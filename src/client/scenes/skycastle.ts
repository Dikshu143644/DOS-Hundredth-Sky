import * as THREE from 'three';
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
import { makeCloak } from '../engine/cloak';


/** Sky / haze dome: physically-inspired single scattering look (Rayleigh gradient + Mie sun lobe),
 *  a soft horizon haze band and a bright fog sea below the horizon. Output is linear HDR. */
function skyDome(sunDir: THREE.Vector3) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: sunDir }, uTime: { value: 0 }, uZen: { value: new THREE.Color(0.20, 0.29, 0.44) }, uHor: { value: new THREE.Color(0.60, 0.63, 0.67) }, uSunCol: { value: new THREE.Color(1.0, 0.92, 0.80) }, uSeaLo: { value: new THREE.Color(0.52, 0.55, 0.59) }, uSeaHi: { value: new THREE.Color(0.70, 0.70, 0.70) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `
      uniform vec3 uSun; uniform float uTime; uniform vec3 uZen, uHor, uSunCol, uSeaLo, uSeaHi; varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm2(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*n2(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        float mu = dot(d, uSun);
        // Rayleigh-ish gradient: muted blue zenith → pale haze at the horizon
        vec3 zen = uZen;
        vec3 hor = uHor;
        // golden hour: the horizon glows warmer toward the sun
        hor = mix(hor, uSunCol * 0.95, pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 3.0) * 0.55);
        float t = pow(clamp(1.0 - max(y, 0.0), 0.0, 1.0), 6.0);
        vec3 c = mix(zen, hor, t);
        // Mie forward scattering lobe + sun disc
        float mie = pow(max(mu, 0.0), 12.0) * 0.38 + pow(max(mu, 0.0), 90.0) * 1.1 + pow(max(mu,0.0), 1600.0) * 14.0;
        c += uSunCol * mie;
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
          vec3 sea = mix(uSeaLo, uSeaHi, smoothstep(0.35, 0.8, cl));
          sea += uSunCol * pow(max(mu, 0.0), 8.0) * 0.3;
          c = mix(hor + uSunCol*pow(max(mu,0.0),8.0)*0.45, sea, k);
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

function smooth(a: number, b: number, x: number) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

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
  introDur = 3.2;
  private camBase = new THREE.Vector3(-250, -36, 470);
  private lookBase = new THREE.Vector3(-150, -10, 0);
  heroKey = new THREE.DirectionalLight(0xffc890, 0);
  cloak: { update: (dt: number, s: number) => void } | null = null;
  hero: THREE.Object3D | null = null;
  branch: THREE.Group | null = null;
  seaMat: THREE.ShaderMaterial | null = null;
  private ready = false;
  waterfalls: THREE.ShaderMaterial[] = [];
  crystals: THREE.MeshStandardMaterial[] = [];

  constructor(public renderer: THREE.WebGLRenderer, public quality: 'low' | 'medium' | 'high' | 'ultra' = 'high') {}

  async build() {
    const S = this.scene, A = this.atmos;
    // GOLDEN HOUR (Omkar's title-menu reference): a low sun behind and to the right of the castle,
    // a warm sky over a sea of clouds, peach haze. Everything here is procedural: no HDR download.
    // low sun to the LEFT of the hero, front-lighting the castle on the right (the reference)
    { const f = this.fwd; const a = 0.46; this.sunDir.set(f.x * Math.cos(a) + f.z * Math.sin(a), 0.075, -f.x * Math.sin(a) + f.z * Math.cos(a)).normalize(); }
    A.uSunDir.value.copy(this.sunDir);
    A.uFogColor.value.setRGB(0.86, 0.66, 0.50);
    A.uSunFogColor.value.setRGB(1.0, 0.62, 0.30);
    A.uFogDensity.value = 0.00007; A.uFogHeight.value = -60; A.uFogFalloff.value = 0.0022;
    this.sky = skyDome(this.sunDir);
    const su = (this.sky.material as THREE.ShaderMaterial).uniforms;
    su.uZen.value.setRGB(0.15, 0.29, 0.58); su.uHor.value.setRGB(1.0, 0.66, 0.38); su.uSunCol.value.setRGB(1.0, 0.68, 0.34);
    su.uSeaLo.value.setRGB(0.62, 0.46, 0.46); su.uSeaHi.value.setRGB(1.0, 0.82, 0.62);
    S.add(this.sky);

    this.sun.color.setRGB(1.0, 0.74, 0.48); this.sun.intensity = 4.2;
    this.sun.position.copy(this.sunDir).multiplyScalar(600);
    this.sun.castShadow = this.quality !== 'low';
    this.sun.shadow.mapSize.set(this.quality === 'ultra' ? 4096 : 2048, this.quality === 'ultra' ? 4096 : 2048);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -140; sc.right = 140; sc.top = 160; sc.bottom = -160; sc.near = 200; sc.far = 1100;
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.6;
    S.add(this.sun, this.sun.target);
    // a second, tight shadow-casting key just for the hero on the cliff (crisp contact shadows)
    this.heroKey.color.copy(this.sun.color); this.heroKey.intensity = 0;
    S.add(new THREE.HemisphereLight(0xffd6b0, 0x4b4058, 1.0));
    // warm sunset fill on the castle's camera-facing side (the reference shows it glowing gold)
    const fill = new THREE.DirectionalLight(0xffc488, 1.9);
    fill.position.copy(this.camBase).sub(new THREE.Vector3(0, 0, 0)).normalize().multiplyScalar(500).add(new THREE.Vector3(-250, 120, 0));
    fill.target.position.set(0, 40, 0); S.add(fill, fill.target);
    // image-based light from the procedural sky itself (PMREM of the dome): zero bytes, matches the grade
    try {
      const envScene = new THREE.Scene();
      envScene.add(new THREE.Mesh(this.sky.geometry, this.sky.material));
      const pm = new THREE.PMREMGenerator(this.renderer);
      S.environment = pm.fromScene(envScene, 0.04, 0.1, 20000).texture;
      S.environmentIntensity = 0.6;
      pm.dispose();
    } catch { /* IBL is optional */ }

    const T0 = performance.now(); const L = (s: string) => console.log('[sky] ' + s + ' ' + Math.round(performance.now() - T0));
    this.buildIsland(); L('island');
    this.buildCastle(); L('castle');
    this.buildDistant(); L('distant');
    this.buildCloudSea(); L('clouds');
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
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.15, map: tex('tex/512/brick_col.webp'), normalMap: tex('tex/512/brick_nor.webp', { srgb: false }), normalScale: new THREE.Vector2(0.6, 0.6) });
    return m;
  }

  private buildIsland() {
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xb09276, map: tex('tex/512/rock_col.webp'), normalMap: tex('tex/512/rock_nor.webp', { srgb: false }), normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.92, metalness: 0 });
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
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3d4552, map: tex('tex/512/roof_col.webp'), normalMap: tex('tex/512/roof_nor.webp', { srgb: false }), roughness: 0.5, metalness: 0.3 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9aa52, metalness: 1, roughness: 0.25 });
    const bronze = new THREE.MeshStandardMaterial({ color: 0x9a7a55, metalness: 0.55, roughness: 0.42, map: tex('tex/512/rock_col.webp'), normalMap: tex('tex/512/rock_nor.webp', { srgb: false }), normalScale: new THREE.Vector2(0.4, 0.4) });
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
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x9c8e80, roughness: 0.95, map: tex('tex/512/rock_col.webp'), normalMap: tex('tex/512/rock_nor.webp', { srgb: false }) });
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x5d7a3a, roughness: 1, map: tex('tex/512/grass_col.webp') });
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

  /** Camera forward on the ground plane (toward the look target) and its right vector. */
  private get fwd() { return new THREE.Vector3(this.lookBase.x - this.camBase.x, 0, this.lookBase.z - this.camBase.z).normalize(); }
  private get right() { const f = this.fwd; return new THREE.Vector3(-f.z, 0, f.x); }

  /** Height of the cliff top the hero stands on (analytic, so placement needs no raycasts):
   *  a gently rolling grassy shelf that breaks into a sheer rock face over the cloud sea. */
  groundY(x: number, wz: number) {
    const f = this.fwd, cb = this.camBase;
    const dx = x - cb.x, dz = wz - cb.z;
    const ahead = dx * f.x + dz * f.z, side = dx * -f.z + dz * f.x;
    let y = cb.y - 1.45 + fbm(x * 0.05, wz * 0.05, 2, 4) * 0.6 - 0.3 + Math.max(0, -ahead) * 0.12;
    const edge = 9.5 + fbm(side * 0.06, 3.3, 1, 3) * 6 - Math.max(0, side - 6) * 0.15 + Math.max(0, -side - 10) * 0.35;
    if (ahead > edge) { const k = ahead - edge; y -= k * 2.6 + k * k * 0.06 + fbm(side * 0.2, k * 0.2, 4, 3) * Math.min(6, k * 0.5); }
    // the hero's lookout: a raised rock shelf ~5 m ahead
    { const hx = ahead - 5.4, hs = side + 0.9; y += 0.55 * Math.exp(-(hx * hx) / 9 - (hs * hs) / 14); }
    // a rocky shoulder rising on the left of frame
    y += Math.max(0, -side - 7) * 0.32 * (0.6 + fbm(side * 0.1, ahead * 0.1, 7, 3));
    return y;
  }

  private async buildForeground() {
    const f = this.fwd, r = this.right, cb = this.camBase;
    // cliff-top ground: dense near the hero, sliding into the rock face
    const g = new THREE.PlaneGeometry(1, 1, 180, 140);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5;
      const side = (u - 0.5) * 2; const sd = Math.sign(side) * Math.pow(Math.abs(side), 1.6) * 70;
      const ah = -12 + Math.pow(v, 1.7) * 110;
      const x = cb.x + f.x * ah + r.x * sd, z = cb.z + f.z * ah + r.z * sd;
      p.setXYZ(i, x, this.groundY(x, z), z);
    }
    g.computeVertexNormals();
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 3, (p.getZ(i) + p.getY(i) * 0.6) / 3);
    const rockMap = tex('tex/512/rock_col.webp'), rockNor = tex('tex/512/rock_nor.webp', { srgb: false });
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x9aa06a, map: tex('tex/512/grass_col.webp'), normalMap: tex('tex/512/grass_nor.webp', { srgb: false }), roughness: 1 });
    groundMat.onBeforeCompile = (sh) => {
      sh.uniforms.rockMap = { value: rockMap }; sh.uniforms.rockNor = { value: rockNor };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUp;').replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvUp = normal.y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D rockMap; uniform sampler2D rockNor; varying float vUp;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float steep = 1.0 - smoothstep(0.55, 0.82, vUp);
          vec3 rk = texture2D(rockMap, vMapUv * 0.35).rgb * vec3(1.05, 0.92, 0.82) * 1.25;
          diffuseColor.rgb = mix(diffuseColor.rgb, rk, steep);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.82, steep);');
    };
    const ground = new THREE.Mesh(g, groundMat);
    ground.receiveShadow = true; ground.castShadow = true;
    this.scene.add(ground);

    // instanced grass blades on the shelf (wind-swayed in the vertex shader)
    const n = this.quality === 'low' ? 9000 : this.quality === 'medium' ? 26000 : 52000;
    const blade = new THREE.PlaneGeometry(0.03, 0.2, 1, 4).translate(0, 0.1, 0);
    const bp = blade.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) { const yy = bp.getY(i) / 0.2; bp.setX(i, bp.getX(i) * (1 - yy * 0.9)); bp.setZ(i, yy * yy * 0.1); }
    blade.computeVertexNormals();
    const gm = new THREE.MeshStandardMaterial({ color: 0x8aa050, roughness: 0.8, side: THREE.DoubleSide });
    const windU = { value: 0 };
    gm.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = windU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind; varying float vH;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vH = position.y / 0.2;
          vec4 ip = instanceMatrix * vec4(0.0,0.0,0.0,1.0);
          float sw = sin(uWind * 1.9 + ip.x * 0.9 + ip.z * 0.5) * 0.5 + sin(uWind * 3.1 + ip.x * 1.7) * 0.25 + 0.35;
          transformed.x += sw * vH * vH * 0.16; transformed.z += sw * vH * vH * 0.07;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(0.35, 1.25, vH);');
    };
    (this as any).windU = windU;
    const grass = new THREE.InstancedMesh(blade, gm, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), scl = new THREE.Vector3(), pos = new THREE.Vector3();
    const rnd = mulberry(77);
    const col = new THREE.Color();
    let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) {
      const ah = 0.5 + Math.pow(rnd(), 1.3) * 16, sd = (rnd() - 0.5) * (6 + ah * 2.2);
      const x = cb.x + f.x * ah + r.x * sd, z = cb.z + f.z * ah + r.z * sd;
      const y = this.groundY(x, z);
      if (this.groundY(x + f.x * 0.6, z + f.z * 0.6) < y - 0.5) continue; // not on the cliff face
      pos.set(x, y - 0.03, z);
      q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, rnd() * Math.PI, (rnd() - 0.5) * 0.4));
      const s = 0.5 + rnd() * 0.7; scl.set(s, s * (0.5 + rnd() * 0.8) * Math.min(1, 0.45 + ah * 0.08), s);
      m4.compose(pos, q, scl);
      grass.setMatrixAt(k, m4);
      col.setHSL(0.17 + rnd() * 0.07, 0.35 + rnd() * 0.2, 0.16 + rnd() * 0.12); grass.setColorAt(k, col);
      k++;
    }
    grass.count = k;
    grass.receiveShadow = true;
    this.scene.add(grass);

    // small white wildflowers (the reference's foreground daisies)
    const fc = document.createElement('canvas'); fc.width = fc.height = 64;
    const fx = fc.getContext('2d')!;
    fx.translate(32, 32);
    for (let i = 0; i < 6; i++) { fx.rotate(Math.PI / 3); fx.fillStyle = '#fbf7ee'; fx.beginPath(); fx.ellipse(0, -14, 6, 13, 0, 0, Math.PI * 2); fx.fill(); }
    fx.fillStyle = '#f1c34a'; fx.beginPath(); fx.arc(0, 0, 6, 0, Math.PI * 2); fx.fill();
    const flowerTex = new THREE.CanvasTexture(fc); flowerTex.colorSpace = THREE.SRGBColorSpace;
    const fg = new THREE.PlaneGeometry(0.11, 0.11).rotateX(-Math.PI / 2 + 0.5).translate(0, 0.17, 0);
    const stem = new THREE.PlaneGeometry(0.006, 0.17).translate(0, 0.085, 0);
    const fm = new THREE.MeshStandardMaterial({ map: flowerTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, emissive: 0x241a10 });
    const flowers = new THREE.InstancedMesh(fg, fm, 700), stems = new THREE.InstancedMesh(stem, new THREE.MeshStandardMaterial({ color: 0x5b6b2a, side: THREE.DoubleSide }), 700);
    k = 0;
    for (let i = 0; i < 3000 && k < 700; i++) {
      const ah = 0.3 + Math.pow(rnd(), 1.5) * 11, sd = (rnd() - 0.62) * (5 + ah * 1.6);
      const x = cb.x + f.x * ah + r.x * sd, z = cb.z + f.z * ah + r.z * sd;
      const y = this.groundY(x, z);
      if (this.groundY(x + f.x * 0.6, z + f.z * 0.6) < y - 0.4) continue;
      pos.set(x, y, z); q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.3, rnd() * 6.28, 0)); const s = 0.7 + rnd() * 0.7; scl.set(s, s, s);
      m4.compose(pos, q, scl); flowers.setMatrixAt(k, m4); stems.setMatrixAt(k, m4); k++;
    }
    flowers.count = stems.count = k;
    this.scene.add(flowers, stems);

    // boulders breaking through the turf and along the edge
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xb0a090, map: rockMap, normalMap: rockNor, roughness: 0.88 });
    for (const [ah, sd, s] of [[7.5, -5.2, 1.1], [11.5, 6.5, 1.6], [3.0, -5.5, 0.6], [12, -9, 2.4], [6.5, 4.4, 0.45], [2.2, 2.6, 0.3]] as [number, number, number][]) {
      const rg = new THREE.IcosahedronGeometry(s, 4);
      const rp = rg.attributes.position as THREE.BufferAttribute; const v = new THREE.Vector3();
      for (let i = 0; i < rp.count; i++) { v.fromBufferAttribute(rp, i); const kk = 1 + fbm(v.x * 0.9 + sd, v.y * 0.9, v.z * 0.9, 4) * 0.4; v.multiplyScalar(kk); v.y *= 0.72; rp.setXYZ(i, v.x, v.y, v.z); }
      rg.computeVertexNormals();
      const rock = new THREE.Mesh(rg, rockMat);
      const x = cb.x + f.x * ah + r.x * sd, z = cb.z + f.z * ah + r.z * sd;
      rock.position.set(x, this.groundY(x, z) + s * 0.12, z);
      rock.rotation.y = sd;
      rock.castShadow = rock.receiveShadow = true;
      this.scene.add(rock);
    }

    // THE HERO: seen from behind at the cliff edge, cream hooded cloak in the wind, facing the castle
    try {
      const h = await makeHero('Ranger_Male_SimpleParted', { headgear: false, hair: 0x5a4636, tint: 0x8e8270 });
      h.root.traverse((o) => { if (/Hair_Beard|Head_Hood/.test(o.name)) o.visible = false; });
      const ah = 5.2, sd = -0.9;
      const x = cb.x + f.x * ah + r.x * sd, z = cb.z + f.z * ah + r.z * sd;
      h.root.position.set(x, this.groundY(x, z), z);
      const toCastle = new THREE.Vector3(x - cb.x, 0, z - cb.z).normalize().lerp(new THREE.Vector3(-x, 0, -z).normalize(), 0.12).normalize(); // squarely from behind, a touch toward the castle
      h.root.rotation.y = Math.atan2(toCastle.x, toCastle.z);
      h.play('idle', 0); h.mixer.update(0.5);
      this.scene.add(h.root);
      h.root.updateMatrixWorld(true);
      const cl = makeCloak(h.root, { color: 0xd6c4a0, length: 1.25, width: 0.6, litSide: 1, sweep: -0.55 });
      // light armour like the reference: layered steel pauldrons with gold edging on both shoulders
      {
        const steel = new THREE.MeshPhysicalMaterial({ color: 0xa39a8c, metalness: 0.85, roughness: 0.42, clearcoat: 0.2, envMapIntensity: 0.6 });
        const gold = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 1, roughness: 0.3 });
        const s = h.root.scale.x || 1;
        for (const side of ['l', 'r'] as const) {
          let arm: THREE.Object3D | null = null; h.root.traverse((b) => { if (b.name === 'upperarm_' + side) arm = b; });
          if (!arm) continue;
          const wp = new THREE.Vector3().setFromMatrixPosition((arm as THREE.Object3D).matrixWorld);
          const out = new THREE.Vector3().subVectors(wp, new THREE.Vector3().setFromMatrixPosition(h.root.matrixWorld)).setY(0).normalize();
          const P = new THREE.Group();
          for (let k = 0; k < 3; k++) {
            const rr = (0.078 - k * 0.009) * s;
            const shell = new THREE.Mesh(new THREE.SphereGeometry(rr, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), steel);
            shell.scale.set(1.05, 0.62, 1.2); shell.position.set(0, -k * 0.034 * s, 0); shell.rotation.z = k * 0.12;
            const rim = new THREE.Mesh(new THREE.TorusGeometry(rr * Math.sin(Math.PI * 0.42) * 1.04, 0.006 * s, 6, 28), gold);
            rim.rotation.x = Math.PI / 2; rim.scale.set(1.05, 1.2, 1); rim.position.set(0, shell.position.y + rr * Math.cos(Math.PI * 0.42) * 0.62, 0);
            shell.castShadow = rim.castShadow = true; P.add(shell, rim);
          }
          P.position.copy(wp).addScaledVector(out, 0.03 * s).add(new THREE.Vector3(0, 0.05 * s, 0));
          P.lookAt(P.position.clone().add(new THREE.Vector3(0, 1, 0)).addScaledVector(out, 0.55)); P.rotateX(Math.PI / 2);
          this.scene.add(P); (arm as THREE.Object3D).attach(P);
        }
      }
      if (cl) { cl.uniforms.uWind.value = 1.25; this.cloak = cl; }
      this.heroes.push(h);
      this.hero = h.root;
      // the sun's shadow frustum hugs the hero (crisp contact shadows); the castle is backlit anyway
      this.sun.target.position.copy(h.root.position);
      const shc = this.sun.shadow.camera as THREE.OrthographicCamera;
      shc.left = -14; shc.right = 14; shc.top = 14; shc.bottom = -14; shc.near = 520; shc.far = 700; shc.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
      this.sun.position.copy(h.root.position).addScaledVector(this.sunDir, 600);
    } catch (e) { console.warn('hero load failed', e); }

    this.buildBranch();
  }

  /** An overhanging tree branch in the near left of frame, dark against the sunset, swaying. */
  private buildBranch() {
    const grp = new THREE.Group();
    const bark = new THREE.MeshStandardMaterial({ color: 0x3b2c22, map: tex('tex/q_NormalTree_Bark.webp'), roughness: 0.95 });
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-3.2, 1.6, 0.6), new THREE.Vector3(-1.9, 1.15, 0.1), new THREE.Vector3(-0.8, 0.95, -0.4), new THREE.Vector3(0.2, 0.62, -0.7)]);
    const tube = new THREE.TubeGeometry(curve, 32, 0.07, 8, false);
    const tp = tube.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) { const t = Math.floor(i / 9) / 32; const c = curve.getPointAt(Math.min(1, t)); const off = new THREE.Vector3(tp.getX(i) - c.x, tp.getY(i) - c.y, tp.getZ(i) - c.z); off.multiplyScalar(1.4 - t * 1.05); tp.setXYZ(i, c.x + off.x, c.y + off.y, c.z + off.z); }
    tube.computeVertexNormals();
    grp.add(new THREE.Mesh(tube, bark));
    const leafTex = tex('tex/q_NormalTree_Leaves.webp');
    const lm = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, color: 0x4a4a26, roughness: 0.8, emissive: 0x140a02 });
    const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.62, 0.62), lm, 46);
    const rnd = mulberry(404); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < 46; i++) {
      const t = 0.15 + rnd() * 0.85; const c = curve.getPointAt(t);
      c.add(new THREE.Vector3((rnd() - 0.5) * 0.7, (rnd() - 0.7) * 0.55, (rnd() - 0.5) * 0.5));
      q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3));
      const s = 0.6 + rnd() * 0.7;
      m4.compose(c, q, new THREE.Vector3(s, s, s)); leaves.setMatrixAt(i, m4);
    }
    grp.add(leaves);
    grp.traverse((o) => { (o as any).noAtmos = true; o.castShadow = false; });
    this.branch = grp;
    this.scene.add(grp);
  }

  /** The sea of clouds under the islands: an fbm cloud deck lit by the low sun (warm tops,
   *  lilac shade), with forward scattering toward the sun and distance haze into the horizon. */
  private buildCloudSea() {
    const y0 = this.camBase.y - 240;
    const m = new THREE.ShaderMaterial({
      fog: false, depthWrite: false, transparent: false,
      uniforms: { uTime: { value: 0 }, uSun: { value: this.sunDir }, uCam: { value: this.camera.position }, uLit: { value: new THREE.Color(1.35, 0.98, 0.70) }, uShade: { value: new THREE.Color(0.38, 0.30, 0.42) }, uHaze: { value: new THREE.Color(0.98, 0.66, 0.44) }, uSunCol: { value: new THREE.Color(1.0, 0.68, 0.36) } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `
        uniform float uTime; uniform vec3 uSun, uCam, uLit, uShade, uHaze, uSunCol; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*n2(p); p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(1.7,9.2); a*=0.5; } return s; }
        float cloud(vec2 p){ vec2 q = vec2(fbm(p + uTime*0.01), fbm(p + vec2(5.2,1.3) - uTime*0.008)); return fbm(p + q * 1.6); }
        void main(){
          vec2 p = vW.xz * 0.0016 + vec2(uTime * 0.012, 0.0);
          float c = cloud(p);
          float e = 0.02;
          float cx = cloud(p + vec2(e, 0.0)), cz = cloud(p + vec2(0.0, e));
          vec3 n = normalize(vec3((c - cx) * 9.0, 1.0, (c - cz) * 9.0));
          float tops = smoothstep(0.28, 0.78, c);
          float lit = clamp(dot(n, normalize(uSun + vec3(0.0, 0.25, 0.0))) * 0.6 + 0.5, 0.0, 1.0);
          vec3 col = mix(uShade, uLit, tops * lit);
          vec3 v = normalize(vW - uCam);
          float mu = max(dot(v, uSun), 0.0);
          col += uSunCol * (pow(mu, 10.0) * 0.9 + pow(mu, 3.0) * 0.25) * (0.4 + tops);
          float dist = length(vW.xz - uCam.xz);
          float hz = 1.0 - exp(-dist * 0.00007);
          col = mix(col, uHaze + uSunCol * pow(mu, 6.0) * 0.6, clamp(hz, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000, 1, 1).rotateX(-Math.PI / 2), m);
    sea.position.y = y0; sea.renderOrder = -5; (sea as any).noAtmos = true;
    this.seaMat = m;
    this.scene.add(sea);
    // cumulus piles on the deck: instanced camera-facing puffs (procedural texture), lit warm on
    // the sun side and lilac underneath, glowing where they stand in front of the sun
    {
      const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
      const g2 = c.getContext('2d')!; const im = g2.createImageData(S, S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S - 0.5, v = y / S - 0.5;
        const nn = fbm(u * 6 + 3, v * 6, 1.7, 5);
        const r = Math.hypot(u, v * 1.25) * 2;
        const a0 = (1 - r) * 1.9 + (nn - 0.5) * 2.4; const a = a0 <= 0 ? 0 : Math.min(1, a0 * a0 * 5.0);
        const i = (y * S + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255 * Math.min(1, 0.55 + nn * 0.6); im.data[i + 3] = 255 * a;
      }
      g2.putImageData(im, 0, 0);
      const ct = new THREE.CanvasTexture(c); ct.colorSpace = THREE.NoColorSpace;
      const N = this.quality === 'low' ? 90 : 260;
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const off = new Float32Array(N * 4); const rr = mulberry(311);
      const f = this.fwd, rt = this.right, cb = this.camBase;
      for (let i = 0; i < N; i++) {
        const d = 220 + Math.pow(rr(), 1.35) * 2400, sd = (rr() - 0.5) * d * 1.7;
        off[i * 4] = cb.x + f.x * d + rt.x * sd; off[i * 4 + 2] = cb.z + f.z * d + rt.z * sd;
        const size = 150 + rr() * 300 + d * 0.08;
        off[i * 4 + 1] = y0 + size * 0.12 + rr() * 30; off[i * 4 + 3] = size;
      }
      geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
      geo.instanceCount = N;
      const pm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false,
        uniforms: { map: { value: ct }, uSun: { value: this.sunDir }, uCam: { value: this.camera.position }, uLit: { value: new THREE.Color(1.3, 0.92, 0.62) }, uShade: { value: new THREE.Color(0.34, 0.27, 0.38) }, uHaze: { value: new THREE.Color(1.0, 0.70, 0.46) }, uSunCol: { value: new THREE.Color(1.0, 0.68, 0.36) } },
        vertexShader: `attribute vec4 aOff; varying vec2 vUv; varying vec3 vW;
          void main(){ vUv = uv; vec3 c = aOff.xyz; vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); vec3 u = vec3(0.0,1.0,0.0);
            vec3 w = c + r * position.x * aOff.w * 1.6 + u * position.y * aOff.w; vW = w; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
        fragmentShader: `uniform sampler2D map; uniform vec3 uSun, uCam, uLit, uShade, uHaze, uSunCol; varying vec2 vUv; varying vec3 vW;
          void main(){ vec4 t = texture2D(map, vUv); if (t.a < 0.01) discard;
            vec3 v = normalize(vW - uCam); float mu = max(dot(v, uSun), 0.0);
            vec3 sxz = normalize(vec3(uSun.x, 0.0, uSun.z)); vec3 rxz = normalize(cross(v, vec3(0.0,1.0,0.0)));
            float side = dot(rxz, sxz) * (vUv.x - 0.5) * -2.0;
            float lit = clamp(pow(vUv.y, 1.4) * 1.1 + side * 0.4 + (t.r - 0.6) * 0.8, 0.0, 1.0);
            vec3 col = mix(uShade, uLit, lit);
            col += uSunCol * (pow(mu, 8.0) * 1.2 + pow(mu, 2.5) * 0.2) * (1.2 - t.a * 0.6);
            float dist = length(vW.xz - uCam.xz); col = mix(col, uHaze + uSunCol * pow(mu, 6.0) * 0.6, clamp(1.0 - exp(-dist * 0.00005), 0.0, 1.0));
            gl_FragColor = vec4(col, t.a); }`,
      });
      const puffsMesh = new THREE.Mesh(geo, pm); puffsMesh.frustumCulled = false; puffsMesh.renderOrder = -4; (puffsMesh as any).noAtmos = true;
      this.scene.add(puffsMesh);
    }
    // distant mountain peaks breaking through the cloud deck (left of frame)
    const mm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false });
    const rnd = mulberry(91);
    const spots: [number, number, number, number][] = [[2600, -1900, 520, 420], [3400, -2600, 760, 560], [1700, -2900, 420, 380], [-5200, -7600, 1300, 900], [-1600, -11000, 1400, 1200]];
    for (const [x, z, hgt, rad] of spots) {
      const cg = new THREE.ConeGeometry(rad, hgt, 64, 24, true);
      const cp = cg.attributes.position as THREE.BufferAttribute; const v = new THREE.Vector3();
      const colors = new Float32Array(cp.count * 3);
      for (let i = 0; i < cp.count; i++) {
        v.fromBufferAttribute(cp, i);
        const t = (v.y + hgt / 2) / hgt;
        const a = Math.atan2(v.z, v.x);
        const ridge = 1 - Math.abs(fbm(a * 3 + x, t * 4, 1, 4) - 0.5) * 2;
        const kk = 0.7 + ridge * 0.45 + rnd() * 0.04;
        v.x *= kk; v.z *= kk; v.y += fbm(a * 5, t * 2, x, 3) * hgt * 0.08;
        cp.setXYZ(i, v.x, v.y, v.z);
        const snow = smooth(0.72, 0.86, t + (ridge - 0.5) * 0.15);
        colors[i * 3] = 0.36 + snow * 0.6; colors[i * 3 + 1] = 0.34 + snow * 0.58; colors[i * 3 + 2] = 0.38 + snow * 0.6;
      }
      cg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      cg.computeVertexNormals();
      const mt = new THREE.Mesh(cg, mm);
      mt.position.set(x, y0 + hgt * 0.18, z);
      this.scene.add(mt);
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
      uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2() }, uIntensity: { value: 1 }, uColor: { value: new THREE.Color(1.0, 0.8, 0.55) } },
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.42, 0.5, 1.6);
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
          c = mix(c, c * vec3(0.95, 0.94, 1.06), (1.0 - l) * 0.30); // lilac shadows
          c = mix(c, c * vec3(1.12, 1.0, 0.80), 0.25 + l * 0.35);   // golden grade
          c = mix(vec3(l), c, 1.06);                                   // a touch more saturation
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
    this.camera.fov = w / h < 1.0 ? 56 : 42;
    this.camera.updateProjectionMatrix();
    if (!this.composer) this.makeComposer(w, h); else this.composer.setSize(w, h);
  }

  update(dt: number) {
    if (!this.ready) return;
    this.time += dt;
    const t = this.time;
    this.intro = Math.min(1, this.intro + dt / this.introDur);
    const e = 1 - Math.pow(1 - this.intro, 3);
    // camera: a short settle, then a slow breathing drift over the hero's shoulder
    const narrow = this.camera.aspect < 1.0;
    const cb = this.camBase.clone();
    const back = this.fwd.multiplyScalar(-1);
    if (narrow) cb.addScaledVector(back, 2.6).add(new THREE.Vector3(0, 0.5, 0));
    const start = cb.clone().addScaledVector(back, 6).add(new THREE.Vector3(0, 2.2, 0));
    const cam = start.lerp(cb, e);
    cam.x += Math.sin(t * 0.13) * 0.35; cam.y += Math.sin(t * 0.17) * 0.12; cam.z += Math.cos(t * 0.11) * 0.3;
    this.camera.position.copy(cam);
    const look = this.lookBase.clone();
    if (narrow) look.lerp(new THREE.Vector3(0, 40, 0), 0.3);
    look.y += Math.sin(t * 0.09) * 1.5 - (1 - e) * 12;
    this.camera.lookAt(look);
    if (this.branch) {
      // keep the branch hanging into the top-left of frame whatever the aspect
      const fw = new THREE.Vector3(); this.camera.getWorldDirection(fw);
      const rt = new THREE.Vector3().crossVectors(fw, this.camera.up).normalize();
      const halfW = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect * 3.2;
      this.branch.position.copy(cam).addScaledVector(fw, 3.2).addScaledVector(rt, -halfW * 0.78).add(new THREE.Vector3(0, narrow ? 0.55 : 0.95, 0));
      this.branch.quaternion.copy(this.camera.quaternion);
      this.branch.rotation.z += Math.sin(t * 1.1) * 0.015; this.branch.rotation.x += Math.sin(t * 0.8 + 1) * 0.01;
    }
    if (this.cloak) this.cloak.update(dt, 0);
    if (this.seaMat) this.seaMat.uniforms.uTime.value = t;
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
