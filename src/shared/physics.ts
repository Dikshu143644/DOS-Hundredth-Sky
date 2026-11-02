import { heightAt, normalAt, buildZone, Collider, WATER_LEVEL } from './world';
import { clamp } from './rng';

/** Kinematic character physics shared by client prediction and the authoritative server.
 *  Vertical capsule approximated as a cylinder (radius R, height H) moving against:
 *  - the terrain heightfield (with a max walkable slope), and
 *  - static colliders (oriented boxes and cylinders) with step-up for small ledges.
 *  Movement is sub-stepped so nothing tunnels through thin walls even at high speed. */

export const PHYS = {
  R: 0.42,
  H: 1.8,
  STEP: 0.5,
  GRAVITY: 22,
  JUMP_V: 7.6,
  WALK: 2.6,
  RUN: 6.2,
  SPRINT: 8.4,
  AIR_CONTROL: 0.35,
  ACCEL: 40,
  MAX_SLOPE_NY: 0.62, // ground steeper than ~52° is a wall
  SWIM_DEPTH: 1.25,
  DT: 1 / 60,
};

export interface CharState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number;
  grounded: boolean;
  swimming: boolean;
  coyote: number;
}

export interface MoveInput {
  seq: number;
  mx: number;       // strafe -1..1
  mz: number;       // forward -1..1 (forward = +1)
  yaw: number;      // movement frame yaw (camera yaw)
  jump: boolean;
  sprint: boolean;
  walk: boolean;
  dt: number;
}

export function newCharState(x: number, z: number, yaw = 0): CharState {
  return { x, y: heightAt(x, z), z, vx: 0, vy: 0, vz: 0, yaw, grounded: true, swimming: false, coyote: 0 };
}

// ------------------------------------------------------------------ spatial hash
const CELL = 8;
let grid: Map<number, Collider[]> | null = null;
function key(ix: number, iz: number) { return (ix + 4096) * 8192 + (iz + 4096); }
function colliderExtent(c: Collider) {
  if (c.kind === 'cyl') return { x0: c.x - c.r, x1: c.x + c.r, z0: c.z - c.r, z1: c.z + c.r };
  const cs = Math.abs(Math.cos(c.yaw)), sn = Math.abs(Math.sin(c.yaw));
  const ex = c.hx * cs + c.hz * sn, ez = c.hx * sn + c.hz * cs;
  return { x0: c.x - ex, x1: c.x + ex, z0: c.z - ez, z1: c.z + ez };
}
export function getGrid(): Map<number, Collider[]> {
  if (grid) return grid;
  grid = new Map();
  for (const c of buildZone().colliders) addCollider(c);
  return grid;
}
export function addCollider(c: Collider) {
  const g = grid ?? getGrid();
  const e = colliderExtent(c);
  for (let ix = Math.floor(e.x0 / CELL); ix <= Math.floor(e.x1 / CELL); ix++)
    for (let iz = Math.floor(e.z0 / CELL); iz <= Math.floor(e.z1 / CELL); iz++) {
      const k = key(ix, iz);
      let l = g.get(k);
      if (!l) g.set(k, (l = []));
      l.push(c);
    }
}
const _seen = new Set<Collider>();
export function queryColliders(x: number, z: number, r: number, out: Collider[] = []): Collider[] {
  const g = getGrid();
  out.length = 0;
  _seen.clear();
  for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++)
    for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
      const l = g.get(key(ix, iz));
      if (!l) continue;
      for (const c of l) if (!_seen.has(c)) { _seen.add(c); out.push(c); }
    }
  return out;
}

// ------------------------------------------------------------------ collision primitives
/** Push a circle (x,z,r) out of a collider in XZ. Returns penetration normal & depth or null. */
export function circleVsCollider(x: number, z: number, r: number, c: Collider): { nx: number; nz: number; d: number } | null {
  if (c.kind === 'cyl') {
    const dx = x - c.x, dz = z - c.z;
    const dist = Math.hypot(dx, dz);
    const pen = r + c.r - dist;
    if (pen <= 0) return null;
    if (dist < 1e-6) return { nx: 1, nz: 0, d: pen };
    return { nx: dx / dist, nz: dz / dist, d: pen };
  }
  // box: transform into local frame
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const dx = x - c.x, dz = z - c.z;
  const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
  const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
  let ox = lx - qx, oz = lz - qz;
  const dist = Math.hypot(ox, oz);
  let nlx: number, nlz: number, pen: number;
  if (dist > 1e-6) {
    pen = r - dist;
    if (pen <= 0) return null;
    nlx = ox / dist; nlz = oz / dist;
  } else {
    // center inside the box: push out along the axis of least penetration
    const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
    if (px < pz) { nlx = Math.sign(lx) || 1; nlz = 0; pen = px + r; }
    else { nlx = 0; nlz = Math.sign(lz) || 1; pen = pz + r; }
  }
  return { nx: nlx * cs - nlz * sn, nz: nlx * sn + nlz * cs, d: pen };
}

