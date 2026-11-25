// Which tool calls an agent may make on its own, and which ones the app asks you about first.
import { isAbsolute, relative, resolve } from 'node:path';

export type Decision = { kind: 'allow' } | { kind: 'ask'; why: string } | { kind: 'deny'; why: string };

const READ_ONLY = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'ToolSearch']);
const FILE_WRITERS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// One command (no && ; |) that the Script Writer may run without asking.
const SAFE_COMMANDS: RegExp[] = [
  /^(python3?|py)\s+tools[\\/](shorts|voiceover|transcribe)\.py(\s|$)/,
  /^ffmpeg\s/,
  /^ffprobe\s/,
  /^git\s+(status|diff|log|show|add|commit)(\s|$)/,
  /^(ls|dir|pwd|cat|type|head|tail|wc|mkdir)(\s|$)/,
];

const NEVER: [RegExp, string][] = [
  [/GEMINI_API_KEY|ANTHROPIC_API_KEY/, 'Commands may not read or print API keys.'],
  [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|\brmdir\s+\/s|\bdel\s+\/[sq]|Remove-Item\b.*-Recurse/i, 'Recursive deletes are blocked.'],
  [/git\s+push\b.*(--force|-f\b)/, 'Force-pushing is blocked.'],
  [/\b(curl|wget|Invoke-WebRequest)\b.*\|\s*(sh|bash|powershell|iex)/i, 'Running downloaded scripts is blocked.'],
];

export function inside(root: string, p: string): boolean {
  if (!root) return false;
  const full = isAbsolute(p) ? p : resolve(root, p);
  const rel = relative(resolve(root), full);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function decide(tool: string, input: Record<string, unknown>, root: string): Decision {
  if (READ_ONLY.has(tool)) return { kind: 'allow' };

  if (FILE_WRITERS.has(tool)) {
    const p = String(input.file_path ?? input.notebook_path ?? '');
    if (p && inside(root, p)) return { kind: 'allow' };
    return { kind: 'ask', why: `Write to a file outside the toolkit folder: ${p}` };
  }

  if (tool === 'Bash') {
    const cmd = String(input.command ?? '').trim();
    for (const [re, why] of NEVER) if (re.test(cmd)) return { kind: 'deny', why };
    const parts = cmd.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
    const ok = parts.length > 0 && parts.every((part) => SAFE_COMMANDS.some((re) => re.test(part)));
    if (ok && !/[`$]\(|`/.test(cmd) && !/\.\.[\\/]/.test(cmd)) return { kind: 'allow' };
    return { kind: 'ask', why: `Run a command: ${cmd}` };
  }

  return { kind: 'ask', why: `Use the ${tool} tool` };
}

/** One readable line for the chat, e.g. "Searching the web: Gimli Glider 1983". */
export function describeTool(tool: string, input: Record<string, unknown>, root: string): string {
  const short = (s: unknown, n = 90) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  };
  const rel = (p: unknown) => {
    const s = String(p ?? '');
    return root && inside(root, s) ? relative(root, resolve(root, s)) || '.' : s;
  };
  switch (tool) {
    case 'WebSearch': return `Searching the web: ${short(input.query)}`;
    case 'WebFetch': return `Reading ${short(input.url, 70)}`;
    case 'Read': return `Reading ${rel(input.file_path)}`;
    case 'Write': return `Writing ${rel(input.file_path)}`;
    case 'Edit': case 'MultiEdit': return `Editing ${rel(input.file_path)}`;
    case 'Glob': return `Looking for files: ${short(input.pattern)}`;
    case 'Grep': return `Searching files for: ${short(input.pattern)}`;
    case 'Bash': return `Running: ${short(input.command)}`;
    case 'TodoWrite': return 'Updating its to-do list';
    default: return `Using ${tool}`;
  }
}
