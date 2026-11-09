import fs from 'fs';
import { readFileSync } from 'node:fs';
const LAYOUT_WORLD = JSON.parse(readFileSync(new URL('../../public/data/layout.json', import.meta.url), 'utf8')).world;
const ENABLE_2D = /export const ENABLE_2D = true/.test(readFileSync(new URL('../../src/pixel/billboard.js', import.meta.url), 'utf8')); // bản 2D đang tạm ẩn
// Điều khiển nhân vật bằng bàn phím: đi, nhảy, động tác đồng bộ cho người khác, E chỉ ngồi được chỗ của mình.
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, call, freeDesk } from './helpers.js';
import { newPage, closeAll, finishAvatar } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(180_000);

const state = p => p.evaluate(() => { const a = window.__app.session.player.agent; return { x: a.x, y: a.y, z: a.z, f: a.f, sit: a.sit, act: a.act }; });
const putNear = (p, deskId, dx = 0.35, dz = 0.35) => p.evaluate(([id, dx, dz]) => { const pl = window.__app.session.player, d = window.__app.app.model.deskById.get(id); Object.assign(pl.agent, { x: d.seat.x + dx, z: d.seat.z + dz, y: window.__app.app.model.floorY(d.floor), f: d.floor }); }, [deskId, dx, dz]);

