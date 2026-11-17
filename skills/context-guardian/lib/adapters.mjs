/**
 * 多工具会话日志适配层
 *
 * 不同 AI 工具的会话存储格式各不相同。本层负责：
 *   1. 探测本机装了哪些工具
 *   2. 从各自的存储中读取会话与 token 用量
 *   3. 归一化成统一结构
 *
 * 设计原则：找不到就当没有，绝不因为某个工具格式变化而整体失败。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const HOME = os.homedir();

/**
 * 工具清单。
 * - dirs: 候选数据目录（按优先级）
 * - reader: 读取函数，返回 {sessions: [...]}
 *
 * 说明：只对能确定格式的工具实现真实读取；
 * 其余工具标记为 detected-only（只报告安装了，不猜数据）。
 */
export const TOOLS = [
  {
    id: 'dsh',
    label: 'DeepSeek Harness',
    dirs: [path.join(HOME, '.dsh', 'sessions')],
    format: 'dsh-zstd-jsonl',
    reader: readDshSessions,
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    dirs: [path.join(HOME, '.claude', 'projects')],
    format: 'claude-jsonl',
    reader: readClaudeSessions,
  },
  {
    id: 'codex',
    label: 'Codex',
    dirs: [path.join(HOME, '.codex', 'sessions')],
    format: 'codex-jsonl',
    reader: readCodexSessions,
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    dirs: [path.join(HOME, '.openclaw', 'sessions'), path.join(HOME, '.openclaw', 'agents')],
    format: 'unknown',
    reader: null,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    dirs: [path.join(HOME, '.cursor')],
    format: 'sqlite',
    reader: null,
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    dirs: [path.join(HOME, '.gemini', 'tmp')],
    format: 'json',
    reader: null,
  },
];

// ---------- 通用工具函数 ----------

function listFilesRecursive(dir, filter, maxDepth = 6) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (filter(e.name)) out.push(p);
    }
  };
  walk(dir, 0);
  return out;
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** 从任意对象里挖出 usage 字段（兼容多种命名） */
export function extractUsage(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;

    // 直接命中
    const u = cur.usage;
    if (u && typeof u === 'object') {
      const input =
        u.inputTokens ?? u.input_tokens ?? u.prompt_tokens ?? u.promptTokens ?? 0;
      const output =
        u.outputTokens ?? u.output_tokens ?? u.completion_tokens ?? u.completionTokens ?? 0;
      const cacheRead =
        u.cacheReadTokens ?? u.cache_read_input_tokens ?? u.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0;
      const total = u.totalTokens ?? u.total_tokens ?? (input + output + cacheRead);
      if (total > 0 || input > 0 || output > 0) {
        return { input, output, cacheRead, total };
      }
    }

    // 顶层直接是驼峰字段（DSH 的写法）
    if (cur.inputTokens !== undefined || cur.outputTokens !== undefined) {
      return {
        input: cur.inputTokens || 0,
        output: cur.outputTokens || 0,
        cacheRead: cur.cacheReadTokens || 0,
        total: cur.totalTokens || (cur.inputTokens || 0) + (cur.outputTokens || 0),
      };
    }

    for (const k of Object.keys(cur)) {
      const v = cur[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

/** 在多帧 zstd 中解压（DSH 专用） */
function decompressMultiFrame(buf) {
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const offsets = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) {
      offsets.push(i);
    }
  }
  let text = '';
  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i];
    const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length;
    try {
      text += zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8');
    } catch {
      /* 单帧损坏忽略 */
    }
  }
  return text;
}

/**
 * 计算单次请求的「上下文规模」。
 *
 * 关键事实（实测确认）：
 *   - total = input + output + cacheRead
 *   - total 随对话推进单调增长（11k → 12k → 16k → 20k → 34k ...）
 *   - 下一次请求的 cacheRead 会重置，重新累计
 *   所以「上下文占用」应取 total，而不是 input + cacheRead（那会重复累加）。
 */
function contextSizeOf(u) {
  if (!u) return 0;
  if (u.total > 0) return u.total;
  return (u.input || 0) + (u.output || 0) + (u.cacheRead || 0);
}

// ---------- 各工具读取器 ----------

