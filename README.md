# my-agent-skill

个人自用的 AI Agent 技能库。遵循 [Agent Skills 开放规范](https://agentskills.io)，可被 Claude Code、Cursor、Codex、OpenClaw、Qoder、Qwen Code 等 80+ 工具直接安装使用。

---

## 技能列表

| 技能 | 版本 | 说明 |
|---|---|---|
| [model-dispatch](skills/model-dispatch/) | 1.1.0 | 跨平台智能模型调度：按任务类型、上下文长度、平台余额与免费额度，自动选最省且不降能力的模型并直接调用 |

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
│   └── model-dispatch/    # 技能本体
│       ├── SKILL.md       # Agent 读取的技能说明
│       ├── README.md      # 人类阅读的详细文档
│       ├── lib/           # 调度引擎与平台适配器
│       ├── config/        # 配置
│       └── scripts/       # 安装器
└── dist/                  # 发布产物（zip 包）
```

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
