// Gói vị trí gửi cho mọi người (server/realtime.js Hub.wire): hồ sơ (tên, nhân vật) chỉ kèm lần đầu hoặc khi đổi; còn lại
// chỉ toạ độ làm tròn cm và các trường khác rỗng — để 100 người online không tốn băng thông.
import { describe, it, expect, afterEach } from 'vitest';
import { Hub } from '../server/realtime.js';

let hub;
afterEach(() => hub?.close());
const make = () => { hub = new Hub({ on() {} }, {}); return hub; };

describe('gói vị trí rút gọn', () => {
  it('lần đầu gửi đủ hồ sơ, sau đó chỉ gửi phần thay đổi; đổi nhân vật thì gửi lại đủ', () => {
    const h = make();
    const p = { key: 'employee:1001', kind: 'employee', code: '1001', display: '1001 - An', look: { model: 'mo-toy' }, department: 'IT', x: 1.23456, y: 0, z: -2.0049, f: 1, yaw: 0.12345, walk: true, run: false, act: '', seated: null, mode: 'office' };
    expect(h.wire(p)).toBe(p);                              // (lần đầu: đủ)
    expect(h.wire(p)).toEqual({ key: 'employee:1001', x: 1.23, y: 0, z: -2, f: 1, yaw: 0.12, walk: true });
    Object.assign(p, { walk: false, act: 'wave', seated: 'T1-01', mode: 'real' });
    expect(h.wire(p)).toEqual({ key: 'employee:1001', x: 1.23, y: 0, z: -2, f: 1, yaw: 0.12, act: 'wave', seated: 'T1-01', mode: 'real' });
    p.pv = 1;                                               // (đổi nhân vật / tên)
    expect(h.wire(p)).toBe(p);
    expect(h.wire(p).display).toBeUndefined();
  });
});
