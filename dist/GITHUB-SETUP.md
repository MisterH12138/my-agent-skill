# GitHub 建仓完整步骤

> 适用于 Windows + PowerShell，把 `model-dispatch` 发布到 GitHub。
> 按顺序执行即可，每步都有验证方法。

## 先看这个：本机环境实测结果

| 检查项 | 结果 | 影响 |
|---|---|---|
| Git | ❌ **未安装** | 必须先装，见第一步 |
| winget | ❌ **不可用**（0 字节占位符） | 不能用 winget 装 Git，需手动下载 |
| curl.exe | ✅ 可用 | 备选下载方式 |
| 技能目录 | ✅ `D:\deskwork\.dsh\skills\model-dispatch`（22 文件） | 就绪 |

**结论**：你需要先手动装 Git，然后按第二到第八步走。

---

## 准备：你需要的账号

| 需要 | 说明 | 获取地址 |
|---|---|---|
| GitHub 账号 | 免费注册 | https://github.com/signup |
| Personal Access Token | 推送时用作密码 | 步骤 4 会教你怎么生成 |

---

## 第一步：安装 Git（约 3 分钟）

> ⚠️ **本机实测：winget 不可用**（`winget.exe` 是 0 字节的占位符，系统未安装 App Installer）。
> 所以下面 winget 方案在你机器上会失败，**请用方式 A**。

### 方式 A：官网下载安装（推荐，最稳）

1. 浏览器打开 https://git-scm.com/download/win
2. 页面会自动识别 Windows，点 **64-bit Git for Windows Setup** 下载（约 60 MB）
3. 双击运行安装包，**一路点 Next 用默认设置即可**
4. 装完**必须新开一个 PowerShell 窗口**（当前窗口的 PATH 还没更新）

### 方式 B：如果以后装好了 App Installer，可用 winget

```powershell
winget install --id Git.Git -e --source winget
```

（本机当前不可用，仅作参考）

### 方式 C：用 GitHub Desktop（图形界面，自带 Git）

https://desktop.github.com

这个方式**同时解决两个问题**：不用装 Git、也不用配 Token。见文末「备选方案」。

### 验证

新开 PowerShell 窗口后执行：

```powershell
git --version
```

看到类似 `git version 2.47.0.windows.1` 就成功了。

---

## 第二步：配置身份（一次性）

```powershell
git config --global user.name "你的名字"
git config --global user.email "你的邮箱@example.com"
```

这里的名字和邮箱会出现在每次提交记录里。建议用 GitHub 注册邮箱。

### 验证

```powershell
git config --global user.name
git config --global user.email
```

两行都能输出内容即可。

---

## 第三步：在 GitHub 网页创建仓库（约 1 分钟）

1. 浏览器打开 https://github.com/new
2. 按下表填写：

| 字段 | 填什么 | 注意 |
|---|---|---|
| **Repository name** | `model-dispatch` | 名字随意，但建议和技能名一致 |
| **Description** | 跨平台智能模型调度技能 | 可选 |
| **Public / Private** | **选 Public** | ⚠️ 必须公开，否则别人无法 `npx skills add` |
| **Add a README file** | **不勾选** | ⚠️ 我们本地已有 README.md |
| **Add .gitignore** | **选 None** | ⚠️ 我们已有定制的 .gitignore |
| **Choose a license** | None | 可选，我们已写在 package.json |

3. 点绿色按钮 **Create repository**

### 创建后记下仓库地址

页面会显示类似：

```
https://github.com/你的用户名/model-dispatch.git
```

**把 `你的用户名` 换成你实际的 GitHub 用户名。** 后面要用。

---

## 第四步：生成 Personal Access Token（约 2 分钟）

GitHub 从 2021 年起**不再接受账号密码推送**，必须用 Token。

### 步骤

1. 打开 https://github.com/settings/tokens
2. 点 **Generate new token** → 选 **Generate new token (classic)**
3. 填写：
   - **Note**：`model-dispatch push`（随便写，方便日后识别）
   - **Expiration**：选 90 days（安全起见别选 no expiration）
   - **Select scopes**：勾选 **`repo`**（整个 repo 大项，包括子项）
4. 拉到底部点 **Generate token**
5. **立刻复制**以 `ghp_` 开头的字符串

> ⚠️ **这个 Token 只显示一次**，关掉页面就再也看不到了。先粘贴到记事本暂存。

---

## 第五步：本地初始化仓库

打开 PowerShell，逐条执行：

```powershell
# 进入技能目录
cd D:\deskwork\.dsh\skills\model-dispatch

# 初始化仓库
git init

# 查看将要提交的文件（重要！确认没有 .env）
git status
```

### ⚠️ 关键检查点

`git status` 输出里**不应该出现 `.env`**，应该看到的是：

```
Untracked files:
        .env.example
        .gitignore
        README.md
        SKILL.md
        config/
        lib/
        ...
```

如果**看到 `.env`**，先停下来。运行以下命令确认它被忽略了：

```powershell
git check-ignore -v .env
```

有输出（显示 `.gitignore` 中匹配的规则）才安全。

---

## 第六步：提交文件

