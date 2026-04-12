import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import matter from 'gray-matter';
import { LLMClient } from '../lib/llm';
import { ConfigManager } from '../lib/config';
import { OutputWriter, ConsoleOutput } from '../lib/output';
import { Source, Concept, IndexedSource, ChangeLog } from '../types';
import { generateId, slugify } from '../lib/utils';

const MAX_CONCEPT_DEFINITIONS = 20;

interface MakeCacheEntry {
  hash: string;
  sourceId: string;
  lastMade: string;
}

interface MakeCache {
  version: string;
  entries: Record<string, MakeCacheEntry>;
}

function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export class MakeCommand {
  private config: ConfigManager;
  private output: OutputWriter;
  private sources: Source[] = [];
  private concepts: Concept[] = [];
  private imageMap: Map<string, string> = new Map();
  private cache: MakeCache = { version: '1.0', entries: {} };
  private skippedSources: Source[] = [];
  private changeLog: ChangeLog = {
    timestamp: new Date().toISOString(),
    action: 'make',
    files: { added: [], updated: [], deleted: [] },
    relationships: [],
    sourceFiles: []
  };

  constructor(config: ConfigManager, output?: OutputWriter) {
    this.config = config;
    this.output = output || new ConsoleOutput();
  }

  async execute(): Promise<void> {
    this.output.info('\n🔨 Compiling wiki...\n');

    // Reset change log for this run
    this.changeLog = {
      timestamp: new Date().toISOString(),
      action: 'make',
      files: { added: [], updated: [], deleted: [] },
      relationships: [],
      sourceFiles: []
    };

    if (!await this.config.ensureConfigured()) {
      return;
    }

    const rawDir = this.config.getRawDir();
    const wikiDir = this.config.getWikiDir();

    // Validate paths are within knowledge base
    this.config.validateRead(rawDir);
    this.config.validateWrite(wikiDir);

    // Ensure wiki directories exist
    await fs.ensureDir(path.join(wikiDir, 'concepts'));
    await fs.ensureDir(path.join(wikiDir, 'summaries'));
    await fs.ensureDir(path.join(wikiDir, 'images'));
    await fs.ensureDir(path.join(wikiDir, 'output'));

    // Step 0: Collect and copy images
    this.output.progress('[1/10]', '🖼️  Collecting images...');
    await this.collectAndCopyImages(rawDir, wikiDir);

    // Step 1: Collect all raw files
    this.output.progress('[2/10]', '📁 Scanning raw materials...');
    await this.collectRawFiles(rawDir);

    // Fix image paths in source content
    this.fixImagePaths();

    // Track source files processed
    this.changeLog.sourceFiles = this.sources.map(s => s.path);

    const totalChars = this.sources.reduce((sum, s) => sum + (s.content?.length || 0), 0);
    this.output.log(`  Found ${this.sources.length} sources (${totalChars} chars)`);

    if (this.sources.length === 0) {
      this.output.warn('\n⚠ No raw materials found. Add some with /add first.');
      return;
    }

    // Step 1.5: Incremental detection — skip unchanged sources
    this.output.progress('[3/10]', '\n🔍 Checking for changes...');
    await this.loadCache();
    const { changed, unchanged } = this.detectChanges();
    this.skippedSources = unchanged;
    this.output.log(`  ${changed.length} changed, ${unchanged.length} unchanged (skipped)`);

    if (changed.length === 0 && unchanged.length > 0) {
      this.output.log('  All sources are up-to-date. Rebuilding relationships only...');
      // 即使没有变更，仍需重建概念和关系（因为概念索引可能需要更新）
      this.sources = unchanged;
      await this.restoreSkippedSummaries();
      await this.extractConcepts();
      await this.buildRelationships();
      await this.writeWikiFiles(wikiDir);
      await this.writeConceptsIndex(wikiDir);
      await this.generateIndex(wikiDir);
      await this.appendLog(wikiDir);
      this.output.log('\n✅ Wiki rebuilt (no LLM calls needed)!');
this.output.log(`  Sources: ${this.sources.length}`);
    this.output.log(`  Concepts: ${this.concepts.length}`);
    return;
    }

    // 仅处理变更的源
    this.sources = changed;

    // Step 2: Generate summaries using AI
    this.output.progress('[4/10]', '\n✍️  Generating summaries...');
    await this.generateSummaries();

    // Step 3: Merge skipped sources for relationship building
    if (this.skippedSources.length > 0) {
      this.sources = [...this.sources, ...this.skippedSources];
    }

    // Step 4: Extract and define concepts
    this.output.progress('[5/10]', '\n🧠 Extracting concepts...');
    await this.extractConcepts();

    // Step 4: Build relationships and backlinks
    this.output.progress('[6/10]', '\n🔗 Building relationships...');
    await this.buildRelationships();

    // Track added files and relationships
    for (const source of this.sources) {
      this.changeLog.files.added.push(`summaries/${source.type}/${slugify(source.title)}.md`);
    }
    for (const concept of this.concepts) {
      this.changeLog.files.added.push(`concepts/${slugify(concept.term)}.md`);
    }
    for (const concept of this.concepts) {
      for (const related of concept.relatedConcepts || []) {
        this.changeLog.relationships.push([concept.term, related]);
      }
    }

    // Step 5: Update wiki files with backlinks (rewrite after relationships built)
    this.output.progress('[7/10]', '\n📝 Updating wiki files with relationships...');
    await this.writeWikiFiles(wikiDir);

    // Step 6: Write concepts to structured index file (M1.5)
    this.output.progress('[8/10]', '\n📋 Writing concepts index...');
    await this.writeConceptsIndex(wikiDir);

    // Step 7: Generate knowledge base index (M1.3)
    this.output.progress('[9/10]', '\n🗺️  Generating knowledge base index...');
    await this.generateIndex(wikiDir);

    // Step 8: Append to operation log (M1.4)
    this.output.progress('[10/10]', '\n📝 Recording to operation log...');
    await this.appendLog(wikiDir);

    // Save incremental cache
    await this.saveCache();

    this.output.log('\n✅ Wiki compiled successfully!');
    this.output.log(`  Sources: ${this.sources.length}`);
    this.output.log(`  Concepts: ${this.concepts.length}`);
    this.output.log(`  Relationships: ${this.changeLog.relationships.length}`);
  }

  async collectAndCopyImages(rawDir: string, wikiDir: string): Promise<void> {
    const imagesDir = path.join(rawDir, 'images');
    if (!await fs.pathExists(imagesDir)) {
      return;
    }

    // Validate image source path
    this.config.validateRead(imagesDir);

    const wikiImagesDir = path.join(wikiDir, 'images');

    // Walk through raw/images and copy all images to wiki/images
    const copyImageDir = async (srcDir: string, destDir: string) => {
      // Validate source directory
      this.config.validateRead(srcDir);
      this.config.validateWrite(destDir);

      const items = await fs.readdir(srcDir, { withFileTypes: true });
      for (const item of items) {
        const srcPath = path.join(srcDir, item.name);
        if (item.isDirectory()) {
          await copyImageDir(srcPath, destDir);
        } else if (item.isFile()) {
          // Validate file paths
          this.config.validateRead(srcPath);
          this.config.validateWrite(path.join(destDir, item.name));

          const ext = path.extname(item.name).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'].includes(ext)) {
            await fs.copy(srcPath, path.join(destDir, item.name));
            // Map filename to relative path in wiki (../images/ because articles are in summaries/article/)
            this.imageMap.set(item.name, `../images/${item.name}`);
          }
        }
      }
    };

    await copyImageDir(imagesDir, wikiImagesDir);
    this.output.log(`  Copied ${this.imageMap.size} images to wiki`);
  }

  fixImagePaths(): void {
    if (this.imageMap.size === 0) return;

    for (const source of this.sources) {
      if (source.type !== 'article') continue;

      let content = source.content || '';
      for (const [filename, relativePath] of this.imageMap) {
        // Match image references with just filename (not full paths)
        const regex = new RegExp(`!\\[([^\\]]*)\\]\\(${filename}\\)`, 'g');
        content = content.replace(regex, `![$1](${relativePath})`);
      }
      source.content = content;
    }
  }

  async collectRawFiles(dir: string): Promise<void> {
    // Validate directory is within KB
    this.config.validateRead(dir);

    const items = await fs.readdir(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        // Recurse into all subdirectories (including timestamp-based dirs)
        await this.collectRawFiles(fullPath);
      } else if (item.isFile()) {
        // Validate file path
        this.config.validateRead(fullPath);

        const ext = path.extname(item.name).toLowerCase();

        if (['.md', '.txt'].includes(ext)) {
          const content = await fs.readFile(fullPath, 'utf-8');
          const parsed = matter(content);
          this.sources.push({
            id: parsed.data.id || generateId(),
            path: path.relative(dir, fullPath),
            type: 'article',
            title: parsed.data.title || item.name.replace(ext, ''),
            content: parsed.content,
            summary: parsed.data.summary || '',
            concepts: parsed.data.concepts || [],
            backlinks: [],
            source: parsed.data.source || 'local'
          });
        } else if (['.js', '.ts', '.py', '.go', '.rs'].includes(ext)) {
          const content = await fs.readFile(fullPath, 'utf-8');
          this.sources.push({
            id: generateId(),
            path: path.relative(dir, fullPath),
            type: 'code',
            title: item.name,
            content: content.substring(0, 5000), // Limit size
            summary: '',
            concepts: [],
            backlinks: [],
            source: 'local'
          });
        }
        // Images and other files are tracked but not parsed for content
      }
    }
  }

  async generateSummaries(): Promise<void> {
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

    this.output.log(`  maxContextTokens=${maxContextTokens}, estimatedTokens=${Math.round(estimatedTokens)}, useAllAtOnce=${useAllAtOnce}`);

    if (useAllAtOnce) {
      this.output.log(`  Processing all at once...`);
      await this.generateSummariesAllAtOnce(client, lang, isZh);
    } else {
      this.output.log(`  Using batched processing...`);
      await this.generateSummariesBatched(client, batchSize, lang, isZh);
    }
  }

  async generateSummariesAllAtOnce(client: LLMClient, lang: string, isZh: boolean): Promise<void> {
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

      this.output.log(`  ✓ All ${this.sources.length} sources summarized and saved`);
    } catch (err) {
      this.output.warn(`  ⚠ Failed to process all at once: ${(err as Error).message}`);
      this.output.log('  Falling back to batched processing...');
      await this.generateSummariesBatched(client, 3, lang, isZh);
    }
  }

  async generateSummariesBatched(client: LLMClient, batchSize: number, lang: string, isZh: boolean): Promise<void> {
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

        this.output.log(`  ✓ ${progress} Summarized and saved batch`);
      } catch (err) {
        this.output.warn(`  ⚠ ${progress} Failed to summarize batch: ${(err as Error).message}`);
      }
    }
  }

  async writeSourceFile(source: Source): Promise<void> {
    const wikiDir = this.config.getWikiDir();
    // Use flat structure: summaries/{type}/{slugified-title}.md
    const type = source.type; // 'articles' or 'code'
    const titleSlug = slugify(source.title);
    const summaryDir = path.join(wikiDir, 'summaries', type);
    const summaryPath = path.join(summaryDir, `${titleSlug}.md`);

    // Validate paths
    this.config.validateWrite(summaryPath);

    await fs.ensureDir(summaryDir);

    const contentToStore = source.compressedContent || source.content || '';
    const content = matter.stringify(contentToStore, {
      id: source.id,
      title: source.title,
      type: source.type,
      summary: source.summary || '',
      concepts: source.concepts || [],
      backlinks: source.backlinks || []
    });
    await fs.writeFile(summaryPath, content);

    // Update sources-index.json incrementally
    const sourcesIndexPath = path.join(wikiDir, 'sources-index.json');
    this.config.validateWrite(sourcesIndexPath);

    let sources: IndexedSource[] = [];
    if (await fs.pathExists(sourcesIndexPath)) {
      sources = await fs.readJson(sourcesIndexPath) as IndexedSource[];
    }
    // Update or add this source in index
    const existingIdx = sources.findIndex(s => s.id === source.id);
    const sourceEntry: IndexedSource = {
      id: source.id,
      title: source.title,
      type: source.type,
      summary: source.summary || '',
      concepts: source.concepts || [],
      backlinks: source.backlinks || []
    };
    if (existingIdx >= 0) {
      sources[existingIdx] = sourceEntry;
    } else {
      sources.push(sourceEntry);
    }
    await fs.writeJson(sourcesIndexPath, sources, { spaces: 2 });
  }

  async extractConcepts(): Promise<void> {
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
    const allConcepts = new Map<string, Concept>();

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
        allConcepts.get(key)!.sources.push(source.id);
      }
    }

    if (allConcepts.size === 0) {
      // Auto-generate concepts from common terms
      this.output.log('  No explicit concepts found, auto-extracting...');
      return;
    }

    // Generate definitions for key concepts
    try {
      const conceptTerms = Array.from(allConcepts.keys()).slice(0, MAX_CONCEPT_DEFINITIONS);
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
            allConcepts.get(term)!.definition = def;
          }
        }
      }
    } catch (err) {
      this.output.warn(`  ⚠ Failed to get concept definitions: ${(err as Error).message}`);
    }

    this.concepts = Array.from(allConcepts.values());
  }

  async buildRelationships(): Promise<void> {
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

    // Build concept relationships and backlinks
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

    // Calculate backlinks for each concept
    // If concept A's relatedConcepts includes B, then B gets A in its backlinks
    for (const concept of this.concepts) {
      concept.backlinks = [];
    }
    for (const concept of this.concepts) {
      for (const relatedTerm of concept.relatedConcepts || []) {
        const targetConcept = this.concepts.find(c => c.term === relatedTerm);
        if (targetConcept && !targetConcept.backlinks!.includes(concept.term)) {
          targetConcept.backlinks!.push(concept.term);
        }
      }
    }
  }

  async writeWikiFiles(wikiDir: string): Promise<void> {
    // Update summary files with backlinks (they were written with empty backlinks during generateSummaries)
    for (const source of this.sources) {
      const type = source.type;
      const titleSlug = slugify(source.title);
      const summaryDir = path.join(wikiDir, 'summaries', type);
      const summaryPath = path.join(summaryDir, `${titleSlug}.md`);

      this.config.validateWrite(summaryPath);
      await fs.ensureDir(summaryDir);

      const contentToStore = source.compressedContent || source.content || '';
      const content = matter.stringify(contentToStore, {
        id: source.id,
        title: source.title,
        type: source.type,
        summary: source.summary || '',
        concepts: source.concepts || [],
        backlinks: source.backlinks || []
      });
      await fs.writeFile(summaryPath, content);
    }

    // Update sources-index.json with all sources and their backlinks
    const sourcesIndexPath = path.join(wikiDir, 'sources-index.json');
    this.config.validateWrite(sourcesIndexPath);
    const sourcesEntry: IndexedSource[] = this.sources.map(s => ({
      id: s.id,
      title: s.title,
      type: s.type,
      summary: s.summary || '',
      concepts: s.concepts || [],
      backlinks: s.backlinks || []
    }));
    await fs.writeJson(sourcesIndexPath, sourcesEntry, { spaces: 2 });

    // Write concept files
    for (const concept of this.concepts) {
      if (!concept.definition) continue;
      const slug = slugify(concept.term);
      const conceptPath = path.join(wikiDir, 'concepts', `${slug}.md`);
      this.config.validateWrite(conceptPath);

      const content = matter.stringify(concept.definition, {
        term: concept.term,
        sources: concept.sources,
        relatedConcepts: concept.relatedConcepts || [],
        backlinks: concept.backlinks || []
      });
      await fs.writeFile(conceptPath, content);
    }
  }

  async writeConceptsIndex(wikiDir: string): Promise<void> {
    // Write structured concepts-index.json (M1.5)
    const conceptsIndexPath = path.join(wikiDir, 'concepts-index.json');

    // Build relationships array from relatedConcepts
    const relationships: Array<[string, string]> = [];
    for (const concept of this.concepts) {
      for (const related of concept.relatedConcepts || []) {
        relationships.push([concept.term, related]);
      }
    }

    const structuredIndex = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      concepts: this.concepts.map(c => ({
        term: c.term,
        definition: c.definition || '',
        sources: c.sources,
        relatedConcepts: c.relatedConcepts || [],
        backlinks: c.backlinks || []
      })),
      relationships
    };

    await fs.writeJson(conceptsIndexPath, structuredIndex, { spaces: 2 });
  }

  async generateIndex(wikiDir: string): Promise<void> {
    // Generate knowledge base index (M1.3)
    const indexPath = path.join(wikiDir, 'index.md');
    const summariesDir = path.join(wikiDir, 'summaries');

    // Count articles
    let totalArticles = 0;
    if (await fs.pathExists(summariesDir)) {
      const articleDir = path.join(summariesDir, 'article');
      if (await fs.pathExists(articleDir)) {
        totalArticles = (await fs.readdir(articleDir)).filter(f => f.endsWith('.md')).length;
      }
    }

    // Build concept graph overview
    const conceptGraphLines: string[] = [];
    for (const concept of this.concepts.slice(0, 20)) {
      const related = (concept.relatedConcepts || []).join(', ') || 'none';
      const backlinks = (concept.backlinks || []).join(', ') || 'none';
      conceptGraphLines.push(`- **${concept.term}** → relates: ${related}, backlinks: ${backlinks}`);
    }

    // List all articles
    const articleLines: string[] = [];
    if (await fs.pathExists(summariesDir)) {
      const articleDir = path.join(summariesDir, 'article');
      if (await fs.pathExists(articleDir)) {
        for (const file of await fs.readdir(articleDir)) {
          if (!file.endsWith('.md')) continue;
          const content = await fs.readFile(path.join(articleDir, file), 'utf-8');
          const { data } = matter(content);
          const title = data?.title || file.replace('.md', '');
          articleLines.push(`- [[summaries/article/${file.replace('.md', '')}|${title}]]`);
        }
      }
    }

    // List all concepts
    const conceptLines: string[] = [];
    for (const concept of this.concepts) {
      conceptLines.push(`- [[concepts/${slugify(concept.term)}|${concept.term}]]`);
    }

    // Count relationships
    let totalRelationships = 0;
    for (const concept of this.concepts) {
      totalRelationships += (concept.relatedConcepts || []).length;
    }

    const indexContent = `---
version: "1.0"
generated: ${new Date().toISOString()}
---

# Knowledge Base Index

> Auto-generated by Fina LLM Wiki. Do not edit manually.

## Statistics

| Metric | Value |
|--------|-------|
| Total Articles | ${totalArticles} |
| Total Concepts | ${this.concepts.length} |
| Total Relationships | ${totalRelationships} |

## Concept Graph

${conceptGraphLines.length > 0 ? conceptGraphLines.join('\n') : '_No concepts yet_'}

## All Articles

${articleLines.length > 0 ? articleLines.join('\n') : '_No articles yet_'}

## All Concepts

${conceptLines.length > 0 ? conceptLines.join('\n') : '_No concepts yet_'}

---

_Last updated: ${new Date().toLocaleString()}_
`;

    await fs.writeFile(indexPath, indexContent);
  }

  async appendLog(wikiDir: string): Promise<void> {
    // Append to operation log (M1.4)
    const logPath = path.join(wikiDir, 'log.md');

    const logEntry = `## ${this.changeLog.timestamp}

### Changes
${this.changeLog.files.added.length > 0 ? `- **Added**: ${this.changeLog.files.added.join(', ')}` : '- **Added**: (none)'}
${this.changeLog.files.updated.length > 0 ? `- **Updated**: ${this.changeLog.files.updated.join(', ')}` : '- **Updated**: (none)'}
${this.changeLog.files.deleted.length > 0 ? `- **Deleted**: ${this.changeLog.files.deleted.join(', ')}` : '- **Deleted**: (none)'}
${this.changeLog.relationships.length > 0 ? `- **Relationships**: ${this.changeLog.relationships.map(([s, t]) => `${s} → ${t}`).join(', ')}` : ''}

### Source Files Processed
${this.changeLog.sourceFiles.map(f => `- ${f}`).join('\n')}

---

`;

    // If log.md doesn't exist, create with header
    if (!await fs.pathExists(logPath)) {
      const header = `# Knowledge Base Log

> Record of all changes to the knowledge base.

---

`;
      await fs.writeFile(logPath, header + logEntry);
    } else {
      // Append to existing file
      const existing = await fs.readFile(logPath, 'utf-8');
      const marker = '\n\n---\n\n';
      const parts = existing.split(marker);
      const newContent = parts[0] + marker + logEntry + marker + parts.slice(1).join(marker);
      await fs.writeFile(logPath, newContent);
    }
  }

  // --- Incremental compilation: cache management ---

  private getCachePath(wikiDir: string): string {
    return path.join(wikiDir, '.make-cache.json');
  }

  private async loadCache(): Promise<void> {
    const wikiDir = this.config.getWikiDir();
    const cachePath = this.getCachePath(wikiDir);
    if (await fs.pathExists(cachePath)) {
      try {
        this.cache = await fs.readJson(cachePath);
      } catch {
        this.cache = { version: '1.0', entries: {} };
      }
    }
  }

  private async saveCache(): Promise<void> {
    const wikiDir = this.config.getWikiDir();
    const cachePath = this.getCachePath(wikiDir);
    await fs.writeJson(cachePath, this.cache, { spaces: 2 });
  }

  private detectChanges(): { changed: Source[]; unchanged: Source[] } {
    const changed: Source[] = [];
    const unchanged: Source[] = [];

    for (const source of this.sources) {
      const currentHash = computeHash(source.content || '');
      const cached = this.cache.entries[source.path];

      if (cached && cached.hash === currentHash) {
        // 保持 source.id 与 cache 一致，避免重新生成
        source.id = cached.sourceId;
        unchanged.push(source);
      } else {
        changed.push(source);
        // 更新 cache
        this.cache.entries[source.path] = {
          hash: currentHash,
          sourceId: source.id,
          lastMade: new Date().toISOString()
        };
      }
    }

    return { changed, unchanged };
  }

  /** 从已有 wiki 文件中恢复 skipped sources 的摘要和概念信息 */
  private async restoreSkippedSummaries(): Promise<void> {
    const wikiDir = this.config.getWikiDir();

    for (const source of this.skippedSources) {
      const titleSlug = slugify(source.title);
      const summaryPath = path.join(wikiDir, 'summaries', source.type, `${titleSlug}.md`);

      if (await fs.pathExists(summaryPath)) {
        const content = await fs.readFile(summaryPath, 'utf-8');
        const parsed = matter(content);
        source.summary = parsed.data.summary || '';
        source.concepts = parsed.data.concepts || [];
        source.backlinks = parsed.data.backlinks || [];
      }
    }
  }

  /** Deep merge mode: analyze all sources and merge similar articles */
  async executeDeep(): Promise<void> {
    this.output.info('\n🧠 Deep analyzing and merging wiki...\n');

    const rawDir = this.config.getRawDir();
    const wikiDir = this.config.getWikiDir();
    const deepDir = path.join(wikiDir, 'deep');

    // Load all sources
    this.sources = [];
    await this.collectRawFiles(rawDir);

    if (this.sources.length === 0) {
      this.output.warn('No sources found in raw/. Add some sources first.');
      return;
    }

    this.output.log(`  Found ${this.sources.length} sources\n`);

    const client = new LLMClient(this.config);
    const lang = this.config.getLanguage();
    const isZh = lang === 'zh';

    const systemPrompt = isZh
      ? await fs.readFile(path.join(process.cwd(), 'prompts', 'make', 'deep-system-zh.txt'), 'utf-8')
      : await fs.readFile(path.join(process.cwd(), 'prompts', 'make', 'deep-system-en.txt'), 'utf-8');

    const userPrompt = isZh
      ? await fs.readFile(path.join(process.cwd(), 'prompts', 'make', 'deep-user-zh.txt'), 'utf-8')
      : await fs.readFile(path.join(process.cwd(), 'prompts', 'make', 'deep-user-en.txt'), 'utf-8');

    // Build source contents
    const contents = this.sources.map((s, idx) =>
      `=== ${idx + 1}. ${s.title} (${s.type}) ===\n${s.content.substring(0, 4000)}`
    ).join('\n\n==========\n\n');

    try {
      this.output.log('  Analyzing and merging...\n');

      const message = await client.createMessage({
        model: this.config.getModel(),
        max_tokens: 12000,
        messages: [{
          role: 'user',
          content: `${systemPrompt}\n\n${userPrompt}\n\n=== Articles to Analyze ===\n${contents}`
        }]
      });

      let response = message.content[0]?.text || '';
      // Strip think tags
      const thinkIdx = response.lastIndexOf('</think>');
      response = thinkIdx >= 0 ? response.substring(thinkIdx + 9).trim() : response;

      // Ensure deep directory exists
      await fs.ensureDir(deepDir);

      // Parse groups from response
      const groupBlocks = response.split(/##\s+分组\s*\d*\s*:/i).filter(Boolean);

      const groups: Array<{
        title: string;
        articles: string[];
        summary: string;
        concepts: string[];
        count: number;
      }> = [];

      for (const block of groupBlocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 2) continue;

        const title = lines[0].trim();

        const articlesMatch = block.match(/\*\*包含文章\*\*:\s*(.+?)(?=\*\*|$)/i);
        const summaryMatch = block.match(/\*\*深度摘要\*\*:\s*([\s\S]+?)(?=\*\*来源|\*\*关键|\*\*$)/i);
        const conceptsMatch = block.match(/\*\*关键概念\*\*:\s*(.+?)(?=\*\*|$)/i);
        const countMatch = block.match(/\*\*来源文章数\*\*:\s*(\d+)/i);

        groups.push({
          title,
          articles: articlesMatch ? articlesMatch[1].split(/[,，]/).map(a => a.trim()).filter(Boolean) : [],
          summary: summaryMatch ? summaryMatch[1].trim() : '',
          concepts: conceptsMatch ? conceptsMatch[1].split(/[,，]/).map(c => c.trim()).filter(Boolean) : [],
          count: countMatch ? parseInt(countMatch[1]) : 0
        });
      }

      // Write group files
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const slug = slugify(group.title);
        const groupPath = path.join(deepDir, `group_${i + 1}_${slug}.md`);

        const content = `---
type: deep-merge
group: ${i + 1}
title: "${group.title}"
sourceCount: ${group.count}
concepts: [${group.concepts.join(', ')}]
---

# ${group.title}

**包含文章**: ${group.articles.join(', ')}

## 深度摘要

${group.summary}

## 关键概念

${group.concepts.map(c => `- ${c}`).join('\n')}

## 来源

${group.articles.map(a => `- ${a}`).join('\n')}
`;

        await fs.writeFile(groupPath, content, 'utf-8');
      }

      // Parse cross-references
      const crossRefMatch = response.match(/---\s*##\s*交叉引用\s*([\s\S]+)$/i);
      let crossRefContent = '';
      if (crossRefMatch) {
        crossRefContent = `# 交叉引用\n\n${crossRefMatch[1].trim()}`;
        await fs.writeFile(path.join(deepDir, 'cross-refs.md'), crossRefContent, 'utf-8');
      }

      // Write index
      const indexContent = `---
version: "1.0"
type: deep-merge
generated: ${new Date().toISOString()}
sourceCount: ${this.sources.length}
groupCount: ${groups.length}
---

# Deep Merge Result

## Groups

${groups.map((g, i) => `${i + 1}. [[group_${i + 1}_${slugify(g.title)}.md|${g.title}]] (${g.count} articles)`).join('\n')}

## Statistics

- Total sources: ${this.sources.length}
- Total groups: ${groups.length}
- Generated: ${new Date().toLocaleString()}
`;

      await fs.writeFile(path.join(deepDir, 'index.md'), indexContent, 'utf-8');

      this.output.log(`  ✓ Deep merge complete!`);
      this.output.log(`  Created ${groups.length} groups from ${this.sources.length} sources`);
      this.output.log(`  Output: ${deepDir}/\n`);

    } catch (err) {
      this.output.error(`  Deep merge failed: ${(err as Error).message}`);
      throw err;
    }
  }
}
