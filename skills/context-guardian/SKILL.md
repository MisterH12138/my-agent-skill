---
name: context-guardian
description: "跨工具上下文健康检查 + 用户画像 + AI 记忆提炼。估算 token 占用、按 50%/70%/85%/95% 分级预警、生成 6 维度使用画像、从历史会话提炼跨会话记忆。支持 Claude Code、Codex、DeepSeek Harness 等 80+ 工具的真实会话数据，模型窗口表覆盖 30+ 主流模型。当对话变长、响应变慢、出现截断、用户问「还剩多少上下文」「我平时怎么用的」「帮我记住这些」时使用；也可在长任务前预检余量。不适用于纯事实问答、与上下文管理无关的任务。"
license: MIT
metadata:
  version: "1.1.0"
  author: "dsh-skills"
  tags: ["context", "token", "llm", "monitoring", "profile", "memory", "cross-tool"]
---

# Context Guardian — 跨工具上下文健康检查 · 用户画像 · 记忆提炼

**一句话**：管好你 AI 对话的「空间」——还剩多少、你怎么用的、该记住什么。

长对话最怕的不是慢，是**突然被截断**。这个技能把「还剩多少、什么时候该处理、具体怎么办」变成可测的数字和可执行的步骤；同时能从历史会话中统计使用习惯、提炼可复用的记忆。

## 三大能力

| 能力 | 一句话说明 | 命令 |
|---|---|---|
| **上下文健康检查** | 还剩多少、五级预警、怎么压缩 | `check` / `scan` |
| **用户画像** | 你平时怎么用 AI（6 个维度） | `profile` |
| **记忆提炼** | 从历史中提炼跨会话有用的信息 | `memory build` |

**全部跨平台**：不绑定任何特定 AI 工具，数据来源可以是 Claude Code、Codex、DeepSeek Harness、OpenClaw、Cursor 或任意 JSONL 格式的工具。

## 快速开始

```bash
# 检查当前上下文健康度（自动读取最近的会话）
node lib/cli.mjs check

# 扫描本机所有 AI 工具，列出各会话占用
node lib/cli.mjs scan

# 生成用户使用画像（6 个维度）
node lib/cli.mjs profile

# 从历史会话提炼记忆（会自动调用可用 AI 平台）
node lib/cli.mjs memory build

# 估算一段文本的 token 数（不读任何文件）
node lib/cli.mjs estimate "需要估算的文本内容"
```

> 已通过 `npx skills` 或 npm 全局安装后，可直接用 `context-guardian <子命令>`。

## 五级预警

| 等级 | 占用区间 | 含义 | 该做什么 |
|---|---|---|---|
| 🟢 健康 | < 50% | 正常 | 无需干预 |
| 🟡 注意 | 50-70% | 开始占较多 | 留意长输出操作 |
| 🟠 警告 | 70-85% | 建议清理 | 删掉已完成任务的中间产物 |
| 🔴 危险 | 85-95% | 即将触顶 | 压缩历史或切换大窗口模型 |
| 🆘 危急 | ≥ 95% | 随时中断 | **立即处理**：开新对话并交接摘要 |

阈值可调：

```bash
node lib/cli.mjs check --warn-at 60 --danger-at 90
```

## 支持的 AI 工具

| 工具 | 会话数据读取 | 说明 |
|---|---|---|
| **DeepSeek Harness** | ✅ 完整支持 | 解析多帧 zstd 压缩的会话日志 |
| **Claude Code** | ✅ 完整支持 | 解析 `~/.claude/projects/**.jsonl` |
| **Codex** | ✅ 完整支持 | 解析 `~/.codex/sessions/**.jsonl` |
| OpenClaw / Cursor / Gemini CLI | △ 仅检测 | 存储格式尚未支持，可用 `--tokens` 手动指定 |

`scan` 会自动探测本机装了哪些工具、数据目录在哪、能读到多少会话。

## 模型窗口表

内置 30+ 主流模型的上下文窗口，覆盖：

