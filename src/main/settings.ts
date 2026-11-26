// App settings (plain JSON) and the Gemini key (encrypted with the OS: DPAPI on Windows).
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Settings } from '../shared/types';
import { RESEARCHED_TIMES } from './schedule';

const dir = () => app.getPath('userData');
const settingsFile = () => join(dir(), 'settings.json');
const keyFile = () => join(dir(), 'gemini.key');

type Stored = Omit<Settings, 'hasGeminiKey'>;

function defaults(): Stored {
  // reuse an existing clone (e.g. from the render worker setup), else clone into ~/OopsmithStudio
  const existing = join(homedir(), 'roblox-shorts-toolkit');
  return {
    toolkitRepo: 'clarkekoko11/roblox-shorts-toolkit',
    toolkitPath: existsSync(existing) ? existing : join(homedir(), 'OopsmithStudio', 'roblox-shorts-toolkit'),
    scriptWriterModel: 'sonnet',
    editorModel: 'sonnet',
    reviewerModel: 'sonnet',
    pythonCommand: process.platform === 'win32' ? 'python' : 'python3',
    cameraMode: 'topdown',
    autopilot: true,
    dailyTime: '09:00',
    lastDailyRun: '',
    renderReady: false,
    publisherModel: 'sonnet',
    youtubeAutoUpload: true,
    youtubeMode: 'scheduled',
    youtubeHour: 18,
    publishVia: 'youtube',
    bufferChannelId: '',
    bufferChannelName: '',
    youtubeCategory: '24',
    mediaHost: 'cloudinary',
    cloudinaryCloud: '',
    cloudinaryKey: '',
    r2Account: '',
    r2Bucket: '',
    r2KeyId: '',
    r2PublicBase: '',
    audienceTimezone: 'America/New_York',
    postingTimes: { ...RESEARCHED_TIMES },
    effort: { 'script-writer': 'high', editor: 'high', reviewer: 'medium', publisher: 'low' },
    mainTeamName: 'Team Oopsmith',
    teams: [],
  };
}

export function loadSettings(): Settings {
  let s: Stored = defaults();
  try {
    const stored = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<Stored>;
    for (const [k, v] of Object.entries(stored)) {
      // blank values (e.g. saved by an older version) fall back to the defaults
      if (typeof v === 'string' && !v.trim() && ['toolkitPath', 'toolkitRepo', 'pythonCommand', 'scriptWriterModel', 'editorModel', 'reviewerModel', 'publisherModel'].includes(k)) continue;
      (s as unknown as Record<string, unknown>)[k] = v;
    }
  } catch { /* first run */ }
  return { ...s, hasGeminiKey: existsSync(keyFile()) };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const cur = loadSettings();
  const { hasGeminiKey: _ignored, ...rest } = { ...cur, ...patch };
  mkdirSync(dir(), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(rest, null, 2));
  return loadSettings();
}

export function setGeminiKey(key: string): void {
  mkdirSync(dir(), { recursive: true });
  const k = key.trim();
  if (!k) {
    if (existsSync(keyFile())) unlinkSync(keyFile());
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer.');
  writeFileSync(keyFile(), safeStorage.encryptString(k));
}

/** Decrypted key, only for passing to a tool's environment. Never log or send to the window. */
export function getGeminiKey(): string | undefined {
  try {
    return safeStorage.decryptString(readFileSync(keyFile()));
  } catch {
    return undefined;
  }
}

export async function testGeminiKey(): Promise<{ ok: boolean; message: string }> {
  const key = getGeminiKey();
  if (!key) return { ok: false, message: 'No Gemini key saved yet.' };
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', {
      headers: { 'x-goog-api-key': key },
    });
    if (!r.ok) return { ok: false, message: `Google rejected the key (HTTP ${r.status}).` };
    const j = (await r.json()) as { models?: { name: string }[] };
    const tts = (j.models ?? []).some((m) => m.name.includes('gemini-3.8-flash-tts'));
    return {
      ok: true,
      message: tts
        ? 'Key works, and Gemini 3.8 Flash TTS is available.'
        : 'Key works, but Gemini 3.8 Flash TTS was not in the model list — voiceovers may fail.',
    };
  } catch (e) {
    return { ok: false, message: `Could not reach Google: ${(e as Error).message}` };
  }
}
