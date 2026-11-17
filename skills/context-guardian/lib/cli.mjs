#!/usr/bin/env node
/**
 * Context Guardian CLI —— 跨工具上下文健康检查
 *
 * 子命令：
 *   check     检查当前/指定会话的上下文健康度
 *   scan      扫描本机所有 AI 工具，列出各会话上下文占用
 *   estimate  估算一段文本的 token 数（不读任何文件）
 *   tools     列出检测到的 AI 工具及其数据目录
 */

import fs from 'node:fs';
import { estimateTokens, estimateMessages, getWindow, MODEL_WINDOWS } from './estimator.mjs';
import { analyze, suggest, formatReport, DEFAULT_THRESHOLDS, LEVELS } from './analyzer.mjs';
import { discover, latestSessions, TOOLS } from './adapters.mjs';

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

function usage() {
  console.log(`Context Guardian —— 跨工具上下文健康检查 v1.0.0

用法:
  context-guardian <子命令> [参数]

子命令:
  check [--tokens N] [--model M] [--window W]   检查上下文健康度
  scan  [--tool <id>] [--limit N]               扫描本机会话占用
  estimate "<文本>" [--model M]                 估算 token 数
  tools                                          列出支持的工具与窗口表

通用参数:
  --json            输出 JSON
  --verbose         显示阈值分级
  --warn-at <0-100>      自定义警告阈值（百分比）
  --danger-at <0-100>    自定义危险阈值（百分比）
  --reserve <n>          为输出预留的 token 数

示例:
  context-guardian check
  context-guardian check --tokens 95000 --model claude-sonnet-4
  context-guardian scan --limit 5
  context-guardian estimate "这是一段需要估算的中文文本"
  context-guardian tools
`);
  return 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.flags.help) return usage();

  switch (cmd) {
    case 'check': return cmdCheck(args);
    case 'scan': return cmdScan(args);
    case 'estimate': return cmdEstimate(args);
    case 'tools': return cmdTools();
    default:
      console.error(`未知子命令: ${cmd}\n`);
      usage();
      return 2;
  }
}

process.exit(main() ?? 0);
