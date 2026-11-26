// YouTube direct for Pip: connect once (Google client file + sign-in), then upload approved Shorts from this PC
// as private, optionally with an exact go-live time (YouTube publishes it then). Never public straight away.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitCmd } from './render';

export interface YouTubeStatus {
  hasClientSecret: boolean;
  signedIn: boolean;
  /** the render worker would also upload by itself (before review) */
  workerAutoUpload: boolean;
}

export function youtubeStatus(toolkit: string): YouTubeStatus {
  let workerAutoUpload = false;
  try {
    workerAutoUpload = Boolean(JSON.parse(readFileSync(join(toolkit, 'worker.json'), 'utf8')).youtube?.enabled);
  } catch { /* no worker.json yet */ }
  return {
    hasClientSecret: existsSync(join(toolkit, 'client_secret.json')),
    signedIn: existsSync(join(toolkit, 'youtube_token.json')),
    workerAutoUpload,
  };
}

export function useClientSecret(toolkit: string, file: string) {
  copyFileSync(file, join(toolkit, 'client_secret.json')); // git-ignored in the toolkit
}

function py(python: string, cwd: string, args: string[], onLine: (l: string) => void): Promise<number> {
  const [exe, ...pre] = splitCmd(python);
  return new Promise((res) => {
    const p = spawn(exe, [...pre, ...args], { cwd, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' }, windowsHide: true });
    let buf = '';
    const take = (b: Buffer) => {
      buf += b.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) onLine(l.trim());
    };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    p.on('error', (e) => { onLine(e.message); res(-1); });
    p.on('close', (c) => { if (buf.trim()) onLine(buf.trim()); res(c ?? -1); });
  });
}

/** Installs Google's packages (once) and opens the browser to sign in to your channel. */
export async function signInYouTube(python: string, toolkit: string, log: (l: string) => void): Promise<{ ok: boolean; message: string }> {
  if (!existsSync(join(toolkit, 'client_secret.json'))) return { ok: false, message: 'Choose your client_secret.json first (step 1).' };
  log('Installing Google packages…');
  const i = await py(python, toolkit, ['-m', 'pip', 'install', '--quiet', 'google-api-python-client', 'google-auth-oauthlib'], log);
  if (i !== 0) return { ok: false, message: 'Installing the Google packages failed (see log).' };
  log('A browser window opens: sign in with the Google account that owns your channel and allow uploads.');
  const a = await py(python, toolkit, ['tools/youtube_upload.py', '--auth'], log);
  if (a !== 0 || !existsSync(join(toolkit, 'youtube_token.json'))) return { ok: false, message: 'Sign-in did not finish (see log).' };
  return { ok: true, message: 'YouTube connected.' };
}

let uploading = false;
export const uploadBusy = () => uploading;

export async function uploadShort(
  python: string,
  toolkit: string,
  helper: string,
  video: string,
  metaFile: string,
  mode: 'private' | 'scheduled',
  publishAt: string | null,
  log: (l: string) => void,
): Promise<{ ok: boolean; videoId?: string; message: string }> {
  if (uploading) return { ok: false, message: 'Another upload is running.' };
  if (!existsSync(video)) return { ok: false, message: `Video file not found: ${video}` };
  if (!existsSync(metaFile)) return { ok: false, message: 'No upload details yet (publish.json).' };
  uploading = true;
  let id: string | undefined;
  const tail: string[] = [];
  try {
    const code = await py(python, toolkit, [helper, toolkit, video, metaFile, mode, mode === 'scheduled' && publishAt ? publishAt : 'none'], (l) => {
      tail.push(l);
      if (tail.length > 12) tail.shift();
      const m = /^VIDEO_ID\s+(\S+)/.exec(l);
      if (m) id = m[1];
      log(l);
    });
    if (code === 0 && id) return { ok: true, videoId: id, message: 'Uploaded.' };
    const why = tail.reverse().find((l) => /Error|error|quota|not authori[sz]ed|invalid/i.test(l)) ?? `exit code ${code}`;
    return { ok: false, message: why.slice(0, 300) };
  } finally {
    uploading = false;
  }
}

/** After a video's go-live time: is it public now? (Catches projects whose uploads YouTube keeps private.) */
export async function youtubeVideoStatus(python: string, toolkit: string, helper: string, videoId: string): Promise<{ ok: boolean; privacy?: string; message: string }> {
  let privacy: string | undefined;
  const tail: string[] = [];
  const code = await py(python, toolkit, [helper, toolkit, videoId], (l) => {
    tail.push(l);
    const m = /^PRIVACY\s+(\S+)/.exec(l);
    if (m) privacy = m[1];
  });
  return code === 0 && privacy ? { ok: true, privacy, message: privacy } : { ok: false, message: tail.slice(-2).join(' ') || `exit ${code}` };
}
