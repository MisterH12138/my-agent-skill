/**
 * 千问（阿里云 DashScope / Token Plan）适配器
 *
 * 两种接入方式：
 *   1. OpenAI 兼容端点（DashScope compatible-mode）—— 直连，最快
 *   2. qianwen CLI —— 兜底，支持 Token Plan 专属模型
 */

import { BaseProvider, fetchJSON } from './base.mjs';

const COMPATIBLE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const TOKENPLAN_BASE = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';

export class QianwenProvider extends BaseProvider {
  constructor(opts) {
    super({ ...opts, id: 'qianwen', name: 'Qianwen (Aliyun)' });
    const key = this.cfg.apiKey || this.env.DASHSCOPE_API_KEY || this.env.QIANWEN_API_KEY;
    this.apiKey = key && !/your-key|placeholder/i.test(key) ? key : null;
    // sk-sp- 是 Token Plan 密钥，走专属端点
    this.isTokenPlan = !!this.apiKey && this.apiKey.startsWith('sk-sp-');
    this.baseURL = this.cfg.baseURL
      || (this.isTokenPlan ? TOKENPLAN_BASE : COMPATIBLE_BASE);
    this.kind = 'qianwen';
  }

  hasCredentials() {
    return !!this.apiKey;
  }

  async chat({ model, messages, temperature, maxTokens, stream = false }) {
    if (!this.apiKey) throw new Error('千问：缺少 DASHSCOPE_API_KEY');

    const body = {
      model,
      messages,
      stream: false,
    };
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
      const err = new Error(`千问调用失败(${r.status}): ${msg}`);
      err.status = r.status;
      err.provider = 'qianwen';
      throw err;
    }

    const choice = r.json?.choices?.[0];
    return {
      text: choice?.message?.content || '',
      usage: r.json?.usage || null,
      model: r.json?.model || model,
      provider: 'qianwen',
      raw: r.json,
    };
  }

  async health() {
    if (!this.apiKey) {
      return { available: false, balance: null, note: '未配置 DASHSCOPE_API_KEY' };
    }
    // DashScope 无公开余额接口；用一次极小的模型列表请求探活
    try {
      const r = await fetchJSON(`${this.baseURL}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeoutMs: 20000,
      });
      if (r.ok) {
        // 记录该 Key 实际可见的模型 id，供调度器过滤
        const ids = (r.json?.data || []).map((m) => m.id);
        this.availableModels = ids;
        return {
          available: true,
          balance: null,
          freeRemaining: null,
          models: ids,
          note: this.isTokenPlan ? `Token Plan 连通（${ids.length} 个模型）` : '连通',
        };
      }
      if (r.status === 401) {
        return { available: false, balance: null, note: '密钥无效(401)' };
      }
      return { available: true, balance: null, note: `可达(HTTP ${r.status})` };
    } catch (e) {
      return { available: false, balance: null, note: `探测失败: ${e.message}` };
    }
  }
}
