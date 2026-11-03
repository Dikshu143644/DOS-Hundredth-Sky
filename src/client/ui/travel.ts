import { REGIONS, ZONE_IDS, type ZoneId } from '../../shared/regions';
import { withZone, heightAt, buildZone, ROADS, CITY } from '../../shared/world';
import type { C2S } from '../../shared/protocol';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export interface MapState { zone: string; attuned: string[]; bind: string; visited: string[] }

// ------------------------------------------------------------------ layout: how the regions border each other (from their gates)
const GRID: Record<ZoneId, [number, number]> = { frozen: [0, 0], tower: [2, 0], mountain: [0, 1], capital: [1, 1], desert: [2, 1], forest: [1, 2], forbidden: [1, 3] };
const COLS = 3, ROWS = 4, TILE = 220, PAD = 64, TOP = 130;
export const MAP_W = COLS * TILE + PAD * 2, MAP_H = ROWS * TILE + TOP + PAD;
/** Region-local metres → map pixels. */
export function toMap(zone: string, x: number, z: number): [number, number] {
  const g = GRID[zone as ZoneId] ?? GRID.capital;
  return [PAD + g[0] * TILE + ((x + 200) / 400) * TILE, TOP + g[1] * TILE + ((z + 200) / 400) * TILE];
}

type RGB = [number, number, number];
const hexRgb = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Biome palette per region: low ground → high ground (→ peaks), trees, roads. */
const PAL: Record<ZoneId, { lo: number; hi: number; peak?: number; tree: number; road: number }> = {
  capital: { lo: 0x5f8f45, hi: 0x9db96a, tree: 0x2f5a28, road: 0xb89a6a },
  forest: { lo: 0x2c5a2a, hi: 0x5a8040, tree: 0x163a18, road: 0x8a7048 },
  mountain: { lo: 0x7d8f5a, hi: 0x8a8478, peak: 0xf4f6f8, tree: 0x2e4a30, road: 0xa89878 },
  desert: { lo: 0xe0bf80, hi: 0xc4924e, tree: 0x6a7a3a, road: 0xa07a4a },
  frozen: { lo: 0xb8cfe2, hi: 0xffffff, tree: 0x4a6a70, road: 0x9aaab8 },
  forbidden: { lo: 0x4c3c34, hi: 0x84523e, tree: 0x2a1c16, road: 0x8e6e5a },
  tower: { lo: 0xa9b97f, hi: 0xd6cfa2, tree: 0x4a6a3a, road: 0xd8c8a0 },
};

