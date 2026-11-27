// Gets the toolkit from GitHub: clone on first run, fast-forward pull afterwards.
// Uses the Git installed on this PC, so a private repo signs in through Git Credential Manager
// (a browser window the first time) — the app never handles your GitHub password.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface GitResult { ok: boolean; message: string }

function git(args: string[], cwd?: string, onLine?: (l: string) => void): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    let out = '';
    let p;
    try {
      p = spawn('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true });
    } catch (e) {
      res({ code: -1, out: (e as Error).message });
      return;
    }
    const take = (b: Buffer) => {
      const s = b.toString();
      out += s;
      for (const l of s.split(/[\r\n]+/)) if (l.trim()) onLine?.(l.trim());
    };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    p.on('error', (e) => res({ code: -1, out: e.message }));
    p.on('close', (code) => res({ code: code ?? -1, out }));
  });
}

export const repoUrl = (repo: string) =>
  /^https?:\/\/|^git@|^file:\/\/|^[a-zA-Z]:[\\/]|^\//.test(repo) ? repo : `https://github.com/${repo.replace(/^\/+|\.git$/g, '')}.git`;

export async function gitAvailable(): Promise<boolean> {
  return (await git(['--version'])).code === 0;
}

/** Is this folder a clone of that repo? */
export async function isCloneOf(dir: string, repo: string): Promise<boolean> {
  if (!existsSync(join(dir, '.git'))) return false;
  const r = await git(['remote', 'get-url', 'origin'], dir);
  const norm = (u: string) => u.trim().toLowerCase().replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
  return r.code === 0 && norm(r.out) === norm(repoUrl(repo));
}

export async function cloneToolkit(repo: string, dest: string, progress: (l: string) => void): Promise<GitResult> {
  if (!repo.trim()) return { ok: false, message: 'Set the GitHub repo in Settings → Toolkit first.' };
  if (!dest.trim()) return { ok: false, message: 'No local folder set for the toolkit.' };
  if (!(await gitAvailable())) return { ok: false, message: 'Git is not installed. Install it from git-scm.com, then try again.' };
  if (await isCloneOf(dest, repo)) return pullToolkit(dest);
  if (existsSync(dest) && readdirSync(dest).length) {
    return { ok: false, message: `${dest} already exists and isn't a clone of ${repo}. Pick another folder or empty it.` };
  }
  mkdirSync(dirname(dest), { recursive: true });
  progress(`Cloning ${repo}…`);
  const r = await git(['clone', '--progress', repoUrl(repo), dest], undefined, progress);
  if (r.code === 0) return { ok: true, message: `Cloned ${repo}.` };
  if (/Authentication failed|could not read Username|terminal prompts disabled|Repository not found/i.test(r.out)) {
    return {
      ok: false,
      message: `GitHub didn't let Git in. Make sure Git is signed in to the account that owns ${repo} (run "git clone ${repoUrl(repo)}" once in a terminal to sign in), then try again.`,
    };
  }
  return { ok: false, message: `Clone failed: ${r.out.trim().split('\n').pop()}` };
}

/** Fast-forward to the latest commit. Skips (with a note) when you have uncommitted changes. */
export function pullToolkit(dir: string): Promise<GitResult> {
  return serial(dir, () => pullNow(dir));
}
async function pullNow(dir: string): Promise<GitResult> {
  if (!existsSync(join(dir, '.git'))) return { ok: false, message: 'The toolkit folder is not a Git clone, so it was not updated.' };
  const st = await git(['status', '--porcelain'], dir);
  if (st.code !== 0) return { ok: false, message: 'Git could not read the toolkit folder.' };
  if (st.out.trim()) return { ok: true, message: 'Toolkit has local changes, so it was not updated from GitHub.' };
  const r = await git(['pull', '--ff-only'], dir);
  if (r.code !== 0) return { ok: false, message: `Couldn't update the toolkit: ${r.out.trim().split('\n').pop()}` };
  return { ok: true, message: /Already up to date/i.test(r.out) ? 'Toolkit is up to date.' : 'Toolkit updated from GitHub.' };
}

/** One git job at a time per folder: several teams (and their agents) can share one toolkit clone. */
const queues = new Map<string, Promise<unknown>>();
function serial<T>(dir: string, job: () => Promise<T>): Promise<T> {
  const k = dir.toLowerCase();
  const next = (queues.get(k) ?? Promise.resolve()).catch(() => {}).then(job);
  queues.set(k, next);
  return next;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** An agent's git command can hold .git/index.lock for a moment: wait and try again. */
async function gitRetry(args: string[], dir: string) {
  let r = await git(args, dir);
  for (let i = 0; i < 6 && r.code !== 0 && /index\.lock|another git process/i.test(r.out); i++) {
    await sleep(1500);
    r = await git(args, dir);
  }
  return r;
}

/** Commit some paths (only those, never what someone else staged) and push. */
export function commitAndPush(dir: string, paths: string[], message: string): Promise<GitResult> {
  return serial(dir, async () => {
    const existing = paths.filter((p) => existsSync(join(dir, p)));
    if (!existing.length) return { ok: true, message: 'Nothing to save.' };
    await gitRetry(['add', '--', ...existing], dir);
    const c = await gitRetry(['-c', 'user.name=Oopsmith Studio', '-c', 'user.email=studio@localhost', 'commit', '-m', message, '--', ...existing], dir);
    if (c.code !== 0 && !/nothing to commit|no changes added/i.test(c.out)) return { ok: false, message: 'Could not commit.' };
    let p = await gitRetry(['push'], dir);
    if (p.code !== 0 && /rejected|fetch first|non-fast-forward/i.test(p.out)) {
      // someone pushed in between (another PC): catch up, then push again
      await gitRetry(['pull', '--rebase', '--autostash'], dir);
      p = await gitRetry(['push'], dir);
    }
    return p.code === 0 ? { ok: true, message: 'Saved to GitHub.' } : { ok: false, message: 'Saved locally; push to GitHub failed.' };
  });
}
