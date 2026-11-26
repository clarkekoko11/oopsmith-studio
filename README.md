# Oopsmith Studio — Phase 4

A walkable 3D office where AI agents make your Oopsmith Shorts. All four desks are working:
**Scripty, the Script Writer**, **Cutter, the Editor**, **Hawk, the Reviewer** and **Pip, the Publisher**.

**The pipeline (autopilot, no questions):** Scripty writes + voices a Short → status `voiced` → Cutter builds
the cast, sets, story, sound and captions, runs the still checks → `ready_to_render` → the app renders it on
your graphics card with the toolkit's render worker → `in_review` → Hawk checks the video (size/fps/audio,
a contact sheet of frames against the script, caption sync) → `approved`, or `changes_requested` with a fix
list in `shorts/<ID>/review.md` → Cutter fixes those shots → re-render as v2 → Hawk again. From v3 on Hawk
approves unless it's badly broken and lists the rest under "Needs your eye". A failed render goes back to
Cutter with the error (up to 2 fixes per Short).

**Publishing (Pip):** an `approved` Short goes to Pip, who writes `shorts/<ID>/publish.json` + `publish.md` (title,
3 alternatives, description with the verified facts and a question, 15–20 tags; your skill's step 7b rules) →
`ready_to_publish` → the app uploads it with the toolkit's `tools/youtube_upload.py` as **private** (you publish in
YouTube Studio) or **scheduled**: one Short per day, each on the next free day at that weekday's best time in your
audience's time zone (default US Eastern; Mon 6 PM, Tue 7 PM, Wed 6 PM, Thu 7 PM, Fri 4 PM, Sat 6 PM, Sun 5 PM —
from Buffer's and SocialPilot's 2026 studies; edit in Settings) → `uploaded_private` / `uploaded_scheduled`, with a
YouTube Studio link in Pip's chat and on the review screen. Never public straight away.

Connect YouTube once in Settings → YouTube: (1) choose the `client_secret.json` of a Google Cloud OAuth client
(Desktop app, YouTube Data API v3 enabled — AUTOMATION.md step 4); (2) Sign in to YouTube (installs Google's
packages, opens the browser). Signing in turns off the render worker's own upload, so uploads only happen after
review. Turn off "Upload automatically" to press **Upload** yourself on the review screen.

**Review screen:** click the TV on the back wall (or 🎬 Review in the top bar) to watch any render, read
Hawk's review and the tokens each desk used, and Approve or Request changes yourself — your call overrides
Hawk's and is saved to GitHub.

**Tokens per Short:** after every job the desk's chat shows what it used ("RS-0003 · 1.2M tokens (38k written
· 1.1M re-read from cache · 85 steps)"); totals per Short are on the pipeline board and the review screen.
Every Short (and every hand-off) starts a fresh conversation, so earlier Shorts are never re-sent.

Agents run on **your own Claude plan** (Pro) through the official Claude Code login on this PC.
The app never sees your Claude password or token.

## What you need (Windows)
- **Node.js 20 or newer** — nodejs.org (LTS)
- **Python 3**, **ffmpeg** and **Git** on PATH (you already have these for the render worker)
- Git signed in to the GitHub account that owns `clarkekoko11/roblox-shorts-toolkit`
- Your **Gemini API key** (Google AI Studio → Get API key) for voiceovers

## Install and run
```powershell
git clone https://github.com/clarkekoko11/oopsmith-studio.git
cd oopsmith-studio
npm install
npm start
```
Install from GitHub with `git clone` (not a zip) so the app can update itself.

## Updates
The app checks GitHub when it starts and every 3 hours. When there's a new version, a green
**⬆ Update ready** chip appears in the top bar (also Settings → App updates). Click it: the app pulls the
new version, re-installs packages if they changed, rebuilds and restarts. Settings, chats and your Claude
login are kept (they live in `%APPDATA%\Oopsmith Studio`, not in the app folder).
Don't edit files in the app folder by hand, or updates will stop until you undo those changes.
`npm install` downloads Electron and the Claude Code engine for Windows (a few hundred MB, first time only).

## First run (about 2 minutes)
1. **Sign in to Claude:** click the account chip (top left) → **Sign in / switch…**. A terminal opens; type
   `/login`, sign in with your Pro account in the browser, close the terminal, then press **Check again**.
   The chip should show your email and "Pro".
