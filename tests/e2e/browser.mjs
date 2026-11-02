// Shared headless-browser launcher (software WebGL2 via SwiftShader when no GPU is present).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = path.join(os.homedir(), '.cache/ms-playwright');
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse() : [];
  for (const d of dirs) { const p = path.join(base, d, 'chrome-linux64/chrome'); if (fs.existsSync(p)) return p; const p2 = path.join(base, d, 'chrome-linux/chrome'); if (fs.existsSync(p2)) return p2; }
  return undefined;
}
export async function launch(opts = {}) {
  const browser = await chromium.launch({
    executablePath: chromePath(), headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--no-sandbox', ...(opts.args || [])],
  });
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return { browser, page, errors };
}
