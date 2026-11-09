// Chụp ảnh các góc chuẩn để so sánh trực quan sau mỗi lần sửa.
// Dùng: npm run shots            (chụp vào shots/latest, so với shots/baseline nếu có)
//       npm run shots -- --baseline  (chụp và lưu làm mốc so sánh)
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const root = path.resolve(import.meta.dirname, '..');
const asBaseline = process.argv.includes('--baseline');
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');
const outDir = path.join(root, 'shots', asBaseline ? 'baseline' : 'latest');
fs.mkdirSync(outDir, { recursive: true });

const SHOTS = [
  { name: 'logo', time: '07:30', act: a => a.view('L') },
  { name: 'chinh-dien', time: '07:58', act: a => a.view('F') },
  { name: 'goc-cheo', time: '08:05', act: a => a.view('A') },
  { name: 'tang-tret', time: '10:00', act: a => a.floor(0) },
  { name: 'tang-2', time: '10:00', act: a => a.floor(1) },
  { name: 'tang-3', time: '08:36', act: a => a.floor(2) },
  { name: 'tang-2-duong-di', time: '08:02', act: a => { a.floor(1); a.debug('paths', true); a.debug('desks', true); } },
  { name: 'pantry-trua', time: '12:20', act: a => a.floor(0) },
  { name: 'can-canh-ngoi', time: '10:00', act: a => { const ag = a.app.sim.agents.find(x => x.desk.id === 'T2-10'); a.floor(1); a.app.rig.view(2.2, 1.18, 2.6, [ag.x, ag.y + 0.75, ag.z]); a.app.rig.snap(); } },
  { name: 'can-canh-hop', time: '08:38', act: a => { a.floor(2); a.app.rig.view(0.6, 1.0, 5.5, [0, 6.6, 2.1]); a.app.rig.snap(); } }
];

const server = await startServer(5199);
const url = server.url + '/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
await server.loginAdmin(page);
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { if (!/Failed to load resource/.test(m.text())) logs.push(`${m.type()}: ${m.text()}`); } });
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));

function diff(a, b) {
  const A = PNG.sync.read(fs.readFileSync(a)), B = PNG.sync.read(fs.readFileSync(b));
  if (A.width !== B.width || A.height !== B.height) return 1;
  let n = 0;
  for (let i = 0; i < A.data.length; i += 4) if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 48) n++;
  return n / (A.width * A.height);
}

const report = [];
for (const s of SHOTS.filter(s => !only || only.includes(s.name))) {
  await page.goto(`${url}?shot=1&paused&t=06:00`);
  await page.waitForFunction(() => window.__app && window.__app.ready, null, { timeout: 120000 });
  await page.evaluate(([t]) => { window.__app.pause(true); window.__app.setTime(t); }, [s.time]);
  await page.evaluate(`(${s.act.toString()})(window.__app)`);
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__app.render(); });
  await page.waitForTimeout(300);
  const file = path.join(outDir, `${s.name}.png`);
  await page.locator('#c3').screenshot({ path: file });
  const base = path.join(root, 'shots', 'baseline', `${s.name}.png`);
  const d = !asBaseline && fs.existsSync(base) ? diff(file, base) : null;
  const st = await page.evaluate(() => window.__app.stats());
  report.push({ shot: s.name, time: s.time, diff: d === null ? '-' : `${(d * 100).toFixed(2)}%`, calls: st.calls, people: JSON.stringify(st.byFloor) });
}
console.table(report);
const st = await page.evaluate(() => window.__app.stats());
console.log('logo:', st.sign, 'merge:', JSON.stringify(st.merge), 'problems:', st.problems, 'errors:', st.errors);
if (logs.length) console.log('Console:\n' + [...new Set(logs)].filter(l => !/GPU stall|GL Driver/.test(l)).join('\n'));
await browser.close();
server.stop();
console.log('Ảnh ở', outDir);
