/**
 * 用户画像分析
 *
 * 从统一事件流中统计 6 个维度：
 *   1. 模型使用偏好
 *   2. 任务类型分布
 *   3. 会话长度与上下文峰值
 *   4. 时间习惯（活跃时段、频率）
 *   5. 文件与目录偏好
 *   6. 成本与 token 消耗趋势
 *
 * 原则：只统计真实数据，样本不足时明确标注，不编造。
 */

/** 任务类型关键词（中英双语） */
const TASK_RULES = [
  { type: 'code-review', label: '代码审查', re: /(review|审查|审阅|评审|找问题|code review|\bpr\b)/i },
  { type: 'architecture', label: '架构设计', re: /(架构|设计|技术选型|方案|architecture|design pattern)/i },
  { type: 'unit-test', label: '单元测试', re: /(测试用例|单元测试|unit test|pytest|jest|覆盖率)/i },
  { type: 'code-writing', label: '代码编写', re: /(写代码|实现|修|重构|bug|refactor|implement|编写.*函数|开发)/i },
  { type: 'documentation', label: '文档撰写', re: /(readme|文档|注释|api doc|说明|写作)/i },
  { type: 'data-analysis', label: '数据分析', re: /(分析|统计|数据|清洗|可视化|analysis|dataset)/i },
  { type: 'creative-writing', label: '创意文案', re: /(文案|命名|宣传|创意|标题|slogan|营销|广告)/i },
  { type: 'long-context', label: '长文档处理', re: /(长文|整本书|全仓库|长文档|总结这份)/i },
  { type: 'skill-setup', label: '技能与插件', re: /(skill|技能|插件|plugin|安装|配置|仓库|github)/i },
];

/** 从事件推断任务类型 */
export function inferTaskType(text) {
  if (!text) return null;
  for (const r of TASK_RULES) {
    if (r.re.test(text)) return { type: r.type, label: r.label };
  }
  return null;
}

function pct(n, total) {
  if (!total) return 0;
  return Number(((n / total) * 100).toFixed(1));
}

function topN(map, n = 10) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/**
 * 主分析函数。
 * @param {Array} events 统一事件流（含 sessionId, tool, role, text, time, model, usage, filePaths）
 * @param {object} [opts]
 * @returns {object} 画像数据
 */
