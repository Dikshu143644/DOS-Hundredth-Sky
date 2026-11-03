import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildZone, TREE_TYPES, heightAt } from '../../shared/world';
import { loadGLTF, tex, texturesLoaded } from './assets';
import { HMAP, Terrain } from './terrain';

export const wind = { uTime: { value: 0 }, uWind: { value: 1 } };

function addWind(mat: THREE.Material, strength: number, leaves: boolean) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.uTime = wind.uTime; sh.uniforms.uWind = wind.uWind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;').replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float h = max(position.y, 0.0);
        float ph = ip.x*0.21 + ip.z*0.17;
        float sway = (sin(uTime*1.3 + ph) * 0.6 + sin(uTime*2.9 + ph*1.7)*0.25) * uWind;
        transformed.x += sway * ${strength.toFixed(3)} * h * h * 0.04;
        transformed.z += cos(uTime*1.1 + ph) * ${strength.toFixed(3)} * h * h * 0.02 * uWind;
        ${leaves ? 'transformed += normal * sin(uTime*6.0 + position.x*3.0 + position.z*2.0 + ph) * 0.03 * uWind;' : ''}
      }`);
  };
}

interface Part { geo: THREE.BufferGeometry; mat: THREE.Material }
async function loadParts(model: string, dir = 'nature'): Promise<{ parts: Part[]; box: THREE.Box3 }> {
  const g = await loadGLTF(`models/${dir}/${model}.glb`);
  const byMat = new Map<string, THREE.BufferGeometry[]>();
  g.scene.updateMatrixWorld(true);
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    const name = (m.material as THREE.Material).name;
    if (!byMat.has(name)) byMat.set(name, []);
    byMat.get(name)!.push(geo.index ? geo : geo);
  });
  const parts: Part[] = [];
  const box = new THREE.Box3();
  for (const [name, geos] of byMat) {
    const geo = geos.length > 1 ? mergeGeometries(geos.map((x) => (x.index ? x : x)), false)! : geos[0];
    geo.computeBoundingBox(); box.union(geo.boundingBox!);
    parts.push({ geo, mat: makeMat(name) });
  }
  return { parts, box };
}

const matCache = new Map<string, THREE.Material>();
function makeMat(name: string): THREE.Material {
  let m = matCache.get(name);
  if (m) return m;
  if (/Leaves/.test(name)) {
    const t = tex(`tex/q_${name}.png`);
    m = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.82, color: /Pine/.test(name) ? 0xd8e8d0 : 0xffffff });
    addWind(m, 0.55, true);
  } else if (/Bark/.test(name)) {
    m = new THREE.MeshStandardMaterial({ map: tex(`tex/q_${name}.jpg`), roughness: 0.95 });
    addWind(m, 0.15, false);
  } else if (/Rock/.test(name)) {
    m = new THREE.MeshStandardMaterial({ map: tex('tex/q_Rocks.webp'), roughness: 0.9, color: 0xc8c4bc });
  } else if (/Flowers/.test(name)) {
    m = new THREE.MeshStandardMaterial({ map: tex('tex/q_Flowers.webp'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 });
    addWind(m, 0.8, true);
  } else if (/Grass/.test(name)) {
    m = new THREE.MeshStandardMaterial({ map: tex('tex/q_Grass.webp'), side: THREE.DoubleSide, roughness: 0.85 });
    addWind(m, 1, false);
  } else m = new THREE.MeshStandardMaterial({ color: 0x777777 });
  m.name = name;
  matCache.set(name, m);
  return m;
}

interface TreeKind { near: THREE.InstancedMesh[]; far: THREE.InstancedMesh; list: { x: number; y: number; z: number; s: number; rot: number }[]; h: number; w: number }

/** Trees with distance LOD (full mesh near → baked impostor billboards far), instanced rocks & bushes,
 *  and a GPU grass field that follows the camera, reads terrain height from a texture, and sways in the wind. */
export class Foliage {
  kinds: TreeKind[] = [];
  grass: THREE.InstancedMesh | null = null;
  grassMat: THREE.MeshStandardMaterial | null = null;
  private lastUpdate = -1;
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4();
  group = new THREE.Group();

  constructor(public scene: THREE.Scene) { scene.add(this.group); }

  async build(renderer: THREE.WebGLRenderer, q: { grass: number; treeNear: number; treeFar: number; shadows: boolean }, terrain: Terrain, lowSpec: boolean) {
    const zone = buildZone();
    const kinds = await Promise.all(TREE_TYPES.map((t) => loadParts(t)));
    await texturesLoaded();
    for (let k = 0; k < TREE_TYPES.length; k++) {
      const { parts, box } = kinds[k];
      const list = zone.trees.filter((t, i) => t.type === k && (!lowSpec || i % 2 === 0)).map((t) => ({ x: t.x, y: heightAt(t.x, t.z) - 0.15, z: t.z, s: t.s, rot: t.rot }));
      const near = parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geo, p.mat, Math.max(1, list.length));
        im.castShadow = q.shadows; im.receiveShadow = true; im.count = 0; im.frustumCulled = false;
        this.group.add(im);
        return im;
      });
      const size = box.getSize(new THREE.Vector3());
      const w = Math.max(size.x, size.z) * 1.05, h = size.y * 1.02;
      const imp = this.bakeImpostor(renderer, parts, box, w, h);
      const pg = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
      const far = new THREE.InstancedMesh(pg, imp, Math.max(1, list.length));
      far.count = 0; far.frustumCulled = false;
      this.group.add(far);
      this.kinds.push({ near, far, list, h, w });
    }
    // rocks + bushes: all instanced, static
    const groups = new Map<string, typeof zone.rocks>();
    for (const r of [...zone.rocks, ...zone.bushes]) { if (!groups.has(r.model)) groups.set(r.model, []); groups.get(r.model)!.push(r); }
    for (const [model, items] of groups) {
      const { parts } = await loadParts(model);
      const use = lowSpec ? items.filter((_, i) => i % 2 === 0) : items;
      for (const p of parts) {
        const im = new THREE.InstancedMesh(p.geo, p.mat, use.length);
        use.forEach((it, i) => { this.m4.compose(new THREE.Vector3(it.x, heightAt(it.x, it.z) - (model.startsWith('Rock') ? 0.25 * it.s : 0.05), it.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot), new THREE.Vector3(it.s, it.s, it.s)); im.setMatrixAt(i, this.m4); });
        im.castShadow = q.shadows && model.startsWith('Rock'); im.receiveShadow = true;
        im.computeBoundingSphere();
        this.group.add(im);
      }
    }
    if (q.grass > 0) this.buildGrass(q.grass, terrain);
  }

  private bakeImpostor(renderer: THREE.WebGLRenderer, parts: Part[], box: THREE.Box3, w: number, h: number): THREE.Material {
    const rt = new THREE.WebGLRenderTarget(256, 512, { samples: 4 });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    const sc = new THREE.Scene();
    const amb = new THREE.HemisphereLight(0xffffff, 0x445533, 2.2);
    const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(0.4, 1, 0.8);
    sc.add(amb, dl);
    for (const p of parts) {
      const mat = (p.mat as THREE.MeshStandardMaterial).clone();
      mat.onBeforeCompile = () => {}; // no wind in the bake
      sc.add(new THREE.Mesh(p.geo, mat));
    }
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h, 0, -100, 100);
    cam.position.set(cx, box.min.y, cz + 10); cam.lookAt(cx, box.min.y, cz);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearAlpha();
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(sc, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevClear);
    renderer.toneMapping = prevTone;
    const mat = new THREE.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide, color: 0xd4dccf });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
        vec3 ipos = instanceMatrix[3].xyz; float isc = length(instanceMatrix[0].xyz);
        vec3 camR = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
        vec3 wp = ipos + camR * position.x * ${w.toFixed(3)} * isc + vec3(0.0, position.y * ${h.toFixed(3)} * isc, 0.0);
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      `).replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\ntransformedNormal = normalize((viewMatrix * vec4(0.0, 0.6, 0.0, 0.0)).xyz + vec3(0.0,0.0,0.8));');
    };
    return mat;
  }

  private buildGrass(count: number, terrain: Terrain) {
    // phase 3: a fine clump of 13 thin tapered blades, each with its own green-to-straw colour
    // (dark rooted base, sun-bleached tips), closer to the meadows in the references
    const blades: THREE.BufferGeometry[] = [];
    const rr = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    for (let b = 0; b < 13; b++) {
      const hgt = 0.3 + rr() * 0.32, wid = 0.028 + rr() * 0.018;
      const g = new THREE.PlaneGeometry(wid, hgt, 1, 4);
      const p = g.attributes.position as THREE.BufferAttribute;
      const col = new Float32Array(p.count * 3);
      const tip = new THREE.Color().setHSL(0.14 + rr() * 0.08, 0.45 + rr() * 0.2, 0.36 + rr() * 0.12);
      const root = new THREE.Color().setHSL(0.22 + rr() * 0.05, 0.45, 0.10 + rr() * 0.06);
      const lean = 0.06 + rr() * 0.14;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) + hgt / 2, t = y / hgt;
        p.setX(i, p.getX(i) * (1 - t * 0.92));
        p.setY(i, y);
        p.setZ(i, t * t * lean);
        const c = root.clone().lerp(new THREE.Color().setHSL(0.22 + rr() * 0.04, 0.42, 0.22), Math.min(1, t * 1.6)).lerp(tip, Math.max(0, t - 0.45) * 1.6);
        col.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.rotateY(rr() * Math.PI * 2);
      g.translate((rr() - 0.5) * 0.3, 0, (rr() - 0.5) * 0.3);
      blades.push(g);
    }
    const geo = mergeGeometries(blades)!;
    const n = geo.attributes.position.count, nrm = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) nrm.set([0, 1, 0], i * 3);
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    const T = Math.sqrt(count) * 0.36; // tile size → ~0.18 m² per clump
    const off = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) off.set([Math.random() * T, Math.random() * T, Math.random(), Math.random() * Math.PI * 2], i * 4);
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
    const u = { uH: { value: terrain.heightTex }, uCam: { value: new THREE.Vector3() }, uT: { value: T }, uHalf: { value: HMAP.half }, uN: { value: HMAP.size } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u, wind);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
        attribute vec4 aOff; uniform sampler2D uH; uniform vec3 uCam; uniform float uT, uHalf, uN, uTime, uWind; varying float vFade;
        vec2 hs(vec2 w){ vec2 uv = (w + uHalf) / (2.0*uHalf) * (uN - 1.0); vec2 i = floor(uv); vec2 f = uv - i; ivec2 ii = ivec2(clamp(i, vec2(0.0), vec2(uN-2.0)));
          vec2 a = texelFetch(uH, ii, 0).rg, b = texelFetch(uH, ii+ivec2(1,0), 0).rg, c = texelFetch(uH, ii+ivec2(0,1), 0).rg, d = texelFetch(uH, ii+ivec2(1,1), 0).rg;
          return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }`)
        .replace('#include <begin_vertex>', `
          vec2 base = aOff.xy + floor((uCam.xz - aOff.xy) / uT + 0.5) * uT;
          vec2 hd = hs(base);
          float dist = length(base - uCam.xz);
          vFade = smoothstep(uT*0.5, uT*0.32, dist);
          float keep = step(aOff.z, hd.y) * vFade;
          float c = cos(aOff.w), s = sin(aOff.w);
          vec3 transformed = vec3(c*position.x - s*position.z, position.y, s*position.x + c*position.z) * (0.75 + aOff.z*0.6) * keep;
          float bend = transformed.y * transformed.y;
          float ph = base.x*0.15 + base.y*0.11;
          transformed.x += (sin(uTime*1.8 + ph) * 0.35 + sin(uTime*3.7 + ph*2.3)*0.12) * bend * uWind;
          transformed.z += cos(uTime*1.4 + ph) * 0.2 * bend * uWind;
          transformed += vec3(base.x, hd.x - 0.02, base.y);
        `);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade;').replace('#include <normal_fragment_begin>', 'vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;');
    };
    this.grassMat = mat;
    (mat as any).__u = u;
    this.grass = new THREE.InstancedMesh(geo, mat, count);
    this.grass.frustumCulled = false;
    this.grass.receiveShadow = true;
    this.scene.add(this.grass);
  }

  update(camera: THREE.PerspectiveCamera, focus: THREE.Vector3, t: number, q: { treeNear: number; treeFar: number }) {
    wind.uTime.value = t;
    if (this.grassMat) (this.grassMat as any).__u.uCam.value.copy(focus);
    if (t - this.lastUpdate < 0.2) return;
    this.lastUpdate = t;
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const sphere = new THREE.Sphere();
    const q4 = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const k of this.kinds) {
      let nn = 0, nf = 0;
      for (const tr of k.list) {
        const d = Math.hypot(tr.x - camera.position.x, tr.z - camera.position.z);
        if (d > q.treeFar) continue;
        sphere.center.set(tr.x, tr.y + k.h * tr.s * 0.5, tr.z); sphere.radius = k.h * tr.s * 0.7;
        if (!this.frustum.intersectsSphere(sphere)) continue;
        pv.set(tr.x, tr.y, tr.z); sv.setScalar(tr.s);
        if (d < q.treeNear) {
          q4.setFromAxisAngle(up, tr.rot);
          this.m4.compose(pv, q4, sv);
          for (const im of k.near) im.setMatrixAt(nn, this.m4);
          nn++;
        } else {
          this.m4.compose(pv, q4.identity(), sv);
          k.far.setMatrixAt(nf++, this.m4);
        }
      }
      for (const im of k.near) { im.count = nn; im.instanceMatrix.needsUpdate = true; }
      k.far.count = nf; k.far.instanceMatrix.needsUpdate = true;
    }
  }
}
