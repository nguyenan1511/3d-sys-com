import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const j = JSON.parse(readFileSync('public/data/mocap.json', 'utf8'));
const buf = readFileSync('public/data/mocap.bin');
const D = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

describe('dữ liệu chuyển động người thật (mocap)', () => {
  it('có đủ clip cho các trạng thái của nhân vật', () => {
    for (const k of ['idle', 'walk', 'jog', 'jumpLoop', 'sitIdle', 'sitTalk', 'talk', 'dance', 'phone']) expect(j.clips[k], k).toBeTruthy();
    expect(j.segs).toHaveLength(13);
    expect(j.stride).toBe(13 * 4 + 3);
  });
  it('kích thước file nhị phân khớp chỉ mục; mọi quaternion đã chuẩn hóa', () => {
    let end = 0;
    for (const [k, c] of Object.entries(j.clips)) {
      end = Math.max(end, c.offset + c.frames * j.stride);
      for (let f = 0; f < c.frames; f += 5) for (let s = 0; s < 13; s++) {
        const o = c.offset + f * j.stride + s * 4;
        expect(Math.hypot(D[o], D[o + 1], D[o + 2], D[o + 3]), `${k} f${f} s${s}`).toBeCloseTo(1, 2);
      }
    }
    expect(end).toBe(D.length);
  });
  it('đi/chạy có tốc độ tự nhiên hợp lý (chạy nhanh hơn đi), hông đứng ~1 chiều cao hông', () => {
    expect(j.clips.walk.speed).toBeGreaterThan(0.6);
    expect(j.clips.jog.speed).toBeGreaterThan(j.clips.walk.speed);
    const c = j.clips.idle, hy = D[c.offset + 13 * 4 + 1];
    expect(hy).toBeGreaterThan(0.85); expect(hy).toBeLessThan(1.1);
  });
});