/** DSH：sessions/<workspace>/<uuid>/session.v4.jsonl.zstd */
function readDshSessions(dir) {
  const files = listFilesRecursive(dir, (n) => n.endsWith('.zstd'));
  const sessions = [];
  for (const f of files) {
    let text = '';
    try {
      text = decompressMultiFrame(fs.readFileSync(f));
    } catch {
      continue;
    }
    if (!text) continue;
    let last = null;
    let calls = 0;
    let title = '';
    let model = '';
    let lastTime = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      const o = safeJson(line);
      if (!o) continue;
      if (o.type === 'session/title') {
        title = (o.data && o.data.title) || o.title || title;
      }
      if (o.type === 'model/selection' && o.data && o.data.model) {
        model = o.data.model;
      }
      if (typeof o.time === 'number') lastTime = Math.max(lastTime, o.time);
      const u = extractUsage(o);
      if (u) {
        last = u;
        calls += 1;
      }
    }
    if (!last) continue;
    sessions.push({
      tool: 'dsh',
      id: path.basename(path.dirname(f)),
      file: f,
      title,
      model,
      lastTime,
      calls,
      // DSH 的 last usage 反映最后一次请求的上下文规模：
      // input + cacheRead 即当时的完整上下文
      contextTokens: contextSizeOf(last),
      lastUsage: last,
    });
  }
  return sessions;
}

/** Claude Code：<project>/<session>.jsonl，每行一条消息，带 usage */
function readClaudeSessions(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = listFilesRecursive(dir, (n) => n.endsWith('.jsonl'), 3);
  const sessions = [];
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    let last = null;
    let calls = 0;
    let lastTime = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const o = safeJson(line);
      if (!o) continue;
      if (o.timestamp) {
        const t = Date.parse(o.timestamp);
        if (!Number.isNaN(t)) lastTime = Math.max(lastTime, t);
      }
      const u = extractUsage(o);
      if (u) {
        last = u;
        calls += 1;
      }
    }
    if (!last) continue;
    sessions.push({
      tool: 'claude-code',
      id: path.basename(f, '.jsonl'),
      file: f,
      title: '',
      model: '',
      lastTime,
      calls,
      contextTokens: contextSizeOf(last),
      lastUsage: last,
    });
  }
  return sessions;
}

// Codex：sessions 目录下的 jsonl 文件
function readCodexSessions(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = listFilesRecursive(dir, (n) => n.endsWith('.jsonl'), 5);
  const sessions = [];
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    let last = null;
    let calls = 0;
    let lastTime = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const o = safeJson(line);
      if (!o) continue;
      if (o.timestamp) {
        const t = Date.parse(o.timestamp);
        if (!Number.isNaN(t)) lastTime = Math.max(lastTime, t);
      }
      const u = extractUsage(o);
      if (u) {
        last = u;
        calls += 1;
      }
    }
    if (!last) continue;
    sessions.push({
      tool: 'codex',
      id: path.basename(f, '.jsonl'),
      file: f,
      title: '',
      model: '',
      lastTime,
      calls,
      contextTokens: contextSizeOf(last),
      lastUsage: last,
    });
  }
  return sessions;
}

/**
 * 探测所有工具的安装状态与可读会话。
 * @param {object} [opts]
 * @param {string} [opts.onlyTool] 只查某个工具
 * @returns {{tools: object[], sessions: object[], readable: boolean}}
 */
export function discover(opts = {}) {
  const tools = [];
  const sessions = [];

  for (const t of TOOLS) {
    if (opts.onlyTool && t.id !== opts.onlyTool) continue;
    const existingDirs = t.dirs.filter((d) => fs.existsSync(d));
    const detected = existingDirs.length > 0;
    let readable = false;
    let count = 0;
    let err = null;

    if (detected && typeof t.reader === 'function') {
      try {
        const got = t.reader(existingDirs[0]);
        readable = true;
        count = got.length;
        sessions.push(...got);
      } catch (e) {
        err = e.message;
      }
    }

    tools.push({
      id: t.id,
      label: t.label,
      detected,
      readable,
      sessionCount: count,
      dirs: existingDirs,
      error: err,
    });
  }

  return { tools, sessions, readable: sessions.length > 0 };
}

/** 按最后活跃时间排序，取最新的 N 个 */
export function latestSessions(sessions, n = 5) {
  return [...sessions].sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0)).slice(0, n);
}
