/**
 * OpenRouter 适配器 —— 聚合平台，一个 Key 接入多厂模型
 */

import { BaseProvider, fetchJSON } from './base.mjs';

const BASE = 'https://openrouter.ai/api/v1';

export class OpenRouterProvider extends BaseProvider {
  constructor(opts) {
    super({ ...opts, id: 'openrouter', name: 'OpenRouter' });
    const key = this.cfg.apiKey || this.env.OPENROUTER_API_KEY;
    this.apiKey = key && !/your-key|placeholder/i.test(key) ? key : null;
    this.baseURL = this.cfg.baseURL || BASE;
    this.referer = this.cfg.referer || 'https://github.com/deepseek-ai';
    this.title = this.cfg.title || 'DSH Model Router';
  }

  hasCredentials() {
    return !!this.apiKey;
  }

  async chat({ model, messages, temperature, maxTokens }) {
    if (!this.apiKey) throw new Error('OpenRouter：缺少 OPENROUTER_API_KEY');

    const body = { model, messages, stream: false };
    if (temperature != null) body.temperature = temperature;
    if (maxTokens != null) body.max_tokens = maxTokens;

    const r = await fetchJSON(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': this.referer,
        'X-Title': this.title,
      },
      body,
    });

    if (!r.ok) {
      const msg = r.json?.error?.message || r.text?.slice(0, 300) || `HTTP ${r.status}`;
      const err = new Error(`OpenRouter调用失败(${r.status}): ${msg}`);
      err.status = r.status;
      err.provider = 'openrouter';
      throw err;
    }

    const choice = r.json?.choices?.[0];
    return {
      text: choice?.message?.content || '',
      usage: r.json?.usage || null,
      model: r.json?.model || model,
      provider: 'openrouter',
      raw: r.json,
    };
  }

  async health() {
    if (!this.apiKey) {
      return { available: false, balance: null, note: '未配置 OPENROUTER_API_KEY' };
    }
    try {
      const r = await fetchJSON(`${this.baseURL}/credits`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutMs: 20000,
      });
      if (r.ok && r.json?.data) {
        const total = Number(r.json.data.total_credits ?? 0);
        const used = Number(r.json.data.total_usage ?? 0);
        const balance = total - used;
        return {
          available: balance > 0,
          balance,
          currency: 'USD',
          total,
          used,
          note: `余额 $${balance.toFixed(2)}（已用 $${used.toFixed(2)}）`,
        };
      }
      if (r.status === 401) return { available: false, balance: null, note: '密钥无效(401)' };
      return { available: true, balance: null, note: `可达(HTTP ${r.status})` };
    } catch (e) {
      return { available: false, balance: null, note: `探测失败: ${e.message}` };
    }
  }

  /** 拉取 OpenRouter 实时模型列表（用于扩展注册表） */
  async listModels() {
    const r = await fetchJSON(`${this.baseURL}/models`, { timeoutMs: 30000 });
    if (!r.ok || !r.json?.data) return [];
    return r.json.data.map((m) => ({
      id: m.id,
      provider: 'openrouter',
      label: m.name || m.id,
      ctx: m.context_length || 0,
      caps: m.architecture?.input_modalities || ['text'],
      output: (m.architecture?.output_modalities || ['text'])[0],
      price: {
        // OpenRouter 返回 USD/token，换算为 CNY/1M（汇率可配）
        input: Number(m.pricing?.prompt ?? 0) * 1_000_000 * (Number(process.env.USD_CNY || 7.1)),
        output: Number(m.pricing?.completion ?? 0) * 1_000_000 * (Number(process.env.USD_CNY || 7.1)),
        cacheRead: Number(m.pricing?.input_cache_read ?? 0) * 1_000_000 * (Number(process.env.USD_CNY || 7.1)),
      },
      tier: 'balanced',
      features: [],
      freeTier: null,
    }));
  }
}