- **DeepSeek**：flash / pro / v4 系列（100 万）、chat / reasoner（64K）
- **千问**：qwen3.8-flash / qwen4-max（100 万）、qwen-plus（128K）
- **OpenAI**：gpt-4o / 4o-mini（128K）、gpt-4.1（100 万）、o1 / o3（200K）
- **Anthropic**：claude-sonnet-4 / opus-4 / haiku-4（200K）
- **Google**：gemini-2.5-pro / flash（100 万）
- **其他**：kimi-k2（256K）、glm-4.6（200K）、minimax-m2（200K）

查看完整列表：`node lib/cli.mjs tools`

未知模型默认按 128K 估算，可用 `--window <数量>` 覆盖。

## 命令详解

### check — 健康检查

```bash
# 自动模式：读取最近一个会话的真实用量
node lib/cli.mjs check

# 手动指定
node lib/cli.mjs check --tokens 95000 --model claude-sonnet-4

# 自定义阈值与输出预留
node lib/cli.mjs check --tokens 500000 --warn-at 60 --danger-at 90 --reserve 16384

# JSON 输出（便于脚本消费）
node lib/cli.mjs check --json
```

输出包含进度条、模型窗口、有效窗口、剩余量、预警等级和按优先级排序的建议。

### scan — 扫描本机会话

```bash
node lib/cli.mjs scan              # 全部工具
node lib/cli.mjs scan --limit 5    # 只看最近 5 个
node lib/cli.mjs scan --tool dsh   # 只看某个工具
node lib/cli.mjs scan --json
```

### estimate — 估算 token

```bash
node lib/cli.mjs estimate "一段中文文本"

# 指定模型以获得更准的系数
node lib/cli.mjs estimate "文本" --model claude-sonnet-4

# 从管道读取
cat long-file.txt | node lib/cli.mjs estimate
```

输出会拆分字符构成（中文/拉丁/数字/符号/空白/emoji）各自的 token 贡献，并给出误差区间。

### tools — 工具与窗口表

```bash
node lib/cli.mjs tools
```

## 建议的四种压缩手段

技能会根据等级给出建议，核心手段是这四类：

| 手段 | 适用场景 | 做法 |
|---|---|---|
| **删中间产物** | 警告级 | 删掉失败的命令输出、重复报错、已被替代的方案草稿 |
| **结论化** | 危险级 | 让 AI 把历史压成要点，用摘要替换长文 |
| **外置文件** | 危险级 | 大内容写进文件，对话里只留路径和关键结论 |
| **换大窗口模型** | 危险/危急 | 切到 100 万窗口的模型，可继续容纳更多上下文 |

危急时最干净的做法是**开新对话 + 交接摘要**：让 AI 输出「已完成 / 待办 / 关键决策」三项，复制到新对话开头。

## 推荐用法

### 长任务开始前

```bash
node lib/cli.mjs check --tokens 0 --model <你的模型>
```
确认可用余量够不够跑完整个任务。

### 对话进行中定期检查

```bash
node lib/cli.mjs check
```
看到 🟠 警告就该开始整理，不要等到 🔴。

### 排查「AI 变笨了」

对话很长时 AI 开始答非所问、忘记早期约定，往往是上下文压力导致。先跑一次 `check` 确认。

## 技术说明

### token 估算精度

不依赖模型专用 tokenizer，按字符类型分段估算：

| 字符类型 | 密度 |
|---|---|
| 中文/日韩 | ~1.5 字/token |
| 拉丁字母 | ~4 字符/token |
| 数字 | ~3.2 字符/token |
| 符号 | ~2.5 字符/token |
| 空白 | ~6 字符/token（与相邻词合并） |

不同模型再乘校正系数（Claude 0.95、Gemini 0.92、Qwen 1.02、GPT 1.05）。

**精度**：与真实 tokenizer 偏差通常在 ±15% 内，对预警决策足够。命令会同时给出误差区间。

### 会话数据的读取

