// Góp ý & báo lỗi (src/ui/feedback.js, server/feedback.js): nhân viên chọn Báo lỗi, gửi chữ + ảnh cho Admin; Admin được báo ngay
// (số trên nút), mở đọc (hết số), trả lời → nhân viên nhận ngay; Admin đánh dấu đã xử lý → nhân viên thấy; người khác không xem được.
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, loginAdminAPI, waitScene, newPage, closeAll, finishAvatar, call } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(240_000);

test('góp ý & báo lỗi: nhân viên gửi chữ + ảnh, Admin nhận ngay, trả lời, đánh dấu đã xử lý', async ({ browser }) => {
  const ce = uniqueCode(), co = uniqueCode();
  const e = await newPage(browser); await loginEmployeeUI(e, `${ce}-Lan`); await waitScene(e); await finishAvatar(e);
  const ad = await newPage(browser); await loginAdminAPI(ad); await ad.goto('/'); await waitScene(ad);
  await expect(ad.locator('#sessionBar .who')).toHaveText('Admin');   // (đổi tên: không còn chữ "CEO")
  // nhân viên: mở, chọn Báo lỗi, gõ chữ, đính kèm ảnh, gửi
  await e.click('#btnFb'); await expect(e.locator('.fb-pop.show')).toBeVisible();
  await expect(e.locator('.fb-form textarea')).toBeDisabled();   // (chưa chọn loại)
  await e.click('.fb-kind.bug');
  await e.fill('.fb-form textarea', 'Ảnh trên bảng vẽ không hiện');
  const png = await e.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 240; c.getContext('2d').fillStyle = '#ef476f'; c.getContext('2d').fillRect(0, 0, 400, 240); return c.toDataURL('image/png').split(',')[1]; });
  await e.setInputFiles('.fb-attach input', { name: 'loi.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(e.locator('.fb-draft img')).toBeVisible();
  await e.click('.fb-send');
  await expect(e.locator('.fb-msg.me .fb-img img')).toBeVisible();
  await expect(e.locator('.fb-row')).toHaveCount(1);
  // Admin: số trên nút ngay lập tức; mở → đọc → hết số
  await expect(ad.locator('#btnFb .fb-n')).toHaveText('1', { timeout: 15_000 });
  await ad.click('#btnFb');
  await expect(ad.locator('.fb-row.on')).toContainText(`${ce}-Lan`);
  await expect(ad.locator('.fb-msg .fb-bub p')).toHaveText('Ảnh trên bảng vẽ không hiện');
  await expect.poll(() => ad.locator('.fb-msg .fb-img img').evaluate(i => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  await expect(ad.locator('#btnFb .fb-n')).toBeHidden();
  // Admin trả lời (Enter) → nhân viên thấy ngay; đánh dấu đã xử lý → nhân viên thấy dòng "đã xử lý"
  await ad.fill('.fb-form textarea', 'Đã sửa, bạn thử lại nhé'); await ad.keyboard.press('Enter');
  await expect(e.locator('.fb-msg:not(.me) .fb-bub p')).toHaveText('Đã sửa, bạn thử lại nhé', { timeout: 15_000 });
  await ad.click('.fb-head [data-st=done]');
  await expect(e.locator('.fb-done')).toBeVisible({ timeout: 15_000 });
  await expect(ad.locator('.fb-row')).toHaveCount(0);   // (lọc "Chưa xử lý": cuộc đã xử lý rời danh sách)
  // người khác không xem được cuộc này
  const id = (await call(e, 'GET', '/api/feedback')).body.threads[0].id;
  const o = await newPage(browser); await call(o, 'POST', '/api/login/employee', { input: `${co}-Hà` });
  expect((await call(o, 'GET', `/api/feedback/${id}`)).status).toBe(404);
  expect((await call(o, 'GET', '/api/feedback')).body.threads).toEqual([]);
});