let baseCanvas: HTMLCanvasElement | null = null;
export let paintMs = 0;
/** Paint every region from its real heightmap, roads, trees, towns and the Capital, once. */
function paintWorld(): HTMLCanvasElement {
  if (baseCanvas) return baseCanvas;
  const c = document.createElement('canvas'); c.width = MAP_W; c.height = MAP_H;
  const x = c.getContext('2d')!;
  // sea of clouds / ocean around the known world
  const sea = x.createLinearGradient(0, 0, 0, MAP_H);
  sea.addColorStop(0, '#78bccb'); sea.addColorStop(1, '#5fa6ba');
  x.fillStyle = sea; x.fillRect(0, 0, MAP_W, MAP_H);
  x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = 1;
  for (let yy = 8; yy < MAP_H; yy += 14) { x.beginPath(); for (let xx = 0; xx <= MAP_W; xx += 8) x.lineTo(xx, yy + Math.sin(xx * 0.08 + yy) * 2); x.stroke(); }
  // ---- one continent: organic coastline, regions blending into each other at their borders
  const S = 2, NW = Math.ceil(MAP_W / S), NH = Math.ceil(MAP_H / S);
  const vn = (a: number, b: number) => { // cheap smooth value noise, 0..1
    const xi = Math.floor(a), yi = Math.floor(b), xf = a - xi, yf = b - yi;
    const h = (p: number, q: number) => { const s = Math.sin(p * 127.1 + q * 311.7) * 43758.5453; return s - Math.floor(s); };
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
  };
  const fbm = (a: number, b: number) => vn(a, b) * 0.55 + vn(a * 2.1, b * 2.1) * 0.28 + vn(a * 4.3, b * 4.3) * 0.17;
  // continent shape: the three northern rows full width, the Forbidden Lands a peninsula to the south
  const L0 = PAD, R0 = PAD + COLS * TILE, T0 = TOP, B0 = TOP + 3 * TILE;
  const sdBox = (px: number, py: number, x0: number, y0: number, x1: number, y1: number, r: number) => {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
    const qx = Math.abs(px - cx) - hx, qy = Math.abs(py - cy) - hy;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const landSd = (px: number, py: number) => {
    const main = sdBox(px, py, L0 - 8, T0 - 8, R0 + 8, B0 + 4, 80);
    const pen = sdBox(px, py, L0 + TILE * 0.78, B0 - 40, L0 + TILE * 2.22, B0 + TILE + 10, 70);
    const n = (fbm(px / 110 + 3, py / 110) - 0.5) * 170 + (fbm(px / 36, py / 36) - 0.5) * 60 + (fbm(px / 11, py / 11) - 0.5) * 14;
    return smin(main, pen, 110) + Math.min(n, 38); // bays bite at most a little into a region; headlands reach out
  };
  // biome weight of each region at a map pixel: soft, warped, so borders wander and blend
  const centers = ZONE_IDS.map((z) => ({ z, x0: PAD + GRID[z][0] * TILE, y0: TOP + GRID[z][1] * TILE }));
  const weights = (px: number, py: number, out: Float32Array) => {
    const wx = px + (fbm(px / 90 + 11, py / 90 + 3) - 0.5) * 190 + (fbm(px / 26, py / 26) - 0.5) * 40, wy = py + (fbm(px / 90 + 37, py / 90 + 7) - 0.5) * 190 + (fbm(px / 26 + 5, py / 26 + 9) - 0.5) * 40;
    let sum = 0;
    for (let k = 0; k < centers.length; k++) {
      const c0 = centers[k], dx = Math.max(c0.x0 - wx, 0, wx - (c0.x0 + TILE)), dy = Math.max(c0.y0 - wy, 0, wy - (c0.y0 + TILE));
      const d = Math.hypot(dx, dy) / 34; const w = Math.exp(-d * d); out[k] = w; sum += w;
    }
    for (let k = 0; k < centers.length; k++) out[k] /= sum || 1;
  };
  const W = new Float32Array(NW * NH * centers.length), land = new Float32Array(NW * NH);
  const tmpW = new Float32Array(centers.length);
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
    const px = i * S + S / 2, py = j * S + S / 2, o = j * NW + i;
    land[o] = landSd(px, py);
    if (land[o] > 0) continue;
    weights(px, py, tmpW); W.set(tmpW, o * centers.length);
  }
  // elevation + colour, region by region (each region's own terrain, blended by weight)
  const E = new Float32Array(NW * NH), COL = new Float32Array(NW * NH * 3), WET = new Float32Array(NW * NH);
  centers.forEach((c0, k) => {
    const z = c0.z, P = PAL[z], R = REGIONS[z];
    withZone(z, () => {
      // this region's height range from its own tile
      let mn = 1e9, mx = -1e9;
      for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) { const h = heightAt(-200 + i * 20, -200 + j * 20); if (h < mn) mn = h; if (h > mx) mx = h; }
      const lo = hexRgb(P.lo), hi = hexRgb(P.hi), pk = P.peak !== undefined ? hexRgb(P.peak) : null;
      for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
        const o = j * NW + i; if (land[o] > 0) continue;
        const w = W[o * centers.length + k]; if (w < 0.02) continue;
        const lx = ((i * S + S / 2 - c0.x0) / TILE) * 400 - 200, lz = ((j * S + S / 2 - c0.y0) / TILE) * 400 - 200;
        const rf = (v: number) => { let u = ((v + 200) % 800 + 800) % 800; if (u > 400) u = 800 - u; return u - 200; }; // mirror beyond the region's edge: continuous, no stripes
        const h = heightAt(rf(lx), rf(lz));
        const t = Math.max(0, Math.min(1, (h - mn) / Math.max(1, mx - mn)));
        let col = mix(lo, hi, Math.min(1, t * 1.2));
        if (pk && t > 0.72) col = mix(col, pk, Math.min(1, (t - 0.72) / 0.12));
        E[o] += w * t * (mx - mn); WET[o] += h < R.water ? w : 0;
        COL[o * 3] += w * col[0]; COL[o * 3 + 1] += w * col[1]; COL[o * 3 + 2] += w * col[2];
      }
    });
  });
  const img = x.createImageData(MAP_W, MAP_H), d = img.data;
  const deep: RGB = [96, 166, 186], shallow: RGB = [146, 208, 214], sand: RGB = [226, 206, 160], water: RGB = [92, 168, 200];
  for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) {
    const o = j * NW + i, sd = land[o];
    let col: RGB;
    if (sd > 0) col = sd < 18 ? mix(shallow, deep, sd / 18) : deep;
    else {
      const ex = E[Math.min(NW * NH - 1, o + 1)] - E[o], ez = E[Math.min(NW * NH - 1, o + NW)] - E[o];
      const sh = Math.max(0.6, Math.min(1.32, 1 + (-ex - ez) * 0.05));
      col = [COL[o * 3] * sh, COL[o * 3 + 1] * sh, COL[o * 3 + 2] * sh];
      if (WET[o] > 0.5) col = water;
      if (sd > -5) col = mix(col, sand, 0.75); // beach
    }
    for (let b = 0; b < S; b++) for (let a = 0; a < S; a++) { const yy = j * S + b, xx = i * S + a; if (yy >= MAP_H || xx >= MAP_W) continue; const kk = (yy * MAP_W + xx) * 4; d[kk] = col[0]; d[kk + 1] = col[1]; d[kk + 2] = col[2]; d[kk + 3] = 255; }
  }
  x.putImageData(img, 0, 0);
  // gentle sea swell lines
  x.strokeStyle = 'rgba(255,255,255,.16)'; x.lineWidth = 1;
  for (let yy = 8; yy < MAP_H; yy += 16) { x.beginPath(); let pen = false; for (let xx = 0; xx <= MAP_W; xx += 8) { const y2 = yy + Math.sin(xx * 0.06 + yy) * 2; if (landSd(xx, y2) < 10) { pen = false; continue; } if (pen) x.lineTo(xx, y2); else x.moveTo(xx, y2); pen = true; } x.stroke(); }
  const isLand = (px: number, py: number) => landSd(px, py) < -4;
  const wAt = (k: number, px: number, py: number) => { const i = Math.min(NW - 1, Math.max(0, Math.floor(px / S))), j = Math.min(NH - 1, Math.max(0, Math.floor(py / S))); return land[j * NW + i] > 0 ? 0 : W[(j * NW + i) * centers.length + k]; };
  // rivers: from the high country down to the sea, meandering
  const river = (pts: [number, number][]) => {
    x.strokeStyle = 'rgba(70,130,190,.9)'; x.lineCap = 'round'; x.lineJoin = 'round';
    for (let k = 0; k < pts.length - 1; k++) {
      const [a0, b0] = pts[k], [a1, b1] = pts[k + 1];
      for (let s = 0; s < 1; s += 0.05) {
        const s2 = s + 0.05, ax = a0 + (a1 - a0) * s, ay = b0 + (b1 - b0) * s, bx = a0 + (a1 - a0) * s2, by = b0 + (b1 - b0) * s2;
        const off = (q: number, r: number) => (fbm(q / 40, r / 40) - 0.5) * 26;
        if (!isLand(ax, ay) && !isLand(bx, by)) continue;
        x.lineWidth = 1.6 + (k + s) * 0.9;
        x.beginPath(); x.moveTo(ax + off(ay, ax), ay + off(ax, ay)); x.lineTo(bx + off(by, bx), by + off(bx, by)); x.stroke();
      }
    }
  };
  const cxy = (z: ZoneId, fx: number, fy: number): [number, number] => [PAD + (GRID[z][0] + fx) * TILE, TOP + (GRID[z][1] + fy) * TILE];
  river([cxy('frozen', 0.6, 0.35), cxy('mountain', 0.75, 0.2), cxy('mountain', 0.55, 0.7), cxy('mountain', 0.2, 1.05), [PAD - 30, TOP + 2.25 * TILE]]);
  river([cxy('tower', 0.3, 0.75), cxy('capital', 0.85, 0.15), cxy('capital', 0.62, 0.62), cxy('forest', 0.35, 0.25), cxy('forest', 0.1, 0.8), [PAD - 30, TOP + 2.9 * TILE]]);
  river([cxy('desert', 0.35, 0.3), cxy('desert', 0.8, 0.75), cxy('desert', 1.0, 1.05), [MAP_W + 30, TOP + 2.4 * TILE]]);
  for (const z of ZONE_IDS) {
    const g = GRID[z], ox = PAD + g[0] * TILE, oy = TOP + g[1] * TILE, P = PAL[z];
    withZone(z, () => {
      const kz = ZONE_IDS.indexOf(z);
      const inSea = (wx: number, wz: number) => !isLand(ox + ((wx + 200) / 400) * TILE, oy + ((wz + 200) / 400) * TILE);
      const own = (wx: number, wz: number) => wAt(kz, ox + ((wx + 200) / 400) * TILE, oy + ((wz + 200) / 400) * TILE);
      const zd = buildZone();
      const m = (wx: number, wz: number): [number, number] => [ox + ((wx + 200) / 400) * TILE, oy + ((wz + 200) / 400) * TILE];
      // the Capital: walled stone city on its plateau
      if (z === 'capital') {
        const [a0, b0] = m(CITY.x0, CITY.z0), [a1, b1] = m(CITY.x1, CITY.z1);
        x.fillStyle = '#b8b0a0'; x.fillRect(a0, b0, a1 - a0, b1 - b0);
        x.strokeStyle = '#6a6458'; x.lineWidth = 2.5; x.strokeRect(a0, b0, a1 - a0, b1 - b0);
      }
      // roads
      x.strokeStyle = '#' + P.road.toString(16).padStart(6, '0'); x.lineWidth = 2; x.setLineDash([5, 3]);
      for (const road of ROADS) { x.beginPath(); road.forEach((p, k) => { const [a, b] = m(p.x, p.z); if (k) x.lineTo(a, b); else x.moveTo(a, b); }); x.stroke(); }
      x.setLineDash([]);
      // trees and rocks
      x.fillStyle = '#' + P.tree.toString(16).padStart(6, '0');
      for (let k = 0; k < zd.trees.length; k++) { const t = zd.trees[k]; if (inSea(t.x, t.z)) continue; const ow = own(t.x, t.z); if (ow < 0.35 || ((k * 7919) % 100) / 100 > ow * 1.4) continue; const [a, b] = m(t.x, t.z); x.globalAlpha = 0.75 * Math.min(1, ow * 1.3); x.beginPath(); x.arc(a, b, t.type >= 7 ? 0.9 : 1.3 + t.s * 0.25, 0, Math.PI * 2); x.fill(); }
      x.globalAlpha = 1;
      // buildings
      x.fillStyle = z === 'forbidden' ? '#5e4c44' : z === 'frozen' ? '#d8e8f8' : z === 'desert' ? '#e8d0a0' : '#d8ccb4';
      x.strokeStyle = 'rgba(40,30,20,.7)'; x.lineWidth = 0.8;
      for (const bd of zd.buildings) {
        const [a, b] = m(bd.x, bd.z); const w = (bd.w / 400) * TILE, dd = (bd.d / 400) * TILE;
        x.save(); x.translate(a, b); x.rotate(-bd.yaw); x.fillRect(-w / 2, -dd / 2, w, dd); x.strokeRect(-w / 2, -dd / 2, w, dd); x.restore();
      }
    });
  }
  // gates: the roads continue across region borders
  x.strokeStyle = 'rgba(150,118,72,.95)'; x.lineWidth = 2.6; x.lineCap = 'round';
  for (const z of ZONE_IDS) for (const e of REGIONS[z].exits) {
    if (z > e.to) continue;
    const back = REGIONS[e.to].exits.find((q) => q.to === z)!;
    // road from this region's town, through the gate, across the border, to the next town
    const t0 = REGIONS[z].town, t1 = REGIONS[e.to].town;
    const p0 = toMap(z, t0.x, t0.z), g0 = toMap(z, e.x, e.z), g1 = toMap(e.to, back.x, back.z), p1 = toMap(e.to, t1.x, t1.z);
    const mx = (g0[0] + g1[0]) / 2, my = (g0[1] + g1[1]) / 2;
    x.beginPath(); x.moveTo(p0[0], p0[1]); x.quadraticCurveTo(g0[0], g0[1], mx, my); x.quadraticCurveTo(g1[0], g1[1], p1[0], p1[1]); x.stroke();
  }
  // the Hundredth Tower rises out of the map into the sky
  const [tx] = toMap('tower', REGIONS.tower.tower.x, -200), ty = TOP + GRID.tower[1] * TILE + 20;
  const glow = x.createRadialGradient(tx, ty - 40, 4, tx, ty - 40, 120); glow.addColorStop(0, 'rgba(255,230,160,.65)'); glow.addColorStop(1, 'rgba(255,230,160,0)');
  x.fillStyle = glow; x.fillRect(tx - 130, ty - 170, 260, 260);
  const tw = x.createLinearGradient(tx - 16, 0, tx + 16, 0); tw.addColorStop(0, '#8a7a5a'); tw.addColorStop(0.5, '#fff1c8'); tw.addColorStop(1, '#6a5a40');
  x.fillStyle = tw; x.beginPath(); x.moveTo(tx - 18, ty + 6); x.lineTo(tx - 7, 6); x.lineTo(tx, 0); x.lineTo(tx + 7, 6); x.lineTo(tx + 18, ty + 6); x.closePath(); x.fill();
  x.strokeStyle = 'rgba(80,60,30,.6)'; x.lineWidth = 1; for (let k = 1; k < 12; k++) { const yy = 6 + (k / 12) * ty; const hw = 7 + (11 * k) / 12; x.beginPath(); x.moveTo(tx - hw, yy); x.lineTo(tx + hw, yy); x.stroke(); }
  // compass rose
  const cx = MAP_W - 70, cy = MAP_H - 70;
  x.strokeStyle = '#e8d29a'; x.fillStyle = '#e8d29a'; x.lineWidth = 1.5;
  x.beginPath(); x.arc(cx, cy, 30, 0, Math.PI * 2); x.stroke();
  for (let k = 0; k < 4; k++) { x.save(); x.translate(cx, cy); x.rotate((k * Math.PI) / 2); x.beginPath(); x.moveTo(0, -38); x.lineTo(6, 0); x.lineTo(-6, 0); x.closePath(); x.globalAlpha = k === 0 ? 1 : 0.6; x.fill(); x.restore(); }
  x.globalAlpha = 1; x.font = '600 13px -apple-system, Inter, system-ui, sans-serif'; x.textAlign = 'center'; x.fillText('N', cx, cy - 44);
  baseCanvas = c;
  return c;
}