- **DSH**：会话日志是多帧 zstd 压缩，需按 magic number（`28 B5 2F FD`）切分后逐帧解压
- **上下文规模**取单次请求的 `totalTokens`（= input + output + cacheRead），它随对话推进单调递增
- ⚠️ 不能用 `input + cacheRead` 累加，那会重复计算导致数值虚高

这些坑都已在实现中处理。

## 边界与限制

- ❌ **不主动修改任何东西**：纯只读，不删历史、不改配置
- ❌ 不是所有工具都支持读取：OpenClaw / Cursor / Gemini CLI 目前只能检测安装状态
- ⚠️ 估算有误差：±15%，临界情况建议留出安全余量
- ⚠️ 自动模式读「最近会话」：如果当前对话恰好在另一个工具里，用 `--tokens` 手动指定更准

## 目录结构

```
context-guardian/
├── SKILL.md               # 本文件
├── lib/
│   ├── cli.mjs            # CLI 入口
│   ├── estimator.mjs      # token 估算 + 模型窗口表
│   ├── analyzer.mjs       # 分级判定 + 建议生成
│   └── adapters.mjs       # 多工具会话日志适配
└── scripts/
    └── install.mjs        # 跨工具安装器
```

**依赖**：只需 Node.js ≥ 18，零第三方包。

## 与其他技能的关系

| 场景 | 用哪个 |
|---|---|
| 上下文快满，该换哪个模型 | 本技能给出建议 → `model-dispatch` 执行切换 |
| 想控制成本而非上下文 | `model-dispatch`（它做成本优化） |
| 想知道历史 token 总用量 | `deepseek-usage` |

三者互补：**context-guardian 管「空间」，model-dispatch 管「成本与能力」，deepseek-usage 管「历史账」**。

---

# 用户画像（profile）

从历史会话中统计你的使用习惯，**6 个维度**：

| 维度 | 统计内容 |
|---|---|
| 模型使用偏好 | 用了哪些模型、各自占比、token 消耗 |
| 任务类型分布 | 开发 / 审查 / 文档 / 数据分析等各占多少 |
| 会话长度与上下文 | 平均时长、平均/最大上下文峰值、调用次数 |
| 时间习惯 | 活跃天数、最活跃时段、24 小时分布热力 |
| 文件与目录偏好 | 最常涉及的文件和目录 |
| 成本趋势 | 输入/输出/缓存 token、缓存命中率、按模型分布 |

```bash
node lib/cli.mjs profile              # 人类可读报告
node lib/cli.mjs profile --json       # 机器可读
node lib/cli.mjs profile --tool dsh   # 只看某个工具的数据
```

输出末尾会附**自动生成的优化建议**，比如：

> · 你 100% 的时间用 deepseek-flash。考虑给高价值任务（代码审查、架构设计）单独配更强的模型。
> · 平均上下文峰值 129,080 tokens，中等水平。长任务前建议用 context-guardian check 预检余量。
> · 缓存命中率 99.2%，说明对话连续性良好，成本控制得当。

**所有数字都是真实统计**，样本不足时会明确标注（如「仅 1 天数据，参考价值有限」）。

---

# 记忆提炼（memory）

## 为什么需要两阶段

技能**无法真正「记住」东西**——记忆必须存在宿主的上下文里。所以走离线路线：把历史会话提炼成文件，开新对话时作为背景引用。

但直接用正则从海量对话里「提炼记忆」是错的——判断「什么值得记住」需要语义理解。所以设计成两阶段：

```
阶段 1（离线，脚本）     阶段 2（在线，AI）
海量事件                候选包
   ↓ 机械筛选              ↓ 语义精炼
68 条候选  ──────────→  20 条真正的记忆
```

## 使用

```bash
# 一键：生成候选包 → 调 AI 提炼 → 保存
node lib/cli.mjs memory build

# 只生成候选包（不调 AI）
node lib/cli.mjs memory build --pack-only

# 查看已生成的记忆
node lib/cli.mjs memory show

# 手动保存 AI 产出
node lib/cli.mjs memory save --file <路径>
```

