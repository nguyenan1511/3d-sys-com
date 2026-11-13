// Phòng 3D riêng cho bi-a và karaoke (src/rooms): bấm E ở bàn / buồng → vào phòng 3D riêng (văn phòng ngừng vẽ), chơi trong
// phòng, "Rời bàn / Rời phòng" → về đúng chỗ cũ trong văn phòng. (GPU giả lập: dựng phòng lần đầu mất vài giây)
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(240_000);

const pressE = p => p.evaluate(() => window.__app.session.player.onKey({ key: 'e', type: 'keydown', repeat: false, preventDefault() {} }));
const inRoom = p => p.evaluate(() => window.__app.app.rooms.room?.kind || null);
/** Cảnh vừa vẽ đúng là cảnh 3D của phòng (không phải văn phòng / khung hình cũ). Lỗi cũ: giao diện phòng hiện nhưng cảnh vẫn là văn phòng. */
async function drawsRoom(p) {
  await p.evaluate(() => { const st = window.__app.app.rooms, r = st.renderer; if (!r.__spy) { const orig = r.render.bind(r); r.render = (sc, cam) => { r.__last = sc; return orig(sc, cam); }; r.__spy = true; } r.__last = null; });
  await expect.poll(() => p.evaluate(() => { const st = window.__app.app.rooms; return !!st.room && st.renderer.__last === st.room.scene; }), { timeout: 15000 }).toBe(true);
}
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
  await drawsRoom(a);
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
  await drawsRoom(a);
  await expect(a.locator('.room-ui.ktv3')).toBeVisible();
  await expect(a.locator('.ktv3 .ktv-add input')).toBeDisabled();       // (1 người: chưa mở bài được)
  await pressE(b);
  await expect.poll(() => inRoom(b), { timeout: 45000 }).toBe('karaoke');
  await expect(a.locator('.ktv3 .ktv-members li')).toHaveCount(2);
  await expect(a.locator('.ktv3 .ktv-add input')).toBeEnabled();
  await expect.poll(() => a.evaluate(() => window.__app.app.rooms.room.cast.list.length)).toBe(2);   // (nhân vật của cả hai trong phòng)
  // đi lại trong phòng: A giữ phím A / W → nhân vật đi (không xuyên sofa / tường), B thấy A di chuyển; "Về ghế" thì ngồi lại
  const kA = await a.evaluate(() => window.__app.session.key);
  const posB = () => b.evaluate(k => { const x = window.__app.app.rooms.room.cast.get(k); return x ? { x: +x.x.toFixed(2), z: +x.z.toFixed(2), sit: +x.sit.toFixed(2) } : null; }, kA);
  const before = await posB();
  await a.locator('.ktv3 .rm-input').click({ position: { x: 5, y: 5 } }).catch(() => {});
  // đi như ngoài văn phòng: giữ W nửa giây → đi nhanh như người chơi (≈ player.WALK), chân bước (người kia cũng thấy), camera bám theo
  const ph0 = await b.evaluate(k => window.__app.app.rooms.room.cast.get(k).walkPhase, kA);
  await a.keyboard.down('w');
  await expect.poll(() => a.evaluate(() => !!window.__app.app.rooms.room.free), { timeout: 5000 }).toBe(true);   // (phím W bắt đầu đi tự do)
  await a.keyboard.up('w');
  // tốc độ: 3 bước 0,1 s với phím W (tính thẳng — máy test vẽ rất ít khung hình nên không đo bằng đồng hồ)
  const p1 = await a.evaluate(() => {
    const r = window.__app.app.rooms.room, me = r.cast.get(window.__app.session.key); me.x = -1.21; me.z = 0.4; r.free.x = me.x; r.free.z = me.z; r.vx = r.vz = 0; r.moveRef = null; r.cam.S.th = r.cam.G.th = 0;
    r.keys.add('f'); const z0 = me.z; for (let i = 0; i < 3; i++) r.walk(0.1); r.keys.delete('f'); r.walk(0.1);
    return { dist: z0 - me.z, walk: window.__app.session.player.WALK, camT: r.cam.G.t.toArray(), x: me.x, z: me.z };
  });
  expect(p1.dist / 0.3).toBeGreaterThan(p1.walk * 0.8);                                      // (như ngoài văn phòng, không còn 1,3 m/s)
  expect(Math.hypot(p1.camT[0] - p1.x, p1.camT[2] - p1.z)).toBeLessThan(0.01);               // (camera nhìn theo mình)
  await expect.poll(() => b.evaluate(k => window.__app.app.rooms.room.cast.get(k).walkPhase, kA), { timeout: 5000 }).toBeGreaterThan(ph0 + 1);   // (chân bước, không trượt)
  await a.keyboard.down('a'); await a.waitForTimeout(500); await a.keyboard.up('a');
  const free = await a.evaluate(() => window.__app.app.rooms.room.free);
  expect(free).not.toBeNull();
  expect(Math.abs(free.x) < 2.8 && free.z > -3.3 && free.z < 3.3).toBe(true);
  await expect(a.locator('.ktv3 .k3-seat')).toBeVisible();
  await expect.poll(async () => { const p = await posB(); return Math.hypot(p.x - free.x, p.z - free.z) < 0.15; }, { timeout: 10000 }).toBe(true);
  expect(Math.hypot(before.x - free.x, before.z - free.z)).toBeGreaterThan(0.3);
  await a.click('.ktv3 .k3-seat');
  await expect.poll(async () => (await posB()).sit, { timeout: 10000 }).toBeGreaterThan(0.5);
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
