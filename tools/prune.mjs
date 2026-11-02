import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, quantize, meshopt, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
const KEEP = new Set(['Idle','Walking_A','Walking_B','Walking_Backwards','Running_A','Running_C','Jump_Start','Jump_Idle','Jump_Land','1H_Melee_Attack_Chop','1H_Melee_Attack_Slice_Diagonal','1H_Melee_Attack_Slice_Horizontal','2H_Melee_Attack_Slice','2H_Melee_Attack_Chop','1H_Ranged_Shoot','2H_Ranged_Shoot','Spellcast_Shoot','Spellcast_Long','Spellcasting','Spellcast_Raise','Spellcast_Summon','Hit_A','Hit_B','Death_A','Dodge_Forward','Dodge_Backward','Block','Cheer','Interact','Sit_Chair_Idle','Sit_Floor_Idle','Idle_Combat','Walking_D_Skeletons','Spawn_Ground_Skeletons','Taunt','2H_Melee_Idle','PickUp']);
const [,, inF, outF, mode] = process.argv;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inF);
for (const a of doc.getRoot().listAnimations()) if (!KEEP.has(a.getName()) || mode === 'noanim') { for (const s of a.listSamplers()) { s.getInput()?.dispose(); s.getOutput()?.dispose(); s.dispose(); } for (const c of a.listChannels()) c.dispose(); a.dispose(); }
if (mode === 'animonly') { for (const m of doc.getRoot().listMeshes()) m.dispose(); for (const t of doc.getRoot().listTextures()) t.dispose(); }
await doc.transform(resample({ tolerance: 0.0005 }), prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(outF, doc);
console.log(outF.split('/').pop(), doc.getRoot().listAnimations().length);
