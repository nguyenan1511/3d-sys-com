// Sao lưu dữ liệu: file JSON chứa mọi bảng, đọc lại được, giữ đúng số bản, tên file hợp lệ; API chỉ CEO dùng được.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemDB } from '../server/memdb.js';
import { backupNow, listBackups, isBackupName, backupDir } from '../server/backup.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sysone-bk-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('sao lưu database', () => {
  it('chép đủ dữ liệu, file mở lại được', () => {
    const db = new MemDB();
    for (const c of ['1001', '1002', '1003']) db.employees.insert({ code: c, name: 'A', name_key: 'a', created_at: 1 });
    const dir = path.join(tmp, 'backups'), b = backupNow(db, dir);
    expect(isBackupName(b.name)).toBe(true);
    const copy = JSON.parse(fs.readFileSync(path.join(dir, b.name), 'utf8'));
    expect(copy.tables.employees.map(e => e.code)).toEqual(['1001', '1002', '1003']);
  });
  it('chỉ giữ số bản gần nhất', () => {
    const db = new MemDB();
    const dir = path.join(tmp, 'keep');
    for (let i = 0; i < 5; i++) backupNow(db, dir, 3);
    expect(listBackups(dir)).toHaveLength(3);
  });
  it('tên file lạ bị từ chối; DB trong bộ nhớ thì không có thư mục sao lưu', () => {
    for (const n of ['../sysone.db', 'sysone-2026-01-01-0200.db/../x', 'a.db', '.env']) expect(isBackupName(n)).toBe(false);
    expect(backupDir({ dbPath: ':memory:' })).toBe(null);
    expect(backupDir({ dbPath: '/data/sysone.db' })).toBe(path.join('/data', 'backups'));
  });
});
