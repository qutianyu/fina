import * as fs from 'fs-extra';
import * as path from 'path';
import { ConfigManager } from '../lib/config';
import { OutputWriter, ConsoleOutput } from '../lib/output';

export interface StatusResult {
  rawStats: { articles: number; code: number; images: number; total: number };
  wikiStats: { summaries: number; concepts: number };
  indexedStats?: { sources: number; concepts: number };
  isCompiled: boolean;
}

export class StatusCommand {
  private config: ConfigManager;
  private output: OutputWriter;

  constructor(config: ConfigManager, output?: OutputWriter) {
    this.config = config;
    this.output = output || new ConsoleOutput();
  }

  async execute(): Promise<StatusResult> {
    const rawDir = this.config.getRawDir();
    const wikiDir = this.config.getWikiDir();

    // Validate paths are within KB
    this.config.validateRead(rawDir);
    this.config.validateRead(wikiDir);

    this.output.log('\n📊 Fina Status\n');
    this.output.log('Raw Materials:');
    const rawStats = await this.countDirectory(rawDir);

    this.output.log('\nWiki:');
    const wikiStats = await this.countWikiDirectory(wikiDir);
    if (wikiStats.summaries === 0 && wikiStats.concepts === 0) {
      this.output.log('  (empty)');
    }

    const sourcesIndexPath = path.join(wikiDir, 'sources-index.json');
    const conceptsIndexPath = path.join(wikiDir, 'concepts-index.json');

    let indexedStats: { sources: number; concepts: number } | undefined;
    let isCompiled = false;

    if (await fs.pathExists(sourcesIndexPath)) {
      const sources = await fs.readJson(sourcesIndexPath) as unknown[];
      const concepts = await fs.pathExists(conceptsIndexPath)
        ? await fs.readJson(conceptsIndexPath) as unknown[]
        : [];
      indexedStats = { sources: sources.length, concepts: concepts.length };
      isCompiled = true;
      this.output.log('\nKnowledge Base:');
      this.output.log(`  Sources indexed: ${sources.length}`);
      this.output.log(`  Concepts defined: ${concepts.length}`);
    } else {
      this.output.warn('\n⚠ Wiki not yet compiled. Run /make to build it.');
    }

    this.output.log('');

    return {
      rawStats,
      wikiStats,
      indexedStats,
      isCompiled,
    };
  }

  private async countDirectory(dir: string): Promise<{ articles: number; code: number; images: number; total: number }> {
    const stats = { articles: 0, code: 0, images: 0, total: 0 };

    if (!await fs.pathExists(dir)) {
      this.output.log('  (empty)');
      return stats;
    }

    const rawSubdirs = ['articles', 'code', 'images'];

    for (const subdir of rawSubdirs) {
      const subdirPath = path.join(dir, subdir);
      if (await fs.pathExists(subdirPath)) {
        const count = await this.countFilesRecursive(subdirPath);
        if (count > 0) {
          this.output.log(`  ${subdir}: ${count}`);
          stats[subdir as keyof typeof stats] = count;
          stats.total += count;
        }
      }
    }

    if (stats.total === 0) {
      this.output.log('  (empty)');
    } else {
      this.output.log(`  total: ${stats.total}`);
    }

    return stats;
  }

  private async countFilesRecursive(dir: string): Promise<number> {
    let count = 0;
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.')) continue;
      if (item.isDirectory()) {
        count += await this.countFilesRecursive(path.join(dir, item.name));
      } else {
        count++;
      }
    }
    return count;
  }

  private async countWikiDirectory(dir: string): Promise<{ summaries: number; concepts: number }> {
    const stats = { summaries: 0, concepts: 0 };

    const summariesPath = path.join(dir, 'summaries');
    if (await fs.pathExists(summariesPath)) {
      const count = await this.countFilesRecursive(summariesPath);
      if (count > 0) {
        this.output.log(`  summaries: ${count}`);
        stats.summaries = count;
      }
    }

    const conceptsPath = path.join(dir, 'concepts');
    if (await fs.pathExists(conceptsPath)) {
      const files = await fs.readdir(conceptsPath);
      const count = files.filter(f => !f.startsWith('.')).length;
      if (count > 0) {
        this.output.log(`  concepts: ${count}`);
        stats.concepts = count;
      }
    }

    return stats;
  }
}
