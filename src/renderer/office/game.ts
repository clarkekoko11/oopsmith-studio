// The walkable studio: renderer, lights, player, every team's agents (and what they get up to when idle),
// the two camera modes, input and name tags.
import * as THREE from 'three';
import type { AgentId, AgentStatus, BacklogCard, ShortRow, TeamId } from '../../shared/types';
import { makeCharacter, type Action, type Character, type Look } from './characters';
import { collide, NavGrid } from './nav';
import { BRAND, buildOffice, updateMonitor, type ActivitySpot, type DeskSpot, type World } from './world';

export type CameraMode = 'topdown' | 'firstperson';

// Each team has its own crew (CREWS in shared/types): own names and own outfits. Shirts keep the desk's colour
// (yellow scripts, blue edit, orange review, violet publish) so roles still read at a glance; hats, hair, jackets
// and trousers make every crew distinct.
const CREW_LOOKS: Record<AgentId, Look>[] = [
  { // Scripty, Cutter, Hawk, Pip
    'script-writer': { skin: '#c68c5a', shirt: BRAND.yellow, pants: '#4a3b6b', hair: '#1c1410', hairStyle: 'bob', hat: 'beret', hatColor: '#c0392b', glasses: true },
    editor: { skin: '#f5d0b0', shirt: BRAND.sky, pants: '#3b4252', hair: '#d9a441', hairStyle: 'short', hat: 'headphones', hatColor: BRAND.plum },
    reviewer: { skin: '#8d5a3b', shirt: BRAND.orange, pants: '#2b2d3a', hair: '#0f0f12', hairStyle: 'short', glasses: true },
    publisher: { skin: '#ffd9b8', shirt: BRAND.violet, pants: '#1f4f8a', hairStyle: 'none', hat: 'cap', hatColor: BRAND.orange },
  },
  { // Quill, Splice, Lynx, Dash: knits and denim
    'script-writer': { skin: '#e8b48a', shirt: BRAND.yellow, sleeves: '#b5723a', pants: '#2f4a7a', hair: '#7a3b1c', hairStyle: 'long', glasses: true },
    editor: { skin: '#f2c9a0', shirt: BRAND.sky, sleeves: '#1d2f55', pants: '#6b6f7a', hair: '#e0b85a', hairStyle: 'short', hat: 'beanie', hatColor: BRAND.orange },
    reviewer: { skin: '#5c3a26', shirt: BRAND.orange, shirtStripe: BRAND.cream, pants: '#14141a', hair: '#0f0f12', hairStyle: 'bun', hat: 'visor', hatColor: BRAND.plum },
    publisher: { skin: '#a8714a', shirt: BRAND.violet, pants: '#b59a6a', hair: '#2a1a12', hairStyle: 'afro', hat: 'none' },
  },
  { // Inky, Reel, Owl, Bolt: hoodies and street
    'script-writer': { skin: '#f5d0b0', shirt: BRAND.yellow, sleeves: '#3b2a45', pants: '#23262f', hair: '#111111', hairStyle: 'spiky', hat: 'bandana', hatColor: BRAND.sky },
    editor: { skin: '#c68c5a', shirt: BRAND.sky, shirtStripe: BRAND.orange, pants: '#3a2a22', hair: '#b3402a', hairStyle: 'bob', hat: 'bucket', hatColor: BRAND.yellow, glasses: true },
    reviewer: { skin: '#e8b48a', shirt: BRAND.orange, sleeves: BRAND.cream, pants: '#3b4252', hair: '#9a9a9a', hairStyle: 'afro', glasses: true },
    publisher: { skin: '#8d5a3b', shirt: BRAND.violet, shirtStripe: BRAND.yellow, pants: '#1f1f28', hair: '#e8d08a', hairStyle: 'long', hat: 'headphones', hatColor: BRAND.orange },
  },
  { // Penny, Frame, Falcon, Zip: blazers and caps
    'script-writer': { skin: '#9a6440', shirt: BRAND.yellow, sleeves: '#2b2d3a', pants: '#2b2d3a', hair: '#5a3418', hairStyle: 'bob', glasses: true },
    editor: { skin: '#ffd9b8', shirt: BRAND.sky, sleeves: '#6b4a2e', pants: '#4a3b2a', hair: '#2a1a12', hairStyle: 'short', hat: 'beanie', hatColor: '#3f8a50' },
    reviewer: { skin: '#c68c5a', shirt: BRAND.orange, shirtStripe: BRAND.night, pants: '#1f2a44', hair: '#1c1410', hairStyle: 'short', hat: 'cap', hatColor: '#1f2a44' },
    publisher: { skin: '#f2c9a0', shirt: BRAND.violet, sleeves: BRAND.cream, pants: '#3a2a4a', hair: '#d66a9a', hairStyle: 'bun', hat: 'visor', hatColor: BRAND.orange },
  },
];
const PLAYER_LOOK: Look = { skin: '#f2c9a0', shirt: BRAND.plum, pants: '#23262f', hair: '#3b2416', hairStyle: 'spiky', shirtStripe: BRAND.orange };

type Mode = 'desk' | 'going' | 'activity' | 'returning';
interface AgentActor {
  key: string;
  team: TeamId;
  id: AgentId;
  ch: Character;
  desk: DeskSpot;
  tag: HTMLDivElement;
  status: AgentStatus;
  talking: boolean;
  pos: THREE.Vector3;
  heading: number;
  walkPhase: number;
  walkAmt: number;
  path: [number, number][];
  /** exact point to finish on after the path (spots can sit inside furniture) */
  final: THREE.Vector3 | null;
  mode: Mode;
  spot: ActivitySpot | null;
  action: Action;
  /** time the current activity / desk idle ends */
  until: number;
  seatY: number;
  /** you're walking over to talk to them: they wait for you */
  held: boolean;
  /** busy at the desk but waving along with a celebration until then */
  waveUntil: number;
}

