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
    this._t = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._bind();
  }
  go(k) {
    if (this.walkMode) this.setWalk(false);
    const p = PRESETS[k]; this.follow = null;
    this.G.th = p.th; this.G.ph = p.ph; this.G.r = p.r; this.G.t.set(...p.t); this.auto = false;
  }
  view(th, ph, r, t) { if (this.walkMode) this.setWalk(false); this.G.th = th; this.G.ph = ph; this.G.r = r; this.G.t.set(t[0], t[1], t[2]); }
  snap() { this.S.th = this.G.th; this.S.ph = this.G.ph; this.S.r = this.G.r; this.S.t.copy(this.G.t); }
  zoom(f) {
    if (this.walkMode) return;
    if (this.follow && this.follow.local) { const H = this.follow.camR ?? (this.follow.camH ?? 0.375) / 0.5; this.G.r = clamp(this.G.r * f, LIM.fR[0] * H, LIM.fR[1] * H); }
    else this.G.r = clamp(this.G.r * f, LIM.oR[0], LIM.oR[1]);
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
    this.fp = !!on;
    if (this.follow) this.follow._fpHide = this.fp;
    if (this.fp && this.follow) { this.S.th = this.G.th = this.follow.yaw; this.fpPitch = -0.08; }
    else if (this.follow) { this.S.th = this.G.th = this.follow.yaw; this.camDist = null; }
  }

  /**
   * Camera bám nhân vật kiểu agent-office: quay quanh nhân vật theo chuột (kéo để xoay, cuộn để gần/xa), không tự
   * xoay về sau lưng; nhắm vào ngang vai (≈0.65 chiều cao), trượt mượt tới chỗ mới. Có vật cản giữa nhân vật và camera
   * thì kéo camera lại gần (không xuyên tường), thông rồi lùi ra từ từ. Bấm C để về sau lưng.
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
    const ty = a.y + 0.65 * H + lift + (a.jumpH || 0);
    G.t.set(a.x, ty, a.z);
    const k = 1 - Math.exp(-dt * 16);                       // ≈ lerp 0.25 mỗi khung hình ở 60 fps
    S.t.lerp(G.t, k);
    if (this.recenter) { S.th += angDiff(S.th, a.yaw) * Math.min(1, dt * 8); if (Math.abs(angDiff(S.th, a.yaw)) < 0.02) this.recenter = false; }
    G.ph = clamp(G.ph, PH(LIM.fEl[1]), PH(LIM.fEl[0])); G.r = clamp(G.r, LIM.fR[0] * R, LIM.fR[1] * R);
    // tường ép camera sát người quá 0.35 s (và người dùng không đang kéo): xoay sang hướng thoáng nhất gần nhất
    const fixed = !!this.world.fixedFollow; // khoảng cách cố định: không co giãn theo vật cản, không cắt cảnh (người dùng tự xoay/cuộn để nhìn)
    if (!fixed && this.squeezeT > 0.35 && !this.drag && this.escapeTh == null) {
      let best = null, score = -Infinity;
      for (let k = 1; k < 12; k++) for (const sg of [1, -1]) {
        const th = S.th + sg * k * Math.PI / 12, dd = this._t.set(Math.sin(S.ph) * Math.sin(th), Math.cos(S.ph), Math.sin(S.ph) * Math.cos(th));
        const fr = Math.min(this.rayCOL(S.t, dd, S.r), S.r), sc = fr - k * 0.04 * H;
        if (fr > LIM.fR[0] * R && sc > score) { score = sc; best = th; }
      }
      this.escapeTh = best ?? S.th + Math.PI; // không hướng nào thoáng: nhìn từ phía ngược lại
      if (best === null) G.ph = PH(LIM.fEl[1]);
    }
    // khoảng cách cố định: bị che (góc chết) thì tự xoay sang hướng gần nhất thấy trọn nhân vật nhất — ưu tiên sau lưng;
    // người dùng vừa tự xoay camera thì để yên 2,5 giây
    if (fixed) {
      this.visT = (this.visT || 0) - dt;
      if (this.visT <= 0) {
        this.visT = 0.15;
        const cur = this.viewScore(a, S.th, S.ph, S.r, H), idle = !this.drag && !this.recenter && performance.now() - this.lastUserOrbit > 2500;
        this.blockT = cur < 2 ? (this.blockT || 0) + 0.15 : 0;
        if (idle && this.escapeTh == null && cur < 2 && this.blockT >= (cur < 1 ? 0.3 : 0.9)) {
          let best = null, bs = cur + 0.3;
          for (let k = 1; k <= 12; k++) for (const sg of [1, -1]) {
            const th = S.th + sg * k * Math.PI / 12;
            const sc = this.viewScore(a, th, S.ph, S.r, H) - k * 0.015 - Math.abs(angDiff(th, a.yaw)) * 0.05;
            if (sc > bs) { bs = sc; best = th; }
          }
          if (best !== null) this.escapeTh = best;
          this.blockT = 0;
        }
      }
    }
    if (this.escapeTh != null) { const dth = angDiff(S.th, this.escapeTh); S.th += dth * Math.min(1, dt * (fixed ? 3 : 5)); if (Math.abs(dth) < 0.03 || this.drag) this.escapeTh = null; }
    G.th = S.th; S.ph += (G.ph - S.ph) * Math.min(1, dt * 8); S.r += (G.r - S.r) * Math.min(1, dt * 10);
    // không xuyên tường: rút camera lại khi có vật cản, lùi ra từ từ khi thông
    const t = S.t, d = this._d.set(Math.sin(S.ph) * Math.sin(S.th), Math.cos(S.ph), Math.sin(S.ph) * Math.cos(S.th));
    const free = fixed ? S.r : this.rayCOL(t, d, S.r) - 0.15;
    const want = fixed ? S.r : Math.max(LIM.fMin * H, Math.min(S.r, free));
    this.squeezeT = free < Math.min(S.r, LIM.fR[0] * R) ? (this.squeezeT || 0) + dt : 0;
    // vướng vật cản: kéo lại gần nhanh nhưng mượt (không giật); thông rồi lùi ra từ từ
    if (this.camDist === null || fixed) this.camDist = want;
    else if (want < this.camDist) this.camDist = Math.max(want, this.camDist + (want - this.camDist) * (1 - Math.exp(-dt * 18)) - dt * 0.5);
    else this.camDist = Math.min(want, this.camDist + dt * 2.2);
    const r = this.camDist;
    this.camera.position.set(t.x + r * d.x, t.y + r * d.y, t.z + r * d.z);
    if (this.clamp) this.clamp(this.camera.position);
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
    let pd = 0, moved = 0;
    cv.addEventListener('pointerdown', e => { cv.focus(); cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.drag = true; moved = 0; cv.style.cursor = 'grabbing'; if (ptrs.size === 2) { const a = [...ptrs.values()]; pd = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); } });
    cv.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (this.walkMode) { this.PL.yaw -= dx * 0.005; this.PL.pitch = clamp(this.PL.pitch - dy * 0.004, -1.2, 1.2); return; }
      const S = this.S;
      // nhìn bằng mắt nhân vật: kéo để nhìn quanh
      if (this.fp && this.follow && this.follow.local) { S.th -= dx * 0.005; this.G.th = S.th; this.fpPitch = clamp((this.fpPitch ?? 0) - dy * 0.005, -1.2, 1.2); return; }
      // bám nhân vật (kiểu agent-office): ngang 0.006 rad/px, dọc 0.004 rad/px, góc chếch 0.05–1.3 rad
      if (ptrs.size === 1 && this.follow && this.follow.local) { S.th -= dx * 0.006; S.ph = clamp(S.ph - dy * 0.004, PH(LIM.fEl[1]), PH(LIM.fEl[0])); this.G.th = S.th; this.G.ph = S.ph; this.lastUserOrbit = performance.now(); this.recenter = false; if (moved > 6) this.onUserOrbit(); return; }
      if (ptrs.size === 1) { S.th -= dx * 0.008; S.ph = clamp(S.ph - dy * 0.008, LIM.oPh[0], LIM.oPh[1]); this.lastUserOrbit = performance.now(); this.recenter = false; if (moved > 6) this.onUserOrbit(); }
      else if (ptrs.size === 2) { const a = [...ptrs.values()]; const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); if (pd > 0) S.r = clamp(S.r * pd / d, LIM.oR[0], LIM.oR[1]); pd = d; }
      this.G.th = S.th; this.G.ph = S.ph; this.G.r = S.r;
    });
    const up = e => { ptrs.delete(e.pointerId); if (!ptrs.size) { this.drag = false; cv.style.cursor = 'grab'; } this.lastMoved = moved; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => {
      if (this.walkMode) return; e.preventDefault();
      const tp = this.follow && this.follow.local;
      if (tp) { const H = this.follow.camR ?? (this.follow.camH ?? 0.375) / 0.5; this.G.r = clamp(this.G.r + e.deltaY * 0.01 * H / 2, LIM.fR[0] * H, LIM.fR[1] * H); return; }
      this.G.r = this.S.r = clamp(this.S.r * Math.exp(e.deltaY * 0.0012), LIM.oR[0], LIM.oR[1]);
    }, { passive: false });
    const KM = { w: 'w', s: 's', a: 'a', d: 'd', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', W: 'w', S: 's', A: 'a', D: 'd' };
    cv.addEventListener('keydown', e => { const k = KM[e.key]; if (k) { this.keys[k] = true; if (this.walkMode) e.preventDefault(); } });
    cv.addEventListener('keyup', e => { const k = KM[e.key]; if (k) this.keys[k] = false; });
    cv.addEventListener('blur', () => { this.keys = {}; });
  }
}
