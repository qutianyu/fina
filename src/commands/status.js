const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

class StatusCommand {
  constructor(config) {
    this.config = config;
  }

  async execute() {
    const rawDir = this.config.getRawDir();
    const wikiDir = this.config.getWikiDir();

    console.log(chalk.cyan('\n📊 Fina Status\n'));
    console.log(chalk.gray('Raw Materials:'));
    await this.countDirectory(rawDir);

    console.log(chalk.gray('\nWiki:'));
    // Wiki has summaries/ and concepts/ structure, count files recursively
    const wikiEmpty = await this.countWikiDirectory(wikiDir);
    if (wikiEmpty) {
      console.log(chalk.gray('  (empty)'));
    }

    // Check for index
    const indexPath = path.join(wikiDir, 'index.json');
    if (await fs.pathExists(indexPath)) {
      const index = await fs.readJson(indexPath);
      console.log(chalk.gray('\nKnowledge Base:'));
      console.log(chalk.green(`  Sources indexed: ${index.sources?.length || 0}`));
      console.log(chalk.green(`  Concepts defined: ${index.concepts?.length || 0}`));
      if (index.lastUpdated) {
        console.log(chalk.gray(`  Last compiled: ${new Date(index.lastUpdated).toLocaleString()}`));
      }
    } else {
      console.log(chalk.yellow('\n⚠ Wiki not yet compiled. Run /make to build it.'));
    }

    console.log();
  }

  async countDirectory(dir) {
    if (!await fs.pathExists(dir)) {
      console.log(chalk.gray('  (empty)'));
      return;
    }

    // For raw directories: count files in articles/documents/code/images
    const rawSubdirs = ['articles', 'documents', 'code', 'images'];
    let total = 0;

    for (const subdir of rawSubdirs) {
      const subdirPath = path.join(dir, subdir);
      if (await fs.pathExists(subdirPath)) {
        // Count files recursively
        const count = await this.countFilesRecursive(subdirPath);
        if (count > 0) {
          console.log(chalk.white(`  ${subdir}: ${count}`));
          total += count;
        }
      }
    }

    if (total === 0) {
      console.log(chalk.gray('  (empty)'));
    } else {
      console.log(chalk.gray(`  total: ${total}`));
    }
  }

  async countFilesRecursive(dir) {
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

  async countWikiDirectory(dir) {
    let total = 0;

    // Count summaries
    const summariesPath = path.join(dir, 'summaries');
    if (await fs.pathExists(summariesPath)) {
      const count = await this.countFilesRecursive(summariesPath);
      if (count > 0) {
        console.log(chalk.white(`  summaries: ${count}`));
        total += count;
      }
    }

    // Count concepts
    const conceptsPath = path.join(dir, 'concepts');
    if (await fs.pathExists(conceptsPath)) {
      const files = await fs.readdir(conceptsPath);
      const count = files.filter(f => !f.startsWith('.')).length;
      if (count > 0) {
        console.log(chalk.white(`  concepts: ${count}`));
        total += count;
      }
    }

    return total === 0;
  }
}

module.exports = { StatusCommand };