```powershell
# 添加所有文件
git add .

# 关键安全检查：扫描暂存区是否含真实密钥
git diff --cached | Select-String "sk-[A-Za-z0-9._\-]{30,}"
```

**上面这条命令必须没有输出。**

> 💡 为什么用这个正则：实测发现，千问的 Token Plan 密钥（`sk-sp-...`，115 字符）
> **包含点号**，而 DeepSeek 密钥（35 字符）是纯字母数字加短横线。
> 只有 `sk-[A-Za-z0-9._\-]{30,}` 能同时覆盖两种格式。
> 若写成常见的 `sk-[a-zA-Z0-9]{20,}`，**会漏掉千问密钥**。

如果有输出，说明暂存区里有真实 API Key，**立即停止**并检查。

确认干净后提交：

```powershell
git commit -m "feat: model-dispatch v1.1.0 - 跨平台智能模型调度"
```

---

## 第七步：关联远程仓库并推送

```powershell
# 把 main 设为主分支
git branch -M main

# 关联远程仓库（把 "你的用户名" 换成实际用户名）
git remote add origin https://github.com/你的用户名/model-dispatch.git

# 推送
git push -u origin main
```

### 推送时会提示输入用户名和密码

- **Username**：你的 GitHub 用户名
- **Password**：**粘贴第四步生成的 Token**（不是账号密码，粘贴时不会显示字符，正常）

### 验证

```powershell
# 查看远程配置
git remote -v

# 查看最近提交
git log --oneline -1
```

刷新 GitHub 页面，能看到 22 个文件就是成功了。

---

## 第八步：验证别人能安装

在**任意目录**（不要在这个仓库里）执行：

```powershell
# 测试安装（把 你的用户名 换掉）
npx skills add 你的用户名/model-dispatch --skill model-dispatch -y

# 或你自己先验证格式
npx skills list
```

如果报 `Repository not found`，检查：
- 仓库是不是 **Public**
- 用户名有没有拼错
- 仓库名大小写是否一致

---

## 常见问题

### Q1: `git` 不是内部或外部命令

装完 Git 后**没重开终端**。关掉当前 PowerShell 窗口，重新打开。

### Q2: 推送报 `Authentication failed`

三种可能：
1. 用的是账号密码 → 必须换成 Token
2. Token 没勾选 `repo` 权限 → 重新生成
3. Token 已过期 → 重新生成

### Q3: 推送报 `remote origin already exists`

```powershell
git remote remove origin
git remote add origin https://github.com/你的用户名/model-dispatch.git
```

### Q4: 推送报 `rejected - non-fast-forward`

说明远程仓库不是空的（可能你创建时勾了 README）：

```powershell
git pull origin main --allow-unrelated-histories
git push -u origin main
```

### Q5: 怎么确认我的 Key 没进历史记录？

```powershell
git log -p --all | Select-String "sk-[A-Za-z0-9._\-]{30,}"
```

无输出 = 安全。**有输出 = Key 已进入历史记录**，需要立刻：

1. 到平台控制台**吊销该 Key 并重新生成**
2. 光删除文件不够，Key 已泄露

### Q6: 推送成功但 npx 装不上

检查仓库根目录是否有 `SKILL.md`：

```powershell
git ls-tree --name-only HEAD
```

列表里必须有 `SKILL.md`，否则 `skills` CLI 找不到技能。

---

## 命令速查（复制即用）

把 `你的用户名` 替换后，整段粘贴即可：

```powershell
cd D:\deskwork\.dsh\skills\model-dispatch
git init
git add .
git diff --cached | Select-String "sk-[A-Za-z0-9._\-]{30,}"
git commit -m "feat: model-dispatch v1.1.0 - 跨平台智能模型调度"
git branch -M main
git remote add origin https://github.com/你的用户名/model-dispatch.git
git push -u origin main
```

---

## 后续更新版本

改了代码之后：

```powershell
cd D:\deskwork\.dsh\skills\model-dispatch
git add .
git commit -m "fix: 你的改动说明"
git push
```

用户端更新：

```bash
npx skills update model-dispatch
```

---

## 检查清单

发布前逐项打勾：

- [ ] `git --version` 有输出
- [ ] `git config user.name` / `user.email` 已设置
- [ ] GitHub 仓库已创建且为 **Public**
- [ ] Token 已生成且勾选了 `repo`
- [ ] `git status` 里**没有** `.env`
- [ ] 密钥扫描命令**无输出**
- [ ] `git push` 成功
- [ ] GitHub 页面上能看到 SKILL.md
- [ ] `npx skills add` 能装下来

---

## 备选：用 GitHub Desktop（不碰命令行）

如果不想用命令行：

1. 下载 https://desktop.github.com
2. 登录 GitHub 账号
3. `File` → `Add local repository` → 选 `D:\deskwork\.dsh\skills\model-dispatch`
4. 它会提示「不是 Git 仓库」，点 **create a repository**
5. 填描述，点 `Create repository`
6. 点右上角 **Publish repository**
7. ⚠️ **取消勾选 "Keep this code private"**
8. 点 Publish

这样省去了装 Git、配 Token、敲命令的所有步骤。
