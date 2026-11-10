// Bi-a 2 người (src/shared/billiards.js): xếp bi, vật lý tất định (mọi máy ra cùng kết quả), luật lỗ 8 bi.
import { describe, it, expect } from 'vitest';
import { rack, simulate, applyRules, respotCue, PX, PZ, BALL_R } from '../src/shared/billiards.js';

const seeded = s => () => (s = (s * 16807) % 2147483647) / 2147483647;
describe('bi-a', () => {
  it('xếp đủ 16 bi trên bàn, không chồng nhau', () => {
    const b = rack(seeded(7));
    expect(b).toHaveLength(16);
    for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) expect(Math.hypot(b[i].x - b[j].x, b[i].z - b[j].z)).toBeGreaterThan(2 * BALL_R - 1e-9);
    expect(b[8].on).toBe(1);
  });
  it('cùng thế bi + cùng cú đánh → cùng kết quả (tất định); bi luôn nằm trong bàn', () => {
    const b = rack(seeded(3)), shot = { ax: 0.02, az: 1, power: 0.9 };
    const s1 = simulate(b, shot), r1 = s1.finish(), s2 = simulate(b, shot), r2 = s2.finish();
    expect(r2).toEqual(r1); expect(s2.balls()).toEqual(s1.balls());
    for (const x of s1.balls()) if (x.on) { expect(Math.abs(x.x)).toBeLessThanOrEqual(PX + 0.021); expect(Math.abs(x.z)).toBeLessThanOrEqual(PZ + 0.021); }
    expect(r1.first).toBeGreaterThan(0);
  });
  it('bi chủ vào lỗ: phạm lỗi, đổi lượt, đặt lại bi chủ', () => {
    const before = rack(seeded(1)), after = before.map(b => ({ ...b })); after[0] = { ...after[0], on: 0 };
    const out = applyRules({ players: ['a', 'b'], turn: 0, groups: {}, balls: before }, before, after, { potted: [0], first: 3, cushions: 2 });
    expect(out.foul).toBe(true); expect(out.turn).toBe(1); expect(out.balls[0].on).toBe(1);
  });
  it('vào bi hợp lệ: chia nhóm, đánh tiếp; bi 8 sớm thì thua', () => {
    const before = rack(seeded(2)), after = before.map(b => ({ ...b })); after[3] = { ...after[3], on: 0 };
    const g = { players: ['a', 'b'], turn: 0, groups: {}, balls: before };
    const out = applyRules(g, before, after, { potted: [3], first: 1, cushions: 1 });
    expect(out.groups).toEqual({ a: 'solid', b: 'stripe' }); expect(out.turn).toBe(0); expect(out.foul).toBe(false);
    const a8 = before.map(b => ({ ...b })); a8[8] = { ...a8[8], on: 0 };
    expect(applyRules({ ...g, groups: out.groups }, before, a8, { potted: [8], first: 1, cushions: 1 }).winner).toBe('b');
  });
  it('đặt lại bi chủ không đè bi khác', () => {
    const b = rack(seeded(5)); b[1] = { x: 0, z: -PZ / 2, on: 1 };
    const c = respotCue(b);
    for (let i = 1; i < 16; i++) if (b[i].on) expect(Math.hypot(b[i].x - c.x, b[i].z - c.z)).toBeGreaterThan(2 * BALL_R);
  });
});
