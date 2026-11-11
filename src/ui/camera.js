// Camera quỹ đạo + góc đặt sẵn + đi bộ góc nhìn thứ nhất (va chạm COL/FL) + bám theo nhân viên.
import * as THREE from 'three';
import { clamp, angDiff } from '../core/util.js';
import { XL, XR } from '../scene/street.js';

const DT = [0.2, 5, 6];
// Giới hạn camera — lúc nào cũng thấy tổng quan, không kẹt:
//  bám nhân vật: chếch xuống 12°–72°, cách 1.5–9 lần chiều cao nhân vật, gần nhất 0.7 lần (tường ép thì tự xoay ra chỗ thoáng)
//  tổng quan: cách 4–75 m, chếch 3°–86°, tâm nhìn trong khu phố (không trôi ra ngoài)
/** Camera bám nhân vật kiểu hangmu.online (số đo lấy từ code của họ: nhân vật cao 1,91; camera cách 14; tâm nhìn cao 4). */
export const HM = { fov: 55, dist: 9, target: 1.25, pitch: [-0.75, 1.1], pitch0: 0.38, zoom: [3.2, 12], dragMouse: [0.006 * 0.6, 0.004 * 0.6], dragTouch: [0.006, 0.004], edgeRate: 0, edgeZone: 0.07 };
// (target 2,1 → 1,25 lần chiều cao: điểm nhìn ngang vai/đầu thay vì trên đầu như hangmu (hang rộng) — văn phòng trần ~4 m,
// điểm nhìn thấp cho camera thêm ~1 m chiều cao để lùi xa (cùng góc nhìn lùi xa hơn ~60%). dist 7,3 → 9 lần chiều cao, zoom ra tối đa 12: không còn sát nhân vật; pitch0 0,24 → 0,38 rad (~22°) — trong nhà
// trần ~4 m nên lùi xa với góc vừa phải là cách thấy rộng nhất. Ít chóng mặt. edgeRate 0: tắt tự xoay khi chuột ở mép màn hình — người
// dùng thấy chóng mặt; camera chỉ xoay khi người dùng kéo.)
/**
 * Độ mượt của camera bám nhân vật, theo cách các engine game làm:
 * - posTime / yTime: thời gian (s) tâm nhìn đuổi kịp nhân vật — như Damping của Cinemachine 3rd Person Follow / Camera Lag của
 *   Unreal Spring Arm (giảm chấn tới hạn, SmoothDamp). Trục đứng mượt hơn (bậc thang, nhảy, ngồi xuống không làm khung hình nảy);
 *   maxLag: tâm nhìn không tụt sau nhân vật quá chừng này (× chiều cao) — như CameraLagMaxDistance;
 * - inTime / outTime / hold: né vật chắn kiểu Cinemachine Deoccluder — kéo vào nhanh nhưng không giật, giữ chỗ gần nhất ít nhất
 *   `hold` giây rồi mới lùi ra chậm (đi dọc bàn, cột, khung cửa không làm camera co giãn liên tục);
 * - minArm: gần nhất (× chiều cao) — chỗ chật thì nâng camera lên nhìn chếch xuống (tới maxPitch) thay vì tiến sát nhân vật;
 *   pitchTime: thời gian chuyển góc ngẩng đó.
 */
export const FOLLOW = { alignRate: 2.2, posTime: 0.12, yTime: 0.3, maxLag: 0.9, inTime: 0.08, outTime: 0.5, hold: 0.5, minArm: 3.4, maxPitch: 0.84, pitchTime: 0.35, teleport: 4 };
/** SmoothDamp (Unity): giảm chấn tới hạn, không vọt quá, độc lập tốc độ khung hình. Trả về giá trị mới, cập nhật v[k]. */
function smoothDamp(cur, target, v, k, time, dt) {
  const omega = 2 / Math.max(1e-4, time), x = omega * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target, temp = (v[k] + omega * change) * dt;
  v[k] = (v[k] - omega * temp) * e;
  let out = target + (change + temp) * e;
  if ((target - cur > 0) === (out > target)) { out = target; v[k] = 0; } // (không vọt quá đích)
  return out;
}
export const LIM = { fEl: [0.21, 1.26], fR: [1.5, 12], fMin: 0.7, oR: [4, 75], oPh: [0.06, 1.52], ox: [-18, 18], oy: [0, 12], oz: [-10, 28] };
const PH = el => Math.PI / 2 - el; // góc chếch → góc cực
/** Thế giới khác (vd. văn phòng my-office): tâm các góc nhìn tổng quan và vùng giới hạn theo toà nhà trong layout. */
export function setWorldView(box) {
  const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2, span = Math.max(box.x1 - box.x0, box.z1 - box.z0);
  DT[0] = cx; DT[1] = 0.5; DT[2] = cz;
  Object.assign(LIM, { ox: [box.x0 - 6, box.x1 + 6], oz: [box.z0 - 6, box.z1 + 6], oy: [0, 8] });
  Object.assign(PRESETS.A, { th: Math.PI / 4, ph: 0.85, r: span * 1.45 });   // góc isometric 45° như my-office
  Object.assign(PRESETS.W, { th: Math.PI / 4, ph: 0.95, r: span * 2.0 });
  Object.assign(PRESETS.F, { th: 0, ph: 1.1, r: span * 1.4 });
  Object.assign(PRESETS.G, { th: -0.6, ph: 1.25, r: span * 1.3 });
  Object.assign(PRESETS.K, { th: Math.PI, ph: 1.1, r: span * 1.4 });
  Object.assign(PRESETS.T, { r: span * 1.7 });
  Object.assign(PRESETS.L, { th: Math.PI / 4, ph: 0.85, r: span * 1.45, t: [cx, 0.5, cz] });
}

export const PRESETS = {
  L: { th: 0, ph: 1.53, r: 4.6, t: [-1.755, 1.25, 9.3], label: 'Logo' },
  F: { th: 0, ph: 1.46, r: 34, t: DT, label: 'Chính diện' },
  A: { th: 0.55, ph: 1.3, r: 42, t: DT, label: 'Góc chéo' },
  W: { th: -0.25, ph: 1.2, r: 62, t: DT, label: 'Toàn cảnh' },
  G: { th: -0.35, ph: 1.5, r: 36, t: DT, label: 'Góc đường' },
  K: { th: Math.PI, ph: 1.3, r: 44, t: DT, label: 'Phía sau' },
  T: { th: 0, ph: 0.06, r: 60, t: DT, label: 'Từ trên' }
};