/** World map (M): an illustrated map of the seven regions painted from their real terrain, with the
 *  Capital, towns, roads, gates, shrines (click an attuned one to fast-travel), bosses, the Hundredth
 *  Tower and you. Zoom with the wheel / pinch / buttons, drag to pan. */
export function worldMap(o: { state: MapState; level: number; send: (m: C2S) => void; onClose: () => void; toggleMinimap: () => void; me?: () => { zone: string; x: number; z: number; yaw: number } }) {
  const d = document.createElement('div');
  d.className = 'modal wm-modal'; d.id = 'worldmap';
  document.getElementById('ui')!.appendChild(d);
  const close = () => { d.remove(); window.removeEventListener('keydown', key, true); cancelAnimationFrame(raf); o.onClose(); };
  const key = (e: KeyboardEvent) => { if (e.code === 'Escape' || e.code === 'KeyM') { e.preventDefault(); e.stopPropagation(); close(); } };
  window.addEventListener('keydown', key, true);
  d.innerHTML = `<div class="wm-frame panel"><span class="crn tr"></span><span class="crn bl"></span>
    <div class="wm-head"><div class="wm-title">THE WORLD BENEATH THE HUNDREDTH SKY</div><button class="btn ghost small" data-mini>Minimap</button><button class="x" data-close aria-label="Close">✕</button></div>
    <div class="wm-main"><div class="wm-view"><div class="wm-world"></div>
      <div class="wm-zoom"><button data-z="1" aria-label="Zoom in">+</button><button data-z="-1" aria-label="Zoom out">−</button><button data-me aria-label="Center on me">◎</button></div>
      <div class="wm-pop"></div></div>
    <div class="wm-side"></div></div></div>`;
  const view = d.querySelector('.wm-view') as HTMLElement, world = d.querySelector('.wm-world') as HTMLElement, side = d.querySelector('.wm-side') as HTMLElement, pop = d.querySelector('.wm-pop') as HTMLElement;
  world.style.width = MAP_W + 'px'; world.style.height = MAP_H + 'px';
  const t0 = performance.now();
  world.appendChild(paintWorld());
  (window as any).__mapPaintMs = Math.round(performance.now() - t0);
  const layer = document.createElement('div'); layer.className = 'wm-layer'; world.appendChild(layer);
  const me = document.createElement('div'); me.className = 'wm-me'; me.innerHTML = '<i></i>'; world.appendChild(me);
  // view transform
  let s = 1, tx = 0, ty = 0;
  const apply = () => { world.style.transform = `translate(${tx}px,${ty}px) scale(${s})`; world.style.setProperty('--s', String(s)); world.style.setProperty('--k', String(Math.min(1, 1 / s))); world.classList.toggle('zoomed', s > 1.5); };
  const clampView = () => { const vw = view.clientWidth, vh = view.clientHeight; const w = MAP_W * s, h = MAP_H * s; tx = w < vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, tx)); ty = h < vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, ty)); };
  const zoomAt = (k: number, px: number, py: number) => { const ns = Math.min(4, Math.max(fit(), s * k)); tx = px - ((px - tx) * ns) / s; ty = py - ((py - ty) * ns) / s; s = ns; clampView(); apply(); };
  const fit = () => Math.min(view.clientWidth / MAP_W, view.clientHeight / MAP_H);
  const centerOn = (mx: number, my: number, ns = s) => { s = ns; tx = view.clientWidth / 2 - mx * s; ty = view.clientHeight / 2 - my * s; clampView(); apply(); };
  requestAnimationFrame(() => { s = fit(); clampView(); apply(); });
  view.addEventListener('wheel', (e) => { e.preventDefault(); const r = view.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  const pts = new Map<number, { x: number; y: number }>(); let pinch = 0;
  view.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('button, .wm-shrine, .wm-pop')) return; view.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); pop.classList.remove('on'); });
  view.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    if (pts.size === 2) { const [a, b] = [...pts.values()]; const dist = Math.hypot(a.x - b.x, a.y - b.y); p.x = e.clientX; p.y = e.clientY; const [a2, b2] = [...pts.values()]; const d2 = Math.hypot(a2.x - b2.x, a2.y - b2.y); if (pinch) { const r = view.getBoundingClientRect(); zoomAt(d2 / dist, (a2.x + b2.x) / 2 - r.left, (a2.y + b2.y) / 2 - r.top); } pinch = 1; return; }
    tx += e.clientX - p.x; ty += e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; clampView(); apply();
  });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
  view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
  d.querySelectorAll<HTMLElement>('[data-z]').forEach((b) => b.onclick = () => zoomAt(Number(b.dataset.z) > 0 ? 1.4 : 1 / 1.4, view.clientWidth / 2, view.clientHeight / 2));
  (d.querySelector('[data-me]') as HTMLElement).onclick = () => { const p = o.me?.(); if (p) { const [mx, my] = toMap(p.zone, p.x, p.z); centerOn(mx, my, Math.max(s, 2)); } };
  d.querySelector('[data-close]')!.addEventListener('click', close);
  d.querySelector('[data-mini]')!.addEventListener('click', () => o.toggleMinimap());

  const render = () => {
    const st = o.state;
    const html: string[] = [];
    for (const z of ZONE_IDS) {
      const r = REGIONS[z], seen = st.visited.includes(z) || st.zone === z;
      const g = GRID[z], cx = PAD + g[0] * TILE + TILE / 2, cy = TOP + g[1] * TILE;
      const danger = o.level < r.levels[0] - 2;
      html.push(`<div class="wm-region ${st.zone === z ? 'here' : ''} ${danger ? 'danger' : ''}" style="left:${cx}px;top:${cy + TILE - 8}px;max-width:${TILE - 16}px"><b>${esc(r.name)}</b><small>Lv ${r.levels[0]}–${r.levels[1]}${seen ? '' : ' · unexplored'}</small></div>`);
      const [tx2, ty2] = toMap(z, r.town.x, r.town.z);
      html.push(`<div class="wm-ico wm-town" style="left:${tx2}px;top:${ty2}px" title="${esc(r.town.name)}"><span>${z === 'capital' ? '♜' : '⌂'}</span><em>${esc(r.town.name)}</em></div>`);
      const [bx, by] = toMap(z, r.boss.x, r.boss.z);
      html.push(`<div class="wm-ico wm-boss" style="left:${bx}px;top:${by}px" title="Field boss">☠</div>`);
      for (const p of r.pois) { const [px, py] = toMap(z, p.x, p.z); if (Math.hypot(px - bx, py - by) < 12) continue; html.push(`<div class="wm-poi" style="left:${px}px;top:${py}px">${esc(p.name)}</div>`); }
      for (const sh of r.shrines) {
        const k = z + ':' + sh.id, has = st.attuned.includes(k); const [sx, sy] = toMap(z, sh.x, sh.z);
        html.push(`<div class="wm-shrine ${has ? 'on' : ''} ${st.bind === k ? 'bind' : ''}" data-k="${k}" style="left:${sx}px;top:${sy}px" title="${esc(has ? sh.name : 'Unattuned shrine')}"><i></i></div>`);
      }
    }
    const [tx3] = toMap('tower', REGIONS.tower.tower.x, -200);
    html.push(`<div class="wm-towerlbl" style="left:${tx3}px;top:${TOP - 18}px">THE HUNDREDTH TOWER</div>`);
    layer.innerHTML = html.join('');
    layer.querySelectorAll<HTMLElement>('.wm-shrine').forEach((el) => el.onclick = (e) => {
      e.stopPropagation();
      const k = el.dataset.k!, [z, id] = k.split(':'), sh = REGIONS[z as ZoneId].shrines.find((q) => q.id === id)!, has = st.attuned.includes(k);
      const r = view.getBoundingClientRect(), b = el.getBoundingClientRect();
      pop.style.left = Math.min(r.width - 220, Math.max(8, b.left - r.left - 100)) + 'px'; pop.style.top = Math.max(8, b.top - r.top - 96) + 'px';
      pop.innerHTML = has ? `<b>${esc(sh.name)}</b><small>${esc(REGIONS[z as ZoneId].name)}</small><button class="btn small" data-go="${k}">Travel here</button>` : `<b>Unattuned shrine</b><small>${esc(REGIONS[z as ZoneId].name)} · touch its crystal to attune</small>`;
      pop.classList.add('on');
      (pop.querySelector('[data-go]') as HTMLElement | null)?.addEventListener('click', () => { o.send({ type: 'travel', shrine: k }); close(); });
    });
    // compact fast-travel list: attuned shrines + how many are still locked
    const all = ZONE_IDS.flatMap((z) => REGIONS[z].shrines.map((sh) => ({ z, sh, k: z + ':' + sh.id })));
    const mine = all.filter((q) => st.attuned.includes(q.k));
    side.innerHTML = `<div class="h">FAST TRAVEL</div>${mine.map(({ z, sh, k }) => `<button class="wm-go ${st.bind === k ? 'bind' : ''}" data-go="${k}"><span>${esc(sh.name)}</span><small>${esc(REGIONS[z].name)}${st.bind === k ? ' · you rise here' : ''}</small></button>`).join('')}
      <div class="wm-locked">🔒 ${all.length - mine.length} shrines not yet attuned</div>
      <p class="wm-tip">Touch a shrine's crystal to attune it. Click a glowing shrine on the map to travel (not in combat). Walk through a gate at a region's edge to cross on foot.</p>`;
    side.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.onclick = () => { o.send({ type: 'travel', shrine: b.dataset.go! }); close(); });
  };
  let raf = 0;
  const tickMe = () => { const p = o.me?.(); if (p) { const [mx, my] = toMap(p.zone, p.x, p.z); me.style.left = mx + 'px'; me.style.top = my + 'px'; me.style.setProperty('--yaw', -p.yaw + 'rad'); } raf = requestAnimationFrame(tickMe); };
  render(); tickMe();
  return { close, update(st: MapState) { o.state = st; render(); } };
}
