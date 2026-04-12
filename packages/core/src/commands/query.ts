import * as fs from 'fs-extra';
import * as path from 'path';
import matter from 'gray-matter';
import { LLMClient } from '../lib/llm';
import { ConfigManager } from '../lib/config';
import { IndexedSource, Concept, ChatMessage } from '../types';
import { slugify } from '../lib/utils';
import { OutputWriter, ConsoleOutput, StreamRenderer } from '../lib/output';

interface ScoredSource {
  source: IndexedSource;
  score: number;
}

export class QueryCommand {
  private config: ConfigManager;
  private output: OutputWriter;

  constructor(config: ConfigManager, output?: OutputWriter) {
    this.config = config;
    this.output = output || new ConsoleOutput();
  }

  async execute(question: string, historyOrOptions?: ChatMessage[] | { streamRenderer?: StreamRenderer; abortSignal?: AbortSignal }): Promise<string | null> {
    let options: { streamRenderer?: StreamRenderer; abortSignal?: AbortSignal } | undefined;
    if (historyOrOptions && !Array.isArray(historyOrOptions)) {
      options = historyOrOptions;
    }
    if (!question) {
      this.output.error('Please provide a question.');
      return null;
    }

    const wikiDir = this.config.getWikiDir();
    const sourcesIndexPath = path.join(wikiDir, 'sources-index.json');

    this.output.info(`\n🤔 ${question}\n`);

    if (!await this.config.ensureConfigured()) {
      return null;
    }

    this.config.validateRead(sourcesIndexPath);

    if (!await fs.pathExists(sourcesIndexPath)) {
      this.output.warn('Wiki not yet compiled. Run /make first.');
      return null;
    }

    const sources = await fs.readJson(sourcesIndexPath) as IndexedSource[];

    if (sources.length === 0) {
      this.output.warn('Wiki is empty. Add some sources and run /make.');
      return null;
    }

    const relevantSources = await this.findRelevantSources(sources, question);
    this.output.log(`Found ${relevantSources.length} relevant sources\n`);

    if (relevantSources.length === 0) {
      this.output.warn('No relevant sources found. Try rephrasing your question.');
      return null;
    }

    const context = await this.buildContext(wikiDir, relevantSources);
    const streamRenderer = options?.streamRenderer;
    const abortSignal = options?.abortSignal;

    const client = new LLMClient(this.config);
    const lang = this.config.getLanguage();
    const isZh = lang === 'zh';

    const systemPrompt = isZh
      ? '你是一个知识库助手，请根据提供的上下文信息，用中文回答用户的问题。如果不确定，请说明。'
      : 'You are a knowledge base assistant. Answer the user question based on the provided context. If you are unsure, say so.';

    try {
      let fullResponse = '';
      let pendingThink = '';
      let inThinkBlock = false;

      if (abortSignal?.aborted) {
        throw new Error('Query was aborted');
      }

      this.output.log('Thinking...\n');

      await client.createMessageStream({
        model: this.config.getModel(),
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `${systemPrompt}\n\nQuestion: ${question}\n\nContext:\n${context}\n\nAnswer the question based on the context above. At the end of your answer, cite the sources.\n\nIf you are unsure, say so.`
        }],
        onChunk: (text) => {
          fullResponse += text;
          pendingThink += text;

          // Check if we have a complete think block
          const thinkMatch = pendingThink.match(/<think>[\s\S]*?<\/think>/);
          if (thinkMatch) {
            // Found complete think block, remove it from pending
            pendingThink = pendingThink.replace(/<think>[\s\S]*?<\/think>/g, '');
            fullResponse = fullResponse.replace(/<think>[\s\S]*?<\/think>/g, '');
            inThinkBlock = false;
          } else if (pendingThink.includes('<think>') && !pendingThink.includes('</think>')) {
            // We're inside a think block but it hasn't closed yet
            if (streamRenderer && !inThinkBlock) {
              streamRenderer.onThinkStart();
            }
            inThinkBlock = true;
            return; // Don't display anything yet
          }

          if (!inThinkBlock) {
            if (streamRenderer) {
              streamRenderer.onChunk(text);
            } else {
              // Terminal mode: render markdown and update display
              const displayText = this.stripMarkdown(fullResponse);
              process.stdout.write('\r\x1b[0J' + displayText);
            }
          }
        }
      });

