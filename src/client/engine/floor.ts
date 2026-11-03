import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { floorPlan, themeOf, TRAP, SYMBOLS, type FloorPlan } from '../../shared/tower';
import { worldUV } from './city';
import { arenaPlan, type ArenaKind } from '../../shared/instances';
import { tex } from './assets';
import { FloorTheme } from './floortheme';

export interface TowerView { floor: number; seal: boolean; lit: number[]; braziers: number[]; order: number[] | null; chest: boolean; now: number }
function bake(geo: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0) { return geo.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z)); }
function merged(geos: THREE.BufferGeometry[]) {
  return mergeGeometries(geos.map((x) => { const y = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(y.attributes)) if (!['position', 'normal', 'uv'].includes(k)) y.deleteAttribute(k); if (!y.attributes.uv) y.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(y.attributes.position.count * 2), 2)); return y; }))!;
}
function glyphTex(text: string, size = 256, fg = '#ffffff', bg = 'rgba(0,0,0,0)', font = 150) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!; g.fillStyle = bg; g.fillRect(0, 0, size, size);
  g.fillStyle = fg; g.font = `700 ${font}px "Segoe UI Symbol", "Noto Sans Symbols 2", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, size / 2, size / 2 + 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Phase 4 · M5: everything a Tower floor draws on top of its platform: walls, the stairway seal,
 *  spike plates, rune plates + stele, braziers, the vault chest and the landing fountain. */
export class FloorDeco {
  group = new THREE.Group();
  P: FloorPlan;
  seal: THREE.Mesh;
  spikes: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; phase: number }[] = [];
  runes: THREE.MeshStandardMaterial[] = [];
  braziers: THREE.Sprite[] = [];
  chest: THREE.Mesh | null = null;
  state: TowerView | null = null;
  clock: () => number = () => performance.now() / 1000;
  sealMat: THREE.ShaderMaterial;
  theme: FloorTheme;
  constructor(scene: THREE.Scene, n: number, flameTex: THREE.Texture) {
    scene.add(this.group);
    const P = (this.P = floorPlan(n)), th = themeOf(n);
    // POLISH-1: per-band interior (materials, vaults, props, particles, light)
    this.theme = new FloorTheme(this.group, P, n);
    const stone = this.theme.wallMat, trim = this.theme.trimMat;
    const wallG: THREE.BufferGeometry[] = [], trimG: THREE.BufferGeometry[] = [];
    for (const w of P.walls) {
      wallG.push(bake(worldUV(new THREE.BoxGeometry(w.hx * 2, w.h, w.hz * 2), 4), w.x, w.h / 2, w.z));
      trimG.push(bake(worldUV(new THREE.BoxGeometry(w.hx * 2 + 0.4, 0.5, w.hz * 2 + 0.4), 3), w.x, w.h + 0.25, w.z));
    }
    // pillars at every room corner + floor trim rings around the rooms
    for (let i = 0; i <= P.cols; i++) for (let j = 0; j <= P.rows; j++) {
      const x = -(P.cols * P.R) / 2 + i * P.R, z = -(P.rows * P.R) / 2 + j * P.R;
      wallG.push(bake(worldUV(new THREE.BoxGeometry(2.2, P.walls[0].h + 1.4, 2.2), 3), x, (P.walls[0].h + 1.4) / 2, z));
      trimG.push(bake(worldUV(new THREE.BoxGeometry(2.6, 0.5, 2.6), 3), x, P.walls[0].h + 1.6, z));
    }
    const wm = new THREE.Mesh(merged(wallG), stone); wm.castShadow = true; wm.receiveShadow = true; this.group.add(wm);
    const tm = new THREE.Mesh(merged(trimG), trim); tm.castShadow = true; tm.receiveShadow = true; this.group.add(tm);
    // stairway seal: a shimmering barrier across the doorway
    this.sealMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(th.accent) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uCol; varying vec2 vUv;
        void main(){ float h = sin(vUv.x*40.0 + uTime*2.0)*0.5+0.5; float v = sin(vUv.y*24.0 - uTime*3.0)*0.5+0.5;
          float a = 0.18 + 0.32*h*v + 0.35*smoothstep(0.85,1.0,abs(vUv.x*2.0-1.0)); gl_FragColor = vec4(uCol*a*1.4, a); }`,
    });
    const s = P.seal, long = Math.max(s.hx, s.hz) * 2;
    this.seal = new THREE.Mesh(new THREE.PlaneGeometry(long, 6.5), this.sealMat);
    this.seal.position.set(s.x, 3.25, s.z); if (s.hx < s.hz) this.seal.rotation.y = Math.PI / 2;
    this.group.add(this.seal);
    // plates
    const plateG = new THREE.CylinderGeometry(1, 1, 0.12, 24);
    for (const pl of P.plates) {
      if (pl.kind === 'spike') {
        const mat = new THREE.MeshStandardMaterial({ color: 0x8a8278, emissive: 0xff5a3a, emissiveIntensity: 0, roughness: 0.6, metalness: 0.3 });
        const base = new THREE.Mesh(new THREE.BoxGeometry(pl.r * 2, 0.08, pl.r * 2), mat); base.position.set(pl.x, 0.04, pl.z); base.receiveShadow = true; this.group.add(base);
        const sg: THREE.BufferGeometry[] = [];
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) sg.push(bake(new THREE.ConeGeometry(0.16, 0.9, 6), pl.x + a * 0.6, 0.45, pl.z + b * 0.6));
        const spikes = new THREE.Mesh(merged(sg), new THREE.MeshStandardMaterial({ color: 0xd8d4cc, metalness: 0.7, roughness: 0.3 }));
        spikes.castShadow = true; this.group.add(spikes);
        this.spikes.push({ mesh: spikes, mat, phase: pl.phase ?? 0 });
      } else if (pl.kind === 'rune') {
        const mat = new THREE.MeshStandardMaterial({ color: 0xe8e2d6, map: glyphTex(pl.sym ?? '?', 256, '#3a3026', '#e8e2d6'), emissive: th.accent, emissiveIntensity: 0, roughness: 0.5 });
        const m = new THREE.Mesh(plateG, [new THREE.MeshStandardMaterial({ color: 0xb8b0a4 }), mat, new THREE.MeshStandardMaterial({ color: 0xb8b0a4 })]);
        m.scale.set(pl.r, 1, pl.r); m.position.set(pl.x, 0.06, pl.z); m.receiveShadow = true; this.group.add(m);
        this.runes.push(mat);
      } else if (pl.kind === 'brazier') {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.35, 1.5, 12), trim); b.position.set(pl.x, 0.75, pl.z); b.castShadow = true; this.group.add(b);
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.5, 0.35, 16), trim); bowl.position.set(pl.x, 1.6, pl.z); this.group.add(bowl);
        const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
        f.scale.set(1.6, 2.4, 1); f.position.set(pl.x, 2.6, pl.z); this.group.add(f); this.braziers.push(f);
        const ring = new THREE.Mesh(new THREE.RingGeometry(pl.r - 0.12, pl.r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: th.accent, transparent: true, opacity: 0.35 }));
        ring.position.set(pl.x, 0.03, pl.z); this.group.add(ring);
      } else if (pl.kind === 'chest') {
        const gold = new THREE.MeshStandardMaterial({ color: 0xc89a48, metalness: 0.6, roughness: 0.35, emissive: 0x6a4a10, emissiveIntensity: 0.4 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.2), gold); body.position.set(pl.x, 0.5, pl.z); body.castShadow = true; this.group.add(body);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.8, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), gold); lid.position.set(pl.x, 1.0, pl.z); lid.castShadow = true; this.group.add(lid);
        this.chest = lid;
      } else if (pl.kind === 'fountain') {
        const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.8, 24), trim); basin.position.set(pl.x, 0.4, pl.z); basin.castShadow = true; this.group.add(basin);
        const water = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.05, 24), new THREE.MeshStandardMaterial({ color: 0x9ad8e8, emissive: 0x4ab8d8, emissiveIntensity: 0.6, roughness: 0.1, transparent: true, opacity: 0.85 }));
        water.position.set(pl.x, 0.78, pl.z); this.group.add(water);
        const ring = new THREE.Mesh(new THREE.RingGeometry(pl.r + 1.4, pl.r + 1.55, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9ae8ff, transparent: true, opacity: 0.4 }));
        ring.position.set(pl.x, 0.03, pl.z); this.group.add(ring);
      }
    }
    // the stele in the rune chamber shows the order
    if (P.puzzle?.kind === 'runes' && P.puzzle.order) {
      const seq = P.puzzle.order.map((k) => SYMBOLS[k]).join(' ');
      const face = new THREE.MeshStandardMaterial({ map: glyphTex(seq, 512, '#2a2420', '#efe8dc', 92), emissive: th.accent, emissiveIntensity: 0.15, roughness: 0.6 });
      const stele = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 0.7), [trim, trim, trim, trim, face, face]);
      stele.position.set(P.gate.x, 1.6, P.gate.z); stele.castShadow = true; this.group.add(stele);
    }
  }
  setState(v: TowerView, clock: () => number) { this.state = v; this.clock = clock; }
  update(t: number) {
    this.theme.update(t);
    this.sealMat.uniforms.uTime.value = t;
    const st = this.state;
    this.seal.visible = !st?.seal;
    const now = this.clock();
    for (const s of this.spikes) {
      const ph = (now + s.phase) % TRAP.period;
      const up = ph < TRAP.active ? 1 : ph > TRAP.period - 0.5 ? 0.25 : 0; // warn glow just before they rise
      s.mesh.position.y = ph < TRAP.active ? 0 : -0.95;
      s.mat.emissiveIntensity = up * 1.6;
    }
    this.runes.forEach((m, k) => { m.emissiveIntensity = st?.lit.includes(k) || st?.seal ? 1.4 + Math.sin(t * 4) * 0.2 : 0; });
    this.braziers.forEach((f, k) => { const on = !!st?.braziers[k] || !!st?.seal; (f.material as THREE.SpriteMaterial).opacity = on ? 0.95 : 0; const q = 0.9 + Math.sin(t * 12 + k) * 0.1; f.scale.set(1.6 * q, 2.4 * q, 1); });
    if (this.chest) this.chest.rotation.x = st?.chest ? -1.1 : 0;
  }
  dispose(scene: THREE.Scene) { scene.remove(this.group); this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); }
}

