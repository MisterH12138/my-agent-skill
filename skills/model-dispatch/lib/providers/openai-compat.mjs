/**
 * 通用 OpenAI 兼容适配器
 *
 * 绝大多数平台（Kimi/Moonshot、智谱GLM、MiniMax、硅基流动、
 * Together、Groq、本地 Ollama/vLLM 等）都提供 OpenAI 兼容端点。
 * 用一个适配器覆盖它们，只需配置 baseURL + apiKey。
 */

import { BaseProvider, fetchJSON } from './base.mjs';

export class OpenAICompatProvider extends BaseProvider {
  constructor(opts) {
    super(opts);
    const key = this.cfg.apiKey
      || (this.cfg.envKey ? this.env[this.cfg.envKey] : null);
    this.apiKey = key && !/your-key|placeholder/i.test(key) ? key : null;
    this.baseURL = (this.cfg.baseURL || '').replace(/\/+$/, '');
    this.requiresKey = this.cfg.requiresKey !== false;
    this.kind = 'openai-compat';
  }

  hasCredentials() {
    if (!this.requiresKey) return !!this.baseURL;
    return !!this.apiKey && !!this.baseURL;
  }

  async chat({ model, messages, temperature, maxTokens }) {
    if (!this.hasCredentials()) {
      throw new Error(`${this.name}：缺少 baseURL 或 apiKey`);
    }
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const body = { model, messages, stream: false };
    if (temperature != null) body.temperature = temperature;
    if (maxTokens != null) body.max_tokens = maxTokens;

    const r = await fetchJSON(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body,
    });

    if (!r.ok) {
      const msg = r.json?.error?.message || r.text?.slice(0, 300) || `HTTP ${r.status}`;
      const err = new Error(`${this.name}调用失败(${r.status}): ${msg}`);
      err.status = r.status;
      err.provider = this.id;
      throw err;
    }

    const choice = r.json?.choices?.[0];
    return {
      text: choice?.message?.content || '',
      usage: r.json?.usage || null,
      model: r.json?.model || model,
      provider: this.id,
      raw: r.json,
    };
  }

  async health() {
    if (!this.hasCredentials()) {
      return { available: false, balance: null, note: '未配置 baseURL/apiKey' };
    }
    try {
      const headers = this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
      const r = await fetchJSON(`${this.baseURL}/models`, { headers, timeoutMs: 15000 });
      if (r.ok) return { available: true, balance: null, note: '连通' };
      if (r.status === 401) return { available: false, balance: null, note: '密钥无效(401)' };
      return { available: true, balance: null, note: `可达(HTTP ${r.status})` };
    } catch (e) {
      return { available: false, balance: null, note: `探测失败: ${e.message}` };
    }
  }
}
