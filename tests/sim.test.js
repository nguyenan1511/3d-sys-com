import { describe, it, expect } from 'vitest';
import { setup, fakeStaff } from './helpers.js';
import { Simulation, ST } from '../src/sim/sim.js';
import { validateStaff } from '../src/model/staff.js';
import { parseTime } from '../src/core/util.js';

function runDay(sim, until = '20:00', h = 0.2) {
  const samples = [];
  const end = parseTime(until);
  const last = new Map();
  let stuck = [];
  let overlapSeats = 0;
  while (sim.t < end) {
    sim.step(h);
    const sec = Math.floor(sim.t);
    if (sec % 30 === 0 && Math.abs(sim.t - sec) < h) {
      // không ai ngồi chồng ghế
      const seats = new Map();
      for (const a of sim.agents) if (a.visible && a.sit > 0.9 && a.seat) { if (seats.has(a.seat.id)) overlapSeats++; seats.set(a.seat.id, a.id); }
      // đang đi mà không nhúc nhích quá 90 s mô phỏng
      for (const a of sim.agents) {
        if (!a.path) { last.delete(a.id); continue; }
        const p = last.get(a.id);
        if (!p || Math.hypot(p.x - a.x, p.z - a.z) > 0.05) last.set(a.id, { x: a.x, z: a.z, t: sim.t });
        else if (sim.t - p.t > 90) stuck.push(`${a.id} kẹt tại ${a.x.toFixed(2)},${a.z.toFixed(2)} tầng ${a.f} (${a.waiting || a.state})`);
      }
      samples.push({ t: sim.t, states: sim.agents.map(a => a.state) });
    }
  }
  return { samples, stuck: [...new Set(stuck)], overlapSeats };
}

describe('mô phỏng một ngày', () => {
  it('36 nhân viên mặc định: ai cũng đến bàn, không kẹt, cuối ngày về hết', () => {
    const { model, nav, staff } = setup();
    expect(staff.errors).toEqual([]);
    const sim = new Simulation(model, nav, staff, { start: '07:00' });
    const at = parseTime('09:00');
    const r = runDay(sim);
    expect(sim.problems).toEqual([]);
    expect(r.stuck).toEqual([]);
    expect(r.overlapSeats).toBe(0);
    // 9h sáng: ai đến trước 8h45 phải đang ở công ty (làm việc hoặc họp...)
    const s9 = r.samples.find(s => s.t >= at);
    sim.agents.forEach((a, i) => { if (a.plan.arrive < at - 900) expect([ST.OUTSIDE, ST.ARRIVING, ST.GONE], a.id).not.toContain(s9.states[i]); });
    expect(sim.agents.every(a => a.state === ST.GONE)).toBe(true);
    console.log('đi xuyên khi né:', sim.stats.passThrough, 'ép lượt cầu thang:', sim.stats.forcedStair);
  }, 120000);

  it('đủ người cho mọi bàn chạy hết ngày không kẹt', () => {
    const { model, nav } = setup();
    const staff = validateStaff(model, fakeStaff(model, model.desks.length));
    expect(staff.errors).toEqual([]);
    const sim = new Simulation(model, nav, staff, { start: '07:00' });
    const r = runDay(sim);
    expect(sim.problems).toEqual([]);
    expect(r.stuck).toEqual([]);
    expect(r.overlapSeats).toBe(0);
    expect(sim.agents.every(a => a.state === ST.GONE)).toBe(true);
  }, 120000);
});

describe('sức chứa và chỗ ngồi', () => {
  it('nhiều người hơn số bàn thì báo lỗi rõ ràng và không xếp chồng', () => {
    const { model } = setup();
    const N = model.desks.length;
    const staff = validateStaff(model, fakeStaff(model, N + 3));
    expect(staff.errors.join('\n')).toContain(`${N + 3} nhân viên nhưng layout.json chỉ có ${N} bàn`);
    expect(staff.active.length).toBe(N);
    expect(new Set(staff.active.map(e => e.deskId)).size).toBe(N);
  });
  it('hai người cùng một bàn: người sau bị loại kèm thông báo', () => {
    const { model } = setup();
    const data = fakeStaff(model, 3);
    data.employees[1].deskId = data.employees[0].deskId;
    const staff = validateStaff(model, data);
    expect(staff.errors.some(e => e.includes('đã thuộc'))).toBe(true);
    expect(new Set(staff.active.map(e => e.deskId)).size).toBe(staff.active.length);
  });
});
