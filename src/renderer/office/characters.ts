// Roblox-style R6 characters: blocky body, cylinder head, flat decal face, smooth hair shells and hats.
import * as THREE from 'three';

export type Face = 'smile' | 'talk' | 'blink' | 'grin' | 'surprised';
/** What the body is doing (besides walking). */
export type Action = 'stand' | 'type' | 'sit' | 'readSit' | 'drink' | 'play' | 'read' | 'water' | 'stretch' | 'wave' | 'look' | 'chat' | 'dance' | 'think';
/** Something held in the right hand. */
export type Prop = 'mug' | 'cup' | 'book' | 'can';

export interface Look {
  skin: string;
  shirt: string;
  pants: string;
  shoes?: string;
  hair?: string;
  hairStyle?: 'short' | 'bob' | 'spiky' | 'none';
  hat?: 'beret' | 'cap' | 'headphones' | 'none';
  hatColor?: string;
  glasses?: boolean;
  shirtStripe?: string;
}

export interface Character {
  root: THREE.Group;
  /** 0 = standing, 1 = full walk swing. phase advances with distance walked. action blends in when standing still. */
  pose(walk: number, phase: number, t: number, action?: Action): void;
  hold(p: Prop | null): void;
  setFace(f: Face): void;
  setTalking(on: boolean): void;
  update(t: number): void;
  headY: number;
}

const faceCache = new Map<string, THREE.CanvasTexture>();

function faceTexture(kind: Face, glasses: boolean): THREE.CanvasTexture {
  const key = `${kind}-${glasses}`;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#111';
  g.strokeStyle = '#111';
  g.lineCap = 'round';
  // eyes
  if (kind === 'blink') {
    g.lineWidth = 10;
    for (const x of [92, 164]) { g.beginPath(); g.moveTo(x - 14, 104); g.lineTo(x + 14, 104); g.stroke(); }
  } else {
    const h = kind === 'surprised' ? 34 : 28;
    for (const x of [92, 164]) {
      g.beginPath(); g.ellipse(x, 102, 11, h / 2, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 3, 96, 4, 0, Math.PI * 2); g.fill(); g.fillStyle = '#111';
    }
  }
  // mouth
  g.lineWidth = 9;
  if (kind === 'smile' || kind === 'blink') {
    g.beginPath(); g.arc(128, 132, 40, 0.18 * Math.PI, 0.82 * Math.PI); g.stroke();
  } else if (kind === 'grin') {
    g.beginPath(); g.moveTo(84, 146); g.quadraticCurveTo(128, 200, 172, 146); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.fillRect(96, 148, 64, 10); g.fillStyle = '#111';
  } else if (kind === 'talk') {
    g.beginPath(); g.ellipse(128, 162, 22, 17, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d4545b'; g.beginPath(); g.ellipse(128, 170, 12, 6, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#111';
  } else if (kind === 'surprised') {
    g.beginPath(); g.ellipse(128, 166, 14, 18, 0, 0, Math.PI * 2); g.fill();
  }
  if (glasses) {
    g.lineWidth = 7;
    g.strokeStyle = '#2a2a33';
    for (const x of [92, 164]) { g.beginPath(); g.roundRect(x - 27, 80, 54, 46, 12); g.stroke(); }
    g.beginPath(); g.moveTo(119, 100); g.lineTo(137, 100); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  faceCache.set(key, tex);
  return tex;
}

const mat = (color: string, rough = 0.75) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });

