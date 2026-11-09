import { describe, it, expect } from 'vitest';
import { setup } from './helpers.js';
import { seatApproach } from '../src/model/layoutModel.js';

const { model, nav } = setup();
const spawns = ['spawnL', 'spawnR'].map(k => model.waypoints[k]);

describe('điều hướng', () => {
  it('mọi waypoint, đầu cầu thang và chỗ ngồi đều nằm trong vùng đi được', () => {
    const bad = [];
    for (const [k, w] of Object.entries(model.waypoints)) if (!nav.grid(w.f).isFree(w.x, w.z)) bad.push(`waypoint ${k}`);
    for (const s of model.stairs) for (const k of ['pEntry', 'pExit']) if (!nav.grid(s[k].f).isFree(s[k].x, s[k].z)) bad.push(`${s.id}.${k}`);
    for (const s of model.seats.values()) { const a = seatApproach(s); if (nav.grid(s.floor).nearestFree(a.x, a.z, 0.45) < 0) bad.push(`ghế ${s.id}`); }
    expect(bad).toEqual([]);
  });

  it('mọi bàn tới được từ cổng (cả hai phía vỉa hè) theo lộ trình vào làm', () => {
    const bad = [];
    for (const sp of spawns) for (const d of model.desks) {
      const p = nav.path(sp, seatApproach(d.seat), model.routes.arrive);
      if (!p) bad.push(d.id);
    }
    expect(bad).toEqual([]);
  });

  it('phòng họp, pantry, WC tới được từ mọi bàn và quay về được', () => {
    const targets = [...model.seats.values()].filter(s => s.kind !== 'desk' && s.kind !== 'reception').map(s => seatApproach(s));
    for (const w of model.wcs) targets.push(w.pQueue, w.pInside);
    const bad = [];
    for (const d of model.desks) for (const t of targets) {
      const from = seatApproach(d.seat);
      if (!nav.path(from, t)) bad.push(`${d.id}->${t.x},${t.z}`);
      if (!nav.path(t, from)) bad.push(`${t.x},${t.z}->${d.id}`);
    }
    expect(bad).toEqual([]);
  }, 120000);

  it('lộ trình vào làm đi qua các điểm mốc (thang máy → sảnh) rồi tới bàn', () => {
    const d = model.deskById.get('T3-01') || model.desks[model.desks.length - 1];
    const p = nav.path(spawns[0], seatApproach(d.seat), model.routes.arrive);
    const near = (q, w) => Math.hypot(q.x - w.x, q.z - w.z) < 0.05;
    let k = 0;
    for (const id of model.routes.arrive) { const w = model.waypoints[id]; k = p.points.findIndex((q, i) => i >= k && near(q, w)); expect(k, id).toBeGreaterThanOrEqual(0); }
    const stairs = p.points.filter(q => q.ev && q.ev.enter).map(q => q.ev.stair);
    expect(stairs).toEqual(model.stairs.length ? ['S1', 'S2'] : []); // văn phòng một tầng: không có cầu thang
  });

  it('đường đi không cắt qua vật cản (kiểm tra từng đoạn trên lưới)', () => {
    const bad = [];
    for (const d of model.desks) {
      const p = nav.path(spawns[1], seatApproach(d.seat), model.routes.arrive).points;
      for (let i = 1; i < p.length - 1; i++) { // đoạn cuối là bước sát vào ghế, được phép gần mép bàn
        const a = p[i - 1], b = p[i];
        if (a.s || b.s || a.ev || (a.f !== b.f)) continue; // đoạn trên cầu thang
        const g = nav.grid(b.f);
        const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(L / 0.05);
        for (let k = 1; k < n; k++) {
          const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n;
          if (g.clearance(x, z) < g.radius * 0.9) { bad.push(`${d.id} đoạn ${i} tại ${x.toFixed(2)},${z.toFixed(2)}`); break; }
        }
      }
    }
    expect(bad).toEqual([]);
  }, 60000);
});
