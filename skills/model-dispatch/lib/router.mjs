/**
 * 调度引擎
 *
 * 核心职责：给定任务描述 + 约束，在候选模型中选出「最省最优」的一个。
 *
 * 评分模型（加权求和，权重可配）：
 *   score = w.capability * 能力匹配度
 *         + w.cost       * 成本性价比
 *         + w.context    * 上下文充裕度
 *         + w.availability * 可用性（余额/额度）
 *         + w.tier       * 综合能力基线
 *
 * 关键设计：
 *   1. 硬约束先过滤（模态、上下文、可用性），不合格的直接淘汰
 *   2. 软约束再打分（成本、能力、余量）
 *   3. 同分时优先免费额度充足、再优先能力高的
 */

import { TASK_TYPES, TIERS, BUILTIN_MODELS, estimateTokens } from './registry.mjs';

export const DEFAULT_WEIGHTS = {
  capability: 0.30,
  cost: 0.30,
  context: 0.15,
  availability: 0.15,
  tier: 0.10,
};

/**
 * 归一化到 0-1。max<=min 时返回 1（无区分度）。
 */
function norm(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 1;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * 推断任务类型：基于关键词 + 显式指定。
 */
export function inferTaskType(prompt, explicit) {
  if (explicit && TASK_TYPES[explicit]) return explicit;
  const p = String(prompt || '').toLowerCase();

  const rules = [
    { type: 'code-review', re: /(review|审查|审阅|评审|找问题|code review|pr )/ },
    { type: 'architecture', re: /(架构|设计|技术选型|方案|architecture|design pattern)/ },
    { type: 'unit-test', re: /(测试用例|单元测试|unit test|pytest|jest|覆盖率)/ },
    { type: 'code-writing', re: /(写代码|实现|修|重构|bug|refactor|implement|编写.*函数)/ },
    { type: 'documentation', re: /(readme|文档|注释|api doc|说明)/ },
    { type: 'data-analysis', re: /(分析|统计|数据|清洗|可视化|analysis|dataset)/ },
    { type: 'creative-writing', re: /(文案|命名|宣传|创意|标题|slogan|营销|广告)/ },
    { type: 'long-context', re: /(长文|整本书|全仓库|大量|长文档|总结这份)/ },
  ];

  for (const r of rules) {
    if (r.re.test(p)) return r.type;
  }
  return 'chat';
}

/**
 * 计算单个模型的成本（按估算 token）。
 */
export function estimateCost(model, inputTokens, outputTokens) {
  const p = model.price || {};
  const inCost = (inputTokens / 1_000_000) * (p.input || 0);
  const outCost = (outputTokens / 1_000_000) * (p.output || 0);
  return inCost + outCost;
}

/**
 * 评估一个候选模型。返回 null 表示被硬约束淘汰。
 */
function evaluate(model, ctx) {
  const { taskType, needCaps, inputTokens, outputTokens, health, weights, estOutputTokens } = ctx;
  const need = TASK_TYPES[taskType] || TASK_TYPES.chat;

  // ---- 硬约束 ----
  // 1. 模态支持
  for (const cap of needCaps) {
    if (!(model.caps || []).includes(cap)) return null;
  }
  // 2. 输出类型必须是 text（当前调度只做文本产出；图片/视频走专用路径）
  if (model.output !== 'text') return null;
  // 3. 上下文窗口必须装得下
  if (model.ctx > 0 && inputTokens > model.ctx * 0.9) return null;

  // ---- 可用性 ----
  const h = health[model.provider];
  if (h && h.available === false) return null;

  // 若平台探测返回了可用模型清单，则只允许清单内的模型
  // （Token Plan 常出现「模型列表有、但当前 Key 调不了」的情况）
  if (h && Array.isArray(h.models) && h.models.length > 0) {
    if (!h.models.includes(model.id)) return null;
  }

  // 免费额度：优先用平台探测到的剩余量；未探测到时按「有免费额度但未知余量」处理，
  // 给予中性可用性加成（不假定已耗尽，也不视为完全免费）。
  let freeRatio = 0;
  let freeKnown = false;
  if (model.freeTier) {
    if (h && h.freeRemaining != null) {
      freeKnown = true;
      freeRatio = model.freeTier.total > 0 ? Math.max(0, h.freeRemaining / model.freeTier.total) : 0;
    } else {
      freeRatio = 1; // 未知视为额度尚存
    }
  }
  const hasFree = freeRatio > 0.01;

  // ---- 成本（免费额度按比例抵扣）----
  const rawCost = estimateCost(model, inputTokens, outputTokens);
  // 免费额度只抵扣「有量」的部分；未知余量按一半计入，避免全是 0 导致成本维度失去区分度。
  const freeCredit = hasFree ? (freeKnown ? freeRatio : 0.5) : 0;
  const effectiveCost = rawCost * (1 - freeCredit);

  // ---- 能力匹配度 ----
  const tie = (TIERS[model.tier] || TIERS.balanced).tie;
  // 有 reasoning 特性对高推理任务加分
  const isReasoning = (model.features || []).includes('reasoning') ? 0.15 : 0;
  const capability = Math.min(1, tie * (0.65 + 0.35 * need.needReasoning) + isReasoning);

  // ---- 能力门槛（硬约束）----
  // 「能力不打折扣」：按任务所需推理强度，要求模型达到对应最低档位。
  //   needReasoning >= 0.85（代码审查/架构）→ 必须是 flagship 档（tie >= 0.95）
  //   needReasoning >= 0.65（代码编写/数据分析/单测）→ 至少 strong 档（tie >= 0.85）
  //   needReasoning >= 0.50（文档/长上下文）      → 至少 balanced 档（tie >= 0.70）
  //   其余（创意/闲聊）                          → 不限档位
  // 可用 minTierRatio 调整严格度，或 enforceFloor=false 关闭。
  if (ctx.enforceFloor !== false) {
    const strict = ctx.minCapabilityRatio ?? 1.0;
    let requiredTie = 0;
    if (need.needReasoning >= 0.85) requiredTie = TIERS.flagship.tie;      // 1.00
    else if (need.needReasoning >= 0.65) requiredTie = TIERS.strong.tie;   // 0.85
    else if (need.needReasoning >= 0.50) requiredTie = TIERS.balanced.tie; // 0.70
    // strict 越小越宽松：requiredTie 向下调整
    requiredTie = requiredTie * strict;
    if (tie < requiredTie) return null;
  }
  const capabilityFloor = (() => {
    if (need.needReasoning >= 0.85) return TIERS.flagship.tie;
    if (need.needReasoning >= 0.65) return TIERS.strong.tie;
    if (need.needReasoning >= 0.50) return TIERS.balanced.tie;
    return 0;
  })();

  // ---- 上下文充裕度 ----
  const contextScore = model.ctx > 0
    ? norm(Math.log10(model.ctx / Math.max(inputTokens, 1)), 0, 3)
    : 0.3;

  // ---- 可用性得分 ----
  let availability = 0.5;
  if (hasFree) availability = 0.8 + 0.2 * freeRatio;
  if (h && h.balance != null && h.balance <= 0 && !hasFree) availability = 0;
  if (h && h.available === false) availability = 0;

  return {
    model,
    rawCost,
    effectiveCost,
    hasFree,
    freeRatio,
    freeKnown,
    capability,
    capabilityFloor,
    contextScore,
    availability,
    tierScore: tie,
    needScore: need,
  };
}

/**
 * 主调度函数。
 *
 * @param {object} opts
 * @param {string} opts.prompt        任务描述（用于推断类型和估算 token）
 * @param {string} [opts.taskType]    显式指定任务类型
 * @param {string[]} [opts.needCaps]  必需的输入模态，默认 ['text']
 * @param {object} [opts.health]      各平台健康状态 { provider: {available, balance, freeRemaining} }
 * @param {object} [opts.weights]     权重覆盖
 * @param {object[]} [opts.models]    模型目录覆盖
 * @param {number} [opts.estOutputTokens] 预估输出 token
 * @param {string} [opts.preferProvider] 偏好平台
 * @returns {{chosen: object|null, ranked: object[], taskType: string, inputTokens: number}}
 */
export function route(opts = {}) {
  const {
    prompt = '',
    taskType: explicitType,
    needCaps = ['text'],
    health = {},
    weights: weightOverride = {},
    models = BUILTIN_MODELS,
    estOutputTokens = 1000,
    preferProvider = null,
    respectBalance = true,
    enforceFloor = true,
    minCapabilityRatio = 0.75,
  } = opts;

  const taskType = inferTaskType(prompt, explicitType);
  const inputTokens = estimateTokens(prompt);
  const weights = { ...DEFAULT_WEIGHTS, ...weightOverride };

  const ctx = {
    taskType,
    needCaps,
    inputTokens,
    outputTokens: estOutputTokens,
    estOutputTokens,
    health: respectBalance ? health : {},
    weights,
    enforceFloor,
    minCapabilityRatio,
  };

  let candidates = models.map((m) => evaluate(m, ctx)).filter(Boolean);

  // 若因门槛过滤后为空，逐步放宽：先降门槛，再放开可用性
  if (candidates.length === 0) {
    ctx.enforceFloor = false;
    candidates = models.map((m) => evaluate(m, ctx)).filter(Boolean);
  }
  if (candidates.length === 0 && respectBalance) {
    ctx.health = {};
    candidates = models.map((m) => evaluate(m, ctx)).filter(Boolean);
  }

  if (candidates.length === 0) {
    return { chosen: null, ranked: [], taskType, inputTokens, reason: 'no-candidate' };
  }

  // 成本归一化（对数，避免极端值主导）
  const costs = candidates.map((c) => c.effectiveCost);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const logMin = Math.log10(Math.max(minCost, 1e-6) + 1e-6);
  const logMax = Math.log10(Math.max(maxCost, 1e-6) + 1e-6);

  for (const c of candidates) {
    const logC = Math.log10(Math.max(c.effectiveCost, 1e-6) + 1e-6);
    // 成本越低得分越高
    const costScore = 1 - norm(logC, logMin, logMax);
    c.costScore = costScore;
    c.score =
      weights.capability * c.capability +
      weights.cost * costScore +
      weights.context * c.contextScore +
      weights.availability * c.availability +
      weights.tier * c.tierScore;

    if (preferProvider && c.model.provider === preferProvider) c.score += 0.05;
  }

  // 排序：总分降序 → 免费额度降序 → 成本升序 → 能力降序
  candidates.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
    if (b.freeRatio !== a.freeRatio) return b.freeRatio - a.freeRatio;
    if (Math.abs(a.effectiveCost - b.effectiveCost) > 1e-6) return a.effectiveCost - b.effectiveCost;
    return b.capability - a.capability;
  });

  return {
    chosen: candidates[0],
    ranked: candidates,
    taskType,
    inputTokens,
    weights,
  };
}

/**
 * 生成降级链：首选失败时依次尝试。
 */
export function fallbackChain(ranked, limit = 3) {
  return ranked.slice(0, limit);
}
