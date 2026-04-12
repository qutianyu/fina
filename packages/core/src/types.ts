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
  backlinks?: string[];
}

export interface Relationship {
  source: string;
  target: string;
  context?: string;
}

export interface WikiIndex {
  version: string;
  generated: string;
  stats: {
    totalArticles: number;
    totalConcepts: number;
    totalRelationships: number;
  };
  recentChanges: Array<{
    date: string;
    type: 'added' | 'updated' | 'deleted';
    page: string;
  }>;
}

export interface ChangeLog {
  timestamp: string;
  action: string;
  files: {
    added: string[];
    updated: string[];
    deleted: string[];
  };
  relationships: Array<[string, string]>;
  sourceFiles: string[];
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

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Session {
  id: string;
  name: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
