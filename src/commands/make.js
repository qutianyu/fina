const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const matter = require('gray-matter');
const { LLMClient } = require('../lib/llm.js');

class MakeCommand {
  constructor(config) {
    this.config = config;
    this.sources = [];
    this.concepts = [];
  }

  async execute() {
    console.log(chalk.cyan('\n🔨 Compiling wiki...\n'));

    if (!await this.config.ensureConfigured()) {
      return;
    }

    const rawDir = this.config.getRawDir();
    const wikiDir = this.config.getWikiDir();

    // Ensure wiki directories exist
    await fs.ensureDir(path.join(wikiDir, 'concepts'));
    await fs.ensureDir(path.join(wikiDir, 'summaries'));

    // Step 1: Collect all raw files
    console.log(chalk.gray('📁 Scanning raw materials...'));
    await this.collectRawFiles(rawDir);
    const totalChars = this.sources.reduce((sum, s) => sum + (s.content?.length || 0), 0);
    console.log(chalk.green(`  Found ${this.sources.length} sources (${totalChars} chars)`));

    if (this.sources.length === 0) {
      console.log(chalk.yellow('\n⚠ No raw materials found. Add some with /add first.'));
      return;
    }

    // Step 2: Generate summaries using AI
    console.log(chalk.gray('\n✍️  Generating summaries...'));
    await this.generateSummaries();

    // Step 3: Extract and define concepts
    console.log(chalk.gray('\n🧠 Extracting concepts...'));
    await this.extractConcepts();

    // Step 4: Build relationships and backlinks
    console.log(chalk.gray('\n🔗 Building relationships...'));
    await this.buildRelationships();

    // Step 5: Update wiki files with backlinks (rewrite after relationships built)
    console.log(chalk.gray('\n📝 Updating wiki files with relationships...'));
    await this.writeWikiFiles(wikiDir);

    // Step 6: Update index with concepts (sources already written incrementally)
    const indexPath = path.join(wikiDir, 'index.json');
    let index = { version: '1.0', lastUpdated: new Date().toISOString(), sources: [], concepts: [] };
    if (await fs.pathExists(indexPath)) {
      index = await fs.readJson(indexPath);
    }
    index.concepts = this.concepts;
    index.lastUpdated = new Date().toISOString();
    await fs.writeJson(indexPath, index, { spaces: 2 });

    console.log(chalk.green('\n✅ Wiki compiled successfully!'));
    console.log(chalk.gray(`  Sources: ${this.sources.length}`));
    console.log(chalk.gray(`  Concepts: ${this.concepts.length}`));
  }

