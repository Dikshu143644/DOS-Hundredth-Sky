import * as THREE from 'three';
import { raycastWorld } from '../../shared/physics';
import { heightAt, buildZone, ZONE } from '../../shared/world';

/** Foliage the camera must not sit inside: tree canopies and big bushes as spheres, on a grid per zone. */
type Blob = { x: number; y: number; z: number; r: number };
const blobGrids = new Map<string, Map<string, Blob[]>>();
const CELL = 12;
function blobGrid(): Map<string, Blob[]> {
  let g = blobGrids.get(ZONE);
  if (g) return g;
  g = new Map();
  const zd = buildZone();
  const add = (b: Blob) => { const k = Math.floor(b.x / CELL) + ',' + Math.floor(b.z / CELL); let l = g!.get(k); if (!l) g!.set(k, l = []); l.push(b); };
  for (const t of zd.trees) {
    if (t.type >= 7) continue; // dead trees: bare branches
    const h = heightAt(t.x, t.z), s = t.s;
    if (t.type === 4 || t.type === 5) add({ x: t.x, y: h + 2.4 * s, z: t.z, r: 1.45 * s });
    else if (t.type === 6) add({ x: t.x, y: h + 3.8 * s, z: t.z, r: 1.4 * s });
    else add({ x: t.x, y: h + 4.6 * s, z: t.z, r: 2.1 * s });
  }
  for (const b of zd.bushes) if (b.model === 'Bush_Large' || b.model === 'Bush') add({ x: b.x, y: b.y + 0.5 * b.s, z: b.z, r: 0.95 * b.s });
  blobGrids.set(ZONE, g);
  return g;
}
/** Distance along the ray to the first canopy it enters (ignores canopies the pivot is already inside). */
export function foliageHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
  const g = blobGrid();
  let best = max;
  const ex = ox + dx * max, ez = oz + dz * max;
  const x0 = Math.floor(Math.min(ox, ex) / CELL) - 1, x1 = Math.floor(Math.max(ox, ex) / CELL) + 1;
  const z0 = Math.floor(Math.min(oz, ez) / CELL) - 1, z1 = Math.floor(Math.max(oz, ez) / CELL) + 1;
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
    const l = g.get(cx + ',' + cz); if (!l) continue;
    for (const b of l) {
      const lx = ox - b.x, ly = oy - b.y, lz = oz - b.z;
      const c = lx * lx + ly * ly + lz * lz - b.r * b.r;
      if (c < 0) continue; // the hero stands inside this canopy: nothing to pull in front of
      const bb = lx * dx + ly * dy + lz * dz;
      const disc = bb * bb - c;
      if (disc < 0) continue;
      const t = -bb - Math.sqrt(disc);
      if (t > 0 && t < best) best = t;
    }
  }
  return best;
}

/** Third-person spring-arm camera: orbit with mouse/touch, smoothed follow, and collision —
 *  a ray from the shoulder pivot to the desired position against walls/trees/terrain pulls the
 *  camera in so it never clips through geometry. */
export class ThirdPersonCamera {
  yaw = 0;              // camera south of the player, looking north (-Z) toward the Tower
  pitch = 0.22;
  dist = 6.5;
  targetDist = 6.5;
  private pivot = new THREE.Vector3();
  private cur = new THREE.Vector3();
  private shake = 0;
  constructor(public cam: THREE.PerspectiveCamera) {}
  rotate(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -0.55, 1.25);
  }
  zoom(d: number) { this.targetDist = THREE.MathUtils.clamp(this.targetDist + d, 2.2, 14); }
  addShake(a: number) { this.shake = Math.min(1, this.shake + a); }
  /** Movement frame yaw (W moves where the camera looks). */
  get moveYaw() { return this.yaw; }

  update(dt: number, target: THREE.Vector3) {
    const k = 1 - Math.exp(-dt * 14);
    this.pivot.lerp(new THREE.Vector3(target.x, target.y + 1.65, target.z), this.pivot.lengthSq() === 0 ? 1 : k);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    // shoulder offset (slightly to the right)
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const origin = this.pivot.clone().addScaledVector(right, 0.45);
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 8);
    const hit = raycastWorld(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, this.dist + 0.3, new Set(['bound']));
    const leaf = foliageHit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, this.dist + 0.3);
    const d = Math.max(0.6, Math.min(this.dist, hit - 0.35, leaf - 0.25));
    const want = origin.clone().addScaledVector(dir, d);
    const g = heightAt(want.x, want.z) + 0.35;
    if (want.y < g) want.y = g;
    // pull in fast when blocked, ease out slowly when free (no popping)
    if (this.cur.lengthSq() === 0) this.cur.copy(want);
    const blocked = want.distanceTo(origin) < this.cur.distanceTo(origin) - 0.05;
    this.cur.lerp(want, blocked ? 1 : Math.min(1, dt * 10));
    this.cam.position.copy(this.cur);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const s = this.shake * this.shake * 0.25;
      this.cam.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    this.cam.lookAt(this.pivot.x, this.pivot.y + 0.15, this.pivot.z);
  }
}
