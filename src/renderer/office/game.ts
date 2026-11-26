// The walkable office: renderer, lights, player, agents, the two camera modes, input and name tags.
import * as THREE from 'three';
import type { AgentId, AgentStatus } from '../../shared/types';
import { makeCharacter, type Character, type Look } from './characters';
import { collide, NavGrid } from './nav';
import { buildOffice, ROOM, updateMonitor, type DeskSpot } from './world';

export type CameraMode = 'topdown' | 'firstperson';

const LOOKS: Record<AgentId | 'player', Look> = {
  player: { skin: '#f2c9a0', shirt: '#2f6fed', pants: '#23262f', hair: '#3b2416', hairStyle: 'spiky', shirtStripe: '#ffd34d' },
  'script-writer': { skin: '#c68c5a', shirt: '#ffb84d', pants: '#4a3b6b', hair: '#1c1410', hairStyle: 'bob', hat: 'beret', hatColor: '#c0392b', glasses: true },
  editor: { skin: '#f5d0b0', shirt: '#24324a', pants: '#3b4252', hair: '#d9a441', hairStyle: 'short', hat: 'headphones', hatColor: '#5ec8ff' },
  reviewer: { skin: '#8d5a3b', shirt: '#ff6b8b', pants: '#2b2d3a', hair: '#0f0f12', hairStyle: 'short', glasses: true },
  publisher: { skin: '#ffd9b8', shirt: '#7be07b', pants: '#1f4f8a', hairStyle: 'none', hat: 'cap', hatColor: '#ff7a59' },
};

interface AgentActor {
  id: AgentId;
  ch: Character;
  desk: DeskSpot;
  tag: HTMLDivElement;
  status: AgentStatus;
  talking: boolean;
  phase: number;
}

const TOPDOWN_PITCH = 0.92; // radians above the floor
const WALK_SPEED = 14;

export class Office {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  mode: CameraMode = 'topdown';
  inputEnabled = true;
  onTalk: (a: AgentId) => void = () => {};
  onMode: (m: CameraMode) => void = () => {};
  onHint: (text: string | null) => void = () => {};
  onScreen: () => void = () => {};
  private videoEl?: HTMLVideoElement;

  private player: Character;
  private pos = new THREE.Vector3(0, 0, 11.5);
  private heading = Math.PI; // facing the back wall
  private walkPhase = 0;
  private walkAmount = 0;
  private path: [number, number][] = [];
  private goalAgent: AgentId | null = null;
  private agents: AgentActor[] = [];
  private office: ReturnType<typeof buildOffice>;
  private nav: NavGrid;
  private keys = new Set<string>();
  private yaw = 0; // top-down orbit angle
  private zoom = 50;
  private fpYaw = Math.PI;
  private fpPitch = -0.08;
  private camTarget = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private timer = new THREE.Timer();
  private marker: THREE.Mesh;
  private dragging: { x: number; y: number; button: number; moved: boolean } | null = null;
  private talkingTo: AgentId | null = null;
  private nearAgent: AgentId | null = null;

