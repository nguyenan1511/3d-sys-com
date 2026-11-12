// Modal giới thiệu "Có gì ở văn phòng?" (src/ui/intro.js + public/data/intro.json): tự mở lần đầu, chuyển nhóm, đóng bằng
// Esc, không mở lại khi đã xem; nội dung có phiên bản mới (tính năng mới) thì tự mở lại với tab "Mới" đứng đầu.
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(240_000);

test('giới thiệu nhanh: tự mở lần đầu, xem theo nhóm, đóng; có tính năng mới thì mở lại với nhãn MỚI', async ({ browser }) => {
  const a = await newPage(browser);
  await a.context().addInitScript(() => { window.__NO_INTRO = false; });   // (helpers tắt modal cho các test khác)
  let bump = false;
  await a.context().route('**/data/intro.json', async route => {
    const r = await route.fetch(), d = await r.json();
    if (bump) { d.version += 1; d.items[d.items.length - 1].new_in = d.version; }
    await route.fulfill({ response: r, json: d });
  });
  await loginEmployeeUI(a, `${uniqueCode()}-Giới Thiệu`); await waitScene(a); await finishAvatar(a);
  await expect(a.locator('.intro-back.show')).toBeVisible({ timeout: 20_000 });
  await expect(a.locator('.intro-tabs [aria-selected="true"]')).toContainText('Bắt đầu');
  await a.click('.intro-next');
  await expect(a.locator('.intro-tabs [aria-selected="true"]')).toContainText('Làm việc');
  await expect(a.locator('.intro-card')).not.toHaveCount(0);
  await a.keyboard.press('Escape');
  await expect(a.locator('.intro-back')).toHaveCount(0);
  // đã xem: tải lại không tự mở
  await a.reload(); await waitScene(a); await a.waitForTimeout(2000);
  await expect(a.locator('.intro-back')).toHaveCount(0);
  // nội dung có phiên bản mới: tự mở lại, tab "Mới" đứng đầu, mục mới có nhãn MỚI
  bump = true;
  await a.reload(); await waitScene(a);
  await expect(a.locator('.intro-back.show')).toBeVisible({ timeout: 20_000 });
  await expect(a.locator('.intro-tabs button').first()).toContainText('Mới');
  await expect(a.locator('.intro-card .intro-new')).toHaveCount(1);
});
