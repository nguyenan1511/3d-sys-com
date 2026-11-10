// Hạ tầng HTTP dùng chung cho mọi API: mã yêu cầu, nhật ký truy cập, header bảo mật, giới hạn tần suất, kiểm tra dữ liệu vào.
// Không thêm thư viện ngoài: mọi thứ ở đây đủ nhỏ để đọc và kiểm tra được.
import crypto from 'crypto';
import { HttpError } from './store.js';

// ---------- mã yêu cầu + nhật ký truy cập ----------
/** Gắn req.id (lấy từ X-Request-Id nếu hợp lệ, không thì tạo mới), trả lại ở header; ghi một dòng nhật ký cho mỗi lời gọi /api. */
export function requestLog({ production = false, quiet = false } = {}) {
  return (req, res, next) => {
    const given = String(req.headers['x-request-id'] || '');
    req.id = /^[\w-]{8,64}$/.test(given) ? given : crypto.randomBytes(8).toString('hex');
    res.set('X-Request-Id', req.id);
    if (quiet || !req.originalUrl.startsWith('/api')) return next();
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const line = { t: new Date().toISOString(), id: req.id, m: req.method, p: req.originalUrl.split('?')[0], s: res.statusCode, ms: +ms.toFixed(1), who: req.actor?.key || '-' };
      if (production) console.log(JSON.stringify(line));
      else if (res.statusCode >= 400 || req.method !== 'GET') console.log(`[api] ${line.m} ${line.p} → ${line.s} ${line.ms}ms ${line.who} #${line.id}`);
    });
    next();
  };
}

// ---------- header bảo mật ----------
export function securityHeaders({ production = false, secure = false } = {}) {
  return (_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=(), autoplay=(self "https://www.youtube.com")');
    if (secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // CSP chỉ bật khi chạy bản build (dev: Vite chèn script nội tuyến để nạp lại nóng)
    // (YouTube: trình phát nhúng cho loa công ty — script API, iframe, ảnh thu nhỏ)
    if (production) res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com; connect-src 'self' ws: wss:; font-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'");
    next();
  };
}

// ---------- giới hạn tần suất (theo người dùng, chưa đăng nhập thì theo IP) ----------
const buckets = new Map();
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60e3).unref();
/** Tối đa `max` lời gọi mỗi `windowMs` cho mỗi người (hoặc IP) trong nhóm `name`. Quá giới hạn → 429 + Retry-After. */
export function rateLimit(name, { max, windowMs = 60e3, methods = null } = {}) {
  return (req, res, next) => {
    if (methods && !methods.includes(req.method)) return next();
    const who = req.actor?.key || `ip:${req.ip || req.socket.remoteAddress}`, key = `${name}|${who}`, now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.n++;
    res.set('X-RateLimit-Limit', String(max)); res.set('X-RateLimit-Remaining', String(Math.max(0, max - b.n)));
    if (b.n > max) { res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000))); return res.status(429).json({ error: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.', code: 'rate_limited' }); }
    next();
  };
}
export const resetRateLimits = () => buckets.clear(); // (kiểm thử)

// ---------- kiểm tra dữ liệu vào ----------
/**
 * Kiểm tra một đối tượng theo lược đồ đơn giản; trả về bản đã làm sạch (chỉ các khoá trong lược đồ), sai thì HttpError 400.
 *   v.str({ max, min, pattern, optional }), v.int({ min, max, optional }), v.bool({ optional }), v.oneOf([...], { optional })
 */
export const v = {
  str: (o = {}) => ({ t: 'str', ...o }), int: (o = {}) => ({ t: 'int', ...o }), bool: (o = {}) => ({ t: 'bool', ...o }),
  oneOf: (values, o = {}) => ({ t: 'enum', values, ...o })
};
export function check(input, schema, where = 'dữ liệu') {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {}, out = {};
  for (const [k, r] of Object.entries(schema)) {
    let x = src[k];
    if (x === undefined || x === null || x === '') { if (r.optional) continue; throw new HttpError(400, `Thiếu ${k} trong ${where}.`, { code: 'invalid', field: k }); }
    const bad = msg => { throw new HttpError(400, `${k}: ${msg}`, { code: 'invalid', field: k }); };
    if (r.t === 'str') {
      if (typeof x !== 'string') bad('phải là chuỗi');
      x = x.normalize('NFC').trim();
      if (r.min && x.length < r.min) bad(`tối thiểu ${r.min} ký tự`);
      if (r.max && x.length > r.max) bad(`tối đa ${r.max} ký tự`);
      if (r.pattern && !r.pattern.test(x)) bad('sai định dạng');
    } else if (r.t === 'int') {
      x = typeof x === 'string' && /^-?\d+$/.test(x) ? Number(x) : x;
      if (!Number.isInteger(x)) bad('phải là số nguyên');
      if (r.min != null && x < r.min) bad(`tối thiểu ${r.min}`);
      if (r.max != null && x > r.max) bad(`tối đa ${r.max}`);
    } else if (r.t === 'bool') {
      if (typeof x !== 'boolean') bad('phải là true/false');
    } else if (r.t === 'enum') {
      if (!r.values.includes(x)) bad(`phải là một trong: ${r.values.join(', ')}`);
    }
    out[k] = x;
  }
  return out;
}
