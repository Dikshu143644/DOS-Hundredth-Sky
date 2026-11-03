import * as THREE from 'three';

/** Cloth cloak + folded hood for the realistic heroes (phase 3, matching the title-menu hero).
 *  The sheet is built in the hero's bind-pose space, parented to the upper-spine bone (so it
 *  follows the torso), and animated in the vertex shader: layered wind ripples that grow toward
 *  the hem, plus a "trail" term that lifts the hem behind a running hero. No physics cost. */
export interface CloakFX { group: THREE.Group; uniforms: { uTime: { value: number }; uWind: { value: number }; uTrail: { value: number } }; update: (dt: number, speed: number) => void }

let fabricNormal: THREE.Texture | null = null;
function fabricTex(): THREE.Texture {
  if (fabricNormal) return fabricNormal;
  // woven wool normal map: fine twill lines + soft noise (drawn once, 128 px, tiled)
  const n = 128, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d')!; const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const tw = Math.sin((x + y) * Math.PI * 2 / 4) * 0.5 + Math.sin(y * Math.PI * 2 / 8) * 0.2;
    const nz = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    const i = (y * n + x) * 4;
    img.data[i] = 128 + tw * 38 + nz * 10; img.data[i + 1] = 128 + Math.cos((x - y) * Math.PI * 2 / 4) * 30; img.data[i + 2] = 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 14); t.colorSpace = THREE.NoColorSpace;
  return (fabricNormal = t);
}

