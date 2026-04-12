import * as fs from 'fs-extra';
import * as path from 'path';
import picocolors from 'picocolors';
import matter from 'gray-matter';
import { LLMClient } from '../lib/llm';
import { ConfigManager } from '../lib/config';
import { IndexedSource, Concept, ChatMessage } from '../types';
import { slugify } from '../lib/utils';

interface ScoredSource {
  source: IndexedSource;
  score: number;
}

export class QueryCommand {
  private config: ConfigManager;

  constructor(config: ConfigManager) {
    this.config = config;
  }

  async execute(question: string, chatHistory?: ChatMessage[]): Promise<string | null> {
    if (!question) {
      console.log(picocolors.red('Please provide a question.'));
      return null;
    }

    const wikiDir = this.config.getWikiDir();
    const sourcesIndexPath = path.join(wikiDir, 'sources-index.json');

    console.log(picocolors.cyan(`\n🤔 ${question}\n`));

    if (!await this.config.ensureConfigured()) {
      return null;
    }

    // Validate read paths are within KB
    this.config.validateRead(sourcesIndexPath);

    if (!await fs.pathExists(sourcesIndexPath)) {
      console.log(picocolors.yellow('Wiki not yet compiled. Run /make first.'));
      return null;
    }

    const sources = await fs.readJson(sourcesIndexPath) as IndexedSource[];

    if (sources.length === 0) {
      console.log(picocolors.yellow('Wiki is empty. Add some sources and run /make.'));
      return null;
    }

    // Find relevant sources
    const relevantSources = await this.findRelevantSources(sources, question);
    console.log(picocolors.gray(`Found ${relevantSources.length} relevant sources\n`));

    if (relevantSources.length === 0) {
      console.log(picocolors.yellow('No relevant sources found. Try rephrasing your question.'));
      return null;
    }

    // Build context from relevant sources
    const context = await this.buildContext(wikiDir, relevantSources);

    // Query AI
    const client = new LLMClient(this.config);
    const lang = this.config.getLanguage();
    const isZh = lang === 'zh';

    const systemPrompt = isZh
      ? `你是一个知识库助手。如果用户的问题：
1. 包含不明确的指代词（如"它"、"这个"、"他"等）而上下文无法确定
2. 缺少回答所需的关键信息
3. 过于模糊无法给出准确答案

请主动向用户提问澄清，而不是猜测答案。优先问一个最关键的问题。
如果上下文足够回答，请给出准确答案并注明来源。`
      : `You are a knowledge base assistant. If the user's question:
1. Contains ambiguous references ("it", "this", etc.) that cannot be determined from context
2. Lacks key information needed to answer
3. Is too vague to provide an accurate answer

Ask the user for clarification instead of guessing. Ask only the most critical clarifying question.
If context is sufficient, provide an accurate answer and cite sources.`;

    // Build chat history content if present
    let historySection = '';
    if (chatHistory && chatHistory.length > 0) {
      const historyContent = chatHistory
        .map(m => `<${m.role}>${m.content}</${m.role}>`)
        .join('\n\n');
      historySection = `\n\n## Conversation History\n${historyContent}\n\n## Current Question`;
    }

    try {
      console.log(picocolors.gray('Thinking...\n'));

      let fullResponse = '';
      let currentLines = 0;
      let pendingThink = ''; // Accumulate text that might be inside a think block
      let inThinkBlock = false;

      await client.createMessageStream({
        model: this.config.getModel(),
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `${systemPrompt}${historySection}\n\nQuestion: ${question}\n\nContext:\n${context}\n\nAnswer the question based on the context above. At the end of your answer, cite the sources using their full file paths in this format:\n**来源**: 标题 (绝对路径)\n\nIf you are unsure, say so.`
        }],
        onChunk: (text) => {
          fullResponse += text;
          pendingThink += text;

          // Check if we have a complete think block
          const thinkMatch = pendingThink.match(/<think>[\s\S]*?<\/think>/);
          if (thinkMatch) {
            // Found complete think block, remove it from pending
            pendingThink = pendingThink.replace(/<think>[\s\S]*?<\/think>/g, '');
            // Also remove from fullResponse to prevent think content from being displayed
            fullResponse = fullResponse.replace(/<think>[\s\S]*?<\/think>/g, '');
            inThinkBlock = false;
          } else if (pendingThink.includes('<think>') && !pendingThink.includes('</think>')) {
            // We're inside a think block but it hasn't closed yet
            inThinkBlock = true;
            return;
          }

          // Remove think blocks and output
          const displayText = this.stripMarkdown(fullResponse);
          process.stdout.write(displayText.slice(process.stdout.columns || 80));
        }
      });

