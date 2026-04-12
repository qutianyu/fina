import { red, yellow, blue, cyan, gray } from 'picocolors';

// ============================================================================
// OutputWriter 接口 - 替代 console.log / console.error
// ============================================================================

export interface OutputWriter {
  log(message: string): void;
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  progress(step: string, message: string, percent?: number): void;
}

// 命令输出事件（用于 Electron IPC）
export interface CommandOutputEvent {
  command: string;
  type: 'log' | 'warn' | 'error' | 'progress' | 'done';
  content: string;
  step?: string;
  progress?: number;
}

// CLI 模式 - 终端输出
export class ConsoleOutput implements OutputWriter {
  log(msg: string): void {
    console.log(msg);
  }

  error(msg: string): void {
    console.error(red(msg));
  }

  warn(msg: string): void {
    console.warn(yellow(msg));
  }

  info(msg: string): void {
    console.log(blue(msg));
  }

  progress(step: string, msg: string, pct?: number): void {
    const progressStr = pct !== undefined ? ` (${pct}%)` : '';
    console.log(`${cyan(step)} ${msg}${progressStr}`);
  }
}

// Electron 模式 - 通过 callback 推送到渲染进程
export class ElectronOutput implements OutputWriter {
  constructor(
    private emit: (event: CommandOutputEvent) => void,
    private command: string
  ) {}

  log(msg: string): void {
    this.emit({ command: this.command, type: 'log', content: msg });
  }

  error(msg: string): void {
    this.emit({ command: this.command, type: 'error', content: msg });
  }

  warn(msg: string): void {
    this.emit({ command: this.command, type: 'warn', content: msg });
  }

  info(msg: string): void {
    this.emit({ command: this.command, type: 'log', content: msg });
  }

  progress(step: string, msg: string, pct?: number): void {
    this.emit({
      command: this.command,
      type: 'progress',
      step,
      content: msg,
      progress: pct,
    });
  }
}

// ============================================================================
// StreamRenderer 接口 - 替代 query.ts 中直接的 process.stdout.write
// ============================================================================

export interface ChatStreamEvent {
  type: 'text' | 'think_start' | 'think_content' | 'think_end' | 'source' | 'error' | 'done';
  content: string;
  sources?: string[];
  autoMerged?: boolean;
  mergedConcept?: string;
}

export interface StreamRenderer {
  /** 流式输出一个文本 chunk */
  onChunk(text: string): void;
  /** think 块开始 */
  onThinkStart(): void;
  /** think 块内容 */
  onThinkContent(text: string): void;
  /** think 块结束 */
  onThinkEnd(): void;
  /** 来源引用 */
  onSources(sources: string[]): void;
  /** 流式结束 */
  onDone(fullResponse: string, autoMergeResult?: { autoMerged: boolean; mergedConcept?: string }): void;
  /** 流式错误 */
  onError(error: string): void;
}

// CLI 模式 - 终端渲染
export class TerminalStreamRenderer implements StreamRenderer {
  private buffer = '';
  private inThink = false;

  onChunk(text: string): void {
    process.stdout.write(text);
    this.buffer += text;
  }

  onThinkStart(): void {
    this.inThink = true;
    // 终端模式下可以选择不显示 think 块，或者折叠显示
  }

  onThinkContent(text: string): void {
    // 终端模式下忽略 think 内容
    if (this.inThink) {
      // 可选：将 think 内容输出到 stderr 或隐藏
    }
  }

  onThinkEnd(): void {
    this.inThink = false;
  }

  onSources(sources: string[]): void {
    console.log('\n');
    console.log(gray('Sources:'));
    sources.forEach((source, i) => {
      console.log(gray(`  ${i + 1}. ${source}`));
    });
  }

  onDone(fullResponse: string): void {
    // 已经在 onChunk 中输出了，这里不需要额外操作
  }

  onError(error: string): void {
    process.stderr.write(red(error));
  }
}

// Electron 模式 - 通过 IPC 推送到渲染进程
export class ElectronStreamRenderer implements StreamRenderer {
  constructor(private send: (event: ChatStreamEvent) => void) {}

  onChunk(text: string): void {
    this.send({ type: 'text', content: text });
  }

  onThinkStart(): void {
    this.send({ type: 'think_start', content: '' });
  }

  onThinkContent(text: string): void {
    this.send({ type: 'think_content', content: text });
  }

  onThinkEnd(): void {
    this.send({ type: 'think_end', content: '' });
  }

  onSources(sources: string[]): void {
    this.send({ type: 'source', content: '', sources });
  }

  onDone(fullResponse: string, autoMergeResult?: { autoMerged: boolean; mergedConcept?: string }): void {
    this.send({
      type: 'done',
      content: fullResponse,
      autoMerged: autoMergeResult?.autoMerged,
      mergedConcept: autoMergeResult?.mergedConcept,
    });
  }

  onError(error: string): void {
    this.send({ type: 'error', content: error });
  }
}

// ============================================================================
// CommandAbortedError - 命令被取消时抛出
// ============================================================================

export class CommandAbortedError extends Error {
  constructor(command: string) {
    super(`Command "${command}" was aborted`);
    this.name = 'CommandAbortedError';
  }
}
