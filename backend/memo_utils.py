"""Read display summaries from Codex memory without modifying its files."""
from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import re

MAX_SUMMARY_BYTES = 512 * 1024


def sanitize_content(text: str) -> str:
    text = re.sub(r"ou_[a-f0-9]+", "[用户]", text)
    text = re.sub(r'user_id="[^"]+"', 'user_id="[隐藏]"', text)
    text = re.sub(r"(?:[A-Za-z]:[\\/]|/root/|/home/|/Users/)[^\s`<>]+", "[路径]", text)
    text = re.sub(r"sk-[A-Za-z0-9_-]{16,}", "[密钥]", text)
    text = re.sub(r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}", "[IP]", text)
    text = re.sub(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", "[邮箱]", text)
    return re.sub(r"1[3-9]\d{9}", "[手机号]", text)


def _display_text(text: str, limit: int = 240) -> str:
    text = re.sub(r"!?\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = sanitize_content(text.replace("`", "").replace("**", ""))
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def _parse_summary(content: str) -> dict | None:
    metadata = {}
    title = ""
    tasks = []
    fallback = ""
    in_header = True
    fence = ""
    current_task = None
    for raw in content.splitlines():
        line = raw.strip()
        if line.startswith(("```", "~~~")):
            if not fence:
                fence = line[:3]
            elif line.startswith(fence):
                fence = ""
            continue
        if fence or not line:
            continue
        if in_header and not line.startswith("#"):
            key, sep, value = line.partition(":")
            if sep and key in {"updated_at", "cwd"}:
                metadata[key] = value.strip().strip('"')
            continue
        in_header = False
        task = re.match(r"^#{1,6}\s+Task\s+\d+\s*[:.-]\s*(.+)", line, re.I)
        if task:
            current_task = {"title": _display_text(task.group(1)), "outcome": ""}
            tasks.append(current_task)
        elif line.startswith("# ") and not title:
            title = _display_text(line[2:])
        elif current_task and re.match(r"^(?:Task )?Outcome:", line, re.I):
            outcome = line.split(":", 1)[1].strip().lower()
            if outcome in {"success", "partial", "failed", "unknown"}:
                current_task["outcome"] = outcome
        elif title and not tasks and not fallback and not line.startswith("#"):
            fallback = _display_text(re.sub(r"^Rollout context:\s*", "", line, flags=re.I))
    try:
        updated = datetime.fromisoformat(metadata.get("updated_at", "").replace("Z", "+00:00"))
    except ValueError:
        return None
    if not title:
        return None
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=timezone.utc)
    cwd = metadata.get("cwd", "").rstrip("/\\")
    project = _display_text(re.split(r"[\\/]", cwd)[-1], 80) if cwd else ""
    if not tasks and fallback:
        tasks = [{"title": fallback, "outcome": ""}]
    return {
        "updated_at": updated.astimezone(timezone.utc).isoformat(),
        "date": updated.astimezone().date().isoformat(),
        "project": project,
        "title": title,
        "tasks": tasks[:3],
    }


def load_recent_memos(limit: int = 5) -> list[dict]:
    """Use updated_at metadata, never filename or filesystem modification time."""
    codex_home = Path(os.environ.get("CODEX_HOME", "").strip() or Path.home() / ".codex").expanduser()
    directory = codex_home / "memories" / "rollout_summaries"
    if not directory.is_dir():
        return []
    entries = []
    for path in directory.glob("*.md"):
        if path.is_symlink() or not path.is_file():
            continue
        try:
            with path.open("rb") as stream:
                raw = stream.read(MAX_SUMMARY_BYTES + 1)
            if len(raw) > MAX_SUMMARY_BYTES:
                continue
            entry = _parse_summary(raw.decode("utf-8-sig"))
        except (OSError, UnicodeError, ValueError):
            continue
        if entry:
            entries.append(entry)
    entries.sort(key=lambda item: item["updated_at"], reverse=True)
    return entries[:limit]
