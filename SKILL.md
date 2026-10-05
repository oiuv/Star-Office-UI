---
name: star-office-ui
description: Star Office UI 一键化 Skill：部署像素办公室看板并优先配置 Codex hooks，支持其他 Agent 脚本/API 接入、活动记录与公网访问。
---

# Star Office UI Skill

当前开发与部署仓库为 [oiuv/Star-Office-UI](https://github.com/oiuv/Star-Office-UI)，本项目基于 [ringhyacinth/Star-Office-UI](https://github.com/ringhyacinth/Star-Office-UI) 修改。部署时克隆当前仓库。

本 Skill 面向帮助用户部署像素办公室的 AI Agent，推荐优先配置 Codex hooks：
- 目标：用户只需"看到效果"，尽量少问问题
- 你可以按下面的步骤，一步一步帮用户跑起来并对外访问

使用当前环境中的 Python 3.10+。以下示例使用 `python3`，Windows 可替换为 `python`；按操作系统使用对应的环境变量设置方式。

---

## 0. 一句话告诉用户这是什么

你可以先和用户说：
> 这是一个多人协作的像素办公室仪表盘，你的 AI 助手会根据状态自动走到不同位置，还能看到最近的 Codex 会话小记！

---

## 1. 启动看板

在你这台机器执行（按顺序）：

```bash
# 1) 下载仓库
git clone https://github.com/oiuv/Star-Office-UI.git
cd Star-Office-UI

# 2) 安装依赖
python3 -m pip install -r backend/requirements.txt

# 3) 准备状态文件（首次）
cp state.sample.json state.json

# 4) 启动后端
python3 backend/app.py
```

然后告诉用户：
> 好了，你现在打开 [http://127.0.0.1:19000](http://127.0.0.1:19000) 就能看到像素办公室了！

---

## 2. 配置状态接入：Codex hooks 优先

### 2.1 Codex hooks（推荐）

在 Star Office 项目根目录执行：

```bash
python3 scripts/codex_hooks_config.py
```

把输出合并到用户使用 Codex 的项目 `.codex/hooks.json`，或用户目录的 `~/.codex/hooks.json`。保留已有配置并合并各事件数组。需要指定 Python 时，使用生成器的 `--python` 参数。

引导用户在 Codex 中用 `/hooks` 检查并信任配置，然后提交任务验证动画与 [活动档案](http://127.0.0.1:19000/stats)。该集成自动记录 12 种生命周期事件，配置后不需要 Agent 再主动调用状态脚本。

本地默认直接写数据库，Flask 停止时也能记录。远程部署使用 `STAR_OFFICE_URL`，并在客户端与后端设置相同的 `STAR_OFFICE_HOOK_TOKEN`。详细说明见 [README](./README.md)。

### 2.2 其他 Agent 的脚本/API 接入

没有配置 Codex hooks 的 Agent，可在项目根目录执行：

```bash
python3 set_state.py writing "正在整理文档"
python3 set_state.py idle "任务完成，待命中"
```

也可发送 `POST /set_state`，字段为 `state` 和 `detail`；远程访客使用 join key 与 `office-agent-push.py`。这些状态更新同样进入活动档案。

---

## 3. 侧边栏验证码设置（首次部署时说明）

当前默认验证码是：`1234`。

你需要这样引导用户：

1. 默认密码是 `1234`，可以先直接体验；
2. 当用户愿意时，可随时和你沟通修改密码；
3. 你应主动推荐改成强密码（更安全，防止他人误改资产和布局）。

修改方式（示例）：

```bash
export ASSET_DRAWER_PASS="your-strong-pass"
```

如果是长期运行（systemd / pm2 / 容器），请把该环境变量写入服务配置，而不是只在当前 shell 临时设置。

---

## 4. 生图功能（OpenAI gpt-image-2）—— 可选

"搬新家 / 找中介"装修功能使用 OpenAI 兼容 Image API，默认模型为 `gpt-image-2`。基础看板不依赖生图 API。

### 4.1 使用项目内的生图接口

安装 `backend/requirements.txt` 后即可使用页面的生图功能。后端通过 `backend/image_client.py` 直接发送请求，无需复制脚本到外部 Skill 目录或安装额外的模型 SDK。

命令行入口为 `scripts/image_generate.py`。在项目根目录执行以下示例，环境中需要已经设置 `OPENAI_API_KEY`：

```bash
python3 scripts/image_generate.py \
  --prompt "A cozy pixel-art office" \
  --model gpt-image-2 \
  --mode generate \
  --out-dir output
```

如需保持房间布局，使用 `--mode edit --reference-image assets/room-reference.webp`；仅支持文生图的服务使用 `--mode generate`。

### 4.2 配置图片 API

推荐在装修侧边栏的「API 设置」中配置：

- **API 地址**：默认 `https://api.openai.com/v1`，可填写自定义服务的完整前缀。
- **API Key**：使用该服务的密钥；留空保存会保留已有密钥，已保存的密钥只显示掩码。
- **图片模型**：默认 `gpt-image-2`，可填写服务实际支持的名称。
- **生成方式**：默认参考图编辑；仅支持文生图时选择「纯文生图」。

也可通过后端进程的环境变量配置：

```bash
export OPENAI_API_KEY="your-key"
export AI_BASE_URL="https://api.openai.com/v1"
export AI_IMAGE_MODEL="gpt-image-2"
export AI_IMAGE_MODE="edit"
```

页面保存的配置优先于环境变量。配置接口统一为 `GET /config/ai` 和 `POST /config/ai`，需要先通过资产侧边栏认证。

服务需要支持 `/images/edits` 或 `/images/generations`；仅提供 `/chat/completions` 的服务无法用于此功能。缺少密钥时，引导用户在侧边栏填写并保存。

---

## 5. 安装成功后，必须提醒用户的三件事

### 5.1 告知临时公网链接

推荐先用 Cloudflare Tunnel（最快）：

```bash
cloudflared tunnel --url http://127.0.0.1:19000
```

拿到 `https://xxx.trycloudflare.com` 后发给用户，并补一句：
> 这是临时公网链接；如果你愿意，后续我可以一步步带你部署到本地域名。

### 5.2 装修房子入口

提醒用户：
- 现在可以点击"装修房间"开始装饰；
- 侧边栏默认密码是 `1234`；
- 当他想改密码时，可随时告诉你，你来帮他改；
- 推荐改成强密码，安全性更高。

### 5.3 生图 API 配置

提醒用户：
- 生图功能需要自己的 API；
- 当前接入的是 **OpenAI 兼容 Image API**，默认模型为 `gpt-image-2`；
- 地址、模型和生成方式可在侧边栏配置；
- 自定义服务需要支持图片生成或参考图编辑接口。

---

## 6. 邀请其他 Agent 加入（可选）

其他能够执行脚本或发送 HTTP 请求的 AI Agent，也可以加入用户的办公室：

### 步骤 A：告诉其他 Agent 用 office-agent-push.py

你可以让其他 Agent：
1) 下载 `office-agent-push.py`（可以直接从你这个仓库拿）
2) 让它调用 `join-agent` + 周期 `agent-push`
3) 用户那边就能看到它进办公室了