export function buildProfile(events, opts = {}) {
  const profile = {
    generatedAt: new Date().toISOString(),
    sampleSize: events.length,
    sessions: 0,
    tools: {},
    models: [],
    tasks: [],
    sessionStats: {},
    timeHabits: {},
    filePrefs: {},
    cost: {},
    warnings: [],
  };

  if (!events || events.length === 0) {
    profile.warnings.push('没有可用的事件数据，无法生成画像。');
    return profile;
  }

  // ---------- 基础分组 ----------
  const bySession = new Map();
  const toolCount = new Map();
  const modelCount = new Map();
  const modelUsage = new Map(); // model -> {calls, tokens}
  const taskCount = new Map();
  const fileCount = new Map();
  const dirCount = new Map();
  const hourCount = Array(24).fill(0);
  const dayCount = new Map();
  const sessionMeta = new Map(); // sessionId -> {start, end, maxCtx, calls, tools}

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalUsageCalls = 0;

  for (const e of events) {
    const sid = e.sessionId || 'unknown';
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(e);

    if (!sessionMeta.has(sid)) {
      sessionMeta.set(sid, { start: null, end: null, maxCtx: 0, calls: 0, tool: e.tool, modelCount: new Map() });
    }
    const sm = sessionMeta.get(sid);
    if (e.tool) sm.tool = e.tool;

    // 工具
    if (e.tool) toolCount.set(e.tool, (toolCount.get(e.tool) || 0) + 1);

    // 时间
    if (typeof e.time === 'number' && e.time > 0) {
      const d = new Date(e.time);
      hourCount[d.getHours()] += 1;
      const dayKey = d.toISOString().slice(0, 10);
      dayCount.set(dayKey, (dayCount.get(dayKey) || 0) + 1);
      if (!sm.start || e.time < sm.start) sm.start = e.time;
      if (!sm.end || e.time > sm.end) sm.end = e.time;
    }

    // 模型
    if (e.model) {
      modelCount.set(e.model, (modelCount.get(e.model) || 0) + 1);
      sm.modelCount.set(e.model, (sm.modelCount.get(e.model) || 0) + 1);
    }

    // 任务类型（只看用户消息）
    if (e.role === 'user' && e.text) {
      const t = inferTaskType(e.text);
      if (t) taskCount.set(t.label, (taskCount.get(t.label) || 0) + 1);
    }

    // 文件偏好
    if (Array.isArray(e.filePaths)) {
      for (const fp of e.filePaths) {
        fileCount.set(fp, (fileCount.get(fp) || 0) + 1);
        // 目录统计：取最后两段
        const parts = fp.split('/').filter(Boolean);
        if (parts.length >= 2) {
          const dir = parts.slice(-2, -1)[0];
          dirCount.set(dir, (dirCount.get(dir) || 0) + 1);
        }
      }
    }

    // 用量
    if (e.role === 'usage' && e.usage) {
      totalInput += e.usage.input || 0;
      totalOutput += e.usage.output || 0;
      totalCacheRead += e.usage.cacheRead || 0;
      totalUsageCalls += 1;
      sm.calls += 1;
      const ctx = e.usage.total || (e.usage.input || 0) + (e.usage.output || 0) + (e.usage.cacheRead || 0);
      if (ctx > sm.maxCtx) sm.maxCtx = ctx;
      if (e.model) {
        const mu = modelUsage.get(e.model) || { calls: 0, tokens: 0 };
        mu.calls += 1;
        mu.tokens += ctx;
        modelUsage.set(e.model, mu);
      }
    }
  }

  profile.sessions = bySession.size;

  // ---------- 1. 模型偏好 ----------
  const modelTotal = [...modelCount.values()].reduce((a, b) => a + b, 0);
  profile.models = topN(modelCount, 15).map(([name, count]) => {
    const mu = modelUsage.get(name) || { calls: 0, tokens: 0 };
    return {
      model: name,
      mentions: count,
      share: pct(count, modelTotal),
      usageCalls: mu.calls,
      tokens: mu.tokens,
    };
  });
  if (profile.models.length === 0) {
    profile.warnings.push('事件中未记录模型信息，无法统计模型偏好。');
  }

  // ---------- 2. 任务类型 ----------
  const taskTotal = [...taskCount.values()].reduce((a, b) => a + b, 0);
  profile.tasks = topN(taskCount, 10).map(([label, count]) => ({
    label,
    count,
    share: pct(count, taskTotal),
  }));
  if (profile.tasks.length === 0) {
    profile.warnings.push('未从用户消息中识别出任务类型（可能是消息文本未记录）。');
  }

  // ---------- 3. 会话统计 ----------
  const durations = [];
  const ctxPeaks = [];
  for (const [, sm] of sessionMeta) {
    if (sm.start && sm.end && sm.end > sm.start) durations.push(sm.end - sm.start);
    if (sm.maxCtx > 0) ctxPeaks.push(sm.maxCtx);
  }
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const median = (arr) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  profile.sessionStats = {
    total: sessionMeta.size,
    withDuration: durations.length,
    avgDurationMin: Number((avg(durations) / 60000).toFixed(1)),
    medianDurationMin: Number((median(durations) / 60000).toFixed(1)),
    avgContextPeak: Math.round(avg(ctxPeaks)),
    medianContextPeak: Math.round(median(ctxPeaks)),
    maxContextPeak: ctxPeaks.length ? Math.max(...ctxPeaks) : 0,
    avgCallsPerSession: Number(
      (avg([...sessionMeta.values()].map((s) => s.calls)) || 0).toFixed(1),
    ),
  };

  // ---------- 4. 时间习惯 ----------
  const activeHours = hourCount
    .map((count, hour) => ({ hour, count }))
    .filter((h) => h.count > 0);
  const peakHour = activeHours.length ? activeHours.reduce((a, b) => (b.count > a.count ? b : a)) : null;
  profile.timeHabits = {
    activeDays: dayCount.size,
    peakHour: peakHour ? peakHour.hour : null,
    hourly: hourCount,
    daily: topN(dayCount, 30).map(([date, count]) => ({ date, count })),
    avgPerActiveDay: dayCount.size ? Number((events.length / dayCount.size).toFixed(0)) : 0,
  };
  if (dayCount.size > 0 && dayCount.size < 3) {
    profile.warnings.push(`仅 ${dayCount.size} 天数据，时间习惯统计参考价值有限。`);
  }

  // ---------- 5. 文件偏好 ----------
  profile.filePrefs = {
    topFiles: topN(fileCount, 10).map(([file, count]) => ({ file, count })),
    topDirs: topN(dirCount, 10).map(([dir, count]) => ({ dir, count })),
    uniqueFiles: fileCount.size,
  };

  // ---------- 6. 成本趋势 ----------
  profile.cost = {
    usageCalls: totalUsageCalls,
    totalInput,
    totalOutput,
    totalCacheRead,
    totalTokens: totalInput + totalOutput + totalCacheRead,
    cacheHitRate: totalInput + totalCacheRead > 0 ? pct(totalCacheRead, totalInput + totalCacheRead + totalOutput) : 0,
    byModel: [...modelUsage.entries()]
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, 10)
      .map(([model, v]) => ({ model, calls: v.calls, tokens: v.tokens })),
  };

  // ---------- 自动洞察 ----------
  profile.insights = buildInsights(profile);

  return profile;
}