/** Is point (x,z) inside the collider's footprint (shrunk by m)? */
function footprintContains(x: number, z: number, c: Collider, m = 0): boolean {
  if (c.kind === 'cyl') return Math.hypot(x - c.x, z - c.z) < c.r + m;
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const dx = x - c.x, dz = z - c.z;
  const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
  return Math.abs(lx) < c.hx + m && Math.abs(lz) < c.hz + m;
}

const _q: Collider[] = [];
/** Ground height under the character: terrain or the top of a collider we stand on. */
export function groundAt(x: number, z: number, feetY: number, r = PHYS.R * 0.7): number {
  let g = heightAt(x, z);
  for (const c of queryColliders(x, z, r + 0.1, _q)) {
    if (c.y1 <= feetY + PHYS.STEP + 0.01 && c.y1 > g && footprintContains(x, z, c, r * 0.5)) g = c.y1;
  }
  return g;
}

/** Resolve horizontal overlap of the character cylinder at (x, feetY, z). */
function resolveXZ(s: CharState): void {
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    for (const c of queryColliders(s.x, s.z, PHYS.R + 0.2, _q)) {
      // vertical overlap? (stand on tops we can step onto)
      if (s.y + PHYS.H <= c.y0 || s.y >= c.y1 - 0.001) continue;
      if (c.y1 - s.y <= PHYS.STEP && s.grounded) continue; // step-up handled by ground query
      const hit = circleVsCollider(s.x, s.z, PHYS.R, c);
      if (!hit) continue;
      s.x += hit.nx * hit.d;
      s.z += hit.nz * hit.d;
      // remove velocity into the wall
      const vn = s.vx * hit.nx + s.vz * hit.nz;
      if (vn < 0) { s.vx -= vn * hit.nx; s.vz -= vn * hit.nz; }
      moved = true;
    }
    if (!moved) break;
  }
}

/** Steep terrain acts like a wall: push back down-slope. */
function resolveSlope(s: CharState, px: number, pz: number): void {
  const n = normalAt(s.x, s.z);
  if (n.y >= PHYS.MAX_SLOPE_NY) return;
  const g = heightAt(s.x, s.z);
  if (s.y > g + 0.3) return; // airborne above it
  // only block movement that climbs
  if (heightAt(s.x, s.z) > heightAt(px, pz) + 0.02) {
    s.x = px; s.z = pz;
    const hl = Math.hypot(n.x, n.z) || 1;
    const vn = (s.vx * -n.x + s.vz * -n.z) / hl;
    if (vn > 0) { s.vx += (n.x / hl) * vn; s.vz += (n.z / hl) * vn; }
  }
}

/** One fixed simulation step. Pure function of (state, input) → deterministic on both ends. */
export function stepCharacter(s: CharState, inp: MoveInput, speedMul = 1): void {
  const dt = clamp(inp.dt, 0.001, 0.05);
  // desired horizontal velocity in world space
  let mx = clamp(inp.mx, -1, 1), mz = clamp(inp.mz, -1, 1);
  const ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; }
  const sy = Math.sin(inp.yaw), cy = Math.cos(inp.yaw);
  // forward = -Z rotated by yaw ; right = +X rotated
  const fx = -sy, fz = -cy, rx = cy, rz = -sy;
  const speed = (inp.walk ? PHYS.WALK : inp.sprint ? PHYS.SPRINT : PHYS.RUN) * speedMul * (s.swimming ? 0.55 : 1);
  const tvx = (fx * mz + rx * mx) * speed, tvz = (fz * mz + rz * mx) * speed;
  const control = s.grounded || s.swimming ? 1 : PHYS.AIR_CONTROL;
  const a = PHYS.ACCEL * control * dt;
  const dvx = tvx - s.vx, dvz = tvz - s.vz;
  const dl = Math.hypot(dvx, dvz);
  if (dl <= a) { s.vx = tvx; s.vz = tvz; } else { s.vx += (dvx / dl) * a; s.vz += (dvz / dl) * a; }
  if (ml > 0.05) s.yaw = Math.atan2(-(tvx), -(tvz));

  // jump / gravity / swimming
  s.coyote = s.grounded ? 0.12 : Math.max(0, s.coyote - dt);
  const waterDepth = WATER_LEVEL - heightAt(s.x, s.z);
  s.swimming = waterDepth > PHYS.SWIM_DEPTH && s.y < WATER_LEVEL - PHYS.SWIM_DEPTH + 0.3;
  if (s.swimming) {
    const targetY = WATER_LEVEL - PHYS.SWIM_DEPTH;
    s.vy += (targetY - s.y) * 8 * dt - s.vy * 4 * dt;
    if (inp.jump && s.y > targetY - 0.2) s.vy = 3.5;
  } else {
    if (inp.jump && (s.grounded || s.coyote > 0)) { s.vy = PHYS.JUMP_V; s.grounded = false; s.coyote = 0; }
    s.vy -= PHYS.GRAVITY * dt;
    if (s.vy < -40) s.vy = -40;
  }

  // sub-stepped horizontal move (max 0.2 m per sub-step → no tunnelling)
  const travel = Math.hypot(s.vx, s.vz) * dt;
  const n = Math.max(1, Math.ceil(travel / 0.2));
  for (let i = 0; i < n; i++) {
    const px = s.x, pz = s.z;
    s.x += (s.vx * dt) / n;
    s.z += (s.vz * dt) / n;
    resolveXZ(s);
    resolveSlope(s, px, pz);
    // step up onto ledges / follow ground down slopes
    const g = groundAt(s.x, s.z, s.y);
    if (s.grounded && g > s.y && g - s.y <= PHYS.STEP + 0.01) s.y = g;
  }

  // vertical move
  s.y += s.vy * dt;
  // ceiling: hitting the underside of a collider
  if (s.vy > 0) {
    for (const c of queryColliders(s.x, s.z, PHYS.R, _q)) {
      if (c.y0 > s.y && c.y0 < s.y + PHYS.H && circleVsCollider(s.x, s.z, PHYS.R * 0.9, c)) { s.y = c.y0 - PHYS.H; s.vy = 0; }
    }
  }
  const g = groundAt(s.x, s.z, s.y);
  const wasGrounded = s.grounded;
  if (s.y <= g) {
    s.y = g; if (s.vy < 0) s.vy = 0; s.grounded = true;
  } else if (wasGrounded && s.vy <= 0 && s.y - g < 0.35 && !s.swimming) {
    // snap down small drops (walking down slopes / stairs) instead of micro-falling
    s.y = g; s.vy = 0; s.grounded = true;
  } else s.grounded = false;
  if (s.swimming) s.grounded = false;
  // final guarantee: never under the terrain
  const th = heightAt(s.x, s.z);
  if (s.y < th - 0.01) { s.y = th; s.vy = Math.max(0, s.vy); }
  resolveXZ(s);
}

