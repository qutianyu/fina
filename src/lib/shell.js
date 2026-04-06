const readline = require('readline');
const chalk = require('chalk');
const { AddCommand } = require('../commands/add.js');
const { MakeCommand } = require('../commands/make.js');
const { StatusCommand } = require('../commands/status.js');
const { QueryCommand } = require('../commands/query.js');

const COMMANDS = [
  { name: '/add', description: 'Add URL or local file' },
  { name: '/batch-add', description: 'Add all files from a directory' },
  { name: '/make', description: 'Compile/refresh wiki' },
  { name: '/status', description: 'Show stats' },
  { name: '/search', description: 'Search wiki' },
  { name: '/exit', description: 'Exit shell' },
];

class Shell {
  constructor(config, skillManager = null) {
    this.config = config;
    this.skillManager = skillManager;
    this.running = true;
    this.history = [];
    this.historyIndex = -1;
  }

  printBanner() {
    console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════════╗
║                       Fina CLI                                 ║
║            AI Knowledge Base - Your Personal Librarian        ║
╚═══════════════════════════════════════════════════════════════╝
`));
    console.log(chalk.gray('Commands:'));
    for (const cmd of COMMANDS) {
      console.log(`  ${chalk.yellow(cmd.name.padEnd(10))} ${chalk.gray('- ' + cmd.description)}`);
    }
    console.log(chalk.gray('  (just type)         - Ask questions'));
    console.log();
  }

  async handleCommand(input) {
    const trimmed = input.trim();

    if (trimmed === '/exit' || trimmed === '/quit' || trimmed === 'exit' || trimmed === 'quit') {
      console.log(chalk.green('Goodbye!'));
      this.running = false;
      return;
    }

    if (trimmed === '/status') {
      const cmd = new StatusCommand(this.config);
      await cmd.execute();
      return;
    }

    if (trimmed.startsWith('/batch-add ')) {
      const dir = trimmed.slice(11).trim();
      if (!dir) {
        console.log(chalk.red('Usage: /batch-add <directory>'));
        return;
      }
      const cmd = new AddCommand(this.config, this.skillManager);
      await cmd.execute(dir, true);
      return;
    }

    if (trimmed.startsWith('/add ')) {
      const source = trimmed.slice(5).trim();
      if (!source) {
        console.log(chalk.red('Usage: /add <url-or-path>'));
        return;
      }
      const cmd = new AddCommand(this.config, this.skillManager);
      await cmd.execute(source);
      return;
    }

    if (trimmed === '/make') {
      const cmd = new MakeCommand(this.config);
      await cmd.execute();
      return;
    }

    if (trimmed.startsWith('/search ')) {
      const query = trimmed.slice(8).trim();
      const cmd = new QueryCommand(this.config);
      await cmd.execute(query);
      return;
    }

    if (trimmed === '/help') {
      this.printBanner();
      return;
    }

    if (trimmed === '/') {
      console.log(chalk.gray('Commands:'));
      for (const cmd of COMMANDS) {
        console.log(`  ${chalk.yellow(cmd.name.padEnd(10))} ${chalk.gray('- ' + cmd.description)}`);
      }
      return;
    }

    // Unknown command
    if (trimmed.startsWith('/')) {
      console.log(chalk.yellow(`Unknown command: ${trimmed.split(' ')[0]}. Type /help for available commands.`));
      return;
    }

    // Treat as a question
    const cmd = new QueryCommand(this.config);
    await cmd.execute(trimmed);
  }

  async start() {
    this.printBanner();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    });

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      // Disable terminal's interpretation of special characters like &, !, etc.
      try {
        const tty = require('tty');
        if (tty.isatty()) {
          // Try to disable character echoing of special chars
        }
      } catch (e) {}
    }

    let input = '';

    const printInput = () => {
      process.stdout.write('\r\x1b[K');
      process.stdout.write(chalk.cyan('fina > ') + input);
    };

    printInput();

    const cleanup = () => {
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
          console.log(chalk.yellow('\nExiting...'));
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

        // Ctrl+U: clear line
        if (key.ctrl && key.name === 'u') {
          process.stdout.write('\r\x1b[K');
          input = '';
          return;
        }

        // Ctrl+K: kill from cursor to end of line
        if (key.ctrl && key.name === 'k') {
          const spaces = input.length;
          input = '';
          for (let i = 0; i < spaces; i++) {
            process.stdout.write(' ');
          }
          readline.moveCursor(process.stdin, -spaces);
          return;
        }

        // Up arrow: history previous
        if (key.name === 'up') {
          if (this.history.length === 0) return;
          if (this.historyIndex === -1) {
            this.historyIndex = this.history.length - 1;
          } else if (this.historyIndex > 0) {
            this.historyIndex--;
          }
          input = this.history[this.historyIndex] || '';
          process.stdout.write('\r\x1b[K');
          process.stdout.write(chalk.cyan('fina > ') + input);
          return;
        }

        // Down arrow: history next
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
          process.stdout.write(chalk.cyan('fina > ') + input);
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

module.exports = { Shell };
