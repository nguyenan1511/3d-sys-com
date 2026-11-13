// Chấm công: mỗi nhân viên một bản ghi mỗi ngày (giờ Việt Nam): giờ vào, giờ ra. Đi muộn tính theo giờ vào ca (mặc định
// 08:00, cho phép trễ 5 phút; đổi bằng biến môi trường SHIFT_START / LATE_GRACE_MIN).
const TZ = 'Asia/Ho_Chi_Minh';
const SHIFT = () => process.env.SHIFT_START || '08:00';
const GRACE = () => Number(process.env.LATE_GRACE_MIN ?? 5);

// Bảng attendance: { code, day, check_in, check_out } — khoá (code, day) (server/memdb.js). Xoá nhân viên thì xoá theo (store.js).
const byDayAsc = (a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : 0;
/** Ngày (YYYY-MM-DD) và phút trong ngày theo giờ Việt Nam. */
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); // (tạo mới mỗi lần rất tốn CPU)
export function vnDay(ts = Date.now()) {
  const p = Object.fromEntries(FMT.formatToParts(ts).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
const toMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
export function view(r, emp) {
  if (!r) return null;
  const late = Math.max(0, vnDay(r.check_in).min - toMin(SHIFT()));
  return { code: r.code, day: r.day, checkIn: r.check_in, checkOut: r.check_out || null, lateMin: late > GRACE() ? late : 0, shift: SHIFT(),
    ...(emp ? { name: emp.name, display: `${emp.code}-${emp.name}`, department: emp.department } : {}) };
}
export function today(db, code) { return db.attendance.get(`${code}|${vnDay().day}`); }
export function checkIn(db, code) {
  const now = Date.now(), { day } = vnDay(now);
  if (!db.attendance.has(`${code}|${day}`)) db.attendance.insert({ code, day, check_in: now, check_out: null });
  return today(db, code);
}
export function checkOut(db, code) {
  const r = today(db, code); if (!r) return null;
  db.attendance.update(`${code}|${r.day}`, { check_out: Date.now() });
  return today(db, code);
}
export function listDay(db, day = vnDay().day) {
  return db.attendance.by('day', day).sort((a, b) => a.check_in - b.check_in)
    .map(r => [r, db.employees.get(r.code)]).filter(([, e]) => e).map(([r, e]) => view(r, { code: r.code, name: e.name, department: e.department }));
}
export function history(db, code, n = 14) {
  return db.attendance.by('code', code).sort(byDayAsc).reverse().slice(0, n).map(r => view(r));
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
  const inRange = r => r.day >= from && r.day <= to && db.employees.has(r.code);
  const rows = code ? db.attendance.by('code', code).filter(inRange).sort(byDayAsc)
    : db.attendance.where(inRange).sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : byDayAsc(a, b));
  return rows.map(r => view(r));
}
/** Ngày bắt đầu tính công của một người: ngày tạo tài khoản (giờ VN). */
export function sinceOf(db, code) { const e = db.employees.get(code); return e ? vnDay(e.created_at).day : ''; }
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
