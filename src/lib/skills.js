const fs = require('fs-extra');
const path = require('path');
const matter = require('gray-matter');

class SkillManager {
  constructor() {
    this.skills = [];
    this.loaded = false;
  }

  async loadSkills(kbDir) {
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

  async loadSkillFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = matter(content);
      if (!parsed.data.name) return;

      // Extract patterns from description (Claude Code compatible)
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
    }
  }

  extractPatterns(description) {
    const patterns = [];
    // Match URL patterns: https://mp.weixin.qq.com/* or *://example.com/*
    const urlPatternRegex = /(?:URL[\s:：匹配]+|[\s\(\[])(https?:\/\/\S+|\*:\/\/\S+)/gi;
    let match;
    while ((match = urlPatternRegex.exec(description)) !== null) {
      patterns.push(match[1]);
    }
    // Match domain patterns: mp.weixin.qq.com/* or *://example.com/*
    const domainPatternRegex = /(?:[\s\(\[]|URL[\s:：匹配]+)([\w\.\-]+\/\*)/gi;
    while ((match = domainPatternRegex.exec(description)) !== null) {
      patterns.push(match[1]);
    }
    return [...new Set(patterns)]; // deduplicate
  }

  matchSkill(url) {
    for (const skill of this.skills) {
      for (const pattern of skill.patterns) {
        if (this.matchPattern(pattern, url)) {
          return skill;
        }
      }
    }
    return null;
  }

  matchPattern(pattern, url) {
    // If pattern is a full URL or contains wildcards
    if (pattern.includes('*')) {
      const regex = this.globToRegex(pattern);
      return regex.test(url);
    }
    // Otherwise do substring match
    return url.includes(pattern);
  }

  globToRegex(pattern) {
    // Escape special regex chars except *
    const escaped = pattern
      .replace(/[.+?${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '<<<DOUBLE_STAR>>>')
      .replace(/\*/g, '<<<STAR>>>');

    // Handle single star at the end of a path segment (match anything after)
    // But "/*" at the end of URL should match everything including slashes
    const isUrlPattern = pattern.startsWith('http') && pattern.endsWith('*');

    let result = escaped
      .replace(/<<<DOUBLE_STAR>>>/g, '.*')
      .replace(/<<<STAR>>>/g, isUrlPattern ? '.*' : '[^/]*');

    return new RegExp(`^${result}$`, 'i');
  }
}

module.exports = { SkillManager };
