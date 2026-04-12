import * as fs from 'fs-extra';
import * as path from 'path';
import picocolors from 'picocolors';
import matter from 'gray-matter';
import { ConfigManager } from '../lib/config';
import { LLMClient } from '../lib/llm';

export interface LintIssue {
  type: 'orphan' | 'dangling' | 'contradiction' | 'stale' | 'missing-link';
  severity: 'error' | 'warning' | 'info';
  file: string;
  message: string;
  suggestion?: string;
}

export class LintCommand {
  private config: ConfigManager;
  private issues: LintIssue[] = [];

  constructor(config: ConfigManager) {
    this.config = config;
  }

  async execute(): Promise<void> {
    const wikiDir = this.config.getWikiDir();

    console.log(picocolors.cyan('\n🩺 Running knowledge base health check...\n'));

    // Validate wiki directory exists
    if (!await fs.pathExists(wikiDir)) {
      console.log(picocolors.yellow('⚠ Wiki directory does not exist. Run /make first.'));
      return;
    }

    // 1. Check orphaned pages
    console.log(picocolors.gray('  Checking for orphaned pages...'));
    this.issues.push(...await this.findOrphanedPages(wikiDir));

    // 2. Check dangling references
    console.log(picocolors.gray('  Checking for dangling references...'));
    this.issues.push(...await this.findDanglingReferences(wikiDir));

    // 3. Check contradictions
    console.log(picocolors.gray('  Checking for contradictions...'));
    this.issues.push(...await this.findContradictions(wikiDir));

    // 4. Check stale content
    console.log(picocolors.gray('  Checking for stale content...'));
    this.issues.push(...await this.findStaleContent(wikiDir));

    // 5. Check missing links
    console.log(picocolors.gray('  Checking for missing links...'));
    this.issues.push(...await this.findMissingLinks(wikiDir));

    // Output report
    this.printReport();

    if (this.issues.length === 0) {
      console.log(picocolors.green('\n✅ Knowledge base looks healthy!'));
    } else {
      console.log(picocolors.gray(`\nTotal issues: ${this.issues.length}`));
    }
  }

