import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildZone, CITY_Y, WALL_Z, GATE_HALF, POIS, heightAt } from '../../shared/world';
import { tex } from './assets';

/** World-space UVs so textures keep real-world scale on any box. */
export function worldUV(geo: THREE.BufferGeometry, size: number): THREE.BufferGeometry {
  geo = geo.index ? geo.toNonIndexed() : geo;
  geo.computeVertexNormals();
  const p = geo.attributes.position as THREE.BufferAttribute, n = geo.attributes.normal as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const [u, v] = ay > ax && ay > az ? [x, z] : ax > az ? [z, y] : [x, y];
    uv[i * 2] = u / size; uv[i * 2 + 1] = v / size;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
function pbr(name: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ map: tex(`tex/${name}_col.jpg`), normalMap: tex(`tex/${name}_nor.jpg`, { srgb: false }), roughness: 0.9, metalness: 0, ...extra });
}
function bake(geo: THREE.BufferGeometry, x: number, y: number, z: number, yaw = 0) {
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
  return geo.clone().applyMatrix4(m);
}

export interface TorchInfo { pos: THREE.Vector3; flame: THREE.Sprite }

export class City {
  group = new THREE.Group();
  torches: TorchInfo[] = [];
  windowMat: THREE.MeshStandardMaterial;
  runeMat: THREE.MeshStandardMaterial;
  fountainWater: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const zone = buildZone();
    const brick = pbr('brick', { color: new THREE.Color(1.15, 1.12, 1.08) });
    const cobble = pbr('cobble');
    const roofM = pbr('roof', { color: 0xc07a5a });
    const wood = pbr('wood', { color: 0xa88866 });
    const rock = pbr('rock', { color: 0xb8b4aa });
    this.windowMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.4 });
    this.runeMat = new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0x58e0ff, emissiveIntensity: 1.5, roughness: 0.3 });

    const wallG: THREE.BufferGeometry[] = [], roofG: THREE.BufferGeometry[] = [], woodG: THREE.BufferGeometry[] = [], winG: THREE.BufferGeometry[] = [], rockG: THREE.BufferGeometry[] = [], runeG: THREE.BufferGeometry[] = [];
    // walls with crenellations
    for (const c of zone.colliders) {
      if (c.kind !== 'box') continue;
      if (c.tag === 'wall' || c.tag === 'tower' || c.tag === 'arch') {
        const h = c.y1 - c.y0;
        wallG.push(bake(worldUV(new THREE.BoxGeometry(c.hx * 2, h, c.hz * 2), 4), c.x, c.y0 + h / 2, c.z, c.yaw));
        // merlons
        const long = Math.max(c.hx, c.hz) * 2, alongX = c.hx >= c.hz;
        const n = Math.floor(long / 2.6);
        if (c.tag !== 'arch') for (let i = 0; i < n; i++) {
          if (i % 2) continue;
          const o = -long / 2 + (i + 0.5) * (long / n);
          const mx = alongX ? c.x + o : c.x, mz = alongX ? c.z : c.z + o;
          wallG.push(bake(worldUV(new THREE.BoxGeometry(alongX ? long / n : c.hx * 2, 1.4, alongX ? c.hz * 2 : long / n), 4), mx, c.y1 + 0.7, mz));
        }
        if (c.tag === 'tower') {
          // conical roof on gate towers
          const cone = new THREE.ConeGeometry(Math.max(c.hx, c.hz) * 1.45, 7, 4, 1).rotateY(Math.PI / 4);
          roofG.push(bake(worldUV(cone, 3), c.x, c.y1 + 1.4 + 3.5, c.z));
          winG.push(bake(new THREE.BoxGeometry(1.1, 1.8, 0.2), c.x, c.y1 - 4, c.z + c.hz + 0.05));
        }
      }
      if (c.tag === 'stall') {
        woodG.push(bake(worldUV(new THREE.BoxGeometry(c.hx * 2, 1.1, c.hz * 2), 2), c.x, CITY_Y + 0.55, c.z));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) woodG.push(bake(worldUV(new THREE.BoxGeometry(0.12, 2.6, 0.12), 2), c.x + sx * (c.hx - 0.1), CITY_Y + 1.3, c.z + sz * (c.hz - 0.1)));
        roofG.push(bake(worldUV(new THREE.BoxGeometry(c.hx * 2 + 0.6, 0.12, c.hz * 2 + 0.6), 2).rotateX(0.18), c.x, CITY_Y + 2.7, c.z));
      }
      if (c.tag === 'ruinwall' || c.tag === 'altar') {
        const h = c.y1 - c.y0;
        rockG.push(bake(worldUV(new THREE.BoxGeometry(c.hx * 2, h, c.hz * 2), 3), c.x, c.y0 + h / 2, c.z, c.yaw));
      }
    }
    // gate arch (decorative half-ring under the lintel)
    const arch = new THREE.TorusGeometry(GATE_HALF, 0.9, 8, 24, Math.PI);
    wallG.push(bake(worldUV(arch, 3), 0, CITY_Y + 7.4 - GATE_HALF * 0.0, WALL_Z));
    // gate banner runes
    runeG.push(bake(new THREE.BoxGeometry(GATE_HALF * 1.6, 0.25, 0.1), 0, CITY_Y + 9.2, WALL_Z + 1.75));

    // buildings
    for (const b of zone.buildings) {
      if (b.roof === 'cone') {
        const tower = new THREE.CylinderGeometry(b.w / 2, b.w / 2 + 0.6, b.h, 20, 1);
        wallG.push(bake(worldUV(tower, 4), b.x, CITY_Y + b.h / 2, b.z));
        roofG.push(bake(worldUV(new THREE.ConeGeometry(b.w / 2 + 1.2, 10, 20), 3), b.x, CITY_Y + b.h + 5, b.z));
        for (let k = 0; k < 5; k++) winG.push(bake(new THREE.BoxGeometry(0.9, 1.6, 0.3), b.x + Math.sin(k * 1.3) * (b.w / 2 + 0.05), CITY_Y + 4 + k * 3.5, b.z + Math.cos(k * 1.3) * (b.w / 2 + 0.05), k * 1.3));
        runeG.push(bake(new THREE.TorusGeometry(b.w / 2 + 0.35, 0.12, 6, 40).rotateX(Math.PI / 2), b.x, CITY_Y + b.h - 1, b.z));
        continue;
      }
      wallG.push(bake(worldUV(new THREE.BoxGeometry(b.w, b.h, b.d), 4), b.x, CITY_Y + b.h / 2, b.z, b.yaw));
      // timber frame
      for (const sx of [-1, 1]) woodG.push(bake(worldUV(new THREE.BoxGeometry(0.35, b.h, 0.35), 2), b.x + sx * (b.w / 2), CITY_Y + b.h / 2, b.z + b.d / 2 + 0.05));
      woodG.push(bake(worldUV(new THREE.BoxGeometry(b.w + 0.3, 0.35, 0.35), 2), b.x, CITY_Y + b.h * 0.55, b.z + b.d / 2 + 0.06));
      // gable roof
      const rh = b.w * 0.42;
      const shape = new THREE.Shape([new THREE.Vector2(-b.w / 2 - 0.8, 0), new THREE.Vector2(b.w / 2 + 0.8, 0), new THREE.Vector2(0, rh)]);
      const roof = new THREE.ExtrudeGeometry(shape, { depth: b.d + 1.2, bevelEnabled: false }).translate(0, 0, -(b.d + 1.2) / 2);
      roofG.push(bake(worldUV(roof, 3), b.x, CITY_Y + b.h, b.z, b.yaw));
      // door + windows
      woodG.push(bake(worldUV(new THREE.BoxGeometry(1.6, 2.6, 0.2), 2), b.x, CITY_Y + 1.3, b.z + b.d / 2 + 0.08));
      for (const sx of [-1, 1]) winG.push(bake(new THREE.BoxGeometry(1.1, 1.2, 0.15), b.x + sx * b.w * 0.28, CITY_Y + b.h * 0.62, b.z + b.d / 2 + 0.1));
    }
    // plaza paving ring + fountain
    const fountain = new THREE.CylinderGeometry(3.4, 3.6, 0.9, 40, 1, false);
    rockG.push(bake(worldUV(fountain, 2), 0, CITY_Y + 0.45, -122));
    rockG.push(bake(worldUV(new THREE.CylinderGeometry(0.5, 0.8, 3.2, 16), 2), 0, CITY_Y + 1.6, -122));
    rockG.push(bake(worldUV(new THREE.CylinderGeometry(1.5, 0.3, 0.5, 20), 2), 0, CITY_Y + 3.2, -122));
    runeG.push(bake(new THREE.OctahedronGeometry(0.55), 0, CITY_Y + 4.1, -122));
    this.fountainWater = new THREE.Mesh(new THREE.CircleGeometry(3.15, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a5a66, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 }));
    this.fountainWater.position.set(0, CITY_Y + 0.82, -122);
    this.group.add(this.fountainWater);
    // a cobbled road ribbon outside the gate is part of the terrain splat; inside, plaza is cobble too.

    // ruins pillars & shrine stones
    for (const r of zone.ruins) {
      const g = heightAt(r.x, r.z);
      const pillar = new THREE.CylinderGeometry(r.r * 0.85, r.r, r.h, 10, 3);
      const p = pillar.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { const k = Math.sin(p.getY(i) * 3 + r.x) * 0.06; p.setX(i, p.getX(i) * (1 + k)); p.setZ(i, p.getZ(i) * (1 + k)); }
      rockG.push(bake(worldUV(pillar, 2), r.x, g + r.h / 2 - 0.3, r.z, r.x));
      if (!r.broken && r.h > 6) rockG.push(bake(worldUV(new THREE.BoxGeometry(r.r * 2.6, 0.6, r.r * 2.6), 2), r.x, g + r.h, r.z, r.z));
      if (r.h < 5 && !r.broken) runeG.push(bake(new THREE.BoxGeometry(0.12, 1.6, 0.12), r.x, g + 2.6, r.z));
    }
    const shrine = POIS.find((p) => p.id === 'shrine')!;
    runeG.push(bake(new THREE.TorusGeometry(1.2, 0.08, 8, 40).rotateX(Math.PI / 2), shrine.x, heightAt(shrine.x, shrine.z) + 1.3, shrine.z));

    const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, cast = true) => {
      if (!geos.length) return;
      const g = mergeGeometries(geos.map((x) => { const y = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(y.attributes)) if (!['position', 'normal', 'uv'].includes(k)) y.deleteAttribute(k); if (!y.attributes.uv) y.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(y.attributes.position.count * 2), 2)); return y; }))!;
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = cast; m.receiveShadow = true;
      this.group.add(m);
    };
    add(wallG, brick); add(roofG, roofM); add(woodG, wood); add(winG, this.windowMat, false); add(rockG, rock); add(runeG, this.runeMat, false);
    void cobble;

    // torches: flame sprites (+ pooled real lights at runtime)
    const fc = document.createElement('canvas'); fc.width = fc.height = 64;
    const fg = fc.getContext('2d')!;
    const gr = fg.createRadialGradient(32, 36, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,180,60,0.9)'); gr.addColorStop(0.6, 'rgba(255,90,20,0.35)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
    fg.fillStyle = gr; fg.fillRect(0, 0, 64, 64);
    const flameTex = new THREE.CanvasTexture(fc);
    const bracket = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.5 });
    for (const t of zone.torches) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff }));
      s.scale.set(0.9, 1.3, 1);
      s.position.set(t.x, t.y + 0.55, t.z);
      this.group.add(s);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.7, 6), bracket);
      b.position.set(t.x, t.y, t.z);
      this.group.add(b);
      this.torches.push({ pos: new THREE.Vector3(t.x, t.y + 0.6, t.z), flame: s });
    }
  }

  update(t: number, night: number) {
    this.windowMat.emissiveIntensity = night * 2.2;
    this.runeMat.emissiveIntensity = 1.2 + night * 2.5 + Math.sin(t * 2) * 0.3;
    for (let i = 0; i < this.torches.length; i++) {
      const f = this.torches[i].flame;
      const k = 0.85 + Math.sin(t * 13 + i) * 0.08 + Math.sin(t * 7.3 + i * 2) * 0.07;
      f.scale.set(0.8 * k, 1.25 * k, 1);
      (f.material as THREE.SpriteMaterial).opacity = 0.35 + night * 0.65;
    }
  }
}