test('di chuyển bằng phím, nhảy, động tác được người khác thấy; E chỉ ngồi được chỗ của mình', async ({ browser }) => {
  const ca = uniqueCode(), cb = uniqueCode();
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${ca}-An`); await waitScene(a); await finishAvatar(a);
  const mine = await freeDesk(a);
  expect((await call(a, 'POST', `/api/seats/${mine}/claim`, {})).status).toBe(200);
  await a.evaluate(() => window.__app.session.player.follow());
  await a.locator('#ctrlNav .keys-btn').waitFor();

  // đi về phía trước 1 giây: vị trí phải đổi
  // (giữ W tới khi đi được: vừa đóng "Chọn chỗ" bản đồ còn đang chuyển cảnh, máy test chạy 12 khung/giây)
  const s0 = await state(a);
  const tW = Date.now();
  await a.keyboard.down('w');
  await expect.poll(async () => { const s = await state(a); return Math.hypot(s.x - s0.x, s.z - s0.z); }, { timeout: 5000 }).toBeGreaterThan(0.3);
  await a.keyboard.up('w');
  const s1 = await state(a);
  // không nhanh hơn tốc độ chạy (bắt lỗi vòng lặp tính sai thời gian mỗi khung → nhân vật "bay" rồi kẹt vào tường)
  const run = await a.evaluate(() => window.__app.session.player.RUN);
  expect(Math.hypot(s1.x - s0.x, s1.z - s0.z)).toBeLessThan(run * 1.3 * ((Date.now() - tW) / 1000) + 0.3);
  // nhảy: lên khỏi mặt đất rồi rơi xuống
  // nhảy (nhân vật tỉ lệ 0.5): nhún lấy đà 0.12 s, cao ~0.27 m
  // (máy test vẽ một khung mất ~1 s: cả cú nhảy có thể nằm gọn trong một khung — đọc độ cao cao nhất mà nhân vật ghi lại)
  await a.keyboard.press('Space');
  await expect.poll(() => a.evaluate(() => window.__app.session.player.lastJumpPeak), { timeout: 4000 }).not.toBeNull();
  expect(await a.evaluate(() => window.__app.session.player.lastJumpPeak) - s1.y).toBeGreaterThan(0.15);
  await expect.poll(async () => Math.abs((await state(a)).y - s1.y), { timeout: 3000 }).toBeLessThan(0.05);

  // quy định: không hút thuốc trong văn phòng — trong nhà bấm 2 bị từ chối, có thông báo
  const b = await newPage(browser);
  await loginEmployeeUI(b, `${cb}-Bình`); await waitScene(b); await finishAvatar(b);
  const pos0 = await a.evaluate(() => { const g = window.__app.session.player.agent; return { x: g.x, y: g.y, z: g.z, f: g.f }; });
  await a.evaluate(() => Object.assign(window.__app.session.player.agent, { x: 0.3, z: -1.25 }));
  await a.keyboard.press('2');
  expect((await state(a)).act).toBe(null);
  await expect(a.locator('#toast')).toContainText('Không hút thuốc trong văn phòng');
  // ra vỉa hè thì được hút; B thấy động tác hút thuốc của A
  await a.evaluate(() => Object.assign(window.__app.session.player.agent, { x: 1.5, y: 0.15, z: 11, f: 0 }));
  await a.waitForTimeout(300);
  await a.keyboard.press('2');
  expect((await state(a)).act).toBe('smoke');
  await expect.poll(() => b.evaluate(k => window.__app.session.remote.byKey.get(k)?.act ?? null, `employee:${ca}`)).toBe('smoke');
  await a.keyboard.press('2');
  await expect.poll(() => b.evaluate(k => window.__app.session.remote.byKey.get(k)?.act ?? null, `employee:${ca}`)).toBe(null);
  await a.evaluate(p => Object.assign(window.__app.session.player.agent, p), pos0); // về chỗ cũ cho phần sau

  // B đứng cạnh ghế của A bấm E: bị từ chối
  await b.evaluate(() => window.__app.session.endPick());
  await putNear(b, mine);
  await b.keyboard.press('e');
  await expect(b.locator('#toast')).toHaveText(`Chỗ này thuộc về ${ca}-An`);
  expect((await state(b)).sit).toBe(0);

  // A đứng cạnh ghế của mình bấm E: ngồi xuống, B thấy A ngồi đúng chỗ
  await putNear(a, mine);
  await a.keyboard.press('e');
  await expect.poll(() => state(a).then(s => s.sit)).toBe(1);
  await expect.poll(() => b.evaluate(k => window.__app.session.remote.byKey.get(k)?.seated ?? null, `employee:${ca}`)).toBe(mine);
  // bấm W khi đang ngồi: đứng dậy
  await a.keyboard.down('w'); await a.waitForTimeout(800); await a.keyboard.up('w');
  await expect.poll(() => a.evaluate(() => window.__app.session.seated)).toBe(null);
});

test('xuống lòng đường: hiện cảnh báo, xe dừng lại, bấm còi và tài xế chửi', async ({ browser }) => {
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Tâm`); await waitScene(a); await finishAvatar(a);
  await a.evaluate(() => { window.__app.session.endPick(); const pl = window.__app.session.player; Object.assign(pl.agent, { x: 1.0, z: 15.0, y: 0.01, f: 0 }); pl.follow(); });
  await expect(a.locator('#roadWarn')).toBeVisible();
  await expect(a.locator('#roadWarn')).toContainText('lòng đường');
  // có xe trong làn z=15 dừng trước mặt nhân vật, bong bóng chữ hiện, lời chửi hiện trong cảnh báo
  await expect(a.locator('#roadWarn .insult')).toContainText('Tài xế', { timeout: 30_000 });
  const stopped = await a.evaluate(() => window.__app.app.street.movers.filter(m => Math.abs(m.o.position.z - 15) < 0.5 && m.speed < 1.0 && m.bubble).length);
  expect(stopped).toBeGreaterThan(0);
  // lên lề thì hết cảnh báo, xe chạy tiếp
  await a.evaluate(() => Object.assign(window.__app.session.player.agent, { z: 10.5, y: 0.15 }));
  await expect(a.locator('#roadWarn')).toBeHidden();
  await expect.poll(() => a.evaluate(() => Math.max(...window.__app.app.street.movers.filter(m => Math.abs(m.o.position.z - 15) < 0.5).map(m => m.speed))), { timeout: 10_000 }).toBeGreaterThan(3);
});

test('kéo rèm bằng phím F đồng bộ cho người khác và được lưu lại', async ({ browser }) => {
  const a = await newPage(browser);
  test.skip(LAYOUT_WORLD === 'my-office', 'nội thất my-office không có rèm cửa sổ');
  await loginEmployeeUI(a, `${uniqueCode()}-Lam`); await waitScene(a); await finishAvatar(a);

  const b = await newPage(browser);
  await loginEmployeeUI(b, `${uniqueCode()}-Quân`); await waitScene(b); await finishAvatar(b);
  // đứng trước một rèm tầng 2 (nhà cũ: cửa sổ lồi f1-bay; toà nhà lớn: rèm tre đầu tiên của tầng 2)
  const id = await a.evaluate(() => {
    window.__app.session.endPick(); const s = window.__app.session, pl = s.player, it = s.blinds.byId.get('f1-bay') || s.blinds.items.find(i => i.floor === 1);
    const u = (it.a0 + it.a1) / 2, p = it.c + it.n * 0.5, y = window.__app.app.model.floorY(1);
    Object.assign(pl.agent, it.axis === 'z' ? { x: p, z: u } : { x: u, z: p }, { y, f: 1 });
    return it.id;
  });
  await expect(a.locator('#hudPrompt')).toContainText('tầng 2');
  const before = await b.evaluate(id => window.__app.session.blinds.byId.get(id).open, id);
  await a.keyboard.press('f');
  await expect.poll(() => b.evaluate(id => window.__app.session.blinds.byId.get(id).open, id)).toBe(!before);
  // tải lại trang vẫn giữ trạng thái rèm
  await b.reload(); await waitScene(b);
  await expect.poll(() => b.evaluate(id => window.__app.session.blinds.byId.get(id).open, id)).toBe(!before);
});

