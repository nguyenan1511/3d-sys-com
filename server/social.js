// Chat nội bộ và loa nhạc của công ty.
// Chat: kênh "Toàn công ty", kênh của từng phòng ban (src/shared/departments.js), nhắn riêng 1-1. Lưu trong SQLite
//   (bảng chat_messages), gửi tức thời qua WebSocket. Kênh phòng ban: chỉ thành viên phòng đó (theo hồ sơ nhân viên hoặc
//   phòng của bàn mình nhận) và CEO đọc/gửi được. Nhắn riêng: chỉ hai người trong cuộc thấy.
// Loa: dán link YouTube ở góc âm nhạc → cả công ty nghe, video chiếu lên TV phòng giải trí. Chỉ CEO và người được CEO cấp
//   quyền mới phát/điều khiển; trạng thái lưu ở world_state('music'), quyền ở employees.can_music.
import { DEPARTMENTS, findDepartment, departmentOfDesk } from '../src/shared/departments.js';

const MAX_LEN = 500, HISTORY = 80;

export function migrateSocial(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    sender TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    body TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_channel_ts ON chat_messages(channel, id);`);
  const cols = db.prepare('PRAGMA table_info(employees)').all().map(c => c.name);
  if (!cols.includes('can_music')) db.exec('ALTER TABLE employees ADD COLUMN can_music INTEGER NOT NULL DEFAULT 0');
}

/** Phòng ban của một người (id phòng) hoặc null. */
export function deptIdOf(store, actor) {
  if (actor.kind === 'admin') return 'bgd';
  const e = store.employee(actor.code); if (!e) return null;
  const d = findDepartment(e.department); if (d) return d.id;
  const seat = store.seatOf(actor.code); return seat ? departmentOfDesk(seat.desk_id)?.id || null : null;
}
/** Kênh nhắn riêng giữa hai khoá phiên (thứ tự cố định). */
export const dmChannel = (a, b) => 'dm:' + [a, b].sort().join('|');
/** Người này có được đọc/gửi ở kênh không. */
export function canUseChannel(store, actor, key, channel) {
  if (channel === 'all') return true;
  if (channel.startsWith('dept:')) { const id = channel.slice(5); return DEPARTMENTS.some(d => d.id === id) && (actor.kind === 'admin' || deptIdOf(store, actor) === id); }
  if (channel.startsWith('dm:')) return channel.slice(3).split('|').includes(key);
  return false;
}
export function history(store, channel, before = null) {
  const rows = before ? store.db.prepare('SELECT * FROM chat_messages WHERE channel = ? AND id < ? ORDER BY id DESC LIMIT ?').all(channel, before, HISTORY)
    : store.db.prepare('SELECT * FROM chat_messages WHERE channel = ? ORDER BY id DESC LIMIT ?').all(channel, HISTORY);
  return rows.reverse().map(view);
}
const view = r => ({ id: r.id, channel: r.channel, from: r.sender, name: r.sender_name, body: r.body, ts: r.ts });
/** Các kênh nhắn riêng mà người này đã có tin. */
export function myDms(store, key) {
  return store.db.prepare("SELECT channel, MAX(id) AS last FROM chat_messages WHERE channel LIKE 'dm:%' AND (channel LIKE ? OR channel LIKE ?) GROUP BY channel ORDER BY last DESC LIMIT 30")
    .all(`dm:${key}|%`, `dm:%|${key}`).map(r => r.channel);
}
export function postMessage(store, actor, key, name, channel, body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
  if (!text) return null;
  if (!canUseChannel(store, actor, key, channel)) return null;
  const ts = Date.now();
  const r = store.db.prepare('INSERT INTO chat_messages (channel, sender, sender_name, body, ts) VALUES (?, ?, ?, ?, ?)').run(channel, key, name, text, ts);
  return { id: Number(r.lastInsertRowid), channel, from: key, name, body: text, ts };
}

// ---------- loa: phát nhạc từ YouTube cho cả công ty ----------
// Trạng thái chung (world_state 'music'): { on, videoId, title, by, startedAt, paused, position, updatedAt }.
// Vị trí hiện tại = paused ? position : (giờ server − startedAt) / 1000 — mọi máy tự tính và khớp theo giờ server.
export function canMusic(store, actor) {
  if (actor.kind === 'admin') return true;
  return !!store.db.prepare('SELECT can_music FROM employees WHERE code = ?').get(actor.code)?.can_music;
}
const OFF = { on: false, videoId: '', title: '', by: '', startedAt: 0, paused: false, position: 0, updatedAt: 0 };
export function musicState(store) {
  const r = store.db.prepare("SELECT value FROM world_state WHERE key = 'music'").get();
  let st; try { st = r ? JSON.parse(r.value) : null; } catch { st = null; }
  if (!st || typeof st.videoId !== 'string') st = { ...OFF };            // (trạng thái kiểu cũ — kênh nhạc tự tạo — coi như đang tắt)
  return { ...st, serverNow: Date.now() };
}
function saveMusic(store, key, st) {
  const { serverNow: _drop, ...keep } = st; void _drop;
  store.db.prepare('INSERT INTO world_state (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .run('music', JSON.stringify({ ...keep, updatedAt: Date.now() }), Date.now(), key);
  return musicState(store);
}
/** Mã video (11 ký tự) từ link YouTube: youtube.com/watch?v=, youtu.be/, /shorts/, /embed/, /live/, music.youtube.com; null nếu không hợp lệ. */
export function youtubeId(input) {
  const s = String(input || '').trim(); if (!s || s.length > 500) return null;
  if (/^[\w-]{11}$/.test(s)) return s;
  let u; try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/); if (m) id = m[2]; }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}
/** Tên video qua oEmbed của YouTube (tối đa 2,5 giây; lỗi mạng thì để trống). */
export async function youtubeTitle(id) {
  if (process.env.VITEST || process.env.NO_NET) return '';           // (kiểm thử: không gọi mạng)
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`, { signal: ctl.signal });
    clearTimeout(t); if (!r.ok) return '';
    const j = await r.json(); return String(j.title || '').slice(0, 200);
  } catch { return ''; }
}
export function playMusic(store, key, by, videoId, title) {
  const now = Date.now();
  const st = saveMusic(store, key, { on: true, videoId, title, by, startedAt: now, paused: false, position: 0 });
  // 10 bài gần nhất (gợi ý phát lại ở góc âm nhạc)
  const recent = recentMusic(store).filter(x => x.videoId !== videoId); recent.unshift({ videoId, title, by, at: now });
  store.db.prepare('INSERT INTO world_state (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .run('music_recent', JSON.stringify(recent.slice(0, 10)), now, key);
  return st;
}
export function recentMusic(store) {
  const r = store.db.prepare("SELECT value FROM world_state WHERE key = 'music_recent'").get();
  try { return r ? JSON.parse(r.value) : []; } catch { return []; }
}
/** Điều khiển: pause | resume | seek (position giây) | stop. */
export function controlMusic(store, key, by, action, position) {
  const st = musicState(store), now = Date.now();
  if (!st.on && action !== 'stop') return null;
  const pos = st.paused ? st.position : Math.max(0, (now - st.startedAt) / 1000);
  if (action === 'pause') return saveMusic(store, key, { ...st, paused: true, position: pos, by });
  if (action === 'resume') return saveMusic(store, key, { ...st, paused: false, startedAt: now - st.position * 1000, by });
  if (action === 'seek') { const p = Math.max(0, Number(position) || 0); return saveMusic(store, key, st.paused ? { ...st, position: p, by } : { ...st, startedAt: now - p * 1000, position: p, by }); }
  if (action === 'stop') return saveMusic(store, key, { ...OFF, by });
  return null;
}
export function setMusicPermission(store, code, allow) {
  const r = store.db.prepare('UPDATE employees SET can_music = ? WHERE code = ?').run(allow ? 1 : 0, code);
  return r.changes === 1;
}
export function musicPermissions(store) {
  return store.db.prepare('SELECT code FROM employees WHERE can_music = 1').all().map(r => r.code);
}
