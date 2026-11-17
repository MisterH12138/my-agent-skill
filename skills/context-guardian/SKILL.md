---
name: context-guardian
description: "跨工具上下文健康检查。估算 token 占用、按 50%/70%/85%/95% 分级预警、给出可执行的压缩建议。支持 Claude Code、Codex、DeepSeek Harness 等工具的真实会话数据读取，模型窗口表覆盖 30+ 主流模型。当对话变长、响应变慢、出现截断或报错、用户问「还剩多少上下文」「会不会超限」「怎么压缩」时使用；也可在开始长任务前预检余量。不适用于纯事实问答、与上下文管理无关的任务。"
license: MIT
metadata:
  version: "1.0.0"
  author: "dsh-skills"
  tags: ["context", "token", "llm", "monitoring", "cross-tool"]
---

# Context Guardian — 跨工具上下文健康检查

**一句话**：告诉你当前对话还能撑多久，以及在超限之前该做什么。

长对话最怕的不是慢，是**突然被截断**——上下文塞满后，模型开始丢历史、答非所问，甚至直接报错中断。这个技能把「还剩多少、什么时候该处理、具体怎么处理」变成可测的数字和可执行的步骤。

## 它解决什么

| 痛点 | 本技能给出的答案 |
|---|---|
| 不知道对话还剩多少空间 | 精确的 token 占用与剩余量 |
| 不知道什么时候该处理 | 5 级预警：健康 / 注意 / 警告 / 危险 / 危急 |
| 不知道该怎么压缩 | 按当前等级给可执行建议，而非泛泛而谈 |
| 换工具就得重新适应 | 一套命令，适配多个 AI 工具 |

## 快速开始

```bash
# 检查当前上下文健康度（自动读取最近的会话）
node lib/cli.mjs check

# 扫描本机所有 AI 工具，列出各会话占用
node lib/cli.mjs scan

# 估算一段文本的 token 数（不读任何文件）
node lib/cli.mjs estimate "需要估算的文本内容"

# 手动指定用量
node lib/cli.mjs check --tokens 150000 --model claude-sonnet-4
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
