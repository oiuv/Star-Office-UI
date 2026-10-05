# Repository Guidelines

## Project Structure & Module Organization

- `backend/` contains Flask routes, hook normalization, SQLite activity storage, achievements, and image API integration.
- `frontend/` contains the Phaser office, shared JavaScript/CSS, sprites, and `/stats` interface. `index.html` serves browsers; `electron-standalone.html` is maintained separately. Check both when changing shared behavior or assets.
- `electron-shell/` and `desktop-pet/` provide optional Electron and Tauri clients.
- `scripts/` holds development utilities; `integrations/codex/` contains hook examples. `codex_hook.py` records or forwards events.
- `tests/` contains regression tests; `art/` holds sprite sources; `assets/` holds room references. `data/` contains local runtime databases.

## Build, Test, and Development Commands

Run from the repository root using Python 3.10+ and Node.js for JavaScript tests. The web frontend requires no build step.

- `python -m pip install -r backend/requirements.txt` — install Flask and Pillow.
- `python backend/app.py` — start the office at `http://127.0.0.1:19000`; override with `STAR_BACKEND_PORT`.
- `python scripts/codex_hooks_config.py` — print hook configuration for merging into an existing hooks file.
- `python -B -m unittest discover -s tests -v` — run Python tests.
- `node --test tests/test_stats.cjs tests/test_image_settings.cjs tests/test_speech_bubbles.cjs` — run frontend logic tests.
- Inside `electron-shell/`, run `npm ci`, then `npm run dev` for Electron.

Restart the backend after editing `frontend/index.html`; its HTML is cached in memory.

## Coding Style & Naming Conventions

Use four-space Python indentation, `snake_case` functions, and uppercase constants. JavaScript uses `camelCase`; follow each file's existing two- or four-space indentation. Preserve UTF-8 text and existing pixel-art styling. Keep sprite dimensions and frame ranges consistent with their loaders. No shared formatter or linter is configured; run `git diff --check`.

## Testing Guidelines

Use Python `unittest` and Node `node:test`. Name tests `test_*.py` or `test_*.cjs`. Cover meaningful behavior changes with temporary databases and mocked image APIs. No coverage percentage is enforced. Verify UI changes in desktop and narrow browser viewports, including scrolling, focus, and animation behavior.

## Commit & Pull Request Guidelines

Follow recent subjects: `feat: ...`, `fix: ...`, or `chore: ...`. Keep commits focused. PRs should explain the problem, resulting behavior, validation, and relevant issues; include screenshots for visual changes.

## Configuration & Agent Instructions

Never commit credentials, `.env`, `join-keys.json`, `office-agent.local.json`, runtime state, or SQLite databases. Direct Python startup does not load `.env`; set environment variables explicitly.

Preserve existing uncommitted work. Commit or push only when requested. If `.codegraph/` exists, use `codegraph explore` before searching or reading code; otherwise skip CodeGraph without creating an index.
