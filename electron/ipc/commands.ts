import { ipcMain, IpcMainInvokeEvent } from 'electron';
import {
  ConfigManager,
  SkillManager,
  InitCommand,
  AddCommand,
  MakeCommand,
  LintCommand,
  MergeCommand,
  StatusCommand,
  ElectronOutput,
  LintIssue,
} from '@fina/core';

const abortControllers = new Map<string, AbortController>();
const runningCommands = new Set<string>();

function createOutput(event: IpcMainInvokeEvent, command: string): ElectronOutput {
  return new ElectronOutput((e) => {
    event.sender.send('command:output', { ...e, command });
  }, command);
}

// Init command
ipcMain.handle('cmd:init', async (event: IpcMainInvokeEvent, kbPath: string) => {
  try {
    const output = createOutput(event, 'init');
    const cmd = new InitCommand(output);
    await cmd.execute(kbPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Add command
ipcMain.handle('cmd:add', async (event: IpcMainInvokeEvent, kbPath: string, source: string) => {
  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);
    const skillManager = new SkillManager();
    await skillManager.loadSkills(config.getKnowledgeBaseDir());

    const output = createOutput(event, 'add');
    const cmd = new AddCommand(config, skillManager, output);
    await cmd.execute(source);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Batch add command
ipcMain.handle('cmd:batch-add', async (event: IpcMainInvokeEvent, kbPath: string, dir: string) => {
  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);
    const skillManager = new SkillManager();
    await skillManager.loadSkills(config.getKnowledgeBaseDir());

    const output = createOutput(event, 'batch-add');
    const cmd = new AddCommand(config, skillManager, output);
    await cmd.execute(dir, true);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Make command (with concurrency protection)
ipcMain.handle('cmd:make', async (event: IpcMainInvokeEvent, kbPath: string, deep?: boolean) => {
  if (runningCommands.has('make')) {
    return { success: false, error: 'make command is already running' };
  }

  runningCommands.add('make');

  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);

    const output = createOutput(event, 'make');
    const cmd = new MakeCommand(config, output);

    if (deep) {
      await cmd.executeDeep();
    } else {
      await cmd.execute();
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  } finally {
    runningCommands.delete('make');
  }
});

// Lint command
ipcMain.handle('cmd:lint', async (event: IpcMainInvokeEvent, kbPath: string) => {
  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);

    const output = createOutput(event, 'lint');
    const cmd = new LintCommand(config, output);
    const issues: LintIssue[] = await cmd.execute();

    return { success: true, issues };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Merge command
ipcMain.handle('cmd:merge', async (event: IpcMainInvokeEvent, kbPath: string, file: string, into?: string) => {
  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);

    const output = createOutput(event, 'merge');
    const cmd = new MergeCommand(config, output);
    await cmd.execute(file, into);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Status command
ipcMain.handle('cmd:status', async (event: IpcMainInvokeEvent, kbPath: string) => {
  try {
    const config = new ConfigManager();
    await config.loadFromPath(kbPath);

    const output = createOutput(event, 'status');
    const cmd = new StatusCommand(config, output);
    const status = await cmd.execute();

    return { success: true, status };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Cancel command
ipcMain.handle('cmd:cancel', async (_event, command: string) => {
  const controller = abortControllers.get(command);
  if (controller) {
    controller.abort();
    abortControllers.delete(command);
    return { success: true };
  }
  return { success: false, error: `No running command: ${command}` };
});