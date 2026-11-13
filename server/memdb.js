// Dữ liệu của server: MongoDB là nơi lưu chính (mỗi bảng một collection — xem / tìm / sửa được trong MongoDB Atlas), server
// giữ một bản trong bộ nhớ để đọc tức thì (mọi nghiệp vụ vẫn chạy đồng bộ, không phải chờ mạng) và GHI THẲNG mỗi thay đổi
// lên Mongo theo thứ tự (hàng đợi, tự thử lại khi mạng lỗi, tắt server thì ghi nốt).
//  • Giao dịch db.tx(fn): fn lỗi giữa chừng thì mọi thay đổi trong fn được trả lại (như ROLLBACK của SQLite) và không có gì
//    được gửi lên Mongo; xong thì gửi cả lô.
//  • Ràng buộc: khoá chính mỗi bảng; bảng seats — mỗi người tối đa một chỗ ở mỗi chế độ (Office: mã T…, Real SYS: mã R…).
//  • Nơi lưu: MONGODB_URI → Mongo; DB_PATH=':memory:' → chỉ trong bộ nhớ (kiểm thử); còn lại → file JSON (máy dev / server có ổ đĩa).
//  • Chỉ chạy MỘT server (Render một instance): sửa trực tiếp trong Atlas khi server đang chạy sẽ bị ghi đè — sửa qua Bảng quản trị,
//    hoặc khởi động lại server sau khi sửa.
import fs from 'node:fs';
import path from 'node:path';

/** Các bảng: khoá chính, cột JSON (lưu lên Mongo dạng object cho dễ đọc), chỉ mục phụ, số bản giữ trong bộ nhớ. */
export const TABLES = {
  employees: { key: 'code', json: ['look'], index: [] },
  seats: { key: 'desk_id', json: ['equipment'], index: ['owner_code'] },
  admins: { key: 'username' },
  sessions: { key: 'id_hash', index: ['subject'] },
  login_failures: { auto: true, index: ['key'] },
  world_state: { key: 'key' },
  audit: { auto: true, json: ['detail'], keepInMemory: 3000 },
  attendance: { key: r => `${r.code}|${r.day}`, index: ['day', 'code'] },
  chat_messages: { auto: true, index: ['channel'] }
};

class Table {
  constructor(db, name, spec) {
    this.db = db; this.name = name; this.spec = spec; this.rows = new Map(); this.nextId = 1;
    this.keyOf = spec.auto ? r => r.id : typeof spec.key === 'function' ? spec.key : r => r[spec.key];
    this.idx = Object.fromEntries((spec.index || []).map(f => [f, new Map()]));
  }
  // ---- đọc (trả bản sao: sửa bản sao không làm đổi dữ liệu) ----
  get(k) { const r = this.rows.get(k); return r ? { ...r } : undefined; }
  has(k) { return this.rows.has(k); }
  all() { return [...this.rows.values()].map(r => ({ ...r })); }
  where(fn) { const out = []; for (const r of this.rows.values()) if (fn(r)) out.push({ ...r }); return out; }
  find(fn) { for (const r of this.rows.values()) if (fn(r)) return { ...r }; return undefined; }
  /** Theo chỉ mục phụ: các dòng có field === value. */
  by(field, value) { const ks = this.idx[field]?.get(value); if (!ks) return this.where(r => r[field] === value); return [...ks].map(k => ({ ...this.rows.get(k) })); }
  count(fn) { if (!fn) return this.rows.size; let n = 0; for (const r of this.rows.values()) if (fn(r)) n++; return n; }
  // ---- ghi ----
  insert(row) {
    if (this.spec.auto && row.id == null) row = { ...row, id: this.nextId };
    const k = this.keyOf(row);
    if (this.rows.has(k)) throw new Error(`UNIQUE constraint failed: ${this.name}`);
    this.write(k, { ...row });
    return k;
  }
  upsert(row) { const k = this.keyOf(row), cur = this.rows.get(k); this.write(k, cur ? { ...cur, ...row } : { ...row }); return k; }
  /** Sửa một dòng; trả về 1 (có dòng) / 0. */
  update(k, patch) { const cur = this.rows.get(k); if (!cur) return 0; this.write(k, { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }); return 1; }
  updateWhere(fn, patch) { let n = 0; for (const [k, r] of [...this.rows]) if (fn(r)) { this.update(k, patch); n++; } return n; }
  del(k) { if (!this.rows.has(k)) return 0; this.write(k, null); return 1; }
  delWhere(fn) { let n = 0; for (const [k, r] of [...this.rows]) if (fn(r)) { this.write(k, null); n++; } return n; }
  /** Bỏ bớt dòng cũ khỏi BỘ NHỚ (vẫn còn trên Mongo). */
  trim() {
    const keep = this.spec.keepInMemory; if (!keep || this.rows.size <= keep * 1.2) return;
    const ks = [...this.rows.keys()].sort((a, b) => a - b).slice(0, this.rows.size - keep);
    for (const k of ks) this.place(k, null);
  }
  write(k, row) {
    const prev = this.rows.get(k) ?? null;
    if (row && this.name === 'seats') this.db.checkSeat(row);
    this.place(k, row);
    if (row && this.spec.auto && row.id >= this.nextId) this.nextId = row.id + 1;
    this.db.changed(this, k, prev);
  }
  /** Đặt dòng vào bộ nhớ + cập nhật chỉ mục (không ghi nhận thay đổi). */
  place(k, row) {
    const prev = this.rows.get(k);
    for (const [f, m] of Object.entries(this.idx)) {
      if (prev && prev[f] != null) { const s = m.get(prev[f]); s?.delete(k); if (s && !s.size) m.delete(prev[f]); }
      if (row && row[f] != null) { if (!m.has(row[f])) m.set(row[f], new Set()); m.get(row[f]).add(k); }
    }
    if (row) this.rows.set(k, row); else this.rows.delete(k);
    if (row && this.spec.auto && row.id >= this.nextId) this.nextId = row.id + 1;
  }
}

