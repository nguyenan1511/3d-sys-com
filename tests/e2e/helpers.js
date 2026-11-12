import { expect } from '@playwright/test';

// mỗi test tự mở nhiều context (nhiều người dùng); đóng hết sau test để các trang 3D không tranh CPU
const opened = [];
// GPU giả lập (SwiftShader) dùng chung cho mọi trang: giới hạn 12 khung hình/giây để trang mới mở không bị trang cũ chiếm hết
/** guide: bật người hướng dẫn đón người mới (mặc định tắt để các test khác vào thẳng màn hình chọn chỗ). */
export async function newPage(browser, { guide = false } = {}) { const c = await browser.newContext(); await c.addInitScript(g => { try { if (!localStorage.getItem('sysone.mode')) localStorage.setItem('sysone.mode', 'office'); } catch { /* */ } /* (bài kiểm thử viết cho Office SYS) */ window.__MAXFPS = 12; window.__PIXEL_RATIO = 0.6; window.__RENDER_EVERY_MS = 2000; if (!g) window.__NO_GUIDE = true; window.__NO_INTRO = true; /* (modal giới thiệu: test riêng ở h-intro) */ }, guide); opened.push(c); return c.newPage(); }
export async function closeAll() { while (opened.length) await opened.pop().close().catch(() => {}); }

let next = 1000 + Math.floor(Math.random() * 8000);
/** Mã 4 chữ số không trùng giữa các test trong một lần chạy (DB mới mỗi lần chạy). */
export const uniqueCode = () => String(1000 + ((next++ - 1000) % 9000));

export async function loginEmployeeUI(page, input) {
  await page.goto('/');
  await page.fill('#empInput', input);
  await page.click('#empSubmit');
}
const pages = new Set();
/** Chờ cảnh 3D sẵn sàng. Trong lúc chờ, các trang khác tạm dừng vẽ (GPU giả lập dùng chung: trang đang vẽ làm trang đang tải chậm hẳn). */
export async function waitScene(page) {
  pages.add(page); page.once('close', () => pages.delete(page));
  const others = [...pages].filter(p => p !== page && !p.isClosed());
  await Promise.all(others.map(p => p.evaluate(() => { window.__PAUSE_RENDER = true; }).catch(() => {})));
  try { await waitSceneOnly(page); } finally { await Promise.all(others.map(p => p.evaluate(() => { window.__PAUSE_RENDER = false; }).catch(() => {}))); }
}
async function waitSceneOnly(page) {
  await page.waitForFunction(() => window.__app && window.__app.ready && window.__app.session?.rt?.connected && window.__app.session.synced, null, { timeout: 120_000 }); // (GPU giả lập: dựng toà nhà 3 tầng của my-office mất lâu hơn khi trang khác đang vẽ)
}
/** Lần đầu vào phải tạo nhân vật: bấm lưu với lựa chọn mặc định. */
export async function finishAvatar(page) {
  await page.locator('#avSave').click();
  await page.locator('#avSave').waitFor({ state: 'detached' });
}
/** Gọi API bằng cookie của context (giống client gọi trực tiếp). */
export async function call(page, method, path, body) {
  const r = await page.request.fetch(path, { method, data: body === undefined ? undefined : body, headers: { 'Content-Type': 'application/json' } });
  let json = null; try { json = await r.json(); } catch { /* không có body */ }
  return { status: r.status(), body: json };
}
export async function loginEmployeeAPI(page, input) {
  const r = await call(page, 'POST', '/api/login/employee', { input });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.employee;
}
export async function loginAdminAPI(page) {
  const r = await call(page, 'POST', '/api/login/admin', { username: 'admin', password: process.env.E2E_ADMIN_PW });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}
/** Một chỗ trống bất kỳ trên tầng f (mỗi test lấy chỗ khác nhau). */
export async function freeDesk(page, floor = 1) {
  const r = await call(page, 'GET', '/api/seats');
  const s = r.body.seats.find(x => (floor == null || x.floor === floor) && !x.owner && !x.locked && x.kind === 'desk');
  if (!s) throw new Error('hết chỗ trống để test');
  return s.deskId;
}
