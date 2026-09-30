# Star Office UI — 开源发布准备清单（仅准备，不上传）

## 0. 当前目标
- 本文档用于“发布前准备”，不执行实际上传。
- 所有 push 行为需项目维护者最终明确批准。

## 1. 发布前隐私与安全检查

### 需要排除的本地运行文件
- 运行日志：
  - `cloudflared.out`
  - `cloudflared-named.out`
  - `cloudflared-quick.out`
  - `healthcheck.log`
  - `backend.log`
  - `backend/backend.out`
- 运行状态：
  - `state.json`
  - `agents-state.json`
  - `backend/backend.pid`
- 备份/历史文件：
  - `index.html.backup.*`
  - `index.html.original`
  - `*.backup*` 目录与文件
- 本地虚拟环境与缓存：
  - `.venv/`
  - `__pycache__/`

### 检查配置与示例
- 工具路径应使用项目相对路径、命令行参数或环境变量，避免开发者机器的固定路径
- 文档使用 `office.example.com` 等占位域名；实际部署时替换为目标办公室地址
- 公开推送脚本的接入密钥应留空，避免将本地配置一并发布

## 2. 必改项（提交前）

### A. .gitignore（核对现有规则）
确认覆盖以下本地文件与目录：
```
*.log
*.out
*.pid
state.json
agents-state.json
join-keys.json
office-agent-state.json
office-agent.local.json
*.backup*
*.original
__pycache__/
.venv/
venv/
```

### B. README 版权声明（需保留并核对）
确认“美术资产版权与使用限制”章节与 LICENSE 一致：
- 代码按开源协议（如 MIT）
- 美术素材归原作者/工作室所有
- 素材仅供学习/演示，**禁止商用**

### C. 发布目录瘦身
- 清理运行日志、运行态文件、备份文件
- 仅保留“可运行最小集 + 必要素材 + 文档”

## 3. 准备中的发布包建议结构
```
star-office-ui/
  backend/
    app.py
    requirements.txt
    run.sh
  frontend/
    index.html
    game.js (若仍需要)
    layout.js
    assets/* (仅可公开素材)
  office-agent-push.py
  set_state.py
  state.sample.json
  README.md
  LICENSE
  SKILL.md
  docs/
```

## 4. 发布前最终核对（给项目维护者确认）
- [ ] 示例地址是否统一使用占位域名（如 `office.example.com`）
- [ ] 哪些美术资源允许公开（逐项确认）
- [ ] README 非商用声明是否满足你的预期措辞
- [ ] 是否需要将访客接入示例脚本单独放入 examples 目录

## 5. 发布状态（每次发布时填写）
- [ ] 文档、功能说明与接入说明已核对
- [ ] 项目维护者已确认公开素材范围、声明文案与打包清理范围
- [ ] 已获得本次上传授权并记录发布结果
