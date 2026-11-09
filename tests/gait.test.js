import { describe, it, expect } from 'vitest';
import { gaitMotion, gaitLegs, legIK, cycleLength } from '../src/agents/gait.js';

const CHIBI = { hip: 0.6, L1: 0.28, L2: 0.26, ankle: 0.06 };
const GLB = { hip: 0.5035, L1: 0.2185, L2: 0.1805, ankle: 0.1045 };

/** Mô phỏng nhân vật đi thẳng với tốc độ v; trả về độ trượt của chân trụ (m trượt / m đi). */
function slide(leg, unit, v, ramp = 0) {
  const a = { x: 0, z: 0, yaw: 0, idx: 0 }; let t = 0, slip = 0, dist = 0, prev = null;
  for (let i = 0; i < 600; i++) {
    const vt = ramp ? v * Math.min(1, t / ramp) : v; t += 1 / 60; a.z -= vt / 60; // nhìn về -z
    const g = gaitMotion(a, unit, leg, t), G = gaitLegs(g, unit, leg);
    // vị trí cổ chân theo thế giới = thân + (tiến) * unit, tính lại từ góc IK (kiểm tra luôn IK)
    const feet = [0, 1].map(k => { const h = G.hip[k], kn = G.knee[k] - 0.04; return { f: (leg.L1 * Math.sin(h) + leg.L2 * Math.sin(h - kn)) * unit, st: G.feet[k].stance }; });
    if (i > (ramp ? 2 : 120) && prev) for (const k of [0, 1]) if (feet[k].st && prev[k].st) { slip += Math.abs((-a.z + feet[k].f) - prev[k].w); dist += vt / 60; }
    prev = feet.map(f => ({ ...f, w: -a.z + f.f }));
  }
  return slip / dist;
}

/** Đi vòng tròn bán kính R (m): độ trượt của chân trụ tính theo toạ độ thế giới. */
function slideTurn(leg, unit, v, R) {
  const a = { x: R, z: 0, yaw: 0, idx: 0 }; let t = 0, slip = 0, dist = 0, prev = null;
  for (let i = 0; i < 600; i++) {
    t += 1 / 60; const th = v * t / R; a.x = R * Math.cos(th); a.z = -R * Math.sin(th); a.yaw = th; // tiếp tuyến, nhìn theo hướng đi (hướng nhìn = (-sin yaw, -cos yaw))
    const g = gaitMotion(a, unit, leg, t), G = gaitLegs(g, unit, leg);
    const Fx = -Math.sin(a.yaw), Fz = -Math.cos(a.yaw), Rx = Math.cos(a.yaw), Rz = -Math.sin(a.yaw);
    const w = [0, 1].map(k => { const ft = G.feet[k], l = (k ? 1 : -1) * leg.hipX + ft.l; return { st: ft.stance, x: a.x + (Fx * ft.f + Rx * l) * unit, z: a.z + (Fz * ft.f + Rz * l) * unit }; });
    if (i > 120 && prev) for (const k of [0, 1]) if (w[k].st && prev[k].st) { slip += Math.hypot(w[k].x - prev[k].x, w[k].z - prev[k].z); dist += v / 60; }
    prev = w;
  }
  return slip / dist;
}

describe('dáng đi theo quỹ đạo bàn chân', () => {
  it('IK có dạng chân: cổ chân tới đúng điểm lệch ngang', () => {
    const dy = 0.5, l = 0.06, roll = Math.atan2(l, dy), r = legIK(0.1, Math.hypot(dy, l), 0.28, 0.26);
    const inPlaneDown = 0.28 * Math.cos(r.hip) + 0.26 * Math.cos(r.hip - r.knee);
    expect(inPlaneDown * Math.sin(roll)).toBeCloseTo(l, 4); expect(inPlaneDown * Math.cos(roll)).toBeCloseTo(dy, 4);
  });
  it('đi vòng (rẽ liên tục): chân trụ vẫn đứng yên trên sàn', () => {
    expect(slideTurn({ ...CHIBI, hipX: 0.072 }, 0.5, 1.1, 0.8)).toBeLessThan(0.08);
    expect(slideTurn({ ...GLB, hipX: 0.1615 }, 0.395, 1.1, 0.8)).toBeLessThan(0.08);
  });
  it('IK đưa cổ chân tới đúng điểm', () => {
    const r = legIK(0.12, 0.45, 0.28, 0.26);
    const f = 0.28 * Math.sin(r.hip) + 0.26 * Math.sin(r.hip - r.knee), y = 0.28 * Math.cos(r.hip) + 0.26 * Math.cos(r.hip - r.knee);
    expect(f).toBeCloseTo(0.12, 4); expect(y).toBeCloseTo(0.45, 4); expect(r.knee).toBeGreaterThan(0);
  });
  it('sải chân dài ra khi chạy nhanh hơn', () => { expect(cycleLength(2.4, 0.27)).toBeGreaterThan(cycleLength(1.1, 0.27)); });
  for (const [name, leg, unit] of [['chibi', CHIBI, 0.5], ['GLB', GLB, 0.395]]) {
    for (const v of [1.1, 2.4]) {
      it(`${name} ${v} m/s: chân trụ gần như không trượt`, () => { expect(slide(leg, unit, v)).toBeLessThan(0.08); });
      it(`${name} tăng tốc 0 → ${v} m/s: chân trụ vẫn không trượt`, () => { expect(slide(leg, unit, v, 1.5)).toBeLessThan(0.08); });
    }
  }
});
