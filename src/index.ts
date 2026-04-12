#!/usr/bin/env node

import { Command } from 'commander';
import picocolors from 'picocolors';
import * as fs from 'fs-extra';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ConfigManager } from './lib/config';
import { SkillManager } from './lib/skills';
import { Shell } from './lib/shell';
import { InitCommand } from './commands/init';
import { COMMANDS } from './lib/commands';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = fs.readJsonSync(path.join(__dirname, '..', 'package.json'));

const program = new Command();

program
  .name('Fina')
  .description('AI Knowledge Base CLI - Transform raw materials into a queryable wiki')
  .version(pkg.version);

async function loadConfig(kbPath?: string): Promise<ConfigManager> {
  const config = new ConfigManager();
  if (kbPath) {
    await config.loadFromPath(kbPath);
  } else {
    await config.load();
  }
  return config;
}

async function loadSkillManager(config: ConfigManager): Promise<SkillManager> {
  const skillManager = new SkillManager();
  await skillManager.loadSkills(config.getKnowledgeBaseDir());
  return skillManager;
}

function needsSkillManager(cliName: string): boolean {
  return cliName === 'add' || cliName === 'batch-add';
}

for (const cmd of COMMANDS) {
  if (!cmd.cliName) continue;

  const cliCommand = program
    .command(cmd.cliName)
    .description(cmd.description);

  for (const arg of cmd.args) {
    if (arg.required) {
      cliCommand.argument(`<${arg.name}>`, arg.description);
    } else {
      cliCommand.argument(`[${arg.name}]`, arg.description);
    }
  }

  if (cmd.cliName !== 'init') {
    cliCommand.argument('[kb-path]', 'Knowledge base directory (default: auto-detect)');
  }

  if (cmd.options) {
    for (const opt of cmd.options) {
      if (opt.isFlag) {
        cliCommand.option(opt.flag, opt.description);
      } else {
        cliCommand.option(`${opt.flag} <${opt.name}>`, opt.description);
      }
    }
  }

  cliCommand.action(async (...allArgs: unknown[]) => {
    const options = allArgs[allArgs.length - 1] as Record<string, unknown>;
    const argValues = allArgs.slice(0, -1) as string[];

    const args: Record<string, string> = {};
    for (let i = 0; i < cmd.args.length; i++) {
      if (argValues[i] !== undefined) {
        args[cmd.args[i].name] = argValues[i];
      }
    }

    if (cmd.options) {
      for (const opt of cmd.options) {
        if (options?.[opt.name] !== undefined) {
          args[opt.name] = String(options[opt.name]);
          if (opt.isFlag && options[opt.name] === true) {
            args[opt.name] = 'true';
          }
        }
      }
    }

    const kbPathIndex = cmd.args.length;
    const kbPath = argValues[kbPathIndex];

    const config = await loadConfig(kbPath as string | undefined);
    const skillManager = needsSkillManager(cmd.cliName!) ? await loadSkillManager(config) : null;

    await cmd.action(args, config, skillManager);
  });
}

program
  .command('init')
  .description('Initialize a new knowledge base at the specified path')
  .argument('<path>', 'Directory path for the knowledge base')
  .action(async (targetPath: string) => {
    const cmd = new InitCommand();
    await cmd.execute(targetPath);
  });

program
  .command('run')
  .description('Start interactive mode')
  .argument('[kb-path]', 'Knowledge base directory (default: auto-detect)')
  .action(async (kbPath?: string) => {
    const config = await loadConfig(kbPath);
    const skillManager = await loadSkillManager(config);
    const shell = new Shell(config, skillManager);
    await shell.start();
  });

program
  .command('run-debug')
  .description('Start interactive mode with AI debug output')
  .argument('[kb-path]', 'Knowledge base directory (default: auto-detect)')
  .action(async (kbPath?: string) => {
    process.env.FINA_DEBUG = '1';
    const config = await loadConfig(kbPath);
    const skillManager = await loadSkillManager(config);
    const shell = new Shell(config, skillManager);
    await shell.start();
  });

program
  .command('app')
  .description('Start the Fina desktop application')
  .action(async () => {
    const { spawn } = await import('child_process');
    const projectRoot = path.join(__dirname, '..');

    // 检查是否有 electron 目录（开发环境）
    if (fs.existsSync(path.join(projectRoot, 'electron'))) {
      const child = spawn('npm', ['run', 'dev'], {
        cwd: projectRoot,
        stdio: 'inherit',
        shell: true
      });

      child.on('exit', (code) => {
        process.exit(code || 0);
      });

      child.on('error', (err) => {
        console.error(picocolors.red(`Failed to start Fina app: ${err.message}`));
        process.exit(1);
      });
    } else {
      // 生产模式：启动打包后的应用
      const releaseDir = path.join(projectRoot, 'release');
      const macAppPath = path.join(releaseDir, 'mac', 'Fina.app');

      if (fs.existsSync(macAppPath)) {
        spawn('open', [macAppPath], { stdio: 'inherit' });
      } else {
        console.error(picocolors.yellow('Fina app not found. Build it first:'));
        console.error(picocolors.gray('  npm run build'));
        console.error(picocolors.gray('  npm run pack'));
        process.exit(1);
      }
    }
  });

if (process.argv.length === 2) {
  (async () => {
    const config = await loadConfig();
    const skillManager = await loadSkillManager(config);
    const shell = new Shell(config, skillManager);
    await shell.start();
  })();
} else {
  program.parseAsync(process.argv);
}