## AI 平台自动探测

`memory build` 会按顺序查找可用的 AI 平台：

| 优先级 | 来源 |
|---|---|
| 1 | 命令行参数 `--base-url` / `--key` / `--model` |
| 2 | 环境变量或 `.env` 中的 Key（千问/DeepSeek/OpenRouter/OpenAI/Kimi/智谱/硅基流动） |
| 3 | 都没有 → 只生成候选包，提示你后续怎么处理 |

**没配 Key 也能用**：生成候选包后，让当前 AI 直接读那个文件，按其中的「提炼指令」处理即可。

## 输出示例

```markdown
## 项目
- [中] 用户正在维护 Agent Skill 项目，目标 GitHub 仓库为 `MisterH12138/my-agent-skill`。

## 偏好
- [中] 下载、批量转换、文件搬运等机械任务优先写脚本完成，不再启动子代理。

## 知识
- [中] DSH 会话记录中 `totalTokens` 表示单次请求的真实上下文规模，随对话推进递增。
- [中] 千问 `sk-sp-` 类型密钥必须走 Token Plan 专用端点，用默认端点会报 401。

## 待办
- [低] 在 GitHub 创建远程仓库并配置推送凭据（状态待确认）。
```

**置信度标注**：`[高]` = 用户明确说过；`[中]` = 从行为推断；`[低]` = 仅为可能。

## 存储

默认写到当前工作目录的 `memory/`：

```
memory/
├── candidates.md   # 候选包（脚本生成，供 AI 读）
├── candidates.json # 同上，结构化
├── summary.md      # 精炼后的记忆 ← 开新对话时引用这个
├── summary.json    # 同上，结构化
└── index.json      # 生成历史索引
```

用 `--dir <路径>` 可改变存储位置。

## 怎么用提炼出的记忆

开新对话时：

```
请先阅读 memory/summary.md，了解我之前的工作背景再回答。
```

多数 AI 工具都支持读文件，这一句就够。

## 已知限制（诚实说明）

- **候选是机械筛选的**：可能漏掉重要的、也收进无关的。AI 阶段会二次过滤，但不能保证不遗漏。
- **待办容易过时**：历史里说「稍后做」的事，可能后来已经完成了。提示词已要求 AI 谨慎判断并标注，但仍可能有偏差。
- **记忆不会自动更新**：需要定期重跑 `memory build`。
- **不建议高频重跑**：每次都要调 AI，会消耗额度。

---

## 跨平台设计

本技能**不绑定任何特定 AI 工具**，体现在三层：

### 1. 数据来源可扩展

内置 10 个已知工具的解析器，覆盖 `~/.claude`、`~/.codex`、`~/.dsh`、`~/.openclaw`、`~/.cursor` 等目录。

**任何 JSONL/JSON 格式的工具**都能通过 `config/parsers.json` 注册：

```json
{
  "tools": [
    {
      "id": "my-tool",
      "label": "我的工具",
      "dirs": ["~/.my-tool/sessions"]
    }
  ]
}
```

注册后会被通用解析器处理（自动嗅探 timestamp / role / content / usage 字段）。

### 2. AI 平台可替换

7 个预置平台（千问/DeepSeek/OpenRouter/OpenAI/Kimi/智谱/硅基流动）+ 任意 OpenAI 兼容端点（含本地 Ollama）。

### 3. 无 AI 也能用

最差情况：生成候选包，交给任意 AI 手动处理。功能不会被环境限制死。

### 安装路径覆盖

`scripts/install.mjs` 内置 12 种工具的技能目录，也支持 `--dir` 自定义。而 `npx skills add` 本身支持 80+ 工具。

---

## 版本

- **v1.1.0** — 新增用户画像（6 维度）、AI 记忆提炼（两阶段）、跨平台解析器注册
- v1.0.0 — 上下文健康检查、五级预警、token 估算
