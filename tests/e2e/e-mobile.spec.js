// Bản điện thoại (iPhone 14, cảm ứng):
// - chọn nhân vật toàn màn hình, nút "Vào văn phòng" luôn thấy;
// - cảnh 3D phủ kín màn hình;
// - bảng điều khiển, bản đồ nhỏ mặc định thu gọn;
// - có cần điều khiển và nút Tương tác / Nhảy / Về bàn; kéo cần điều khiển thì nhân vật đi;
// - không có gì tràn ngang màn hình.
import { test, expect, devices } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, finishAvatar, closeAll } from './helpers.js';

test.afterEach(closeAll);

test('điện thoại: bố cục gọn, cần điều khiển đi được, không tràn màn hình', async ({ browser }) => {
  const { defaultBrowserType: _d, ...iphone } = devices['iPhone 14']; void _d;
  const ctx = await browser.newContext(iphone);
  await ctx.addInitScript(() => { window.__MAXFPS = 12; window.__PIXEL_RATIO = 0.6; window.__RENDER_EVERY_MS = 2000; window.__NO_GUIDE = true; });
  const p = await ctx.newPage();
  await loginEmployeeUI(p, `${uniqueCode()}-Mobi`);
  // chọn nhân vật: nút vào văn phòng nằm trong màn hình
  await p.locator('#avSave').waitFor();
  const save = await p.locator('#avSave').boundingBox(), vh = p.viewportSize().height, vw = p.viewportSize().width;
  expect(save.y + save.height).toBeLessThanOrEqual(vh + 1);
  await waitScene(p); await finishAvatar(p);

  // cảnh 3D phủ kín
  const c3 = await p.locator('#c3').boundingBox();
  expect(c3.height).toBeGreaterThan(vh * 0.95);
  // thu gọn mặc định, có điều khiển cảm ứng
  expect(await p.evaluate(() => document.getElementById('panel').classList.contains('collapsed'))).toBe(true);
  await expect(p.locator('.touch-ui .joy')).toBeVisible();
  await expect(p.locator('.touch-ui [data-key="e"]')).toBeVisible();
  // không tràn ngang
  expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw);

  // kéo cần điều khiển lên: nhân vật đi
  const s0 = await p.evaluate(() => { const a = window.__app.session.player.agent; return { x: a.x, z: a.z }; });
  const jb = await p.locator('.touch-ui .joy').boundingBox(), cx = jb.x + jb.width / 2, cy = jb.y + jb.height / 2;
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - i * 10 }] });
  await expect.poll(async () => { const s = await p.evaluate(() => { const a = window.__app.session.player.agent; return { x: a.x, z: a.z }; }); return Math.hypot(s.x - s0.x, s.z - s0.z); }, { timeout: 8000 }).toBeGreaterThan(0.5);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => p.evaluate(() => window.__app.session.player.keys.f)).toBe(false);

  // mở bảng điều khiển: tấm trượt từ dưới lên; chạm cảnh thì đóng
  await p.tap('#panelToggle');
  await expect.poll(() => p.evaluate(() => document.getElementById('panel').classList.contains('collapsed'))).toBe(false);
  const sheet = await p.locator('#panel').boundingBox();
  expect(sheet.y + sheet.height).toBeGreaterThan(vh - 4);
  await p.touchscreen.tap(vw / 2, sheet.y - 30);
  await expect.poll(() => p.evaluate(() => document.getElementById('panel').classList.contains('collapsed'))).toBe(true);
  await ctx.close();
});
