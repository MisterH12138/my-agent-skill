# Model Dispatch

> 让 AI 每次干活都自动用上「最省钱又不降能力」的模型。

一个跨平台的智能模型调度技能。它根据**任务类型**、**上下文长度**、**各平台余额与免费额度**，自动选出最合适的模型并直接调用。不依赖任何特定 AI 工具，可安装到 Claude Code、Cursor、Codex、OpenClaw 等 80+ 支持 Agent Skills 的工具。

---

## 它解决什么问题

你手上有多个 AI 平台的 API Key，常见的困惑是：

- 写个简单文案，用旗舰模型是不是太贵了？
- 审一段安全代码，用小模型会不会漏掉漏洞？
- 千问的免费额度还剩多少？该不该切到 DeepSeek？
- 这个平台报错了，能不能自动换个模型继续？

`model-dispatch` 把这些问题变成一次自动决策：

```
你:  帮我审查这段代码
它:  任务类型 code-review → 需要高推理能力 → 要求旗舰档
     → 候选: qwen4-max (免费额度充足) / qwen3.8-max / deepseek-reasoner
     → 选出: qwen/qwen4-max  预估成本 ¥0（免费额度抵扣）
     → 真实调用 → 返回审查结果
```

---

## 核心特性

### 能力不打折扣（两阶段决策）

**第一阶段：硬约束筛除** —— 不满足的模型直接淘汰，不参与打分

| 任务推理需求 | 要求最低档位 | 典型任务 |
|---|---|---|
| ≥ 0.85 | 旗舰 | 代码审查、架构设计 |
| ≥ 0.65 | 强力 | 代码编写、数据分析、单测 |
| ≥ 0.50 | 均衡 | 文档撰写、长上下文 |
| < 0.50 | 不限 | 创意文案、闲聊 |

**第二阶段：加权打分** —— 在合格者中选最优

```
score = 0.40×能力 + 0.25×成本 + 0.15×上下文 + 0.15×可用性 + 0.05×档位
```

这样便宜但能力不够的模型**根本进不了打分环节**，不可能为了省钱牺牲质量。

### 余额与额度感知

| 平台 | 探测能力 |
|---|---|
| DeepSeek | 真实余额查询，余额为 0 自动剔除 |
| 千问 | 获取当前 Key **实际可调的模型白名单** |
| OpenRouter | credits 余额 |
| 通用 OpenAI 兼容 | 连通性探测 |

> 关键细节：千问 `models list` 显示的模型 ≠ 当前 Key 能调的模型。本技能会探测实际可用列表并据此过滤，避免 `404 Model not exist`。

### 自动降级

首选模型失败时，自动尝试次优，默认深度 3。任务不会因为单个模型不可用而中断。

### 零依赖

- 只需 **Node.js ≥ 18**（使用原生 `fetch`）
- **无任何第三方 npm 包**
- 不依赖任何特定 AI 框架

---

## 安装

### 方式一：npx skills（推荐）

```bash
npx skills add <owner>/<repo> --skill model-dispatch

# 全局安装
npx skills add <owner>/<repo> --skill model-dispatch -g

# 指定目标工具
npx skills add <owner>/<repo> --skill model-dispatch -a claude-code
```

### 方式二：ClawHub / OpenClaw

```bash
openclaw skills install model-dispatch
```

或直接放到 `~/.openclaw/skills/model-dispatch/`。

### 方式三：自带安装器

```bash
node scripts/install.mjs --list              # 列出 12 种工具的目录
node scripts/install.mjs                     # 自动检测并安装
node scripts/install.mjs --agent openclaw    # 指定工具
node scripts/install.mjs --dir <自定义目录>
```

### 方式四：手动复制

| 工具 | 技能目录 |
|---|---|
| Claude Code | `~/.claude/skills/` |
| Cursor | `~/.cursor/skills/` |
| Codex | `~/.codex/skills/` 或 `./.agents/skills/` |
| OpenClaw | `~/.openclaw/skills/` |
| Qoder | `~/.qoder/skills/` |
| Qwen Code | `~/.qwen/skills/` |
| 通用约定 | `~/.agents/skills/` |

---

## 配置

```bash
# 交互式向导
node lib/cli.mjs setup
```

