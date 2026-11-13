// Route HTTP. Mọi quyết định quyền đều ở server; client chỉ hiển thị kết quả.
import express from 'express';
import { compressedStatic } from './static.js';
import path from 'path';
import { config as defaultConfig, ROOT } from './config.js';
import { openData, audit } from './db.js';
import { Store, HttpError } from './store.js';
import { Hub } from './realtime.js';
import { requestLog, securityHeaders, rateLimit } from './http.js';
import { attendanceRoutes } from './routes/attendance.js';
import { suggest, CATEGORIES } from './ktvSuggest.js';
import { chatRoutes } from './routes/chat.js';
import { backupRoutes } from './routes/backup.js';
import { scheduleBackups, backupDir } from './backup.js';
import { musicRoutes } from './routes/music.js';
import { lightsRoutes } from './routes/lights.js';
import {
  hashPassword, verifyPassword, dummyVerify, createSession, sessionFromCookie, setSessionCookie, clearSessionCookie,
  failureCount, recordFailure, clearFailures, originAllowed, issueWsTicket
} from './security.js';
import { displayOf } from '../src/shared/identity.js';

const GENERIC_ADMIN_FAIL = 'Tên đăng nhập hoặc mật khẩu không đúng.';
const LOCKED_MSG = 'Đăng nhập tạm bị khóa do thử sai nhiều lần. Vui lòng thử lại sau 15 phút.';
export const API_VERSION = '1.1.0';
const DATA_FILE = /(^|\/)(layout|employees|equipment|appearance)\.json$/;

