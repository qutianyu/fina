import * as readline from 'readline';
import { red, yellow, cyan, gray, green } from 'picocolors';
import { QueryCommand } from '../commands/query';
import { ConfigManager } from './config';
import { SkillManager } from './skills';
import { SessionManager } from './session';
import { COMMANDS, findShellCommand, ShellState } from './commands';
import { ChatMessage } from '../types';

const EXTRA_SHELL_COMMANDS = [
  { name: '/exit', description: 'Exit shell' },
  { name: '/help', description: 'Show help' },
];

export class Shell {
  private config: ConfigManager;
  private skillManager: SkillManager | null;
  private running: boolean = true;
  private history: string[] = [];
  private historyIndex: number = -1;
  private sessionManager: SessionManager;

  private shellState: ShellState;

  constructor(config: ConfigManager, skillManager: SkillManager | null = null) {
    this.config = config;
    this.skillManager = skillManager;
    this.sessionManager = new SessionManager(config.getKnowledgeBaseDir());

    this.shellState = {
      currentSessionId: null,
      sessionManager: this.sessionManager
    };
  }

  async init(): Promise<void> {
    await this.sessionManager.init();
    const sessions = await this.sessionManager.listSessions();
    if (sessions.length === 0) {
      const defaultSession = await this.sessionManager.createSession('default');
      this.shellState.currentSessionId = defaultSession.id;
    } else {
      // Use most recently updated session
      this.shellState.currentSessionId = sessions[0].id;
    }
  }

  printBanner(): void {
    console.log(cyan(`
╔═══════════════════════════════════════════════════════════════╗
║                       Fina CLI                                 ║
║            AI Knowledge Base - Your Personal Librarian        ║
╚═══════════════════════════════════════════════════════════════╝
`));
    console.log(gray('Commands:'));
    for (const cmd of COMMANDS) {
      const argsStr = cmd.args.length > 0 ? ` <${cmd.args[0].name}>` : '';
      console.log(`  ${yellow(cmd.name.padEnd(12))} ${gray('- ' + cmd.description + argsStr)}`);
    }
    for (const cmd of EXTRA_SHELL_COMMANDS) {
      console.log(`  ${yellow(cmd.name.padEnd(12))} ${gray('- ' + cmd.description)}`);
    }
    console.log(gray('  (just type)       - Ask questions'));
    console.log();
  }

  async handleCommand(input: string): Promise<void> {
    let trimmed = input.trim();

    // 向后兼容: /make deep → /make --deep
    if (trimmed === '/make deep') {
      trimmed = '/make --deep';
    }

    // Shell 特有命令
    if (trimmed === '/exit' || trimmed === '/quit' || trimmed === 'exit' || trimmed === 'quit') {
      console.log(green('Goodbye!'));
      this.running = false;
      return;
    }

    if (trimmed === '/help') {
      this.printBanner();
      return;
    }

    if (trimmed === '/') {
      console.log(gray('Commands:'));
      for (const cmd of COMMANDS) {
        console.log(`  ${yellow(cmd.name.padEnd(12))} ${gray('- ' + cmd.description)}`);
      }
      return;
    }

    // 从共享命令表中查找匹配
    const matched = findShellCommand(trimmed);
    if (matched) {
      // 检查必填参数
      for (const argDef of matched.def.args) {
        if (argDef.required && !matched.args[argDef.name]) {
          console.log(red(`Usage: ${matched.def.name} <${argDef.name}>`));
          return;
        }
      }
      await matched.def.action(matched.args, this.config, this.skillManager, this.shellState);
      return;
    }

    if (trimmed.startsWith('/')) {
      console.log(yellow(`Unknown command: ${trimmed.split(' ')[0]}. Type /help for available commands.`));
      return;
    }

    // 非命令输入 → 作为搜索查询（使用 session 历史）
    const cmd = new QueryCommand(this.config);
    const sessionId = this.shellState.currentSessionId;
    let history: ChatMessage[] = [];

    if (sessionId) {
      const session = await this.sessionManager.getSession(sessionId);
      if (session) {
        history = session.messages;
      }
    }

    const answer = await cmd.execute(trimmed, history);
    if (answer) {
      // Save to session history
      if (sessionId) {
        const now = Math.floor(Date.now() / 1000);
        await this.sessionManager.addMessage(sessionId, { role: 'user', content: trimmed, timestamp: now });
        await this.sessionManager.addMessage(sessionId, { role: 'assistant', content: answer, timestamp: now });
      }
    }
  }

  async start(): Promise<void> {
    await this.init();
    this.printBanner();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    });

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    let input = '';

    const printInput = (): void => {
      process.stdout.write('\r\x1b[K');
      process.stdout.write(cyan('fina > ') + input);
    };

    printInput();

    const cleanup = (): void => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };

    return new Promise((resolve) => {
      process.stdin.on('keypress', (chunk, key) => {
        if (key === undefined) return;

        if (key.name === 'ctrl-c') {
          cleanup();
          console.log(yellow('\nExiting...'));
          resolve();
          return;
        }

        if (key.name === 'return') {
          process.stdout.write('\n');
          const cmd = input.trim();
          input = '';
          this.historyIndex = -1;
          if (cmd) {
            this.history.push(cmd);
            this.handleCommand(cmd).then(() => {
              if (!this.running) {
                cleanup();
                resolve();
              } else {
                printInput();
              }
            });
          } else {
            printInput();
          }
          return;
        }

        if (key.name === 'backspace') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            printInput();
          }
          return;
        }

        if (key.ctrl && key.name === 'u') {
          process.stdout.write('\r\x1b[K');
          input = '';
          return;
        }

        if (key.ctrl && key.name === 'k') {
          const spaces = input.length;
          input = '';
          for (let i = 0; i < spaces; i++) {
            process.stdout.write(' ');
          }
          readline.moveCursor(process.stdin, -spaces, 0);
          return;
        }

        if (key.name === 'up') {
          if (this.history.length === 0) return;
          if (this.historyIndex === -1) {
            this.historyIndex = this.history.length - 1;
          } else if (this.historyIndex > 0) {
            this.historyIndex--;
          }
          input = this.history[this.historyIndex] || '';
          process.stdout.write('\r\x1b[K');
          process.stdout.write(cyan('fina > ') + input);
          return;
        }

        if (key.name === 'down') {
          if (this.historyIndex === -1) return;
          this.historyIndex++;
          if (this.historyIndex >= this.history.length) {
            this.historyIndex = -1;
            input = '';
          } else {
            input = this.history[this.historyIndex] || '';
          }
          process.stdout.write('\r\x1b[K');
          process.stdout.write(cyan('fina > ') + input);
          return;
        }

        if (key.ctrl) return;

        if (key.sequence && key.sequence.length === 1) {
          input += key.sequence;
          printInput();
        }
      });

      process.stdin.resume();
    });
  }
}
