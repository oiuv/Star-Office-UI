# Star Office UI

🌐 Language: [中文](./README.md) | **English** | [日本語](./README.ja.md)

![Star Office UI Cover](docs/screenshots/office-current.png)

**A pixel-art AI office dashboard** — visualize your AI assistant's work status in real time, so you can see at a glance who's doing what, what they worked on recently, and whether they're online.

Supports multi-agent collaboration, trilingual UI (CN/EN/JP), AI-powered room design, and desktop pet mode.
**Codex hooks** are the recommended integration: automatically update characters and record sessions, tools, and subagent activity. Other AI agents can connect through scripts or the HTTP API.

This version is based on [ringhyacinth/Star-Office-UI](https://github.com/ringhyacinth/Star-Office-UI). Development and deployment use [oiuv/Star-Office-UI](https://github.com/oiuv/Star-Office-UI).

> The original project was co-created by **[Ring Hyacinth](https://x.com/ring_hyacinth)** and **[Simon Lee](https://x.com/simonxxoo)**, and is continuously maintained and improved together with community contributors ([@Zhaohan-Wang](https://github.com/Zhaohan-Wang), [@Jah-yee](https://github.com/Jah-yee), [@liaoandi](https://github.com/liaoandi)).
> Issues and PRs are welcome — thank you to everyone who contributes.

---

> The browser office fills the viewport. Click the bottom office name for Recent Notes, Visitors, Room Design, Activity, and settings. Codex subagents join automatically without keys; after stopping they become offline and disappear after five minutes without events. Direct Python startup does not load `.env`; inject variables through your shell or service manager. Guest distribution uses `frontend/office-agent-push.py` (requires `requests`); the root script creates a fresh random test visitor on each launch. Recent Notes read the backend account's Codex summaries, not the visiting browser's files. See the [Chinese guide](./README.md) for the full current configuration and regression commands.

## ✨ Quick Start: Codex hooks (recommended)

Start the dashboard, configure hooks, then submit a task in Codex to see animations and activity records.

> **Requires Python 3.10+**. Use `python3` if that is your interpreter command. Copy the sample state only on first install; keep existing configuration.

### 1) Start the dashboard

```bash
git clone https://github.com/oiuv/Star-Office-UI.git
cd Star-Office-UI
python -m pip install -r backend/requirements.txt
cp state.sample.json state.json
python backend/app.py
```

Open [http://127.0.0.1:19000](http://127.0.0.1:19000). Leave the backend running and open another terminal in the Star Office project root.

### 2) Configure Codex hooks

```bash
python scripts/codex_hooks_config.py
```

Merge the output into the `.codex/hooks.json` of the project where you use Codex, or your user-level `~/.codex/hooks.json`. Merge event arrays with existing hooks. Use `/hooks` in Codex to review and trust the configuration.

The generated command uses an absolute script path, so Codex can call it from other projects. Use `--python` to specify an interpreter path when needed.

### 3) Submit a task and view activity

Submit a task in Codex. The character updates automatically and returns to idle when the turn ends or is interrupted. Open the [activity archive](http://127.0.0.1:19000/stats) for events, tool statistics, sessions, XP, and logs.

You can also ask an AI assistant to follow this repository's [SKILL.md](./SKILL.md) for deployment and hooks setup.

![Activity archive with monthly collections and followed goals](docs/screenshots/activity-current.png)

---

## 🔌 Codex hooks configuration

Keep **6 animation states + 12 lifecycle events**: states describe the character's action; events explain what triggered it. The generated configuration covers all 12 events.

The generator and example use Chinese `statusMessage` labels and a 3-second timeout for every event. `PostToolUse` runs asynchronously. These labels only affect Codex's progress messages; event data determines office animations and statistics.

| Hook | Animation / meaning |
|------|---------------------|
| `SessionStart` | Idle on start or resume; restore work state after compaction |
| `UserPromptSubmit` | Researching: understand the task |
| `PreToolUse` | Writing, researching, or executing based on tool type |
| `PermissionRequest` | Idle while waiting for permission |
| `PostToolUse` | Executing; error only on an explicit failure |
| `PreCompact` | Syncing: organize context |
| `PostCompact` | Restore the state from before compaction |
| `SubagentStart` | Start an independently tracked child character |
| `SubagentStop` | Child returns to idle |
| `Stop` | Main turn ends; return to idle |
| `Interrupt` | Return to idle and end child presence |
| `SessionEnd` | End the session; return to idle |

See the [official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks) and [example configuration](./integrations/codex/hooks.example.json). The script observes events, outputs an empty JSON object, and does not make permission decisions. Changes to hook definitions require renewed trust; project-level hooks also require a trusted project.

### Local and remote modes

- **Local default**: `codex_hook.py` writes SQLite and the state file directly. It records events even while Flask is stopped; run the backend to view them.
- **Remote**: set `STAR_OFFICE_URL`, for example `https://your-office.example`, in the Codex process. Set the same `STAR_OFFICE_HOOK_TOKEN` on both client and backend. Without a token, only direct loopback requests are accepted; use a token behind a reverse proxy.
- The default database is `data/office-events.sqlite3`; override it with `STAR_OFFICE_EVENTS_DB`. Use `STAR_OFFICE_STATE_FILE` to change the state-file path.
- Prompts, command bodies, full tool outputs, transcripts, and working directories are not stored. Late asynchronous tool results remain in the log without reviving a completed turn.
- States expire after five minutes without updates. Long tool calls may temporarily appear offline until the next hook.

---

## 🤔 Who is this for?

### People using AI for coding or automation

See whether an AI is writing, researching, running tools, or waiting for permission. Codex hooks update the dashboard automatically; other agents can call the state script or API.

### Individuals and teams running multiple agents

View agents and subagents in one office and review tool activity, collaboration, and turn completion in the activity archive.

### People who want a pixel dashboard and work records

Push states manually or from scripts for personal logs, remote collaboration, or automation. Core features work without an image-generation API.

---

## 📋 Features

1. **Automatic Codex hooks** — 12 lifecycle events drive animations and records, including sessions, tools, compaction, interrupts, and subagents
2. **Activity and progression** — State counts and observed time, trends, tool statistics, filterable logs, JSON export, XP, levels, 24 regular achievements, hidden discoveries, full collection, and monthly badges
3. **Status Visualization** — 6 states (`idle` / `writing` / `researching` / `executing` / `syncing` / `error`) mapped to different office areas with animated sprites and speech bubbles
4. **Recent Notes** — Reads the latest five Codex summaries from `$CODEX_HOME/memories/rollout_summaries/` (default `~/.codex/`). Shows summary update dates, projects, and up to three tasks per entry; no API calls or manual diary required.
5. **Multi-Agent Collaboration** — Invite other agents to join your office via join keys and see everyone's status in real time
6. **Trilingual UI** — Switch between Chinese, English, and Japanese with one click; all UI text, bubbles, and loading messages update instantly
7. **Custom Art Assets** — Manage characters, scenes, and decorations through the sidebar; dynamic frame sync prevents flickering
8. **AI-Powered Room Design** — Connect an OpenAI-compatible Image API (default model: `gpt-image-2`) to generate new office backgrounds; core features work fine without an API
9. **Mobile-Friendly** — Open on your phone for a quick status check on the go
10. **Security Hardening** — Sidebar password protection, weak-password blocking in production, hardened session cookies
11. **Flexible Public Access** — Use Cloudflare Tunnel for instant public access, or bring your own domain / reverse proxy
12. **Desktop Pet Mode** — Optional Electron desktop wrapper that turns the office into a transparent desktop widget (see below)

---

## 🚀 Detailed Setup Guide

### 1) Install dependencies

```bash
cd Star-Office-UI
python3 -m pip install -r backend/requirements.txt
```

### 2) Initialize state file

```bash
cp state.sample.json state.json
```

### 3) Start the backend

```bash
cd backend
python3 app.py
```

Open [http://127.0.0.1:19000](http://127.0.0.1:19000).

> ✅ For local development you can start with the defaults; in production, use `.env.example` as a reference and inject strong random values into the process environment for `FLASK_SECRET_KEY` and `ASSET_DRAWER_PASS` to avoid weak passwords and session leaks.

### 4) Verify states manually (optional)

Run these from the project root in another terminal. Codex hooks handle normal status updates automatically.

```bash
python3 set_state.py writing "Organizing documents"
python3 set_state.py syncing "Syncing progress"
python3 set_state.py error "Found an issue, debugging"
python3 set_state.py idle "Standing by"
```

### 5) Public access (optional)

```bash
cloudflared tunnel --url http://127.0.0.1:19000
```

Share the `https://xxx.trycloudflare.com` link with anyone.

### 6) Verify your installation (optional)

```bash
python3 scripts/smoke_test.py --base-url http://127.0.0.1:19000
```

The smoke check reads pages and APIs without pushing test states. To verify hooks, submit a Codex task and confirm its events in `/stats`.

---

## 🤝 Other AI agents

Any agent that can run scripts or send HTTP requests can use the original integration. Once Codex hooks are configured, additional manual status-sync rules are unnecessary.

### Automatic Status Sync

Add these rules to your agent instructions and run `set_state.py` from the Star Office project root. Alternatively, send `POST /set_state` with `state` and `detail` fields:

```markdown
## Star Office Status Sync Rules
- When starting a task: run `python3 set_state.py <state> "<description>"` before beginning work
- When finishing a task: run `python3 set_state.py idle "Standing by"` before replying
```

**6 states → 3 office areas:**

| State | Office Area | When to use |
|-------|-------------|-------------|
| `idle` | 🛋 Breakroom (sofa) | Standing by / task complete |
| `writing` | 💻 Workspace (desk) | Writing code or docs |
| `researching` | 💻 Workspace | Searching / researching |
| `executing` | 💻 Workspace | Running commands / tasks |
| `syncing` | 💻 Workspace | Syncing data / pushing |
| `error` | 🐛 Bug Corner | Error / debugging |

### Invite Other Agents to Your Office

**Step 1: Prepare join keys**

When you start the backend for the first time, if there is no `join-keys.json` in the project root, the service will automatically create one based on `join-keys.sample.json` (which contains an example key such as `ocj_example_team_01`). You can then edit the generated `join-keys.json` to add, modify, or remove keys; by default each key supports up to 9 concurrent visitors.

**Step 2: Have the guest run the push script**

Distribute [`frontend/office-agent-push.py`](./frontend/office-agent-push.py), install `requests`, and fill in these 3 variables:

```python
JOIN_KEY = "ocj_starteam02"          # The key you assign
AGENT_NAME = "Alice's Agent"       # Display name
OFFICE_URL = "https://your-office.example"  # Your office URL
```

```bash
python3 -m pip install requests
python3 office-agent-push.py
```

The script auto-joins and pushes status every 15 seconds. The guest will appear on the dashboard, moving to the appropriate area based on their state.

**Step 3 (optional): Guest installs a Skill**

Guests can also use `frontend/join-office-skill.md` as a Skill — their agent will handle setup and pushing automatically.

> See [`frontend/join-office-skill.md`](./frontend/join-office-skill.md) for full guest onboarding instructions.

---

## 📊 Activity archive and progression

Open the [activity archive](http://127.0.0.1:19000/stats) or click the office's activity link. View today, 7 days, 30 days, or all records, including state counts and observed time, the 12 hook counts, sessions, completed turns, tools, daily trends, and filtered logs. Export the latest 200 matching events as JSON.

Tool durations pair start/end events by `tool_use_id`. Unique completed turns award 20 XP, successful tools 2 XP, and subagent completions 10 XP; each 100 XP adds a level. Duplicate replays and state heartbeats do not award extra XP.

`set_state.py`, `POST /set_state`, and `POST /agent-push` also record activity. Session, turn, and tool breakdowns require the corresponding lifecycle events. Dates use the backend's local time zone, and observed time is capped at 300 seconds per update. Direct edits to the state file do not create records.

### Achievements and collections

- **24 regular badges across 8 tracks**: session starts, task submissions, completed turns, tool attempts, tool successes, completed compactions, collaboration starts, and collaboration finishes. Each track has a one-time basic badge, a one-time milestone, and an advanced badge with unlimited levels.
- **Advanced levels double their cumulative thresholds**: the successful-tool badge unlocks at 1,000 calls, reaches Lv.2 at 2,000 and Lv.3 at 4,000. On wide screens, two fixed badges sit on the left and one taller advanced card on the right; on phones they stack vertically.
- **Follow up to 3 advanced badges** to see their next-level progress near the top. Selections are saved in the current browser. Lifetime progress is deduplicated and unaffected by the date filter; existing history is recalculated without resetting XP.
- **Full collection** requires the initial unlock of all 24 regular badges; Lv.1 is enough for advanced badges. Hidden discoveries and monthly badges are excluded.
- **Monthly challenge** uses the same three requirements every month: **10 active days, 100 task submissions (UserPromptSubmit), and 1,000 successful tool calls**. All three must be met within the backend's local calendar month; active days need not be consecutive. Task submissions, completed turns, or successful tools count as activity. Multiple agents on the same date count as one active day; heartbeats and permission waits do not count. Task submissions are deduplicated by turn ID; repeated reports count once.
- **Monthly collection** keeps each earned year-month badge with a seasonal theme. A new month starts fresh; retained historical events can unlock past months, including late arrivals. Back up `data/office-events.sqlite3` to preserve the record.
- **Hidden discoveries** have 9 optional experiences plus a tenth reward for collecting all nine. Locked cards show only an unrevealed placeholder; names and conditions appear after unlocking. Some use rare lifecycle events and others use local time and actual task events. They never block the regular full collection.
- Achievements and monthly badges award no extra XP. All 12 lifecycle event statistics remain available.

See the [full rule table and screenshots](./README.md#成就成长线). Hidden conditions and screenshots are in separate spoiler folds in the Chinese guide.

---

## 🎨 OpenAI image generation (gpt-image-2)

In the asset drawer, configure the API key, base URL, model, and edit/generate mode. Defaults are `https://api.openai.com/v1`, `gpt-image-2`, and reference-image editing. Custom base URLs and models are supported.

The service must implement `/images/edits` or `/images/generations`; a chat-only endpoint cannot generate office backgrounds. Settings use authenticated `GET /config/ai` and `POST /config/ai`. Environment options are `OPENAI_API_KEY`, `AI_BASE_URL` (or `OPENAI_BASE_URL`), `AI_IMAGE_MODEL`, and `AI_IMAGE_MODE`; saved UI/file settings take precedence. The CLI is `scripts/image_generate.py`.

---

## 📡 API Reference

| Endpoint | Description |
|----------|-------------|
| `POST /hooks/codex` | Receive Codex events; Bearer token for remote use |
| `GET /api/stats?period=today` | Activity statistics; `today` / `7d` / `30d` / `all` |
| `GET /api/events?period=7d&limit=50` | Event log; limit 1–200, optional `state` / `hook` filters |
| `GET /health` | Health check |
| `GET /status` | Get main agent status |
| `POST /set_state` | Set main agent status |
| `GET /agents` | List all agents |
| `POST /join-agent` | Guest joins the office |
| `POST /agent-push` | Guest pushes status |
| `POST /leave-agent` | Guest leaves |
| `GET /recent-memo` | Get recent Codex summaries (`/yesterday-memo` remains an alias) |
| `GET /config/ai` | Get OpenAI Image API settings (key masked) |
| `POST /config/ai` | Save OpenAI Image API settings |
| `GET /assets/generate-rpg-background/poll` | Poll image generation progress |

---

## 🖥 Desktop Pet Mode (Optional)

`desktop-pet/` provides a **Tauri** desktop version; `electron-shell/` provides an **Electron** version. Both can turn the pixel office into a desktop widget.

```bash
cd desktop-pet
npm install
npm run dev
```

- Auto-launches the Python backend on startup
- Window points to `http://127.0.0.1:19000/?desktop=1` by default
- Customizable via environment variables for project path and Python path

> ⚠️ This is an **optional, experimental feature**, primarily developed and tested on macOS. See [`desktop-pet/README.md`](./desktop-pet/README.md) for details.
>
> 🙏 The desktop pet module was independently developed by [@Zhaohan-Wang](https://github.com/Zhaohan-Wang) — thank you for this contribution!

---

## 🎨 Art Assets & License

### Asset Attribution

Guest character animations use free assets by **LimeZu**:
- [Animated Mini Characters 2 (Platformer) [FREE]](https://limezu.itch.io/animated-mini-characters-2-platform-free)

Please keep attribution when redistributing or demoing, and follow the original license terms.

### License

- **Code / Logic: MIT** (see [`LICENSE`](./LICENSE))
- **Art Assets: Non-commercial use only** (learning / demo / sharing)

> For commercial use, replace all art assets with your own original artwork.

---

## 📁 Project Structure

```text
Star-Office-UI/
├── backend/            # Flask backend
│   ├── app.py
│   ├── requirements.txt
│   └── run.sh
├── frontend/           # Frontend pages & assets
│   ├── index.html
│   ├── join.html
│   ├── invite.html
│   └── layout.js
├── desktop-pet/        # Tauri desktop version (optional)
├── electron-shell/     # Electron desktop version (optional)
├── docs/               # Documentation & screenshots
│   └── screenshots/
├── office-agent-push.py  # Random local test visitor
├── set_state.py          # Status switch script
├── state.sample.json     # State file template
├── join-keys.sample.json # Join key template (runtime generates join-keys.json)
├── codex_hook.py         # Codex hooks adapter
├── integrations/codex/   # Example hook configuration
├── scripts/              # Hook config generator and image CLI
├── SKILL.md              # General agent deployment guide
└── LICENSE               # MIT License
```