export class CameraRig {
  constructor(camera, canvas, world) {
    this.camera = camera; this.canvas = canvas; this.world = world; // world: {COL, FL, gateOpen()}
    this.FOLLOW = FOLLOW; // (kiểm thử / tinh chỉnh độ mượt — xem FOLLOW)
    // chế độ camera khi bám nhân vật của mình (kiểu hangmu): 'bám theo' (mặc định — đi đâu camera tự vòng ra sau lưng, kéo
    // chuột không xoay) và 'xem xung quanh' (Esc; điện thoại: kéo màn hình) — kéo để nhìn quanh; đi tiếp là về 'bám theo'
    this.lookMode = false; this.onLookModeChange = () => {}; this.onDragInFollow = () => {};
    this.S = { th: 0.5, ph: 1.3, r: 46, t: new THREE.Vector3(0.2, 5, 6) };
    this.G = { th: 0.5, ph: 1.3, r: 46, t: new THREE.Vector3(0.2, 5, 6) };
    this.drag = false; this.auto = false; this.walkMode = false; this.follow = null;
    this.PL = { x: 0.4, z: 12, yaw: 0, pitch: 0, feet: 0.15 };
    this.keys = {}; this.holds = {};
    this.onWalkChange = () => {};
    this.onUserOrbit = () => {};
    this.lastUserOrbit = 0; this.camDist = null; this.squeezeT = 0; this.recenter = false;
    // quán tính xoay (kiểu OrbitControls enableDamping): vận tốc góc rad/s, giảm dần sau khi thả chuột
    this.vth = 0; this.vph = 0;
    this.reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._t = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._bind();
  }
  go(k) {
    this.stopCoast();
    if (this.walkMode) this.setWalk(false);
    const p = PRESETS[k]; this.follow = null;
    this.G.th = p.th; this.G.ph = p.ph; this.G.r = p.r; this.G.t.set(...p.t); this.auto = false;
  }
  view(th, ph, r, t) { if (this.walkMode) this.setWalk(false); this.G.th = th; this.G.ph = ph; this.G.r = r; this.G.t.set(t[0], t[1], t[2]); }
  snap() { this.S.th = this.G.th; this.S.ph = this.G.ph; this.S.r = this.G.r; this.S.t.copy(this.G.t); }
  zoom(f) {
    if (this.walkMode) return;
    if (this.follow && this.follow.local) {
      const H = (this.follow.camH ?? 0.375) / 0.5;
      this.G.r = clamp(this.G.r * f, HM.zoom[0] * H, HM.zoom[1] * H);
    }
    else this.G.r = clamp(this.G.r * f, LIM.oR[0], LIM.oR[1]);
  }

  /**
   * Quán tính sau khi thả chuột: camera trôi tiếp theo hướng vừa kéo rồi dừng êm (giảm ~99% trong 0,8 s).
   * phLim: [min, max] góc cực của chế độ hiện tại. Trả về true khi còn đang trôi.
   */
  coast(dt, phLim) {
    if (this.drag || (!this.vth && !this.vph)) return false;
    const S = this.S, G = this.G;
    if (!this.canOrbit(S.th + this.vth * dt, S.ph)) { this.stopCoast(); return false; } // trôi tới tường: dừng
    S.th += this.vth * dt; G.th = S.th;
    if (this.vph) { S.ph = clamp(S.ph + this.vph * dt, phLim[0], phLim[1]); G.ph = S.ph; }
    const f = Math.exp(-dt * 6); this.vth *= f; this.vph *= f;
    if (Math.abs(this.vth) < 0.02 && Math.abs(this.vph) < 0.02) { this.vth = this.vph = 0; return false; }
    this.lastUserOrbit = performance.now();                 // đang trôi = người dùng đang chỉnh: không tự xoay tránh góc chết
    return true;
  }
  stopCoast() { this.vth = this.vph = 0; }
  /** Bật / tắt chế độ 'xem xung quanh' (Esc). Tắt = 'bám theo': camera tự vòng ra sau lưng khi nhân vật di chuyển. */
  setLookMode(on) {
    on = !!on; if (this.lookMode === on) return;
    this.lookMode = on; this.stopCoast();
    if (this.canvas) this.canvas.style.cursor = on ? 'grab' : '';
    this.onLookModeChange(on);
  }

  setWalk(on) {
    this.walkMode = on; this.follow = null;
    this.camera.fov = on ? 68 : 35; this.camera.near = on ? 0.08 : 0.3; this.camera.updateProjectionMatrix();
    if (on) { this.auto = false; this.canvas.focus(); }
    this.onWalkChange(on);
  }
  tele(x, z, yaw, feet) { Object.assign(this.PL, { x, z, yaw, pitch: 0, feet }); this.setWalk(true); }

  /** Va chạm thân hình trụ bán kính r, từ feet+h0 tới feet+h1 (h0 nhỏ hơn bậc thang thì không bước lên được). */
  blocked(x, z, feet, r = 0.25, h0 = 0.5, h1 = 1.7) {
    const bd = this.world.bounds || { z0: -10.3, z1: 30.2 };
    if (x < XL + 0.3 || x > XR - 0.3 || z < bd.z0 || z > bd.z1) return true;
    const y0 = feet + h0, y1 = feet + h1, gateOpen = this.world.gateOpen();
    for (const c of this.world.COL) {
      if (c.gate && gateOpen) continue;
      if (y1 <= c.y0 || y0 >= c.y1) continue;
      const dx = Math.max(c.x0 - x, 0, x - c.x1), dz = Math.max(c.z0 - z, 0, z - c.z1); // thân tròn (không vướng góc)
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }
  groundAt(x, z, feet) { let best = 0; for (const f of this.world.FL) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1 && f.top <= feet + 0.46 && f.top > best) best = f.top; return best; }

