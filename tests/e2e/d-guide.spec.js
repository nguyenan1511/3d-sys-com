// Người hướng dẫn đón người mới: chào, hỏi phòng ban, nhận bàn trống của phòng đó, dẫn tới bàn, mời ngồi, giao việc tuần đầu.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar, call, loginAdminAPI } from './helpers.js';
const LAYOUT_WORLD = JSON.parse(readFileSync(new URL('../../public/data/layout.json', import.meta.url), 'utf8')).world;

test.afterEach(closeAll);
test.setTimeout(240_000);

test('người mới vào: đứng trước cổng, vào sảnh thì chị hướng dẫn ra đón, hỏi phòng ban, dẫn tới bàn của Team Fresher, mời ngồi và giao việc tuần đầu', async ({ browser }) => {
  test.skip(LAYOUT_WORLD !== 'sysone-mo', 'người hướng dẫn chỉ có ở toà nhà lớn');
  const a = await newPage(browser, { guide: true });
  await loginEmployeeUI(a, `${uniqueCode()}-Mới`); await waitScene(a); await finishAvatar(a);
  // mở đầu: đứng trên vỉa hè trước cổng, có gợi ý đi vào cửa chính; chị Mai chưa ra đón
  await expect(a.locator('.gate-hint')).toContainText('cửa chính', { timeout: 60_000 });
  const start = await a.evaluate(() => { const p = window.__app.session.player.agent, w = window.__app.app.model.waypoints; return { z: p.z, gateZ: w.gate.z }; });
  expect(start.z).toBeGreaterThan(start.gateZ);
  await expect(a.locator('.guide-card')).toHaveCount(0);
  // đi vào tới sảnh → chị Mai ra đón
  await a.evaluate(() => { const p = window.__app.session.player.agent, l = window.__app.app.model.waypoints.lobby; Object.assign(p, { x: l.x, z: l.z, y: 0.05, f: 0 }); });
  await expect(a.locator('.gate-hint')).toHaveCount(0);
  const card = a.locator('.guide-card');
  await expect(card).toContainText('Chào mừng bạn đến công ty', { timeout: 60_000 });
  await card.getByRole('button', { name: 'Chào chị!' }).click();
  await expect(card).toContainText('Toà nhà mình có 3 tầng');
  await card.getByRole('button', { name: 'Dạ, em hiểu rồi' }).click();
  // chấm công đầu ngày (chị Mai chấm giúp lần đầu)
  await expect(card).toContainText('chấm công');
  await card.getByRole('button', { name: 'Chấm công' }).click();
  await expect(card).toContainText('Đã chấm công vào ca');
  await card.getByRole('button', { name: 'Dạ' }).click();
  expect((await call(a, 'GET', '/api/attendance/me')).body.today.checkIn).toBeGreaterThan(0);
  // hồ sơ chưa có phòng ban: chọn trong 13 phòng
  await expect(card.locator('.gc-depts button')).toHaveCount(13);
  await card.locator('.gc-depts button', { hasText: 'Team Fresher' }).click();
  await expect(card).toContainText('Team Fresher');
  const desk = await card.locator('.gc-text b').nth(1).textContent();
  expect(['T1-09', 'T1-10', 'T1-11', 'T1-12']).toContain(desk);
  await card.getByRole('button', { name: 'Đi theo chị' }).click();
  // được dẫn tới bàn và ngồi xuống; nhận danh sách việc tuần đầu
  await expect.poll(() => a.evaluate(() => window.__app.session.player.seated), { timeout: 120_000 }).toBe(desk);
  await expect(card.locator('.gc-tasks li')).toHaveCount(5, { timeout: 15_000 });
  await card.locator('.gc-tasks input').first().check();
  await card.getByRole('button', { name: 'Cảm ơn chị!' }).click();
  const saved = await a.evaluate(() => JSON.parse(localStorage.getItem('sysone.tasks.' + window.__app.session.me.employee.code)));
  expect(saved.dept).toBe('Team Fresher');
  expect(saved.items[0].done).toBe(true);
  expect(await a.evaluate(() => window.__app.session.mySeat?.deskId)).toBe(desk);
});

