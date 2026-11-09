// Chuyển động quay từ người thật (Quaternius UAL 1+2, CC0) cho nhân vật chibi — dữ liệu từ scripts/build-mocap.mjs.
// Mỗi nhân vật có vài "lớp" clip đang phát; trọng số các lớp chuyển dần về đích (crossfade ~0.25 s) rồi trộn
// hướng từng khớp bằng nlerp có trọng số. Đi/chạy dùng chung một pha và tốc độ phát khớp tốc độ di chuyển thật
// (chân trụ không trượt). Động tác tay mà mocap không có (gõ phím, vẫy tay, hút thuốc, cầm cốc) lấy từ tư thế
// tự dựng cũ và trộn lên phần tay.
import * as THREE from 'three';

export const MOCAP = { ready: false, fps: 30, segs: [], stride: 0, clips: {}, data: null };
let loading = null;
export function loadMocap(base = '/data/') {
  if (!loading) loading = Promise.all([fetch(base + 'mocap.json').then(r => r.json()), fetch(base + 'mocap.bin').then(r => r.arrayBuffer())])
    .then(([j, bin]) => { Object.assign(MOCAP, j, { data: new Float32Array(bin), ready: true }); })
    .catch(e => { console.warn('mocap: không tải được', e); });
  return loading;
}

export const SEG = { pelvis: 0, spine: 1, head: 2, upperL: 3, upperR: 4, foreL: 5, foreR: 6, thighL: 7, thighR: 8, shinL: 9, shinR: 10, ankleL: 11, ankleR: 12 };
const NS = 13;

/** Lấy mẫu clip tại thời điểm t (giây) → cộng dồn (trọng số w) vào acc (Float32Array NS*4+3). */
function accumulate(acc, key, t, w) {
  const c = MOCAP.clips[key]; if (!c || w <= 0) return;
  const n = c.frames, st = MOCAP.stride;
  let f = t * MOCAP.fps;
  if (c.loop) { f %= (n - 1); if (f < 0) f += n - 1; } else f = Math.max(0, Math.min(n - 1, f));
  const i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), k = f - i0;
  const o0 = c.offset + i0 * st, o1 = c.offset + i1 * st, D = MOCAP.data;
  for (let s = 0; s < NS; s++) {
    const a = o0 + s * 4, b = o1 + s * 4;
    // nlerp giữa hai khung (cùng bán cầu), rồi cộng vào tổng (cùng bán cầu với tổng hiện có)
    const sgn = D[a] * D[b] + D[a + 1] * D[b + 1] + D[a + 2] * D[b + 2] + D[a + 3] * D[b + 3] < 0 ? -1 : 1;
    let x = D[a] * (1 - k) + sgn * D[b] * k, y = D[a + 1] * (1 - k) + sgn * D[b + 1] * k, z = D[a + 2] * (1 - k) + sgn * D[b + 2] * k, q = D[a + 3] * (1 - k) + sgn * D[b + 3] * k;
    const j = s * 4;
    if (acc[j] * x + acc[j + 1] * y + acc[j + 2] * z + acc[j + 3] * q < 0) { x = -x; y = -y; z = -z; q = -q; }
    acc[j] += x * w; acc[j + 1] += y * w; acc[j + 2] += z * w; acc[j + 3] += q * w;
  }
  const h0 = o0 + NS * 4, h1 = o1 + NS * 4, j = NS * 4;
  for (let m = 0; m < 3; m++) acc[j + m] += (D[h0 + m] * (1 - k) + D[h1 + m] * k) * w;
}

const FADE = 0.18;
/**
 * Tính tư thế mocap cho agent a. v: tốc độ di chuyển (m/s), hipW: chiều cao hông thật (m), dt: giây.
 * Trả về { q: Float32Array(NS*4) (đã chuẩn hóa), hip: [x,y,z] theo đơn vị chiều cao hông, armW: [trái, phải] — trọng
 * số tay tự dựng cần đè lên } hoặc null khi chưa có dữ liệu.
 */
