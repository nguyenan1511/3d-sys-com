// Xe không bao giờ chồng lên nhau hay chạm người; người đi khỏi thì xe chạy tiếp.
import { describe, it, expect } from 'vitest';
import { stepTraffic } from '../src/scene/traffic.js';

const XL = -14.6, XR = 15.1;
const mk = (x, z, v, dir, kind) => ({ o: { position: { x, z } }, dir, v0: v, speed: v, len: kind === 'car' ? 4.3 : 1.8 });
const fleet = () => [mk(12, 15.0, 8, -1, 'bike'), mk(-6, 15.0, 7, -1, 'bike'), mk(4, 17.6, 7, -1, 'car'), mk(-12, 17.6, 10, -1, 'bike'),
  mk(-8, 21.8, 8, 1, 'car'), mk(6, 21.8, 9, 1, 'bike'), mk(-2, 24.4, 7, 1, 'bike'), mk(10, 24.4, 8, 1, 'car')];

describe('giao thông', () => {
  it('10 phút: không xe nào chồng nhau, không chạm người đứng giữa làn, người đi khỏi thì xe chạy tiếp', () => {
    const movers = fleet(), dt = 1 / 60;
    const person = { x: 1.0, z: 15.0, visible: true };
    let minGap = Infinity, minPerson = Infinity, stoppedForPerson = false;
    for (let i = 0; i < 600 * 60; i++) {
      const t = i * dt;
      person.visible = t > 60 && t < 180; // đứng giữa đường từ phút 1 tới phút 3
      stepTraffic(movers, dt, [person], XL, XR);
      for (const a of movers) for (const b of movers) {
        if (a === b || Math.abs(a.o.position.z - b.o.position.z) > 0.5) continue;
        const d = Math.abs(a.o.position.x - b.o.position.x) - (a.len + b.len) / 2;
        minGap = Math.min(minGap, d);
      }
      if (person.visible) for (const m of movers) {
        if (Math.abs(m.o.position.z - person.z) > 0.5) continue;
        const ahead = (person.x - m.o.position.x) * m.dir - m.len / 2;
        if (ahead > -0.3 && ahead < 3) { minPerson = Math.min(minPerson, ahead); if (m.speed < 0.05) stoppedForPerson = true; }
      }
    }
    expect(minGap).toBeGreaterThan(0.3);
    expect(minPerson).toBeGreaterThan(0.3);
    expect(stoppedForPerson).toBe(true);
    // sau khi người đi khỏi, mọi xe đều đã chạy lại
    expect(Math.min(...movers.map(m => m.speed))).toBeGreaterThan(1);
  });
});
