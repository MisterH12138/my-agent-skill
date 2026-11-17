#!/usr/bin/env node
/**
 * Model Dispatch CLI —— 跨平台智能模型调度
 *
 * 可执行入口。既可作为 `model-dispatch` 全局命令，也可 `node lib/cli.mjs` 调用。
 *
 * 子命令：
 *   route   显示调度决策（不实际调用）
 *   ask     调度 + 真实调用（带自动降级）
 *   health  探测各平台健康与余额
 *   models  列出可用模型
 *   config  查看配置与密钥状态
 *   setup   交互式配置向导
 */

import { route as routeFn, inferTaskType } from './router.mjs';
import { BUILTIN_MODELS, TASK_TYPES } from './registry.mjs';
import { buildProviders, probeAll } from './providers/index.mjs';
import { loadConfig, maskSecret } from './config.mjs';
import { runSetup } from './setup.mjs';

const fmt = (n) => Number(n).toLocaleString('en-US');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out.flags[key] = next;
        i++;
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function resolveWeights(config, presetName) {
  const presets = config.routing?.presets || {};
  const name = presetName || config.routing?.defaultPreset || 'balanced';
  if (presets[name]) {
    const { _note, ...w } = presets[name];
    return { weights: w, presetName: name };
  }
  const { _note, ...base } = config.routing?.weights || {};
  return { weights: base, presetName: 'custom' };
}

async function buildHealth(config, { skip = false } = {}) {
  const providers = buildProviders(config.providers);
  if (skip) return { providers, health: {} };
  const health = await probeAll(providers);
  return { providers, health };
}

function printDecision(result, { verbose = false } = {}) {
  const { chosen, ranked, taskType, inputTokens, weights } = result;
  if (!chosen) {
    console.log('❌ 没有可用的候选模型。请检查平台配置与密钥。');
    return;
  }
  const task = TASK_TYPES[taskType] || { label: taskType };
  console.log(`任务类型   : ${task.label} (${taskType})`);
  console.log(`输入规模   : ~${fmt(inputTokens)} tokens`);
  console.log(`权重       : 能力${weights.capability} 成本${weights.cost} 上下文${weights.context} 可用${weights.availability} 档位${weights.tier}`);
  console.log('');
  console.log('✅ 选定模型');
  const m = chosen.model;
  console.log(`  ${m.provider}/${m.id}`);
  console.log(`  能力档位   : ${m.tier}   上下文: ${m.ctx ? fmt(m.ctx) : 'N/A'}`);
  console.log(`  预估成本   : ¥${chosen.effectiveCost.toFixed(4)}${chosen.hasFree ? `  (含免费额度抵扣 ${(chosen.freeRatio * 100).toFixed(0)}%)` : ''}`);
  console.log(`  综合得分   : ${chosen.score.toFixed(3)}`);

  if (verbose && ranked.length > 1) {
    console.log('');
    console.log('候选排名（前 5）:');
    console.log('  得分   成本(¥)   平台/模型                          免费');
    for (const c of ranked.slice(0, 5)) {
      const free = c.hasFree ? `${(c.freeRatio * 100).toFixed(0)}%` : '-';
      console.log(
        `  ${c.score.toFixed(3)}  ${c.effectiveCost.toFixed(5).padStart(9)}  ${(c.model.provider + '/' + c.model.id).padEnd(34)} ${free}`,
      );
    }
  }
}

function buildMessages(prompt, system) {
  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  msgs.push({ role: 'user', content: prompt });
  return msgs;
}

function routeOptionsFromConfig(config) {
  const o = config.routing?.options || {};
  return {
    respectBalance: o.respectBalance !== false,
    enforceFloor: o.enforceCapabilityFloor !== false,
    minCapabilityRatio: o.minTierRatio ?? 1.0,
    fallbackDepth: Number(o.fallbackDepth || 3),
  };
}

