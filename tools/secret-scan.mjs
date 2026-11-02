#!/usr/bin/env node
// Pre-push secret scan: fails if any tracked/staged file contains something that looks like a credential.
// Usage: node tools/secret-scan.mjs   (scans `git ls-files` + staged files)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const files = new Set(execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean));
const patterns = [
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/github_pat_[A-Za-z0-9_]{40,}/, 'GitHub fine-grained token'],
  [/sk-[A-Za-z0-9_-]{24,}/, 'API secret key (sk-…)'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/, 'private key'],
  [/fw_[A-Za-z0-9]{20,}/, 'Fireworks key'],
  [/["']?Authorization["']?\s*[:=]\s*["']Bearer\s+[A-Za-z0-9._-]{20,}/, 'hard-coded bearer token'],
];
const extra = (process.env.SECRET_SCAN_LITERALS || '').split(',').filter((s) => s.length >= 12);
let bad = 0;
for (const f of files) {
  if (!fs.existsSync(f) || fs.statSync(f).size > 5e6 || /\.(png|jpe?g|glb|woff2|mp4|webp|ico)$/i.test(f)) continue;
  const text = fs.readFileSync(f, 'utf8');
  for (const [re, name] of patterns) if (re.test(text)) { console.error(`✗ ${f}: looks like a ${name}`); bad++; }
  for (const lit of extra) if (text.includes(lit)) { console.error(`✗ ${f}: contains a known secret value`); bad++; }
}
if (bad) { console.error(`secret scan FAILED (${bad} finding${bad > 1 ? 's' : ''})`); process.exit(1); }
console.log(`secret scan passed (${files.size} files)`);
