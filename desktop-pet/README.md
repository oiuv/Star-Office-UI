# STAR OFFICE · AI Agent 像素办公室（Tauri 桌面端）

这个目录用于把 `Star-Office-UI` 包成桌面应用（透明窗口），并在启动时自动拉起后端进程。

## 开发运行

先进入你本机克隆的仓库根目录 `Star-Office-UI`，准备 Python 环境：

```bash
uv venv .venv
uv sync
```

然后从仓库根目录进入桌面端目录，启动 Tauri：

```bash
cd desktop-pet
npm install
npm run dev
```

## 自动拉起后端逻辑

- 优先使用：`STAR_BACKEND_PYTHON` 指定的 Python；其次使用项目 `.venv`（Windows 为 `Scripts/python.exe`，其他平台为 `bin/python`）
- 回退到：`python3 backend/app.py`
- 再回退到：`python backend/app.py`
- 检查 `/health` 的服务标识后才打开窗口。Python 提前退出会尝试下一候选；所有候选失败或端口被其他服务占用时停止启动。退出时只关闭本次启动的后端。

窗口默认会跳转到：

- `http://127.0.0.1:19000/?desktop=1`

## 可选环境变量

- `STAR_PROJECT_ROOT`：项目根目录（默认会自动探测）
- `STAR_BACKEND_PYTHON`：自定义 Python 可执行路径
- `STAR_BACKEND_PORT`：本地后端端口（默认 `19000`），主窗口、mini 资源与状态读取使用同一端口

使用 `uv sync` 需要 Python 3.10+；Windows 启动脚本不依赖 POSIX 环境变量语法，直接执行 `npm run dev` 即可。
