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
  const ctx = await browser.newContext(iphone); await ctx.addInitScript(() => { try { localStorage.setItem('sysone.mode', 'office'); } catch { /* */ } });
  await ctx.addInitScript(() => { window.__MAXFPS = 12; window.__PIXEL_RATIO = 0.6; window.__RENDER_EVERY_MS = 2000; window.__NO_GUIDE = true; window.__NO_INTRO = true; });
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

// Các khối nổi không đè nhau / không tràn màn hình (iPhone SE dọc và iPhone xoay ngang); mở Bảng công từ tấm bảng
// điều khiển thì tấm tự đóng, bảng công nằm gọn trong màn hình và cuộn được.
const overlaps = p => p.evaluate(() => {
  const vis = e => { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
  const els = [...document.querySelectorAll('#bar .project, .social-bar, #panelToggle, .ctrl-nav #onlineBox, .music-bar, .minimap, .gate-hint, .guide-card, #hudPrompt, .touch-ui .joy, .touch-ui .tbtn')].filter(vis);
  const out = [], vw = innerWidth, vh = innerHeight;
  for (const e of els) { const r = e.getBoundingClientRect(); if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) out.push('tràn: ' + e.className); }
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 3 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 3 && !els[i].contains(els[j]) && !els[j].contains(els[i])) out.push(`đè: ${els[i].className} × ${els[j].className}`);
  }
  return out;
});
for (const name of ['iPhone SE', 'iPhone 14 landscape']) {
  test(`điện thoại (${name}): không khối nào đè nhau; bảng công mở gọn, tấm bảng điều khiển tự đóng`, async ({ browser }) => {
    const { defaultBrowserType: _d, ...dev } = devices[name]; void _d;
    const ctx = await browser.newContext(dev); await ctx.addInitScript(() => { try { localStorage.setItem('sysone.mode', 'office'); } catch { /* */ } });
    await ctx.addInitScript(() => { window.__MAXFPS = 12; window.__PIXEL_RATIO = 0.6; window.__RENDER_EVERY_MS = 2000; window.__NO_GUIDE = true; window.__NO_INTRO = true; });
    const p = await ctx.newPage();
    await loginEmployeeUI(p, `${uniqueCode()}-Mobi`); await waitScene(p); await finishAvatar(p);
    await p.waitForTimeout(800);
    expect(await overlaps(p)).toEqual([]);
    await p.tap('#panelToggle');
    await expect.poll(() => p.evaluate(() => document.getElementById('panel').classList.contains('collapsed'))).toBe(false);
    await p.getByText('Bảng công của tôi').first().tap({ force: true });
    await p.locator('.ts-pop.show').waitFor();
    await expect.poll(() => p.evaluate(() => document.getElementById('panel').classList.contains('collapsed'))).toBe(true);
    const r = await p.locator('.ts-pop').boundingBox(), vp = p.viewportSize();
    expect(r.y).toBeGreaterThanOrEqual(0); expect(r.y + r.height).toBeLessThanOrEqual(vp.height + 1);
    await ctx.close();
  });
}
