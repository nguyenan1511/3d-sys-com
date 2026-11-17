// Tự chấm công theo trạng thái online (server/attendance.js autoIn / autoOut).
import { describe, it, expect } from 'vitest';
import { autoIn, autoOut, today, vnDay } from '../server/attendance.js';

/** Bảng attendance tối giản (khoá code|day) giống server/memdb.js. */
function fakeDb() {
  const rows = new Map(), key = r => `${r.code}|${r.day}`;
  return { attendance: {
    has: k => rows.has(k), get: k => rows.get(k) ? { ...rows.get(k) } : undefined,
    insert: r => { rows.set(key(r), { ...r }); }, update: (k, patch) => { Object.assign(rows.get(k), patch); },
    by: (f, v) => [...rows.values()].filter(r => r[f] === v).map(r => ({ ...r })),
  } };
}

describe('tự chấm công khi online', () => {
  it('online lần đầu trong ngày: tạo giờ vào; lần sau không đổi giờ vào', () => {
    const db = fakeDb(), t0 = Date.now();
    const a = autoIn(db, '1234', t0);
    expect(a.created).toBe(true); expect(a.rec.check_in).toBe(t0); expect(a.rec.check_out).toBeNull();
    const b = autoIn(db, '1234', t0 + 60e3);
    expect(b.created).toBeFalsy(); expect(b.reopened).toBeFalsy(); expect(b.rec.check_in).toBe(t0);
  });
  it('offline hẳn: giờ ra = lúc đó; online lại: xoá giờ ra (đang làm tiếp)', () => {
    const db = fakeDb(), t0 = Date.now();
    autoIn(db, '1234', t0);
    const out = autoOut(db, '1234', t0 + 3600e3);
    expect(out.check_out).toBe(t0 + 3600e3);
    const back = autoIn(db, '1234', t0 + 4000e3);
    expect(back.reopened).toBe(true); expect(back.rec.check_out).toBeNull(); expect(back.rec.check_in).toBe(t0);
  });
  it('chưa từng online hôm nay thì offline không tạo bản ghi', () => {
    const db = fakeDb();
    expect(autoOut(db, '1234')).toBeNull(); expect(today(db, '1234')).toBeUndefined();
  });
  it('online qua nửa đêm: đóng bản ghi hôm trước lúc 0:00, mở bản ghi hôm nay', () => {
    const db = fakeDb(), now = Date.now(), { day, min } = vnDay(now), midnight = now - min * 60e3 - (now % 60e3);
    db.attendance.insert({ code: '1234', day: '2000-01-01', check_in: midnight - 5 * 3600e3, check_out: null });
    const r = autoIn(db, '1234', now);
    expect(r.created).toBe(true); expect(r.rec.day).toBe(day);
    expect(db.attendance.get('1234|2000-01-01').check_out).toBe(midnight);
  });
});
