---
name: keykeeper
description: "跨平台 API Key 池管理。多 Key 轮询、健康检查、失效自动切换、端点自动推断（解决 sk-sp- 走错端点报 401 这类问题）。支持千问、DeepSeek、OpenRouter、OpenAI、Kimi、智谱、硅基流动等 9 个平台及任意 OpenAI 兼容接口。当 API 报 401/403/429、Key 失效需要切换、要检查 Key 有效性、需要多 Key 负载均衡、或想知道某平台该用哪个端点时使用。不适用于与 API Key 管理无关的任务。"
license: MIT
metadata:
  version: "1.0.0"
  author: "dsh-skills"
  tags: ["api-key", "key-management", "llm", "openai-compatible", "cross-platform"]
---

# Keykeeper — 跨平台 API Key 池管理

**一句话**：让你的多个 API Key 自己管好自己——失效自动跳过、端点自动选对、状态一目了然。

## 它解决什么

| 痛点 | 本技能的解法 |
|---|---|
| Key 失效了，程序报错中断 | 健康检查 + 自动跳过失效 Key |
| `sk-sp-` Key 走默认端点报 401 | 按 Key 前缀**自动选对的端点** |
| 多个 Key 想负载均衡 | 轮询取 Key |
| 不知道哪个 Key 还能用 | 一条命令查看全部状态 |
| 不敢把 Key 写在代码里 | 从环境变量/`.env` 读取，输出永远脱敏 |

## 快速开始

```bash
# 查看所有平台 Key 状态（不联网，很快）
node lib/cli.mjs status

# 测试所有 Key 是否真的可用（联网）
node lib/cli.mjs test

# 看某平台的 Key 会用哪个端点
node lib/cli.mjs endpoint qianwen

# 取一个可用 Key（给脚本用）
node lib/cli.mjs pick qianwen
```

> 已通过 `npx skills` 或 npm 全局安装后，可直接用 `keykeeper <子命令>`。

## 核心特性：端点自动推断

这是本项目最实用的一条。**同一个平台的 Key 类型不同，端点也不同**：

```
千问 sk-sp-...  →  https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
千问 sk-ws-...  →  https://dashscope.aliyuncs.com/compatible-mode/v1
```

用错端点会直接 **401 Incorrect API key**——而且报错信息不会告诉你原因，很容易误判成 Key 坏了。

`keykeeper` 按前缀自动判断：

```bash
$ keykeeper endpoint qianwen
千问 / 阿里云 DashScope 端点信息

默认端点 : https://dashscope.aliyuncs.com/compatible-mode/v1
TokenPlan: https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1

各 Key 实际使用的端点：
  sk-sp-…NOcw → https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
                Key 前缀 sk-sp- → Token Plan 专属端点
```

## 多 Key 配置

在环境变量或 `.env` 里用 `_1`、`_2` 后缀即可：

```env
DASHSCOPE_API_KEY_1=sk-sp-aaaaaaaa
DASHSCOPE_API_KEY_2=sk-sp-bbbbbbbb
DASHSCOPE_API_KEY_3=sk-ws-cccccccc
```

也可以只在 `config/keys.json` 里配：

```json
{
  "providers": {
    "qianwen": ["sk-sp-aaa", "sk-sp-bbb"]
  }
}
```

三种来源（config / 环境变量 / `.env`）会合并去重。

## 命令详解

### status — 查看状态（不联网）

```bash
keykeeper status                  # 只看有 Key 的平台
keykeeper status --all            # 包含没配 Key 的平台
keykeeper status --verbose         # 显示端点来源、检测历史
keykeeper status --platform qianwen
```

输出示例：

```
Key 池状态

状态文件 : C:\Users\DELL\.keykeeper\state.json
环境文件 : D:\deskwork\.env

千问 / 阿里云 DashScope（1/1 可用）
  🟢 sk-sp-…NOcw (115 字符)   可用   token-plan   .env 中的 DASHSCOPE_API_KEY

DeepSeek（1/1 可用）
  🟢 sk-45d…63b9 (35 字符)    可用   default      .env 中的 DEEPSEEK_API_KEY

合计：2/2 个 Key 可用
```

### test — 健康检查（联网）

```bash
keykeeper test                    # 测所有平台
keykeeper test --platform qianwen
keykeeper test --timeout 30       # 单 Key 超时秒数（默认 20）
```