/**
 * 从画像数据生成文字洞察。
 */
function buildInsights(p) {
  const out = [];

  // 模型集中度
  if (p.models.length > 0) {
    const top = p.models[0];
    if (top.share >= 70) {
      out.push({
        type: 'model-concentration',
        text: `你 ${top.share}% 的时间用 ${top.model}。考虑给高价值任务（代码审查、架构设计）单独配更强的模型。`,
      });
    } else if (p.models.length >= 3) {
      out.push({
        type: 'model-diverse',
        text: `你使用了 ${p.models.length} 个不同模型，分布较分散。可考虑用 model-dispatch 固化选型规则。`,
      });
    }
  }

  // 上下文压力
  const peak = p.sessionStats.maxContextPeak;
  const avgPeak = p.sessionStats.avgContextPeak;
  if (peak > 0) {
    if (avgPeak > 500_000) {
      out.push({
        type: 'context-pressure',
        text: `平均会话上下文峰值 ${avgPeak.toLocaleString('en-US')} tokens，偏高。建议开启 DSH 的 compaction-basic 自动压缩，或在中途主动开新对话。`,
      });
    } else if (avgPeak > 100_000) {
      out.push({
        type: 'context-moderate',
        text: `平均上下文峰值 ${avgPeak.toLocaleString('en-US')} tokens，中等水平。长任务前建议用 context-guardian check 预检余量。`,
      });
    }
  }

  // 任务分布
  if (p.tasks.length > 0) {
    const top = p.tasks[0];
    if (top.share >= 40) {
      out.push({
        type: 'task-focus',
        text: `你的任务 ${top.share}% 集中在「${top.label}」，可针对这类任务优化默认配置。`,
      });
    }
  }

  // 缓存效率
  if (p.cost.cacheHitRate > 0) {
    if (p.cost.cacheHitRate > 80) {
      out.push({
        type: 'cache-good',
        text: `缓存命中率 ${p.cost.cacheHitRate}%，说明对话连续性良好，成本控制得当。`,
      });
    } else if (p.cost.cacheHitRate < 30 && p.cost.usageCalls > 50) {
      out.push({
        type: 'cache-low',
        text: `缓存命中率仅 ${p.cost.cacheHitRate}%，频繁开新对话会降低缓存复用。可考虑延长单次会话。`,
      });
    }
  }

  // 时间习惯
  if (p.timeHabits.peakHour !== null && p.timeHabits.activeDays >= 3) {
    out.push({
      type: 'time-habit',
      text: `你最活跃的时段是 ${p.timeHabits.peakHour}:00 前后，共 ${p.timeHabits.activeDays} 天有使用记录。`,
    });
  }

  return out;
}

/**
 * 生成人类可读报告。
 */
