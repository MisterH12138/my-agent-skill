# 模型能力登记表

本文件是 `model-dispatch` 技能的**可选覆盖层**。技能会优先读取这里的映射；若文件不存在或某任务类型未登记，则回退到 `SKILL.md` 的通用规则。

## 如何使用

1. 先运行 `list_subagent_models` 拿到你环境里**真实可用**的 provider / model
2. 把匹配结果填到下方对应任务类型
3. 未填写的项保持 `auto`，技能会按通用特征选择

## 填写规范

```yaml
task_type:            # 8 类之一
  provider: <id>      # 必填，必须真实存在
  model: <id>         # 必填，必须真实存在
  effort: high|medium|low   # 可选，推理深度
  note: <说明>        # 可选，为什么选它
```

---

## 当前登记（截至首次创建）

```yaml
# 环境探测结果：本会话仅放行 deepseek-account
# 其余 provider 均返回 "not allowed for this Session"

code-writing:
  provider: auto
  model: auto
  effort: medium
  note: 均衡型即可，无需最强

code-review:
  provider: auto
  model: auto
  effort: high
  note: 精度要求高，需对抗式审查

architecture:
  provider: auto
  model: auto
  effort: high
  note: 最需要推理深度

documentation:
  provider: auto
  model: auto
  effort: medium

data-analysis:
  provider: auto
  model: auto
  effort: medium

creative-writing:
  provider: auto
  model: auto
  effort: low
  note: 创造性优先，深度反而拖慢

long-context:
  provider: auto
  model: auto
  effort: medium
  note: 关键是大窗口，需分批

unit-test:
  provider: auto
  model: auto
  effort: medium
```

---

## 已确认可用的模型（供参考）

| provider | model | 备注 |
|---|---|---|
| `deepseek-account` | `deepseek-flash` | DSH 会话内唯一放行，DeepSeek-V4.1-Flash |

### 千问账户（独立于 DSH 路由）

已通过 `qianwen auth login`（Device Flow）登录，账号 `15276******@163.com`，token scope：
`inference:read`、`usage:read`、`config:write`。

**重要边界**：登录授权只解锁**账户类操作**，不提供模型推理能力。两者是分开的：

| 能力 | 登录后 | 说明 |
|---|---|---|
| `qianwen models list` | ✅ 可用 | 查模型、免费额度、价格 |
| `qianwen usage summary` | ✅ 可用 | 查用量 |
| `qianwen billing balance summary` | ✅ 可用 | 查余额 |
| `qianwen workspace list` | ✅ 可用 | 查业务空间 |
| `qianwen chat create` | ✅ **已可用** | 已配 `sk-sp-` Token Plan 密钥 |

推理调用使用 `DASHSCOPE_API_KEY`（配置在 `D:\deskwork\.env`）。

> 探测时间：2026-11-17
> 重新探测方法：`list_subagent_models()` 与 `list_subagent_models({provider})`

### 千问可用模型（20 个，全部经 `qianwen models list` 确认）

**有免费额度（16 个）**：`qwen4-max`、`qwen3.8-max`、`qwen3.8-omni-flash`、`qwen3.8-27b`、
`qwen3.8-2.4t-a95b`、`qwen-image-3.0`、`qwen-image-3.0-pro`、
`qwen-audio-3.1-tts-plus`/`tts-flash`/`tts-next`、`qwen-audio-3.1-realtime-flash`/`plus`、
`qwen-audio-3.1-asr-flash`/`flash-message`/`flash-filetrans`/`flash-streaming`

**无免费额度（4 个）**：`qwen3.8-max-0902`（12/36 CNY per 1M）、`qwen3.8-flash`（0.8/2.7）、
`wan3.0-video-prime`、`wan3.0-video`

> 免费额度多为 1,000,000 tokens，图片类为 10 次。
> 账户现金余额 `0.00` CNY —— Token Plan 走订阅额度（45,000 credits/月），不扣现金。

### Token Plan 实测边界（重要）

当前密钥为 **Token Plan 个人版 Essential**（`sk-sp-`），到期 2026-12-12。实测：

| 模型 | 状态 |
|---|---|
| `qwen3.8-flash` / `qwen3.7-plus` / `qwen4-max` | ✅ 文本调用正常 |
| `qwen-image-3.0-pro` | ✅ 图片生成正常 |
| `qwen-image-3.0` / `qwen-image` | ❌ `MODEL_NOT_SUPPORTED` |

**规则**：Token Plan 下图片生成用 `-pro` 变体。看到 `qwen models list` 列出某模型
**不等于**当前密钥能用它——必须以实际调用为准。

## 接入更多模型的途径

### 途径 1：千问 Qwen（已装 CLI）

```powershell
qianwen auth login          # 设备码登录
qianwen models list         # 查看可用模型
```

登录后重启 DSH，在 `list_subagent_models` 中确认出现。

### 途径 2：DeepSeek API Key

在 `.env` 配置 `DEEPSEEK_API_KEY`，可启用 `deepseek` provider（非 account 版）。

### 途径 3：profile 配置

编辑 `C:\Users\DELL\.dsh\profiles\desktop\cordis.patch.yml` 调整 provider 放行策略，改完需重启客户端。

---

## 维护建议

- 每次发现新可用模型，**实测**一次再登记，不要凭名字猜能力
- `note` 字段记录选择理由，方便回看
- 此文件改动**立即生效**（技能每次执行都会读取），无需重启
