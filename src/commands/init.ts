import * as fs from 'fs-extra';
import * as path from 'path';
import { fileURLToPath } from 'url';
import picocolors from 'picocolors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class InitCommand {
  async execute(targetPath: string): Promise<void> {
    const resolvedPath = path.resolve(targetPath);
    const finaDir = path.join(resolvedPath, '.fina');
    const configPath = path.join(finaDir, 'config.json');

    if (await fs.pathExists(configPath)) {
      console.log(picocolors.yellow(`Already initialized: ${resolvedPath}`));
      return;
    }

    if (!(await fs.pathExists(resolvedPath))) {
      await fs.ensureDir(resolvedPath);
    }

    await fs.ensureDir(finaDir);
    await fs.ensureDir(path.join(finaDir, 'skills'));

    const defaultSkillsDir = path.join(__dirname, '..', 'defaults', 'skills');
    if (await fs.pathExists(defaultSkillsDir)) {
      await fs.copy(defaultSkillsDir, path.join(finaDir, 'skills'));
    }

    await fs.ensureDir(path.join(resolvedPath, 'raw', 'articles'));
    await fs.ensureDir(path.join(resolvedPath, 'raw', 'code'));
    await fs.ensureDir(path.join(resolvedPath, 'raw', 'images'));
    await fs.ensureDir(path.join(resolvedPath, 'wiki', 'concepts'));
    await fs.ensureDir(path.join(resolvedPath, 'wiki', 'summaries'));

    const defaultConfig = {
      type: 'anthropic',
      apiKey: '',
      baseUrl: '',
      model: '',
      language: 'en',
      maxContextTokens: 100000
    };

    await fs.writeJson(configPath, defaultConfig, { spaces: 2 });

    console.log(picocolors.green(`✓ Initialized Fina knowledge base at: ${resolvedPath}`));
    console.log(picocolors.gray(`  Config: ${configPath}`));
    console.log(picocolors.gray('\nEdit the config file to add your API key.'));
  }
}