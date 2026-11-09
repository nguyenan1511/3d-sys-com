// Camera quỹ đạo + góc đặt sẵn + đi bộ góc nhìn thứ nhất (va chạm COL/FL) + bám theo nhân viên.
import * as THREE from 'three';
import { clamp, angDiff } from '../core/util.js';
import { XL, XR } from '../scene/street.js';

const DT = [0.2, 5, 6];
// Giới hạn camera — lúc nào cũng thấy tổng quan, không kẹt:
//  bám nhân vật: chếch xuống 12°–72°, cách 1.5–9 lần chiều cao nhân vật, gần nhất 0.7 lần (tường ép thì tự xoay ra chỗ thoáng)
//  tổng quan: cách 4–75 m, chếch 3°–86°, tâm nhìn trong khu phố (không trôi ra ngoài)
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
      const H = this.follow.camR ?? (this.follow.camH ?? 0.375) / 0.5;
      let r = clamp(this.G.r * f, LIM.fR[0] * H, LIM.fR[1] * H);
      // cuộn ra xa khi sau lưng là tường: không cộng dồn khoảng cách "ảo" (cuộn vào lại có tác dụng ngay)
      if (f > 1 && this.lastFree != null) r = Math.min(r, Math.max(this.G.r, this.lastFree + 0.5));
      this.G.r = r;
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
    for (const [sx, sy] of [[1, 0], [-1, 0], [0, 0.3 * H], [0, -0.45 * H]]) { o.set(t.x + rx * sx * w, t.y + sy, t.z + rz * sx * w); f = Math.min(f, this.rayCOL(o, d, f, true)); }
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
    // tốt: đủ chỗ VÀ bàn ghế, cây cảnh không che mặt/chân nhân vật. Không có góc nào tốt thì lấy góc rộng chỗ nhất.
    let f = this.armFree(t, th, ph, want, a), best = ph;
    if (f >= need && !this.furnitureBlocks(t, th, ph, Math.min(want, f), a)) return { f, ph };
    let good = null;
    for (let el = PH(ph) + 0.1; el <= 1.4 + 1e-6; el += 0.1) {
      const p2 = PH(el), f2 = this.armFree(t, th, p2, want, a);
      if (f2 > f + 0.05) { f = f2; best = p2; }
      if (f2 >= need && !this.furnitureBlocks(t, th, p2, Math.min(want, f2), a)) { good = { f: f2, ph: p2 }; break; }
    }
    return good || { f, ph: best };
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
    const a = this.follow; if (!a || !a.local || this.fp) return true;
    const need = this.armNeed(a), cur = this.lastFree ?? 0;
    const { f } = this.bestArm(this.S.t, th, ph, Math.max(need, this.S.r), a, need);
    return f >= need || f >= cur - 0.05;
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
    const R = a.camR ?? H; // thước đo khoảng cách camera (không co theo nhân vật nhỏ: giữ góc nhìn rộng)
    const lift = (a.sit || 0) * -0.25 * H;
    // nhìn bằng mắt nhân vật
    if (this.fp) {
      const eye = this._t.set(a.x, a.y + 0.86 * H + lift, a.z);
      this.camera.position.copy(eye);
      this.camera.rotation.set(this.fpPitch ?? -0.08, S.th, 0, 'YXZ');
      if (this.camera.fov !== 70) { this.camera.fov = 70; this.camera.updateProjectionMatrix(); }
      return;
    }
    if (this.camera.fov !== 60) { this.camera.fov = 60; this.camera.updateProjectionMatrix(); }
    // tâm nhìn: ngang vai, bám theo nhân vật mượt (nhảy thì chỉ nhấc nửa, đỡ rung)
    G.t.set(a.x, a.y + 0.65 * H + lift + (a.jumpH || 0) * 0.5, a.z);
    S.t.lerp(G.t, 1 - Math.exp(-dt * 14));
    if (this.recenter) { this.stopCoast(); S.th += angDiff(S.th, a.yaw) * Math.min(1, dt * 6); if (Math.abs(angDiff(S.th, a.yaw)) < 0.02) this.recenter = false; }
    else this.coast(dt, [PH(LIM.fEl[1]), PH(LIM.fEl[0])]);
    G.ph = clamp(G.ph, PH(LIM.fEl[1]), PH(LIM.fEl[0])); G.r = clamp(G.r, LIM.fR[0] * R, LIM.fR[1] * R);
    G.th = S.th; S.ph += (G.ph - S.ph) * (1 - Math.exp(-dt * 10)); S.r += (G.r - S.r) * (1 - Math.exp(-dt * 10));

    // spring arm: tìm góc nâng cần thiết (mỗi 0,08 s) để camera đủ xa mà không có tường chen giữa
    const need = this.armNeed(a), t = S.t;
    if (this.camDist === null) { this.aPh = null; this.armT = 0; } // vừa chuyển sang bám nhân vật / dịch chuyển nhanh: tính lại ngay
    this.armT = (this.armT || 0) - dt;
    if (this.armT <= 0 || this.aPh == null) {
      this.armT = 0.08;
      const b = this.bestArm(t, S.th, S.ph, S.r, a, Math.min(S.r, need));
      this.aPhGoal = b.ph;
      // chật kín mọi phía ở góc này (rất hiếm, vd. bị đặt sát góc tường): xoay sang hướng thoáng nhất gần nhất
      if (b.f < need * 0.5 && !this.drag && !this.recenter && this.escapeTh == null) {
        let best = null, bf = b.f + 0.3;
        for (let k = 1; k <= 12; k++) for (const sg of [1, -1]) { const th = S.th + sg * k * Math.PI / 12, x = this.bestArm(t, th, S.ph, S.r, a, need).f - k * 0.03; if (x > bf) { bf = x; best = th; } }
        if (best !== null) this.escapeTh = best;
      }
    }
    if (this.escapeTh != null) { const dth = angDiff(S.th, this.escapeTh); S.th += dth * Math.min(1, dt * 4); G.th = S.th; if (Math.abs(dth) < 0.03 || this.drag) this.escapeTh = null; }
    // góc nâng thực tế: nâng lên nhanh khi bị ép, hạ về góc người dùng chọn từ từ
    if (this.aPh == null) this.aPh = this.aPhGoal;
    const up = this.aPhGoal < this.aPh;
    this.aPh += (this.aPhGoal - this.aPh) * (1 - Math.exp(-dt * (up ? 9 : 2.5)));
    const ph = Math.min(S.ph, this.aPh);
    const free = this.armFree(t, S.th, ph, S.r, a);
    this.lastFree = free;
    // khoảng cách: vướng thì kéo lại gần nhanh mà mượt; thông rồi lùi ra từ từ (không giật, không "thở")
    const want = Math.min(S.r, free);
    if (this.camDist === null) this.camDist = want;
    else if (want < this.camDist) this.camDist = Math.max(want, this.camDist + (want - this.camDist) * (1 - Math.exp(-dt * 20)));
    else this.camDist = Math.min(want, this.camDist + (want - this.camDist) * (1 - Math.exp(-dt * 2.2)) + dt * 0.15);
    const r = this.camDist, sp = Math.sin(ph);
    this.camera.position.set(t.x + r * sp * Math.sin(S.th), t.y + r * Math.cos(ph), t.z + r * sp * Math.cos(S.th));
    this.camera.lookAt(t);
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
      this.drag = true; moved = 0; this.stopCoast(); lastT = performance.now(); cv.style.cursor = 'grabbing';
      if (ptrs.size === 2) { const m = midOf(); pd = m.d; mid = m; }
    });
    cv.addEventListener('pointermove', e => {
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
        if (mid) { const th2 = S.th - (m.x - mid.x) * 0.005; if (!tpLocal() || this.canOrbit(th2, S.ph)) { S.th = th2; G.th = S.th; } this.lastUserOrbit = performance.now(); }
        pd = m.d; mid = m; return;
      }
      if (ptrs.size !== 1) return;
      // bám nhân vật (kiểu agent-office): ngang 0.006 rad/px, dọc 0.004 rad/px; tổng quan: 0.008 rad/px
      const local = tpLocal(), kx = local ? 0.006 : 0.008, ky = local ? 0.004 : 0.008;
      const lim = local ? [PH(LIM.fEl[1]), PH(LIM.fEl[0])] : LIM.oPh;
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
        this.drag = false; cv.style.cursor = 'grab';
        // chỉ trôi khi vừa kéo thật (không phải bấm) và tay còn đang di chuyển lúc thả
        const still = performance.now() - lastT > 90;
        if (this.reduceMotion || this.walkMode || this.fp || moved <= 6 || still) this.stopCoast();
        else { this.vth = clamp(this.vth, -6, 6); this.vph = clamp(this.vph, -3, 3); }
      }
      this.lastMoved = moved;
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
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
