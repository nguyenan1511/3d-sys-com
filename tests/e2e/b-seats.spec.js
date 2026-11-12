// Khóa chỗ ngồi: chỉ chủ chỗ được ngồi (kể cả gọi API trực tiếp), admin đổi chỗ, tranh chấp nhận chỗ, đồng bộ thời gian thực.
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, call, loginEmployeeAPI, loginAdminAPI, freeDesk } from './helpers.js';
import { newPage, closeAll, finishAvatar } from './helpers.js';

test.afterEach(closeAll);

test('được xếp chỗ thì tự thiết lập bàn làm việc (dụng cụ, màu bàn) qua giao diện; người khác không ngồi/nhận/sửa được kể cả gọi API', async ({ browser }) => {
  const ca = uniqueCode(), cb = uniqueCode();
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${ca}-An`); await waitScene(a); await finishAvatar(a);
  // nhân viên không tự chọn chỗ: chỗ được xếp (chị hướng dẫn / quản trị) — ở đây xếp qua API
  const desk = await freeDesk(a);
  expect((await call(a, 'POST', `/api/seats/${desk}/claim`, {})).status).toBe(200);
  await expect(a.locator('#seatBox')).toContainText(desk);
  await a.click('#btnEquip');
  await a.selectOption('#eq_monitors', '3');
  await a.check('#eq_lamp');
  // bản nháp hiện ngay trên bàn: viền cam quanh bàn đang thiết lập, không phủ kín mặt bàn
  await expect.poll(() => a.evaluate(() => window.__app.deskState.highlighted)).toBe(desk);
  await a.click('#btnSaveEq');
  await expect.poll(async () => (await call(a, 'GET', '/api/seats')).body.seats.find(s => s.deskId === desk).equipment).toMatchObject({ monitors: 3, lamp: true });
  const seat = (await call(a, 'GET', '/api/seats')).body.seats.find(s => s.deskId === desk);
  expect(seat.owner.display).toBe(`${ca}-An`);

  const b = await newPage(browser);
  await loginEmployeeUI(b, `${cb}-Bình`); await waitScene(b); await finishAvatar(b);
  // B thấy chủ chỗ
  await expect.poll(() => b.evaluate(d => window.__app.session.seats.get(d)?.owner?.display, desk)).toBe(`${ca}-An`);
  // gọi API trực tiếp
  const sit = await call(b, 'POST', `/api/seats/${desk}/sit`, {});
  expect(sit.status).toBe(403); expect(sit.body.error).toBe(`Chỗ này thuộc về ${ca}-An`);
  const claim = await call(b, 'POST', `/api/seats/${desk}/claim`, {});
  expect(claim.status).toBe(409); expect(claim.body.error).toBe(`Chỗ này thuộc về ${ca}-An`);
  expect((await call(b, 'PUT', `/api/seats/${desk}/equipment`, { equipment: { monitors: 1 } })).status).toBe(403);
  // A nhận thêm chỗ khác khi chưa được admin cho phép: bị từ chối
  const other = await freeDesk(a);
  expect((await call(a, 'POST', `/api/seats/${other}/claim`, {})).status).toBe(403);
  // chủ chỗ ngồi được
  expect((await call(a, 'POST', `/api/seats/${desk}/sit`, {})).status).toBe(200);
});

test('CEO không ngồi chỗ của nhân viên khi ADMIN_CAN_SIT_ANYWHERE=false; nhân viên không gọi được API quản trị', async ({ browser }) => {
  const e = await newPage(browser);
  await loginEmployeeAPI(e, `${uniqueCode()}-Cường`);
  const desk = await freeDesk(e);
  await call(e, 'POST', `/api/seats/${desk}/claim`, {});
  expect((await call(e, 'GET', '/api/admin/employees')).status).toBe(403);
  expect((await call(e, 'POST', `/api/admin/seats/${desk}/release`, {})).status).toBe(403);
  const ceo = await newPage(browser);
  await loginAdminAPI(ceo);
  const r = await call(ceo, 'POST', `/api/seats/${desk}/sit`, {});
  expect(r.status).toBe(403); expect(r.body.error).toMatch(/^Chỗ này thuộc về \d{4}-Cường$/);
});

test('admin đổi chỗ của A thì B nhận được chỗ cũ; B nhận cập nhật thời gian thực', async ({ browser }) => {
  const ca = uniqueCode(), cb = uniqueCode();
  const a = await newPage(browser);
  await loginEmployeeAPI(a, `${ca}-An`);
  const oldDesk = await freeDesk(a);
  expect((await call(a, 'POST', `/api/seats/${oldDesk}/claim`, {})).status).toBe(200);

  const b = await newPage(browser);
  await loginEmployeeUI(b, `${cb}-Bình`); await waitScene(b);
  expect((await call(b, 'POST', `/api/seats/${oldDesk}/claim`, {})).status).toBe(409);

  const ceo = await newPage(browser);
  await loginAdminAPI(ceo);
  const newDesk = (await call(ceo, 'GET', '/api/seats')).body.seats.find(s => s.floor === 2 && !s.owner && s.deskId !== oldDesk && s.kind === 'desk').deskId;
  expect((await call(ceo, 'POST', `/api/admin/seats/${newDesk}/assign`, { code: ca })).status).toBe(200);
  // B thấy chỗ cũ trống lại qua WebSocket mà không cần tải lại trang
  // (GPU giả lập: trang B vừa vào còn đang nướng sprite 2D / biên dịch shader, có lúc phản hồi chậm vài giây)
  await expect.poll(() => b.evaluate(d => window.__app.session.seats.get(d)?.owner?.code ?? null, oldDesk), { timeout: 30_000 }).toBe(null);
  expect((await call(b, 'POST', `/api/seats/${oldDesk}/claim`, {})).status).toBe(200);
  const seats = (await call(ceo, 'GET', '/api/seats')).body.seats;
  expect(seats.find(s => s.deskId === oldDesk).owner.code).toBe(cb);
  expect(seats.find(s => s.deskId === newDesk).owner.code).toBe(ca);
  // nhật ký có ghi thao tác của admin
  const audit = (await call(ceo, 'GET', '/api/admin/audit')).body.audit;
  expect(audit.some(x => x.action === 'admin.seat.assign' && x.target === newDesk)).toBe(true);
});

test('hai người nhận cùng một chỗ cùng lúc: chỉ một người thành công', async ({ browser }) => {
  for (let round = 0; round < 4; round++) {
    const x = await newPage(browser), y = await newPage(browser);
    await loginEmployeeAPI(x, `${uniqueCode()}-Xuân`); await loginEmployeeAPI(y, `${uniqueCode()}-Yến`);
    const desk = await freeDesk(x, null);
    const [rx, ry] = await Promise.all([call(x, 'POST', `/api/seats/${desk}/claim`, {}), call(y, 'POST', `/api/seats/${desk}/claim`, {})]);
    const codes = [rx.status, ry.status].sort();
    expect(codes, `vòng ${round}`).toEqual([200, 409]);
    const seat = (await call(x, 'GET', '/api/seats')).body.seats.find(s => s.deskId === desk);
    const winner = rx.status === 200 ? rx : ry;
    expect(seat.owner.code).toBe(winner.body.seat.owner.code);
    await x.context().close(); await y.context().close();
  }
});

test('người dùng online thấy nhau: danh sách online và avatar ngồi đúng chỗ', async ({ browser }) => {
  const ca = uniqueCode(), cb = uniqueCode();
  const a = await newPage(browser);
  await loginEmployeeAPI(a, `${ca}-An`);
  const desk = await freeDesk(a);
  await call(a, 'POST', `/api/seats/${desk}/claim`, {});
  await a.goto('/'); await waitScene(a); await finishAvatar(a); // tạo nhân vật xong, có chỗ thì ngồi luôn
  const b = await newPage(browser);
  await loginEmployeeUI(b, `${cb}-Bình`); await waitScene(b); await finishAvatar(b);
  await expect(b.locator('#onlineBox')).toContainText(`${ca}-An`);
  await expect.poll(() => b.evaluate(k => { const r = window.__app.session.remote.byKey.get(k); return r ? r.seated : null; }, `employee:${ca}`)).toBe(desk);
  // màn hình bàn của A sáng ở phía B
  await expect.poll(() => b.evaluate(d => window.__app.session.seatedAt(d), desk)).toBe(true);
});

test('nhân viên chọn nhân vật; người khác thấy đúng nhân vật; đăng nhập lại vẫn giữ', async ({ browser }) => {
  test.setTimeout(240_000); // tải cảnh 3D ba lần trên GPU giả lập
  const ca = uniqueCode(), cb = uniqueCode();
  const a = await newPage(browser);
  await loginEmployeeUI(a, `${ca}-Hoa`); await waitScene(a);
  await expect(a.locator('#avTitle')).toContainText('Chọn nhân vật');
  const model = await a.locator('.m3-card').nth(1).getAttribute('data-m3'); // nhân vật thứ hai (không phải mặc định)
  await a.locator('.m3-card').nth(1).click();
  await a.click('#avSave');
  await expect(a.locator('#avSave')).toHaveCount(0);
  const me = (await call(a, 'GET', '/api/me')).body.employee;
  expect(me.look).toMatchObject({ model });
  // nhận chỗ rồi ngồi: B thấy nhân vật của A đúng tạo hình
  const desk = await freeDesk(a);
  expect((await call(a, 'POST', `/api/seats/${desk}/claim`, {})).status).toBe(200);
  expect((await call(a, 'POST', `/api/seats/${desk}/sit`, {})).status).toBe(200);
  const b = await newPage(browser);
  await loginEmployeeUI(b, `${cb}-Lan`); await waitScene(b); await finishAvatar(b);
  await expect.poll(() => b.evaluate(k => window.__app.session.remote.byKey.get(k)?.emp.look ?? null, `employee:${ca}`)).toMatchObject({ model });
  // giá trị lạ bị chặn
  expect((await call(b, 'PUT', '/api/me/look', { look: { model: 'khong-co' } })).status).toBe(400);
  // vào lại (máy khác) không phải tạo hình lại
  await a.context().close();
  await new Promise(r => setTimeout(r, 4500));
  const a2 = await newPage(browser);
  await loginEmployeeUI(a2, `${ca}-Hoa`); await waitScene(a2);
  await expect(a2.locator('#avSave')).toHaveCount(0);
  await expect(a2.locator('#seatBox')).toContainText(desk);
});

test('CEO thêm nhân viên; người đó đăng nhập đúng mã-tên thì vào được', async ({ browser }) => {
  test.setTimeout(240_000); // hai trang 3D trên GPU giả lập
  const code = uniqueCode();
  const ceo = await newPage(browser);
  await loginAdminAPI(ceo);
  await ceo.goto('/'); await ceo.waitForFunction(() => window.__app?.ready, null, { timeout: 60_000 });
  await ceo.click('#btnDash'); await ceo.click('[data-tab="emp"]');   // (bảng quản trị mở ở trang Tổng quan)
  await ceo.click('#dAdd');
  await ceo.fill('#nCode', `${code}-Ngô Thị Mai`); await ceo.fill('#nDept', 'Kế toán');
  await ceo.click('#mOk');
  await expect(ceo.locator(`tr[data-code="${code}"]`)).toContainText('Ngô Thị Mai');
  await expect(ceo.locator(`tr[data-code="${code}"]`)).toContainText('chưa chọn');
  const e = await newPage(browser);
  await loginEmployeeUI(e, `${code}-ngô thị mai`); await waitScene(e);
  await expect(e.locator('#avTitle')).toBeVisible();
  await finishAvatar(e);
  await expect(ceo.locator(`tr[data-code="${code}"] .look-dot`)).toBeVisible({ timeout: 45_000 }); // (máy test: bảng cập nhật chậm)
});
