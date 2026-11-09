// Đăng nhập nhân viên: định dạng, trùng mã đang online, cùng mã khác tên, cùng mã cùng tên vào lại giữ chỗ.
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, call, loginEmployeeAPI, freeDesk } from './helpers.js';
import { newPage, closeAll } from './helpers.js';

test.afterEach(closeAll);

test('chưa đăng nhập thì không tải cảnh và không lấy được dữ liệu bố cục', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#empInput')).toBeVisible();
  await expect(page.locator('#appRoot')).toBeHidden();
  expect(await page.evaluate(() => !!window.__app)).toBe(false);
  for (const p of ['/data/layout.json', '/data/employees.json', '/data/equipment.json', '/api/seats', '/api/admin/employees']) {
    expect((await call(page, 'GET', p)).status, p).toBe(401);
  }
});

test('sai định dạng bị chặn ngay khi gõ, chuẩn hóa Unicode và khoảng trắng', async ({ page }) => {
  await page.goto('/');
  const inp = page.locator('#empInput'), btn = page.locator('#empSubmit'), err = page.locator('#empErr');
  for (const [bad, msg] of [['115-An', '4 chữ số'], ['11511-An', '4 chữ số'], ['abcd-An', '4 chữ số'], ['1151', 'gạch ngang'], ['1151-', 'Thiếu tên'], ['1151-An3', 'chữ cái'], ['1151-An_', 'chữ cái']]) {
    await inp.fill(bad); await inp.blur();
    await expect(btn, bad).toBeDisabled();
    await expect(err, bad).toContainText(msg);
  }
  // server cũng chặn khi gọi thẳng
  expect((await call(page, 'POST', '/api/login/employee', { input: '12-ab' })).status).toBe(400);
  // khoảng trắng thừa, dấu cách quanh gạch ngang, Unicode tổ hợp (NFD) đều được chuẩn hóa
  const code = uniqueCode();
  await inp.fill(`  ${code}  -  Nguyền   Văn  An `);
  await expect(btn).toBeEnabled();
  await btn.click();
  await waitScene(page);
  const me = await call(page, 'GET', '/api/me');
  expect(me.body.employee.display).toBe(`${code}-Nguyền Văn An`.normalize('NFC'));
});

test('trùng mã đang online bị từ chối, nhập mã khác thì vào được', async ({ browser }) => {
  const code = uniqueCode(), other = uniqueCode();
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${code}-An`); await waitScene(a);
  const b = await newPage(browser);
  await loginEmployeeUI(b, `${code}-An`);
  await expect(b.locator('#empErr')).toContainText('đang được dùng ở nơi khác');
  await expect(b.locator('#appRoot')).toBeHidden();
  // nhập lại mã khác
  await b.fill('#empInput', `${other}-Bình`); await b.click('#empSubmit');
  await waitScene(b);
  await expect(b.locator('#sessionBar')).toContainText(`${other}-Bình`);
});

test('cùng mã khác tên bị từ chối; cùng mã cùng tên (khác hoa thường) vào lại và giữ nguyên chỗ', async ({ browser }) => {
  const code = uniqueCode();
  const a = await newPage(browser); const ctxA = a.context();
  await loginEmployeeAPI(a, `${code}-Trần An`);
  const desk = await freeDesk(a);
  expect((await call(a, 'POST', `/api/seats/${desk}/claim`, { equipment: { monitors: 2 } })).status).toBe(200);
  await ctxA.close(); // A rời đi: không còn kết nối -> offline (hết thời gian chờ "đang vào")
  await new Promise(r => setTimeout(r, 4500));

  const b = await newPage(browser);
  await loginEmployeeUI(b, `${code}-Lê Bình`);
  await expect(b.locator('#empErr')).toContainText('đã được đăng ký với tên khác');

  await b.fill('#empInput', `${code}-trần an`); await b.click('#empSubmit');
  await waitScene(b);
  const me = await call(b, 'GET', '/api/me');
  expect(me.body.employee.seat.deskId).toBe(desk);
  await expect(b.locator('#seatBox')).toContainText(desk);
  const seat = (await call(b, 'GET', '/api/seats')).body.seats.find(s => s.deskId === desk);
  expect(seat.equipment.monitors).toBe(2);
});
