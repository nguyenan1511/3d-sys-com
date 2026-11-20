// Một tài khoản chỉ dùng ở MỘT tab (server/realtime.js onConnect, src/ui/tabLock.js): mở tab thứ hai cùng tài khoản → tab mới
// hiện "Văn phòng đang mở ở tab khác" và không gửi vị trí; "Dùng ở tab này" → tab mới vào, tab cũ tạm dừng; tải lại chính tab
// đang dùng thì vẫn vào thẳng (không bị coi là tab khác).
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(240_000);

const synced = p => p.waitForFunction(() => window.__app?.session?.synced && window.__app.session.rt?.connected, null, { timeout: 120_000 });

test('một tài khoản chỉ mở ở một tab: tab thứ hai bị chặn, chuyển qua lại được, tải lại trang không bị chặn', async ({ browser }) => {
  const code = uniqueCode();
  const a = await newPage(browser); await loginEmployeeUI(a, `${code}-Tab`); await waitScene(a); await finishAvatar(a);
  // tải lại chính tab đang dùng: vẫn vào thẳng
  await a.reload(); await waitScene(a);
  await expect(a.locator('.tl-back')).toHaveCount(0);
  // tab thứ hai (cùng trình duyệt, cùng phiên đăng nhập)
  const b = await a.context().newPage(); await b.goto('/');
  await expect(b.locator('.tl-back h2')).toHaveText('Văn phòng đang mở ở tab khác', { timeout: 120_000 });
  expect(await b.evaluate(() => !!window.__app?.session?.synced)).toBe(false);
  await expect(a.locator('.tl-back')).toHaveCount(0);   // (tab đang dùng không bị ảnh hưởng)
  // chuyển sang tab mới: tab mới vào, tab cũ tạm dừng (không tự nối lại)
  await b.click('.tl-go'); await synced(b);
  await expect(b.locator('.tl-back')).toHaveCount(0);
  await expect(a.locator('.tl-back h2')).toHaveText('Bạn đã chuyển sang tab khác');
  await a.waitForTimeout(2500);
  expect(await a.evaluate(() => window.__app.session.rt.connected)).toBe(false);
  // chuyển ngược lại về tab cũ
  await a.click('.tl-go'); await synced(a);
  await expect(a.locator('.tl-back')).toHaveCount(0);
  await expect(b.locator('.tl-back h2')).toHaveText('Bạn đã chuyển sang tab khác');
  // vẫn chỉ một kết nối đang dùng cho tài khoản này: danh sách online có đúng một mục của mình
  await expect.poll(() => a.evaluate(c => window.__app.session.online.filter(o => o.key === `employee:${c}`).length, code)).toBe(1);
});
