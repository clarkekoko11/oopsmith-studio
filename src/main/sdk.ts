// Loads the Claude Agent SDK and works out how to run it on this PC with the user's own Claude login.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { sep } from 'node:path';
import type * as Sdk from '@anthropic-ai/claude-agent-sdk';

const require = createRequire(import.meta.url);
let sdk: typeof Sdk | undefined;

export async function loadSdk(): Promise<typeof Sdk> {
  sdk ??= await import('@anthropic-ai/claude-agent-sdk');
  return sdk;
}

/**
 * Path of the Claude Code binary that ships with the SDK. In a packaged app it lives in
 * app.asar.unpacked (a program can't be started from inside the asar archive).
 */
export function claudeExecutable(): string | undefined {
  const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  const file = process.platform === 'win32' ? 'claude.exe' : 'claude';
  try {
    let p = require.resolve(`${pkg}/${file}`);
    p = p.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
    return existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Environment for agent processes. ANTHROPIC_API_KEY is removed so the agents always use the
 * Claude plan you signed in with (an API key would take priority and bill the API instead).
 * Extra variables (e.g. GEMINI_API_KEY for voiceovers) are added only for this process.
 */
export function agentEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'ANTHROPIC_API_KEY' || k === 'ANTHROPIC_AUTH_TOKEN') continue;
    env[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) if (v) env[k] = v;
  return env;
}

export const apiKeyInEnv = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** An input stream that stays open without sending anything until close() is called. */
export function idleInput<T>(): { stream: AsyncIterable<T>; close: () => void } {
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  return {
    stream: {
      async *[Symbol.asyncIterator]() {
        await finished;
      },
    },
    close: () => done(),
  };
}
