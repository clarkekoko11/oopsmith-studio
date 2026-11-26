// Moves Shorts between desks without you: voiced -> Editor builds -> ready_to_render -> GPU render -> delivered.
// A failed render goes back to the Editor (at most twice per Short) with the error.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentId } from '../shared/types';
import { editorFixKickoff, editorKickoff, editorRevisionKickoff, publisherKickoff, reviewerKickoff, AUTOPILOT_TAG } from './agentDefs';
import { commitAndPush } from './git';
import { createShortPost, postStatus } from './buffer';
import { checkPublic, hostVideo } from './media';
import { getSecret } from './secrets';
import { uploadBusy, uploadShort, youtubeStatus, youtubeVideoStatus } from './youtube';
import { dayKey, describeSlot, nextSlot } from './schedule';
import type { AgentManager } from './agents';
import { outputDir, renderBusy, renderShort, shortsCmd } from './render';
import { loadSettings } from './settings';

type Reg = { shorts: Record<string, { id: string; status?: string; error?: string; title?: string; file?: string; version?: number; publish_at?: string; buffer_post_id?: string; media_url?: string; youtube_id?: string }> };

/** Statuses that take a day in the one-Short-a-day schedule. */
const TAKES_A_DAY = /^(queued_buffer|uploaded_scheduled|published|published_manual)$/;

let publishing = false;
const publishBusy = () => publishing || uploadBusy();

export class Pipeline {
  private tries = new Map<string, number>(); // `${kind}:${id}` -> attempts this session
  private warnedSetup = false;
  private ticking = false;
  onChange: () => void = () => {};
  onBlocked: (message: string) => void = () => {};

  /** Shorts you pressed Upload for (when automatic upload is off) */
  private uploadNow = new Set<string>();

  /** when each Buffer post was last checked (to stay well inside Buffer's API limits) */
  private lastPoll = new Map<string, number>();

  constructor(private agents: AgentManager, private helpers: { upload: string; status: string }) {}

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
    const when = m.publish_at ? describeSlot(Date.parse(m.publish_at), s.audienceTimezone) : '';
    if (st === 'published') return `Published on YouTube${when ? ` (${when})` : ''}.`;
    if (st === 'published_manual') return `You posted this yourself${when ? ` (${when})` : ''}. That day counts as this Short's day in the schedule.`;
    if (st === 'uploaded_scheduled') return `On YouTube as private; YouTube makes it public ${when}.`;
    if (st === 'uploaded_private') return 'On YouTube as private: publish it in YouTube Studio when you like.';
    if (st === 'queued_buffer') return `Scheduled in Buffer: goes live ${when}.`;
    if (st === 'draft_in_buffer') return 'Saved as a draft in Buffer: schedule it there when you like.';
    if (st === 'publish_failed') return `Publishing failed: ${m.error ?? 'unknown error'}. Press "Try again" on the review screen.`;
    if (publishBusy() && busy('publisher') === id) return s.publishVia === 'buffer' ? 'Putting the video online and scheduling it in Buffer…' : 'Uploading to YouTube…';
    if (busy('publisher') === id) return 'Pip is writing the upload details.';
    if (st === 'approved') return this.agents.isIdle('publisher') ? 'Next in line for Pip (upload details).' : `Waiting for Pip (busy with ${busy('publisher') ?? 'another Short'}).`;
    if (st === 'ready_to_publish') {
      const missing = publishSetupMissing(s);
      if (missing) return `Waiting: ${missing}`;
      if (s.publishVia === 'manual') return 'Ready for you to post (details below). Then press "I posted it myself".';
      if (!s.youtubeAutoUpload && !this.uploadNow.has(id)) return 'Ready: press "Publish now".';
      return s.publishVia === 'buffer' ? 'Next in line to schedule in Buffer.' : 'Next in line to upload to YouTube.';
    }
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
    for (const id of [...this.manual]) if (/^(published|published_manual|queued_buffer|draft_in_buffer|uploaded_scheduled|uploaded_private)$/.test(reg.shorts[id]?.status ?? '')) this.manual.delete(id);

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

