import * as THREE from 'three';
import type { Engine } from '../engine/engine';
import { spellById } from '../../shared/combat';
import { heightAt } from '../../shared/world';

/** Spell & combat VFX (phase 2 rewrite).
 *  Particles are simulated on the GPU: each particle is written ONCE into a ring buffer (spawn
 *  position, velocity, birth time, life, size, gravity, colour, behaviour) and the vertex shader
 *  integrates drag + gravity and animates size/colour over life, so thousands of embers cost
 *  the CPU nothing per frame. Two pools: additive light (fire, sparks, holy light) and alpha
 *  smoke. Crisp geometry rides on top: lightning as glowing tubes, shockwave rings, light
 *  pillars. Every spell also claims a REAL light from the engine's light pool (shadowed on High+). */

const MODE = { glow: 0, fire: 1, spark: 2, smoke: 3 } as const;
type Mode = keyof typeof MODE;
interface Effect { t: number; dur: number; update(e: Effect, dt: number): boolean }

const PVERT = /* glsl */ `
  attribute vec3 aV; attribute vec4 aT; attribute vec4 aC;
  uniform float uTime, uScale;
  varying vec4 vC; varying float vK; varying float vMode;
  void main() {
    float age = uTime - aT.x, life = aT.y;
    if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    float k = age / life; float mode = aC.w;
    float drag = mode > 2.5 ? 1.6 : mode > 1.5 ? 0.6 : 1.1;
    vec3 p = position + aV * (1.0 - exp(-drag * age)) / drag + vec3(0.0, -0.5 * aT.w * age * age, 0.0);
    if (mode > 2.5) p += vec3(sin(age * 1.7 + position.x) , 0.0, cos(age * 1.3 + position.z)) * 0.25 * age; // smoke curls
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float sz = aT.z;
    if (mode < 0.5) sz *= 0.35 + 0.65 * (1.0 - k);            // glow: shrink
    else if (mode < 1.5) sz *= mix(1.0, 0.25, k * k);          // fire: burn down
    else if (mode < 2.5) sz *= 1.0 - k * 0.6;                  // spark
    else sz *= 0.5 + 1.8 * k;                                 // smoke: billow
    gl_PointSize = sz * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
    vC = aC; vK = k; vMode = mode;
  }`;
const PFRAG_ADD = /* glsl */ `
  varying vec4 vC; varying float vK; varying float vMode;
  void main() {
    vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
    if (r > 1.0) discard;
    float soft = pow(1.0 - r, 1.6), core = smoothstep(0.35, 0.0, r);
    vec3 c = vC.rgb;
    float fade = 1.0 - vK;
    if (vMode > 0.5 && vMode < 1.5) { // fire: white-hot → colour → deep ember
      c = mix(vec3(1.6, 1.4, 1.1), vC.rgb * 1.3, smoothstep(0.0, 0.35, vK));
      c = mix(c, vec3(0.45, 0.06, 0.01), smoothstep(0.45, 1.0, vK));
      fade = 1.0 - smoothstep(0.6, 1.0, vK);
    }
    if (vMode > 1.5) { soft = pow(1.0 - r, 3.0); core = smoothstep(0.25, 0.0, r) * 1.5; }
    vec3 col = c * soft * 1.4 + vec3(1.0) * core * 0.6 * (1.0 - vK);
    gl_FragColor = vec4(col * fade, 1.0);
  }`;
const PFRAG_SMOKE = /* glsl */ `
  varying vec4 vC; varying float vK; varying float vMode;
  void main() {
    vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0;
    if (r > 1.0) discard;
    float n = sin(q.x * 13.0 + vK * 3.0) * sin(q.y * 11.0 - vK * 2.0) * 0.15;
    float a = smoothstep(1.0, 0.2, r + n) * (1.0 - vK) * smoothstep(0.0, 0.15, vK) * 0.3;
    gl_FragColor = vec4(vC.rgb, a);
  }`;

