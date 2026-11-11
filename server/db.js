// SQLite (node:sqlite có sẵn trong Node 22+). Bảng: employees, seats, admins, sessions, login_failures, audit.
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS employees (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  can_move INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS seats (
  desk_id TEXT PRIMARY KEY,
  owner_code TEXT REFERENCES employees(code) ON DELETE SET NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  equipment TEXT,
  in_layout INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS admins (
  username TEXT PRIMARY KEY,
  pass_hash TEXT NOT NULL,
  is_initial INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('employee','admin')),
  subject TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_subject ON sessions(kind, subject);
CREATE TABLE IF NOT EXISTS login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_failures_key ON login_failures(scope, key, ts);
CREATE TABLE IF NOT EXISTS world_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrateSeatModes(db);
  // nâng cấp DB cũ: cột tạo hình nhân vật
  if (!db.prepare('PRAGMA table_info(employees)').all().some(c => c.name === 'look')) db.exec('ALTER TABLE employees ADD COLUMN look TEXT');
  /** Chạy fn trong transaction ghi (BEGIN IMMEDIATE), tự rollback khi lỗi. */
  db.tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  return db;
}

/**
 * Hai chế độ văn phòng (src/core/mode.js): mỗi người có tối đa MỘT chỗ ở mỗi chế độ — bàn Real SYS mã R…, bàn Office
 * SYS các mã còn lại. DB cũ ràng buộc owner_code UNIQUE trên cả bảng: dựng lại bảng (giữ nguyên dữ liệu) rồi thay bằng
 * hai chỉ mục duy nhất theo chế độ.
 */
function migrateSeatModes(db) {
  const old = db.prepare('PRAGMA index_list(seats)').all().some(i => i.origin === 'u');
  if (old) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE seats_new (desk_id TEXT PRIMARY KEY, owner_code TEXT REFERENCES employees(code) ON DELETE SET NULL, locked INTEGER NOT NULL DEFAULT 0, equipment TEXT, in_layout INTEGER NOT NULL DEFAULT 1, updated_at INTEGER);
      INSERT INTO seats_new (desk_id, owner_code, locked, equipment, in_layout, updated_at) SELECT desk_id, owner_code, locked, equipment, in_layout, updated_at FROM seats;
      DROP TABLE seats; ALTER TABLE seats_new RENAME TO seats; COMMIT;`);
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS seats_owner_office ON seats(owner_code) WHERE owner_code IS NOT NULL AND desk_id NOT LIKE 'R%';
    CREATE UNIQUE INDEX IF NOT EXISTS seats_owner_real ON seats(owner_code) WHERE owner_code IS NOT NULL AND desk_id LIKE 'R%';`);
}

export function audit(db, actor, action, target = null, detail = null) {
  db.prepare('INSERT INTO audit (ts, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)')
    .run(Date.now(), actor, action, target, detail == null ? null : JSON.stringify(detail));
}
