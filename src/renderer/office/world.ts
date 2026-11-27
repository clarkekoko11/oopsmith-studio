// The studio: a cozy creative loft in the Oopsmith brand. Each team gets a production line laid out in pipeline
// order (Script → Edit → Review → Publish, left to right) with its own board and review screen; everyone shares the
// lounge at the front (coffee bar, sofa, arcade, books, plants), which is where idle agents hang out.
import * as THREE from 'three';
import type { AgentId, BacklogCard, ShortRow, TeamId } from '../../shared/types';
import type { Action, Prop } from './characters';

export interface Collider { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Wall { mesh: THREE.Mesh; normal: THREE.Vector2; trims: THREE.Object3D[] }
export interface DeskSpot {
  team: TeamId;
  agent: AgentId;
  /** team/agent */
  key: string;
  /** where the agent works */
  stand: THREE.Vector3;
  /** which way the agent faces at work (radians around Y, 0 = +Z) */
  facing: number;
  /** where you stand to talk */
  talk: THREE.Vector3;
  monitor: THREE.CanvasTexture;
}
export interface ActivitySpot {
  kind: 'coffee' | 'cooler' | 'sofa' | 'beanbag' | 'arcade' | 'read' | 'armchair' | 'water' | 'window' | 'record' | 'party' | 'fame';
  pos: THREE.Vector3;
  facing: number;
  action: Action;
  prop?: Prop;
  /** height of the seat top, for sitting */
  seatY?: number;
  /** agent key using it */
  taken: string | null;
}
export interface TeamLine {
  team: TeamId;
  name: string;
  z0: number;
  accent: string;
  drawBoard: (rows: ShortRow[]) => void;
  /** pin the backlog's next stories on Scripty's corkboard */
  drawCork: (cards: BacklogCard[]) => void;
  tv: THREE.Mesh;
  poster: THREE.Texture;
}

/** Studio upgrades, unlocked by how many Shorts are out (posted or published). */
export const MILESTONES = [
  { at: 1, name: 'First Short plaque' },
  { at: 7, name: 'Neon OOPS sign' },
  { at: 25, name: 'Trophy cups' },
  { at: 50, name: 'Disco ball' },
  { at: 100, name: 'Gold record' },
];

// ---- brand (Oopsmith brand guidelines v1.0)
export const BRAND = {
  orange: '#FF6B2C', plum: '#241726', night: '#1C1220', cream: '#FFF4E2', yellow: '#FFC94A', sky: '#2F6BB8',
  muted: '#6B5A6E', hairline: '#E8D9C2', orangeText: '#C2410C', plumSoft: '#3B2A45', violet: '#A06CD5',
};
export const DISPLAY = '"Bricolage Grotesque", system-ui, sans-serif';
export const TEXT = '"DM Sans", system-ui, sans-serif';
export const STATION_COLORS: Record<AgentId, string> = {
  'script-writer': BRAND.yellow,
  editor: BRAND.sky,
  reviewer: BRAND.orange,
  publisher: BRAND.violet,
};
export const TEAM_ACCENTS = [BRAND.orange, BRAND.sky, BRAND.yellow, BRAND.violet];
const STATION_TITLES: Record<AgentId, string> = { 'script-writer': 'Scripts', editor: 'Edit bay', reviewer: 'Review', publisher: 'Publish' };
/** pipeline order, left to right */
export const PIPELINE: AgentId[] = ['script-writer', 'editor', 'reviewer', 'publisher'];
const STATION_X = [-19.5, -6.5, 6.5, 19.5];

export const ROOM_W = 58;
export const ROOM_H = 9;
export const LINE_DEPTH = 13;
export const LOUNGE_DEPTH = 17;

const std = (color: string, rough = 0.8, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const loader = new THREE.TextureLoader();
const brandCache = new Map<string, THREE.Texture>();
/** a file from the Oopsmith brand kit (assets/brand) */
function brand(file: string): THREE.Texture {
  let t = brandCache.get(file);
  if (!t) {
    t = loader.load(`assets/brand/${file}`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    brandCache.set(file, t);
  }
  return t;
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = true) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}
const picture = (tex: THREE.Texture, w: number, h: number, transparent = false) =>
  new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent, toneMapped: false }));

function monitorTexture(agent: AgentId, line: string) {
  return canvasTex(512, 320, (g) => {
    const c = STATION_COLORS[agent];
    g.fillStyle = BRAND.night;
    g.fillRect(0, 0, 512, 320);
    g.fillStyle = c;
    g.fillRect(0, 0, 512, 60);
    g.fillStyle = agent === 'editor' || agent === 'publisher' ? BRAND.cream : BRAND.plum;
    g.font = `800 36px ${DISPLAY}`;
    g.fillText(STATION_TITLES[agent], 22, 44);
    g.fillStyle = BRAND.cream;
    g.font = `600 28px ${TEXT}`;
    g.fillText(line, 22, 124);
    g.fillStyle = '#ffffff1c';
    for (let i = 0; i < 5; i++) g.fillRect(22, 164 + i * 28, 200 + ((i * 97) % 240), 12);
    if (agent === 'editor') {
      // a little timeline
      const cols = [BRAND.orange, BRAND.yellow, BRAND.sky, BRAND.violet];
      for (let i = 0; i < 9; i++) { g.fillStyle = cols[i % 4]; g.fillRect(22 + i * 52, 286, 46, 18); }
    }
  });
}

export function updateMonitor(spot: DeskSpot, line: string) {
  const fresh = monitorTexture(spot.agent, line);
  spot.monitor.image = fresh.image;
  spot.monitor.needsUpdate = true;
}

