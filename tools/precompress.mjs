// Build step: write .br (and .gz) twins next to every compressible client file that shrinks.
// node tools/precompress.mjs dist/client
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
const root = process.argv[2] || 'dist/client';
const OK = /\.(js|css|html|svg|json|glb|hdr|webmanifest|txt)$/;
let raw = 0, br = 0, n = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (OK.test(e.name)) {
  const buf = fs.readFileSync(p); const b = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  if (b.length < buf.length * 0.92) { fs.writeFileSync(p + '.br', b); fs.writeFileSync(p + '.gz', zlib.gzipSync(buf, { level: 9 })); raw += buf.length; br += b.length; n++; }
} } };
walk(root);
console.log(`precompressed ${n} files: ${(raw / 1e6).toFixed(2)} MB -> ${(br / 1e6).toFixed(2)} MB brotli`);
