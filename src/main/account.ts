// Checks which Claude account the agents will use, without sending a prompt (costs no usage).
import { homedir } from 'node:os';
import type { AccountState } from '../shared/types';
import { agentEnv, apiKeyInEnv, claudeExecutable, idleInput, loadSdk } from './sdk';

export async function checkAccount(): Promise<AccountState> {
  const base: AccountState = { checked: true, signedIn: false, apiKeyInEnv: apiKeyInEnv() };
  try {
    const { query } = await loadSdk();
    const input = idleInput<never>();
    const q = query({
      prompt: input.stream,
      options: {
        cwd: homedir(),
        env: agentEnv(),
        pathToClaudeCodeExecutable: claudeExecutable(),
        settingSources: [],
        persistSession: false,
      },
    });
    try {
      const info = await Promise.race([
        q.accountInfo(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Timed out talking to Claude Code')), 45000)),
      ]);
      const signedIn = Boolean(info.email || info.subscriptionType || (info.apiKeySource && info.apiKeySource !== 'none'));
      return {
        ...base,
        signedIn,
        email: info.email,
        plan: info.subscriptionType,
        source: info.tokenSource ?? info.apiKeySource,
      };
    } finally {
      input.close();
      q.close();
    }
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}
