import * as THREE from 'three';
import { heightAt, cityMask, distToRoad, WATER_LEVEL, LAKE, REGION } from '../../shared/world';
import { fbm, smoothstep } from '../../shared/rng';
import { tex } from './assets';

export const HMAP = { size: 512, half: 320 }; // height texture covers [-320, 320]

/** PBR terrain: 4 splatted texture layers (meadow, forest floor, cliff rock, cobblestone) with
 *  normal maps, triplanar rock on cliffs, wetness from rain, and a far ring out to the horizon. */
export class Terrain {
  mesh: THREE.Mesh;
  far: THREE.Mesh;
  heightTex: THREE.DataTexture;
  uniforms = { uWet: { value: 0 } };

  constructor(scene: THREE.Scene, segments: number) {
    const half = HMAP.half;
    const geo = new THREE.PlaneGeometry(half * 2, half * 2, segments, segments).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const splat = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, heightAt(x, z));
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i), ny = nrm.getY(i);
      const city = cityMask(x, z);
      const road = 1 - smoothstep(2.5, 6.5, distToRoad(x, z));
      const rock = smoothstep(0.86, 0.68, ny) + smoothstep(35, 70, y) * 0.6;
      const forestN = 0.5 + 0.5 * fbm(x / 28, z / 28, 3, 77) + smoothstep(-40, 100, z) * 0.3;
      const shore = 1 - smoothstep(WATER_LEVEL + 0.2, WATER_LEVEL + 1.6, y);
      let wCob = Math.max(city > 0.6 ? 1 : 0, 0) ;
      let wRock = Math.min(1, rock + shore * 0.5) * (1 - wCob);
      let wForest = Math.min(1, Math.max(road * 1.2, smoothstep(0.55, 0.8, forestN))) * (1 - wRock) * (1 - wCob);
      let wGrass = Math.max(0, 1 - wForest - wRock - wCob);
      const s = wGrass + wForest + wRock + wCob || 1;
      splat.set([wGrass / s, wForest / s, wRock / s, wCob / s], i * 4);
    }
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));

    const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    const L = REGION.layers; // phase 4: each region picks its 4 ground layers + tints
    const cols = L.map((l) => tex(`tex/${l}_col.jpg`));
    const nors = L.map((l) => tex(`tex/${l}_nor.jpg`, { srgb: false }));
    const uni: Record<string, { value: unknown }> = { uWet: this.uniforms.uWet };
    L.forEach((l, i) => { uni['tC' + i] = { value: cols[i] }; uni['tN' + i] = { value: nors[i] }; uni['uK' + i] = { value: new THREE.Color(REGION.tints[i]).multiplyScalar(REGION.id === 'desert' ? 1.45 : REGION.id === 'frozen' ? 1.15 : 1) }; });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splat; varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNrm;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = splat; vWPos = (modelMatrix*vec4(transformed,1.0)).xyz; vWNrm = normalize(mat3(modelMatrix)*objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNrm; uniform float uWet;
          uniform sampler2D tC0, tC1, tC2, tC3, tN0, tN1, tN2, tN3; uniform vec3 uK0, uK1, uK2, uK3;
          float tHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
          float tNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(tHash(i),tHash(i+vec2(1,0)),f.x), mix(tHash(i+vec2(0,1)),tHash(i+vec2(1,1)),f.x), f.y); }
          vec3 triRock(sampler2D t, vec3 p, vec3 n){ vec3 b = pow(abs(n), vec3(4.0)); b/= (b.x+b.y+b.z); return texture2D(t, p.zy*0.11).rgb*b.x + texture2D(t, p.xz*0.11).rgb*b.y + texture2D(t, p.xy*0.11).rgb*b.z; }
          vec4 splatW(){ vec4 w = vSplat; float n = tNoise(vWPos.xz*0.35)*0.5 + tNoise(vWPos.xz*0.06); w = max(w + (n-0.7)*0.35*w, 0.0); w = pow(w, vec4(2.2)); return w / max(dot(w, vec4(1.0)), 1e-4); }
        `)
        .replace('#include <map_fragment>', `
          vec4 sw = splatW();
          vec2 uvA = vWPos.xz * 0.16; vec2 uvB = vWPos.xz * 0.043 + 0.37;
          vec3 cG = mix(texture2D(tC0, uvA).rgb, texture2D(tC0, uvB).rgb, 0.45);
          vec3 cF = mix(texture2D(tC1, uvA*1.2).rgb, texture2D(tC1, uvB).rgb, 0.35);
          vec3 cR = triRock(tC2, vWPos, vWNrm);
          vec3 cC = texture2D(tC3, vWPos.xz*0.22).rgb;
          vec3 albedo = cG*uK0*sw.x + cF*uK1*sw.y + cR*uK2*sw.z + cC*uK3*sw.w;
          albedo *= mix(0.82, 1.08, tNoise(vWPos.xz*0.02));
          albedo *= mix(1.0, 0.62, uWet * (1.0 - sw.z*0.5));
          diffuseColor.rgb *= albedo;
        `)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(dot(sw, vec4(0.95, 0.9, 0.78, 0.7)), 0.28, uWet*0.85);`)
        .replace('#include <normal_fragment_maps>', `
          {
            vec3 nG = texture2D(tN0, uvA).xyz*2.0-1.0; vec3 nF = texture2D(tN1, uvA*1.2).xyz*2.0-1.0; vec3 nR = texture2D(tN2, vWPos.xz*0.11).xyz*2.0-1.0; vec3 nC = texture2D(tN3, vWPos.xz*0.22).xyz*2.0-1.0;
            vec3 mapN = normalize(nG*sw.x + nF*sw.y + nR*sw.z + nC*sw.w);
            mapN.xy *= 0.9;
            vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
            vec2 st0 = dFdx(uvA), st1 = dFdy(uvA);
            vec3 N = normal; vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
            vec3 T = q1perp*st0.x + q0perp*st1.x; vec3 B = q1perp*st0.y + q0perp*st1.y;
            float det = max(dot(T,T), dot(B,B)); float sc = (det == 0.0) ? 0.0 : inversesqrt(det);
            normal = normalize(T*(mapN.x*sc) + B*(mapN.y*sc) + N*mapN.z);
          }
        `);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    scene.add(this.mesh);

    // far ring to the horizon (same height function, coarse polar grid)
    const rings = 48, segs = 160, r0 = half - 6, r1 = 5200;
    const fp: number[] = [], fi: number[] = [], fs: number[] = [];
    for (let j = 0; j <= rings; j++) {
      const t = j / rings, r = r0 + (r1 - r0) * Math.pow(t, 2.2);
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        // square-ish inner edge so it meets the inner grid
        const sq = j === 0 ? 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) : 1;
        const rr = j === 0 ? r0 * sq : Math.max(r, r0 * sq + (r - r0));
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        fp.push(x, heightAt(x, z) - (j === 0 ? 0.3 : 0), z);
        fs.push(0.55, 0.25, 0.2, 0);
      }
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i, b = a + segs + 1;
      fi.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fg.setAttribute('splat', new THREE.Float32BufferAttribute(fs, 4));
    fg.setIndex(fi);
    fg.computeVertexNormals();
    this.far = new THREE.Mesh(fg, mat);
    this.far.receiveShadow = false;
    scene.add(this.far);

    // height texture for GPU grass placement (R = height, G = grass density)
    const N = HMAP.size, data = new Float32Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -half + (i / (N - 1)) * half * 2, z = -half + (j / (N - 1)) * half * 2;
      const h = heightAt(x, z);
      const city = cityMask(x, z), road = distToRoad(x, z);
      const lake = Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 2 || h < WATER_LEVEL + 0.25;
      const slope = Math.abs(heightAt(x + 1, z) - h) + Math.abs(heightAt(x, z + 1) - h);
      const dens = lake || city > 0.4 || road < 3.2 || slope > 0.9 || h > 40 ? 0 : (0.55 + 0.45 * fbm(x / 22, z / 22, 2, 9)) * smoothstep(3.2, 6, road);
      data.set([h, dens, 0, 1], (j * N + i) * 4);
    }
    this.heightTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
    this.heightTex.magFilter = THREE.NearestFilter;
    this.heightTex.minFilter = THREE.NearestFilter;
    this.heightTex.needsUpdate = true;
  }
}
