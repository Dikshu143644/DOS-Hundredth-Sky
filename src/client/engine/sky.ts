import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { clamp, smoothstep } from '../../shared/rng';

/** Sky, sun/moon, stars, clouds, fog and ambient — all driven by the world clock and weather. */
export class Environment {
  sky = new Sky();
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3020, 0.8);
  sunDir = new THREE.Vector3(0.3, 0.8, 0.2).normalize();
  moonDir = new THREE.Vector3();
  stars: THREE.Points;
  moon: THREE.Sprite;
  clouds: THREE.Mesh;
  cloudMat: THREE.ShaderMaterial;
  fog: THREE.FogExp2;
  night = 0;          // 0 day … 1 night
  overcast = 0;       // 0 clear … 1 storm (smoothed)
  regionFog = new THREE.Color(0x9fb4c8);
  regionMix = 0;
  regionDensity = 1;
  fogBoost = 1;
  setRegion(fog: number, density: number, mix: number) { this.regionFog.set(fog); this.regionDensity = density; this.regionMix = mix; }
  targetOvercast = 0;
  horizon = new THREE.Color();
  sunScreen = new THREE.Vector3();
  cinematicSun: THREE.Vector3 | null = null;
  lightning = 0;
  private skyNight: { value: number };
  private time = 0;

  constructor(public scene: THREE.Scene, quality: { clouds: boolean; drawDist: number }) {
    this.sky.scale.setScalar(9000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.86;
    this.skyNight = { value: 0 };
    const sm = this.sky.material as THREE.ShaderMaterial;
    sm.uniforms.uNight = this.skyNight;
    sm.fragmentShader = sm.fragmentShader.replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float uNight;').replace(
      '#include <tonemapping_fragment>',
      `gl_FragColor.rgb *= 0.42;
       gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(vec3(0.018,0.03,0.07), vec3(0.05,0.08,0.15), pow(1.0-max(direction.y,0.0),4.0)), uNight);
       #include <tonemapping_fragment>`);
    scene.add(this.sky);

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);

    // stars
    const n = 2500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u1 = Math.random(), v1 = Math.random() * 0.95 + 0.05;
      const th = u1 * Math.PI * 2, ph = Math.acos(1 - v1);
      pos.set([Math.sin(ph) * Math.cos(th) * 7000, Math.cos(ph) * 7000, Math.sin(ph) * Math.sin(th) * 7000], i * 3);
      const c = 0.6 + Math.random() * 0.4, tint = Math.random();
      col.set([c * (tint > 0.8 ? 1 : 0.85), c * 0.9, c * (tint < 0.2 ? 0.8 : 1)], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.renderOrder = -1;
    scene.add(this.stars);

    // moon
    const mc = document.createElement('canvas'); mc.width = mc.height = 128;
    const g = mc.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,245,1)'); gr.addColorStop(0.28, 'rgba(235,240,255,0.95)'); gr.addColorStop(0.33, 'rgba(180,200,255,0.35)'); gr.addColorStop(1, 'rgba(120,150,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(mc), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.moon.scale.setScalar(700);
    scene.add(this.moon);

    // cloud layer (procedural fbm, lit by the sun, pierced by the Tower)
    this.cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uSun: { value: this.sunDir }, uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() }, uCover: { value: 0.45 }, uCam: { value: new THREE.Vector3() }, uLightning: { value: 0 } },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `
        uniform float uTime, uCover, uLightning; uniform vec3 uSun, uSunCol, uAmb, uCam; varying vec3 vW;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
        void main(){
          vec2 p = vW.xz*0.00042 + vec2(uTime*0.004, uTime*0.0017);
          float d = fbm(p) ;
          float d2 = fbm(p*2.7 - vec2(uTime*0.006,0.0));
          float dens = smoothstep(1.0-uCover-0.12, 1.0-uCover+0.35, d*0.75+d2*0.35);
          // thickness toward the sun gives silver lining
          float thick = fbm(p + uSun.xz*0.03);
          float light = clamp(1.0 - (thick - d)*3.0, 0.0, 1.0);
          vec3 col = mix(uAmb*0.75, uSunCol*1.15 + uAmb*0.3, light*0.8 + 0.2);
          col += vec3(0.8,0.85,1.0)*uLightning*dens;
          float dist = length(vW.xz - uCam.xz);
          float fade = smoothstep(9000.0, 3000.0, dist) * smoothstep(0.0, 600.0, dist + 200.0);
          gl_FragColor = vec4(col, dens*0.92*fade);
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000, 1, 1).rotateX(-Math.PI / 2), this.cloudMat);
    this.clouds.position.y = 640;
    this.clouds.renderOrder = 1;
    this.clouds.visible = quality.clouds;
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    this.fog = new THREE.FogExp2(0xaabbcc, 0.0018);
    scene.fog = this.fog;
  }

  /** time in hours [0,24) */
  update(hours: number, weather: string, camera: THREE.Camera, dt: number, focus: THREE.Vector3, shadowRange: number) {
    this.time += dt;
    this.targetOvercast = ({ storm: 1, blizzard: 0.95, rain: 0.7, snow: 0.55, ash: 0.65, sandstorm: 0.45, fog: 0.4 } as Record<string, number>)[weather] ?? 0;
    const fogBoost = ({ fog: 3.2, sandstorm: 4.5, blizzard: 4, ash: 1.6, snow: 1.4 } as Record<string, number>)[weather] ?? 1;
    this.fogBoost += (fogBoost - this.fogBoost) * Math.min(1, dt * 0.3);
    this.overcast += (this.targetOvercast - this.overcast) * Math.min(1, dt * 0.25);
    const ang = ((hours - 6) / 12) * Math.PI;
    const elev = Math.sin(ang);
    this.sunDir.set(Math.cos(ang) * 0.82, elev, 0.42 - 0.2 * Math.cos(ang)).normalize();
    if (this.cinematicSun) this.sunDir.copy(this.cinematicSun);
    const e = this.sunDir.y;
    this.night = 1 - smoothstep(-0.12, 0.08, e);
    // phase 3 art direction (Omkar's title-menu reference): the whole world keeps a warm golden
    // bias by day, deepening into a full golden hour as the sun drops
    const golden = Math.max(smoothstep(0.35, 0.02, e), 0.42) * (1 - this.night);
    const oc = this.overcast;

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = 2.4 + oc * 12 + golden * 1.6;
    u.rayleigh.value = 1.2 + golden * 1.6 - oc * 0.8;
    u.mieCoefficient.value = 0.004 + oc * 0.02;
    this.skyNight.value = Math.max(this.night * 0.92, oc * 0.55);

    // sun / moon light
    this.moonDir.set(-this.sunDir.x, Math.max(0.25, -this.sunDir.y), -this.sunDir.z * 0.6 - 0.3).normalize();
    const lightDir = this.night > 0.5 ? this.moonDir : this.sunDir;
    const sunCol = new THREE.Color().setHSL(0.09 - golden * 0.04, 0.55 + golden * 0.35, 0.62 + (1 - golden) * 0.3);
    const moonCol = new THREE.Color(0x9fb7ff);
    const col = this.night > 0.5 ? moonCol : sunCol;
    const dayI = (2.9 + golden * 0.6) * smoothstep(-0.05, 0.12, e);
    const nightI = 0.42 * smoothstep(0.4, 1.0, this.night);
    this.sun.color.copy(col);
    this.sun.intensity = (this.night > 0.5 ? nightI : dayI) * (1 - oc * 0.72) + this.lightning * 6;
    this.sun.position.copy(focus).addScaledVector(lightDir, 120);
    this.sun.target.position.copy(focus);
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    if (cam.right !== shadowRange) { cam.left = -shadowRange; cam.right = shadowRange; cam.top = shadowRange; cam.bottom = -shadowRange; cam.near = 1; cam.far = 320; cam.updateProjectionMatrix(); }
    // stabilise shadow map (snap to texel grid → no shimmering)
    const texel = (shadowRange * 2) / this.sun.shadow.mapSize.x;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.position.copy(this.sun.target.position).addScaledVector(lightDir, 120);

    const skyTop = new THREE.Color(0x7f9fd0).lerp(new THREE.Color(0xffd9b0), golden * 0.35).lerp(new THREE.Color(0x0b1430), this.night).lerp(new THREE.Color(0x56606c), oc * 0.8);
    const ground = new THREE.Color(0x5a4630).lerp(new THREE.Color(0x0c1018), this.night);
    this.hemi.color.copy(skyTop);
    this.hemi.groundColor.copy(ground);
    this.hemi.intensity = (0.95 + golden * 0.35 - this.night * 0.6) * (1 + oc * 0.3) + this.lightning * 2;

    // horizon / fog colour
    this.horizon.setRGB(0.72, 0.74, 0.80).lerp(new THREE.Color(1.0, 0.70, 0.46), golden * 0.85).lerp(new THREE.Color(0.035, 0.05, 0.1), this.night).lerp(new THREE.Color(0.42, 0.46, 0.5).multiplyScalar(1 - this.night * 0.8), oc * 0.85);
    // Phase 4: each region tints its air (forest green haze, desert gold, frozen white, forbidden violet)
    this.horizon.lerp(this.regionFog.clone().multiplyScalar(1 - this.night * 0.85), this.regionMix);
    this.fog.color.copy(this.horizon);
    this.fog.density = (0.0009 + oc * 0.0042 + this.night * 0.0006) * this.regionDensity * this.fogBoost;

    (this.stars.material as THREE.PointsMaterial).opacity = this.night * (1 - oc);
    this.stars.position.copy(camera.position);
    this.stars.rotation.y = this.time * 0.002;
    this.moon.position.copy(camera.position).addScaledVector(this.moonDir, 5000);
    (this.moon.material as THREE.SpriteMaterial).opacity = this.night * (1 - oc * 0.9);
    this.sky.position.copy(camera.position);

    const cu = this.cloudMat.uniforms;
    cu.uTime.value = this.time;
    cu.uSunCol.value.copy(this.night > 0.5 ? new THREE.Color(0x3a4a70) : sunCol).multiplyScalar(this.night > 0.5 ? 0.6 : 1 - oc * 0.5);
    cu.uAmb.value.copy(this.horizon);
    cu.uCover.value = 0.42 + oc * 0.5;
    cu.uCam.value.copy(camera.position);
    cu.uLightning.value = this.lightning;
    this.clouds.position.x = camera.position.x;
    this.clouds.position.z = camera.position.z;
    this.lightning = Math.max(0, this.lightning - dt * 4);

    this.sunScreen.copy(camera.position).addScaledVector(this.sunDir, 4000).project(camera);
  }
}
