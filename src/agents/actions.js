// Chuyển động tự nhiên cho nhân vật chibi (rig my-office). Lớp này đứng giữa trạng thái nhân vật (đi, ngồi, động tác)
// và rig, rồi đưa tư thế cuối vào applyChibiPose:
//  - tư thế gốc: đứng / đi / chạy / ngồi. Ngồi xuống và đứng dậy trộn liên tục theo a.sit (không bật ở 0,5), có cúi
//    người lấy đà và chống tay;
//  - tầng động tác (vẫy tay, gọi điện, uống cà phê, hút thuốc, nhảy múa, xem TV…): mỗi động tác có pha vào, giữ, ra;
//    trọng số tăng/giảm êm. Đang đi thì động tác chỉ thay phần thân trên (vừa đi vừa gọi điện / cầm cốc);
//  - mocap thật (Quaternius UAL, CC0 — public/data/mocap.*) đổi sang các kênh của rig: nhảy múa, gọi điện, nói chuyện,
//    gật/lắc đầu, khoanh tay;
//  - đứng yên / ngồi lâu có cử chỉ vặt (nhìn quanh, đổi chân trụ, xem đồng hồ, vươn vai, khoanh tay, nhấp cà phê…);
//  - đầu tự quay nhìn người ở gần; quay tại chỗ thì bước chân;
//  - mọi khớp đi qua lò xo giảm chấn tới hạn (không giật, không lố), độc lập với số khung hình.
import * as THREE from 'three';
import { chibiPose, armIK } from '../vendor/my-office/chibi-rig.js';
import { MOCAP } from './mocap.js';

const NUM = ['hipL', 'hipR', 'kneeL', 'kneeR', 'lean', 'y', 'tilt', 'breathe'];
const ARR = ['armL', 'armR', 'head'];
const UPPER = new Set(['armL', 'armR', 'head', 'lean', 'tilt']);   // phần thân trên (động tác khi đang đi)
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
const lerp = (a, b, t) => a + (b - a) * t;
const angWrap = d => ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

/** Trộn tư thế b vào a với trọng số w (mask: chỉ các kênh trong tập). Kênh rời rạc theo bên nặng hơn. */
function blend(a, b, w, mask = null) {
  if (w <= 0) return a;
  const out = { ...a };
  for (const k of NUM) if (!mask || mask.has(k)) out[k] = lerp(a[k] ?? 0, b[k] ?? 0, w);
  for (const k of ARR) if (!mask || mask.has(k)) out[k] = [0, 1, 2].map(i => lerp(a[k][i], b[k][i], w));
  if (w > 0.5) for (const k of ['mouth', 'mug', 'held', 'book', 'pad', 'mic', 'drop', 'lid', 'visor']) if (b[k] !== undefined && (!mask || k !== 'shadow')) out[k] = b[k];
  if (!mask && w > 0.5) out.shadow = b.shadow;
  return out;
}

