// Kiểm thử trên trình duyệt thật (headless): không lỗi console, đi bộ lên cầu thang, không chui gầm thang,
// bấm chọn avatar, nhập CSV chỗ ngồi, sức chứa. Dùng: npm run e2e
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const server = await startServer(5198);
const url = server.url + '/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1300, height: 820 } });
await server.loginAdmin(page);
const errors = [];
page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall|GL Driver|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
let fail = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); if (!ok) fail++; };

await page.goto(`${url}?paused&t=07:00`);
await page.waitForFunction(() => window.__app?.ready, null, { timeout: 120000 });

// 1. đi bộ: có cầu thang (toà nhà 2 tầng cũ) thì kiểm tra leo thang; văn phòng một tầng thì kiểm tra tường chặn
const world = await page.evaluate(() => window.__app.app.model.layout.world || 'sysone');
const hasStairs = await page.evaluate(() => window.__app.app.model.stairs.length > 0);
if (world === 'sysone-mo') {
  // ngôi nhà SYSONE 3 tầng (nội thất my-office): đi bộ từ chân cầu thang S1 trong khối thang lên tầng 2
  const climb = await page.evaluate(() => {
    const rig = window.__app.app.rig, M = window.__app.app.model, s = M.stairById.get('S1');
    const walk = (yaw, secs) => { rig.PL.yaw = yaw; rig.holds.f = true; for (let i = 0; i < secs * 60; i++) rig.walkStep(1 / 60); rig.holds.f = false; };
    rig.tele(s.pBottom.x, s.pBottom.z, 0, M.floorY(0));
    walk(0, 6);                                                  // yaw 0: đi về -z (hướng lên của S1)
    const top = { ...rig.PL }; rig.setWalk(false);
    return { feet: top.feet, z: top.z, F1: M.floorY(1) };
  });
  check('leo cầu thang khối thang lên tầng 2', Math.abs(climb.feet - climb.F1) < 0.08, `chân ở y=${climb.feet.toFixed(2)} (tầng 2: ${climb.F1}), z=${climb.z.toFixed(2)}`);
} else if (hasStairs) {
  const climb = await page.evaluate(() => {
    const rig = window.__app.app.rig, F = window.__app.app.model.floors;
    const walk = (yaw, secs) => { rig.PL.yaw = yaw; rig.holds.f = true; for (let i = 0; i < secs * 60; i++) rig.walkStep(1 / 60); rig.holds.f = false; };
    rig.tele(-1.45, -6.26, Math.PI / 2, F[0].y);
    walk(Math.PI / 2, 0.45);           // sang trái vào chân thang
    walk(Math.PI, 3.2);                // đi lên theo +z
    const top = { ...rig.PL };
    walk(Math.PI, 0.4);
    const after = { ...rig.PL };
    // chui gầm thang: đứng ở sảnh tầng trệt đi thẳng vào gầm (về -z) ở x=-2.45
    rig.tele(-2.45, 0.5, 0, F[0].y);
    walk(0, 2.5);
    const under = { ...rig.PL };
    // tầng 2: đi về phía lỗ cầu thang 1 từ bên phải (x tăng -> giảm) phải bị lan can chặn
    rig.tele(-1.3, -5.9, Math.PI / 2, F[1].y);
    walk(Math.PI / 2, 2);
    const rail = { ...rig.PL };
    rig.setWalk(false);
    return { top, after, under, rail, F1: F[1].y };
  });
  check('leo cầu thang 1 lên tầng 2', Math.abs(climb.after.feet - climb.F1) < 0.05 && climb.after.z > -1.6, `chân ở y=${climb.after.feet.toFixed(2)}, z=${climb.after.z.toFixed(2)}`);
  check('không chui được gầm cầu thang', climb.under.z > -1.64 && climb.under.feet < 0.6, `dừng ở z=${climb.under.z.toFixed(2)}`);
  check('lan can quanh lỗ cầu thang ở tầng 2 chặn rơi', climb.rail.x > -1.9 && Math.abs(climb.rail.feet - climb.F1) < 0.05, `dừng ở x=${climb.rail.x.toFixed(2)}`);
} else {
  const wall = await page.evaluate(() => {
    const rig = window.__app.app.rig, M = window.__app.app.model, a = M.layout.nav.areas[0], w = M.waypoints.lobby;
    const walk = (yaw, secs) => { rig.PL.yaw = yaw; rig.holds.f = true; for (let i = 0; i < secs * 60; i++) rig.walkStep(1 / 60); rig.holds.f = false; };
    rig.tele(w.x, w.z, -Math.PI / 2, 0); walk(-Math.PI / 2, 4);   // đi thẳng ra tường trái (về -x) — phải bị chặn trong nhà
    const p = { ...rig.PL }; rig.setWalk(false);
    return { x: p.x, x0: a.x0 };
  });
  check('tường bao văn phòng chặn người chơi', wall.x > wall.x0 - 0.2, `dừng ở x=${wall.x.toFixed(2)} (mép trong ${wall.x0})`);
}

