#!/usr/bin/env python3
"""
Star Office - Agent 状态主动推送脚本

用法：
1. 在同目录 office-agent.local.json 填入 {"joinKey": "你的接入密钥"}，或设置 OFFICE_JOIN_KEY 环境变量；按需修改 OFFICE_URL
2. AGENT_NAME 自动生成“访客 + 随机名称”，用于本机新访客测试
3. 运行：python office-agent-push.py
4. 每次启动都以新访客加入，不复用缓存身份；随后每 15s 向指定办公室推送当前状态
"""

import json
import os
import secrets
import time
import sys
from datetime import datetime

# === 你需要填入的信息 ===
# 本地测试密钥不写入源码；环境变量优先于本地配置。
LOCAL_CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "office-agent.local.json")
JOIN_KEY = os.environ.get("OFFICE_JOIN_KEY", "")
if not JOIN_KEY and os.path.exists(LOCAL_CONFIG_FILE):
    with open(LOCAL_CONFIG_FILE, "r", encoding="utf-8") as config_file:
        JOIN_KEY = json.load(config_file).get("joinKey", "")
AGENT_NAME = f"访客{secrets.token_hex(4)}"  # 每次启动生成新的测试访客名称
OFFICE_URL = "http://127.0.0.1:19000"  # 本机办公室地址

# === 推送配置 ===
PUSH_INTERVAL_SECONDS = 15  # 每隔多少秒推送一次（更实时）
STATUS_ENDPOINT = "/status"
JOIN_ENDPOINT = "/join-agent"
PUSH_ENDPOINT = "/agent-push"

# 自动状态守护：当本地状态文件不存在或长期不更新时，自动回 idle，避免“假工作中”
STALE_STATE_TTL_SECONDS = int(os.environ.get("OFFICE_STALE_STATE_TTL", "600"))

# 记录本次测试访客信息；下次启动不读取此缓存
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "office-agent-state.json")

# 优先读取本机 OpenClaw 工作区的状态文件
# 支持自动发现，减少对方手动配置成本，且避免硬编码绝对路径：
# - 优先使用环境变量 OPENCLAW_HOME / OPENCLAW_WORKSPACE_DIR
# - 其次使用当前用户 HOME/.openclaw
# - 再回落到当前工作目录与脚本所在目录
OPENCLAW_HOME = os.environ.get("OPENCLAW_HOME") or os.path.join(os.path.expanduser("~"), ".openclaw")
OPENCLAW_WORKSPACE_DIR = os.environ.get("OPENCLAW_WORKSPACE_DIR") or os.path.join(OPENCLAW_HOME, "workspace")

