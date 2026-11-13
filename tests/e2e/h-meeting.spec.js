// Bảng thông báo + phòng họp: tin admin đăng hiện trong bảng tin; đặt phòng mời người, cả hai vào phòng họp 3D, bấm bảng trắng
// mở 2 cột, nét vẽ đồng bộ, xoá tài liệu, host kết thúc sớm thì mọi người rời phòng.
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar, call, loginAdminAPI } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(300_000);

test('bảng tin + phòng họp 3D: đặt phòng, vào phòng, vẽ chung, xoá tài liệu, kết thúc sớm', async ({ browser }) => {
  const ceo = await newPage(browser); await loginAdminAPI(ceo);
  expect((await call(ceo, 'POST', '/api/board', { title: 'Tin kiểm thử bảng thông báo', body: 'Nội dung' })).status).toBe(200);
  const ca = uniqueCode(), cb = uniqueCode();
  const a = await newPage(browser); await loginEmployeeUI(a, `${ca}-Lan`); await waitScene(a); await finishAvatar(a);
  const b = await newPage(browser); await loginEmployeeUI(b, `${cb}-Minh`); await waitScene(b); await finishAvatar(b);
  // bảng tin
  await a.click('#btnBoard');
  await expect(a.locator('.nb-row', { hasText: 'Tin kiểm thử bảng thông báo' })).toBeVisible();
  await a.locator('.sx-x').click();
  // đặt phòng ngay khung giờ hiện tại, mời B
  const slot = Math.floor(Date.now() / 1800e3) * 1800e3;
  const bk = await call(a, 'POST', '/api/meetings', { title: 'Họp kiểm thử', start: slot, end: slot + 3600e3, invitees: [`employee:${cb}`] });
  test.skip(bk.status === 400 && /mở từ/.test(bk.body?.error || ''), 'ngoài giờ mở phòng họp (07:00–21:00)');
  expect(bk.status).toBe(200);
  const id = bk.body.meeting.id;
  await a.evaluate(i => window.__app.session.meet.join(i), id);
  await b.evaluate(i => window.__app.session.meet.join(i), id);
  await expect(a.locator('.mt-room.mode-scene')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => a.evaluate(() => window.__app.app.rooms?.room?.kind)).toBe('meet');
  await expect.poll(() => a.evaluate(() => { const st = window.__app.app.rooms, r = st.renderer; if (!r.__spy) { const o = r.render.bind(r); r.render = (sc, cam) => { r.__last = sc; return o(sc, cam); }; r.__spy = true; } return r.__last === st.room.scene; }), { timeout: 15000 }).toBe(true);   // (cảnh phòng họp được vẽ thật)
  await expect(a.locator('.mt-here .mt-av')).toHaveCount(2, { timeout: 20_000 });
  // bấm vào bảng trắng trong cảnh 3D → bảng vẽ + cột chat/tài liệu, cảnh 3D thu vào khung nhỏ góc trái dưới
  const pt = await a.evaluate(() => { const r = window.__app.app.rooms.room, v = r.board.position.clone().project(r.camera), c = r.canvasEl.getBoundingClientRect(); return { x: c.left + (v.x + 1) / 2 * c.width, y: c.top + (1 - v.y) / 2 * c.height }; });
  await a.mouse.click(pt.x, pt.y);
  await expect(a.locator('.mt-room.mode-split .excalidraw canvas.interactive')).toBeVisible({ timeout: 30_000 });   // (bảng vẽ Excalidraw)
  await expect(a.locator('.mt-pip')).toBeVisible();
  await expect(a.locator('.mt-pane[data-pane=chat] .mt-form')).toBeVisible();   // (cột phải: thanh thẻ ở trên, mỗi thẻ chiếm trọn phần dưới)
  await a.click('[data-tab=people]');
  // tên thẻ + số đếm luôn một hàng (máy tính hẹp và điện thoại)
  for (const w of [1024, 1280, 375]) {
    await a.setViewportSize({ width: w, height: w < 500 ? 667 : 800 }); if (w < 500) await a.click('[data-tab=people]');
    const hs = await a.evaluate(() => [...document.querySelectorAll('.mt-tabs [data-tab]')].map(b => { const t = b.querySelector('span').getBoundingClientRect(); return t.height; }));
    for (const h of hs) expect(h).toBeLessThan(24);
    expect(await a.evaluate(() => [...document.querySelectorAll('.mt-tabs [data-tab] span')].some(e => e.scrollWidth > e.clientWidth + 1))).toBe(false);   // (không bị cắt "…")
    if (process.env.SHOT) await a.locator('.mt-side').screenshot({ path: process.env.SHOT + '/tabs-' + w + '.png' });
  }
  await a.setViewportSize({ width: 1280, height: 800 });
  await expect(a.locator('.mt-people li')).toHaveCount(2); await expect(a.locator('.mt-pane[data-pane=chat]')).toBeHidden();
  // chữ trong avatar nằm giữa vòng tròn
  const off = await a.evaluate(() => { const av = document.querySelector('.mt-people .mt-av'), r = av.getBoundingClientRect(), t = document.createRange(); t.selectNodeContents(av); const q = t.getBoundingClientRect(); return Math.max(Math.abs((q.left + q.right) / 2 - (r.left + r.right) / 2), Math.abs((q.top + q.bottom) / 2 - (r.top + r.bottom) / 2)); });
  expect(off).toBeLessThan(2.5);
  await a.click('[data-tab=files]');
  await expect(a.locator('.mt-pane[data-pane=files] .mt-up')).toBeVisible();
  // khung 3D nhỏ có hình (không trắng trơn), kéo được
  await expect.poll(() => a.evaluate(() => { const c = document.querySelector('.mt-pipc'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const set = new Set(); for (let i = 0; i < d.length; i += 4 * 97) set.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4); return set.size; }), { timeout: 15_000 }).toBeGreaterThan(8);
  const p0 = await a.locator('.mt-pip').boundingBox(), vp = a.viewportSize();
  expect(p0.x).toBeLessThan(40); expect(p0.y + p0.height).toBeGreaterThan(vp.height - 120);
  expect(await a.evaluate(() => document.documentElement.lang)).toBe('vi');   // (Excalidraw không đổi ngôn ngữ của trang)
  await a.mouse.move(p0.x + 40, p0.y + 30); await a.mouse.down(); await a.mouse.move(p0.x + 340, p0.y - 200, { steps: 6 }); await a.mouse.up();
  const p1 = await a.locator('.mt-pip').boundingBox();
  expect(p1.x - p0.x).toBeGreaterThan(250); expect(await a.locator('.mt-room.mode-split').count()).toBe(1);
  // vẽ một hình chữ nhật bằng công cụ của Excalidraw → người kia nhận được, bảng trắng 3D của họ vẽ lại
  await expect.poll(() => a.evaluate(() => !!window.__app.session.meet.room?.wb?.xapi), { timeout: 30_000 }).toBe(true);
  await a.locator('.mt-room label:has([data-testid="toolbar-rectangle"])').click();
  await expect.poll(() => a.evaluate(() => window.__app.session.meet.room.wb.xapi.getAppState().activeTool.type)).toBe('rectangle');
  const box = await a.locator('.mt-room .excalidraw canvas.interactive').boundingBox();
  await a.mouse.move(box.x + box.width * 0.66, box.y + box.height * 0.3); await a.mouse.down(); await a.mouse.move(box.x + box.width * 0.86, box.y + box.height * 0.5, { steps: 8 }); await a.mouse.up();   // (bên phải: khung 3D nhỏ vừa được kéo ra giữa)
  await expect.poll(() => a.evaluate(() => window.__app.session.meet.room.wb.count), { timeout: 10_000 }).toBe(1);
  await expect.poll(() => b.evaluate(() => window.__app.session.meet.room?.wb?.count || 0), { timeout: 20_000 }).toBe(1);
  await expect.poll(() => b.evaluate(() => !!window.__app.session.meet.room?.preview), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => b.evaluate(() => Math.round(window.__app.session.meet.room.wb.elements()[0].width))).toBe(await a.evaluate(() => Math.round(window.__app.session.meet.room.wb.elements()[0].width)));   // (nhận đủ, không dừng ở khung đầu lúc đang kéo)
  expect(await b.evaluate(() => window.__app.session.meet.room.wb.elements()[0].type)).toBe('rectangle');
  await expect.poll(async () => (await call(a, 'GET', `/api/meetings/${id}`)).body.board.elements.filter(e => !e.isDeleted).length, { timeout: 10_000 }).toBe(1);
  // dán ảnh lên bảng (như dán từ clipboard): ảnh lưu ở máy chủ, người kia thấy ảnh
  const fid = await a.evaluate(async () => {
    const w = window.__app.session.meet.room.wb, X = w.L.X, c = document.createElement('canvas'); c.width = 120; c.height = 80; c.getContext('2d').fillStyle = '#e63946'; c.getContext('2d').fillRect(0, 0, 120, 80);
    const id = 'img' + Date.now().toString(36); w.xapi.addFiles([{ id, mimeType: 'image/png', dataURL: c.toDataURL('image/png'), created: Date.now() }]);
    const [el] = X.convertToExcalidrawElements([{ type: 'image', fileId: id, x: 0, y: 0, width: 120, height: 80 }]);
    w.xapi.updateScene({ elements: [...w.xapi.getSceneElementsIncludingDeleted(), el], captureUpdate: X.CaptureUpdateAction.IMMEDIATELY }); return id;
  });
  await expect.poll(async () => (await call(a, 'GET', `/api/meetings/${id}`)).body.board.files, { timeout: 15_000 }).toEqual([fid]);
  await expect.poll(() => b.evaluate(f => !!window.__app.session.meet.room.wb.files.get(f), fid), { timeout: 15_000 }).toBe(true);
  if (process.env.SHOT) { await a.waitForTimeout(800); await a.screenshot({ path: process.env.SHOT + '/xb-a.png' }); await b.evaluate(() => window.__app.session.meet.room.setMode('split')); await b.waitForTimeout(2500); await b.screenshot({ path: process.env.SHOT + '/xb-b.png' }); await b.setViewportSize({ width: 375, height: 667 }); await b.waitForTimeout(1500); await b.screenshot({ path: process.env.SHOT + '/xb-se.png' }); await b.setViewportSize({ width: 1280, height: 800 }); }
  // tài liệu: tải lên rồi xoá
  expect((await call(a, 'POST', `/api/meetings/${id}/files`, { name: 'bien-ban.txt', data: Buffer.from('ok').toString('base64') })).status).toBe(200);
  await a.locator('.mt-flist [data-del]').first().click(); await a.click('#mOk');
  await expect.poll(async () => (await call(a, 'GET', `/api/meetings/${id}`)).body.files.length).toBe(0);
  // host kết thúc sớm → cả hai rời phòng
  await a.click('.mt-end'); await a.click('#mOk');
  await expect.poll(() => b.evaluate(() => window.__app.session.meet.inRoom), { timeout: 15_000 }).toBe(null);
  await expect.poll(() => a.evaluate(() => window.__app.session.meet.inRoom)).toBe(null);
  // xem lại trong "Folder của tôi": bảng vẽ có đủ hình + ảnh (ảnh tải lại từ máy chủ); hộp xác nhận: 2 nút cùng cỡ, thẳng hàng
  await a.evaluate(i => window.__app.session.meet.panel.open('folder', i), id);
  await a.locator('[data-sub=board]').click();
  await expect.poll(() => a.evaluate(() => { const w = window.__app.session.meet.panel.wb; return w?.xapi ? `${w.count}/${Object.keys(w.xapi.getFiles()).length}` : ''; }), { timeout: 30_000 }).toBe('2/1');
  await a.locator('[data-purge]').click();
  const [ok, no] = [await a.locator('#mOk').boundingBox(), await a.locator('#mCancel').boundingBox()];
  expect(Math.abs(ok.height - no.height)).toBeLessThan(1); expect(Math.abs(ok.y - no.y)).toBeLessThan(1);
  await a.click('#mOk');
  await expect.poll(async () => (await call(a, 'GET', `/api/meetings/${id}`)).status).toBe(404);
});
