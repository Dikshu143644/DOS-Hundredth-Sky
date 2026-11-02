import * as THREE from 'three';
import { TOWER } from '../../shared/world';
import { tex } from './assets';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The Hundredth Tower: 10 tiers × 10 floors, rune rings that glow at night, a crystal crown and a
 *  light pillar into the sky. Far away, so it carries its own aerial-perspective haze. */
export class Tower {
  group = new THREE.Group();
  haze = { value: new THREE.Color(0.7, 0.78, 0.9) };
  hazeAmt = { value: 0.55 };
  glow: THREE.MeshStandardMaterial;
  beam: THREE.Mesh;
  crown: THREE.Mesh;
  halos: THREE.Mesh[] = [];
  constructor(scene: THREE.Scene) {
    const stone = new THREE.MeshStandardMaterial({ map: tex('tex/brick_col.jpg'), normalMap: tex('tex/brick_nor.jpg', { srgb: false }), color: 0xa9adb8, roughness: 0.75, fog: false });
    stone.map!.repeat.set(1, 1);
    this.glow = new THREE.MeshStandardMaterial({ color: 0x0a1820, emissive: 0x5fe8ff, emissiveIntensity: 2.4, fog: false });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.9, roughness: 0.35, fog: false });
    const addHaze = (m: THREE.Material) => {
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uHaze = this.haze; sh.uniforms.uHazeAmt = this.hazeAmt;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vTH;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTH = (modelMatrix*vec4(transformed,1.0)).y;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHaze; uniform float uHazeAmt; varying float vTH;')
          .replace('#include <dithering_fragment>', `#include <dithering_fragment>
            float hz = uHazeAmt * (1.0 - smoothstep(0.0, ${TOWER.height.toFixed(1)}, vTH) * 0.55);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, hz);`);
      };
    };
    [stone, gold].forEach(addHaze);
    const tiers = 12;
    let y = -200, r = TOWER.radius;
    const winGeo: THREE.BufferGeometry[] = [];
    const halo = new THREE.MeshBasicMaterial({ color: 0x8feaff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < tiers; i++) {
      const h = ((TOWER.height + 200) / tiers) * (i === 0 ? 1.25 : 0.975);
      const rTop = r * 0.91;
      const body = new THREE.CylinderGeometry(rTop, r, h, 48, 8, true);
      const pa = body.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pa.count; k++) {
        // fluted columns around the body
        const a = Math.atan2(pa.getZ(k), pa.getX(k));
        const f = 1 + 0.035 * Math.max(0, Math.cos(a * 16));
        pa.setX(k, pa.getX(k) * f); pa.setZ(k, pa.getZ(k) * f);
      }
      body.computeVertexNormals();
      const uv = body.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * ((r * 2 * Math.PI) / 18), uv.getY(k) * (h / 18));
      const m = new THREE.Mesh(body, stone);
      m.position.y = y + h / 2;
      this.group.add(m);
      // flared balcony skirt + gold ring
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(rTop * 1.12, rTop * 0.98, h * 0.06, 48, 1), stone);
      skirt.position.y = y + h - h * 0.03;
      this.group.add(skirt);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rTop * 1.12, rTop * 0.02, 6, 72).rotateX(Math.PI / 2), gold);
      ring.position.y = y + h;
      this.group.add(ring);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(rTop * 1.04, rTop * 1.04, h * 0.025, 48, 1, true), this.glow);
      band.position.y = y + h * 0.82;
      this.group.add(band);
      // buttresses
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + (i % 2) * 0.39;
        const rr = (r + rTop) * 0.5;
        const bt = new THREE.Mesh(new THREE.BoxGeometry(rr * 0.12, h * 0.9, rr * 0.1), stone);
        bt.position.set(Math.cos(a) * rr * 1.04, y + h * 0.47, Math.sin(a) * rr * 1.04);
        bt.rotation.y = -a;
        this.group.add(bt);
        // windows in a spiral
        for (let w = 0; w < 3; w++) {
          const wa = a + 0.2 + w * 0.12, wy = y + h * (0.25 + w * 0.2);
          const g = new THREE.BoxGeometry(rr * 0.035, h * 0.07, 1).applyMatrix4(new THREE.Matrix4().makeRotationY(-wa + Math.PI / 2).setPosition(Math.cos(wa) * rr * 1.02, wy, Math.sin(wa) * rr * 1.02));
          winGeo.push(g);
        }
      }
      if (i % 4 === 2) {
        const hr = new THREE.Mesh(new THREE.TorusGeometry(rTop * 1.9, rTop * 0.012, 4, 96).rotateX(Math.PI / 2 + 0.08), halo);
        hr.position.y = y + h * 0.5;
        this.group.add(hr);
        this.halos.push(hr);
      }
      y += h; r = rTop;
    }
    const winMesh = new THREE.Mesh(mergeGeometries(winGeo)!, this.glow);
    this.group.add(winMesh);
    this.crown = new THREE.Mesh(new THREE.OctahedronGeometry(r * 0.9, 0), new THREE.MeshStandardMaterial({ color: 0x9ff4ff, emissive: 0x7fe9ff, emissiveIntensity: 3, metalness: 0.2, roughness: 0.1, fog: false }));
    this.crown.scale.y = 2.2;
    this.crown.position.y = y + r * 2;
    this.group.add(this.crown);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x8feaff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.25, r * 0.55, 6000, 24, 1, true), beamMat);
    this.beam.position.y = y + 3000;
    this.group.add(this.beam);
    this.group.position.set(TOWER.x, 0, TOWER.z);
    scene.add(this.group);
  }
  update(t: number, env: { horizon: THREE.Color; night: number; overcast: number }) {
    this.haze.value.copy(env.horizon);
    this.hazeAmt.value = 0.3 + env.overcast * 0.45 + env.night * 0.05;
    this.glow.emissiveIntensity = 1.4 + env.night * 3 + Math.sin(t * 0.7) * 0.4;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.05 + env.night * 0.2;
    this.crown.rotation.y = t * 0.15;
    this.halos.forEach((h, i) => { h.rotation.y = t * 0.03 * (i % 2 ? -1 : 1); });
  }
}