async function cmdRoute(args, config) {
  const prompt = args._.slice(1).join(' ') || args.flags.prompt || '';
  const { weights } = resolveWeights(config, args.flags.preset);
  const { health } = await buildHealth(config, { skip: !!args.flags['no-probe'] });
  const models = config.models || BUILTIN_MODELS;
  const ro = routeOptionsFromConfig(config);

  const result = routeFn({
    prompt,
    taskType: args.flags.task,
    needCaps: (args.flags.caps || 'text').split(','),
    health,
    weights,
    models,
    estOutputTokens: Number(args.flags.out || config.routing?.options?.defaultEstOutputTokens || 1000),
    preferProvider: args.flags.prefer,
    respectBalance: ro.respectBalance,
    enforceFloor: args.flags['no-floor'] ? false : ro.enforceFloor,
    minCapabilityRatio: ro.minCapabilityRatio,
  });
  printDecision(result, { verbose: !args.flags.quiet });
  return 0;
}

async function cmdAsk(args, config) {
  const prompt = args._.slice(1).join(' ') || args.flags.prompt;
  if (!prompt) {
    console.error('用法: ask "<你的问题>" [--preset balanced] [--task code-review]');
    return 2;
  }
  const { weights } = resolveWeights(config, args.flags.preset);
  const { providers, health } = await buildHealth(config);
  const models = config.models || BUILTIN_MODELS;
  const ro = routeOptionsFromConfig(config);

  const result = routeFn({
    prompt,
    taskType: args.flags.task,
    needCaps: ['text'],
    health,
    weights,
    models,
    estOutputTokens: Number(args.flags.out || 1000),
    preferProvider: args.flags.prefer,
    respectBalance: ro.respectBalance,
    enforceFloor: args.flags['no-floor'] ? false : ro.enforceFloor,
    minCapabilityRatio: ro.minCapabilityRatio,
  });

  if (!result.chosen) {
    console.error('❌ 无可用模型');
    return 1;
  }

  if (!args.flags.quiet) printDecision(result, { verbose: !!args.flags.verbose });

  const depth = Number(config.routing?.options?.fallbackDepth || 3);
  const chain = result.ranked.slice(0, depth);
  const messages = buildMessages(prompt, args.flags.system);

  for (const cand of chain) {
    const { provider, id } = cand.model;
    const prov = providers.get(provider);
    if (!prov) continue;
    try {
      if (!args.flags.quiet) console.error(`\n→ 调用 ${provider}/${id} ...`);
      const res = await prov.chat({
        model: id,
        messages,
        temperature: args.flags.temperature ? Number(args.flags.temperature) : undefined,
        maxTokens: args.flags['max-tokens'] ? Number(args.flags['max-tokens']) : undefined,
      });
      console.log('');
      console.log(res.text);
      console.log('');
      const u = res.usage || {};
      const tin = u.prompt_tokens ?? u.input_tokens ?? 0;
      const tout = u.completion_tokens ?? u.output_tokens ?? 0;
      console.log(`── ${res.provider}/${res.model} · ${fmt(tin)} in / ${fmt(tout)} out ──`);
      return 0;
    } catch (e) {
      console.error(`   ✗ ${provider}/${id} 失败: ${e.message}`);
      if (args.flags.verbose) console.error(e.stack);
    }
  }

  console.error('\n❌ 全部候选模型调用失败');
  return 1;
}

async function cmdHealth(args, config) {
  const { providers, health } = await buildHealth(config);
  console.log('平台健康状态');
  console.log('');
  console.log('平台          状态     余额            返回');
  console.log('─'.repeat(72));
  for (const [id, p] of providers.entries()) {
    const h = health[id] || {};
    const ok = h.available ? '✅ 可用' : '❌ 不可用';
    let bal = '-';
    if (h.balance != null) bal = `${h.currency || ''} ${h.balance}`;
    console.log(`${id.padEnd(14)}${ok.padEnd(9)}${bal.padEnd(16)}${h.note || ''}`);
  }
  console.log('');
  const envFiles = config.envFiles || [];
  console.log(`配置文件来源: ${envFiles.length ? envFiles.join(' | ') : '(无 .env)'}`);

  if (args.flags.json) {
    console.log('');
    console.log(JSON.stringify(health, null, 2));
  }
  return 0;
}

