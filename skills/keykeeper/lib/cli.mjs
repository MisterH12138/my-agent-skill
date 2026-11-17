#!/usr/bin/env node
/**
 * keykeeper —— 跨平台 API Key 池管理
 *
 * 子命令：
 *   status    查看所有平台 Key 池状态（不联网）
 *   test      逐个测试 Key 是否可用（联网）
 *   pick      选一个可用 Key（供其他技能调用）
 *   endpoint  显示某平台应使用的端点
 *   add       检查某个 Key 会走哪个端点（不保存）
 *
 * 设计原则：永远不输出明文 Key。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLATFORMS,
  resolveEndpoint,
  maskKey,
  isPlaceholder,
  listPlatformIds,
} from './platforms.mjs';
import {
  buildPool,
  checkKey,
  recordResult,
  loadState,
  saveState,
  defaultStateDir,
  findDotenv,
  fingerprint,
  pickKey,
  rotateKey,
  collectKeys,
} from './pool.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n && !n.startsWith('--')) {
        out.flags[k] = n;
        i++;
      } else {
        out.flags[k] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function loadConfigKeys() {
  const p = path.join(SKILL_ROOT, 'config', 'keys.json');
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    return raw.providers || {};
  } catch {
    return {};
  }
}

function baseOpts(args) {
  const configKeys = loadConfigKeys();
  return {
    searchDirs: [process.cwd(), SKILL_ROOT],
    envFiles: findDotenv([process.cwd(), SKILL_ROOT]),
    configKeys,
    stateDir: args.flags['state-dir'] || defaultStateDir(),
  };
}

const STATUS_ICON = {
  ok: '🟢',
  'rate-limited': '🟡',
  invalid: '🔴',
  unknown: '⚪',
};

const STATUS_LABEL = {
  ok: '可用',
  'rate-limited': '限流',
  invalid: '无效',
  unknown: '未检测',
};

// ---------- status ----------
function cmdStatus(args) {
  const opts = baseOpts(args);
  const platforms = args.flags.platform ? [args.flags.platform] : listPlatformIds();
  const state = loadState(opts.stateDir);

  console.log('Key 池状态');
  console.log('');
  console.log(`状态文件 : ${path.join(opts.stateDir, 'state.json')}`);
  console.log(`环境文件 : ${opts.envFiles.length ? opts.envFiles.join(' | ') : '(无 .env)'}`);
  console.log('');

  let totalKeys = 0;
  let totalUsable = 0;

  for (const id of platforms) {
    const p = PLATFORMS[id];
    const pool = buildPool(id, { ...opts, state });

    if (pool.length === 0) {
      if (args.flags.all) {
        console.log(`${p.label.padEnd(24)} 无 Key`);
      }
      continue;
    }

    totalKeys += pool.length;
    const usable = pool.filter((k) => k.lastStatus !== 'invalid').length;
    totalUsable += usable;

    console.log(`${p.label}（${usable}/${pool.length} 可用）`);
    for (const k of pool) {
      const icon = STATUS_ICON[k.lastStatus] || '⚪';
      const label = STATUS_LABEL[k.lastStatus] || k.lastStatus;
      const checked = k.lastCheck ? new Date(k.lastCheck).toLocaleString('zh-CN') : '未检测';
      console.log(`  ${icon} ${k.masked.padEnd(28)} ${label.padEnd(6)} ${k.endpoint.kind.padEnd(12)} ${k.source}`);
      if (args.flags.verbose) {
        console.log(`     端点: ${k.endpoint.kind}（${k.endpoint.reason}）`);
        console.log(`     上次检测: ${checked}  成功${k.successCount} 失败${k.failCount}`);
        if (k.lastError) console.log(`     错误: ${k.lastError}`);
      }
    }
    console.log('');
  }

  if (totalKeys === 0) {
    console.log('未检测到任何 Key。');
    console.log('');
    console.log('配置方式（任选其一）：');
    console.log('  1. 环境变量：setx DASHSCOPE_API_KEY "sk-..."');
    console.log('  2. 工作目录 .env：DASHSCOPE_API_KEY=sk-...');
    console.log('  3. 技能目录 config/keys.json');
    console.log('');
    console.log('多 Key 配置：DASHSCOPE_API_KEY_1、DASHSCOPE_API_KEY_2 …');
  } else {
    console.log(`合计：${totalUsable}/${totalKeys} 个 Key 可用`);
  }

  if (args.flags.json) {
    console.log('');
    console.log(JSON.stringify({ state }, null, 2));
  }
  return 0;
}

// ---------- test ----------
async function cmdTest(args) {
  const opts = baseOpts(args);
  const platforms = args.flags.platform ? [args.flags.platform] : listPlatformIds();
  const state = loadState(opts.stateDir);

  console.log('Key 健康检查');
  console.log('');

  let tested = 0;
  let passed = 0;

  for (const id of platforms) {
    const pool = buildPool(id, { ...opts, state });
    if (pool.length === 0) continue;

    console.log(`${PLATFORMS[id].label}`);
    for (const k of pool) {
      tested += 1;
      process.stdout.write(`  ${k.masked.padEnd(28)} 测试中…`);
      // --timeout 单位是秒，需转换；未指定时默认 20 秒
      const timeoutSec = args.flags.timeout ? Number(args.flags.timeout) : 20;
      const timeoutMs = (Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 20) * 1000;
      const r = await checkKey(id, k.key, { timeoutMs });
      recordResult(state, k.fingerprint, r, id);
      if (r.status === 'ok') passed += 1;

      // 清除进度行并打印结果
      process.stdout.write('\r');
      const icon = STATUS_ICON[r.status] || '⚪';
      console.log(`  ${icon} ${k.masked.padEnd(28)} ${(STATUS_LABEL[r.status] || r.status).padEnd(6)} ${String(r.ms).padStart(6)}ms  ${r.detail}`);
    }
    console.log('');
  }

  saveState(state, opts.stateDir);

  if (tested === 0) {
    console.log('未检测到任何 Key。');
    return 2;
  }

  console.log(`结果：${passed}/${tested} 可用`);
  console.log(`状态已保存到 ${path.join(opts.stateDir, 'state.json')}`);
  return passed > 0 ? 0 : 1;
}

// ---------- pick ----------
function cmdPick(args) {
  const platformId = args._[1] || args.flags.platform;
  if (!platformId) {
    console.error('用法: keykeeper pick <平台>');
    console.error(`可用平台: ${listPlatformIds().join(', ')}`);
    return 2;
  }
  if (!PLATFORMS[platformId]) {
    console.error(`未知平台: ${platformId}`);
    return 2;
  }

  const opts = baseOpts(args);
  const state = loadState(opts.stateDir);

  if (args.flags.rotate) {
    const r = rotateKey(platformId, { ...opts, state });
    if (!r) {
      console.error(`平台 ${platformId} 没有可用 Key`);
      return 1;
    }
    saveState(state, opts.stateDir);
    if (args.flags.json) {
      console.log(JSON.stringify({
        key: r.pick.key,
        masked: r.pick.masked,
        endpoint: r.pick.endpoint.baseURL,
        kind: r.pick.endpoint.kind,
        index: r.index,
        total: r.total,
      }, null, 2));
    } else {
      // 供脚本消费：只输出 Key 本身
      console.log(r.pick.key);
    }
    return 0;
  }

  const pick = pickKey(platformId, { ...opts, state });
  if (!pick) {
    console.error(`平台 ${platformId} 没有可用 Key`);
    return 1;
  }
  if (pick.lastStatus === 'invalid') {
    console.error(`平台 ${platformId} 的 Key 均标记为无效，建议先运行 keykeeper test`);
    return 1;
  }

  if (args.flags.json) {
    console.log(JSON.stringify({
      key: pick.key,
      masked: pick.masked,
      endpoint: pick.endpoint.baseURL,
      kind: pick.endpoint.kind,
      status: pick.lastStatus,
    }, null, 2));
  } else if (args.flags['show-endpoint']) {
    console.log(`KEY=${pick.key}`);
    console.log(`BASE_URL=${pick.endpoint.baseURL}`);
  } else {
    console.log(pick.key);
  }
  return 0;
}

// ---------- endpoint ----------
function cmdEndpoint(args) {
  const platformId = args._[1] || args.flags.platform;
  if (!platformId) {
    console.error('用法: keykeeper endpoint <平台>');
    return 2;
  }
  const p = PLATFORMS[platformId];
  if (!p) {
    console.error(`未知平台: ${platformId}`);
    return 2;
  }

  const opts = baseOpts(args);
  const keys = collectKeys(platformId, opts);

  console.log(`${p.label} 端点信息`);
  console.log('');
  console.log(`默认端点 : ${p.baseURL}`);
  if (p.tokenPlanBase) console.log(`TokenPlan: ${p.tokenPlanBase}`);
  console.log('');

  if (keys.length === 0) {
    console.log('未配置 Key，将使用默认端点。');
    return 0;
  }

  console.log('各 Key 实际使用的端点：');
  for (const k of keys) {
    const e = resolveEndpoint(platformId, k.key);
    console.log(`  ${maskKey(k.key).padEnd(28)} → ${e.baseURL}`);
    console.log(`  ${''.padEnd(28)}   ${e.reason}`);
  }
  return 0;
}

// ---------- platforms ----------
function cmdPlatforms() {
  console.log('支持的平台');
  console.log('');
  console.log('平台 ID        名称                    环境变量');
  console.log('─'.repeat(76));
  for (const [id, p] of Object.entries(PLATFORMS)) {
    const envs = p.envKeys.length ? p.envKeys.join(', ') : '(无需 Key)';
    console.log(`${id.padEnd(15)}${p.label.padEnd(24)}${envs}`);
  }
  console.log('');
  console.log('多 Key 配置：在变量名后加 _1、_2，例如 DASHSCOPE_API_KEY_1');
  console.log('自定义平台：在 config/keys.json 注册');
  return 0;
}

function usage() {
  console.log(`Keykeeper —— 跨平台 API Key 池管理 v1.0.0

用法:
  keykeeper <子命令> [参数]

子命令:
  status [--platform <id>] [--all] [--verbose]   查看 Key 池状态（不联网）
  test   [--platform <id>] [--timeout <秒>]      逐个测试 Key（联网）
  pick   <平台> [--json] [--show-endpoint]       选一个可用 Key
  pick   <平台> --rotate                         轮询取下一个可用 Key
  endpoint <平台>                                显示各 Key 的实际端点
  platforms                                      列出支持的平台

通用参数:
  --json          输出 JSON
  --verbose       显示详细信息
  --state-dir     自定义状态目录（默认 ~/.keykeeper）

设计要点:
  • 自动按 Key 前缀选端点（sk-sp- → Token Plan，避免 401）
  • 多 Key 自动轮询、失效标记、恢复重试
  • 输出永远脱敏，不打印明文 Key

示例:
  keykeeper status
  keykeeper test --platform qianwen
  keykeeper pick qianwen --show-endpoint
  keykeeper endpoint qianwen

供其他程序使用（只输出 Key 本身）:
  KEY=$(keykeeper pick qianwen)
`);
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || cmd === '-h' || args.flags.help) return usage();

  switch (cmd) {
    case 'status': return cmdStatus(args);
    case 'test': return await cmdTest(args);
    case 'pick': return cmdPick(args);
    case 'endpoint': return cmdEndpoint(args);
    case 'platforms': return cmdPlatforms();
    default:
      console.error(`未知子命令: ${cmd}\n`);
      usage();
      return 2;
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((e) => {
    console.error('致命错误:', e.message);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  });