/** Phase 4 · M6: the Crimson Ring (PvP) and the Eclipse Throne (raid): a parapet ring, pillars and floor rings. */
export class ArenaDeco {
  group = new THREE.Group();
  constructor(scene: THREE.Scene, kind: ArenaKind) {
    scene.add(this.group);
    const P = arenaPlan(kind);
    const stone = new THREE.MeshStandardMaterial({ map: tex('tex/brick_col.jpg'), normalMap: tex('tex/brick_nor.jpg', { srgb: false }), color: P.wall, roughness: 0.9, side: THREE.DoubleSide });
    const trim = new THREE.MeshStandardMaterial({ map: tex('tex/rock_col.jpg'), normalMap: tex('tex/rock_nor.jpg', { srgb: false }), color: P.wall, roughness: 0.85 });
    const wall = new THREE.Mesh(worldUV(new THREE.CylinderGeometry(P.wallR + 0.6, P.wallR + 0.6, 2.4, 96, 1, true), 4), stone); wall.position.y = 1.2; wall.receiveShadow = true; this.group.add(wall);
    const inner = new THREE.Mesh(worldUV(new THREE.CylinderGeometry(P.wallR - 0.6, P.wallR - 0.6, 2.4, 96, 1, true), 4), stone); inner.position.y = 1.2; this.group.add(inner);
    const cap = new THREE.Mesh(new THREE.RingGeometry(P.wallR - 0.8, P.wallR + 0.8, 96).rotateX(-Math.PI / 2), trim); cap.position.y = 2.42; this.group.add(cap);
    for (const p of P.pillars) {
      const m = new THREE.Mesh(worldUV(new THREE.CylinderGeometry(p.r, p.r * 1.15, p.h, 16), 3), stone); m.position.set(p.x, p.h / 2, p.z); m.castShadow = true; m.receiveShadow = true; this.group.add(m);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.35, p.r * 1.2, 0.5, 16), trim); top.position.set(p.x, p.h + 0.25, p.z); this.group.add(top);
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: P.accent, transparent: true, opacity: 0.45, depthWrite: false });
    for (const r of kind === 'raid' ? [8, 8.3, 18, 30] : [5, 5.25, 14]) { const m = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.18, 96).rotateX(-Math.PI / 2), ringMat); m.position.y = 0.03; this.group.add(m); }
    if (kind === 'raid') {
      const dais = new THREE.Mesh(worldUV(new THREE.CylinderGeometry(8, 8.6, 0.4, 48), 3), trim); dais.position.y = 0.2; dais.receiveShadow = true; this.group.add(dais);
    } else {
      for (const e of P.entry) { const m = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false })); m.position.set(e.x, 0.04, e.z); this.group.add(m); }
    }
  }
  update(t: number) { void t; }
  dispose(scene: THREE.Scene) { scene.remove(this.group); this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); }
}
