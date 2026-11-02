import * as THREE from 'three';
import { raycastWorld } from '../../shared/physics';
import { heightAt } from '../../shared/world';

/** Third-person spring-arm camera: orbit with mouse/touch, smoothed follow, and collision —
 *  a ray from the shoulder pivot to the desired position against walls/trees/terrain pulls the
 *  camera in so it never clips through geometry. */
export class ThirdPersonCamera {
  yaw = 0;              // camera south of the player, looking north (-Z) toward the Tower
  pitch = 0.22;
  dist = 6.5;
  targetDist = 6.5;
  private pivot = new THREE.Vector3();
  private cur = new THREE.Vector3();
  private shake = 0;
  constructor(public cam: THREE.PerspectiveCamera) {}
  rotate(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -0.55, 1.25);
  }
  zoom(d: number) { this.targetDist = THREE.MathUtils.clamp(this.targetDist + d, 2.2, 14); }
  addShake(a: number) { this.shake = Math.min(1, this.shake + a); }
  /** Movement frame yaw (W moves where the camera looks). */
  get moveYaw() { return this.yaw; }

  update(dt: number, target: THREE.Vector3) {
    const k = 1 - Math.exp(-dt * 14);
    this.pivot.lerp(new THREE.Vector3(target.x, target.y + 1.65, target.z), this.pivot.lengthSq() === 0 ? 1 : k);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    // shoulder offset (slightly to the right)
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const origin = this.pivot.clone().addScaledVector(right, 0.45);
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 8);
    const hit = raycastWorld(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, this.dist + 0.3, new Set(['bound']));
    const d = Math.max(0.6, Math.min(this.dist, hit - 0.35));
    const want = origin.clone().addScaledVector(dir, d);
    const g = heightAt(want.x, want.z) + 0.35;
    if (want.y < g) want.y = g;
    // pull in fast when blocked, ease out slowly when free (no popping)
    if (this.cur.lengthSq() === 0) this.cur.copy(want);
    const blocked = want.distanceTo(origin) < this.cur.distanceTo(origin) - 0.05;
    this.cur.lerp(want, blocked ? 1 : Math.min(1, dt * 10));
    this.cam.position.copy(this.cur);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const s = this.shake * this.shake * 0.25;
      this.cam.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    this.cam.lookAt(this.pivot.x, this.pivot.y + 0.15, this.pivot.z);
  }
}