test('chấm công ở máy cạnh cửa chính: E → vào ca, bảng trên bàn hiện đã đến; ra về; CEO xem bảng chấm công', async ({ browser }) => {
  test.skip(LAYOUT_WORLD !== 'sysone-mo', 'máy chấm công ở toà nhà lớn');
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Công`); await waitScene(a); await finishAvatar(a);
  await expect.poll(() => a.evaluate(() => window.__app.app.mode2d)).toBe(false); // (mặc định 3D)
  const desk = (await call(a, 'GET', '/api/seats')).body.seats.find(x => x.floor === 0 && !x.owner && x.kind === 'desk').deskId;
  expect((await call(a, 'POST', `/api/seats/${desk}/claim`, {})).status).toBe(200);
  await a.evaluate(() => { const s = window.__app.session, st = s.att.spot.stand; Object.assign(s.player.agent, { x: st.x, z: st.z, y: 0.05, f: 0 }); s.player.follow(); });
  await expect(a.locator('#hudPrompt')).toContainText('chấm công vào ca');
  await a.keyboard.press('e');
  await a.locator('.att-card .att-go').click();
  await expect(a.locator('.att-card')).toContainText('Chấm công ra về');
  const me = (await call(a, 'GET', '/api/attendance/me')).body.today;
  expect(me.checkIn).toBeGreaterThan(0); expect(me.checkOut).toBeNull();
  // bảng thông tin trên bàn: đã đến (chưa ngồi)
  await expect.poll(() => a.evaluate(d => window.__app.app.deskInfoSig?.(d) || '', desk), { timeout: 15_000 }).toContain('Đã đến');
  await a.locator('.att-card .att-go').click();
  await expect.poll(async () => (await call(a, 'GET', '/api/attendance/me')).body.today.checkOut).toBeGreaterThan(0);
  // CEO xem bảng chấm công trong ngày
  const ceo = await newPage(browser); await loginAdminAPI(ceo);
  const r = await call(ceo, 'GET', '/api/admin/attendance');
  expect(r.body.list.some(x => x.display.endsWith('-Công') && x.checkOut)).toBe(true);
  expect((await call(a, 'GET', '/api/admin/attendance')).status).toBe(403);
});

test('góc âm nhạc: đi tới máy hát bấm E, dán link YouTube (cần CEO cấp quyền); cả công ty cùng nghe, thanh điều khiển chỉ người có quyền dùng được', async ({ browser }) => {
  test.skip(LAYOUT_WORLD !== 'sysone-mo', 'góc âm nhạc ở toà nhà lớn');
  const a = await newPage(browser), b = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Nhạc`); await waitScene(a); await finishAvatar(a);
  const code = await a.evaluate(() => window.__app.session.me.employee.code);
  await loginEmployeeUI(b, `${uniqueCode()}-Nghe`); await waitScene(b); await finishAvatar(b);
  await expect(a.locator('.music-bar')).not.toHaveClass(/show/);                // chưa phát: không có thanh nhạc
  await a.evaluate(() => { const s = window.__app.session, mc = window.__app.app.musicCorner; Object.assign(s.player.agent, { x: mc.stand.x, z: mc.stand.z, y: 0.05, f: 0 }); s.player.follow(); });
  await expect(a.locator('#hudPrompt')).toContainText('nhạc');
  await a.keyboard.press('e');
  await expect(a.locator('.music-pop .mp-deny')).toBeVisible();                  // chưa có quyền
  await expect(a.locator('.music-pop .mp-form')).toBeHidden();
  const ceo = await newPage(browser); await loginAdminAPI(ceo);
  expect((await call(ceo, 'POST', `/api/v1/admin/music/${code}`, { allow: true })).status).toBe(200);
  await expect(a.locator('.music-pop .mp-form')).toBeVisible({ timeout: 10_000 });   // bảng tự cập nhật khi được cấp quyền
  await a.locator('.music-pop .mp-url').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await a.locator('.music-pop .mp-go').click();
  // cả công ty nhận trạng thái; thanh nhạc hiện ở mọi người; B không có quyền → nút điều khiển bị khoá, âm lượng riêng vẫn chỉnh được
  await expect.poll(() => b.evaluate(() => window.__app.session.social.musicState.videoId)).toBe('dQw4w9WgXcQ');
  await expect(b.locator('.music-bar')).toHaveClass(/show/);
  await expect(b.locator('.music-bar .mb-play')).toBeDisabled();
  await expect(b.locator('.music-bar .mb-vol')).toBeEnabled();
  // thu gọn / mở thanh nhạc (nhớ lựa chọn)
  await b.locator('.music-bar .mb-toggle').click();
  await expect(b.locator('.music-bar')).toHaveClass(/collapsed/);
  expect(await b.evaluate(() => localStorage.getItem('sysone.musicbar'))).toBe('0');
  await b.locator('.music-bar .mb-thumb').click();
  await expect(b.locator('.music-bar')).not.toHaveClass(/collapsed/);
  // A tạm dừng từ thanh điều khiển → B thấy tạm dừng
  await a.keyboard.press('Escape');
  await a.locator('.music-bar .mb-play').click();
  await expect.poll(() => b.evaluate(() => window.__app.session.social.musicState.paused)).toBe(true);
});

test('bảng công: nhân viên mở bảng công tháng/năm của mình; CEO xem bảng tháng của mọi người', async ({ browser }) => {
  test.skip(LAYOUT_WORLD !== 'sysone-mo', 'chấm công ở toà nhà lớn');
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Bảng`); await waitScene(a); await finishAvatar(a);
  expect((await call(a, 'POST', '/api/v1/attendance/checkin', {})).status).toBe(200);
  await a.click('#btnTimesheet');
  await expect(a.locator('.ts-pop .ts-cal')).toBeVisible({ timeout: 15_000 });
  await expect(a.locator('.ts-pop .ts-cell.is-today')).toHaveCount(1);
  await expect(a.locator('.ts-pop .ts-sum')).toContainText('Ngày đi làm');
  await a.locator('.ts-pop [data-tab="year"]').click();
  await expect(a.locator('.ts-pop .ts-table tbody tr')).toHaveCount(13);
  const ceo = await newPage(browser); await loginAdminAPI(ceo);
  const ym = (await call(a, 'GET', '/api/v1/attendance/me')).body.today.day.slice(0, 7);
  const m = (await call(ceo, 'GET', `/api/v1/admin/attendance/month?ym=${ym}`)).body;
  expect(m.employees.some(e => e.display.endsWith('-Bảng') && e.summary.present === 1 && e.summary.absent === 0)).toBe(true);
});
