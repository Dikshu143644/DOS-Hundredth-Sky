import * as THREE from 'three';
import type { Engine } from '../engine/engine';
import { spellById } from '../../shared/combat';
import { heightAt } from '../../shared/world';

/** Spell & combat VFX. Each spell is a GPU-cheap particle system plus a REAL dynamic light from the
 *  engine's light pool (IGNIS's fireball claims the shadow-casting light on High/Ultra, so trees and
 *  walls throw moving shadows as it flies). */
interface Particle { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; size: number; color: THREE.Color; grav: number }
interface Effect { t: number; dur: number; update(e: Effect, dt: number): boolean; data: any }

function spriteTex(kind: 'soft' | 'spark'): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (kind === 'soft') { gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,255,.9)'); gr.addColorStop(0.3, 'rgba(255,255,255,.15)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); }
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class VFX {
  private parts: Particle[] = [];
  private effects: Effect[] = [];
  private points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private MAX = 6000;
  constructor(public engine: Engine) {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.MAX * 3), 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.MAX * 3), 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(this.MAX), 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTex: { value: spriteTex('soft') }, uScale: { value: 400 } },
      vertexShader: 'attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform sampler2D uTex; varying vec3 vC; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC * t.a * 2.2, t.a); }',
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    engine.scene.add(this.points);
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, color: THREE.Color | number, grav = 0) {
    if (this.parts.length >= this.MAX) this.parts.shift();
    this.parts.push({ p: p.clone(), v: v.clone(), life, max: life, size, color: new THREE.Color(color), grav });
  }
  burst(at: THREE.Vector3, n: number, speed: number, life: number, size: number, color: number, grav = 0, up = 0) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5 + up, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      this.emit(at, v, life * (0.5 + Math.random() * 0.5), size * (0.6 + Math.random() * 0.6), color, grav);
    }
  }

  /** Charging aura while chanting. */
  castAura(getPos: () => THREE.Vector3 | null, spellId: string, dur: number) {
    const sp = spellById(spellId); if (!sp) return;
    const col = new THREE.Color(sp.color);
    this.effects.push({ t: 0, dur, data: null, update: (e, dt) => {
      const p = getPos(); if (!p) return false;
      const k = e.t / e.dur;
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2, r = 1.6 - k * 0.9;
        const at = new THREE.Vector3(p.x + Math.cos(a) * r, p.y + 0.1 + Math.random() * 0.2, p.z + Math.sin(a) * r);
        this.emit(at, new THREE.Vector3(-Math.cos(a) * 0.6, 1.2 + k * 2, -Math.sin(a) * 0.6), 0.9, 0.25 + k * 0.2, col);
      }
      // rune circle
      if (Math.random() < 0.5) for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2 + e.t; this.emit(new THREE.Vector3(p.x + Math.cos(a) * 1.3, p.y + 0.05, p.z + Math.sin(a) * 1.3), new THREE.Vector3(0, 0.05, 0), 0.15, 0.18, col); }
      this.engine.requestLight({ pos: new THREE.Vector3(p.x, p.y + 1.4, p.z), color: col, intensity: 4 + k * sp.light, distance: 9, priority: 4 });
      return true;
    } });
  }

  ignis(from: THREE.Vector3, to: THREE.Vector3, onImpact: () => void) {
    const dir = to.clone().sub(from); const dist = dir.length(); dir.normalize();
    const speed = 26, dur = dist / speed;
    const pos = from.clone();
    this.effects.push({ t: 0, dur, data: null, update: (e, dt) => {
      pos.copy(from).addScaledVector(dir, Math.min(dist, e.t * speed));
      for (let i = 0; i < 14; i++) this.emit(pos.clone().add(new THREE.Vector3((Math.random() - .5) * .5, (Math.random() - .5) * .5, (Math.random() - .5) * .5)), dir.clone().multiplyScalar(-2).add(new THREE.Vector3((Math.random() - .5) * 2, Math.random() * 1.5, (Math.random() - .5) * 2)), 0.5, 0.7, i % 3 ? 0xff7a1f : 0xffd36a);
      this.emit(pos, new THREE.Vector3(), 0.08, 2.2, 0xffe8b0);
      this.engine.requestLight({ pos: pos.clone(), color: 0xff8a3a, intensity: 60, distance: 22, priority: 10, shadow: true });
      if (e.t >= e.dur) { onImpact(); this.explosion(pos.clone(), 0xff6a1f, 5.5); return false; }
      return true;
    } });
  }
  explosion(at: THREE.Vector3, color: number, radius: number) {
    this.burst(at, 260, radius * 2.4, 1.1, 1.1, color, -2, 0.4);
    this.burst(at, 120, radius * 1.2, 1.6, 1.6, 0xffd36a, -1, 0.6);
    this.burst(at, 90, 3, 2.6, 2.2, 0x40281a, 0.6, 0.8); // smoke-ish embers
    const p = at.clone();
    this.effects.push({ t: 0, dur: 1.2, data: null, update: (e) => { this.engine.requestLight({ pos: p, color, intensity: 140 * (1 - e.t / e.dur) ** 2, distance: radius * 6, priority: 11, shadow: true }); return e.t < e.dur; } });
  }
  fulgur(from: THREE.Vector3, to: THREE.Vector3) {
    // a jagged bolt from the sky onto the target + a beam from the caster's hand
    const segs = (a: THREE.Vector3, b: THREE.Vector3, jag: number) => {
      const pts = [a.clone()]; const n = 14;
      for (let i = 1; i < n; i++) pts.push(a.clone().lerp(b, i / n).add(new THREE.Vector3((Math.random() - .5) * jag, (Math.random() - .5) * jag * 0.4, (Math.random() - .5) * jag)));
      pts.push(b.clone()); return pts;
    };
    const sky = to.clone().add(new THREE.Vector3((Math.random() - .5) * 6, 40, (Math.random() - .5) * 6));
    const lines: THREE.Line[] = [];
    for (const [a, b, j, w] of [[sky, to, 3, 1], [from, to, 0.8, 0.6]] as [THREE.Vector3, THREE.Vector3, number, number][]) {
      for (let k = 0; k < 2; k++) {
        const g = new THREE.BufferGeometry().setFromPoints(segs(a, b, j));
        const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: k ? 0xffffff : 0x8fd4ff, transparent: true, opacity: w, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.engine.scene.add(l); lines.push(l);
      }
    }
    this.burst(to, 160, 9, 0.6, 0.6, 0x8fd4ff, -6, 0.5);
    this.engine.flash = 0.25; this.engine.env.lightning = 0.6;
    const p = to.clone();
    this.effects.push({ t: 0, dur: 0.45, data: null, update: (e) => {
      for (const l of lines) (l.material as THREE.LineBasicMaterial).opacity = (1 - e.t / e.dur) * (Math.random() < 0.3 ? 0.2 : 1);
      this.engine.requestLight({ pos: p.clone().setY(p.y + 2), color: 0x9fd8ff, intensity: 160 * (1 - e.t / e.dur), distance: 30, priority: 12, shadow: true });
      if (e.t >= e.dur) { for (const l of lines) { l.removeFromParent(); l.geometry.dispose(); } return false; }
      return true;
    } });
  }
  lux(at: THREE.Vector3) {
    const p = at.clone();
    this.effects.push({ t: 0, dur: 1.6, data: null, update: (e) => {
      const k = e.t / e.dur, r = 1 + k * 8;
      for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2; this.emit(new THREE.Vector3(p.x + Math.cos(a) * r, p.y + 0.2 + Math.random() * 0.4, p.z + Math.sin(a) * r), new THREE.Vector3(0, 1.5 + Math.random() * 2, 0), 0.9, 0.45, i % 2 ? 0xffe9a8 : 0xffffff); }
      for (let i = 0; i < 6; i++) this.emit(new THREE.Vector3(p.x + (Math.random() - .5) * 2, p.y + Math.random() * 6, p.z + (Math.random() - .5) * 2), new THREE.Vector3(0, 3, 0), 1.2, 0.8, 0xfff2c8);
      this.engine.requestLight({ pos: new THREE.Vector3(p.x, p.y + 2.5, p.z), color: 0xffeeb8, intensity: 70 * (1 - k * k), distance: 26, priority: 9, shadow: true });
      return e.t < e.dur;
    } });
  }
  bolt(from: THREE.Vector3, to: THREE.Vector3) {
    const dir = to.clone().sub(from); const d = dir.length(); dir.normalize();
    const pos = from.clone();
    this.effects.push({ t: 0, dur: d / 18, data: null, update: (e) => {
      pos.copy(from).addScaledVector(dir, Math.min(d, e.t * 18));
      for (let i = 0; i < 5; i++) this.emit(pos, new THREE.Vector3((Math.random() - .5), (Math.random() - .5), (Math.random() - .5)), 0.4, 0.45, 0x9b4bff);
      this.engine.requestLight({ pos: pos.clone(), color: 0x9b4bff, intensity: 12, distance: 8, priority: 3 });
      if (e.t >= e.dur) { this.burst(pos, 40, 3, 0.5, 0.4, 0x9b4bff); return false; }
      return true;
    } });
  }
  slash(at: THREE.Vector3, yaw: number, color = 0xfff2d0) {
    for (let i = 0; i < 26; i++) {
      const a = yaw + (i / 26 - 0.5) * 1.8;
      const p = new THREE.Vector3(at.x - Math.sin(a) * 1.4, at.y + 1.1 + (i / 26 - 0.5) * 0.6, at.z - Math.cos(a) * 1.4);
      this.emit(p, new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)).multiplyScalar(1.5), 0.22, 0.32, color);
    }
  }
  arrow(from: THREE.Vector3, to: THREE.Vector3, color = 0xd9f6ff) {
    const dir = to.clone().sub(from); const d = dir.length(); dir.normalize();
    const pos = from.clone();
    this.effects.push({ t: 0, dur: d / 45, data: null, update: (e) => { pos.copy(from).addScaledVector(dir, Math.min(d, e.t * 45)); this.emit(pos, new THREE.Vector3(), 0.18, 0.28, color); return e.t < e.dur; } });
  }
  hit(at: THREE.Vector3, color = 0xffd8a0) { this.burst(at, 30, 4, 0.4, 0.3, color, -8, 0.4); }
  levelUp(at: THREE.Vector3) {
    const p = at.clone();
    this.effects.push({ t: 0, dur: 2, data: null, update: (e) => {
      for (let i = 0; i < 20; i++) { const a = Math.random() * 6.28, r = 1.2; this.emit(new THREE.Vector3(p.x + Math.cos(a) * r, p.y + Math.random() * 0.3, p.z + Math.sin(a) * r), new THREE.Vector3(0, 4 + Math.random() * 3, 0), 1, 0.4, i % 2 ? 0xffd36a : 0xffffff); }
      this.engine.requestLight({ pos: p.clone().setY(p.y + 2), color: 0xffd36a, intensity: 30, distance: 12, priority: 6 });
      return e.t < e.dur;
    } });
  }
  loot(at: THREE.Vector3, rare: boolean) {
    const p = at.clone(); p.y = heightAt(p.x, p.z);
    this.effects.push({ t: 0, dur: 6, data: null, update: (e) => { if (Math.random() < 0.6) this.emit(new THREE.Vector3(p.x + (Math.random() - .5) * .4, p.y, p.z + (Math.random() - .5) * .4), new THREE.Vector3(0, 3, 0), 0.8, 0.3, rare ? 0xc46bff : 0xffd36a); return e.t < e.dur; } });
  }
  death(at: THREE.Vector3) { this.burst(at.clone().setY(at.y + 1), 70, 2.5, 1.4, 0.6, 0x8fb8ff, -1, 0.5); }

  update(dt: number) {
    for (let i = this.effects.length - 1; i >= 0; i--) { const e = this.effects[i]; e.t += dt; if (!e.update(e, dt)) this.effects.splice(i, 1); }
    const pos = this.geo.attributes.position as THREE.BufferAttribute, col = this.geo.attributes.color as THREE.BufferAttribute, size = this.geo.attributes.size as THREE.BufferAttribute;
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.v.y -= p.grav * dt; p.v.multiplyScalar(1 - dt * 0.8); p.p.addScaledVector(p.v, dt);
      const k = p.life / p.max;
      pos.setXYZ(n, p.p.x, p.p.y, p.p.z);
      col.setXYZ(n, p.color.r * k, p.color.g * k, p.color.b * k);
      size.setX(n, p.size * (0.4 + 0.6 * k));
      n++;
    }
    this.geo.setDrawRange(0, n);
    pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = innerHeight * 0.6;
  }
}
