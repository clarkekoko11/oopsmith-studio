// Roblox-style R6 characters: blocky body, cylinder head, flat decal face, smooth hair shells and hats.
import * as THREE from 'three';

export type Face = 'smile' | 'talk' | 'blink' | 'grin' | 'surprised';

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
  /** 0 = standing, 1 = full walk swing. phase advances with distance walked. */
  pose(walk: number, phase: number, t: number): void;
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

export function makeCharacter(look: Look): Character {
  const root = new THREE.Group();
  const skin = mat(look.skin, 0.6);
  const shirt = mat(look.shirt);
  const pants = mat(look.pants);
  const shoes = mat(look.shoes ?? '#2b2b33');

  // torso (y 2..4)
  const torso = box(2, 2, 1, shirt);
  torso.position.y = 3;
  root.add(torso);
  if (look.shirtStripe) {
    const stripe = box(2.02, 0.35, 1.02, mat(look.shirtStripe));
    stripe.position.y = 3.2;
    root.add(stripe);
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
    root.add(pivot);
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
  root.add(head);
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
  return {
    root,
    headY: 5.6,
    setFace,
    setTalking(on) {
      talking = on;
      if (!on) setFace('smile');
    },
    pose(walk, phase, t) {
      const s = Math.sin(phase) * 0.75 * walk;
      legL.rotation.x = s;
      legR.rotation.x = -s;
      armL.rotation.x = -s * 0.9;
      armR.rotation.x = s * 0.9;
      // idle breathing + slight head motion
      const idle = 1 - walk;
      torso.scale.y = 1 + Math.sin(t * 1.6 + seed) * 0.012 * idle;
      head.rotation.y = Math.sin(t * 0.5 + seed) * 0.12 * idle;
      head.position.y = 4.65 + Math.abs(Math.sin(phase)) * 0.08 * walk;
      armL.rotation.z = -0.05 - Math.sin(t * 1.6 + seed) * 0.02 * idle;
      armR.rotation.z = 0.05 + Math.sin(t * 1.6 + seed) * 0.02 * idle;
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