test('thang máy: đứng trước cửa bấm E, chọn tầng 3 thì ra ở tầng 3; bản đồ nhỏ theo tầng', async ({ browser }) => {
  test.skip(LAYOUT_WORLD !== 'sysone-mo', 'chỉ toà nhà lớn có thang máy');
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Thang`); await waitScene(a); await finishAvatar(a);
  await expect.poll(() => a.evaluate(() => window.__app.app.mode2d)).toBe(false); // (mặc định 3D)
  await a.evaluate(() => { window.__app.session.endPick(); const s = window.__app.session, L = s.lift.stops[0]; Object.assign(s.player.agent, { x: L.x, z: L.z, y: L.y, f: 0 }); s.player.follow(); });
  await expect(a.locator('#hudPrompt')).toContainText('thang máy');
  await expect(a.locator('#minimap .mm-floor')).toHaveText('Tầng trệt');
  await a.keyboard.press('e');
  await expect(a.locator('.lift-box')).toBeVisible();
  await a.keyboard.press('3');
  await expect.poll(() => a.evaluate(() => window.__app.session.player.agent.f), { timeout: 10_000 }).toBe(2);
  await expect(a.locator('#minimap .mm-floor')).toHaveText('Tầng 3');
  // bấm tầng trệt trên bảng chọn tầng
  await a.keyboard.press('e'); await a.locator('.lift-box button[data-f="0"]').click();
  await expect.poll(() => a.evaluate(() => window.__app.session.player.agent.f), { timeout: 10_000 }).toBe(0);
});

test('ngồi sofa xem TV ở khu giải trí: E ngồi, TV bật, người khác thấy đang ngồi xem; E đứng dậy thì TV tắt', async ({ browser }) => {
  test.skip(LAYOUT_WORLD !== 'sysone-mo', 'chỉ toà nhà lớn có khu giải trí my-office');
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Tivi`); await waitScene(a); await finishAvatar(a);
  const b = await newPage(browser);
  await loginEmployeeUI(b, `${uniqueCode()}-Xem`); await waitScene(b); await finishAvatar(b);
  await a.evaluate(() => { window.__app.session.endPick(); const s = window.__app.session, st = s.tv.seats[0]; Object.assign(s.player.agent, { x: st.front.x, z: st.front.z + 0.2, y: 0.05, f: 0 }); });
  await expect(a.locator('#hudPrompt')).toContainText('xem TV');
  await a.keyboard.press('e');
  await expect.poll(() => a.evaluate(() => { const s = window.__app.session, p = s.player.agent; return p.sit > 0.95 && p.act === 'tv' && s.tv.on; }), { timeout: 10_000 }).toBe(true);
  const key = await a.evaluate(() => window.__app.session.key);
  await expect.poll(() => b.evaluate(k => { const r = window.__app.session.remote.byKey.get(k); return !!r && r.act === 'tv' && r.sit > 0.9 && window.__app.session.tv.on; }, key), { timeout: 15_000 }).toBe(true);
  await a.keyboard.press('e');
  await expect.poll(() => a.evaluate(() => { const s = window.__app.session; return s.player.agent.act === null && !s.tv.on; }), { timeout: 10_000 }).toBe(true);
});

