/**
 * DeepSeek 官方 API 适配器
 *
 * 特点：有真实可查的余额接口，调度时可据此判断「还能不能用」。
 */

import { BaseProvider, fetchJSON } from './base.mjs';

const BASE = 'https://api.deepseek.com';

export class DeepseekProvider extends BaseProvider {
  constructor(opts) {
    super({ ...opts, id: 'deepseek', name: 'DeepSeek' });
    const key = this.cfg.apiKey || this.env.DEEPSEEK_API_KEY;
    this.apiKey = key && !/your-key|placeholder/i.test(key) ? key : null;
    this.baseURL = this.cfg.baseURL || BASE;
  }

  hasCredentials() {
    return !!this.apiKey;
  }

  async chat({ model, messages, temperature, maxTokens }) {
    if (!this.apiKey) throw new Error('DeepSeek：缺少 DEEPSEEK_API_KEY');

    // DeepSeek 的模型名与内部注册 id 映射
    const modelMap = {
      'deepseek-chat': 'deepseek-chat',
      'deepseek-reasoner': 'deepseek-reasoner',
    };
    const apiModel = modelMap[model] || model;

    const body = { model: apiModel, messages, stream: false };
    if (temperature != null) body.temperature = temperature;
    if (maxTokens != null) body.max_tokens = maxTokens;

    const r = await fetchJSON(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
    });

    if (!r.ok) {
      const msg = r.json?.error?.message || r.text?.slice(0, 300) || `HTTP ${r.status}`;
      const err = new Error(`DeepSeek调用失败(${r.status}): ${msg}`);
      err.status = r.status;
      err.provider = 'deepseek';
      throw err;
    }

    const choice = r.json?.choices?.[0];
    return {
      text: choice?.message?.content || '',
      usage: r.json?.usage || null,
      model: r.json?.model || apiModel,
      provider: 'deepseek',
      raw: r.json,
    };
  }

  async health() {
    if (!this.apiKey) {
      return { available: false, balance: null, note: '未配置 DEEPSEEK_API_KEY' };
    }
    try {
      const r = await fetchJSON(`${this.baseURL}/user/balance`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutMs: 20000,
      });
      if (!r.ok) {
        if (r.status === 401) return { available: false, balance: null, note: '密钥无效(401)' };
        return { available: false, balance: null, note: `余额查询失败(HTTP ${r.status})` };
      }
      const infos = r.json?.balance_infos || [];
      const cny = infos.find((i) => i.currency === 'CNY') || infos[0];
      const balance = cny ? Number(cny.total_balance) : null;
      return {
        available: r.json?.is_available !== false && (balance == null || balance > 0),
        balance,
        currency: cny?.currency || 'CNY',
        granted: cny ? Number(cny.granted_balance) : null,
        toppedUp: cny ? Number(cny.topped_up_balance) : null,
        note: balance != null ? `余额 ${cny.currency} ${cny.total_balance}` : '连通',
      };
    } catch (e) {
      return { available: false, balance: null, note: `探测失败: ${e.message}` };
    }
  }
}
