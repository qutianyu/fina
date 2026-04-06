const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const matter = require('gray-matter');
const { LLMClient } = require('../lib/llm.js');

class QueryCommand {
  constructor(config) {
    this.config = config;
  }

  async execute(question) {
    if (!question) {
      console.log(chalk.red('Please provide a question.'));
      return;
    }

    const wikiDir = this.config.getWikiDir();
    const indexPath = path.join(wikiDir, 'index.json');

    console.log(chalk.cyan(`\n🤔 ${question}\n`));

    if (!await this.config.ensureConfigured()) {
      return;
    }

    if (!await fs.pathExists(indexPath)) {
      console.log(chalk.yellow('Wiki not yet compiled. Run /make first.'));
      return;
    }

    const index = await fs.readJson(indexPath);

    if (index.sources.length === 0) {
      console.log(chalk.yellow('Wiki is empty. Add some sources and run /make.'));
      return;
    }

    // Find relevant sources
    const relevantSources = this.findRelevantSources(index, question);
    console.log(chalk.gray(`Found ${relevantSources.length} relevant sources\n`));

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

      console.log(chalk.white(response));

    } catch (err) {
      console.log(chalk.red(`Query failed: ${err.message}`));
    }
  }

  findRelevantSources(index, question) {
    const queryLower = question.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);

    const scored = index.sources.map(source => {
      let score = 0;
      const titleLower = (source.title || '').toLowerCase();
      const summaryLower = (source.summary || '').toLowerCase();
      const contentLower = (source.content || '').toLowerCase();

      // Check for any query term in any field - more lenient matching
      for (const term of queryTerms) {
        if (term.length < 2) continue;

        // Title match (highest weight)
        if (titleLower.includes(term)) score += 10;

        // Summary match (medium weight)
        if (summaryLower.includes(term)) score += 5;

        // Content preview match
        if (contentLower.includes(term)) score += 3;

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
        score += (source.summary || source.content) ? 2 : 0;
      }

      // Backlink count (more connected = more likely relevant)
      score += (source.backlinks?.length || 0) * 0.5;

      return { source, score };
    });

    // Sort by score, if tie use backlink count
    scored.sort((a, b) => b.score - a.score || (b.source.backlinks?.length || 0) - (a.source.backlinks?.length || 0));

    // Always return at least some sources if available
    const results = scored.slice(0, 10);

    // If no sources have any score, return the top sources by backlinks or recency
    if (results.every(s => s.score === 0) && index.sources.length > 0) {
      const fallback = [...index.sources]
        .sort((a, b) => (b.backlinks?.length || 0) - (a.backlinks?.length || 0))
        .slice(0, 3);
      return fallback;
    }

    return results.map(s => s.source);
  }

  async buildContext(wikiDir, sources) {
    const contexts = [];

    for (const source of sources) {
      const summaryPath = path.join(wikiDir, 'summaries', `${source.id}.md`);

      if (await fs.pathExists(summaryPath)) {
        const content = await fs.readFile(summaryPath, 'utf-8');
        const parsed = matter(content);

        contexts.push(`## ${source.title} (${source.type})\nPath: ${summaryPath}\n\n${parsed.content.substring(0, 1500)}`);
      } else {
        // Fallback to what's in index
        contexts.push(`## ${source.title}\n${source.summary || source.content?.substring(0, 1000) || 'No content available'}`);
      }
    }

    // Also include concept definitions
    if (sources.length > 0) {
      const allConcepts = new Set();
      for (const source of sources) {
        for (const concept of source.concepts || []) {
          allConcepts.add(concept);
        }
      }

      if (allConcepts.size > 0) {
        const indexPath = path.join(wikiDir, 'index.json');
        if (await fs.pathExists(indexPath)) {
          const index = await fs.readJson(indexPath);
          contexts.push('\n## Relevant Concepts\n');
          for (const concept of index.concepts || []) {
            if (allConcepts.has(concept.term)) {
              contexts.push(`**${concept.term}**: ${concept.definition || 'No definition'}`);
            }
          }
        }
      }
    }

    return contexts.join('\n\n');
  }

  generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

module.exports = { QueryCommand };