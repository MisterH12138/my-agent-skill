#!/usr/bin/env node
/**
 * Context Guardian CLI —— 跨工具上下文健康检查
 *
 * 子命令：
 *   check     检查当前/指定会话的上下文健康度
 *   scan      扫描本机所有 AI 工具，列出各会话上下文占用
 *   estimate  估算一段文本的 token 数（不读任何文件）
 *   tools     列出检测到的 AI 工具及其数据目录
 *   profile   生成用户使用画像（6 个维度）
 *   memory    从历史会话提炼记忆摘要并落盘
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateTokens, estimateMessages, getWindow, MODEL_WINDOWS } from './estimator.mjs';
import { analyze, suggest, formatReport, DEFAULT_THRESHOLDS, LEVELS } from './analyzer.mjs';
import { discover, latestSessions, TOOLS } from './adapters.mjs';
import { listTools, readToolEvents } from './extract.mjs';
import { buildProfile, formatProfile } from './profile.mjs';
import { writeCandidatePack, saveRefinedMemory, readMemory, MEMORY_KINDS } from './memory.mjs';
import { detectProvider, refine, PROVIDERS } from './refine.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fmt = (n) => Number(n).toLocaleString('en-US');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n && !n.startsWith('--')) { out.flags[k] = n; i++; } else out.flags[k] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function customThresholds(args) {
  const t = {};
  if (args.flags['warn-at']) t.warning = Number(args.flags['warn-at']) / 100;
  if (args.flags['danger-at']) t.danger = Number(args.flags['danger-at']) / 100;
  return Object.keys(t).length ? t : undefined;
}

// ---------- check ----------
function cmdCheck(args) {
  let model = args.flags.model || process.env.CONTEXT_MODEL || null;
  const windowFlag = args.flags.window ? Number(args.flags.window) : undefined;
  let tokens = args.flags.tokens ? Number(args.flags.tokens) : null;
  let source = '参数';

  // 未给 tokens 时，尝试从最近的会话推断
  if (tokens === null) {
    const { sessions, tools } = discover({});
    const latest = latestSessions(sessions, 1)[0];
    if (latest) {
      tokens = latest.contextTokens;
      source = `最近会话（${latest.tool} / ${latest.id.slice(0, 12)}）`;
      // 会话里记了模型就用它（除非用户显式指定）
      if (!model && latest.model) model = latest.model;
      if (latest.title) source += `：${latest.title.slice(0, 20)}`;
    } else {
      console.error('无法获取上下文用量。');
      console.error('请用 --tokens <数量> 指定，或用 scan 查看本机会话。');
      const detected = tools.filter((t) => t.detected);
      if (detected.length > 0) {
        console.error('');
        console.error('检测到的工具：');
        for (const t of detected) {
          console.error(`  ${t.label}：${t.readable ? `可读 ${t.sessionCount} 个会话` : '格式暂不支持读取'}`);
        }
      }
      return 2;
    }
  }

  // 会话未记录模型时，用 --assume-model / --assume-window 兜底
  if (!windowFlag && !model) {
    if (args.flags['assume-window']) {
      // 交给下面 window 参数处理
    } else if (args.flags['assume-model']) {
      model = args.flags['assume-model'];
    } else {
      model = 'qwen3.8-flash'; // 多数现代模型已到百万级窗口
      source += '（未记录模型，按百万窗口估算）';
    }
  }
  const window = windowFlag || (args.flags['assume-window'] ? Number(args.flags['assume-window']) : undefined);

  const result = analyze({ tokens, model, window }, {
    thresholds: customThresholds(args),
    reserveOutput: args.flags.reserve ? Number(args.flags.reserve) : undefined,
  });

  if (args.flags.json) {
    console.log(JSON.stringify({ ...result, source }, null, 2));
    return 0;
  }

  console.log('上下文健康检查');
  console.log(`数据来源：${source}`);
  console.log('');
  console.log(formatReport(result, suggest(result, {
    availableModels: args.flags.models ? String(args.flags.models).split(',') : [],
  })));

  // 阈值图例
  if (args.flags.verbose) {
    console.log('');
    console.log('阈值分级：');
    const t = result.thresholds;
    console.log(`  健康    < ${(t.healthy * 100).toFixed(0)}%`);
    console.log(`  注意    ${(t.healthy * 100).toFixed(0)}% - ${(t.notice * 100).toFixed(0)}%`);
    console.log(`  警告    ${(t.notice * 100).toFixed(0)}% - ${(t.warning * 100).toFixed(0)}%`);
    console.log(`  危险    ${(t.warning * 100).toFixed(0)}% - ${(t.danger * 100).toFixed(0)}%`);
    console.log(`  危急    >= ${(t.danger * 100).toFixed(0)}%`);
  }
  return 0;
}

// ---------- scan ----------
function cmdScan(args) {
  const { tools, sessions } = discover({ onlyTool: args.flags.tool });

  if (args.flags.json) {
    console.log(JSON.stringify({ tools, sessions }, null, 2));
    return 0;
  }

  console.log('本机 AI 工具扫描');
  console.log('');
  console.log('工具                状态        会话数   数据目录');
  console.log('─'.repeat(88));
  for (const t of tools) {
    const status = !t.detected ? '未安装' : t.readable ? '✓ 可读' : '△ 已装(格式未知)';
    console.log(
      `${t.label.padEnd(20)}${status.padEnd(14)}${String(t.sessionCount).padStart(5)}    ${t.dirs[0] || '-'}`,
    );
  }

  if (sessions.length === 0) {
    console.log('');
    console.log('没有可读取的会话数据。');
    console.log('如果工具已安装但仍显示「格式未知」，说明其存储格式尚未支持，');
    console.log('可改用 `check --tokens <数量>` 手动指定用量。');
    return 0;
  }

  const list = latestSessions(sessions, Number(args.flags.limit) || 10);
  // 模型未知时用此值估算窗口（可通过 --assume-window 覆盖）
  const assumeWindow = args.flags['assume-window']
    ? Number(args.flags['assume-window'])
    : getWindow(args.flags['assume-model'] || 'qwen3.8-flash');

  console.log('');
  console.log('最近会话上下文占用（按时间排序）');
  console.log('');
  console.log('工具          会话              上下文 tokens   占比     状态');
  console.log('─'.repeat(88));

  for (const s of list) {
    // 会话有记录的模型就用它，否则用假设窗口
    const win = s.model ? getWindow(s.model) : assumeWindow;
    const effective = win - Math.min(8192, Math.floor(win * 0.1));
    const ratio = Math.min(1, s.contextTokens / effective);
    const lv =
      ratio < 0.5 ? LEVELS.healthy
      : ratio < 0.7 ? LEVELS.notice
      : ratio < 0.85 ? LEVELS.warning
      : ratio < 0.95 ? LEVELS.danger
      : LEVELS.critical;
    const title = (s.title || s.id).slice(0, 16);
    const modelTag = s.model ? '' : '*';
    console.log(
      `${s.tool.padEnd(14)}${(title + modelTag).padEnd(18)}${fmt(s.contextTokens).padStart(13)}   ${(ratio * 100).toFixed(1).padStart(5)}%   ${lv.icon} ${lv.label}`,
    );
  }

  const unknown = list.filter((s) => !s.model).length;
  if (unknown > 0) {
    console.log('');
    console.log(`* 标记的 ${unknown} 个会话未记录模型，按 ${fmt(assumeWindow)} tokens 窗口估算。`);
    console.log(`  可用 --assume-window <数量> 或 --assume-model <模型名> 调整。`);
  }
  return 0;
}

// ---------- estimate ----------
function cmdEstimate(args) {
  const text = args._.slice(1).join(' ') || args.flags.text || '';
  if (!text) {
    // 支持从 stdin 读
    try {
      const stdin = fs.readFileSync(0, 'utf8');
      if (stdin) return doEstimate(stdin, args);
    } catch {
      /* 无 stdin */
    }
    console.error('用法: estimate "<文本>" 或 echo "文本" | estimate');
    return 2;
  }
  return doEstimate(text, args);
}

