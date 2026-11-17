/**
 * 上下文健康分析器
 *
 * 输入：用量数据（token 数、模型、窗口）
 * 输出：健康等级、预警、可执行的压缩建议
 *
 * 设计原则：
 *   - 只基于可测数据，不编造指标
 *   - 建议必须可执行（说清删什么、留什么）
 *   - 分级阈值可配置，不写死
 */

import { getWindow, DEFAULT_WINDOW } from './estimator.mjs';

/** 默认阈值（百分比） */
export const DEFAULT_THRESHOLDS = {
  healthy: 0.5,   // < 50% 健康
  notice: 0.7,    // 50-70% 注意
  warning: 0.85,  // 70-85% 警告
  danger: 0.95,   // 85-95% 危险
  // >= 95% 危急
};

/** 等级定义 */
export const LEVELS = {
  healthy: {
    id: 'healthy',
    label: '健康',
    icon: '🟢',
    advice: '正常使用，无需干预。',
  },
  notice: {
    id: 'notice',
    label: '注意',
    icon: '🟡',
    advice: '上下文开始占用较多，留意长输出操作。',
  },
  warning: {
    id: 'warning',
    label: '警告',
    icon: '🟠',
    advice: '建议开始清理不必要的历史内容。',
  },
  danger: {
    id: 'danger',
    label: '危险',
    icon: '🔴',
    advice: '即将触及上限，应立即压缩或切换模型。',
  },
  critical: {
    id: 'critical',
    label: '危急',
    icon: '🆘',
    advice: '随时可能超限中断，务必立即处理。',
  },
};

/**
 * 判定等级
 */
export function classify(ratio, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  if (ratio < t.healthy) return LEVELS.healthy;
  if (ratio < t.notice) return LEVELS.notice;
  if (ratio < t.warning) return LEVELS.warning;
  if (ratio < t.danger) return LEVELS.danger;
  return LEVELS.critical;
}

/**
 * 分析单个会话的上下文健康度。
 *
 * @param {object} usage
 * @param {number} usage.tokens       当前占用 token
 * @param {string} [usage.model]      模型名（用于查窗口）
 * @param {number} [usage.window]     显式指定窗口，覆盖模型查表
 * @param {object} [opts]
 * @param {object} [opts.thresholds]  阈值覆盖
 * @param {number} [opts.reserveOutput] 为输出预留的 token（默认窗口的 10%）
 * @returns {object} 分析结果
 */
export function analyze(usage, opts = {}) {
  const tokens = Math.max(0, Number(usage.tokens) || 0);
  const model = usage.model || null;
  const window = Number(usage.window) || getWindow(model);
  const reserveOutput = opts.reserveOutput ?? Math.min(8192, Math.floor(window * 0.1));

  // 有效可用窗口 = 总窗口 - 输出预留
  const effectiveWindow = Math.max(1, window - reserveOutput);
  const ratio = tokens / effectiveWindow;
  const level = classify(ratio, opts.thresholds);

  const remaining = Math.max(0, effectiveWindow - tokens);

  return {
    model,
    window,
    reserveOutput,
    effectiveWindow,
    tokens,
    ratio,
    percent: Number((ratio * 100).toFixed(1)),
    remaining,
    level,
    thresholds: { ...DEFAULT_THRESHOLDS, ...(opts.thresholds || {}) },
  };
}

/**
 * 生成可执行建议。
 *
 * @param {object} result     analyze() 的结果
 * @param {object} [context]  额外上下文
 * @param {string[]} [context.availableModels] 可切换的模型列表
 * @param {object[]} [context.bigItems] 占用量大的内容项 [{label, tokens}]
 * @returns {object[]} 建议列表
 */
