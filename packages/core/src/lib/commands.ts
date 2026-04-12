import { red, green, yellow, gray } from 'picocolors';
import { AddCommand } from '../commands/add';
import { MakeCommand } from '../commands/make';
import { StatusCommand } from '../commands/status';
import { QueryCommand } from '../commands/query';
import { LintCommand } from '../commands/lint';
import { MergeCommand } from '../commands/merge';
import { ConfigManager } from './config';
import { SkillManager } from './skills';
import { SessionManager } from './session';
import { ChatMessage } from '../types';

export interface CommandArg {
  name: string;
  required: boolean;
  description: string;
}

export interface CommandOption {
  name: string;
  flag: string;
  description: string;
  required: boolean;
  isFlag?: boolean;
}

export interface CommandDef {
  name: string;
  cliName?: string;
  description: string;
  usage?: string;
  args: CommandArg[];
  options?: CommandOption[];
  action: (args: Record<string, string>, config: ConfigManager, skillManager: SkillManager | null, shellState?: ShellState) => Promise<void>;
}

export interface ShellState {
  currentSessionId: string | null;
  sessionManager: SessionManager | null;
}

export const COMMANDS: CommandDef[] = [
  {
    name: '/add',
    cliName: 'add',
    description: 'Add URL or local file to raw materials',
    args: [{ name: 'source', required: true, description: 'URL or local file path' }],
    action: async (args, config, skillManager) => {
      const cmd = new AddCommand(config, skillManager);
      await cmd.execute(args.source);
    }
  },
  {
    name: '/batch-add',
    cliName: 'batch-add',
    description: 'Add all files from a directory',
    args: [{ name: 'dir', required: true, description: 'Directory path' }],
    action: async (args, config, skillManager) => {
      const cmd = new AddCommand(config, skillManager);
      await cmd.execute(args.dir, true);
    }
  },
  {
    name: '/make',
    cliName: 'make',
    description: 'Compile/refresh wiki',
    args: [],
    options: [{ name: 'deep', flag: '--deep', description: 'Deep merge mode', required: false, isFlag: true }],
    action: async (args, config) => {
      const cmd = new MakeCommand(config);
      if (args.deep) {
        await cmd.executeDeep();
      } else {
        await cmd.execute();
      }
    }
  },
  {
    name: '/search',
    cliName: 'search',
    description: 'Search wiki',
    args: [{ name: 'query', required: true, description: 'Search query' }],
    action: async (args, config, _skillManager, shellState) => {
      const cmd = new QueryCommand(config);
      const sessionId = shellState?.currentSessionId;
      let history: ChatMessage[] = [];

      if (sessionId && shellState?.sessionManager) {
        const session = await shellState.sessionManager.getSession(sessionId);
        if (session) {
          history = session.messages;
        }
      }

      const answer = await cmd.execute(args.query, history);

      if (answer && shellState?.sessionManager && sessionId) {
        const now = Math.floor(Date.now() / 1000);
        await shellState.sessionManager.addMessage(sessionId, { role: 'user', content: args.query, timestamp: now });
        await shellState.sessionManager.addMessage(sessionId, { role: 'assistant', content: answer, timestamp: now });
      }
    }
  },
  {
    name: '/open',
    description: 'Direct chat (no wiki needed)',
    args: [{ name: 'query', required: true, description: 'Your question' }],
    action: async (args, config, _skillManager, shellState) => {
      const cmd = new QueryCommand(config);
      const sessionId = shellState?.currentSessionId;
      let history: ChatMessage[] = [];

      if (sessionId && shellState?.sessionManager) {
        const session = await shellState.sessionManager.getSession(sessionId);
        if (session) {
          history = session.messages;
        }
      }

      const answer = await cmd.executeDirect(args.query, history);

      if (answer && shellState?.sessionManager && sessionId) {
        const now = Math.floor(Date.now() / 1000);
        await shellState.sessionManager.addMessage(sessionId, { role: 'user', content: args.query, timestamp: now });
        await shellState.sessionManager.addMessage(sessionId, { role: 'assistant', content: answer, timestamp: now });
      }
    }
  },
  {
    name: '/status',
    cliName: 'status',
    description: 'Show stats',
    args: [],
    action: async (_args, config) => {
      const cmd = new StatusCommand(config);
      await cmd.execute();
    }
  },
  {
    name: '/lint',
    cliName: 'lint',
    description: 'Run knowledge base health check',
    args: [],
    action: async (_args, config) => {
      const cmd = new LintCommand(config);
      await cmd.execute();
    }
  },
  {
    name: '/merge',
    cliName: 'merge',
    description: 'Merge output file into a concept page',
    args: [{ name: 'file', required: true, description: 'Output file to merge' }],
    options: [{ name: 'into', flag: '--into', description: 'Target concept to merge into', required: false }],
    action: async (args, config) => {
      const cmd = new MergeCommand(config);
      await cmd.execute(args.file, args.into);
    }
  },
  {
    name: '/new-session',
    description: 'Create a new chat session',
    args: [{ name: 'name', required: false, description: 'Session name' }],
    action: async (args, _config, _skillManager, shellState) => {
      if (!shellState?.sessionManager) {
        console.log(red('Session manager not initialized'));
        return;
      }
      const session = await shellState.sessionManager.createSession(args.name);
      shellState.currentSessionId = session.id;
      console.log(green(`Created session: ${session.id} (${session.name})`));
    }
  },
  {
    name: '/session-list',
    description: 'List all sessions',
    args: [],
    action: async (_args, _config, _skillManager, shellState) => {
      if (!shellState?.sessionManager) {
        console.log(red('Session manager not initialized'));
        return;
      }
      const sessions = await shellState.sessionManager.listSessions();
      console.log(gray('Sessions:'));
      for (const s of sessions) {
        const marker = s.id === shellState.currentSessionId ? ' *' : '';
        console.log(`  ${yellow(s.id)}${marker} - ${s.name} (${s.messages.length} messages)`);
      }
    }
  },
  {
    name: '/session',
    description: 'Switch to a session',
    args: [{ name: 'id', required: true, description: 'Session ID' }],
    action: async (args, _config, _skillManager, shellState) => {
      if (!shellState?.sessionManager) {
        console.log(red('Session manager not initialized'));
        return;
      }
      const session = await shellState.sessionManager.getSession(args.id);
      if (!session) {
        console.log(red(`Session not found: ${args.id}`));
        return;
      }
      shellState.currentSessionId = session.id;
      console.log(green(`Switched to session: ${session.id} (${session.name})`));
    }
  }
];

export function findShellCommand(input: string): { def: CommandDef; args: Record<string, string> } | null {
  const trimmed = input.trim();

  for (const def of COMMANDS) {
    if (def.name === trimmed) {
      const allOptional = def.args.every(arg => !arg.required);
      if (def.args.length === 0 || allOptional) {
        return { def, args: {} };
      }
    }
    if (trimmed.startsWith(def.name + ' ')) {
      let rest = trimmed.slice(def.name.length + 1).trim();
      if (!rest) continue;

      const args: Record<string, string> = {};

      if (def.options) {
        for (const opt of def.options) {
          if (opt.isFlag) {
            if (rest.includes(opt.flag)) {
              args[opt.name] = 'true';
              rest = rest.replace(opt.flag, '').trim();
            }
          } else {
            const escapedFlag = opt.flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`${escapedFlag}\\s+(\\S+)`);
            const match = rest.match(regex);
            if (match) {
              args[opt.name] = match[1];
              rest = rest.replace(regex, '').trim();
            }
          }
        }
      }

      if (def.args.length > 0 && rest) {
        args[def.args[0].name] = rest;
      }

      return { def, args };
    }
  }

  return null;
}