const { Anthropic } = require('@anthropic-ai/sdk');
const { OpenAI } = require('openai');

class LLMClient {
  constructor(config) {
    this.config = config;
    this.type = config.getType();
    this.client = this.createClient();
  }

  createClient() {
    const apiKey = this.config.getApiKey();
    const baseUrl = this.config.getBaseUrl();
    const model = this.config.getModel();

    if (this.type === 'openai') {
      return new OpenAI({ apiKey, baseURL: baseUrl });
    }

    return new Anthropic({ apiKey, baseURL: baseUrl });
  }

  async createMessage({ model, max_tokens, messages }) {
    if (this.config.debug) {
      console.log('\n========== LLM INPUT ==========');
      for (const msg of messages) {
        console.log(`[${msg.role}]`, msg.content.substring(0, 500) + (msg.content.length > 500 ? '...' : ''));
      }
      console.log('===============================\n');
    }

    if (this.type === 'openai') {
      const response = await this.client.chat.completions.create({
        model: model || this.config.getModel(),
        messages
      });
      let content = response.choices[0].message.content;
      // Handle multi-block content (e.g., MiniMax returns thinking + text blocks)
      if (Array.isArray(content)) {
        const textBlock = content.find(b => b.type === 'text');
        content = textBlock ? textBlock.text : (content[0]?.text || '');
      }
      if (this.config.debug) {
        console.log('\n========== LLM OUTPUT ==========');
        console.log(content || '');
        console.log('===============================\n');
      }
      return { content: [{ text: content || '' }] };
    }

    const result = await this.client.messages.create({
      model: model || this.config.getModel(),
      max_tokens: max_tokens || 4096,
      messages
    });

    if (this.config.debug) {
      console.log('\n========== LLM OUTPUT ==========');
      console.log(result.content[0]?.text || '');
      console.log('===============================\n');
    }

    return result;
  }
}

module.exports = { LLMClient };
