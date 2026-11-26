// The office: room, cut-away walls, desks, pipeline board, review screen, lounge and props.
import * as THREE from 'three';
import type { AgentId, ShortRow } from '../../shared/types';

export interface Collider { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Wall { mesh: THREE.Mesh; normal: THREE.Vector2; fullHeight: number; trims: THREE.Object3D[] }
export interface DeskSpot {
  agent: AgentId;
  /** where the agent stands */
  stand: THREE.Vector3;
  /** which way the agent faces (radians around Y, 0 = +Z) */
  facing: number;
  /** where you stand to talk */
  talk: THREE.Vector3;
  pickables: THREE.Object3D[];
  monitor: THREE.CanvasTexture;
}

export const ROOM = { w: 44, d: 32, h: 9 };

const std = (color: string, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough });

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

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, shadow = true) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}

const ROLE_COLORS: Record<AgentId, string> = {
  'script-writer': '#ffb84d',
  editor: '#5ec8ff',
  reviewer: '#ff6b8b',
  publisher: '#7be07b',
};
const ROLE_TITLES: Record<AgentId, string> = {
  'script-writer': 'SCRIPTS',
  editor: 'EDIT BAY',
  reviewer: 'REVIEW',
  publisher: 'PUBLISH',
};

function monitorTexture(agent: AgentId, line: string) {
  return canvasTex(512, 320, (g) => {
    const c = ROLE_COLORS[agent];
    g.fillStyle = '#10131c';
    g.fillRect(0, 0, 512, 320);
    g.fillStyle = c;
    g.fillRect(0, 0, 512, 56);
    g.fillStyle = '#10131c';
    g.font = '800 34px system-ui, sans-serif';
    g.fillText(ROLE_TITLES[agent], 22, 40);
    g.fillStyle = '#e8ecf6';
    g.font = '600 26px system-ui, sans-serif';
    g.fillText(line, 22, 120);
    g.fillStyle = '#ffffff22';
    for (let i = 0; i < 5; i++) g.fillRect(22, 160 + i * 28, 200 + ((i * 97) % 240), 12);
  });
}

export function updateMonitor(spot: DeskSpot, line: string) {
  const fresh = monitorTexture(spot.agent, line);
  spot.monitor.image = fresh.image;
  spot.monitor.needsUpdate = true;
}

