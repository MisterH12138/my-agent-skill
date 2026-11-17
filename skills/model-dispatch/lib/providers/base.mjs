/**
 * 平台适配器基类与注册表
 *
 * 每个适配器实现统一接口，调度器不需要知道底层平台差异。
 * 新增平台只需实现：chat() / health() / (可选) listModels()
 */

/** 从环境变量或 .env 取配置 */
export function pick(cfg, key, envNames = []) {
  if (cfg && cfg[key] != null && cfg[key] !== '') return cfg[key];
  for (const n of envNames) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/** 简单超时 fetch */
export async function fetchJSON(url, { method = 'GET', headers = {}, body, timeoutMs = 120000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 适配器注册表。
 * 键为 provider id，与 registry.mjs 中的 model.provider 对应。
 */
export class ProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(id, factory) {
    this.providers.set(id, factory);
  }

  get(id) {
    const f = this.providers.get(id);
    return f ? f() : null;
  }

  has(id) {
    return this.providers.has(id);
  }

  list() {
    return [...this.providers.keys()];
  }
}

/**
 * 适配器基类。
 * 子类需实现 chat() 与 health()。
 */
export class BaseProvider {
  constructor({ id, name, cfg, env }) {
    this.id = id;
    this.name = name || id;
    this.cfg = cfg || {};
    this.env = env || process.env;
  }

  /** 是否已配置可用密钥 */
  hasCredentials() {
    return false;
  }

  /** 平台健康与余量；返回 {available, balance, currency, freeRemaining, note} */
  async health() {
    return { available: this.hasCredentials(), balance: null, currency: null, freeRemaining: null };
  }

  /** 统一对话接口；返回 {text, usage, model, raw} */
  async chat(_req) {
    throw new Error(`${this.id}: chat() 未实现`);
  }
}
