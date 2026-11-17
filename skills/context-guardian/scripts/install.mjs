#!/usr/bin/env node
/**
 * 跨平台安装器
 *
 * 把本技能安装到目标 AI 工具的 skills 目录。
 * 支持：npx skills add、OpenClaw、Claude Code、Cursor、Codex 等。
 *
 * 用法:
 *   node scripts/install.mjs                    # 自动检测已安装的工具
 *   node scripts/install.mjs --agent claude-code
 *   node scripts/install.mjs --dir <目标目录>
 *   node scripts/install.mjs --list             # 只列出支持的目录
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_SRC = path.resolve(HERE, '..');
const SKILL_NAME = 'context-guardian';
const HOME = os.homedir();

/**
 * 各 AI 工具的技能目录（全局级）
 * 来自 skills.sh / OpenClaw / Claude Code / Cursor 官方文档
 */
const AGENT_DIRS = {
  'claude-code': { label: 'Claude Code', dir: path.join(HOME, '.claude', 'skills'), detect: path.join(HOME, '.claude') },
  'cursor': { label: 'Cursor', dir: path.join(HOME, '.cursor', 'skills'), detect: path.join(HOME, '.cursor') },
  'codex': { label: 'Codex', dir: path.join(HOME, '.codex', 'skills'), detect: path.join(HOME, '.codex') },
  'openclaw': { label: 'OpenClaw', dir: path.join(HOME, '.openclaw', 'skills'), detect: path.join(HOME, '.openclaw') },
  'qoder': { label: 'Qoder', dir: path.join(HOME, '.qoder', 'skills'), detect: path.join(HOME, '.qoder') },
  'qwen': { label: 'Qwen Code', dir: path.join(HOME, '.qwen', 'skills'), detect: path.join(HOME, '.qwen') },
  'windsurf': { label: 'Windsurf', dir: path.join(HOME, '.windsurf', 'skills'), detect: path.join(HOME, '.windsurf') },
  'trae': { label: 'Trae', dir: path.join(HOME, '.trae', 'skills'), detect: path.join(HOME, '.trae') },
  'opencode': { label: 'OpenCode', dir: path.join(HOME, '.config', 'opencode', 'skills'), detect: path.join(HOME, '.config', 'opencode') },
  'gemini': { label: 'Gemini CLI', dir: path.join(HOME, '.gemini', 'skills'), detect: path.join(HOME, '.gemini') },
  'agents': { label: '通用 .agents', dir: path.join(HOME, '.agents', 'skills'), detect: path.join(HOME, '.agents') },
  'dsh': { label: 'DeepSeek Harness', dir: path.join(HOME, '.dsh', 'skills'), detect: path.join(HOME, '.dsh') },
};

function parseArgs(argv) {
  const out = { flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n && !n.startsWith('--')) { out.flags[k] = n; i++; } else out.flags[k] = true;
    }
  }
  return out;
}

function copyRecursive(src, dst, { skip = [] } = {}) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyRecursive(s, d, { skip });
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

function detectAgents() {
  const found = [];
  for (const [id, cfg] of Object.entries(AGENT_DIRS)) {
    if (fs.existsSync(cfg.detect)) found.push({ id, ...cfg });
  }
  return found;
}

function installTo(targetDir, { force = false, dryRun = false } = {}) {
  const dest = path.join(targetDir, SKILL_NAME);
  if (fs.existsSync(dest) && !force) {
    return { ok: false, dest, reason: '已存在（用 --force 覆盖）' };
  }
  if (dryRun) return { ok: true, dest, reason: 'dry-run' };

  fs.mkdirSync(targetDir, { recursive: true });
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  copyRecursive(SKILL_SRC, dest, { skip: ['node_modules', '.git'] });
  return { ok: true, dest };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.list) {
    console.log('支持的 AI 工具与技能目录:');
    console.log('');
    const detected = new Set(detectAgents().map((a) => a.id));
    for (const [id, cfg] of Object.entries(AGENT_DIRS)) {
      const mark = detected.has(id) ? '✓ 已安装此工具' : ' ';
      console.log(`  ${mark} ${id.padEnd(14)} ${cfg.label.padEnd(20)} ${cfg.dir}`);
    }
    return 0;
  }

  let targets = [];
  if (args.flags.dir) {
    targets = [{ id: 'custom', label: '自定义', dir: path.resolve(args.flags.dir) }];
  } else if (args.flags.agent) {
    const ids = String(args.flags.agent).split(',');
    for (const id of ids) {
      const cfg = AGENT_DIRS[id.trim()];
      if (!cfg) {
        console.error(`未知工具: ${id}。用 --list 查看支持列表。`);
        return 2;
      }
      targets.push({ id, ...cfg });
    }
  } else {
    targets = detectAgents();
    if (targets.length === 0) {
      console.log('未检测到已安装的 AI 工具。');
      console.log('请用 --agent <工具名> 或 --dir <目录> 手动指定。');
      console.log('用 --list 查看全部支持的目录。');
      return 1;
    }
  }

  console.log(`安装 ${SKILL_NAME} v1.0.0`);
  console.log(`源目录: ${SKILL_SRC}`);
  console.log('');

  let installed = 0;
  for (const t of targets) {
    const r = installTo(t.dir, { force: !!args.flags.force, dryRun: !!args.flags['dry-run'] });
    if (r.ok) {
      console.log(`  ✓ ${t.label.padEnd(20)} -> ${r.dest}`);
      installed++;
    } else {
      console.log(`  ○ ${t.label.padEnd(20)} ${r.reason}: ${r.dest}`);
    }
  }

  console.log('');
  if (installed > 0) {
    console.log(`完成：安装到 ${installed} 个位置。`);
    console.log('');
    console.log('下一步:');
    console.log('  1. 配置 API Key（任选其一）');
    console.log('     - 运行安装目录下的 lib/cli.mjs setup');
    console.log('     - 或设置环境变量 DASHSCOPE_API_KEY / DEEPSEEK_API_KEY');
    console.log('  2. 验证: node <安装目录>/lib/cli.mjs health');
  }
  return installed > 0 ? 0 : 1;
}

process.exit(main());
