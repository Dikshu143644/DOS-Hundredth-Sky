import { NodeIO } from '@gltf-transform/core';
const io = new NodeIO();
for (const f of process.argv.slice(2)) {
  const d = await io.read(f); const r = d.getRoot();
  console.log(f.split('/').pop(), 'anims:', r.listAnimations().map(a=>a.getName()).join(','));
  console.log('  meshNodes:', r.listNodes().filter(n=>n.getMesh()).map(n=>n.getName()).join(','));
  console.log('  textures:', r.listTextures().map(t=>t.getName()+':'+t.getImage()?.byteLength).join(','));
}
