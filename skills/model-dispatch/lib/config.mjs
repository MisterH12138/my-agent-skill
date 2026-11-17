/**
 * 配置加载
 *
 * 优先级（高 → 低）：
 *   1. 命令行参数
 *   2. 工作区 .env 文件（含父目录查找）
 *   3. 进程环境变量
 *   4. config/*.json 默认值
 *
 * 支持多平台多 Key，全部从 .env 读取，不硬编码。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 跨平台安全：用 fileURLToPath 解析，兼容 Windows 盘符与 POSIX 路径
const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 向上查找 .env，最多到盘符根 */
export function findEnvFiles(startDirs = [process.cwd()]) {
  const found = [];
  for (const start of startDirs) {
    let cur = path.resolve(start);
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const p = path.join(cur, '.env');
      if (fs.existsSync(p)) found.push(p);
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return [...new Set(found)];
}

/** 解析 .env（容忍 BOM、注释、export、引号） */
export function parseEnvFile(file) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  text = text.replace(/^\uFEFF/, '');
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim().replace(/^\uFEFF/, '');
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!k) continue;
    out[k] = v;
  }
  return out;
}

/** 合并环境：.env 优先于进程 env（便于用户覆盖） */
export function loadEnv({ cwd = process.cwd() } = {}) {
  const files = findEnvFiles([cwd, SKILL_ROOT]);
  const merged = {};
  // 先放进程环境
  for (const [k, v] of Object.entries(process.env)) merged[k] = v;
  // 再用 .env 覆盖（越靠近工作区的越优先，故逆序写）
  for (const f of files.reverse()) {
    Object.assign(merged, parseEnvFile(f));
  }
  return { env: merged, files };
}

function readJSONSafe(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

/**
 * 加载完整配置。
 * config/providers.json   —— 平台与密钥配置
 * config/routing.json     —— 权重与策略
 * config/models.json      —— 模型目录覆盖（可选）
 */
export function loadConfig({ cwd = process.cwd(), configDir = null } = {}) {
  const dir = configDir || path.join(SKILL_ROOT, 'config');
  const providers = readJSONSafe(path.join(dir, 'providers.json'), {});
  const routing = readJSONSafe(path.join(dir, 'routing.json'), {});
  const models = readJSONSafe(path.join(dir, 'models.json'), null);

  const { env, files } = loadEnv({ cwd });

  // 把 .env 中的凭证注入到各 provider 配置
  for (const [id, cfg] of Object.entries(providers.providers || {})) {
    if (!cfg || typeof cfg !== 'object') continue;
    if (cfg.envKey && !cfg.apiKey) {
      const v = env[cfg.envKey];
      if (v) cfg.apiKey = v;
    }
  }

  return {
    providers,
    routing,
    models,
    env,
    envFiles: files,
    configDir: dir,
  };
}

/** 将密钥类值脱敏，用于安全输出 */
export function maskSecret(v) {
  if (!v) return '<未设置>';
  const s = String(v);
  if (s.length <= 8) return '****';
  return `${s.slice(0, 3)}****${s.slice(-4)} (len=${s.length})`;
}
