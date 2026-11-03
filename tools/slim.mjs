// Asset slimmer: keep only the animation clips the game plays, then resample + meshopt.
// node tools/slim.mjs in.glb out.glb "Clip1,Clip2" [animonly]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, meshopt, resample } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
const [,, inF, outF, keepArg, mode] = process.argv;
const KEEP = new Set((keepArg || '').split(',').filter(Boolean));
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(inF);
for (const a of doc.getRoot().listAnimations()) if (KEEP.size && !KEEP.has(a.getName())) { for (const c of a.listChannels()) c.dispose(); for (const s of a.listSamplers()) s.dispose(); a.dispose(); }
if (mode === 'animonly') { for (const n of doc.getRoot().listNodes()) if (n.getMesh()) n.setMesh(null); for (const n of doc.getRoot().listNodes()) if (n.getSkin()) n.setSkin(null); for (const m of doc.getRoot().listMeshes()) m.dispose(); for (const t of doc.getRoot().listTextures()) t.dispose(); for (const m of doc.getRoot().listMaterials()) m.dispose(); }
await doc.transform(resample({ tolerance: 0.0008 }), prune({ keepLeaves: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await io.write(outF, doc);
console.log(outF.split('/').pop(), doc.getRoot().listAnimations().map((a) => a.getName()).join(','));
