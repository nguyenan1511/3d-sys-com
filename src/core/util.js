// Tiện ích dùng chung, không phụ thuộc three.js (chạy được trong test Node).

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t);

/** "08:30" -> giây kể từ 0h. */
export function parseTime(s) {
  if (typeof s === 'number') return s;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(s).trim());
  if (!m) throw new Error(`Giờ không hợp lệ: "${s}" (cần dạng HH:MM)`);
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] || 0));
}

export function fmtTime(sec, withSec = false) {
  sec = ((Math.floor(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  const p = n => String(n).padStart(2, '0');
  return withSec ? `${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}`;
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** PRNG mulberry32 có seed, để mô phỏng lặp lại được. */
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a0, b0) => a0 + (b0 - a0) * f();
  f.normal = () => { let u = 0, v = 0; while (!u) u = f(); while (!v) v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  return f;
}

/** Hướng nhìn (độ) -> vector đơn vị trên mặt phẳng xz. 0 = -z, 90 = -x, 180 = +z, 270 = +x. */
export function facingVec(deg) {
  const r = deg * Math.PI / 180;
  return { x: -Math.sin(r), z: -Math.cos(r) };
}

export const deg2yaw = deg => deg * Math.PI / 180;

/** Góc yaw (radian, quy ước rotation.y của three) để nhìn theo vector (dx,dz). */
export const yawOf = (dx, dz) => Math.atan2(-dx, -dz);

export function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const inRect = (r, x, z, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
