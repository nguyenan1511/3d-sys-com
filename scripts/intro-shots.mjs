// Chụp hình minh hoạ cho modal "Có gì ở văn phòng?" từ chính cảnh 3D của app (bản build production): mỗi mục trong
// public/data/intro.json một ảnh 3D thật — buồng karaoke, bàn bi-a, máy chấm công, nhân vật đang vẫy tay / nhảy…
// Camera tự chọn góc: thử nhiều hướng quanh vật, bỏ hướng bị tường che (tia va chạm của camera), ưu tiên hướng gợi ý.
// Ảnh: public/intro/<id>.webp (640×400). Thêm tính năng mới: thêm một mục vào SHOTS dưới đây rồi chạy lại.
// Dùng: npm run build && node scripts/intro-shots.mjs [--only=id1,id2] [--headed]
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { startServer } from './_server.mjs';

const ROOT = path.resolve(import.meta.dirname, '..'), OUT = path.join(ROOT, 'public/intro');
const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]?.split(',');
process.env.NODE_ENV = 'production';
fs.mkdirSync(OUT, { recursive: true });

// Mỗi ảnh: hàm chạy trong trang (nhận S = công cụ dựng cảnh) trả về { focus, dist, h, prefer } hoặc tự đặt camera.
//   focus: điểm nhìn {x, z, f, y?}; dist: khoảng cách camera (m); h: độ cao mắt so với sàn; prefer: hướng ưu tiên (rad, 0 = +z)
//   who: đặt nhân vật của mình ({ x, z, act, faceCam }) — không có thì nhân vật bị ẩn
const SHOTS = {
  move: S => { const w = S.wp.sidewalk; return { eye: { x: w.x + 0.6, y: 1.7, z: w.z + 3.6 }, look: { x: w.x + 0.3, y: 0.8, z: w.z }, who: { x: w.x - 2.4, z: w.z, walkTo: { x: w.x + 3, z: w.z } } }; },
  interact: S => { const a = S.s.att.spot; return { focus: { x: a.stand.x, z: a.stand.z, f: 0 }, who: { x: a.stand.x, z: a.stand.z, faceTo: a }, dist: 2.4, h: 1.6, prefer: 2.4 }; },
  chat: S => { const g = S.s.guide?.agent, w = g ? { x: g.x + 0.95, z: g.z + 0.35 } : S.wp.lobby; return { focus: { x: (w.x + (g?.x ?? w.x)) / 2, z: (w.z + (g?.z ?? w.z)) / 2, f: 0 }, who: { x: w.x, z: w.z, faceTo: g || null, act: 'wave' }, dist: 2.6, h: 1.45, prefer: 0.2 }; },
  camera: S => ({ eye: { x: S.box.cx + 18, y: 16, z: S.box.z1 + 16 }, look: { x: S.box.cx, y: 2, z: S.box.cz } }),
  desk: S => { const d = S.m.desks.find(d => d.floor === 1) || S.m.desks[0]; return { focus: { x: d.x, z: d.z, f: d.floor }, dist: 3.4, h: 2.0, prefer: 0.8 }; },
  clock: S => { const a = S.s.att.spot; return { focus: { x: a.x, z: a.z, f: 0, y: 1.25 }, dist: 1.25, h: 1.4, prefer: Math.atan2(a.stand.x - a.x, a.stand.z - a.z) + 0.35 }; },
  guide: S => { const g = S.s.guide?.agent; return g ? { focus: { x: g.x, z: g.z, f: g.f ?? 0 }, dist: 2.2, h: 1.5, prefer: 0, faceGuide: true } : null; },
  lift: S => { const st = S.s.lift.stops[0]; return { focus: { x: st.door.x, z: st.door.z, f: 0, y: 1.2 }, dist: 3.0, h: 1.6, prefer: Math.atan2(st.x - st.door.x, st.z - st.door.z) }; },
  travel: S => ({ eye: { x: S.box.cx - 4, y: 24, z: S.box.z1 + 10 }, look: { x: S.box.cx, y: 0, z: S.box.cz }, noRoof: true, floor: 1 }),
  karaoke: S => { const b = S.s.ktv.spot; return { focus: { x: b.x, z: b.z, f: b.f, y: 1.2 }, dist: 3.3, h: 1.6, prefer: 0 }; },
  billiards: S => { const t = S.s.bil.table; return { focus: { x: t.x, z: t.z, f: t.f, y: 0.6 }, dist: 3.0, h: 2.3, prefer: 3.75 }; },
  tv: S => { const s0 = S.s.tv.seats[0]; return { focus: { x: s0.x, z: s0.z, f: 0, y: 0.7 }, who: { x: s0.front.x, z: s0.front.z, sofa: s0 }, dist: 3.2, h: 1.7, prefer: s0.yaw + Math.PI }; },
  music: S => { const st = S.app.musicCorner.stand; return { focus: { x: st.x, z: st.z, f: 0, y: 1.0 }, dist: 2.6, h: 1.6, prefer: Math.PI }; },
  // bảng thông báo ở sảnh: vài tin mẫu chỉ vẽ trên máy chụp ảnh (không lưu)
  board: S => { const b = S.s.board; if (!b) return null; b.ensure(); if (!b.spot) return null; const n = Date.now(); b.top = [['Tiệc tất niên SYSONE 2026', 'event', 9], ['Nghỉ Tết Dương lịch 01/01', 'notice', 0], ['Team building Vũng Tàu', 'event', 23], ['Cập nhật quy định chấm công', 'notice', 0], ['Khám sức khoẻ định kỳ', 'event', 5], ['Chào mừng 3 bạn Fresher mới', 'notice', 0]].map(([title, kind, d], i) => ({ id: i + 1, title, kind, eventAt: kind === 'event' ? n + d * 86400e3 : null, upcoming: kind === 'event', place: kind === 'event' ? 'Sảnh tầng trệt' : '', pinned: i === 1, byName: 'Phòng HC-NS', createdAt: n - i * 7200e3 })); b.total = 6; b.draw(); return { focus: { x: b.spot.x, z: b.spot.z, f: 0, y: 1.55 }, dist: 2.3, h: 1.6, prefer: b.spot.yaw + 0.25 }; },
  meeting: S => { const d = S.s.meet?.door; if (!d) return null; return { focus: { x: (d.rect.x0 + d.rect.x1) / 2, z: (d.rect.z0 + d.rect.z1) / 2, f: 0, y: 0.8 }, dist: 4.2, h: 2.6, prefer: 0.5, who: { x: d.x, z: d.z - 0.2, faceTo: { x: d.inX, z: d.inZ } } }; },
  acts: S => { const w = S.wp.lobby; return { focus: { x: w.x, z: w.z, f: 0, y: 0.8 }, who: { x: w.x, z: w.z, act: 'wave' }, dist: 1.9, h: 1.2, prefer: -0.4 }; },
  props: S => { const it = S.s.props?.items?.find(i => i.kind === 'coffee') || S.s.props?.items?.[0]; return it ? { focus: { x: it.stand.x, z: it.stand.z, f: it.f, y: 1.0 }, who: { x: it.stand.x, z: it.stand.z, faceTo: it, act: it.act }, dist: 2.2, h: 1.6, prefer: Math.atan2(it.stand.x - it.x, it.stand.z - it.z) + 0.6 } : null; },
  lights: S => { const d = S.m.desks.find(d => d.floor === 1) || S.m.desks[0]; return { night: true, focus: { x: d.x, z: d.z, f: d.floor }, dist: 4.2, h: 2.1, prefer: 0.8 }; },
  wc: S => { const k = S.s.wc.sink, mp = S.s.wc.mirrorPos; if (!k || !mp) return null; const dx = k.x - mp.x, dz = k.z - mp.z, L = Math.hypot(dx, dz); return { eye: { x: k.x + dx / L * 1.45 + dz / L * 0.4, y: 1.85, z: k.z + dz / L * 1.45 - dx / L * 0.4 }, look: { x: mp.x, y: 1.3, z: mp.z }, who: { x: k.x, z: k.z, faceTo: mp } }; },
  blinds: S => { const it = S.s.blinds.items.find(i => i.floor === 1) || S.s.blinds.items[0]; const u = (it.a0 + it.a1) / 2, p = it.c + it.n * 2.4; const fy = S.m.floorY(it.floor); return it.axis === 'z' ? { eye: { x: p, y: fy + 1.6, z: u + 0.8 }, look: { x: it.c, y: fy + 1.5, z: u }, floor: it.floor } : { eye: { x: u + 0.8, y: fy + 1.6, z: p }, look: { x: u, y: fy + 1.5, z: it.c }, floor: it.floor }; },
  street: S => { const w = S.wp.sidewalk; return { eye: { x: w.x + 9, y: 6, z: w.z + 9 }, look: { x: w.x, y: 0.5, z: w.z + 2 } }; },
  look: S => { const w = S.wp.lobby; return { focus: { x: w.x, z: w.z, f: 0, y: 0.75 }, who: { x: w.x, z: w.z }, dist: 1.3, h: 1.0, prefer: 0.25 }; },
  smoke: S => { const w = S.wp.sidewalk; return { focus: { x: w.x, z: w.z, f: 0 }, who: { x: w.x, z: w.z, act: 'smoke' }, dist: 2.0, h: 1.35, prefer: 0.5 }; }
};