    // Pip writes upload details for approved Shorts; then the app hosts the video and schedules it in Buffer
    const publisher: AgentId = 'publisher';
    if (this.agents.isIdle(publisher) && !publishBusy()) {
      const needDetails = by('approved').find((id) => this.attempt('details', id, 2));
      const retry = Object.values(reg.shorts).filter((m) => m.status === 'publish_failed' && this.manual.has(m.id)).map((m) => m.id);
      const ready = [...by('ready_to_publish'), ...retry].find((id) => (s.youtubeAutoUpload || this.uploadNow.has(id) || this.manual.has(id)) && this.attempt('publish', `${id}v${reg.shorts[id].version ?? 1}`, 2));
      if (ready && s.publishVia !== 'manual' && !publishSetupMissing(s)) {
        void (s.publishVia === 'buffer' ? this.publish(ready) : this.uploadYouTube(ready));
      } else if (needDetails) {
        await this.agents.send(publisher, publisherKickoff(needDetails), `Write upload details for ${needDetails}`, { fresh: true, short: needDetails });
      }
    }
    void this.pollBuffer(reg);
    void this.pollYouTube(reg);

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

  /** Put the video online, then create the Buffer post (one per day at the best time, or a draft). */
  async publish(id: string) {
    const s = loadSettings();
    const reg = this.registry();
    const m = reg?.shorts[id];
    const publisher: AgentId = 'publisher';
    if (!m?.file) {
      this.agents.post(publisher, { kind: 'notice', tone: 'warn', text: `${id} has no rendered video recorded, so it can't be posted.` });
      return;
    }
    const video = join(outputDir(s.toolkitPath), m.file);
    const metaFile = join(s.toolkitPath, 'shorts', id, 'publish.json');
    if (!existsSync(metaFile)) {
      this.agents.post(publisher, { kind: 'notice', tone: 'warn', text: `${id} has no publish.json yet; asking Pip to write it.` });
      await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, 'status=approved']);
      return;
    }
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { title: string; description?: string };
    // one Short per day: the next free day, at that weekday's best time for the audience
    let dueAt: string | null = null;
    let when = 'as a draft in Buffer';
    if (s.youtubeMode === 'scheduled') {
      const taken = new Set(
        Object.values(reg!.shorts)
          .filter((x) => x.publish_at && x.id !== id && TAKES_A_DAY.test(x.status ?? ''))
          .map((x) => dayKey(Date.parse(x.publish_at!), s.audienceTimezone)),
      );
      const at = nextSlot(s.audienceTimezone, s.postingTimes, taken);
      dueAt = new Date(at).toISOString();
      when = `to go live ${describeSlot(at, s.audienceTimezone)}`;
    }
    publishing = true;
    this.agents.setCurrentShort(publisher, id);
    this.agents.setExternal(publisher, `${id} · uploading video`);
    this.uploadNow.delete(id);
    try {
      const secret = getSecret(s.mediaHost === 'r2' ? 'r2Secret' : 'cloudinarySecret') ?? '';
      const url = await hostVideo(s, secret, video, `oopsmith/${id}_v${m.version ?? 1}.mp4`);
      if (!(await checkPublic(url))) throw new Error(`The video isn't publicly reachable at ${url}. Buffer needs a public link: check the host's public access settings.`);
      this.agents.setExternal(publisher, `${id} · scheduling in Buffer`);
      const description = `${meta.description ?? ''}`.trim();
      const postId = await createShortPost(getSecret('buffer')!, { channelId: s.bufferChannelId, videoUrl: url, title: meta.title, description, dueAt, categoryId: s.youtubeCategory });
      const status = dueAt ? 'queued_buffer' : 'draft_in_buffer';
      await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, `status=${status}`, `buffer_post_id=${postId}`, `media_url=${url}`, ...(dueAt ? [`publish_at=${dueAt}`] : []), 'error=']);
      await commitAndPush(s.toolkitPath, ['shorts/registry.json', 'SHORTS.md'], `${id}: scheduled in Buffer`);
      this.agents.post(publisher, { kind: 'agent', text: `**${id} is in Buffer** ${when}. See it at https://publish.buffer.com` });
    } catch (e) {
      const msg = (e as Error).message;
      await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, 'status=publish_failed', `error=${msg.slice(0, 300)}`]);
      this.agents.post(publisher, { kind: 'notice', tone: 'error', text: `Couldn't schedule ${id} in Buffer: ${msg}` });
    } finally {
      publishing = false;
      this.agents.setExternal(publisher, undefined);
    }
    this.onChange();
    setTimeout(() => void this.tick(), 1000);
  }

  /** YouTube direct: upload from this PC as private, with the day's go-live time when scheduling. */
  async uploadYouTube(id: string) {
    const s = loadSettings();
    const reg = this.registry();
    const m = reg?.shorts[id];
    const publisher: AgentId = 'publisher';
    if (!m?.file) {
      this.agents.post(publisher, { kind: 'notice', tone: 'warn', text: `${id} has no rendered video recorded, so it can't be uploaded.` });
      return;
    }
    const video = join(outputDir(s.toolkitPath), m.file);
    const metaFile = join(s.toolkitPath, 'shorts', id, 'publish.json');
    if (!existsSync(metaFile)) {
      await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, 'status=approved']);
      return;
    }
    let publishAt: string | null = null;
    let when = 'as private';
    if (s.youtubeMode === 'scheduled') {
      const taken = new Set(
        Object.values(reg!.shorts)
          .filter((x) => x.publish_at && x.id !== id && TAKES_A_DAY.test(x.status ?? ''))
          .map((x) => dayKey(Date.parse(x.publish_at!), s.audienceTimezone)),
      );
      const at = nextSlot(s.audienceTimezone, s.postingTimes, taken);
      publishAt = new Date(at).toISOString();
      when = `to go public ${describeSlot(at, s.audienceTimezone)}`;
    }
    this.agents.setCurrentShort(publisher, id);
    this.agents.setExternal(publisher, `${id} · uploading to YouTube`);
    this.uploadNow.delete(id);
    const r = await uploadShort(s.pythonCommand, s.toolkitPath, this.helpers.upload, video, metaFile, s.youtubeMode, publishAt, () => {});
    this.agents.setExternal(publisher, undefined);
    if (r.ok && r.videoId) {
      const status = publishAt ? 'uploaded_scheduled' : 'uploaded_private';
      await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, `status=${status}`, `youtube_id=${r.videoId}`, ...(publishAt ? [`publish_at=${publishAt}`] : []), 'error=']);
      await commitAndPush(s.toolkitPath, ['shorts/registry.json', 'SHORTS.md'], `${id}: uploaded to YouTube`);
      this.agents.post(publisher, { kind: 'agent', text: `**${id} is on YouTube** ${when}. Open it in YouTube Studio: https://studio.youtube.com/video/${r.videoId}/edit` });
    } else {
      await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, 'status=publish_failed', `error=${r.message.slice(0, 300)}`]);
      this.agents.post(publisher, { kind: 'notice', tone: 'error', text: `Upload of ${id} failed: ${r.message}` });
    }
    this.onChange();
    setTimeout(() => void this.tick(), 1000);
  }

  /** After a scheduled YouTube video's go-live time: check that YouTube really made it public. */
  private async pollYouTube(reg: Reg) {
    const s = loadSettings();
    if (!youtubeStatus(s.toolkitPath).signedIn) return;
    const now = Date.now();
    for (const m of Object.values(reg.shorts)) {
      if (m.status !== 'uploaded_scheduled' || !m.youtube_id || !m.publish_at) continue;
      if (Date.parse(m.publish_at) > now - 10 * 60_000) continue;
      if (now - (this.lastPoll.get(m.id) ?? 0) < 30 * 60_000) continue;
      this.lastPoll.set(m.id, now);
      const st = await youtubeVideoStatus(s.pythonCommand, s.toolkitPath, this.helpers.status, m.youtube_id);
      if (!st.ok) continue;
      if (st.privacy === 'public') {
        await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', m.id, 'status=published', `published_at=${m.publish_at}`]);
        await commitAndPush(s.toolkitPath, ['shorts/registry.json', 'SHORTS.md'], `${m.id}: published`);
        this.agents.post('publisher', { kind: 'notice', text: `${m.id} went public on YouTube.` });
      } else {
        const msg = `still ${st.privacy} after its go-live time. YouTube may be keeping uploads from your (unverified) Google Cloud project private. Publish it in YouTube Studio, then press "I posted it myself" — or switch Publish via to Buffer.`;
        await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', m.id, 'status=publish_failed', `error=${msg.slice(0, 300)}`]);
        this.agents.post('publisher', { kind: 'notice', tone: 'error', text: `${m.id} is ${msg} https://studio.youtube.com/video/${m.youtube_id}/edit` });
      }
      this.onChange();
    }
  }

  /** You posted it yourself (or did so before the app existed): record it so nothing re-posts it and its day stays taken. */
  async markPosted(id: string, whenIso: string | null) {
    const s = loadSettings();
    const at = whenIso ? new Date(whenIso).toISOString() : new Date().toISOString();
    await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, 'status=published_manual', `publish_at=${at}`, 'error=']);
    this.manual.delete(id);
    this.uploadNow.delete(id);
    await commitAndPush(s.toolkitPath, ['shorts/registry.json', 'SHORTS.md'], `${id}: posted by you`);
    this.onChange();
  }

  async unmarkPosted(id: string) {
    const s = loadSettings();
    const ready = existsSync(join(s.toolkitPath, 'shorts', id, 'publish.json'));
    await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, `status=${ready ? 'ready_to_publish' : 'approved'}`, 'publish_at=']);
    await commitAndPush(s.toolkitPath, ['shorts/registry.json', 'SHORTS.md'], `${id}: not posted yet`);
    this.onChange();
  }

  /** After a post's time has passed, ask Buffer whether it went out (at most every 30 minutes per post). */
  private async pollBuffer(reg: Reg) {
    const key = getSecret('buffer');
    if (!key) return;
    const s = loadSettings();
    const now = Date.now();
    for (const m of Object.values(reg.shorts)) {
      if (m.status !== 'queued_buffer' || !m.buffer_post_id) continue;
      if (m.publish_at && Date.parse(m.publish_at) > now - 5 * 60_000) continue;
      if (now - (this.lastPoll.get(m.id) ?? 0) < 30 * 60_000) continue;
      this.lastPoll.set(m.id, now);
      try {
        const st = await postStatus(key, m.buffer_post_id);
        if (st.status === 'sent') {
          await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', m.id, 'status=published', `published_at=${st.sentAt ?? new Date().toISOString()}`]);
          await commitAndPush(s.toolkitPath, ['shorts/registry.json', 'SHORTS.md'], `${m.id}: published`);
          this.agents.post('publisher', { kind: 'notice', text: `${m.id} went live on YouTube.` });
          this.onChange();
        } else if (st.status === 'error') {
          await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', m.id, 'status=publish_failed', `error=${(st.error ?? 'Buffer reported an error').slice(0, 300)}`]);
          this.agents.post('publisher', { kind: 'notice', tone: 'error', text: `Buffer couldn't publish ${m.id}: ${st.error ?? 'unknown error'}. Open the review screen and press "Send on" to try again.` });
          this.onChange();
        }
      } catch { /* try again next time */ }
    }
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

/** What's still missing before the app can post through Buffer (null = ready). */
export function publishSetupMissing(s: ReturnType<typeof loadSettings>): string | null {
  if (s.publishVia === 'manual') return null;
  if (s.publishVia === 'youtube') {
    const y = youtubeStatus(s.toolkitPath);
    if (!y.hasClientSecret) return 'choose your Google client_secret.json in Settings → Publishing.';
    if (!y.signedIn) return 'sign in to YouTube in Settings → Publishing.';
    return null;
  }
  if (!getSecret('buffer')) return 'add your Buffer API key in Settings → Publishing.';
  if (!s.bufferChannelId) return 'pick your YouTube channel in Settings → Publishing.';
  if (s.mediaHost === 'r2' ? !(s.r2Account && s.r2Bucket && s.r2KeyId && s.r2PublicBase && getSecret('r2Secret')) : !(s.cloudinaryCloud && s.cloudinaryKey && getSecret('cloudinarySecret'))) {
    return 'set up the video host in Settings → Publishing (Buffer needs a public link to each video).';
  }
  return null;
}