或直接设置环境变量：

```bash
# Linux / macOS
export DASHSCOPE_API_KEY=sk-...
export DEEPSEEK_API_KEY=sk-...

# Windows
setx DASHSCOPE_API_KEY "sk-..."
setx DEEPSEEK_API_KEY "sk-..."
```

也可以在工作目录放一个 `.env` 文件（支持向上查找父目录，自动处理 BOM）。

**支持的平台**：

| 平台 | 环境变量 | 说明 |
|---|---|---|
| 千问 / 阿里云 | `DASHSCOPE_API_KEY` | `sk-sp-` 自动识别为 Token Plan |
| DeepSeek | `DEEPSEEK_API_KEY` | 有真实余额可查 |
| OpenRouter | `OPENROUTER_API_KEY` | 一个 Key 接入 Claude / Gemini / GPT |
| Kimi、智谱、硅基流动、MiniMax、Ollama 等 | 自定义 | 配置里已预置，取消注释即可 |

---

## 使用

```bash
# 查看平台状态与余额
model-dispatch health

# 查看调度决策（不实际调用）
model-dispatch route "帮我审查这段代码" --task code-review

# 调度 + 真实调用
model-dispatch ask "实现一个快速排序" --task code-writing

# 列出可用模型
model-dispatch models

# 查看配置（密钥自动脱敏）
model-dispatch config
```

### 任务类型

`code-writing` · `code-review` · `architecture` · `documentation` · `data-analysis` · `creative-writing` · `long-context` · `unit-test` · `chat`

不指定时按关键词自动推断。

### 权重预设

| 预设 | 适用 |
|---|---|
| `balanced`（默认） | 日常使用 |
| `cheapest` | 省钱优先 |
| `best-quality` | 质量优先 |
| `long-context` | 长文档 |

```bash
model-dispatch ask "总结这份报告" --preset long-context
```

---

## 扩展示例

### 接入一个 OpenAI 兼容平台

编辑 `config/providers.json`：

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

再加环境变量 `MOONSHOT_API_KEY=sk-...` 即可。

### 添加模型到目录

编辑 `lib/registry.mjs` 的 `BUILTIN_MODELS`，或创建 `config/models.json` 覆盖。

### 自定义权重

编辑 `config/routing.json` 的 `presets`。

---

## 目录结构

```
model-dispatch/
├── SKILL.md                    # 技能说明（Agent 读取）
├── README.md                   # 本文件（人类阅读）
├── package.json                # npm / npx 元数据
├── mr.bat / mr.sh              # 跨平台启动器
├── config/
│   ├── providers.json          # 平台与密钥配置
│   └── routing.json            # 权重与调度策略
├── lib/
│   ├── cli.mjs                 # CLI 入口
│   ├── setup.mjs               # 配置向导
│   ├── router.mjs              # 调度引擎
│   ├── registry.mjs            # 模型目录
│   ├── config.mjs              # 配置加载
│   └── providers/              # 平台适配器
├── scripts/
│   └── install.mjs             # 跨工具安装器
└── references/
    └── model-capability-map.md # 能力登记表
```

---

## 常见问题

**Q: 为什么不用原来的名字 `model-router`？**
skills.sh 上已有 4 个同名技能，改用 `model-dispatch` 避免冲突，也更准确表达「派发调度」的语义。

**Q: 支持哪些 AI 工具？**
任何支持 Agent Skills 开放规范的工具，包括 Claude Code、Cursor、Codex、OpenClaw、Qoder、Qwen Code、Windsurf、Gemini CLI 等 80+ 个。

**Q: 会不会泄露我的 API Key？**
不会。密钥只在本地读取，`config` 命令输出时自动脱敏（如 `sk-****abcd (len=115)`），不会写入日志或上传。

**Q: 模型能力评分怎么来的？**
基于任务推理需求与模型档位的匹配度。档位分为旗舰/强力/均衡/轻快四档，可通过 `config/routing.json` 调整门槛。

---

## 相关

- [Agent Skills 规范](https://agentskills.io)
- [skills.sh 技能市场](https://skills.sh)
- [OpenClaw](https://openclaw.ai)
- [ClawHub](https://docs.openclaw.ai/clawhub)

## License

MIT
