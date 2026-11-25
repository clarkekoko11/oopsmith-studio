---
name: "roblox-story-shorts"
description: "Turn a voiceover (or script) into a 3D Roblox-style story Short — Blender characters/sets, Three.js animation, Remotion karaoke captions, synthesised SFX and music, 1080x1920 at 30 fps."
---

# Roblox story Shorts from a voiceover

Make a vertical 3D Short in the Roblox style that acts out what a voiceover says. The pipeline and every
script ship alongside this file and, once set up, in a private GitHub "toolkit repo" on the user's account
that grows with every Short; this file is the workflow and the standards. Needs a Linux workspace with a shell, Python and Node, and network access
to PyPI, npm and Hugging Face (first run downloads the speech model). Stay in the turn while frames render:
background jobs may be stopped once the reply ends. Read the repo's `README.md` for file-level reference and the coordinate conventions, and use
`src/stories/lake.js` (Lake Peigneur, 24 shots, 48.9 s) as the worked example to copy patterns from.

## House style (what the user has asked for — keep it)
- **Story only, no narrator character.** Never insert a presenter/mascot; every shot shows the story's own
  people, places and objects. Rhetorical lines ("so how does…?") get story characters reacting, or an
  explainer visual (cutaway, analogy), not a host.
- **Roblox look:** R6 blocky bodies, cylinder heads, flat Roblox decal faces (smile, talk, blink, surprised,
  grin, scared, annoyed), bright saturated colours, soft shadows, depth of field. Not photoreal.
- **Lighting not too bright:** keep the engine defaults (Neutral tone mapping, exposure ≈0.78, sun ≈2.15,
  rim 1.0, HDR bloom threshold ≈6). Avoid shots aimed into the sun.
- **Nothing clips through anything:** people never overlap each other, props or walls (see checks below).
- **Number callouts:** use `ctx.hud(text, age)` (crisp 2D overlay, upper third, `<b>` = yellow), never 3D label sprites —
  depth of field and bloom blur sprites into a smudge.
- **Hair:** smooth sculpted Roblox-catalog-style shells (the toolkit default), never many separate strands; under hats
  only at the sides and back.
- **Captions:** Remotion, 30 fps, 1–3 lowercase words, Montserrat Black Italic, white with a black stroke,
  at 60% height; the **spoken word lights up yellow and pops in sync with the voice**; captions spring in and bob.
- **Animation alive:** idle breathing/head motion is automatic; add anticipation, reactions, secondary motion
  (wobble, bob, bounce, splashes) to props. Cut every ~1.5–2.5 s with handheld camera moves.
- Deliver 1080x1920, 30 fps MP4 with voiceover + SFX + original music, then offer a title if asked.

## Batches, IDs and change requests
- **How many?** At the start, ask how many Shorts to make (default 1) unless the request says ("make 5"). For a batch:
  write all scripts first and get them approved together, make all voiceovers (send them for a listen), then build
  and render the Shorts one by one, delivering each as soon as it's done. Tell the user the render estimate up front
  (~1 h per minute of video on CPU; a batch of 5 one-minute Shorts ≈ 5 h; keep the chat active).
- **Every Short gets an ID** before any work: `python3 tools/shorts.py new --title "..." --topic "..."` → `RS-0007`.
  Its internal name is `rs0007` (`tools/shorts.py name RS-0007`): use it for `src/stories/rs0007.js`,
  `audio/cues_rs0007.py`, `captions/props/rs0007.json`, `vo/rs0007.wav`. Keep its script, voiceover (as
  `voiceover.mp3`), word timings and cast JSONs in `shorts/RS-0007/`. Always say the ID when talking about a Short.
- **Delivery:** `tools/make_short.sh RS-0007 <duration> ...` writes one clean video, `out/RS-0007_<title>_v1.mp4`.
  Never draw the ID (or any version tag) on the video; the ID lives in the file name, the manifest and the chat only.
- **Changes:** when the user names an ID ("RS-0007: brighten the ending"), read `shorts/RS-0007/manifest.json`
  and its files, make the change, run `python3 tools/shorts.py revise RS-0007 "<what changed>"` (bumps v1→v2 and
  logs it), re-render, and deliver `..._v2`. If frames from this session still exist, delete only the changed
  shots' frames from `out/frames_<name>/` before re-running; caption/mix-only changes skip the 3D render.
  Older Shorts may use a plain name (RS-0001 = `lake`); the manifest's `name` and `files` say which.
- `SHORTS.md` (generated) lists every Short with status and version; `python3 tools/shorts.py list` prints it.

