// Hệ nút chung (src/ui/style.css "HỆ NÚT CHUNG"): đo thật mọi nút trong luồng phòng họp + bảng tin + hộp xác nhận, trên
// máy tính và điện thoại — nút hành động, thẻ tab, ô chọn giờ / thời lượng, thanh họp trực tuyến: cùng chiều cao 38px,
// bo tròn hẳn, phẳng (không gờ nổi), cùng chữ 800/13px, biểu tượng cùng màu chữ. Hộp xác nhận luôn nằm trên cùng, bấm được.
// Modal dạng dashboard (.sx.dash — Phòng họp, Dự án): thu nhỏ một cỡ — mọi nút 32px, chữ 700/12.5px (vẫn MỘT cỡ trong modal).
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar, call } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(300_000);
test.use({ actionTimeout: 15_000 });

const SEL = ['.sx-primary', '.sx-ghost', '.sx-tabs button', '.mp-sub button', '.mp-durs button', '.mp-sl', '.mt-open', '.mt-end', '.mt-leave', '.mt-cb', '.mt-tabs button[data-tab]', '#modalRoot .modal:not(.charsel) .actions button'].join(', ');
/** Các nút lệch chuẩn trên màn đang mở (rỗng = đạt). */
const outliers = p => p.evaluate(sel => [...document.querySelectorAll(sel)].filter(b => b.offsetParent && b.getBoundingClientRect().width > 0).map(b => {
  const cs = getComputedStyle(b), r = b.getBoundingClientRect(), svg = b.querySelector(':scope > svg'), bad = [], dash = !!b.closest('.sx.dash');
  if (b.offsetHeight !== (dash ? 32 : 38)) bad.push(`cao ${b.offsetHeight}`);   // (offsetHeight: không tính hiệu ứng phóng to lúc hộp mở)
  if (parseFloat(cs.borderTopLeftRadius) < b.offsetHeight / 2 - 1) bad.push(`bo ${cs.borderTopLeftRadius}`);
  if (cs.boxShadow !== 'none') bad.push(`bóng ${cs.boxShadow}`);
  if (dash ? (cs.fontWeight !== '700' || cs.fontSize !== '12.5px') : (cs.fontWeight !== '800' || cs.fontSize !== '13px')) bad.push(`chữ ${cs.fontWeight}/${cs.fontSize}`);
  if (svg && getComputedStyle(svg).color !== cs.color) bad.push('biểu tượng khác màu chữ');
  return bad.length ? `${b.className || b.tagName} "${b.textContent.trim().slice(0, 20)}": ${bad.join(', ')}` : null;
}).filter(Boolean), SEL);
/** Nút có thật sự bấm được (không bị lớp khác che). */
const onTop = (p, sel) => p.evaluate(s => { const b = document.querySelector(s); if (!b) return false; const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }, sel);

for (const vp of [{ n: 'máy tính', w: 1280, h: 800 }, { n: 'điện thoại', w: 390, h: 844 }]) test(`hệ nút chung đồng bộ cả luồng phòng họp — ${vp.n}`, async ({ browser }) => {
  const ca = uniqueCode(), cb = uniqueCode(), bad = {};
  const a = await newPage(browser); await a.setViewportSize({ width: vp.w, height: vp.h }); await loginEmployeeUI(a, `${ca}-Lan`); await waitScene(a); await finishAvatar(a);
  const b = await newPage(browser); await loginEmployeeUI(b, `${cb}-Minh`);
  const check = async name => { const o = await outliers(a); if (o.length) bad[name] = o; };
  const P = t => a.evaluate(t => window.__app.session.meet.panel.open(t), t);
  await P('mine'); await expect(a.locator('.sx')).toBeVisible(); await a.waitForTimeout(500); await check('Cuộc họp của tôi (trống)');
  await P('book'); await a.waitForTimeout(500); await check('Lịch phòng');
  await a.locator('.mp-new').first().click(); await expect(a.locator('.mp-durs')).toBeVisible(); await check('Form đặt phòng');
  const slot = Math.floor(Date.now() / 1800e3) * 1800e3;
  const bk = await call(a, 'POST', '/api/meetings', { title: 'Kiểm nút', start: slot, end: slot + 3600e3, invitees: [`employee:${cb}`] });
  test.skip(bk.status === 400 && /mở từ/.test(bk.body?.error || ''), 'ngoài giờ mở phòng họp (07:00–21:00)');
  expect(bk.status).toBe(200); const id = bk.body.meeting.id;
  try {
    await P('mine'); await expect(a.locator('.mp-card').first()).toBeVisible(); await check('Cuộc họp của tôi (thẻ)');
    await P('folder'); await a.locator('.mp-fd').first().click(); await expect(a.locator('[data-purge]')).toBeVisible(); await check('Folder');
    await a.locator('[data-purge]').click(); await expect(a.locator('#mCancel')).toBeVisible(); await check('Hộp xác nhận xoá');
    expect(await onTop(a, '#mCancel'), 'hộp xác nhận nằm trên bảng Phòng họp').toBe(true);
    await a.locator('#mCancel').click(); await expect(a.locator('#modalRoot .modal-back')).toHaveCount(0);
    await a.locator('.sx .sx-x').first().click();
    await a.click('#btnBoard'); await expect(a.locator('.sx.nb')).toBeVisible(); await a.waitForTimeout(500); await check('Bảng tin');
    await a.locator('.sx .sx-x').first().click();
    await a.evaluate(i => window.__app.session.meet.join(i), id);
    await expect(a.locator('.mt-room')).toBeVisible({ timeout: 30_000 }); await check('Phòng họp (cảnh 3D)');
    await a.locator('.mt-open').click(); await a.locator('.mt-room [data-tab=files]').click(); await a.waitForTimeout(400); await check('Phòng họp (bảng vẽ, Tài liệu)');
    if (await a.locator('.mt-sx').isVisible()) await a.locator('.mt-sx').click();   // (điện thoại: tấm Chat/Tài liệu đang mở thì thanh nút họp ẩn — thu tấm lại)
    await a.locator('.mt-vview').click(); await check('Phòng họp (màn hình họp)');
    await a.locator('.mt-end').click(); await expect(a.locator('#mCancel')).toBeVisible(); await check('Hộp xác nhận kết thúc');
    expect(await onTop(a, '#mCancel'), 'hộp xác nhận nằm trên phòng họp').toBe(true);
    await a.locator('#mCancel').click();
    expect(bad).toEqual({});
  } finally { await call(a, 'DELETE', `/api/meetings/${id}/data`, {}); }
});
