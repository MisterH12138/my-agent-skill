/**
 * 密钥池核心
 *
 * 职责：
 *   1. 从环境变量 / .env / 配置文件收集多个 Key
 *   2. 维护每个 Key 的健康状态（可用 / 失效 / 限流）
 *   3. 提供「取一个可用 Key」的接口，支持轮询与故障转移
 *   4. 持久化状态，供下次启动复用
 *
 * 设计原则：
 *   - 永远不打印明文 Key
 *   - 状态文件不含 Key 本身，只含指纹
 *   - 单点失败不影响整体
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { PLATFORMS, resolveEndpoint, maskKey, isPlaceholder } from './platforms.mjs';

const HOME = os.homedir();

/** 状态文件位置 */
export function defaultStateDir() {
  return process.env.KEYKEEPER_HOME || path.join(HOME, '.keykeeper');
}

function statePath(dir) {
  return path.join(dir, 'state.json');
}

/** Key 指纹：用于在不存明文的前提下标识 Key */
export function fingerprint(key) {
  if (!key) return null;
  return crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 16);
}

// ---------- 配置加载 ----------

/** 解析 .env 内容 */
export function parseDotenv(text) {
  const out = {};
  if (!text) return out;
  const clean = String(text).replace(/^\uFEFF/, '');
  for (let line of clean.split(/\r?\n/)) {
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
    if (k) out[k] = v;
  }
  return out;
}

/** 向上查找 .env */
export function findDotenv(startDirs = [process.cwd()]) {
  const found = [];
  for (const start of startDirs) {
    let cur = path.resolve(start);
    for (let i = 0; i < 8; i++) {
      const p = path.join(cur, '.env');
      if (fs.existsSync(p)) found.push(p);
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return [...new Set(found)];
}

/**
 * 收集某个平台的所有候选 Key。
 *
 * 支持三种来源，按优先级：
 *   1. 环境变量 KEY_NAME（支持 KEY_NAME_1、KEY_NAME_2 形式的多 Key）
 *   2. .env 文件同名字段
 *   3. config/keys.json 里显式配置
 *
 * @returns {{key:string, source:string, index:number}[]}
 */
export function collectKeys(platformId, opts = {}) {
  const p = PLATFORMS[platformId];
  if (!p) return [];

  const envFiles = opts.envFiles || findDotenv(opts.searchDirs || [process.cwd()]);
  const envFileValues = {};
  for (const f of envFiles) {
    try {
      Object.assign(envFileValues, parseDotenv(fs.readFileSync(f, 'utf8')));
    } catch {
      /* 忽略 */
    }
  }

  const explicit = opts.configKeys?.[platformId] || [];
  const out = [];
  let idx = 0;

  // 1. config 里显式配置的（最高优先级）
  for (const k of explicit) {
    if (k && !isPlaceholder(k)) {
      out.push({ key: k, source: 'config/keys.json', index: idx++ });
    }
  }

  // 2. 环境变量 + .env，支持多 Key 后缀
  for (const baseName of p.envKeys) {
    // 单 Key 形式
    const single = process.env[baseName] || envFileValues[baseName];
    if (single && !isPlaceholder(single)) {
      out.push({
        key: single,
        source: process.env[baseName] ? `环境变量 ${baseName}` : `.env 中的 ${baseName}`,
        index: idx++,
      });
    }
    // 多 Key 形式: NAME_1, NAME_2 ...
    for (let i = 1; i <= 10; i++) {
      const name = `${baseName}_${i}`;
      const v = process.env[name] || envFileValues[name];
      if (v && !isPlaceholder(v)) {
        out.push({
          key: v,
          source: process.env[name] ? `环境变量 ${name}` : `.env 中的 ${name}`,
          index: idx++,
        });
      }
    }
  }

  // 去重（同一个 Key 只留第一次出现的）
  const seen = new Set();
  return out.filter((k) => {
    const fp = fingerprint(k.key);
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });
}

// ---------- 状态管理 ----------

/** 读取持久化状态 */
export function loadState(dir = defaultStateDir()) {
  const p = statePath(dir);
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      return raw && typeof raw === 'object' ? raw : { keys: {} };
    }
  } catch {
    /* 损坏则重建 */
  }
  return { keys: {} };
}

