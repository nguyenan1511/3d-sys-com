// "Có gì ở văn phòng?" (src/ui/intro.js + public/data/intro.json): lần đầu vào hiện GHIM NỔI trong cảnh 3D (không còn hộp chữ
// tự mở — người dùng lười đọc); bấm ghim là tới nơi đó; "Danh sách đầy đủ" mở hộp cũ; đã xem thì không tự hiện lại; nút
// "Có gì ở đây?" bật / tắt ghim; nội dung có phiên bản mới thì ghim tự hiện lại, nơi mới có nhãn MỚI.
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(240_000);
test.use({ actionTimeout: 15_000 });

test('giới thiệu bằng ghim nổi: tự hiện lần đầu, bấm ghim để tới, danh sách đầy đủ; có nơi mới thì hiện lại với nhãn MỚI', async ({ browser }) => {
  const a = await newPage(browser);
  await a.context().addInitScript(() => { window.__NO_INTRO = false; });   // (helpers tắt giới thiệu cho các test khác)
  let bump = false;
  await a.context().route('**/data/intro.json', async route => {
    const r = await route.fetch(), d = await r.json();
    if (bump) { d.version += 1; d.items.find(x => x.id === 'billiards').new_in = d.version; }
    await route.fulfill({ response: r, json: d });
  });
  await loginEmployeeUI(a, `${uniqueCode()}-Giới Thiệu`); await waitScene(a); await finishAvatar(a);
  // lần đầu: ghim nổi (không có hộp chữ chặn màn hình)
  await expect(a.locator('.ipin-layer')).toBeVisible({ timeout: 20_000 });
  await expect(a.locator('.intro-back')).toHaveCount(0);
  await expect.poll(() => a.locator('.ipin:not([hidden])').count(), { timeout: 15_000 }).toBeGreaterThan(2);
  // bấm ghim → tới nơi đó
  const before = await a.evaluate(() => { const p = window.__app.session.player.agent; return { x: p.x, z: p.z }; });
  await a.locator('.ipin:not([hidden])').first().dispatchEvent('click');   // (ghim đi theo camera đang trôi — bấm thẳng, không chờ "đứng yên")
  await expect.poll(() => a.evaluate(b => { const p = window.__app.session.player.agent; return Math.hypot(p.x - b.x, p.z - b.z); }, before), { timeout: 15_000 }).toBeGreaterThan(1);
  // danh sách đầy đủ: hộp cũ (các mục không có chỗ như phím tắt)
  await a.locator('.ipin-bar [data-all]').click();
  await expect(a.locator('.intro-back.show')).toBeVisible();
  await expect(a.locator('.ipin-layer')).toHaveCount(0);
  await a.keyboard.press('Escape');
  await expect(a.locator('.intro-back')).toHaveCount(0);
  // đã xem: tải lại không tự hiện; nút "Có gì ở đây?" bật / tắt ghim
  await a.reload(); await waitScene(a); await a.waitForTimeout(2000);
  await expect(a.locator('.ipin-layer')).toHaveCount(0);
  await a.locator('.intro-btn').first().click();
  await expect(a.locator('.ipin-layer')).toBeVisible();
  await a.locator('.ipin-bar [data-hide]').click();
  await expect(a.locator('.ipin-layer')).toHaveCount(0);
  // nội dung có phiên bản mới: ghim tự hiện lại, nơi mới có nhãn MỚI
  bump = true;
  await a.reload(); await waitScene(a);
  await expect(a.locator('.ipin-layer')).toBeVisible({ timeout: 20_000 });
  await expect(a.locator('.ipin.new')).toHaveCount(1);
});
