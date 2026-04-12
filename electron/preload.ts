import { contextBridge, ipcRenderer } from 'electron';

// Chat params
interface ChatParams {
  kbPath: string;
  query: string;
  sessionId?: string;
  history?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
  }>;
  abortSignal?: string;
}

// Stream events
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

// Expose safe API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Wiki
  wikiTree: (kbPath: string) => ipcRenderer.invoke('wiki:tree', kbPath),
  wikiFile: (kbPath: string, filePath: string) => ipcRenderer.invoke('wiki:file', kbPath, filePath),
  wikiFileRaw: (kbPath: string, filePath: string) => ipcRenderer.invoke('wiki:file-raw', kbPath, filePath),
  wikiConcepts: (kbPath: string) => ipcRenderer.invoke('wiki:concepts', kbPath),
  wikiSources: (kbPath: string) => ipcRenderer.invoke('wiki:sources', kbPath),

  // Chat
  chatQuery: (params: ChatParams) => ipcRenderer.invoke('chat:query', params),
  chatDirect: (params: ChatParams) => ipcRenderer.invoke('chat:direct', params),
  onChatStream: (callback: (data: ChatStreamEvent) => void) => {
    ipcRenderer.on('chat:stream', (_e, data) => callback(data));
  },
  removeChatStreamListener: () => {
    ipcRenderer.removeAllListeners('chat:stream');
  },

  // Commands
  cmdInit: (kbPath: string) => ipcRenderer.invoke('cmd:init', kbPath),
  cmdAdd: (kbPath: string, source: string) => ipcRenderer.invoke('cmd:add', kbPath, source),
  cmdBatchAdd: (kbPath: string, dir: string) => ipcRenderer.invoke('cmd:batch-add', kbPath, dir),
  cmdMake: (kbPath: string, deep?: boolean) => ipcRenderer.invoke('cmd:make', kbPath, deep),
  cmdLint: (kbPath: string) => ipcRenderer.invoke('cmd:lint', kbPath),
  cmdMerge: (kbPath: string, file: string, into?: string) => ipcRenderer.invoke('cmd:merge', kbPath, file, into),
  cmdStatus: (kbPath: string) => ipcRenderer.invoke('cmd:status', kbPath),
  onCommandOutput: (callback: (data: CommandOutputEvent) => void) => {
    ipcRenderer.on('command:output', (_e, data) => callback(data));
  },
  cancelCommand: (command: string) => ipcRenderer.invoke('cmd:cancel', command),

  // Sessions
  sessionList: (kbPath: string) => ipcRenderer.invoke('session:list', kbPath),
  sessionCreate: (kbPath: string, name?: string) => ipcRenderer.invoke('session:create', kbPath, name),
  sessionGet: (kbPath: string, id: string) => ipcRenderer.invoke('session:get', kbPath, id),
  sessionDelete: (kbPath: string, id: string) => ipcRenderer.invoke('session:delete', kbPath, id),
  sessionRename: (kbPath: string, id: string, name: string) => ipcRenderer.invoke('session:rename', kbPath, id, name),
  sessionMessages: (kbPath: string, id: string, offset?: number, limit?: number) => 
    ipcRenderer.invoke('session:messages', kbPath, id, offset, limit),

  // Dialog
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),

  // Config
  getKbPath: () => ipcRenderer.invoke('config:getKbPath'),
  setKbPath: (path: string) => ipcRenderer.invoke('config:setKbPath', path),
  getConfig: (kbPath: string) => ipcRenderer.invoke('config:get', kbPath),
  updateConfig: (kbPath: string, updates: Record<string, unknown>) => ipcRenderer.invoke('config:update', kbPath, updates),
  validateConfig: (kbPath: string) => ipcRenderer.invoke('config:validate', kbPath),
});
