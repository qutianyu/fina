// Type declarations for Electron API

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface ChatStreamEvent {
  type: 'text' | 'think_start' | 'think_content' | 'think_end' | 'source' | 'error' | 'done';
  content: string;
  sources?: string[];
  autoMerged?: boolean;
  mergedConcept?: string;
}

interface CommandOutputEvent {
  command: string;
  type: 'log' | 'warn' | 'error' | 'progress' | 'done';
  content: string;
  step?: string;
  progress?: number;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];
  fileType?: 'markdown' | 'image' | 'json' | 'code' | 'other';
  size?: number;
  modified?: string;
}

interface Session {
  id: string;
  name: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface Config {
  type: 'anthropic' | 'openai';
  baseUrl: string;
  model: string;
  language: string;
  maxContextTokens: number;
}

declare global {
  interface Window {
    electronAPI: {
      // Wiki
      wikiTree: (kbPath: string) => Promise<{ success: boolean; roots?: FileTreeNode[]; error?: string }>;
      wikiFile: (kbPath: string, filePath: string) => Promise<{ success: boolean; content?: string; frontmatter?: Record<string, unknown>; error?: string }>;
      wikiFileRaw: (kbPath: string, filePath: string) => Promise<{ success: boolean; mimeType?: string; base64?: string; error?: string }>;
      wikiConcepts: (kbPath: string) => Promise<{ success: boolean; concepts?: Record<string, unknown>; error?: string }>;
      wikiSources: (kbPath: string) => Promise<{ success: boolean; sources?: Record<string, unknown>; error?: string }>;

      // Chat
      chatQuery: (params: { kbPath: string; query: string; sessionId?: string; history?: ChatMessage[]; abortSignal?: string }) => Promise<{ success: boolean; result?: string; error?: string; cancelled?: boolean }>;
      chatDirect: (params: { kbPath: string; query: string; sessionId?: string; history?: ChatMessage[]; abortSignal?: string }) => Promise<{ success: boolean; result?: string; error?: string; cancelled?: boolean }>;
      onChatStream: (callback: (data: ChatStreamEvent) => void) => void;
      removeChatStreamListener: () => void;

      // Commands
      cmdInit: (kbPath: string) => Promise<{ success: boolean; error?: string }>;
      cmdAdd: (kbPath: string, source: string) => Promise<{ success: boolean; error?: string }>;
      cmdBatchAdd: (kbPath: string, dir: string) => Promise<{ success: boolean; error?: string }>;
      cmdMake: (kbPath: string, deep?: boolean) => Promise<{ success: boolean; error?: string; cancelled?: boolean }>;
      cmdLint: (kbPath: string) => Promise<{ success: boolean; issues?: unknown[]; error?: string }>;
      cmdMerge: (kbPath: string, file: string, into?: string) => Promise<{ success: boolean; error?: string }>;
      cmdStatus: (kbPath: string) => Promise<{ success: boolean; status?: unknown; error?: string }>;
      onCommandOutput: (callback: (data: CommandOutputEvent) => void) => void;
      cancelCommand: (command: string) => Promise<{ success: boolean; error?: string }>;

      // Sessions
      sessionList: (kbPath: string) => Promise<{ success: boolean; sessions?: Session[]; error?: string }>;
      sessionCreate: (kbPath: string, name?: string) => Promise<{ success: boolean; session?: Session; error?: string }>;
      sessionGet: (kbPath: string, id: string) => Promise<{ success: boolean; session?: Session; error?: string }>;
      sessionDelete: (kbPath: string, id: string) => Promise<{ success: boolean; error?: string }>;
      sessionRename: (kbPath: string, id: string, name: string) => Promise<{ success: boolean; error?: string }>;
      sessionMessages: (kbPath: string, id: string, offset?: number, limit?: number) => Promise<{ success: boolean; messages?: ChatMessage[]; error?: string }>;

      // Dialog
      selectDirectory: () => Promise<string | null>;

      // Config
      getKbPath: () => Promise<string | null>;
      setKbPath: (path: string) => Promise<boolean>;
      getConfig: (kbPath: string) => Promise<{ success: boolean; config?: Config; error?: string }>;
      updateConfig: (kbPath: string, updates: Partial<Config>) => Promise<{ success: boolean; error?: string }>;
      validateConfig: (kbPath: string) => Promise<{ success: boolean; valid?: boolean; error?: string }>;
    };
  }
}

export {};