      if (streamRenderer) {
        const sourceNames = relevantSources.map(s => s.title);
        streamRenderer.onSources(sourceNames);
        streamRenderer.onDone(fullResponse);
      }

      this.output.log('');

      return fullResponse;

    } catch (err) {
      this.output.error(`Query failed: ${(err as Error).message}`);
      if (streamRenderer) {
        streamRenderer.onError((err as Error).message);
      }
      return null;
    }
  }

  async executeDirect(question: string, historyOrOptions?: ChatMessage[] | { streamRenderer?: StreamRenderer; abortSignal?: AbortSignal }): Promise<string | null> {
    const options = historyOrOptions && !Array.isArray(historyOrOptions) ? historyOrOptions : undefined;
    if (!question) {
      this.output.error('Please provide a question.');
      return null;
    }

    if (!await this.config.ensureConfigured()) {
      return null;
    }

    this.output.info(`\n🤔 ${question}\n`);

    const client = new LLMClient(this.config);
    const streamRenderer = options?.streamRenderer;
    const abortSignal = options?.abortSignal;
    const lang = this.config.getLanguage();
    const isZh = lang === 'zh';

    const systemPrompt = isZh
      ? '你是一个有用的AI助手，请用中文回答用户的问题。'
      : 'You are a helpful AI assistant. Answer the user question in a helpful way.';

    try {
      let fullResponse = '';
      let pendingThink = '';
      let inThinkBlock = false;

      if (abortSignal?.aborted) {
        throw new Error('Query was aborted');
      }

      this.output.log('Thinking...\n');

      await client.createMessageStream({
        model: this.config.getModel(),
        max_tokens: 1500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        onChunk: (text) => {
          fullResponse += text;
          pendingThink += text;

          // Check if we have a complete think block
          const thinkMatch = pendingThink.match(/<think>[\s\S]*?<\/think>/);
          if (thinkMatch) {
            // Found complete think block, remove it from pending and displayText
            pendingThink = pendingThink.replace(/<think>[\s\S]*?<\/think>/g, '');
            fullResponse = fullResponse.replace(/<think>[\s\S]*?<\/think>/g, '');
            inThinkBlock = false;
          } else if (pendingThink.includes('<think>') && !pendingThink.includes('</think>')) {
            // We're inside a think block but it hasn't closed yet
            if (streamRenderer && !inThinkBlock) {
              streamRenderer.onThinkStart();
            }
            inThinkBlock = true;
            return; // Don't display anything yet
          }

          if (!inThinkBlock) {
            if (streamRenderer) {
              streamRenderer.onChunk(text);
            } else {
              // Terminal mode: render markdown and update display
              const displayText = this.stripMarkdown(fullResponse);
              process.stdout.write('\r\x1b[0J' + displayText);
            }
          }
        }
      });

      if (streamRenderer) {
        streamRenderer.onDone(fullResponse);
      }

      this.output.log('');

      return fullResponse;

    } catch (err) {
      this.output.error(`Query failed: ${(err as Error).message}`);
      if (streamRenderer) {
        streamRenderer.onError((err as Error).message);
      }
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

      for (const term of queryTerms) {
        if (term.length < 2) continue;

        if (titleLower.includes(term)) score += 10;
        if (summaryLower.includes(term)) score += 5;

        if (source.concepts) {
          for (const concept of source.concepts) {
            if (concept.toLowerCase().includes(term)) score += 4;
          }
        }
      }

      const generalQuestionPatterns = [
        'what is', '这是什么', '介绍', '是什么', '关于',
        'tell me about', '摘要', '总结'
      ];
      const isGeneralQuestion = generalQuestionPatterns.some(p => queryLower.includes(p));

      if (isGeneralQuestion) {
        score += source.summary ? 2 : 0;
      }

      score += (source.backlinks?.length || 0) * 0.5;

      return { source, score };
    });

    scored.sort((a, b) => b.score - a.score || (b.source.backlinks?.length || 0) - (a.source.backlinks?.length || 0));

    const maxScore = scored.length > 0 ? scored[0].score : 0;

    if (maxScore < 4 && sources.length > 0) {
      this.output.log('No clear matches found, using AI to find relevant sources...\n');
      return await this.findRelevantSourcesWithLLM(sources, question);
    }

    const results = scored.filter(s => s.score > 0).slice(0, 10);
    return results.map(s => s.source);
  }

  private async findRelevantSourcesWithLLM(sources: IndexedSource[], question: string): Promise<IndexedSource[]> {
    const client = new LLMClient(this.config);
    const lang = this.config.getLanguage();
    const isZh = lang === 'zh';

    const summariesList = sources.map(s =>
      `[${s.id}] ${s.title}\n${s.summary || '(no summary)'}`
    ).join('\n\n---\n\n');

    const systemPrompt = isZh
      ? '你是一个知识库助手。你的任务是从给定的文章列表中，找出与用户问题最相关的文章。'
      : 'You are a knowledge base assistant. Your task is to find the most relevant articles from the given list for the user question.';

    const userPrompt = isZh
      ? `问题: ${question}\n\n文章列表:\n${summariesList}\n\n请从上面的列表中找出与问题最相关的文章（最多5篇），只返回文章ID，格式如下:\n[ID1, ID2, ID3]\n\n如果没有相关文章，返回空数组: []`
      : `Question: ${question}\n\nArticles:\n${summariesList}\n\nFind the most relevant articles (max 5) for the question above. Return only the article IDs in this format:\n[ID1, ID2, ID3]\n\nIf no relevant articles found, return empty array: []`;

    try {
      const message = await client.createMessage({
        model: this.config.getModel(),
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      });

      const response = message.content[0].text;
      const match = response.match(/\[([^\]]+)\]/);
      if (match) {
        const ids = match[1].split(/[,，\s]+/).map(id => id.trim()).filter(Boolean);
        return sources.filter((s: IndexedSource) => ids.includes(s.id));
      }
    } catch (err) {
      this.output.warn(`LLM source selection failed: ${(err as Error).message}`);
    }

    return [...sources]
      .sort((a, b) => (b.backlinks?.length || 0) - (a.backlinks?.length || 0))
      .slice(0, 3);
  }

  async buildContext(wikiDir: string, sources: IndexedSource[]): Promise<string> {
    const contexts: string[] = [];

    for (const source of sources) {
      const titleSlug = slugify(source.title);
      const summaryPath = path.join(wikiDir, 'summaries', source.type, `${titleSlug}.md`);

      this.config.validateRead(summaryPath);

      if (await fs.pathExists(summaryPath)) {
        const content = await fs.readFile(summaryPath, 'utf-8');
        const parsed = matter(content);
        contexts.push(`## ${source.title} (${source.type})\nPath: ${summaryPath}\n\n${parsed.content}`);
      } else {
        contexts.push(`## ${source.title}\n${source.summary || 'No content available'}`);
      }
    }

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
          const concepts = await fs.readJson(conceptsIndexPath) as Concept[];
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
    text = text.replace(/<think[\s\S]*?<\/think>/g, '');
    text = this.renderTables(text);

    const lines = text.split('\n');
    const result: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
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

      if (line.match(/^[-*_]{3,}$/)) {
        result.push('─'.repeat(40));
        continue;
      }

      const quoteMatch = line.match(/^>\s*(.*)/);
      if (quoteMatch) {
        result.push('│ ' + quoteMatch[1]);
        continue;
      }

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
      const isTableRow = /^\|.*\|$/.test(line.trim());

      if (isTableRow) {
        inTable = true;
        if (/^\|[-:\s]+\|[-:\s\|\s]*$/.test(line.trim())) {
          continue;
        }

        const cells = line.trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map(cell => cell.trim())
          .filter(cell => cell.length > 0);

        rows.push(cells);
        cells.forEach((cell, i) => {
          const len = this.visibleLength(cell);
          colWidths[i] = Math.max(colWidths[i] || 0, len);
        });
      } else {
        if (inTable && rows.length > 0) {
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
}