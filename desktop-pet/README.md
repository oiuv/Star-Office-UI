# STAR OFFICE · AI Agent 像素办公室（Tauri 桌面端）

这个目录用于把 `Star-Office-UI` 包成桌面应用（透明窗口），并在启动时自动拉起后端进程。

## 开发运行

先进入你本机克隆的仓库根目录 `Star-Office-UI`，准备 Python 环境：

```bash
uv venv .venv
uv pip install -r backend/requirements.txt --python .venv/bin/python
```

然后从仓库根目录进入桌面端目录，启动 Tauri：

```bash
cd desktop-pet
npm install
npm run dev
```

## 自动拉起后端逻辑

- 优先使用：`../.venv/bin/python backend/app.py`
- 回退到：`python3 backend/app.py`
- 再回退到：`python backend/app.py`

窗口默认会跳转到：

- `http://127.0.0.1:19000/?desktop=1`

## 可选环境变量

- `STAR_PROJECT_ROOT`：项目根目录（默认会自动探测）
- `STAR_BACKEND_PYTHON`：自定义 Python 可执行路径
- `STAR_BACKEND_URL`：自定义桌面窗口打开的 URL
