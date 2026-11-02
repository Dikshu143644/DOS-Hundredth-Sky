import * as THREE from 'three';
import { Environment } from './sky';
import { Terrain } from './terrain';
import { Water } from './water';
import { Foliage, wind } from './foliage';
import { City } from './city';
import { Tower } from './tower';
import { Post } from './post';
import { PRESETS, settings, Quality, QualityPreset } from '../settings';

export interface LightRequest { pos: THREE.Vector3; color: THREE.Color | number; intensity: number; distance: number; priority: number; shadow?: boolean }

/** Rain as GPU line streaks that wrap around the camera; lightning flashes in storms. */
class Rain {
  mesh: THREE.LineSegments;
  mat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene, count: number) {
    const pos = new Float32Array(count * 6), seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 60 - 30, y = Math.random() * 40, z = Math.random() * 60 - 30;
      pos.set([x, y, z, x, y - 0.55, z], i * 6);
      const s = Math.random();
      seed.set([s, s], i * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uCol: { value: new THREE.Color(0.7, 0.75, 0.85) } },
      vertexShader: `attribute float seed; uniform float uTime, uAmt; uniform vec3 uCam; varying float vA;
        void main(){ vec3 p = position; p.y = mod(p.y - uTime*(24.0+seed*8.0), 40.0); p.x -= p.y*0.08;
          p.xz = mod(p.xz - uCam.xz + 30.0, 60.0) - 30.0; vec3 w = vec3(uCam.x, uCam.y - 12.0, uCam.z) + p;
          vA = step(seed, uAmt) * 0.55; gl_Position = projectionMatrix*viewMatrix*vec4(w,1.0); }`,
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
      for (const t of this.city.torches) {
        const d = t.pos.distanceTo(this.focus);
        if (d < 60) reqs.push({ pos: t.pos, color: 0xff9a40, intensity: 9 * this.env.night * (0.9 + Math.sin(this.time * 11 + t.pos.x) * 0.1), distance: 14, priority: 1 - d / 60 });
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
    const targetRain = this.weather === 'storm' ? 1 : this.weather === 'rain' ? 0.6 : 0;
    this.rainAmt += (targetRain - this.rainAmt) * Math.min(1, dt * 0.3);
    this.rain.mat.uniforms.uTime.value = this.time;
    this.rain.mat.uniforms.uCam.value.copy(this.camera.position);
    this.rain.mat.uniforms.uAmt.value = this.rainAmt;
    this.rain.mat.uniforms.uCol.value.setScalar(0.5 + (1 - this.env.night) * 0.3);
    this.terrain.uniforms.uWet.value = Math.min(1, this.rainAmt * 1.3);
    wind.uWind.value = 0.8 + this.env.overcast * 1.6;
    this.water.update(this.time, this.env, this.rainAmt);
    this.city.update(this.time, this.env.night);
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
