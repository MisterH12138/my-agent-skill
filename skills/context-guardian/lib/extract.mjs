/**
 * 跨平台数据提取层
 *
 * 设计目标：不绑定任何特定 AI 工具。
 *
 * 三层结构：
 *   1. 内置解析器（known）：为已知格式精确解析
 *   2. 通用解析器（generic）：任意 JSONL/JSON 文件，自动嗅探字段
 *   3. 自定义解析器（custom）：用户可通过 config/parsers.json 注册
 *
 * 所有解析器输出统一结构，上层（画像/记忆）不感知来源差异。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const HOME = os.homedir();

/** 统一的事件结构（解析器需产出这个形状） */
export const EVENT_SHAPE = {
  time: 'number|null',        // 毫秒时间戳
  role: 'string|null',        // user / assistant / system
  text: 'string|null',        // 文本内容（截断到 2000 字符）
  toolName: 'string|null',    // 工具名
  model: 'string|null',       // 模型名
  provider: 'string|null',
  filePaths: 'string[]',      // 涉及的文件路径
  usage: 'object|null',       // {input, output, cacheRead, total}
};

// ---------- 通用工具 ----------

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function walkFiles(dir, filter, maxDepth = 8) {
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

/** 多帧 zstd 解压 */
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
      /* 忽略坏帧 */
    }
  }
  return text;
}

/**
 * 从任意对象提取 usage（兼容各种命名）。
 */
