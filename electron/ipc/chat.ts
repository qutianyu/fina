import { ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  ConfigManager,
  QueryCommand,
  ElectronStreamRenderer,
} from '@fina/core';

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

const abortControllers = new Map<string, AbortController>();

ipcMain.handle('chat:query', async (event: IpcMainInvokeEvent, params: ChatParams) => {
  const { kbPath, query, abortSignal } = params;

  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);

    const cmd = new QueryCommand(config);

    const renderer = new ElectronStreamRenderer((streamEvent) => {
      event.sender.send('chat:stream', streamEvent);
    });

    const controller = new AbortController();
    if (abortSignal) {
      abortControllers.set(abortSignal, controller);
    }

    const result = await cmd.execute(query, {
      streamRenderer: renderer,
      abortSignal: controller.signal,
    });

    if (abortSignal) {
      abortControllers.delete(abortSignal);
    }

    return { success: true, result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('chat:direct', async (event: IpcMainInvokeEvent, params: ChatParams) => {
  const { kbPath, query } = params;

  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);

    const cmd = new QueryCommand(config);

    const renderer = new ElectronStreamRenderer((streamEvent) => {
      event.sender.send('chat:stream', streamEvent);
    });

    const result = await cmd.executeDirect(query, {
      streamRenderer: renderer,
    });

    return { success: true, result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('chat:cancel', async (_event, abortSignal: string) => {
  const controller = abortControllers.get(abortSignal);
  if (controller) {
    controller.abort();
    abortControllers.delete(abortSignal);
    return { success: true };
  }
  return { success: false, error: 'No active chat to cancel' };
});