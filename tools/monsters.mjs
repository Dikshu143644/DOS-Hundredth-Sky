// Monster pack slimmer: keep idle/move/attack/hit/death clips, meshopt-compress.
// node tools/monsters.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, meshopt, resample, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
const [,, inF, outF] = process.argv;
const KEEP = /(^|\|)(Idle|Flying_Idle|Walk|Run|Gallop|Fast_Flying|Attack|Punch|Bite_Front|Headbutt|HitReact|HitRecieve|Hit|Death|Weapon|\w+_(Idle|Walk|Flying|Attack|Death|Hit))$/;
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inF);
for (const a of doc.getRoot().listAnimations()) { const n = a.getName(); if (!KEEP.test(n) || /Idle_HitReact/.test(n)) { for (const c of a.listChannels()) c.dispose(); for (const s of a.listSamplers()) s.dispose(); a.dispose(); } }
await doc.transform(resample({ tolerance: 0.001 }), prune({ keepLeaves: true }), dedup(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await io.write(outF, doc);
console.log(outF.split('/').pop(), doc.getRoot().listAnimations().map((a) => a.getName().replace(/^\w+Armature\|/, '')).join(','));