### 步骤 B：join key 说明

- 后端首次启动时根据 `join-keys.sample.json` 生成运行时的 `join-keys.json`；在该文件中管理接入密钥
- 同一个 key 最多 3 人同时在线
- 你也可以帮用户新建自己的 key

---

## 7. 最近小记（可选）

如果用户想看到"最近小记"：
- 后端读取 `~/.codex/memories/rollout_summaries/*.md`；设置 `CODEX_HOME` 可指定 Codex 目录
- 按总结中的更新时间展示最近 5 份记录（每份最多 3 项任务），不修改 Codex 记忆
- 没有记录时显示空状态；远程后端需要能访问对应文件，打开面板会刷新内容

---

## 8. 常见问题（用户可能问你的）

### Q1："我可以商用吗？"
> 代码玩法可以基于 MIT 用，但美术资产（包括角色/场景）禁止商用；如果你要商用，请务必换成你自己的原创美术资产。

### Q2："其他 Agent 怎么加入？"
> 用 join key 加入，然后持续推送状态就行；仓库里有 `office-agent-push.py` 可以给其他 Agent 用。

---

## 9. 给你的提示

- 尽量帮用户把"启动步骤"做完，让用户只负责"看"和"体验"
- 如果用户要对外访问，优先用 Cloudflare Tunnel（最快最方便）
- 已配置 Codex hooks 时，由 hooks 自动更新状态，不额外调用状态脚本。
- 使用脚本/API 接入的其他 Agent：
  - 接任务前切换到工作状态（如 `writing` / `researching` / `executing`）；
  - 完成任务后切回 `idle`。