/** Daylight 0..1 and sunrise/sunset warmth 0..1 for an hour of the day (0-24). */
export function skyAt(h: number): { daylight: number; warmth: number } {
  const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const daylight = ss(5.3, 7.6, h) * (1 - ss(17.6, 19.8, h));
  const g = (c: number, w: number) => Math.exp(-((h - c) ** 2) / (2 * w * w));
  return { daylight, warmth: Math.min(1, Math.max(g(6.7, 0.8), g(17.9, 0.9))) };
}

interface Confetti { mesh: THREE.InstancedMesh; vel: Float32Array; spin: Float32Array; born: number }

const TOPDOWN_PITCH = 0.95; // radians above the floor
const WALK_SPEED = 14;
const AGENT_SPEED = 6.5;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Office {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  mode: CameraMode = 'topdown';
  inputEnabled = true;
  onTalk: (team: TeamId, a: AgentId) => void = () => {};
  onMode: (m: CameraMode) => void = () => {};
  onHint: (key: string | null) => void = () => {};
  onScreen: (team: TeamId) => void = () => {};
  onBacklog: (team: TeamId) => void = () => {};
  private videos = new Map<TeamId, HTMLVideoElement>();
  private hemi: THREE.HemisphereLight;
  /** null = follow the real clock; a number pins the hour (Settings or ?hour= for previews) */
  private hourOverride: number | null = null;
  private dayNight = true;
  private lastSky = -1;
  private confetti: Confetti[] = [];
  private milestones = 0;
  private corks = new Map<TeamId, BacklogCard[]>();
  private crews = new Map<TeamId, number>();

  private player: Character;
  private pos = new THREE.Vector3(0, 0, 11.5);
  private heading = Math.PI;
  private walkPhase = 0;
  private walkAmount = 0;
  private path: [number, number][] = [];
  private goalAgent: string | null = null;
  private agents: AgentActor[] = [];
  private world!: World;
  private nav!: NavGrid;
  private keys = new Set<string>();
  private yaw = 0;
  private zoom = 50;
  private maxZoom = 80;
  private fpYaw = Math.PI;
  private fpPitch = -0.08;
  private camTarget = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private timer = new THREE.Timer();
  private marker: THREE.Mesh;
  private dragging: { x: number; y: number; button: number; moved: boolean } | null = null;
  private talkingTo: string | null = null;
  private nearAgent: string | null = null;
  private sun: THREE.DirectionalLight;
  private lights = new THREE.Group();
  private teamNames = new Map<TeamId, string>();
  private t = 0;

  constructor(private host: HTMLElement, private tagLayer: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(BRAND.night);
    this.scene.fog = new THREE.Fog(BRAND.night, 120, 260);
    this.hemi = new THREE.HemisphereLight('#ffe9cf', '#5a3b40', 1.35);
    this.scene.add(this.hemi);
    const qh = new URLSearchParams(location.search).get('hour');
    if (qh !== null && !Number.isNaN(Number(qh))) this.hourOverride = Number(qh);
    // late-afternoon sun through the factory windows
    this.sun = new THREE.DirectionalLight('#ffe2b8', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target, this.lights);

    this.player = makeCharacter(PLAYER_LOOK);
    this.scene.add(this.player.root);

    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 32), new THREE.MeshBasicMaterial({ color: BRAND.yellow, transparent: true, opacity: 0 }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.05;
    this.scene.add(this.marker);

    this.setTeams([{ id: 'main', name: 'Team Oopsmith' }]);
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- public API
  /** (Re)build the studio for this list of teams: one production line each, plus the lounge. */
  setTeams(teams: { id: TeamId; name: string; crew?: number }[]) {
    const same = this.world && teams.length === this.world.lines.length && teams.every((t, i) => this.world.lines[i].team === t.id && this.world.lines[i].name === t.name && (this.crews.get(t.id) ?? 0) === (t.crew ?? 0));
    this.crews = new Map(teams.map((t) => [t.id, t.crew ?? 0]));
    if (same) return;
    const old = new Map(this.agents.map((a) => [a.key, a]));
    if (this.world) this.scene.remove(this.world.root);
    for (const a of this.agents) { this.scene.remove(a.ch.root); a.tag.remove(); }
    this.agents = [];
    this.lights.clear();
    this.teamNames = new Map(teams.map((t) => [t.id, t.name]));

    this.world = buildOffice(this.scene, teams);
    const { w, d } = this.world.room;
    this.nav = new NavGrid(w, d, this.world.colliders);

    // warm lights: one over each line, two in the lounge
    for (const line of this.world.lines) {
      const l = new THREE.PointLight('#ffd9a8', 55, 34, 1.5);
      l.position.set(0, 7.2, line.z0 + 7);
      this.lights.add(l);
    }
    for (const x of [-12, 12]) {
      const l = new THREE.PointLight('#ffc98a', 60, 34, 1.5);
      l.position.set(x, 7, d / 2 - 8);
      this.lights.add(l);
    }
    this.sun.position.set(18, 34, -d / 2 + 6);
    this.sun.target.position.set(0, 0, 0);
    const sc = this.sun.shadow.camera;
    sc.left = -w / 2 - 4; sc.right = w / 2 + 4; sc.top = d / 2 + 6; sc.bottom = -d / 2 - 6; sc.near = 1; sc.far = 120;
    sc.updateProjectionMatrix();

    teams.forEach((team, ti) => {
      for (const desk of this.world.desks.filter((x) => x.team === team.id)) {
        const look = CREW_LOOKS[(team.crew ?? ti) % CREW_LOOKS.length][desk.agent];
        const ch = makeCharacter(look);
        ch.root.traverse((o) => (o.userData.agentKey = desk.key));
        this.scene.add(ch.root);
        const tag = document.createElement('div');
        tag.className = 'tag';
        this.tagLayer.appendChild(tag);
        const prev = old.get(desk.key);
        this.agents.push({
          key: desk.key, team: team.id, id: desk.agent, ch, desk, tag,
          status: prev?.status ?? 'offline', talking: false,
          pos: desk.stand.clone(), heading: desk.facing, walkPhase: 0, walkAmt: 0, path: [], final: null,
          mode: 'desk', spot: null, action: 'stand', until: this.t + rand(4, 14), seatY: 0, held: false, waveUntil: 0,
        });
        if (prev) this.renderTag(this.agents[this.agents.length - 1], prev.tag.dataset.name ?? '', prev.tag.dataset.role ?? '', prev.tag.dataset.activity);
      }
    });

    this.maxZoom = Math.max(60, d * 1.35);
    this.zoom = THREE.MathUtils.clamp(this.zoom, 20, this.maxZoom);
    if (Math.abs(this.pos.x) > w / 2 - 1 || Math.abs(this.pos.z) > d / 2 - 1 || !old.size) this.pos.copy(this.world.playerStart);
    this.camTarget.copy(this.pos);
    this.player.root.visible = this.mode === 'topdown';
    this.world.ceiling.visible = this.mode === 'firstperson';
    this.lastSky = -1;
    this.world.setMilestones(this.milestones);
    for (const l of this.world.lines) l.drawCork(this.corks.get(l.team) ?? []);
  }

  // ---------- time of day, backlog, milestones, celebrations
  /** Stop drawing while the window is hidden in the tray; pick up again when it's shown. */
  setPaused(paused: boolean) {
    this.renderer.setAnimationLoop(paused ? null : () => this.frame());
    for (const v of this.videos.values()) { if (paused) v.pause(); else void v.play().catch(() => {}); }
  }
  /** Follow the real time of day (on), or keep the warm late-afternoon look (off). */
  setDayNight(on: boolean) {
    this.dayNight = on;
    this.lastSky = -1;
  }
  private applySky(force = false) {
    const now = new Date();
    const h = this.hourOverride ?? (this.dayNight ? now.getHours() + now.getMinutes() / 60 : 16.3);
    if (!force && Math.abs(h - this.lastSky) < 0.05) return;
    this.lastSky = h;
    const { daylight: d, warmth: w } = skyAt(h);
    const c = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);
    // the sun (moonlight at night) through the factory windows
    this.sun.color.copy(c('#8fa6ff', c('#ffe2b8', '#ffad6b', w).getStyle(), d));
    this.sun.intensity = 0.25 + d * (2.2 - 0.6 * w) ;
    this.hemi.color.copy(c('#8f97c8', '#ffe9cf', d));
    this.hemi.intensity = 0.6 + d * 0.75;
    // lamps feel cozier at night
    this.lights.children.forEach((l) => ((l as THREE.PointLight).intensity = 55 + (1 - d) * 40));
    this.renderer.toneMappingExposure = 0.92 + d * 0.08;
    this.world.setSky(d, w);
  }
  setCork(team: TeamId, cards: BacklogCard[]) {
    this.corks.set(team, cards);
    this.world.lines.find((l) => l.team === team)?.drawCork(cards);
  }
  setMilestones(count: number) {
    this.milestones = count;
    this.world.setMilestones(count);
  }
  /**
   * A Short is out (or a week is full, or an upgrade unlocked): the team's free agents gather on the lounge rug and
   * dance, busy ones wave from their desks, and confetti comes down. team null = everyone.
   */
  celebrate(team: TeamId | null) {
    const crew = this.agents.filter((a) => !team || a.team === team);
    const free = crew.filter((a) => (a.status === 'idle' || a.status === 'offline') && !a.held);
    const c = this.world.party;
    free.forEach((a, i) => {
      const ang = (i / Math.max(1, free.length)) * Math.PI * 2 + Math.random() * 0.4;
      const r = 2.2 + (i % 2) * 1.1;
      const pos = new THREE.Vector3(c.x + Math.cos(ang) * r, 0, c.z + Math.sin(ang) * r * 0.7);
      this.release(a);
      a.spot = { kind: 'party', pos, facing: Math.atan2(c.x - pos.x, c.z - pos.z), action: 'dance', taken: a.key };
      a.mode = 'going';
      a.action = 'stand';
      a.until = this.t + 16;
      this.sendTo(a, pos.x, pos.z, pos);
    });
    for (const a of crew) if (!free.includes(a)) a.waveUntil = this.t + 5;
    this.burst(new THREE.Vector3(c.x, 9, c.z));
    if (team) {
      const line = this.world.lines.find((l) => l.team === team);
      if (line) this.burst(new THREE.Vector3(19.5, 8.5, line.z0 + 6.4)); // over Pip's desk too
    }
  }
  private burst(at: THREE.Vector3) {
    const n = 260;
    const geo = new THREE.PlaneGeometry(0.22, 0.34);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const cols = [BRAND.orange, BRAND.yellow, BRAND.sky, BRAND.violet, BRAND.cream];
    const vel = new Float32Array(n * 3), spin = new Float32Array(n * 3);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 7;
      vel.set([Math.cos(a) * sp, 3 + Math.random() * 6, Math.sin(a) * sp], i * 3);
      spin.set([Math.random() * 8, Math.random() * 8, Math.random() * 8], i * 3);
      m.makeTranslation(at.x, at.y, at.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(cols[i % cols.length]));
    }
    mesh.userData.origin = at.clone();
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.confetti.push({ mesh, vel, spin, born: this.t });
  }
  private updateConfetti() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (const c of [...this.confetti]) {
      const age = this.t - c.born;
      if (age > 7) {
        this.scene.remove(c.mesh);
        c.mesh.geometry.dispose();
        (c.mesh.material as THREE.Material).dispose();
        this.confetti.splice(this.confetti.indexOf(c), 1);
        continue;
      }
      const o = c.mesh.userData.origin as THREE.Vector3;
      for (let i = 0; i < c.mesh.count; i++) {
        const vx = c.vel[i * 3], vy = c.vel[i * 3 + 1], vz = c.vel[i * 3 + 2];
        // a quick pop, then paper fluttering down (air drag)
        const drag = 1 - Math.exp(-age * 1.4);
        p.set(o.x + (vx / 1.4) * drag + Math.sin(age * 3 + i) * 0.3, Math.max(0.05, o.y + (vy / 1.4) * drag - age * 1.6), o.z + (vz / 1.4) * drag);
        e.set(c.spin[i * 3] * age, c.spin[i * 3 + 1] * age, c.spin[i * 3 + 2] * age);
        q.setFromEuler(e);
        m.compose(p, q, one);
        c.mesh.setMatrixAt(i, m);
      }
      c.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private actor(team: TeamId, id: AgentId) {
    return this.agents.find((x) => x.team === team && x.id === id);
  }

  setAgentInfo(team: TeamId, id: AgentId, name: string, role: string, status: AgentStatus, activity?: string) {
    const a = this.actor(team, id);
    if (!a) return;
    a.status = status;
    this.renderTag(a, name, role, activity);
    updateMonitor(a.desk, status === 'offline' ? 'offline' : activity && status !== 'idle' ? activity.slice(0, 26) : status);
  }
  private renderTag(a: AgentActor, name: string, role: string, activity?: string) {
    const label: Record<AgentStatus, string> = { idle: 'idle', working: 'working', 'needs-you': 'needs you', offline: 'offline', error: 'error' };
    a.tag.dataset.status = a.status;
    a.tag.dataset.name = name;
    a.tag.dataset.role = role;
    if (activity) a.tag.dataset.activity = activity; else delete a.tag.dataset.activity;
    const line = activity && a.status !== 'idle' ? activity : a.status === 'idle' ? this.idleLabel(a) : label[a.status];
    const team = this.teamNames.size > 1 ? `<em>${esc(this.teamNames.get(a.team) ?? '')}</em>` : '';
    a.tag.innerHTML = `<div class="bubble"><span class="dot"></span>${esc(line)}</div><div class="name">${esc(name)}<span>${esc(role)}</span>${team}</div>`;
  }
  private idleLabel(a: AgentActor): string {
    if (a.mode === 'going') return a.spot?.kind === 'party' ? 'party time' : 'on a break';
    if (a.mode === 'returning') return 'heading back';
    if (a.mode === 'activity' && a.spot) {
      return ({ coffee: a.action === 'chat' ? 'chatting' : 'coffee break', cooler: 'getting water', sofa: 'chilling', beanbag: 'chilling', arcade: 'playing arcade', read: 'reading', armchair: 'reading', water: 'watering plants', window: 'daydreaming', record: 'vibing to records', party: 'celebrating', fame: 'admiring the Hall of Fame' } as Record<string, string>)[a.spot.kind] ?? 'idle';
    }
    return a.action === 'stretch' ? 'stretching' : a.action === 'think' ? 'thinking' : 'idle';
  }
  setTalking(key: string | null) {
    if (this.talkingTo && this.talkingTo !== key) {
      const prev = this.agents.find((a) => a.key === this.talkingTo);
      if (prev) prev.held = false;
    }
    this.talkingTo = key;
    if (key) { const a = this.agents.find((x) => x.key === key); if (a) a.held = true; }
  }
  setAgentSpeaking(team: TeamId, id: AgentId, on: boolean) {
    const a = this.actor(team, id);
    if (a && a.talking !== on) {
      a.talking = on;
      a.ch.setTalking(on);
    }
  }
  setBoard(team: TeamId, rows: ShortRow[]) {
    this.world.lines.find((l) => l.team === team)?.drawBoard(rows);
  }
  /** Play a team's latest rendered Short (muted, looping) on its review screen; null shows the poster. */
  setReviewVideo(team: TeamId, url: string | null) {
    const line = this.world.lines.find((l) => l.team === team);
    if (!line) return;
    const mat = line.tv.material as THREE.MeshBasicMaterial;
    const cur = this.videos.get(team);
    if (cur && cur.dataset.src === (url ?? '') && mat.map instanceof THREE.VideoTexture) return;
    cur?.pause();
    if (!url) {
      line.tv.scale.set(1, 1, 1);
      mat.map = line.poster;
      mat.needsUpdate = true;
      this.videos.delete(team);
      return;
    }
    const v = document.createElement('video');
    v.src = url;
    v.dataset.src = url;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    void v.play().catch(() => {});
    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex;
    mat.needsUpdate = true;
    this.videos.set(team, v);
    // the screen is 16:9; the Short is 9:16, so show it as a tall picture in the middle
    line.tv.scale.set((9 / 16) * (3.94 / 7), 1, 1);
  }

  setMode(m: CameraMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.path = [];
    this.goalAgent = null;
    if (m === 'firstperson') {
      this.fpYaw = this.heading;
      this.fpPitch = -0.08;
    } else if (document.pointerLockElement) document.exitPointerLock();
    this.player.root.visible = m === 'topdown';
    this.world.ceiling.visible = m === 'firstperson';
    this.onMode(m);
  }
  toggleMode() {
    this.setMode(this.mode === 'topdown' ? 'firstperson' : 'topdown');
  }
  /** Walk over to an agent (wherever they are right now) and start talking. */
  walkToAgent(key: string) {
    const a = this.agents.find((x) => x.key === key);
    if (!a) return;
    if (this.mode === 'firstperson') {
      this.onTalk(a.team, a.id);
      return;
    }
    this.setTalking(null);
    a.held = true;
    let tx: number, tz: number;
    if (a.mode === 'desk') {
      tx = a.desk.talk.x;
      tz = a.desk.talk.z;
    } else {
      const dx = this.pos.x - a.pos.x, dz = this.pos.z - a.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      tx = a.pos.x + (dx / len) * 3.4;
      tz = a.pos.z + (dz / len) * 3.4;
    }
    const p = this.nav.path(this.pos.x, this.pos.z, tx, tz);
    if (p) {
      this.path = p;
      this.goalAgent = key;
    } else this.onTalk(a.team, a.id);
  }
  /** Center the view on a team's line. */
  focusTeam(team: TeamId) {
    const line = this.world.lines.find((l) => l.team === team);
    if (!line) return;
    const p = this.nav.path(this.pos.x, this.pos.z, 0, line.z0 + 10.4);
    if (p) { this.path = p; this.goalAgent = null; }
  }
  /**
   * Layout check (for tests): wall pictures that overlap each other, and furniture that stands in front of a
   * wall picture or overlaps other furniture. Returns plain text lines.
   */
  debugAudit(): string[] {
    const out: string[] = [];
    const w = this.world;
    const trims = new Set(w.walls.flatMap((x) => x.trims));
    const walls = new Set<THREE.Object3D>(w.walls.map((x) => x.mesh));
    const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
    const fmt = (b: THREE.Box3) => `x ${b.min.x.toFixed(1)}..${b.max.x.toFixed(1)} y ${b.min.y.toFixed(1)}..${b.max.y.toFixed(1)} z ${b.min.z.toFixed(1)}..${b.max.z.toFixed(1)}`;
    const pics = [...trims].filter((t) => (t as THREE.Mesh).geometry?.type === 'PlaneGeometry' || (t as THREE.Mesh).geometry?.type === 'BoxGeometry');
    // pictures on the same wall that overlap
    for (const wall of w.walls) {
      const ps = wall.trims.filter((t) => (t as THREE.Mesh).geometry?.type === 'PlaneGeometry');
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const a = box(ps[i]).expandByScalar(0.05), b = box(ps[j]);
        if (a.intersectsBox(b)) out.push(`WALL OVERLAP: ${fmt(box(ps[i]))}  &  ${fmt(b)}`);
      }
    }
    // furniture standing in front of a wall picture (within 2.5 of the wall, taller than the picture's bottom)
    const furniture = w.root.children.filter((c) => !trims.has(c) && !walls.has(c) && c !== w.ceiling && !(w.pickFloor as THREE.Object3D[]).includes(c) && box(c).max.y > 0.3 && box(c).min.y < 8 && box(c).getSize(new THREE.Vector3()).x < 40);
    for (const p of pics) {
      if ((p as THREE.Mesh).geometry?.type !== 'PlaneGeometry') continue;
      const pb = box(p);
      const wall = w.walls.find((x) => x.trims.includes(p))!;
      const zone = pb.clone();
      if (wall.normal.x) { if (wall.normal.x > 0) zone.max.x += 2.5; else zone.min.x -= 2.5; } else { if (wall.normal.y > 0) zone.max.z += 2.5; else zone.min.z -= 2.5; }
      for (const f of furniture) {
        const fb = box(f);
        if (fb.intersectsBox(zone) && fb.max.y > pb.min.y + 0.15) out.push(`BLOCKS PICTURE: furniture ${fmt(fb)} covers picture ${fmt(pb)}`);
      }
    }
    // floor colliders overlapping each other (walls excluded)
    const cs = w.colliders.filter((c) => c.maxX - c.minX < 20 && c.maxZ - c.minZ < 20);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      if (ox > 0.2 && oz > 0.2) out.push(`FLOOR OVERLAP: [${a.minX.toFixed(1)}..${a.maxX.toFixed(1)}, ${a.minZ.toFixed(1)}..${a.maxZ.toFixed(1)}] & [${b.minX.toFixed(1)}..${b.maxX.toFixed(1)}, ${b.minZ.toFixed(1)}..${b.maxZ.toFixed(1)}]`);
    }
    return out;
  }
  debugTeleport(x: number, z: number, heading: number) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.fpYaw = heading;
    this.camTarget.copy(this.pos);
  }
  setYaw(y: number) {
    this.yaw = y;
  }
  setZoom(z: number) {
    this.zoom = THREE.MathUtils.clamp(z, 20, this.maxZoom);
  }

  // ---------- input
  private bindInput() {
    const el = this.renderer.domElement;
    const typing = () => {
      const a = document.activeElement;
      return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
    };
    window.addEventListener('keydown', (e) => {
      if (typing() || !this.inputEnabled) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === 'v') this.toggleMode();
      if (k === 'e' && this.mode === 'firstperson' && this.nearAgent) {
        document.exitPointerLock();
        const a = this.agents.find((x) => x.key === this.nearAgent)!;
        this.onTalk(a.team, a.id);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      if (this.mode !== 'topdown') return;
      this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * 0.03, 20, this.maxZoom);
    }, { passive: true });
    el.addEventListener('pointerdown', (e) => {
      if (!this.inputEnabled) return;
      if (this.mode === 'firstperson') {
        if (!document.pointerLockElement) el.requestPointerLock();
        return;
      }
      this.dragging = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
      if (this.mode === 'firstperson') {
        if (document.pointerLockElement === el) {
          this.fpYaw -= e.movementX * 0.0025;
          this.fpPitch = THREE.MathUtils.clamp(this.fpPitch - e.movementY * 0.0022, -1.2, 1.1);
        }
        return;
      }
      if (this.dragging) {
        const dx = e.clientX - this.dragging.x;
        if (Math.abs(dx) + Math.abs(e.clientY - this.dragging.y) > 5) this.dragging.moved = true;
        if (this.dragging.button === 2) this.yaw -= e.movementX * 0.006;
      } else {
        const hit = this.pick(e.clientX, e.clientY);
        el.style.cursor = hit.agent || hit.screen || hit.backlog ? 'pointer' : 'default';
      }
    });
    window.addEventListener('pointerup', (e) => {
      const d = this.dragging;
      this.dragging = null;
      if (!d || d.moved || d.button !== 0 || this.mode !== 'topdown' || !this.inputEnabled) return;
      if (e.target !== el) return;
      const hit = this.pick(e.clientX, e.clientY);
      if (hit.screen) this.onScreen(hit.screen);
      else if (hit.backlog) this.onBacklog(hit.backlog);
      else if (hit.agent) this.walkToAgent(hit.agent);
      else if (hit.point) {
        const p = this.nav.path(this.pos.x, this.pos.z, hit.point.x, hit.point.z);
        if (p) {
          if (this.goalAgent) { const g = this.agents.find((a) => a.key === this.goalAgent); if (g) g.held = false; }
          this.path = p;
          this.goalAgent = null;
          this.marker.position.set(p[p.length - 1][0], 0.05, p[p.length - 1][1]);
          (this.marker.material as THREE.MeshBasicMaterial).opacity = 1;
        }
      }
    });
  }

  private pick(cx: number, cy: number): { agent?: string; point?: THREE.Vector3; screen?: TeamId; backlog?: TeamId } {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    for (const h of hits) {
      if (!isVisible(h.object)) continue;
      const agent = h.object.userData.agentKey as string | undefined;
      if (agent) return { agent };
      if (h.object.userData.screen) return { screen: h.object.userData.screen as TeamId };
      if (h.object.userData.backlog) return { backlog: h.object.userData.backlog as TeamId };
      if (this.world.pickFloor.includes(h.object)) return { point: h.point };
    }
    const { w, d } = this.world.room;
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) && Math.abs(p.x) < w / 2 && Math.abs(p.z) < d / 2) return { point: p };
    return {};
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  // ---------- agent life: work at the desk; when idle, take breaks around the studio
  private freeSpots() {
    return this.world.spots.filter((s) => !s.taken);
  }
  private sendTo(a: AgentActor, x: number, z: number, final: THREE.Vector3 | null) {
    a.path = this.nav.path(a.pos.x, a.pos.z, x, z) ?? [];
    a.final = final;
  }
  private release(a: AgentActor) {
    if (a.spot) a.spot.taken = null;
    a.spot = null;
    a.ch.hold(null);
  }
  private goBreak(a: AgentActor) {
    const free = this.freeSpots();
    if (!free.length) return false;
    // coffee is popular, and a free spot next to someone already there makes a chat
    const weights = free.map((s) => (s.kind === 'coffee' ? (this.world.spots.some((o) => o.kind === 'coffee' && o.taken) ? 4 : 2) : s.kind === 'water' ? 0.7 : 1));
    let r = Math.random() * weights.reduce((x, y) => x + y, 0);
    let spot = free[0];
    for (let i = 0; i < free.length; i++) { r -= weights[i]; if (r <= 0) { spot = free[i]; break; } }
    spot.taken = a.key;
    a.spot = spot;
    a.mode = 'going';
    a.action = 'stand';
    this.sendTo(a, spot.pos.x, spot.pos.z, spot.pos);
    return true;
  }
  private goDesk(a: AgentActor) {
    this.release(a);
    a.mode = 'returning';
    a.action = 'stand';
    this.sendTo(a, a.desk.stand.x, a.desk.stand.z, a.desk.stand);
  }
  /** Move along the path; true when arrived. */
  private walk(a: AgentActor, dt: number): boolean {
    let budget = AGENT_SPEED * dt;
    let moved = 0;
    while (budget > 0) {
      const target = a.path.length ? a.path[0] : a.final ? [a.final.x, a.final.z] as [number, number] : null;
      if (!target) break;
      const dx = target[0] - a.pos.x, dz = target[1] - a.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.05) {
        if (a.path.length) a.path.shift(); else a.final = null;
        continue;
      }
      const step = Math.min(dist, budget);
      a.pos.x += (dx / dist) * step;
      a.pos.z += (dz / dist) * step;
      a.heading = Math.atan2(dx, dz);
      budget -= step;
      moved += step;
    }
    a.walkPhase += moved * 0.75;
    a.walkAmt = THREE.MathUtils.lerp(a.walkAmt, moved > 0 ? 1 : 0, 0.25);
    return !a.path.length && !a.final;
  }

  private live(a: AgentActor, dt: number, t: number) {
    const busy = a.status === 'working' || a.status === 'needs-you' || a.status === 'error';
    let face = a.heading;
    // you're coming over: wait where you are
    if (a.held && a.mode !== 'activity' && a.mode !== 'desk') {
      a.walkAmt = THREE.MathUtils.lerp(a.walkAmt, 0, 0.25);
      a.action = 'stand';
    } else if (busy && (a.mode === 'going' || a.mode === 'activity')) {
      if (!a.held) this.goDesk(a);
    } else if (a.mode === 'going' || a.mode === 'returning') {
      if (this.walk(a, dt)) {
        if (a.mode === 'going' && a.spot) {
          a.mode = 'activity';
          a.action = a.spot.action;
          a.ch.hold(a.spot.prop ?? null);
          a.until = t + (a.spot.kind === 'party' ? rand(10, 14) : a.spot.action === 'sit' || a.spot.action === 'readSit' ? rand(14, 30) : rand(8, 18));
        } else {
          a.mode = 'desk';
          a.action = 'stand';
          a.until = t + rand(6, 16);
        }
      }
    } else if (a.mode === 'activity' && a.spot) {
      face = a.spot.facing;
      // two people at the coffee bar have a chat
      if (a.spot.kind === 'coffee') {
        const other = this.agents.find((o) => o !== a && o.mode === 'activity' && o.spot?.kind === 'coffee');
        if (other) {
          a.action = 'chat';
          face = Math.atan2(other.pos.x - a.pos.x, other.pos.z - a.pos.z);
          const mine = Math.sin(t * 0.7 + (a.key < other.key ? 0 : Math.PI)) > 0;
          if (!a.talking && this.talkingTo !== a.key) a.ch.setFace(mine && Math.sin(t * 14) > 0 ? 'talk' : 'smile');
        } else a.action = 'drink';
      }
      if (t > a.until && !a.held) {
        if (Math.random() < 0.35 && this.goBreak(a)) { /* off to the next thing */ }
        else this.goDesk(a);
        if ((a.mode as Mode) === 'going') this.world.spots.forEach((s) => { if (s.taken === a.key && s !== a.spot) s.taken = null; });
      }
    } else {
      // at the desk
      a.pos.lerp(a.desk.stand, 0.2);
      face = a.desk.facing;
      if (a.waveUntil > t) a.action = 'wave';
      else if (a.status === 'working') a.action = 'type';
      else if (a.status === 'needs-you') a.action = 'wave';
      else if (a.status === 'error') a.action = 'think';
      else if (a.status === 'offline') a.action = 'stand';
      else if (t > a.until && !a.held) {
        // idle: take a break, or stretch at the desk for a bit
        const r = Math.random();
        if (r < 0.65 && this.goBreak(a)) { /* going */ }
        else { a.action = r < 0.85 ? 'stretch' : 'think'; a.until = t + rand(4, 8); }
      } else if (t > a.until - 0.1 || (a.action !== 'stretch' && a.action !== 'think')) a.action = 'stand';
    }
    // not walking this frame: settle out of the walk cycle, so sitting / typing / arcade poses take over
    if (a.mode !== 'going' && a.mode !== 'returning') a.walkAmt = THREE.MathUtils.lerp(a.walkAmt, 0, 1 - Math.exp(-dt * 10));
    // face you while you talk to them, or when you stand close by
    const close = Math.hypot(this.pos.x - a.pos.x, this.pos.z - a.pos.z) < 6;
    const seated = a.mode === 'activity' && a.spot?.seatY !== undefined;
    if ((this.talkingTo === a.key || (close && a.mode === 'desk')) && !seated) face = Math.atan2(this.pos.x - a.pos.x, this.pos.z - a.pos.z);
    if (a.mode === 'going' || a.mode === 'returning') face = a.heading;
    if (this.talkingTo === a.key && (a.action === 'type' || a.action === 'stretch')) a.action = 'stand';
    a.ch.root.rotation.y = lerpAngle(a.ch.root.rotation.y, face, 1 - Math.exp(-dt * 7));
    // sit down onto the seat
    const wantY = seated && a.walkAmt < 0.2 ? a.spot!.seatY! - 1.5 : 0;
    a.seatY = THREE.MathUtils.lerp(a.seatY, wantY, 1 - Math.exp(-dt * 8));
    a.ch.root.position.set(a.pos.x, a.seatY, a.pos.z);
    const act: Action = a.walkAmt > 0.3 ? 'stand' : seated ? (a.spot!.action) : a.action;
    a.ch.pose(a.walkAmt, a.walkPhase, t, act);
    a.ch.update(t);
  }

  // ---------- per frame
  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const t = (this.t = this.timer.getElapsed());
    let moving = false;
    const cols = this.world.colliders;
    const agentBlocks = this.agents
      .filter((a) => a.mode === 'desk' || a.mode === 'activity')
      .map((a) => ({ minX: a.pos.x - 0.8, maxX: a.pos.x + 0.8, minZ: a.pos.z - 0.8, maxZ: a.pos.z + 0.8 }));
    const allCols = cols.concat(agentBlocks);

    if (this.mode === 'topdown') {
      const rot = (this.keys.has('q') ? 1 : 0) - (this.keys.has('e') ? 1 : 0);
      if (this.inputEnabled) this.yaw += rot * dt * 1.6;
      const f = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
      const s = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
      if ((f || s) && this.inputEnabled) {
        this.path = [];
        if (this.goalAgent) { const g = this.agents.find((a) => a.key === this.goalAgent); if (g && this.talkingTo !== g.key) g.held = false; }
        this.goalAgent = null;
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
        const dx = fx * f + rx * s, dz = fz * f + rz * s;
        const len = Math.hypot(dx, dz) || 1;
        moving = this.step(dx / len, dz / len, WALK_SPEED * dt, allCols);
      } else if (this.path.length) {
        const [tx, tz] = this.path[0];
        const dx = tx - this.pos.x, dz = tz - this.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.25) {
          this.path.shift();
          if (!this.path.length) {
            (this.marker.material as THREE.MeshBasicMaterial).opacity = 0;
            if (this.goalAgent) {
              const a = this.agents.find((x) => x.key === this.goalAgent);
              this.goalAgent = null;
              if (a) {
                this.heading = Math.atan2(a.pos.x - this.pos.x, a.pos.z - this.pos.z);
                this.onTalk(a.team, a.id);
              }
            }
          }
        } else {
          moving = this.step(dx / dist, dz / dist, Math.min(dist, WALK_SPEED * dt), cols, true);
        }
      }
    } else {
      const f = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
      const s = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
      if ((f || s) && this.inputEnabled) {
        const fx = Math.sin(this.fpYaw), fz = Math.cos(this.fpYaw);
        const rx = -fz, rz = fx;
        const dx = fx * f + rx * s, dz = fz * f + rz * s;
        const len = Math.hypot(dx, dz) || 1;
        const speed = WALK_SPEED * (this.keys.has('shift') ? 1.6 : 1);
        this.step(dx / len, dz / len, speed * dt, allCols, false);
        moving = true;
      }
      this.heading = this.fpYaw;
    }

    this.walkAmount = THREE.MathUtils.lerp(this.walkAmount, moving ? 1 : 0, 1 - Math.exp(-dt * 12));
    this.player.root.position.copy(this.pos);
    this.player.root.rotation.y = lerpAngle(this.player.root.rotation.y, this.heading, 1 - Math.exp(-dt * 14));
    this.player.pose(this.walkAmount, this.walkPhase, t);
    this.player.update(t);
    const m = this.marker.material as THREE.MeshBasicMaterial;
    if (m.opacity > 0) this.marker.scale.setScalar(1 + Math.sin(t * 6) * 0.08);

    this.nearAgent = null;
    for (const a of this.agents) {
      const was = a.mode + a.action + (a.spot?.kind ?? '');
      this.live(a, dt, t);
      if (a.status === 'idle' && was !== a.mode + a.action + (a.spot?.kind ?? '')) this.renderTag(a, a.tag.dataset.name ?? '', a.tag.dataset.role ?? '', a.tag.dataset.activity);
      if (this.mode === 'firstperson' && Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) < 6) {
        const toA = Math.atan2(a.pos.x - this.pos.x, a.pos.z - this.pos.z);
        if (Math.abs(angleDiff(toA, this.fpYaw)) < 0.9) this.nearAgent = a.key;
      }
    }
    this.onHint(this.mode === 'firstperson' && this.nearAgent && this.inputEnabled ? this.nearAgent : null);

    this.world.update(t);
    this.applySky();
    if (this.confetti.length) this.updateConfetti();
    this.updateCamera(dt);
    this.updateWalls();
    this.renderer.render(this.scene, this.camera);
    this.updateTags();
  }

  private step(dx: number, dz: number, dist: number, cols: World['colliders'], face = true): boolean {
    const ox = this.pos.x, oz = this.pos.z;
    const [nx, nz] = collide(ox + dx * dist, oz + dz * dist, cols);
    this.pos.x = nx;
    this.pos.z = nz;
    const moved = Math.hypot(nx - ox, nz - oz);
    this.walkPhase += moved * 0.75;
    if (face && moved > 0.001) this.heading = Math.atan2(dx, dz);
    if (moved < dist * 0.2 && this.path.length && face) {
      const goal = this.path[this.path.length - 1];
      this.path = this.nav.path(this.pos.x, this.pos.z, goal[0], goal[1]) ?? [];
    }
    return moved > 0.001;
  }

  private updateCamera(dt: number) {
    if (this.mode === 'topdown') {
      const { d } = this.world.room;
      // follow you, leaning toward the middle of the studio; frame the agent you're talking to
      // small studios stay framed whole; bigger ones (more teams) follow you more
      const follow = THREE.MathUtils.clamp((d - 30) / 40, 0, 1) * 0.55 + 0.3;
      const goal = new THREE.Vector3(this.pos.x * 0.35, 1, THREE.MathUtils.clamp(this.pos.z * follow, -d / 2 + 10, d / 2 - 10) - 4.5);
      const a = this.talkingTo ? this.agents.find((x) => x.key === this.talkingTo) : undefined;
      if (a) {
        goal.set((this.pos.x + a.pos.x) / 2, 1, (this.pos.z + a.pos.z) / 2);
        const shift = this.zoom * 0.28;
        goal.x += Math.cos(this.yaw) * shift;
        goal.z += -Math.sin(this.yaw) * shift;
      }
      this.camTarget.lerp(goal, 1 - Math.exp(-dt * 4));
      const h = Math.sin(TOPDOWN_PITCH) * this.zoom;
      const r = Math.cos(TOPDOWN_PITCH) * this.zoom;
      const want = new THREE.Vector3(this.camTarget.x + Math.sin(this.yaw) * r, h, this.camTarget.z + Math.cos(this.yaw) * r);
      this.camera.position.lerp(want, 1 - Math.exp(-dt * 10));
      this.camera.fov = 42;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.camTarget);
    } else {
      this.camera.fov = 70;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(this.pos.x, 4.9, this.pos.z);
      const dir = new THREE.Vector3(Math.sin(this.fpYaw) * Math.cos(this.fpPitch), Math.sin(this.fpPitch), Math.cos(this.fpYaw) * Math.cos(this.fpPitch));
      this.camera.lookAt(this.camera.position.clone().add(dir));
    }
  }

  /** Sims-style cut-away: walls between the camera and the room drop to a low strip. */
  private updateWalls() {
    const cx = this.camera.position.x - this.camTarget.x;
    const cz = this.camera.position.z - this.camTarget.z;
    for (const w of this.world.walls) {
      const cut = this.mode === 'topdown' && w.normal.x * cx + w.normal.y * cz < -2;
      const target = cut ? 0.12 : 1;
      w.mesh.scale.y = THREE.MathUtils.lerp(w.mesh.scale.y, target, 0.2);
      for (const tr of w.trims) tr.visible = w.mesh.scale.y > 0.6;
    }
  }

  private updateTags() {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    for (const a of this.agents) {
      v.set(a.pos.x, a.seatY + a.ch.headY + 1.9, a.pos.z).project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      const dist = this.camera.position.distanceTo(a.ch.root.position);
      a.tag.style.display = visible && (this.mode === 'topdown' || dist < 30) ? '' : 'none';
      a.tag.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * r.width}px, ${((1 - v.y) / 2) * r.height}px)`;
      a.tag.classList.toggle('active', this.talkingTo === a.key);
      a.tag.classList.toggle('far', this.mode === 'topdown' && this.zoom > 75);
    }
  }
}

function isVisible(o: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
function lerpAngle(a: number, b: number, t: number) {
  return a + angleDiff(b, a) * t;
}
function angleDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
