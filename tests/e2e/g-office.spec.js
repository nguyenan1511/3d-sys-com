// Công tắc đèn công ty (cạnh máy chấm công) và nhà vệ sinh (buồng có khoá, gương soi được).
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar, call, loginAdminAPI } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(240_000);

const pressE = p => p.evaluate(() => window.__app.session.player.onKey({ key: 'e', type: 'keydown', repeat: false, preventDefault() {}, stopPropagation() {} }));
const goTo = (p, where) => p.evaluate(w => {
  const s = window.__app.session, a = s.player.agent, pt = w === 'switch' ? s.lights.spot.stand : w === 'sink' ? s.wc.sink : s.wc.stalls[0].out;
  Object.assign(a, { x: pt.x, z: pt.z, y: window.__app.app.model.floorY(0), f: 0 }); s.player.follow();
}, where);
const prompt = p => p.evaluate(() => document.getElementById('hudPrompt')?.textContent || '');

test('đèn công ty: chỉ người được CEO cấp quyền mới bật được; bật đèn thì cả công ty chuyển sang buổi tối', async ({ browser }) => {
  const ca = uniqueCode();
  const a = await newPage(browser); await loginEmployeeUI(a, `${ca}-Lan`); await waitScene(a); await finishAvatar(a);
  const b = await newPage(browser); await loginEmployeeUI(b, `${uniqueCode()}-Hoa`); await waitScene(b); await finishAvatar(b);
  await goTo(a, 'switch');
  await expect.poll(() => prompt(a)).toContain('công tắc đèn');
  await pressE(a);
  await expect(a.locator('.light-pop .lp-toggle')).toBeDisabled();
  await expect(a.locator('.light-pop .lp-deny')).toBeVisible();
  // CEO cấp quyền → nút bật được ngay (không cần tải lại)
  const ceo = await newPage(browser); await loginAdminAPI(ceo);
  expect((await call(ceo, 'POST', `/api/admin/lights/${ca}`, { allow: true })).status).toBe(200);
  await expect(a.locator('.light-pop .lp-toggle')).toBeEnabled({ timeout: 15_000 });
  await a.click('.light-pop .lp-toggle');
  await expect.poll(() => b.evaluate(() => window.__app.session.lights.state.on), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => b.evaluate(() => window.__app.app.__night.want)).toBe(1);
  await a.click('.light-pop .lp-toggle');
  await expect.poll(() => b.evaluate(() => window.__app.session.lights.state.on), { timeout: 15_000 }).toBe(false);
});

test('nhà vệ sinh: buồng có người thì người khác bị quát, không vào được; soi gương ở bồn rửa tay', async ({ browser }) => {
  const a = await newPage(browser); await loginEmployeeUI(a, `${uniqueCode()}-Minh`); await waitScene(a); await finishAvatar(a);
  const b = await newPage(browser); await loginEmployeeUI(b, `${uniqueCode()}-Tú`); await waitScene(b); await finishAvatar(b);
  await goTo(a, 'stall');
  await expect.poll(() => prompt(a)).toContain('vào buồng');
  await pressE(a);
  await expect.poll(() => a.evaluate(() => window.__app.session.wc.inside)).toBe(0);
  await expect(a.locator('.wc-card')).toBeVisible();
  await goTo(b, 'stall');
  await expect.poll(() => prompt(b), { timeout: 15_000 }).toContain('gõ cửa');
  await pressE(b);
  await expect(b.locator('#toast')).toContainText('😡', { timeout: 10_000 });
  expect(await b.evaluate(() => window.__app.session.wc.inside)).toBe(-1);
  await a.click('.wc-card [data-out]');
  await expect.poll(() => b.evaluate(() => window.__app.session.wc.state.stalls[0]), { timeout: 20_000 }).toBe(null);
  // soi gương: góc nhìn vào gương, gương phản chiếu bật; Esc là thôi
  await goTo(b, 'sink');
  await expect.poll(() => prompt(b)).toContain('soi gương');
  await pressE(b);
  await expect.poll(() => b.evaluate(() => !!window.__app.session.wc.looking && window.__app.app.scene.getObjectByName('wcMirror')?.visible)).toBe(true);
  await b.evaluate(() => window.__app.session.player.onKey({ key: 'Escape', type: 'keydown', repeat: false, preventDefault() {} }));
  await expect.poll(() => b.evaluate(() => window.__app.session.wc.looking)).toBe(null);
});

