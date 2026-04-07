import * as fs from 'fs-extra';
import * as path from 'path';
import axios from 'axios';
import chalk from 'chalk';
import { SkillManager } from '../lib/skills';
import { Extractor } from '../lib/extractor';
import { LLMClient } from '../lib/llm';
import { ConfigManager } from '../lib/config';
import { Skill } from '../types';
import { generateId } from '../lib/utils';

export class AddCommand {
  private config: ConfigManager;
  private skillManager: SkillManager | null;

  constructor(config: ConfigManager, skillManager: SkillManager | null = null) {
    this.config = config;
    this.skillManager = skillManager;
  }

  async execute(source: string, isDirectory: boolean = false): Promise<void> {
    console.log(chalk.cyan(`Adding: ${source}`));

    if (source.startsWith('http://') || source.startsWith('https://')) {
      await this.addFromUrl(source);
    } else if (isDirectory) {
      await this.addFromDirectory(source);
    } else {
      await this.addFromFile(source, false);
    }
  }

  async addFromUrl(url: string): Promise<void> {
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

      const { title, content, author } = Extractor.extract(response.data, skill ?? undefined);

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
id: ${generateId()}
source: ${url}
title: ${title}
author: ${author}
type: article
---

`;
      await fs.writeFile(filePath, frontmatter + cleanedContent);

      console.log(chalk.green(`✓ Saved to: ${path.relative(process.cwd(), filePath)}`));
      console.log(chalk.gray(`  Title: ${title}`));

    } catch (err) {
      console.log(chalk.red(`Failed to fetch URL: ${(err as Error).message}`));
    }
  }

  async cleanContent(content: string, skill: Skill | null = null): Promise<string> {
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
      { role: 'user' as const, content: `Clean the following web content:\n\n${content}` }
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

  async addFromFile(filePath: string, useTimestampDir: boolean = true): Promise<void> {
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
      let targetDir: string;

      // Determine target directory based on extension
      if (['.md', '.txt', '.html'].includes(ext)) {
        targetDir = path.join(rawDir, 'articles');
      } else if (['.js', '.ts', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.rb', '.php'].includes(ext)) {
        targetDir = path.join(rawDir, 'code');
      } else if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'].includes(ext)) {
        targetDir = path.join(rawDir, 'images');
      } else {
        targetDir = path.join(rawDir, 'articles');
      }

      // Use flat structure for batch-add (no timestamp subdirectory)
      let destPath: string;
      if (useTimestampDir) {
        const timestamp = Date.now();
        const dir = path.join(targetDir, String(timestamp));
        destPath = path.join(dir, path.basename(resolvedPath));
      } else {
        destPath = path.join(targetDir, path.basename(resolvedPath));
      }

      // Validate destination is within KB
      this.config.validateWrite(destPath);

      if (useTimestampDir) {
        const timestamp = Date.now();
        const dir = path.join(targetDir, String(timestamp));
        await fs.ensureDir(dir);
      } else {
        await fs.ensureDir(targetDir);
      }
      await fs.copy(resolvedPath, destPath);

      console.log(chalk.green(`✓ Copied to: ${path.relative(process.cwd(), destPath)}`));
      console.log(chalk.gray(`  Size: ${(stats.size / 1024).toFixed(1)} KB`));
      console.log(chalk.gray(`  Type: ${ext || 'unknown'}`));

    } catch (err) {
      console.log(chalk.red(`Failed to copy file: ${(err as Error).message}`));
    }
  }

  async addFromDirectory(dirPath: string): Promise<void> {
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

      // Use single timestamp for all files in batch
      const timestamp = Date.now();

      // First, collect all images referenced in markdown files
      const imageMap = new Map<string, string>(); // originalPath -> newPath
      for (const file of files) {
        if (file.endsWith('.md') || file.endsWith('.markdown')) {
          const content = await fs.readFile(file, 'utf-8');
          const imagePaths = this.extractImagePaths(content);
          for (const imgPath of imagePaths) {
            if (!imgPath.startsWith('http://') && !imgPath.startsWith('https://')) {
              // Resolve relative to the markdown file
              const imgFullPath = path.resolve(path.dirname(file), imgPath);
              if (await fs.pathExists(imgFullPath)) {
                imageMap.set(imgFullPath, imgPath);
              }
            }
          }
        }
      }

      // Copy all referenced images first
      const imagesDir = path.join(this.config.getRawDir(), 'images', String(timestamp));
      await fs.ensureDir(imagesDir);
      for (const [imgFullPath] of imageMap) {
        const imgFileName = path.basename(imgFullPath);
        const destPath = path.join(imagesDir, imgFileName);
        await fs.copy(imgFullPath, destPath);
        imageMap.set(imgFullPath, `../images/${timestamp}/${imgFileName}`);
      }

      // Copy all files, updating markdown image paths
      for (const file of files) {
        await this.copyFileInBatch(file, timestamp, imageMap);
      }

      console.log(chalk.green(`\n✓ Added ${files.length} files`));
      if (imageMap.size > 0) {
        console.log(chalk.gray(`  + ${imageMap.size} images referenced in markdown`));
      }
    } catch (err) {
      console.log(chalk.red(`Failed to add directory: ${(err as Error).message}`));
    }
  }

  private async copyFileInBatch(filePath: string, timestamp: number, imageMap?: Map<string, string>): Promise<void> {
    try {
      const resolvedPath = path.resolve(filePath);
      const rawDir = this.config.getRawDir();
      const ext = path.extname(resolvedPath).toLowerCase();
      let targetDir: string;
      let content: string | null = null;

      if (['.md', '.txt', '.html'].includes(ext)) {
        targetDir = path.join(rawDir, 'articles', String(timestamp));
      } else if (['.js', '.ts', '.py', '.go', '.rs', '.java', '.cpp', '.c', '.rb', '.php'].includes(ext)) {
        targetDir = path.join(rawDir, 'code', String(timestamp));
      } else if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'].includes(ext)) {
        targetDir = path.join(rawDir, 'images', String(timestamp));
      } else {
        targetDir = path.join(rawDir, 'articles', String(timestamp));
      }

      await fs.ensureDir(targetDir);
      const destPath = path.join(targetDir, path.basename(resolvedPath));

      // For markdown files, update image paths
      if (['.md', '.markdown'].includes(ext) && imageMap && imageMap.size > 0) {
        content = await fs.readFile(resolvedPath, 'utf-8');
        // Update image paths: originalRelativePath -> newRelativePath
        for (const [imgFullPath, newPath] of imageMap) {
          const imgBasename = path.basename(imgFullPath);
          // Match any reference to this image (with various path patterns)
          const regex = new RegExp(`!\\[([^\\]]*)\\]\\(([^)]*${imgBasename}[^)]*)\\)`, 'g');
          content = content.replace(regex, (match, alt, oldPath) => {
            return `![${alt}](${newPath})`;
          });
        }
        await fs.writeFile(destPath, content);
      } else {
        await fs.copy(resolvedPath, destPath);
      }

      console.log(chalk.gray(`  + ${path.basename(resolvedPath)}`));
    } catch (err) {
      console.log(chalk.red(`Failed to copy ${filePath}: ${(err as Error).message}`));
    }
  }

  private extractImagePaths(content: string): string[] {
    const paths: string[] = [];
    const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      paths.push(match[2]);
    }
    return paths;
  }

  async collectFiles(dir: string): Promise<string[]> {
    const supportedExtensions = [
      // Documents
      '.md', '.markdown', '.txt', '.json', '.jsonc', '.toml', '.yaml', '.yml', '.xml',
      // Code files
      '.js', '.ts', '.java', '.py', '.go', '.rs',
      // Images
      '.jpg', '.jpeg', '.png', '.img'
    ];
    const files: string[] = [];

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
