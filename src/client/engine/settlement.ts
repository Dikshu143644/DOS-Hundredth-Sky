import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildZone, heightAt, REGION, ZONE } from '../../shared/world';
import { REGIONS } from '../../shared/regions';
import { worldUV, type TorchInfo } from './city';
import { tex } from './assets';
import { floorOf } from '../../shared/tower';
import { FloorDeco } from './floor';

function pbr(name: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ map: tex(`tex/${name}_col.jpg`), normalMap: tex(`tex/${name}_nor.jpg`, { srgb: false }), roughness: 0.9, metalness: 0, ...extra });
}
function bake(geo: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0) {
  return geo.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z));
}
const STYLE: Record<string, { wall: [string, number]; roof: [string, number] }> = {
  camp: { wall: ['wood', 0xb89a78], roof: ['roof', 0x8a9a6a] },
  stone: { wall: ['rock', 0xc8c0b4], roof: ['roof', 0x7a6a8a] },
  adobe: { wall: ['sand', 0xf0d4a8], roof: ['sand', 0xe0b888] },
  ice: { wall: ['snow', 0xd8e8ff], roof: ['snow', 0xc0d8ff] },
  ruin: { wall: ['rock', 0x6a5a70], roof: ['rock', 0x504058] },
  plaza: { wall: ['brick', 0xe8e4f0], roof: ['roof', 0x5a6aa8] },
};
const PORTAL_COL: Record<string, number> = { f1: 0xfff4c8,  capital: 0x9fd8ff, forest: 0x7cff9a, mountain: 0xc8d0ff, desert: 0xffc870, frozen: 0xbfeaff, forbidden: 0xc070ff, tower: 0xfff0b0 };

/** Phase 4 · M2: everything built in a region that is not the Capital's hand-made city —
 *  town buildings in the region's style, ruins, torches — plus, in every zone, the glowing
 *  fast-travel shrines and the portal gates to the neighbouring regions. */
export class Settlement {
  group = new THREE.Group();
  torches: TorchInfo[] = [];
  crystals: THREE.Mesh[] = [];
  portalMat: THREE.ShaderMaterial;
  runeMat: THREE.MeshStandardMaterial;
  windowMat: THREE.MeshStandardMaterial;
  labels: { pos: THREE.Vector3; text: string }[] = [];
  floor: FloorDeco | null = null;