const server = await startServer(5191, { demo: false });
const browser = await chromium.launch({ headless: !process.argv.includes('--headed'), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1, storageState: { cookies: [], origins: [{ origin: server.url, localStorage: [{ name: 'sysone.mode', value: 'office' }, { name: 'sysone.intro.seen', value: '999' }] }] } });
await ctx.addInitScript(() => { window.__NO_GUIDE = true; window.__NO_INTRO = true; });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const r = await page.request.post(`${server.url}/api/login/employee`, { data: { input: '9123-Minh Hoạ' } });
if (!r.ok()) throw new Error(await r.text());
await page.request.put(`${server.url}/api/me/look`, { data: { look: { pixel: 'mo-nu', model: 'mo-toy', hairColor: '#1d1a17', skinColor: '#ecc9a8', topColor: '#d9d9d9', bottomColor: '#2b2d42' } } });
await page.goto(`${server.url}/?mode=office`);
await page.waitForFunction(() => window.__app?.ready && window.__app.session?.synced, null, { timeout: 300000 });
await page.locator('#avSave').click({ timeout: 3000 }).catch(() => {});
// ẩn toàn bộ giao diện, chỉ để lại khung 3D (và nhãn/bong bóng khi ảnh cần)
await page.addStyleTag({ content: `#appRoot > :not(#main), #main > :not(#stage), #stage > :not(#c3):not(.tag-layer), .notices, .toast, .guide-card, .gate-hint, #toast, .chat-fab, .touch-ctrl, .tbtns { display: none !important; } .tag-layer { visibility: hidden; } body.show-tags .tag-layer { visibility: visible; }` });
await page.evaluate(() => {
  const A = window.__app, s = A.session, app = A.app, m = app.model, wp = m.waypoints;
  const xs = m.desks.map(d => d.x), zs = m.desks.map(d => d.z);
  window.__S = { s, app, m, wp, box: { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...zs) + Math.max(...zs)) / 2, z1: Math.max(...zs) } };
});
await page.waitForTimeout(2500);