- 注意不要暴露用户的内网地址或私有信息

---

## 10. 2026-03 增量补充（仅新增项）

> 本次重制核心请按四条理解：
> 1) 新增中英日三语
> 2) 新增资产管理（全量美术可自定义）
> 3) 接入生图 API（Agent 自动改房间 + 用户手动装修）
> 4) 美术资产替换与优化（含命名与索引重建）

### 10.1 当前生图配置（房间装修）

当前默认使用 OpenAI `gpt-image-2`。参考图编辑会上传办公室参考图；纯文生图按提示词生成，布局保持效果相应改变。

配置项为 `OPENAI_API_KEY`、`AI_BASE_URL`、`AI_IMAGE_MODEL`、`AI_IMAGE_MODE`，也可在侧边栏直接保存。

### 10.2 侧边栏验证码安全提醒（必须）

默认验证码为 `1234`，但生产/公网场景必须改强密码：

```bash
export ASSET_DRAWER_PASS="your-strong-pass"
```

理由：防止外部访问者修改房间布局、装饰和资产配置。

### 10.3 版权口径更新

主角状态素材已切换为无版权争议的小猫，不再沿用旧角色版权说明。

保留统一口径：
- 代码：MIT
- 美术资产：禁止商用

### 10.4 安装时必须提醒（API 可选）

在帮助用户安装时，需明确提醒：

- 现在支持接入自己的生图 API 来改美术资产与背景（可持续更换）。
- 但基础功能（状态看板、多 Agent、资产替换/布局、三语切换）**不依赖 API**，不开 API 也能正常使用。

建议对用户口径：
> 先把基础看板跑起来；需要"无限换背景/AI 生图装修"再接入自己的 API。

### 10.5 老用户更新指南（从旧版本升级）

如果用户之前已经下载过旧版，按以下步骤升级：

1. 进入项目目录并备份本地配置（如 `state.json`、自定义资产）。
2. 拉取最新代码（`git pull` 或重新克隆到新目录）。
3. 确认依赖：`python3 -m pip install -r backend/requirements.txt`。
4. 保留并检查本地运行配置：
   - `ASSET_DRAWER_PASS`
   - `OPENAI_API_KEY` / `AI_BASE_URL` / `AI_IMAGE_MODEL` / `AI_IMAGE_MODE`（如需生图）
5. 如有自定义位置，确认：
   - `asset-positions.json`
   - `asset-defaults.json`
6. 重启后端并验收关键功能：
   - `/health`
   - 三语切换（CN/EN/JP）
   - 资产侧栏（选择、替换、设默认）
   - 生图入口（有 key 时可用）

### 10.6 功能更新提醒清单（对用户口播）

本次更新以后，至少提醒用户以下变化：

1. 已支持 **CN/EN/JP 三语切换**（含 loading 与气泡实时联动）。
2. 已支持 **自定义美术资产替换**（含动态素材切帧同步，减少闪烁）。
3. 已支持 **接入自有生图 API** 持续更换背景（默认使用 `gpt-image-2`）。
4. 新增/强化了安全项：`ASSET_DRAWER_PASS` 生产环境建议改强密码。

### 10.7 2026-03-05 稳定性修复

本次更新修复了多个影响线上稳定运行的问题：

1. **CDN 缓存修复**：静态资源 404 不再被 CDN 长缓存（之前导致 `phaser.js` 被缓存为 404 达 2.7 天）。
2. **前端加载修复**：修复 `fetchStatus()` 中的 JS 语法错误（多余 `else` 块），解决页面卡 loading 问题。
3. **生图异步化**：生图接口改为后台任务 + 轮询模式，避免 Cloudflare 524 超时（100s 限制）。前端显示实时等待进度。
4. **移动端侧边栏**：新增遮罩层、body 滚动锁定、`100dvh` 适配、`overscroll-behavior: contain`。
5. **Join Key 增强**：支持 key 级别过期时间（`expiresAt`）和并发上限（`maxConcurrent`），`join-keys.json` 不再入库。

> 详细说明见：`docs/UPDATE_REPORT_2026-03-05.md`
