// Lịch trong ngày của từng nhân viên, có sai lệch ngẫu nhiên nhỏ (lặp lại được theo seed).
import { parseTime, rng, hashStr, clamp } from '../core/util.js';

export const DEFAULTS = { shift: { arrive: '08:00', leave: '17:30' }, lunch: { start: '12:00', duration: 60, place: 'outside' }, breaks: 2, wc: 2, speed: 1.25, jitterMinutes: 6 };

export function normEmployee(e, defaults = DEFAULTS) {
  const d = { ...DEFAULTS, ...defaults };
  return {
    ...e,
    shift: { ...d.shift, ...(e.shift || {}) },
    lunch: { ...d.lunch, ...(e.lunch || {}) },
    meetings: e.meetings || [],
    breaks: e.breaks ?? d.breaks,
    wc: e.wc ?? d.wc,
    speed: e.speed ?? d.speed,
    jitter: (e.jitterMinutes ?? d.jitterMinutes) * 60,
    look: e.look || {}
  };
}

/** Kế hoạch một ngày: giờ đến, giờ về, danh sách hoạt động đã sắp xếp. */
export function dayPlan(emp, day = 0) {
  const r = rng(hashStr(`${emp.id}:${day}`));
  const J = emp.jitter;
  const arrive = parseTime(emp.shift.arrive) + clamp(r.normal() * J, -2.5 * J, 2.5 * J);
  const leave = parseTime(emp.shift.leave) + r.range(0, 2 * J);
  const acts = [];
  const lunchStart = parseTime(emp.lunch.start) + clamp(r.normal() * 120, -300, 300);
  const lunchDur = emp.lunch.duration * 60 + r.range(-300, 300);
  if (emp.lunch.duration > 0) acts.push({ type: 'lunch', t: lunchStart, dur: lunchDur, place: emp.lunch.place, fixed: true });
  for (const m of emp.meetings) {
    const t = parseTime(m.start);
    acts.push({ type: 'meeting', t: t - r.range(60, 150), end: t + m.duration * 60, room: m.room, title: m.title || 'Họp', fixed: true });
  }
  const lunchEnd = lunchStart + lunchDur;
  const windows = [[arrive + 2400, lunchStart - 1200], [lunchEnd + 1500, leave - 2400]];
  const pickT = k => { const w = windows[k % 2]; return w[1] > w[0] ? r.range(w[0], w[1]) : null; };
  for (let i = 0; i < emp.breaks; i++) { const t = pickT(i); if (t) acts.push({ type: 'pantry', t, dur: r.range(360, 720) }); }
  for (let i = 0; i < emp.wc; i++) { const t = pickT(i + 1); if (t) acts.push({ type: 'wc', t, dur: r.range(150, 330) }); }
  acts.sort((a, b) => a.t - b.t);
  // bỏ hoạt động tự do chồng lên họp/ăn trưa hoặc chồng nhau
  const out = [];
  const endOf = a => a.end ?? (a.t + (a.dur || 0));
  for (const a of acts) {
    if (!a.fixed && acts.some(b => b.fixed && a.t < endOf(b) + 300 && endOf(a) + 300 > b.t)) continue;
    const prev = out[out.length - 1];
    if (!a.fixed && prev && a.t < endOf(prev) + 600) continue;
    if (a.t >= leave - 600) continue;
    out.push(a);
  }
  return { arrive, leave, acts: out, seed: r };
}
