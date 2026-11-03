import * as THREE from 'three';
import { CharacterView } from '../game/character';
import { makeHero } from '../engine/heroes';
import type { Appearance } from '../../shared/protocol';
import type { ClassId } from '../../shared/combat';

/** Phase 4 · Reincarnation prologue scene, rendered with the shared WebGL renderer.
 *  Act I  "An ordinary life": a rainy city street at night, a tired office worker walking home,
 *         headlights, a horn, white.
 *  Act II "Between worlds": a violet void of stars and drifting light, a rune circle, and Aurelia,
 *         Keeper of the Hundred Skies, made of light. The player's new body floats as a pale soul.
 *  Everything is procedural (no downloads beyond the hero models the game already ships). */
export class Prologue {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  phase: 'life' | 'void' = 'life';
  t = 0;
  private life = new THREE.Group();
  private void = new THREE.Group();
  private walker: any = null;
  private follow!: THREE.SpotLight;
  private followFill!: THREE.PointLight;
  private truck = new THREE.Group();
  private truckLight!: THREE.SpotLight;
  private rain!: THREE.LineSegments;
  private motes!: THREE.Points;
  private stars!: THREE.Points;
  private rune!: THREE.Mesh;
  private goddess = new THREE.Group();
  private goddessGlow: THREE.ShaderMaterial[] = [];
  private wings: THREE.Mesh[] = [];
  private halo!: THREE.Mesh;
  private soul: CharacterView | null = null;
  private soulMat: THREE.MeshStandardMaterial[] = [];
  private flashEl: HTMLElement;
  private capEl: HTMLElement;
  private lifeT = 0;
  onLifeEnd?: () => void;
  private lifeEnded = false;
  goddessVisible = 0;
  private goddessTarget = 0;

