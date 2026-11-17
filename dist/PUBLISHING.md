# 发布指南

本文件说明如何把 `model-dispatch` 发布到 GitHub，使其可以通过 `npx skills add` 一行安装。

## 当前状态

| 项目 | 状态 |
|---|---|
| 技能本体 | ✅ 完成（v1.1.0） |
| README.md | ✅ 完成 |
| .gitignore | ✅ 完成（已排除密钥） |
| .env.example | ✅ 完成 |
| 分发包 | ✅ `dist/model-dispatch-v1.1.0.zip` |
| Git 环境 | ❌ **本机未安装 Git** |
| 远程仓库 | ⬜ 待创建 |

---

## 第一步：安装 Git

### 方式 A：官网安装（推荐）

1. 打开 https://git-scm.com/download/win
2. 下载 64-bit Git for Windows Setup
3. 一路默认安装即可
4. 装完**新开一个终端**验证：

```powershell
git --version
```

### 方式 B：winget（Windows 10/11）

```powershell
winget install --id Git.Git -e --source winget
```

### 方式 C：用 GitHub Desktop

https://desktop.github.com/ —— 图形界面，自带 Git，适合不想碰命令行的人。

---

## 第二步：配置身份

```powershell
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

---

## 第三步：在 GitHub 建仓库

1. 打开 https://github.com/new
2. **Repository name** 填：`model-dispatch`（或你喜欢的名字，如 `agent-skills`）
3. **可见性**：Public（`npx skills add` 需要公开访问）
4. **不要**勾选 "Add a README file"（我们已经有）
5. 点 Create repository

创建后记下仓库地址，形如：
```
https://github.com/你的用户名/model-dispatch.git
```

---

## 第四步：初始化并推送

在技能目录执行：

```powershell
cd D:\deskwork\.dsh\skills\model-dispatch

git init
git add .
git commit -m "feat: model-dispatch v1.1.0 - 跨平台智能模型调度"

git branch -M main
git remote add origin https://github.com/你的用户名/model-dispatch.git
git push -u origin main
```

> 首次推送会要求登录。推荐用 GitHub Personal Access Token 代替密码：
> https://github.com/settings/tokens （勾选 `repo` 权限）

---

## 第五步：验证安装

推送成功后，**让别人（或你自己换台机器）**测试：

```bash
npx skills add 你的用户名/model-dispatch --skill model-dispatch
```

如果仓库里有多个技能，用 `--skill` 指定；只有这一个可以直接：

```bash
npx skills add 你的用户名/model-dispatch
```

---

## 推送前的检查清单

- [ ] `git --version` 能正常输出
- [ ] `git config user.name` 和 `user.email` 已设置
- [ ] GitHub 上已创建 **Public** 仓库
- [ ] **确认 `.env` 没有被提交**（重要！）
- [ ] `git status` 里看不到真实 API Key

### 关键安全检查

推送前必跑：

```powershell
cd D:\deskwork\.dsh\skills\model-dispatch

# 确认 .env 被忽略
git check-ignore -v .env

# 确认暂存区没有密钥
git diff --cached | Select-String "sk-[a-zA-Z0-9]{20,}"

# 如果输出为空 = 安全
```

**如果发现密钥被提交**，立即：
1. 到平台控制台**吊销该 Key** 并重新生成
2. 用 `git rm --cached .env` 移除后重新提交
3. 已推送的话，Key 视为已泄露

---

## 分发方式对比

| 方式 | 别人怎么装 | 需要 Git 吗 |
|---|---|---|
| **GitHub 仓库** | `npx skills add 用户名/仓库` | 需要（推送时） |
| **Zip 包** | 解压到技能目录 | 不需要 |
| **复制目录** | 拷贝整个文件夹 | 不需要 |
| **ClawHub** | `openclaw skills install` | 需要发布到 ClawHub |

**当前 `dist/model-dispatch-v1.1.0.zip` 已经可用**，适合直接发给别人：

```
解压后得到 model-dispatch/ 目录
→ 放进 ~/.claude/skills/ 或 ~/.openclaw/skills/
→ 配好 .env 即可用
```

---

## 后续维护

### 更新版本

1. 修改 `package.json` 和 `SKILL.md` 的 `version`
2. 重新打包：
   ```powershell
   # 见仓库根目录的打包命令，或手动压缩目录
   ```
3. 提交并推送：
   ```powershell
   git add .
   git commit -m "chore: bump version to x.y.z"
   git push
   ```

用户端更新：
```bash
npx skills update model-dispatch
```

### 发布到 ClawHub（可选）

如果想让 OpenClaw 用户能 `openclaw skills install model-dispatch`：

1. 安装 OpenClaw CLI
2. 登录 ClawHub 账号
3. 从仓库目录发布

具体流程见 https://docs.openclaw.ai/clawhub/publishing
