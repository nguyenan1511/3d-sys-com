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
  owner_code TEXT UNIQUE REFERENCES employees(code) ON DELETE SET NULL,
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
  // nâng cấp DB cũ: cột tạo hình nhân vật
  if (!db.prepare('PRAGMA table_info(employees)').all().some(c => c.name === 'look')) db.exec('ALTER TABLE employees ADD COLUMN look TEXT');
  /** Chạy fn trong transaction ghi (BEGIN IMMEDIATE), tự rollback khi lỗi. */
  db.tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  return db;
}

export function audit(db, actor, action, target = null, detail = null) {
  db.prepare('INSERT INTO audit (ts, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)')
    .run(Date.now(), actor, action, target, detail == null ? null : JSON.stringify(detail));
}