/** 保存状态（只存指纹，不存明文） */
export function saveState(state, dir = defaultStateDir()) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(statePath(dir), JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

// ---------- 健康检查 ----------

/**
 * 测试单个 Key 是否可用。
 *
 * 用平台提供的 models 接口做轻量探活：
 *   - 200 → 可用
 *   - 401/403 → 无效
 *   - 429 → 限流（暂时不可用，但 Key 有效）
 *   - 网络错误 → 未知
 *
 * @returns {Promise<{status:'ok'|'invalid'|'rate-limited'|'unknown', code:number|null, detail:string, ms:number}>}
 */
export async function checkKey(platformId, apiKey, opts = {}) {
  const p = PLATFORMS[platformId];
  if (!p) return { status: 'unknown', code: null, detail: '未知平台', ms: 0 };

  const { baseURL } = resolveEndpoint(platformId, apiKey);
  const url = `${baseURL.replace(/\/+$/, '')}${p.healthPath || '/models'}`;

  const headers = { Accept: 'application/json', ...(p.extraHeaders || {}) };
  if (p.authStyle === 'bearer' && apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const timeoutMs = opts.timeoutMs || 20000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();

  try {
    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
    const ms = Date.now() - t0;

    if (res.ok) {
      return { status: 'ok', code: res.status, detail: '可用', ms };
    }
    if (res.status === 401 || res.status === 403) {
      return { status: 'invalid', code: res.status, detail: `Key 无效或权限不足 (HTTP ${res.status})`, ms };
    }
    if (res.status === 429) {
      return { status: 'rate-limited', code: res.status, detail: '限流中（Key 有效）', ms };
    }
    if (res.status === 404) {
      // 有些平台的 models 路径不同，404 不代表 Key 无效
      return { status: 'ok', code: res.status, detail: '端点可达（探活路径不同，视为可用）', ms };
    }
    return { status: 'unknown', code: res.status, detail: `异常响应 HTTP ${res.status}`, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    const detail = e.name === 'AbortError' ? '请求超时' : `网络错误: ${e.message}`;
    return { status: 'unknown', code: null, detail, ms };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 池操作 ----------

/**
 * 构建某个平台的密钥池视图（Key + 状态）。
 */
export function buildPool(platformId, opts = {}) {
  const keys = collectKeys(platformId, opts);
  const state = opts.state || loadState(opts.stateDir);
  return keys.map((k) => {
    const fp = fingerprint(k.key);
    const rec = state.keys[fp] || {};
    return {
      ...k,
      fingerprint: fp,
      masked: maskKey(k.key),
      endpoint: resolveEndpoint(platformId, k.key),
      lastStatus: rec.status || 'unknown',
      lastCheck: rec.lastCheck || null,
      lastError: rec.error || null,
      successCount: rec.successCount || 0,
      failCount: rec.failCount || 0,
    };
  });
}

/**
 * 更新某个 Key 的状态记录。
 */
export function recordResult(state, fp, result, platformId) {
  state.keys = state.keys || {};
  const rec = state.keys[fp] || {};
  rec.platform = platformId;
  rec.status = result.status;
  rec.lastCheck = new Date().toISOString();
  rec.error = result.status === 'ok' ? null : result.detail;
  if (result.status === 'ok') rec.successCount = (rec.successCount || 0) + 1;
  else rec.failCount = (rec.failCount || 0) + 1;
  state.keys[fp] = rec;
  return rec;
}

/**
 * 从池中选一个可用的 Key。
 * 策略：优先最近一次检测为 ok 的，其次 unknown，跳过 invalid/rate-limited。
 */
export function pickKey(platformId, opts = {}) {
  const pool = buildPool(platformId, opts);
  if (pool.length === 0) return null;

  const rank = { ok: 0, unknown: 1, 'rate-limited': 2, invalid: 3 };
  const sorted = [...pool].sort((a, b) => {
    const ra = rank[a.lastStatus] ?? 9;
    const rb = rank[b.lastStatus] ?? 9;
    if (ra !== rb) return ra - rb;
    return a.failCount - b.failCount; // 失败少的优先
  });

  return sorted[0];
}

/**
 * 轮询式取 Key（在可用集合中按顺序轮转）。
 */
export function rotateKey(platformId, opts = {}) {
  const pool = buildPool(platformId, opts);
  const usable = pool.filter((k) => k.lastStatus !== 'invalid');
  if (usable.length === 0) return null;

  const state = opts.state || loadState(opts.stateDir);
  state.rr = state.rr || {};
  const idx = (state.rr[platformId] || 0) % usable.length;
  state.rr[platformId] = idx + 1;
  return { pick: usable[idx], index: idx, total: usable.length };
}