test('lướt TikTok trong buồng vệ sinh: khung điện thoại, dán link thêm video, vuốt / phím chuyển video, người dán xoá được, ra buồng thì cất điện thoại', async ({ browser }) => {
  const a = await newPage(browser); await loginEmployeeUI(a, `${uniqueCode()}-Lướt`); await waitScene(a); await finishAvatar(a);
  // dọn danh sách cũ (các lần chạy trước) để biết chắc thứ tự
  const ceo = await newPage(browser); await loginAdminAPI(ceo);
  for (const it of (await call(ceo, 'GET', '/api/tiktok')).body.items) await call(ceo, 'DELETE', `/api/tiktok/${it.id}`, {});
  await goTo(a, 'stall');
  await expect.poll(() => prompt(a)).toContain('vào buồng');
  await pressE(a);
  await expect.poll(() => a.evaluate(() => window.__app.session.wc.inside)).toBe(0);
  await a.click('.wc-card [data-tt]');
  const phone = a.locator('.tt-back.show .tt-phone');
  await expect(phone).toBeVisible();
  await expect(a.locator('.tt-empty')).toBeVisible();
  expect(await a.evaluate(() => window.__app.session.player.agent.act)).toBe('phone');   // (nhân vật cầm điện thoại)
  // link không phải TikTok: báo lỗi
  await a.fill('.tt-add input', 'https://example.com/video/1');
  await a.click('.tt-add button');
  await expect(a.locator('#toast')).toContainText('TikTok');
  // dán 2 link → video mới nhất phát trước, trình phát nhúng chính thức
  for (const id of ['7300000000000000001', '7300000000000000002']) { await a.fill('.tt-add input', `https://www.tiktok.com/@sysone/video/${id}?lang=vi`); await a.click('.tt-add button'); await expect(a.locator('.tt-add input')).toHaveValue(''); }
  await expect(a.locator('.tt-pos')).toHaveText('1/2');
  await expect(a.locator('.tt-frame')).toHaveAttribute('src', /tiktok\.com\/player\/v1\/7300000000000000002/);
  // trùng link: báo đã có
  await a.fill('.tt-add input', 'https://www.tiktok.com/@sysone/video/7300000000000000001'); await a.click('.tt-add button');
  await expect(a.locator('#toast')).toContainText('đã có');
  await a.fill('.tt-add input', '');
  // phím ↓ / vuốt lên: video kế
  await a.evaluate(() => document.activeElement?.blur());   // (đang gõ trong ô link thì phím mũi tên dành cho ô nhập)
  await a.keyboard.press('ArrowDown');
  await expect(a.locator('.tt-pos')).toHaveText('2/2');
  await expect(a.locator('.tt-frame')).toHaveAttribute('src', /7300000000000000001/);
  const box = await a.locator('.tt-swipe').boundingBox();
  await a.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3); await a.mouse.down(); await a.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75, { steps: 4 }); await a.mouse.up();   // (vuốt xuống: video trước)
  await expect(a.locator('.tt-pos')).toHaveText('1/2');
  // người dán xoá được
  await a.click('.tt-rail [data-del]'); await a.click('#mOk');
  await expect(a.locator('.tt-pos')).toHaveText('1/1');
  // cất điện thoại, ra khỏi buồng
  await a.click('.tt-close');
  await expect(a.locator('.tt-back')).toHaveCount(0);
  expect(await a.evaluate(() => window.__app.session.player.agent.act || null)).toBe(null);
  await a.click('.wc-card [data-out]');
  await expect.poll(() => a.evaluate(() => window.__app.session.wc.inside)).toBe(-1);
});

