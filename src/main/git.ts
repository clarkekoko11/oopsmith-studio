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
export async function pullToolkit(dir: string): Promise<GitResult> {
  if (!existsSync(join(dir, '.git'))) return { ok: false, message: 'The toolkit folder is not a Git clone, so it was not updated.' };
  const st = await git(['status', '--porcelain'], dir);
  if (st.code !== 0) return { ok: false, message: 'Git could not read the toolkit folder.' };
  if (st.out.trim()) return { ok: true, message: 'Toolkit has local changes, so it was not updated from GitHub.' };
  const r = await git(['pull', '--ff-only'], dir);
  if (r.code !== 0) return { ok: false, message: `Couldn't update the toolkit: ${r.out.trim().split('\n').pop()}` };
  return { ok: true, message: /Already up to date/i.test(r.out) ? 'Toolkit is up to date.' : 'Toolkit updated from GitHub.' };
}