// ---------------- mocap → kênh rig chibi ----------------
// Mỗi đoạn: quaternion hướng (không gian nhân vật, nhìn +z) của 13 đoạn xương; xương chỉ theo -y ở tư thế nghỉ.
const NS = 13, S = { pelvis: 0, spine: 1, head: 2, upperL: 3, upperR: 4, foreL: 5, foreR: 6, thighL: 7, thighR: 8, shinL: 9, shinR: 10 };
const q4 = new Float32Array(NS * 4);
function sampleClip(key, t) {
  const c = MOCAP.clips?.[key]; if (!MOCAP.ready || !c) return false;
  const n = c.frames, st = MOCAP.stride, D = MOCAP.data;
  let f = t * MOCAP.fps; if (c.loop) { f %= (n - 1); if (f < 0) f += n - 1; } else f = Math.max(0, Math.min(n - 1, f));
  const i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), k = f - i0, o0 = c.offset + i0 * st, o1 = c.offset + i1 * st;
  for (let s = 0; s < NS; s++) {
    const a = o0 + s * 4, b = o1 + s * 4, sg = D[a] * D[b] + D[a + 1] * D[b + 1] + D[a + 2] * D[b + 2] + D[a + 3] * D[b + 3] < 0 ? -1 : 1;
    let x = D[a] * (1 - k) + sg * D[b] * k, y = D[a + 1] * (1 - k) + sg * D[b + 1] * k, z = D[a + 2] * (1 - k) + sg * D[b + 2] * k, w = D[a + 3] * (1 - k) + sg * D[b + 3] * k;
    const L = Math.hypot(x, y, z, w) || 1; q4[s * 4] = x / L; q4[s * 4 + 1] = y / L; q4[s * 4 + 2] = z / L; q4[s * 4 + 3] = w / L;
  }
  return true;
}
// quay vector v bởi q (q4[i]) rồi bởi nghịch đảo của q4[j] (đưa về khung của đoạn cha)
function dirIn(i, parent, vx, vy, vz) {
  const qx = q4[i * 4], qy = q4[i * 4 + 1], qz = q4[i * 4 + 2], qw = q4[i * 4 + 3];
  let [x, y, z] = rot(qx, qy, qz, qw, vx, vy, vz);
  if (parent >= 0) [x, y, z] = rot(-q4[parent * 4], -q4[parent * 4 + 1], -q4[parent * 4 + 2], q4[parent * 4 + 3], x, y, z);
  return [x, y, z];
}
function rot(qx, qy, qz, qw, vx, vy, vz) {
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1))));
/**
 * Tư thế rig từ clip mocap tại thời điểm t. Cánh tay: hướng xương trong khung ngực → (vai x, vai z); khuỷu: góc gập.
 * Chân: hướng đùi trong khung hông → hông x; gối: góc gập. Cột sống: độ nghiêng; đầu: cúi/ngẩng, quay.
 * mirror: đổi tay trái ↔ phải (clip thuận tay trái). Trả về null khi chưa có dữ liệu.
 */
export function mocapChibi(key, t, mirror = false) {
  if (!sampleClip(key, t)) return null;
  // clip Quaternius nhìn -z, rig nhìn +z: quay 180° quanh trục đứng (x → -x, z → -z); vì vậy tay/chân trái của clip
  // (phía -x) sang phía +x của rig (armR/legR)
  const R = v => [-v[0], v[1], -v[2]];
  const arm = (U, F) => {
    const d = R(dirIn(U, S.spine, 0, -1, 0)), f = R(dirIn(F, S.spine, 0, -1, 0));
    const z = Math.asin(Math.max(-1, Math.min(1, d[0]))), x = Math.atan2(-d[2], -d[1]);
    return [x, z, -angle(d, f)];
  };
  const leg = (T, Sh) => { const d = R(dirIn(T, S.pelvis, 0, -1, 0)), s = R(dirIn(Sh, S.pelvis, 0, -1, 0)); return [Math.atan2(-d[2], -d[1]), angle(d, s)]; };
  const aR = arm(S.upperL, S.foreL), aL = arm(S.upperR, S.foreR);
  const [hR, kR] = leg(S.thighL, S.shinL), [hL, kL] = leg(S.thighR, S.shinR);
  const sp = R(dirIn(S.spine, S.pelvis, 0, 1, 0)), hf = R(dirIn(S.head, S.spine, 0, 0, -1));
  const p = { armL: aL, armR: aR, hipL: hL, hipR: hR, kneeL: kL, kneeR: kR, lean: Math.atan2(sp[2], sp[1]), head: [Math.atan2(-hf[1], hf[2]), Math.atan2(hf[0], hf[2]), 0] };
  if (mirror) { p.armL = [aR[0], -aR[1], aR[2]]; p.armR = [aL[0], -aL[1], aL[2]]; [p.hipL, p.hipR, p.kneeL, p.kneeR] = [hR, hL, kR, kL]; p.head[1] = -p.head[1]; }
  return p;
}
const clipDur = k => MOCAP.clips?.[k]?.dur || 2;

// ---------------- lò xo giảm chấn tới hạn ----------------
// x'' = ω²(goal − x) − 2ω x'  (ω = 2π/thời gian ổn định); bước con nếu khung dài.
function spring(st, key, goal, w, dt) {
  let x = st.x[key], v = st.v[key] || 0;
  if (x === undefined) { st.x[key] = goal; st.v[key] = 0; return goal; }
  const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
  for (let i = 0; i < n; i++) { const a = w * w * (goal - x) - 2 * w * v; v += a * h; x += v * h; }
  st.x[key] = x; st.v[key] = v; return x;
}

