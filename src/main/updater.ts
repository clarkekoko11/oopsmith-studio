// Self-update from GitHub, two ways:
// - installed app (the .exe): electron-updater downloads the newest GitHub Release in the background;
//   "Update and restart" installs it.
// - running from a Git clone (npm start): fetch; if new commits exist, pull, re-install packages when
//   they changed, rebuild, and restart.
import { app } from 'electron';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface UpdateState {
  /** false when the app isn't a Git clone (e.g. an old zip copy) */
  available: boolean;
  behind: number;
  /** newest commit messages waiting, newest first */
  changes: string[];
  busy?: string;
  error?: string;
  current?: string;
}

const dir = () => app.getAppPath();

function run(cmd: string, args: string[], onLine?: (l: string) => void): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    let out = '';
    const p = spawn(cmd, args, {
      cwd: dir(),
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      shell: process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx'),
      windowsHide: true,
    });
    const take = (b: Buffer) => {
      const s = b.toString();
      out += s;
      for (const l of s.split(/\r?\n/)) if (l.trim()) onLine?.(l.trim());
    };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    p.on('error', (e) => res({ code: -1, out: e.message }));
    p.on('close', (code) => res({ code: code ?? -1, out }));
  });
}

export const isClone = () => !app.isPackaged && existsSync(join(dir(), '.git'));

// ---- installed app: GitHub Releases via electron-updater
type AU = typeof import('electron-updater').autoUpdater;
let au: AU | undefined;
let downloaded: { version: string; notes: string[] } | null = null;
let auError: string | undefined;
function updater(): AU {
  if (au) return au;
  au = (createRequire(import.meta.url)('electron-updater') as typeof import('electron-updater')).autoUpdater;
  au.autoDownload = true; // download quietly in the background
  au.autoInstallOnAppQuit = true; // or install the next time the app closes
  au.on('update-downloaded', (info) => {
    const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes.replace(/<[^>]+>/g, '').split('\n') : (info.releaseNotes ?? []).map((n) => n.note ?? '');
    downloaded = { version: info.version, notes: notes.map((n) => n.trim()).filter(Boolean).slice(0, 6) };
  });
  au.on('error', (e) => (auError = e.message));
  return au;
}

async function checkReleases(): Promise<UpdateState> {
  auError = undefined;
  try {
    await updater().checkForUpdates();
  } catch (e) {
    auError = (e as Error).message;
  }
  // give a small update a moment to finish downloading
  for (let i = 0; i < 20 && !downloaded && !auError; i++) await new Promise((r) => setTimeout(r, 500));
  if (downloaded) return { available: true, behind: 1, changes: [`Version ${downloaded.version}`, ...downloaded.notes], current: app.getVersion() };
  return { available: true, behind: 0, changes: [], current: app.getVersion(), error: auError ? `Could not check GitHub for updates (${auError.split('\n')[0]}).` : undefined };
}

export async function checkForUpdate(): Promise<UpdateState> {
  if (app.isPackaged) return checkReleases();
  if (!isClone()) return { available: false, behind: 0, changes: [] };
  const current = (await run('git', ['rev-parse', '--short', 'HEAD'])).out.trim();
  const f = await run('git', ['fetch', '--quiet', 'origin']);
  if (f.code !== 0) {
    return { available: true, behind: 0, changes: [], current, error: 'Could not reach GitHub to check for updates.' };
  }
  const n = await run('git', ['rev-list', '--count', 'HEAD..@{u}']);
  const behind = parseInt(n.out.trim(), 10) || 0;
  const log = behind ? await run('git', ['log', '--format=%s', '-n', '8', 'HEAD..@{u}']) : { out: '' };
  return { available: true, behind, changes: log.out.split('\n').map((s) => s.trim()).filter(Boolean), current };
}

/** Pull, install if package files changed, rebuild, restart. Progress goes to onStep. */
export async function applyUpdate(onStep: (s: string) => void): Promise<{ ok: boolean; message: string }> {
  if (app.isPackaged) {
    if (!downloaded) {
      onStep('downloading the update');
      await checkReleases();
      if (!downloaded) return { ok: false, message: auError ?? 'No update downloaded yet.' };
    }
    onStep('restarting');
    setTimeout(() => updater().quitAndInstall(true, true), 600);
    return { ok: true, message: 'Installing the update and restarting…' };
  }
  if (!isClone()) return { ok: false, message: 'This copy of the app is not a Git clone, so it cannot update itself.' };
  onStep('downloading the update');
  const before = (await run('git', ['rev-parse', 'HEAD'])).out.trim();
  const pull = await run('git', ['pull', '--ff-only']);
  if (pull.code !== 0) {
    return {
      ok: false,
      message: /local changes|overwritten/i.test(pull.out)
        ? 'Update stopped: files in the app folder were changed by hand. Undo those changes (or run "git stash" in the app folder) and try again.'
        : `Update failed: ${pull.out.trim().split('\n').pop()}`,
    };
  }
  const changed = (await run('git', ['diff', '--name-only', before, 'HEAD'])).out;
  if (/package(-lock)?\.json/.test(changed)) {
    onStep('installing new packages');
    const i = await run('npm', ['install', '--no-audit', '--no-fund']);
    if (i.code !== 0) return { ok: false, message: 'Update downloaded, but "npm install" failed. Run it in the app folder, then restart.' };
  }
  onStep('rebuilding');
  const b = await run('node', ['scripts/build.mjs']);
  if (b.code !== 0) return { ok: false, message: 'Update downloaded, but the rebuild failed. Run "npm start" in the app folder.' };
  onStep('restarting');
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 600);
  return { ok: true, message: 'Updated. Restarting…' };
}
