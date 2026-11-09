// CEO: thông báo lỗi chung chung, đổi mật khẩu, khóa sau 5 lần sai trong 15 phút. Chạy cuối vì làm khóa tài khoản admin.
import { test, expect } from '@playwright/test';
import { call } from './helpers.js';

test('đăng nhập CEO qua giao diện, đổi mật khẩu, đăng xuất', async ({ page }) => {
  await page.goto('/');
  await page.click('#tabCeo');
  await page.fill('#ceoUser', 'admin'); await page.fill('#ceoPass', process.env.E2E_ADMIN_PW);
  await page.click('#ceoSubmit');
  await page.waitForFunction(() => window.__app?.ready, null, { timeout: 60_000 });
  await expect(page.locator('#sessionBar')).toContainText('CEO');
  await page.click('#btnDash');
  await expect(page.locator('#dash')).toBeVisible();
  await page.click('#dashClose');
  // đổi mật khẩu: sai mật khẩu hiện tại bị từ chối, mật khẩu ngắn bị từ chối
  await page.click('#btnPw');
  await page.fill('#pwCur', 'khong-dung'); await page.fill('#pwNew', 'matkhaumoi123'); await page.fill('#pwNew2', 'matkhaumoi123');
  await page.click('#mOk'); await expect(page.locator('#mErr')).toContainText('không đúng');
  await page.fill('#pwCur', process.env.E2E_ADMIN_PW); await page.fill('#pwNew', 'ngan'); await page.fill('#pwNew2', 'ngan');
  await page.click('#mOk'); await expect(page.locator('#mErr')).toContainText('ít nhất 8');
  const next = process.env.E2E_ADMIN_PW + '-moi';
  await page.fill('#pwNew', next); await page.fill('#pwNew2', next);
  await page.click('#mOk'); await expect(page.locator('#toast')).toContainText('Đã đổi mật khẩu');
  process.env.E2E_ADMIN_PW = next;
  await page.click('#btnLogout');
  await expect(page.locator('#empInput')).toBeVisible();
  expect((await call(page, 'GET', '/api/admin/employees')).status).toBe(401);
});

test('sai mật khẩu CEO: thông báo chung chung, khóa sau 5 lần kể cả khi nhập đúng', async ({ page }) => {
  await page.goto('/');
  await page.click('#tabCeo');
  // tên đăng nhập không tồn tại và mật khẩu sai cho cùng một thông báo
  const unknown = await call(page, 'POST', '/api/login/admin', { username: 'khongco', password: 'x' });
  expect(unknown.body.error).toBe('Tên đăng nhập hoặc mật khẩu không đúng.');
  for (let i = 0; i < 5; i++) {
    await page.fill('#ceoUser', 'admin'); await page.fill('#ceoPass', `sai-${i}`);
    await page.click('#ceoSubmit');
    await expect(page.locator('#ceoSubmit')).toHaveText('Đăng nhập'); // chờ server trả lời
    await expect(page.locator('#ceoErr')).toHaveText(i < 4 ? 'Tên đăng nhập hoặc mật khẩu không đúng.' : /tạm bị khóa/);
  }
  await page.fill('#ceoUser', 'admin'); await page.fill('#ceoPass', process.env.E2E_ADMIN_PW);
  await page.click('#ceoSubmit');
  await expect(page.locator('#ceoErr')).toContainText('tạm bị khóa');
  await expect(page.locator('#appRoot')).toBeHidden();
  const r = await call(page, 'POST', '/api/login/admin', { username: 'admin', password: process.env.E2E_ADMIN_PW });
  expect(r.status).toBe(429);
});
