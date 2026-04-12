import * as fs from 'fs-extra';
import * as path from 'path';
import matter from 'gray-matter';
import { ConfigManager } from '../lib/config';
import { slugify } from '../lib/utils';
import { OutputWriter, ConsoleOutput } from '../lib/output';

export class MergeCommand {
  private config: ConfigManager;
  private output: OutputWriter;

  constructor(config: ConfigManager, output?: OutputWriter) {
    this.config = config;
    this.output = output || new ConsoleOutput();
  }

  async execute(outputFile: string, intoConcept?: string): Promise<void> {
    const wikiDir = this.config.getWikiDir();
    const outputDir = path.join(wikiDir, 'output');

    let targetPath = path.resolve(outputFile);
    if (!await fs.pathExists(targetPath)) {
      targetPath = path.join(outputDir, outputFile);
    }

    if (!await fs.pathExists(targetPath)) {
      this.output.error(`Output file not found: ${outputFile}`);
      this.output.log(`  Looked in: ${targetPath}`);
      return;
    }

    this.config.validateRead(targetPath);

    const content = await fs.readFile(targetPath, 'utf-8');

    if (!intoConcept) {
      this.output.warn('Specify a target concept with --into <concept>');
      this.output.log('\nAvailable concepts:');
      await this.listConcepts(wikiDir);
      return;
    }

    const conceptsDir = path.join(wikiDir, 'concepts');
    const slug = slugify(intoConcept);
    const conceptPath = path.join(conceptsDir, `${slug}.md`);

    this.config.validateWrite(conceptPath);

    if (!await fs.pathExists(conceptPath)) {
      this.output.warn(`Concept "${intoConcept}" not found. Creating new concept page.`);
      await this.createConcept(conceptPath, intoConcept, content);
    } else {
      await this.appendToConcept(conceptPath, content, path.basename(targetPath));
    }

    this.output.log(`✓ Merged output into concept: ${intoConcept}`);
  }

  private async listConcepts(wikiDir: string): Promise<void> {
    const conceptsDir = path.join(wikiDir, 'concepts');
    if (!await fs.pathExists(conceptsDir)) return;

    const files = await fs.readdir(conceptsDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(conceptsDir, file);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const { data } = matter(fileContent);
      this.output.log(`  - ${data.term || file.replace('.md', '')}`);
    }
  }

  private async createConcept(conceptPath: string, term: string, content: string): Promise<void> {
    const frontmatter = {
      term,
      sources: [],
      relatedConcepts: [],
      backlinks: [],
      created: new Date().toISOString()
    };

    const fileContent = matter.stringify(content, frontmatter);
    await fs.ensureDir(path.dirname(conceptPath));
    await fs.writeFile(conceptPath, fileContent);
  }

  private async appendToConcept(conceptPath: string, content: string, sourceFileName: string): Promise<void> {
    const existing = await fs.readFile(conceptPath, 'utf-8');
    const { data: meta, content: body } = matter(existing);

    const merged = `${body}\n\n---\n\n## Merged from: ${sourceFileName}\n\n${content}`;

    const updated = matter.stringify(merged, {
      ...meta,
      updated: new Date().toISOString()
    });

    await fs.writeFile(conceptPath, updated);
  }
}