export function formatProfile(p) {
  const L = [];
  const n = (x) => (x == null ? '-' : x.toLocaleString('en-US'));

  L.push('用户使用画像');
  L.push('');
  L.push(`生成时间  : ${new Date(p.generatedAt).toLocaleString('zh-CN')}`);
  L.push(`事件样本  : ${n(p.sampleSize)} 条`);
  L.push(`会话数    : ${p.sessions}`);
  L.push(`工具来源  : ${Object.keys(p.tools || {}).length ? Object.keys(p.tools).join(', ') : '(单一来源)'}`);

  // 模型偏好
  if (p.models.length > 0) {
    L.push('');
    L.push('■ 模型使用偏好');
    for (const m of p.models.slice(0, 8)) {
      const bar = '█'.repeat(Math.max(1, Math.round(m.share / 5)));
      L.push(`  ${m.model.padEnd(24)} ${String(m.share).padStart(5)}%  ${bar}`);
    }
  }

  // 任务分布
  if (p.tasks.length > 0) {
    L.push('');
    L.push('■ 任务类型分布');
    for (const t of p.tasks) {
      const bar = '█'.repeat(Math.max(1, Math.round(t.share / 5)));
      L.push(`  ${t.label.padEnd(16)} ${String(t.share).padStart(5)}%  ${bar}`);
    }
  }

  // 会话统计
  const s = p.sessionStats;
  if (s.total > 0) {
    L.push('');
    L.push('■ 会话长度与上下文');
    L.push(`  会话总数        : ${n(s.total)}`);
    L.push(`  平均时长        : ${s.avgDurationMin} 分钟（中位数 ${s.medianDurationMin}）`);
    L.push(`  平均上下文峰值  : ${n(s.avgContextPeak)} tokens`);
    L.push(`  最大上下文峰值  : ${n(s.maxContextPeak)} tokens`);
    L.push(`  平均调用次数    : ${s.avgCallsPerSession} 次/会话`);
  }

  // 时间习惯
  const th = p.timeHabits;
  if (th.activeDays > 0) {
    L.push('');
    L.push('■ 时间习惯');
    L.push(`  活跃天数        : ${th.activeDays}`);
    if (th.peakHour !== null) L.push(`  最活跃时段      : ${th.peakHour}:00 前后`);
    // 简易热力条
    if (Array.isArray(th.hourly)) {
      const maxH = Math.max(...th.hourly, 1);
      const cells = th.hourly.map((c) => {
        const ratio = c / maxH;
        if (!c) return '·';
        if (ratio > 0.75) return '█';
        if (ratio > 0.5) return '▓';
        if (ratio > 0.25) return '▒';
        return '░';
      }).join('');
      L.push(`  24小时分布      : ${cells}`);
      L.push(`                    ${'0'.padEnd(2)}${'  '.padEnd(8)}${'8'.padEnd(3)}${'  '.padEnd(8)}${'16'.padEnd(3)}${'  '.padEnd(8)}${'20'.padEnd(2)}`);
    }
  }

  // 文件偏好
  const fp = p.filePrefs;
  if (fp.topFiles && fp.topFiles.length > 0) {
    L.push('');
    L.push('■ 文件与目录偏好');
    L.push(`  涉及文件数      : ${fp.uniqueFiles}`);
    L.push('  最常涉及的文件：');
    for (const f of fp.topFiles.slice(0, 5)) {
      const short = f.file.length > 56 ? '…' + f.file.slice(-55) : f.file;
      L.push(`    ${short}  (${f.count} 次)`);
    }
    if (fp.topDirs && fp.topDirs.length > 0) {
      L.push('  最常涉及的目录：');
      for (const d of fp.topDirs.slice(0, 5)) {
        L.push(`    ${d.dir}  (${d.count} 次)`);
      }
    }
  }

  // 成本
  const c = p.cost;
  if (c.usageCalls > 0) {
    L.push('');
    L.push('■ Token 消耗');
    L.push(`  统计调用数      : ${n(c.usageCalls)}`);
    L.push(`  输入 tokens     : ${n(c.totalInput)}`);
    L.push(`  输出 tokens     : ${n(c.totalOutput)}`);
    L.push(`  缓存读 tokens   : ${n(c.totalCacheRead)}`);
    L.push(`  总计            : ${n(c.totalTokens)}`);
    L.push(`  缓存命中占比    : ${c.cacheHitRate}%`);
    if (c.byModel.length > 0) {
      L.push('  按模型分布：');
      for (const m of c.byModel.slice(0, 5)) {
        L.push(`    ${m.model.padEnd(22)} ${n(m.tokens)} tokens (${n(m.calls)} 次调用)`);
      }
    }
  }

  // 洞察
  if (p.insights && p.insights.length > 0) {
    L.push('');
    L.push('■ 优化建议');
    for (const i of p.insights) {
      L.push(`  · ${i.text}`);
    }
  }

  // 警告
  if (p.warnings && p.warnings.length > 0) {
    L.push('');
    L.push('■ 数据说明');
    for (const w of p.warnings) {
      L.push(`  ⚠ ${w}`);
    }
  }

  return L.join('\n');
}
