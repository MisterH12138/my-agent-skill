/**
 * Token 估算引擎
 *
 * 目标：在不依赖模型专用 tokenizer 的前提下，给出足够准的 token 数估算。
 *
 * 策略：
 *   1. 按字符类型分段估算（CJK / 拉丁字母 / 数字 / 符号 / 空白）
 *   2. 不同模型的 tokenizer 差异用系数校正
 *   3. 结果给出误差范围提示
 *
 * 精度目标：与真实 tokenizer 偏差控制在 ±15% 内（对预警决策足够）。
 */

/** 主流模型的上下文窗口（token） */
export const MODEL_WINDOWS = {
  // DeepSeek（含 DSH 内部的 flash 命名）
  'deepseek-flash': 1_000_000,
  'deepseek-pro': 1_000_000,
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4-pro': 1_000_000,
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,
  'deepseek-v3': 64_000,
  'deepseek-v3.1': 128_000,
  'deepseek-v3.2': 128_000,
  'deepseek-v4': 1_000_000,

  // 千问
  'qwen3.8-flash': 1_000_000,
  'qwen4-max': 1_000_000,
  'qwen3.8-max': 1_000_000,
  'qwen-turbo': 1_000_000,
  'qwen-plus': 131_072,
  'qwen-max': 32_768,

  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4.1': 1_047_576,
  'o1': 200_000,
  'o3': 200_000,

  // Anthropic
  'claude-sonnet-4': 200_000,
  'claude-opus-4': 200_000,
  'claude-haiku-4': 200_000,
  'claude-3-5-sonnet': 200_000,

  // Google
  'gemini-2.5-pro': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-2.0-flash': 1_048_576,

  // 其他常见
  'kimi-k2': 256_000,
  'moonshot-v1-128k': 128_000,
  'glm-4-plus': 128_000,
  'glm-4.6': 200_000,
  'minimax-m2': 204_800,
};

/** 默认窗口（未知模型时） */
export const DEFAULT_WINDOW = 128_000;

/** 单字符 token 密度系数（越小越省 token） */
const DENSITY = {
  cjk: 1 / 1.5,      // 中文：约 1.5 字/token
  latin: 1 / 4,      // 英文：约 4 字符/token
  digit: 1 / 3.2,    // 数字
  symbol: 1 / 2.5,   // 标点符号
  whitespace: 1 / 6, // 空白
  emoji: 2,          // emoji 通常占多个 token
};

/**
 * 估算文本的 token 数。
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.model] 模型名，用于系数校正
 * @param {boolean} [opts.verbose] 返回明细
 * @returns {number|object}
 */
export function estimateTokens(text, opts = {}) {
  if (!text) return opts.verbose ? { total: 0, breakdown: {} } : 0;
  const s = String(text);

  const counts = { cjk: 0, latin: 0, digit: 0, symbol: 0, whitespace: 0, emoji: 0 };
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const len = ch.length;
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK 统一表意
      (cp >= 0x3400 && cp <= 0x4dbf) ||   // 扩展 A
      (cp >= 0x3040 && cp <= 0x30ff) ||   // 日文假名
      (cp >= 0xac00 && cp <= 0xd7af) ||   // 韩文
      (cp >= 0xff00 && cp <= 0xffef)      // 全角符号
    ) {
      counts.cjk += 1;
    } else if (cp >= 0x1f300 && cp <= 0x1faff) {
      counts.emoji += 1;
    } else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) {
      counts.latin += 1;
    } else if (cp >= 0x30 && cp <= 0x39) {
      counts.digit += 1;
    } else if (cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d) {
      counts.whitespace += 1;
    } else {
      counts.symbol += 1;
    }
    i += len;
  }

  // 不同 tokenizer 的校正系数
  const model = (opts.model || '').toLowerCase();
  let adjust = 1.0;
  if (model.includes('claude')) adjust = 0.95;      // Claude tokenizer 对中文略省
  else if (model.includes('gemini')) adjust = 0.92; // Gemini 对多语言效率高
  else if (model.includes('qwen')) adjust = 1.02;   // Qwen 对中文优化
  else if (model.includes('deepseek')) adjust = 1.0;
  else if (model.includes('gpt')) adjust = 1.05;    // OpenAI 对中文略费

  const parts = {
    cjk: counts.cjk * DENSITY.cjk,
    latin: counts.latin * DENSITY.latin,
    digit: counts.digit * DENSITY.digit,
    symbol: counts.symbol * DENSITY.symbol,
    whitespace: counts.whitespace * DENSITY.whitespace,
    emoji: counts.emoji * DENSITY.emoji,
  };

  // 空白通常与相邻词合并，扣除约 30%
  parts.whitespace *= 0.7;

  const raw = Object.values(parts).reduce((a, b) => a + b, 0);
  const total = Math.ceil(raw * adjust);

  if (opts.verbose) {
    return {
      total,
      adjust,
      chars: s.length,
      breakdown: Object.fromEntries(
        Object.entries(counts).map(([k, v]) => [k, { chars: v, tokens: Math.round(parts[k]) }]),
      ),
      // 估算误差区间
      range: [Math.floor(total * 0.85), Math.ceil(total * 1.15)],
    };
  }
  return total;
}

/**
 * 消息数组的 token 估算（含 role 开销）。
 * @param {Array<{role:string, content:string|Array}>} messages
 * @param {object} [opts]
 */
export function estimateMessages(messages, opts = {}) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) {
    total += 4; // 每条消息的结构开销（role、分隔符）
    if (typeof m.content === 'string') {
      total += estimateTokens(m.content, opts);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (typeof part === 'string') total += estimateTokens(part, opts);
        else if (part && typeof part.text === 'string') total += estimateTokens(part.text, opts);
        else if (part && part.type === 'image') total += 850; // 图像约 850 token（中位数）
      }
    }
  }
  total += 3; // 回复引导开销
  return Math.ceil(total);
}

/** 查模型的上下文窗口 */
export function getWindow(model) {
  if (!model) return DEFAULT_WINDOW;
  const m = String(model).toLowerCase();
  if (MODEL_WINDOWS[m]) return MODEL_WINDOWS[m];
  // 模糊匹配：取最长匹配的键
  const keys = Object.keys(MODEL_WINDOWS).filter((k) => m.includes(k) || k.includes(m));
  if (keys.length > 0) {
    keys.sort((a, b) => b.length - a.length);
    return MODEL_WINDOWS[keys[0]];
  }
  return DEFAULT_WINDOW;
}