export function buildOffice(scene: THREE.Scene) {
  const colliders: Collider[] = [];
  const walls: Wall[] = [];
  const desks: DeskSpot[] = [];
  const pickFloor: THREE.Object3D[] = [];
  const W = ROOM.w / 2, D = ROOM.d / 2, H = ROOM.h;
  const block = (cx: number, cz: number, w: number, d: number) =>
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });

  // ---- floor: warm wood planks
  const floorTex = canvasTex(1024, 1024, (g) => {
    const tones = ['#c9935c', '#c08852', '#d09a63', '#b98149', '#c68e57'];
    for (let r = 0; r < 16; r++) {
      let x = (r % 3) * -120;
      while (x < 1024) {
        const len = 260 + ((r * 53 + x) % 180);
        g.fillStyle = tones[(r * 7 + Math.floor(x / 97)) % tones.length];
        g.fillRect(x, r * 64, len, 64);
        g.fillStyle = '#00000022';
        g.fillRect(x, r * 64, 3, 64);
        x += len;
      }
      g.fillStyle = '#00000030';
      g.fillRect(0, r * 64 + 62, 1024, 2);
    }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(4, 3);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  scene.add(floor);
  pickFloor.push(floor);

  // ground outside the room so cut-away walls don't show void
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), std('#2a2d3e', 1));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  // ---- walls (each knows its inward normal so the camera can cut away the ones in front)
  const wallMat = std('#efe6d8', 0.9);
  const trimMat = std('#5d4a6e', 0.6);
  const addWall = (cx: number, cz: number, len: number, alongX: boolean, nx: number, nz: number) => {
    const t = 0.6;
    const geo = new THREE.BoxGeometry(alongX ? len : t, H, alongX ? t : len);
    geo.translate(0, H / 2, 0);
    const m = mesh(geo, wallMat.clone(), cx, 0, cz);
    scene.add(m);
    const trim = mesh(new THREE.BoxGeometry(alongX ? len : t + 0.1, 0.6, alongX ? t + 0.1 : len), trimMat, cx, 0.3, cz, false);
    scene.add(trim);
    walls.push({ mesh: m, normal: new THREE.Vector2(nx, nz), fullHeight: H, trims: [] });
    block(cx, cz, alongX ? len : t + 0.4, alongX ? t + 0.4 : len);
  };
  addWall(0, -D, ROOM.w + 0.6, true, 0, 1); // back
  addWall(-W, 0, ROOM.d, false, 1, 0); // left
  addWall(W, 0, ROOM.d, false, -1, 0); // right
  // front wall with a door gap (x -3..3)
  addWall(-(W + 3) / 2 - 0.0, D, W - 3 + 0.6, true, 0, -1);
  walls[walls.length - 1].mesh.position.x = -(W + 3) / 2;
  addWall((W + 3) / 2, D, W - 3 + 0.6, true, 0, -1);

  // windows on the side walls (light panels)
  const glass = new THREE.MeshStandardMaterial({ color: '#bfe6ff', emissive: '#8fd0ff', emissiveIntensity: 0.55, roughness: 0.2 });
  for (const z of [-8, 6]) {
    for (const s of [-1, 1]) {
      const win = mesh(new THREE.BoxGeometry(0.15, 3.6, 6), glass, s * (W - 0.36), 4.8, z, false);
      win.userData.wallSide = s;
      scene.add(win);
      walls.find((w) => w.normal.x === -s)!.trims.push(win);
    }
  }

  // ---- sign above the board
  const sign = canvasTex(1024, 160, (g) => {
    g.fillStyle = '#5d4a6e';
    g.beginPath(); g.roundRect(0, 0, 1024, 160, 40); g.fill();
    g.fillStyle = '#ffd34d';
    g.font = 'italic 900 96px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('OOPSMITH STUDIO', 512, 112);
  });
  const signMesh = mesh(new THREE.PlaneGeometry(12, 1.9), new THREE.MeshBasicMaterial({ map: sign, transparent: true }), 0, 7.8, -D + 0.35, false);
  scene.add(signMesh);
  walls[0].trims.push(signMesh);

  // ---- pipeline board (back wall)
  const board = canvasTex(1600, 720, () => {});
  const boardMesh = mesh(new THREE.PlaneGeometry(15, 6.75), new THREE.MeshBasicMaterial({ map: board }), 0, 3.9, -D + 0.36, false);
  const frame = mesh(new THREE.BoxGeometry(15.6, 7.3, 0.3), std('#2b2d3a', 0.5), 0, 3.9, -D + 0.2);
  scene.add(frame, boardMesh);
  walls[0].trims.push(boardMesh, frame);
  const drawBoard = (rows: ShortRow[]) => {
    const c = board.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    g.fillStyle = '#151824';
    g.fillRect(0, 0, 1600, 720);
    g.fillStyle = '#ffd34d';
    g.font = '900 64px system-ui, sans-serif';
    g.fillText('PIPELINE', 56, 92);
    g.fillStyle = '#8a91a8';
    g.font = '600 30px system-ui, sans-serif';
    g.fillText(`${rows.length} short${rows.length === 1 ? '' : 's'}`, 410, 90);
    const stages = ['planned', 'voiced', 'building', 'ready', 'rendering', 'review', 'delivered'];
    g.font = '700 26px system-ui, sans-serif';
    stages.forEach((s, i) => {
      g.fillStyle = '#ffffff10';
      g.beginPath(); g.roundRect(56 + i * 214, 128, 200, 46, 23); g.fill();
      g.fillStyle = '#c9cee0';
      g.textAlign = 'center';
      g.fillText(s, 156 + i * 214, 160);
      g.textAlign = 'left';
    });
    if (!rows.length) {
      g.fillStyle = '#8a91a8';
      g.font = '600 34px system-ui, sans-serif';
      g.fillText('No Shorts yet — ask Scripty for a story.', 56, 280);
    }
    rows.slice(0, 6).forEach((r, i) => {
      const y = 230 + i * 78;
      g.fillStyle = i % 2 ? '#ffffff08' : '#ffffff12';
      g.fillRect(40, y - 44, 1520, 70);
      g.fillStyle = '#ffd34d';
      g.font = '800 34px ui-monospace, monospace';
      g.fillText(r.id, 56, y);
      g.fillStyle = '#eef1fa';
      g.font = '600 32px system-ui, sans-serif';
      const t = r.title.length > 40 ? r.title.slice(0, 39) + '…' : r.title;
      g.fillText(t, 250, y);
      g.fillStyle = /failed/.test(r.status) ? '#ff6b8b' : /delivered|uploaded|published/.test(r.status) ? '#7be07b' : '#ffd34d';
      g.font = '700 28px system-ui, sans-serif';
      g.textAlign = 'right';
      const tok = r.tokens ? ` · ${r.tokens >= 1e6 ? (r.tokens / 1e6).toFixed(1) + 'M' : Math.round(r.tokens / 1e3) + 'k'} tok` : '';
      g.fillText(`${r.status} · v${r.version}${tok}`, 1540, y);
      g.textAlign = 'left';
    });
    board.needsUpdate = true;
  };
  drawBoard([]);

  // ---- review screen (back wall, right)
  const review = canvasTex(800, 450, (g) => {
    g.fillStyle = '#0d0f17';
    g.fillRect(0, 0, 800, 450);
    g.strokeStyle = '#ff6b8b';
    g.lineWidth = 10;
    g.beginPath(); g.arc(400, 200, 70, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ff6b8b';
    g.beginPath(); g.moveTo(380, 165); g.lineTo(380, 235); g.lineTo(440, 200); g.fill();
    g.fillStyle = '#c9cee0';
    g.font = '700 40px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('Review screen — click to open', 400, 350);
  });
  const tv = mesh(new THREE.PlaneGeometry(7, 3.94), new THREE.MeshBasicMaterial({ map: review }), 14.5, 5.2, -D + 0.36, false);
  const tvFrame = mesh(new THREE.BoxGeometry(7.4, 4.3, 0.3), std('#1d1f2a', 0.4), 14.5, 5.2, -D + 0.2);
  scene.add(tvFrame, tv);
  walls[0].trims.push(tv, tvFrame);
  tv.userData.screen = 'review';
  tvFrame.userData.screen = 'review';

  // ---- desks: two on the left wall, two on the right, agents stand behind them facing the room
  const deskTop = std('#f4f1ea', 0.5);
  const deskLeg = std('#4b4f63', 0.5);
  const mkDesk = (agent: AgentId, side: -1 | 1, z: number) => {
    const g = new THREE.Group();
    const dx = side * 14.5; // desk centre x
    g.position.set(dx, 0, z);
    g.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; // front of desk faces room centre
    // local frame: desk spans x -3..3, z -1.4..1.4, agent at local z = -3.6 (behind), visitor at +z
    const top = mesh(new THREE.BoxGeometry(6, 0.25, 2.8), deskTop, 0, 2.6, 0);
    g.add(top);
    for (const [lx, lz] of [[-2.8, -1.2], [2.8, -1.2], [-2.8, 1.2], [2.8, 1.2]]) g.add(mesh(new THREE.BoxGeometry(0.22, 2.5, 0.22), deskLeg, lx, 1.25, lz));
    const front = mesh(new THREE.BoxGeometry(6, 1.6, 0.12), std(ROLE_COLORS[agent], 0.6), 0, 1.7, 1.35);
    g.add(front);
    // monitor facing the agent
    const monitorTex = monitorTexture(agent, 'idle');
    const mon = new THREE.Group();
    mon.position.set(1.9, 2.75, -0.4);
    mon.rotation.y = Math.PI; // screen faces agent (-z)
    mon.add(mesh(new THREE.BoxGeometry(2.6, 1.7, 0.15), std('#1d1f2a', 0.4), 0, 1.25, 0));
    const screen = mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ map: monitorTex }), 0, 1.25, 0.08, false);
    mon.add(screen);
    mon.add(mesh(new THREE.BoxGeometry(0.25, 0.5, 0.25), std('#1d1f2a'), 0, 0.25, 0));
    g.add(mon);
    // back of the monitor faces the visitor: small logo dot
    g.add(mesh(new THREE.BoxGeometry(1.4, 0.08, 0.5), std('#2b2d3a'), 1.6, 2.77, -0.95)); // keyboard
    const mug = mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.4, 14), std(ROLE_COLORS[agent], 0.5), -2.2, 2.92, -0.3);
    g.add(mug);
    // papers / props per role
    if (agent === 'script-writer') {
      for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(0.9, 0.04, 1.2), std('#ffffff', 0.9), -1.4 + i * 0.12, 2.75 + i * 0.04, 0.3 + i * 0.05));
    }
    // nameplate on the front
    const plate = canvasTex(512, 128, (c) => {
      c.fillStyle = '#1d1f2a';
      c.beginPath(); c.roundRect(0, 0, 512, 128, 24); c.fill();
      c.fillStyle = '#fff';
      c.font = '800 56px system-ui, sans-serif';
      c.textAlign = 'center';
      c.fillText(ROLE_TITLES[agent], 256, 84);
    });
    g.add(mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: plate, transparent: true }), 0, 1.9, 1.43, false));
    // chair behind
    const chair = new THREE.Group();
    chair.position.set(-2.2, 0, -3.2);
    chair.add(mesh(new THREE.BoxGeometry(1.6, 0.3, 1.6), std('#3a3d52'), 0, 1.6, 0));
    chair.add(mesh(new THREE.BoxGeometry(1.6, 2, 0.25), std('#3a3d52'), 0, 2.7, -0.75));
    chair.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.5, 8), std('#888'), 0, 0.75, 0));
    g.add(chair);
    scene.add(g);

    const toWorld = (lx: number, lz: number) => new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y).add(g.position);
    const stand = toWorld(-0.4, -3.4);
    const talk = toWorld(-0.4, 4.2);
    const facing = g.rotation.y; // local +z → world
    // colliders: desk + agent zone + chair (in world space, desks are axis aligned after rotation)
    block(dx, z, 2.8, 6);
    block(side * (W - 3.8), z, 5.2, 7);
    desks.push({ agent, stand, facing, talk, pickables: [g], monitor: monitorTex });
    g.traverse((o) => (o.userData.agent = agent));
  };
  mkDesk('script-writer', -1, -7);
  mkDesk('editor', -1, 6);
  mkDesk('reviewer', 1, -7);
  mkDesk('publisher', 1, 6);

  // ---- lounge: rug, couch facing the board, coffee table
  const rugTex = canvasTex(512, 512, (g) => {
    g.fillStyle = '#6a5acd';
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = '#ffd34d';
    g.lineWidth = 18;
    g.strokeRect(30, 30, 452, 452);
    g.strokeStyle = '#ffffff55';
    g.lineWidth = 6;
    g.strokeRect(70, 70, 372, 372);
  });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(12, 9), new THREE.MeshStandardMaterial({ map: rugTex, roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.02, 0);
  rug.receiveShadow = true;
  scene.add(rug);
  pickFloor.push(rug);
  const couchMat = std('#ff7a59', 0.85);
  const couch = new THREE.Group();
  couch.position.set(0, 0, 4.2);
  couch.add(mesh(new THREE.BoxGeometry(8, 1.2, 2.6), couchMat, 0, 0.9, 0));
  couch.add(mesh(new THREE.BoxGeometry(8, 2, 0.8), couchMat, 0, 2, 1.0));
  for (const s of [-1, 1]) couch.add(mesh(new THREE.BoxGeometry(0.8, 1.7, 2.6), couchMat, s * 3.9, 1.15, 0));
  for (let i = -1; i <= 1; i++) couch.add(mesh(new THREE.BoxGeometry(2.4, 0.35, 2.0), std('#ff9a7f', 0.9), i * 2.5, 1.6, -0.15));
  scene.add(couch);
  block(0, 4.2, 8.4, 3);
  const table = new THREE.Group();
  table.position.set(0, 0, -0.8);
  table.add(mesh(new THREE.BoxGeometry(4.5, 0.25, 2.2), std('#3a2e25', 0.5), 0, 1.3, 0));
  for (const [x, z] of [[-2, -0.9], [2, -0.9], [-2, 0.9], [2, 0.9]]) table.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8), std('#222'), x, 0.6, z));
  table.add(mesh(new THREE.BoxGeometry(1.2, 0.5, 0.9), std('#ffd34d', 0.4), -1, 1.65, 0)); // stack of scripts
  table.add(mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.45, 14), std('#5ec8ff'), 1.2, 1.65, 0.2));
  scene.add(table);
  block(0, -0.8, 4.7, 2.4);

  // ---- plants, water cooler, shelf
  const plant = (x: number, z: number, s = 1) => {
    const p = new THREE.Group();
    p.position.set(x, 0, z);
    p.add(mesh(new THREE.CylinderGeometry(0.7 * s, 0.55 * s, 1.3 * s, 16), std('#d9775c', 0.8), 0, 0.65 * s, 0));
    for (let i = 0; i < 4; i++) {
      const leaf = mesh(new THREE.SphereGeometry(0.75 * s, 14, 10), std(i % 2 ? '#3fae5b' : '#59c46f', 0.8), Math.cos(i * 1.6) * 0.4 * s, (1.8 + i * 0.45) * s, Math.sin(i * 1.6) * 0.4 * s);
      leaf.scale.y = 1.25;
      p.add(leaf);
    }
    scene.add(p);
    block(x, z, 1.6 * s, 1.6 * s);
  };
  plant(-W + 1.8, -D + 1.8, 1.2);
  plant(W - 1.8, D - 1.8, 1.2);
  plant(-W + 1.8, D - 1.8);
  plant(-4.6, D - 1.6, 0.8);
  plant(4.6, D - 1.6, 0.8);
  const cooler = new THREE.Group();
  cooler.position.set(W - 2, 0, -1);
  cooler.add(mesh(new THREE.BoxGeometry(1.4, 2.6, 1.4), std('#e9edf5', 0.5), 0, 1.3, 0));
  const bottle = mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.5, 18), new THREE.MeshStandardMaterial({ color: '#6fc3ff', transparent: true, opacity: 0.7, roughness: 0.1 }), 0, 3.35, 0);
  cooler.add(bottle);
  scene.add(cooler);
  block(W - 2, -1, 1.8, 1.8);
  const shelf = new THREE.Group();
  shelf.position.set(-W + 1.2, 0, -0.5);
  shelf.add(mesh(new THREE.BoxGeometry(1.4, 5, 4), std('#8a6a4f', 0.7), 0, 2.5, 0));
  const bookColors = ['#ff6b8b', '#5ec8ff', '#ffd34d', '#7be07b', '#b48cff'];
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) shelf.add(mesh(new THREE.BoxGeometry(1.1, 1.1, 0.45), std(bookColors[(r + i) % 5]), 0.25, 0.9 + r * 1.5, -1.5 + i * 0.6));
  scene.add(shelf);
  walls.find((w) => w.normal.x === 1)!.trims.push(shelf);
  block(-W + 1.2, -0.5, 1.8, 4.3);
  // door mat
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.2), std('#3a3d52', 1));
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(0, 0.02, D - 1.4);
  scene.add(mat);
  pickFloor.push(mat);

  // ceiling with light panels — only shown in first person (top-down looks in from above)
  const ceiling = new THREE.Group();
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), std('#f6f2ea', 1));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  ceiling.add(ceil);
  const panel = new THREE.MeshBasicMaterial({ color: '#fffbe8' });
  for (const x of [-12, 0, 12]) for (const z of [-7, 6]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.4), panel);
    p.rotation.x = Math.PI / 2;
    p.position.set(x, H - 0.02, z);
    ceiling.add(p);
  }
  ceiling.visible = false;
  scene.add(ceiling);

  return { colliders, walls, desks, pickFloor, drawBoard, ceiling, tv, reviewPoster: review };
}
