// Hộp bo góc nhanh (src/scene/fastRoundedBox.js) phải cho ra đúng từng số như bản gốc của three.js.
import { describe, it, expect } from 'vitest';
import { RoundedBoxGeometry as Orig } from '../node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoundedBoxGeometry as Fast } from '../src/scene/fastRoundedBox.js';

const same = (a, b) => { expect(b.index ? [...b.index.array] : null).toEqual(a.index ? [...a.index.array] : null); expect(b.groups).toEqual(a.groups); for (const k of ['position', 'normal', 'uv']) { const x = a.attributes[k].array, y = b.attributes[k].array; expect(y.length).toBe(x.length); let bad = 0; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) bad++; expect(bad, k).toBe(0); } };
describe('RoundedBoxGeometry nhanh', () => {
  it('trùng khớp bản gốc với nhiều cỡ, số ô chia, bán kính (kể cả bán kính lớn hơn cạnh)', () => {
    let seed = 3; const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let t = 0; t < 60; t++) {
      const w = 0.02 + r() * 3, h = 0.02 + r() * 3, d = 0.02 + r() * 3, seg = 1 + Math.floor(r() * 4), rad = r() * 0.6;
      same(new Orig(w, h, d, seg, rad), new Fast(w, h, d, seg, rad));
    }
    same(new Orig(), new Fast());
    same(new Orig(1, 2, 3, 0, 0.2), new Fast(1, 2, 3, 0, 0.2));
  });
  it('clone giữ tham số', () => { const g = new Fast(1, 2, 3, 2, 0.1).clone(); expect(g.parameters).toEqual({ width: 1, height: 2, depth: 3, segments: 2, radius: 0.1 }); expect(g.attributes.position.count).toBe(new Orig(1, 2, 3, 2, 0.1).attributes.position.count); });
});
