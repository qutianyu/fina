import * as cheerio from 'cheerio';
import { Skill } from '../types';

export interface ExtractedContent {
  title: string;
  content: string;
  author: string;
}

export class Extractor {
  static extract(html: string, skill?: Skill): ExtractedContent {
    if (skill && skill.extract) {
      return Extractor.extractWithSkill(html, skill.extract);
    }
    return Extractor.extractDefault(html);
  }

  static extractDefault(html: string): ExtractedContent {
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer, aside, noscript').remove();

    const title = $('title').text().trim() ||
                  $('h1').first().text().trim() ||
                  'Untitled';

    const article = $('article').html() ||
                   $('main').html() ||
                   $('.content').html() ||
                   $('body').html();

    return {
      title,
      content: article ? Extractor.htmlToMarkdown(cheerio.load(article)) : '',
      author: ''
    };
  }

  static extractWithSkill(html: string, extract: NonNullable<Skill['extract']>): ExtractedContent {
    const $ = cheerio.load(html);

    const excludeSelectors = extract.exclude || [];
    for (const sel of excludeSelectors) {
      $(sel).remove();
    }
    $('script, style, nav, header, footer, aside, noscript').remove();

    let title = 'Untitled';
    if (extract.title) {
      title = $(extract.title).first().text().trim() || title;
    }

    let content = '';
    if (extract.content) {
      const contentEl = $(extract.content).first();
      if (contentEl.length) {
        content = Extractor.htmlToMarkdown(cheerio.load(contentEl.html() || ''));
      }
    }

    let author = '';
    if (extract.author) {
      author = $(extract.author).first().text().trim() || '';
    }

    return { title, content, author };
  }

  static htmlToMarkdown($: cheerio.CheerioAPI): string {
    const blocks: string[] = [];

    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      const level = el.tagName[1];
      const text = $(el).text().trim();
      if (text) {
        blocks.push(`${'#'.repeat(parseInt(level))} ${text}`);
      }
    });

    $('p').each((_, el) => {
      const text = $(el).text().trim();
      if (text) {
        blocks.push(text);
      }
    });

    $('ul, ol').each((_, el) => {
      const isOrdered = el.tagName === 'ol';
      $(el).find('li').each((i, li) => {
        const prefix = isOrdered ? `${i + 1}.` : '-';
        blocks.push(`${prefix} ${$(li).text().trim()}`);
      });
    });

    $('pre, pre code').each((_, el) => {
      const code = $(el).text().trim();
      if (code) {
        blocks.push(`\`\`\`\n${code}\n\`\`\``);
      }
    });

    $('blockquote').each((_, el) => {
      const text = $(el).text().trim();
      if (text) {
        blocks.push(`> ${text}`);
      }
    });

    $('img').each((_, el) => {
      const alt = $(el).attr('alt') || '';
      const src = $(el).attr('src') || '';
      if (src) {
        blocks.push(`![${alt}](${src})`);
      }
    });

    return blocks.join('\n\n');
  }
}
