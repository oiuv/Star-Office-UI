# Star Office UI

🌐 Language: **中文** | [English](./README.en.md) | [日本語](./README.ja.md)

![Star Office UI 封面](docs/screenshots/readme-cover-2.jpg)

**一个像素风格的 AI 办公室看板** —— 把 AI 助手的工作状态实时可视化，让你直观看到"谁在做什么、昨天做了什么、现在是否在线"。

支持多 Agent 协作、中英日三语、AI 生图装修、桌面宠物模式。
推荐通过 **Codex hooks** 自动驱动角色状态并记录会话、工具和子 Agent 活动；其他 AI Agent 也可通过脚本或 HTTP API 接入。

本项目基于 [ringhyacinth/Star-Office-UI](https://github.com/ringhyacinth/Star-Office-UI) 修改，当前开发与部署仓库为 [oiuv/Star-Office-UI](https://github.com/oiuv/Star-Office-UI)。

> 原项目由 **[Ring Hyacinth](https://x.com/ring_hyacinth)** 与 **[Simon Lee](https://x.com/simonxxoo)** 共同创建（co-created project），并与社区开发者（[@Zhaohan-Wang](https://github.com/Zhaohan-Wang)、[@Jah-yee](https://github.com/Jah-yee)、[@liaoandi](https://github.com/liaoandi)）一起持续维护和共建。
> 欢迎提交 Issue 和 PR，也感谢每一位贡献者的支持。

---

## ✨ 快速上手：Codex hooks（推荐）

完成以下三步，Codex 的任务开始、工具调用、上下文整理和本轮结束就会自动映射到办公室动画与活动记录。

> **环境要求：Python 3.10+**。以下示例使用 `python`；macOS / Linux 可按环境改为 `python3`。状态文件只在首次安装时复制，已有配置请保留。

### 1) 启动看板

```bash
git clone https://github.com/oiuv/Star-Office-UI.git
cd Star-Office-UI
python -m pip install -r backend/requirements.txt
cp state.sample.json state.json
python backend/app.py
```

打开 [http://127.0.0.1:19000](http://127.0.0.1:19000)。保持后端运行，另开终端进入 Star Office 项目根目录，继续配置 hooks。

### 2) 生成并启用 Codex hooks

```bash
python scripts/codex_hooks_config.py
```

把输出配置合并到你使用 Codex 的项目 `.codex/hooks.json`，或用户目录的 `~/.codex/hooks.json`。已有 hooks 应合并事件数组。然后在 Codex 中使用 `/hooks` 检查并信任配置。

生成的脚本路径为绝对路径，因此 Codex 可以在其他项目中调用这份办公室集成。Python 解释器需可访问；可用 `--python` 指定解释器路径。

### 3) 提交任务，查看动画与统计

在 Codex 中提交任务，办公室会自动显示工作状态；本轮结束或中断后恢复待命。打开 [活动档案](http://127.0.0.1:19000/stats) 查看事件、工具、会话、经验值与历史日志。

也可以让 AI 助手按本仓库的 [SKILL.md](./SKILL.md) 完成部署和 hooks 配置。

![Star Office UI 预览](docs/screenshots/readme-cover-1.jpg)

---

## 🔌 Codex hooks 配置

主接入方式为 Codex hooks，采用 **6 种动画状态 + 12 种生命周期事件**。状态表示角色动作，事件表示触发原因；事件名称、描述、会话和工具标识分别记录，不需要增加 12 套动画。

### 生成 hooks.json

在 Star Office 项目根目录执行：

~~~powershell
python scripts/codex_hooks_config.py
~~~

将输出合并到希望接入的项目 `.codex/hooks.json`，或用户目录的 `~/.codex/hooks.json`。已有配置应合并各事件数组，避免覆盖原有 hooks。生成器只输出配置，不会修改已有文件，可用 `--python` 指定解释器。

也可使用 [hooks.example.json](./integrations/codex/hooks.example.json)，将脚本路径替换成实际路径。Windows 路径会加引号，支持空格。

生成器与示例均使用中文 `statusMessage`，所有事件设置 `timeout: 3`，其中 `PostToolUse` 使用异步执行。提示文字仅用于 Codex 的运行提示，桌宠状态与统计由事件内容决定。

配置后在 Codex 中使用 `/hooks` 检查并信任新配置。官方要求信任确切的 hook 定义，改动后需重新审核；项目级 hooks 还需要项目被信任。脚本无需额外安装 Python 包，必须能访问这份源码。

### 事件与动画状态

| Hook | 动画状态 | 展示含义 |
|------|----------|----------|
| SessionStart | idle；压缩后恢复前一状态 | 新会话 / 恢复会话 |
| UserPromptSubmit | researching | 理解任务 |
| PreToolUse | writing / researching / executing | 根据工具类型修改文件、查资料或执行 |
| PermissionRequest | idle | 等待执行权限；不会显示成报错 |
| PostToolUse | executing；明确失败时 error | 处理结果 / 工具失败 |
| PreCompact | syncing | 整理上下文 |
| PostCompact | 恢复压缩前状态 | 继续工作 |
| SubagentStart | 子角色 executing | 子 Agent 独立开始工作 |
| SubagentStop | 子角色 idle | 子 Agent 本轮收尾 |
| Stop | idle | 主角色本轮结束 |
| Interrupt | idle | 中断，同时结束当前子角色的在线状态 |
| SessionEnd | idle | 会话结束 |

参考 [Codex 官方 hooks 文档](https://learn.chatgpt.com/docs/hooks)。脚本只观察事件，统一输出合法 JSON 空对象，不批准权限、不改写工具输入、不要求继续任务。失败和超时不会影响 Codex。

### 本地与远程模式

- **本地默认模式**：`codex_hook.py` 直接写 SQLite 与状态文件，无需启动 Flask 即可保存记录；启动后端后查看动画和历史。
- **远程模式**：Codex 进程环境设置 `STAR_OFFICE_URL`，例如 `https://your-office.example`；客户端与后端设置相同 `STAR_OFFICE_HOOK_TOKEN`。未设置 Token 时仅接受直接来自 loopback 的 hook 请求，反向代理部署应始终设置 Token。
- 默认数据库是 `data/office-events.sqlite3`，支持 `STAR_OFFICE_EVENTS_DB` 指定位置，数据库及 WAL/SHM 文件不会提交到 Git。备份时使用 SQLite 备份机制或停止写入后备份。
- `STAR_OFFICE_STATE_FILE` 可指定兼容状态文件位置。`STAR_OFFICE_HOOK_DEBUG=1` 仅将失败类别写到 stderr。
- 不读取或保存 prompt、命令正文、完整工具输出、transcript 或 cwd；保留事件名、工具名、会话/回合/子 Agent 标识及少量运行元数据。
- 异步 PostToolUse 迟到仍留日志，但不会复活已结束回合；多会话、子 Agent 分别记录。
- 五分钟未更新的状态回到待命。长工具调用可能暂时视为离线，直到下一次 hook；时长是保守观测值。

---

## 🤔 适合谁用？

### 使用 AI 编程或自动化任务的人

查看 AI 当前在写代码、查资料、执行命令还是等待权限。Codex 用户使用 hooks 自动同步；其他 Agent 可以调用状态脚本或 API。

### 同时运行多个 Agent 的个人或团队

在一个办公室查看多个 Agent 与子 Agent 的状态，并通过活动档案回看工具调用、协作和任务收尾记录。

### 想要像素看板与工作记录的人

手动或通过脚本推送状态，把它作为个人工作记录、远程协作看板或由自动化系统驱动的像素办公室。基础功能不需要生图 API。

---

## 📋 功能一览

1. **Codex hooks 自动接入** —— 12 种生命周期事件驱动动画与记录，支持会话、工具、上下文整理、中断和子 Agent
2. **活动档案与成长** —— 状态次数、观测时长、事件趋势、工具统计、筛选日志、JSON 导出，以及经验等级和成就
3. **状态可视化** —— 6 种状态（`idle` / `writing` / `researching` / `executing` / `syncing` / `error`）自动映射到办公室不同区域，动画 + 气泡实时展示
4. **昨日小记** —— 自动从 `memory/*.md` 读取最近一天的工作记录，脱敏后展示为"昨日小记"卡片
5. **多 Agent 协作** —— 通过 join key 邀请其他 Agent 加入你的办公室，实时查看多人状态
6. **中英日三语** —— CN / EN / JP 一键切换，界面文案、气泡、加载提示全部联动
7. **美术资产自定义** —— 侧边栏管理角色 / 场景 / 装饰素材，支持动态帧同步，避免闪烁
8. **AI 生图装修** —— 接入 OpenAI 兼容图片 API，默认使用 `gpt-image-2` 给办公室换背景；不接入 API 也能正常使用核心功能
9. **移动端适配** —— 手机直接打开即可查看，适合外出时快速瞄一眼
10. **安全加固** —— 侧边栏密码保护、生产环境弱密码拦截、Session Cookie 加固
11. **灵活公网访问** —— 推荐 Cloudflare Tunnel 一键公网化，也可用自有域名 / 反向代理
12. **桌面宠物版** —— 可选的 Electron 桌面封装，把办公室变成透明窗口的桌面宠物（见下方说明）

---

## 🚀 详细部署指南

### 1) 安装依赖

```bash
cd Star-Office-UI
python3 -m pip install -r backend/requirements.txt
```

### 2) 初始化状态文件

```bash
cp state.sample.json state.json
```

### 3) 启动后端

```bash
cd backend
python3 app.py
```

打开 [http://127.0.0.1:19000](http://127.0.0.1:19000)。

> ✅ 首次部署可以先保留默认配置；在生产环境中，请复制 `.env.example` 为 `.env` 并设置强随机的 `FLASK_SECRET_KEY` 与 `ASSET_DRAWER_PASS`，避免弱密码和会话泄露。

### 4) 手动验证状态（可选）

在另一个终端进入项目根目录执行。Codex hooks 已配置时，日常状态由 hooks 自动同步。

```bash
python3 set_state.py writing "正在整理文档"
python3 set_state.py syncing "同步进度中"
python3 set_state.py error "发现问题，排查中"
python3 set_state.py idle "待命中"
```

### 5) 公网访问（可选）

```bash
cloudflared tunnel --url http://127.0.0.1:19000
```

拿到 `https://xxx.trycloudflare.com` 链接即可分享。

### 6) 验证安装（可选）

```bash
python3 scripts/smoke_test.py --base-url http://127.0.0.1:19000
```

所有检查显示 `OK` 即表示部署成功。

### 7) 运行回归测试（可选）

~~~powershell
python -B -m unittest discover -s tests -v
~~~

测试使用临时数据库和模拟图片接口，不消耗 API 额度。

---

## 🤝 其他 AI Agent 接入

任何能执行脚本或发送 HTTP 请求的 Agent 都可以使用原有接入方式。Codex hooks 已配置时，无需再添加手动状态同步规则。

### 状态自动同步

在 Agent 的规则文件中加入以下规则，让它主动调用 `set_state.py`；也可发送 `POST /set_state`，请求字段为 `state` 和 `detail`。在 Star Office 项目根目录执行脚本：

```markdown
## Star Office 状态同步规则
- 接到任务时：先执行 `python3 set_state.py <状态> "<描述>"` 再开始工作
- 完成任务后：执行 `python3 set_state.py idle "待命中"` 再回复
```

**6 种状态 → 3 个区域的映射：**

| 状态 | 办公室区域 | 触发场景 |
|------|-----------|---------|
| `idle` | 🛋 休息区（沙发） | 待命 / 任务完成 |
| `writing` | 💻 工作区（办公桌） | 写代码 / 写文档 |
| `researching` | 💻 工作区 | 搜索 / 调研 |
| `executing` | 💻 工作区 | 执行命令 / 跑任务 |
| `syncing` | 💻 工作区 | 同步数据 / 推送 |
| `error` | 🐛 Bug 区 | 报错 / 异常排查 |

状态推送同样进入活动档案，记录次数、描述和观测时长。会话、回合和工具等细分统计需要相应生命周期事件。

### 邀请其他 Agent 加入办公室

**Step 1：准备 join key**

首次启动后端时，如果当前目录下不存在 `join-keys.json`，服务会自动根据 `join-keys.sample.json` 生成一个运行时的 `join-keys.json`（内含示例 key，例如 `ocj_example_team_01`）。你可以在生成后的 `join-keys.json` 中自行添加、修改或删除 key，每个 key 默认支持最多 3 人同时在线。

**Step 2：让访客 Agent 运行推送脚本**

访客只需下载 `office-agent-push.py`，填写 3 个变量即可：

```python
JOIN_KEY = "ocj_starteam02"          # 你分配的 key
AGENT_NAME = "小明的 Agent"            # 显示名称
OFFICE_URL = "https://your-office.example"  # 你的办公室地址
```

```bash
python3 office-agent-push.py
```

脚本会自动加入办公室并每 15 秒推送一次状态。访客会出现在看板上，根据状态自动走到对应区域。

**Step 3（可选）：访客安装 Skill**

访客也可以把 `frontend/join-office-skill.md` 作为 Skill 使用，Agent 会自动完成配置和推送。

> 详细的访客接入说明见 [`frontend/join-office-skill.md`](./frontend/join-office-skill.md)

---

## 📊 活动档案与成长

访问 [http://127.0.0.1:19000/stats](http://127.0.0.1:19000/stats)，或点击办公室的「活动档案」。

支持今日、近 7 天、近 30 天、全部的事件、会话、回合和工具统计，六类状态的次数与观测时长，十二类 hooks 计数，权限等待、中断、压缩、子 Agent、每日趋势、筛选日志，以及最新 200 条 JSON 导出。

工具耗时通过 `tool_use_id` 配对开始/结束；只有明确错误标记或非零退出码才计为失败。回合结束 +20 XP、工具成功 +2、子 Agent 收尾 +10，100 XP 升一级，并解锁四个纪念成就。重复回放同一回合/工具不会重复领奖，主动状态心跳不产生经验值。

已有 `set_state.py`、`POST /set_state` 和 `POST /agent-push` 同样记录。页面轮询不增加事件，相同状态描述的重复推送标记为心跳。hook 接收次数和去重后的结束回合数分别展示。

日期按后端本地时区分组，Agent 时长累加，每次更新最多观测 300 秒；断联时间不无限累计。回合数表示收到 Stop，不代表任务质量。没有 Token 数据时不推算 Token 或费用。升级前的历史不自动生成，绕过脚本手工修改状态文件不产生记录。

---

## 🎨 OpenAI 图片接口（gpt-image-2）

在装修侧边栏的 API 设置中填写：

- **API 地址**：例如 `https://api.openai.com/v1` 或 `http://127.0.0.1:8000/v1`。包含服务所需的完整前缀，后端追加 `/images/edits` 或 `/images/generations`。
- **API Key**：保存后只显示末四位；留空保存会保留已有密钥。
- **图片模型**：填写服务实际支持的名称，允许自定义。
- **生成方式**：默认通过 multipart 上传参考图进行编辑。仅支持文生图的服务可明确选择「纯文生图」，布局保持效果相应改变。

服务必须支持 OpenAI **Image API**，只有 `/chat/completions` 的服务不能接入。支持 `data[].b64_json` 和 `data[].url` 返回方式，图片下载不附带 API Key。参考 [Image API 官方文档](https://developers.openai.com/api/docs/guides/image-generation)。

环境变量为 `OPENAI_API_KEY`、`AI_BASE_URL`（或 `OPENAI_BASE_URL`）、`AI_IMAGE_MODEL`、`AI_IMAGE_MODE`，文件/UI 的值优先。默认地址 `https://api.openai.com/v1`，默认模型 `gpt-image-2`，可按服务替换。

图片配置统一使用 `/config/ai`，运行配置字段为 `api_key`、`base_url`、`model`、`image_mode`。生图由项目内的 `backend/image_client.py` 直接调用服务，无需额外安装模型 SDK 或仓库外的生图 Skill。命令行入口为 `scripts/image_generate.py`。

---

## 📡 常用 API

| 端点 | 说明 |
|------|------|
| `POST /hooks/codex` | 接收 Codex hook 事件；远程使用 Bearer Token |
| `GET /api/stats?period=today` | 活动统计；支持 `today` / `7d` / `30d` / `all` |
| `GET /api/events?period=7d&limit=50` | 活动日志；`limit` 为 1–200，可加 `state` / `hook` 筛选 |
| `GET /health` | 健康检查 |
| `GET /status` | 获取主 Agent 状态 |
| `POST /set_state` | 设置主 Agent 状态 |
| `GET /agents` | 获取多 Agent 列表 |
| `POST /join-agent` | 访客加入办公室 |
| `POST /agent-push` | 访客推送状态 |
| `POST /leave-agent` | 访客离开 |
| `GET /yesterday-memo` | 获取昨日小记 |
| `GET /config/ai` | 获取 OpenAI 图片 API 配置（Key 脱敏） |
| `POST /config/ai` | 设置 OpenAI 图片 API 配置 |
| `GET /assets/generate-rpg-background/poll` | 轮询生图进度 |

---

## 🖥 桌面宠物版（可选）

`desktop-pet/` 提供 **Tauri** 桌面版本，`electron-shell/` 提供 **Electron** 桌面版本，可以把像素办公室变成一个透明窗口的桌面宠物。

```bash
cd desktop-pet
npm install
npm run dev
```

- 启动时自动拉起 Python 后端
- 窗口默认指向 `http://127.0.0.1:19000/?desktop=1`
- 支持通过环境变量自定义项目路径和 Python 路径

> ⚠️ 这是一个**可选的实验性功能**，目前主要在 macOS 上开发测试。详见 [`desktop-pet/README.md`](./desktop-pet/README.md)。
>
> 🙏 桌面宠物版由 [@Zhaohan-Wang](https://github.com/Zhaohan-Wang) 独立开发，感谢他的贡献！

---

## 🎨 美术资产与开源许可

### 资产来源

访客角色动画使用了 **LimeZu** 的免费资产：
- [Animated Mini Characters 2 (Platformer) [FREE]](https://limezu.itch.io/animated-mini-characters-2-platform-free)

请在二次发布 / 演示时保留来源说明，并遵守原作者许可条款。

### 许可协议

- **代码 / 逻辑：MIT**（见 [`LICENSE`](./LICENSE)）
- **美术资产：禁止商用**（仅学习 / 演示 / 交流用途）

> 如需商用，请将所有美术资产替换为你自己的原创素材。

---

## 📝 更新日志

| 日期 | 概要 | 详情 |
|------|------|------|
| 2026-03-06 | 🔌 默认端口调整 — 默认后端端口从 18791 调整为 19000，以避开 OpenClaw Browser Control 端口冲突；同步更新脚本、桌面壳与文档默认值 | [`docs/CHANGELOG_2026-03.md`](./docs/CHANGELOG_2026-03.md) |
| 2026-03-05 | 📱 稳定性修复 — CDN 缓存修复、生图异步化、移动端侧边栏优化、Join Key 过期与并发控制 | [`docs/UPDATE_REPORT_2026-03-05.md`](./docs/UPDATE_REPORT_2026-03-05.md) |
| 2026-03-04 | 🔒 P0/P1 安全加固 — 弱密码拦截、后端模块拆分、stale 状态自动回 idle、首屏骨架屏优化 | [`docs/UPDATE_REPORT_2026-03-04_P0_P1.md`](./docs/UPDATE_REPORT_2026-03-04_P0_P1.md) |
| 2026-03-03 | 📋 开源发布检查清单完成 | [`docs/OPEN_SOURCE_RELEASE_CHECKLIST.md`](./docs/OPEN_SOURCE_RELEASE_CHECKLIST.md) |
| 2026-03-01 | 🎉 **v2 重制发布** — 新增三语支持、资产管理系统、AI 生图装修、美术资产全面替换 | [`docs/FEATURES_NEW_2026-03-01.md`](./docs/FEATURES_NEW_2026-03-01.md) |

---

## 📁 项目结构

```text
Star-Office-UI/
├── backend/            # Flask 后端
│   ├── app.py
│   ├── event_store.py     # 活动记录与统计
│   ├── image_client.py    # OpenAI 图片接口
│   ├── requirements.txt
│   └── run.sh
├── frontend/           # 前端页面与资产
│   ├── stats.html         # 活动档案
│   ├── index.html
│   ├── join.html
│   ├── invite.html
│   └── layout.js
├── desktop-pet/        # Tauri 桌面宠物版（可选）
├── electron-shell/     # Electron 桌面壳（可选）
├── docs/               # 文档与截图
│   └── screenshots/
├── office-agent-push.py  # 访客推送脚本
├── set_state.py          # 状态切换脚本
├── state.sample.json     # 状态文件模板
├── join-keys.sample.json # Join Key 模板（启动时生成 join-keys.json）
├── codex_hook.py         # Codex hooks 事件适配
├── integrations/codex/   # hooks 配置示例
├── scripts/              # hooks 配置生成器与图片生成 CLI
├── SKILL.md              # 通用 Agent 部署指南
└── LICENSE               # MIT 许可
```

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/image?repos=oiuv/Star-Office-UI&type=date&legend=top-left)](https://www.star-history.com/?repos=oiuv%2FStar-Office-UI&type=date&legend=top-left)
