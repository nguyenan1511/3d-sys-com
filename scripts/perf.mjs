// Đo fps / draw call với 40 nhân viên ở giờ cao điểm. Dùng: npm run perf  (thêm --low để thử chất lượng thấp)
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
import path from 'path';
const root = path.resolve(import.meta.dirname, '..');
const low = process.argv.includes('--low');
const server = await startServer(5197);
const url = server.url + '/';
const browser = await chromium.launch({ headless: !process.argv.includes('--headed'), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await server.loginAdmin(page);
await page.goto(`${url}?n=40&t=07:50&speed=10${low ? '&q=low' : ''}`);
await page.waitForFunction(() => window.__app?.ready, null, { timeout: 120000 });
const gpu = await page.evaluate(() => { const gl = document.getElementById('c3').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; });
console.log('GPU:', gpu, low ? '(chất lượng thấp)' : '(chất lượng cao)');
const rows = [];
for (const [name, fn] of [['góc chéo', a => a.view('A')], ['chính diện', a => a.view('F')], ['tầng 2', a => a.floor(1)], ['tầng 3', a => a.floor(2)]]) {
  await page.evaluate(`(${fn})(window.__app)`);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res({ fps: n / ((performance.now() - t0) / 1000), calls: window.__app.stats().calls, tris: window.__app.stats().tris, people: window.__app.app.sim.agents.filter(a => a.visible).length }); }; requestAnimationFrame(f); }));
  rows.push({ góc: name, fps: r.fps.toFixed(0), 'draw call': r.calls, 'tam giác': r.tris, 'người hiện': r.people });
}
console.table(rows);
await browser.close(); server.stop();
