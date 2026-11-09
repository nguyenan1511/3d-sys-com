import { describe, it, expect } from 'vitest';
import { insideOffice, smokeAllowed, NO_SMOKING } from '../src/shared/rules.js';
import { Hub } from '../server/realtime.js';

describe('quy định: không hút thuốc trong văn phòng làm việc', () => {
  it('trong toà nhà (mọi tầng) là văn phòng; vỉa hè/đường là ngoài trời', () => {
    expect(insideOffice(0, -1.25)).toBe(true);   // giữa văn phòng
    expect(insideOffice(2.9, 8.5)).toBe(true);   // sát cửa chính, vẫn trong nhà
    expect(insideOffice(1.5, 11)).toBe(false);   // vỉa hè
    expect(insideOffice(-10, 20)).toBe(false);   // ngoài đường
    expect(smokeAllowed(0, -1.25)).toBe(false);
    expect(smokeAllowed(1.5, 11)).toBe(true);
    expect(NO_SMOKING).toMatch(/Không hút thuốc trong văn phòng/);
  });
  it('server bỏ động tác hút thuốc khi người chơi ở trong văn phòng hoặc đang ngồi', () => {
    const hub = Object.create(Hub.prototype); hub.presence = new Map(); hub.dirty = new Set();
    const ws = { key: 'employee:1' }, p = { key: ws.key, seated: false, act: '' };
    hub.presence.set(ws.key, p);
    const send = m => hub.onMessage(ws, JSON.stringify({ t: 'pos', x: 0, y: 3, z: -1, f: 1, yaw: 0, ...m }));
    send({ act: 'smoke' }); expect(p.act).toBe('');                       // trong văn phòng: bị chặn
    send({ act: 'wave' }); expect(p.act).toBe('wave');                    // động tác khác vẫn được
    send({ act: 'smoke', x: 1.5, y: 0.15, z: 11, f: 0 }); expect(p.act).toBe('smoke'); // ngoài vỉa hè: được
    p.seated = true; send({ act: 'smoke' }); expect(p.act).toBe('');      // đang ngồi ở bàn: bị chặn
  });
});