test('nút 2D/3D đổi cả không gian: 2D là bản đồ pixel ở mọi nơi (kể cả đường phố), 3D là cảnh 3D', async ({ browser }) => {
  test.skip(!ENABLE_2D, 'bản 2D đang tạm ẩn (bật lại: ENABLE_2D trong src/pixel/billboard.js)');
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Hoa`); await waitScene(a);
  await a.locator('.px-card[data-kind="mo-dev"]').click();
  await a.click('#avSave');
  expect((await call(a, 'GET', '/api/me')).body.employee.look.pixel).toBe('mo-dev');
  await a.waitForFunction(() => window.__app.session.synced);
  // ngoài vỉa hè, chế độ 2D (mặc định) → bản đồ 2D
  await a.evaluate(() => { const pl = window.__app.session.player; Object.assign(pl.agent, { x: 1.55, z: 10.5, y: 0.15, f: 0, yaw: 0 }); pl.follow(); });
  await expect.poll(() => a.evaluate(() => window.__app.app.mode2d)).toBe(true);
  await expect(a.locator('#map2d')).toBeVisible();
  // bấm 3D → cảnh 3D (cả không gian, không chỉ nhân vật)
  await a.click('#view3d');
  await expect.poll(() => a.evaluate(() => window.__app.app.mode2d)).toBe(false);
  await expect(a.locator('#map2d')).toBeHidden();
  // vào trong nhà vẫn 3D; bấm 2D → về 2D
  await a.evaluate(() => { const pl = window.__app.session.player; Object.assign(pl.agent, { x: 1.3, z: -1.0 }); });
  await a.waitForTimeout(500);
  expect(await a.evaluate(() => window.__app.app.mode2d)).toBe(false);
  await a.click('#view2d');
  await expect.poll(() => a.evaluate(() => window.__app.app.mode2d)).toBe(true);
});

test('hai chế độ 2D (mặc định) và 3D dùng chung bản đồ: người ở 3D thấy người ở 2D đúng chỗ', async ({ browser }) => {
  test.skip(!ENABLE_2D, 'bản 2D đang tạm ẩn (bật lại: ENABLE_2D trong src/pixel/billboard.js)');
  const a = await newPage(browser), b = await newPage(browser);
  const ca = uniqueCode(), cb = uniqueCode();
  await loginEmployeeUI(a, `${ca}-An`); await waitScene(a); await finishAvatar(a);
  await loginEmployeeUI(b, `${cb}-Bình`); await waitScene(b); await finishAvatar(b);
  expect(await a.evaluate(() => localStorage.getItem('sysone.view'))).toBeNull(); // mặc định 2D
  await expect(a.locator('#view2d')).toHaveAttribute('aria-pressed', 'true');
  await b.click('#view3d');
  expect(await b.evaluate(() => localStorage.getItem('sysone.view'))).toBe('3d');
  await a.evaluate(() => { window.__app.session.endPick?.(); const pl = window.__app.session.player; Object.assign(pl.agent, { x: 0.4, z: -2.5, y: window.__app.app.model.floorY(0), f: 0 }); pl.send(true); });
  await expect.poll(() => a.evaluate(() => window.__app.app.mode2d)).toBe(true);
  await expect.poll(() => b.evaluate(k => { const r = window.__app.session.remote.byKey.get(k); return r ? [+r.x.toFixed(1), +r.z.toFixed(1), r.f] : null; }, `employee:${ca}`), { timeout: 15000 }).toEqual([0.4, -2.5, 0]);
  await expect.poll(() => b.evaluate(() => window.__app.app.mode2d)).toBe(false);
});


test('lần đầu vào: nhân viên không tự chọn chỗ (không có nút Chọn chỗ); mặc định 3D, không có nút 2D', async ({ browser }) => {
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Mai`); await waitScene(a); await finishAvatar(a);
  await expect(a.locator('#seatBox')).toContainText('Bạn chưa có chỗ ngồi');
  await expect(a.locator('#btnPick')).toHaveCount(0);
  await expect(a.locator('#btnMove')).toHaveCount(0);
  expect(await a.evaluate(() => window.__app.session.selecting)).toBe(false);
  await expect.poll(() => a.evaluate(() => window.__app.app.mode2d)).toBe(false);         // mặc định 3D (bản 2D tạm ẩn)
  await expect(a.locator('#view2d')).toHaveCount(0);
});

