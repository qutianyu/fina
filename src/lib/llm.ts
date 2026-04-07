import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai';
import { ConfigManager } from './config';

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | object;
}

export interface LLMResponse {
  content: Array<{ text: string }>;
}

export type StreamingCallback = (text: string) => void;

export class LLMClient {
  private config: ConfigManager;
  private type: string;
  private client: Anthropic | OpenAI;

  constructor(config: ConfigManager) {
    this.config = config;
    this.type = config.getType();
    this.client = this.createClient();
  }

  private createClient(): Anthropic | OpenAI {
    const apiKey = this.config.getApiKey();
    const baseUrl = this.config.getBaseUrl();

    if (this.type === 'openai') {
      return new OpenAI({ apiKey, baseURL: baseUrl });
    }

    return new Anthropic({ apiKey, baseURL: baseUrl });
  }

  async createMessage({ model, max_tokens, messages }: {
    model?: string;
    max_tokens?: number;
    messages: LLMMessage[];
  }): Promise<LLMResponse> {
    if (this.config.debug) {
      console.log('\n========== LLM INPUT ==========');
      for (const msg of messages) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        console.log(`[${msg.role}]`, content.substring(0, 500) + (content.length > 500 ? '...' : ''));
      }
      console.log('===============================\n');
    }

    if (this.type === 'openai') {
      const openAIClient = this.client as OpenAI;
      const response = await openAIClient.chat.completions.create({
        model: model || this.config.getModel(),
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }))
      });
      let content = response.choices[0].message.content;
      if (Array.isArray(content)) {
        const textBlock = content.find((b: any) => b.type === 'text');
        content = textBlock ? textBlock.text : (content[0] as any)?.text || '';
      }
      if (this.config.debug) {
        console.log('\n========== LLM OUTPUT ==========');
        console.log(content || '');
        console.log('===============================\n');
      }
      return { content: [{ text: content || '' }] };
    }

    const anthropicClient = this.client as Anthropic;

    // Separate system messages from user/assistant messages for Anthropic
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');
    const systemContent = systemMessages.map(m =>
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    ).join('\n');

    const result = await anthropicClient.messages.create({
      model: model || this.config.getModel(),
      max_tokens: max_tokens || 4096,
      system: systemContent || undefined,
      messages: otherMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      }))
    });

    if (this.config.debug) {
      console.log('\n========== LLM OUTPUT ==========');
      const textBlock = result.content.find((b: any) => b.type === 'text');
      console.log((textBlock as any)?.text || '');
      console.log('===============================\n');
    }

    const textContent = result.content.find((b: any) => b.type === 'text');
    return { content: [{ text: (textContent as any)?.text || '' }] } as LLMResponse;
  }

  async createMessageStream({ model, max_tokens, messages, onChunk }: {
    model?: string;
    max_tokens?: number;
    messages: LLMMessage[];
    onChunk: StreamingCallback;
  }): Promise<void> {
    if (this.config.debug) {
      console.log('\n========== LLM INPUT ==========');
      for (const msg of messages) {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        console.log(`[${msg.role}]`, content.substring(0, 500) + (content.length > 500 ? '...' : ''));
      }
      console.log('===============================\n');
    }

    if (this.type === 'openai') {
      const openAIClient = this.client as OpenAI;
      const stream = await openAIClient.chat.completions.create({
        model: model || this.config.getModel(),
        max_tokens: max_tokens || 1500,
        stream: true,
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }))
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          onChunk(content);
        }
      }
      return;
    }

    const anthropicClient = this.client as Anthropic;

    // Separate system messages from user/assistant messages for Anthropic
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');
    const systemContent = systemMessages.map(m =>
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    ).join('\n');

    const stream = await anthropicClient.messages.stream({
      model: model || this.config.getModel(),
      max_tokens: max_tokens || 1500,
      system: systemContent || undefined,
      messages: otherMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      }))
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta') {
        const text = (chunk as any).delta?.text;
        if (text) {
          onChunk(text);
        }
      }
    }
  }
}