const results = [];
for (const [id, fn] of Object.entries(SHOTS)) {
  if (only && !only.includes(id)) continue;
  const ok = await page.evaluate(async ([id, src]) => {
    const S = window.__S, { s, app, m } = S, THREE_V = (x, y, z) => ({ x, y, z });
    const spec = new Function('S', `return (${src})(S)`)(S);
    if (!spec) return 'bỏ qua (không có vật này trong cảnh)';
    document.body.classList.toggle('show-tags', !!spec.bubble);
    const pl = s.player, a = pl.agent;
    pl.stopPath?.(); a.act = null;
    // đèn công ty (ảnh buổi tối)
    if (app.setLights) app.setLights(!!spec.night);
    let eye, look;
    if (spec.eye) { eye = spec.eye; look = spec.look; }
    else {
      const f = spec.focus.f ?? 0, fy = m.floorY(f), fx = spec.focus.x, fz = spec.focus.z, ly = fy + (spec.focus.y ?? 1.0);
      // chọn hướng: thử 16 hướng, ưu tiên gần "prefer"; bỏ hướng có tường giữa vật và camera
      const cand = [];
      for (let k = 0; k < 16; k++) { const ang = (spec.prefer || 0) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8; cand.push(ang); }
      const rig = app.rig;
      let best = null;
      for (const ang of cand) {
        const ex = fx + Math.sin(ang) * spec.dist, ez = fz + Math.cos(ang) * spec.dist, ey = fy + spec.h;
        const d = { x: ex - fx, y: ey - ly, z: ez - fz }, L = Math.hypot(d.x, d.y, d.z);
        const free = rig.rayCOL ? rig.rayCOL({ x: fx, y: ly, z: fz }, { x: d.x / L, y: d.y / L, z: d.z / L }, L + 0.4, true) : L + 0.4;
        if (free >= L + 0.3) { best = { x: ex, y: ey, z: ez }; break; }
        if (!best || free > best.free) best = { x: fx + Math.sin(ang) * Math.min(spec.dist, free - 0.3), y: ey, z: fz + Math.cos(ang) * Math.min(spec.dist, free - 0.3), free };
      }
      eye = best; look = { x: fx, y: ly, z: fz };
    }
    // nhân vật của mình: đặt vào cảnh (quay mặt về camera) hoặc ẩn
    const floor = spec.floor ?? spec.focus?.f ?? 0;
    pl.sofa = null; pl.seq = null;
    if (spec.who) {
      const w = spec.who; Object.assign(a, { x: w.x, z: w.z, y: m.floorY(floor), f: floor });
      a.yaw = w.yaw ?? (w.faceTo ? Math.atan2(-(w.faceTo.x - w.x), -(w.faceTo.z - w.z)) : Math.atan2(-(eye.x - w.x), -(eye.z - w.z)));
      if (w.sofa) pl.sitSofa(w.sofa); else if (w.act) pl.setAct(w.act);
      window.__walkTo = w.walkTo ? { ...w.walkTo, f: floor } : null;
    } else {
      // không có mình trong ảnh: đứng sau lưng camera, cùng tầng (để cắt tầng đúng)
      const dx = eye.x - look.x, dz = eye.z - look.z, L = Math.hypot(dx, dz) || 1;
      Object.assign(a, { x: eye.x + dx / L * 1.5, z: eye.z + dz / L * 1.5, y: m.floorY(floor), f: floor }); window.__walkTo = null;
    }
    const roof = document.getElementById('cM'); if (roof && roof.checked !== !!spec.noRoof) { roof.checked = !!spec.noRoof; roof.dispatchEvent(new Event('change')); }
    if (spec.bubble) s.social?.showBubble?.(s.key, spec.bubble);
    app.setCamOverride({ eye: new app.camera.position.constructor(eye.x, eye.y, eye.z), look: new app.camera.position.constructor(look.x, look.y, look.z) });
    return 'ok';
  }, [id, fn.toString()]);
  if (ok !== 'ok') { results.push(`${id}: ${ok}`); continue; }
  await page.waitForTimeout(2600);   // (camera trượt tới, cắt tầng, nhân vật vào tư thế)
  // ảnh "đi lại": bắt đầu đi rồi chụp giữa bước
  if (await page.evaluate(() => { const w = window.__walkTo; if (!w) return false; window.__app.session.player.walkTo(w.x, w.z, w.f); return true; })) await page.waitForTimeout(900);
  const buf = await page.screenshot({ type: 'png' });
  await sharp(buf).resize(640, 400).webp({ quality: 80 }).toFile(path.join(OUT, `${id}.webp`));
  results.push(`${id}: ${(fs.statSync(path.join(OUT, `${id}.webp`)).size / 1024).toFixed(0)} KB`);
}
console.log(results.join('\n'));
if (errs.length) console.log('Lỗi trang:', errs.slice(0, 5));
await browser.close(); server.stop(); process.exit(0);