  constructor(public renderer: THREE.WebGLRenderer) {
    this.flashEl = document.createElement('div'); this.flashEl.className = 'pro-flash';
    this.capEl = document.createElement('div'); this.capEl.className = 'pro-cap';
    document.body.appendChild(this.flashEl); document.body.appendChild(this.capEl);
    this.scene.add(this.life, this.void);
    this.buildLife(); this.buildVoid();
    this.void.visible = false;
    this.setSize(innerWidth, innerHeight);
  }
  setSize(w: number, h: number) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  // ------------------------------------------------------------------ Act I: an ordinary life
  private windowTex() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const x = c.getContext('2d')!; x.fillStyle = '#0b0d14'; x.fillRect(0, 0, 128, 256);
    for (let r = 0; r < 16; r++) for (let k = 0; k < 6; k++) {
      const lit = Math.random() < 0.38; x.fillStyle = lit ? (Math.random() < 0.7 ? '#ffd9a0' : '#a8d4ff') : '#151925';
      x.fillRect(6 + k * 20, 6 + r * 15.5, 13, 9);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  private buildLife() {
    const L = this.life;
    L.add(new THREE.HemisphereLight(0x4a5a88, 0x16161e, 0.9));
    // wet asphalt + pavements
    const road = new THREE.Mesh(new THREE.PlaneGeometry(14, 220), new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.18, metalness: 0.4 }));
    road.rotation.x = -Math.PI / 2; L.add(road);
    for (const s of [-1, 1]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(5, 0.25, 220), new THREE.MeshStandardMaterial({ color: 0x2a2b31, roughness: 0.5 }));
      walk.position.set(s * 9.5, 0.12, 0); L.add(walk);
    }
    for (let z = -100; z < 100; z += 6) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 2.6), new THREE.MeshBasicMaterial({ color: 0xd8d0b0 })); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.01, z); L.add(m); }
    // buildings with lit windows
    const tex = this.windowTex();
    for (const s of [-1, 1]) for (let z = -100; z < 60; z += 13) {
      const h = 14 + Math.random() * 30, w = 10, d = 11;
      const t = tex.clone(); t.needsUpdate = true; t.repeat.set(1, h / 18);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x222633, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.8 }));
      m.position.set(s * (12 + w / 2 + Math.random() * 1.5), h / 2, z); L.add(m);
    }
    // street lamps
    for (let z = -80; z < 40; z += 22) for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      pole.position.set(s * 7.6, 3, z + (s > 0 ? 11 : 0)); L.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
      bulb.position.set(s * 6.9, 5.9, z + (s > 0 ? 11 : 0)); L.add(bulb);
      const pl = new THREE.PointLight(0xffb060, 18, 16, 1.6); pl.position.copy(bulb.position); L.add(pl);
    }
    // rain
    const n = 1800, p = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const x = (Math.random() - 0.5) * 30, y = Math.random() * 20, z = -40 + Math.random() * 60; p.set([x, y, z, x + 0.05, y - 0.6, z], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.35 })); L.add(this.rain);
    // the truck (box body, glowing headlights)
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 7), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.4 }));
    body.position.y = 2.1; this.truck.add(body);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 2.2), new THREE.MeshStandardMaterial({ color: 0x2a4a9a, roughness: 0.35 }));
    cab.position.set(0, 1.7, 4.4); this.truck.add(cab);
    for (const s of [-1, 1]) { const hl = new THREE.Mesh(new THREE.CircleGeometry(0.28, 12), new THREE.MeshBasicMaterial({ color: 0xffffff })); hl.position.set(s * 0.9, 1.0, 5.52); this.truck.add(hl); }
    this.truckLight = new THREE.SpotLight(0xfff4e0, 0, 80, 0.5, 0.6, 1.2); this.truckLight.position.set(0, 1.1, 5.6);
    this.truckLight.target.position.set(0, 0, 30); this.truck.add(this.truckLight, this.truckLight.target);
    this.truck.position.set(1.5, 0, -95); this.truck.visible = false; L.add(this.truck);
    this.scene.fog = new THREE.FogExp2(0x0a0c14, 0.022);
    this.scene.background = new THREE.Color(0x07080d);
    // the hero's old self: a tired office worker walking home
    void makeHero('Peasant_Male_SimpleParted', { tint: 0x3a4250, headgear: false }).then((rig) => {
      const w = { root: new THREE.Group(), rig, update: (dt: number, n: string) => { rig.play(n as any, 0.3); rig.mixer.update(dt); }, play: (n: string) => rig.play(n as any, 0), dispose: () => { rig.root.removeFromParent(); rig.mixer.stopAllAction(); } } as any;
      w.root.add(rig.root); this.walker = w; w.root.position.set(4.5, 0.25, 6); w.root.rotation.y = Math.PI; L.add(w.root); w.play('walk');
    }).catch(() => {});
    // a cold key light that follows him (shop signs), and a warm fill
    this.follow = new THREE.SpotLight(0xbcd4ff, 60, 18, 0.5, 0.7, 1.4); L.add(this.follow, this.follow.target);
    const fill = new THREE.PointLight(0xff9a50, 10, 12, 1.5); this.followFill = fill; L.add(fill);
  }
  private cap(text: string) {
    this.capEl.classList.remove('on');
    setTimeout(() => { this.capEl.textContent = text; if (text) this.capEl.classList.add('on'); }, 350);
  }
  private flash(color: string, ms: number, hold = 0) {
    this.flashEl.style.background = color; this.flashEl.style.transition = `opacity ${ms}ms ease`;
    this.flashEl.style.opacity = '1';
    if (hold >= 0) setTimeout(() => { this.flashEl.style.opacity = '0'; }, ms + hold);
  }
  skipLife() { if (this.phase === 'life' && !this.lifeEnded) { this.lifeT = 99; } }

  // ------------------------------------------------------------------ Act II: between worlds
  private buildVoid() {
    const V = this.void;
    // nebula sky sphere
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: { uT: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float uT; varying vec3 vP;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
        float n(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){ vec3 p = vP*3.0 + vec3(0.0, uT*0.02, 0.0);
          float a = n(p)*0.5 + n(p*2.1)*0.25 + n(p*4.3)*0.125;
          vec3 c = mix(vec3(0.012,0.035,0.04), vec3(0.09,0.30,0.31), smoothstep(0.35,0.85,a));
          c = mix(c, vec3(0.95,0.62,0.32), smoothstep(0.72,0.95,a)*0.35*(0.6+0.4*vP.y));
          c += vec3(0.03,0.07,0.065)*(1.0-abs(vP.y));
          gl_FragColor = vec4(c,1.0); }`,
    });
    V.add(new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat));
    (this as any).skyMat = skyMat;
    const pts = (n: number, spread: number, size: number, color: number, y0: number) => {
      const p = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { const r = spread * Math.cbrt(Math.random()), a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1); p.set([r * Math.sin(b) * Math.cos(a), y0 + r * Math.cos(b) * 0.6, r * Math.sin(b) * Math.sin(a)], i * 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      return new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    };
    this.stars = pts(2500, 600, 1.6, 0xffffff, 0); V.add(this.stars);
    this.motes = pts(700, 22, 0.09, 0xffd89a, 4); V.add(this.motes);
    // rune circle under the goddess
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const x = c.getContext('2d')!; x.translate(256, 256); x.strokeStyle = '#ffe2a0'; x.fillStyle = '#ffe2a0'; x.lineWidth = 3;
    for (const r of [240, 200, 120]) { x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.stroke(); }
    const glyphs = '火水風土雷光闇空時禁ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
    x.font = '26px serif'; x.textAlign = 'center';
    for (let i = 0; i < 36; i++) { x.save(); x.rotate((i / 36) * Math.PI * 2); x.fillText(glyphs[i % glyphs.length], 0, -212); x.restore(); }
    for (let i = 0; i < 6; i++) { x.save(); x.rotate((i / 6) * Math.PI * 2); x.beginPath(); x.moveTo(0, -200); x.lineTo(0, -120); x.stroke(); x.restore(); }
    x.beginPath(); for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 2 * 2; x.lineTo(Math.sin(a) * 200, -Math.cos(a) * 200); } x.stroke();
    const rt = new THREE.CanvasTexture(c); rt.colorSpace = THREE.SRGBColorSpace;
    this.rune = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: rt, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffd28a }));
    this.rune.rotation.x = -Math.PI / 2; this.rune.position.set(0, -0.1, -6); V.add(this.rune);
    // Aurelia: a hero body made of light, a halo and wings of light
    const glow = (col: number, power: number) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uC: { value: new THREE.Color(col) }, uA: { value: 0 }, uT: { value: 0 } },
      vertexShader: `#include <common>
        #include <skinning_pars_vertex>
        varying vec3 vN; varying vec3 vV; varying float vY;
        void main(){
          #include <skinbase_vertex>
          #include <begin_vertex>
          #include <beginnormal_vertex>
          #include <skinnormal_vertex>
          #include <skinning_vertex>
          vec4 mv = modelViewMatrix*vec4(transformed,1.0); vN = normalize(normalMatrix*objectNormal); vV = normalize(-mv.xyz); vY = transformed.y;
          gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uC; uniform float uA; uniform float uT; varying vec3 vN; varying vec3 vV; varying float vY;
        void main(){ float f = pow(1.0 - abs(dot(vN, vV)), ${power.toFixed(1)});
          float shimmer = 0.85 + 0.15*sin(vY*30.0 - uT*3.0);
          gl_FragColor = vec4(uC*(0.25 + f*1.6)*shimmer*uA, 1.0); }`,
    });
    void makeHero('Noble_Female_Long', { scale: 1.6, headgear: false }).then((rig) => {
      rig.root.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; const g = glow(0xffd9a0, 1.8); this.goddessGlow.push(g); m.material = g; m.castShadow = false; });
      rig.play('idle', 0); (this.goddess as any).rig = rig;
      this.goddess.add(rig.root);
    }).catch(() => {});
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.016, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.halo.position.set(0, 2.78, -0.28); this.goddess.add(this.halo);
    const wingTex = (() => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512; const g = cv.getContext('2d')!;
      for (let i = 0; i < 9; i++) { const grad = g.createLinearGradient(0, 512, 256, 0); grad.addColorStop(0, 'rgba(255,240,200,0.0)'); grad.addColorStop(0.5, 'rgba(255,225,160,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0.0)'); g.fillStyle = grad; g.save(); g.translate(10, 500); g.rotate(-0.25 - i * 0.11); g.beginPath(); g.ellipse(120, 0, 130, 14, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.6), new THREE.MeshBasicMaterial({ map: wingTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      w.geometry.translate(1.2, 0.4, 0); w.scale.set(s * 1.3, 1.3, 1); w.position.set(0.1 * s, 2.1, -0.4); w.rotation.y = s * 0.35; this.goddess.add(w); this.wings.push(w);
    }
    const gl = new THREE.PointLight(0xffd29a, 0, 18, 1.5); gl.position.set(0, 2, 1); this.goddess.add(gl); (this as any).gLight = gl;
    this.goddess.position.set(0, 0.5, -6);
    V.add(this.goddess);
    V.add(new THREE.AmbientLight(0x6a8a86, 0.6));
    const key = new THREE.DirectionalLight(0xfff0dc, 1.2); key.position.set(2, 5, 4); V.add(key);
  }

  /** The player's new body, floating like a pale soul to the left of the goddess (create screen + dialogue). */
  async setSoul(cls: ClassId, ap: Appearance) {
    const v = new CharacterView('p', cls, ap);
    await v.ready;
    if (this.soul) { this.void.remove(this.soul.root); this.soul.dispose(); }
    this.soul = v; this.soulMat = [];
    v.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) { const mm = m.material as THREE.MeshStandardMaterial; mm.transparent = true; mm.opacity = 0.92; mm.emissive = new THREE.Color(0x7fb8b0); mm.emissiveIntensity = 0.35; this.soulMat.push(mm); } });
    v.root.position.set(-2.7, -0.2, -4.2); v.root.rotation.y = 0.75;
    this.void.add(v.root);
    v.play('idle', 0);
  }
  showGoddess(on: boolean) { this.goddessTarget = on ? 1 : 0; }

  enterVoid() {
    this.phase = 'void'; this.life.visible = false; this.void.visible = true;
    this.scene.fog = null; this.scene.background = new THREE.Color(0x020606);
    this.walker?.dispose(); this.walker = null;
    this.camera.position.set(0, 0.9, 3.6); this.camera.lookAt(-0.4, 1.0, -6);
  }
  /** Fade to white and leave (the hero wakes in the Capital). */
  ascend(): Promise<void> { this.flash('#fff8e8', 1400, -1); return new Promise((r) => setTimeout(r, 1500)); }

  render(dt: number) {
    this.t += dt;
    if (this.phase === 'life') this.updateLife(dt); else this.updateVoid(dt);
    this.renderer.render(this.scene, this.camera);
  }
  private updateLife(dt: number) {
    const T = (this.lifeT += dt);
    // rain falls
    const p = this.rain.geometry.attributes.position as THREE.BufferAttribute, a = p.array as Float32Array;
    for (let i = 0; i < a.length; i += 6) { a[i + 1] -= dt * 24; a[i + 4] -= dt * 24; if (a[i + 4] < 0) { a[i + 1] += 20; a[i + 4] += 20; } }
    p.needsUpdate = true;
    const w = this.walker;
    if (w) { const wp = w.root.position; this.follow.position.set(wp.x + 2.5, 6, wp.z + 3); this.follow.target.position.copy(wp); this.followFill.position.set(wp.x - 1.5, 2.2, wp.z + 1.5); }
    if (w?.rig) {
      if (T < 5.2) { w.root.position.z = 6 - T * 1.0; w.update(dt, 'walk', 1.0); }
      else if (T < 6.4) { if (w.root.position.x > 1.6) w.root.position.x -= dt * 2.6; w.root.rotation.y = Math.PI + 0.9; w.update(dt, 'walk', 1.0); }
      else { w.root.rotation.y = 0; w.update(dt, 'idle', 0); }
    }
    // camera: low, behind and to the side, slowly pushing in
    const k = Math.min(1, T / 9);
    const tgt = w?.root.position ?? new THREE.Vector3(3, 0, 2);
    // a tracking shot ahead of him, slowly turning to look up the road as the light comes
    this.camera.position.set(tgt.x + 2.2 - k * 1.2, 1.5 + k * 0.3, tgt.z + 4.2 - k * 0.6);
    this.camera.lookAt(tgt.x - 0.6 * k, 1.35, tgt.z - 2 - k * 10);
    if (T > 0.2 && T < 0.3) this.cap('11:47 PM. Another overtime night.');
    if (T > 2.8 && T < 2.9) this.cap('Another ordinary day, in an ordinary life.');
    if (T > 5.4 && T < 5.5) this.cap('“If I could start over… just once…”');
    if (T > 6.2) {
      this.truck.visible = true;
      const tt = T - 6.2; this.truck.position.z = -95 + tt * tt * 14 + tt * 10;
      this.truckLight.intensity = Math.min(900, tt * 400);
      if (tt > 0.6 && !(this as any).horned) { (this as any).horned = true; this.cap(''); window.dispatchEvent(new CustomEvent('dos:prologue-sfx', { detail: 'horn' })); }
      if (this.truck.position.z > 0 && !this.lifeEnded) this.endLife();
    }
    if (T > 30 && !this.lifeEnded) this.endLife();
    if (this.lifeT >= 99 && !this.lifeEnded) this.endLife();
  }
  private endLife() {
    this.lifeEnded = true;
    window.dispatchEvent(new CustomEvent('dos:prologue-sfx', { detail: 'crash' }));
    this.flash('#ffffff', 80, -1);
    setTimeout(() => { this.flashEl.style.transition = 'background 1.6s ease'; this.flashEl.style.background = '#000'; }, 500);
    setTimeout(() => this.cap('…'), 1800);
    setTimeout(() => this.cap('Is this… what dying feels like?'), 3200);
    setTimeout(() => {
      this.cap(''); this.enterVoid();
      this.flashEl.style.transition = 'opacity 2.4s ease'; this.flashEl.style.opacity = '0';
      window.dispatchEvent(new CustomEvent('dos:prologue-sfx', { detail: 'void' }));
      this.onLifeEnd?.();
    }, 5600);
  }
  private updateVoid(dt: number) {
    (this as any).skyMat.uniforms.uT.value = this.t;
    this.stars.rotation.y += dt * 0.004;
    const mp = this.motes.geometry.attributes.position as THREE.BufferAttribute, ma = mp.array as Float32Array;
    for (let i = 0; i < ma.length; i += 3) { ma[i + 1] += dt * 0.35; if (ma[i + 1] > 14) ma[i + 1] -= 18; }
    mp.needsUpdate = true;
    this.rune.rotation.z += dt * 0.08;
    this.goddessVisible += (this.goddessTarget - this.goddessVisible) * Math.min(1, dt * 1.2);
    const gv = this.goddessVisible;
    for (const g of this.goddessGlow) { g.uniforms.uA.value = gv; g.uniforms.uT.value = this.t; }
    (this.halo.material as THREE.MeshBasicMaterial).opacity = gv * 0.9;
    (this.rune.material as THREE.MeshBasicMaterial).opacity = 0.15 + gv * 0.7;
    this.wings.forEach((w, i) => { (w.material as THREE.MeshBasicMaterial).opacity = gv * 0.8; w.rotation.y = (i ? 1 : -1) * (0.35 + Math.sin(this.t * 1.3) * 0.08); });
    (this as any).gLight.intensity = gv * 30;
    this.goddess.position.y = 0.5 + Math.sin(this.t * 0.9) * 0.08 + (1 - gv) * -0.5;
    const rig = (this.goddess as any).rig; rig?.mixer.update(dt);
    if (this.soul) { this.soul.update(dt, 'idle', 0); this.soul.root.position.y = -0.2 + Math.sin(this.t * 1.1 + 1) * 0.06; }
    // camera drifts
    this.camera.position.set(Math.sin(this.t * 0.07) * 0.5, 0.9 + Math.sin(this.t * 0.11) * 0.08, 3.6);
    this.camera.lookAt(-0.4, 1.0, -6);
  }
  dispose() {
    this.flashEl.remove(); this.capEl.remove();
    this.soul?.dispose(); this.walker?.dispose();
    this.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | THREE.Material[] | undefined; if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose()); });
  }
}