// cử chỉ vặt khi đứng / ngồi yên
const FIDGET_STAND = ['look', 'shift', 'watch', 'stretch', 'fold', 'look', 'shift'];
const FIDGET_SIT = ['look', 'stretch', 'lean', 'sip', 'look'];

export class Motion {
  constructor() {
    this.t = Math.random() * 10; this.st = { x: {}, v: {} };
    this.act = null; this.actT = 0; this.wAct = 0; this.lastAct = null;
    this.fid = null; this.fidT = 0; this.fidAt = 4 + Math.random() * 8;
    this.yaw = null; this.turnPh = 0; this.turnW = 0; this.lookYaw = 0; this.laughAt = 6 + Math.random() * 8;
  }

  /** Tư thế cuối cho agent a. P: rig; dt: giây; o: { scale, blink }. */
  pose(P, a, dt, o) {
    this.t += dt;
    if ((a.sit > 0.5) !== this._wasSit) { this._wasSit = a.sit > 0.5; this.fid = null; this.fidAt = 5 + Math.random() * 8; }   // (vừa ngồi/đứng: chưa làm cử chỉ vặt ngay)
    const t = this.t, sitF = smooth(a.sit || 0), walk = Math.min(2, a.walkAmt || 0), moving = walk > 0.15;
    const act = a.act || null;
    // ---- máy trạng thái động tác: vào / giữ / ra ----
    if (act !== this.act) { if (act) { this.lastAct = act; this.actT = 0; } this.act = act; }
    this.actT += dt;
    this.wAct = clamp01(this.wAct + (act ? 1 : -1) * dt / (act ? 0.28 : 0.35));
    const wAct = smooth(this.wAct), shownAct = act || (this.wAct > 0 ? this.lastAct : null);

    // ---- tư thế gốc ----
    const walkPh = (a._g?.ph ?? a.walkPhase ?? 0) / 9;
    let stand;
    if (moving) stand = this.walkPose(P, walkPh, walk, o);
    else stand = this.idlePose(P, a, dt, o, sitF > 0.02);
    let base = stand;
    if (sitF > 0.001) {
      const sitAnim = this.sitAnim(a);
      const seated = chibiPose(P, sitAnim, t, { ...o, sit: true });
      if (a.anim === 'tv' || a.act === 'tv') this.tvTweak(seated, P, t, dt);
      base = blend(stand, seated, sitF);
      // chân đi trước thân: đùi co lên sớm khi ngồi xuống, duỗi muộn khi đứng dậy (không đâm chân xuyên mặt ghế)
      const legW = smooth(Math.min(1, (a.sit || 0) * 1.8));
      for (const k of ['hipL', 'hipR', 'kneeL', 'kneeR']) base[k] = lerp(stand[k], seated[k], legW);
      // đang ngồi xuống / đứng dậy: cúi người lấy đà, tay chống về phía đùi, đầu hơi cúi
      const sv = clamp01(a.sit || 0), mid = Math.sin(Math.PI * sv);
      // chân chibi ngắn hơn mặt ghế: nhún người lấy đà (đầu quá trình) rồi nhổm lên ghế
      const crouch = sv < 0.4 ? Math.sin(Math.PI * sv / 0.4) : 0;
      if (crouch > 0) { base.y -= 0.07 * crouch; base.kneeL += 0.45 * crouch; base.kneeR += 0.45 * crouch; base.hipL -= 0.3 * crouch; base.hipR -= 0.3 * crouch; }
      if (mid > 0.01) {
        base.lean += mid * 0.42; base.head[0] += mid * 0.2;
        base.armL = [lerp(base.armL[0], -0.55, mid * 0.7), base.armL[1], lerp(base.armL[2], -0.5, mid * 0.7)];
        base.armR = [lerp(base.armR[0], -0.55, mid * 0.7), base.armR[1], lerp(base.armR[2], -0.5, mid * 0.7)];
      }
    }
    // ---- quay tại chỗ: bước chân nhỏ ----
    if (this.yaw === null) this.yaw = a.yaw;
    const dyaw = angWrap(a.yaw - this.yaw); this.yaw = a.yaw;
    const turning = !moving && sitF < 0.05 && Math.abs(dyaw) / Math.max(dt, 1e-3) > 1.0;
    this.turnW = clamp01(this.turnW + (turning ? 1 : -1) * dt * 6);
    if (this.turnW > 0) { this.turnPh += Math.abs(dyaw) * 3.2 + dt * 2; const s = Math.sin(this.turnPh); base.hipL += s * 0.22 * this.turnW; base.hipR -= s * 0.22 * this.turnW; base.kneeL += Math.max(0, -s) * 0.35 * this.turnW; base.kneeR += Math.max(0, s) * 0.35 * this.turnW; }
    // ---- nhảy: lấy đà, trên không, tiếp đất ----
    if (a.airborne || (a.jumpH || 0) > 0.01) { base.kneeL += 0.35; base.kneeR += 0.6; base.hipL -= 0.25; base.hipR -= 0.45; base.armL[1] -= 0.5; base.armR[1] += 0.5; base.lean += 0.05; }
    else if ((a.landT ?? 9) < 0.18) { const k = 1 - a.landT / 0.18; base.kneeL += 0.5 * k; base.kneeR += 0.5 * k; base.hipL -= 0.35 * k; base.hipR -= 0.35 * k; base.y -= 0.05 * k; base.lean += 0.15 * k; }

    // ---- tầng động tác ----
    let p = base;
    if (shownAct && shownAct !== 'tv' && shownAct !== 'jump' && wAct > 0) {
      const ap = this.actPose(P, shownAct, a, o, sitF > 0.5, walkPh, walk);
      if (ap) {
        const upperOnly = moving || sitF > 0.5 || ap.upperOnly;
        p = blend(base, ap, wAct * (ap.env ?? 1), upperOnly ? UPPER : null);
        if (wAct > 0.5) for (const k of ['held', 'mug', 'mic', 'book', 'pad']) if (ap[k] !== undefined) p[k] = ap[k];
        if (ap.mouth && wAct > 0.5) p.mouth = ap.mouth;
        if (ap.y !== undefined && !upperOnly) p.y = lerp(base.y, ap.y, wAct);
      }
    }
    // ---- đầu nhìn người ở gần (cộng thêm, có giới hạn) ----
    const wantLook = !moving && !act ? (a._lookYaw || 0) : 0;
    this.lookYaw += (wantLook - this.lookYaw) * Math.min(1, dt * 2.5);
    p.head = [p.head[0], p.head[1] + this.lookYaw, p.head[2]];

    // ---- lò xo cho mọi khớp ----
    const W = 26, Wh = 14;   // (rad/s: khớp ổn định ~0,25 s; đầu chậm hơn ~0,45 s)
    const st = this.st, out = { ...p };
    for (const k of ['hipL', 'hipR', 'kneeL', 'kneeR', 'lean', 'y', 'tilt']) out[k] = spring(st, k, p[k] ?? 0, k === 'y' ? 30 : W, dt);
    for (const k of ['armL', 'armR']) out[k] = p[k].map((v, i) => spring(st, k + i, v, W, dt));
    out.head = p.head.map((v, i) => spring(st, 'head' + i, v, Wh, dt));
    return out;
  }

