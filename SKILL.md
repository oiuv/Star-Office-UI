---
name: star-office-ui
description: 安装、配置接入或升级 Star Office UI 像素办公室。为用户启动看板，配置 Codex 或 Claude Code hooks，并按需设置其他 Agent 接入、图片 API 与远程访问。
---

# Star Office UI 安装与接入

面向帮助用户部署办公室的 AI Agent。目标是启动可访问的看板、接入用户实际使用的 Agent，并验证活动记录。

部署仓库为 [oiuv/Star-Office-UI](https://github.com/oiuv/Star-Office-UI)，基于 [ringhyacinth/Star-Office-UI](https://github.com/ringhyacinth/Star-Office-UI) 修改。下文命令都在部署仓库根目录执行；安装了本 Skill 后，仍需获取项目代码。

## 1. 确定环境与安装位置

- 使用 Python 3.10+。网页无需构建；Node.js 仅在使用 Electron 客户端或开发测试时需要。
- 优先沿用用户指定的目录、Python 环境和 Agent。接入方式未指定且上下文无法判断时，以 Codex hooks 为默认。
- 已有项目先检查 Git 状态与运行配置，按第 6 节升级；首次安装再克隆。
- 默认访问地址为 `http://127.0.0.1:19000`。需要其他端口时，在启动进程环境中设置 `STAR_BACKEND_PORT`，后续检查和链接使用实际地址。

详细配置以部署仓库的 [README.md](./README.md) 和 [.env.example](./.env.example) 为准。直接执行 Python 不会自动加载 `.env`，环境变量应注入启动进程或服务配置。

## 2. 安装并启动看板

首次安装：

```bash
git clone https://github.com/oiuv/Star-Office-UI.git
cd Star-Office-UI
```

可复用已有 Python 环境；首次安装使用项目虚拟环境：

**Windows / PowerShell**

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.\.venv\Scripts\python.exe -B backend\app.py
```

**macOS / Linux**

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -B backend/app.py
```

后端首次启动会初始化缺失的运行文件，无需复制样例覆盖 `state.json` 或 `join-keys.json`。

用当前环境支持的后台任务或服务保持后端运行，记录启动方式和日志位置。Windows 后台启动使用隐藏窗口。随后在另一任务会话或终端中继续配置 hooks，不要让前台服务阻塞剩余安装步骤。

读取 `GET /health`，确认返回 `status: "ok"` 和 `service: "star-office-ui"`。已有健康的办公室服务可复用；端口由其他服务占用时选择其他端口。

## 3. 配置 Agent 接入

用安装后端依赖的同一 Python 解释器运行生成器，确保观察器可读取本地数据库。生成配置中的解释器和脚本路径均为绝对路径，可从其他项目触发。

选择用户正在使用的接入方式。已经配置 hooks 的 Agent 由 hooks 更新状态，无需额外添加手动状态同步规则。

### Codex hooks

运行生成器：

| 系统 | 命令 |
| --- | --- |
| Windows | `.\.venv\Scripts\python.exe -B scripts\codex_hooks_config.py` |
| macOS / Linux | `.venv/bin/python -B scripts/codex_hooks_config.py` |

生成器只输出 JSON。将 `hooks` 合并到用户实际使用 Codex 的项目 `.codex/hooks.json`，或用户目录 `~/.codex/hooks.json`；自定义主目录使用 `CODEX_HOME/hooks.json`。

保留已有配置及其他 hooks，合并事件数组。同一份办公室集成只放在项目或用户配置中的一个层级，避免重复上报。引导用户在 Codex 的 `/hooks` 中检查并信任配置。

### Claude Code hooks

运行生成器：

| 系统 | 命令 |
| --- | --- |
| Windows | `.\.venv\Scripts\python.exe -B scripts\claude_hooks_config.py` |
| macOS / Linux | `.venv/bin/python -B scripts/claude_hooks_config.py` |

将生成的 `hooks` 合并到用户实际使用 Claude Code 的项目 `.claude/settings.json`、`.claude/settings.local.json`，或用户的 `~/.claude/settings.json`。设置了 `CLAUDE_CONFIG_DIR` 时使用对应用户配置目录。

保留其他设置和已有事件数组，同一份办公室集成只配置在一个层级。沿用生成器的 `command` 与 `args`，不要套用 Codex 的 `commandWindows`。引导用户在 Claude Code 的 `/hooks` 中检查配置；事件支持与额外监视文件选项见 README 的「Claude Code hooks 接入」。

### 其他 Agent：脚本或 API

为能执行脚本的 Agent 添加任务状态同步规则，在真实任务开始和结束时调用：

```bash
python set_state.py writing "正在整理文档"
python set_state.py idle "任务完成，待命中"
```

使用实际的项目 Python 解释器；macOS / Linux 可使用 `python3`。可用状态为 `idle`、`writing`、`researching`、`executing`、`syncing`、`error`。也可调用 `POST /set_state`，JSON 字段为 `state` 和 `detail`。

需要以独立访客加入时，使用稳定身份的 `frontend/office-agent-push.py`，安装 `requests` 并配置 `JOIN_KEY`、`AGENT_NAME`、`OFFICE_URL`。明确客户端状态来源 `OFFICE_LOCAL_STATE_FILE`，或按需设置 `OFFICE_LOCAL_STATUS_URL`。接入细节见 [访客接入指南](./frontend/join-office-skill.md)。

根目录的同名 `office-agent-push.py` 用于本机新访客测试，每次运行生成新身份；分发稳定访客脚本时使用 `frontend/` 下的版本。密钥的并发和有效期以服务端 `join-keys.json` 的实际配置为准。

## 4. 验证安装和接入

使用项目 Python 运行只读验收，例如默认端口下：

| 系统 | 命令 |
| --- | --- |
| Windows | `.\.venv\Scripts\python.exe -B scripts\smoke_test.py --base-url http://127.0.0.1:19000` |
| macOS / Linux | `.venv/bin/python -B scripts/smoke_test.py --base-url http://127.0.0.1:19000` |

验收脚本检查页面和读取接口，不写测试事件。hooks 的实际接入还需在已配置的 Codex 或 Claude Code 中完成一次简单任务，确认办公室状态变化且 `/stats` 收到对应来源的事件。客户端需要用户完成 `/hooks` 操作或提交任务时，明确说明这一待办，不把接口检查通过当作 hooks 已验证。

向用户交付：

- 办公室与 `/stats` 的实际访问地址。
- 后端的运行方式、日志位置及停止/重启方法。
- 已配置的 Agent 类型和配置文件位置，以及实际完成的验证。
- 尚需用户完成的步骤。

## 5. 按需配置

### 图片 API

仅在用户需要 AI 装修时配置。基础看板、hooks、统计和本地档案不依赖图片 API。

优先引导用户在「装修房间 → API 设置」保存地址、密钥、模型和生成方式。也可在后端进程设置：

| 变量 | 用途 |
| --- | --- |
| `OPENAI_API_KEY` | 图片服务密钥 |
| `AI_BASE_URL` | OpenAI 兼容接口前缀，默认 `https://api.openai.com/v1` |
| `AI_IMAGE_MODEL` | 默认 `gpt-image-2`，可使用服务实际支持的图片模型 |
| `AI_IMAGE_MODE` | `edit` 参考图编辑，或 `generate` 纯文生图 |

页面保存的配置优先于环境变量。服务需支持 `/images/edits` 或 `/images/generations`；按服务支持的能力选择生成方式。详细用法见 README 的图片 API 配置和 `scripts/image_generate.py`。

### 公网访问与远程 hooks

仅在用户需要远程访问时配置。公网部署按 [.env.example](./.env.example) 设置：

- `STAR_OFFICE_ENV=production`。
- 随机 `FLASK_SECRET_KEY`，至少 24 字符。
- `ASSET_DRAWER_PASS`，至少 8 字符，本地体验默认值为 `1234`。
- 网关访问控制：装修验证码与 hook Token 各自保护对应接口，不是整个网站的访问密码；记忆、档案和留言板同样可通过看板访问。

已安装 Cloudflare Tunnel 时，可为用户启动临时隧道：

```bash
cloudflared tunnel --url http://127.0.0.1:19000
```

使用实际后端端口，告知用户隧道需要持续运行、地址为临时地址。长期运行按用户已有的域名、网关或服务方式部署。

远程 hooks 在客户端进程中设置 `STAR_OFFICE_URL`，客户端与后端设置相同的 `STAR_OFFICE_HOOK_TOKEN`。经反向代理访问 hooks 时设置 Token；未设 Token 仅接受直接来自 loopback 的请求。未设置 `STAR_OFFICE_URL` 时观察器直接写本地账本，后端停止时也能记录。

### 本地总结、记忆与档案

按用户实际数据位置配置后端进程：

| 数据 | 默认位置 / 配置 |
| --- | --- |
| Codex 会话总结 | `~/.codex/memories/rollout_summaries/`；可用 `CODEX_HOME` 指定主目录 |
| Codex 会话档案、留言板 | Codex 的 SQLite 目录；可用 `STAR_OFFICE_CODEX_SQLITE_HOME` 指定，其他解析规则见 README |
| Claude 项目记忆、会话档案 | `~/.claude/projects/`；可用 `CLAUDE_CONFIG_DIR` 指定主目录 |

这些功能读取后端所在机器的文件。远程部署需让后端能够访问对应目录；仅上报 hooks 不会同步总结、会话或留言正文。只读已有资料，不修改 Codex / Claude 的记忆和源数据库，也不为填充面板编造记录。

## 6. 升级已有部署

1. 检查工作区与现有启动方式，保留用户未提交的修改、配置和自定义素材。备份本地运行数据；活动数据库用 SQLite 备份机制或暂停写入后备份。
2. 在部署仓库执行 `git pull --ff-only`。遇到本地修改或历史分叉时保留现场，解决具体冲突后继续。
3. 用原项目 Python 安装更新后的 `backend/requirements.txt`。
4. 保留 `state.json`、`join-keys.json`、`runtime-config.json`、活动数据库、资产位置/默认配置和用户自定义素材，不用样例文件覆盖。
5. 若接入脚本路径、Python 环境或配置需要更新，重新生成并合并对应 hooks，替换已有办公室处理器，避免追加重复集成。
6. 重启后端并重新执行第 4 节验收。后端会缓存 `frontend/index.html`，更新后只刷新浏览器不足以载入新 HTML。

Electron 和 Tauri 的启动、构建与端口配置按需读取 [electron-shell/README.md](./electron-shell/README.md) 或 [desktop-pet/README.md](./desktop-pet/README.md)。许可证与美术使用范围以 [LICENSE](./LICENSE) 和仓库 README 为准。
