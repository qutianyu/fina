import { ipcMain } from 'electron';
import {
  ConfigManager,
  SessionManager,
  QueryCommand,
  ElectronStreamRenderer,
  ChatStreamEvent,
} from '@fina/core';

// Maintain abort controllers for cancellation
const abortControllers = new Map<string, AbortController>();

ipcMain.handle('session:list', async (_event, kbPath: string) => {
  try {
    const sessionMgr = new SessionManager(kbPath);
    await sessionMgr.init();
    const sessions = await sessionMgr.listSessions();
    return { success: true, sessions };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('session:create', async (_event, kbPath: string, name?: string) => {
  try {
    const sessionMgr = new SessionManager(kbPath);
    await sessionMgr.init();
    const session = await sessionMgr.createSession(name);
    return { success: true, session };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('session:get', async (_event, kbPath: string, id: string) => {
  try {
    const sessionMgr = new SessionManager(kbPath);
    await sessionMgr.init();
    const session = await sessionMgr.getSession(id);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    return { success: true, session };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('session:delete', async (_event, kbPath: string, id: string) => {
  try {
    const sessionMgr = new SessionManager(kbPath);
    await sessionMgr.init();
    await sessionMgr.deleteSession(id);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('session:rename', async (_event, kbPath: string, id: string, name: string) => {
  try {
    const sessionMgr = new SessionManager(kbPath);
    await sessionMgr.init();
    await sessionMgr.renameSession(id, name);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('session:messages', async (_event, kbPath: string, id: string, offset?: number, limit?: number) => {
  try {
    const sessionMgr = new SessionManager(kbPath);
    await sessionMgr.init();
    const messages = await sessionMgr.getMessages(id, offset, limit);
    return { success: true, messages };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});