function box(w: number, h: number, d: number, m: THREE.Material, r = 0.08): THREE.Mesh {
  // slightly bevelled box, like Roblox parts
  const geo = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  void r;
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function propMesh(p: Prop): THREE.Object3D {
  const g = new THREE.Group();
  const m = (geo: THREE.BufferGeometry, c: string, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mat(c, 0.5)); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  if (p === 'mug') { m(new THREE.CylinderGeometry(0.22, 0.2, 0.45, 14), '#FFF4E2'); m(new THREE.TorusGeometry(0.12, 0.04, 6, 12), '#FFF4E2', 0.25, 0, 0).rotation.y = 0; m(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 14), '#4a2c1e', 0, 0.22, 0); }
  else if (p === 'cup') { m(new THREE.CylinderGeometry(0.2, 0.14, 0.4, 12), '#ffffff'); }
  else if (p === 'book') { const b = m(new THREE.BoxGeometry(0.9, 0.12, 0.65), '#FF6B2C'); b.rotation.x = 0.2; m(new THREE.BoxGeometry(0.84, 0.13, 0.6), '#FFF4E2', 0.03, 0, 0).rotation.x = 0.2; }
  else { m(new THREE.CylinderGeometry(0.32, 0.36, 0.55, 14), '#2F6BB8'); const sp = m(new THREE.CylinderGeometry(0.05, 0.08, 0.8, 8), '#2F6BB8', 0, 0.15, 0.5); sp.rotation.x = 1.0; m(new THREE.TorusGeometry(0.2, 0.04, 6, 12, Math.PI), '#2F6BB8', 0, 0.3, -0.05).rotation.y = Math.PI / 2; }
  return g;
}

