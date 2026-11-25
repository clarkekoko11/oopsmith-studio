// Click-to-walk pathfinding (A* on a 0.5-unit grid) and circle-vs-box collision.
import type { Collider } from './world';

export const BODY_RADIUS = 1.15;

export function collide(x: number, z: number, cols: Collider[], r = BODY_RADIUS): [number, number] {
  for (let pass = 0; pass < 3; pass++) {
    for (const c of cols) {
      const nx = Math.max(c.minX, Math.min(x, c.maxX));
      const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
      const dx = x - nx, dz = z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          x = nx + (dx / d) * r;
          z = nz + (dz / d) * r;
        } else {
          // centre inside the box: push out along the shortest axis
          const opts = [[c.minX - r, z], [c.maxX + r, z], [x, c.minZ - r], [x, c.maxZ + r]] as [number, number][];
          opts.sort((a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z));
          [x, z] = opts[0];
        }
      }
    }
  }
  return [x, z];
}

export class NavGrid {
  readonly cell = 0.5;
  private cols: number;
  private rows: number;
  private blocked: Uint8Array;
  constructor(private w: number, private d: number, colliders: Collider[], r = BODY_RADIUS + 0.1) {
    this.cols = Math.ceil(w / this.cell);
    this.rows = Math.ceil(d / this.cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (let j = 0; j < this.rows; j++)
      for (let i = 0; i < this.cols; i++) {
        const [x, z] = this.center(i, j);
        this.blocked[j * this.cols + i] = colliders.some((c) => x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) ? 1 : 0;
      }
  }
  private center(i: number, j: number): [number, number] {
    return [-this.w / 2 + (i + 0.5) * this.cell, -this.d / 2 + (j + 0.5) * this.cell];
  }
  private idx(x: number, z: number): [number, number] {
    return [Math.floor((x + this.w / 2) / this.cell), Math.floor((z + this.d / 2) / this.cell)];
  }
  private free(i: number, j: number) {
    return i >= 0 && j >= 0 && i < this.cols && j < this.rows && !this.blocked[j * this.cols + i];
  }
  /** nearest free cell to a point (so clicking on furniture still walks next to it) */
  private nearestFree(i: number, j: number): [number, number] | null {
    if (this.free(i, j)) return [i, j];
    for (let r = 1; r < 20; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++)
          if ((Math.abs(di) === r || Math.abs(dj) === r) && this.free(i + di, j + dj)) return [i + di, j + dj];
    return null;
  }
  private lineFree(ax: number, az: number, bx: number, bz: number) {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (this.cell / 2));
    for (let s = 0; s <= steps; s++) {
      const [i, j] = this.idx(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps);
      if (!this.free(i, j)) return false;
    }
    return true;
  }

  path(fromX: number, fromZ: number, toX: number, toZ: number): [number, number][] | null {
    const s = this.nearestFree(...this.idx(fromX, fromZ));
    const g = this.nearestFree(...this.idx(toX, toZ));
    if (!s || !g) return null;
    const N = this.cols * this.rows;
    const cost = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const open: number[] = [];
    const key = (i: number, j: number) => j * this.cols + i;
    const h = (k: number) => Math.hypot((k % this.cols) - g[0], Math.floor(k / this.cols) - g[1]);
    const start = key(...s), goal = key(...g);
    cost[start] = 0;
    open.push(start);
    const f = new Float32Array(N).fill(Infinity);
    f[start] = h(start);
    let found = false;
    let guard = 0;
    while (open.length && guard++ < 40000) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) { found = true; break; }
      const ci = cur % this.cols, cj = Math.floor(cur / this.cols);
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (!this.free(ni, nj)) continue;
          if (di && dj && (!this.free(ci + di, cj) || !this.free(ci, cj + dj))) continue;
          const nk = key(ni, nj);
          const c = cost[cur] + (di && dj ? 1.4142 : 1);
          if (c < cost[nk]) {
            cost[nk] = c;
            came[nk] = cur;
            f[nk] = c + h(nk);
            if (!open.includes(nk)) open.push(nk);
          }
        }
    }
    if (!found) return null;
    const pts: [number, number][] = [];
    for (let k = goal; k !== -1; k = came[k]) pts.push(this.center(k % this.cols, Math.floor(k / this.cols)));
    pts.reverse();
    // exact goal if it was free, then string-pull
    const [gi, gj] = this.idx(toX, toZ);
    if (gi === g[0] && gj === g[1]) pts[pts.length - 1] = [toX, toZ];
    const out: [number, number][] = [];
    let ax = fromX, az = fromZ;
    let k = 0;
    while (k < pts.length) {
      let far = k;
      for (let m = pts.length - 1; m > k; m--) if (this.lineFree(ax, az, pts[m][0], pts[m][1])) { far = m; break; }
      out.push(pts[far]);
      [ax, az] = pts[far];
      k = far + 1;
    }
    return out;
  }
}