function doEstimate(text, args) {
  const model = args.flags.model || null;
  const detail = estimateTokens(text, { model, verbose: true });

  if (args.flags.json) {
    console.log(JSON.stringify(detail, null, 2));
    return 0;
  }

  console.log('Token 估算');
  console.log('');
  console.log(`字符数      : ${fmt(detail.chars)}`);
  console.log(`估算 tokens : ${fmt(detail.total)}  （范围 ${fmt(detail.range[0])} - ${fmt(detail.range[1])}）`);
  if (model) console.log(`模型校正    : ${model}（系数 ${detail.adjust}）`);
  console.log('');
  console.log('字符构成：');
  for (const [k, v] of Object.entries(detail.breakdown)) {
    if (v.chars > 0) {
      const label = { cjk: '中文/日韩', latin: '拉丁字母', digit: '数字', symbol: '符号', whitespace: '空白', emoji: 'emoji' }[k] || k;
      console.log(`  ${label.padEnd(10)} ${String(v.chars).padStart(7)} 字符  →  ${fmt(v.tokens)} tokens`);
    }
  }
  return 0;
}

// ---------- tools ----------
function cmdTools() {
  console.log('支持的 AI 工具');
  console.log('');
  console.log('工具                 可读  数据目录');
  console.log('─'.repeat(80));
  for (const t of TOOLS) {
    const existing = t.dirs.filter((d) => fs.existsSync(d));
    console.log(
      `${t.label.padEnd(21)}${(t.reader ? '✓' : '△').padEnd(6)}${existing[0] || t.dirs[0]}`,
    );
  }
  console.log('');
  console.log('✓ = 可读取会话数据    △ = 仅检测安装状态');
  console.log('');
  console.log('已知模型的上下文窗口：');
  const entries = Object.entries(MODEL_WINDOWS).slice(0, 12);
  for (let i = 0; i < entries.length; i += 2) {
    const [a, b] = [entries[i], entries[i + 1]];
    const line = `${a[0].padEnd(22)}${fmt(a[1]).padStart(11)}`;
    const line2 = b ? `    ${b[0].padEnd(22)}${fmt(b[1]).padStart(11)}` : '';
    console.log('  ' + line + line2);
  }
  return 0;
}

