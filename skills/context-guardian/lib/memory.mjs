/**
 * 记忆提炼：候选包生成 + AI 精炼
 *
 * 两阶段设计：
 *   阶段 1（离线，本文件）：从事件流中筛出「可能值得记住」的内容，过滤噪声，
 *                          打成结构化候选包（Markdown），供 AI 阅读。
 *   阶段 2（在线，AI）：把候选包交给任意 AI 模型，由其生成真正的记忆条目。
 *
 * 为什么分两阶段：
 *   - 判断「什么是值得记住的」需要语义理解，正则做不到
 *   - 但直接把几万条原始事件喂给 AI 太贵，所以先做机械筛选
 */

import fs from 'node:fs';
import path from 'node:path';

/** 记忆分类 */
export const MEMORY_KINDS = {
  project: { label: '项目', hint: '做过的项目、仓库、技术栈' },
  preference: { label: '偏好', hint: '用户明确表达的喜好、习惯、要求' },
  decision: { label: '决策', hint: '做过的重要选择及理由' },
  learning: { label: '知识', hint: '验证过的事实、踩过的坑、根因' },
  todo: { label: '待办', hint: '未完成或待跟进的事项' },
};

// ---------- 噪声过滤 ----------

/** 判断文本是否是噪声（系统提示、表格碎片、代码块、模板等） */
export function isNoise(text) {
  if (!text) return true;
  const t = text.trim();
  if (t.length < 12) return true;

  // 表格行：| a | b |
  if (/^\|.*\|.*\|/.test(t)) return true;
  // 纯符号/分隔线
  if (/^[-=_*#\s]{3,}$/.test(t)) return true;
  // 代码块围栏
  if (/^```/.test(t)) return true;
  // 系统/工具内部指令特征（英文祈使句式 meta 指令）
  if (/^(you (must|should|need to|are)|the goal is|inspect them|write the closing|report only|do not|never )/i.test(t)) return true;
  // 明显的模板占位
  if (/^(\{\{|\$\{|<[a-z]+\s*\/?>$)/i.test(t)) return true;
  // 单行超长且无标点（多为数据/日志）
  if (t.length > 400 && !/[。！？.!?]/.test(t)) return true;
  // 纯英文字符串常量/报错栈
  if (/^(at |Error:|TypeError|SyntaxError|node:internal|Traceback|File ")/.test(t)) return true;
  // 命令行回显
  if (/^(\$|>|PS |C:\\|D:\\)/.test(t) && t.length > 80) return true;
  // 纯 URL 行
  if (/^https?:\/\/\S+$/.test(t)) return true;
  // 大量重复字符
  if (/(.)\1{20,}/.test(t)) return true;

  return false;
}

/** 分句 */
function splitSentences(text) {
  return text
    .split(/[。！？\n]+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- 候选项打分 ----------

const SIGNALS = [
  { re: /(我习惯|我喜欢|我不喜欢|以后都|以后要|记住|一律|总是用|别再用|不要再|偏好|习惯用)/, kind: 'preference', weight: 10 },
  { re: /(决定|选择|采用|定为|最终|定稿|敲定|方案是|就这个|确认用)/, kind: 'decision', weight: 8 },
  { re: /(发现|根因|原因是|验证过|确认了|结论是|原来是|踩了.*坑|注意.*坑)/, kind: 'learning', weight: 8 },
  { re: /(待办|TODO|还没|下次|稍后|未完成|待跟进|之后再说)/i, kind: 'todo', weight: 7 },
  { re: /(github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/, kind: 'project', weight: 9 },
  { re: /(我(的|们)项目|这个项目|仓库名|命名为|叫做)/, kind: 'project', weight: 5 },
];

function scoreSentence(sentence) {
  let best = null;
  for (const s of SIGNALS) {
    if (s.re.test(sentence)) {
      if (!best || s.weight > best.weight) best = { kind: s.kind, weight: s.weight };
    }
  }
  return best;
}

// ---------- 阶段 1：生成候选包 ----------

/**
 * 从事件流生成候选包。
 *
 * @param {Array} events    统一事件流
 * @param {object} [opts]
 * @param {number} [opts.maxPerKind]   每类最多候选数（默认 15）
 * @param {number} [opts.maxTotal]     总候选上限（默认 80）
 * @param {number} [opts.recentSessions] 只看最近 N 个会话（默认 20）
 * @returns {{candidates: object, stats: object}}
 */
export function buildCandidates(events, opts = {}) {
  const { maxPerKind = 15, maxTotal = 80, recentSessions = 20 } = opts;

  // 按会话最后活跃时间排序，只保留最近的会话（老会话记忆价值衰减）
  const sessionLast = new Map();
  for (const e of events) {
    if (typeof e.time === 'number') {
      const cur = sessionLast.get(e.sessionId) || 0;
      if (e.time > cur) sessionLast.set(e.sessionId, e.time);
    }
  }
  const recentIds = new Set(
    [...sessionLast.entries()].sort((a, b) => b[1] - a[1]).slice(0, recentSessions).map((x) => x[0]),
  );

  const buckets = { project: [], preference: [], decision: [], learning: [], todo: [] };
  const seen = new Set();
  let scanned = 0;
  let filtered = 0;

  for (const e of events) {
    if (e.role !== 'user' && e.role !== 'assistant') continue;
    if (recentIds.size > 0 && !recentIds.has(e.sessionId)) continue;
    scanned += 1;

    const text = (e.text || '').trim();
    if (isNoise(text)) {
      filtered += 1;
      continue;
    }

    for (const sentence of splitSentences(text)) {
      if (isNoise(sentence)) continue;
      const sig = scoreSentence(sentence);
      if (!sig) continue;

      // 去重
      const fp = sentence.slice(0, 50).replace(/\s+/g, '');
      if (seen.has(fp)) continue;
      seen.add(fp);

      if (buckets[sig.kind].length >= maxPerKind * 3) continue; // 先多收，后面按权重截断
      buckets[sig.kind].push({
        text: sentence.length > 300 ? sentence.slice(0, 300) + '…' : sentence,
        weight: sig.weight,
        time: e.time,
        role: e.role,
        tool: e.tool,
        sessionId: e.sessionId,
      });
    }
  }

  // 每类按权重降序 + 时间降序，截取前 maxPerKind
  const picked = {};
  let total = 0;
  for (const [kind, items] of Object.entries(buckets)) {
    items.sort((a, b) => b.weight - a.weight || (b.time || 0) - (a.time || 0));
    const take = items.slice(0, Math.min(maxPerKind, maxTotal - total));
    picked[kind] = take;
    total += take.length;
  }

  return {
    candidates: picked,
    stats: {
      scanned,
      filtered,
      totalCandidates: total,
      byKind: Object.fromEntries(Object.entries(picked).map(([k, v]) => [k, v.length])),
      recentSessions: recentIds.size,
    },
  };
}

// ---------- 候选包渲染 ----------

/**
 * 渲染成给 AI 阅读的候选包（Markdown）。
 */
export function renderCandidatePack(candidates, stats = {}) {
  const L = [];
  L.push('# 记忆候选包');
  L.push('');
  L.push('> 这是从历史会话中机械筛选出的候选记忆，**尚未精炼**。');
  L.push('> 请按文末的「提炼指令」处理。');
  L.push('');
  if (stats.scanned != null) {
    L.push(`- 扫描事件：${stats.scanned} 条`);
    L.push(`- 过滤噪声：${stats.filtered} 条`);
    L.push(`- 候选项：${stats.totalCandidates} 条`);
    L.push(`- 涉及会话：${stats.recentSessions} 个（最近的）`);
    L.push('');
  }

  for (const [kind, cfg] of Object.entries(MEMORY_KINDS)) {
    const items = candidates[kind] || [];
    L.push(`## ${cfg.label}（${items.length} 条候选）`);
    L.push('');
    L.push(`_筛选标准：${cfg.hint}_`);
    L.push('');
    if (items.length === 0) {
      L.push('（无候选）');
    } else {
      items.forEach((it, i) => {
        const date = it.time ? new Date(it.time).toLocaleDateString('zh-CN') : '';
        const meta = [date, it.role, it.tool].filter(Boolean).join(' · ');
        L.push(`${i + 1}. ${it.text}`);
        if (meta) L.push(`   ＿ ${meta}`);
      });
    }
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('## 提炼指令（给 AI）');
  L.push('');
  L.push('请阅读上面的候选，产出**精炼后的记忆条目**，要求：');
  L.push('');
  L.push('1. **合并重复**：多条候选说的是同一件事时合成一条');
  L.push('2. **删除噪声**：与用户长期工作无关的、临时的、一次性的一次性内容全部丢弃');
  L.push('3. **改写为陈述句**：每条独立可读，不依赖上下文');
  L.push('4. **保留具体信息**：仓库名、技术选型、明确说过的偏好，不要泛化成「用户喜欢用工具」这种空话');
  L.push('5. **数量控制**：每类 0-8 条，宁缺毋滥；没有值得记的就留空');
  L.push('6. **标注置信度**：`高` = 用户明确说过；`中` = 从行为推断；`低` = 仅为可能');
  L.push('');
  L.push('输出格式（严格遵循）：');
  L.push('');
  L.push('```markdown');
  L.push('## 项目');
  L.push('- [高] 具体内容');
  L.push('');
  L.push('## 偏好');
  L.push('- [高] 具体内容');
  L.push('...');
  L.push('```');
  L.push('');
  L.push('输出纯 Markdown，不要额外解释。');

  return L.join('\n');
}

// ---------- 写候选包 ----------

/**
 * 把候选包写到磁盘。
 * @returns {{file:string, stats:object}}
 */
export function writeCandidatePack(dir, events, opts = {}) {
  const { candidates, stats } = buildCandidates(events, opts);
  const md = renderCandidatePack(candidates, stats);

  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'candidates.md');
  fs.writeFileSync(file, md, 'utf8');

  // 也存一份 JSON 便于程序处理
  const jsonFile = path.join(dir, 'candidates.json');
  fs.writeFileSync(
    jsonFile,
    JSON.stringify({ generatedAt: new Date().toISOString(), stats, candidates }, null, 2),
    'utf8',
  );

  return { file, jsonFile, stats, bytes: Buffer.byteLength(md, 'utf8') };
}

// ---------- 阶段 2：保存 AI 精炼结果 ----------

/**
 * 保存 AI 产出的记忆正文。
 * @param {string} dir
 * @param {string} refinedText AI 输出的 Markdown
 * @param {object} [meta]
 */
export function saveRefinedMemory(dir, refinedText, meta = {}) {
  fs.mkdirSync(dir, { recursive: true });

  const header = [
    '# 记忆摘要',
    '',
    `> 生成时间：${new Date().toLocaleString('zh-CN')}`,
    meta.source ? `> 提炼来源：${meta.source}` : null,
    meta.sessions ? `> 覆盖会话：${meta.sessions} 个` : null,
    '>',
    '> 本文件由 AI 从历史会话候选包中精炼生成，开新对话时可作为背景引用。',
    '',
  ]
    .filter((x) => x !== null)
    .join('\n');

  const body = String(refinedText || '').trim();
  const md = `${header}\n${body}\n`;

  const file = path.join(dir, 'summary.md');
  fs.writeFileSync(file, md, 'utf8');

  // 索引
  const indexPath = path.join(dir, 'index.json');
  let index = { entries: [] };
  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch {
      /* 重建 */
    }
  }
  index.entries = index.entries || [];
  index.entries.push({
    generatedAt: new Date().toISOString(),
    file: 'summary.md',
    meta,
  });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');

  return { file, bytes: Buffer.byteLength(md, 'utf8') };
}

/**
 * 读取已有记忆。
 */
export function readMemory(dir) {
  const mdFile = path.join(dir, 'summary.md');
  if (!fs.existsSync(mdFile)) return null;
  return {
    markdown: fs.readFileSync(mdFile, 'utf8'),
    mtime: fs.statSync(mdFile).mtime,
    file: mdFile,
  };
}
