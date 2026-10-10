"""Read Codex summaries and complete Claude memories without modifying their files."""
from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import re


def sanitize_content(text: str) -> str:
    text = re.sub(r"ou_[a-f0-9]+", "[用户]", text)
    text = re.sub(r'user_id="[^"]+"', 'user_id="[隐藏]"', text)
    text = re.sub(r"(?:[A-Za-z]:[\\/]|/root/|/home/|/Users/)[^\s`<>]+", "[路径]", text)
    text = re.sub(r"sk-[A-Za-z0-9_-]{16,}", "[密钥]", text)
    text = re.sub(r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}", "[IP]", text)
    text = re.sub(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", "[邮箱]", text)
    return re.sub(r"1[3-9]\d{9}", "[手机号]", text)


def _display_text(text: str) -> str:
    text = re.sub(r"!?\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = sanitize_content(text.replace("`", "").replace("**", ""))
    text = " ".join(text.split())
    return text


def _parse_summary(content: str) -> dict | None:
    metadata = {}
    title = ""
    tasks = []
    fallback = ""
    in_header = True
    fence = ""
    current_task = None
    body_start = 0
    lines = content.splitlines(keepends=True)
    for index, raw in enumerate(lines):
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
            body_start = index + 1
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
    project = _display_text(re.split(r"[\\/]", cwd)[-1]) if cwd else ""
    if not tasks and fallback:
        tasks = [{"title": fallback, "outcome": ""}]
    return {
        "updated_at": updated.astimezone(timezone.utc).isoformat(),
        "date": updated.astimezone().date().isoformat(),
        "project": project,
        "title": title,
        "tasks": tasks,
        "text": sanitize_content("".join(lines[body_start:]).strip()),
    }


def _memory_title(content: str) -> tuple[str, str]:
    """Split a memory file into its frontmatter description and body text."""
    text = content
    title = ""
    lines = content.splitlines()
    if lines and lines[0].strip() == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() == "---":
                text = "\n".join(lines[index + 1:])
                for raw in lines[1:index]:
                    match = re.match(r"^description:\s*(.+?)\s*$", raw.strip())
                    if match:
                        title = match.group(1).strip().strip("'\"")
                break
    return title, text


def load_claude_memories() -> list[dict]:
    """Read all auto-memory bodies across Claude Code projects, ordered by file mtime."""
    config_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR", "").strip() or Path.home() / ".claude").expanduser()
    projects = config_dir / "projects"
    if not projects.is_dir():
        return []
    entries = []
    for directory in sorted(projects.iterdir()):
        memory_dir = directory / "memory"
        if not directory.is_dir() or not memory_dir.is_dir():
            continue
        for path in memory_dir.glob("*.md"):
            if path.name == "MEMORY.md" or path.is_symlink() or not path.is_file():
                continue
            try:
                title, text = _memory_title(path.read_text(encoding="utf-8-sig"))
                updated = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
            except (OSError, UnicodeError):
                continue
            entries.append({
                "updated_at": updated.isoformat(),
                "date": updated.astimezone().date().isoformat(),
                "project": directory.name,
                "title": " ".join(sanitize_content(title or path.stem).split()),
                "text": sanitize_content(text.strip()),
            })
    entries.sort(key=lambda item: item["updated_at"], reverse=True)
    return entries


def load_recent_memos() -> list[dict]:
    """Read complete summaries, sorted by updated_at rather than filename or file mtime."""
    codex_home = Path(os.environ.get("CODEX_HOME", "").strip() or Path.home() / ".codex").expanduser()
    directory = codex_home / "memories" / "rollout_summaries"
    if not directory.is_dir():
        return []
    entries = []
    for path in directory.glob("*.md"):
        if path.is_symlink() or not path.is_file():
            continue
        try:
            entry = _parse_summary(path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, ValueError):
            continue
        if entry:
            entries.append(entry)
    entries.sort(key=lambda item: item["updated_at"], reverse=True)
    return entries
