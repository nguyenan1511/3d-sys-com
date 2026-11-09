// API chấm công. Nhân viên tự chấm vào/ra cho chính mình; ai đăng nhập cũng xem được bảng trong ngày (bảng thông tin trên
// bàn làm việc); CEO xem bảng chấm công theo ngày (kèm danh sách chưa đến) và lịch sử của từng người.
import * as att from '../attendance.js';
import { audit } from '../db.js';
import { check, v, rateLimit } from '../http.js';
import { HttpError } from '../store.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/, YM = /^\d{4}-(0[1-9]|1[0-2])$/, YEAR = /^20\d{2}$/;
const thisYm = () => att.vnDay().day.slice(0, 7);

export function attendanceRoutes(api, { db, store, hub, guards: { needAuth, needEmployee, needAdmin } }) {
  const empOf = code => store.employee(code);
  const limit = rateLimit('attendance', { max: 12, windowMs: 60e3, methods: ['POST'] });

  /** Bảng chấm công hôm nay (giờ vào/ra từng người) — cho bảng thông tin trên bàn. */
  api.get('/attendance/today', needAuth, (_req, res) => res.json({ day: att.vnDay().day, list: att.listDay(db) }));
  /** Của tôi: hôm nay + 14 ngày gần nhất. */
  api.get('/attendance/me', needEmployee, (req, res) => res.json({ today: att.view(att.today(db, req.actor.code), empOf(req.actor.code)), history: att.history(db, req.actor.code) }));
  /** Chấm công vào ca (mỗi ngày một lần; gọi lại trả về bản ghi cũ, already=true). */
  api.post('/attendance/checkin', needEmployee, limit, (req, res) => {
    const before = att.today(db, req.actor.code), r = att.view(att.checkIn(db, req.actor.code), empOf(req.actor.code));
    if (!before) { hub.attendance(r); audit(db, req.actor.key, 'attendance.checkin', req.actor.code, { day: r.day, lateMin: r.lateMin }); }
    res.json({ ok: true, record: r, already: !!before });
  });
  /** Chấm công ra về (chấm lại thì cập nhật giờ ra mới nhất). */
  api.post('/attendance/checkout', needEmployee, limit, (req, res) => {
    const r = att.checkOut(db, req.actor.code);
    if (!r) throw new HttpError(409, 'Bạn chưa chấm công vào hôm nay.', { code: 'not_checked_in' });
    const rec = att.view(r, empOf(req.actor.code)); hub.attendance(rec); audit(db, req.actor.key, 'attendance.checkout', req.actor.code, { day: rec.day });
    res.json({ ok: true, record: rec });
  });
  /** Bảng công tháng của tôi (?ym=YYYY-MM, mặc định tháng này). */
  api.get('/attendance/me/month', needEmployee, (req, res) => {
    const { ym } = check(req.query, { ym: v.str({ pattern: YM, optional: true }) }, 'truy vấn');
    res.json(att.personMonth(db, req.actor.code, ym || thisYm()));
  });
  /** Bảng công năm của tôi (?year=YYYY): tổng hợp từng tháng. */
  api.get('/attendance/me/year', needEmployee, (req, res) => {
    const { year } = check(req.query, { year: v.str({ pattern: YEAR, optional: true }) }, 'truy vấn');
    res.json(att.personYear(db, req.actor.code, year || thisYm().slice(0, 4)));
  });
  /** CEO: bảng công tháng của mọi nhân viên (ma trận nhân viên × ngày) + tổng hợp. */
  api.get('/admin/attendance/month', needAdmin, (req, res) => {
    const { ym } = check(req.query, { ym: v.str({ pattern: YM, optional: true }) }, 'truy vấn');
    const m = ym || thisYm(), days = att.monthDays(m), recs = att.recordsBetween(db, days[0].day, days[days.length - 1].day);
    const emps = store.listEmployees(() => false).filter(e => e.status === 'active' || recs.some(r => r.code === e.code));
    res.json({ ym: m, days, employees: emps.map(e => { const mine = recs.filter(r => r.code === e.code); const since = att.sinceOf(db, e.code); return { code: e.code, display: e.display, department: e.department, since, records: mine, summary: att.summarize(mine, days, since) }; }) });
  });
  /** CEO: bảng công năm của mọi nhân viên (nhân viên × 12 tháng). */
  api.get('/admin/attendance/year', needAdmin, (req, res) => {
    const { year } = check(req.query, { year: v.str({ pattern: YEAR, optional: true }) }, 'truy vấn');
    const y = year || thisYm().slice(0, 4);
    res.json({ year: y, employees: store.listEmployees(() => false).map(e => ({ code: e.code, display: e.display, department: e.department, ...att.personYear(db, e.code, y) })) });
  });
  /** CEO: bảng công tháng của một nhân viên. */
  api.get('/admin/attendance/:code/month', needAdmin, (req, res) => {
    const { code, ym } = check({ ...req.params, ...req.query }, { code: v.str({ pattern: /^\d{4}$/ }), ym: v.str({ pattern: YM, optional: true }) }, 'yêu cầu');
    if (!empOf(code)) throw new HttpError(404, `Không có nhân viên ${code}.`, { code: 'not_found' });
    res.json({ code, display: `${code}-${empOf(code).name}`, ...att.personMonth(db, code, ym || thisYm()) });
  });
  /** CEO: bảng chấm công một ngày (mặc định hôm nay) + ai chưa đến. */
  api.get('/admin/attendance', needAdmin, (req, res) => {
    const { day } = check(req.query, { day: v.str({ pattern: DAY, optional: true }) }, 'truy vấn');
    const d = day || att.vnDay().day, list = att.listDay(db, d), present = new Set(list.map(r => r.code));
    const absent = store.listEmployees(() => false).filter(e => e.status === 'active' && !present.has(e.code)).map(e => ({ code: e.code, display: e.display, department: e.department }));
    res.json({ day: d, shift: process.env.SHIFT_START || '08:00', list, absent });
  });
  /** CEO: lịch sử chấm công của một nhân viên. */
  api.get('/admin/attendance/:code', needAdmin, (req, res) => {
    const { code } = check(req.params, { code: v.str({ pattern: /^\d{4}$/ }) }, 'đường dẫn');
    if (!empOf(code)) throw new HttpError(404, `Không có nhân viên ${code}.`, { code: 'not_found' });
    res.json({ code, history: att.history(db, code, 60) });
  });
}