## Autopilot mode (optional)
On when the user says "autopilot" (or "don't wait for me", "hands-off"), and always in scheduled runs.
- Don't stop for approvals: pick topics yourself (avoid anything already in `SHORTS.md`; vary era, region and category
  across a batch), approve your own scripts and voiceovers, and keep going. Still ask only for things you truly can't
  get (repo access, a missing API key): if one is missing in an unattended run, stop and report exactly what's needed.
- Every quality step still runs: fact verification with sources, still-frame checks (clipping, framing, lighting,
  story match), final-video checks. Fix problems yourself; if a shot still can't be made right, simplify it.
- Write each decision you'd normally have asked about (topic choice, script, voice, anything skipped) into the
  Short's manifest notes (`python3 tools/shorts.py set RS-0007 notes="..."`) so the user can review later.
- Never publish anything publicly. Videos go to the user as files, or to YouTube only as private/scheduled
  (see AUTOMATION.md).

## Scheduled automation (optional — see AUTOMATION.md)
A daily scheduled task runs this skill on a timer; the user's own PC renders on its GPU (minutes instead of hours).
- **Scheduled runs are prepare-only:** do steps 0-6 in autopilot for N Shorts, but don't render. For each Short,
  copy its cast JSONs into `shorts/<ID>/characters/`, save `voiceover.mp3`, then
  `python3 tools/shorts.py ready <ID> <duration> key=assets/x.glb ...` (every asset the story needs, cast GLBs named
  after their JSON files) and commit + push. The PC worker (`tools/render_worker.py`) renders queued Shorts, delivers
  them to the user's folder (and optionally YouTube as private), marks them delivered and pushes.
- New sets must be committed as `blender/build_<set>.py` so the worker can build them; it runs `setup.sh`-equivalent
  builds itself. Never rely on files that only exist in the cloud session.
- Setting it up: when the user asks, walk them through AUTOMATION.md (PC worker first, test it on RS-0001), then
  create the scheduled task with the session's scheduling tools using the prompt template in AUTOMATION.md, starting at
  1 Short a day.
- Change requests on automated Shorts: revise as usual (`shorts.py revise`), then `shorts.py ready <ID> ...` again and
  push — the worker re-renders it as the new version.

