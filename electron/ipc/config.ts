import { ipcMain } from 'electron';
import { ConfigManager } from '@fina/core';

// Store KB path in memory (could also use electron-store)
let currentKbPath: string | null = null;

ipcMain.handle('config:getKbPath', () => {
  return currentKbPath;
});

ipcMain.handle('config:setKbPath', (_event, path: string) => {
  currentKbPath = path;
  return true;
});

ipcMain.handle('config:get', async (_event, kbPath: string) => {
  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);
    return {
      success: true,
      config: {
        type: config.getConfig().type,
        baseUrl: config.getConfig().baseUrl,
        model: config.getConfig().model,
        language: config.getConfig().language,
        maxContextTokens: config.getConfig().maxContextTokens,
      },
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('config:update', async (_event, kbPath: string, updates: Record<string, unknown>) => {
  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);
    // Update config values
    // Note: This is a simplified version; actual implementation would update the config file
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('config:validate', async (_event, kbPath: string) => {
  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);
    const isValid = await config.validateApiKey();
    return { success: true, valid: isValid };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});
