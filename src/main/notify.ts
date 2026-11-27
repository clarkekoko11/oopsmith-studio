// Tells you when something needs you or something good happened: a Windows notification, and (if you set an ntfy
// topic) a push to your phone through ntfy.sh — free, no account: install the ntfy app and subscribe to the topic.
import { BrowserWindow, Notification } from 'electron';
import { loadSettings } from './settings';

export type Level = 'info' | 'good' | 'urgent';

const recent = new Map<string, number>();

/** ntfy URL for a topic: a bare topic goes to ntfy.sh; a full URL (self-hosted server) is used as is. */
function ntfyUrl(topic: string): string | null {
  const t = topic.trim();
  if (!t) return null;
  if (/^https?:\/\//.test(t)) return t;
  if (!/^[\w-]{1,64}$/.test(t)) return null;
  return `https://ntfy.sh/${t}`;
}

export async function notify(title: string, body: string, level: Level = 'info', opts: { force?: boolean } = {}): Promise<{ ok: boolean; message: string }> {
  const s = loadSettings();
  // the same message within 10 minutes is sent once
  const k = `${title}|${body}`;
  const now = Date.now();
  if (!opts.force && now - (recent.get(k) ?? 0) < 10 * 60_000) return { ok: true, message: 'sent recently' };
  recent.set(k, now);
  const sent: string[] = [];
  const problems: string[] = [];
  if (s.notifyDesktop && Notification.isSupported()) {
    const n = new Notification({ title, body, silent: level === 'info', urgency: level === 'urgent' ? 'critical' : 'normal' });
    n.on('click', () => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
    });
    n.show();
    sent.push('this PC');
  }
  const url = ntfyUrl(s.ntfyTopic);
  if (s.ntfyTopic.trim() && !url) problems.push('the ntfy topic can only use letters, numbers, - and _');
  if (url) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        body,
        headers: { Title: title.replace(/[^\x20-\x7e]/g, ''), Priority: level === 'urgent' ? '4' : '3' },
      });
      if (r.ok) sent.push('your phone (ntfy)');
      else problems.push(`ntfy said HTTP ${r.status}`);
    } catch (e) {
      problems.push(`couldn't reach ntfy: ${(e as Error).message}`);
    }
  }
  if (problems.length) return { ok: false, message: `Sent to ${sent.join(' and ') || 'nowhere'}; ${problems.join('; ')}.` };
  return { ok: true, message: sent.length ? `Sent to ${sent.join(' and ')}.` : 'Notifications are off (turn on Windows notifications or add an ntfy topic).' };
}
