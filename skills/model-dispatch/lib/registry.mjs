/**
 * 统一模型注册表
 *
 * 把不同平台的模型归一化成同一套描述，供调度器评分。
 * 每个模型记录：能力、价格、上下文窗口、免费额度来源。
 */

/** 任务类型 —— 与 SKILL.md 的路由规则表一一对应 */
export const TASK_TYPES = {
  'code-writing': { label: '代码编写', needReasoning: 0.65, needCreative: 0.3 },
  'code-review': { label: '代码审查', needReasoning: 0.9, needCreative: 0.2 },
  architecture: { label: '架构设计', needReasoning: 0.95, needCreative: 0.6 },
  documentation: { label: '文档撰写', needReasoning: 0.5, needCreative: 0.4 },
  'data-analysis': { label: '数据分析', needReasoning: 0.75, needCreative: 0.2 },
  'creative-writing': { label: '创意文案', needReasoning: 0.35, needCreative: 0.95 },
  'long-context': { label: '长上下文', needReasoning: 0.6, needCreative: 0.3 },
  'unit-test': { label: '单元测试', needReasoning: 0.7, needCreative: 0.3 },
  chat: { label: '通用对话', needReasoning: 0.4, needCreative: 0.3 },
};

/**
 * 模型能力分级（0-1）
 * tie: 综合能力基线，用于同价位时的优选
 */
export const TIERS = {
  flagship: { tie: 1.0, label: '旗舰' },
  strong: { tie: 0.85, label: '强力' },
  balanced: { tie: 0.7, label: '均衡' },
  fast: { tie: 0.55, label: '轻快' },
  specialized: { tie: 0.6, label: '专用' },
};

/**
 * 内置模型目录（可被 config/models.json 覆盖）
 *
 * price: 单位 CNY / 1M tokens
 *   input   —— 常规输入
 *   output  —— 输出
 *   cacheRead —— 缓存命中读
 * ctx: 上下文窗口 token 数
 * caps: 输入模态，用于过滤
 * tier: 能力档位
 */
export const BUILTIN_MODELS = [
  // ---------- 千问（阿里云 DashScope / Token Plan）----------
  {
    id: 'qwen3.8-flash',
    provider: 'qianwen',
    label: 'Qwen3.8 Flash',
    tier: 'fast',
    ctx: 1000000,
    caps: ['text', 'image', 'video'],
    output: 'text',
    price: { input: 0.8, output: 2.7, cacheRead: 0.1 },
    features: ['cache', 'function-calling', 'structured-outputs'],
    freeTier: { unit: 'tokens', total: 1000000 },
  },
  {
    id: 'qwen4-max',
    provider: 'qianwen',
    label: 'Qwen4 Max',
    tier: 'flagship',
    ctx: 1000000,
    caps: ['text', 'image', 'video'],
    output: 'text',
    price: { input: 10, output: 30, cacheRead: 0.5 },
    features: ['cache', 'function-calling', 'structured-outputs'],
    freeTier: { unit: 'tokens', total: 1000000 },
  },
  {
    id: 'qwen3.8-max',
    provider: 'qianwen',
    label: 'Qwen3.8 Max',
    tier: 'flagship',
    ctx: 1000000,
    caps: ['text', 'image', 'video'],
    output: 'text',
    price: { input: 12, output: 36, cacheRead: 1 },
    features: ['cache', 'function-calling', 'structured-outputs'],
    freeTier: { unit: 'tokens', total: 1000000 },
  },
  {
    id: 'qwen3.8-omni-flash',
    provider: 'qianwen',
    label: 'Qwen3.8 Omni Flash',
    tier: 'balanced',
    ctx: 1000000,
    caps: ['text', 'image', 'audio', 'video'],
    output: 'text',
    price: { input: 0.8, output: 2.7, cacheRead: 0.1 },
    features: ['cache', 'function-calling'],
    freeTier: { unit: 'tokens', total: 1000000 },
  },
  {
    id: 'qwen3.8-27b',
    provider: 'qianwen',
    label: 'Qwen3.8 27B',
    tier: 'balanced',
    ctx: 1000000,
    caps: ['text', 'image', 'video'],
    output: 'text',
    price: { input: 2, output: 6, cacheRead: 0.2 },
    features: ['cache', 'function-calling'],
    freeTier: { unit: 'tokens', total: 1000000 },
  },
  {
    id: 'qwen-image-3.0-pro',
    provider: 'qianwen',
    label: 'Qwen Image 3.0 Pro',
    tier: 'specialized',
    ctx: 0,
    caps: ['text', 'image'],
    output: 'image',
    price: { input: 0.02, output: 0.25, cacheRead: 0 },
    features: [],
    freeTier: { unit: 'images', total: 10 },
  },

  // ---------- DeepSeek 官方 ----------
  {
    id: 'deepseek-chat',
    provider: 'deepseek',
    label: 'DeepSeek Chat',
    tier: 'strong',
    ctx: 128000,
    caps: ['text'],
    output: 'text',
    price: { input: 2, output: 8, cacheRead: 0.5 },
    features: ['cache', 'function-calling'],
    freeTier: null,
  },
  {
    id: 'deepseek-reasoner',
    provider: 'deepseek',
    label: 'DeepSeek Reasoner',
    tier: 'flagship',
    ctx: 128000,
    caps: ['text'],
    output: 'text',
    price: { input: 4, output: 16, cacheRead: 1 },
    features: ['cache', 'function-calling', 'reasoning'],
    freeTier: null,
  },

  // ---------- OpenRouter 常用（价格为 USD 折算 CNY，汇率可配）----------
  {
    id: 'anthropic/claude-sonnet-4.5',
    provider: 'openrouter',
    label: 'Claude Sonnet 4.5',
    tier: 'flagship',
    ctx: 200000,
    caps: ['text', 'image'],
    output: 'text',
    price: { input: 21, output: 105, cacheRead: 2.1 },
    features: ['cache', 'function-calling'],
    freeTier: null,
  },
  {
    id: 'google/gemini-2.5-flash',
    provider: 'openrouter',
    label: 'Gemini 2.5 Flash',
    tier: 'fast',
    ctx: 1000000,
    caps: ['text', 'image', 'video', 'audio'],
    output: 'text',
    price: { input: 2.1, output: 8.4, cacheRead: 0.7 },
    features: ['function-calling'],
    freeTier: null,
  },
  {
    id: 'openai/gpt-4o-mini',
    provider: 'openrouter',
    label: 'GPT-4o mini',
    tier: 'fast',
    ctx: 128000,
    caps: ['text', 'image'],
    output: 'text',
    price: { input: 1.05, output: 4.2, cacheRead: 0.5 },
    features: ['function-calling'],
    freeTier: null,
  },
  {
    id: 'openai/gpt-4o',
    provider: 'openrouter',
    label: 'GPT-4o',
    tier: 'strong',
    ctx: 128000,
    caps: ['text', 'image'],
    output: 'text',
    price: { input: 17.5, output: 70, cacheRead: 8.75 },
    features: ['function-calling'],
    freeTier: null,
  },
];

/** 估算 token 数（无精确 tokenizer 时的保守估算，中文按 1.5 字/token） */
export function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}
