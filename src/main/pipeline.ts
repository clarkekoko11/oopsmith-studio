// Moves Shorts between desks without you: voiced -> Editor builds -> ready_to_render -> GPU render -> delivered.
// A failed render goes back to the Editor (at most twice per Short) with the error.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentId } from '../shared/types';
import { editorFixKickoff, editorKickoff, editorRevisionKickoff, publisherKickoff, reviewerKickoff, AUTOPILOT_TAG } from './agentDefs';
import { commitAndPush } from './git';
import { uploadBusy, uploadShort, youtubeStatus } from './youtube';
import { dayKey, describeSlot, nextSlot } from './schedule';
import type { AgentManager } from './agents';
import { outputDir, renderBusy, renderShort, shortsCmd } from './render';
import { loadSettings } from './settings';

type Reg = { shorts: Record<string, { id: string; status?: string; error?: string; title?: string; file?: string; version?: number; youtube_id?: string; publish_at?: string }> };

export class Pipeline {
  private tries = new Map<string, number>(); // `${kind}:${id}` -> attempts this session
  private warnedSetup = false;
  private ticking = false;
  onChange: () => void = () => {};
  onBlocked: (message: string) => void = () => {};

  /** Shorts you pressed Upload for (when automatic upload is off) */
  private uploadNow = new Set<string>();

  constructor(private agents: AgentManager, private uploadHelper: string) {}

  requestUpload(id: string) {
    this.uploadNow.add(id);
    this.follow(id);
  }

  private registry(): Reg | null {
    try {
      return JSON.parse(readFileSync(join(loadSettings().toolkitPath, 'shorts', 'registry.json'), 'utf8')) as Reg;
    } catch {
      return null;
    }
  }

