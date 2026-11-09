// Sao lưu database: VACUUM INTO ra file riêng đọc lại được, giữ đúng số bản, tên file hợp lệ; API chỉ CEO dùng được.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupNow, listBackups, isBackupName, backupDir } from '../server/backup.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sysone-bk-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('sao lưu database', () => {
  it('chép đủ dữ liệu, file mở lại được', () => {
    const db = new DatabaseSync(path.join(tmp, 'a.db'));
    db.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1), (2), (3);');
    const dir = path.join(tmp, 'backups'), b = backupNow(db, dir);
    expect(isBackupName(b.name)).toBe(true);
    const copy = new DatabaseSync(path.join(dir, b.name));
    expect(copy.prepare('SELECT COUNT(*) AS n FROM t').get().n).toBe(3);
    copy.close(); db.close();
  });
  it('chỉ giữ số bản gần nhất', () => {
    const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE t (x)');
    const dir = path.join(tmp, 'keep');
    for (let i = 0; i < 5; i++) backupNow(db, dir, 3);
    expect(listBackups(dir)).toHaveLength(3);
    db.close();
  });
  it('tên file lạ bị từ chối; DB trong bộ nhớ thì không có thư mục sao lưu', () => {
    for (const n of ['../sysone.db', 'sysone-2026-01-01-0200.db/../x', 'a.db', '.env']) expect(isBackupName(n)).toBe(false);
    expect(backupDir({ dbPath: ':memory:' })).toBe(null);
    expect(backupDir({ dbPath: '/data/sysone.db' })).toBe(path.join('/data', 'backups'));
  });
});
