// Which tool calls an agent may make on its own, and which ones the app asks you about first.
import { isAbsolute, relative, resolve } from 'node:path';

export type Decision = { kind: 'allow' } | { kind: 'ask'; why: string } | { kind: 'deny'; why: string };

const READ_ONLY = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'ToolSearch']);
const FILE_WRITERS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// One command (after splitting on && ; |) that agents may run without asking.
const PY = String.raw`(?:"?[\w:./\\ -]*?(?:python(?:3(?:\.\d+)?)?|py)(?:\.exe)?"?)(?:\s+-(?:[uBIEsSO]+|X\s*\S+|3(?:\.\d+)?))*`;
const TOOL = String.raw`(?:\.[\\/])?tools[\\/](?:shorts|voiceover|transcribe|make_captions|sheet)\.py`;
const SAFE_COMMANDS: RegExp[] = [
  new RegExp(String.raw`^${PY}\s+${TOOL}(\s|$)`, 'i'),
  /^ffmpeg(\.exe)?\s/i,
  /^ffprobe(\.exe)?\s/i,
  /^git\s+(status|diff|log|show|add|commit|pull)(\s|$)/,
  /^git\s+push(\s+origin(\s+[\w./-]+)?)?$/, // plain push to your toolkit repo only
  /^(ls|dir|pwd|cat|type|head|tail|wc|mkdir|echo)(\s|$)/,
  /^(Get-Content|Get-ChildItem|Get-Location|Test-Path|Select-Object|Out-String|Write-Output|Write-Host)(\s|$)/i,
  /^New-Item\s+(-ItemType\s+Directory|-Type\s+Directory)/i,
];

/** Split a shell line on && || ; | — but not inside quotes. */
export function splitCommand(cmd: string): string[] {
  const parts: string[] = [];
  let cur = '', q: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { if (c === q && cmd[i - 1] !== '\\') q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    const two = cmd.slice(i, i + 2);
    if (two === '&&' || two === '||') { parts.push(cur); cur = ''; i++; continue; }
    if (c === ';' || (c === '|' && cmd[i + 1] !== '|')) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim().replace(/(\s+(\d|\*)?>&\d|\s+(\d|\*)?>\s*(\/dev\/null|\$null|nul))+$/i, '').trim()).filter(Boolean);
}

/** Text outside quotes (to look for command substitution that would really run). */
function unquotedAndDouble(cmd: string): string {
  // single-quoted text is literal in bash; double-quoted text still runs $( ) and backticks
  return cmd.replace(/'[^']*'/g, "''");
}

const NEVER: [RegExp, string][] = [
  [/GEMINI_API_KEY|ANTHROPIC_API_KEY|Env:|Get-ChildItem\s+env|\bprintenv\b|^\s*(env|set)\s*$/i, 'Commands may not read or print API keys.'],
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

  // On Windows, Claude Code may run commands with its PowerShell tool instead of Bash: same rules.
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(input.command ?? '').trim();
    for (const [re, why] of NEVER) if (re.test(cmd)) return { kind: 'deny', why };
    const parts = splitCommand(cmd).filter((part) => {
      // "cd <toolkit or a folder inside it>" is harmless: drop it before checking the rest
      const m = part.match(/^(?:cd|Set-Location|sl|pushd)\s+(?:\/d\s+|-Path\s+|-LiteralPath\s+)?["']?(.+?)["']?$/i);
      return !(m && inside(root, m[1]));
    });
    const subst = /\$\(|`/.test(unquotedAndDouble(cmd));
    // harmless environment prefixes, e.g. PYTHONIOENCODING=utf-8 python tools/…
    // also PowerShell's call operator: & python …  /  & "C:\…\python.exe" …
    const bare = (p: string) => p.replace(/^&\s+/, '').replace(/^(?:(?:PYTHONIOENCODING|PYTHONUTF8)=\S+\s+)+/, '');
    const ok = parts.length > 0 && parts.every((part) => SAFE_COMMANDS.some((re) => re.test(bare(part))));
    if (ok && !subst) return { kind: 'allow' };
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
    case 'Bash': case 'PowerShell': return `Running: ${short(input.command)}`;
    case 'TodoWrite': return 'Updating its to-do list';
    default: return `Using ${tool}`;
  }
}
