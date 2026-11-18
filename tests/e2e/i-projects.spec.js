// Workspace dự án (docs/design/projects-workspace.md): A tạo dự án qua giao diện, mời B; B được báo; Kanban (thêm việc, kéo sang
// cột khác, B thấy ngay, giao việc → B được báo); chat dự án + @nhắc tên; người ngoài không thấy dự án; phòng dự án 3D (cả hai
// vào, B được báo khi A vào); đặt họp từ dự án mời cả dự án; hệ nút chung 38px.
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar, call } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(300_000);

test('dự án: tạo + mời, Kanban kéo thả, giao việc, chat @nhắc, riêng tư, phòng dự án, đặt họp cho dự án', async ({ browser }) => {
  const ca = uniqueCode(), cb = uniqueCode(), cc = uniqueCode();
  const a = await newPage(browser); await loginEmployeeUI(a, `${ca}-Lan`); await waitScene(a); await finishAvatar(a);
  const b = await newPage(browser); await loginEmployeeUI(b, `${cb}-Minh Tú`); await waitScene(b); await finishAvatar(b);
  // A tạo dự án qua giao diện, chọn B làm thành viên
  await a.click('#btnProj');
  await expect(a.locator('.pj-body .pj-start .pj-steps li')).toHaveCount(3);   // (chưa có dự án: hướng dẫn 3 bước)
  await a.locator('.pj-h [data-h=new]').click();
  await a.fill('.pj-form [name=name]', 'Dự án kiểm thử');
  await a.fill('.pj-form [name=description]', 'Mô tả ngắn');
  await a.locator('.pj-form .mp-q').fill(cb);
  await a.locator('.pj-form .mp-res [data-k]').first().dispatchEvent('mousedown');
  await expect(a.locator('.pj-form .mp-chip')).toHaveCount(1);
  await a.locator('.pj-form [type=submit]').click();
  await expect(a.locator('.pj-h h2')).toHaveText('Dự án kiểm thử');
  const pid = await a.evaluate(() => window.__app.session.projects.panel.pid);
  // B được báo, mở được dự án; người ngoài (C) không thấy (404)
  await expect(b.locator('.notice', { hasText: 'thêm bạn vào dự án' })).toBeVisible({ timeout: 15_000 });
  const c = await newPage(browser); await call(c, 'POST', '/api/login/employee', { input: `${cc}-Người Ngoài` });
  expect((await call(c, 'GET', `/api/projects/${pid}`)).status).toBe(404);
  expect((await call(c, 'GET', '/api/projects')).body.projects).toEqual([]);
  await b.evaluate(id => window.__app.session.projects.panel.open(id), pid);
  await expect(b.locator('.pj-h h2')).toHaveText('Dự án kiểm thử');
  // hệ nút chung: nút + thẻ tab cao 38
  const hs = await a.evaluate(() => [...new Set([...document.querySelectorAll('.pj .sx-primary, .pj .sx-ghost, .pj-nav button')].filter(x => x.offsetParent).map(x => Math.round(x.getBoundingClientRect().height)))]);
  expect(hs).toEqual([38]);
  // A thêm việc ở cột "Cần làm" → B thấy ngay
  await a.locator('.pj-col[data-st=todo] .pj-add').click();
  await a.locator('.pj-addf textarea').fill('Viết tài liệu');
  await a.keyboard.press('Enter');
  await expect(b.locator('.pj-col[data-st=todo] .pj-card', { hasText: 'Viết tài liệu' })).toBeVisible({ timeout: 15_000 });
  // A kéo thẻ sang "Đang làm"
  const card = a.locator('.pj-col[data-st=todo] .pj-card', { hasText: 'Viết tài liệu' }), col = a.locator('.pj-col[data-st=doing] .pj-cards');
  const p0 = await card.boundingBox(), p1 = await col.boundingBox();
  await a.mouse.move(p0.x + 20, p0.y + 12); await a.mouse.down();
  await a.mouse.move(p0.x + 40, p0.y + 30, { steps: 3 }); await a.mouse.move(p1.x + 30, p1.y + 10, { steps: 8 }); await a.mouse.up();
  await expect(a.locator('.pj-col[data-st=doing] .pj-card', { hasText: 'Viết tài liệu' })).toBeVisible();
  await expect(b.locator('.pj-col[data-st=doing] .pj-card', { hasText: 'Viết tài liệu' })).toBeVisible({ timeout: 15_000 });
  // giao việc cho B trong chi tiết → B được báo
  await a.locator('.pj-card', { hasText: 'Viết tài liệu' }).click();
  await expect(a.locator('.pj-drawer .pj-task')).toBeVisible();
  await a.selectOption('.pj-asg', `employee:${cb}`);
  await expect(b.locator('.notice', { hasText: 'giao việc cho bạn' })).toBeVisible({ timeout: 15_000 });
  await a.locator('.pj-cform textarea').fill('Nhờ bạn làm trước thứ 6');
  await a.keyboard.press('Enter');
  await expect(a.locator('.pj-cmts li', { hasText: 'Nhờ bạn làm trước thứ 6' })).toBeVisible();
  // chat dự án: A gõ @ chọn B → B được báo nhắc tên
  await expect(a.locator('.pj-drawer .pj-task')).toBeVisible(); await a.locator('.pj-drawer [data-x]').click();
  await a.click('.pj-nav [data-tab=chat]');
  await a.locator('.pj-cf input').click(); await a.keyboard.type('Chào @Tú');
  await expect(a.locator('.pj-mention [data-k]')).toHaveCount(1);
  await a.keyboard.press('Enter'); await a.keyboard.type('xem giúp nhé'); await a.keyboard.press('Enter');
  await expect(a.locator('.pj-chat .mt-chat li.me mark')).toHaveText(/@Minh Tú/);
  await expect(b.locator('.notice', { hasText: 'nhắc bạn' })).toBeVisible({ timeout: 15_000 });
  // phòng dự án 3D: A vào → B được báo; B vào → 2 người trong phòng, không có nút "Kết thúc họp"
  await a.click('.pj-h [data-h=room]');
  await expect(a.locator('.mt-room.is-proj')).toBeVisible({ timeout: 30_000 });
  await expect(a.locator('.mt-room .mt-end')).toHaveCount(0);
  await expect(b.locator('.notice', { hasText: 'vừa vào phòng dự án' })).toBeVisible({ timeout: 15_000 });
  await b.evaluate(id => window.__app.session.projects.join(id), pid);
  await expect(a.locator('.mt-here .mt-av')).toHaveCount(2, { timeout: 20_000 });
  await a.locator('.mt-leave').click(); await b.locator('.mt-leave').click();
  await expect(a.locator('.mt-room')).toHaveCount(0);
  // đặt họp cho dự án: mời cả dự án, tài liệu họp hiện trong dự án
  const slot = Math.floor(Date.now() / 1800e3) * 1800e3 + 1800e3;
  const bk = await call(a, 'POST', '/api/meetings', { title: 'Họp dự án', start: slot, end: slot + 1800e3, projectId: pid });
  test.skip(bk.status === 400 && /mở từ|đã qua/.test(bk.body?.error || ''), 'ngoài giờ mở phòng họp (07:00–21:00)');
  expect(bk.status).toBe(200);
  expect(bk.body.meeting.invitees.map(x => x.key)).toEqual([`employee:${cb}`]);
  expect((await call(a, 'POST', `/api/meetings/${bk.body.meeting.id}/files`, { name: 'bien-ban.txt', data: Buffer.from('ok').toString('base64') })).status).toBe(200);
  expect((await call(b, 'GET', `/api/projects/${pid}`)).body.meetingFiles[0].files[0].name).toBe('bien-ban.txt');
  // dọn: xoá cuộc họp (không để lịch trùng cho test khác) và dự án
  await call(a, 'DELETE', `/api/meetings/${bk.body.meeting.id}/data`, {});
  expect((await call(a, 'DELETE', `/api/projects/${pid}`, {})).status).toBe(200);
  await expect(b.locator('.notice', { hasText: 'Dự án đã bị xoá' })).toBeVisible({ timeout: 15_000 });
});