function brickTexture() {
  const t = canvasTex(512, 512, (g) => {
    g.fillStyle = '#4a2f33';
    g.fillRect(0, 0, 512, 512);
    const tones = ['#a2523a', '#ab5c41', '#954a35', '#b5684c', '#9c573f', '#8f4532'];
    const bh = 32, bw = 96;
    for (let r = 0; r < 512 / bh; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let x = -bw; x < 512 + bw; x += bw) {
        g.fillStyle = tones[(r * 5 + Math.floor((x + off) / bw) * 3 + 7) % tones.length];
        g.fillRect(x + off + 3, r * bh + 3, bw - 6, bh - 6);
        g.fillStyle = '#ffffff0d';
        g.fillRect(x + off + 3, r * bh + 3, bw - 6, 4);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function woodTexture() {
  const t = canvasTex(1024, 1024, (g) => {
    const tones = ['#b9824f', '#b07a48', '#c08a55', '#a87142', '#b57e4c'];
    for (let r = 0; r < 16; r++) {
      let x = (r % 3) * -120;
      while (x < 1024) {
        const len = 260 + ((r * 53 + x) % 180);
        g.fillStyle = tones[(r * 7 + Math.floor(x / 97)) % tones.length];
        g.fillRect(x, r * 64, len, 64);
        g.fillStyle = '#00000020';
        g.fillRect(x, r * 64, 3, 64);
        g.fillStyle = '#ffffff0a';
        g.fillRect(x, r * 64 + 20, len, 2);
        x += len;
      }
      g.fillStyle = '#00000030';
      g.fillRect(0, r * 64 + 62, 1024, 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface World {
  root: THREE.Group;
  colliders: Collider[];
  walls: Wall[];
  desks: DeskSpot[];
  lines: TeamLine[];
  spots: ActivitySpot[];
  pickFloor: THREE.Object3D[];
  ceiling: THREE.Group;
  room: { w: number; d: number; h: number };
  playerStart: THREE.Vector3;
  /** where the team gathers to celebrate (middle of the lounge rug) */
  party: THREE.Vector3;
  update(t: number): void;
  /** daylight 0 (night) .. 1 (day), warmth 0..1 (sunrise / sunset glow) */
  setSky(daylight: number, warmth: number): void;
  /** how many Shorts are out: shows the upgrades unlocked so far */
  setMilestones(count: number): void;
}

export function buildOffice(scene: THREE.Scene, teams: { id: TeamId; name: string }[]): World {
  const root = new THREE.Group();
  scene.add(root);
  const add = (...o: THREE.Object3D[]) => root.add(...o);
  const colliders: Collider[] = [];
  const walls: Wall[] = [];
  const desks: DeskSpot[] = [];
  const lines: TeamLine[] = [];
  const spots: ActivitySpot[] = [];
  const pickFloor: THREE.Object3D[] = [];
  const animated: ((t: number) => void)[] = [];
  const N = Math.max(1, teams.length);
  const W = ROOM_W / 2, H = ROOM_H;
  const D = N * LINE_DEPTH + LOUNGE_DEPTH;
  const HD = D / 2;
  const block = (cx: number, cz: number, w: number, d: number) =>
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  const wallOf = (nx: number, nz: number) => walls.find((w) => w.normal.x === nx && w.normal.y === nz)!;

  // ---- floor: warm wood planks
  const floorTex = woodTexture();
  floorTex.repeat.set(ROOM_W / 11, D / 11);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.65 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  add(floor);
  pickFloor.push(floor);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), std(BRAND.night, 1));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  add(ground);

  // ---- exposed brick walls with a plum skirting board
  const brick = brickTexture();
  const trimMat = std(BRAND.plum, 0.6);
  const addWall = (cx: number, cz: number, len: number, alongX: boolean, nx: number, nz: number) => {
    const t = 0.6;
    const geo = new THREE.BoxGeometry(alongX ? len : t, H, alongX ? t : len);
    geo.translate(0, H / 2, 0);
    const tex = brick.clone();
    tex.repeat.set(len / 7, H / 7);
    tex.needsUpdate = true;
    const m = mesh(geo, std('#ffffff', 0.92, { map: tex }), cx, 0, cz);
    add(m);
    const trim = mesh(new THREE.BoxGeometry(alongX ? len : t + 0.12, 0.7, alongX ? t + 0.12 : len), trimMat, cx, 0.35, cz, false);
    add(trim);
    walls.push({ mesh: m, normal: new THREE.Vector2(nx, nz), trims: [] });
    block(cx, cz, alongX ? len : t + 0.4, alongX ? t + 0.4 : len);
    return walls[walls.length - 1];
  };
  addWall(0, -HD, ROOM_W + 0.6, true, 0, 1); // back
  addWall(-W, 0, D, false, 1, 0); // left
  addWall(W, 0, D, false, -1, 0); // right
  const doorHalf = 3.2;
  const frontSeg = W - doorHalf;
  const fl = addWall(-(W + doorHalf) / 2, HD, frontSeg + 0.6, true, 0, -1);
  const fr = addWall((W + doorHalf) / 2, HD, frontSeg + 0.6, true, 0, -1);
  fr.trims = fl.trims; // the two halves cut away together
  // door frame
  const doorMat = std(BRAND.plum, 0.5);
  for (const s of [-1, 1]) { const post = mesh(new THREE.BoxGeometry(0.5, 7, 0.9), doorMat, s * doorHalf, 3.5, HD); add(post); fl.trims.push(post); }
  const lintel = mesh(new THREE.BoxGeometry(doorHalf * 2 + 0.5, 0.5, 0.9), doorMat, 0, 7, HD);
  add(lintel);
  fl.trims.push(lintel);

  // ---- factory windows (steel frame, warm daylight glass)
  const drawGlass = (g: CanvasRenderingContext2D, top: string, bottom: string, stars: number) => {
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, top);
    grd.addColorStop(1, bottom);
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    if (stars > 0) {
      g.fillStyle = `rgba(255,244,226,${stars})`;
      for (let i = 0; i < 26; i++) g.fillRect((i * 97) % 250, (i * 53) % 170, i % 4 ? 2 : 3, i % 4 ? 2 : 3);
      // a small moon in the corner
      g.beginPath(); g.arc(200, 48, 16, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = BRAND.plum;
    g.lineWidth = 10;
    g.strokeRect(5, 5, 246, 246);
    g.lineWidth = 6;
    for (const p of [85, 171]) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 256); g.stroke(); g.beginPath(); g.moveTo(0, p); g.lineTo(256, p); g.stroke(); }
  };
  const glassTex = canvasTex(256, 256, (g) => drawGlass(g, '#8fb8e8', '#f6d9a8', 0));
  const windowAt = (x: number, z: number, rot: number, w: number, h: number, y: number, wall: Wall) => {
    const m = picture(glassTex, w, h);
    m.position.set(x, y, z);
    m.rotation.y = rot;
    add(m);
    wall.trims.push(m);
    const sill = mesh(new THREE.BoxGeometry(w + 0.4, 0.25, 0.6), std(BRAND.plum, 0.5), 0, 0, 0, false);
    sill.position.set(x, y - h / 2 - 0.1, z);
    sill.rotation.y = rot;
    add(sill);
    wall.trims.push(sill);
  };
  const back = wallOf(0, 1), left = wallOf(1, 0), right = wallOf(-1, 0);
  for (const x of [-13, 13]) windowAt(x, -HD + 0.34, 0, 7, 4.6, 5.6, back);
  for (const x of [-24.5, 24.5]) windowAt(x, -HD + 0.34, 0, 5, 4.6, 5.6, back);

  // ---- brand sign on the back wall: the reverse lockup on a plum panel, tagline in Spark Yellow below
  const panel = mesh(new THREE.BoxGeometry(12.4, 3.4, 0.25), std(BRAND.night, 0.5), 0, 6.2, -HD + 0.42, false);
  const lockup = picture(brand('lockup-reverse.png'), 11, 11 * (295 / 1600), true);
  lockup.position.set(0, 6.35, -HD + 0.56);
  const tagTex = canvasTex(1024, 96, (g) => {
    g.fillStyle = BRAND.yellow;
    g.font = `700 64px ${TEXT}`;
    g.textAlign = 'center';
    g.shadowColor = BRAND.yellow;
    g.shadowBlur = 18;
    g.fillText('Tiny mistakes. Huge stories.', 512, 70);
  });
  const tagline = picture(tagTex, 8, 0.75, true);
  tagline.position.set(0, 4.95, -HD + 0.56);
  add(panel, lockup, tagline);
  back.trims.push(panel, lockup, tagline);

  // ---- production lines, one per team, in pipeline order
  const loader3 = { deskTop: std('#d9b48a', 0.55), leg: std(BRAND.plum, 0.5), dark: std(BRAND.night, 0.4), paper: std(BRAND.cream, 0.9) };
  teams.forEach((team, ti) => {
    const z0 = -HD + ti * LINE_DEPTH;
    const accent = TEAM_ACCENTS[ti % TEAM_ACCENTS.length];
    const deskZ = z0 + 6.4;

    // divider planters between lines (gaps to walk through)
    if (ti > 0) {
      for (const [a, b] of [[-24.5, -15], [-9.5, 9.5], [15, 24.5]] as [number, number][]) {
        const w = b - a, cx = (a + b) / 2;
        add(mesh(new THREE.BoxGeometry(w, 1.3, 1.1), std('#8a5a3c', 0.7), cx, 0.65, z0 + 0.3));
        add(mesh(new THREE.BoxGeometry(w - 0.3, 0.15, 0.85), std('#3a2a22', 1), cx, 1.32, z0 + 0.3, false));
        for (let x = a + 1; x < b - 0.5; x += 1.6) {
          const leaf = mesh(new THREE.SphereGeometry(0.62, 10, 8), std((x * 7) % 2 > 1 ? '#4f9a5c' : '#3f8a50', 0.85), x, 1.75 + ((x * 3) % 1) * 0.3, z0 + 0.3);
          leaf.scale.y = 0.8;
          add(leaf);
        }
        block(cx, z0 + 0.3, w, 1.2);
      }
    }

    // floor track: the work flows left to right
    const trackTex = canvasTex(512, 64, (g) => {
      g.fillStyle = accent;
      g.globalAlpha = 0.85;
      g.fillRect(0, 8, 512, 48);
      g.globalAlpha = 1;
      g.fillStyle = '#ffffffaa';
      for (let x = 30; x < 512; x += 128) { g.beginPath(); g.moveTo(x, 16); g.lineTo(x + 30, 32); g.lineTo(x, 48); g.lineTo(x + 12, 32); g.fill(); }
    });
    trackTex.wrapS = THREE.RepeatWrapping;
    trackTex.repeat.set(12, 1);
    const track = new THREE.Mesh(new THREE.PlaneGeometry(46, 0.9), new THREE.MeshStandardMaterial({ map: trackTex, roughness: 0.9, transparent: true }));
    track.rotation.x = -Math.PI / 2;
    track.position.set(0, 0.02, z0 + 11.4);
    add(track);
    pickFloor.push(track);

    // overhead rail carrying film cans from desk to desk
    add(mesh(new THREE.BoxGeometry(46, 0.18, 0.18), std('#2b2030', 0.4, { metalness: 0.6 }), 0, 8.1, z0 + 2.0, false));
    for (const x of [-22, -8, 8, 22]) add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), std('#2b2030', 0.4), x, 8.6, z0 + 2.0, false));
    const cans: THREE.Group[] = [];
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Group();
      c.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), std('#555', 0.4), 0, -0.4, 0, false));
      const can = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.22, 20), std(i === 1 ? BRAND.orange : '#c9c2b8', 0.35, { metalness: 0.5 }), 0, -0.9, 0, false);
      can.rotation.x = Math.PI / 2;
      c.add(can);
      c.position.set(0, 8.1, z0 + 2.0);
      add(c);
      cans.push(c);
    }
    animated.push((t) => cans.forEach((c, i) => {
      // hop from station to station, pausing at each
      const u = (t * 0.06 + i / 3 + ti * 0.17) % 1;
      const seg = u * 4, k = Math.floor(seg), f = seg - k;
      const e = f < 0.6 ? 0 : (f - 0.6) / 0.4;
      const ease = e * e * (3 - 2 * e);
      const a = STATION_X[k], b = k < 3 ? STATION_X[k + 1] : STATION_X[0] - 6;
      c.position.x = k < 3 ? a + (b - a) * ease : a + (STATION_X[3] + 6 - a) * ease;
      c.visible = !(k === 3 && e > 0.5);
      c.rotation.z = Math.sin(t * 3 + i) * 0.05;
    }));

    // the team's pipeline board on the left wall
    const board = canvasTex(1500, 980, () => {});
    const boardMesh = picture(board, 9.6, 9.6 * (980 / 1500));
    boardMesh.position.set(-W + 0.38, 4.5, z0 + 6.6);
    boardMesh.rotation.y = Math.PI / 2;
    const bframe = mesh(new THREE.BoxGeometry(0.3, 9.6 * (980 / 1500) + 0.5, 10.1), std('#5a3b2a', 0.6), -W + 0.22, 4.5, z0 + 6.6);
    add(bframe, boardMesh);
    left.trims.push(boardMesh, bframe);
    const drawBoard = (rows: ShortRow[]) => {
      const c = board.image as HTMLCanvasElement;
      const g = c.getContext('2d')!;
      g.fillStyle = BRAND.night;
      g.fillRect(0, 0, 1500, 980);
      g.fillStyle = accent;
      g.fillRect(0, 0, 1500, 14);
      g.fillStyle = BRAND.cream;
      g.font = `800 70px ${DISPLAY}`;
      g.fillText(team.name, 50, 104);
      g.fillStyle = BRAND.yellow;
      g.font = `600 30px ${TEXT}`;
      g.fillText(`PIPELINE · ${rows.length} SHORT${rows.length === 1 ? '' : 'S'}`, 54, 152);
      const stages = ['planned', 'voiced', 'building', 'ready', 'rendering', 'review', 'delivered'];
      g.font = `600 24px ${TEXT}`;
      stages.forEach((s, i) => {
        g.fillStyle = '#ffffff12';
        g.beginPath(); g.roundRect(50 + i * 202, 186, 188, 44, 22); g.fill();
        g.fillStyle = BRAND.hairline;
        g.textAlign = 'center';
        g.fillText(s, 144 + i * 202, 216);
        g.textAlign = 'left';
      });
      if (!rows.length) {
        g.fillStyle = '#b9a9bd';
        g.font = `500 36px ${TEXT}`;
        g.fillText('No Shorts yet. Ask Scripty for a story.', 54, 340);
      }
      rows.slice(0, 8).forEach((r, i) => {
        const y = 310 + i * 84;
        g.fillStyle = i % 2 ? '#ffffff07' : '#ffffff10';
        g.fillRect(34, y - 50, 1432, 76);
        g.fillStyle = BRAND.yellow;
        g.font = `800 34px ui-monospace, monospace`;
        g.fillText(r.id, 54, y);
        g.fillStyle = BRAND.cream;
        g.font = `600 32px ${TEXT}`;
        const title = r.title.length > 34 ? r.title.slice(0, 33) + '…' : r.title;
        g.fillText(title, 250, y);
        g.fillStyle = /failed/.test(r.status) ? '#ff8a8a' : /delivered|uploaded|published|approved/.test(r.status) ? '#8be0a0' : BRAND.orange;
        g.font = `700 26px ${TEXT}`;
        g.textAlign = 'right';
        const tok = r.tokens ? ` · ${r.tokens >= 1e6 ? (r.tokens / 1e6).toFixed(1) + 'M' : Math.round(r.tokens / 1e3) + 'k'} tok` : '';
        g.fillText(`${r.status} · v${r.version}${tok}`, 1446, y);
        g.textAlign = 'left';
      });
      board.needsUpdate = true;
    };
    drawBoard([]);

    // the team's review screen on the right wall
    const poster = canvasTex(800, 450, (g) => {
      g.fillStyle = BRAND.night;
      g.fillRect(0, 0, 800, 450);
      g.fillStyle = BRAND.orange;
      g.beginPath(); g.arc(400, 190, 74, 0, Math.PI * 2); g.fill();
      g.fillStyle = BRAND.cream;
      g.beginPath(); g.moveTo(378, 152); g.lineTo(378, 228); g.lineTo(440, 190); g.fill();
      g.fillStyle = BRAND.cream;
      g.font = `700 40px ${DISPLAY}`;
      g.textAlign = 'center';
      g.fillText('Review screen', 400, 340);
      g.fillStyle = '#b9a9bd';
      g.font = `500 28px ${TEXT}`;
      g.fillText(team.name, 400, 386);
    });
    const tv = picture(poster, 7, 3.94);
    tv.position.set(W - 0.38, 4.7, z0 + 6.6);
    tv.rotation.y = -Math.PI / 2;
    const tvFrame = mesh(new THREE.BoxGeometry(0.3, 4.4, 7.5), std(BRAND.night, 0.35), W - 0.22, 4.7, z0 + 6.6);
    add(tvFrame, tv);
    right.trims.push(tv, tvFrame);
    tv.userData.screen = team.id;
    tvFrame.userData.screen = team.id;
    let corkDraw: (cards: BacklogCard[]) => void = () => {};
    let backlogEasel: THREE.Group | null = null;
    const line: TeamLine = { team: team.id, name: team.name, z0, accent, drawBoard, drawCork: (c) => corkDraw(c), tv, poster };
    lines.push(line);

    // the four desks
    PIPELINE.forEach((agent, si) => {
      const sx = STATION_X[si];
      const col = STATION_COLORS[agent];
      const g = new THREE.Group();
      g.position.set(sx, 0, deskZ);
      // desk: agent at local -z, visitors at +z
      g.add(mesh(new THREE.BoxGeometry(6, 0.25, 2.8), loader3.deskTop, 0, 2.6, 0));
      for (const [lx, lz] of [[-2.8, -1.2], [2.8, -1.2], [-2.8, 1.2], [2.8, 1.2]]) g.add(mesh(new THREE.BoxGeometry(0.2, 2.5, 0.2), loader3.leg, lx, 1.25, lz));
      g.add(mesh(new THREE.BoxGeometry(6, 1.7, 0.12), std(col, 0.6), 0, 1.65, 1.35));
      // nameplate on the front
      const plate = canvasTex(512, 128, (c) => {
        c.fillStyle = BRAND.night;
        c.beginPath(); c.roundRect(0, 0, 512, 128, 28); c.fill();
        c.fillStyle = BRAND.cream;
        c.font = `800 60px ${DISPLAY}`;
        c.textAlign = 'center';
        c.fillText(STATION_TITLES[agent], 256, 86);
      });
      const pl = picture(plate, 2.6, 0.65, true);
      pl.position.set(0, 1.85, 1.43);
      g.add(pl);
      // step number on the desk front, so the pipeline order reads at a glance
      const num = canvasTex(128, 128, (c) => {
        c.fillStyle = BRAND.cream;
        c.beginPath(); c.arc(64, 64, 58, 0, Math.PI * 2); c.fill();
        c.fillStyle = BRAND.plum;
        c.font = `800 72px ${DISPLAY}`;
        c.textAlign = 'center';
        c.fillText(String(si + 1), 64, 90);
      });
      const nm = picture(num, 0.6, 0.6, true);
      nm.position.set(-2.35, 1.85, 1.43);
      g.add(nm);
      // monitor facing the agent; the Oopsmith mark on its back faces the room
      const monitorTex = monitorTexture(agent, 'idle');
      const mon = new THREE.Group();
      mon.position.set(agent === 'publisher' ? 0.4 : 1.0, 2.75, -0.3);
      mon.rotation.y = Math.PI;
      mon.add(mesh(new THREE.BoxGeometry(agent === 'reviewer' ? 3.2 : 2.6, agent === 'reviewer' ? 2 : 1.7, 0.15), loader3.dark, 0, 1.3, 0));
      const scr = picture(monitorTex, agent === 'reviewer' ? 3 : 2.4, agent === 'reviewer' ? 1.8 : 1.5);
      scr.position.set(0, 1.3, 0.08);
      mon.add(scr);
      const logo = picture(brand('mark.png'), 0.7, 0.7, true);
      logo.position.set(0, 1.3, -0.085);
      logo.rotation.y = Math.PI;
      mon.add(logo);
      mon.add(mesh(new THREE.BoxGeometry(0.25, 0.5, 0.25), loader3.dark, 0, 0.25, 0));
      if (agent === 'publisher') mon.visible = false; // Pip works on a laptop
      g.add(mon);
      g.add(mesh(new THREE.BoxGeometry(1.4, 0.08, 0.5), loader3.dark, 0.6, 2.77, -0.95)); // keyboard
      // mug with the mark
      const mug = mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.42, 16), std(BRAND.cream, 0.4), -2.3, 2.94, -0.6);
      g.add(mug);
      // desk lamp, warm
      const lamp = new THREE.Group();
      lamp.position.set(-2.4, 2.73, 0.6);
      lamp.add(mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.1, 16), loader3.dark, 0, 0, 0));
      const arm = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), loader3.dark, 0.2, 0.7, 0);
      arm.rotation.z = -0.3;
      lamp.add(arm);
      const shade = mesh(new THREE.ConeGeometry(0.35, 0.45, 16, 1, true), std(col, 0.5, { side: THREE.DoubleSide }), 0.45, 1.35, 0);
      shade.rotation.z = 0.6;
      lamp.add(shade);
      lamp.add(mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff1c9' }), 0.38, 1.25, 0, false));
      g.add(lamp);

      // station props
      if (agent === 'script-writer') {
        for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(0.9, 0.05, 1.2), loader3.paper, -1.2 + i * 0.1, 2.76 + i * 0.05, 0.2 + i * 0.04));
        // story corkboard on an easel beside the desk: the backlog's next stories (click it to open the backlog)
        const cork = canvasTex(768, 576, () => {});
        corkDraw = (cards) => {
          const c = (cork.image as HTMLCanvasElement).getContext('2d')!;
          c.setLineDash([]);
          c.fillStyle = '#c79a66';
          c.fillRect(0, 0, 768, 576);
          c.fillStyle = '#b5885499';
          for (let i = 0; i < 260; i++) c.fillRect((i * 137) % 768, (i * 89) % 576, 3, 3);
          c.fillStyle = BRAND.plum;
          c.font = `800 40px ${DISPLAY}`;
          c.fillText('Story backlog', 28, 52);
          const ready = cards.filter((x) => x.status === 'ready');
          c.font = `600 22px ${TEXT}`;
          c.fillStyle = BRAND.plumSoft;
          c.fillText(ready.length ? `${ready.length} ready · click to sort` : 'empty · click to fill', 520, 50);
          const tones = [BRAND.yellow, BRAND.cream, '#ffd9c7', '#ffffff', BRAND.cream, BRAND.yellow];
          const shown = ready.slice(0, 6);
          if (!shown.length) {
            c.fillStyle = '#6b5a6e';
            c.font = `500 28px ${TEXT}`;
            c.fillText('Scripty pins researched stories here.', 60, 300);
          }
          shown.forEach((card, i) => {
            const x = 28 + (i % 3) * 246, y = 78 + Math.floor(i / 3) * 246;
            c.save(); c.translate(x + 110, y + 112); c.rotate(((i * 37) % 9 - 4) * 0.018);
            c.fillStyle = '#0003'; c.fillRect(-104, -100, 216, 222);
            c.fillStyle = tones[i % tones.length]; c.fillRect(-110, -106, 216, 222);
            c.fillStyle = BRAND.orangeText; c.font = `800 22px ${TEXT}`;
            c.fillText(i === 0 ? 'NEXT' : `#${i + 1}`, -94, -72);
            c.fillStyle = BRAND.plum; c.font = `800 25px ${DISPLAY}`;
            wrap(c, card.title, -94, -38, 188, 29, 3);
            c.fillStyle = BRAND.muted; c.font = `600 18px ${TEXT}`;
            if (card.when) c.fillText(card.when.slice(0, 22), -94, 92);
            c.fillStyle = i === 0 ? BRAND.orange : BRAND.sky; c.beginPath(); c.arc(-2, -96, 9, 0, Math.PI * 2); c.fill();
            c.restore();
          });
          if (shown.length > 1) {
            c.strokeStyle = BRAND.orange; c.lineWidth = 4; c.setLineDash([10, 8]);
            c.beginPath();
            shown.forEach((_, i) => { const px = 136 + (i % 3) * 246, py = 82 + Math.floor(i / 3) * 246; if (i) c.lineTo(px, py); else c.moveTo(px, py); });
            c.stroke();
          }
          cork.needsUpdate = true;
        };
        corkDraw([]);
        const easel = new THREE.Group();
        easel.position.set(-4.3, 0, -1.2);
        easel.rotation.y = 0.35;
        for (const s of [-1, 1]) { const leg = mesh(new THREE.BoxGeometry(0.12, 5.2, 0.12), std('#6a4632'), s * 0.9, 2.5, 0); leg.rotation.z = s * -0.08; easel.add(leg); }
        const cb = picture(cork, 2.4, 1.8);
        cb.position.set(0, 3.6, 0.1);
        easel.add(mesh(new THREE.BoxGeometry(2.6, 2.0, 0.1), std('#6a4632'), 0, 3.6, 0.02), cb);
        g.add(easel);
        backlogEasel = easel;
      } else if (agent === 'editor') {
        // second monitor, angled, with a timeline
        const tl = canvasTex(256, 160, (c) => {
          c.fillStyle = BRAND.night; c.fillRect(0, 0, 256, 160);
          const cols = [BRAND.orange, BRAND.yellow, BRAND.sky, BRAND.violet, BRAND.cream];
          for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) { c.fillStyle = cols[(r + i) % 5]; c.fillRect(10 + i * 40 + (r % 2) * 12, 20 + r * 32, 30 + ((i * r) % 3) * 6, 22); }
          c.fillStyle = '#ff4d4d'; c.fillRect(150, 10, 3, 140);
        });
        const m2 = new THREE.Group();
        m2.position.set(-1.6, 2.75, -0.2);
        m2.rotation.y = Math.PI + 0.45;
        m2.add(mesh(new THREE.BoxGeometry(2.2, 1.45, 0.15), loader3.dark, 0, 1.2, 0));
        const s2 = picture(tl, 2.0, 1.25);
        s2.position.set(0, 1.2, 0.08);
        m2.add(s2, mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), loader3.dark, 0, 0.25, 0));
        g.add(m2);
        const hp = mesh(new THREE.TorusGeometry(0.35, 0.06, 8, 20, Math.PI), std(BRAND.sky, 0.4), 2.4, 2.8, 0.6);
        hp.rotation.x = -Math.PI / 2;
        g.add(hp);
        const reel = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 20), std('#bdb6ad', 0.3, { metalness: 0.6 }), 2.3, 2.8, -0.6);
        g.add(reel);
        animated.push((t) => (reel.rotation.y = t * 0.6));
      } else if (agent === 'reviewer') {
        // clapperboard
        const clap = canvasTex(256, 200, (c) => {
          c.fillStyle = '#111'; c.fillRect(0, 0, 256, 200);
          for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? BRAND.cream : '#111'; c.beginPath(); c.moveTo(i * 36, 0); c.lineTo(i * 36 + 36, 0); c.lineTo(i * 36 + 20, 44); c.lineTo(i * 36 - 16, 44); c.fill(); }
          c.fillStyle = BRAND.cream; c.font = `800 38px ${DISPLAY}`; c.fillText('TAKE 1', 24, 120); c.font = `500 24px ${TEXT}`; c.fillText('scene · oops', 24, 168);
        });
        const cl = picture(clap, 1.1, 0.86);
        cl.position.set(-1.0, 3.18, 0.7);
        cl.rotation.x = -0.25;
        g.add(cl);
        // director's chair to the side
        const dc = new THREE.Group();
        dc.position.set(3.9, 0, -1.4);
        dc.rotation.y = -0.5;
        dc.add(mesh(new THREE.BoxGeometry(1.5, 0.12, 1.2), std(BRAND.orange, 0.8), 0, 1.7, 0));
        dc.add(mesh(new THREE.BoxGeometry(1.5, 0.8, 0.08), std(BRAND.orange, 0.8), 0, 2.6, -0.55));
        for (const s of [-1, 1]) { const x = mesh(new THREE.BoxGeometry(0.1, 2.0, 0.1), std('#5a3b2a'), s * 0.7, 0.9, 0); x.rotation.x = 0.4; dc.add(x); const y = x.clone(); y.rotation.x = -0.4; dc.add(y); dc.add(mesh(new THREE.BoxGeometry(0.1, 1.2, 0.1), std('#5a3b2a'), s * 0.7, 2.5, -0.55)); }
        g.add(dc);
        block(sx + 3.9, deskZ - 1.4, 1.6, 1.4);
      } else {
        // laptop
        const lap = new THREE.Group();
        lap.position.set(0.3, 2.73, -0.4);
        lap.add(mesh(new THREE.BoxGeometry(1.6, 0.07, 1.1), std('#c9c2b8', 0.3, { metalness: 0.5 }), 0, 0, 0));
        const lid = new THREE.Group();
        lid.position.set(0, 0, 0.55);
        lid.rotation.x = -1.9;
        lid.add(mesh(new THREE.BoxGeometry(1.6, 0.06, 1.1), std('#c9c2b8', 0.3, { metalness: 0.5 }), 0, 0, -0.55));
        const ls = picture(monitorTex, 1.45, 0.95);
        ls.position.set(0, -0.04, -0.55);
        ls.rotation.x = Math.PI / 2;
        lid.add(ls);
        const lg = picture(brand('mark.png'), 0.45, 0.45, true);
        lg.position.set(0, 0.04, -0.55);
        lg.rotation.x = -Math.PI / 2;
        lid.add(lg);
        lap.add(lid);
        g.add(lap);
        // outbox tray with film cans, ready to ship
        g.add(mesh(new THREE.BoxGeometry(1.3, 0.3, 1.0), std(BRAND.violet, 0.6), -1.5, 2.88, 0.3));
        for (let i = 0; i < 3; i++) { const c = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 16), std(i === 0 ? BRAND.orange : '#c9c2b8', 0.4, { metalness: 0.4 }), -1.5, 3.05 + i * 0.1, 0.3); g.add(c); }
        // "upload" light
        const up = canvasTex(256, 96, (c) => {
          c.fillStyle = BRAND.night; c.beginPath(); c.roundRect(0, 0, 256, 96, 20); c.fill();
          c.fillStyle = BRAND.violet; c.font = `800 52px ${DISPLAY}`; c.textAlign = 'center'; c.shadowColor = BRAND.violet; c.shadowBlur = 14; c.fillText('UPLOAD', 128, 66);
        });
        const ul = picture(up, 1.2, 0.45, true);
        ul.position.set(2.2, 3.1, -0.4);
        ul.rotation.y = 0;
        g.add(mesh(new THREE.BoxGeometry(1.3, 0.55, 0.2), loader3.dark, 2.2, 3.1, -0.52), ul);
      }
      // stool tucked to the side
      const stool = new THREE.Group();
      stool.position.set(agent === 'reviewer' ? -3.8 : 3.8, 0, -1.5);
      stool.add(mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.22, 18), std(col, 0.7), 0, 1.75, 0));
      stool.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.7, 8), std('#3a3036', 0.4, { metalness: 0.5 }), 0, 0.85, 0));
      stool.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 18), std('#3a3036', 0.4, { metalness: 0.5 }), 0, 0.05, 0));
      g.add(stool);
      add(g);

      const key = `${team.id}/${agent}`;
      g.traverse((o) => (o.userData.agentKey = key));
      // the corkboard opens the backlog instead of the chat
      if (backlogEasel) {
        backlogEasel.traverse((o) => { delete o.userData.agentKey; o.userData.backlog = team.id; });
        backlogEasel = null;
      }
      block(sx, deskZ, 6.2, 3.0);
      block(sx + stool.position.x, deskZ - 1.5, 1.2, 1.2);
      if (agent === 'script-writer') block(sx - 4.3, deskZ - 1.2, 2.4, 1.0);
      desks.push({
        team: team.id,
        agent,
        key,
        stand: new THREE.Vector3(sx - 0.4, 0, deskZ - 2.35),
        facing: 0,
        talk: new THREE.Vector3(sx - 0.4, 0, deskZ + 3.6),
        monitor: monitorTex,
      });
    });
  });

  // ---------------- the lounge (shared by every team)
  const L = -HD + N * LINE_DEPTH; // where the lounge starts
  // a big plum rug, with the Oopsmith mark rug in the middle
  const rugTex = canvasTex(512, 512, (g) => {
    g.fillStyle = BRAND.plumSoft;
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = BRAND.yellow;
    g.lineWidth = 10;
    g.strokeRect(24, 24, 464, 464);
    g.strokeStyle = '#ffffff22';
    g.lineWidth = 4;
    g.strokeRect(48, 48, 416, 416);
  });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(18, 12), new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.02, L + 8);
  rug.receiveShadow = true;
  add(rug);
  pickFloor.push(rug);
  const markRug = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), new THREE.MeshStandardMaterial({ map: brand('mark.png'), transparent: true, roughness: 1 }));
  markRug.rotation.x = -Math.PI / 2;
  markRug.position.set(0, 0.035, L + 3.6);
  markRug.receiveShadow = true;
  add(markRug);
  pickFloor.push(markRug);

  // the sofa: the one big orange thing
  const sofa = new THREE.Group();
  sofa.position.set(0, 0, L + 11.4);
  const sofaMat = std(BRAND.orange, 0.9);
  sofa.add(mesh(new THREE.BoxGeometry(8.6, 1.2, 2.8), sofaMat, 0, 0.95, 0));
  sofa.add(mesh(new THREE.BoxGeometry(8.6, 2.2, 0.8), sofaMat, 0, 2.0, 1.1));
  for (const s of [-1, 1]) sofa.add(mesh(new THREE.BoxGeometry(0.8, 1.8, 2.8), sofaMat, s * 4.2, 1.2, 0));
  for (let i = -1; i <= 1; i++) sofa.add(mesh(new THREE.BoxGeometry(2.55, 0.32, 2.1), std('#ff8a55', 0.95), i * 2.62, 1.66, -0.15));
  const pillow = (x: number, c: string, r: number) => { const p = mesh(new THREE.BoxGeometry(1.1, 1.1, 0.35), std(c, 0.95), x, 2.35, 0.55); p.rotation.set(-0.25, 0, r); sofa.add(p); };
  pillow(-3.3, BRAND.cream, 0.15);
  pillow(3.3, BRAND.yellow, -0.12);
  add(sofa);
  block(0, L + 11.4, 9.0, 3.0);
  for (const x of [-2.62, 0, 2.62]) spots.push({ kind: 'sofa', pos: new THREE.Vector3(x, 0, L + 10.9), facing: Math.PI, action: 'sit', seatY: 1.82, taken: null });

  // coffee table with a stack of scripts and a mug
  const table = new THREE.Group();
  table.position.set(0, 0, L + 7.2);
  table.add(mesh(new THREE.BoxGeometry(4.6, 0.25, 2.2), std('#5a3b2a', 0.5), 0, 1.25, 0));
  for (const [x, z] of [[-2, -0.9], [2, -0.9], [-2, 0.9], [2, 0.9]]) table.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.15, 8), std(BRAND.plum), x, 0.58, z));
  table.add(mesh(new THREE.BoxGeometry(1.1, 0.4, 0.85), std(BRAND.cream, 0.9), -1, 1.58, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.42, 14), std(BRAND.yellow), 1.2, 1.6, 0.2));
  add(table);
  block(0, L + 7.2, 4.8, 2.4);

  // ---- coffee bar along the left wall
  const counter = new THREE.Group();
  counter.position.set(-W + 1.6, 0, L + 6.4);
  counter.add(mesh(new THREE.BoxGeometry(2.2, 2.6, 8.4), std(BRAND.plum, 0.7), 0, 1.3, 0));
  counter.add(mesh(new THREE.BoxGeometry(2.5, 0.2, 8.7), std('#d9b48a', 0.45), 0, 2.7, 0));
  // espresso machine
  const esp = new THREE.Group();
  esp.position.set(-0.1, 2.8, -1.6);
  esp.add(mesh(new THREE.BoxGeometry(1.4, 1.5, 1.4), std('#c9c2b8', 0.25, { metalness: 0.7 }), 0, 0.75, 0));
  esp.add(mesh(new THREE.BoxGeometry(1.45, 0.3, 1.45), std(BRAND.orange, 0.5), 0, 1.55, 0));
  esp.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), std('#333', 0.3), 0.6, 0.6, 0));
  counter.add(esp);
  // jars + mugs
  for (let i = 0; i < 4; i++) counter.add(mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.4, 12), std([BRAND.cream, BRAND.yellow, BRAND.sky, BRAND.orange][i], 0.5), 0.3, 3.0, 1.0 + i * 0.6));
  counter.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.8, 14), std('#e9e2d6', 0.3, { transparent: true, opacity: 0.8 }), -0.3, 3.2, 3.4));
  // menu board above
  const menu = canvasTex(512, 384, (g) => {
    g.fillStyle = '#2a2a2e'; g.fillRect(0, 0, 512, 384);
    g.fillStyle = BRAND.yellow; g.font = `800 52px ${DISPLAY}`; g.fillText('Oops café', 34, 72);
    g.fillStyle = BRAND.cream; g.font = `500 30px ${TEXT}`;
    ['Flat white ......... 1 oops', 'Cold brew ......... 2 oops', 'Plot-twist tea .... free', 'Re-render latte ... v2'].forEach((l, i) => g.fillText(l, 34, 140 + i * 54));
  });
  const mb = picture(menu, 4.2, 3.15);
  mb.position.set(-W + 0.38, 5.6, L + 6.4);
  mb.rotation.y = Math.PI / 2;
  add(counter, mb);
  left.trims.push(mb);
  block(-W + 1.6, L + 6.4, 2.6, 8.8);
  spots.push({ kind: 'coffee', pos: new THREE.Vector3(-W + 4.4, 0, L + 4.4), facing: -Math.PI / 2, action: 'drink', prop: 'mug', taken: null });
  spots.push({ kind: 'coffee', pos: new THREE.Vector3(-W + 4.4, 0, L + 8.0), facing: -Math.PI / 2, action: 'drink', prop: 'mug', taken: null });
  // water cooler
  const cooler = new THREE.Group();
  cooler.position.set(-W + 1.4, 0, L + 13.2);
  cooler.add(mesh(new THREE.BoxGeometry(1.4, 2.6, 1.4), std('#e9edf5', 0.5), 0, 1.3, 0));
  cooler.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.5, 18), new THREE.MeshStandardMaterial({ color: '#6fb3ff', transparent: true, opacity: 0.7, roughness: 0.1 }), 0, 3.35, 0));
  add(cooler);
  block(-W + 1.4, L + 13.2, 1.8, 1.8);
  spots.push({ kind: 'cooler', pos: new THREE.Vector3(-W + 3.7, 0, L + 13.2), facing: -Math.PI / 2, action: 'drink', prop: 'cup', taken: null });

  // ---- arcade corner on the right
  const arcadeTex = canvasTex(256, 256, (g) => {
    g.fillStyle = '#120c18'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) { g.fillStyle = i % 3 ? '#ffffff88' : BRAND.yellow; g.fillRect((i * 67) % 256, (i * 131) % 256, 3, 3); }
    g.fillStyle = BRAND.orange; g.fillRect(40, 190, 28, 28); g.fillRect(48, 174, 12, 16);
    g.fillStyle = BRAND.sky; for (let i = 0; i < 6; i++) g.fillRect(30 + i * 36, 40 + (i % 2) * 18, 22, 14);
  });
  arcadeTex.wrapS = arcadeTex.wrapT = THREE.RepeatWrapping;
  const arcade = (z: number, color: string) => {
    const a = new THREE.Group();
    a.position.set(W - 1.4, 0, z);
    a.rotation.y = -Math.PI / 2;
    a.add(mesh(new THREE.BoxGeometry(1.8, 5.2, 1.6), std(BRAND.plum, 0.6), 0, 2.6, 0));
    for (const s of [-1, 1]) a.add(mesh(new THREE.BoxGeometry(0.06, 5.0, 1.62), std(color, 0.6), s * 0.93, 2.6, 0));
    const scr = picture(arcadeTex, 1.4, 1.2);
    scr.position.set(0, 3.7, 0.81);
    scr.rotation.x = -0.12;
    a.add(scr);
    a.add(mesh(new THREE.BoxGeometry(1.8, 0.3, 0.8), std('#2a2030', 0.6), 0, 2.4, 0.9));
    a.add(mesh(new THREE.SphereGeometry(0.12, 10, 8), std(BRAND.orange, 0.3), -0.3, 2.65, 1.0), mesh(new THREE.SphereGeometry(0.09, 10, 8), std(BRAND.yellow, 0.3), 0.25, 2.6, 1.0));
    const mq = canvasTex(256, 64, (g) => { g.fillStyle = color; g.fillRect(0, 0, 256, 64); g.fillStyle = BRAND.plum; g.font = `800 40px ${DISPLAY}`; g.textAlign = 'center'; g.fillText('OOPS!', 128, 48); });
    const m = picture(mq, 1.7, 0.42);
    m.position.set(0, 4.95, 0.81);
    a.add(m);
    add(a);
    block(W - 1.4, z, 1.8, 2.0);
    spots.push({ kind: 'arcade', pos: new THREE.Vector3(W - 3.8, 0, z), facing: Math.PI / 2, action: 'play', taken: null });
  };
  arcade(L + 3.0, BRAND.orange);
  arcade(L + 6.2, BRAND.sky);
  animated.push((t) => { arcadeTex.offset.x = (t * 0.15) % 1; });

  // bean bags
  const bean = (x: number, z: number, c: string, face: number) => {
    const b = mesh(new THREE.SphereGeometry(1.3, 18, 12), std(c, 0.95), x, 0.7, z);
    b.scale.set(1, 0.55, 1);
    add(b);
    block(x, z, 1.8, 1.8);
    spots.push({ kind: 'beanbag', pos: new THREE.Vector3(x + Math.sin(face) * 0.5, 0, z + Math.cos(face) * 0.5), facing: face, action: 'sit', seatY: 1.05, taken: null });
  };
  bean(14, L + 5.0, BRAND.sky, -2.4);
  bean(17.5, L + 8.2, BRAND.yellow, -2.0);

  // bookshelf + armchair reading nook (right wall, front)
  const shelf = new THREE.Group();
  shelf.position.set(W - 1.0, 0, L + 12.6);
  shelf.add(mesh(new THREE.BoxGeometry(1.4, 5, 5), std('#6a4632', 0.7), 0, 2.5, 0));
  const bookColors = [BRAND.orange, BRAND.sky, BRAND.yellow, BRAND.cream, BRAND.violet, BRAND.plumSoft];
  for (let r = 0; r < 3; r++) for (let i = 0; i < 8; i++) shelf.add(mesh(new THREE.BoxGeometry(1.0, 1.0 + ((i * 7 + r) % 3) * 0.12, 0.45), std(bookColors[(r * 2 + i) % 6]), -0.3, 0.9 + r * 1.55, -2.0 + i * 0.55));
  add(shelf);
  right.trims.push(shelf);
  block(W - 1.0, L + 12.6, 1.8, 5.2);
  spots.push({ kind: 'read', pos: new THREE.Vector3(W - 3.2, 0, L + 11.4), facing: Math.PI / 2, action: 'read', prop: 'book', taken: null });
  const chair = new THREE.Group();
  chair.position.set(W - 6.2, 0, L + 14.4);
  chair.rotation.y = -2.5;
  const chairMat = std(BRAND.sky, 0.9);
  chair.add(mesh(new THREE.BoxGeometry(2.4, 1.2, 2.2), chairMat, 0, 0.9, 0));
  chair.add(mesh(new THREE.BoxGeometry(2.4, 2.2, 0.6), chairMat, 0, 2.0, -0.85));
  for (const s of [-1, 1]) chair.add(mesh(new THREE.BoxGeometry(0.5, 1.7, 2.2), chairMat, s * 1.2, 1.2, 0));
  add(chair);
  block(W - 6.2, L + 14.4, 2.6, 2.6);
  spots.push({ kind: 'armchair', pos: new THREE.Vector3(W - 6.2 + Math.sin(-2.5) * 0.25, 0, L + 14.4 + Math.cos(-2.5) * 0.25), facing: -2.5, action: 'readSit', prop: 'book', seatY: 1.55, taken: null });
  // floor lamp by the chair
  const fl2 = new THREE.Group();
  fl2.position.set(W - 3.2, 0, L + 15.6);
  fl2.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 5.6, 8), std(BRAND.plum), 0, 2.8, 0));
  fl2.add(mesh(new THREE.CylinderGeometry(0.6, 0.9, 1.0, 16, 1, true), std(BRAND.cream, 0.8, { side: THREE.DoubleSide, emissive: '#ffcf8a', emissiveIntensity: 0.6 }), 0, 5.6, 0));
  add(fl2);
  block(W - 3.2, L + 15.6, 0.8, 0.8);

  // record player on a sideboard by the front wall
  const side = new THREE.Group();
  side.position.set(-9, 0, HD - 1.3);
  side.add(mesh(new THREE.BoxGeometry(5, 2.0, 1.4), std('#6a4632', 0.6), 0, 1.0, 0));
  for (let i = 0; i < 3; i++) side.add(mesh(new THREE.BoxGeometry(1.4, 1.4, 0.05), std(bookColors[i + 1], 0.8), -1.6 + i * 1.6, 1.0, -0.72));
  side.add(mesh(new THREE.BoxGeometry(1.8, 0.3, 1.2), std(BRAND.plum, 0.4), 1.1, 2.15, 0));
  const vinyl = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 24), std('#111', 0.3), 1.1, 2.33, 0);
  const label = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 16), std(BRAND.orange, 0.5), 1.1, 2.34, 0, false);
  side.add(vinyl, label);
  add(side);
  block(-9, HD - 1.3, 5.2, 1.6);
  animated.push((t) => { vinyl.rotation.y = t * 3.5; label.rotation.y = t * 3.5; });
  spots.push({ kind: 'record', pos: new THREE.Vector3(-9, 0, HD - 3.6), facing: Math.PI, action: 'dance', taken: null });

  // plants (and somebody has to water them)
  const plant = (x: number, z: number, s = 1, water?: { dx: number; dz: number }) => {
    const p = new THREE.Group();
    p.position.set(x, 0, z);
    p.add(mesh(new THREE.CylinderGeometry(0.7 * s, 0.55 * s, 1.3 * s, 16), std('#c8643f', 0.8), 0, 0.65 * s, 0));
    for (let i = 0; i < 5; i++) {
      const leaf = mesh(new THREE.SphereGeometry(0.75 * s, 14, 10), std(i % 2 ? '#3f8a50' : '#56a865', 0.8), Math.cos(i * 1.3) * 0.45 * s, (1.8 + i * 0.42) * s, Math.sin(i * 1.3) * 0.45 * s);
      leaf.scale.y = 1.25;
      p.add(leaf);
    }
    add(p);
    block(x, z, 1.6 * s, 1.6 * s);
    if (water) spots.push({ kind: 'water', pos: new THREE.Vector3(x + water.dx, 0, z + water.dz), facing: Math.atan2(-water.dx, -water.dz), action: 'water', prop: 'can', taken: null });
  };
  plant(-W + 1.8, HD - 1.8, 1.2, { dx: 2.4, dz: -0.6 });
  plant(W - 1.8, HD - 1.8, 1.2);
  plant(-6.6, L + 11.2, 0.9, { dx: -0.2, dz: -2.1 });
  plant(6.6, L + 11.2, 0.9, { dx: 0.2, dz: -2.1 });
  plant(-4.8, HD - 1.4, 0.8);
  plant(4.8, HD - 1.4, 0.8);
  // window gazing spots
  for (const s of [-1, 1]) {
    windowAt(s * (W - 0.34), L + 3, s < 0 ? Math.PI / 2 : -Math.PI / 2, 4.5, 3.4, 6.4, s < 0 ? left : right);
    windowAt(s * (W - 0.34), L + 10.5, s < 0 ? Math.PI / 2 : -Math.PI / 2, 4.5, 3.4, 6.4, s < 0 ? left : right);
  }
  spots.push({ kind: 'window', pos: new THREE.Vector3(W - 3.6, 0, L + 9.0), facing: Math.PI / 2, action: 'look', taken: null });
  spots.push({ kind: 'window', pos: new THREE.Vector3(-W + 3.8, 0, L + 11.4), facing: -Math.PI / 2, action: 'look', taken: null });

  // brand posters: end card + YouTube banner, framed
  const framed = (tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, rot: number, wall: Wall) => {
    const f = mesh(new THREE.BoxGeometry(w + 0.4, h + 0.4, 0.15), std(BRAND.plum, 0.5), 0, 0, 0, false);
    f.position.set(x - Math.sin(rot) * 0.05, y, z - Math.cos(rot) * 0.05);
    f.rotation.y = rot;
    const p = picture(tex, w, h);
    p.position.set(x + Math.sin(rot) * 0.05, y, z + Math.cos(rot) * 0.05);
    p.rotation.y = rot;
    add(f, p);
    wall.trims.push(f, p);
  };
  framed(brand('end-card.png'), 2.4, 4.27, W - 0.4, 4.8, L + 0.2 + 0.0, -Math.PI / 2, right);
  framed(brand('banner.png'), 5.4, 3.04, -W + 0.4, 4.8, HD - 3.0, Math.PI / 2, left);
  framed(brand('thumb-layout.png'), 3.6, 2.03, W - 0.4, 5.0, HD - 3.0, -Math.PI / 2, right);

  // door mat
  const matTex = canvasTex(512, 220, (g) => { g.fillStyle = BRAND.plum; g.fillRect(0, 0, 512, 220); g.fillStyle = BRAND.cream; g.font = `800 64px ${DISPLAY}`; g.textAlign = 'center'; g.fillText('oops, hi!', 256, 132); });
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.2), new THREE.MeshStandardMaterial({ map: matTex, roughness: 1 }));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(0, 0.03, HD - 1.4);
  add(mat);
  pickFloor.push(mat);

  // string lights across the lounge
  const bulbs: THREE.Mesh[] = [];
  const strands = new THREE.Group();
  const bulbMat = [new THREE.MeshBasicMaterial({ color: '#ffd98a' }), new THREE.MeshBasicMaterial({ color: '#ffb36b' }), new THREE.MeshBasicMaterial({ color: '#fff1c9' })];
  for (const z of [L + 2.5, L + 9.5]) {
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = -W + 0.5 + u * (ROOM_W - 1);
      const y = 8.4 - Math.sin(u * Math.PI) * 1.4;
      const b = mesh(new THREE.SphereGeometry(0.14, 8, 6), bulbMat[i % 3], x, y, z + Math.sin(u * 9) * 0.2, false);
      b.receiveShadow = false;
      strands.add(b);
      bulbs.push(b);
    }
  }
  animated.push((t) => bulbs.forEach((b, i) => b.scale.setScalar(0.85 + 0.25 * (0.5 + 0.5 * Math.sin(t * 1.6 + i * 1.7)))));

  // ---- Hall of Fame: studio upgrades unlocked by how many Shorts are out
  const fameTex = canvasTex(1024, 640, () => {});
  const fame = new THREE.Group();
  fame.position.set(-16.5, 0, L + 14.6);
  fame.add(mesh(new THREE.BoxGeometry(7.2, 4.6, 0.35), std(BRAND.plum, 0.6), 0, 3.4, 0));
  for (const sx of [-3.2, 3.2]) fame.add(mesh(new THREE.BoxGeometry(0.3, 1.2, 0.8), std('#3a2a22', 0.7), sx, 0.6, 0));
  const famePic = picture(fameTex, 6.8, 4.25);
  famePic.position.set(0, 3.4, 0.19);
  fame.add(famePic);
  // trophy cups on top (25+)
  const cups = new THREE.Group();
  const gold = std('#e9b949', 0.25, { metalness: 0.85 });
  for (let i = 0; i < 3; i++) {
    const cup = new THREE.Group();
    cup.position.set(-1.6 + i * 1.6, 5.75, 0);
    const sc = i === 1 ? 1.25 : 1;
    cup.add(mesh(new THREE.CylinderGeometry(0.28 * sc, 0.18 * sc, 0.5 * sc, 16), gold, 0, 0.45 * sc, 0, false));
    cup.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3 * sc, 8), gold, 0, 0.1, 0, false));
    cup.add(mesh(new THREE.BoxGeometry(0.4 * sc, 0.08, 0.3 * sc), gold, 0, -0.05, 0, false));
    cups.add(cup);
  }
  fame.add(cups);
  add(fame);
  block(-16.5, L + 14.6, 7.6, 1.0);
  // neon OOPS sign above the arcades (7+)
  const neonTex = canvasTex(512, 200, (g) => {
    g.font = `800 150px ${DISPLAY}`;
    g.textAlign = 'center';
    g.shadowColor = BRAND.orange;
    g.shadowBlur = 30;
    g.strokeStyle = BRAND.orange;
    g.lineWidth = 10;
    g.strokeText('OOPS', 256, 160);
    g.fillStyle = '#ffd3bd';
    g.fillText('OOPS', 256, 160);
  });
  const neon = picture(neonTex, 2.8, 1.1, true);
  neon.position.set(W - 0.4, 7.25, L + 6.9);
  neon.rotation.y = -Math.PI / 2;
  add(neon);
  right.trims.push(neon);
  // disco ball over the record corner (50+)
  const discoTex = canvasTex(256, 128, (g) => {
    for (let y = 0; y < 128; y += 8) for (let x = 0; x < 256; x += 8) { g.fillStyle = ['#f4f1ea', '#bdb6ad', '#ffffff', '#8f8a84'][((x + y) / 8 + (y % 3)) % 4]; g.fillRect(x, y, 7, 7); }
  });
  const disco = new THREE.Group();
  disco.position.set(-9, 7.6, HD - 3.6);
  disco.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), std('#222'), 0, 1.0, 0, false));
  const ball = mesh(new THREE.SphereGeometry(0.75, 24, 16), new THREE.MeshStandardMaterial({ map: discoTex, metalness: 0.9, roughness: 0.15 }), 0, 0, 0, false);
  disco.add(ball);
  add(disco);
  const discoLight = new THREE.PointLight('#a06cd5', 0, 14, 1.6);
  discoLight.position.set(-9, 6.5, HD - 3.6);
  add(discoLight);
  animated.push((t) => {
    ball.rotation.y = t * 0.8;
    if (disco.visible) discoLight.color.setHSL((t * 0.07) % 1, 0.8, 0.6);
  });
  let fameCount = -1;
  const setMilestones = (count: number) => {
    if (count === fameCount) return;
    fameCount = count;
    const c = (fameTex.image as HTMLCanvasElement).getContext('2d')!;
    c.fillStyle = BRAND.night;
    c.fillRect(0, 0, 1024, 640);
    c.fillStyle = BRAND.yellow;
    c.font = `800 64px ${DISPLAY}`;
    c.fillText('Hall of Fame', 48, 92);
    c.fillStyle = BRAND.cream;
    c.font = `600 34px ${TEXT}`;
    c.textAlign = 'right';
    c.fillText(`${count} Short${count === 1 ? '' : 's'} out`, 976, 88);
    c.textAlign = 'left';
    MILESTONES.forEach((m, i) => {
      const x = 48 + i * 188, y = 150;
      const on = count >= m.at;
      c.fillStyle = on ? '#ffffff14' : '#ffffff08';
      c.beginPath(); c.roundRect(x, y, 170, 420, 22); c.fill();
      c.strokeStyle = on ? BRAND.yellow : '#ffffff22';
      c.lineWidth = 4;
      c.stroke();
      // badge
      c.beginPath(); c.arc(x + 85, y + 120, 62, 0, Math.PI * 2);
      c.fillStyle = on ? (i === 4 ? '#e9b949' : [BRAND.orange, BRAND.orange, BRAND.yellow, BRAND.violet, '#e9b949'][i]) : '#ffffff10';
      c.fill();
      c.fillStyle = on ? BRAND.night : '#ffffff40';
      c.font = `800 ${m.at >= 100 ? 52 : 62}px ${DISPLAY}`;
      c.textAlign = 'center';
      c.fillText(String(m.at), x + 85, y + 142);
      c.font = `700 26px ${TEXT}`;
      c.fillStyle = on ? BRAND.cream : '#ffffff55';
      wrap(c, m.name, x + 85, y + 240, 150, 32, 3, true);
      c.font = `600 22px ${TEXT}`;
      c.fillStyle = on ? '#8be0a0' : BRAND.muted;
      c.fillText(on ? 'unlocked' : `at ${m.at} out`, x + 85, y + 380);
      c.textAlign = 'left';
    });
    fameTex.needsUpdate = true;
    neon.visible = count >= 7;
    cups.visible = count >= 25;
    disco.visible = count >= 50;
    discoLight.intensity = count >= 50 ? 18 : 0;
  };
  setMilestones(0);
  spots.push({ kind: 'fame', pos: new THREE.Vector3(-15.5, 0, L + 16.0), facing: Math.PI, action: 'look', taken: null });

  // ---- the sky outside the windows follows the time of day
  let lastSky = '';
  const setSky = (daylight: number, warmth: number) => {
    const key = `${daylight.toFixed(2)}|${warmth.toFixed(2)}`;
    if (key === lastSky) return;
    lastSky = key;
    const mix = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
    const dayTop = mix('#8fb8e8', '#e98a5a', warmth), dayBottom = mix('#f6d9a8', '#ffc98a', warmth);
    const top = mix('#0d1030', dayTop, daylight), bottom = mix('#2a1f4a', dayBottom, daylight);
    drawGlass(glassTex.image.getContext('2d') as CanvasRenderingContext2D, top, bottom, Math.max(0, 1 - daylight * 2.2));
    glassTex.needsUpdate = true;
  };

  // ceiling with beams and pendant lamps: only in first person (top-down looks in from above)
  const ceiling = new THREE.Group();
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, D), std('#3b2a30', 1));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  ceiling.add(ceil);
  const beamMat = std('#5a3b2a', 0.7);
  for (let x = -W + 3; x < W; x += 7) ceiling.add(mesh(new THREE.BoxGeometry(0.7, 0.7, D), beamMat, x, H - 0.4, 0, false));
  const duct = mesh(new THREE.CylinderGeometry(0.6, 0.6, D, 16), std('#9a948c', 0.4, { metalness: 0.6 }), -W + 6, H - 1.2, 0, false);
  duct.rotation.x = Math.PI / 2;
  ceiling.add(duct);
  for (const d of desks) {
    ceiling.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 4), std('#222'), d.stand.x + 0.4, H - 1.2, d.stand.z + 2.3, false));
    const sh = mesh(new THREE.ConeGeometry(0.8, 0.7, 18, 1, true), std(BRAND.plum, 0.5, { side: THREE.DoubleSide }), d.stand.x + 0.4, H - 2.6, d.stand.z + 2.3, false);
    ceiling.add(sh);
    ceiling.add(mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: '#fff1c9' }), d.stand.x + 0.4, H - 2.85, d.stand.z + 2.3, false));
  }
  ceiling.add(strands);
  ceiling.visible = false;
  add(ceiling);

  return {
    root, colliders, walls, desks, lines, spots, pickFloor, ceiling,
    room: { w: ROOM_W, d: D, h: H },
    playerStart: new THREE.Vector3(0, 0, HD - 3.2),
    party: new THREE.Vector3(0, 0, L + 3.6),
    update: (t) => { for (const f of animated) f(t); },
    setSky,
    setMilestones,
  };
}

/** Word-wrap text onto a canvas, at most `lines` lines (the last one ends in … if it doesn't fit). */
function wrap(c: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number, lines: number, center = false) {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const word of words) {
    const t = cur ? `${cur} ${word}` : word;
    if (c.measureText(t).width > w && cur) { out.push(cur); cur = word; } else cur = t;
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    out.length = lines;
    let last = out[lines - 1];
    while (c.measureText(last + '…').width > w && last.length > 1) last = last.slice(0, -1);
    out[lines - 1] = last + '…';
  }
  const prev = c.textAlign;
  if (center) c.textAlign = 'center';
  out.forEach((l, i) => c.fillText(l, x, y + i * lh));
  c.textAlign = prev;
}