export class MemDB {
  constructor() {
    this.t = {}; for (const [n, s] of Object.entries(TABLES)) this[n] = this.t[n] = new Table(this, n, s);
    this.journal = null; this.sink = null;   // sink: nơi lưu (Mongo / file), nhận các lô thay đổi đã chốt
  }
  /** Giao dịch: lỗi thì trả lại như cũ, xong thì gửi cả lô thay đổi lên nơi lưu. Lồng nhau: chạy chung giao dịch ngoài. */
  tx(fn) {
    if (this.journal) return fn();
    this.journal = [];
    try { const r = fn(); const j = this.journal; this.journal = null; this.commit(j); return r; }
    catch (e) { const j = this.journal; this.journal = null; for (let i = j.length - 1; i >= 0; i--) { const [t, k, prev] = j[i]; t.place(k, prev); } throw e; }
  }
  changed(t, k, prev) { if (this.journal) this.journal.push([t, k, prev]); else this.commit([[t, k, prev]]); }
  commit(j) {
    if (!j.length) return;
    const ops = new Map(); for (const [t, k] of j) ops.set(`${t.name}\u0000${k}`, [t, k]);
    this.sink?.push([...ops.values()].map(([t, k]) => ({ table: t.name, key: k, row: t.rows.get(k) ?? null })));
    for (const [t] of ops.values()) t.trim();
  }
  /** Mỗi người tối đa một chỗ ở mỗi chế độ (thay cho UNIQUE INDEX của SQLite). */
  checkSeat(row) {
    if (!row.owner_code) return;
    const real = String(row.desk_id).startsWith('R');
    for (const k of this.seats.idx.owner_code.get(row.owner_code) || []) if (k !== row.desk_id && String(k).startsWith('R') === real) throw new Error('UNIQUE constraint failed: seats.owner_code');
  }
  /** Nạp dữ liệu (khởi động / chuyển dữ liệu cũ): không ghi nhận thay đổi. */
  load(table, rows) { const t = this.t[table]; for (const r of rows) t.place(t.keyOf(r), { ...r }); }
  dump() { return Object.fromEntries(Object.keys(TABLES).map(n => [n, [...this.t[n].rows.values()]])); }
}

// ---------- nơi lưu ----------
const fromDoc = (spec, doc) => { const { _id, ...r } = doc; for (const f of spec.json || []) if (r[f] != null && typeof r[f] !== 'string') r[f] = JSON.stringify(r[f]); return r; };
const toDoc = (spec, key, row) => { const d = { _id: key, ...row }; for (const f of spec.json || []) if (typeof d[f] === 'string') { try { d[f] = JSON.parse(d[f]); } catch { /* giữ chuỗi */ } } return d; };

