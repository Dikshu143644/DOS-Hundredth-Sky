import * as THREE from 'three';
import { WATER_LEVEL, LAKE, heightAt } from '../../shared/world';

/** Lake Mirrorveil: procedural normals, Fresnel sky reflection, sun glint, depth-based colour
 *  and shoreline foam (depth baked per vertex from the shared terrain function), rain ripples. */
export class Water {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene, env: { sunDir: THREE.Vector3; horizon: THREE.Color; fog: THREE.FogExp2 }) {
    const R = LAKE.r * 1.6;
    const geo = new THREE.CircleGeometry(R, 96, 0, Math.PI * 2).rotateX(-Math.PI / 2);
    // densify for depth attribute
    const g2 = new THREE.PlaneGeometry(R * 2, R * 2, 90, 90).rotateX(-Math.PI / 2);
    const p = g2.attributes.position as THREE.BufferAttribute;
    const depth = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) depth[i] = WATER_LEVEL - heightAt(p.getX(i) + LAKE.x, p.getZ(i) + LAKE.z);
    g2.setAttribute('depth', new THREE.BufferAttribute(depth, 1));
    geo.dispose();
    this.mat = new THREE.ShaderMaterial({
      transparent: true, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uSun: { value: env.sunDir }, uSky: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color(1, 0.9, 0.7) }, uRain: { value: 0 }, uNight: { value: 0 },
      }]),
      vertexShader: `
        attribute float depth; varying float vDepth; varying vec3 vW;
        #include <fog_pars_vertex>
        void main(){ vDepth = depth; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vec4 mvPosition = viewMatrix*w; gl_Position = projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float uTime, uRain, uNight; uniform vec3 uSun, uSky, uSunCol; varying float vDepth; varying vec3 vW;
        #include <fog_pars_fragment>
        float hsh(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1)))*43758.5453); }
        vec2 wave(vec2 p, float t){
          vec2 g = vec2(0.0);
          g += vec2(cos(p.x*0.9 + t*1.1), cos(p.y*0.7 - t*0.9))*0.08;
          g += vec2(cos(dot(p, vec2(1.7,1.1)) + t*1.7), cos(dot(p, vec2(-1.3,1.9)) + t*1.4))*0.05;
          g += vec2(cos(dot(p, vec2(3.1,-2.3)) + t*2.6), cos(dot(p, vec2(2.7,3.3)) - t*2.2))*0.025;
          return g;
        }
        void main(){
          if (vDepth < -0.05) discard;
          vec2 g = wave(vW.xz, uTime);
          // rain ripples: expanding rings on a grid
          if (uRain > 0.01) {
            vec2 c = floor(vW.xz*1.3); vec2 f = fract(vW.xz*1.3) - 0.5;
            float ph = fract(uTime*0.9 + hsh(c));
            float r = length(f - (vec2(hsh(c+1.7), hsh(c+5.1))-0.5)*0.5);
            float ring = sin((r - ph*0.6)*40.0) * smoothstep(0.6, 0.0, ph) * smoothstep(0.3, 0.0, abs(r - ph*0.5));
            g += normalize(f + 1e-4) * ring * 0.18 * uRain;
          }
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 v = normalize(cameraPosition - vW);
          float fres = 0.02 + 0.98*pow(1.0 - max(dot(n, v), 0.0), 5.0);
          vec3 r = reflect(-v, n);
          vec3 sky = mix(uSky*0.9, uSky*1.25 + vec3(0.04,0.08,0.16)*(1.0-uNight), clamp(r.y*2.0, 0.0, 1.0));
          float spec = pow(max(dot(r, normalize(uSun)), 0.0), 380.0) * 8.0 * (1.0-uNight*0.85) * (1.0-uRain*0.7);
          vec3 deep = mix(vec3(0.01,0.06,0.07), vec3(0.004,0.012,0.025), uNight);
          vec3 shallow = mix(vec3(0.06,0.24,0.22), vec3(0.01,0.03,0.05), uNight);
          vec3 body = mix(shallow, deep, smoothstep(0.0, 3.5, vDepth));
          vec3 col = mix(body, sky, fres) + uSunCol*spec;
          float foam = smoothstep(0.35, 0.0, vDepth) * (0.6 + 0.4*sin(uTime*1.6 + vW.x*0.7 + vW.z*0.5));
          col = mix(col, vec3(0.85,0.9,0.92)*(1.0-uNight*0.8), foam*0.55);
          float alpha = clamp(0.55 + fres*0.4 + smoothstep(0.0, 2.0, vDepth)*0.35, 0.0, 0.97);
          alpha *= smoothstep(-0.05, 0.12, vDepth);
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g2, this.mat);
    this.mesh.position.set(LAKE.x, WATER_LEVEL, LAKE.z);
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  update(t: number, env: { horizon: THREE.Color; night: number; sun: THREE.DirectionalLight }, rain: number) {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uSky.value.copy(env.horizon);
    u.uRain.value = rain;
    u.uNight.value = env.night;
    u.uSunCol.value.copy(env.sun.color);
  }
}
