import * as THREE from 'three';
import { Environment } from './sky';
import { Terrain } from './terrain';
import { Water } from './water';
import { Foliage, wind } from './foliage';
import { City } from './city';
import { Tower } from './tower';
import { floorOf } from '../../shared/tower';
import { Settlement } from './settlement';
import { setActiveZone, REGION, ZONE, TOWER } from '../../shared/world';
import { Post } from './post';
import { PRESETS, settings, Quality, QualityPreset } from '../settings';

export interface LightRequest { pos: THREE.Vector3; color: THREE.Color | number; intensity: number; distance: number; priority: number; shadow?: boolean }

/** Precipitation as GPU line streaks that wrap around the camera: rain, snow, blizzard, sand, ash
 *  (phase 4: one buffer, the look comes from uniforms); lightning flashes in storms. */
export const PRECIP: Record<string, { amt: number; speed: number; len: number; slant: number; sway: number; wind: number; col: [number, number, number]; alpha: number }> = {
  rain: { amt: 0.6, speed: 24, len: 0.55, slant: 0.08, sway: 0, wind: 0, col: [0.7, 0.75, 0.85], alpha: 0.55 },
  storm: { amt: 1, speed: 28, len: 0.7, slant: 0.14, sway: 0, wind: 0, col: [0.7, 0.75, 0.85], alpha: 0.55 },
  snow: { amt: 0.55, speed: 2.2, len: 0.07, slant: 0, sway: 0.7, wind: 0.6, col: [1, 1, 1], alpha: 0.95 },
  blizzard: { amt: 1, speed: 5.5, len: 0.14, slant: 0.9, sway: 0.5, wind: 10, col: [1, 1, 1], alpha: 0.95 },
  sandstorm: { amt: 1, speed: 1.6, len: 0.3, slant: 3.5, sway: 0.3, wind: 17, col: [0.86, 0.7, 0.45], alpha: 0.6 },
  ash: { amt: 0.7, speed: 1.3, len: 0.06, slant: 0, sway: 0.5, wind: 0.8, col: [0.32, 0.28, 0.3], alpha: 0.9 },
};
class Rain {
  mesh: THREE.LineSegments;
  mat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene, count: number) {
    const pos = new Float32Array(count * 6), seed = new Float32Array(count * 2), end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 60 - 30, y = Math.random() * 40, z = Math.random() * 60 - 30;
      pos.set([x, y, z, x, y, z], i * 6);
      const s = Math.random();
      seed.set([s, s], i * 2); end.set([0, 1], i * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uCol: { value: new THREE.Color(0.7, 0.75, 0.85) }, uSpeed: { value: 24 }, uLen: { value: 0.55 }, uSlant: { value: 0.08 }, uSway: { value: 0 }, uWindX: { value: 0 }, uAlpha: { value: 0.55 } },
      vertexShader: `attribute float seed; attribute float aEnd; uniform float uTime, uAmt, uSpeed, uLen, uSlant, uSway, uWindX, uAlpha; uniform vec3 uCam; varying float vA;
        void main(){ vec3 p = position; float t = uTime*(1.0+seed*0.35);
          p.y = mod(p.y - t*uSpeed, 40.0); p.x += t*uWindX + sin(uTime*1.3 + seed*40.0)*uSway; p.z += cos(uTime*1.1 + seed*31.0)*uSway;
          p.x -= p.y*0.08;
          p.xz = mod(p.xz - uCam.xz + 30.0, 60.0) - 30.0; vec3 w = vec3(uCam.x, uCam.y - 12.0, uCam.z) + p;
          w.y -= aEnd*uLen; w.x -= aEnd*uLen*uSlant;
          vA = step(seed, uAmt) * uAlpha; gl_Position = projectionMatrix*viewMatrix*vec4(w,1.0); }`,
      fragmentShader: 'uniform vec3 uCol; varying float vA; void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(uCol, vA); }',
    });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
  env!: Environment;
  terrain!: Terrain;
  water!: Water;
  foliage!: Foliage;
  city!: City;
  tower!: Tower;
  post!: Post;
  rain!: Rain;
  q: QualityPreset;
  quality: Quality;
  lights: THREE.PointLight[] = [];
  shadowLight: THREE.PointLight | null = null;
  requests: LightRequest[] = [];
  time = 0;
  hours = 17.2;
  weather = 'clear';
  rainAmt = 0;
  wetAmt = 0;
  precipKind = 'rain';
  zone = 'capital';
  settlement: Settlement | null = null;
  hurt = 0;
  flash = 0;
  lowHp = 0;
  focus = new THREE.Vector3();
  private nextLightning = 5;
  onThunder?: (delay: number, strength: number) => void;
  fps = 0;
  private frames = 0;
  private fpsT = 0;
  ready = false;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envScene = new THREE.Scene();
  private envSun = new THREE.Vector3(0, -1, 0);
  private envOc = -1;
  private envT = 0;

  constructor(public canvas: HTMLCanvasElement) {
    this.quality = settings.quality;
    this.q = PRESETS[this.quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;
    this.renderer.setClearColor(0x05070c);
  }

  async build(onStep: (label: string) => void) {
    const q = this.q;
    onStep('Shaping the sky');
    this.env = new Environment(this.scene, q);
    this.applyShadowQuality();
    onStep('Raising the land');
    this.terrain = new Terrain(this.scene, q.terrainSeg);
    this.water = new Water(this.scene, this.env);
    onStep('Building the Capital walls');
    this.city = new City(this.scene);
    this.tower = new Tower(this.scene);
    onStep('Growing the Ancient Forest');
    this.foliage = new Foliage(this.scene);
    await this.foliage.build(this.renderer, { grass: q.grass, treeNear: q.treeNear, treeFar: q.treeFar, shadows: q.shadows }, this.terrain, this.quality === 'low');
    this.settlement = new Settlement(this.scene);
    this.rain = new Rain(this.scene, q.rain);
    // fixed light pool: constant light count = no shader recompiles when spells start/stop
    for (let i = 0; i < q.maxLights; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 10, 2);
      this.scene.add(l);
      this.lights.push(l);
    }
    if (q.spellShadows) {
      this.shadowLight = new THREE.PointLight(0xff8833, 0, 20, 2);
      this.shadowLight.castShadow = true;
      this.shadowLight.shadow.mapSize.set(512, 512);
      this.shadowLight.shadow.bias = -0.002;
      this.shadowLight.shadow.camera.near = 0.3;
      this.scene.add(this.shadowLight);
    }
    // image-based lighting: a PMREM of the live sky, refreshed as the sun moves
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const envSky = new THREE.Mesh(this.env.sky.geometry, this.env.sky.material);
    envSky.scale.setScalar(100);
    this.envScene.add(envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a4a2a }));
    ground.position.y = -2;
    this.envScene.add(ground);
    (this as any).envGround = ground;
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // compile everything up front so entering the world never hitches
    onStep('Compiling shaders');
    this.renderer.compile(this.scene, this.camera);
    this.ready = true;
  }

  /** Phase 4 · M2: stream a region in — rebuild ground, foliage and buildings for it. */
  async loadZone(id: string, onStep: (label: string) => void = () => {}) {
    setActiveZone(id);
    this.zone = ZONE;
    const q = this.q;
    onStep('Raising the land');
    for (const m of [this.terrain.mesh, this.terrain.far]) { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.terrain.heightTex.dispose();
    this.terrain = new Terrain(this.scene, q.terrainSeg);
    this.water.mesh.visible = ZONE === 'capital';
    this.city.group.visible = ZONE === 'capital';
    onStep('Raising the settlements');
    this.settlement?.dispose();
    this.settlement = new Settlement(this.scene);
    this.tower.group.position.set(TOWER.x, 0, TOWER.z);
    this.tower.group.visible = !floorOf(ZONE);
    onStep('Growing the wilds');
    const old = this.foliage;
    this.foliage = new Foliage(this.scene);
    await this.foliage.build(this.renderer, { grass: q.grass, treeNear: q.treeNear, treeFar: q.treeFar, shadows: q.shadows }, this.terrain, this.quality === 'low');
    old.dispose();
    this.env.setRegion(REGION.fog, REGION.fogDensity, ZONE === 'capital' ? 0 : 0.45);
    onStep('Compiling shaders');
    this.renderer.compile(this.scene, this.camera);
    this.envT = 0; this.envOc = -1;
  }

  applyShadowQuality() {
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.env.sun.castShadow = this.q.shadows;
    this.env.sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
    this.env.sun.shadow.map?.dispose();
    (this.env.sun.shadow as any).map = null;
  }

  setQuality(qk: Quality) {
    // runtime-safe parts; geometry density changes apply on next load
    this.quality = qk; this.q = PRESETS[qk];
    if (!this.ready) return; // chosen on the title menu before the world streamed in
    this.applyShadowQuality();
    this.resize();
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    if (this.foliage.grass) this.foliage.grass.visible = this.q.grass > 0;
    this.env.clouds.visible = this.q.clouds;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 2) * this.q.pixelRatio * settings.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = settings.fov;
    this.camera.far = this.q.drawDist + 3000;
    this.camera.updateProjectionMatrix();
    this.post?.configure(this.q, w, h);
  }

  requestLight(r: LightRequest) { this.requests.push(r); }

  private assignLights() {
    // torches near the focus compete with spell lights by priority
    const reqs = this.requests;
    if (this.env.night > 0.15) {
      for (const t of [...(this.city.group.visible ? this.city.torches : []), ...(this.settlement?.torches ?? [])]) {
        const d = t.pos.distanceTo(this.focus);
        if (d < 60) reqs.push({ pos: t.pos, color: t.flame ? 0xff9a40 : 0x70c8ff, intensity: 9 * this.env.night * (0.9 + Math.sin(this.time * 11 + t.pos.x) * 0.1), distance: 14, priority: 1 - d / 60 });
      }

    }
    reqs.sort((a, b) => b.priority - a.priority);
    let i = 0;
    if (this.shadowLight) {
      const sr = reqs.find((r) => r.shadow);
      if (sr) { this.shadowLight.position.copy(sr.pos); this.shadowLight.color.set(sr.color as THREE.ColorRepresentation); this.shadowLight.intensity = sr.intensity; this.shadowLight.distance = sr.distance; reqs.splice(reqs.indexOf(sr), 1); }
      else this.shadowLight.intensity = 0;
    }
    for (const l of this.lights) {
      const r = reqs[i++];
      if (r) { l.position.copy(r.pos); l.color.set(r.color as THREE.ColorRepresentation); l.intensity = r.intensity; l.distance = r.distance; }
      else l.intensity = 0;
    }
    this.requests = [];
  }

  update(dt: number) {
    this.time += dt;
    const hours = settings.timeOverride ?? this.hours;
    this.env.update(hours, this.weather, this.camera, dt, this.focus, this.q.shadowRange);
    const pc = PRECIP[this.weather];
    if (pc) { // switch the look when nothing is falling, else blend into it
      const u = this.rain.mat.uniforms;
      if (this.precipKind !== this.weather && this.rainAmt < 0.08) { this.precipKind = this.weather; u.uSpeed.value = pc.speed; u.uLen.value = pc.len; u.uSlant.value = pc.slant; u.uSway.value = pc.sway; u.uWindX.value = pc.wind; u.uAlpha.value = pc.alpha; }
    }
    const pk = PRECIP[this.precipKind];
    const targetRain = pc && this.precipKind === this.weather ? pc.amt : 0;
    this.rainAmt += (targetRain - this.rainAmt) * Math.min(1, dt * (pc && this.precipKind !== this.weather ? 1.5 : 0.3));
    this.wetAmt += ((this.precipKind === 'rain' || this.precipKind === 'storm' ? this.rainAmt : 0) - this.wetAmt) * Math.min(1, dt * 0.3);
    this.rain.mat.uniforms.uTime.value = this.time;
    this.rain.mat.uniforms.uCam.value.copy(this.camera.position);
    this.rain.mat.uniforms.uAmt.value = this.rainAmt;
    const lit = 0.5 + (1 - this.env.night) * 0.5;
    if (pk) this.rain.mat.uniforms.uCol.value.setRGB(pk.col[0] * lit, pk.col[1] * lit, pk.col[2] * lit);
    this.terrain.uniforms.uWet.value = Math.min(1, this.wetAmt * 1.3);
    wind.uWind.value = 0.8 + this.env.overcast * 1.6;
    this.water.update(this.time, this.env, this.wetAmt);
    this.city.update(this.time, this.env.night);
    this.settlement?.update(this.time, this.env.night);
    this.tower.update(this.time, this.env);
    this.foliage.update(this.camera, this.focus, this.time, this.q);
    this.envT -= dt;
    if (this.pmrem && this.envT <= 0 && (this.envSun.distanceTo(this.env.sunDir) > 0.03 || Math.abs(this.envOc - this.env.overcast) > 0.08)) {
      this.envT = 1.5;
      this.envSun.copy(this.env.sunDir); this.envOc = this.env.overcast;
      ((this as any).envGround.material as THREE.MeshBasicMaterial).color.copy(this.env.hemi.groundColor).multiplyScalar(0.6);
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
      this.envRT?.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    }
    this.scene.environmentIntensity = (0.62 - this.env.night * 0.3) * (1 - this.env.overcast * 0.3);
    if (this.weather === 'storm') {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.nextLightning = 6 + Math.random() * 12;
        this.env.lightning = 1; this.flash = 0.5;
        this.onThunder?.(0.4 + Math.random() * 2.2, 0.6 + Math.random() * 0.4);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    this.assignLights();
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }
  }

  render(dt: number) {
    if (this.renderer.xr.isPresenting) { this.renderer.render(this.scene, this.camera); return; }
    this.post.render(dt, { sunScreen: this.env.sunScreen, sunUp: Math.max(0, 1 - this.env.night * 1.5) * (1 - this.env.overcast * 0.9), hurt: this.hurt, flash: this.flash, lowHp: this.lowHp, time: this.time });
  }
}