// ---------- profile ----------
function collectEvents(args) {
  const tools = listTools(SKILL_ROOT).filter((t) => t.detected);
  if (tools.length === 0) return { events: [], tools: [] };
  const filtered = args.flags.tool ? tools.filter((t) => t.id === args.flags.tool) : tools;
  const events = [];
  for (const t of filtered) {
    events.push(...readToolEvents(t, {
      maxFiles: args.flags['max-files'] ? Number(args.flags['max-files']) : 500,
    }));
  }
  return { events, tools: filtered };
}

function cmdProfile(args) {
  const { events, tools } = collectEvents(args);

  if (events.length === 0) {
    console.error('没有读取到任何会话数据。');
    const detected = listTools(SKILL_ROOT).filter((t) => t.detected);
    if (detected.length === 0) {
      console.error('本机未检测到已知 AI 工具的数据目录。');
      console.error('可在 config/parsers.json 中注册自定义工具路径。');
    } else {
      console.error('检测到工具但未读到事件：');
      for (const t of detected) console.error(`  ${t.label}: ${t.existing.join(', ')}`);
    }
    return 2;
  }

  const profile = buildProfile(events);
  profile.tools = Object.fromEntries(tools.map((t) => [t.id, t.label]));

  if (args.flags.json) {
    console.log(JSON.stringify(profile, null, 2));
    return 0;
  }
  console.log(formatProfile(profile));
  return 0;
}

// ---------- memory ----------
function defaultMemoryDir() {
  return path.join(process.cwd(), 'memory');
}

