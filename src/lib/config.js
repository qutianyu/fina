const fs = require('fs-extra');
const path = require('path');

class ConfigManager {
  constructor() {
    // Config is stored in .fina/config.json within the knowledge base
    this.configPath = null;
    this.debug = process.env.FINA_DEBUG === '1';
    this.config = {
      type: 'anthropic',
      apiKey: '',
      baseUrl: '',
      model: ''
    };
  }

  async load() {
    // Find .fina/config.json by searching up from current directory
    let dir = process.cwd();
    const root = path.parse(dir).root;

    while (dir !== root) {
      const configPath = path.join(dir, '.fina', 'config.json');
      if (await fs.pathExists(configPath)) {
        this.configPath = configPath;
        const storedConfig = await fs.readJson(configPath);
        this.config = { ...this.config, ...storedConfig };
        return this;
      }
      dir = path.dirname(dir);
    }

    // Also check current directory
    const localConfig = path.join(process.cwd(), '.fina', 'config.json');
    if (await fs.pathExists(localConfig)) {
      this.configPath = localConfig;
      const storedConfig = await fs.readJson(localConfig);
      this.config = { ...this.config, ...storedConfig };
    }

    return this;
  }

  async loadFromPath(kbPath) {
    const resolvedPath = path.resolve(kbPath);
    const configPath = path.join(resolvedPath, '.fina', 'config.json');
    if (await fs.pathExists(configPath)) {
      this.configPath = configPath;
      const storedConfig = await fs.readJson(configPath);
      this.config = { ...this.config, ...storedConfig };
    }
    return this;
  }

  get(key) {
    return this.config[key];
  }

  getApiKey() {
    if (this.get('apiKey')) return this.get('apiKey');
    if (this.get('type') === 'openai') return process.env.OPENAI_API_KEY;
    return process.env.ANTHROPIC_API_KEY;
  }

  getBaseUrl() {
    if (this.get('baseUrl')) return this.get('baseUrl');
    if (this.get('type') === 'openai') return 'https://api.openai.com/v1';
    return 'https://api.anthropic.com';
  }

  getModel() {
    return this.get('model');
  }

  getType() {
    return this.get('type') || 'anthropic';
  }

  getLanguage() {
    return this.get('language') || 'en';
  }

  getMaxContextTokens() {
    return this.get('maxContextTokens') || 100000;
  }

  getRawDir() {
    return path.join(this.getKnowledgeBaseDir(), 'raw');
  }

  getWikiDir() {
    return path.join(this.getKnowledgeBaseDir(), 'wiki');
  }

  getKnowledgeBaseDir() {
    if (this.configPath) {
      return path.dirname(path.dirname(this.configPath));
    }
    return process.cwd();
  }

  async ensureConfigured() {
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

module.exports = { ConfigManager };
