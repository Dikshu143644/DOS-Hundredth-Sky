import * as THREE from 'three';
import { makeBossRig, BOSS_LOOKS } from '../../src/client/engine/bossrig';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
const q = new URLSearchParams(location.search);
const kinds = (q.get('k') ?? Object.keys(BOSS_LOOKS).join(',')).split(',');
const anim = q.get('a') ?? 'idle', at = Number(q.get('t') ?? 0.6);
const W = innerWidth, H = innerHeight;
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(W, H); r.shadowMap.enabled = true; r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace; document.body.appendChild(r.domElement);
const cols = Math.ceil(Math.sqrt(kinds.length * W / H)), rows = Math.ceil(kinds.length / cols);
(async () => {
  r.setScissorTest(true);
  const env = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  for (let i = 0; i < kinds.length; i++) {
    const sc = new THREE.Scene(); sc.background = new THREE.Color(0x6a7480); sc.environment = env; sc.environmentIntensity = 0.55;
    sc.add(new THREE.HemisphereLight(0xdfe8f0, 0x40382c, 1.1)); const d = new THREE.DirectionalLight(0xfff0e0, 2.4); d.position.set(4, 8, 6); d.castShadow = true; sc.add(d);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a5a52, roughness: 1 })); g.receiveShadow = true; sc.add(g);
    const rig = await makeBossRig(kinds[i], 5); sc.add(rig.root); rig.root.rotation.y = Number(q.get('yaw') ?? 0.7);
    const c = rig.clipsMap[anim as 'idle']!; const a = rig.actions.get(c)!; a.play(); rig.mixer.update(at * a.getClip().duration);
    const cam = new THREE.PerspectiveCamera(35, (W / cols) / (H / rows), 0.1, 200); cam.position.set(0, 3.6, 15); cam.lookAt(0, 2.6, 0);
    const x = (i % cols) * (W / cols), y = H - (Math.floor(i / cols) + 1) * (H / rows);
    r.setViewport(x, y, W / cols, H / rows); r.setScissor(x, y, W / cols, H / rows); r.render(sc, cam);
  }
  (window as any).done = true;
})();