  async collectRawFiles(dir) {
    const items = await fs.readdir(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        // Recurse into all subdirectories (including timestamp-based dirs)
        await this.collectRawFiles(fullPath);
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        const stats = await fs.stat(fullPath);

        if (['.md', '.txt'].includes(ext)) {
          const content = await fs.readFile(fullPath, 'utf-8');
          const parsed = matter(content);
          this.sources.push({
            id: parsed.data.id || this.generateId(),
            path: path.relative(dir, fullPath),
            type: 'article',
            title: parsed.data.title || item.name.replace(ext, ''),
            content: parsed.content,
            summary: parsed.data.summary || '',
            concepts: parsed.data.concepts || [],
            backlinks: [],
            addedAt: parsed.data.addedAt || stats.mtime.toISOString(),
            source: parsed.data.source || 'local'
          });
        } else if (['.js', '.ts', '.py', '.go', '.rs'].includes(ext)) {
          const content = await fs.readFile(fullPath, 'utf-8');
          this.sources.push({
            id: this.generateId(),
            path: path.relative(dir, fullPath),
            type: 'code',
            title: item.name,
            content: content.substring(0, 5000), // Limit size
            summary: '',
            concepts: [],
            backlinks: [],
            addedAt: stats.mtime.toISOString(),
            source: 'local'
          });
        }
        // Images and other files are tracked but not parsed for content
      }
    }
  }

  async generateSummaries() {
    const client = new LLMClient(this.config);
    const batchSize = 3;
    const lang = this.config.getLanguage();
    const isZh = lang === 'zh';
    const maxContextTokens = this.config.getMaxContextTokens();

    // Calculate total content length (rough estimate: 1 token ≈ 2.5 chars, accounting for prompt overhead and output)
    const totalChars = this.sources.reduce((sum, s) => sum + (s.content?.length || 0), 0);
    const estimatedTokens = totalChars / 2.5;

    // Decide: all at once vs batched
    const useAllAtOnce = maxContextTokens > 0 && estimatedTokens < maxContextTokens;

    console.log(chalk.gray(`  maxContextTokens=${maxContextTokens}, estimatedTokens=${Math.round(estimatedTokens)}, useAllAtOnce=${useAllAtOnce}`));

    if (useAllAtOnce) {
      console.log(chalk.gray(`  Processing all at once...`));
      await this.generateSummariesAllAtOnce(client, lang, isZh);
    } else {
      console.log(chalk.gray(`  Using batched processing...`));
      await this.generateSummariesBatched(client, batchSize, lang, isZh);
    }
  }

  async generateSummariesAllAtOnce(client, lang, isZh) {
    const systemPrompt = isZh
      ? '请用中文回答。'
      : 'Please respond in English.';

    const userPrompt = isZh
      ? `请对以下所有来源逐一进行处理，每个来源需要：
1. 提供简要摘要（2-3句话）
2. 列出3-5个关键概念/标签
3. 对内容进行适度压缩（保留原意，删除冗余内容），但不要改变原文的核心信息

格式要求（严格按此格式输出，不要省略任何部分）：
## [标题1]
**摘要:** 这是该来源的简要摘要
**概念:** 概念1, 概念2, 概念3
---
[压缩后的完整内容]

## [标题2]
**摘要:** ...
**概念:** ...
---
[压缩后的内容]

（以此类推，对每个来源都要有完整的上述四部分内容）
`
      : `Process each of the following sources. For each one provide:
1. A brief summary (2-3 sentences)
2. 3-5 key concepts/tags
3. Moderately compressed content (preserve meaning, remove redundancy, keep core info)

Format for EACH source (strictly follow this format):
## [Title1]
**Summary:** Brief summary here
**Concepts:** concept1, concept2, concept3
---
Compressed content here

## [Title2]
**Summary:** ...
**Concepts:** ...
---
Compressed content...

(Repeat for every source, include ALL sources)
`;

    const contents = this.sources.map((s, idx) =>
      `=== Source ${idx + 1}: ${s.title} ===\nType: ${s.type}\n\n${s.content.substring(0, 6000)}`
    ).join('\n\n==========\n\n');

    try {
      const message = await client.createMessage({
        model: this.config.getModel(),
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: `${systemPrompt}\n\n${userPrompt}\n\nSources:\n${contents}`
        }]
      });

      let response = message.content[0].text;
      const thinkIdx = response.lastIndexOf('</think>');
      response = thinkIdx >= 0 ? response.substring(thinkIdx + 9).trim() : response;

      let sourceBlocks = response.split(/## /).filter(Boolean);

      for (let j = 0; j < this.sources.length; j++) {
        const titleLower = this.sources[j].title.toLowerCase();
        const candidates = sourceBlocks.filter(b =>
          b.toLowerCase().includes(titleLower) &&
          (b.includes('**Summary:**') || b.includes('**摘要:**')) &&
          !b.match(/\*\*(Summary|摘要):\*\*\s*\.\.\./)
        );
        const block = candidates[candidates.length - 1] || sourceBlocks.find(b => b.toLowerCase().includes(titleLower));

        if (block) {
          const summaryMatch = block.match(/\*\*(Summary|摘要):\*\*\s*(.+?)(?=\*\*(Concepts|概念):|---|$)/s);
          const conceptsMatch = block.match(/\*\*(Concepts|概念):\*\*\s*(.+?)(?=\n|---|$)/s);
          const compressedMatch = block.match(/---\s*\n([\s\S]+)$/);

          if (summaryMatch) {
            this.sources[j].summary = summaryMatch[2].trim();
          }
          if (conceptsMatch) {
            this.sources[j].concepts = conceptsMatch[2].split(/[,，]/).map(c => c.trim()).filter(Boolean);
          }
          if (compressedMatch) {
            this.sources[j].compressedContent = compressedMatch[1].trim();
          }
        }

        await this.writeSourceFile(this.sources[j]);
      }

      console.log(chalk.green(`  ✓ All ${this.sources.length} sources summarized and saved`));
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ Failed to process all at once: ${err.message}`));
      console.log(chalk.gray('  Falling back to batched processing...'));
      await this.generateSummariesBatched(client, 3, lang, isZh);
    }
  }

  async generateSummariesBatched(client, batchSize, lang, isZh) {
    const systemPrompt = isZh
      ? '请用中文回答。'
      : 'Please respond in English.';

    const userPrompt = isZh
      ? `为以下每个来源：
1. 提供简要摘要（2-3句话）
2. 列出3-5个关键概念/标签
3. 对内容进行适度压缩（保留原意，删除冗余内容），但不要改变原文的核心信息

格式要求：
## [标题]
**摘要:** ...
**概念:** 概念1, 概念2, 概念3
---
[压缩后的内容]
`
      : `For each of the following sources:
1. Provide a brief summary (2-3 sentences)
2. List 3-5 key concepts/tags
3. Compress the content moderately (preserve original meaning, remove redundancy, keep core info)

Format for each:
## [Title]
**Summary:** ...
**Concepts:** concept1, concept2, concept3
---
[Compressed content]
`;

    for (let i = 0; i < this.sources.length; i += batchSize) {
      const batch = this.sources.slice(i, i + batchSize);
      const progress = `[${Math.min(i + batchSize, this.sources.length)}/${this.sources.length}]`;

      try {
        const contents = batch.map((s, idx) =>
          `Source ${idx + 1}: ${s.title}\nType: ${s.type}\n\nContent:\n${s.content.substring(0, 4000)}`
        ).join('\n\n---\n\n');

        const message = await client.createMessage({
          model: this.config.getModel(),
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: `${systemPrompt}\n\n${userPrompt}\n\nSources:\n${contents}`
          }]
        });

        let response = message.content[0].text;
        const thinkIdx = response.lastIndexOf('</think>');
        response = thinkIdx >= 0 ? response.substring(thinkIdx + 9).trim() : response;
        let sourceBlocks = response.split(/## /).filter(Boolean);

        for (let j = 0; j < batch.length; j++) {
          const titleLower = batch[j].title.toLowerCase();
          const candidates = sourceBlocks.filter(b =>
            b.toLowerCase().includes(titleLower) &&
            (b.includes('**Summary:**') || b.includes('**摘要:**')) &&
            !b.match(/\*\*(Summary|摘要):\*\*\s*\.\.\./)
          );
          const block = candidates[candidates.length - 1] || sourceBlocks.find(b => b.toLowerCase().includes(titleLower));

          if (block) {
            const summaryMatch = block.match(/\*\*(Summary|摘要):\*\*\s*(.+?)(?=\*\*(Concepts|概念):|---|$)/s);
            const conceptsMatch = block.match(/\*\*(Concepts|概念):\*\*\s*(.+?)(?=\n|---|$)/s);
            const compressedMatch = block.match(/---\s*\n([\s\S]+)$/);

            if (summaryMatch) {
              batch[j].summary = summaryMatch[2].trim();
            }
            if (conceptsMatch) {
              batch[j].concepts = conceptsMatch[2].split(/[,，]/).map(c => c.trim()).filter(Boolean);
            }
            if (compressedMatch) {
              batch[j].compressedContent = compressedMatch[1].trim();
            }
          }

          await this.writeSourceFile(batch[j]);
        }

        console.log(chalk.green(`  ✓ ${progress} Summarized and saved batch`));
      } catch (err) {
        console.log(chalk.yellow(`  ⚠ ${progress} Failed to summarize batch: ${err.message}`));
      }
    }
  }

  async writeSourceFile(source) {
    const wikiDir = this.config.getWikiDir();
    // Extract timestamp dir and filename from source.path
    // path format: "articles/1234567890/title.md" or "code/1234567891/script.js"
    const pathParts = source.path.split('/');
    let summaryPath;
    if (pathParts.length >= 2) {
      // Use same structure as raw: type/timestamp/filename
      const type = pathParts[0]; // articles, code, etc.
      const timestamp = pathParts[1]; // millisecond timestamp
      const filename = pathParts[pathParts.length - 1];
      const summaryDir = path.join(wikiDir, 'summaries', type, timestamp);
      await fs.ensureDir(summaryDir);
      summaryPath = path.join(summaryDir, filename);
    } else {
      // Fallback to id-based naming
      summaryPath = path.join(wikiDir, 'summaries', `${source.id}.md`);
    }

    const contentToStore = source.compressedContent || source.content || '';
    const content = matter.stringify(contentToStore, {
      id: source.id,
      title: source.title,
      type: source.type,
      summary: source.summary || '',
      concepts: source.concepts || [],
      backlinks: source.backlinks || [],
      addedAt: source.addedAt
    });
    await fs.writeFile(summaryPath, content);

    // Update index.json incrementally
    const indexPath = path.join(wikiDir, 'index.json');
    let index = { version: '1.0', lastUpdated: new Date().toISOString(), sources: [], concepts: [] };
    if (await fs.pathExists(indexPath)) {
      index = await fs.readJson(indexPath);
    }
    // Update or add this source in index
    const existingIdx = index.sources.findIndex(s => s.id === source.id);
    const sourceEntry = {
      id: source.id,
      title: source.title,
      type: source.type,
      summary: source.summary || '',
      concepts: source.concepts || [],
      backlinks: source.backlinks || [],
      addedAt: source.addedAt
    };
    if (existingIdx >= 0) {
      index.sources[existingIdx] = sourceEntry;
    } else {
      index.sources.push(sourceEntry);
    }
    index.lastUpdated = new Date().toISOString();
    await fs.writeJson(indexPath, index, { spaces: 2 });
  }

  async extractConcepts() {
    const client = new LLMClient(this.config);
    const lang = this.config.getLanguage();
    const isZh = lang === 'zh';

    const systemPrompt = isZh
      ? '请用中文提供定义。'
      : 'Please provide definitions in English.';

    const userPrompt = isZh
      ? `为知识库中的以下概念各提供一个简短定义（1句话）。

格式：
**术语**: 定义`
      : `Provide brief definitions (1 sentence each) for these concepts found in a knowledge base:

Format:
**Term**: definition`;

    // Collect all unique concepts from sources
    const allConcepts = new Map();

    for (const source of this.sources) {
      for (const concept of source.concepts || []) {
        const key = concept.toLowerCase();
        if (!allConcepts.has(key)) {
          allConcepts.set(key, {
            term: concept,
            sources: [],
            relatedConcepts: []
          });
        }
        allConcepts.get(key).sources.push(source.id);
      }
    }

    if (allConcepts.size === 0) {
      // Auto-generate concepts from common terms
      console.log(chalk.gray('  No explicit concepts found, auto-extracting...'));
      return;
    }

    // Generate definitions for key concepts
    try {
      const conceptTerms = Array.from(allConcepts.keys()).slice(0, 20);
      const message = await client.createMessage({
        model: this.config.getModel(),
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `${systemPrompt}\n\n${userPrompt}\n\n${conceptTerms.join('\n')}`
        }]
      });

      let response = message.content[0].text;
      const thinkIdx = response.lastIndexOf('</think>');
      response = thinkIdx >= 0 ? response.substring(thinkIdx + 9).trim() : response;

      // Parse definitions - support both English **Term**: and Chinese **术语**:
      const defBlocks = response.split(/(?=\*\*[^*]+\*\*:)/).filter(Boolean);

      for (const block of defBlocks) {
        const match = block.match(/\*\*([^*]+)\*\*:\s*(.+)/s);
        if (match) {
          const term = match[1].trim().toLowerCase();
          const def = match[2].trim();
          if (allConcepts.has(term)) {
            allConcepts.get(term).definition = def;
          }
        }
      }
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ Failed to get concept definitions: ${err.message}`));
    }

    this.concepts = Array.from(allConcepts.values());
  }

  async buildRelationships() {
    const client = new LLMClient(this.config);

    // For each source, find related sources based on shared concepts
    for (const source of this.sources) {
      const related = this.sources
        .filter(s => s.id !== source.id)
        .map(s => ({
          id: s.id,
          title: s.title,
          sharedConcepts: (source.concepts || []).filter(c =>
            (s.concepts || []).map(sc => sc.toLowerCase()).includes(c.toLowerCase())
          )
        }))
        .filter(r => r.sharedConcepts.length > 0)
        .sort((a, b) => b.sharedConcepts.length - a.sharedConcepts.length)
        .slice(0, 5);

      source.backlinks = related.map(r => r.id);
    }

    // Build concept relationships
    for (const concept of this.concepts) {
      const related = this.concepts
        .filter(c => c.term !== concept.term)
        .map(c => ({
          id: c.term,
          sharedSources: concept.sources.filter(s => c.sources.includes(s)).length
        }))
        .filter(r => r.sharedSources > 0)
        .sort((a, b) => b.sharedSources - a.sharedSources)
        .slice(0, 5);

      concept.relatedConcepts = related.map(r => r.id);
    }
  }

  async writeWikiFiles(wikiDir) {
    // Write summary files (same structure as writeSourceFile)
    for (const source of this.sources) {
      const pathParts = source.path.split('/');
      let summaryPath;
      if (pathParts.length >= 2) {
        const type = pathParts[0];
        const timestamp = pathParts[1];
        const filename = pathParts[pathParts.length - 1];
        const summaryDir = path.join(wikiDir, 'summaries', type, timestamp);
        await fs.ensureDir(summaryDir);
        summaryPath = path.join(summaryDir, filename);
      } else {
        summaryPath = path.join(wikiDir, 'summaries', `${source.id}.md`);
      }
      const contentToStore = source.compressedContent || source.content || '';
      const content = matter.stringify(contentToStore, {
        id: source.id,
        title: source.title,
        type: source.type,
        summary: source.summary || '',
        concepts: source.concepts || [],
        backlinks: source.backlinks || [],
        addedAt: source.addedAt
      });
      await fs.writeFile(summaryPath, content);
    }

    // Write concept files
    for (const concept of this.concepts) {
      if (!concept.definition) continue;
      const slug = concept.term.toLowerCase().replace(/\s+/g, '-');
      const conceptPath = path.join(wikiDir, 'concepts', `${slug}.md`);
      const content = matter.stringify(concept.definition, {
        id: concept.term,
        term: concept.term,
        sources: concept.sources,
        relatedConcepts: concept.relatedConcepts
      });
      await fs.writeFile(conceptPath, content);
    }
  }

  generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

module.exports = { MakeCommand };
