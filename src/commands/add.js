const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const chalk = require('chalk');
const { SkillManager } = require('../lib/skills.js');
const { Extractor } = require('../lib/extractor.js');
const { LLMClient } = require('../lib/llm.js');

class AddCommand {
  constructor(config, skillManager = null) {
    this.config = config;
    this.skillManager = skillManager;
  }

  async execute(source, isDirectory = false) {
    console.log(chalk.cyan(`Adding: ${source}`));

    if (source.startsWith('http://') || source.startsWith('https://')) {
      await this.addFromUrl(source);
    } else if (isDirectory) {
      await this.addFromDirectory(source);
    } else {
      await this.addFromFile(source);
    }
  }

  async addFromUrl(url) {
    try {
      console.log(chalk.gray('Fetching webpage...'));
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
      });

      // Check for matching skill
      const skill = this.skillManager ? this.skillManager.matchSkill(url) : null;
      if (skill) {
        console.log(chalk.gray(`  Using skill: ${skill.name}`));
      }

      const { title, content, author } = Extractor.extract(response.data, skill);

      if (!content) {
        console.log(chalk.red('Failed to extract content from page'));
        return;
      }

      // Clean content using LLM
      console.log(chalk.gray('Cleaning content with AI...'));
      const cleanedContent = await this.cleanContent(content, skill);

      // Generate filename
      const slug = title.toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 50);
      const timestamp = Date.now();
      const rawDir = this.config.getRawDir();
      const articleDir = path.join(rawDir, 'articles', String(timestamp));
      await fs.ensureDir(articleDir);
      const filePath = path.join(articleDir, `${slug}.md`);

      // Write with frontmatter
      const frontmatter = `---
id: ${this.generateId()}
source: ${url}
title: ${title}
author: ${author}
addedAt: ${new Date().toISOString()}
type: article
---

`;
      await fs.writeFile(filePath, frontmatter + cleanedContent);

      console.log(chalk.green(`✓ Saved to: ${path.relative(process.cwd(), filePath)}`));
      console.log(chalk.gray(`  Title: ${title}`));

    } catch (err) {
      console.log(chalk.red(`Failed to fetch URL: ${err.message}`));
    }
  }

  async cleanContent(content, skill = null) {
    if (!(await this.config.ensureConfigured())) {
      // Fallback to original content if not configured
      return content;
    }

    const llm = new LLMClient(this.config);

    let systemPrompt = `You are a content cleaning assistant. Your task is to clean extracted web content by:
1. Removing ads, promotional content, and noise
2. Removing navigation elements, footers, and unrelated content
3. Fixing formatting issues
4. Preserving the main content and structure
5. Keeping markdown formatting intact

Output ONLY the cleaned content, nothing else. Do not add explanations or notes.`;

    // If skill has instructions, add them to the prompt
    if (skill && skill.instructions) {
      systemPrompt += `\n\nSkill-specific instructions for this content:\n${skill.instructions}`;
    }

    const messages = [
      { role: 'user', content: `Clean the following web content:\n\n${content}` }
    ];

    const result = await llm.createMessage({
      model: this.config.getModel(),
      max_tokens: 8192,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ]
    });

    let cleanedContent = result.content[0]?.text || content;
    // Strip any thinking tags if present
    cleanedContent = cleanedContent.replace(/<think>/g, '').replace(/<\/think>/g, '').trim();

    return cleanedContent;
  }

  generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async addFromFile(filePath) {
    try {
      // Expand ~ to home directory
      if (filePath.startsWith('~/')) {
        filePath = path.join(process.env.HOME || '', filePath.slice(2));
      }
      const resolvedPath = path.resolve(filePath);

      if (!await fs.pathExists(resolvedPath)) {
        console.log(chalk.red(`File not found: ${filePath}`));
        return;
      }

      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        console.log(chalk.red(`Not a file: ${filePath}`));
        return;
      }

      const rawDir = this.config.getRawDir();
      const ext = path.extname(resolvedPath).toLowerCase();
      let targetDir;

      // Determine target directory based on extension
      if (['.md', '.txt', '.html'].includes(ext)) {
        targetDir = path.join(rawDir, 'articles');
      } else if (['.js', '.ts', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.rb', '.php'].includes(ext)) {
        targetDir = path.join(rawDir, 'code');
      } else if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'].includes(ext)) {
        targetDir = path.join(rawDir, 'images');
      } else {
        targetDir = path.join(rawDir, 'documents');
      }

      const timestamp = Date.now();
      const dir = path.join(targetDir, String(timestamp));
      await fs.ensureDir(dir);
      const destPath = path.join(dir, path.basename(resolvedPath));
      await fs.copy(resolvedPath, destPath);

      console.log(chalk.green(`✓ Copied to: ${path.relative(process.cwd(), destPath)}`));
      console.log(chalk.gray(`  Size: ${(stats.size / 1024).toFixed(1)} KB`));
      console.log(chalk.gray(`  Type: ${ext || 'unknown'}`));

    } catch (err) {
      console.log(chalk.red(`Failed to copy file: ${err.message}`));
    }
  }

  async addFromDirectory(dirPath) {
    try {
      if (dirPath.startsWith('~/')) {
        dirPath = path.join(process.env.HOME || '', dirPath.slice(2));
      }
      const resolvedPath = path.resolve(dirPath);

      if (!await fs.pathExists(resolvedPath)) {
        console.log(chalk.red(`Directory not found: ${dirPath}`));
        return;
      }

      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        console.log(chalk.red(`Not a directory: ${dirPath}`));
        return;
      }

      // Recursively collect all supported files
      const files = await this.collectFiles(resolvedPath);

      if (files.length === 0) {
        console.log(chalk.yellow(`No supported files found in: ${dirPath}`));
        return;
      }

      console.log(chalk.cyan(`Adding ${files.length} files from: ${dirPath}\n`));

      for (const file of files) {
        await this.addFromFile(file);
      }

      console.log(chalk.green(`\n✓ Added ${files.length} files`));
    } catch (err) {
      console.log(chalk.red(`Failed to add directory: ${err.message}`));
    }
  }

  async collectFiles(dir) {
    const supportedExtensions = [
      // Documents
      '.md', '.markdown', '.txt', '.json', '.jsonc', '.toml', '.yaml', '.yml', '.xml',
      // Code files
      '.js', '.ts', '.java', '.py', '.go', '.rs',
      // Images
      '.jpg', '.jpeg', '.png', '.img'
    ];
    const files = [];

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and common non-content directories
        if (!entry.name.startsWith('.') && !['node_modules', 'venv', '__pycache__'].includes(entry.name)) {
          const subFiles = await this.collectFiles(fullPath);
          files.push(...subFiles);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (supportedExtensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }
}

module.exports = { AddCommand };