/** Ghi lên MongoDB: hàng đợi theo thứ tự, gộp nhiều thay đổi của cùng một dòng, thử lại khi lỗi. */
export class MongoSink {
  constructor(mdb, log = console) { this.mdb = mdb; this.log = log; this.q = new Map(); this.busy = null; this.status = { lastWriteAt: null, error: null, pending: 0 }; this.retry = 0; }
  push(ops) { for (const o of ops) this.q.set(`${o.table}\u0000${o.key}`, o); this.status.pending = this.q.size; this.kick(); }
  kick(delay = 0) { if (this.busy || this.timer) return; this.timer = setTimeout(() => { this.timer = null; this.busy = this.flushOnce().finally(() => { this.busy = null; if (this.q.size) this.kick(this.status.error ? Math.min(30000, 1000 * 2 ** this.retry) : 0); }); }, delay); }
  async flushOnce() {
    if (!this.q.size) return;
    const batch = [...this.q.values()]; this.q.clear();
    const byTable = new Map(); for (const o of batch) { if (!byTable.has(o.table)) byTable.set(o.table, []); byTable.get(o.table).push(o); }
    try {
      for (const [table, ops] of byTable) {
        const spec = TABLES[table];
        await this.mdb.collection(table).bulkWrite(ops.map(o => o.row ? { replaceOne: { filter: { _id: o.key }, replacement: toDoc(spec, o.key, o.row), upsert: true } } : { deleteOne: { filter: { _id: o.key } } }), { ordered: true });
      }
      this.status.lastWriteAt = Date.now(); this.status.error = null; this.retry = 0;
    } catch (e) {
      // trả lại hàng đợi (thay đổi mới hơn của cùng dòng giữ nguyên) rồi thử lại sau
      for (const o of batch) { const k = `${o.table}\u0000${o.key}`; if (!this.q.has(k)) this.q.set(k, o); }
      this.status.error = e.message; this.retry++;
      this.log.warn(`[mongo] Ghi lỗi (${e.message}), thử lại sau ${Math.min(30, 2 ** this.retry)} giây…`);
    }
    this.status.pending = this.q.size;
  }
  /** Ghi nốt mọi thứ (khi tắt server). */
  async flush(timeoutMs = 15000) {
    const end = Date.now() + timeoutMs;
    while ((this.q.size || this.busy || this.timer) && Date.now() < end) { if (this.timer) { clearTimeout(this.timer); this.timer = null; } if (this.busy) await this.busy; else await this.flushOnce(); }
  }
}

/** Lưu ra file JSON (máy dev / server có ổ đĩa, không dùng Mongo): ghi cả file ~0,5 giây sau thay đổi, đổi tên nguyên tử. */
export class FileSink {
  constructor(memdb, file) { this.db = memdb; this.file = file; this.t = null; this.status = { lastWriteAt: null, error: null, pending: 0 }; }
  push() { this.status.pending = 1; clearTimeout(this.t); this.t = setTimeout(() => this.write(), 500); this.t.unref?.(); }
  write() {
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const tmp = `${this.file}.tmp`; fs.writeFileSync(tmp, JSON.stringify({ version: 1, savedAt: Date.now(), tables: this.db.dump() }), { mode: 0o600 }); fs.renameSync(tmp, this.file); this.status = { lastWriteAt: Date.now(), error: null, pending: 0 }; }
    catch (e) { this.status.error = e.message; }
  }
  async flush() { if (this.status.pending) { clearTimeout(this.t); this.write(); } }
}

/** Đọc toàn bộ bảng từ database SQLite cũ (chuyển dữ liệu một lần). */
export async function readLegacySqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
  const out = {};
  for (const t of Object.keys(TABLES)) out[t] = names.has(t) ? db.prepare(`SELECT * FROM ${t}`).all().map(r => ({ ...r })) : [];
  db.close();
  return out;
}