      console.log();

      // Auto-evaluate and merge if valuable
      await this.evaluateAndAutoMerge(question, fullResponse, relevantSources);

      return fullResponse;

    } catch (err) {
      console.log(picocolors.red(`Query failed: ${(err as Error).message}`));
      return null;
    }
  }

  async executeDirect(question: string, chatHistory?: ChatMessage[]): Promise<string | null> {
    if (!question) {
      console.log(picocolors.red('Please provide a question.'));
      return null;
    }

    if (!await this.config.ensureConfigured()) {
      return null;
    }

    console.log(picocolors.cyan(`\n🤔 ${question}\n`));

    const client = new LLMClient(this.config);
    const lang = this.config.getLanguage();
    const isZh = lang === 'zh';

    const systemPrompt = isZh
      ? `你是一个有用的AI助手。如果用户的问题：
1. 包含不明确的指代词（如"它"、"这个"、"他"等）而上下文无法确定
2. 缺少回答所需的关键信息
3. 过于模糊无法给出准确答案

请主动向用户提问澄清，而不是猜测答案。优先问一个最关键的问题。
如果问题足够清晰，请给出有帮助的回答。`
      : `You are a helpful AI assistant. If the user's question:
1. Contains ambiguous references ("it", "this", etc.) that cannot be determined from context
2. Lacks key information needed to answer
3. Is too vague to provide an accurate answer

Ask the user for clarification instead of guessing. Ask only the most critical clarifying question.
If the question is clear, provide a helpful answer.`;

    // Build messages including history
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      { role: 'system', content: systemPrompt }
    ];

    // Add chat history
    if (chatHistory && chatHistory.length > 0) {
      for (const msg of chatHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add current question
    messages.push({ role: 'user', content: question });

    try {
      console.log(picocolors.gray('Thinking...\n'));

      let fullResponse = '';
      let currentLines = 0;
      let pendingThink = '';
      let inThinkBlock = false;

      await client.createMessageStream({
        model: this.config.getModel(),
        max_tokens: 1500,
        messages,
        onChunk: (text) => {
          fullResponse += text;
          pendingThink += text;

          // Check if we have a complete think block
          const thinkMatch = pendingThink.match(/<think>[\s\S]*?<\/think>/);
          if (thinkMatch) {
            pendingThink = pendingThink.replace(/<think>[\s\S]*?<\/think>/g, '');
            fullResponse = fullResponse.replace(/<think>[\s\S]*?<\/think>/g, '');
            inThinkBlock = false;
          } else if (pendingThink.includes('<think>') && !pendingThink.includes('</think>')) {
            inThinkBlock = true;
            return;
          }

          // Remove any remaining think blocks and render markdown
          let displayText = this.stripMarkdown(fullResponse);
          const newLines = displayText.split('\n').length;

          // Move cursor back to start position
          if (currentLines > 0) {
            process.stdout.write('\x1b[' + currentLines + 'A');
          }
          process.stdout.write('\r');

          // Clear from current position to end of screen
          process.stdout.write('\x1b[0J');

          // Output all content
          process.stdout.write(displayText);

          currentLines = newLines;
        }
      });

      console.log();
      return fullResponse;

    } catch (err) {
      console.log(picocolors.red(`Query failed: ${(err as Error).message}`));
      return null;
    }
  }

  async findRelevantSources(sources: IndexedSource[], question: string): Promise<IndexedSource[]> {
    const queryLower = question.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);

    const scored: ScoredSource[] = sources.map(source => {
      let score = 0;
      const titleLower = (source.title || '').toLowerCase();
      const summaryLower = (source.summary || '').toLowerCase();

      // Check for any query term in any field - more lenient matching
      for (const term of queryTerms) {
        if (term.length < 2) continue;

        // Title match (highest weight)
        if (titleLower.includes(term)) score += 10;

        // Summary match (medium weight)
        if (summaryLower.includes(term)) score += 5;

        // Concept match
        if (source.concepts) {
          for (const concept of source.concepts) {
            if (concept.toLowerCase().includes(term)) score += 4;
          }
        }
      }

      // For general questions like "what is this", return all sources with some content
      const generalQuestionPatterns = [
        'what is', '这是什么', '介绍', '是什么', '关于',
        'tell me about', '介绍', '摘要', '总结'
      ];
      const isGeneralQuestion = generalQuestionPatterns.some(p => queryLower.includes(p));

      if (isGeneralQuestion) {
        // Boost score for all sources that have meaningful content
        score += source.summary ? 2 : 0;
      }

      // Backlink count (more connected = more likely relevant)
      score += (source.backlinks?.length || 0) * 0.5;

      return { source, score };
    });

    // Sort by score, if tie use backlink count
    scored.sort((a, b) => b.score - a.score || (b.source.backlinks?.length || 0) - (a.source.backlinks?.length || 0));

    const maxScore = scored.length > 0 ? scored[0].score : 0;

    // If no source has score >= 4, use LLM to find relevant sources
    if (maxScore < 4 && sources.length > 0) {
      console.log(picocolors.gray('No clear matches found, using AI to find relevant sources...\n'));
      return await this.findRelevantSourcesWithLLM(sources, question);
    }

    // Filter to only sources with score > 0, max 10
    const results = scored.filter(s => s.score > 0).slice(0, 10);

    return results.map(s => s.source);
  }

  private async findRelevantSourcesWithLLM(sources: IndexedSource[], question: string): Promise<IndexedSource[]> {
    const client = new LLMClient(this.config);
    const lang = this.config.getLanguage();
    const isZh = lang === 'zh';

    // Build summaries list
    const summariesList = sources.map(s =>
      `[${s.id}] ${s.title}\n${s.summary || '(no summary)'}`
    ).join('\n\n---\n\n');

    const systemPrompt = isZh
      ? '你是一个知识库助手。你的任务是从给定的文章列表中，找出与用户问题最相关的文章。'
      : 'You are a knowledge base assistant. Your task is to find the most relevant articles from the given list for the user question.';

    const userPrompt = isZh
      ? `问题: ${question}

文章列表:
${summariesList}

请从上面的列表中找出与问题最相关的文章（最多5篇），只返回文章ID，格式如下:
[ID1, ID2, ID3]

如果没有相关文章，返回空数组: []`
      : `Question: ${question}

Articles:
${summariesList}

Find the most relevant articles (max 5) for the question above. Return only the article IDs in this format:
[ID1, ID2, ID3]

If no relevant articles found, return empty array: []`;

    try {
      const message = await client.createMessage({
        model: this.config.getModel(),
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      });

      let response = message.content[0].text;
      // Extract IDs from response
      const match = response.match(/\[([^\]]+)\]/);
      if (match) {
        const ids = match[1].split(/[,，\s]+/).map(id => id.trim()).filter(Boolean);
        return sources.filter((s: IndexedSource) => ids.includes(s.id));
      }
    } catch (err) {
      console.log(picocolors.yellow(`LLM source selection failed: ${(err as Error).message}`));
    }

    // Fallback: return top 3 by backlinks
    return [...sources]
      .sort((a, b) => (b.backlinks?.length || 0) - (a.backlinks?.length || 0))
      .slice(0, 3);
  }

  async buildContext(wikiDir: string, sources: IndexedSource[]): Promise<string> {
    const contexts: string[] = [];
    const sourcesIndexPath = path.join(wikiDir, 'sources-index.json');

    // Collect all source IDs to include (direct + backlinks expansion)
    const sourceIdsToInclude = new Set<string>();
    for (const source of sources) {
      sourceIdsToInclude.add(source.id);
      // Add backlinks (source IDs that reference this source)
      for (const backlink of source.backlinks || []) {
        sourceIdsToInclude.add(backlink);
      }
    }

    // Read all sources from index
    let allSources: IndexedSource[] = [];
    if (await fs.pathExists(sourcesIndexPath)) {
      allSources = await fs.readJson(sourcesIndexPath) as IndexedSource[];
    }

    // Build context for included sources
    for (const sourceId of sourceIdsToInclude) {
      const source = allSources.find(s => s.id === sourceId);
      if (!source) continue;

      const titleSlug = slugify(source.title);
      const summaryPath = path.join(wikiDir, 'summaries', source.type, `${titleSlug}.md`);

      // Validate path is within KB
      this.config.validateRead(summaryPath);

      if (await fs.pathExists(summaryPath)) {
        const content = await fs.readFile(summaryPath, 'utf-8');
        const parsed = matter(content);

        const prefix = sourceIdsToInclude.has(source.id) ? '' : '[via backlink] ';
        contexts.push(`${prefix}## ${source.title} (${source.type})\nPath: ${summaryPath}\n\n${parsed.content}`);
      } else {
        const prefix = sourceIdsToInclude.has(source.id) ? '' : '[via backlink] ';
        contexts.push(`${prefix}## ${source.title}\n${source.summary || 'No content available'}`);
      }
    }

    // Also include concept definitions
    if (sources.length > 0) {
      const allConcepts = new Set<string>();
      for (const source of sources) {
        for (const concept of source.concepts || []) {
          allConcepts.add(concept);
        }
      }

      if (allConcepts.size > 0) {
        const conceptsIndexPath = path.join(wikiDir, 'concepts-index.json');
        this.config.validateRead(conceptsIndexPath);

        if (await fs.pathExists(conceptsIndexPath)) {
          const conceptsIndex = await fs.readJson(conceptsIndexPath);
          const concepts: Concept[] = conceptsIndex.concepts || [];
          contexts.push('\n## Relevant Concepts\n');
          for (const concept of concepts) {
            if (allConcepts.has(concept.term)) {
              contexts.push(`**${concept.term}**: ${concept.definition || 'No definition'}`);
            }
          }
        }
      }
    }

    return contexts.join('\n\n');
  }

  private stripMarkdown(text: string): string {
    // Remove think blocks first (before any other processing)
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '');

    // Process tables first (they span multiple lines)
    text = this.renderTables(text);

    const lines = text.split('\n');
    const result: string[] = [];
    let inCodeBlock = false;
    let inList = false;
    let listIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code block handling
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          result.push('');
        } else {
          inCodeBlock = false;
          result.push('');
        }
        continue;
      }

      if (inCodeBlock) {
        result.push('  ' + line);
        continue;
      }

      // Headers - add underline
      const headerMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headerMatch) {
        const level = headerMatch[1].length;
        const content = headerMatch[2];
        const underlineChar = level === 1 ? '=' : level === 2 ? '-' : '~';
        result.push('');
        result.push(content);
        result.push(underlineChar.repeat(Math.min(content.length, 40)));
        result.push('');
        continue;
      }

      // List items
      const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)/);
      if (listMatch) {
        const indent = listMatch[1].length;
        const marker = listMatch[2];
        const content = listMatch[3];

        if (marker.match(/\d+\./)) {
          result.push('  '.repeat(indent) + content);
        } else {
          result.push('  '.repeat(indent) + '• ' + content);
        }
        continue;
      }

      // Horizontal rule
      if (line.match(/^[-*_]{3,}$/)) {
        result.push('─'.repeat(40));
        continue;
      }

      // Blockquotes
      const quoteMatch = line.match(/^>\s*(.*)/);
      if (quoteMatch) {
        result.push('│ ' + quoteMatch[1]);
        continue;
      }

      // Regular text - process inline formatting
      let processed = line
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

      if (processed.trim()) {
        result.push(processed);
      }
    }

    return result.join('\n');
  }

  private renderTables(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let rows: string[][] = [];
    let colWidths: number[] = [];
    let inTable = false;

    for (const line of lines) {
      // Check if this is a table row (starts with | and ends with |)
      const isTableRow = /^\|.*\|$/.test(line.trim());

      if (isTableRow) {
        inTable = true;
        // Skip separator line (|---|---|)
        if (/^\|[-:\s]+\|[-:\s\|\s]*$/.test(line.trim())) {
          continue;
        }

        // Clean the row: remove leading/trailing |, clean whitespace
        const cells = line.trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map(cell => cell.trim())
          .filter(cell => cell.length > 0);

        rows.push(cells);

        // Update column widths
        cells.forEach((cell, i) => {
          const len = this.visibleLength(cell);
          colWidths[i] = Math.max(colWidths[i] || 0, len);
        });
      } else {
        if (inTable && rows.length > 0) {
          // Render the table with borders
          result.push('');
          this.renderTableRow(result, rows[0], colWidths, true);
          result.push(colWidths.map(w => '─'.repeat(w)).join('─┼─'));
          for (let i = 1; i < rows.length; i++) {
            this.renderTableRow(result, rows[i], colWidths, false);
          }
          result.push('');
          rows = [];
          colWidths = [];
        }
        inTable = false;
        result.push(line);
      }
    }

    // Handle table at end of text
    if (inTable && rows.length > 0) {
      result.push('');
      this.renderTableRow(result, rows[0], colWidths, true);
      result.push(colWidths.map(w => '─'.repeat(w)).join('─┼─'));
      for (let i = 1; i < rows.length; i++) {
        this.renderTableRow(result, rows[i], colWidths, false);
      }
      result.push('');
    }

    return result.join('\n');
  }

  private visibleLength(str: string): number {
    // Calculate visible length (strip ANSI codes)
    return str.replace(/\x1b\[[0-9;]*m/g, '').length;
  }

  private renderTableRow(output: string[], cells: string[], widths: number[], isHeader: boolean): void {
    const formatted = cells.map((cell, i) => {
      const len = this.visibleLength(cell);
      const pad = widths[i] - len;
      return cell + ' '.repeat(pad);
    });
    const prefix = isHeader ? '│ ' : '│ ';
    const suffix = ' │';
    output.push(prefix + formatted.join(' │ ') + suffix);
  }

  /** Evaluate if answer is valuable enough to merge, and auto-merge if yes */
  private async evaluateAndAutoMerge(question: string, answer: string, relevantSources: IndexedSource[]): Promise<void> {
    try {
      const evaluation = await this.evaluateMergeValue(question, answer, relevantSources);

      if (evaluation.shouldMerge && evaluation.targetConcept) {
        console.log(picocolors.gray(`  💾 Auto-merging to "${evaluation.targetConcept}"...`));
        await this.autoMerge(question, answer, evaluation.targetConcept);
        console.log(picocolors.green(`  ✓ Merged into "${evaluation.targetConcept}"`));
      }
    } catch (err) {
      // Silently fail - auto-merge is best-effort
      console.log(picocolors.gray(`  (skipping auto-merge: ${(err as Error).message})`));
    }
  }

  /** Evaluate if the answer should be merged */
  private async evaluateMergeValue(question: string, answer: string, relevantSources: IndexedSource[]): Promise<{
    shouldMerge: boolean;
    targetConcept: string | null;
    reason: string;
  }> {
    const wikiDir = this.config.getWikiDir();
    const conceptsIndexPath = path.join(wikiDir, 'concepts-index.json');

    // Collect all available concepts
    let allConcepts: string[] = [];
    if (await fs.pathExists(conceptsIndexPath)) {
      const conceptsIndex = await fs.readJson(conceptsIndexPath);
      allConcepts = (conceptsIndex.concepts || []).map((c: Concept) => c.term);
    }

    // Collect concepts from relevant sources
    const sourceConcepts = [...new Set(relevantSources.flatMap(s => s.concepts || []))];
    const availableConcepts = [...new Set([...allConcepts, ...sourceConcepts])];

    if (availableConcepts.length === 0) {
      return { shouldMerge: false, targetConcept: null, reason: 'No concepts available' };
    }

    const lang = this.config.getLanguage();
    const isZh = lang === 'zh';

    const systemPrompt = isZh
      ? await fs.readFile(path.join(process.cwd(), 'prompts', 'query', 'evaluate-merge-system-zh.txt'), 'utf-8')
      : await fs.readFile(path.join(process.cwd(), 'prompts', 'query', 'evaluate-merge-system-en.txt'), 'utf-8');

    const userPrompt = isZh
      ? await fs.readFile(path.join(process.cwd(), 'prompts', 'query', 'evaluate-merge-user-zh.txt'), 'utf-8')
      : await fs.readFile(path.join(process.cwd(), 'prompts', 'query', 'evaluate-merge-user-en.txt'), 'utf-8');

    const formattedUserPrompt = userPrompt
      .replace('{question}', question)
      .replace('{answer}', answer)
      .replace('{concepts}', availableConcepts.join(', '));

    const client = new LLMClient(this.config);

    const message = await client.createMessage({
      model: this.config.getModel(),
      max_tokens: 500,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: formattedUserPrompt }
      ]
    });

    const response = message.content[0]?.text || '';

    // Parse response
    const mergeMatch = response.match(/MERGE:\s*(YES|NO)/i);
    const targetMatch = response.match(/TARGET:\s*([^\s,]+)/i);
    const reasonMatch = response.match(/REASON:\s*([^\n]+)/i);

    const shouldMerge = mergeMatch?.[1]?.toUpperCase() === 'YES';
    const targetConcept = targetMatch?.[1] || null;

    return {
      shouldMerge,
      targetConcept,
      reason: reasonMatch?.[1] || ''
    };
  }

  /** Auto-merge answer into target concept */
  private async autoMerge(question: string, answer: string, targetConcept: string): Promise<void> {
    const wikiDir = this.config.getWikiDir();
    const conceptDir = path.join(wikiDir, 'concepts');
    const conceptsIndexPath = path.join(wikiDir, 'concepts-index.json');

    // Find matching concept file
    let conceptFiles = await fs.readdir(conceptDir);
    let matchedFile = conceptFiles.find(f =>
      f.replace('.md', '').toLowerCase() === slugify(targetConcept).toLowerCase()
    );

    if (!matchedFile) {
      throw new Error(`Concept not found: ${targetConcept}`);
    }

    const conceptPath = path.join(conceptDir, matchedFile);
    this.config.validateWrite(conceptPath);

    // Read concept file
    const conceptContent = await fs.readFile(conceptPath, 'utf-8');
    const { data: conceptMeta, content: conceptBody } = matter(conceptContent);

    // Merge content: append answer to concept
    const mergedContent = matter.stringify(
      `${conceptBody}\n\n---\n\n## From Query: ${question}\n\n${answer}`,
      {
        term: conceptMeta?.term || targetConcept,
        sources: conceptMeta?.sources || [],
        relatedConcepts: conceptMeta?.relatedConcepts || [],
        backlinks: conceptMeta?.backlinks || [],
        updated: new Date().toISOString(),
        autoMerged: true
      }
    );

    // Write merged concept
    await fs.writeFile(conceptPath, mergedContent);

    // Update backlinks in concepts-index.json
    if (await fs.pathExists(conceptsIndexPath)) {
      const conceptsIndex = await fs.readJson(conceptsIndexPath);
      const concepts = conceptsIndex.concepts || [];

      const targetSlug = slugify(targetConcept);
      for (const concept of concepts) {
        if (slugify(concept.term) === targetSlug) {
          if (!concept.backlinks) {
            concept.backlinks = [];
          }
          break;
        }
      }

      await fs.writeJson(conceptsIndexPath, conceptsIndex, { spaces: 2 });
    }
  }
}