2. **Toolkit:** nothing to do. On start the app clones `clarkekoko11/roblox-shorts-toolkit` from GitHub
   (into `~\OopsmithStudio\roblox-shorts-toolkit`, or reuses `~\roblox-shorts-toolkit` if you already
   have it) and pulls the latest version on every start after that. If you have uncommitted changes in it,
   it leaves them alone. A different repo or folder can be set in Settings → Toolkit.
   If GitHub asks you to sign in, a browser window from Git Credential Manager opens.
   The pipeline board on the back wall then lists your Shorts.
3. **Rendering (one time, 10–20 min):** Settings → Rendering → **Set up rendering**. It runs
   `tools/render_worker.py --setup` (Blender for Python, Playwright's browser, Remotion, base 3D assets)
   and installs faster-whisper for transcribing voiceovers. If you already did this for the render worker,
   it just re-checks quickly. Videos go to the worker's `output_dir` (default `~\Videos\RobloxShorts`).
   If your PC render worker is also running in the background, stop it so the two don't render at once.
4. **Gemini key:** paste it in Settings → **Save** → **Test key**. It's encrypted with Windows (DPAPI)
   and only handed to the voiceover tool while it runs.

If you have an `ANTHROPIC_API_KEY` environment variable set, the app ignores it so your Pro plan is used,
and shows a notice.

## Controls
| Top-down (default) | First person (press **V**) |
|---|---|
| Click the floor to walk | Click to look around (mouse) |
| Click an agent to walk over and talk | WASD move, Shift run |
| Scroll to zoom | **E** to talk to the agent in front of you |
| Q/E or right-drag to rotate | Esc frees the mouse |
| WASD also walks | **V** back to top-down |

Esc closes a chat.

## Autopilot (on by default)
With **Autopilot ON** (top bar) the agents never ask you anything or wait for approval. Press
**▶ Make today's Short** — or let the daily run start it (Settings → Autopilot, default 09:00) — and Scripty
picks a new true story that isn't in SHORTS.md, verifies it, writes and self-checks the script, makes the
voiceover, writes every decision into the Short's notes (`shorts.py set <ID> notes=…`), commits and pushes.
It only stops if something truly needs you (no Gemini key, voiceover API error, push rejected).
Anything outside the safe list below is skipped instead of asked. Turn Autopilot off to chat and approve
step by step. The daily run needs the app open (or opened later that day) and the PC awake.

## What Scripty does
Ask for pitches or name a story. Scripty checks the facts with web sources, writes the 45–60 s script in
your house style (your `viral-short-script` rules), and waits for your approval. After you approve, it
creates the RS ID, saves `shorts/<ID>/script.txt`, makes the voiceover with Gemini 3.8 Flash TTS (Alnilam,
promote, +3 st, 1.25x), and puts a player in the chat so you can listen.

**What runs without asking:** reading files, web search, writing inside the toolkit folder, and the
toolkit's own commands (`tools/shorts.py`, `tools/voiceover.py`, `ffmpeg`, `git status/add/commit/pull`,
and a plain `git push` to your toolkit repo — so each approved script + voiceover lands on GitHub).
**Asks you first:** anything else, such as pushing somewhere else, other commands, or writing outside the toolkit.
**Always blocked:** printing API keys, recursive deletes, force-push.

## What Cutter may run without asking
Everything Scripty may, plus the toolkit's own builders and scripts: `python tools|blender|audio/*.py`
(including new set builders he writes into `blender/`) and `node tools/*.mjs`. Paths with `..` or outside the
toolkit still ask (or are skipped in autopilot).

## Where things are saved
`%APPDATA%\Oopsmith Studio\` — settings, encrypted Gemini key, chat history per desk, and the Claude
session id (so Scripty remembers the conversation after a restart; **New chat** starts fresh).

## Build an installer (optional)
```powershell
npm run dist
```
Creates `release\Oopsmith Studio Setup 0.1.0.exe`.

## Project layout
```
src/main/        Electron main process: agents (Claude Agent SDK), permissions, settings, account check
src/preload/     the bridge between the window and main
src/renderer/    the 3D office (Three.js) and UI
  office/        world.ts (room, desks, board) · characters.ts (R6 Roblox-style) · game.ts (cameras, input) · nav.ts (pathfinding)
  ui/            chat markdown, browser preview mock
resources/       bundled copy of viral-short-script.md (the toolkit's copy wins if present)
```

## Current limits
- Models default to Sonnet for every desk (Settings to change). Each job has a step cap so a stuck agent can't burn your plan.
- One Short moves through the pipeline at a time. Building a Short uses a lot of Claude usage (many steps and still checks); on Pro, expect roughly one Short a day.
- Plan usage appears in the top bar after the first message (it's reported with each reply).
- Profiles / second-account switching is Phase 5; for now "Sign in / switch…" changes the one login.
