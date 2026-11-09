// Đo chất lượng chuyển động và camera của nhân vật chính (chạy: node scripts/motion-check.mjs [chibi|glb] [thư-mục-ảnh])
// - trượt chân: tốc độ ngang của bàn chân đang chạm đất so với tốc độ thân (lý tưởng ~0)
// - camera: độ giật (thay đổi gia tốc góc), vị trí nhân vật trên màn hình, số khung hình nhân vật bị che
import { chromium } from 'playwright';
import { startServer } from './_server.mjs';
const MODE = process.argv[2] || 'glb', OUT = process.argv[3];
const srv = await startServer(5341, { demo: false });
const b = await chromium.launch({ args: ['--use-angle=metal'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(srv.url); await p.fill('#empInput', `${Date.now() % 9000 + 1000}-Test`); await p.click('#empSubmit');
await p.waitForSelector('#avSave', { timeout: 60000 });
// mọi người dùng nhân vật 3D (mặc định là nhân vật đầu tiên trong characters.json)
await p.click('#avSave'); await p.waitForTimeout(500);
await p.evaluate(() => { window.__app.session.endPick(); const pl = window.__app.session.player; Object.assign(pl.agent, { x: 0.3, z: -1.25, y: window.__app.app.model.floorY(1), f: 1, yaw: Math.PI / 2 }); pl.follow(); });
await p.waitForFunction(m => m !== 'glb' || window.__app.app.scene.getObjectsByProperty('isSkinnedMesh', true).length > 0, MODE, { timeout: 20000 });
await p.waitForTimeout(1200);
await p.locator('canvas').first().click({ position: { x: 640, y: 120 } }); await p.keyboard.press('c'); await p.waitForTimeout(800);
// ghi mẫu mỗi khung hình
await p.evaluate(() => {
  const app = window.__app.app, s = window.__app.session, a = s.player.agent, cam = app.camera, T = window.__THREE || null;
  const sys = s.remote.sys, rec = window.__rec = [];
  const V = cam.position.constructor, foot = [new V(), new V()], head = new V(), dir = new V(), fwd = new V();
  const loop = () => {
    if (!window.__rec) return;
    const gi = sys.glb.inst.get(a);
    if (gi) {
      const r = gi.t.def.rig, H = gi.t.H;
      ['shinL', 'shinR'].forEach((n, i) => { foot[i].set(0, (r.ankle - r.knee) * H, 0).applyMatrix4(gi.bones[n].matrixWorld); });
    } else foot.forEach((v, i) => v.setFromMatrixPosition(sys.J.ankle[i]));
    head.set(a.x, a.y + (a.camH || 0.4) * 1.2, a.z);
    const sp = head.clone().project(cam);
    dir.copy(head).sub(cam.position); const dist = dir.length(); dir.normalize();
    const blocked = app.rig.rayCOL(cam.position, dir, dist) < dist - 0.15;
    cam.getWorldDirection(fwd);
    rec.push({ seg: window.__seg, st: a._gl ? a._gl.feet.map(f => f.stance) : null, t: performance.now(), x: a.x, z: a.z, y: a.y, yaw: a.yaw, f: foot.map(v => [v.x, v.y, v.z]), cx: cam.position.x, cy: cam.position.y, cz: cam.position.z, dx: fwd.x, dy: fwd.y, dz: fwd.z, sx: sp.x, sy: sp.y, blocked, walk: a.walkAmt });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
const mark = n => p.evaluate(n => { window.__seg = n; }, n);
const hold = async (keys, ms) => { for (const k of keys) await p.keyboard.down(k); await p.waitForTimeout(ms); for (const k of keys) await p.keyboard.up(k); };
let shot = 0; const snap = async n => { if (OUT) await p.screenshot({ path: `${OUT}/mc-${MODE}-${++shot}-${n}.png` }); };
await mark('walk'); await hold(['w'], 1400); await snap('walk');
await mark('diag'); await hold(['w', 'd'], 1000);
await mark('run'); await p.keyboard.down('Shift'); await hold(['w'], 900); await snap('run'); await hold(['w'], 500); await p.keyboard.up('Shift');
await mark('left'); await hold(['a'], 900); await snap('strafe');
await mark('diag2'); await hold(['w', 'a'], 1200);
await mark('back'); await hold(['s'], 700); await mark('stop');
await p.waitForTimeout(700); await snap('stop');
const rec = await p.evaluate(() => { const r = window.__rec; window.__rec = null; return r; });
// --- phân tích ---
// chân được coi là đang chạm đất khi cổ chân ở sát độ cao thấp nhất của chính nó (sai số 5 mm); đo từng chân riêng
const mv = rec.filter(r => r.walk > 0.5), minY = [0, 1].map(k => Math.min(...mv.map(r => r.f[k][1] - r.y)));
let slideSum = 0, slideN = 0, bodySum = 0; const segs = {};
for (let i = 1; i < rec.length; i++) {
  const A = rec[i - 1], B = rec[i], dt = (B.t - A.t) / 1000; if (dt <= 0 || dt > 0.1) continue;
  const v = Math.hypot(B.x - A.x, B.z - A.z) / dt; if (v < 0.2 || Math.abs(B.y - A.y) > 0.01) continue;
  if (Math.abs(Math.atan2(Math.sin(B.yaw - A.yaw), Math.cos(B.yaw - A.yaw))) / dt > 0.5) continue; // chỉ đo khi đi thẳng
  for (const k of [0, 1]) {
    if (A.st && B.st ? !(A.st[k] && B.st[k]) : (A.f[k][1] - A.y > minY[k] + 0.005 || B.f[k][1] - B.y > minY[k] + 0.005)) continue;
    const sl = Math.hypot(B.f[k][0] - A.f[k][0], B.f[k][2] - A.f[k][2]), bd = Math.hypot(B.x - A.x, B.z - A.z);
    slideSum += sl; bodySum += bd; slideN++;
    const S = (segs[B.seg] ||= [0, 0]); S[0] += sl; S[1] += bd;
  }
}
const ang = []; for (let i = 1; i < rec.length; i++) { const A = rec[i - 1], B = rec[i], dt = (B.t - A.t) / 1000; if (dt <= 0) continue; ang.push(Math.acos(Math.min(1, A.dx * B.dx + A.dy * B.dy + A.dz * B.dz)) / dt); }
const jerk = []; for (let i = 1; i < ang.length; i++) jerk.push(Math.abs(ang[i] - ang[i - 1]));
const pct = (arr, q) => { const s = [...arr].sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))] || 0; };
const moving = rec.filter(r => r.walk > 0.3);
const res = {
  mode: MODE, frames: rec.length,
  footSlide: slideN ? +(slideSum / bodySum).toFixed(3) : null, // 0 = chân không trượt, 1 = trượt như trượt băng
  camAngVel_p95: +pct(ang, 0.95).toFixed(2), camJerk_p95: +pct(jerk, 0.95).toFixed(2), camJerk_max: +pct(jerk, 1).toFixed(2),
  occludedFrames: rec.filter(r => r.blocked).length,
  screenY_mean_moving: +(moving.reduce((s, r) => s + r.sy, 0) / Math.max(1, moving.length)).toFixed(3),
  screenX_absmax: +Math.max(...rec.map(r => Math.abs(r.sx))).toFixed(3),
  offscreen: rec.filter(r => Math.abs(r.sx) > 0.95 || Math.abs(r.sy) > 0.95).length,
  errors: errs.length,
  slideBySegment: Object.fromEntries(Object.entries(segs).map(([k, v]) => [k, +(v[0] / Math.max(1e-6, v[1])).toFixed(3)]))
};
console.log(JSON.stringify(res));
await b.close(); srv.stop();
