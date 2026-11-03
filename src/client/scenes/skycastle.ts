import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tex } from '../engine/assets';
import { fbm, billow, mulberry, applyAtmos, makeAtmos, Atmos, sparkleField, glowTex, canvasTex, runeStripTex, vnoise } from '../engine/procedural';
import { makeHero } from '../engine/heroes';

const BASE = import.meta.env.BASE_URL + 'assets/';

/** Sky / haze dome: physically-inspired single scattering look (Rayleigh gradient + Mie sun lobe),
 *  a soft horizon haze band and a bright fog sea below the horizon. Output is linear HDR. */
function skyDome(sunDir: THREE.Vector3) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: sunDir }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `
      uniform vec3 uSun; uniform float uTime; varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm2(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n2(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        float mu = dot(d, uSun);
        // Rayleigh-ish gradient: muted blue zenith → pale haze at the horizon
        vec3 zen = vec3(0.20, 0.29, 0.44);
        vec3 hor = vec3(0.60, 0.63, 0.67);
        float t = pow(clamp(1.0 - max(y, 0.0), 0.0, 1.0), 3.2);
        vec3 c = mix(zen, hor, t);
        // Mie forward scattering lobe + sun disc
        float mie = pow(max(mu, 0.0), 12.0) * 0.38 + pow(max(mu, 0.0), 90.0) * 1.1 + pow(max(mu,0.0), 1600.0) * 14.0;
        c += vec3(1.0, 0.92, 0.80) * mie;
        float disc = smoothstep(0.9990, 0.9994, mu);
        c += vec3(14.0, 12.6, 10.4) * disc;
        // thin high cirrus, lit toward the sun
        if (y > 0.0) {
          vec2 uv = d.xz / (y + 0.12) * 1.4 + vec2(uTime * 0.004, 0.0);
          float cl = smoothstep(0.52, 0.95, fbm2(uv * vec2(1.0, 3.2)));
          c = mix(c, vec3(1.0, 0.98, 0.95) * (1.0 + pow(max(mu,0.0), 4.0) * 1.5), cl * 0.35 * smoothstep(0.0, 0.25, y));
        }
        // below the horizon: the cloud sea, bright and hazy
        if (y < 0.0) {
          float k = smoothstep(0.0, -0.18, y);
          vec2 uv = d.xz / (-y + 0.03) * 0.8 + vec2(uTime * 0.006, 0.0);
          float cl = fbm2(uv);
          vec3 sea = mix(vec3(0.52, 0.55, 0.59), vec3(0.70, 0.70, 0.70), smoothstep(0.35, 0.8, cl));
          sea += vec3(1.0, 0.9, 0.75) * pow(max(mu, 0.0), 8.0) * 0.3;
          c = mix(hor + vec3(1.0,0.92,0.8)*pow(max(mu,0.0),8.0)*0.45, sea, k);
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), m);
  s.renderOrder = -10;
  s.frustumCulled = false;
  return s;
}

/** Floating-island rock: a lathe profile (wide lumpy crown → gold collar waist → tapering root)
 *  displaced with billowy boulder noise and vertical erosion streaks. */
function islandGeometry(o: { radius: number; depth: number; seed: number; crown?: number; detail?: number }) {
  const R = o.radius, D = o.depth, seed = o.seed;
  const seg = o.detail ?? 128, rings = Math.floor((o.detail ?? 128) * 0.55);
  const g = new THREE.CylinderGeometry(1, 1, 1, seg, rings, false);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const colors = new Float32Array(p.count * 3);
  const crown = o.crown ?? 0.12;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = v.y + 0.5; // 0 bottom … 1 top
    const a = Math.atan2(v.z, v.x);
    const isCap = Math.abs(Math.abs(v.y) - 0.5) < 1e-4 && Math.hypot(v.x, v.z) < 0.999;
    const rr = Math.hypot(v.x, v.z);
    // radius profile (top → bottom)
    let prof: number;
    if (t > 0.88) prof = 1.0 - Math.pow((t - 0.88) / 0.12, 2) * 0.12;
    else if (t > 0.62) prof = 0.84 + 0.16 * Math.sin(((t - 0.62) / 0.26) * Math.PI * 0.5);
    else prof = 0.84 * Math.pow(t / 0.62, 1.35);
    prof = Math.max(prof, 0.015);
    let y = (t - 1) * D; // top at 0
    const nx = Math.cos(a), nz = Math.sin(a);
    const wx = nx * R * 0.02, wz = nz * R * 0.02;
    const bil = billow(wx * 3 + seed, y / R * 3.5, wz * 3, 4);
    const streak = fbm(a * 7 + seed, y / D * 1.2, seed * 0.3, 3);
    let r = R * prof * (0.86 + bil * 0.32 + streak * 0.06 * (1 - t));
    if (isCap && v.y > 0) {
      // top crown: lumpy, slightly domed
      r = R * rr * (0.9 + bil * 0.2);
      y = crown * R * (1 - rr * rr) * 0.25 + fbm(nx * rr * 2 + seed, nz * rr * 2, 1, 3) * R * 0.04;
    } else if (isCap) { r = 0.01; y = -D; }
    else if (t > 0.88) y += (bil - 0.5) * R * 0.08;
    p.setXYZ(i, nx * r, y, nz * r);
    // vertex colour: warm grey rock, darker in crevices and toward the root, mossy crown
    const shade = 0.55 + bil * 0.6;
    const moss = isCap && v.y > 0 ? 1 : Math.max(0, (t - 0.93) / 0.07) * 0.6;
    colors[i * 3] = shade * (0.78 + 0.22 * t) * (1 - moss * 0.45);
    colors[i * 3 + 1] = shade * (0.74 + 0.2 * t) * (1 - moss * 0.1);
    colors[i * 3 + 2] = shade * (0.70 + 0.18 * t) * (1 - moss * 0.5);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // cylindrical UVs scaled to metres so rock texture keeps its scale
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) { v.fromBufferAttribute(p, i); uv.setXY(i, (Math.atan2(v.z, v.x) / (Math.PI * 2)) * (R * 6.28 / 14), v.y / 14); }
  g.computeVertexNormals();
  return g;
}

function lathe(points: [number, number][], seg = 48) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}

/** A sweeping crescent horn/blade: a tapered tube along a curve, flattened into a blade. */
function hornGeometry(curve: THREE.Curve<THREE.Vector3>, width: number, thick: number, segs = 64) {
  const g = new THREE.TubeGeometry(curve, segs, 1, 10, false);
  const p = g.attributes.position as THREE.BufferAttribute;
  const frames = curve.computeFrenetFrames(segs, false);
  const v = new THREE.Vector3(), c = new THREE.Vector3(), off = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, c);
    const taper = Math.pow(Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.5 + 0.0001), 0.6) * Math.pow(1 - u, 0.85);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= 10; j++) {
      const k = i * 11 + j;
      if (k >= p.count) continue;
      v.fromBufferAttribute(p, k);
      off.copy(v).sub(c);
      const dn = off.dot(N), db = off.dot(B);
      const nv = c.clone().addScaledVector(N, dn * width * (0.25 + taper)).addScaledVector(B, db * thick * (0.3 + taper));
      p.setXYZ(k, nv.x, nv.y, nv.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

export class SkyCastle {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 20000);
  composer!: EffectComposer;
  atmos: Atmos = makeAtmos();
  sunDir = new THREE.Vector3();
  sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
  castle = new THREE.Group();
  halos: THREE.Object3D[] = [];
  bobbers: { o: THREE.Object3D; base: THREE.Vector3; amp: number; ph: number; spin: number }[] = [];
  fx: THREE.Points[] = [];
  heroes: { mixer: THREE.AnimationMixer }[] = [];
  sky!: THREE.Mesh;
  godrays!: ShaderPass;
  grade!: ShaderPass;
  bloom!: UnrealBloomPass;
  time = 0;
  intro = 0;           // 0 → 1 camera push-in when the scene opens
  introDur = 7;
  private camBase = new THREE.Vector3(-10, -70, 440);
  private lookBase = new THREE.Vector3(-30, 6, 0);
  private ready = false;
  waterfalls: THREE.ShaderMaterial[] = [];
  crystals: THREE.MeshStandardMaterial[] = [];

  constructor(public renderer: THREE.WebGLRenderer, public quality: 'low' | 'medium' | 'high' | 'ultra' = 'high') {}

  async build() {
    const S = this.scene, A = this.atmos;
    // sun: upper-left, behind the castle (from the reference composition)
    this.sunDir.set(-0.37, 0.40, -0.84).normalize();
    A.uSunDir.value.copy(this.sunDir);
    A.uFogColor.value.setRGB(0.55, 0.59, 0.65);
    A.uSunFogColor.value.setRGB(0.80, 0.74, 0.62);
    A.uFogDensity.value = 0.00042; A.uFogHeight.value = -40; A.uFogFalloff.value = 0.0025;
    this.sky = skyDome(this.sunDir);
    S.add(this.sky);

    // lighting: sun + sky fill + image-based light from a CC0 Poly Haven HDRI
    this.sun.position.copy(this.sunDir).multiplyScalar(600);
    this.sun.castShadow = this.quality !== 'low';
    this.sun.shadow.mapSize.set(this.quality === 'ultra' ? 4096 : 2048, this.quality === 'ultra' ? 4096 : 2048);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -140; sc.right = 140; sc.top = 160; sc.bottom = -160; sc.near = 200; sc.far = 1100;
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.6;
    S.add(this.sun, this.sun.target);
    S.add(new THREE.HemisphereLight(0xc8d6ea, 0x6e675c, 1.1));
    try {
      const hdr = await new RGBELoader().loadAsync(BASE + 'hdri/sky_1k.hdr');
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(this.renderer);
      S.environment = pm.fromEquirectangular(hdr).texture;
      S.environmentIntensity = 0.55;
      hdr.dispose(); pm.dispose();
    } catch { /* IBL is optional */ }

    const T0 = performance.now(); const L = (s: string) => console.log('[sky] ' + s + ' ' + Math.round(performance.now() - T0));
    L('hdr');
    this.buildIsland(); L('island');
    this.buildCastle(); L('castle');
    this.buildDistant(); L('distant');
    await this.buildForeground(); L('fg');
    this.buildFx(); L('fx');

    S.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m || o === this.sky || (o as any).isPoints || (o as any).noAtmos) return;
      (Array.isArray(m) ? m : [m]).forEach((mm) => { if ((mm as any).isMeshStandardMaterial || (mm as any).isMeshPhysicalMaterial || (mm as any).isMeshBasicMaterial) applyAtmos(mm, A); });
    });
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.lookBase);
    this.ready = true;
  }

  private stone(color: number, rough = 0.7) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.15, map: tex('tex/brick_col.jpg'), normalMap: tex('tex/brick_nor.jpg', { srgb: false }), normalScale: new THREE.Vector2(0.6, 0.6) });
    return m;
  }

  private buildIsland() {
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xb09276, map: tex('tex/rock_col.jpg'), normalMap: tex('tex/rock_nor.jpg', { srgb: false }), normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.92, metalness: 0 });
    const island = new THREE.Mesh(islandGeometry({ radius: 78, depth: 82, seed: 3.1, crown: 0.2, detail: this.quality === 'low' ? 72 : 160 }), rockMat);
    island.castShadow = island.receiveShadow = true;
    this.castle.add(island);
    // gold collar balustrade around the waist (at ~ -27 m in the reference)
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8a64a, metalness: 1, roughness: 0.28, emissive: 0x3a2405, emissiveIntensity: 0.6 });
    const collarY = -24;
    const collar = new THREE.Group();
    const rC = 79;
    collar.add(new THREE.Mesh(new THREE.TorusGeometry(rC, 0.9, 10, 160).rotateX(Math.PI / 2), gold));
    const rail = new THREE.Mesh(new THREE.TorusGeometry(rC, 0.45, 8, 160).rotateX(Math.PI / 2), gold); rail.position.y = 4.2; collar.add(rail);
    const postG = new THREE.CylinderGeometry(0.28, 0.32, 4.2, 6).translate(0, 2.1, 0);
    const posts = new THREE.InstancedMesh(postG, gold, 96);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < 96; i++) { const a = (i / 96) * Math.PI * 2; mtx.makeTranslation(Math.cos(a) * rC, 0, Math.sin(a) * rC); posts.setMatrixAt(i, mtx); }
    collar.add(posts);
    collar.position.y = collarY;
    this.castle.add(collar);
    // gold ring ledge (a shelf the balustrade stands on)
    const ledge = new THREE.Mesh(new THREE.CylinderGeometry(rC + 2.5, rC - 10, 4, 96, 1), this.stone(0x8c8478, 0.8));
    ledge.position.y = collarY - 1.5; ledge.castShadow = ledge.receiveShadow = true;
    this.castle.add(ledge);

    // warm lantern points scattered on the rock face + the big hanging crystal at the root
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 3.4, 2.0) });
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.55, 8, 6), lampMat, 40);
    const rnd = mulberry(11);
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, y = -4 - rnd() * 58, t = 1 + y / 82;
      const prof = t > 0.62 ? 0.84 : 0.84 * Math.pow(t / 0.62, 1.35);
      const r = 78 * prof * 1.08;
      mtx.makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r);
      lamps.setMatrixAt(i, mtx);
    }
    this.castle.add(lamps);
    const glowSpr = (c: THREE.Color, s: number) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); sp.scale.setScalar(s); (sp as any).noAtmos = true; return sp; };
    // hanging lantern-crystal (white, glowing) on a chain below the root
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 12, 6), gold); chain.position.y = -86; this.castle.add(chain);
    const crysMat = new THREE.MeshStandardMaterial({ color: 0xdff6ff, emissive: 0xbfeaff, emissiveIntensity: 3.2, roughness: 0.1, metalness: 0.1 });
    this.crystals.push(crysMat);
    const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(4, 0).scale(1, 2.2, 1), crysMat);
    lantern.position.y = -100; this.castle.add(lantern);
    const lg = glowSpr(new THREE.Color(0.9, 0.97, 1.0), 34); lg.position.y = -100; this.castle.add(lg);
    const pl = new THREE.PointLight(0xcfeeff, 6000, 120, 2); pl.position.y = -98; this.castle.add(pl);
    // smaller hanging crystals around the underside
    const cg = new THREE.OctahedronGeometry(1, 0).scale(1, 3.2, 1);
    const cryst = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x58d8ff, emissiveIntensity: 2.2, roughness: 0.15 }), 26);
    this.crystals.push(cryst.material as THREE.MeshStandardMaterial);
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, y = -40 - rnd() * 34, t = 1 + y / 82, r = 78 * 0.84 * Math.pow(t / 0.62, 1.35) * 0.82;
      const s = 0.8 + rnd() * 1.8;
      mtx.compose(new THREE.Vector3(Math.cos(a) * r, y - s * 3, Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.5, rnd() * 3, (rnd() - 0.5) * 0.5)), new THREE.Vector3(s, s, s));
      cryst.setMatrixAt(i, mtx);
    }
    this.castle.add(cryst);
    // two waterfalls spilling off the crown, ending in mist
    for (const [a, w] of [[2.2, 7], [0.6, 4.5]] as [number, number][]) {
      const h = 70;
      const wm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `uniform float uTime; varying vec2 vUv;
          float h(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1)))*43758.5); }
          float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
          void main(){
            float s = n(vec2(vUv.x*18.0, vUv.y*6.0 + uTime*2.2)) * 0.6 + n(vec2(vUv.x*40.0, vUv.y*14.0 + uTime*3.4)) * 0.4;
            float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
            float fade = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
            float a = smoothstep(0.3, 0.75, s) * edge * fade * 0.85;
            gl_FragColor = vec4(vec3(0.95,0.97,1.0)*1.3, a);
          }`,
      });
      this.waterfalls.push(wm);
      const r = 78 * 0.96;
      const geo = new THREE.PlaneGeometry(w, h, 1, 12);
      const gp = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < gp.count; i++) { const yy = gp.getY(i); const k = (h / 2 - yy) / h; gp.setZ(i, k * k * 14); gp.setX(i, gp.getX(i) * (1 + k * 1.6)); }
      const wf = new THREE.Mesh(geo, wm);
      wf.position.set(Math.cos(a) * r, -h / 2 + 1, Math.sin(a) * r);
      wf.lookAt(Math.cos(a) * 500, -h / 2, Math.sin(a) * 500);
      (wf as any).noAtmos = true;
      this.castle.add(wf);
    }
    this.scene.add(this.castle);
  }

  private buildCastle() {
    const C = new THREE.Group();
    const slate = this.stone(0x4c525d, 0.6);
    const slateDark = this.stone(0x434a56, 0.55);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3d4552, map: tex('tex/roof_col.jpg'), normalMap: tex('tex/roof_nor.jpg', { srgb: false }), roughness: 0.5, metalness: 0.3 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9aa52, metalness: 1, roughness: 0.25 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x9a7a55, metalness: 0.55, roughness: 0.42, map: tex('tex/rock_col.jpg'), normalMap: tex('tex/rock_nor.jpg', { srgb: false }), normalScale: new THREE.Vector2(0.4, 0.4) });
    const lightBand = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1.0, 0.93, 0.82), emissiveIntensity: 3.6, roughness: 0.4 });
    const winMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1.0, 0.78, 0.46), emissiveIntensity: 3.0 });
    const shadowAll = (o: THREE.Object3D) => o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    const band = (r: number, y: number, h: number) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 72, 1, true), lightBand); b.position.y = y; C.add(b); };
    const trim = (r: number, y: number, t = 0.5) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 96).rotateX(Math.PI / 2), gold); m.position.y = y; C.add(m); };
    const windowRing = (r: number, y: number, n: number, w: number, h: number) => {
      const g = new THREE.PlaneGeometry(w, h);
      const im = new THREE.InstancedMesh(g, winMat, n);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2); m.compose(new THREE.Vector3(Math.cos(a) * (r + 0.05), y, Math.sin(a) * (r + 0.05)), q, new THREE.Vector3(1, 1, 1)); im.setMatrixAt(i, m); }
      C.add(im);
    };

    // base terrace wall (sits in the crown)
    const terrace = new THREE.Mesh(lathe([[0, 0], [58, 0], [60, 2], [57, 9], [55, 9.5], [0, 9.5]], 96), slateDark);
    C.add(terrace);
    // the great drum with its stacked rings of light (the reference's glowing bands)
    const drumR = 38;
    const drum = new THREE.Mesh(lathe([[0, 9], [drumR + 1.5, 9], [drumR, 11], [drumR, 40], [drumR - 3, 42], [drumR - 4, 44], [0, 44]], 96), slate);
    C.add(drum);
    for (const [y, h] of [[16, 1.4], [23.5, 1.4], [31, 1.4], [38.5, 1.6]] as [number, number][]) { band(drumR + 0.25, y, h); trim(drumR + 0.6, y + h * 0.5 + 0.4, 0.35); }
    windowRing(drumR + 0.3, 27, 40, 1.4, 3.2);
    windowRing(drumR + 0.3, 19.5, 40, 1.4, 3.2);
    // upper keep
    const keep = new THREE.Mesh(lathe([[0, 44], [19, 44], [18, 46], [17, 70], [19, 72], [19, 75], [14, 77], [0, 77]], 72), slate);
    C.add(keep);
    band(17.2, 56, 1.2); band(17.2, 63, 1.2); band(19.2, 73.5, 1.6);
    windowRing(17.2, 50.5, 22, 1.1, 2.6); windowRing(17.2, 66.5, 22, 1.1, 2.4);
    trim(19.4, 72, 0.4); trim(19.4, 75.2, 0.4);
    // the spire: a slender, slightly concave cone with gold banding, glowing tip
    const sp: [number, number][] = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; sp.push([13 * Math.pow(1 - t, 1.6) + 0.15, 77 + t * 82]); }
    sp.push([0, 159.5]);
    const spire = new THREE.Mesh(lathe(sp, 48), slateDark);
    C.add(spire);
    for (const t of [0.12, 0.3, 0.5, 0.68]) { const r = 13 * Math.pow(1 - t, 1.6) + 0.35; trim(r, 77 + t * 82, 0.3 + 0.2 * (1 - t)); }
    const tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 7.4, 6.2) });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), tipMat); tip.position.y = 160; C.add(tip);
    const tipGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(1.6, 1.5, 1.3), blending: THREE.AdditiveBlending, depthWrite: false })); tipGlow.scale.setScalar(26); tipGlow.position.y = 160; (tipGlow as any).noAtmos = true; C.add(tipGlow);

    // halo rings: one bright thin ring around the spire (as in the reference) plus two rune halos
    const runes = runeStripTex(5, 48, 2048, 64);
    const haloSpec: [number, number, number, number, number][] = [[24, 112, 0.18, 0.22, 0], [30, 92, -0.12, -0.1, 1], [44, 60, 0.08, 0.06, 1]];
    for (const [r, y, tilt, speed, rune] of haloSpec) {
      const h = new THREE.Group();
      if (!rune) {
        h.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.38, 8, 160).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 3.9, 3.4) })));
      } else {
        const bandG = new THREE.CylinderGeometry(r, r, 2.4, 160, 1, true);
        const uvA = bandG.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uvA.count; i++) uvA.setX(i, uvA.getX(i) * 4);
        const rm = new THREE.MeshStandardMaterial({ color: 0xc89a44, metalness: 1, roughness: 0.3, emissive: new THREE.Color(1.0, 0.75, 0.35), emissiveMap: runes, emissiveIntensity: 3.0, side: THREE.DoubleSide });
        runes.repeat.set(1, 1);
        h.add(new THREE.Mesh(bandG, rm));
        h.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.3, 6, 160).rotateX(Math.PI / 2).translate(0, 1.3, 0), gold));
        h.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.3, 6, 160).rotateX(Math.PI / 2).translate(0, -1.3, 0), gold));
      }
      h.position.y = y; h.rotation.x = tilt; h.rotation.z = tilt * 0.6;
      (h as any).spin = speed;
      this.halos.push(h);
      C.add(h);
    }

    // satellite towers (x, z, radius, height, collar glow)
    const towers: [number, number, number, number][] = [
      [-46, 4, 6.5, 62], [46, -2, 6.5, 66], [4, 44, 5, 46], [-26, 38, 4, 34], [30, 36, 4.2, 38], [-52, -24, 4, 40], [50, -30, 4, 44], [-6, -46, 5, 50], [-62, 22, 3.2, 26], [64, 18, 3.2, 28],
    ];
    for (const [x, z, r, h] of towers) {
      const tg = new THREE.Group();
      const body = new THREE.Mesh(lathe([[r * 1.25, 0], [r * 1.15, 3], [r, 4], [r, h - 4], [r * 1.25, h - 3], [r * 1.25, h], [0, h]], 32), slate);
      tg.add(body);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.27, r * 1.27, 1.2, 32, 1, true), lightBand); collar.position.y = h - 1.5; tg.add(collar);
      const b2 = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.8, 32, 1, true), lightBand); b2.position.y = h * 0.55; tg.add(b2);
      const cap = new THREE.Mesh(lathe([[r * 1.35, 0], [r * 0.9, r * 0.9], [r * 0.45, r * 2.4], [0.05, r * 4.2]], 32), roofMat); cap.position.y = h; tg.add(cap);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.25, r * 1.4, 6), gold); fin.position.y = h + r * 4.2 + r * 0.6; tg.add(fin);
      const nWin = Math.max(6, Math.round(r * 2.2));
      const wg = new THREE.PlaneGeometry(0.9, 2.0);
      const wi = new THREE.InstancedMesh(wg, winMat, nWin * 2);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      for (let k = 0; k < nWin * 2; k++) { const a = (k % nWin) / nWin * Math.PI * 2 + (k >= nWin ? 0.3 : 0); const yy = k >= nWin ? h * 0.75 : h * 0.35; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2); m.compose(new THREE.Vector3(Math.cos(a) * (r + 0.05), yy, Math.sin(a) * (r + 0.05)), q, new THREE.Vector3(1, 1, 1)); wi.setMatrixAt(k, m); }
      tg.add(wi);
      tg.position.set(x, 8, z);
      C.add(tg);
    }
    // bridges: arched walkways from the drum to the two tall towers
    for (const s of [-1, 1]) {
      const br = new THREE.Mesh(new THREE.BoxGeometry(10, 2.2, 4), slateDark);
      br.position.set(s * 42, 36, 2); C.add(br);
    }

    // crescent horns / blade wings (two great upswept horns + two long horizontal blades)
    const hornSpecs: { pts: [number, number, number][]; w: number; t: number }[] = [
      { pts: [[16, 60, 4], [36, 70, 8], [58, 92, 6], [68, 122, 0], [64, 146, -6]], w: 9, t: 2.2 },
      { pts: [[-16, 60, 4], [-34, 68, 8], [-52, 84, 6], [-62, 106, 0], [-58, 124, -6]], w: 8, t: 2.0 },
      { pts: [[34, 36, 6], [60, 42, 10], [92, 54, 8], [118, 70, 2], [134, 82, -4]], w: 8, t: 1.8 },
      { pts: [[-34, 34, 6], [-62, 38, 10], [-98, 44, 8], [-128, 52, 2], [-148, 58, -4]], w: 8, t: 1.8 },
    ];
    for (const hs of hornSpecs) {
      const curve = new THREE.CatmullRomCurve3(hs.pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      const hm = new THREE.Mesh(hornGeometry(curve, hs.w, hs.t), bronze);
      C.add(hm);
      // a thin gold inlay along the horn
      const inlay = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.22, 5, false), gold);
      C.add(inlay);
    }
    shadowAll(C);
    this.castle.add(C);
  }

  private buildDistant() {
    const rnd = mulberry(29);
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x9c8e80, roughness: 0.95, map: tex('tex/rock_col.jpg'), normalMap: tex('tex/rock_nor.jpg', { srgb: false }) });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x5d7a3a, roughness: 1, map: tex('tex/grass_col.jpg') });
    const spec: [number, number, number, number][] = [[-640, -40, -420, 30], [-420, -110, -120, 14], [560, -10, -620, 26], [-1300, 80, -1800, 80], [300, -140, -900, 18]];
    for (const [x, y, z, r] of spec) {
      const g = new THREE.Group();
      const isl = new THREE.Mesh(islandGeometry({ radius: r, depth: r * 2.1, seed: rnd() * 50, crown: 0.4, detail: 56 }), rockMat);
      g.add(isl);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.98, r * 0.06, 40).translate(0, r * 0.02, 0), grassMat); g.add(top);
      if (r > 25) { const t = new THREE.Mesh(lathe([[r * 0.08, 0], [r * 0.08, r * 0.8], [r * 0.1, r * 0.8], [0, r * 1.15]], 12), new THREE.MeshStandardMaterial({ color: 0x5b6270, roughness: 0.6 })); g.add(t); }
      g.position.set(x, y, z);
      g.rotation.y = rnd() * 6;
      this.scene.add(g);
      this.bobbers.push({ o: g, base: g.position.clone(), amp: r * 0.04, ph: rnd() * 6, spin: 0 });
    }
    // small rocks orbiting close to the main island
    const debris = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const r = 2 + rnd() * 3.5;
      const d = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1).scale(1, 0.75, 1), rockMat);
      { const pa = d.geometry.attributes.position as THREE.BufferAttribute; const v = new THREE.Vector3(); for (let k = 0; k < pa.count; k++) { v.fromBufferAttribute(pa, k); v.multiplyScalar(1 + fbm(v.x * 0.4 + i, v.y * 0.4, v.z * 0.4, 3) * 0.45); pa.setXYZ(k, v.x, v.y, v.z); } d.geometry.computeVertexNormals(); }
      const a = rnd() * Math.PI * 2, dist = 95 + rnd() * 50;
      d.position.set(Math.cos(a) * dist, -20 + rnd() * 70, Math.sin(a) * dist * 0.8);
      debris.add(d);
      this.bobbers.push({ o: d, base: d.position.clone(), amp: 1 + rnd() * 2, ph: rnd() * 6, spin: (rnd() - 0.5) * 0.1 });
    }
    this.castle.add(debris);
  }

  /** Height of the grassy crest the camera stands on (analytic, so placement needs no raycasts). */
  groundY(x: number, wz: number) {
    const ahead = this.camBase.z - wz;
    let y = this.camBase.y - 1.8 - Math.max(0, ahead - 14) * 0.18 - Math.max(0, ahead - 34) * 0.6 + fbm(x * 0.02, wz * 0.02, 2, 4) * 2.2;
    y += Math.max(0, x - this.camBase.x - 40) * 0.05;
    return y;
  }

  private async buildForeground() {
    // grassy hilltop the camera stands on, dropping away toward the cloud sea
    const W = 900, Dp = 260;
    const g = new THREE.PlaneGeometry(W, Dp, 220, 90).rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + this.camBase.x, wz = this.camBase.z + p.getZ(i) - 60;
      p.setXYZ(i, x, this.groundY(x, wz), wz);
    }
    g.computeVertexNormals();
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 6, p.getZ(i) / 6);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2c3d1e, map: tex('tex/grass_col.jpg'), normalMap: tex('tex/grass_nor.jpg', { srgb: false }), roughness: 1 });
    const ground = new THREE.Mesh(g, groundMat);
    ground.receiveShadow = true;
    this.scene.add(ground);
    // instanced grass blades near the camera (wind-swayed in the vertex shader)
    const n = this.quality === 'low' ? 8000 : this.quality === 'medium' ? 24000 : 60000;
    const blade = new THREE.PlaneGeometry(0.045, 0.2, 1, 3).translate(0, 0.1, 0);
    const bp = blade.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) { const yy = bp.getY(i) / 0.2; bp.setX(i, bp.getX(i) * (1 - yy * 0.9)); bp.setZ(i, yy * yy * 0.12); }
    blade.computeVertexNormals();
    const gm = new THREE.MeshStandardMaterial({ color: 0x6f8e45, roughness: 0.85, side: THREE.DoubleSide });
    const windU = { value: 0 };
    gm.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = windU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind; varying float vH;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vH = position.y / 0.2;
          vec4 ip = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
          float sw = sin(uWind * 1.7 + ip.x * 0.31 + ip.z * 0.17) * 0.5 + sin(uWind * 2.9 + ip.x * 0.7) * 0.25;
          transformed.x += sw * vH * vH * 0.22; transformed.z += sw * vH * vH * 0.08;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(0.45, 1.15, vH);');
    };
    (this as any).windU = windU;
    const grass = new THREE.InstancedMesh(blade, gm, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    const rnd = mulberry(77);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const zz = Math.pow(rnd(), 0.8); const x = this.camBase.x + (rnd() - 0.5) * (18 + zz * 50), z = this.camBase.z - 8 - zz * 32;
      pos.set(x, this.groundY(x, z) - 0.05, z);
      q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, rnd() * Math.PI, (rnd() - 0.5) * 0.4));
      const s = 0.6 + rnd() * 0.6; sc.set(s, s * (0.6 + rnd() * 0.6), s);
      m4.compose(pos, q, sc);
      grass.setMatrixAt(i, m4);
      col.setHSL(0.24 + rnd() * 0.05, 0.3 + rnd() * 0.2, 0.09 + rnd() * 0.08); grass.setColorAt(i, col);
    }
    grass.receiveShadow = true;
    this.scene.add(grass);
    // boulders
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8378, map: tex('tex/rock_col.jpg'), normalMap: tex('tex/rock_nor.jpg', { srgb: false }), roughness: 0.9 });
    for (const [dx, dz, s] of [[-30, -16, 3.2], [-24, -20, 1.6], [22, -20, 2.4], [30, -14, 1.2], [-14, -30, 1.4]] as [number, number, number][]) {
      const rg = new THREE.IcosahedronGeometry(s, 4);
      const rp = rg.attributes.position as THREE.BufferAttribute; const v = new THREE.Vector3();
      for (let i = 0; i < rp.count; i++) { v.fromBufferAttribute(rp, i); const k = 1 + fbm(v.x * 0.6 + dx, v.y * 0.6, v.z * 0.6, 4) * 0.35; v.multiplyScalar(k); v.y *= 0.7; rp.setXYZ(i, v.x, v.y, v.z); }
      rg.computeVertexNormals();
      const rock = new THREE.Mesh(rg, rockMat);
      const x = this.camBase.x + dx, z = this.camBase.z + dz;
      rock.position.set(x, this.groundY(x, z) + s * 0.2, z);
      rock.castShadow = rock.receiveShadow = true;
      this.scene.add(rock);
    }
    // two adventurers on the crest, looking up at the castle
    const heroSpots: [string, number, number, number, number][] = [['Ranger_Male_SimpleParted', -4.4, -12.5, 0x8a7a5a, 0.25], ['Wizard_Female_Long', -2.7, -12.0, 0x2a3550, -0.1]];
    for (const [model, dx, dz, , rot] of heroSpots) {
      try {
        const h = await makeHero(model, {});
        const x = this.camBase.x + dx, z = this.camBase.z + dz;
        h.root.position.set(x, this.groundY(x, z), z);
        h.root.lookAt(this.lookBase.x * 0.3, h.root.position.y, this.lookBase.z);
        h.root.rotation.y += rot;
        h.play('idle', 0); h.mixer.update(Math.random() * 3);
        this.scene.add(h.root);
        this.heroes.push(h);
      } catch (e) { console.warn('hero load failed', e); }
    }
  }

  private buildFx() {
    // floating light motes drifting in the haze (crisp, additive)
    const box = new THREE.Box3(new THREE.Vector3(this.camBase.x - 60, this.camBase.y - 6, this.camBase.z - 120), new THREE.Vector3(this.camBase.x + 60, this.camBase.y + 40, this.camBase.z - 8));
    const motes = sparkleField({ count: this.quality === 'low' ? 60 : 160, box, color: new THREE.Color(1.6, 1.5, 1.2), size: 0.28, rise: 0.6, swirl: 1.2, twinkle: 0.8, seed: 9 });
    this.fx.push(motes); this.scene.add(motes);
    const box2 = new THREE.Box3(new THREE.Vector3(-110, -80, -60), new THREE.Vector3(110, 170, 80));
    const castleMotes = sparkleField({ count: this.quality === 'low' ? 80 : 260, box: box2, color: new THREE.Color(2.6, 2.4, 1.9), size: 6, rise: 2.0, swirl: 4, twinkle: 1, seed: 21 });
    this.fx.push(castleMotes); this.castle.add(castleMotes);
    // birds
    const birdG = new THREE.BufferGeometry();
    const bv = new Float32Array([0, 0, 0, -1, 0.25, -0.2, -0.15, 0, 0.1, 0, 0, 0, 1, 0.25, -0.2, 0.15, 0, 0.1]);
    birdG.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    const birdM = new THREE.MeshBasicMaterial({ color: 0x3a3d45, side: THREE.DoubleSide });
    const birds = new THREE.Group();
    const rnd = mulberry(5);
    for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(birdG, birdM); b.scale.setScalar(2.2); b.position.set(-180 + rnd() * 60, 70 + rnd() * 30, 120 + rnd() * 50); (b as any).ph = rnd() * 6; birds.add(b); }
    (this as any).birds = birds;
    this.scene.add(birds);
  }

  makeComposer(w: number, h: number) {
    const r = this.renderer;
    const c = new EffectComposer(r);
    c.setPixelRatio(r.getPixelRatio());
    c.setSize(w, h);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.godrays = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2() }, uIntensity: { value: 1 }, uColor: { value: new THREE.Color(1.0, 0.9, 0.75) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uIntensity; uniform vec3 uColor; varying vec2 vUv;
        void main(){
          vec4 base = texture2D(tDiffuse, vUv);
          vec2 d = (uSun - vUv) / 64.0; vec2 p = vUv; float illum = 0.0; float decay = 1.0;
          for (int i = 0; i < 64; i++) { p += d; vec3 s = texture2D(tDiffuse, clamp(p, 0.0, 1.0)).rgb; float l = clamp(dot(s, vec3(0.3,0.59,0.11)) - 1.3, 0.0, 3.0); illum += l * decay; decay *= 0.972; }
          float fall = smoothstep(1.4, 0.0, length((uSun - vUv) * vec2(1.6, 1.0)));
          gl_FragColor = vec4(base.rgb + uColor * illum * uIntensity * 0.0022 * fall, base.a);
        }`,
    });
    c.addPass(this.godrays);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.3, 0.32, 2.2);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uTime, uFade; varying vec2 vUv;
        float rnd(vec2 p){ return fract(sin(dot(p + fract(uTime), vec2(12.9898,78.233)))*43758.5453); }
        void main(){
          vec2 q = vUv - 0.5;
          // subtle lateral chromatic aberration toward the edges
          float ca = dot(q, q) * 0.006;
          vec3 c = vec3(texture2D(tDiffuse, vUv + q * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - q * ca).b);
          float l = dot(c, vec3(0.299,0.587,0.114));
          c = mix(c, c * vec3(0.93, 0.98, 1.05), (1.0 - l) * 0.35); // cool shadows
          c = mix(c, c * vec3(1.05, 1.0, 0.95), l * 0.25);          // warm highlights
          float v = smoothstep(0.95, 0.25, length(q * vec2(1.0, 1.2)));
          c *= mix(0.72, 1.0, v);
          c += (rnd(vUv) - 0.5) * 0.02;
          gl_FragColor = vec4(c * uFade, 1.0);
        }`,
    });
    c.addPass(this.grade);
    if (this.quality !== 'low') c.addPass(new SMAAPass(w * r.getPixelRatio(), h * r.getPixelRatio()));
    this.composer = c;
    return c;
  }

  setSize(w: number, h: number) {
    this.camera.aspect = w / h;
    // keep the castle framed on narrow (phone) screens by widening the vertical fov
    this.camera.fov = w / h < 1.2 ? 58 : 40;
    this.camera.updateProjectionMatrix();
    if (!this.composer) this.makeComposer(w, h); else this.composer.setSize(w, h);
  }

  update(dt: number) {
    if (!this.ready) return;
    this.time += dt;
    const t = this.time;
    this.intro = Math.min(1, this.intro + dt / this.introDur);
    const e = 1 - Math.pow(1 - this.intro, 3);
    // camera: push-in from a high wide shot, then a slow breathing drift
    const narrow = this.camera.aspect < 1.2;
    const cb = this.camBase.clone();
    if (narrow) cb.add(new THREE.Vector3(18, 10, 160));
    const start = cb.clone().add(new THREE.Vector3(-140, 90, 420));
    const cam = start.lerp(cb, e);
    cam.x += Math.sin(t * 0.07) * 1.6; cam.y += Math.sin(t * 0.11) * 0.5; cam.z += Math.cos(t * 0.05) * 1.5;
    this.camera.position.copy(cam);
    const look = this.lookBase.clone(); if (narrow) look.x = 0; look.y += Math.sin(t * 0.09) * 1.2 + (1 - e) * 30;
    this.camera.lookAt(look);
    // the castle breathes: a slow vertical bob; halos and debris turn
    this.castle.position.y = Math.sin(t * 0.35) * 1.6;
    for (const h of this.halos) h.rotation.y += (h as any).spin * dt;
    for (const b of this.bobbers) { b.o.position.y = b.base.y + Math.sin(t * 0.4 + b.ph) * b.amp; b.o.rotation.y += b.spin * dt; }
    for (const c of this.crystals) c.emissiveIntensity = (c.userData.base ??= c.emissiveIntensity) * (0.85 + 0.15 * Math.sin(t * 1.6));
    for (const w of this.waterfalls) w.uniforms.uTime.value = t;
    for (const f of this.fx) (f.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    for (const f of this.fx) (f.material as THREE.ShaderMaterial).uniforms.uPx.value = this.renderer.domElement.height / 900;
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    (this as any).windU.value = t;
    for (const h of this.heroes) h.mixer.update(dt);
    const birds = (this as any).birds as THREE.Group;
    birds.position.x = ((t * 9) % 520) - 60; birds.position.y = Math.sin(t * 0.3) * 6;
    birds.children.forEach((b) => { const f = Math.sin(t * 9 + (b as any).ph); b.scale.y = 2.2 * (0.4 + 0.6 * Math.abs(f)); });
    // sun screen position for god rays
    const sp = this.sunDir.clone().multiplyScalar(5000).add(this.camera.position).project(this.camera);
    const vis = sp.z < 1 ? 1 : 0;
    this.godrays.uniforms.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    this.godrays.uniforms.uIntensity.value = vis;
    this.grade.uniforms.uTime.value = t;
    this.grade.uniforms.uFade.value = Math.min(1, t / 1.2);
  }

  render(dt: number) { this.update(dt); this.composer.render(dt); }

  dispose() {
    this.scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mm = m.material as any; (Array.isArray(mm) ? mm : mm ? [mm] : []).forEach((x: THREE.Material) => x.dispose()); });
    this.scene.environment?.dispose();
    this.composer?.dispose();
  }
}
