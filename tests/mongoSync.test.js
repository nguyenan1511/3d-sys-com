// Lưu database lên MongoDB (server/mongoSync.js) — dùng kho giả trong bộ nhớ thay Mongo thật.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { push, restore, initSync } from '../server/mongoSync.js';

const fakeStore = () => { const m = new Map(); return { m, get: async id => m.get(id) ?? null, put: async d => { m.set(d._id, structuredClone(d)); }, del: async ids => { for (const i of ids) m.delete(i); } }; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mongosync-'));
const quiet = { log() {}, warn() {}, error() {} };

describe('đồng bộ database lên MongoDB', () => {
  it('đẩy lên rồi tải về đúng dữ liệu; không đổi thì không đẩy; xoá mảnh của bản cũ', async () => {
    const dir = tmp(), file = path.join(dir, 'a.db'), st = fakeStore();
    const db = new DatabaseSync(file); db.exec('CREATE TABLE t (v TEXT); INSERT INTO t VALUES (\'một\')');
    const r1 = await push(st, 'x', db, file);
    expect((await push(st, 'x', db, file, r1)).skipped).toBe(true);
    db.exec("INSERT INTO t VALUES ('hai')");
    const r2 = await push(st, 'x', db, file, r1);
    expect(r2.ver).not.toBe(r1.ver);
    expect([...st.m.keys()].sort()).toEqual(['x', `x:${r2.ver}:0`]);
    db.close();
    const out = path.join(dir, 'moi', 'b.db');
    expect((await restore(st, 'x', out)).ver).toBe(r2.ver);
    const db2 = new DatabaseSync(out);
    expect(db2.prepare('SELECT v FROM t ORDER BY rowid').all().map(r => r.v)).toEqual(['một', 'hai']);
    db2.close();
    expect(await restore(fakeStore(), 'x', out)).toBeNull();               // (Mongo chưa có bản lưu)
    st.m.get(`x:${r2.ver}:0`).data[100] ^= 0xff;                           // (bản lưu hỏng: không ghi đè file trên máy)
    await expect(restore(st, 'x', out)).rejects.toThrow('hỏng');
  });

  it('khởi động: tải bản lưu trước khi mở database; có thay đổi thì tự đẩy; tắt server thì đẩy lần cuối', async () => {
    const dir = tmp(), st = fakeStore();
    const src = path.join(dir, 'src.db'), d0 = new DatabaseSync(src); d0.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('cũ')");
    await push(st, 'sysone', d0, src); d0.close();
    const file = path.join(dir, 'run.db');
    const sync = await initSync({ dbPath: file, mongodbUri: 'x' }, { store: st, log: quiet, delay: 0, tick: 20 });
    expect(sync.status.restoredAt).toBeGreaterThan(0);
    const db = new DatabaseSync(file); sync.start(db);
    expect(db.prepare('SELECT v FROM t').get().v).toBe('cũ');
    db.exec("INSERT INTO t VALUES ('mới')");
    await expect.poll(() => sync.status.lastPushAt, { timeout: 3000 }).toBeGreaterThan(0);
    db.exec("INSERT INTO t VALUES ('lúc tắt')");
    await sync.flush(); sync.stop(); db.close();
    const check = path.join(dir, 'check.db'); await restore(st, 'sysone', check);
    const c = new DatabaseSync(check);
    expect(c.prepare('SELECT v FROM t ORDER BY rowid').all().map(r => r.v)).toEqual(['cũ', 'mới', 'lúc tắt']);
    c.close();
  });

  it('không có MONGODB_URI (hoặc đang chạy dev): không làm gì', async () => {
    const s = await initSync({ dbPath: '/tmp/x.db', mongodbUri: '', production: true }, { log: quiet });
    expect(s.status.enabled).toBe(false);
    const d = await initSync({ dbPath: '/tmp/x.db', mongodbUri: 'mongodb://x', production: false }, { log: quiet });
    expect(d.status.enabled).toBe(false);
  });
});
