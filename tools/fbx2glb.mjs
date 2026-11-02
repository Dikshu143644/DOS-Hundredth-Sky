// Converts Quaternius FBX nature models to lean GLB (geometry + named materials only).
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { Document, NodeIO } from '@gltf-transform/core';
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({ style: {} }) };
const [,, inDir, outDir, ...names] = process.argv;
const loader = new FBXLoader();
loader.manager.setURLModifier(() => 'data:,');
for (const name of names) {
  const buf = fs.readFileSync(path.join(inDir, name + '.fbx'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let obj;
  try { obj = loader.parse(ab, ''); } catch (e) { console.error('parse fail', name, e.message); continue; }
  obj.updateMatrixWorld(true);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(name);
  const mats = new Map();
  const box = new THREE.Box3();
  obj.traverse((m) => {
    if (!m.isMesh) return;
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI/2));
    g.scale(0.01,0.01,0.01);
    // scale: Quaternius FBX are in cm -> the root carries scale; matrixWorld applied.
    if (!g.index) { const idx = []; for (let i = 0; i < g.attributes.position.count; i++) idx.push(i); g.setIndex(idx); }
    const mlist = Array.isArray(m.material) ? m.material : [m.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index.count, materialIndex: 0 }];
    const mesh = doc.createMesh(m.name);
    const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.attributes.position.array)).setBuffer(buffer);
    const nor = g.attributes.normal ? doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.attributes.normal.array)).setBuffer(buffer) : null;
    const uv = g.attributes.uv ? doc.createAccessor().setType('VEC2').setArray(new Float32Array(g.attributes.uv.array)).setBuffer(buffer) : null;
    const col = g.attributes.color ? doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.attributes.color.array)).setBuffer(buffer) : null;
    for (const gr of groups) {
      const mm = mlist[gr.materialIndex ?? 0] || mlist[0];
      const mname = (mm && mm.name) || 'Default';
      if (!mats.has(mname)) {
        const c = mm && mm.color ? mm.color : new THREE.Color(1, 1, 1);
        mats.set(mname, doc.createMaterial(mname).setBaseColorFactor([c.r, c.g, c.b, 1]).setRoughnessFactor(0.9).setMetallicFactor(0));
      }
      const idx = new Uint32Array(g.index.array.slice(gr.start, gr.start + gr.count));
      const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer)).setMaterial(mats.get(mname));
      if (nor) prim.setAttribute('NORMAL', nor);
      if (uv) prim.setAttribute('TEXCOORD_0', uv);
      mesh.addPrimitive(prim);
    }
    scene.addChild(doc.createNode(m.name).setMesh(mesh));
    g.computeBoundingBox(); box.union(g.boundingBox);
  });
  const io = new NodeIO();
  await io.write(path.join(outDir, name + '.glb'), doc);
  const s = box.getSize(new THREE.Vector3());
  console.log(name, 'mats=', [...mats.keys()].join(','), 'size=', s.toArray().map((v) => v.toFixed(2)).join('x'));
}
