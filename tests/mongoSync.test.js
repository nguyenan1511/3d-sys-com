// Lớp dữ liệu (server/memdb.js): giao dịch trả lại như cũ khi lỗi, ràng buộc mỗi người một chỗ / chế độ, ghi lên Mongo theo
// lô (gộp thay đổi, thử lại khi lỗi, cột JSON lưu dạng object), chuyển dữ liệu SQLite cũ / bản lưu nén cũ sang một lần.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MemDB, MongoSink, openData, readLegacySqlite } from '../server/memdb.js';
import { restore } from '../server/mongoSync.js';

const quiet = { log() {}, warn() {}, error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'memdb-'));
const emp = (code, extra = {}) => ({ code, name: 'An', name_key: 'an', department: '', status: 'active', can_move: 0, created_at: 1, ...extra });
/** Mongo giả: các collection là Map, ghi bằng bulkWrite như driver thật; fail: số lần ghi lỗi trước khi được. */
const fakeMongo = (fail = 0) => { const cols = new Map(); let calls = 0; return { cols, get calls() { return calls; }, collection(n) { if (!cols.has(n)) cols.set(n, new Map()); const m = cols.get(n); return { bulkWrite: async ops => { calls++; if (fail-- > 0) throw new Error('mạng lỗi'); for (const o of ops) { if (o.replaceOne) m.set(o.replaceOne.filter._id, structuredClone(o.replaceOne.replacement)); else m.delete(o.deleteOne.filter._id); } } }; } }; };

describe('lớp dữ liệu', () => {
  it('giao dịch: lỗi giữa chừng thì trả lại mọi thay đổi và không gửi gì lên nơi lưu', () => {
    const db = new MemDB(), sent = []; db.sink = { push: ops => sent.push(...ops) };
    db.employees.insert(emp('1001'));
    expect(() => db.tx(() => { db.employees.update('1001', { name: 'Bình' }); db.employees.insert(emp('1002')); throw new Error('dừng'); })).toThrow('dừng');
    expect(db.employees.get('1001').name).toBe('An');
    expect(db.employees.has('1002')).toBe(false);
    expect(sent.map(o => o.key)).toEqual(['1001']);                       // (chỉ lần thêm 1001 trước giao dịch)
    db.tx(() => { db.employees.update('1001', { name: 'Chi' }); db.employees.update('1001', { department: 'IT' }); });
    expect(sent.at(-1)).toMatchObject({ table: 'employees', key: '1001', row: { name: 'Chi', department: 'IT' } });   // (gộp thành một)
  });
  it('mỗi người tối đa một chỗ ở mỗi chế độ (Office T…, Real SYS R…); bản sao đọc ra không làm đổi dữ liệu', () => {
    const db = new MemDB();
    for (const id of ['T1-01', 'T1-02', 'R1-01']) db.seats.insert({ desk_id: id, owner_code: null, locked: 0, equipment: null, in_layout: 1 });
    db.seats.update('T1-01', { owner_code: '2000' });
    expect(() => db.seats.update('T1-02', { owner_code: '2000' })).toThrow('UNIQUE');
    db.seats.update('R1-01', { owner_code: '2000' });
    expect(db.seats.by('owner_code', '2000').map(r => r.desk_id).sort()).toEqual(['R1-01', 'T1-01']);
    const r = db.seats.get('T1-01'); r.owner_code = 'x';
    expect(db.seats.get('T1-01').owner_code).toBe('2000');
  });
  it('ghi lên Mongo: cột JSON thành object, mạng lỗi thì giữ hàng đợi và thử lại, xoá dòng thì xoá tài liệu', async () => {
    const mongo = fakeMongo(1), db = new MemDB(); db.sink = new MongoSink(mongo, quiet);
    db.employees.insert(emp('1001', { look: '{"model":"mo-toy"}' }));
    db.chat_messages.insert({ channel: 'all', sender: 'a', sender_name: 'A', body: 'chào', ts: 1 });
    db.sink.retry = 0; await db.sink.flush(5000);
    expect(mongo.cols.get('employees').get('1001')).toMatchObject({ _id: '1001', look: { model: 'mo-toy' } });
    expect(mongo.cols.get('chat_messages').get(1)).toMatchObject({ _id: 1, body: 'chào' });
    expect(mongo.calls).toBeGreaterThanOrEqual(2);                          // (lần đầu lỗi, lần sau được)
    db.employees.del('1001'); await db.sink.flush(5000);
    expect(mongo.cols.get('employees').has('1001')).toBe(false);
  });
  it('máy dev: lần đầu tự chuyển database SQLite cũ sang file JSON; mở lại đọc từ JSON', async () => {
    const dir = tmp(), file = path.join(dir, 'sysone.db');
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE employees (code TEXT PRIMARY KEY, name TEXT, name_key TEXT, department TEXT, status TEXT, can_move INTEGER, created_at INTEGER, last_seen INTEGER, look TEXT);
      INSERT INTO employees VALUES ('1151', 'An', 'an', 'IT', 'active', 0, 1, 2, NULL);
      CREATE TABLE attendance (code TEXT, day TEXT, check_in INTEGER, check_out INTEGER);
      INSERT INTO attendance VALUES ('1151', '2026-11-12', 100, NULL);`);
    old.close();
    const db = await openData({ dbPath: file }, quiet);
    expect(db.kind).toBe('file');
    expect(db.employees.get('1151')).toMatchObject({ name: 'An', department: 'IT' });
    expect(db.attendance.get('1151|2026-11-12').check_in).toBe(100);
    db.employees.update('1151', { department: 'HR' }); await db.flush();
    const again = await openData({ dbPath: file }, quiet);
    expect(again.employees.get('1151').department).toBe('HR');
    expect((await readLegacySqlite(file)).employees[0].department).toBe('IT');   // (file SQLite cũ không bị đụng tới)
  });
  it('đọc được bản lưu nén kiểu cũ (để chuyển sang các collection)', async () => {
    const dir = tmp(), src = path.join(dir, 'a.db'), d = new DatabaseSync(src); d.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('một')"); d.close();
    const gz = zlib.gzipSync(fs.readFileSync(src)), h = crypto.createHash('sha256').update(gz).digest('hex');
    const docs = new Map([['x', { _id: 'x', ver: 'v1', parts: 1, sha: h, at: 5 }], ['x:v1:0', { _id: 'x:v1:0', data: gz }]]);
    const out = path.join(dir, 'b.db');
    expect(await restore({ get: async id => docs.get(id) ?? null }, 'x', out)).toMatchObject({ ver: 'v1' });
    const c = new DatabaseSync(out); expect(c.prepare('SELECT v FROM t').get().v).toBe('một'); c.close();
    docs.get('x:v1:0').data = Buffer.from('hỏng');
    await expect(restore({ get: async id => docs.get(id) ?? null }, 'x', out)).rejects.toThrow('hỏng');
  });
});