// ------------------------------------------------------------------ raycasts (camera, LOS, spells)
/** Ray vs world (terrain + colliders). Returns hit distance (≤ maxDist). */
export function raycastWorld(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, ignoreTags?: Set<string>): number {
  let best = maxDist;
  // colliders: test those along the ray (sample grid cells along XZ)
  const steps = Math.ceil(maxDist / 4) + 1;
  const tested = new Set<Collider>();
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * maxDist;
    for (const c of queryColliders(ox + dx * t, oz + dz * t, 4, _q)) {
      if (tested.has(c)) continue;
      tested.add(c);
      if (ignoreTags && c.tag && ignoreTags.has(c.tag)) continue;
      const h = rayCollider(ox, oy, oz, dx, dy, dz, c);
      if (h !== null && h < best) best = h;
    }
  }
  // terrain: march then bisect
  const stepLen = 0.5;
  let prevT = 0;
  for (let t = stepLen; t <= best; t += stepLen) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    if (y < heightAt(x, z)) {
      let a = prevT, b = t;
      for (let k = 0; k < 8; k++) {
        const m = (a + b) / 2;
        if (oy + dy * m < heightAt(ox + dx * m, oz + dz * m)) b = m; else a = m;
      }
      return Math.min(best, a);
    }
    prevT = t;
  }
  return best;
}

function rayCollider(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, c: Collider): number | null {
  if (c.kind === 'cyl') {
    // infinite cylinder in XZ then clip by y range
    const fx = ox - c.x, fz = oz - c.z;
    const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), cc = fx * fx + fz * fz - c.r * c.r;
    let t0 = -Infinity, t1 = Infinity;
    if (a > 1e-9) {
      const disc = b * b - 4 * a * cc;
      if (disc < 0) return null;
      const sq = Math.sqrt(disc);
      t0 = (-b - sq) / (2 * a); t1 = (-b + sq) / (2 * a);
    } else if (cc > 0) return null;
    // y slab
    if (Math.abs(dy) > 1e-9) {
      let ya = (c.y0 - oy) / dy, yb = (c.y1 - oy) / dy;
      if (ya > yb) [ya, yb] = [yb, ya];
      t0 = Math.max(t0, ya); t1 = Math.min(t1, yb);
    } else if (oy < c.y0 || oy > c.y1) return null;
    if (t0 > t1 || t1 < 0) return null;
    return Math.max(0, t0);
  }
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const lox = (ox - c.x) * cs + (oz - c.z) * sn, loz = -(ox - c.x) * sn + (oz - c.z) * cs;
  const ldx = dx * cs + dz * sn, ldz = -dx * sn + dz * cs;
  let t0 = -Infinity, t1 = Infinity;
  const slab = (o: number, d: number, mn: number, mx: number) => {
    if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
    let a = (mn - o) / d, b = (mx - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  if (!slab(lox, ldx, -c.hx, c.hx)) return null;
  if (!slab(loz, ldz, -c.hz, c.hz)) return null;
  if (!slab(oy, dy, c.y0, c.y1)) return null;
  if (t1 < 0) return null;
  return Math.max(0, t0);
}

/** Line of sight between two points (for spells / AI). */
export function hasLineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.01) return true;
  return raycastWorld(ax, ay, az, dx / d, dy / d, dz / d, d, new Set(['bound'])) >= d - 0.05;
}