export async function createApp(config = defaultConfig) {
  const db = await openData(config);   // (MONGODB_URI: nạp các collection từ MongoDB; lần đầu tự chuyển dữ liệu SQLite cũ sang)
  // tình trạng lưu dữ liệu (thẻ Cấu hình ở bảng quản trị, /health)
  const dataStatus = () => { const st = db.status(); return { enabled: db.kind === 'mongo', kind: db.kind, restoredAt: db.loadedAt || null, lastSaveAt: st.lastWriteAt || null, pending: st.pending || 0, error: st.error || null }; };
  const store = new Store(db, config);
  const hub = new Hub(store, config);
  await seedAdmin(db, config);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ?? 'loopback');
  app.use(securityHeaders({ production: config.production, secure: config.cookieSecure }));
  app.use(express.json({ limit: '1mb' }));

  // phiên
  app.use((req, _res, next) => {
    req.sess = sessionFromCookie(db, req.headers.cookie);
    if (req.sess) {
      req.actor = req.sess.kind === 'admin'
        ? { kind: 'admin', username: req.sess.subject, key: `admin:${req.sess.subject}` }
        : { kind: 'employee', code: req.sess.subject, key: `emp:${req.sess.subject}` };
      if (req.actor.kind === 'employee') {
        const e = store.employee(req.actor.code);
        if (!e || e.status !== 'active') { req.sess = null; req.actor = null; }
      }
    }
    next();
  });

  app.use(requestLog({ production: config.production, quiet: !!process.env.VITEST }));
  // chống CSRF: thao tác ghi phải là JSON và cùng nguồn
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (!req.is('application/json')) return res.status(415).json({ error: 'Yêu cầu phải gửi dạng JSON.' });
    if (!originAllowed(req, config.allowedOrigins)) return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
    next();
  });

  const needAuth = (req, res, next) => req.actor ? next() : res.status(401).json({ error: 'Cần đăng nhập.' });
  const needAdmin = (req, res, next) => req.actor?.kind === 'admin' ? next() : res.status(req.actor ? 403 : 401).json({ error: req.actor ? 'Chỉ CEO được thực hiện thao tác này.' : 'Cần đăng nhập.' });
  const needEmployee = (req, res, next) => req.actor?.kind === 'employee' ? next() : res.status(req.actor ? 403 : 401).json({ error: req.actor ? 'Chỉ dành cho nhân viên.' : 'Cần đăng nhập.' });
  const ip = req => req.ip || req.socket.remoteAddress || '?';
  // Mọi API nằm trên một router, gắn ở /api/v1 (bản chính thức) và /api (giữ tương thích): thêm API mới chỉ cần thêm route vào đây
  const api = express.Router();
  api.use(rateLimit('write', { max: 240, windowMs: 60e3, methods: ['POST', 'PUT', 'PATCH', 'DELETE'] })); // trần chung cho thao tác ghi
  const ctx = { db, store, hub, config, guards: { needAuth, needAdmin, needEmployee } };
  // gợi ý bài karaoke từ YouTube (phòng hát): nhóm có sẵn (?cat=) hoặc tìm theo tên bài (?q=)
  api.get('/ktv/suggest', needAuth, rateLimit('ktv-suggest', { max: 30, windowMs: 60e3 }), async (req, res) => {
    const r = await suggest({ cat: String(req.query.cat || ''), q: String(req.query.q || ''), key: config.youtubeApiKey });
    res.json({ categories: CATEGORIES.map(({ id, label }) => ({ id, label })), ...r });
  });
  api.get('/health', (_req, res) => res.json({ ok: true, version: API_VERSION, time: Date.now(), uptimeSec: Math.round(process.uptime()), ...(db.kind === 'mongo' ? { mongo: (({ restoredAt, lastSaveAt, pending, error }) => ({ restoredAt, lastSaveAt, pending, ok: !error }))(dataStatus()) } : {}) }));

  // ---------- phiên làm việc ----------
  api.get('/me', (req, res) => {
    if (!req.actor) return res.json({ authenticated: false });
    const base = { authenticated: true, kind: req.actor.kind, config: { duplicatePolicy: config.duplicatePolicy, adminCanSitAnywhere: config.adminCanSitAnywhere } };
    if (req.actor.kind === 'admin') {
      const a = db.admins.get(req.actor.username);
      return res.json({ ...base, admin: { username: a.username, mustChangePassword: !!a.is_initial } });
    }
    res.json({ ...base, employee: store.employeeView(store.employee(req.actor.code), hub.isOnline) });
  });

  api.post('/login/employee', (req, res) => {
    if (failureCount(db, 'emp-ip', ip(req)) >= 30) return res.status(429).json({ error: 'Thử quá nhiều lần. Vui lòng đợi 15 phút.' });
    try {
      const r = store.loginEmployee(req.body?.input, hub.isOnline);
      const { token, maxAge } = createSession(db, 'employee', r.code);
      setSessionCookie(res, token, maxAge);
      hub.markPending(r.code);
      hub.kickSessions(`employee:${r.code}`, 'Mã của bạn vừa đăng nhập ở nơi khác.');
      store.emit({ type: 'employees', code: r.code });
      res.json({ ok: true, created: r.created, employee: store.employeeView(store.employee(r.code), hub.isOnline) });
    } catch (e) {
      if (e instanceof HttpError && e.status !== 400) recordFailure(db, 'emp-ip', ip(req));
      throw e;
    }
  });

  api.post('/login/admin', async (req, res) => {
    const username = String(req.body?.username ?? '').trim().toLowerCase().slice(0, 64);
    const password = String(req.body?.password ?? '').slice(0, 256);
    if (failureCount(db, 'admin-user', username) >= config.loginMaxFailures || failureCount(db, 'admin-ip', ip(req)) >= config.loginMaxFailures) {
      return res.status(429).json({ error: LOCKED_MSG });
    }
    const a = db.admins.get(username);
    const ok = a ? await verifyPassword(password, a.pass_hash) : (await dummyVerify(password), false);
    if (!ok) {
      recordFailure(db, 'admin-user', username); recordFailure(db, 'admin-ip', ip(req));
      audit(db, 'anonymous', 'admin.login.fail', username, { ip: ip(req) });
      const locked = failureCount(db, 'admin-user', username) >= config.loginMaxFailures;
      return res.status(locked ? 429 : 401).json({ error: locked ? LOCKED_MSG : GENERIC_ADMIN_FAIL });
    }
    clearFailures(db, 'admin-user', username); clearFailures(db, 'admin-ip', ip(req));
    const { token, maxAge } = createSession(db, 'admin', a.username);
    setSessionCookie(res, token, maxAge);
    audit(db, `admin:${a.username}`, 'admin.login', a.username, { ip: ip(req) });
    res.json({ ok: true, mustChangePassword: !!a.is_initial });
  });

  api.post('/logout', (req, res) => {
    if (req.sess) {
      db.sessions.del(req.sess.id);
      audit(db, req.actor?.key || 'unknown', 'logout');
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  api.post('/admin/password', needAdmin, async (req, res) => {
    const { current, next } = req.body || {};
    const a = db.admins.get(req.actor.username);
    if (!(await verifyPassword(String(current ?? ''), a.pass_hash))) return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng.' });
    const pw = String(next ?? '');
    if (pw.length < 8) return res.status(400).json({ error: 'Mật khẩu mới cần ít nhất 8 ký tự.' });
    if (pw === String(current)) return res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu cũ.' });
    db.admins.update(a.username, { pass_hash: await hashPassword(pw), is_initial: 0, updated_at: Date.now() });
    db.sessions.delWhere(r => r.kind === 'admin' && r.subject === a.username && r.id_hash !== req.sess.id);
    audit(db, req.actor.key, 'admin.password.change', a.username);
    res.json({ ok: true });
  });

  // ---------- chỗ ngồi ----------
  api.get('/seats', needAuth, (req, res) => res.json({ seats: store.listSeats(req.query.mode === 'real' ? 'real' : req.query.mode === 'all' ? null : 'office') })); // (mặc định Office SYS như trước)
  api.get('/equipment', needAuth, (_req, res) => res.json(store.equipment));
  api.get('/appearance', needAuth, (_req, res) => res.json(store.appearance));
  api.put('/me/look', needEmployee, (req, res) => res.json({ ok: true, look: store.setLook(req.actor, req.actor.code, req.body?.look) }));

  api.post('/seats/:id/claim', needEmployee, (req, res) => {
    const seat = store.claim(req.actor.code, req.params.id, req.body?.equipment);
    res.json({ ok: true, seat });
  });
  api.put('/seats/:id/equipment', needAuth, (req, res) => {
    res.json({ ok: true, seat: store.updateEquipment(req.actor, req.params.id, req.body?.equipment) });
  });
  api.post('/seats/:id/sit', needAuth, (req, res) => {
    const seat = store.checkSit(req.actor, req.params.id);
    hub.setSeated(req.actor.kind === 'admin' ? `admin:${req.actor.username}` : `employee:${req.actor.code}`, seat);
    audit(db, req.actor.key, 'seat.sit', seat.deskId);
    res.json({ ok: true, seat });
  });
  api.post('/seats/stand', needAuth, (req, res) => {
    hub.stand(req.actor.kind === 'admin' ? `admin:${req.actor.username}` : `employee:${req.actor.code}`);
    res.json({ ok: true });
  });

  // ---------- quản trị ----------
  api.get('/admin/employees', needAdmin, (_req, res) => res.json({ employees: store.listEmployees(hub.isOnline), online: hub.onlineList() }));
  api.post('/admin/employees', needAdmin, (req, res) => res.json({ ok: true, ...store.adminCreateEmployee(req.actor, req.body?.input, req.body?.department) }));
  api.put('/admin/employees/:code/look', needAdmin, (req, res) => res.json({ ok: true, look: store.setLook(req.actor, req.params.code, req.body?.look) }));
  api.patch('/admin/employees/:code', needAdmin, (req, res) => { store.adminUpdateEmployee(req.actor, req.params.code, req.body || {}); res.json({ ok: true }); });
  api.delete('/admin/employees/:code', needAdmin, (req, res) => { store.adminDeleteEmployee(req.actor, req.params.code); res.json({ ok: true }); });
  api.post('/admin/employees/:code/logout', needAdmin, (req, res) => { store.adminForceLogout(req.actor, req.params.code); res.json({ ok: true }); });
  api.post('/admin/seats/:id/assign', needAdmin, (req, res) => { store.adminAssign(req.actor, req.params.id, String(req.body?.code || '')); res.json({ ok: true }); });
  api.post('/admin/seats/:id/release', needAdmin, (req, res) => { store.adminRelease(req.actor, req.params.id); res.json({ ok: true }); });
  api.post('/admin/seats/:id/lock', needAdmin, (req, res) => { store.adminLock(req.actor, req.params.id, !!req.body?.locked); res.json({ ok: true }); });
  api.get('/admin/export.csv', needAdmin, (req, res) => {
    audit(db, req.actor.key, 'admin.csv.export');
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="nhan-vien-cho-ngoi.csv"').send('﻿' + store.exportCsv());
  });
  api.post('/admin/import', needAdmin, (req, res) => res.json({ ok: true, ...store.importCsv(req.actor, req.body?.csv) }));
  // tổng quan cho bảng quản trị: số người online theo phút (6 giờ), tình trạng server và lưu MongoDB
  api.get('/admin/stats', needAdmin, (_req, res) => res.json({ online: hub.hist, now: hub.onlineEmployees(), version: API_VERSION, uptimeSec: Math.round(process.uptime()),
    mongo: dataStatus() }));
  api.get('/admin/audit', needAdmin, (req, res) => res.json({ audit: store.auditLog(+req.query.limit || 200) }));

  /** Vé mở WebSocket thẳng tới server (khi giao diện đặt ở tên miền khác, ví dụ Vercel). */
  api.post('/ws-ticket', needAuth, (req, res) => res.json({ ticket: issueWsTicket(req.headers.cookie) }));

  attendanceRoutes(api, ctx);
  chatRoutes(api, ctx);
  musicRoutes(api, ctx);
  lightsRoutes(api, ctx);
  backupRoutes(api, ctx);
  app.use(['/api/v1', '/api'], api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Không có API này.', code: 'not_found', path: req.originalUrl.split('?')[0], requestId: req.id }));

  // dữ liệu bố cục chỉ cấp sau khi đăng nhập
  app.use((req, res, next) => (DATA_FILE.test(req.path) && !req.actor) ? res.status(401).json({ error: 'Cần đăng nhập.' }) : next());
  if (config.simEmployeesPath) app.get('/data/employees.json', (_req, res) => res.sendFile(config.simEmployeesPath));
  app.use('/data', compressedStatic(path.join(ROOT, 'public/data'))); // (nén; kiểm tra lại bằng ETag)

  // lỗi
  const finish = (err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}), requestId: req.id });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON không hợp lệ.', code: 'bad_json', requestId: req.id });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Dữ liệu gửi lên quá lớn.', code: 'too_large', requestId: req.id });
    console.error(`[lỗi] #${req.id}`, err);   // chi tiết chỉ ghi ở server, không trả về cho client
    res.status(500).json({ error: 'Lỗi máy chủ.', code: 'server_error', requestId: req.id });
  };

  // theo dõi layout.json để cập nhật danh sách bàn
  let t = null;
  const watcher = (await import('fs')).watch(config.layoutPath, () => { clearTimeout(t); t = setTimeout(() => { try { store.loadLayout(); hub.onStore({ type: 'seats' }); } catch (e) { console.error('layout.json lỗi:', e.message); } }, 300); });

  const stopBackups = scheduleBackups(db, backupDir(config));
  return { app, db, store, hub, finish, close() { stopBackups(); watcher.close(); hub.close(); return db.close(); } };
}

async function seedAdmin(db, config) {
  const n = db.admins.count();
  if (n) return;
  if (!config.adminInitialPassword) {
    console.warn('[cảnh báo] Chưa có tài khoản CEO. Đặt ADMIN_INITIAL_PASSWORD trong .env rồi khởi động lại để tạo tài khoản "admin".');
    return;
  }
  db.admins.insert({ username: 'admin', pass_hash: await hashPassword(config.adminInitialPassword), is_initial: 1, updated_at: Date.now() });
  audit(db, 'system', 'admin.seed', 'admin');
  console.log('Đã tạo tài khoản CEO "admin" từ ADMIN_INITIAL_PASSWORD. Hãy đổi mật khẩu sau lần đăng nhập đầu.');
}

export { displayOf };
