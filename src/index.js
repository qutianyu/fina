#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const fs = require('fs-extra');
const path = require('path');
const { ConfigManager } = require('./lib/config.js');
const { Shell } = require('./lib/shell.js');
const { SkillManager } = require('./lib/skills.js');
const { AddCommand } = require('./commands/add.js');
const { MakeCommand } = require('./commands/make.js');
const { StatusCommand } = require('./commands/status.js');
const { QueryCommand } = require('./commands/query.js');

const program = new Command();

program
  .name('Fina')
  .description('AI Knowledge Base CLI - Transform raw materials into a queryable wiki')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new knowledge base at the specified path')
  .argument('<path>', 'Directory path for the knowledge base')
  .action(async (targetPath) => {
    const resolvedPath = path.resolve(targetPath);
    const finaDir = path.join(resolvedPath, '.fina');
    const configPath = path.join(finaDir, 'config.json');

    if (await fs.pathExists(configPath)) {
      console.log(chalk.yellow(`Already initialized: ${resolvedPath}`));
      return;
    }

    if (!(await fs.pathExists(resolvedPath))) {
      await fs.ensureDir(resolvedPath);
    }

    await fs.ensureDir(finaDir);
    await fs.ensureDir(path.join(finaDir, 'skills'));
    await fs.copy(path.join(__dirname, 'defaults', 'skills'), path.join(finaDir, 'skills'));
    await fs.ensureDir(path.join(resolvedPath, 'raw', 'articles'));
    await fs.ensureDir(path.join(resolvedPath, 'raw', 'documents'));
    await fs.ensureDir(path.join(resolvedPath, 'raw', 'code'));
    await fs.ensureDir(path.join(resolvedPath, 'raw', 'images'));
    await fs.ensureDir(path.join(resolvedPath, 'wiki', 'concepts'));
    await fs.ensureDir(path.join(resolvedPath, 'wiki', 'summaries'));

    const defaultConfig = {
      type: 'anthropic',
      apiKey: '',
      baseUrl: '',
      model: '',
      language: 'en',
      maxContextTokens: 100000
    };

    await fs.writeJson(configPath, defaultConfig, { spaces: 2 });

    console.log(chalk.green(`✓ Initialized Fina knowledge base at: ${resolvedPath}`));
    console.log(chalk.gray(`  Config: ${configPath}`));
    console.log(chalk.gray('\nEdit the config file to add your API key.'));
  });

program
  .command('add')
  .description('Add URL or local file to raw materials')
  .argument('<source>', 'URL or local file path')
  .argument('[kb-path]', 'Knowledge base directory (default: auto-detect)')
  .action(async (source, kbPath) => {
    const config = new ConfigManager();
    if (kbPath) {
      await config.loadFromPath(kbPath);
    } else {
      await config.load();
    }
    const skillManager = new SkillManager();
    await skillManager.loadSkills(config.getKnowledgeBaseDir());
    const cmd = new AddCommand(config, skillManager);
    await cmd.execute(source);
  });

program
  .command('make')
  .description('Compile/refresh the wiki')
  .argument('[kb-path]', 'Knowledge base directory (default: auto-detect)')
  .action(async (kbPath) => {
    const config = new ConfigManager();
    if (kbPath) {
      await config.loadFromPath(kbPath);
    } else {
      await config.load();
    }
    const cmd = new MakeCommand(config);
    await cmd.execute();
  });

program
  .command('run')
  .description('Start interactive mode')
  .argument('[kb-path]', 'Knowledge base directory (default: auto-detect)')
  .action(async (kbPath) => {
    const config = new ConfigManager();
    if (kbPath) {
      await config.loadFromPath(kbPath);
    } else {
      await config.load();
    }
    const skillManager = new SkillManager();
    await skillManager.loadSkills(config.getKnowledgeBaseDir());
    const shell = new Shell(config, skillManager);
    await shell.start();
  });

program
  .command('search')
  .description('Search through the wiki')
  .argument('<query>', 'Search query')
  .argument('[kb-path]', 'Knowledge base directory (default: auto-detect)')
  .action(async (query, kbPath) => {
    const config = new ConfigManager();
    if (kbPath) {
      await config.loadFromPath(kbPath);
    } else {
      await config.load();
    }
    const cmd = new QueryCommand(config);
    await cmd.execute(query);
  });

program
  .command('status')
  .description('Show knowledge base status')
  .argument('[kb-path]', 'Knowledge base directory (default: auto-detect)')
  .action(async (kbPath) => {
    const config = new ConfigManager();
    if (kbPath) {
      await config.loadFromPath(kbPath);
    } else {
      await config.load();
    }
    const cmd = new StatusCommand(config);
    await cmd.execute();
  });

program
  .command('batch-add')
  .description('Add all files from a directory to raw materials')
  .argument('<dir>', 'Directory path')
  .argument('[kb-path]', 'Knowledge base directory (default: auto-detect)')
  .action(async (dir, kbPath) => {
    const config = new ConfigManager();
    if (kbPath) {
      await config.loadFromPath(kbPath);
    } else {
      await config.load();
    }
    const skillManager = new SkillManager();
    await skillManager.loadSkills(config.getKnowledgeBaseDir());
    const cmd = new AddCommand(config, skillManager);
    await cmd.execute(dir, true);
  });

program
  .command('run-debug')
  .description('Start interactive mode with AI debug output')
  .argument('[kb-path]', 'Knowledge base directory (default: auto-detect)')
  .action(async (kbPath) => {
    process.env.FINA_DEBUG = '1';
    const config = new ConfigManager();
    if (kbPath) {
      await config.loadFromPath(kbPath);
    } else {
      await config.load();
    }
    const skillManager = new SkillManager();
    await skillManager.loadSkills(config.getKnowledgeBaseDir());
    const shell = new Shell(config, skillManager);
    await shell.start();
  });

// Default: enter shell mode
if (process.argv.length === 2) {
  (async () => {
    const config = new ConfigManager();
    await config.load();
    const skillManager = new SkillManager();
    await skillManager.loadSkills(config.getKnowledgeBaseDir());
    const shell = new Shell(config, skillManager);
    await shell.start();
  })();
} else {
  program.parseAsync(process.argv);
}