export function suggest(result, context = {}) {
  const out = [];
  const { level, ratio, remaining, model, window } = result;

  if (level.id === 'healthy') {
    out.push({
      priority: 'none',
      action: '无需操作',
      detail: `当前占用 ${result.percent}%，剩余约 ${remaining.toLocaleString('en-US')} tokens，可继续正常工作。`,
    });
    return out;
  }

  // ---- 1. 清理类建议 ----
  if (level.id === 'notice' || level.id === 'warning') {
    out.push({
      priority: 'medium',
      action: '清理已完成任务的中间产物',
      detail: '把「已经做完、结论已记下」的过程性内容删除：失败的命令输出、重复的报错、已被替代的方案草稿。',
    });
  }

  // ---- 2. 压缩类建议 ----
  if (level.id === 'warning' || level.id === 'danger' || level.id === 'critical') {
    out.push({
      priority: 'high',
      action: '要求 AI 先做小结再继续',
      detail: '明确说「把目前的结论压成要点，然后我们开新对话继续」，把长历史换成结构化摘要。',
    });
    out.push({
      priority: 'high',
      action: '把大文件内容挪出对话',
      detail: '需要的内容写进文件，对话里只留路径和关键结论。下次让 AI 按需读取，而不是整段贴进来。',
    });
  }

  // ---- 3. 大占用项定位 ----
  if (Array.isArray(context.bigItems) && context.bigItems.length > 0) {
    const top = context.bigItems.slice(0, 3);
    out.push({
      priority: 'high',
      action: '优先处理占用量最大的内容',
      detail: top
        .map((i) => `${i.label}（约 ${i.tokens.toLocaleString('en-US')} tokens）`)
        .join('、'),
      items: top,
    });
  }

  // ---- 4. 切模型建议 ----
  if (level.id === 'danger' || level.id === 'critical') {
    const candidates = (context.availableModels || [])
      .map((m) => ({ model: m, window: getWindow(m) }))
      .filter((x) => x.window > window * 1.5)
      .sort((a, b) => b.window - a.window);

    if (candidates.length > 0) {
      const best = candidates[0];
      out.push({
        priority: 'urgent',
        action: `切换到更大窗口的模型：${best.model}`,
        detail: `该模型窗口 ${best.window.toLocaleString('en-US')} tokens，是当前的 ${(best.window / window).toFixed(1)} 倍，可继续容纳更多上下文。`,
        model: best.model,
        window: best.window,
      });
    } else if (window < DEFAULT_WINDOW) {
      out.push({
        priority: 'urgent',
        action: '当前模型窗口偏小',
        detail: `当前窗口仅 ${window.toLocaleString('en-US')} tokens，建议换用 128K 或更大窗口的模型。`,
      });
    }
  }

  // ---- 5. 危急时的新对话建议 ----
  if (level.id === 'critical') {
    out.push({
      priority: 'urgent',
      action: '现在开新对话',
      detail: '先让 AI 输出一份「已完成 / 待办 / 关键决策」的交接摘要，复制到新对话开头，这是最干净的解法。',
    });
  }

  return out;
}

/**
 * 生成人类可读报告
 */
export function formatReport(result, suggestions) {
  const lines = [];
  const { level, percent, tokens, effectiveWindow, window, remaining, model } = result;
  const barLen = 30;
  const filled = Math.min(barLen, Math.round((percent / 100) * barLen));
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

  lines.push(`${level.icon} 上下文健康度：${level.label}（${percent}%）`);
  lines.push('');
  lines.push(`  [${bar}]`);
  lines.push('');
  if (model) lines.push(`  模型        : ${model}`);
  lines.push(`  模型窗口    : ${window.toLocaleString('en-US')} tokens`);
  lines.push(`  可用窗口    : ${effectiveWindow.toLocaleString('en-US')}（扣除输出预留 ${result.reserveOutput.toLocaleString('en-US')}）`);
  lines.push(`  当前占用    : ${tokens.toLocaleString('en-US')} tokens`);
  lines.push(`  剩余可用    : ${remaining.toLocaleString('en-US')} tokens`);
  lines.push('');
  lines.push(`  ${level.advice}`);

  if (suggestions && suggestions.length > 0) {
    const actionable = suggestions.filter((s) => s.priority !== 'none');
    if (actionable.length > 0) {
      lines.push('');
      lines.push('建议操作：');
      const order = { urgent: 0, high: 1, medium: 2, low: 3 };
      actionable.sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
      for (const s of actionable) {
        const tag = s.priority === 'urgent' ? '‼' : s.priority === 'high' ? '!' : '·';
        lines.push(`  ${tag} ${s.action}`);
        if (s.detail) lines.push(`    ${s.detail}`);
      }
    }
  }
  return lines.join('\n');
}