  sitAnim(a) {
    if (a.act === 'tv' || a.anim === 'tv') return 'idle';
    return { type: 'type', cup: 'coffee', pour: 'coffee', eat: 'eat', talk: 'laugh' }[a.anim] || (this.fid === 'sip' ? 'coffee' : 'idle');
  }

  /** Đi / chạy: biên độ bước, gối, tay và độ nghiêng theo tốc độ; nhún lên xuống theo nhịp bước. */
  walkPose(P, ph, walk, o) {
    const p = chibiPose(P, 'walk', ph, o), s = Math.sin(ph * 9), run = Math.max(0, walk - 1);
    const amp = 0.4 + 0.18 * Math.min(1, walk) + 0.12 * run;
    p.hipL = s * amp; p.hipR = -s * amp;
    p.kneeL = Math.max(0, -s) * (0.7 + 0.5 * run) + 0.08; p.kneeR = Math.max(0, s) * (0.7 + 0.5 * run) + 0.08;
    p.armL = [-s * (0.38 + 0.4 * run), -0.1, -0.3 - 0.7 * run]; p.armR = [s * (0.38 + 0.4 * run), 0.1, -0.3 - 0.7 * run];
    p.lean = 0.04 + 0.16 * run; p.y = Math.abs(Math.cos(ph * 9)) * (0.025 + 0.03 * run);
    p.head = [-0.04 * run, 0, Math.sin(ph * 9) * 0.03];
    p.tilt = Math.sin(ph * 9) * 0.025;
    return p;
  }