async function cmdMemory(args) {
  const sub = args._[1];

  // ---- show：查看已生成的记忆 ----
  if (sub === 'show') {
    const dir = args.flags.dir || defaultMemoryDir();
    const got = readMemory(dir);
    if (!got) {
      console.error(`未找到记忆文件：${path.join(dir, 'summary.md')}`);
      console.error('先运行: context-guardian memory build');
      return 2;
    }
    console.log(`记忆文件：${got.file}`);
    console.log(`更新时间：${got.mtime.toLocaleString('zh-CN')}`);
    console.log('');
    console.log(got.markdown);
    return 0;
  }

  // ---- pack：只生成候选包 ----
  const { events, tools } = collectEvents(args);
  if (events.length === 0) {
    console.error('没有读取到会话数据，无法提炼记忆。');
    return 2;
  }

  const dir = args.flags.dir || defaultMemoryDir();
  const packOpts = {
    maxPerKind: args.flags.limit ? Number(args.flags.limit) : 15,
    maxTotal: args.flags.max ? Number(args.flags.max) : 80,
    recentSessions: args.flags.sessions ? Number(args.flags.sessions) : 20,
  };

  if (sub === 'pack' || args.flags['pack-only']) {
    const res = writeCandidatePack(dir, events, packOpts);
    console.log('候选包已生成（未提炼）');
    console.log('');
    console.log(`  文件      : ${res.file}`);
    console.log(`  大小      : ${(res.bytes / 1024).toFixed(1)} KB`);
    console.log(`  扫描事件  : ${res.stats.scanned}`);
    console.log(`  过滤噪声  : ${res.stats.filtered}`);
    console.log(`  候选项    : ${res.stats.totalCandidates}`);
    console.log('');
    console.log('  各类候选：');
    for (const [k, v] of Object.entries(res.stats.byKind)) {
      console.log(`    ${k.padEnd(12)} ${v}`);
    }
    console.log('');
    console.log('下一步（任选其一）：');
    console.log(`  1. 让 AI 阅读该文件并按其「提炼指令」处理，结果用 memory save 保存`);
    console.log(`  2. 运行 memory build 自动调用 AI 提炼`);
    return 0;
  }

  // ---- save：保存 AI 产出 ----
  if (sub === 'save') {
    const inFile = args.flags.file;
    if (!inFile || !fs.existsSync(inFile)) {
      console.error('请用 --file <路径> 指定 AI 输出的 Markdown 文件');
      return 2;
    }
    const text = fs.readFileSync(inFile, 'utf8');
    const res = saveRefinedMemory(dir, text, { source: 'manual' });
    console.log(`记忆已保存：${res.file}（${(res.bytes / 1024).toFixed(1)} KB）`);
    return 0;
  }

  // ---- build（默认）：生成候选包 → AI 提炼 → 保存 ----
  const packRes = writeCandidatePack(dir, events, packOpts);

  // 探测可用的 AI 平台
  let provider = null;
  if (!args.flags['no-ai']) {
    if (args.flags['base-url']) {
      provider = {
        provider: 'custom',
        label: '自定义',
        baseURL: args.flags['base-url'],
        apiKey: args.flags.key || '',
        model: args.flags.model || 'gpt-4o-mini',
        source: '命令行参数',
      };
    } else {
      provider = detectProvider({
        searchDirs: [process.cwd(), SKILL_ROOT],
        model: args.flags.model,
      });
      if (provider && args.flags.provider) {
        // 用户指定了平台但自动探测到了别的
        const want = PROVIDERS[args.flags.provider];
        if (want && want.label !== provider.label) {
          const keys = readEnvForProvider(args.flags.provider);
          if (keys) {
            provider = {
              provider: args.flags.provider,
              label: want.label,
              baseURL: baseURLFor(args.flags.provider, keys),
              apiKey: keys,
              model: args.flags.model || want.defaultModel,
              source: '指定平台',
            };
          }
        }
      }
    }
  }

  console.log('记忆提炼');
  console.log('');
  console.log(`  候选包      : ${packRes.file}`);
  console.log(`  扫描事件    : ${packRes.stats.scanned} 条（过滤噪声 ${packRes.stats.filtered}）`);
  console.log(`  候选项      : ${packRes.stats.totalCandidates} 条`);

  if (!provider) {
    console.log('');
    console.log('  未找到可用的 AI 平台，已停在候选包阶段。');
    console.log('');
    console.log('  三种后续方式：');
    console.log('    1. 配一个平台的 Key（DASHSCOPE_API_KEY / DEEPSEEK_API_KEY 等）后重跑');
    console.log('    2. 让当前 AI 读取候选包并按其中的「提炼指令」处理，');
    console.log(`       再用 memory save --file <结果文件> 保存`);
    console.log(`    3. 直接看候选包内容手动整理：${packRes.file}`);
    return 0;
  }

  console.log(`  AI 平台     : ${provider.label}（${provider.source}）`);
  console.log(`  模型        : ${provider.model}`);
  console.log('');
  console.log('  正在提炼...');

  let refined;
  try {
    const packText = fs.readFileSync(packRes.file, 'utf8');
    refined = await refine(packText, provider);
  } catch (e) {
    console.error(`  提炼失败：${e.message}`);
    console.error('');
    console.error(`  候选包已保留：${packRes.file}`);
    console.error('  可手动交给任意 AI 处理，再用 memory save 保存。');
    return 1;
  }

  const sessionIds = new Set(events.map((e) => e.sessionId));
  const saveRes = saveRefinedMemory(dir, refined.text, {
    source: `${provider.label} / ${refined.model}`,
    sessions: sessionIds.size,
  });

  console.log('  ✓ 完成');
  console.log('');
  console.log(`  记忆文件    : ${saveRes.file}`);
  console.log(`  大小        : ${(saveRes.bytes / 1024).toFixed(1)} KB`);
  if (refined.usage) {
    const u = refined.usage;
    console.log(`  token 消耗  : ${u.prompt_tokens ?? '-'} 入 / ${u.completion_tokens ?? '-'} 出`);
  }
  console.log('');
  console.log('  查看内容：context-guardian memory show');
  return 0;
}

