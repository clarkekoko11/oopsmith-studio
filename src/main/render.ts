// Runs the toolkit's own PC render worker (tools/render_worker.py) for the app:
// one-time setup, and rendering one Short at a time on the graphics card.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface JobResult { ok: boolean; message: string; file?: string }
type Progress = (activity: string, line: string) => void;

let current: ChildProcess | undefined;
export const renderBusy = () => Boolean(current);

/** "py -3.11" -> ["py", "-3.11"]; a quoted path stays one piece. */
export function splitCmd(cmd: string): string[] {
  return (cmd.match(/"[^"]+"|\S+/g) ?? ['python']).map((t) => t.replace(/^"|"$/g, ''));
}

function runPython(python: string, cwd: string, args: string[], onLine: (l: string) => void, track = true): Promise<number> {
  const [exe, ...pre] = splitCmd(python);
  return new Promise((res) => {
    let p: ChildProcess;
    try {
      p = spawn(exe, [...pre, ...args], {
        cwd,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
        windowsHide: true,
      });
    } catch (e) {
      onLine(`could not start ${python}: ${(e as Error).message}`);
      res(-1);
      return;
    }
    if (track) current = p;
    let buf = '';
    const take = (b: Buffer) => {
      buf += b.toString();
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) onLine(l.trim());
    };
    p.stdout?.on('data', take);
    p.stderr?.on('data', take);
    p.on('error', (e) => { onLine(`could not start ${python}: ${e.message}`); });
    p.on('close', (code) => {
      if (buf.trim()) onLine(buf.trim());
      if (track) current = undefined;
      res(code ?? -1);
    });
  });
}

/** Folder where the worker puts finished videos (worker.json "output_dir"). */
export function outputDir(toolkit: string): string {
  let dir = join('~', 'Videos', 'RobloxShorts');
  try {
    const cfg = JSON.parse(readFileSync(join(toolkit, 'worker.json'), 'utf8')) as { output_dir?: string };
    if (cfg.output_dir) dir = cfg.output_dir;
  } catch { /* defaults */ }
  return dir.replace(/^~(?=$|[\\/])/, homedir());
}

/** What the worker is doing, in plain words, from its log line. */
function stage(line: string, last: string): string {
  if (/build_short\.mjs/.test(line)) return 'building the scene';
  if (/render_frames\.py/.test(line)) return 'rendering frames';
  if (/make_audio\.py/.test(line)) return 'making sound + music';
  if (/remotion/.test(line)) return 'adding captions';
  if (/alimiter|ffmpeg.*\.mp4/.test(line)) return 'finishing the video';
  if (/build_character|blender[\\/]build_/.test(line)) return 'building 3D assets';
  return last;
}

/** Run a command quietly and collect its output. */
async function capture(python: string, cwd: string, args: string[]): Promise<{ code: number; out: string }> {
  let out = '';
  const code = await runPython(python, cwd, args, (l) => (out += l + '\n'), false);
  return { code, out };
}

function hasTool(tool: string): Promise<boolean> {
  return new Promise((res) => {
    const p = spawn(process.platform === 'win32' ? 'where' : 'which', [tool], { windowsHide: true });
    p.on('error', () => res(false));
    p.on('close', (c) => res(c === 0));
  });
}

/**
 * Blender-for-Python (bpy) only installs on one Python version (3.13 for Blender 5.x, 3.11 for 4.x LTS).
 * Returns a Python command that can install it, trying the Windows "py" launcher's 3.13 / 3.11 when the
 * configured one can't. null + message when none works.
 */
export async function findPythonForBpy(python: string, cwd: string, log: (l: string) => void): Promise<{ python: string | null; message: string }> {
  const candidates = [python, ...(process.platform === 'win32' ? ['py -3.13', 'py -3.11'] : ['python3.13', 'python3.11'])].filter((c, i, a) => a.indexOf(c) === i);
  let firstVersion = '';
  for (const py of candidates) {
    const v = await capture(py, cwd, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])']);
    if (v.code !== 0) { log(`${py}: not found`); continue; }
    const ver = v.out.trim().split('\n').pop()!;
    firstVersion ||= ver;
    const idx = await capture(py, cwd, ['-m', 'pip', 'index', 'versions', 'bpy']);
    const ok = idx.code === 0 && /bpy \(\d/.test(idx.out);
    log(`${py}: Python ${ver} — Blender for Python ${ok ? 'available' : 'not available for this version'}`);
    if (ok) return { python: py, message: `Using ${py} (Python ${ver}).` };
  }
  return {
    python: null,
    message: `Blender for Python (bpy) only installs on one Python version — today that's Python 3.13 — and ${firstVersion ? `this PC's Python is ${firstVersion}` : 'no working Python was found'}. Install Python 3.13 from python.org (keep "py launcher" ticked), then press Set up rendering again — the app finds it by itself.`,
  };
}