## 0. No voiceover yet? Write the script first
If the user wants a new story or script rather than giving a voiceover, follow
`skills/viral-short-script.md` (bundled in this toolkit; it is also the user's `viral-short-script` skill):
pick and verify one real, little-known event and write the 45–60 s narration in that structure. Then ask the
user to approve the script, then make the voiceover (step 0b) and continue from step 2. Keep the script's
beats in mind when planning shots: its hook, escalation and reveal map onto the shot list.

## 0b. Make the voiceover (the user's house voice)
The user's voice: **Gemini 3.8 Flash TTS, voice Alnilam, style "promote"**, then polished like their Reaper edit:
**pitch +3 semitones, rate 1.25x (pitch preserved)**. `tools/voiceover.py` does all of it:
- From a script: ask the user for their Gemini API key (Google AI Studio → Get API key) if `GEMINI_API_KEY`
  isn't set, pass it only as an environment variable for the command, and never write it to a file or repeat it:
  `GEMINI_API_KEY=... python3 tools/voiceover.py --text script.txt --out vo/<name>.wav --keep-raw`
- From a raw AI Studio export: `python3 tools/voiceover.py --input raw.wav --out vo/<name>.wav`
- Defaults match the user's settings (`--voice Alnilam --rate 1.25 --pitch 3`); use `--no-preserve-pitch` only
  if the user says Reaper's "preserve pitch" was off. Always **Gemini 3.8 Flash TTS** (`gemini-3.8-flash-tts`) — never
  another TTS model or voice service; if it fails, report the error to the user instead of switching models.
- Put only the spoken words in the script file (no headings, stage directions or timestamps).
- If the user supplies a finished voiceover, use it as-is: don't polish it again.
Listen-check is the user's: send the polished voiceover before the long render so they can approve it.

## 1. Get the toolkit (every session)
1. **Find the toolkit repo.** Check memory and the conversation for which GitHub repo holds this user's
   toolkit (e.g. `owner/roblox-shorts-toolkit`). If it isn't known, **ask the user before anything else**
   (AskUserQuestion when available), because accounts differ:
   - **Use an existing repo** — they give `owner/repo`; `add_repo` it with access `push` and clone it.
   - **Create a new private repo** — run `list_repos` to learn their GitHub username, suggest
     `<username>/roblox-shorts-toolkit`, and create it with `gh repo create <name> --private` if `gh` is
     authenticated; otherwise ask them to create it empty on github.com (+ → New repository → Private, no README)
     and say when done. Then `add_repo` it (push), copy the bundled toolkit from this skill's folder into it,
     commit "Initial toolkit" and push.
   - **No GitHub** — copy the bundled toolkit from this skill's folder (it contains `setup.sh`) into the working
     directory as `roblox-shorts-toolkit/` and `git init` it; step 8 then hands back an updated zip instead.
   Once chosen, remember the repo for future sessions (save it to memory if the user agrees) and don't ask again.
   If the repo's copy and this skill's bundled copy differ, the repo wins (it has the newest library).
2. `cd roblox-shorts-toolkit && chmod +x setup.sh tools/*.sh && ./setup.sh` (idempotent: installs bpy, faster-whisper, scipy, playwright,
   three, esbuild, Remotion; builds the base cast and the town/lake/mine sets into `assets/`).
3. `export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` if that folder exists.

## 2. Understand the voiceover
- Copy the audio to `vo/<name>.wav`, then `python3 tools/transcribe.py vo/<name>.wav vo/<name>_words.json`.
- Read the transcript; note mis-hearings (e.g. "runs for sure" → "shore") for the caption `--fix` flags.
- Tell the user in a few lines what the story is and the plan (sets, cast, explainer shots, audio).

## 3. Plan shots from word timings
Make a shot list: one shot per line or clause, cut points on phrase boundaries (from the word timings),
each shot 1.3–3.5 s. For every shot decide: set, look (`day` | `mine` | `studio`), camera move, who is in it
and what they do, which props animate, which SFX cue. Open with the most dramatic image (the hook) even if
it happens later in the story. Use explainer sets for "how/why" lines (geology cutaway, an everyday analogy
like the tea-cup) and label sprites (`label()` from `sets.js`) for key numbers.

## 4. Build what the story needs
Read `CATALOG.md` first: reuse existing sets, characters, faces, explainer sets and sounds wherever the story
fits, and extend them (new props in an existing set, a new hat) before building from scratch.
- **Cast:** every character is a JSON (`characters/`) built by `python3 blender/build_character_v2.py x.json assets/x.glb`
  with skin, `face` style, `hair`, `hat`, `outfit` (shirt/pants patterns + details) and `accessories` — see CATALOG.md for
  every option. Fastest route: `python3 blender/random_character.py <seed> assets/x.glb --role <role>` (24 roles: police,
  chef, miner, astronaut, farmer...), then edit the saved JSON in `characters/random/` to fit the story (period, job, era,
  weather). Make every character in a Short visibly different (skin, hair, outfit colours), give main characters a distinct
  silhouette (hat/hair), and check them in the lineup story before animating. Characters have 20 expressions
  (smile talk blink surprised grin scared annoyed angry sad laugh confused smirk worried shout sleepy crying love dizzy cool
  wink): use them in poses (`face:`) to act out each line.
- **Sets:** reuse `town` / `lake` / `mine` when they fit; otherwise write `blender/build_<set>.py` with
  `blib.py` (look at `build_lake.py`): terrain, buildings, props. Give anything that moves a name
  (e.g. `Rig`, `Cart`, `Cage`) with its origin at the pivot. Procedural explainer sets go in `src/short/sets.js`.
- **Story:** `src/stories/<name>.js` exporting nothing, calling `run({...})` from `../short/engine.js` with
  `duration, sets, procedural, actors, shots, update`. Copy patterns from `lake.js`: `shot()` helper,
  `keyed()` keyframes, `walkCycle`/`run_` for running, `talk()` for mouths synced to word times, per-shot
  pose branches, `update()` for props and water (`uSwirl`, `uFunnel`, level, `uFlow`, flood `uReach`).

## 5. Check stills before rendering (loop until clean)
`node tools/build_short.mjs src/stories/<name>.js dist/<name>.html <name> key=assets/x.glb ...`, then
`python3 tools/record_short.py dist/<name>.html out/chk --stills <one time per shot> --q "&nocap"` and
`python3 tools/sheet.py out/chk out/chk.png`; look at the sheet. Fix and re-check:
- **Clipping:** people ≥4 apart side by side (arm span), ≥2.8 apart in single file; no one inside derricks,
  rails, pipes, walls, cages or seats; seated characters' hips sit on the seat; vehicles/boats don't overlap.
- **Framing:** subject visible and not cut off, nothing huge blocking the lens, camera outside lattices/props,
  labels not sitting on characters, no sun glare in frame.
- **Lighting/colour:** faces readable (no bloom wash), not too bright, backdrops not pure black.
- **Story match:** each shot shows what its line says.
Water bugs to know: keep the funnel above the lake bed; flood masks use `uReachOrigin/uReachDir`.

## 6. Audio and captions
- SFX + music: write `audio/cues_<name>.py` (copy `cues_lake.py`: `DURATION`, `MUSIC = dict(quiet=[...],
  build_from=..., sting_at=...)`, `cues()` placing `whoosh` on every cut plus story sounds — `clank, thud,
  splash, bubbles, rushing, drill, groan, step, bell, siren, engine, roar, plop, fizz, pop, impact`; add new
  generators to `sfxlib.py` if needed). All sound is synthesised; never use copyrighted music.
- Captions: `python3 tools/make_captions.py vo/<name>_words.json captions/props/<name>.json --name <name>
  --duration <s> --fix "wrong=right" --proper Name` (mix defaults: VO 0.88, music 0.2, SFX 0.5).

## 7. Render and deliver
- `tools/make_short.sh <name> <duration> key=assets/x.glb ...` → `out/<name>_final.mp4`. It renders two
  parallel halves (~5 s/frame each on CPU, about 1 h per minute of video), makes audio, runs Remotion and a
  limiter. It is resumable: re-run after an interruption and finished frames are skipped.
- While it renders, spot-check a few frames from `out/frames_<name>/` and keep the user posted on progress.
- Verify the final: duration, 1080x1920, 30 fps, audio present; pull frames across the timeline and check
  captions sit on the right words. Send the MP4 with `SendUserFile`, then summarise in a few lines what
  each part of the story shows and any known shortcomings.
- To change only captions or mix: edit `captions/props/<name>.json` and re-run the Remotion + limiter steps.
  To change some shots: delete those frame numbers from `out/frames_<name>/` and re-run `make_short.sh`.

## 7b. Upload details (after the first render of every Short)
Right after delivering a Short's **first** video (v1), write its upload details without being asked; revisions keep
them unless the story changes:
- **Title** (≤ 70 characters, ≤ 100 hard limit): a curiosity hook built on the story's most surprising fact, not
  a summary; one emoji at most; no clickbait the video doesn't pay off. Give 3 alternative titles too.
- **Description**: 2-3 short paragraphs telling the true story with the verified facts (date, place, names,
  numbers; same sources as the script), a respectful note if people died, and one question to drive comments.
  Then 3-5 hashtags (always #Shorts).
- **Tags**: 15-20, mixing the event's own names, the topic, "Roblox"/"Roblox animation"/"Roblox story", and
  genre tags (true story, history shorts); under 500 characters in total.
- Save them with `python3 tools/shorts.py meta <ID> shorts/<ID>/publish.json` (writes `shorts/<ID>/publish.md`;
  the PC worker uses them for YouTube uploads). Show the title, description and tags in the reply, ready to paste,
  and commit them with the Short.

## 8. Grow the library (every Short — this is how the toolkit gets better)
When the user is happy with the video, save everything reusable back to the toolkit:
1. Make new work reusable, not story-specific: sets as `blender/build_<set>.py` with named moving parts,
   characters as `characters/*.json`, new faces in `roblox_faces.py`, new sounds in `sfxlib.py`, new
   explainer sets in `sets.js`, engine/shader fixes in `src/short/`. Keep the story file, its cue sheet and
   caption props too (`src/stories/<name>.js`, `audio/cues_<name>.py`, `captions/props/<name>.json`).
2. Commit the Short's folder `shorts/<ID>/` (manifest, script, voiceover.mp3, words, cast) and its story, cues and
   caption props, plus `SHORTS.md`. Never commit renders, assets/, out/, dist/, vo/ or API keys (.gitignore covers them).
   Voiceovers stay in the repo but are left out of the skill zip (.gitattributes export-ignore).
3. Add a line per new item to `CATALOG.md`; add any hard-won lesson to the README's "Lessons" list.
4. Re-run `./setup.sh` on a clean copy if `setup.sh` or a builder changed, to be sure the library still builds.
5. Commit with a message naming the Short's ID and what was added, and push to the user's toolkit repo from step 1.
   Tell the user what was added.
6. If the repo can't be reached, build `roblox-shorts-toolkit.zip` (`git archive --prefix=roblox-shorts-toolkit/`)
   and send it, saying to re-upload it as the skill so the next session has the new pieces.