async function cmdModels(args, config) {
  const models = config.models || BUILTIN_MODELS;
  const { health } = await buildHealth(config);
  const provider = args.flags.provider;

  console.log('可用模型目录');
  console.log('');
  console.log('平台/模型                              档位     上下文      价格(入/出 元每百万)');
  console.log('─'.repeat(84));
  for (const m of models) {
    if (provider && m.provider !== provider) continue;
    if (m.output !== 'text') continue;
    const h = health[m.provider];
    const mark = h && h.available === false ? ' ❌' : '';
    const rate = m.price ? `${m.price.input}/${m.price.output}` : '-';
    console.log(
      `${(m.provider + '/' + m.id).padEnd(38)}${(m.tier || '-').padEnd(9)}${fmt(m.ctx || 0).padEnd(12)}${rate}${mark}`,
    );
  }
  return 0;
}

async function cmdConfig(args, config) {
  console.log('配置概览');
  console.log('');
  console.log(`技能目录 : ${config.configDir}`);
  console.log(`环境文件 : ${(config.envFiles || []).join(' | ') || '(无)'}`);
  console.log('');
  console.log('平台密钥状态（脱敏）:');
  const { providers } = await buildHealth(config, { skip: true });
  for (const [id] of providers.entries()) {
    const p = providers.get(id);
    const key = p.apiKey;
    console.log(`  ${id.padEnd(14)} ${p.hasCredentials() ? '✅' : '⬜'} ${maskSecret(key)}`);
  }
  console.log('');
  const presets = Object.keys(config.routing?.presets || {});
  console.log(`可用权重预设: ${presets.join(', ')}`);
  console.log(`默认预设: ${config.routing?.defaultPreset || 'balanced'}`);
  return 0;
}

function usage() {
  console.log(`Model Dispatch —— 跨平台智能模型调度 v1.1.0

用法:
  model-dispatch <子命令> [参数]
  node lib/cli.mjs <子命令> [参数]

子命令:
  setup                交互式配置向导（首次使用先跑这个）
  health               探测各平台健康与余额
  route [提示词]       只做决策，不实际调用
  ask "<问题>"         调度 + 真实调用（自动降级）
  models               列出可用模型目录
  config               查看配置与密钥状态（脱敏）

通用参数:
  --task <类型>        code-writing|code-review|architecture|documentation|
                       data-analysis|creative-writing|long-context|unit-test|chat
  --preset <名称>      balanced|cheapest|best-quality|long-context
  --prefer <平台>      偏好某平台
  --out <n>            预估输出 token，默认 1000
  --no-probe           跳过平台探测（快，但不感知余额）
  --no-floor           关闭能力门槛（不推荐）
  --quiet              减少输出
  --verbose            显示候选排名与堆栈

示例:
  model-dispatch setup
  model-dispatch health
  model-dispatch route "帮我审查这段代码" --task code-review
  model-dispatch ask "写个快排" --preset cheapest
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || cmd === '-h' || args.flags.help) {
    usage();
    return 0;
  }

  const config = loadConfig({ cwd: process.cwd() });

  switch (cmd) {
    case 'setup': return runSetup();
    case 'route': return cmdRoute(args, config);
    case 'ask': return cmdAsk(args, config);
    case 'health': return cmdHealth(args, config);
    case 'models': return cmdModels(args, config);
    case 'config': return cmdConfig(args, config);
    default:
      console.error(`未知子命令: ${cmd}`);
      usage();
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('致命错误:', e.message);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  });
