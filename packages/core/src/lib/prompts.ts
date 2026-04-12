import path from 'path';
import fs from 'fs-extra';

export class PromptLoader {
  private static promptsDir: string | null = null;

  /** 获取 prompts 目录路径（兼容开发态和打包态） */
  static getPromptsDir(): string {
    if (this.promptsDir) {
      return this.promptsDir;
    }

    // 尝试多种方式获取 prompts 目录
    const possiblePaths = [
      // 开发态：packages/core/prompts/
      path.join(__dirname, '..', '..', 'prompts'),
      // 打包态：相对于 dist/ 目录
      path.join(__dirname, '..', 'prompts'),
      // 相对于当前工作目录（monorepo 根）
      path.join(process.cwd(), 'packages', 'core', 'prompts'),
      path.join(process.cwd(), 'prompts'),
    ];

    for (const dir of possiblePaths) {
      if (fs.existsSync(dir)) {
        this.promptsDir = dir;
        return dir;
      }
    }

    throw new Error('Could not find prompts directory');
  }

  /** 设置 prompts 目录（用于测试或自定义路径） */
  static setPromptsDir(dir: string): void {
    this.promptsDir = dir;
  }

  /** 根据语言加载 prompt */
  static load(systemOrUser: 'system' | 'user', name: string, lang: string = 'en'): string {
    const suffix = lang === 'zh' ? '-zh' : '-en';
    const filePath = path.join(this.getPromptsDir(), name, `${systemOrUser}${suffix}.txt`);
    
    if (!fs.existsSync(filePath)) {
      // 如果指定语言的文件不存在，尝试加载英文版本
      const enFilePath = path.join(this.getPromptsDir(), name, `${systemOrUser}-en.txt`);
      if (fs.existsSync(enFilePath)) {
        return fs.readFileSync(enFilePath, 'utf-8');
      }
      throw new Error(`Prompt file not found: ${filePath}`);
    }
    
    return fs.readFileSync(filePath, 'utf-8');
  }

  /** 加载没有语言后缀的 prompt（如 lint、add） */
  static loadSimple(systemOrUser: 'system' | 'user', name: string): string {
    const filePath = path.join(this.getPromptsDir(), name, `${systemOrUser}.txt`);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt file not found: ${filePath}`);
    }
    
    return fs.readFileSync(filePath, 'utf-8');
  }
}
