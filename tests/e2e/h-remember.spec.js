// Máy đã đăng nhập thì lần sau vào thẳng: server mất phiên (khởi động lại mất dữ liệu, phiên hết hạn) thì máy tự đăng nhập
// lại bằng mã đã nhớ, không chọn lại nhân vật. Bấm "Đăng xuất" thì quên mã — lần sau phải tự đăng nhập.
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(240_000);

test('mất phiên ở server: tự đăng nhập lại, giữ nhân vật; bấm đăng xuất thì phải đăng nhập lại', async ({ browser }) => {
  const input = `${uniqueCode()}-Nhớ`;
  const a = await newPage(browser); await loginEmployeeUI(a, input); await waitScene(a); await finishAvatar(a);
  const look = await a.evaluate(() => window.__app.session.me.employee.look);
  expect(look?.model).toBeTruthy();
  // phiên mất (như server khởi động lại với database trống / phiên hết hạn): xoá cookie rồi mở lại
  await a.context().clearCookies();
  await a.reload(); await waitScene(a);
  await expect(a.locator('#empInput')).toBeHidden();
  await expect(a.locator('#avSave')).toHaveCount(0);
  expect(await a.evaluate(() => window.__app.session.me.employee.look.model)).toBe(look.model);
  // tự bấm đăng xuất: lần sau hiện màn hình đăng nhập, không tự vào
  await a.evaluate(() => document.getElementById('btnLogout').click());
  await expect(a.locator('#empInput')).toBeVisible({ timeout: 20_000 });
  await a.reload();
  await expect(a.locator('#empInput')).toBeVisible({ timeout: 20_000 });
  expect(await a.evaluate(() => window.__app?.ready)).toBeFalsy();
});
