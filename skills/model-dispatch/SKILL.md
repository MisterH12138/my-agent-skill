---
name: model-dispatch
description: "跨平台智能模型调度器。按任务类型、上下文长度、平台余额和免费额度，自动挑选最省钱又不降能力的模型并直接调用，支持千问、DeepSeek、OpenRouter 及任意 OpenAI 兼容平台，一个 Key 或多个 Key 都能管。当用户要写代码、改 bug、审查代码、设计架构、写文档、做数据分析、写文案、处理长文档或生成单元测试时使用；当用户问「用哪个模型好」「哪个最划算」「帮我省钱」「自动切换模型」时使用；当某个平台余额不足、额度用完或报错需要换平台时使用。不适用于纯闲聊、简单事实问答、用户已指定具体模型且不需要调度、或与选模型无关的任务。"
license: MIT
metadata:
  version: "1.1.0"
  author: "dsh-skills"
  tags: ["llm", "routing", "cost-optimization", "multi-provider", "qianwen", "deepseek", "openrouter"]
---

# Model Dispatch — 跨平台智能模型调度

**一句话**：让 AI 每次干活都自动用上「最省钱又不降能力」的模型。

不同任务对模型能力的要求天差地别——写文案用旗舰模型是浪费，审查安全代码用轻量模型是冒险。本技能把这件事自动化：

- **看任务**：识别是写代码、审代码、做架构还是写文案
- **看体量**：估算上下文有多大，会不会爆窗口
- **看钱包**：查各平台余额和免费额度还剩多少
- **做决策**：两阶段筛选，先保能力下限，再在合格者里挑最便宜的
- **真执行**：直接调 API，失败自动降级到次优

不依赖 DeepSeek Harness，不依赖任何第三方 npm 包，只需 Node.js 18+，可安装到 Claude Code、Cursor、Codex、OpenClaw 等 80+ 工具。

一个**可执行**的调度系统，不只是给建议。它综合任务类型、上下文规模、平台余额与免费额度，选出「最省且能力不打折扣」的模型，并真实调用。

## 安装

