import * as fs from 'fs-extra';
import * as path from 'path';
import picocolors from 'picocolors';
import { ConfigManager } from '../lib/config';

export class StatusCommand {
  private config: ConfigManager;

  constructor(config: ConfigManager) {
    this.config = config;
  }

  async execute(): Promise<void> {
    const rawDir = this.config.getRawDir();
    const wikiDir = this.config.getWikiDir();

    // Validate paths are within KB
    this.config.validateRead(rawDir);
    this.config.validateRead(wikiDir);

    console.log(picocolors.cyan('\n📊 Fina Status\n'));
    console.log(picocolors.gray('Raw Materials:'));
    await this.countDirectory(rawDir);

    console.log(picocolors.gray('\nWiki:'));
    const wikiEmpty = await this.countWikiDirectory(wikiDir);
    if (wikiEmpty) {
      console.log(picocolors.gray('  (empty)'));
    }

    const sourcesIndexPath = path.join(wikiDir, 'sources-index.json');
    const conceptsIndexPath = path.join(wikiDir, 'concepts-index.json');

    if (await fs.pathExists(sourcesIndexPath)) {
      const sources = await fs.readJson(sourcesIndexPath) as any[];
      const concepts = await fs.pathExists(conceptsIndexPath)
        ? await fs.readJson(conceptsIndexPath) as any[]
        : [];
      console.log(picocolors.gray('\nKnowledge Base:'));
      console.log(picocolors.green(`  Sources indexed: ${sources.length}`));
      console.log(picocolors.green(`  Concepts defined: ${concepts.length}`));
    } else {
      console.log(picocolors.yellow('\n⚠ Wiki not yet compiled. Run /make to build it.'));
    }

    console.log();
  }

  private async countDirectory(dir: string): Promise<void> {
    if (!await fs.pathExists(dir)) {
      console.log(picocolors.gray('  (empty)'));
      return;
    }

    const rawSubdirs = ['articles', 'code', 'images'];
    let total = 0;

    for (const subdir of rawSubdirs) {
      const subdirPath = path.join(dir, subdir);
      if (await fs.pathExists(subdirPath)) {
        const count = await this.countFilesRecursive(subdirPath);
        if (count > 0) {
          console.log(picocolors.white(`  ${subdir}: ${count}`));
          total += count;
        }
      }
    }

    if (total === 0) {
      console.log(picocolors.gray('  (empty)'));
    } else {
      console.log(picocolors.gray(`  total: ${total}`));
    }
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

  private async countWikiDirectory(dir: string): Promise<boolean> {
    let total = 0;

    const summariesPath = path.join(dir, 'summaries');
    if (await fs.pathExists(summariesPath)) {
      const count = await this.countFilesRecursive(summariesPath);
      if (count > 0) {
        console.log(picocolors.white(`  summaries: ${count}`));
        total += count;
      }
    }

    const conceptsPath = path.join(dir, 'concepts');
    if (await fs.pathExists(conceptsPath)) {
      const files = await fs.readdir(conceptsPath);
      const count = files.filter(f => !f.startsWith('.')).length;
      if (count > 0) {
        console.log(picocolors.white(`  concepts: ${count}`));
        total += count;
      }
    }

    return total === 0;
  }
}
