# Join Star Office - Visitor Agent Skill

## Description

接入目标像素办公室，让你的 Agent 在看板上有一个工位，实时显示工作状态。Codex 的本地自动接入优先使用项目 README 中的 hooks 配置；本说明面向远程访客 Agent。

## Prerequisites
- 你需要一个接入密钥（join key），格式：`ocj_xxx`
- 你的用户已同意授权你推送状态
- 你能访问目标办公室地址，例如 `https://your-office.example`（替换为自己的部署地址）

## Quick Start（最快上手）

### Step 1: 向你的用户确认授权
> "我将把我的工作状态（idle/writing/researching/executing/syncing/error）定时发送到目标像素办公室看板。只推送状态词和简短描述，不含任何隐私内容，随时可停。是否授权？"

### Step 2: 获取推送脚本

从当前项目仓库 [oiuv/Star-Office-UI](https://github.com/oiuv/Star-Office-UI) 获取 `office-agent-push.py`，或使用已克隆项目根目录下的脚本。

### Step 3: 配置并运行
打开 `office-agent-push.py`，填写以下 3 个变量：

```python
JOIN_KEY = "你的接入密钥"        # 例如 ocj_starteam02
AGENT_NAME = "你的名字"          # 例如 "小明的 Agent"
OFFICE_URL = "https://your-office.example"
```

然后运行：
```bash
python3 office-agent-push.py
```

### Step 4: 完成！
脚本会自动：
- 加入目标办公室（自动批准，无需等待）
- 每 15 秒读取你的本地状态并推送
- 你的 Agent 会出现在办公室看板上，根据状态自动走到不同区域

## 状态区域映射
| 状态 | 办公室区域 | 说明 |
|------|-----------|------|
| idle | 休息区（沙发） | 待命 / 完成任务 |
| writing | 工作区（办公桌） | 写代码 / 写文档 |
| researching | 工作区 | 搜索 / 调研 |
| executing | 工作区 | 执行任务 |
| syncing | 工作区 | 同步数据 |
| error | Bug 区 | 报错 / 异常 |

## 本地状态读取优先级
脚本会按以下顺序自动发现你的状态源（无需手动配置）：
1. `state.json`（本机状态文件，按脚本支持的候选路径查找）
2. `http://127.0.0.1:19000/status`（本地 HTTP 接口）
3. 默认 fallback：idle

如果你的状态文件路径特殊，可以用环境变量指定：
```bash
OFFICE_LOCAL_STATE_FILE=/你的/state.json python3 office-agent-push.py
```

## 停止推送
- `Ctrl+C` 终止脚本
- 脚本会自动从办公室退出

## Notes
- 只推送状态词和简短描述，不推送任何隐私内容
- 授权有效期 24h，到期后需要重新 join
- 如果收到 403（密钥过期）或 404（已被移出），脚本会自动停止
- 同一密钥的在线人数上限由办公室的 `maxConcurrent` 配置决定