  private attempt(kind: string, id: string, max: number): boolean {
    const k = `${kind}:${id}`;
    const n = this.tries.get(k) ?? 0;
    if (n >= max) return false;
    this.tries.set(k, n + 1);
    return true;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.step();
    } finally {
      this.ticking = false;
    }
  }

  /** Shorts you asked for by hand (review screen): they move on even with Autopilot off. */
  private manual = new Set<string>();
  /** Why the pipeline is holding back, per Short, for the review screen. */
  private why = new Map<string, string>();

  follow(id: string) {
    this.manual.add(id);
    // a new request from you is a new attempt
    for (const k of [...this.tries.keys()]) if (k.includes(id)) this.tries.delete(k);
  }

  /** One line: what this Short is waiting for right now. */
  explain(id: string): string {
    const reg = this.registry();
    const m = reg?.shorts[id];
    if (!m) return '';
    const s = loadSettings();
    const st = m.status ?? '';
    const busy = (a: AgentId) => this.agents.currentWork(a);
    if (this.why.has(id)) return this.why.get(id)!;
    if (/^(uploaded|published)/.test(st)) return st === 'uploaded_scheduled' && m.publish_at ? `On YouTube, goes public ${describeSlot(Date.parse(m.publish_at), s.audienceTimezone)}.` : 'Uploaded to YouTube as private: publish it in YouTube Studio when you like.';
    if (uploadBusy() && busy('publisher') === id) return 'Uploading to YouTube…';
    if (busy('publisher') === id) return 'Pip is writing the upload details.';
    if (st === 'approved') return this.agents.isIdle('publisher') ? 'Next in line for Pip (upload details).' : `Waiting for Pip (busy with ${busy('publisher') ?? 'another Short'}).`;
    if (st === 'ready_to_publish') {
      const yt = youtubeStatus(s.toolkitPath);
      if (!yt.signedIn) return 'Waiting: connect YouTube in Settings → YouTube.';
      if (!s.youtubeAutoUpload && !this.uploadNow.has(id)) return 'Ready to upload: press Upload.';
      return 'Next in line for upload.';
    }
    if (st === 'rendering' || (renderBusy() && busy('editor')?.includes(id))) return 'Rendering on your graphics card…';
    if (busy('editor') === id) return 'Cutter is working on it now.';
    if (busy('reviewer') === id) return 'Hawk is reviewing it now.';
    const auto = s.autopilot || this.manual.has(id);
    if (!auto && /voiced|building|ready_to_render|render_failed|changes_requested|in_review|reviewing/.test(st)) {
      return 'Waiting: Autopilot is off. Turn it on, or press "Send on" here.';
    }
    if (/voiced|building|ready_to_render|render_failed|changes_requested/.test(st)) {
      if (!s.renderReady) return "Waiting: rendering isn't set up in the app yet (Settings → Rendering → Set up rendering).";
      if (!this.agents.isIdle('editor')) return `Waiting for Cutter (busy with ${busy('editor') ?? 'another job'}).`;
      return 'Next in line for Cutter.';
    }
    if (/in_review|reviewing/.test(st)) {
      if (!m.file) return 'Waiting: no rendered video recorded for this version yet.';
      return this.agents.isIdle('reviewer') ? 'Next in line for Hawk.' : `Waiting for Hawk (busy with ${busy('reviewer') ?? 'another review'}).`;
    }
    if (st === 'delivered') return 'Rendered before review existed. Approve it, or request changes to send it to Cutter.';
    return '';
  }

  private async step() {
    const s = loadSettings();
    const reg = this.registry();
    if (!reg) return;
    this.why.clear();
    const allowed = (id: string) => s.autopilot || this.manual.has(id);
    const by = (st: string) => Object.values(reg.shorts).filter((m) => m.status === st && allowed(m.id)).map((m) => m.id).sort();
    for (const id of [...this.manual]) if (/^(published|uploaded)/.test(reg.shorts[id]?.status ?? '')) this.manual.delete(id);

    // Hawk works independently of Cutter: review what's rendered (or a review that stopped part-way)
    const reviewer: AgentId = 'reviewer';
    if (this.agents.isIdle(reviewer)) {
      const toReview = [...by('in_review'), ...by('reviewing')].find((id) => reg.shorts[id].file && this.attempt('review', `${id}v${reg.shorts[id].version ?? 1}`, 2));
      if (toReview) {
        const m = reg.shorts[toReview];
        const video = join(outputDir(s.toolkitPath), m.file!);
        await this.agents.send(reviewer, reviewerKickoff(toReview, video, m.version ?? 1), `Review ${toReview} v${m.version ?? 1}`, { fresh: true, short: toReview });
      }
    }

    // Pip writes upload details for approved Shorts; then the app uploads them (private or scheduled)
    const publisher: AgentId = 'publisher';
    if (this.agents.isIdle(publisher) && !uploadBusy()) {
      const needDetails = by('approved').find((id) => this.attempt('details', id, 2));
      const ready = by('ready_to_publish').find((id) => (s.youtubeAutoUpload || this.uploadNow.has(id)) && this.attempt('upload', id, 2));
      if (ready && youtubeStatus(s.toolkitPath).signedIn) {
        void this.upload(ready);
      } else if (needDetails) {
        await this.agents.send(publisher, publisherKickoff(needDetails), `Write upload details for ${needDetails}`, { fresh: true, short: needDetails });
      }
    }

    if (renderBusy()) return;
    const editor: AgentId = 'editor';
    if (!this.agents.isIdle(editor)) return;

    const waiting = [...by('ready_to_render'), ...by('voiced'), ...by('render_failed'), ...by('building'), ...by('changes_requested')];
    if (waiting.length && !s.renderReady) {
      if (!this.warnedSetup) {
        this.warnedSetup = true;
        this.onBlocked(`${waiting[0]} is waiting for Cutter, but rendering isn't set up in the app yet. Settings → Rendering → Set up rendering (quick if your render worker is already set up).`);
      }
      return;
    }

    // 1. finish what's ready: render it
    const ready = by('ready_to_render')[0];
    if (ready && this.attempt('render', `${ready}v${reg.shorts[ready].version ?? 1}`, 3)) return void this.render(ready);
    // 2. a failed render goes back to the Editor with the error
    const failed = by('render_failed').find((id) => this.attempt('fix', `${id}v${reg.shorts[id].version ?? 1}`, 2));
    if (failed) {
      await this.agents.send(editor, editorFixKickoff(failed, reg.shorts[failed].error ?? 'unknown error'), `Render of ${failed} failed — fix it`, { fresh: true, short: failed });
      return;
    }
    // 3. changes requested (by Hawk or by you): a revision (each version gets one try)
    const changes = by('changes_requested').find((id) => this.attempt('revise', `${id}v${reg.shorts[id].version ?? 1}`, 1));
    if (changes) {
      const who = this.manual.has(changes) ? 'You' : 'Hawk';
      await this.agents.send(editor, editorRevisionKickoff(changes, who === 'You'), `${who} asked for changes on ${changes}`, { fresh: true, short: changes });
      return;
    }
    // 4. a build that stopped part-way: continue it once
    const stuck = by('building').find((id) => this.attempt('continue', id, 1));
    if (stuck) {
      await this.agents.send(editor, `${AUTOPILOT_TAG} Continue building ${stuck} where you left off (check what already exists in the repo first) and get it ready to render, without asking me anything.`, `Continue ${stuck}`, { fresh: true, short: stuck });
      return;
    }
    // 5. new work from Scripty
    const voiced = by('voiced').find((id) => this.attempt('build', id, 2));
    if (voiced) await this.agents.send(editor, editorKickoff(voiced), `Build ${voiced}`, { fresh: true, short: voiced });
  }

  async upload(id: string) {
    const s = loadSettings();
    const reg = this.registry();
    const m = reg?.shorts[id];
    const publisher: AgentId = 'publisher';
    if (!m?.file) {
      this.agents.post(publisher, { kind: 'notice', tone: 'warn', text: `${id} has no rendered video recorded, so it can't be uploaded.` });
      return;
    }
    const video = join(outputDir(s.toolkitPath), m.file);
    const meta = join(s.toolkitPath, 'shorts', id, 'publish.json');
    if (!existsSync(meta)) {
      this.agents.post(publisher, { kind: 'notice', tone: 'warn', text: `${id} has no publish.json yet; asking Pip to write it.` });
      await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, 'status=approved']);
      return;
    }
    // one Short per day: the next free day, at that weekday's best time for the audience
    let publishAt: string | null = null;
    let when = 'private';
    if (s.youtubeMode === 'scheduled') {
      const taken = new Set(
        Object.values(reg!.shorts)
          .filter((x) => x.publish_at && x.id !== id)
          .map((x) => dayKey(Date.parse(x.publish_at!), s.audienceTimezone)),
      );
      const at = nextSlot(s.audienceTimezone, s.postingTimes, taken);
      publishAt = new Date(at).toISOString();
      when = `goes public ${describeSlot(at, s.audienceTimezone)}`;
    }
    this.agents.post(publisher, { kind: 'notice', text: `Uploading ${id} to YouTube (${when})…` });
    this.agents.setExternal(publisher, `${id} · uploading`);
    this.agents.setCurrentShort(publisher, id);
    const r = await uploadShort(s.pythonCommand, s.toolkitPath, this.uploadHelper, video, meta, s.youtubeMode, publishAt, () => {});
    this.agents.setExternal(publisher, undefined);
    this.uploadNow.delete(id);
    if (r.ok && r.videoId) {
      const status = s.youtubeMode === 'scheduled' ? 'uploaded_scheduled' : 'uploaded_private';
      await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, `status=${status}`, `youtube_id=${r.videoId}`, ...(publishAt ? [`publish_at=${publishAt}`] : [])]);
      await commitAndPush(s.toolkitPath, ['shorts/registry.json', 'SHORTS.md'], `${id}: uploaded to YouTube (${s.youtubeMode})`);
      this.agents.post(publisher, {
        kind: 'agent',
        text: `**${id} is on YouTube** (${when}). Open it in YouTube Studio: https://studio.youtube.com/video/${r.videoId}/edit`,
      });
    } else {
      this.agents.post(publisher, { kind: 'notice', tone: 'error', text: `Upload of ${id} failed: ${r.message}` });
    }
    this.onChange();
    setTimeout(() => void this.tick(), 1000);
  }

  async render(id: string) {
    const s = loadSettings();
    const editor: AgentId = 'editor';
    this.agents.post(editor, { kind: 'notice', text: `Rendering ${id} on the graphics card. This can take a while; you can keep working.` });
    let lastPush = 0;
    this.agents.setExternal(editor, `rendering ${id}`);
    const r = await renderShort(s.pythonCommand, s.toolkitPath, id, (activity) => {
      const now = Date.now();
      if (now - lastPush > 1500) {
        lastPush = now;
        this.agents.setExternal(editor, `${id} · ${activity}`);
      }
    });
    this.agents.setExternal(editor, undefined);
    if (r.ok) {
      this.agents.post(editor, { kind: 'notice', text: `${id} is rendered and goes to Hawk for review.` });
      if (r.file) this.agents.post(editor, { kind: 'media', path: r.file, source: 'video' });
      await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, 'status=in_review']);
    } else {
      this.agents.post(editor, { kind: 'notice', tone: 'error', text: `Render of ${id} failed: ${r.message}` });
    }
    this.onChange();
    setTimeout(() => void this.tick(), 1000);
  }
}
