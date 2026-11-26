# Oopsmith Studio — Phase 4

A walkable 3D office where AI agents make your Oopsmith Shorts. All four desks are working:
**Scripty, the Script Writer**, **Cutter, the Editor**, **Hawk, the Reviewer** and **Pip, the Publisher**.

## The studio
A cozy creative loft in the Oopsmith brand (colours, Bricolage Grotesque + DM Sans, logos and posters from the brand
kit in `src/renderer/assets`). Each team works on a **production line laid out in pipeline order**, left to right:
① Scripts → ② Edit bay → ③ Review → ④ Publish, with an arrow track on the floor and film cans riding an overhead
rail from desk to desk. The team's pipeline board hangs on the left wall and its review screen on the right wall.
Everyone shares the **lounge** at the front: the Oops café coffee bar, water cooler, the orange sofa, bean bags, two
arcade cabinets, a reading nook, a record player and plants.

**Idle agents have a life:** when a desk has nothing to do, its agent stretches, then wanders off for a break —
coffee (two at the bar start chatting), the sofa, arcade, books, watering plants, gazing out the window, dancing by
the record player. Their bubble says what they're up to. The moment work arrives they walk back and start typing;
an agent who needs you waves. Click anyone, wherever they are, to walk over and talk — they wait for you.

## Teams
**Team chip (top left) → Teams** to add up to four teams, rename them, or remove them (back down to one). Each team is a
full line of four agents working in **its own toolkit repo** (so Short IDs never collide), and **teams work in
parallel**. Renders take turns on your graphics card and uploads take turns too. Every extra team uses your Claude
plan faster. The top bar, review screen and Settings → Toolkit act on the active team (click an agent or a team's
review screen to switch). The daily run starts a Short for every team. Removing a team stops its desks; its toolkit
clone and chats stay on the PC. The main team keeps the original settings, chats and folders.

**The pipeline (autopilot, no questions):** Scripty writes + voices a Short → status `voiced` → Cutter builds
the cast, sets, story, sound and captions, runs the still checks → `ready_to_render` → the app renders it on
your graphics card with the toolkit's render worker → `in_review` → Hawk checks the video (size/fps/audio,
a contact sheet of frames against the script, caption sync) → `approved`, or `changes_requested` with a fix
list in `shorts/<ID>/review.md` → Cutter fixes those shots → re-render as v2 → Hawk again. From v3 on Hawk
approves unless it's badly broken and lists the rest under "Needs your eye". A failed render goes back to
Cutter with the error (up to 2 fixes per Short).

**Publishing (Pip):** an `approved` Short goes to Pip, who writes `shorts/<ID>/publish.json` + `publish.md` (title,
3 alternatives, description with the verified facts, a question and hashtags, tags) → `ready_to_publish`. Then, by
**Settings → Publishing → Publish via** (switch any time):
- **YouTube direct** (default, free): uploads from this PC as private with an exact go-live time → `uploaded_scheduled`;
  YouTube makes it public then, even with the PC off. After that time the app checks the video really went public →
  `published`, or `publish_failed` if YouTube kept it private (some unverified Google Cloud projects are held private).
  Setup: Google Cloud OAuth client (Desktop app, YouTube Data API v3) → choose client_secret.json → Sign in.
- **Buffer**: puts the video on your video host (Cloudinary or Cloudflare R2 — Buffer only takes public links), then
  creates a YouTube Short post in Buffer → `queued_buffer` → `published`. Setup: Buffer API key, YouTube channel in
  Buffer, video host keys.
- **I post them myself**: nothing is posted automatically; Pip's details are on the review screen to copy.

One Short per day either way: each goes on the next free day at that weekday's best time in your audience's time zone
(default US Eastern: Mon 6 PM, Tue 7 PM, Wed 6 PM, Thu 7 PM, Fri 4 PM, Sat 6 PM, Sun 5 PM — Buffer's and SocialPilot's
2026 studies). **Posted one yourself** (now or before the app existed)? Open it on the review screen and press
**I posted it myself** with the date: it becomes `published_manual`, is never posted again, and its day counts in the
schedule. "Not posted after all" undoes it.

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

## Install (the easy way)
1. Open **[Releases](https://github.com/clarkekoko11/oopsmith-studio/releases/latest)** and download
   `OopsmithStudio-Setup-<version>.exe`.
2. Run it. It installs for your Windows user only (no admin), and adds Start menu and desktop shortcuts.
3. The installer isn't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click
   **More info → Run anyway**. This only happens on the first install.

## Updates
The app checks GitHub Releases when it starts and every 3 hours, and downloads a new version quietly in the
background. When it's ready, a green **⬆ Update ready** chip appears in the top bar (also Settings → App
updates). Click it to install and restart, or just close the app and the update installs then. Settings,
chats, keys and your Claude login are kept (they live in `%APPDATA%\Oopsmith Studio`).

**Publishing a new version (for the maintainer):** bump `version` in `package.json`, commit and push, then
either push a tag (`git tag v0.6.1 && git push --tags`) or run the **Release** workflow from the Actions
tab (it tags the version for you). GitHub Actions builds the installer on Windows and publishes the
release; every installed copy picks it up.

## Run from source (developers)
```powershell
git clone https://github.com/clarkekoko11/oopsmith-studio.git
cd oopsmith-studio
npm install
npm start
```
A source clone updates itself with `git pull` instead (same ⬆ chip). Don't edit files in it by hand, or
updates stop until you undo those changes.

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