  private async findOrphanedPages(wikiDir: string): Promise<LintIssue[]> {
    const issues: LintIssue[] = [];
    const summariesDir = path.join(wikiDir, 'summaries');
    const conceptsDir = path.join(wikiDir, 'concepts');

    if (!await fs.pathExists(summariesDir) && !await fs.pathExists(conceptsDir)) {
      return issues;
    }

    // Check summaries: report if they have no relatedConcepts (no concepts extracted)
    if (await fs.pathExists(summariesDir)) {
      const typeDirs = await fs.readdir(summariesDir);
      for (const typeDir of typeDirs) {
        const typePath = path.join(summariesDir, typeDir);
        const stat = await fs.stat(typePath);
        if (stat.isDirectory()) {
          for (const file of await fs.readdir(typePath)) {
            if (!file.endsWith('.md')) continue;
            const filePath = path.join(typePath, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const { data } = matter(content);
            const relatedConcepts = this.parseListField(data?.concepts);

            if (relatedConcepts.length === 0) {
              issues.push({
                type: 'orphan',
                severity: 'warning',
                file: `summaries/${typeDir}/${file}`,
                message: 'This article has no related concepts extracted',
                suggestion: 'Run /make to re-process and extract concepts from this article'
              });
            }
          }
        }
      }
    }

    // Check concepts: report if they have no backlinks (no other concept references it)
    if (await fs.pathExists(conceptsDir)) {
      for (const file of await fs.readdir(conceptsDir)) {
        if (!file.endsWith('.md')) continue;
        const filePath = path.join(conceptsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const { data } = matter(content);
        const backlinks = this.parseListField(data?.backlinks);

        if (backlinks.length === 0) {
          issues.push({
            type: 'orphan',
            severity: 'warning',
            file: `concepts/${file}`,
            message: 'This concept has no backlinks (no other concept references it)',
            suggestion: 'Consider linking this concept from related content or delete if irrelevant'
          });
        }
      }
    }

    return issues;
  }

  private async findDanglingReferences(wikiDir: string): Promise<LintIssue[]> {
    const issues: LintIssue[] = [];
    const conceptsDir = path.join(wikiDir, 'concepts');

    if (!await fs.pathExists(conceptsDir)) {
      return issues;
    }

    // Collect all existing concepts
    const existingConcepts = new Set<string>();
    for (const file of await fs.readdir(conceptsDir)) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(conceptsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const { data } = matter(content);
      const term = data?.term as string;
      if (term) {
        existingConcepts.add(term.toLowerCase());
      }
    }

    // Check each concept's relatedConcepts
    for (const file of await fs.readdir(conceptsDir)) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(conceptsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const { data } = matter(content);
      const relatedConcepts = this.parseListField(data?.relatedConcepts);

      for (const related of relatedConcepts) {
        if (!existingConcepts.has(related.toLowerCase())) {
          issues.push({
            type: 'dangling',
            severity: 'error',
            file: `concepts/${file}`,
            message: `References non-existent concept: "${related}"`,
            suggestion: `Either create a concept page for "${related}" or remove this reference`
          });
        }
      }
    }

    return issues;
  }

  private async findContradictions(wikiDir: string): Promise<LintIssue[]> {
    const issues: LintIssue[] = [];
    const conceptsDir = path.join(wikiDir, 'concepts');

    if (!await fs.pathExists(conceptsDir)) {
      return issues;
    }

    // Collect all concept definitions
    const concepts: Array<{ term: string; definition: string; file: string }> = [];
    for (const file of await fs.readdir(conceptsDir)) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(conceptsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const { data, content: body } = matter(content);
      const term = data?.term as string || file.replace('.md', '');
      const definition = body?.trim() || (data?.definition as string) || '';
      if (definition) {
        concepts.push({ term, definition, file: `concepts/${file}` });
      }
    }

    if (concepts.length < 2) {
      return issues; // Need at least 2 concepts to compare
    }

    // Build prompt for LLM to check contradictions
    const conceptsText = concepts
      .map(c => `- **${c.term}**: ${c.definition.substring(0, 200)}`)
      .join('\n');

    const prompt = `Analyze these concept definitions for contradictions or conflicting information:

${conceptsText}

Check if any concepts have conflicting definitions or mutually exclusive properties.
Report any contradictions found in this format:
CONTRADICTION: [Concept A] vs [Concept B] - [Brief explanation]

If no contradictions found, respond with: NONE`;

    try {
      if (!await this.config.ensureConfigured()) {
        console.log(picocolors.yellow('  ⚠ LLM not configured, skipping contradiction check'));
        return issues;
      }

      const client = new LLMClient(this.config);
      const response = await client.createMessage({
        model: this.config.getModel(),
        max_tokens: 1000,
        messages: [
          { role: 'system', content: 'You are a knowledge base quality checker.' },
          { role: 'user', content: prompt }
        ]
      });

      const result = response.content[0]?.text || '';

      if (!result.includes('NONE')) {
        // Parse contradiction results
        const contradictionMatches = result.matchAll(/CONTRADICTION:\s*(.+?)\s*vs\s*(.+?)\s*-\s*(.+)/gi);
        for (const match of contradictionMatches) {
          issues.push({
            type: 'contradiction',
            severity: 'error',
            file: 'multiple',
            message: `Contradiction between "${match[1]}" and "${match[2]}": ${match[3]}`,
            suggestion: 'Review both concept definitions and resolve the conflict'
          });
        }
      }
    } catch (err) {
      console.log(picocolors.yellow(`  ⚠ LLM contradiction check failed: ${(err as Error).message}`));
    }

    return issues;
  }

  private async findStaleContent(wikiDir: string, maxAgeDays: number = 30): Promise<LintIssue[]> {
    const issues: LintIssue[] = [];
    const summariesDir = path.join(wikiDir, 'summaries');
    const conceptsDir = path.join(wikiDir, 'concepts');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    // Check summaries
    if (await fs.pathExists(summariesDir)) {
      const typeDirs = await fs.readdir(summariesDir);
      for (const typeDir of typeDirs) {
        const typePath = path.join(summariesDir, typeDir);
        const stat = await fs.stat(typePath);
        if (stat.isDirectory()) {
          for (const file of await fs.readdir(typePath)) {
            if (!file.endsWith('.md')) continue;
            const filePath = path.join(typePath, file);
            const stats = await fs.stat(filePath);
            const updated = new Date(stats.mtime);

            if (updated < cutoffDate) {
              const content = await fs.readFile(filePath, 'utf-8');
              const { data } = matter(content);
              const daysSinceUpdate = Math.floor((Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24));
              issues.push({
                type: 'stale',
                severity: 'warning',
                file: `summaries/${typeDir}/${file}`,
                message: `Not updated in ${daysSinceUpdate} days (last: ${updated.toLocaleDateString()})`,
                suggestion: `Consider reviewing and updating: ${data?.title || file}`
              });
            }
          }
        }
      }
    }

    // Check concepts
    if (await fs.pathExists(conceptsDir)) {
      for (const file of await fs.readdir(conceptsDir)) {
        if (!file.endsWith('.md')) continue;
        const filePath = path.join(conceptsDir, file);
        const stats = await fs.stat(filePath);
        const updated = new Date(stats.mtime);

        if (updated < cutoffDate) {
          const content = await fs.readFile(filePath, 'utf-8');
          const { data } = matter(content);
          const daysSinceUpdate = Math.floor((Date.now() - updated.getTime()) / (1000 * 60 * 60 * 24));
          issues.push({
            type: 'stale',
            severity: 'warning',
            file: `concepts/${file}`,
            message: `Not updated in ${daysSinceUpdate} days (last: ${updated.toLocaleDateString()})`,
            suggestion: `Consider reviewing concept: ${data?.term || file.replace('.md', '')}`
          });
        }
      }
    }

    return issues;
  }

  private async findMissingLinks(wikiDir: string): Promise<LintIssue[]> {
    const issues: LintIssue[] = [];
    const conceptsIndexPath = path.join(wikiDir, 'concepts-index.json');

    if (!await fs.pathExists(conceptsIndexPath)) {
      return issues;
    }

    // Read concepts index
    const conceptsIndex = await fs.readJson(conceptsIndexPath);
    const concepts = conceptsIndex.concepts || [];
    const relationships = new Set(
      (conceptsIndex.relationships || []).map((r: string[]) => `${r[0]}|${r[1]}`)
    );

    // Find potentially related but not-linked concepts
    for (const concept of concepts) {
      const termWords = (concept.term || '').toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);

      for (const other of concepts) {
        if (concept.term === other.term) continue;

        const otherLower = (other.term || '').toLowerCase();
        const otherWords = otherLower.split(/\s+/).filter((w: string) => w.length > 3);

        // Find common words
        const commonWords = termWords.filter((w: string) => otherWords.includes(w));

        // If there are common significant words but no link
        const hasRelationship = relationships.has(`${concept.term}|${other.term}`) ||
          relationships.has(`${other.term}|${concept.term}`);

        if (commonWords.length > 0 && !hasRelationship) {
          issues.push({
            type: 'missing-link',
            severity: 'info',
            file: `concepts/${this.slugify(concept.term)}.md`,
            message: `"${concept.term}" and "${other.term}" may be related (common terms: ${commonWords.join(', ')})`,
            suggestion: `Consider adding a link between these related concepts`
          });
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    return issues.filter(issue => {
      const key = `${issue.type}|${issue.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private parseListField(field: unknown): string[] {
    if (!field) return [];
    if (Array.isArray(field)) return field.map(String);
    if (typeof field === 'string') {
      return field.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
    }
    return [];
  }

  private slugify(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private printReport(): void {
    if (this.issues.length === 0) {
      return;
    }

    // Group by severity
    const errors = this.issues.filter(i => i.severity === 'error');
    const warnings = this.issues.filter(i => i.severity === 'warning');
    const infos = this.issues.filter(i => i.severity === 'info');

    if (errors.length > 0) {
      console.log(picocolors.red(`\n🔴 Errors: ${errors.length}`));
      // Group dangling references by target concept
      const danglingByTarget = new Map<string, string[]>();
      for (const issue of errors) {
        if (issue.type === 'dangling') {
          const match = issue.message.match(/non-existent concept: "(.+)"/);
          if (match) {
            const target = match[1];
            if (!danglingByTarget.has(target)) {
              danglingByTarget.set(target, []);
            }
            danglingByTarget.get(target)!.push(issue.file);
          }
        }
      }
      // Simplify: only show unique dangling concepts
      const uniqueDangling = [...danglingByTarget.keys()];
      if (uniqueDangling.length > 0) {
        console.log(picocolors.gray(`  Missing concepts: ${uniqueDangling.join(', ')}`));
      }
    }

    if (warnings.length > 0) {
      console.log(picocolors.yellow(`\n🟡 Warnings: ${warnings.length}`));
      // Group orphan issues by type
      const orphanFiles = warnings.filter(i => i.type === 'orphan').map(i => i.file);
      if (orphanFiles.length > 0) {
        console.log(picocolors.gray(`  Orphan pages: ${orphanFiles.length}`));
      }
    }

    if (infos.length > 0) {
      console.log(picocolors.blue(`\n🔵 Suggestions: ${infos.length}`));
    }

    console.log();
  }
}