DEFAULT_STATE_CANDIDATES = [
    os.path.join(OPENCLAW_WORKSPACE_DIR, "Star-Office-UI", "state.json"),
    os.path.join(OPENCLAW_WORKSPACE_DIR, "star-office-ui", "state.json"),
    os.path.join(OPENCLAW_WORKSPACE_DIR, "state.json"),
    os.path.join(os.getcwd(), "state.json"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json"),
]

# 如果对方本地 /status 需要鉴权，可在这里填写 token（或通过环境变量 OFFICE_LOCAL_STATUS_TOKEN）
LOCAL_STATUS_TOKEN = os.environ.get("OFFICE_LOCAL_STATUS_TOKEN", "")
LOCAL_STATUS_URL = os.environ.get("OFFICE_LOCAL_STATUS_URL", "http://127.0.0.1:19000/status")
# 可选：直接指定本地状态文件路径（最简单方案：绕过 /status 鉴权）
LOCAL_STATE_FILE = os.environ.get("OFFICE_LOCAL_STATE_FILE", "")
VERBOSE = os.environ.get("OFFICE_VERBOSE", "0") in {"1", "true", "TRUE", "yes", "YES"}


def create_local_state():
    """每次启动创建全新访客身份，不复用上次测试的 agentId。"""
    return {
        "agentId": None,
        "joined": False,
        "joinKey": JOIN_KEY,
        "agentName": AGENT_NAME
    }


def save_local_state(data):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def normalize_state(s):
    """兼容不同本地状态词，并映射到办公室识别状态。"""
    s = (s or "").strip().lower()
    if s in {"writing", "researching", "executing", "syncing", "error", "idle"}:
        return s
    if s in {"working", "busy", "write"}:
        return "writing"
    if s in {"run", "running", "execute", "exec"}:
        return "executing"
    if s in {"research", "search"}:
        return "researching"
    if s in {"sync"}:
        return "syncing"
    return "idle"


def map_detail_to_state(detail, fallback_state="idle"):
    """当只有 detail 时，用关键词推断状态并映射到办公区域。"""
    d = (detail or "").lower()
    if any(k in d for k in ["报错", "error", "bug", "异常", "报警"]):
        return "error"
    if any(k in d for k in ["同步", "sync", "备份"]):
        return "syncing"
    if any(k in d for k in ["调研", "research", "搜索", "查资料"]):
        return "researching"
    if any(k in d for k in ["执行", "run", "推进", "处理任务", "工作中", "writing"]):
        return "writing"
    if any(k in d for k in ["待命", "休息", "idle", "完成", "done"]):
        return "idle"
    return fallback_state


def _state_age_seconds(data):
    try:
        ts = (data or {}).get("updated_at")
        if not ts:
            return None
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            from datetime import timezone
            return (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds()
        return (datetime.now() - dt).total_seconds()
    except Exception:
        return None


def fetch_local_status():
    """读取本地状态：
    1) 优先 state.json（由本地 Agent 或状态更新工具维护）
    2) 其次尝试本地 HTTP /status
    3) 最后 fallback idle

    额外防抖：如果本地状态更新时间超过 STALE_STATE_TTL_SECONDS，自动视为 idle。
    """
    # 1) 读本地 state.json（优先读取显式指定路径，其次自动发现）
    candidate_files = []
    if LOCAL_STATE_FILE:
        candidate_files.append(LOCAL_STATE_FILE)
    for fp in DEFAULT_STATE_CANDIDATES:
        if fp not in candidate_files:
            candidate_files.append(fp)

    for fp in candidate_files:
        try:
            if fp and os.path.exists(fp):
                with open(fp, "r", encoding="utf-8") as f:
                    data = json.load(f)

                    # 只接受“状态文件”结构；避免误把 office-agent-state.json（仅缓存 agentId）当状态源
                    if not isinstance(data, dict):
                        continue
                    has_state = "state" in data
                    has_detail = "detail" in data
                    if (not has_state) and (not has_detail):
                        continue

                    state = normalize_state(data.get("state", "idle"))
                    detail = data.get("detail", "") or ""
                    # detail 兜底纠偏，确保“工作/休息/报警”能正确落区
                    state = map_detail_to_state(detail, fallback_state=state)

                    # 防止状态文件久未更新仍停留在 working 态
                    age = _state_age_seconds(data)
                    if age is not None and age > STALE_STATE_TTL_SECONDS:
                        state = "idle"
                        detail = f"本地状态超过{STALE_STATE_TTL_SECONDS}s未更新，自动回待命"

                    if VERBOSE:
                        print(f"[status-source:file] path={fp} state={state} detail={detail[:60]}")
                    return {"state": state, "detail": detail}
        except Exception:
            pass

    # 2) 尝试本地 /status（可能需要鉴权）
    try:
        import requests
        headers = {}
        if LOCAL_STATUS_TOKEN:
            headers["Authorization"] = f"Bearer {LOCAL_STATUS_TOKEN}"
        r = requests.get(LOCAL_STATUS_URL, headers=headers, timeout=5)
        if r.status_code == 200:
            data = r.json()
            state = normalize_state(data.get("state", "idle"))
            detail = data.get("detail", "") or ""
            state = map_detail_to_state(detail, fallback_state=state)

            age = _state_age_seconds(data)
            if age is not None and age > STALE_STATE_TTL_SECONDS:
                state = "idle"
                detail = f"本地/status 超过{STALE_STATE_TTL_SECONDS}s未更新，自动回待命"

            if VERBOSE:
                print(f"[status-source:http] url={LOCAL_STATUS_URL} state={state} detail={detail[:60]}")
            return {"state": state, "detail": detail}
        # 如果 401，说明需要 token
        if r.status_code == 401:
            return {"state": "idle", "detail": "本地/status需要鉴权（401），请设置 OFFICE_LOCAL_STATUS_TOKEN"}
    except Exception:
        pass

    # 3) 默认 fallback
    if VERBOSE:
        print("[status-source:fallback] state=idle detail=待命中")
    return {"state": "idle", "detail": "待命中"}


def do_join(local):
    import requests
    # Persist before the request so retries retain identity even if its reply is lost.
    if not local.get("clientId"):
        local["clientId"] = secrets.token_hex(16)
        save_local_state(local)
    payload = {
        "clientId": local["clientId"],
        "name": local.get("agentName", AGENT_NAME),
        "joinKey": local.get("joinKey", JOIN_KEY),
        "state": "idle",
        "detail": "刚刚加入"
    }
    r = requests.post(f"{OFFICE_URL}{JOIN_ENDPOINT}", json=payload, timeout=10)
    if r.status_code in (200, 201):
        data = r.json()
        if data.get("ok"):
            local["joined"] = True
            local["agentId"] = data.get("agentId")
            save_local_state(local)
            print(f"✅ 已加入目标办公室，agentId={local['agentId']}")
            return True
    print(f"❌ 加入失败：{r.text}")
    return False


def do_push(local, status_data):
    import requests
    payload = {
        "agentId": local.get("agentId"),
        "joinKey": local.get("joinKey", JOIN_KEY),
        "state": status_data.get("state", "idle"),
        "detail": status_data.get("detail", ""),
        "name": local.get("agentName", AGENT_NAME)
    }
    r = requests.post(f"{OFFICE_URL}{PUSH_ENDPOINT}", json=payload, timeout=10)
    if r.status_code in (200, 201):
        data = r.json()
        if data.get("ok"):
            area = data.get("area", "breakroom")
            print(f"✅ 状态已同步，当前区域={area}")
            return True

    # 403/404：拒绝/移除 → 停止推送
    if r.status_code in (403, 404):
        msg = ""
        try:
            msg = (r.json() or {}).get("msg", "")
        except Exception:
            msg = r.text
        print(f"⚠️  访问拒绝或已移出房间（{r.status_code}），停止推送：{msg}")
        local["joined"] = False
        local["agentId"] = None
        save_local_state(local)
        sys.exit(1)

    print(f"⚠️  推送失败：{r.text}")
    return False


def main():
    local = create_local_state()
    print(f"🆕 本次测试访客：{AGENT_NAME}")

    # Startup hint for state source and URL (helps with port/state issues, e.g. issue #31)
    if LOCAL_STATE_FILE:
        print(f"State file: {LOCAL_STATE_FILE}")
    else:
        first_existing = next((p for p in DEFAULT_STATE_CANDIDATES if p and os.path.exists(p)), None)
        if first_existing:
            print(f"State file (auto): {first_existing}")
        else:
            print("State file: auto-discover (set OFFICE_LOCAL_STATE_FILE if state not found)")
    print(f"Local status URL: {LOCAL_STATUS_URL} (set OFFICE_LOCAL_STATUS_URL if backend uses another port)")

    # 先确认配置是否齐全
    if not JOIN_KEY or not AGENT_NAME:
        print("❌ 请在 office-agent.local.json 中配置 joinKey，或设置 OFFICE_JOIN_KEY 环境变量")
        sys.exit(1)

    # 新测试访客先加入，获取本次运行的 agentId
    if not local.get("joined") or not local.get("agentId"):
        ok = do_join(local)
        if not ok:
            sys.exit(1)

    # 持续推送
    print(f"🚀 开始持续推送状态，间隔={PUSH_INTERVAL_SECONDS}秒")
    print("🧭 状态逻辑：任务中→工作区；待命/完成→休息区；异常→bug区")
    print("🔐 若本地 /status 返回 Unauthorized(401)，请设置环境变量：OFFICE_LOCAL_STATUS_TOKEN 或 OFFICE_LOCAL_STATUS_URL")
    try:
        while True:
            try:
                status_data = fetch_local_status()
                do_push(local, status_data)
            except Exception as e:
                print(f"⚠️  推送异常：{e}")
            time.sleep(PUSH_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        print("\n👋 停止推送")
        sys.exit(0)


if __name__ == "__main__":
    main()