  constructor(public scene: THREE.Scene) {
    scene.add(this.group);
    const zone = buildZone(), R = REGION, capital = ZONE === 'capital';
    const st = STYLE[R.town.style] ?? STYLE.stone;
    const wallM = pbr(st.wall[0], { color: st.wall[1] }), roofM = pbr(st.roof[0], { color: st.roof[1] });
    const wood = pbr('wood', { color: 0xa88866 }), rock = pbr('rock', { color: R.id === 'forbidden' ? 0x6a5a78 : R.id === 'frozen' ? 0xc8d4e4 : 0xb8b4aa });
    this.windowMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.4 });
    this.runeMat = new THREE.MeshStandardMaterial({ color: 0x223344, emissive: PORTAL_COL[R.id] ?? 0x58e0ff, emissiveIntensity: 1.5, roughness: 0.3 });
    const wallG: THREE.BufferGeometry[] = [], roofG: THREE.BufferGeometry[] = [], woodG: THREE.BufferGeometry[] = [], winG: THREE.BufferGeometry[] = [], rockG: THREE.BufferGeometry[] = [], runeG: THREE.BufferGeometry[] = [];
    if (!capital) {
      for (const b of zone.buildings) {
        const y = b.y ?? heightAt(b.x, b.z);
        const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw); // front faces the town centre
        if (b.roof === 'tent') {
          roofG.push(bake(worldUV(new THREE.ConeGeometry(b.w * 0.62, b.h, 6, 1), 2), b.x, y + b.h / 2, b.z, b.yaw));
          woodG.push(bake(worldUV(new THREE.CylinderGeometry(0.1, 0.1, b.h + 0.8, 5), 1), b.x, y + (b.h + 0.8) / 2, b.z));
          winG.push(bake(new THREE.BoxGeometry(1.1, 1.6, 0.1), b.x + fx * b.w * 0.5, y + 0.8, b.z + fz * b.w * 0.5, b.yaw));
          continue;
        }
        if (b.roof === 'cone') {
          wallG.push(bake(worldUV(new THREE.CylinderGeometry(b.w / 2, b.w / 2 + 0.6, b.h, 16, 1), 4), b.x, y + b.h / 2, b.z));
          roofG.push(bake(worldUV(new THREE.ConeGeometry(b.w / 2 + 1.2, 8, 16), 3), b.x, y + b.h + 4, b.z));
          runeG.push(bake(new THREE.TorusGeometry(b.w / 2 + 0.35, 0.12, 6, 32).rotateX(Math.PI / 2), b.x, y + b.h - 1, b.z));
          for (let k = 0; k < 4; k++) winG.push(bake(new THREE.BoxGeometry(0.9, 1.5, 0.3), b.x + Math.sin(k * 1.6) * (b.w / 2 + 0.05), y + 3 + k * 3, b.z + Math.cos(k * 1.6) * (b.w / 2 + 0.05), k * 1.6));
          continue;
        }
        const h = b.broken ? b.h * 0.55 : b.h;
        wallG.push(bake(worldUV(new THREE.BoxGeometry(b.w, h, b.d), 4), b.x, y + h / 2, b.z, b.yaw));
        if (b.roof === 'gable' && !b.broken) {
          const shape = new THREE.Shape([new THREE.Vector2(-b.w / 2 - 0.5, 0), new THREE.Vector2(b.w / 2 + 0.5, 0), new THREE.Vector2(0, b.w * 0.42)]);
          const roof = new THREE.ExtrudeGeometry(shape, { depth: b.d + 1, bevelEnabled: false }).translate(0, 0, -(b.d + 1) / 2);
          roofG.push(bake(worldUV(roof, 3), b.x, y + h, b.z, b.yaw));
        } else if (b.roof === 'dome' && !b.broken) {
          roofG.push(bake(worldUV(new THREE.SphereGeometry(Math.min(b.w, b.d) * 0.55, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 3), b.x, y + h - 0.2, b.z));
        } else if (!b.broken) {
          roofG.push(bake(worldUV(new THREE.BoxGeometry(b.w + 0.6, 0.4, b.d + 0.6), 3), b.x, y + h + 0.2, b.z, b.yaw));
        }
        woodG.push(bake(worldUV(new THREE.BoxGeometry(1.6, 2.6, 0.2), 2), b.x + fx * (b.d / 2 + 0.08), y + 1.3, b.z + fz * (b.d / 2 + 0.08), b.yaw));
        for (const sx of [-1, 1]) winG.push(bake(new THREE.BoxGeometry(1.1, 1.2, 0.15), b.x + fx * (b.d / 2 + 0.1) + Math.cos(b.yaw) * sx * b.w * 0.28, y + h * 0.62, b.z + fz * (b.d / 2 + 0.1) - Math.sin(b.yaw) * sx * b.w * 0.28, b.yaw));
      }
      // town centre: bonfire ring / well
      const ty = heightAt(R.town.x, R.town.z);
      if (!floorOf(ZONE)) rockG.push(bake(worldUV(new THREE.CylinderGeometry(2.2, 2.4, 0.9, 20), 2), R.town.x, ty + 0.45, R.town.z));
      if (!floorOf(ZONE)) runeG.push(bake(new THREE.OctahedronGeometry(0.5), R.town.x, ty + 2.6, R.town.z));
      // ruins
      for (const r of zone.ruins) {
        const g = heightAt(r.x, r.z);
        rockG.push(bake(worldUV(new THREE.CylinderGeometry(r.r * 0.85, r.r, r.h, 10, 2), 2), r.x, g + r.h / 2 - 0.3, r.z, r.x));
        if (!r.broken && r.h > 6) rockG.push(bake(worldUV(new THREE.BoxGeometry(r.r * 2.6, 0.6, r.r * 2.6), 2), r.x, g + r.h, r.z, r.z));
      }
    }
    // shrines: a stone plinth with a floating crystal
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, emissive: 0x58c8ff, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 });
    for (const s of R.shrines) {
      const g = heightAt(s.x, s.z);
      rockG.push(bake(worldUV(new THREE.CylinderGeometry(1.4, 1.8, 1.1, 8), 2), s.x, g + 0.4, s.z));
      for (let k = 0; k < 4; k++) rockG.push(bake(worldUV(new THREE.BoxGeometry(0.4, 3.2, 0.4), 2), s.x + Math.cos(k * Math.PI / 2 + 0.785) * 2.6, g + 1.4, s.z + Math.sin(k * Math.PI / 2 + 0.785) * 2.6, k));
      runeG.push(bake(new THREE.TorusGeometry(1.25, 0.06, 6, 40).rotateX(Math.PI / 2), s.x, g + 1.0, s.z));
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.75, 0).scale(0.7, 1.4, 0.7), crystalMat);
      c.position.set(s.x, g + 3.2, s.z);
      this.group.add(c); this.crystals.push(c);
      this.torches.push({ pos: new THREE.Vector3(s.x, g + 3.2, s.z), flame: null as unknown as THREE.Sprite });
      this.labels.push({ pos: new THREE.Vector3(s.x, g + 5, s.z), text: s.name });
    }
    // portal gates to the neighbouring regions
    this.portalMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: 'varying vec2 vUv; attribute vec3 aCol; varying vec3 vCol; void main(){ vUv = uv; vCol = aCol; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vCol;
        void main(){ vec2 p = vUv*2.0-1.0; float r = length(p*vec2(1.0,0.75)); float a = atan(p.y,p.x);
          float sw = sin(a*5.0 + r*14.0 - uTime*3.0)*0.5+0.5; float edge = smoothstep(1.0, 0.75, r);
          float glow = edge * (0.25 + 0.55*sw*(1.0-r)) + smoothstep(0.95,0.8,r)*smoothstep(0.6,0.9,r)*0.8;
          gl_FragColor = vec4(vCol*glow*1.6, glow); }`,
    });
    const portalG: THREE.BufferGeometry[] = [];
    const gates: typeof R.exits = [...R.exits, ...(ZONE === 'tower' ? [{ to: 'f1' as typeof R.exits[number]['to'], x: 0, z: -168, name: 'Gate of the Tower', yaw: 0 }] : [])];
    for (const e of gates) {
      const g = heightAt(e.x, e.z), alongX = floorOf(ZONE) ? true : Math.abs(e.x) <= Math.abs(e.z); // gate spans across the road
      const yaw = alongX ? 0 : Math.PI / 2;
      for (const sgn of [-1, 1]) {
        const px = e.x + (alongX ? sgn * 5 : 0), pz = e.z + (alongX ? 0 : sgn * 5);
        rockG.push(bake(worldUV(new THREE.CylinderGeometry(0.75, 0.95, 9.5, 10), 2), px, g + 4.5, pz));
        runeG.push(bake(new THREE.BoxGeometry(0.15, 5, 0.15), px + (alongX ? -sgn * 0.8 : 0), g + 4, pz + (alongX ? 0 : -sgn * 0.8)));
      }
      rockG.push(bake(worldUV(new THREE.BoxGeometry(12.4, 1.1, 1.8), 2), e.x, g + 9.6, e.z, yaw));
      const col = new THREE.Color(PORTAL_COL[e.to] ?? 0xffffff);
      const pg = new THREE.PlaneGeometry(9, 8.6).translate(0, 4.4, 0);
      const cols = new Float32Array(pg.attributes.position.count * 3); for (let i = 0; i < pg.attributes.position.count; i++) cols.set([col.r, col.g, col.b], i * 3);
      pg.setAttribute('aCol', new THREE.BufferAttribute(cols, 3));
      portalG.push(bake(pg, e.x, g, e.z, yaw));
      this.torches.push({ pos: new THREE.Vector3(e.x, g + 4, e.z), flame: null as unknown as THREE.Sprite });
      this.labels.push({ pos: new THREE.Vector3(e.x, g + 11.2, e.z), text: `${REGIONS[e.to].name} · Lv ${REGIONS[e.to].levels[0]}–${REGIONS[e.to].levels[1]}` });
    }
    const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, cast = true) => {
      if (!geos.length) return;
      const g = mergeGeometries(geos.map((x) => { const y = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(y.attributes)) if (!['position', 'normal', 'uv'].includes(k)) y.deleteAttribute(k); if (!y.attributes.uv) y.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(y.attributes.position.count * 2), 2)); return y; }))!;
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = true;
      this.group.add(m);
    };
    add(wallG, wallM); add(roofG, roofM); add(woodG, wood); add(winG, this.windowMat, false); add(rockG, rock); add(runeG, this.runeMat, false);
    if (portalG.length) { const pm = new THREE.Mesh(mergeGeometries(portalG.map((x) => (x.index ? x.toNonIndexed() : x)))!, this.portalMat); pm.renderOrder = 2; this.group.add(pm); }
    // torches with flames (non-capital towns)
    if (!capital) {
      const fc = document.createElement('canvas'); fc.width = fc.height = 64;
      const fg = fc.getContext('2d')!;
      const gr = fg.createRadialGradient(32, 36, 2, 32, 32, 30);
      gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,180,60,0.9)'); gr.addColorStop(0.6, 'rgba(255,90,20,0.35)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
      fg.fillStyle = gr; fg.fillRect(0, 0, 64, 64);
      const flameTex = new THREE.CanvasTexture(fc);
      for (const t of zone.torches) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false }));
        s.scale.set(0.9, 1.3, 1); s.position.set(t.x, t.y + 0.55, t.z);
        this.group.add(s);
        this.torches.push({ pos: new THREE.Vector3(t.x, t.y + 0.6, t.z), flame: s });
      }
      if (floorOf(ZONE)) this.floor = new FloorDeco(scene, floorOf(ZONE), flameTex);
    }
  }
  update(t: number, night: number) {
    this.windowMat.emissiveIntensity = night * 2.2;
    this.runeMat.emissiveIntensity = 1.2 + night * 2.5 + Math.sin(t * 2) * 0.3;
    this.portalMat.uniforms.uTime.value = t;
    this.floor?.update(t);
    for (const c of this.crystals) { c.rotation.y = t * 0.8; c.position.y += Math.sin(t * 1.7 + c.position.x) * 0.004; }
    for (let i = 0; i < this.torches.length; i++) {
      const f = this.torches[i].flame;
      if (!f) continue;
      const k = 0.85 + Math.sin(t * 13 + i) * 0.08 + Math.sin(t * 7.3 + i * 2) * 0.07;
      f.scale.set(0.8 * k, 1.25 * k, 1);
      (f.material as THREE.SpriteMaterial).opacity = 0.35 + night * 0.65;
    }
  }
  dispose() {
    this.floor?.dispose(this.scene);
    this.scene.remove(this.group);
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  }
}
