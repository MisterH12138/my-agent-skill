/**
 * AI 提炼接口
 *
 * 设计原则：不绑定任何具体的 AI 工具或平台。
 *
 * 三种调用途径（按优先级）：
 *   1. 显式提供 --provider/--key/--base-url → 直接调 OpenAI 兼容接口
 *   2. 环境变量中有已知平台的 Key → 自动选用可用平台
 *   3. 都没有 → 输出候选包路径，让宿主 AI 自己读取处理
 *
 * 这样保证：任何工具、任何平台都能用，最差情况也能手动完成。
 */

import fs from 'node:fs';

/** 已知平台的 OpenAI 兼容端点 */
export const PROVIDERS = {
  qianwen: {
    label: '千问 / DashScope',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    tokenPlanBase: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    envKeys: ['DASHSCOPE_API_KEY', 'QIANWEN_API_KEY'],
    defaultModel: 'qwen3.8-flash',
  },
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    envKeys: ['DEEPSEEK_API_KEY'],
    defaultModel: 'deepseek-chat',
  },
  openrouter: {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    envKeys: ['OPENROUTER_API_KEY'],
    defaultModel: 'google/gemini-2.5-flash',
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    envKeys: ['OPENAI_API_KEY'],
    defaultModel: 'gpt-4o-mini',
  },
  moonshot: {
    label: 'Moonshot Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    envKeys: ['MOONSHOT_API_KEY'],
    defaultModel: 'moonshot-v1-8k',
  },
  zhipu: {
    label: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    envKeys: ['ZHIPU_API_KEY'],
    defaultModel: 'glm-4-flash',
  },
  siliconflow: {
    label: '硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    envKeys: ['SILICONFLOW_API_KEY'],
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
  },
  ollama: {
    label: 'Ollama（本地）',
    baseURL: 'http://localhost:11434/v1',
    envKeys: [],
    defaultModel: 'qwen2.5:7b',
    requiresKey: false,
  },
};

/** 从 .env 文件读（支持向上查找、BOM、export） */
function readEnvFiles(startDirs) {
  const found = {};
  for (const start of startDirs) {
    let cur = start;
    for (let depth = 0; depth < 6; depth++) {
      const p = `${cur}/.env`;
      try {
        if (fs.existsSync(p)) {
          const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
          for (let line of text.split(/\r?\n/)) {
            line = line.trim();
            if (!line || line.startsWith('#')) continue;
            if (line.startsWith('export ')) line = line.slice(7).trim();
            const eq = line.indexOf('=');
            if (eq <= 0) continue;
            const k = line.slice(0, eq).trim();
            let v = line.slice(eq + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
              v = v.slice(1, -1);
            }
            if (k && v && !found[k]) found[k] = v;
          }
        }
      } catch {
        /* 忽略 */
      }
      const parent = cur.replace(/[\\/][^\\/]+$/, '');
      if (parent === cur || !parent) break;
      cur = parent;
    }
  }
  return found;
}

/**
 * 根据 Key 前缀选择正确的端点。
 * sk-sp- 是 Token Plan，必须走专属端点，否则 401。
 */
function resolveBaseURL(id, cfg, apiKey) {
  if (id === 'qianwen' && apiKey && apiKey.startsWith('sk-sp-') && cfg.tokenPlanBase) {
    return cfg.tokenPlanBase;
  }
  return cfg.baseURL;
}

/**
 * 自动探测可用的 AI 平台。
 * @param {object} [opts]
 * @param {string[]} [opts.searchDirs] 查找 .env 的起始目录
 * @returns {{provider, label, baseURL, apiKey, model, source}|null}
 */
export function detectProvider(opts = {}) {
  const envFiles = readEnvFiles(opts.searchDirs || [process.cwd()]);

  for (const [id, cfg] of Object.entries(PROVIDERS)) {
    const requiresKey = cfg.requiresKey !== false;
    for (const key of cfg.envKeys) {
      const v = process.env[key] || envFiles[key];
      if (v && !/your-key|placeholder/i.test(v)) {
        return {
          provider: id,
          label: cfg.label,
          baseURL: resolveBaseURL(id, cfg, v),
          apiKey: v,
          model: opts.model || cfg.defaultModel,
          source: process.env[key] ? `环境变量 ${key}` : `.env 中的 ${key}`,
        };
      }
    }
    if (!requiresKey && id === 'ollama') {
      // 无需 Key 的平台，留待显式指定
    }
  }
  return null;
}

