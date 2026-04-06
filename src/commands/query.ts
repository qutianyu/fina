import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import matter from 'gray-matter';
import { LLMClient } from '../lib/llm';
import { ConfigManager } from '../lib/config';
import { IndexedSource, Concept } from '../types';
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

  async execute(question: string): Promise<void> {
    if (!question) {
      console.log(chalk.red('Please provide a question.'));
      return;
    }

    const wikiDir = this.config.getWikiDir();
    const sourcesIndexPath = path.join(wikiDir, 'sources-index.json');

    console.log(chalk.cyan(`\n🤔 ${question}\n`));

    if (!await this.config.ensureConfigured()) {
      return;
    }

    if (!await fs.pathExists(sourcesIndexPath)) {
      console.log(chalk.yellow('Wiki not yet compiled. Run /make first.'));
      return;
    }

    const sources = await fs.readJson(sourcesIndexPath) as IndexedSource[];

    if (sources.length === 0) {
      console.log(chalk.yellow('Wiki is empty. Add some sources and run /make.'));
      return;
    }

    // Find relevant sources
    const relevantSources = await this.findRelevantSources(sources, question);
    console.log(chalk.gray(`Found ${relevantSources.length} relevant sources\n`));

    if (relevantSources.length === 0) {
      console.log(chalk.yellow('No relevant sources found. Try rephrasing your question.'));
      return;
    }

    // Build context from relevant sources
    const context = await this.buildContext(wikiDir, relevantSources);

    // Query AI
    const client = new LLMClient(this.config);
    const lang = this.config.getLanguage();
    const isZh = lang === 'zh';

    const systemPrompt = isZh
      ? '你是一个知识库助手，请根据提供的上下文信息，用中文回答用户的问题。如果不确定，请说明。'
      : 'You are a knowledge base assistant. Answer the user question based on the provided context. If you are unsure, say so.';

    try {
      console.log(chalk.gray('Thinking...\n'));

      const message = await client.createMessage({
        model: this.config.getModel(),
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `${systemPrompt}\n\nQuestion: ${question}\n\nContext:\n${context}\n\nAnswer the question based on the context above. At the end of your answer, cite the sources using their full file paths in this format:\n**来源**: [标题](绝对路径)\n\nIf you are unsure, say so.`
        }]
      });

      let response = message.content[0].text;
      // Strip thinking blocks
      const thinkIdx = response.lastIndexOf('</think>');
      if (thinkIdx >= 0) {
        response = response.substring(thinkIdx + 9).trim();
      }
      response = response.replace(/<think>/g, '').replace(/<\/think>/g, '').trim();

      const plainText = this.stripMarkdown(response);
      console.log(chalk.white(plainText));

    } catch (err) {
      console.log(chalk.red(`Query failed: ${(err as Error).message}`));
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
      console.log(chalk.gray('No clear matches found, using AI to find relevant sources...\n'));
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
      console.log(chalk.yellow(`LLM source selection failed: ${(err as Error).message}`));
    }

    // Fallback: return top 3 by backlinks
    return [...sources]
      .sort((a, b) => (b.backlinks?.length || 0) - (a.backlinks?.length || 0))
      .slice(0, 3);
  }

  async buildContext(wikiDir: string, sources: IndexedSource[]): Promise<string> {
    const contexts: string[] = [];

    for (const source of sources) {
      const titleSlug = slugify(source.title);
      const summaryPath = path.join(wikiDir, 'summaries', source.type, `${titleSlug}.md`);

      if (await fs.pathExists(summaryPath)) {
        const content = await fs.readFile(summaryPath, 'utf-8');
        const parsed = matter(content);

        contexts.push(`## ${source.title} (${source.type})\nPath: ${summaryPath}\n\n${parsed.content}`);
      } else {
        // Fallback to what's in index
        contexts.push(`## ${source.title}\n${source.summary || 'No content available'}`);
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
    // Process tables first (they span multiple lines)
    text = this.stripTables(text);

    return text
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      // Remove headers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Remove links but keep text and URL
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      // Remove images but keep URL
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[$1]($2)')
      // Remove blockquotes
      .replace(/^>\s*/gm, '')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}$/gm, '')
      // Clean up extra whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private stripTables(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let inTable = false;
    let separatorSeen = false;

    for (const line of lines) {
      // Check if this is a table row (starts with | and ends with |)
      const isTableRow = /^\|.*\|$/.test(line.trim());

      if (isTableRow) {
        inTable = true;
        // Skip separator line (|---|---|)
        if (/^\|[-:\s]+\|[-:\s\|\s]*$/.test(line.trim())) {
          separatorSeen = true;
          continue;
        }

        // Clean the row: remove leading/trailing |, clean whitespace
        const cells = line.trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map(cell => cell.trim())
          .filter(cell => cell.length > 0);

        result.push(cells.join(' | '));
      } else {
        if (inTable && separatorSeen) {
          // End of table, add separator line
          result.push('');
        }
        inTable = false;
        separatorSeen = false;
        result.push(line);
      }
    }

    return result.join('\n');
  }
}
