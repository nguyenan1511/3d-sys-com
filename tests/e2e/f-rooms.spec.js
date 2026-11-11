// Phòng 3D riêng cho bi-a và karaoke (src/rooms): bấm E ở bàn / buồng → vào phòng 3D riêng (văn phòng ngừng vẽ), chơi trong
// phòng, "Rời bàn / Rời phòng" → về đúng chỗ cũ trong văn phòng. (GPU giả lập: dựng phòng lần đầu mất vài giây)
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(240_000);

const pressE = p => p.evaluate(() => window.__app.session.player.onKey({ key: 'e', type: 'keydown', repeat: false, preventDefault() {} }));
const inRoom = p => p.evaluate(() => window.__app.app.rooms.room?.kind || null);
async function login(browser, name) {
  const p = await newPage(browser);
  await loginEmployeeUI(p, `${uniqueCode()}-${name}`); await waitScene(p); await finishAvatar(p);
  await p.evaluate(() => { window.__RENDER_EVERY_MS = 0; });   // (trong phòng: vẽ đủ khung để thao tác được)
  return p;
}

test('bi-a: E ở bàn mở phòng 3D riêng, 2 người chơi, kéo thanh lực để đánh, rời bàn về văn phòng', async ({ browser }) => {
  const a = await login(browser, 'Bo'), b = await login(browser, 'Ha');
  for (const [p, dx] of [[a, -0.5], [b, 0.5]]) await p.evaluate(dx => { const s = window.__app.session, t = s.bil.table; Object.assign(s.player.agent, { x: t.x + dx, z: t.z + 1.5, y: 0, f: t.f }); s.player.follow(); }, dx);
  await expect.poll(() => a.evaluate(() => document.getElementById('hudPrompt')?.textContent || '')).toContain('chơi bi-a');
  await pressE(a);
  await expect.poll(() => inRoom(a), { timeout: 45000 }).toBe('billiards');
  await expect(a.locator('.room-ui.bil3')).toBeVisible();
  await expect(a.locator('.bil3 .rm-card')).toContainText('chờ người chơi thứ hai');
  // giao diện văn phòng ẩn trong phòng
  await expect(a.locator('#ctrlNav')).toBeHidden();
  await pressE(b);
  await expect.poll(() => inRoom(b), { timeout: 45000 }).toBe('billiards');
  await expect(a.locator('.bil3 .b3-pl')).toHaveCount(2);
  // người tới lượt: thanh lực hiện, kéo xuống rồi thả là đánh
  const myTurn = p => p.evaluate(() => window.__app.session.bil.myTurn());
  await expect.poll(async () => (await myTurn(a)) || (await myTurn(b)), { timeout: 10000 }).toBe(true);
  const shooter = (await myTurn(a)) ? a : b;
  const seq0 = await shooter.evaluate(() => window.__app.session.bil.state.seq);
  const bar = await shooter.locator('.bil3 .b3-power').boundingBox();
  await shooter.mouse.move(bar.x + bar.width / 2, bar.y + 20); await shooter.mouse.down();
  await shooter.mouse.move(bar.x + bar.width / 2, bar.y + bar.height, { steps: 6 }); await shooter.mouse.up();
  await expect.poll(() => shooter.evaluate(() => window.__app.session.bil.state.seq), { timeout: 15000 }).not.toBe(seq0);
  await expect.poll(() => a.evaluate(() => window.__app.session.bil.state.balls.filter(x => x.on).length)).toBeLessThanOrEqual(16);
  // rời bàn: về văn phòng, người kia thấy ván kết thúc
  await a.click('.bil3 .rm-back');
  await expect.poll(() => inRoom(a), { timeout: 10000 }).toBe(null);
  await expect(a.locator('.room-ui.bil3')).toBeHidden();
  await expect(a.locator('#ctrlNav')).toBeVisible();
  await expect.poll(() => b.evaluate(() => window.__app.session.bil.state.phase)).toBe('over');
});

test('karaoke: E ở buồng mở phòng hát 3D, thấy người trong phòng, chat trong phòng, quẩy, rời phòng về văn phòng', async ({ browser }) => {
  const a = await login(browser, 'Ca'), b = await login(browser, 'Si');
  for (const p of [a, b]) await p.evaluate(() => { const s = window.__app.session, k = s.ktv; k.spot ||= k.findBooth(); const o = k.spot; Object.assign(s.player.agent, { x: o.x, z: o.z, y: 0, f: o.f }); s.player.follow(); });
  await expect.poll(() => a.evaluate(() => document.getElementById('hudPrompt')?.textContent || '')).toContain('karaoke');
  await pressE(a);
  await expect.poll(() => inRoom(a), { timeout: 45000 }).toBe('karaoke');
  await expect(a.locator('.room-ui.ktv3')).toBeVisible();
  await expect(a.locator('.ktv3 .ktv-add input')).toBeDisabled();       // (1 người: chưa mở bài được)
  await pressE(b);
  await expect.poll(() => inRoom(b), { timeout: 45000 }).toBe('karaoke');
  await expect(a.locator('.ktv3 .ktv-members li')).toHaveCount(2);
  await expect(a.locator('.ktv3 .ktv-add input')).toBeEnabled();
  await expect.poll(() => a.evaluate(() => window.__app.app.rooms.room.cast.list.length)).toBe(2);   // (nhân vật của cả hai trong phòng)
  // kênh chat riêng của phòng
  await b.evaluate(() => window.__app.session.ktv.say('Hát bài gì đây?'));
  await expect.poll(() => a.evaluate(() => window.__app.session.ktv.chat.map(m => m.text))).toEqual(['Hát bài gì đây?']);
  // quẩy: nhân vật của mình chuyển sang động tác quẩy, người kia thấy
  await a.evaluate(() => window.__app.session.ktv.setDance(true));
  const keyA = await a.evaluate(() => window.__app.session.key);
  await expect.poll(() => b.evaluate(k => window.__app.app.rooms.room.cast.get(k)?.act, keyA)).toBe('quay');
  await b.click('.ktv3 .rm-back');
  await expect.poll(() => inRoom(b), { timeout: 10000 }).toBe(null);
  await expect(a.locator('.ktv3 .ktv-members li')).toHaveCount(1);
  await expect(b.locator('#ctrlNav')).toBeVisible();
});
