/**
 * 适配器装配
 *
 * 根据配置把所有平台实例化，供调度器统一使用。
 * 新增平台：在 config/providers.json 加一条 openai-compat 记录即可，无需改代码。
 */

import { QianwenProvider } from './qianwen.mjs';
import { DeepseekProvider } from './deepseek.mjs';
import { OpenRouterProvider } from './openrouter.mjs';
import { OpenAICompatProvider } from './openai-compat.mjs';

/** 内置平台（无需配置即可尝试，凭证从环境变量读） */
const BUILTIN_FACTORIES = {
  qianwen: (cfg) => new QianwenProvider({ cfg }),
  deepseek: (cfg) => new DeepseekProvider({ cfg }),
  openrouter: (cfg) => new OpenRouterProvider({ cfg }),
};

/**
 * 按配置构建全部 provider 实例。
 * @param {object} config 形如 { providers: { qianwen: {...}, mykimi: {kind:'openai-compat', ...} } }
 */
export function buildProviders(config = {}) {
  const out = new Map();
  const cfgProviders = config.providers || {};

  // 1. 内置平台
  for (const [id, factory] of Object.entries(BUILTIN_FACTORIES)) {
    const cfg = cfgProviders[id] || {};
    if (cfg.enabled === false) continue;
    out.set(id, factory(cfg));
  }

  // 2. 自定义平台（openai-compat 通用适配器）
  for (const [id, cfg] of Object.entries(cfgProviders)) {
    if (BUILTIN_FACTORIES[id]) continue;
    if (cfg.enabled === false) continue;
    const kind = cfg.kind || 'openai-compat';
    if (kind === 'openai-compat') {
      out.set(id, new OpenAICompatProvider({ id, name: cfg.name || id, cfg }));
    }
  }

  return out;
}

/** 汇总各平台健康状态 */
export async function probeAll(providers) {
  const health = {};
  const entries = [...providers.entries()];
  const results = await Promise.allSettled(
    entries.map(async ([id, p]) => ({ id, h: await p.health() })),
  );
  for (const r of results) {
    if (r.status === 'fulfilled') {
      health[r.value.id] = r.value.h;
    }
  }
  return health;
}

export { QianwenProvider, DeepseekProvider, OpenRouterProvider, OpenAICompatProvider };