test('bản 2D: tâm màn hình luôn theo nhân vật', async ({ browser }) => {
  test.skip(!ENABLE_2D, 'bản 2D đang tạm ẩn (bật lại: ENABLE_2D trong src/pixel/billboard.js)');
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Vy`); await waitScene(a); await finishAvatar(a);
  await expect.poll(() => a.evaluate(() => window.__app.app.mode2d)).toBe(true);
  await a.locator('#map2d').focus();
  await a.keyboard.down('s'); await a.waitForTimeout(1200); await a.keyboard.up('s');
  // camera đuổi kịp nhân vật (lệch < 5 cm)
  await expect.poll(() => a.evaluate(() => { const c = window.__app.mapCenter(); return Math.hypot(c.dx, c.dz); }), { timeout: 5000 }).toBeLessThan(0.05);
});

test('phím B: tự về bàn làm việc (khác tầng thì đi thang máy) và ngồi vào ghế', async ({ browser }) => {
  test.skip(LAYOUT_WORLD !== 'sysone-mo', 'thang máy ở toà nhà lớn');
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Về`); await waitScene(a); await finishAvatar(a);
  const desk = (await call(a, 'GET', '/api/v1/seats')).body.seats.find(s => s.floor === 1 && !s.owner && !s.locked && s.kind === 'desk').deskId;
  expect((await call(a, 'POST', `/api/v1/seats/${desk}/claim`, {})).status).toBe(200);
  await expect(a.locator('#seatBox')).toContainText(desk);
  await a.evaluate(() => { const s = window.__app.session, l = window.__app.app.model.waypoints.lobby; Object.assign(s.player.agent, { x: l.x, z: l.z, y: 0.05, f: 0 }); s.player.follow(); });
  await a.locator('#c3').focus();
  await a.keyboard.press('b');
  await expect.poll(() => a.evaluate(() => window.__app.session.player.seated), { timeout: 90_000 }).toBe(desk);
  expect(await a.evaluate(() => window.__app.session.player.agent.f)).toBe(1);
});

test('bấm lên sàn ở tầng 2: nhân vật đi tới đó trong tầng 2, không chạy xuống tầng trệt', async ({ browser }) => {
  test.skip(LAYOUT_WORLD !== 'sysone-mo', 'toà nhà lớn');
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Tầng`); await waitScene(a); await finishAvatar(a);
  await a.evaluate(() => { const s = window.__app.session; Object.assign(s.player.agent, { x: 1.2, z: -6.0, y: 4.55, f: 1 }); s.player.follow(); const r = window.__app.app.rig; r.G.th = r.S.th = 0; document.querySelector('#panel')?.setAttribute('hidden', ''); });
  await a.waitForTimeout(2000);
  const pt = await a.evaluate(() => { const app = window.__app.app, v = new (app.camera.position.constructor)(1.2, 4.56, -10.5).project(app.camera), r = document.getElementById('c3').getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; });
  // ghi lại đường đi ngay khi được lập (đường ngắn có thể đi xong trong một khung hình chậm của máy test)
  await a.evaluate(() => { const pl = window.__app.session.player, f = pl.walkTo.bind(pl); pl.walkTo = (...x) => { const ok = f(...x); window.__lastPath = pl.path ? pl.path.slice() : null; return ok; }; });
  await a.mouse.click(pt.x, pt.y);
  await expect.poll(() => a.evaluate(() => (window.__lastPath || []).length)).toBeGreaterThan(0);
  expect(await a.evaluate(() => window.__lastPath.every(p => p.f === undefined || p.f === 1))).toBe(true);
  await expect.poll(() => a.evaluate(() => window.__app.session.player.path), { timeout: 30_000 }).toBe(null);
  const end = await a.evaluate(() => { const p = window.__app.session.player.agent; return { f: p.f, z: p.z }; });
  expect(end.f).toBe(1); expect(end.z).toBeLessThan(-9.5);
});

test('Đi nhanh tới: bấm một nơi trong danh sách → nhân vật tới đúng tầng, đứng ở chỗ đi được; "Bàn của tôi" → ngồi luôn', async ({ browser }) => {
  test.skip(LAYOUT_WORLD !== 'sysone-mo', 'toà nhà lớn');
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Nhanh`); await waitScene(a); await finishAvatar(a);
  await expect(a.locator('#viewBox summary h2')).toHaveText('Đi nhanh tới');
  await a.evaluate(() => { document.getElementById('viewBox').open = true; });
  await a.locator('.qt-item', { hasText: 'Team Đối tác' }).click();
  await expect.poll(() => a.evaluate(() => window.__app.session.player.agent.f), { timeout: 10_000 }).toBe(2);
  expect(await a.evaluate(() => { const p = window.__app.session.player; return p.walkable(p.agent.x, p.agent.z); })).toBe(true);
  await a.locator('.qt-item', { hasText: 'Ngoài đường' }).click();
  await expect.poll(() => a.evaluate(() => window.__app.session.player.agent.f), { timeout: 10_000 }).toBe(0);
  const desk = (await call(a, 'GET', '/api/v1/seats')).body.seats.find(s => s.floor === 1 && !s.owner && !s.locked && s.kind === 'desk').deskId;
  expect((await call(a, 'POST', `/api/v1/seats/${desk}/claim`, {})).status).toBe(200);
  await a.locator('.qt-desk').click();
  await expect.poll(() => a.evaluate(() => window.__app.session.player.seated), { timeout: 20_000 }).toBe(desk);
});