输出：

```
千问 / 阿里云 DashScope
  🟢 sk-sp-…NOcw (115 字符)   可用      279ms  可用
  🔴 sk-inv…0000 (34 字符)    无效      158ms  Key 无效或权限不足 (HTTP 401)

结果：1/2 可用
```

**状态会持久化**到 `~/.keykeeper/state.json`，下次 `pick` 会自动跳过失效的。

### pick — 取一个可用 Key

```bash
keykeeper pick qianwen                    # 只输出 Key 本身（给脚本消费）
keykeeper pick qianwen --show-endpoint    # 输出 KEY= 和 BASE_URL=
keykeeper pick qianwen --json             # 结构化输出
keykeeper pick qianwen --rotate           # 轮询取下一个
```

**供其他程序使用**：

```bash
KEY=$(keykeeper pick qianwen)
BASE=$(keykeeper pick qianwen --show-endpoint | grep BASE_URL | cut -d= -f2)
curl -H "Authorization: Bearer $KEY" "$BASE/models"
```

> ⚠️ `pick` 按设计输出明文 Key（否则没法用）。**只有 `status`/`test`/`endpoint` 是脱敏的。** 别把 `pick` 的输出打到日志里。

### endpoint — 端点诊断

```bash
keykeeper endpoint qianwen
keykeeper endpoint deepseek
```

**401 排查神器**：如果某平台报 401 但你确信 Key 是对的，先跑这个看端点选对没有。

### platforms — 支持的平台

```bash
keykeeper platforms
```

| 平台 | 环境变量 |
|---|---|
| `qianwen` | `DASHSCOPE_API_KEY` / `QIANWEN_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `moonshot` | `MOONSHOT_API_KEY` |
| `zhipu` | `ZHIPU_API_KEY` |
| `siliconflow` | `SILICONFLOW_API_KEY` |
| `minimax` | `MINIMAX_API_KEY` |
| `ollama` | 无需 Key（本地） |

## 安全设计

| 项目 | 做法 |
|---|---|
| **状态文件** | 只存 Key 的 SHA256 指纹，**不存明文** |
| **默认输出** | `status`/`test`/`endpoint` 全部脱敏（`sk-sp-…NOcw (115 字符)`） |
| **Key 来源** | 环境变量 / `.env` / `config/keys.json`，三种都支持 |
| **日志** | 不写任何含 Key 的日志 |
| **`pick` 例外** | 按设计输出明文，供程序消费；注意不要重定向到日志文件 |

## 与其他技能的关系

`keykeeper` 是**底层设施**，可以被其他技能调用：

```
model-dispatch    → 决定用哪个模型
        ↓ 需要 Key 时
keykeeper         → 提供可用 Key + 正确端点
```

集成方式：

```javascript
import { pickKey } from './keykeeper/lib/pool.mjs';
const k = pickKey('qianwen');
// k.key → 明文（内部用）
// k.endpoint.baseURL → 正确端点
```

## 跨平台说明

本技能遵循 [Agent Skills 开放规范](https://agentskills.io)，可安装到 Claude Code、Cursor、Codex、OpenClaw、Qoder、Qwen Code 等 **80+ 工具**。

- **操作系统**：纯 Node.js ≥ 18，Win/macOS/Linux 通用
- **AI 平台**：9 个预置 + 任意 OpenAI 兼容端点
- **无第三方依赖**
- **形态**：既是 CLI 程序（人直接敲），也是 Skill（AI 调用）

## 已知限制

- **只做 Key 管理，不代理请求**：它帮你选 Key、给端点，发请求还得你自己来
- **健康检查依赖 `/models` 端点**：少数平台该路径不同，会显示「端点可达」而非「可用」
- **状态不自动刷新**：`test` 才会更新，`status` 读的是上次结果
- **`ollama` 本地模型**：不做 Key 检查，只列出来

## 目录结构

```
keykeeper/
├── SKILL.md              # 本文件
├── package.json          # bin: keykeeper
├── lib/
│   ├── cli.mjs           # 命令入口
│   ├── pool.mjs          # 密钥池核心（收集/检查/选择）
│   └── platforms.mjs     # 平台定义与端点推断
└── config/
    └── keys.json         # 显式配置（可选，注意别提交）
```
