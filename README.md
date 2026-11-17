# my-agent-skill

个人自用的 AI Agent 技能库。遵循 [Agent Skills 开放规范](https://agentskills.io)，可被 Claude Code、Cursor、Codex、OpenClaw、Qoder、Qwen Code 等 80+ 工具直接安装使用。

---

## 技能列表

| 技能 | 版本 | 说明 |
|---|---|---|
| [model-dispatch](skills/model-dispatch/) | 1.1.0 | 跨平台智能模型调度：按任务类型、上下文长度、平台余额与免费额度，自动选最省且不降能力的模型并直接调用 |
| [context-guardian](skills/context-guardian/) | 1.1.0 | 跨工具上下文健康检查 + 用户画像 + AI 记忆提炼 |
| [keykeeper](skills/keykeeper/) | 1.0.0 | 跨平台 API Key 池管理：多 Key 轮询、健康检查、端点自动推断 |

---

## 安装

### 方式一：npx skills

```bash
# 安装全部技能
npx skills add MisterH12138/my-agent-skill

# 只装指定技能
npx skills add MisterH12138/my-agent-skill --skill model-dispatch

# 全局安装
npx skills add MisterH12138/my-agent-skill --skill model-dispatch -g

# 指定目标工具
npx skills add MisterH12138/my-agent-skill --skill model-dispatch -a claude-code
```

### 方式二：直接克隆

```bash
git clone https://github.com/MisterH12138/my-agent-skill.git
# 把 skills/ 下的目录复制到你的 agent 技能目录
```

### 方式三：手动复制

把 `skills/<技能名>/` 整个目录复制到以下任一位置：

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

## model-dispatch

> 让 AI 每次干活都自动用上「最省钱又不降能力」的模型。

**解决的问题**：手上有多个 AI 平台的 API Key，但不知道该用哪个——写文案用旗舰模型太浪费，审安全代码用小模型又怕漏漏洞，这个平台余额没了怎么切？

**做法**：两阶段决策

1. **硬约束筛除**：按任务推理需求强制最低能力档位，不达标的直接淘汰
2. **加权打分**：在合格者中按能力、成本、上下文、可用性综合选优

**核心特性**：

- 能力门槛保证质量下限，便宜模型不会因省钱而胜出
- 余额与免费额度感知（DeepSeek 查真实余额、千问查实际可调模型白名单）
- 失败自动降级，任务不中断
- 零第三方依赖，只需 Node.js 18+

**快速使用**：

```bash
node lib/cli.mjs setup                    # 配置 API Key
node lib/cli.mjs health                   # 查看各平台状态与余额
node lib/cli.mjs ask "实现一个快速排序"    # 调度 + 执行
```

详细文档见 [skills/model-dispatch/README.md](skills/model-dispatch/README.md)。

---

## 仓库结构

```
my-agent-skill/
├── README.md              # 本文件
├── .gitignore             # 忽略密钥与产物
├── skills/
│   ├── model-dispatch/    # 跨平台模型调度
│   │   ├── SKILL.md       # Agent 读取的技能说明
│   │   ├── README.md      # 人类阅读的详细文档
│   │   ├── lib/           # 调度引擎与平台适配器
│   │   ├── config/        # 配置
│   │   └── scripts/       # 安装器
│   ├── context-guardian/  # 上下文健康检查
│   │   ├── SKILL.md
│   │   ├── lib/           # 估算器、分析器、画像、记忆
│   │   └── config/
│   └── keykeeper/         # API Key 池管理
│       ├── SKILL.md
│       ├── lib/           # 密钥池、平台定义
│       └── config/
└── dist/                  # 发布产物（zip 包）
```

---

## context-guardian

> 管好你 AI 对话的「空间」——还剩多少、你怎么用的、该记住什么。

**三大能力**：

| 能力 | 说明 | 命令 |
|---|---|---|
| **上下文健康检查** | 还剩多少、五级预警、怎么压缩 | `check` / `scan` |
| **用户画像** | 6 维度统计你的使用习惯 | `profile` |
| **记忆提炼** | 从历史中提炼跨会话有用的信息 | `memory build` |

**跨平台设计**：

- 内置 10 个工具的数据解析器（Claude Code / Codex / DSH / OpenClaw / Cursor 等）
- 任意 JSONL 格式工具可通过 `config/parsers.json` 注册
- 7 个 AI 平台可切换（千问 / DeepSeek / OpenRouter / OpenAI / Kimi / 智谱 / 硅基流动）
- 没配 AI Key 也能用（生成候选包手动处理）

**快速使用**：

```bash
node lib/cli.mjs check            # 检查当前上下文健康度
node lib/cli.mjs profile          # 生成用户使用画像
node lib/cli.mjs memory build     # 提炼记忆（自动调 AI）
node lib/cli.mjs scan             # 扫描本机所有会话占用
```

**实测输出**：

```
🟠 上下文健康度：警告（78.6%）
  [███████████████████████░░░░░░░]
  模型窗口    : 1,000,000 tokens
  当前占用    : 780,000 tokens

用户使用画像
■ 模型使用偏好
  deepseek-flash    100%  ████████████████████
■ 任务类型分布
  技能与插件         58.2%  ████████████
  代码编写          24.1%  █████
■ 优化建议
  · 你 100% 的时间用 deepseek-flash。考虑给高价值任务单独配更强的模型。
```

详细文档见 [skills/context-guardian/SKILL.md](skills/context-guardian/SKILL.md)。

---

## keykeeper

> 让你的多个 API Key 自己管好自己——失效自动跳过、端点自动选对、状态一目了然。

**解决的问题**：

- 某个 Key 失效了 → 程序报错中断？现在会自动跳过。
- `sk-sp-` 开头的千问 Key 报 401 → 实际是**端点选错了**，不是 Key 坏了。
- 配了多个 Key → 手动管理太麻烦。

**核心特性**：

| 特性 | 说明 |
|---|---|
| **端点自动推断** | 按 Key 前缀选对端点（`sk-sp-` → Token Plan 专属端点，避免 401） |
| **多 Key 池** | `KEY_NAME_1` / `KEY_NAME_2` 后缀即可配置多个，自动去重 |
| **健康检查** | 逐个测试 Key，标记可用 / 无效 / 限流 |
| **失效跳过** | `pick` 自动跳过标记为无效的 Key |
| **状态持久化** | 检测结果存 `~/.keykeeper/state.json`（只存指纹，不含明文） |

**支持平台**：千问、DeepSeek、OpenRouter、OpenAI、Kimi、智谱、硅基流动、MiniMax、Ollama（9 个）+ 任意 OpenAI 兼容端点。

**快速使用**：

```bash
keykeeper status              # 查看 Key 池状态（不联网）
keykeeper test                # 测试所有 Key（联网）
keykeeper endpoint qianwen    # 看各 Key 会用哪个端点
keykeeper pick qianwen        # 取一个可用 Key
```

**实测输出**：

```
千问 / 阿里云 DashScope
  🟢 sk-sp-…NOcw (115 字符)   可用      279ms  可用
  🔴 sk-inv…0000 (34 字符)    无效      158ms  Key 无效或权限不足 (HTTP 401)

结果：1/2 可用
```

详细文档见 [skills/keykeeper/SKILL.md](skills/keykeeper/SKILL.md)。

---

## 添加新技能

1. 在 `skills/` 下新建目录
2. 创建 `SKILL.md`，包含 YAML frontmatter：

```markdown
---
name: my-skill
description: 这个技能做什么，什么时候该用
---

# My Skill

给 Agent 的操作指引...
```

3. 提交推送即可，`npx skills` 会自动发现

---

## 安全说明

- 本仓库**不包含任何 API Key**，所有密钥通过环境变量或本地 `.env` 提供
- `.gitignore` 已排除 `.env`、`*.key`、凭据文件
- 安装第三方技能前请检查内容，技能运行时拥有完整 Agent 权限

## License

MIT