  /** Đứng yên (hoặc nền khi ngồi): thở, đổi trọng tâm, cử chỉ vặt ngẫu nhiên mỗi 6–15 giây. */
  idlePose(P, a, dt, o, seated) {
    const t = this.t;
    let p = chibiPose(P, 'idle', t, o);
    p.tilt = Math.sin(t * 0.35) * 0.02; p.hipL += Math.sin(t * 0.35) * 0.03; p.hipR -= Math.sin(t * 0.35) * 0.03;
    // cử chỉ vặt (không khi đang làm động tác)
    if (!this.fid) { this.fidAt -= dt; if (this.fidAt <= 0 && !a.act) { const L = seated ? FIDGET_SIT : FIDGET_STAND; this.fid = L[Math.floor(Math.random() * L.length)]; this.fidT = 0; this.fidLen = { look: 2.6, shift: 3.2, watch: 2.2, stretch: 2.4, fold: 4.5, lean: 3.5, sip: 3.2 }[this.fid]; this.fidDir = Math.random() < 0.5 ? -1 : 1; } }
    if (this.fid) {
      this.fidT += dt;
      const e = Math.min(smooth(this.fidT / 0.45), smooth((this.fidLen - this.fidT) / 0.45));
      if (this.fidT >= this.fidLen || a.act || (a.walkAmt || 0) > 0.15) { this.fid = null; this.fidAt = 6 + Math.random() * 9; }
      else {
        const f = this.fid;
        if (f === 'look') p.head = [p.head[0] - 0.05 * e, p.head[1] + this.fidDir * 0.7 * e, p.head[2]];
        else if (f === 'shift') { p.tilt += this.fidDir * 0.05 * e; p.hipL += this.fidDir * 0.07 * e; p.hipR -= this.fidDir * 0.07 * e; p.kneeL += (this.fidDir > 0 ? 0.12 : 0) * e; p.kneeR += (this.fidDir < 0 ? 0.12 : 0) * e; }
        else if (f === 'watch' && !seated) { const w = chibiPose(P, 'idle', this.t, o); w.armL = [-1.1, 0.35, -1.75]; w.head = [0.4, -0.25, 0]; p = blend(p, w, e, UPPER); }
        else if (f === 'stretch') p = blend(p, chibiPose(P, 'wake', this.fidT, { ...o, sit: seated }), e, UPPER);
        else if (f === 'fold' && !seated) { const m = mocapChibi('foldArms', this.fidT % clipDur('foldArms')); if (m) p = blend(p, { ...p, armL: m.armL, armR: m.armR, head: [m.head[0], p.head[1], 0] }, e, UPPER); }
        else if (f === 'lean') { p.lean -= 0.2 * e; p.head = [p.head[0] - 0.12 * e, p.head[1], p.head[2]]; }
      }
    }
    return p;
  }

  /** Xem TV trên sofa: ngả lưng, tay đặt đùi, thỉnh thoảng bật cười. */
  tvTweak(p, P, t, dt) {
    p.lean = -0.22; p.head = [-0.08, 0, 0];
    this.laughAt -= dt;
    if (this.laughAt < 0) { this.laughT = 1.6; this.laughAt = 8 + Math.random() * 10; }
    if ((this.laughT || 0) > 0) { this.laughT -= dt; const k = Math.abs(Math.sin(t * 9)); p.head = [-0.25 - k * 0.06, 0, 0]; p.mouth = 'o'; p.lean = -0.28 + k * 0.04; }
  }

