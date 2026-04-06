export interface Config {
  type: 'anthropic' | 'openai';
  apiKey: string;
  baseUrl: string;
  model: string;
  language: string;
  maxContextTokens: number;
}

export interface Source {
  id: string;
  path: string;
  type: 'article' | 'code';
  title: string;
  content: string;
  summary: string;
  concepts: string[];
  backlinks: string[];
  source: string;
  compressedContent?: string;
}

export interface IndexedSource {
  id: string;
  title: string;
  type: 'article' | 'code';
  summary: string;
  concepts: string[];
  backlinks: string[];
}

export interface Concept {
  term: string;
  definition?: string;
  sources: string[];
  relatedConcepts: string[];
}

export interface Skill {
  name: string;
  version: string;
  description: string;
  trigger: string;
  patterns: string[];
  instructions: string;
  extract?: {
    title?: string;
    content?: string;
    author?: string;
    exclude?: string[];
  };
}