/**
 * 调用 OpenAI 兼容接口做提炼。
 *
 * @param {object} opts
 * @param {string} opts.baseURL
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.systemPrompt
 * @param {string} opts.userContent
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{text:string, usage:object|null, model:string}>}
 */
export async function refineWithAI(opts) {
  const {
    baseURL,
    apiKey,
    model,
    systemPrompt,
    userContent,
    timeoutMs = 180_000,
  } = opts;

  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
    stream: false,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        msg = JSON.parse(text)?.error?.message || msg;
      } catch {
        /* 保持原文 */
      }
      throw new Error(`AI 调用失败(${res.status}): ${msg}`);
    }
    const json = JSON.parse(text);
    const content = json?.choices?.[0]?.message?.content || '';
    if (!content) throw new Error('AI 返回内容为空');
    return { text: content, usage: json.usage || null, model: json.model || model };
  } finally {
    clearTimeout(timer);
  }
}

/** 提炼用的系统提示词 */
export const REFINE_SYSTEM_PROMPT = `你是一个记忆整理助手。用户会把「记忆候选包」给你，其中是从历史对话中机械筛选出的候选内容。

你的任务：产出精炼、可长期复用、对后续对话真正有帮助的记忆条目。

核心原则：
1. 只保留**跨会话依然成立**的信息。一次性任务细节、临时调试过程全部丢弃。
2. 合并重复。同一件事被多次提及，合成一条。
3. 每条独立可读，不依赖上文。
4. 保留具体性：仓库名、技术选型、明确说过的偏好、验证过的结论。不要泛化成空话。
5. 数量宁缺毋滥：每类 0-8 条。没有就留空。
6. 置信度标注：[高] = 用户明确说过；[中] = 从行为推断；[低] = 仅为可能。

【待办类的特别要求 — 非常重要】
候选包中的「待办」很多**可能已经完成**。判断依据：
- 如果某条待办在更晚的时间点被提及为「已完成 / 已推送 / 已配置 / 已确认」，则**不要记为待办**，应改为记入「知识」或直接丢弃。
- 只看候选文本无法确认完成状态时，标注 [低] 并加「（状态待确认）」。
- 宁可不记，不要制造虚假待办。用户看到一堆已完成的待办会认为记忆系统坏了。

【知识类的要求】
- 优先记录「踩过的坑」和「反直觉的事实」，这类复用价值最高。
- 记录时带上关键约束条件（如「在 Windows 环境下」「对 sk-sp- 密钥」）。

严格按下面格式输出纯 Markdown，不要任何额外说明：

## 项目
- [高] 具体内容
- [中] 具体内容

## 偏好
- [高] 具体内容

## 决策
- [高] 具体内容

## 知识
- [中] 具体内容

## 待办
- [中] 具体内容

某类没有内容时，标题下留空即可（不要写「无」）。`;

/**
 * 一站式：候选包 → AI 提炼 → 返回文本。
 * @param {string} candidatePack 候选包 Markdown
 * @param {object} providerCfg    detectProvider() 的返回值
 * @returns {Promise<{text, usage, model}>}
 */
export async function refine(candidatePack, providerCfg) {
  if (!providerCfg) throw new Error('未找到可用的 AI 平台');
  // 在候选包后面追加时间线提示，帮助 AI 判断完成状态
  const timeline = [
    '',
    '---',
    '',
    `## 当前时间`,
    '',
    `提炼时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '请注意：候选内容按时间排列，越靠后越新。若某事项在较晚位置已被描述为完成，',
    '则不应再计入「待办」。',
  ].join('\n');

  return refineWithAI({
    baseURL: providerCfg.baseURL,
    apiKey: providerCfg.apiKey,
    model: providerCfg.model,
    systemPrompt: REFINE_SYSTEM_PROMPT,
    userContent: candidatePack + timeline,
  });
}