  walkStep(dt) {
    const k = this.keys, h = this.holds, PL = this.PL;
    const f = ((k.w || k.up || h.f) ? 1 : 0) - ((k.s || k.down || h.b) ? 1 : 0), s = ((k.d || h.r) ? 1 : 0) - ((k.a || h.l) ? 1 : 0), tr = ((k.left || h.tl) ? 1 : 0) - ((k.right || h.tr) ? 1 : 0);
    PL.yaw += tr * 1.6 * dt;
    const sp = 2.4 * dt, fx = -Math.sin(PL.yaw), fz = -Math.cos(PL.yaw), rx = Math.cos(PL.yaw), rz = -Math.sin(PL.yaw);
    const dx = (fx * f + rx * s) * sp, dz = (fz * f + rz * s) * sp;
    if (dx !== 0 && !this.blocked(PL.x + dx, PL.z, PL.feet)) PL.x += dx;
    if (dz !== 0 && !this.blocked(PL.x, PL.z + dz, PL.feet)) PL.z += dz;
    const gy = this.groundAt(PL.x, PL.z, PL.feet);
    PL.feet += (gy - PL.feet) * Math.min(1, dt * 10);
    this.camera.position.set(PL.x, PL.feet + 1.62, PL.z);
    const cp = Math.cos(PL.pitch);
    this.camera.lookAt(PL.x + fx * cp, PL.feet + 1.62 + Math.sin(PL.pitch), PL.z + fz * cp);
  }

  /** Khoảng cách tự do từ p theo hướng d (đơn vị) tới khối va chạm gần nhất (tối đa maxD). */
  rayCOL(p, d, maxD, skipLow = false) {
    let best = maxD;
    const inv = [1 / d.x, 1 / d.y, 1 / d.z];
    for (const c of this.world.COL) {
      if (c.gate && this.world.gateOpen()) continue;
      if (c.glass) continue; // vách kính: nhìn xuyên được — không kéo camera lại, không che nhãn tên
      if (c.y0 >= (this.cutY ?? Infinity)) continue; // phần đã bị cắt tầng (nhìn xuyên từ trên)
      if (c.low && (skipLow || p.y > c.y1 + 0.15)) continue; // đồ đạc thấp (bàn, ghế, tủ) dưới tầm vai: không kéo camera lại (đỡ co giãn liên tục)
      // bỏ khối đang chứa điểm đầu (vd. đứng sát lan can)
      if (p.x > c.x0 && p.x < c.x1 && p.y > c.y0 && p.y < c.y1 && p.z > c.z0 && p.z < c.z1) continue;
      let t0 = 0, t1 = best, ok = true;
      for (const [o, i, a, b] of [[p.x, inv[0], c.x0, c.x1], [p.y, inv[1], c.y0, Math.min(c.y1, this.cutY ?? Infinity)], [p.z, inv[2], c.z0, c.z1]]) {
        let ta = (a - o) * i, tb = (b - o) * i;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 < best) best = t0;
    }
    return best;
  }

  /**
   * Nhìn thấy nhân vật a tới đâu nếu camera ở hướng th (góc ngẩng ph, cách r): mỗi điểm (đầu, chân) được 1 khi không vướng
   * gì, 0,6 khi chỉ vướng đồ đạc thấp, 0 khi bị tường/vách che. 2 = thấy trọn người.
   */
  viewScore(a, th, ph, r, H) {
    const t = this.S.t, C = this._vc || (this._vc = new THREE.Vector3()), o = this._vo || (this._vo = new THREE.Vector3()), d = this._vd || (this._vd = new THREE.Vector3());
    C.set(t.x + r * Math.sin(ph) * Math.sin(th), t.y + r * Math.cos(ph), t.z + r * Math.sin(ph) * Math.cos(th));
    if (this.clamp) this.clamp(C);
    if (this.world.sameSpace && !this.world.sameSpace(a, C)) return 0; // nhân vật trong nhà mà camera ra ngoài tường: góc chết
    let s = 0;
    for (const hy of [0.95 * H, 0.18 * H]) {
      o.set(a.x, a.y + hy, a.z); d.subVectors(C, o); const L = d.length(); if (L < 0.01) continue; d.multiplyScalar(1 / L);
      if (this.rayCOL(o, d, L, true) < L - 0.05) continue;          // tường, vách, cột che
      s += this.rayCOL(o, d, L) < L - 0.05 ? 0.6 : 1;               // chỉ vướng đồ đạc thấp
    }
    return s;
  }

  /** Camera bám nhân vật kiểu game: tự xoay về sau lưng khi đi, tránh tường, góc chết thì tự canh giữa. */
  /** Góc nhìn thứ nhất (phím V) khi đang điều khiển nhân vật. */
  setFirstPerson(on) {
    this.fp = !!on; this.stopCoast();
    if (this.follow) this.follow._fpHide = this.fp;
    if (this.fp && this.follow) { this.S.th = this.G.th = this.follow.yaw; this.fpPitch = -0.08; }
    else if (this.follow) { this.S.th = this.G.th = this.follow.yaw; this.camDist = null; }
  }

