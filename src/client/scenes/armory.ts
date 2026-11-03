import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { tex } from '../engine/assets';
import { buildWeapon, WeaponFX, WeaponModel } from '../engine/weapons';
import { sparkleField } from '../engine/procedural';
import { ITEMS, LEGENDARY_IDS, rarityOf } from '../../shared/items';

const BASE = import.meta.env.BASE_URL + 'assets/';

/** The armory: legendary weapons floating over a dark, wet, reflective cobblestone floor whose
 *  stone joints glow in the weapon's rarity colour; crisp sparkles; slow turntable. */
export class Armory {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 200);
  composer!: EffectComposer;
  bloom!: UnrealBloomPass;
  grade!: ShaderPass;
  time = 0;
  items: { id: string; fx: WeaponFX; holder: THREE.Group; base: THREE.Vector3 }[] = [];
  mode: 'showcase' | 'lineup' = 'showcase';
  current = 'frostfang';
  private glowU = { uGlowColor: { value: new THREE.Color(0.3, 0.8, 1) }, uGlowCenters: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 1, 0)) }, uGlowCount: { value: 1 }, uTime: { value: 0 } };
  private floorFx!: THREE.Points;
  private key!: THREE.SpotLight;
  private floorLight!: THREE.PointLight;
  private turn = 0;
  dragging = false;

  constructor(public renderer: THREE.WebGLRenderer, public quality: 'low' | 'medium' | 'high' | 'ultra' = 'high') {}

  async build() {
    const S = this.scene;
    S.background = new THREE.Color(0x030305);
    S.fog = new THREE.FogExp2(0x040407, 0.085);
    try {
      const hdr = await new RGBELoader().loadAsync(BASE + 'hdri/sky_1k.hdr');
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(this.renderer);
      S.environment = pm.fromEquirectangular(hdr).texture;
      S.environmentIntensity = 0.32;
      S.environmentRotation.y = 1.2;
      hdr.dispose(); pm.dispose();
    } catch { /* optional */ }
    // key light from above + cool rim light from behind
    this.key = new THREE.SpotLight(0xdfe8ff, 60, 14, 0.42, 0.8, 1.6);
    this.key.position.set(1.4, 5.5, 2.2);
    this.key.castShadow = this.quality !== 'low';
    this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0002; this.key.shadow.normalBias = 0.01;
    S.add(this.key, this.key.target);
    const rim = new THREE.DirectionalLight(0x9fb4ff, 2.2); rim.position.set(-3, 3, -4); S.add(rim);
    S.add(new THREE.HemisphereLight(0x223048, 0x050505, 0.35));
    this.floorLight = new THREE.PointLight(0x60c8ff, 8, 5, 2); this.floorLight.position.set(0, 0.25, 0); S.add(this.floorLight);

    // floor: Poly Haven cobblestone (CC0), dark and wet, joints glow
    const rep = 2.2;
    const col = tex('tex/cobble_col.webp'), nor = tex('tex/cobble_nor.webp', { srgb: false }), arm = tex('tex/cobble_arm.webp', { srgb: false });
    for (const t of [col, nor, arm]) t.repeat.set(rep * 6, rep * 6);
    const floorMat = new THREE.MeshStandardMaterial({ map: col, normalMap: nor, normalScale: new THREE.Vector2(1.6, 1.6), aoMap: arm, roughnessMap: arm, color: 0x8a8c94, roughness: 0.5, metalness: 0.05 });
    const U = this.glowU;
    floorMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFW;').replace('#include <project_vertex>', '#include <project_vertex>\nvFW = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFW; uniform vec3 uGlowColor; uniform vec4 uGlowCenters[8]; uniform int uGlowCount; uniform float uTime;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          { float joint = smoothstep(0.76, 0.6, texture2D(aoMap, vAoMapUv).r);
            float g = 0.0;
            for (int i = 0; i < 8; i++) { if (i >= uGlowCount) break; vec4 c = uGlowCenters[i]; float d = length(vFW.xz - c.xy); g += c.w * exp(-d * d / (c.z * c.z)); }
            float pulse = 0.85 + 0.15 * sin(uTime * 2.0 + vFW.x * 3.0);
            totalEmissiveRadiance += uGlowColor * joint * g * 6.0 * pulse + uGlowColor * g * 0.06; }`);
    };
    const fg = new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2);
    fg.setAttribute('uv1', fg.attributes.uv);
    const floor = new THREE.Mesh(fg, floorMat);
    floor.receiveShadow = true;
    S.add(floor);
    // planar reflection layered over the floor: rough-blurred by the stone roughness, distorted by its normals
    if (this.quality !== 'low') {
      const refl = new Reflector(new THREE.PlaneGeometry(30, 30), {
        textureWidth: this.quality === 'ultra' ? 2048 : 1024, textureHeight: this.quality === 'ultra' ? 2048 : 1024, clipBias: 0.003,
        shader: {
          name: 'WetFloor',
          uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, tNor: { value: nor }, tArm: { value: arm }, uRep: { value: rep * 6 } },
          vertexShader: 'uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vUv2; void main(){ vUv = textureMatrix * vec4(position,1.0); vUv2 = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
          fragmentShader: `uniform sampler2D tDiffuse, tNor, tArm; uniform float uRep; varying vec4 vUv; varying vec2 vUv2;
            void main(){
              vec2 tuv = vUv2 * uRep;
              vec3 n = texture2D(tNor, tuv).xyz * 2.0 - 1.0;
              float rough = texture2D(tArm, tuv).g; float ao = texture2D(tArm, tuv).r;
              vec4 uv = vUv; uv.xy += n.xy * 0.035 * uv.w;
              float b = (0.004 + rough * 0.014) * uv.w;
              vec3 r = texture2DProj(tDiffuse, uv).rgb * 0.36;
              r += texture2DProj(tDiffuse, uv + vec4(b, 0.0, 0.0, 0.0)).rgb * 0.16 + texture2DProj(tDiffuse, uv - vec4(b, 0.0, 0.0, 0.0)).rgb * 0.16;
              r += texture2DProj(tDiffuse, uv + vec4(0.0, b, 0.0, 0.0)).rgb * 0.16 + texture2DProj(tDiffuse, uv - vec4(0.0, b, 0.0, 0.0)).rgb * 0.16;
              float k = (1.0 - rough) * 0.75 * ao;
              gl_FragColor = vec4(r * k, 1.0);
            }`,
        } as any,
      });
      refl.rotation.x = -Math.PI / 2; refl.position.y = 0.002;
      (refl.material as THREE.ShaderMaterial).transparent = true;
      (refl.material as THREE.ShaderMaterial).blending = THREE.AdditiveBlending;
      (refl.material as THREE.ShaderMaterial).depthWrite = false;
      S.add(refl);
    }
    // ambient floating sparkles over the floor
    this.floorFx = sparkleField({ count: this.quality === 'low' ? 80 : 260, box: new THREE.Box3(new THREE.Vector3(-4, 0.02, -4), new THREE.Vector3(4, 2.8, 2)), color: new THREE.Color(1.6, 1.6, 1.8), size: 0.05, rise: 0.05, swirl: 0.15, twinkle: 1, seed: 71 });
    S.add(this.floorFx);

    for (const id of LEGENDARY_IDS) {
      const d = ITEMS[id];
      const fx = buildWeapon(d.model as WeaponModel, { quality: this.quality });
      const holder = new THREE.Group();
      holder.add(fx.group);
      fx.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
      S.add(holder);
      this.items.push({ id, fx, holder, base: new THREE.Vector3() });
    }
    this.show(this.current);
  }

  show(id: string) {
    this.mode = 'showcase'; this.current = id;
    for (const it of this.items) {
      const on = it.id === id;
      it.holder.visible = on;
      if (on) { it.base.set(0, this.flip(it.id) ? 1.78 : 0.42, 0); if (it.fx.light) it.fx.light.visible = true; }
    }
    const it = this.items.find((x) => x.id === id)!;
    this.glowU.uGlowColor.value.copy(it.fx.glow);
    this.glowU.uGlowCenters.value.forEach((v, i) => v.set(0, 0, 1.15, i === 0 ? 1 : 0));
    this.glowU.uGlowCount.value = 1;
    this.floorLight.color.copy(it.fx.glow);
    this.floorLight.intensity = 3;
    (this.floorFx.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(it.fx.glow).multiplyScalar(1.4).addScalar(0.5);
  }

  lineup() {
    this.mode = 'lineup';
    const n = this.items.length, gap = 0.62;
    const centers: THREE.Vector4[] = [];
    this.items.forEach((it, i) => {
      it.holder.visible = true;
      const x = (i - (n - 1) / 2) * gap;
      it.base.set(x, it.fx.length > 1.5 ? 0.62 : 0.42, 0);
      if (it.fx.light) it.fx.light.visible = false;
      centers.push(new THREE.Vector4(x, 0, 0.38, 0.8));
    });
    this.glowU.uGlowColor.value.setRGB(0.9, 0.75, 0.55);
    this.glowU.uGlowCenters.value.forEach((v, i) => v.copy(centers[i] ?? new THREE.Vector4(0, 0, 1, 0)));
    this.glowU.uGlowCount.value = centers.length;
    this.floorLight.color.setRGB(1, 0.85, 0.7); this.floorLight.intensity = 0.8;
    (this.floorFx.material as THREE.ShaderMaterial).uniforms.uColor.value.setRGB(1.8, 1.7, 1.6);
  }

  makeComposer(w: number, h: number) {
    const r = this.renderer;
    const c = new EffectComposer(r);
    c.setPixelRatio(r.getPixelRatio()); c.setSize(w, h);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.6, 0.4, 1.1);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
        float rnd(vec2 p){ return fract(sin(dot(p + fract(uTime), vec2(12.9898,78.233)))*43758.5453); }
        void main(){ vec2 q = vUv - 0.5; vec3 c = texture2D(tDiffuse, vUv).rgb;
          float v = smoothstep(0.9, 0.2, length(q * vec2(1.0, 1.25))); c *= mix(0.45, 1.0, v);
          c += (rnd(vUv) - 0.5) * 0.015; gl_FragColor = vec4(c, 1.0); }`,
    });
    c.addPass(this.grade);
    if (this.quality !== 'low') c.addPass(new SMAAPass(w * r.getPixelRatio(), h * r.getPixelRatio()));
    this.composer = c;
  }
  setSize(w: number, h: number) {
    this.camera.aspect = w / h; this.camera.fov = w / h < 1.2 ? 50 : 32; this.camera.updateProjectionMatrix();
    if (!this.composer) this.makeComposer(w, h); else this.composer.setSize(w, h);
  }
  rotateBy(d: number) { this.turn += d; }
  /** Swords are presented point-down, hovering over the stone (as in the reference shots). */
  flip(id: string) { const m = ITEMS[id]?.model; return m === 'frost' || m === 'ignis' || m === 'sol'; }
  update(dt: number) {
    this.time += dt; const t = this.time;
    this.glowU.uTime.value = t;
    (this.floorFx.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    (this.floorFx.material as THREE.ShaderMaterial).uniforms.uPx.value = this.renderer.domElement.height / 900;
    for (const it of this.items) {
      if (!it.holder.visible) continue;
      it.fx.update(t, dt);
      for (const a of it.fx.aura) (a.material as THREE.ShaderMaterial).uniforms.uPx.value = this.renderer.domElement.height / 900;
      it.holder.position.set(it.base.x, it.base.y + Math.sin(t * 1.1 + it.base.x * 2) * 0.03, it.base.z);
      it.holder.scale.setScalar(this.mode === 'showcase' ? 1.35 : 0.62);
      it.holder.rotation.x = this.mode === 'showcase' && this.flip(it.id) ? Math.PI : 0;
      it.holder.rotation.y = (this.mode === 'showcase' ? Math.sin(t * 0.45) * 0.85 + this.turn : 0.5 + Math.sin(t * 0.4 + it.base.x) * 0.25);
    }
    const narrow = this.camera.aspect < 1.2;
    if (this.mode === 'showcase') {
      const d = narrow ? 5.8 : 4.55;
      this.camera.position.set(Math.sin(t * 0.13) * 0.2, 1.45 + Math.sin(t * 0.21) * 0.03, d);
      this.camera.lookAt(0, 1.14, 0);
    } else {
      this.camera.position.set(0, 0.95, narrow ? 6.8 : 3.7);
      this.camera.lookAt(0, 0.8, 0);
    }
    this.key.target.position.set(0, 0.5, 0);
    this.grade.uniforms.uTime.value = t;
  }
  render(dt: number) { this.update(dt); this.composer.render(dt); }
  dispose() { this.scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); }); this.composer?.dispose(); this.scene.environment?.dispose(); }
}
export { rarityOf };
