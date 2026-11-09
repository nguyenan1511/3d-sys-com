// Băm mật khẩu (scrypt), phiên bằng cookie httpOnly, giới hạn đăng nhập sai.
import crypto from 'crypto';
import { promisify } from 'util';
import { config } from './config.js';

const scrypt = promisify(crypto.scrypt);
const N = 16384, R = 8, P = 1, KEYLEN = 64, MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw).normalize('NFC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(String(pw).normalize('NFC'), Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p, maxmem: MAXMEM });
  return crypto.timingSafeEqual(key, expected);
}

// khi không có tài khoản vẫn tính một lần scrypt để thời gian phản hồi như nhau
let dummyHash = null;
export async function dummyVerify(pw) { dummyHash ||= await hashPassword(crypto.randomBytes(8).toString('hex')); await verifyPassword(pw, dummyHash); }

const tokenHash = t => crypto.createHmac('sha256', config.sessionSecret).update(t).digest('base64url');
export const COOKIE = 'sysone_sid';

export function createSession(db, kind, subject) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hours = kind === 'admin' ? config.adminSessionHours : config.employeeSessionHours;
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id_hash, kind, subject, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(tokenHash(token), kind, subject, now, now + hours * 3600e3);
  return { token, maxAge: hours * 3600e3 };
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* bỏ cookie hỏng */ } }
  }
  return out;
}

export function sessionFromCookie(db, cookieHeader) {
  const token = parseCookies(cookieHeader)[COOKIE];
  if (!token) return null;
  const s = db.prepare('SELECT id_hash, kind, subject, expires_at FROM sessions WHERE id_hash = ?').get(tokenHash(token));
  if (!s) return null;
  if (s.expires_at < Date.now()) { db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(s.id_hash); return null; }
  return { id: s.id_hash, kind: s.kind, subject: s.subject };
}

export function setSessionCookie(res, token, maxAge) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge });
}
export function clearSessionCookie(res) { res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' }); }

// ---------- giới hạn số lần sai trong cửa sổ 15 phút ----------
const windowMs = () => config.loginWindowMin * 60e3;
export function failureCount(db, scope, key) {
  return db.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE scope = ? AND key = ? AND ts > ?').get(scope, key, Date.now() - windowMs()).n;
}
export function recordFailure(db, scope, key) {
  db.prepare('INSERT INTO login_failures (scope, key, ts) VALUES (?, ?, ?)').run(scope, key, Date.now());
  db.prepare('DELETE FROM login_failures WHERE ts < ?').run(Date.now() - 24 * 3600e3);
}
export function clearFailures(db, scope, key) { db.prepare('DELETE FROM login_failures WHERE scope = ? AND key = ?').run(scope, key); }

/** Yêu cầu đến từ nguồn hợp lệ: không có Origin, cùng tên miền, hoặc nằm trong ALLOWED_ORIGINS (giao diện đặt ở Vercel). */
export function originAllowed(req, allowed = []) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let u; try { u = new URL(origin); } catch { return false; }
  return u.host === req.headers.host || allowed.includes(u.origin);
}

// Vé WebSocket: giao diện ở tên miền khác (Vercel) không gửi được cookie khi mở WS thẳng tới server, nên lấy một vé
// qua API (đi qua proxy, có cookie) rồi mở wss://server/ws?ticket=…  Vé dùng một lần, hết hạn sau 30 giây, chỉ nằm trong bộ nhớ.
const tickets = new Map();
export function issueWsTicket(cookieHeader) {
  const now = Date.now();
  for (const [k, t] of tickets) if (t.exp < now) tickets.delete(k);
  const id = crypto.randomBytes(24).toString('base64url');
  tickets.set(id, { cookie: cookieHeader, exp: now + 30e3 });
  return id;
}
export function redeemWsTicket(id) {
  const t = tickets.get(String(id || '')); if (!t) return null;
  tickets.delete(id);
  return t.exp >= Date.now() ? t.cookie : null;
}