export function extractUsage(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;

    const u = cur.usage;
    if (u && typeof u === 'object') {
      const input = u.inputTokens ?? u.input_tokens ?? u.prompt_tokens ?? u.promptTokens ?? 0;
      const output = u.outputTokens ?? u.output_tokens ?? u.completion_tokens ?? u.completionTokens ?? 0;
      const cacheRead =
        u.cacheReadTokens ?? u.cache_read_input_tokens ?? u.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0;
      const total = u.totalTokens ?? u.total_tokens ?? (input + output + cacheRead);
      if (total > 0 || input > 0 || output > 0) return { input, output, cacheRead, total };
    }
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

/**
 * 从任意文本中提取本地文件路径（跨平台）。
 *
 * 只接受本地文件路径，明确排除 URL：
 *   - 先剔除所有 http(s):// 与 ftp:// 片段
 *   - Windows 盘符路径 C:\... 或 C:/...
 *   - POSIX 绝对路径 /a/b/c.ext（但不能是 //host 协议相对或 /search?q= 这类）
 */
export function extractFilePaths(text) {
  if (!text || typeof text !== 'string') return [];
  const out = new Set();

  // 先去掉 URL，避免 github.com/x/y.md 被当成路径
  const cleaned = text.replace(/\b(?:https?|ftp|file|oss|s3):\/\/[^\s"'<>)\]]+/gi, ' ');
  // 也去掉裸域名形式（www.x.com/a.md）
  const noDomain = cleaned.replace(/\b(?:www\.)?[\w-]+(?:\.[\w-]+)+\/[^\s"'<>)\]]*/g, ' ');

  // Windows 盘符路径
  const winRe = /\b[A-Za-z]:[\\/](?:[^\s"'<>|*?\n\r:\\/]+[\\/])*[^\s"'<>|*?\n\r:\\/]+\.[A-Za-z0-9]{1,8}\b/g;
  // POSIX 绝对路径（要求至少两级目录，且不含查询串）
  const posixRe = /(?:^|[\s"'`(])(\/(?:[\w.\-]+\/)+[\w.\-]+\.[A-Za-z0-9]{1,8})\b/g;

  for (const m of noDomain.matchAll(winRe)) {
    out.add(m[0].replace(/\\/g, '/'));
  }
  for (const m of noDomain.matchAll(posixRe)) {
    const p = m[1];
    // 排除明显的非文件路径
    if (/^\/(search|api|v\d|help|docs|about|home)\b/.test(p)) continue;
    out.add(p);
  }
  return [...out].slice(0, 30);
}

function truncate(s, n = 2000) {
  if (!s) return null;
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// ---------- 内置解析器 ----------

/**
 * DeepSeek Harness：<sessions>/<workspace>/<uuid>/session.v4.jsonl.zstd
 */
export function parseDsh(file) {
  let text = '';
  try {
    text = decompressMultiFrame(fs.readFileSync(file));
  } catch {
    return [];
  }
  const events = [];
  let model = null;
  let provider = null;

  for (const line of text.split('\n')) {
    if (!line) continue;
    const o = safeJson(line);
    if (!o) continue;

    if (o.type === 'model/selection' && o.data) {
      model = o.data.model || model;
      provider = o.data.provider || provider;
    }

    const time = typeof o.time === 'number' ? o.time : null;

    if (o.type === 'user/message' && o.data) {
      const c = o.data.content;
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : x.text || '')).join(' ') : '';
      if (t) events.push({ time, role: 'user', text: truncate(t), model: null, provider: null, toolName: null, filePaths: extractFilePaths(t), usage: null });
    }

    if (o.type === 'assistant/message' && o.data) {
      const msg = o.data.message || {};
      const parts = Array.isArray(msg.content) ? msg.content : [];
      const textPart = parts.filter((p) => p.type === 'text').map((p) => p.text).join(' ');
      const toolParts = parts.filter((p) => p.type === 'tool-call');
      for (const tp of toolParts) {
        events.push({
          time,
          role: 'tool',
          text: truncate(String(tp.name || '')),
          toolName: tp.name || null,
          model: msg.source?.model || model,
          provider: msg.source?.provider || provider,
          filePaths: extractFilePaths(String(tp.arguments || '')),
          usage: null,
        });
      }
      if (textPart) {
        events.push({
          time,
          role: 'assistant',
          text: truncate(textPart),
          toolName: null,
          model: msg.source?.model || model,
          provider: msg.source?.provider || provider,
          filePaths: extractFilePaths(textPart),
          usage: null,
        });
      }
      const u = extractUsage(o);
      if (u) {
        events.push({ time, role: 'usage', text: null, toolName: null, model: msg.source?.model || model, provider: msg.source?.provider || provider, filePaths: [], usage: u });
      }
    }
  }
  return events;
}

/**
 * Claude Code：<projects>/<encoded-path>/<session>.jsonl
 * 每行一条消息，形如 {type, message:{role,content}, timestamp, ...}
 */
export function parseClaude(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const o = safeJson(line);
    if (!o) continue;

    const time = o.timestamp ? Date.parse(o.timestamp) : null;
    const msg = o.message || {};
    const role = msg.role || o.type;
    let contentText = '';
    if (typeof msg.content === 'string') contentText = msg.content;
    else if (Array.isArray(msg.content)) {
      contentText = msg.content
        .map((c) => (typeof c === 'string' ? c : c.type === 'text' ? c.text : c.type === 'tool_use' ? `[tool:${c.name}]` : ''))
        .filter(Boolean)
        .join(' ');
    }

    if (contentText && (role === 'user' || role === 'assistant')) {
      events.push({
        time: Number.isNaN(time) ? null : time,
        role,
        text: truncate(contentText),
        toolName: null,
        model: msg.model || null,
        provider: 'claude',
        filePaths: extractFilePaths(contentText),
        usage: null,
      });
    }
    const u = extractUsage(o);
    if (u) {
      events.push({
        time: Number.isNaN(time) ? null : time,
        role: 'usage',
        text: null,
        toolName: null,
        model: msg.model || null,
        provider: 'claude',
        filePaths: [],
        usage: u,
      });
    }
  }
  return events;
}

/**
 * 通用 JSONL 解析器
 *
 * 用于任何未明确支持的 AI 工具。策略：
 *   - 逐行 JSON
 *   - 用通用启发式找 role / content / timestamp / usage
 *   - 找不到就跳过，绝不报错
 */
export function parseGeneric(file) {
  let text;
  try {
    const buf = fs.readFileSync(file);
    // 尝试当 zstd 处理
    if (buf.length > 4 && buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd) {
      text = decompressMultiFrame(buf);
    } else {
      text = buf.toString('utf8');
    }
  } catch {
    return [];
  }
  if (!text || !text.includes('\n')) return [];

  const events = [];
  const lines = text.split('\n');
  if (lines.length < 2) return []; // 不像 JSONL

  for (const line of lines) {
    if (!line.trim() || line.length > 500_000) continue;
    const o = safeJson(line);
    if (!o || typeof o !== 'object') continue;

    // 时间
    let time = null;
    for (const k of ['time', 'timestamp', 'createdAt', 'created_at', 'ts', 'date']) {
      const v = o[k] ?? (o.data && o.data[k]);
      if (typeof v === 'number') { time = v; break; }
      if (typeof v === 'string') { const t = Date.parse(v); if (!Number.isNaN(t)) { time = t; break; } }
    }

    // 角色
    let role = null;
    for (const k of ['role', 'type', 'kind', 'author']) {
      const v = o[k] ?? (o.data && o.data[k]) ?? (o.message && o.message[k]);
      if (typeof v === 'string') { role = v.toLowerCase(); break; }
    }

    // 文本
    let contentText = '';
    const candidates = [o.content, o.text, o.message?.content, o.data?.content, o.data?.text, o.message?.text];
    for (const c of candidates) {
      if (typeof c === 'string') { contentText = c; break; }
      if (Array.isArray(c)) {
        contentText = c.map((x) => (typeof x === 'string' ? x : x?.text || '')).filter(Boolean).join(' ');
        if (contentText) break;
      }
    }

    // 模型
    let model = null;
    for (const k of ['model', 'modelId', 'model_id', 'modelName']) {
      const v = o[k] ?? (o.data && o.data[k]) ?? (o.message && o.message[k]);
      if (typeof v === 'string' && v.length < 100) { model = v; break; }
    }

    const u = extractUsage(o);

    if (contentText || u) {
      events.push({
        time,
        role: role || (u ? 'usage' : null),
        text: contentText ? truncate(contentText) : null,
        toolName: null,
        model,
        provider: 'generic',
        filePaths: contentText ? extractFilePaths(contentText) : [],
        usage: u,
      });
    }
  }
  return events;
}

// ---------- 工具注册表 ----------

/**
 * 已知工具定义。
 * dirs 支持函数（延迟求值，便于测试注入）。
 */
export const KNOWN_TOOLS = [
  {
    id: 'dsh',
    label: 'DeepSeek Harness',
    dirs: [path.join(HOME, '.dsh', 'sessions')],
    match: (f) => f.endsWith('.jsonl.zstd') || f.endsWith('.jsonl'),
    parse: parseDsh,
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    dirs: [path.join(HOME, '.claude', 'projects')],
    match: (f) => f.endsWith('.jsonl'),
    parse: parseClaude,
  },
  {
    id: 'codex',
    label: 'Codex',
    dirs: [path.join(HOME, '.codex', 'sessions')],
    match: (f) => f.endsWith('.jsonl'),
    parse: parseGeneric,
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    dirs: [path.join(HOME, '.openclaw', 'sessions')],
    match: (f) => f.endsWith('.jsonl') || f.endsWith('.json'),
    parse: parseGeneric,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    dirs: [path.join(HOME, '.cursor', 'chats')],
    match: (f) => f.endsWith('.jsonl') || f.endsWith('.json'),
    parse: parseGeneric,
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    dirs: [path.join(HOME, '.gemini', 'tmp')],
    match: (f) => f.endsWith('.json') || f.endsWith('.jsonl'),
    parse: parseGeneric,
  },
  {
    id: 'qwen-code',
    label: 'Qwen Code',
    dirs: [path.join(HOME, '.qwen', 'sessions')],
    match: (f) => f.endsWith('.jsonl') || f.endsWith('.json'),
    parse: parseGeneric,
  },
  {
    id: 'kimi-code',
    label: 'Kimi Code',
    dirs: [path.join(HOME, '.kimi-code', 'sessions')],
    match: (f) => f.endsWith('.jsonl') || f.endsWith('.json'),
    parse: parseGeneric,
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    dirs: [path.join(HOME, '.local', 'share', 'opencode')],
    match: (f) => f.endsWith('.json') || f.endsWith('.jsonl'),
    parse: parseGeneric,
  },
  {
    id: 'aider',
    label: 'Aider',
    dirs: [path.join(HOME, '.aider')],
    match: (f) => f.endsWith('.jsonl') || f.endsWith('.md'),
    parse: parseGeneric,
  },
];

/**
 * 加载自定义解析器配置（config/parsers.json）。
 * 用户可以注册任意工具的目录与格式。
 */
export function loadCustomTools(skillRoot) {
  const cfgPath = path.join(skillRoot, 'config', 'parsers.json');
  if (!fs.existsSync(cfgPath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
    return (raw.tools || []).map((t) => ({
      id: t.id,
      label: t.label || t.id,
      dirs: (t.dirs || []).map((d) => d.replace(/^~/, HOME)),
      match: () => true,
      parse: parseGeneric,
      custom: true,
    }));
  } catch {
    return [];
  }
}

/**
 * 收集所有可用工具（内置 + 自定义），并探测哪些存在。
 */
export function listTools(skillRoot) {
  const custom = loadCustomTools(skillRoot);
  const all = [...KNOWN_TOOLS, ...custom.filter((c) => !KNOWN_TOOLS.some((k) => k.id === c.id))];
  return all.map((t) => {
    const existing = t.dirs.filter((d) => fs.existsSync(d));
    return { id: t.id, label: t.label, dirs: t.dirs, existing, detected: existing.length > 0, def: t };
  });
}

/**
 * 生成会话 ID。
 * 优先用父目录名（多数工具把 uuid 放在目录上），
 * 否则用文件名去掉扩展名。
 * 关键：不能直接用文件名——很多工具所有会话都叫 session.v4.jsonl，会全部撞车。
 */
function makeSessionId(file) {
  const base = path.basename(file).replace(/\.(jsonl\.zstd|jsonl|json|ndjson|md)$/i, '');
  const parent = path.basename(path.dirname(file));
  // 父目录看起来像会话标识（uuid / 长 hex / session-xxx）时优先用它
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(parent) || /^session-/i.test(parent) || parent.length > 20) {
    return parent;
  }
  // 文件名本身有区分度时用它
  if (base && base !== 'session' && !/^session\.v\d+$/i.test(base)) return base;
  return parent;
}

/**
 * 读取某个工具的全部事件（自动选择解析器）。
 * @returns {Array} 事件数组，每条带 sessionId
 */
export function readToolEvents(toolInfo, opts = {}) {
  const { maxFiles = 500, maxEvents = 200_000 } = opts;
  const events = [];
  const { def } = toolInfo;

  for (const dir of toolInfo.existing) {
    let files = [];
    try {
      files = walkFiles(dir, def.match).slice(0, maxFiles);
    } catch {
      continue;
    }
    for (const f of files) {
      let evs = [];
      try {
        evs = def.parse(f) || [];
      } catch {
        continue;
      }
      const sessionId = makeSessionId(f);
      for (const e of evs) {
        e.sessionId = sessionId;
        e.tool = toolInfo.id;
        events.push(e);
        if (events.length >= maxEvents) return events;
      }
    }
  }
  return events;
}
