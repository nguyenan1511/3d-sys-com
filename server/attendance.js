// Chấm công: mỗi nhân viên một bản ghi mỗi ngày (giờ Việt Nam): giờ vào, giờ ra. Đi muộn tính theo giờ vào ca (mặc định
// 08:00, cho phép trễ 5 phút; đổi bằng biến môi trường SHIFT_START / LATE_GRACE_MIN).
const TZ = 'Asia/Ho_Chi_Minh';
const SHIFT = () => process.env.SHIFT_START || '08:00';
const GRACE = () => Number(process.env.LATE_GRACE_MIN ?? 5);

export function migrateAttendance(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS attendance (
    code TEXT NOT NULL REFERENCES employees(code) ON DELETE CASCADE,
    day TEXT NOT NULL,
    check_in INTEGER NOT NULL,
    check_out INTEGER,
    PRIMARY KEY (code, day)
  );`);
}
/** Ngày (YYYY-MM-DD) và phút trong ngày theo giờ Việt Nam. */
export function vnDay(ts = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ts).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
export function view(r, emp) {
  if (!r) return null;
  const late = Math.max(0, vnDay(r.check_in).min - toMin(SHIFT()));
  return { code: r.code, day: r.day, checkIn: r.check_in, checkOut: r.check_out || null, lateMin: late > GRACE() ? late : 0, shift: SHIFT(),
    ...(emp ? { name: emp.name, display: `${emp.code}-${emp.name}`, department: emp.department } : {}) };
}
export function today(db, code) { return db.prepare('SELECT * FROM attendance WHERE code = ? AND day = ?').get(code, vnDay().day); }
export function checkIn(db, code) {
  const now = Date.now(), { day } = vnDay(now);
  db.prepare('INSERT INTO attendance (code, day, check_in) VALUES (?, ?, ?) ON CONFLICT(code, day) DO NOTHING').run(code, day, now);
  return today(db, code);
}
export function checkOut(db, code) {
  const r = today(db, code); if (!r) return null;
  db.prepare('UPDATE attendance SET check_out = ? WHERE code = ? AND day = ?').run(Date.now(), code, r.day);
  return today(db, code);
}
export function listDay(db, day = vnDay().day) {
  return db.prepare('SELECT a.*, e.name, e.department FROM attendance a JOIN employees e ON e.code = a.code WHERE a.day = ? ORDER BY a.check_in').all(day)
    .map(r => view(r, { code: r.code, name: r.name, department: r.department }));
}
export function history(db, code, n = 14) {
  return db.prepare('SELECT * FROM attendance WHERE code = ? ORDER BY day DESC LIMIT ?').all(code, n).map(r => view(r));
}

// ---------- bảng công theo tháng / năm ----------
/** Ngày làm việc trong tuần (0 = CN … 6 = T7), mặc định thứ 2 → thứ 6; đổi bằng WORK_DAYS="1-6" hoặc "1,2,3,4,5". */
export function workDays() {
  const s = String(process.env.WORK_DAYS || '1-5'), out = new Set();
  for (const part of s.split(',')) { const [a, b] = part.split('-').map(Number); if (Number.isInteger(a)) for (let d = a; d <= (Number.isInteger(b) ? b : a); d++) out.add(d % 7); }
  return out;
}
const pad = n => String(n).padStart(2, '0');
/** Các ngày trong tháng ym ('YYYY-MM'): [{ day, dow, work, past }] (past: đã qua hoặc hôm nay theo giờ VN). */
export function monthDays(ym) {
  const [y, m] = ym.split('-').map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), today = vnDay().day, wd = workDays(), out = [];
  for (let d = 1; d <= n; d++) { const day = `${y}-${pad(m)}-${pad(d)}`, dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); out.push({ day, dow, work: wd.has(dow), past: day <= today }); }
  return out;
}
/** Tổng hợp một người trong một khoảng ngày: số ngày đi làm, đi muộn, tổng phút muộn, tổng giờ, số ngày làm việc vắng mặt. */
export function summarize(records, days, since = '') {
  const byDay = new Map(records.map(r => [r.day, r])), today = vnDay().day, now = Date.now();
  let present = 0, late = 0, lateMin = 0, ms = 0, absent = 0;
  for (const d of days) {
    const r = byDay.get(d.day);
    if (r) { present++; if (r.lateMin) { late++; lateMin += r.lateMin; } ms += Math.max(0, (r.checkOut || (d.day === today ? now : r.checkIn)) - r.checkIn); }
    else if (d.work && d.past && d.day !== today && d.day >= since) absent++;   // (trước ngày vào công ty không tính vắng)
  }
  return { present, late, lateMin, hours: +(ms / 3600e3).toFixed(1), absent, workDays: days.filter(d => d.work && d.day >= since).length };
}
export function recordsBetween(db, from, to, code = null) {
  const rows = code ? db.prepare('SELECT a.*, e.name, e.department FROM attendance a JOIN employees e ON e.code = a.code WHERE a.code = ? AND a.day BETWEEN ? AND ? ORDER BY a.day').all(code, from, to)
    : db.prepare('SELECT a.*, e.name, e.department FROM attendance a JOIN employees e ON e.code = a.code WHERE a.day BETWEEN ? AND ? ORDER BY a.code, a.day').all(from, to);
  return rows.map(r => view(r));
}
/** Ngày bắt đầu tính công của một người: ngày tạo tài khoản (giờ VN). */
export function sinceOf(db, code) { const e = db.prepare('SELECT created_at FROM employees WHERE code = ?').get(code); return e ? vnDay(e.created_at).day : ''; }
/** Bảng công tháng của một người. */
export function personMonth(db, code, ym) {
  const days = monthDays(ym), recs = recordsBetween(db, days[0].day, days[days.length - 1].day, code), since = sinceOf(db, code);
  return { ym, days, since, records: recs, summary: summarize(recs, days, since) };
}
/** Bảng công năm của một người: tổng hợp từng tháng. */
export function personYear(db, code, y) {
  const recs = recordsBetween(db, `${y}-01-01`, `${y}-12-31`, code), since = sinceOf(db, code);
  const months = Array.from({ length: 12 }, (_, i) => { const ym = `${y}-${pad(i + 1)}`, days = monthDays(ym); return { ym, ...summarize(recs.filter(r => r.day.startsWith(ym)), days, since) }; });
  const all = months.reduce((a, m) => ({ present: a.present + m.present, late: a.late + m.late, lateMin: a.lateMin + m.lateMin, hours: +(a.hours + m.hours).toFixed(1), absent: a.absent + m.absent }), { present: 0, late: 0, lateMin: 0, hours: 0, absent: 0 });
  return { year: y, months, summary: all };
}