class Pool {
  geo = new THREE.BufferGeometry();
  points: THREE.Points;
  mat: THREE.ShaderMaterial;
  private i = 0; private lo = Infinity; private hi = -1;
  constructor(public max: number, additive: boolean) {
    const g = this.geo;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aV', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const t = new Float32Array(max * 4); for (let k = 0; k < max; k++) t[k * 4] = -1e6; // all dead
    g.setAttribute('aT', new THREE.BufferAttribute(t, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 500 } }, vertexShader: PVERT, fragmentShader: additive ? PFRAG_ADD : PFRAG_SMOKE,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = additive ? 6 : 5;
  }
  spawn(time: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grav: number, c: THREE.Color, mode: number) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    const a = this.geo.attributes;
    (a.position.array as Float32Array).set([x, y, z], i * 3);
    (a.aV.array as Float32Array).set([vx, vy, vz], i * 3);
    (a.aT.array as Float32Array).set([time, life, size, grav], i * 4);
    (a.aC.array as Float32Array).set([c.r, c.g, c.b, mode], i * 4);
    if (i < this.lo) this.lo = i; if (i > this.hi) this.hi = i;
  }
  flush(time: number, scale: number) {
    this.mat.uniforms.uTime.value = time; this.mat.uniforms.uScale.value = scale;
    if (this.hi < 0) return;
    for (const [name, w] of [['position', 3], ['aV', 3], ['aT', 4], ['aC', 4]] as const) {
      const at = this.geo.attributes[name] as THREE.BufferAttribute;
      at.clearUpdateRanges(); at.addUpdateRange(this.lo * w, (this.hi - this.lo + 1) * w); at.needsUpdate = true;
    }
    this.lo = Infinity; this.hi = -1;
  }
}

const RING_FRAG = /* glsl */ `uniform vec3 uColor; uniform float uK; varying vec2 vUv;
  void main(){ float r = length(vUv - 0.5) * 2.0; float band = smoothstep(0.62, 0.9, r) * smoothstep(1.0, 0.9, r);
    gl_FragColor = vec4(uColor * band * (1.0 - uK) * 2.0, 1.0); }`;
const PILLAR_FRAG = /* glsl */ `uniform vec3 uColor; uniform float uK, uT; varying vec2 vUv; varying float vF;
  void main(){ float edge = 0.12 + pow(vF, 2.5) * 0.9; float h = pow(1.0 - vUv.y, 1.5);
    float streak = 0.7 + 0.3 * sin(vUv.x * 60.0 + uT * 6.0 + vUv.y * 8.0);
    gl_FragColor = vec4(uColor * h * streak * (1.0 - uK) * 0.55 * edge, 1.0); }`;
const UV_VERT = `varying vec2 vUv; varying float vF; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vec3 n = normalize(normalMatrix * normal); vF = 1.0 - abs(dot(n, normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`;

