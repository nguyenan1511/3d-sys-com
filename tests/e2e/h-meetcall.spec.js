// Họp trực tuyến trong phòng họp: hai người vào phòng; A bật camera → B thấy hình A; A chia sẻ màn hình → B (đang xem cảnh
// 3D) tự mở "Màn hình họp", màn hình của A hiện to; mic bật / tắt hiện đúng cho người kia; A rời phòng thì ô của A mất.
// (Trình duyệt kiểm thử dùng camera / màn hình giả: playwright.config.js.)
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar, call } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(240_000);

const videoOk = (p, sel) => p.evaluate(s => { const v = document.querySelector(s); return !!v && v.videoWidth > 0 && v.readyState >= 2; }, sel);

test('họp trực tuyến: camera, chia sẻ màn hình, mic giữa hai người trong phòng họp', async ({ browser }) => {
  const ca = uniqueCode(), cb = uniqueCode();
  const a = await newPage(browser); await loginEmployeeUI(a, `${ca}-Lan`); await waitScene(a); await finishAvatar(a);
  const b = await newPage(browser); await loginEmployeeUI(b, `${cb}-Minh`); await waitScene(b); await finishAvatar(b);
  const slot = Math.floor(Date.now() / 1800e3) * 1800e3;
  const bk = await call(a, 'POST', '/api/meetings', { title: 'Họp trực tuyến', start: slot, end: slot + 3600e3, invitees: [`employee:${cb}`] });
  test.skip(bk.status === 400 && /mở từ/.test(bk.body?.error || ''), 'ngoài giờ mở phòng họp (07:00–21:00)');
  expect(bk.status).toBe(200);
  const id = bk.body.meeting.id;
  try {
    await a.evaluate(i => window.__app.session.meet.join(i), id);
    await b.evaluate(i => window.__app.session.meet.join(i), id);
    await expect(a.locator('.mt-here .mt-av')).toHaveCount(2, { timeout: 20_000 });
    await expect(b.locator('.mt-here .mt-av')).toHaveCount(2, { timeout: 20_000 });

    // thanh nút họp: cùng chiều cao với hệ nút chung
    const hs = await a.evaluate(() => [...new Set([...document.querySelectorAll('.mt-call .mt-cb, .mt-top .mt-leave')].map(x => Math.round(x.getBoundingClientRect().height)))]);
    expect(hs).toEqual([38]);
    await expect(a.locator('.mt-cb[data-m=mic]')).toHaveText(/Bật mic/);

    // hai máy nối được với nhau
    await expect.poll(() => a.evaluate(k => window.__app.session.meet.room.call.connected(k), `employee:${cb}`), { timeout: 30_000 }).toBe(true);

    // A bật camera → B mở màn hình họp, thấy hình của A
    await a.locator('.mt-cb[data-m=cam]').click();
    await expect(a.locator('.mt-cb[data-m=cam]')).toHaveText(/Tắt camera/);
    await b.locator('.mt-vview').click();
    await expect(b.locator('.mt-room.mode-call .mt-vids')).toBeVisible();
    await expect(b.locator('.mt-vview .mt-cnt')).toHaveText('1');
    await expect.poll(() => videoOk(b, `.mt-tile[data-id="employee:${ca}:cam"].live video`), { timeout: 20_000 }).toBe(true);
    await expect(b.locator('.mt-pip')).toBeVisible();   // (cảnh 3D thu nhỏ vẫn có)
    // B quay lại cảnh 3D
    await b.locator('.mt-vview').click();
    await expect(b.locator('.mt-room.mode-scene')).toBeVisible();

    // A chia sẻ màn hình → B đang xem cảnh 3D tự mở màn hình họp, màn hình của A hiện to
    await a.locator('.mt-cb[data-m=screen]').click();
    await expect(a.locator('.mt-cb[data-m=screen]')).toHaveText(/Dừng chia sẻ/, { timeout: 15_000 });
    await expect(b.locator('.mt-room.mode-call')).toBeVisible({ timeout: 15_000 });
    const big = b.locator(`.mt-tile.big[data-id="employee:${ca}:screen"]`);
    await expect(big).toBeVisible();
    await expect.poll(() => videoOk(b, `.mt-tile[data-id="employee:${ca}:screen"].live video`), { timeout: 20_000 }).toBe(true);
    await expect(b.locator('.mt-vstrip .mt-tile')).toHaveCount(2);   // (camera của hai người xếp bên cạnh)
    const bb = await big.boundingBox(); expect(bb.width).toBeGreaterThan(600);

    // mic: A bật → B thấy biểu tượng mic của A bật, có tiếng của A
    await a.locator('.mt-cb[data-m=mic]').click();
    await expect(a.locator('.mt-cb[data-m=mic]')).toHaveText(/Tắt mic/);
    await expect.poll(() => b.evaluate(k => { const r = window.__app.session.meet.room; return !!r.media(k).mic && !!r.call.peers.get(k)?.tracks.mic; }, `employee:${ca}`), { timeout: 15_000 }).toBe(true);
    await expect(b.locator(`.mt-tile[data-id="employee:${ca}:cam"] .mt-tname .ico.mut`)).toHaveCount(0);

    // A dừng chia sẻ → ô màn hình mất bên B
    await a.locator('.mt-cb[data-m=screen]').click();
    await expect(b.locator(`.mt-tile[data-id="employee:${ca}:screen"]`)).toHaveCount(0, { timeout: 15_000 });

    // A rời phòng → B không còn ô của A, kết nối được đóng; máy A tắt hẳn camera / mic (đèn camera tắt)
    await a.evaluate(() => { window.__tracks = Object.values(window.__app.session.meet.room.call.local).filter(Boolean).flatMap(s => s.getTracks()); });
    expect(await a.evaluate(() => window.__tracks.length)).toBe(2);
    await a.locator('.mt-leave').click();
    await expect(b.locator(`.mt-tile[data-id="employee:${ca}:cam"]`)).toHaveCount(0, { timeout: 15_000 });
    expect(await b.evaluate(k => window.__app.session.meet.room.call.peers.has(k), `employee:${ca}`)).toBe(false);
    await expect(a.locator('.mt-room')).toHaveCount(0);
    expect(await a.evaluate(() => window.__tracks.every(t => t.readyState === 'ended'))).toBe(true);
  } finally {
    expect((await call(a, 'DELETE', `/api/meetings/${id}/data`, {})).status).toBe(200);   // (xoá hẳn cuộc họp: trả khung giờ cho bài kiểm thử phòng họp chạy sau)
  }
});