export function makeCharacter(look: Look): Character {
  const root = new THREE.Group();
  // everything hangs off "body" so the whole figure can bob, sway and sit without moving root
  const body = new THREE.Group();
  root.add(body);
  const skin = mat(look.skin, 0.6);
  const shirt = mat(look.shirt);
  const pants = mat(look.pants);
  const shoes = mat(look.shoes ?? '#2b2b33');

  // torso (y 2..4)
  const torso = box(2, 2, 1, shirt);
  torso.position.y = 3;
  body.add(torso);
  if (look.shirtStripe) {
    const stripe = box(2.02, 0.35, 1.02, mat(look.shirtStripe));
    stripe.position.y = 3.2;
    body.add(stripe);
  }

  // limbs hang from pivots
  const limb = (x: number, y: number, m: THREE.Material, foot?: THREE.Material) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const part = box(1, 2, 1, m);
    part.position.y = -1;
    pivot.add(part);
    if (foot) {
      const f = box(1.02, 0.35, 1.04, foot);
      f.position.set(0, -1.82, 0.02);
      pivot.add(f);
    }
    body.add(pivot);
    return pivot;
  };
  const armL = limb(-1.5, 4, skin);
  const armR = limb(1.5, 4, skin);
  // short sleeves
  for (const a of [armL, armR]) {
    const sleeve = box(1.06, 0.84, 1.06, shirt);
    sleeve.position.y = -0.4;
    a.add(sleeve);
  }
  const legL = limb(-0.5, 2, pants, shoes);
  const legR = limb(0.5, 2, pants, shoes);

  // head
  const head = new THREE.Group();
  head.position.y = 4.65;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.2, 28), skin);
  skull.castShadow = true;
  head.add(skull);
  for (const s of [1, -1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), skin);
    cap.scale.y = 0.28;
    cap.position.y = 0.6 * s;
    cap.rotation.x = s < 0 ? Math.PI : 0;
    head.add(cap);
  }
  const faceMat = new THREE.MeshBasicMaterial({ map: faceTexture('smile', !!look.glasses), transparent: true, depthWrite: false });
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.635, 0.635, 1.2, 28, 1, true, -Math.PI * 0.42, Math.PI * 0.84), faceMat);
  face.renderOrder = 2;
  head.add(face);

  // hair: smooth shells (never strands)
  const hairStyle = look.hairStyle ?? 'short';
  if (look.hair && hairStyle !== 'none') {
    const hm = mat(look.hair, 0.55);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.72, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hm);
    top.scale.set(1, hairStyle === 'spiky' ? 0.95 : 0.7, 1);
    top.position.y = 0.42;
    top.castShadow = true;
    head.add(top);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.68, hairStyle === 'bob' ? 1.15 : 0.75, 28, 1, true, Math.PI * 0.55, Math.PI * 0.9), hm);
    back.position.y = hairStyle === 'bob' ? 0.05 : 0.25;
    back.material = hm.clone();
    (back.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    head.add(back);
    if (hairStyle === 'spiky') {
      for (let i = 0; i < 5; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 10), hm);
        spike.position.set(-0.45 + i * 0.22, 0.95, -0.1 + (i % 2) * 0.1);
        spike.rotation.z = (i - 2) * 0.18;
        head.add(spike);
      }
    }
  }

  // hats
  const hc = mat(look.hatColor ?? '#333');
  if (look.hat === 'beret') {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.7, 0.28, 28), hc);
    b.position.set(0.08, 0.82, 0);
    b.rotation.z = -0.22;
    b.castShadow = true;
    head.add(b);
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), hc);
    nub.position.set(0.12, 1.0, 0);
    head.add(nub);
  } else if (look.hat === 'cap') {
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.7, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), hc);
    crown.scale.y = 0.7;
    crown.position.y = 0.55;
    crown.castShadow = true;
    head.add(crown);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.07, 20, 1, false, -Math.PI / 2, Math.PI), hc);
    brim.scale.set(1, 1, 1.4);
    brim.position.set(0, 0.6, 0.62);
    head.add(brim);
  } else if (look.hat === 'headphones') {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.07, 8, 28, Math.PI), hc);
    band.position.y = 0.25;
    head.add(band);
    for (const s of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 20), hc);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(0.72 * s, 0.15, 0);
      head.add(cup);
    }
  }

  let current: Face = 'smile';
  let talking = false;
  let nextBlink = 2 + Math.random() * 3;
  const setFace = (f: Face) => {
    if (f === current) return;
    current = f;
    faceMat.map = faceTexture(f, !!look.glasses);
    faceMat.needsUpdate = true;
  };

  const seed = Math.random() * 10;
  // smoothed joint angles, so switching actions eases instead of snapping
  const cur = { aLx: 0, aRx: 0, aLz: -0.05, aRz: 0.05, lLx: 0, lRx: 0, hx: 0, hy: 0, by: 0, bry: 0, brx: 0 };
  let held: THREE.Object3D | null = null;
  let heldKind: Prop | null = null;
  const hand = new THREE.Group();
  hand.position.set(-0.1, -2.15, 0.15);
  armR.add(hand);
  return {
    root,
    headY: 5.6,
    setFace,
    setTalking(on) {
      talking = on;
      if (!on) setFace('smile');
    },
    hold(p) {
      if (p === heldKind) return;
      if (held) hand.remove(held);
      held = p ? propMesh(p) : null;
      heldKind = p;
      if (held) hand.add(held);
    },
    pose(walk, phase, t, action = 'stand') {
      const idle = 1 - walk;
      const s = Math.sin(phase) * 0.75 * walk;
      const br = Math.sin(t * 1.6 + seed);
      // targets for this action
      const g = { aLx: 0, aRx: 0, aLz: -0.05 - br * 0.02, aRz: 0.05 + br * 0.02, lLx: 0, lRx: 0, hx: 0, hy: Math.sin(t * 0.5 + seed) * 0.12, by: 0, bry: 0, brx: 0 };
      switch (action) {
        case 'type':
          g.aLx = -1.15 + Math.sin(t * 17 + seed) * 0.07; g.aRx = -1.15 + Math.sin(t * 15 + seed + 1) * 0.07;
          g.aLz = 0.18; g.aRz = -0.18; g.hx = 0.18; g.hy = Math.sin(t * 0.7 + seed) * 0.05; break;
        case 'think':
          g.aRx = -2.3; g.aRz = -0.5; g.aLx = -0.6; g.aLz = 0.5; g.hx = -0.15; g.hy = Math.sin(t * 0.4 + seed) * 0.3; break;
        case 'sit':
          g.lLx = g.lRx = -Math.PI / 2; g.aLx = g.aRx = -0.35; g.hy *= 1.6; break;
        case 'readSit':
          g.lLx = g.lRx = -Math.PI / 2; g.aLx = g.aRx = -1.0; g.aLz = 0.35; g.aRz = -0.35; g.hx = 0.3; g.hy = 0; break;
        case 'read':
          g.aLx = g.aRx = -1.05; g.aLz = 0.35; g.aRz = -0.35; g.hx = 0.3; g.hy = Math.sin(t * 0.3 + seed) * 0.05; break;
        case 'drink': {
          const sip = (t + seed) % 5 < 1.3;
          g.aRx = sip ? -2.5 : -0.85; g.aRz = sip ? -0.35 : -0.1; g.hx = sip ? -0.2 : 0; break;
        }
        case 'play':
          g.aLx = g.aRx = -1.25; g.aLz = 0.15; g.aRz = -0.2;
          g.aRx += Math.sin(t * 22 + seed) * 0.12; g.aLx += Math.sin(t * 13) * 0.1; g.by = Math.abs(Math.sin(t * 6)) * 0.08; g.hx = -0.05; break;
        case 'water':
          g.aRx = -0.95; g.aRz = -0.1; g.brx = 0.12; g.hx = 0.35; break;
        case 'stretch': {
          const k = (Math.sin(t * 1.3 + seed) + 1) / 2;
          g.aLx = g.aRx = -2.9 * k; g.aLz = -0.2 * k; g.aRz = 0.2 * k; g.hx = -0.25 * k; g.by = 0.1 * k; break;
        }
        case 'wave':
          g.aRz = 2.5 + Math.sin(t * 9) * 0.35; g.hy = 0; g.hx = -0.1; break;
        case 'look':
          g.aLx = g.aRx = 0.35; g.aLz = 0.25; g.aRz = -0.25; g.hy = Math.sin(t * 0.35 + seed) * 0.5; g.hx = -0.1; break;
        case 'chat':
          g.aRx = -0.5 + Math.sin(t * 2.3 + seed) * 0.35; g.aLx = -0.2 + Math.sin(t * 1.7 + seed) * 0.25; g.aRz = -0.2; g.hy = Math.sin(t * 0.9) * 0.15;
          g.aRx = Math.min(g.aRx, -0.85); break; // keep the mug up
        case 'dance': {
          const b = Math.sin(t * 7 + seed);
          g.aLx = -1.4 + b * 1.0; g.aRx = -1.4 - b * 1.0; g.aLz = -0.4; g.aRz = 0.4; g.by = Math.abs(b) * 0.25; g.bry = Math.sin(t * 3.5) * 0.35; g.lLx = b * 0.25; g.lRx = -b * 0.25; break;
        }
      }
      const k = 0.14;
      for (const key of Object.keys(cur) as (keyof typeof cur)[]) cur[key] += (g[key] - cur[key]) * k;
      legL.rotation.x = s + cur.lLx * idle;
      legR.rotation.x = -s + cur.lRx * idle;
      armL.rotation.x = -s * 0.9 + cur.aLx * idle;
      armR.rotation.x = s * 0.9 + cur.aRx * idle;
      armL.rotation.z = cur.aLz;
      armR.rotation.z = cur.aRz;
      torso.scale.y = 1 + br * 0.012 * idle;
      head.rotation.y = cur.hy * idle;
      head.rotation.x = cur.hx * idle;
      head.position.y = 4.65 + Math.abs(Math.sin(phase)) * 0.08 * walk;
      body.position.y = cur.by * idle;
      body.rotation.y = cur.bry * idle;
      body.rotation.x = cur.brx * idle;
    },
    update(t) {
      if (talking) {
        setFace(Math.sin(t * 14 + seed) > 0 ? 'talk' : 'smile');
        return;
      }
      nextBlink -= 1 / 60;
      if (nextBlink < 0) {
        setFace('blink');
        if (nextBlink < -0.12) {
          setFace('smile');
          nextBlink = 2.5 + Math.random() * 3.5;
        }
      }
    },
  };
}