export function mocapPose(a, v, hipW, dt) {
  if (!MOCAP.ready) return null;
  const st = a._mc || (a._mc = { L: new Map(), phase: (a.idx || 0) * 0.37 % 1, acc: new Float32Array(NS * 4 + 3), armW: [0, 0], jumpT: 0 });
  const sit = a.sit || 0, act = a.act, anim = a.anim, walk = Math.min(2, a.walkAmt || 0);
  // ---- trọng số đích ----
  const want = {};
  const add = (k, w) => { if (w > 0) want[k] = (want[k] || 0) + w; };
  let armL = 0, armR = 0, locoW = 0;
  if (sit > 0.02) {
    add(anim === 'talk' && !act ? 'sitTalk' : 'sitIdle', 1);
    if ((anim === 'type' || anim === 'cup' || anim === 'eat' || anim === 'pour') && !act) armL = armR = 1;
  } else if ((a.jumpH || 0) > 0.015) {
    add('jumpLoop', 1);
  } else if (act === 'dance') add('dance', 1);
  else if (act === 'phone') add('phone', 1);
  else {
    // đứng ↔ đi ↔ chạy theo tốc độ
    const wWalk = Math.min(1, walk), wRun = Math.max(0, walk - 1);
    const base = anim === 'talk' && !act ? 'talk' : 'idle';
    add(base, 1 - wWalk); add('walk', wWalk * (1 - wRun)); add('jog', wWalk * wRun); locoW = wWalk;
    if (act === 'wave' || act === 'smoke' || act === 'drink') armR = 1; // tay cầm cốc/thuốc: cử chỉ tự dựng, đúng tay đạo cụ
    if ((anim === 'cup' || anim === 'eat' || anim === 'pour') && !act) armL = armR = 1;
  }
  if (sit > 0.02 && act) { armR = act === 'wave' || act === 'smoke' || act === 'drink' || act === 'phone' ? 1 : armR; }
  // ---- crossfade ----
  // khung đầu tiên (chưa có lớp nào): nhận ngay trạng thái đích, không chuyển dần từ "rỗng"
  const fade = st.L.size === 0 ? 1 : Math.min(1, dt / ((a.jumpH || 0) > 0.015 ? 0.1 : FADE));
  for (const k of Object.keys(want)) if (!st.L.has(k)) st.L.set(k, { w: 0, t: 0 });
  let tot = 0;
  for (const [k, L] of st.L) { L.w += ((want[k] || 0) - L.w) * fade; if (L.w < 0.003 && !want[k]) { st.L.delete(k); continue; } tot += L.w; }
  st.armW[0] += (armL - st.armW[0]) * fade; st.armW[1] += (armR - st.armW[1]) * fade;
  // ---- thời gian từng lớp; đi/chạy dùng chung pha, tốc độ phát khớp tốc độ di chuyển ----
  const cw = MOCAP.clips.walk, cj = MOCAP.clips.jog;
  if (locoW > 0.01 || st.L.has('walk') || st.L.has('jog')) {
    const run = Math.max(0, walk - 1);
    const natural = (cw.speed * (1 - run) + cj.speed * run) * hipW; // m/s khi phát đúng tốc độ gốc
    const dur = cw.dur * (1 - run) + cj.dur * run;
    const rate = natural > 1e-3 ? Math.max(0.4, Math.min(2.2, v / natural)) : 1;
    st.phase = (st.phase + dt * rate / dur) % 1;
  }
  for (const [k, L] of st.L) {
    if (k === 'walk' || k === 'jog') L.t = st.phase * MOCAP.clips[k].dur;
    else if (k === 'consume') L.t = (L.t + dt * 0.8) % MOCAP.clips.consume.dur; // uống: lặp chậm
    else L.t += dt;
  }
  // ---- trộn ----
  const acc = st.acc; acc.fill(0);
  for (const [k, L] of st.L) accumulate(acc, k, L.t, L.w / (tot || 1));
  for (let s = 0; s < NS; s++) {
    const j = s * 4, n = Math.hypot(acc[j], acc[j + 1], acc[j + 2], acc[j + 3]) || 1;
    acc[j] /= n; acc[j + 1] /= n; acc[j + 2] /= n; acc[j + 3] /= n;
  }
  return { q: acc, hip: [acc[NS * 4], acc[NS * 4 + 1], acc[NS * 4 + 2]], armW: st.armW };
}

const _q = new THREE.Quaternion();
/** Quaternion khớp s từ kết quả mocapPose. */
export function segQuat(res, s, out = _q) { const j = s * 4; return out.set(res.q[j], res.q[j + 1], res.q[j + 2], res.q[j + 3]); }
