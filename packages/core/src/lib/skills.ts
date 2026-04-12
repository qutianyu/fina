import * as fs from 'fs-extra';
import * as path from 'path';
import { yellow } from 'picocolors';
import matter from 'gray-matter';
import { Skill } from '../types';

export class SkillManager {
  private skills: Skill[] = [];
  private loaded: boolean = false;

  async loadSkills(kbDir: string): Promise<this> {
    if (this.loaded) return this;

    const skillsDir = path.join(kbDir, '.fina', 'skills');
    if (!(await fs.pathExists(skillsDir))) {
      this.loaded = true;
      return this;
    }

    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(skillsDir, entry.name, 'SKILL.md');
      if (await fs.pathExists(fullPath)) {
        await this.loadSkillFile(fullPath);
      }
    }

    this.loaded = true;
    return this;
  }

  private async loadSkillFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = matter(content);
      if (!parsed.data.name) return;

      const patterns = this.extractPatterns(parsed.data.description || '');

      this.skills.push({
        name: parsed.data.name,
        version: parsed.data.version || '1.0',
        description: parsed.data.description || '',
        trigger: parsed.data.trigger || 'automatic',
        patterns,
        instructions: parsed.content.trim()
      });
    } catch (err) {
      // Skip invalid skill files
      console.log(yellow(`  Skipping invalid skill file: ${filePath}`));
    }
  }

  private extractPatterns(description: string): string[] {
    const patterns: string[] = [];
    const urlPatternRegex = /(?:URL[\s:：匹配]+|[\s\(\[])(https?:\/\/\S+|\*:\/\/\S+)/gi;
    let match;
    while ((match = urlPatternRegex.exec(description)) !== null) {
      patterns.push(match[1]);
    }
    const domainPatternRegex = /(?:[\s\(\[]|URL[\s:：匹配]+)([\w\.\-]+\/\*)/gi;
    while ((match = domainPatternRegex.exec(description)) !== null) {
      patterns.push(match[1]);
    }
    return [...new Set(patterns)];
  }

  matchSkill(url: string): Skill | null {
    for (const skill of this.skills) {
      for (const pattern of skill.patterns) {
        if (this.matchPattern(pattern, url)) {
          return skill;
        }
      }
    }
    return null;
  }

  private matchPattern(pattern: string, url: string): boolean {
    if (pattern.includes('*')) {
      const regex = this.globToRegex(pattern);
      return regex.test(url);
    }
    return url.includes(pattern);
  }

  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+?${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '<<<DOUBLE_STAR>>>')
      .replace(/\*/g, '<<<STAR>>>');

    const isUrlPattern = pattern.startsWith('http') && pattern.endsWith('*');

    let result = escaped
      .replace(/<<<DOUBLE_STAR>>>/g, '.*')
      .replace(/<<<STAR>>>/g, isUrlPattern ? '.*' : '[^/]*');

    return new RegExp(`^${result}$`, 'i');
  }
}
