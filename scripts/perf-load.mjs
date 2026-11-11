// Đo tải trang + chạy cảnh trên bản build production (như người dùng thật), hai cấu hình:
//   desktop  — 1440×900, không giới hạn
//   lowend   — điện thoại yếu: 390×844 @3×, cảm ứng, CPU chậm 4×, mạng "4G chậm" (1,6 Mb/s, RTT 150 ms)
// Đo: thời gian tới khi cảnh 3D dùng được (window.__app.ready), dung lượng tải (nén), bộ nhớ JS, số geometry/texture,
// FPS và khung hình chậm (> 50 ms) trong 6 s.
// Dùng: npm run build && node scripts/perf-load.mjs [--only=lowend] [--headed] [--json=out.json]
import { chromium } from 'playwright';
import fs from 'fs';
import { startServer } from './_server.mjs';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
process.env.NODE_ENV = 'production'; // server phục vụ dist/ (bản build), không qua Vite dev
const server = await startServer(5198);
const PROFILES = {
  desktop: { ctx: { viewport: { width: 1440, height: 900 } }, cpu: 1, net: null },
  lowend: { ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 11; Pixel 4a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' }, cpu: 4, net: { latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 } }
};
const browser = await chromium.launch({ headless: !process.argv.includes('--headed'), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const out = {};
for (const [name, p] of Object.entries(PROFILES)) {
  if (arg('only') && arg('only') !== name) continue;
  const ctx = await browser.newContext({ ...p.ctx, storageState: { cookies: [], origins: [{ origin: server.url, localStorage: [{ name: 'sysone.mode', value: 'office' }] }] } });
  const page = await ctx.newPage();
  await server.loginAdmin(page);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (p.net && !process.argv.includes('--fast-net')) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...p.net });
  if (p.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
  let bytes = 0; const big = [];
  cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; });
  const urls = new Map(); cdp.on('Network.responseReceived', e => urls.set(e.requestId, e.response.url));
  cdp.on('Network.loadingFinished', e => { if (e.encodedDataLength > 100e3) big.push(`${(e.encodedDataLength / 1024).toFixed(0)}k ${String(urls.get(e.requestId)).replace(server.url, '')}`); });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const t0 = Date.now();
  await page.goto(`${server.url}/?mode=office`);
  await page.waitForFunction(() => window.__app?.ready, null, { timeout: 300000, polling: 100 });
  const tReady = Date.now() - t0;
  const marks = await page.evaluate(() => performance.getEntriesByType('mark').filter(m => m.name.startsWith('ld:')).map(m => `${m.name.slice(3, 30)} @${(m.startTime / 1000).toFixed(1)}s`));
  if (p.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu }); // (giữ giới hạn CPU khi đo FPS)
  await page.waitForTimeout(2500);
  const run = await page.evaluate(() => new Promise(res => {
    const ts = []; const t0 = performance.now();
    const f = now => { ts.push(now); if (now - t0 < 6000) requestAnimationFrame(f); else {
      const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
      const a = window.__app, r = a.app.renderer, m = performance.memory;
      res({ fps: +(d.length / ((ts.at(-1) - ts[0]) / 1000)).toFixed(1), p95ms: +d[Math.floor(d.length * 0.95)].toFixed(1), slow: d.filter(x => x > 50).length,
        pr: a.pixelRatio, quality: a.quality, calls: r.info.render.calls, tris: r.info.render.triangles, geo: r.info.memory.geometries, tex: r.info.memory.textures, progs: r.info.programs?.length,
        heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(0) : null });
    } };
    requestAnimationFrame(f);
  }));
  out[name] = { readyMs: tReady, transferKB: +(bytes / 1024).toFixed(0), ...run, errors: errs.length, big, marks };
  await ctx.close();
}
await browser.close(); server.stop();
for (const [k, v] of Object.entries(out)) { console.log(`\n== ${k}`); const { big, marks, ...rest } = v; console.table(rest); console.log('  tệp > 100 kB:', big.join(' | ')); console.log('  các bước:', marks.join(' → ')); }
if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(out, null, 2));
