// Small encrypted key store (Windows: DPAPI via Electron safeStorage) for API keys the app needs.
// Values are only read in the main process and handed to a request or tool when it runs.
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type SecretName = 'buffer' | 'cloudinarySecret' | 'r2Secret';
const file = () => join(app.getPath('userData'), 'secrets.bin');

function readAll(): Record<string, string> {
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(file())));
  } catch {
    return {};
  }
}

export function getSecret(name: SecretName): string | undefined {
  return readAll()[name] || undefined;
}

export function hasSecret(name: SecretName): boolean {
  return existsSync(file()) && Boolean(readAll()[name]);
}

export function setSecret(name: SecretName, value: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer.');
  const all = readAll();
  if (value.trim()) all[name] = value.trim();
  else delete all[name];
  writeFileSync(file(), safeStorage.encryptString(JSON.stringify(all)));
}