  /**
   * Khoảng trống cho "cần" camera (spring arm) tính từ tâm nhìn t theo hướng (th, ph), tối đa maxD:
   * - tường, vách, cột (bỏ qua đồ đạc thấp);
   * - camera có bề dày và phải thấy cả đầu lẫn chân: bắn 5 tia (tâm, 2 mép ống kính, ngang đầu, ngang chân);
   * - không lên quá trần (this.clamp) và không lọt ra ngoài vỏ nhà khi nhân vật ở trong nhà (world.sameSpace).
   */
  armFree(t, th, ph, maxD, a) {
    const d = this._ad || (this._ad = new THREE.Vector3()), o = this._ao || (this._ao = new THREE.Vector3()), q = this._aq || (this._aq = new THREE.Vector3());
    const sp = Math.sin(ph); d.set(sp * Math.sin(th), Math.cos(ph), sp * Math.cos(th));
    let f = this.rayCOL(t, d, maxD, true);
    // tia song song từ đầu và chân nhân vật (lan can, bờ tường thấp không được che mất chân) và hai mép ống kính
    const rx = Math.cos(th), rz = -Math.sin(th), w = 0.12, H = a ? (a.camH ?? 0.375) / 0.5 : 0.75;
    // (tâm nhìn ở 1,15H: đầu ≈ −0,2H, chân ≈ −1,0H)
    for (const [sx, sy] of [[1, 0], [-1, 0], [0, -0.2 * H], [0, -1.0 * H]]) { o.set(t.x + rx * sx * w, t.y + sy, t.z + rz * sx * w); f = Math.min(f, this.rayCOL(o, d, f, true)); }
    f = Math.max(0, f - 0.18);
    if (this.clamp && d.y > 0.02) { q.set(t.x + d.x * f, t.y + d.y * f, t.z + d.z * f); const y0 = q.y; this.clamp(q); if (q.y < y0 - 1e-3) f = Math.max(0, (q.y - t.y) / d.y); }
    if (this.world.sameSpace && a) for (let i = 0; i < 24 && f > 0.3; i++) { q.set(t.x + d.x * f, t.y + d.y * f, t.z + d.z * f); if (this.world.sameSpace(a, q)) break; f -= 0.2; }
    return f;
  }
  /**
   * Khoảng trống tốt nhất tại hướng th: thử góc người dùng chọn, rồi nâng dần camera lên cao (nhìn chếch xuống nhiều hơn)
   * cho tới khi đủ chỗ. Trả về { f, ph }.
   */
  bestArm(t, th, ph, want, a, need) {
    // như hangmu.online: chỉ tường / vách / trần kéo camera lại; khi bị ép quá sát (< need) mới nâng camera lên dần
    let f = this.armFree(t, th, ph, want, a), best = ph;
    if (f >= need) return { f, ph };
    for (let el = PH(ph) + 0.1; el <= 1.4 + 1e-6; el += 0.1) {
      const p2 = PH(el), f2 = this.armFree(t, th, p2, want, a);
      if (f2 > f + 0.05) { f = f2; best = p2; }
      if (f2 >= need) break;
    }
    return { f, ph: best };
  }
  /**
   * Đồ đạc thấp (bàn, ghế, quầy, chậu cây) có che đầu hoặc chân nhân vật khi camera ở (th, ph, cách r) không.
   * Khối đồ đạc trong dữ liệu va chạm cao 1,4 m cho chắc chân; để nhìn thì coi cao tối đa 0,95 m (bàn, quầy, cây thấp).
   */
  furnitureBlocks(t, th, ph, r, a) {
    if (!a || r < 0.3) return false;
    const H = (a.camH ?? 0.375) / 0.5, sp = Math.sin(ph);
    const cx = t.x + r * sp * Math.sin(th), cy = t.y + r * Math.cos(ph), cz = t.z + r * sp * Math.cos(th);
    for (const hy of [0.92 * H, 0.15 * H]) {
      const ox = a.x, oy = a.y + hy, oz = a.z, dx = cx - ox, dy = cy - oy, dz = cz - oz;
      for (const c of this.world.COL) {
        if (!c.low) continue;
        const top = Math.min(c.y1, c.y0 + 0.95);
        if (oy > top && cy > top) continue;                                   // cả hai đầu cao hơn đồ đạc
        // đoạn thẳng nhân vật → camera cắt hộp đồ đạc? (bỏ đoạn sát chân nhân vật: đứng sát bàn không tính là che)
        let t0 = 0.12, t1 = 1;
        for (const [o, d, lo, hi] of [[ox, dx, c.x0, c.x1], [oy, dy, c.y0, top], [oz, dz, c.z0, c.z1]]) {
          if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t1 = -1; break; } continue; }
          let ta = (lo - o) / d, tb = (hi - o) / d; if (ta > tb) { const q = ta; ta = tb; tb = q; }
          if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) break;
        }
        if (t0 <= t1) return true;
      }
    }
    return false;
  }
  /** Người dùng (hoặc quán tính) có được xoay camera tới hướng th không: chỉ chặn khi hướng mới chật hơn hẳn mà vẫn không đủ chỗ. */
  canOrbit(th, ph) {
    if (this.follow?.local) return true;   // (như hangmu: xoay tự do, tường chỉ kéo camera lại gần)
    const a = this.follow; if (!a || !a.local || this.fp) return true;
    const need = this.armNeed(a), cur = this.lastFree ?? 0;
    const { f } = this.bestArm(this.S.t, th, ph, Math.max(need, this.S.r), a, need);
    return f >= need || f >= cur - 0.05;
  }
  /** Hướng thoáng gần th nhất có khoảng trống thoải mái (≥ 60% khoảng cách mong muốn); không có thì hướng rộng nhất
   *  (phải rộng hơn hẳn hiện tại); null nếu không có hướng nào tốt hơn. */
  openDir(t, th0, ph, r, a, need, cur = 0) {
    const goal = Math.min(r, Math.max(need * 2, r * 0.6));
    let best = null, bf = Math.max(cur * 1.6, cur + 0.8);
    for (let k = 1; k <= 12; k++) for (const sg of [1, -1]) {
      const th = th0 + sg * k * Math.PI / 12, f = this.armFree(t, th, ph, r, a);
      if (f >= goal) return th;
      if (f > bf) { bf = f; best = th; }
    }
    return best;
  }
  /** Bắt đầu bám nhân vật: sau lưng chật thì chọn ngay hướng thoáng gần sau lưng nhất. */
  pickOpenStart(a) {
    const H = (a.camH ?? 0.375) / 0.5, t = this._t.set(a.x, a.y + 1.15 * H, a.z), need = this.armNeed(a);
    const f = this.armFree(t, this.S.th, this.S.ph, this.S.r, a);
    if (f >= need) return;
    const th = this.openDir(t, this.S.th, this.S.ph, this.S.r, a, need, f);
    if (th !== null) { this.S.th = this.G.th = th; this.camDist = null; }
  }
  /**
   * Bắt đầu bám nhân vật mà sau lưng chật (tường ngay sau, vd. chỗ xuất hiện ở sảnh): đặt hướng camera về hướng thoáng gần
   * sau lưng nhất (thử lệch dần 15° hai bên). Chỉ đặt lúc bắt đầu — trong lúc dùng camera không tự xoay.
   */
  pickOpenYaw(a) {
    const H = (a.camH ?? 0.375) / 0.5, t = this._t.set(a.x, a.y + HM.target * H, a.z), pitch = PH(this.S.ph), want = this.S.r;
    const need = Math.min(FOLLOW.minArm * H * 1.5, want), r0 = this.armAt(t, this.S.th, pitch, want, a, H).free;
    if (r0 >= need) return false;
    let best = null, bf = r0 + 0.5;
    for (let k = 1; k <= 12; k++) for (const sg of [1, -1]) {
      const th = this.S.th + sg * k * Math.PI / 12, f = this.armAt(t, th, pitch, want, a, H).free;
      if (f >= need) { this.S.th = this.G.th = th; this.camDist = null; this.camPitch = null; return true; }
      if (f > bf) { bf = f; best = th; }
    }
    if (best !== null) { this.S.th = this.G.th = best; this.camDist = null; this.camPitch = null; return true; }
    return false;
  }
  /** Khoảng cách tối thiểu để thấy trọn nhân vật thoải mái. */
  armNeed(a) { const R = a.camR ?? (a.camH ?? 0.375) / 0.5; return LIM.fR[0] * R * 0.8; }

  /**
   * Camera bám nhân vật kiểu game góc nhìn thứ ba (spring arm):
   * - Kéo chuột để xoay quanh nhân vật, cuộn để gần/xa. Thả chuột thì camera đứng yên ở đó, không tự quay về.
   * - Không bao giờ để tường, vách che nhân vật: có vật cản giữa nhân vật và camera thì camera tự lại gần (nhanh) và nâng
   *   cao lên (nhìn chếch xuống), ra chỗ thoáng thì lùi và hạ về đúng góc người dùng chọn (chậm, êm).
   * - Không cho xoay/trôi vào hướng bị tường chắn kín (canOrbit).
   * Bấm C để về sau lưng.
   */
  updateThirdPerson(dt, a) {
    const S = this.S, G = this.G, H = (a.camH ?? 0.375) / 0.5; // chiều cao nhân vật (camH = 0.5·H)
    const lift = (a.sit || 0) * -0.25 * H;
    // nhìn bằng mắt nhân vật
    if (this.fp) {
      const eye = this._t.set(a.x, a.y + 0.86 * H + lift, a.z);
      this.camera.position.copy(eye);
      this.camera.rotation.set(this.fpPitch ?? -0.08, S.th, 0, 'YXZ');
      if (this.camera.fov !== 70) { this.camera.fov = 70; this.camera.updateProjectionMatrix(); }
      return;
    }
    // ---- camera y hệt hangmu.online (CaveScreen): FOV 55; tâm nhìn cao HM.target × chiều cao (2,1H — trên đầu nhân vật
    // nên nhân vật nằm phần dưới khung hình); camera cách HM.dist × chiều cao (9H) theo góc ngẩng pitch (mặc định 0,38 rad,
    // giới hạn −0,75 → 1,1) và hướng yaw — CHỈ người dùng xoay (kéo / mép màn hình), không tự xoay, không quán tính.
    // Va chạm như hangmu: tìm điểm XA NHẤT còn hợp lệ trên đoạn tâm nhìn → camera (tìm nhị phân 12 bước): trong cùng không
    // gian với nhân vật, dưới trần, cao hơn sàn 0,42H, không nằm trong tường; thêm tia chắn tường để tường không che nhân vật.
    if (this.camera.fov !== HM.fov) { this.camera.fov = HM.fov; this.camera.updateProjectionMatrix(); }
    if (this.edge && HM.edgeRate) { S.th -= this.edge * HM.edgeRate * dt; G.th = S.th; }
    // phòng hẹp (tường kéo camera lại gần): hạ tâm nhìn theo — từ 2,1H (đủ xa, đúng hangmu) xuống ngang vai khi camera chỉ
    // còn cách ~2H, để nhân vật luôn trọn trong khung (hangmu ở hang rộng nên không gặp)
    G.t.set(a.x, a.y + HM.target * H + lift + (a.jumpH || 0), a.z);
    // tâm nhìn không xuyên trần / dầm thấp
    for (const c of this.world.COL) {
      if (c.low || (c.gate && this.world.gateOpen())) continue;
      if (G.t.x > c.x0 && G.t.x < c.x1 && G.t.z > c.z0 && G.t.z < c.z1 && G.t.y > c.y0 && G.t.y < c.y1) G.t.y = Math.max(a.y + 0.9 * H + lift, c.y0 - 0.05);
    }
    if (this.clamp) { const q = this._t.copy(G.t); this.clamp(q); G.t.y = Math.max(a.y + 0.9 * H + lift, Math.min(G.t.y, q.y)); }
    // ---- tâm nhìn bám nhân vật có giảm chấn (không dính chặt từng khung hình) ----
    const v = this._fv || (this._fv = { x: 0, y: 0, z: 0, r: 0, p: 0 });
    if (!this._ftA || this._ftA !== a || S.t.distanceTo(G.t) > FOLLOW.teleport * H) { S.t.copy(G.t); v.x = v.y = v.z = 0; this._ftA = a; this.camDist = null; this.camPitch = null; this._hardPrev = null; } // (mới bám / dịch chuyển xa: đặt thẳng)
    else {
      S.t.x = smoothDamp(S.t.x, G.t.x, v, 'x', FOLLOW.posTime, dt); S.t.z = smoothDamp(S.t.z, G.t.z, v, 'z', FOLLOW.posTime, dt);
      S.t.y = smoothDamp(S.t.y, G.t.y, v, 'y', FOLLOW.yTime, dt);
      const dx = S.t.x - G.t.x, dz = S.t.z - G.t.z, L = Math.hypot(dx, dz), lag = FOLLOW.maxLag * H; // (không tụt quá xa)
      if (L > lag) { S.t.x = G.t.x + dx * lag / L; S.t.z = G.t.z + dz * lag / L; }
      if (Math.abs(S.t.y - G.t.y) > lag) S.t.y = G.t.y + Math.sign(S.t.y - G.t.y) * lag;
    }
    if (this.recenter) { S.th += angDiff(S.th, a.yaw) * Math.min(1, dt * 6); G.th = S.th; if (Math.abs(angDiff(S.th, a.yaw)) < 0.02) this.recenter = false; }
    // chế độ 'bám theo' (như hangmu): nhân vật đang đi thì camera tự vòng ra sau lưng, mượt (giảm chấn ~0,45 s). Đi lùi về phía
    // camera thì không quay (tránh lật 180° gây chóng mặt); đứng yên thì camera đứng yên.
    else if (!this.lookMode && !this.drag && (a.walkAmt || 0) > 0.05) {
      const d = angDiff(S.th, a.yaw), back = Math.cos(d); // (1: đi thẳng ra xa camera, −1: đi về phía camera)
      const k = (1 - Math.exp(-dt * FOLLOW.alignRate)) * clamp((back + 0.35) / 1.35, 0, 1) * Math.min(1, a.walkAmt);
      S.th += d * k; G.th = S.th;
    }
    S.ph = G.ph = clamp(G.ph, PH(HM.pitch[1]), PH(HM.pitch[0]));
    S.r = G.r = clamp(G.r, HM.zoom[0] * H, HM.zoom[1] * H);
    const t = S.t, userPitch = PH(S.ph), need = Math.min(FOLLOW.minArm * H, S.r);
    // ---- chỗ chật: nâng góc ngẩng (camera cao lên, nhìn chếch xuống) cho tới khi đủ khoảng cách tối thiểu ----
    const reach = x => x.free;
    let want = userPitch, arm = this.armAt(t, S.th, userPitch, S.r, a, H);
    if (reach(arm) < need) {
      // thử lệch dần quanh góc người dùng chọn, cả lên (vượt tường, lan can) lẫn xuống (trần thấp chặn khi ngẩng cao); chọn góc
      // gần nhất đủ chỗ, không có thì góc rộng nhất
      let best = arm, bp = userPitch;
      for (let k = 1; k <= 9 && reach(best) < need; k++) for (const p of [userPitch + k * 0.07, userPitch - k * 0.07]) {
        if (p > Math.max(userPitch, FOLLOW.maxPitch) || p < Math.min(userPitch, 0.1)) continue;
        const r2 = this.armAt(t, S.th, p, S.r, a, H);
        if (reach(r2) > reach(best) + 0.05) { best = r2; bp = p; }
        if (reach(best) >= need) break;
      }
      want = bp;
    }
    const now = performance.now() / 1000;
    if (this._lastR !== S.r || this._lastP !== S.ph) { this._lastR = S.r; this._lastP = S.ph; this.userAdjT = now; } // người dùng vừa zoom / kéo góc
    const userAdj = this.drag || now - (this.userAdjT || 0) < 0.3;
    if (this.camPitch == null || this.drag) { this.camPitch = want; v.p = 0; } // (người dùng kéo: theo tay ngay)
    else if (Math.abs(want - userPitch) > Math.abs(this.camPitch - userPitch) + 1e-3) { this.camPitch = smoothDamp(this.camPitch, want, v, 'p', FOLLOW.pitchTime, dt); this.pitchHold = now; } // lệch thêm để né: ngay
    else if (now - (this.pitchHold || 0) > FOLLOW.hold) this.camPitch = smoothDamp(this.camPitch, want, v, 'p', FOLLOW.pitchTime * 1.6, dt); // về lại góc người dùng: sau khi giữ, chậm hơn
    // ---- khoảng cách: vật lý (không vào trong tường / ra ngoài nhà / lên trần) là giới hạn cứng; tầm nhìn (vật chắn giữa
    // camera và nhân vật) thì kéo vào nhanh có giảm chấn, giữ chỗ gần nhất rồi mới lùi ra chậm ----
    const pitch = this.camPitch, cp = Math.cos(pitch);
    const d = this._d.set(Math.sin(S.th) * cp, Math.sin(pitch), Math.cos(S.th) * cp);
    const arm2 = this.armAt(t, S.th, pitch, S.r, a, H), hard = arm2.hard, free = reach(arm2);
    this.lastFree = free; this.lastHard = hard;
    if (this.camDist == null) this.camDist = free;
    else if (free < this.camDist - 1e-3) { this.camDist = smoothDamp(this.camDist, free, v, 'r', FOLLOW.inTime, dt); this.distHold = now; }
    else if (userAdj) this.camDist = smoothDamp(this.camDist, free, v, 'r', 0.12, dt); // (người dùng zoom ra: theo ngay, không chờ)
    else if (now - (this.distHold || 0) > FOLLOW.hold) this.camDist = smoothDamp(this.camDist, free, v, 'r', FOLLOW.outTime, dt);
    else v.r = 0;
    // giới hạn cứng tụt chỉ 1 khung hình (camera lướt qua mép tấm sàn chiếu nghỉ, khung cửa…) thì bỏ qua — chỉ áp dụng khi
    // kéo dài từ 2 khung hình (chậm 16 ms, mắt không thấy) — hết cú giật lớn nhất còn lại khi đi qua cửa khối cầu thang
    const hardEff = Math.max(hard, this._hardPrev ?? hard); this._hardPrev = hard;
    this.camDist = Math.min(this.camDist, hardEff);
    const r = this.camDist;
    this.camera.position.set(t.x + d.x * r, t.y + d.y * r, t.z + d.z * r);
    // camera bị kéo lại gần: hạ dần điểm nhìn về ngang vai để nhân vật luôn trọn trong khung (theo khoảng cách đã làm mượt)
    const k = clamp((r - 2 * H) / Math.max(0.1, S.r - 2 * H), 0, 1);
    this.lookK = this.lookK == null ? k : this.lookK + (k - this.lookK) * (1 - Math.exp(-dt * 6));
    const look = this._lk || (this._lk = new THREE.Vector3());
    look.set(t.x, t.y - (1 - this.lookK) * (HM.target - 0.8) * H, t.z);
    this.camera.lookAt(look);
  }

  /**
   * Cần camera tại góc ngẩng `pitch`, hướng th, dài tối đa r tính từ tâm nhìn t:
   * hard — xa nhất mà camera còn ở chỗ hợp lệ (cùng không gian với nhân vật, dưới trần, trên sàn, không trong khối tường);
   * free — xa nhất mà tường / vách đặc không chen giữa camera và nhân vật (tia từ tâm, đầu, chân; vách kính không tính).
   */
  armAt(t, th, pitch, r, a, H) {
    const cp = Math.cos(pitch), d = this._ad || (this._ad = new THREE.Vector3());
    d.set(Math.sin(th) * cp, Math.sin(pitch), Math.cos(th) * cp);
    const P = this._aq || (this._aq = new THREE.Vector3()), floorY = a.y + 0.42 * H;
    // solid: không lọt vào khối tường / dưới sàn / trên trần — giới hạn cứng (camera ở trong tường thì thấy xuyên tường);
    // space: cùng không gian với nhân vật (vd. nhân vật vừa qua cửa vào khối cầu thang) — coi như vật chắn: kéo theo nhanh
    // có giảm chấn chứ không nhảy cóc qua cửa
    const solid = k => {
      P.set(t.x + d.x * k, t.y + d.y * k, t.z + d.z * k);
      if (P.y < floorY) return false;
      if (this.clamp) { const y0 = P.y; this.clamp(P); if (P.y < y0 - 1e-3) return false; }
      for (const c of this.world.COL) { if (c.low || c.glass || (c.gate && this.world.gateOpen())) continue; if (P.x > c.x0 && P.x < c.x1 && P.y > c.y0 && P.y < c.y1 && P.z > c.z0 && P.z < c.z1) return false; }
      return true;
    };
    const both = k => solid(k) && (!this.world.sameSpace || (P.set(t.x + d.x * k, t.y + d.y * k, t.z + d.z * k), this.world.sameSpace(a, P)));
    const search = ok => { let lo = 0, hi = r; if (!ok(hi)) { for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; } hi = lo; } return hi; };
    const hardHi = search(solid), hi = this.world.sameSpace ? Math.min(hardHi, search(both)) : hardHi;
    let free = hi;
    const o = this._ao || (this._ao = new THREE.Vector3());
    for (const oy of [0, -(HM.target - 0.9) * H, -(HM.target - 0.15) * H]) { o.set(t.x, t.y + oy, t.z); free = Math.min(free, this.rayCOL(o, d, free, true)); }
    return { hard: Math.max(0.3, hardHi - 0.05), space: Math.max(0.3, hi - 0.05), free: Math.max(0.3, free - 0.12) };
  }

  update(dt) {
    if (this.walkMode) { this.walkStep(dt); return; }
    const S = this.S, G = this.G;
    if (this.follow && this.follow.local) {
      if (this.camera.near !== 0.05) { this.camera.fov = 50; this.camera.near = 0.05; this.camera.updateProjectionMatrix(); }
      this.updateThirdPerson(dt, this.follow); return;
    }
    this.camDist = null;
    // tổng quan: không để tâm nhìn trôi ra ngoài khu phố, không quá gần / quá xa / lật xuống dưới đất
    if (!this.follow || !this.follow.local) {
      for (const T of [G.t, S.t]) T.set(clamp(T.x, LIM.ox[0], LIM.ox[1]), clamp(T.y, LIM.oy[0], LIM.oy[1]), clamp(T.z, LIM.oz[0], LIM.oz[1]));
      G.r = clamp(G.r, LIM.oR[0], LIM.oR[1]); G.ph = clamp(G.ph, LIM.oPh[0], LIM.oPh[1]);
    }
    if (!this.auto) this.coast(dt, LIM.oPh);
    if (this.follow) { const a = this.follow; G.t.lerp(new THREE.Vector3(a.x, a.y + (a.camH ?? 1.0) + (a.jumpH || 0) * 0.5, a.z), Math.min(1, dt * (a.local ? 10 : 4))); }
    const k = 1 - Math.pow(0.001, dt);     // nội suy không phụ thuộc fps
    S.t.lerp(G.t, k);
    if (!this.drag) {
      if (this.auto) { S.th += 0.25 * dt; G.th = S.th; }
      else { const d = ((G.th - S.th + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; S.th += d * k; }
      S.ph += (G.ph - S.ph) * k; S.r += (G.r - S.r) * k;
    }
    const t = S.t;
    this.camera.position.set(t.x + S.r * Math.sin(S.ph) * Math.sin(S.th), t.y + S.r * Math.cos(S.ph), t.z + S.r * Math.sin(S.ph) * Math.cos(S.th));
    if (this.clamp) this.clamp(this.camera.position);
    // bám nhân vật: góc nhìn rộng hơn cho không gian thoáng
    const near = this.follow && this.follow.local ? 0.05 : 0.3, fov = this.walkMode ? 68 : (this.follow && this.follow.local ? 60 : 35);
    if (this.camera.near !== near || this.camera.fov !== fov) { this.camera.near = near; this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.lookAt(t);
  }

  _bind() {
    const cv = this.canvas, ptrs = new Map();
    let pd = 0, mid = null, moved = 0, lastT = 0;
    const tpLocal = () => this.follow && this.follow.local;
    const followR = () => this.follow.camR ?? (this.follow.camH ?? 0.375) / 0.5;
    /** Ghi vận tốc góc để thả tay ra còn trôi (làm mượt theo thời gian, bỏ qua khung quá ngắn). */
    const track = (dth, dph) => {
      const now = performance.now(), dt = Math.max(0.008, (now - lastT) / 1000); lastT = now;
      const a = Math.min(1, dt * 20);
      this.vth += (dth / dt - this.vth) * a; this.vph += (dph / dt - this.vph) * a;
    };
    const midOf = () => { const a = [...ptrs.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) }; };
    cv.addEventListener('pointerdown', e => {
      cv.focus(); cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.drag = true; moved = 0; this._dragHinted = false; this.stopCoast(); lastT = performance.now(); if (!tpLocal() || this.lookMode) cv.style.cursor = 'grabbing';
      if (ptrs.size === 2) { const m = midOf(); pd = m.d; mid = m; }
    });
    cv.addEventListener('pointermove', e => {
      // mép trái / phải màn hình (7%): camera tự quay 1,8 rad/s như hangmu (chuột, khi đang bám nhân vật)
      if (e.pointerType === 'mouse' && !ptrs.size) {
        const r = cv.getBoundingClientRect(), u = (e.clientX - r.left) / r.width, z = HM.edgeZone;
        this.edge = tpLocal() && !this.fp ? (u < z ? -(1 - u / z) : u > 1 - z ? (u - (1 - z)) / z : 0) : 0;
      }
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (this.walkMode) { this.PL.yaw -= dx * 0.005; this.PL.pitch = clamp(this.PL.pitch - dy * 0.004, -1.2, 1.2); return; }
      const S = this.S, G = this.G;
      // nhìn bằng mắt nhân vật: kéo để nhìn quanh
      if (this.fp && tpLocal()) { S.th -= dx * 0.005; G.th = S.th; this.fpPitch = clamp((this.fpPitch ?? 0) - dy * 0.005, -1.2, 1.2); return; }
      // hai ngón (điện thoại): chụm/mở để gần/xa, kéo ngang để xoay
      if (ptrs.size === 2) {
        const m = midOf();
        if (pd > 0 && m.d > 0) {
          const f = pd / m.d;
          if (tpLocal()) { const R = followR(); G.r = clamp(G.r * f, LIM.fR[0] * R, LIM.fR[1] * R); }
          else { S.r = G.r = clamp(S.r * f, LIM.oR[0], LIM.oR[1]); }
        }
        if (mid && (!tpLocal() || this.lookMode || this.fp)) { const th2 = S.th - (m.x - mid.x) * 0.005; if (!tpLocal() || this.canOrbit(th2, S.ph)) { S.th = th2; G.th = S.th; } this.lastUserOrbit = performance.now(); }
        pd = m.d; mid = m; return;
      }
      if (ptrs.size !== 1) return;
      // bám nhân vật, chế độ 'bám theo': kéo chuột không xoay (Esc để xem xung quanh); điện thoại không có Esc — kéo màn hình
      // (vượt 8 px, không phải chạm) thì tự sang 'xem xung quanh'
      if (tpLocal() && !this.fp && !this.lookMode) {
        if (e.pointerType === 'mouse') { if (moved > 12 && !this._dragHinted) { this._dragHinted = true; this.onDragInFollow(); } return; } // (đang muốn xoay mà chưa bấm Esc: nhắc)
        if (moved < 8) return; this.setLookMode(true);
      }
      // bám nhân vật (kiểu agent-office): ngang 0.006 rad/px, dọc 0.004 rad/px; tổng quan: 0.008 rad/px
      const local = tpLocal(), touch = e.pointerType !== 'mouse', kx = local ? (touch ? HM.dragTouch[0] : HM.dragMouse[0]) : 0.008, ky = local ? (touch ? HM.dragTouch[1] : HM.dragMouse[1]) : 0.008;
      const lim = local ? [PH(HM.pitch[1]), PH(HM.pitch[0])] : LIM.oPh;
      const ph0 = S.ph;
      let th2 = S.th - dx * kx, ph2 = clamp(S.ph - dy * ky, lim[0], lim[1]);
      // bám nhân vật: không kéo camera vào hướng bị tường chắn kín (giữ nguyên trục bị chặn, trục kia vẫn đi)
      if (local && !this.canOrbit(th2, ph2)) { if (this.canOrbit(th2, S.ph)) ph2 = S.ph; else if (this.canOrbit(S.th, ph2)) th2 = S.th; else { th2 = S.th; ph2 = S.ph; } }
      const dth = th2 - S.th; S.th = th2; S.ph = ph2;
      G.th = S.th; G.ph = S.ph; if (!local) G.r = S.r;
      track(dth, S.ph - ph0);
      this.lastUserOrbit = performance.now(); this.recenter = false;
      if (moved > 6) this.onUserOrbit();
    });
    const up = e => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) { pd = 0; mid = null; }
      if (!ptrs.size) {
        this.drag = false; cv.style.cursor = !tpLocal() || this.lookMode ? 'grab' : '';
        // chỉ trôi khi vừa kéo thật (không phải bấm) và tay còn đang di chuyển lúc thả
        const still = performance.now() - lastT > 90;
        if (this.reduceMotion || this.walkMode || this.fp || tpLocal() || moved <= 6 || still) this.stopCoast();   // (bám nhân vật: như hangmu, thả tay là dừng)
        else { this.vth = clamp(this.vth, -6, 6); this.vph = clamp(this.vph, -3, 3); }
      }
      this.lastMoved = moved;
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { this.edge = 0; }); window.addEventListener('blur', () => { this.edge = 0; });
    cv.addEventListener('wheel', e => {
      if (this.walkMode) return; e.preventDefault();
      // chuẩn hoá: chuột (dòng/trang) và trackpad (điểm ảnh); chụm 2 ngón trên trackpad Mac = wheel + ctrlKey (bước nhỏ)
      let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      if (e.ctrlKey) dy *= 4;
      dy = clamp(dy, -160, 160);                               // một nấc cuộn không nhảy quá xa
      this.zoom(Math.exp(dy * 0.0015));
      if (!tpLocal()) this.S.r = this.G.r;
    }, { passive: false });
    const KM = { w: 'w', s: 's', a: 'a', d: 'd', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', W: 'w', S: 's', A: 'a', D: 'd' };
    cv.addEventListener('keydown', e => {
      // + / − : phóng to / thu nhỏ (bàn phím thường và bàn phím số)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_')) { e.preventDefault(); this.zoom(e.key === '-' || e.key === '_' ? 1.15 : 1 / 1.15); return; }
      const k = KM[e.key]; if (k) { this.keys[k] = true; if (this.walkMode) e.preventDefault(); }
    });
    cv.addEventListener('keyup', e => { const k = KM[e.key]; if (k) this.keys[k] = false; });
    cv.addEventListener('blur', () => { this.keys = {}; });
  }
}
