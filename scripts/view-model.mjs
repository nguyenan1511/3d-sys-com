// Chụp ảnh model từ 4 hướng: node scripts/view-model.mjs /model/ten.opt.glb out.png
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'path';
const root = path.resolve(import.meta.dirname, '..');
const [file, out] = process.argv.slice(2);
const srv = await createServer({ root, logLevel: 'error', server: { port: 5391 } });
await srv.listen();
const b = await chromium.launch({ args: ['--use-angle=metal'] });
const p = await b.newPage({ viewport: { width: 1200, height: 600 } });
p.on("console", m => console.log("console:", m.text().slice(0, 200))); p.on("pageerror", e => console.log("pageerror:", e.message));
const [f0, ...extra] = file.split("&");
await p.goto(`http://localhost:5391/tools/model-viewer.html?f=${encodeURIComponent(f0)}${extra.length ? "&" + extra.join("&") : ""}`);
await p.waitForFunction(() => window.done, null, { timeout: 120000 });
console.log(await p.textContent('#info'));
await p.screenshot({ path: out });
await b.close(); await srv.close();