  constructor(private host: HTMLElement, private tagLayer: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#1b1d29');
    this.scene.fog = new THREE.Fog('#1b1d29', 90, 180);
    this.scene.add(new THREE.HemisphereLight('#dfeaff', '#6b5a4a', 1.25));
    const sun = new THREE.DirectionalLight('#fff3df', 2.1);
    sun.position.set(14, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = -28; s.right = 28; s.top = 22; s.bottom = -22; s.near = 1; s.far = 80;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.06;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    const fill = new THREE.PointLight('#ffd9a8', 40, 40, 1.6);
    fill.position.set(0, 8, 0);
    this.scene.add(fill);

    this.office = buildOffice(this.scene);
    this.nav = new NavGrid(ROOM.w, ROOM.d, this.office.colliders);

    this.player = makeCharacter(LOOKS.player);
    this.scene.add(this.player.root);

    for (const desk of this.office.desks) {
      const ch = makeCharacter(LOOKS[desk.agent]);
      ch.root.position.copy(desk.stand);
      ch.root.rotation.y = desk.facing;
      ch.root.traverse((o) => (o.userData.agent = desk.agent));
      this.scene.add(ch.root);
      const tag = document.createElement('div');
      tag.className = 'tag';
      tagLayer.appendChild(tag);
      this.agents.push({ id: desk.agent, ch, desk, tag, status: 'offline', talking: false, phase: Math.random() * 6 });
    }

    // click target marker
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 32), new THREE.MeshBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0 }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.05;
    this.scene.add(this.marker);

    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- public API
  setAgentInfo(id: AgentId, name: string, role: string, status: AgentStatus, activity?: string) {
    const a = this.agents.find((x) => x.id === id);
    if (!a) return;
    a.status = status;
    const label: Record<AgentStatus, string> = { idle: 'idle', working: 'working', 'needs-you': 'needs you', offline: 'offline', error: 'error' };
    a.tag.dataset.status = status;
    a.tag.innerHTML = `<div class="bubble"><span class="dot"></span>${esc(activity && status !== 'idle' ? activity : label[status])}</div><div class="name">${esc(name)}<span>${esc(role)}</span></div>`;
    updateMonitor(a.desk, status === 'offline' ? `Phase ${activity?.match(/\d/)?.[0] ?? ''}` : activity && status !== 'idle' ? activity.slice(0, 26) : status);
  }
  setTalking(id: AgentId | null) {
    this.talkingTo = id;
  }
  setAgentSpeaking(id: AgentId, on: boolean) {
    const a = this.agents.find((x) => x.id === id);
    if (a && a.talking !== on) {
      a.talking = on;
      a.ch.setTalking(on);
    }
  }
  setBoard(rows: Parameters<ReturnType<typeof buildOffice>['drawBoard']>[0]) {
    this.office.drawBoard(rows);
  }
  /** Play the latest rendered Short (muted, looping) on the review screen; null shows the poster. */
  setReviewVideo(url: string | null) {
    const mat = this.office.tv.material as THREE.MeshBasicMaterial;
    if (this.videoEl?.dataset.src === (url ?? '')) return;
    this.videoEl?.pause();
    if (!url) {
      this.office.tv.scale.set(1, 1, 1);
      mat.map = this.office.reviewPoster;
      mat.needsUpdate = true;
      this.videoEl = undefined;
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
    this.videoEl = v;
    // the screen is 7 x 3.94 (16:9); the Short is 9:16, so show it as a tall picture in the middle
    this.office.tv.scale.set((3.94 * 9) / 16 / 7, 1, 1);
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
    this.office.ceiling.visible = m === 'firstperson';
    this.onMode(m);
  }
  toggleMode() {
    this.setMode(this.mode === 'topdown' ? 'firstperson' : 'topdown');
  }
  walkToAgent(id: AgentId) {
    const a = this.agents.find((x) => x.id === id);
    if (!a) return;
    if (this.mode === 'firstperson') {
      this.onTalk(id);
      return;
    }
    const p = this.nav.path(this.pos.x, this.pos.z, a.desk.talk.x, a.desk.talk.z);
    if (p) {
      this.path = p;
      this.goalAgent = id;
    }
  }
  /** for screenshots and tests */
  debugTeleport(x: number, z: number, heading: number) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.fpYaw = heading;
    this.camTarget.copy(this.pos);
  }
  setYaw(y: number) {
    this.yaw = y;
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
        this.onTalk(this.nearAgent);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      if (this.mode !== 'topdown') return;
      this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * 0.03, 20, 70);
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
        if (this.dragging.button === 2) {
          this.yaw -= e.movementX * 0.006;
        }
      } else {
        const hit = this.pick(e.clientX, e.clientY);
        el.style.cursor = hit.agent || hit.screen ? 'pointer' : 'default';
      }
    });
    window.addEventListener('pointerup', (e) => {
      const d = this.dragging;
      this.dragging = null;
      if (!d || d.moved || d.button !== 0 || this.mode !== 'topdown' || !this.inputEnabled) return;
      if (e.target !== el) return;
      const hit = this.pick(e.clientX, e.clientY);
      if (hit.screen) this.onScreen();
      else if (hit.agent) this.walkToAgent(hit.agent);
      else if (hit.point) {
        const p = this.nav.path(this.pos.x, this.pos.z, hit.point.x, hit.point.z);
        if (p) {
          this.path = p;
          this.goalAgent = null;
          this.marker.position.set(p[p.length - 1][0], 0.05, p[p.length - 1][1]);
          (this.marker.material as THREE.MeshBasicMaterial).opacity = 1;
        }
      }
    });
  }

  private pick(cx: number, cy: number): { agent?: AgentId; point?: THREE.Vector3; screen?: boolean } {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    for (const h of hits) {
      if (!h.object.visible) continue;
      const agent = h.object.userData.agent as AgentId | undefined;
      if (agent) return { agent };
      if (h.object.userData.screen) return { screen: true };
      if (this.office.pickFloor.includes(h.object)) return { point: h.point };
    }
    // nothing pickable in front: project onto the floor plane
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) && Math.abs(p.x) < ROOM.w / 2 && Math.abs(p.z) < ROOM.d / 2) return { point: p };
    return {};
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  // ---------- per frame
  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const t = this.timer.getElapsed();
    let moving = false;
    const cols = this.office.colliders;
    const agentBlocks = this.agents.map((a) => ({ minX: a.desk.stand.x - 0.9, maxX: a.desk.stand.x + 0.9, minZ: a.desk.stand.z - 0.9, maxZ: a.desk.stand.z + 0.9 }));
    const allCols = cols.concat(agentBlocks);

    if (this.mode === 'topdown') {
      const rot = (this.keys.has('q') ? 1 : 0) - (this.keys.has('e') ? 1 : 0);
      if (this.inputEnabled) this.yaw += rot * dt * 1.6;
      // keyboard walking also works in top-down (relative to the camera)
      const f = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
      const s = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
      if ((f || s) && this.inputEnabled) {
        this.path = [];
        this.goalAgent = null;
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); // camera forward on the floor
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw); // camera right
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
              const a = this.agents.find((x) => x.id === this.goalAgent)!;
              this.heading = Math.atan2(a.desk.stand.x - this.pos.x, a.desk.stand.z - this.pos.z);
              const id = this.goalAgent;
              this.goalAgent = null;
              this.onTalk(id);
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
        // right vector = forward rotated -90°
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

    // agents: idle, face you while you talk to them
    this.nearAgent = null;
    for (const a of this.agents) {
      const close = Math.hypot(a.desk.talk.x - this.pos.x, a.desk.talk.z - this.pos.z) < 6;
      const want = this.talkingTo === a.id || close
        ? Math.atan2(this.pos.x - a.desk.stand.x, this.pos.z - a.desk.stand.z)
        : a.desk.facing;
      a.ch.root.rotation.y = lerpAngle(a.ch.root.rotation.y, want, 1 - Math.exp(-dt * 6));
      a.ch.pose(0, 0, t);
      a.ch.update(t);
      if (this.mode === 'firstperson' && close) {
        const toA = Math.atan2(a.desk.stand.x - this.pos.x, a.desk.stand.z - this.pos.z);
        if (Math.abs(angleDiff(toA, this.fpYaw)) < 0.9) this.nearAgent = a.id;
      }
    }
    this.onHint(this.mode === 'firstperson' && this.nearAgent && this.inputEnabled ? this.nearAgent : null);

    this.updateCamera(dt);
    this.updateWalls();
    this.renderer.render(this.scene, this.camera);
    this.updateTags();
  }

  private step(dx: number, dz: number, dist: number, cols: typeof this.office.colliders, face = true): boolean {
    const ox = this.pos.x, oz = this.pos.z;
    const [nx, nz] = collide(ox + dx * dist, oz + dz * dist, cols);
    this.pos.x = nx;
    this.pos.z = nz;
    const moved = Math.hypot(nx - ox, nz - oz);
    this.walkPhase += moved * 0.75;
    if (face && moved > 0.001) this.heading = Math.atan2(dx, dz);
    if (moved < dist * 0.2 && this.path.length && face) {
      // stuck against something: re-plan
      const goal = this.path[this.path.length - 1];
      this.path = this.nav.path(this.pos.x, this.pos.z, goal[0], goal[1]) ?? [];
    }
    return moved > 0.001;
  }

  private updateCamera(dt: number) {
    if (this.mode === 'topdown') {
      // keep the whole office in view; lean toward you, and toward the agent you're talking to
      const goal = new THREE.Vector3(this.pos.x * 0.35, 1, this.pos.z * 0.3 - 2);
      const a = this.talkingTo ? this.agents.find((x) => x.id === this.talkingTo) : undefined;
      if (a) {
        goal.set((this.pos.x + a.desk.stand.x) / 2, 1, (this.pos.z + a.desk.stand.z) / 2);
        // the chat drawer covers the right of the screen: shift the view so they sit in the free part
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
    for (const w of this.office.walls) {
      const cut = this.mode === 'topdown' && w.normal.x * cx + w.normal.y * cz < -2;
      const target = cut ? 0.14 : 1;
      w.mesh.scale.y = THREE.MathUtils.lerp(w.mesh.scale.y, target, 0.2);
      for (const tr of w.trims) tr.visible = w.mesh.scale.y > 0.6;
    }
  }

  private updateTags() {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    for (const a of this.agents) {
      v.set(a.desk.stand.x, a.ch.headY + 1.9, a.desk.stand.z).project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      const dist = this.camera.position.distanceTo(a.ch.root.position);
      a.tag.style.display = visible && (this.mode === 'topdown' || dist < 30) ? '' : 'none';
      a.tag.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * r.width}px, ${((1 - v.y) / 2) * r.height}px)`;
      a.tag.classList.toggle('active', this.talkingTo === a.id);
    }
  }
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
