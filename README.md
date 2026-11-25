# Oopsmith Studio — Phase 1

A walkable 3D office where AI agents make your Oopsmith Shorts. Phase 1 has the full office (Sims-style
top-down view + first-person view) and one working agent: **Scripty, the Script Writer**. The Editor,
Reviewer and Publisher desks are in place and come online in Phases 2–4.

Agents run on **your own Claude plan** (Pro) through the official Claude Code login on this PC.
The app never sees your Claude password or token.

## What you need (Windows)
- **Node.js 20 or newer** — nodejs.org (LTS)
- **Python 3**, **ffmpeg** and **Git** on PATH (you already have these for the render worker)
- Git signed in to the GitHub account that owns `clarkekoko11/roblox-shorts-toolkit`
- Your **Gemini API key** (Google AI Studio → Get API key) for voiceovers

## Install and run
```powershell
cd oopsmith-studio
npm install
npm start
```
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
3. **Gemini key:** paste it in Settings → **Save** → **Test key**. It's encrypted with Windows (DPAPI)
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

## Phase 1 limits
- Only Scripty is live; the other desks show "arrives in Phase N".
- Plan usage appears in the top bar after the first message (it's reported with each reply).
- Profiles / second-account switching is Phase 5; for now "Sign in / switch…" changes the one login.