export class VFX {
  private effects: Effect[] = [];
  private add: Pool; private smoke: Pool;
  private time = 0;
  private density: number;
  private tmpC = new THREE.Color();
  constructor(public engine: Engine) {
    const q = engine.quality;
    this.density = q === 'low' ? 0.35 : q === 'medium' ? 0.6 : 1;
    this.add = new Pool(q === 'low' ? 4000 : 12000, true);
    this.smoke = new Pool(q === 'low' ? 600 : 2000, false);
    engine.scene.add(this.add.points, this.smoke.points);
  }
  private n(k: number) { return Math.max(1, Math.round(k * this.density)); }
  /** One particle (kept for callers of the old API). */
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, color: THREE.Color | number, grav = 0, mode: Mode = 'glow') {
    const c = color instanceof THREE.Color ? color : this.tmpC.set(color);
    (mode === 'smoke' ? this.smoke : this.add).spawn(this.time, p.x, p.y, p.z, v.x, v.y, v.z, life, size, grav, c, MODE[mode]);
  }
  burst(at: THREE.Vector3, n: number, speed: number, life: number, size: number, color: number, grav = 0, up = 0, mode: Mode = 'glow') {
    const c = new THREE.Color(color); const pool = mode === 'smoke' ? this.smoke : this.add;
    for (let i = 0, N = this.n(n); i < N; i++) {
      let x = Math.random() * 2 - 1, y = Math.random() * 2 - 1 + up, z = Math.random() * 2 - 1; const l = Math.hypot(x, y, z) || 1; const s = speed * (0.3 + Math.random() * 0.7) / l;
      x *= s; y *= s; z *= s;
      pool.spawn(this.time, at.x, at.y, at.z, x, y, z, life * (0.5 + Math.random() * 0.5), size * (0.6 + Math.random() * 0.6), grav, c, MODE[mode]);
    }
  }
  private ring(at: THREE.Vector3, color: number, r0: number, r1: number, dur: number, tilt = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 0 } }, vertexShader: UV_VERT, fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2 + tilt; m.position.copy(at); this.engine.scene.add(m);
    this.effects.push({ t: 0, dur, update: (e) => { const k = e.t / e.dur; const s = r0 + (r1 - r0) * (1 - (1 - k) ** 3); m.scale.setScalar(s); (m.material as THREE.ShaderMaterial).uniforms.uK.value = k; if (k >= 1) { m.removeFromParent(); m.geometry.dispose(); (m.material as THREE.Material).dispose(); return false; } return true; } });
  }
  private pillar(at: THREE.Vector3, color: number, radius: number, height: number, dur: number) {
    const g = new THREE.CylinderGeometry(radius, radius * 1.15, height, 32, 1, true); g.translate(0, height / 2, 0);
    const mat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 0 }, uT: { value: 0 } }, vertexShader: UV_VERT, fragmentShader: PILLAR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const m = new THREE.Mesh(g, mat); m.position.copy(at); this.engine.scene.add(m);
    this.effects.push({ t: 0, dur, update: (e) => { const k = e.t / e.dur; mat.uniforms.uK.value = Math.max(0, (k - 0.5) * 2); mat.uniforms.uT.value = e.t; m.scale.set(1 + k * 0.4, Math.min(1, k * 6), 1 + k * 0.4); if (k >= 1) { m.removeFromParent(); g.dispose(); mat.dispose(); return false; } return true; } });
  }

  /** Charging aura while chanting: spiralling motes, a ground rune ring and a growing light. */
  castAura(getPos: () => THREE.Vector3 | null, spellId: string, dur: number) {
    const sp = spellById(spellId); if (!sp) return;
    const col = new THREE.Color(sp.color);
    let ringed = false;
    this.effects.push({ t: 0, dur, update: (e) => {
      const p = getPos(); if (!p) return false;
      const k = e.t / e.dur;
      if (!ringed) { ringed = true; this.ring(p.clone().setY(p.y + 0.06), sp.color, 0.5, 1.8, Math.max(0.6, dur)); }
      for (let i = 0, N = this.n(5); i < N; i++) {
        const a = Math.random() * Math.PI * 2, r = 1.5 - k * 0.9;
        this.add.spawn(this.time, p.x + Math.cos(a) * r, p.y + 0.1 + Math.random() * 0.2, p.z + Math.sin(a) * r, -Math.cos(a) * 0.9 - Math.sin(a) * 1.2, 1.4 + k * 2.2, -Math.sin(a) * 0.9 + Math.cos(a) * 1.2, 0.9, 0.16 + k * 0.12, 0, col, MODE.spark);
      }
      if (spellId === 'ignis' && Math.random() < 0.6) this.add.spawn(this.time, p.x + (Math.random() - 0.5) * 0.3, p.y + 1.3, p.z + (Math.random() - 0.5) * 0.3, 0, 0.5, 0, 0.5, 0.5 + k * 0.5, -1, col, MODE.fire);
      this.engine.requestLight({ pos: new THREE.Vector3(p.x, p.y + 1.4, p.z), color: col, intensity: 4 + k * sp.light, distance: 9, priority: 4 });
      return e.t < e.dur + 0.1;
    } });
  }

  /** IGNIS: a roaring fireball (white-hot core, flame trail, smoke) → explosion. */
  ignis(from: THREE.Vector3, to: THREE.Vector3, onImpact: () => void) {
    const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
    const speed = 24, dur = dist / speed;
    const pos = from.clone(); const fire = new THREE.Color(0xff6a1f), smoke = new THREE.Color(0x4a4440);
    this.effects.push({ t: 0, dur, update: (e) => {
      pos.copy(from).addScaledVector(dir, Math.min(dist, e.t * speed));
      for (let i = 0, N = this.n(16); i < N; i++) {
        const j = () => (Math.random() - 0.5);
        this.add.spawn(this.time, pos.x + j() * 0.35, pos.y + j() * 0.35, pos.z + j() * 0.35, -dir.x * 3 + j() * 1.6, -dir.y * 3 + j() * 1.6 + 0.8, -dir.z * 3 + j() * 1.6, 0.35 + Math.random() * 0.3, 0.9 + Math.random() * 0.6, -1.5, fire, MODE.fire);
      }
      if (Math.random() < 0.7) this.smoke.spawn(this.time, pos.x, pos.y, pos.z, -dir.x, 0.8, -dir.z, 1.4, 0.9, -0.6, smoke, MODE.smoke);
      for (let i = 0; i < 2; i++) this.add.spawn(this.time, pos.x, pos.y, pos.z, (Math.random() - .5) * 6, Math.random() * 4, (Math.random() - .5) * 6, 0.6, 0.12, 9, fire, MODE.spark);
      this.add.spawn(this.time, pos.x, pos.y, pos.z, 0, 0, 0, 0.06, 2.6, 0, this.tmpC.set(0xffe2a0), MODE.glow);
      this.engine.requestLight({ pos: pos.clone(), color: 0xff8a3a, intensity: 60, distance: 22, priority: 10, shadow: true });
      if (e.t >= e.dur) { onImpact(); this.explosion(pos.clone(), 0xff6a1f, 5.5); return false; }
      return true;
    } });
  }
  explosion(at: THREE.Vector3, color: number, radius: number) {
    this.burst(at, 340, radius * 2.2, 0.9, 1.3, color, -1.5, 0.35, 'fire');
    this.burst(at, 160, radius * 3.2, 1.2, 0.16, 0xffc070, 9, 0.6, 'spark');
    this.burst(at.clone().setY(at.y + 0.6), 36, radius * 0.6, 2.4, 2.2, 0x5a524c, -0.8, 0.9, 'smoke');
    this.ring(new THREE.Vector3(at.x, heightAt(at.x, at.z) + 0.08, at.z), color, 0.6, radius * 1.6, 0.55);
    this.ring(at, 0xffd8a0, 0.4, radius * 1.1, 0.35, Math.PI / 2 * 0.0);
    this.engine.flash = Math.max(this.engine.flash, 0.12);
    const p = at.clone();
    this.effects.push({ t: 0, dur: 1.2, update: (e) => { this.engine.requestLight({ pos: p, color, intensity: 140 * (1 - e.t / e.dur) ** 2, distance: radius * 6, priority: 11, shadow: true }); return e.t < e.dur; } });
  }

  /** FULGUR: a branching sky bolt and a hand beam as glowing tubes, flicker, sparks, ground ring. */
  fulgur(from: THREE.Vector3, to: THREE.Vector3) {
    const jag = (a: THREE.Vector3, b: THREE.Vector3, j: number, n = 16) => {
      const pts = [a.clone()];
      for (let i = 1; i < n; i++) pts.push(a.clone().lerp(b, i / n).add(new THREE.Vector3((Math.random() - .5) * j, (Math.random() - .5) * j * 0.4, (Math.random() - .5) * j)));
      pts.push(b.clone()); return pts;
    };
    const sky = to.clone().add(new THREE.Vector3((Math.random() - .5) * 6, 40, (Math.random() - .5) * 6));
    const meshes: THREE.Mesh[] = [];
    const tube = (pts: THREE.Vector3[], r: number, color: number, op: number) => {
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.0), pts.length * 3, r, 5, false);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.engine.scene.add(m); meshes.push(m);
    };
    const main = jag(sky, to, 3.2);
    tube(main, 0.07, 0xffffff, 1); tube(main, 0.28, 0x6fb8ff, 0.45); tube(main, 0.7, 0x3a7dff, 0.15);
    for (let b = 0; b < 3; b++) { // branches
      const k = 3 + Math.floor(Math.random() * 9); const s = main[k];
      const end = s.clone().add(new THREE.Vector3((Math.random() - .5) * 10, -4 - Math.random() * 8, (Math.random() - .5) * 10));
      const bp = jag(s, end, 1.6, 6); tube(bp, 0.04, 0xe8f4ff, 0.9); tube(bp, 0.18, 0x6fb8ff, 0.35);
    }
    const beam = jag(from, to, 0.7, 10); tube(beam, 0.05, 0xffffff, 0.9); tube(beam, 0.2, 0x8fd4ff, 0.4);
    this.burst(to, 200, 10, 0.55, 0.14, 0xbfe6ff, 12, 0.6, 'spark');
    this.burst(to, 60, 3, 0.4, 1.1, 0x6fb8ff, 0, 0.3, 'glow');
    this.ring(new THREE.Vector3(to.x, heightAt(to.x, to.z) + 0.08, to.z), 0x8fd4ff, 0.4, 4.5, 0.4);
    this.engine.flash = 0.25; this.engine.env.lightning = 0.6;
    const p = to.clone();
    this.effects.push({ t: 0, dur: 0.5, update: (e) => {
      const k = e.t / e.dur, flick = Math.random() < 0.3 ? 0.25 : 1;
      for (const m of meshes) { const mm = m.material as THREE.MeshBasicMaterial; mm.opacity = (mm.userData.o0 ??= mm.opacity) * (1 - k) ** 0.6; mm.visible = flick > 0.5 || k < 0.15; }
      this.engine.requestLight({ pos: p.clone().setY(p.y + 2), color: 0x9fd8ff, intensity: 160 * (1 - k), distance: 30, priority: 12, shadow: true });
      if (k >= 1) { for (const m of meshes) { m.removeFromParent(); m.geometry.dispose(); (m.material as THREE.Material).dispose(); } return false; }
      return true;
    } });
  }

  /** LUX: a column of dawn light, an expanding ring of radiance and rising motes. */
  lux(at: THREE.Vector3) {
    const p = at.clone(); const gold = new THREE.Color(0xffe9a8), white = new THREE.Color(0xffffff);
    this.pillar(p, 0xffe2a0, 1.3, 11, 1.8);
    this.ring(p.clone().setY(p.y + 0.08), 0xffe9a8, 1, 9, 1.4);
    this.effects.push({ t: 0, dur: 1.6, update: (e) => {
      const k = e.t / e.dur, r = 1 + k * 8;
      for (let i = 0, N = this.n(30); i < N; i++) { const a = Math.random() * Math.PI * 2; this.add.spawn(this.time, p.x + Math.cos(a) * r, p.y + 0.2 + Math.random() * 0.4, p.z + Math.sin(a) * r, 0, 1.5 + Math.random() * 2.5, 0, 1.1, 0.2, -0.4, i % 2 ? gold : white, MODE.spark); }
      for (let i = 0, N = this.n(5); i < N; i++) this.add.spawn(this.time, p.x + (Math.random() - .5) * 2.4, p.y + Math.random() * 2, p.z + (Math.random() - .5) * 2.4, 0, 3 + Math.random() * 3, 0, 1.4, 0.5, 0, gold, MODE.glow);
      this.engine.requestLight({ pos: new THREE.Vector3(p.x, p.y + 2.5, p.z), color: 0xffeeb8, intensity: 70 * (1 - k * k), distance: 26, priority: 9, shadow: true });
      return e.t < e.dur;
    } });
  }
  bolt(from: THREE.Vector3, to: THREE.Vector3) {
    const dir = to.clone().sub(from); const d = dir.length(); dir.normalize();
    const pos = from.clone(); const c = new THREE.Color(0x9b4bff);
    this.effects.push({ t: 0, dur: d / 18, update: (e) => {
      pos.copy(from).addScaledVector(dir, Math.min(d, e.t * 18));
      for (let i = 0; i < 4; i++) this.add.spawn(this.time, pos.x, pos.y, pos.z, (Math.random() - .5), (Math.random() - .5), (Math.random() - .5), 0.4, 0.4, 0, c, MODE.glow);
      this.engine.requestLight({ pos: pos.clone(), color: 0x9b4bff, intensity: 12, distance: 8, priority: 3 });
      if (e.t >= e.dur) { this.burst(pos, 40, 3, 0.5, 0.15, 0xc28bff, 4, 0.3, 'spark'); return false; }
      return true;
    } });
  }
  slash(at: THREE.Vector3, yaw: number, color = 0xfff2d0) {
    const c = new THREE.Color(color);
    for (let i = 0; i < 34; i++) {
      const a = yaw + (i / 34 - 0.5) * 1.9;
      this.add.spawn(this.time, at.x - Math.sin(a) * 1.3, at.y + 1.1 + (i / 34 - 0.5) * 0.6, at.z - Math.cos(a) * 1.3, -Math.sin(a) * 1.5, 0, -Math.cos(a) * 1.5, 0.22, 0.22, 0, c, MODE.spark);
    }
  }
  arrow(from: THREE.Vector3, to: THREE.Vector3, color = 0xd9f6ff) {
    const dir = to.clone().sub(from); const d = dir.length(); dir.normalize();
    const pos = from.clone(); const c = new THREE.Color(color);
    this.effects.push({ t: 0, dur: d / 45, update: (e) => { pos.copy(from).addScaledVector(dir, Math.min(d, e.t * 45)); this.add.spawn(this.time, pos.x, pos.y, pos.z, 0, 0, 0, 0.2, 0.16, 0, c, MODE.spark); return e.t < e.dur; } });
  }
  hit(at: THREE.Vector3, color = 0xffd8a0) { this.burst(at, 34, 5, 0.4, 0.12, color, 10, 0.4, 'spark'); this.burst(at, 6, 0.5, 0.15, 0.8, color, 0, 0, 'glow'); }
  levelUp(at: THREE.Vector3) {
    const p = at.clone(); const g = new THREE.Color(0xffd36a), w = new THREE.Color(0xffffff);
    this.pillar(p, 0xffd36a, 0.9, 6, 2);
    this.effects.push({ t: 0, dur: 2, update: (e) => {
      for (let i = 0, N = this.n(16); i < N; i++) { const a = Math.random() * 6.28, r = 1.1; this.add.spawn(this.time, p.x + Math.cos(a) * r, p.y + Math.random() * 0.3, p.z + Math.sin(a) * r, 0, 4 + Math.random() * 3, 0, 1, 0.22, 0, i % 2 ? g : w, MODE.spark); }
      this.engine.requestLight({ pos: p.clone().setY(p.y + 2), color: 0xffd36a, intensity: 30, distance: 12, priority: 6 });
      return e.t < e.dur;
    } });
  }
  loot(at: THREE.Vector3, rare: boolean) {
    const p = at.clone(); p.y = heightAt(p.x, p.z); const c = new THREE.Color(rare ? 0xc46bff : 0xffd36a);
    this.effects.push({ t: 0, dur: 6, update: (e) => { if (Math.random() < 0.6) this.add.spawn(this.time, p.x + (Math.random() - .5) * .4, p.y, p.z + (Math.random() - .5) * .4, 0, 3, 0, 0.8, 0.18, 0, c, MODE.spark); return e.t < e.dur; } });
  }
  death(at: THREE.Vector3) { this.burst(at.clone().setY(at.y + 1), 80, 2.5, 1.4, 0.3, 0x8fb8ff, -1, 0.5, 'spark'); this.burst(at.clone().setY(at.y + 0.6), 14, 1, 2, 1.6, 0x3a4250, -0.4, 0.5, 'smoke'); }

  update(dt: number) {
    this.time += dt;
    for (let i = this.effects.length - 1; i >= 0; i--) { const e = this.effects[i]; e.t += dt; if (!e.update(e, dt)) this.effects.splice(i, 1); }
    const scale = this.engine.renderer.domElement.height * 0.62;
    this.add.flush(this.time, scale); this.smoke.flush(this.time, scale);
  }
}