  /** Tư thế của từng động tác (đã có pha vào/giữ/ra theo actT). */
  actPose(P, act, a, o, seated, walkPh, walk) {
    const T = this.actT, D = P.D, R = D.R, sitO = { ...o, sit: seated };
    switch (act) {
      case 'wave': {   // giơ tay (0,25 s), vẫy 4 nhịp nhỏ dần, hạ tay (player tự tắt sau 2,6 s)
        const p = chibiPose(P, 'hand', T, sitO), damp = 1 - smooth((T - 1.6) / 0.8) * 0.6;
        p.armR = [0, 2.6 + Math.sin(T * 9) * 0.22 * damp, -0.35 + Math.sin(T * 9 + 0.6) * 0.15 * damp];
        p.head = [-0.06, 0, 0.12]; p.mouth = 'smile'; p.y = seated ? undefined : Math.max(0, Math.sin(T * 4.5)) * 0.02;
        return p;
      }
      case 'drink': {   // cầm cốc trước ngực; chu kỳ 5 s: thổi → nâng → nhấp (ngửa đầu) → hạ, trộn liên tục
        const hold = chibiPose(P, 'coffee', 0.3, sitO), sip = chibiPose(P, 'coffee', 1.1, sitO);   // (pha giữ / pha nhấp của rig)
        const c = T % 5, up = c < 2.4 ? 0 : c < 2.9 ? smooth((c - 2.4) / 0.5) : c < 4.0 ? 1 : 1 - smooth((c - 4.0) / 0.6);
        const p = blend(hold, sip, up); p.mug = true; p.mouth = c > 1.6 && c < 2.4 ? 'o' : 'smile';
        if (up > 0.6) p.head = [p.head[0] - 0.12 * up, 0, 0];
        return p;
      }
      case 'smoke': {   // tay cầm thuốc bên hông; chu kỳ 6,5 s: đưa lên miệng → rít → hạ → thả khói
        const rest = chibiPose(P, 'idle', T, sitO);
        rest.armR = [-0.12, 0.2, -0.95];   // (tay buông bên hông, cẳng tay hơi gập, đầu thuốc chỉ ra trước)
        const mouth = chibiPose(P, 'coffee', 1.1, sitO);
        const c = T % 6.5, up = c < 3.2 ? 0 : c < 3.8 ? smooth((c - 3.2) / 0.6) : c < 5.0 ? 1 : 1 - smooth((c - 5.0) / 0.7);
        const p = blend(rest, mouth, up, UPPER); this.ensureCig(P); p.held = 'cig'; p.mug = false;
        p.head = [lerp(0.02, -0.18, up), 0, 0]; p.mouth = c > 5.3 && c < 6.2 ? 'o' : 'smile';
        p.upperOnly = true;
        return p;
      }
      case 'phone': {   // gọi điện: mocap TalkingPhone (điện thoại áp tai), tay kia khua; đi lại vẫn được
        const m = mocapChibi('phone', T % clipDur('phone'), this.phoneMirror(P));
        const p = chibiPose(P, 'idle', T, sitO);
        // tay phải: IK đưa điện thoại lên sát tai (đầu chibi to — tay người thật trong clip không với tới); tay trái và đầu
        // theo clip (khua tay, gật gù khi nói)
        const headY = p.y + D.hipY + D.headY * Math.cos(p.lean), headZ = D.headY * Math.sin(p.lean);
        p.armR = armIK(D, 1, R * 0.92, headY - p.y - R * 0.12, headZ + R * 0.08, p.lean);
        if (m) { if (!seated) p.armL = m.armL; p.head = [m.head[0] * 0.5, m.head[1] * 0.4, 0.14]; if (!seated) p.lean = m.lean * 0.5; }
        else p.head = [0.05, 0, 0.14];
        p.held = 'phone'; p.mouth = Math.sin(T * 5) > 0.2 ? 'o' : 'smile'; p.upperOnly = true;
        return p;
      }
      case 'dance': {   // nhảy múa: mocap Dance, cả người, nhún theo nhịp
        const m = mocapChibi('dance', T % clipDur('dance'));
        const p = chibiPose(P, 'idle', T, sitO);
        if (m) Object.assign(p, { armL: [m.armL[0] * 1.3, m.armL[1] * 1.3, m.armL[2]], armR: [m.armR[0] * 1.3, m.armR[1] * 1.3, m.armR[2]], hipL: m.hipL, hipR: m.hipR, kneeL: m.kneeL, kneeR: m.kneeR, lean: m.lean * 0.7, head: [m.head[0] * 0.6, m.head[1], Math.sin(T * 6) * 0.08] });
        else { const q = chibiPose(P, 'celebrate', T, sitO); Object.assign(p, q); }
        p.y = Math.abs(Math.sin(T * 6.2)) * 0.05; p.mouth = 'o';
        return p;
      }
      // ---- dùng đồ vật (src/scene/props.js) ----
      case 'brew': {   // pha cà phê: hai tay thao tác trước máy, đầu cúi nhìn; cuối chu kỳ nhấc cốc lên
        const p = chibiPose(P, 'tidy', T, sitO); p.lean = 0.1; p.head = [0.22, 0, 0];
        if (T > 3.4) { const q = chibiPose(P, 'coffee', 0.3, sitO); p.armR = q.armR; p.mug = true; p.head = [0.05, 0, 0]; }
        return p;
      }
      case 'print': {  // máy in: bấm nút, chờ giấy ra, cúi nhặt tờ giấy
        const p = chibiPose(P, 'tidy', T * 0.6, sitO); p.lean = 0.12 + Math.max(0, Math.sin(T * 1.6)) * 0.12; p.head = [0.3, 0, 0];
        if (T > 2.6) { p.book = true; p.head = [0.35, 0, 0]; }
        return p;
      }
      case 'read': { const p = chibiPose(P, 'read', T, sitO); p.head = [0.3 + Math.sin(T * 0.4) * 0.04, Math.sin(T * 0.25) * 0.15, 0]; return p; }   // cầm sách đọc, thỉnh thoảng lật trang
      case 'globe': { const p = chibiPose(P, 'globe', T, sitO); p.head = [0.1, 0.15, 0]; p.mouth = 'o'; return p; }
      case 'lamp': { const p = chibiPose(P, 'globe', 0.4, sitO); p.head = [-0.05, 0, 0]; return p; }
      case 'feed': {   // cho cá ăn: tay phải đưa ra rắc thức ăn, đầu nghiêng nhìn bể
        const p = chibiPose(P, 'globe', T, sitO); p.armR = [p.armR[0] - 0.15, p.armR[1], p.armR[2] + Math.sin(T * 8) * 0.12]; p.head = [0.25, 0, 0.1]; p.mouth = 'smile';
        return p;
      }
      case 'pet': {    // vuốt mèo: ngồi xổm, tay vuốt qua lại
        const p = chibiPose(P, 'tidy', T, sitO);
        Object.assign(p, { hipL: -1.0, hipR: -1.0, kneeL: 1.55, kneeR: 1.55, lean: 0.45, y: -0.2, head: [0.35, 0, 0.12] });
        p.armR = [p.armR[0] - 0.3 + Math.sin(T * 3) * 0.25, p.armR[1], p.armR[2]]; p.mouth = 'smile';
        return p;
      }
      case 'game': { const p = chibiPose(P, 'gamepad', T, sitO); return p; }
      case 'cue': { P.stroke = 0.5 + Math.sin(T * 1.6) * 0.45; const p = chibiPose(P, 'cue', T, sitO); return p; }   // bi-a: cúi người trên cơ, kéo cơ ra vào
      case 'sing': { const p = chibiPose(P, 'sing', T, sitO); return p; }   // karaoke: cầm mic, đung đưa theo nhạc   // máy arcade / tay cầm: nghiêng người theo game
      default: return null;
    }
  }
  /** Clip gọi điện có thể cầm tay trái: soi một lần, nếu vậy thì lật sang tay phải (điện thoại nằm ở tay phải của rig). */
  phoneMirror() {
    if (this._pm !== undefined) return this._pm;
    const m = mocapChibi('phone', 0.8); if (!m) return false;
    this._pm = Math.abs(m.armL[2]) > Math.abs(m.armR[2]) + 0.4;   // (khuỷu gập nhiều hơn = tay đang cầm máy)
    return this._pm;
  }
  /** Điếu thuốc trong tay phải (tạo một lần cho mỗi rig). */
  ensureCig(P) {
    if (P.held.cig) return;
    const g = new THREE.Group(); g.position.set(0, -0.02, P.D.handR * 0.9); g.visible = false;
    const r = P.D.handR * 0.18, L = P.D.handR * 2.2;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 8), new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.9 }));
    body.rotation.x = Math.PI / 2; body.position.z = L * 0.5;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, L * 0.18, 8), new THREE.MeshBasicMaterial({ color: '#ff6a2a' }));
    tip.rotation.x = Math.PI / 2; tip.position.z = L;
    g.add(body, tip); P.armR.hand.add(g); P.held.cig = g; P.cigTip = tip;
  }
}