/** 读取指定平台的 Key（供 --provider 使用） */
function readEnvForProvider(id) {
  const cfg = PROVIDERS[id];
  if (!cfg) return null;
  for (const k of cfg.envKeys) {
    if (process.env[k] && !/your-key|placeholder/i.test(process.env[k])) return process.env[k];
  }
  const detected = detectProvider({ searchDirs: [process.cwd(), SKILL_ROOT] });
  if (detected && detected.provider === id) return detected.apiKey;
  return null;
}

/** 根据平台与 Key 解析端点（sk-sp- 走 Token Plan） */
function baseURLFor(id, apiKey) {
  const cfg = PROVIDERS[id];
  if (!cfg) return null;
  if (id === 'qianwen' && apiKey && apiKey.startsWith('sk-sp-') && cfg.tokenPlanBase) {
    return cfg.tokenPlanBase;
  }
  return cfg.baseURL;
}

function usage() {
  console.log(`Context Guardian —— 跨工具上下文健康检查 v1.1.0

用法:
  context-guardian <子命令> [参数]

子命令:
  check [--tokens N] [--model M] [--window W]   检查上下文健康度
  scan  [--tool <id>] [--limit N]               扫描本机会话占用
  estimate "<文本>" [--model M]                 估算 token 数
  tools                                          列出支持的工具与窗口表
  profile [--json] [--tool <id>]                 生成用户使用画像（6 维度）
  memory build [--dir <路径>] [--dry-run]        提炼记忆摘要并落盘
  memory show  [--dir <路径>]                    查看已生成的记忆

通用参数:
  --json            输出 JSON
  --verbose         显示阈值分级
  --warn-at <0-100>      自定义警告阈值（百分比）
  --danger-at <0-100>    自定义危险阈值（百分比）
  --reserve <n>          为输出预留的 token 数
  --tool <id>            只处理指定工具
  --dir <路径>           记忆存储目录（默认 ./memory）
  --max-files <n>        每个工具最多读取的文件数（默认 500）

示例:
  context-guardian check
  context-guardian profile
  context-guardian memory build
  context-guardian memory show
`);
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.flags.help) return usage();

  switch (cmd) {
    case 'check': return cmdCheck(args);
    case 'scan': return cmdScan(args);
    case 'estimate': return cmdEstimate(args);
    case 'tools': return cmdTools();
    case 'profile': return cmdProfile(args);
    case 'memory': return await cmdMemory(args);
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
