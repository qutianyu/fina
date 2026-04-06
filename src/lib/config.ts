import * as fs from 'fs-extra';
import * as path from 'path';
import { Config } from '../types';

export class ConfigManager {
  configPath: string | null = null;
  debug: boolean;
  config: Config;

  constructor() {
    this.configPath = null;
    this.debug = process.env.FINA_DEBUG === '1';
    this.config = {
      type: 'anthropic',
      apiKey: '',
      baseUrl: '',
      model: '',
      language: 'en',
      maxContextTokens: 100000
    };
  }

  async load(): Promise<this> {
    let dir = process.cwd();
    const root = path.parse(dir).root;

    while (dir !== root) {
      const configPath = path.join(dir, '.fina', 'config.json');
      if (await fs.pathExists(configPath)) {
        this.configPath = configPath;
        const storedConfig = await fs.readJson(configPath) as Partial<Config>;
        this.config = { ...this.config, ...storedConfig };
        return this;
      }
      dir = path.dirname(dir);
    }

    const localConfig = path.join(process.cwd(), '.fina', 'config.json');
    if (await fs.pathExists(localConfig)) {
      this.configPath = localConfig;
      const storedConfig = await fs.readJson(localConfig) as Partial<Config>;
      this.config = { ...this.config, ...storedConfig };
    }

    return this;
  }

  async loadFromPath(kbPath: string): Promise<this> {
    const resolvedPath = path.resolve(kbPath);
    const configPath = path.join(resolvedPath, '.fina', 'config.json');
    if (await fs.pathExists(configPath)) {
      this.configPath = configPath;
      const storedConfig = await fs.readJson(configPath) as Partial<Config>;
      this.config = { ...this.config, ...storedConfig };
    }
    return this;
  }

  get(key: string): string | number | undefined {
    return this.config[key as keyof Config];
  }

  getApiKey(): string | undefined {
    const apiKey = this.get('apiKey') as string | undefined;
    if (apiKey) return apiKey;
    if (this.get('type') === 'openai') return process.env.OPENAI_API_KEY;
    return process.env.ANTHROPIC_API_KEY;
  }

  getBaseUrl(): string {
    const baseUrl = this.get('baseUrl') as string | undefined;
    if (baseUrl) return baseUrl;
    if (this.get('type') === 'openai') return 'https://api.openai.com/v1';
    return 'https://api.anthropic.com';
  }

  getModel(): string {
    return this.get('model') as string;
  }

  getType(): string {
    return (this.get('type') as string) || 'anthropic';
  }

  getLanguage(): string {
    return (this.get('language') as string) || 'en';
  }

  getMaxContextTokens(): number {
    return (this.get('maxContextTokens') as number) || 100000;
  }

  getRawDir(): string {
    return path.join(this.getKnowledgeBaseDir(), 'raw');
  }

  getWikiDir(): string {
    return path.join(this.getKnowledgeBaseDir(), 'wiki');
  }

  getKnowledgeBaseDir(): string {
    if (this.configPath) {
      return path.dirname(path.dirname(this.configPath));
    }
    return process.cwd();
  }

  async ensureConfigured(): Promise<boolean> {
    if (!this.getApiKey()) {
      const kbDir = this.getKnowledgeBaseDir();
      const type = this.getType();
      console.log(`\n⚠️  API key not configured (type: ${type}).`);
      if (this.configPath) {
        console.log(`   Config file: ${this.configPath}`);
        if (type === 'openai') {
          console.log('   Add your OPENAI_API_KEY env var or apiKey to config.');
        } else {
          console.log('   Add your ANTHROPIC_API_KEY env var or apiKey to config.');
        }
      } else {
        console.log(`   Please run 'fina init ${kbDir}' first to initialize the knowledge base.`);
      }
      return false;
    }
    return true;
  }
}