export function makeCloak(heroRoot: THREE.Object3D, o: { color?: number; lining?: number; length?: number; width?: number; hood?: boolean; trim?: number; litSide?: number; sweep?: number } = {}): CloakFX | null {
  let spine: THREE.Object3D | null = null, neck: THREE.Object3D | null = null, pelvis: THREE.Object3D | null = null;
  heroRoot.traverse((b) => { if (b.name === 'spine_03') spine = b; if (b.name === 'neck_01') neck = b; if (b.name === 'pelvis') pelvis = b; });
  if (!spine || !neck) return null;
  heroRoot.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(heroRoot.matrixWorld).invert();
  const local = (b: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv);
  const s = heroRoot.scale.x || 1;
  const nk = local(neck).divideScalar(s), sp = local(spine).divideScalar(s);
  const pv = pelvis ? local(pelvis).divideScalar(s) : sp.clone().setY(sp.y * 0.55);
  const top = nk.y + 0.0, len = o.length ?? Math.max(0.9, top - 0.14), backZ = Math.min(sp.z, pv.z) - 0.17;
  const W0 = 0.3, W1 = o.width ?? 0.8;
  const SU = 14, SV = 22;
  const geo = new THREE.PlaneGeometry(1, 1, SU, SV);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const hem = new Float32Array(pos.count);
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5, v = 0.5 - pos.getY(i); // u 0..1 across, v 0 (collar) .. 1 (hem)
    const w = W0 + (W1 - W0) * Math.pow(v, 0.7);
    // the top wraps forward over the shoulders, the lower cloth hangs flatter behind
    const a = (u - 0.5) * Math.PI * (1.18 - v * 0.42);
    const r = 0.13 + v * 0.1;
    const x = Math.sin(a) * w * 0.52;
    const z = backZ + (1 - Math.cos(a)) * r * 1.4 - v * v * 0.12;
    // vertical folds: soft pleats that deepen toward the hem
    const pleat = (Math.sin(u * Math.PI * 7 + Math.sin(u * 5.0) * 0.8) * 0.05 + Math.sin(u * Math.PI * 3 + 1.3) * 0.035) * (0.1 + v * 1.1);
    const hemCut = v > 0.97 ? Math.sin(u * 23.0) * 0.025 : 0;
    pos.setXYZ(i, x, top - v * len + hemCut, z - pleat);
    hem[i] = v;
    // baked fold occlusion: valleys of the pleats and the side wraps sit darker
    const pn = Math.sin(u * Math.PI * 7 + Math.sin(u * 5.0) * 0.8) * 0.6 + Math.sin(u * Math.PI * 3 + 1.3) * 0.4;
    const occ = 0.6 + 0.5 * (0.5 + 0.5 * pn) * (0.35 + v * 0.8) - Math.pow(Math.abs(u - 0.5) * 2, 3) * 0.18 - (1 - v) * 0.06;
    const sideLit = o.litSide === undefined ? 1 : 0.82 + 0.36 * (o.litSide > 0 ? u : 1 - u);
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = Math.max(0.42, Math.min(1.15, occ * sideLit));
  }
  geo.setAttribute('aHem', new THREE.BufferAttribute(hem, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const uniforms = { uTime: { value: 0 }, uWind: { value: 1 }, uTrail: { value: 0 }, uSweep: { value: o.sweep ?? 0 } };
  const mat = new THREE.MeshPhysicalMaterial({
    color: o.color ?? 0xe9dfca, roughness: 0.86, metalness: 0, side: THREE.DoubleSide, vertexColors: true,
    sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(o.color ?? 0xe9dfca).lerp(new THREE.Color(0xffffff), 0.5),
    normalMap: fabricTex(), normalScale: new THREE.Vector2(0.6, 0.6),
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHem; uniform float uTime, uWind, uTrail, uSweep;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float hk = pow(aHem, 1.5);
        float ph = position.x * 5.0 + aHem * 4.0;
        float wv = sin(uTime * 2.1 + ph) * 0.6 + sin(uTime * 3.7 + ph * 1.7) * 0.3 + sin(uTime * 1.3 - position.x * 2.0) * 0.5;
        transformed.z -= (0.05 + 0.10 * uWind) * hk * (0.6 + 0.4 * wv) + uTrail * hk * 0.55;
        transformed.y += uTrail * hk * 0.28;
        transformed.x += sin(uTime * 1.7 + aHem * 3.0) * 0.05 * uWind * hk;
        // steady side wind (title screen): the hem sweeps out to one side and billows
        transformed.x += uSweep * hk * (0.75 + 0.18 * wv) * (0.7 + 0.6 * (position.x + 0.4));
        transformed.z -= abs(uSweep) * hk * 0.25 * (0.8 + 0.2 * wv);
        transformed.y += abs(uSweep) * hk * 0.12;`);
  };
  const sheet = new THREE.Mesh(geo, mat);
  sheet.castShadow = true; sheet.receiveShadow = true; sheet.frustumCulled = false;
  const group = new THREE.Group(); group.name = 'cloak';
  group.add(sheet);
  if (o.hood !== false) {
    // the lowered hood: a soft roll of cloth around the back of the neck and shoulders
    const hm = mat.clone(); hm.vertexColors = false; hm.onBeforeCompile = () => {};
    const roll = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.05, 10, 24, Math.PI * 1.15), hm);
    roll.rotation.set(Math.PI / 2 - 0.35, 0, Math.PI + (Math.PI - Math.PI * 1.15) / 2 - Math.PI);
    roll.rotation.z = -(Math.PI * 1.15) / 2 - Math.PI / 2;
    roll.position.set(0, top + 0.01, nk.z - 0.01);
    roll.scale.set(1.3, 1.05, 1.0);
    roll.castShadow = true;
    const drape = new THREE.Mesh(new THREE.SphereGeometry(0.16, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hm);
    drape.scale.set(1.05, 0.55, 0.38); drape.rotation.x = -Math.PI / 2 - 0.25;
    drape.position.set(0, top - 0.1, backZ + 0.02);
    void drape;
    group.add(roll);
  }
  // parent to the upper spine so the cloak follows breathing, bending and turning
  heroRoot.add(group); heroRoot.updateMatrixWorld(true);
  (spine as THREE.Object3D).attach(group);
  const update = (dt: number, speed: number) => {
    uniforms.uTime.value += dt;
    const target = Math.min(1, speed / 3.5);
    uniforms.uTrail.value += (target - uniforms.uTrail.value) * Math.min(1, dt * 4);
  };
  return { group, uniforms, update };
}