export async function setupRendering(pythonCmd: string, toolkit: string, progress: Progress, usePython: (py: string) => void): Promise<JobResult> {
  if (current) return { ok: false, message: 'Something is already running.' };
  progress('checking this PC', 'Checking Git, ffmpeg, Node and Python…');
  const missing: string[] = [];
  for (const t of ['git', 'ffmpeg', 'node', 'npm']) if (!(await hasTool(t))) missing.push(t);
  if (missing.length) {
    return { ok: false, message: `Not installed or not on PATH: ${missing.join(', ')}. Install ${missing.join(' and ')} (see AUTOMATION.md in the toolkit), restart the app, and run setup again.` };
  }
  const found = await findPythonForBpy(pythonCmd, toolkit, (l) => progress('checking Python', l));
  if (!found.python) return { ok: false, message: found.message };
  const python = found.python;
  if (python !== pythonCmd) {
    usePython(python);
    progress('checking Python', `Switched the Python command to "${python}" (Blender for Python needs it).`);
  }
  let last = 'installing tools';
  progress(last, 'Setting up rendering…');
  const code = await runPython(python, toolkit, ['tools/render_worker.py', '--setup'], (l) => {
    if (/pip install/.test(l)) last = 'installing Python packages';
    else if (/playwright/.test(l)) last = 'installing the browser renderer';
    else if (/npm install/.test(l)) last = 'installing Node packages';
    else last = stage(l, last);
    progress(last, l);
  });
  if (code !== 0) return { ok: false, message: 'Setup failed. The log below shows where; fix that and run setup again (finished parts are skipped).' };
  // the Editor also transcribes voiceovers (word timings for shots and captions)
  progress('installing speech-to-text', 'Installing faster-whisper…');
  const c2 = await runPython(python, toolkit, ['-m', 'pip', 'install', '--quiet', 'faster-whisper'], (l) => progress('installing speech-to-text', l));
  if (c2 !== 0) return { ok: false, message: 'Installing faster-whisper failed.' };
  return { ok: true, message: 'Rendering is set up.' };
}

export async function renderShort(python: string, toolkit: string, id: string, progress: Progress): Promise<JobResult> {
  if (current) return { ok: false, message: 'A render is already running.' };
  if (!existsSync(join(toolkit, 'tools', 'render_worker.py'))) return { ok: false, message: 'tools/render_worker.py is missing from the toolkit.' };
  let last = 'starting';
  progress(last, `Rendering ${id} on the graphics card…`);
  const tail: string[] = [];
  const code = await runPython(python, toolkit, ['tools/render_worker.py', '--only', id], (l) => {
    tail.push(l);
    if (tail.length > 30) tail.shift();
    last = stage(l, last);
    const frames = /frame[s]?\D{0,3}(\d+)\s*\/\s*(\d+)/i.exec(l) ?? /(\d+)\s*\/\s*(\d+)\s*frames/i.exec(l);
    const act = frames && last === 'rendering frames' ? `rendering frames ${Math.round((100 * +frames[1]) / +frames[2])}%` : last;
    progress(act, l);
  });
  // the worker records the result in the registry
  try {
    const reg = JSON.parse(readFileSync(join(toolkit, 'shorts', 'registry.json'), 'utf8')) as {
      shorts: Record<string, { status?: string; file?: string; error?: string }>;
    };
    const m = reg.shorts[id];
    if (m && /^(delivered|uploaded)/.test(m.status ?? '')) {
      return { ok: true, message: `${id} is rendered.`, file: m.file ? join(outputDir(toolkit), m.file) : undefined };
    }
    if (m?.status === 'render_failed') return { ok: false, message: m.error || 'render failed (see worker.log)' };
  } catch { /* fall through */ }
  const reason = tail.reverse().find((l) => /FAILED|Error|error|failed/.test(l)) ?? `worker exited with code ${code}`;
  return { ok: false, message: reason.slice(0, 300) };
}

export function stopJob() {
  current?.kill();
}

/** Run tools/shorts.py with arguments (e.g. set RS-0003 status=in_review). */
export async function shortsCmd(python: string, toolkit: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  const r = await capture(python, toolkit, ['tools/shorts.py', ...args]);
  return { ok: r.code === 0, out: r.out };
}

/**
 * Is this PC already able to build and render (e.g. set up earlier by the render worker)?
 * Returns the Python command that has Blender-for-Python + Playwright, or null.
 */
export async function detectRenderReady(python: string, toolkit: string): Promise<string | null> {
  if (!existsSync(join(toolkit, 'node_modules'))) return null;
  const candidates = [python, ...(process.platform === 'win32' ? ['py -3.13', 'py -3.11'] : ['python3.13', 'python3.11'])].filter((c, i, a) => a.indexOf(c) === i);
  for (const py of candidates) {
    const r = await capture(py, toolkit, ['-c', 'import bpy, playwright, scipy; print("ok")']);
    if (r.code === 0 && /\bok\b/.test(r.out)) return py;
  }
  return null;
}
