// Moves Shorts between desks without you: voiced -> Editor builds -> ready_to_render -> GPU render -> delivered.
// A failed render goes back to the Editor (at most twice per Short) with the error.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentId } from '../shared/types';
import { editorFixKickoff, editorKickoff, editorRevisionKickoff, reviewerKickoff, AUTOPILOT_TAG } from './agentDefs';
import type { AgentManager } from './agents';
import { outputDir, renderBusy, renderShort, shortsCmd } from './render';
import { loadSettings } from './settings';

type Reg = { shorts: Record<string, { id: string; status?: string; error?: string; title?: string; file?: string; version?: number }> };

export class Pipeline {
  private tries = new Map<string, number>(); // `${kind}:${id}` -> attempts this session
  private warnedSetup = false;
  private ticking = false;
  onChange: () => void = () => {};

  constructor(private agents: AgentManager) {}

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

  private async step() {
    const s = loadSettings();
    if (!s.autopilot) return;
    const reg = this.registry();
    if (!reg) return;
    const by = (st: string) => Object.values(reg.shorts).filter((m) => m.status === st).map((m) => m.id).sort();

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

    if (renderBusy()) return;
    const editor: AgentId = 'editor';
    if (!this.agents.isIdle(editor)) return;

    const waiting = [...by('ready_to_render'), ...by('voiced'), ...by('render_failed'), ...by('building'), ...by('changes_requested')];
    if (waiting.length && !s.renderReady) {
      if (!this.warnedSetup) {
        this.warnedSetup = true;
        this.agents.post(editor, { kind: 'notice', tone: 'warn', text: `${waiting[0]} is waiting for me, but rendering isn't set up on this PC yet. Open Settings → Rendering → Set up rendering (one time, 10-20 min).` });
      }
      return;
    }

    // 1. finish what's ready: render it
    const ready = by('ready_to_render')[0];
    if (ready && this.attempt('render', ready, 3)) return void this.render(ready);
    // 2. a failed render goes back to the Editor with the error
    const failed = by('render_failed').find((id) => this.attempt('fix', id, 2));
    if (failed) {
      await this.agents.send(editor, editorFixKickoff(failed, reg.shorts[failed].error ?? 'unknown error'), `Render of ${failed} failed — fix it`, { fresh: true, short: failed });
      return;
    }
    // 3. Hawk asked for changes: a revision (each version gets one try)
    const changes = by('changes_requested').find((id) => this.attempt('revise', `${id}v${reg.shorts[id].version ?? 1}`, 1));
    if (changes) {
      await this.agents.send(editor, editorRevisionKickoff(changes), `Hawk asked for changes on ${changes}`, { fresh: true, short: changes });
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
