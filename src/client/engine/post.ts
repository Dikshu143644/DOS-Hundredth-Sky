import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { QualityPreset } from '../settings';

const GodRaysShader = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.7) }, uIntensity: { value: 0 }, uColor: { value: new THREE.Color(1, 0.9, 0.75) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uIntensity; uniform vec3 uColor; varying vec2 vUv;
    void main(){
      vec4 base = texture2D(tDiffuse, vUv);
      if (uIntensity <= 0.001) { gl_FragColor = base; return; }
      vec2 d = (uSun - vUv) / 48.0; vec2 p = vUv; float illum = 0.0; float decay = 1.0;
      for (int i = 0; i < 48; i++) { p += d; vec3 s = texture2D(tDiffuse, clamp(p, 0.0, 1.0)).rgb; float l = min(max(dot(s, vec3(0.299,0.587,0.114)) - 1.2, 0.0), 1.5); illum += l * decay; decay *= 0.965; }
      float fall = smoothstep(1.3, 0.0, length(uSun - vUv));
      gl_FragColor = vec4(base.rgb + uColor * illum * uIntensity * 0.007 * fall, base.a);
    }`,
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uFlash: { value: 0 }, uLowHp: { value: 0 }, uVig: { value: 0.32 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uHurt, uFlash, uLowHp, uVig; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p + uTime, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // gentle filmic grade: lift shadows toward teal, warm highlights
      float l = dot(c, vec3(0.299,0.587,0.114));
      c = mix(c, c*vec3(0.92,1.0,1.06), (1.0-l)*0.25);
      c = mix(c, c*vec3(1.05,1.0,0.94), l*0.2);
      c = mix(vec3(l), c, 1.08 - uLowHp*0.7);
      vec2 q = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(q*vec2(1.0,1.15)));
      c *= mix(1.0 - uVig, 1.0, v);
      c = mix(c, vec3(0.6,0.0,0.0), (1.0-v)*uHurt*0.75);
      c += uFlash * vec3(0.75,0.82,1.0);
      c += (rnd(vUv) - 0.5) * 0.018;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Post {
  composer: EffectComposer | null = null;
  bloom?: UnrealBloomPass;
  gtao?: GTAOPass;
  godrays?: ShaderPass;
  grade?: ShaderPass;
  enabled = false;
  constructor(public renderer: THREE.WebGLRenderer, public scene: THREE.Scene, public camera: THREE.PerspectiveCamera) {}

  configure(q: QualityPreset, w: number, h: number) {
    this.composer?.dispose();
    this.composer = null;
    this.enabled = q.bloom || q.ao || q.godrays || q.smaa;
    if (!this.enabled) return;
    const c = new EffectComposer(this.renderer);
    c.setPixelRatio(this.renderer.getPixelRatio());
    c.setSize(w, h);
    c.addPass(new RenderPass(this.scene, this.camera));
    if (q.ao) {
      this.gtao = new GTAOPass(this.scene, this.camera, w, h);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.6, thickness: 1.2, scale: 1, samples: 12 });
      c.addPass(this.gtao);
    } else this.gtao = undefined;
    if (q.godrays) { this.godrays = new ShaderPass(GodRaysShader); c.addPass(this.godrays); } else this.godrays = undefined;
    if (q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.42, 0.5, 1.6); c.addPass(this.bloom); } else this.bloom = undefined;
    c.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    c.addPass(this.grade);
    if (q.smaa) c.addPass(new SMAAPass(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio()));
    this.composer = c;
  }
  setSize(w: number, h: number) { this.composer?.setSize(w, h); this.gtao?.setSize(w, h); }
  render(dt: number, o: { sunScreen: THREE.Vector3; sunUp: number; hurt: number; flash: number; lowHp: number; time: number }) {
    if (!this.composer) { this.renderer.render(this.scene, this.camera); return; }
    if (this.godrays) {
      const s = o.sunScreen;
      const vis = s.z < 1 && Math.abs(s.x) < 1.6 && Math.abs(s.y) < 1.6 ? 1 : 0;
      this.godrays.uniforms.uSun.value.set(s.x * 0.5 + 0.5, s.y * 0.5 + 0.5);
      this.godrays.uniforms.uIntensity.value = vis * o.sunUp;
    }
    if (this.grade) {
      const u = this.grade.uniforms;
      u.uTime.value = o.time % 100; u.uHurt.value = o.hurt; u.uFlash.value = o.flash; u.uLowHp.value = o.lowHp;
    }
    this.composer.render(dt);
  }
}