/** Mở dữ liệu theo cấu hình. Trả về MemDB đã nạp, có db.store ('mongo' | 'file' | 'memory'), db.flush(), db.close(), db.status(). */
export async function openData(config, log = console) {
  const db = new MemDB();
  db.kind = config.mongodbUri ? 'mongo' : config.dbPath === ':memory:' ? 'memory' : 'file';
  db.flush = async () => {}; db.close = async () => {}; db.status = () => ({ kind: db.kind }); db.loadedAt = Date.now();
  if (db.kind === 'memory') return db;
  if (db.kind === 'file') {
    const file = config.dbPath.replace(/\.db$/i, '') + '.json';
    if (fs.existsSync(file)) { const j = JSON.parse(fs.readFileSync(file, 'utf8')); for (const [t, rows] of Object.entries(j.tables || {})) if (TABLES[t]) db.load(t, rows); }
    else if (fs.existsSync(config.dbPath) && /\.db$/i.test(config.dbPath)) { const old = await readLegacySqlite(config.dbPath); for (const [t, rows] of Object.entries(old)) db.load(t, rows); log.log(`[dữ liệu] Đã chuyển database SQLite cũ (${config.dbPath}) sang ${file}.`); }
    const sink = db.sink = new FileSink(db, file);
    if (!fs.existsSync(file)) sink.write();
    db.flush = () => sink.flush(); db.status = () => ({ kind: 'file', ...sink.status });
    return db;
  }
  // ---- MongoDB ----
  const { MongoClient } = await import('mongodb');
  let client;
  for (let k = 1; ; k++) {
    try { client = new MongoClient(config.mongodbUri, { serverSelectionTimeoutMS: 10000, appName: 'sysone-office' }); await client.connect(); break; }
    catch (e) { if (k >= 5) { log.error(`[mongo] Không kết nối được MongoDB: ${e.message}. Dừng server (không chạy khi chưa có dữ liệu).`); throw e; } log.warn(`[mongo] Kết nối lỗi (lần ${k}): ${e.message} — thử lại…`); await new Promise(r => setTimeout(r, 1500 * k)); }
  }
  const mdb = client.db(config.mongoDbName || 'sysone');
  const meta = mdb.collection('meta'), schema = await meta.findOne({ _id: 'schema' });
  if (!schema) await migrateIntoMongo(mdb, config, log);
  const now = Date.now();
  // dọn rác: phiên đã hết hạn, lượt đăng nhập sai quá 24 giờ (không cần giữ)
  await Promise.all([mdb.collection('sessions').deleteMany({ expires_at: { $lt: now } }), mdb.collection('login_failures').deleteMany({ ts: { $lt: now - 24 * 3600e3 } })]).catch(() => {});
  for (const [t, spec] of Object.entries(TABLES)) {
    let cur = mdb.collection(t).find(t === 'sessions' ? { expires_at: { $gt: now } } : t === 'login_failures' ? { ts: { $gt: now - 24 * 3600e3 } } : t === 'chat_messages' ? { ts: { $gt: now - 90 * 86400e3 } } : {});
    if (spec.keepInMemory) cur = cur.sort({ _id: -1 }).limit(spec.keepInMemory);
    db.load(t, (await cur.toArray()).map(d => fromDoc(spec, d)));
    if (spec.auto) { const last = await mdb.collection(t).find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).toArray(); if (last[0]) db.t[t].nextId = Math.max(db.t[t].nextId, last[0]._id + 1); }
  }
  // chỉ mục giúp xem / lọc trong Atlas (không bắt buộc)
  await Promise.all([mdb.collection('attendance').createIndex({ day: 1, code: 1 }), mdb.collection('chat_messages').createIndex({ channel: 1, ts: -1 }), mdb.collection('audit').createIndex({ ts: -1 })]).catch(() => {});
  const sink = db.sink = new MongoSink(mdb, log);
  db.flush = t => sink.flush(t); db.close = async () => { await sink.flush(); await client.close(); };
  db.status = () => ({ kind: 'mongo', ...sink.status });
  log.log(`[mongo] Đã nạp dữ liệu từ MongoDB: ${db.employees.count()} nhân viên, ${db.seats.count(r => r.owner_code)} chỗ có chủ, ${db.attendance.count()} lượt chấm công.`);
  return db;
}

/** Lần đầu dùng Mongo: chuyển dữ liệu cũ vào các collection — từ bản lưu nén (bản trước: snapshots/sysone) hoặc file SQLite. */
async function migrateIntoMongo(mdb, config, log) {
  let data = null, from = 'trống';
  const snapId = config.mongoSnapshotId || 'sysone', head = await mdb.collection('snapshots').findOne({ _id: snapId });
  if (head) {
    const { restore } = await import('./mongoSync.js');
    const tmp = path.join((await import('node:os')).tmpdir(), `sysone-migrate-${Date.now()}.db`);
    await restore({ get: id => mdb.collection('snapshots').findOne({ _id: id }) }, snapId, tmp);
    data = await readLegacySqlite(tmp); fs.rmSync(tmp, { force: true }); from = 'bản lưu nén cũ (snapshots)';
  } else if (config.dbPath && config.dbPath !== ':memory:' && fs.existsSync(config.dbPath)) { data = await readLegacySqlite(config.dbPath); from = config.dbPath; }
  if (data) for (const [t, rows] of Object.entries(data)) {
    const spec = TABLES[t], m = new MemDB(); m.load(t, rows);
    const docs = [...m.t[t].rows].map(([k, r]) => toDoc(spec, k, r));
    if (docs.length) await mdb.collection(t).bulkWrite(docs.map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })), { ordered: false });
  }
  await mdb.collection('meta').replaceOne({ _id: 'schema' }, { _id: 'schema', version: 1, migratedFrom: from, at: Date.now() }, { upsert: true });
  log.log(`[mongo] Lần đầu dùng các collection: đã chuyển dữ liệu từ ${from}.`);
}