本技能遵循 [Agent Skills 开放规范](https://agentskills.io)，可被 Claude Code、Cursor、Codex、OpenClaw、Qoder、Qwen Code、Windsurf 等 **80+ 工具**直接识别。

### 方式一：npx skills（推荐，通用）

```bash
# 从 Git 仓库安装到当前项目（会自动检测已安装的 AI 工具）
npx skills add <owner>/<repo> --skill model-dispatch

# 全局安装
npx skills add <owner>/<repo> --skill model-dispatch -g

# 指定目标工具
npx skills add <owner>/<repo> --skill model-dispatch -a claude-code
```

### 方式二：OpenClaw / ClawHub

```bash
# 从 ClawHub 安装
openclaw skills install model-dispatch

# 或直接放到 OpenClaw 技能目录
#   ~/.openclaw/skills/model-dispatch/
```

### 方式三：本技能自带安装器（自动检测工具）

```bash
# 列出支持的 AI 工具与对应目录
node scripts/install.mjs --list

# 自动检测已安装的工具并安装
node scripts/install.mjs

# 安装到指定工具
node scripts/install.mjs --agent claude-code
node scripts/install.mjs --agent openclaw,codex

# 安装到自定义目录
node scripts/install.mjs --dir ~/.my-agent/skills
```

### 方式四：手动复制

把整个 `model-dispatch/` 目录复制到目标工具的技能目录即可：

| 工具 | 技能目录 |
|---|---|
| Claude Code | `~/.claude/skills/` 或 `./.claude/skills/` |
| Cursor | `~/.cursor/skills/` |
| Codex | `~/.codex/skills/` 或 `./.agents/skills/` |
| OpenClaw | `~/.openclaw/skills/` 或 `<workspace>/skills/` |
| Qoder | `~/.qoder/skills/` |
| Qwen Code | `~/.qwen/skills/` |
| Windsurf | `~/.windsurf/skills/` |
| 通用约定 | `~/.agents/skills/` |

### 安装后配置

```bash
# 交互式配置向导（引导填 API Key）
node lib/cli.mjs setup

# 或直接设环境变量
export DASHSCOPE_API_KEY=sk-...     # Linux/macOS
setx DASHSCOPE_API_KEY "sk-..."     # Windows

# 验证
node lib/cli.mjs health
```

**依赖**：只需 Node.js ≥ 18（使用原生 `fetch`），**无任何第三方 npm 包**。

## 快速开始

```powershell
# 查看各平台状态与余额
node lib/cli.mjs health

# 查看调度决策（不实际调用）
node lib/cli.mjs route "帮我审查这段代码" --task code-review

# 调度 + 真实调用（自动降级）
node lib/cli.mjs ask "实现一个快速排序" --task code-writing

# 查看可用模型
node lib/cli.mjs models

# 查看配置与密钥状态（脱敏）
node lib/cli.mjs config
```

> 若已通过 `npx skills` 或 npm 全局安装，可直接用 `model-dispatch <子命令>`。
> Windows 可用 `mr.bat`，macOS/Linux 可用 `./mr.sh` 作为快捷启动。

---

## 核心机制

### 1. 两阶段决策

```
阶段一：硬约束筛除
  ├─ 模态支持（text/image/audio/video）
  ├─ 上下文窗口装得下
  ├─ 能力档位达标 ← 保证「能力不打折扣」
  └─ 平台可用（余额 > 0 或在模型白名单内）

阶段二：加权打分
  score = 0.40×能力 + 0.25×成本 + 0.15×上下文 + 0.15×可用性 + 0.05×档位
```

### 2. 能力门槛（关键设计）

**这是「不打折扣」的保证。** 按任务所需推理强度强制最低档位：

| 任务推理需求 | 要求档位 | 典型任务 |
|---|---|---|
| ≥ 0.85 | **flagship**（旗舰） | 代码审查、架构设计 |
| ≥ 0.65 | **strong** 以上 | 代码编写、数据分析、单元测试 |
| ≥ 0.50 | **balanced** 以上 | 文档撰写、长上下文 |
| < 0.50 | 不限 | 创意文案、闲聊 |

门槛不满足的模型**直接淘汰**，不进入打分。这样便宜但能力不够的模型不会因为省钱而胜出。

### 3. 余额与额度感知

| 平台 | 余额能力 |
|---|---|
| DeepSeek | ✅ 真实余额（`/user/balance`），余额 ≤0 自动剔除 |
| 千问 | ✅ 模型白名单（Token Plan 实际可调列表） |
| OpenRouter | ✅ credits 余额 |
| 通用 OpenAI 兼容 | 连通性探测 |

**关键点**：千问 `models list` 显示的模型 ≠ 当前 Key 能调的模型。系统会探测**实际可见列表**并据此过滤，避免 `404 Model not exist`。

### 4. 免费额度抵扣

有免费额度的模型按比例降低有效成本：

```
effectiveCost = rawCost × (1 - freeCredit)
freeCredit = 已知余量 ? 剩余比例 : 0.5（未知时按一半，避免全 0 失去区分度）
```

---

## 任务类型

| 类型 | 说明 | 推理需求 |
|---|---|---|
| `code-writing` | 写新功能、修 bug、重构 | 0.65 |
| `code-review` | 审 PR、找问题 | 0.90 |
| `architecture` | 技术选型、模块设计 | 0.95 |
| `documentation` | README、API 文档 | 0.50 |
| `data-analysis` | 清洗、统计、可视化 | 0.75 |
| `creative-writing` | 命名、文案、标语 | 0.35 |
| `long-context` | 大仓库、长文档 | 0.60 |
| `unit-test` | 测试用例、边界覆盖 | 0.70 |
| `chat` | 通用对话 | 0.40 |

不指定 `--task` 时按关键词自动推断。

---

## 权重预设

| 预设 | 适用 | 能力/成本权重 |
|---|---|---|
| `balanced`（默认） | 日常 | 0.40 / 0.25 |
| `cheapest` | 省钱优先 | 0.25 / 0.50 |
| `best-quality` | 质量优先 | 0.60 / 0.10 |
| `long-context` | 长文档 | 上下文权重 0.40 |

```powershell
node lib/cli.mjs route "总结这份报告" --preset long-context
```

---

## 接入新平台

### 方式 A：OpenAI 兼容平台（最简单）

绝大多数平台都兼容 OpenAI 协议。在 `config/providers.json` 加一条：

```json
{
  "providers": {
    "mykimi": {
      "enabled": true,
      "kind": "openai-compat",
      "name": "Moonshot Kimi",
      "baseURL": "https://api.moonshot.cn/v1",
      "envKey": "MOONSHOT_API_KEY"
    }
  }
}
```

然后在 `.env` 加一行 `MOONSHOT_API_KEY=sk-...` 即可。

**已预置但默认关闭的平台**：`moonshot`、`zhipu`、`siliconflow`、`minimax`、`ollama`（本地，无需 Key）。

### 方式 B：自定义适配器

平台协议不兼容时，在 `lib/providers/` 新建适配器，继承 `BaseProvider` 实现 `chat()` 和 `health()`，再在 `providers/index.mjs` 注册。

### 加模型到目录

编辑 `lib/registry.mjs` 的 `BUILTIN_MODELS`，或建 `config/models.json` 覆盖。

---

## 多 Key 与 .env

系统按以下顺序读凭证（高 → 低）：

1. `config/providers.json` 里的 `apiKey` 字段
2. 工作区 `.env`（支持向上查找父目录）
3. 进程环境变量

**支持的 Key 变量名**：

| 变量 | 平台 |
|---|---|
| `DASHSCOPE_API_KEY` / `QIANWEN_API_KEY` | 千问（`sk-sp-` 自动走 Token Plan 端点） |
| `DEEPSEEK_API_KEY` | DeepSeek 官方 |
| `OPENROUTER_API_KEY` | OpenRouter |
| 自定义（如 `MOONSHOT_API_KEY`） | 在 providers.json 的 `envKey` 指定 |

**安全**：`node lib/cli.mjs config` 只显示脱敏后的 Key（`sk-****abcd (len=115)`），永不输出明文。

---

## 自动降级

`ask` 子命令内置降级链：首选失败时依次尝试次优模型，默认深度 3。

```
→ 调用 qianwen/qwen3.8-omni-flash ...
   ✗ 失败: 千问调用失败(404): Model not exist.
→ 调用 qianwen/qwen3.8-flash ...
   （成功）
```

这样即使注册表有偏差、或临时某模型不可用，任务也不会中断。

---

## 与其他技能的关系

| 场景 | 用哪个 |
|---|---|
| 跨平台选模型 + 真实调用 | **本技能**（`ask`） |
| 千问专属的图片/视频/TTS 生成 | `qianwen-image-generation` 等 |
| 账户余额查询（DeepSeek） | `deepseek-balance` |
| token 用量统计 | `deepseek-usage` |

**边界**：DSH 会话内的 `subagent` 只能派发运行时放行的 provider（当前只有 `deepseek-account/deepseek-flash`）。要跨平台，**必须走本技能的 CLI**，而不是 subagent 参数。

---

## 配置项说明

`config/routing.json`：

```json
{
  "weights": {...},              // 默认权重
  "presets": {...},              // 预设权重组合
  "defaultPreset": "balanced",
  "options": {
    "respectBalance": true,      // 是否感知余额
    "fallbackDepth": 3,          // 降级链深度
    "enforceCapabilityFloor": true,  // 是否强制能力门槛
    "minTierRatio": 1.0,         // 门槛严格度（1.0 = 严格）
    "usdToCny": 7.1             // 汇率（OpenRouter 用）
  }
}
```

`minTierRatio` 调小可放宽门槛（例如 0.85 允许「差一档」的模型入选）。

---

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| `未配置 XXX_API_KEY` | 该平台没配 Key | 在 `.env` 加对应变量 |
| `Model not exist` | 模型不在该 Key 的可用范围 | 已在探测阶段过滤；若仍出现说明白名单不准 |
| 选中的模型能力不够 | 门槛太松 | 检查 `enforceCapabilityFloor` 是否为 true |
| 总是选同一个模型 | 免费额度让成本趋同 | 用 `--preset cheapest` 或调 `routing.json` 权重 |
| health 很慢 | 平台探测超时 | 加 `--no-probe` 跳过探测（但会失去余额感知） |

---

## 完整示例

```powershell
# 1. 先看平台状态
node lib/cli.mjs health

# 2. 代码审查 → 应选旗舰档
node lib/cli.mjs route "审查这段代码的安全性" --task code-review

# 3. 实际执行
node lib/cli.mjs ask "审查这段代码的安全性：function f(x){return eval(x)}" --task code-review

# 4. 省钱模式跑一批简单任务
node lib/cli.mjs ask "把这个函数改成箭头函数" --task code-writing --preset cheapest

# 5. 长文档
node lib/cli.mjs ask "总结全文要点" --task long-context --out 2000
```

---

## 目录结构

```
model-dispatch/
├── SKILL.md                    # 技能说明（本文件）
├── package.json                # npm / npx 元数据（bin: model-dispatch）
├── mr.bat                      # Windows 启动器
├── mr.sh                       # macOS/Linux 启动器
├── config/
│   ├── providers.json          # 平台与密钥配置
│   └── routing.json            # 权重与调度策略
├── lib/
│   ├── cli.mjs                 # CLI 主入口（可执行）
│   ├── setup.mjs               # 配置向导
│   ├── router.mjs              # 调度引擎（评分算法）
│   ├── registry.mjs            # 统一模型目录
│   ├── config.mjs              # 配置加载（.env 解析）
│   └── providers/
│       ├── base.mjs            # 适配器基类
│       ├── index.mjs           # 适配器装配
│       ├── qianwen.mjs         # 千问 / DashScope
│       ├── deepseek.mjs        # DeepSeek 官方
│       ├── openrouter.mjs      # OpenRouter 聚合
│       └── openai-compat.mjs   # 通用 OpenAI 兼容
├── scripts/
│   └── install.mjs             # 跨工具安装器
└── references/
    └── model-capability-map.md # 模型能力登记表
```

---

## 跨平台兼容性

| 项目 | 状态 |
|---|---|
| Windows | ✅ 已测试（PowerShell / cmd） |
| macOS | ✅ 路径处理已用 `fileURLToPath` |
| Linux | ✅ 同上 |
| Node.js 18+ | ✅ 必需（用原生 `fetch`） |
| 第三方依赖 | ✅ 零依赖 |
| AI 工具 | ✅ 遵循 Agent Skills 开放规范 |

**Windows 用户注意**：

- 若 `node` 不在 PATH 中，用 `mr.bat` 或写全路径
- CLI 的中文参数传递正常，无需特殊编码处理

**Lint / 校验**：可用官方 CLI 验证格式

```bash
npx skills add <本地目录> -y   # 能识别并安装即格式合规
```

---

## 版本

- **v1.1.0** — 支持多工具安装、交互式配置向导、跨平台路径
- v1.0.0 — 初版调度引擎