// 2. mô phỏng tới 10:00, bấm vào một người đang ngồi
await page.evaluate(() => { window.__app.setTime('10:00'); window.__app.floor(window.__app.app.model.desks[0].floor); window.__app.render(); });
const target = await page.evaluate(() => {
  const app = window.__app.app, cam = app.camera, a = app.sim.agents.find(x => x.atDesk && x.sit > 0.9);
  const v = new (cam.position.constructor)(a.x, a.y + 0.5 * (app.model.cs || 1) * 1.1, a.z).project(cam);
  const r = document.getElementById('c3').getBoundingClientRect();
  return { id: a.id, x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
});
await page.mouse.click(target.x, target.y);
await page.waitForTimeout(300);
const card = await page.evaluate(() => { const c = document.getElementById('card'); return c.hidden ? null : c.innerText; });
check('bấm vào avatar hiện thẻ thông tin', !!card && card.includes(target.id), card ? card.split('\n')[0] : 'không có thẻ');

// 3. danh sách: lọc phòng ban + tìm tên
await page.selectOption('#dept', 'Phòng Phát triển ứng dụng');
const nDept = await page.locator('#empList li').count();
await page.selectOption('#dept', '');
await page.fill('#search', 'Nhân viên 02');
const nSearch = await page.locator('#empList li').count();
check('lọc theo phòng ban và tìm tên', nDept === 8 && nSearch === 1, `phòng Phát triển ứng dụng: ${nDept}, tìm "Nhân viên 02": ${nSearch}`);
await page.fill('#search', ''); await page.selectOption('#dept', '');
await page.locator('#empList li').first().click();
const follow = await page.evaluate(() => !!window.__app.app.rig.follow);
check('bấm tên trong danh sách thì camera bám theo', follow);

// 4. nhập CSV: chuyển NV06 sang một bàn trống -> đứng dậy đi tới bàn mới
const csv = await page.evaluate(() => {
  const app = window.__app.app, used = new Set(app.sim.agents.map(x => x.desk.id)), free = app.model.desks.find(d => !used.has(d.id)).id;
  app.importCsv(`nhan_vien,ma_ban\nNV06,${free}\n`, 'test.csv');
  const a = app.sim.byId.get('NV06');
  window.__app.pause(false); app.sim.step(240);
  return { free, desk: a.desk.id, seated: a.atDesk && a.sit > 0.9, dist: Math.hypot(a.x - a.deskSeat.x, a.z - a.deskSeat.z), err: document.getElementById('errors').innerText };
});
check('nhập CSV đổi chỗ ngồi và cập nhật ngay', csv.desk === csv.free && csv.seated && csv.dist < 0.05, `NV06 ở ${csv.desk}, cách ghế ${csv.dist.toFixed(2)} m`);

// 5. sức chứa: nhiều người hơn số bàn
const nDesks = await page.evaluate(() => window.__app.app.model.desks.length), nOver = nDesks + 5;
await page.goto(`${url}?paused&n=${nOver}`);
await page.waitForFunction(() => window.__app?.ready, null, { timeout: 120000 });
const cap = await page.evaluate(() => ({ err: document.getElementById('errors').innerText, n: window.__app.app.sim.agents.length }));
check('quá số bàn thì báo lỗi rõ ràng, không đặt chồng', cap.err.includes(`${nOver} nhân viên nhưng layout.json chỉ có ${nDesks} bàn`) && cap.n === nDesks, `${cap.n} người được đưa vào mô hình`);

check('không có lỗi/cảnh báo trên console', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close(); server.stop();
process.exit(fail ? 1 : 0);
