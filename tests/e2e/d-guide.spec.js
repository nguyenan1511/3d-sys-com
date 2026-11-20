// Người hướng dẫn đón người mới: chào, hỏi phòng ban, nhận bàn trống của phòng đó, dẫn tới bàn, mời ngồi, giao việc tuần đầu.
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar, call, loginAdminAPI } from './helpers.js';
const LAYOUT_WORLD = JSON.parse(readFileSync(new URL('../../public/data/layout.json', import.meta.url), 'utf8')).world;

test.afterEach(closeAll);
test.setTimeout(240_000);

test('người mới vào: không còn bắt đầu ở cổng / đi theo chị Mai — chọn phòng ban, được xếp bàn Team Fresher và ngồi ngay; tự chấm công khi online', async ({ browser }) => {
  test.skip(LAYOUT_WORLD !== 'sysone-mo', 'người hướng dẫn chỉ có ở toà nhà lớn');
  const a = await newPage(browser, { guide: true });
  await loginEmployeeUI(a, `${uniqueCode()}-Mới`); await waitScene(a); await finishAvatar(a);
  // tự chấm công: online là đã vào ca (không cần ra máy chấm công)
  await expect.poll(async () => (await call(a, 'GET', '/api/attendance/me')).body.today?.checkIn || 0, { timeout: 15_000 }).toBeGreaterThan(0);
  // không có gợi ý đi qua cổng; hồ sơ chưa có phòng ban: chọn trong 13 phòng ngay trên màn hình
  await expect(a.locator('.gate-hint')).toHaveCount(0);
  const card = a.locator('.guide-card');
  await expect(card.locator('.gc-depts button')).toHaveCount(13, { timeout: 60_000 });
  await card.locator('.gc-depts button', { hasText: 'Team Fresher' }).click();
  // được xếp bàn Team Fresher và ngồi ngay tại bàn (không dẫn đường)
  await expect.poll(() => a.evaluate(() => window.__app.session.player.seated), { timeout: 30_000 }).toMatch(/^T1-(09|10|11|12)$/);
  const desk = await a.evaluate(() => window.__app.session.player.seated);
  expect(await a.evaluate(() => window.__app.session.mySeat?.deskId)).toBe(desk);
  await expect(card).toHaveCount(0);
  const saved = await a.evaluate(() => JSON.parse(localStorage.getItem('sysone.tasks.' + window.__app.session.me.employee.code)));
  expect(saved.dept).toBe('Team Fresher'); expect(saved.items.length).toBe(5);
  // "Gặp chị Mai": xem việc tuần đầu (không dẫn đi); "Về bàn" ngồi lại ngay
  await a.evaluate(() => { window.__app.session.guide.talk(); });   // (không chờ: talk() chỉ xong khi đóng thẻ)
  await expect(card.locator('.gc-tasks li')).toHaveCount(5);
  await card.locator('.gc-tasks input').first().check();
  await card.getByRole('button', { name: 'Cảm ơn chị!' }).click();
  expect((await a.evaluate(() => JSON.parse(localStorage.getItem('sysone.tasks.' + window.__app.session.me.employee.code)))).items[0].done).toBe(true);
});

test('chấm công: online là tự vào ca; máy cạnh cửa chính E → ra về; bảng trên bàn hiện đã đến; Admin xem bảng chấm công', async ({ browser }) => {
  test.skip(LAYOUT_WORLD !== 'sysone-mo', 'máy chấm công ở toà nhà lớn');
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Công`); await waitScene(a); await finishAvatar(a);
  await expect.poll(() => a.evaluate(() => window.__app.app.mode2d)).toBe(false); // (mặc định 3D)
  const desk = (await call(a, 'GET', '/api/seats')).body.seats.find(x => x.floor === 0 && !x.owner && x.kind === 'desk').deskId;
  expect((await call(a, 'POST', `/api/seats/${desk}/claim`, {})).status).toBe(200);
  await a.evaluate(() => { const s = window.__app.session, st = s.att.spot.stand; Object.assign(s.player.agent, { x: st.x, z: st.z, y: 0.05, f: 0 }); s.player.follow(); });
  // tự chấm công khi online: tới máy là đã vào ca, chỉ còn "ra về"
  await expect(a.locator('#hudPrompt')).toContainText('chấm công ra về');
  await a.keyboard.press('e');
  await expect(a.locator('.att-card')).toContainText('Chấm công ra về');
  const me = (await call(a, 'GET', '/api/attendance/me')).body.today;
  expect(me.checkIn).toBeGreaterThan(0); expect(me.checkOut).toBeNull();
  // bảng thông tin trên bàn: đã đến (chưa ngồi)
  await expect.poll(() => a.evaluate(d => window.__app.app.deskInfoSig?.(d) || '', desk), { timeout: 15_000 }).toContain('Đã đến');
  await a.locator('.att-card .att-go').click();
  await expect.poll(async () => (await call(a, 'GET', '/api/attendance/me')).body.today.checkOut).toBeGreaterThan(0);
  // Admin xem bảng chấm công trong ngày
  const ceo = await newPage(browser); await loginAdminAPI(ceo);
  const r = await call(ceo, 'GET', '/api/admin/attendance');
  expect(r.body.list.some(x => x.display.endsWith('-Công') && x.checkOut)).toBe(true);
  expect((await call(a, 'GET', '/api/admin/attendance')).status).toBe(403);
});

test('góc âm nhạc: đi tới máy hát bấm E, dán link YouTube (cần Admin cấp quyền); cả công ty cùng nghe, thanh điều khiển chỉ người có quyền dùng được', async ({ browser }) => {
  test.skip(LAYOUT_WORLD !== 'sysone-mo', 'góc âm nhạc ở toà nhà lớn');
  const a = await newPage(browser), b = await newPage(browser);
  await loginEmployeeUI(a, `${uniqueCode()}-Nhạc`); await waitScene(a); await finishAvatar(a);
  const code = await a.evaluate(() => window.__app.session.me.employee.code);
  await loginEmployeeUI(b, `${uniqueCode()}-Nghe`); await waitScene(b); await finishAvatar(b);
  await expect(a.locator('.music-bar')).not.toHaveClass(/show/);                // chưa phát: không có thanh nhạc
  await a.evaluate(() => { const s = window.__app.session, mc = window.__app.app.musicCorner; Object.assign(s.player.agent, { x: mc.stand.x, z: mc.stand.z, y: 0.05, f: 0 }); s.player.follow(); });
  await expect(a.locator('#hudPrompt')).toContainText('nhạc');
  await a.keyboard.press('e');
  await expect(a.locator('.music-pop .mu-deny')).toBeVisible();                  // chưa có quyền
  await expect(a.locator('.music-pop .mu-form')).toBeHidden();
  const ceo = await newPage(browser); await loginAdminAPI(ceo);
  expect((await call(ceo, 'POST', `/api/v1/admin/music/${code}`, { allow: true })).status).toBe(200);
  await expect(a.locator('.music-pop .mu-form')).toBeVisible({ timeout: 10_000 });   // bảng tự cập nhật khi được cấp quyền
  await a.locator('.music-pop .mu-url').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await a.locator('.music-pop .mu-go').click();
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

test('bảng công: nhân viên mở bảng công tháng/năm của mình; Admin xem bảng tháng của mọi người', async ({ browser }) => {
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
