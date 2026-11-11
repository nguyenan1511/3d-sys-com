// Nhà vệ sinh (server/wc.js): mỗi buồng một người; buồng có người thì người khác bị quát (không vào được), người trong
// buồng được báo có người gõ cửa; ra / rời mạng thì trả buồng. Đèn vũ trường phòng karaoke: ai trong phòng cũng bật/tắt.
import { describe, it, expect, beforeEach } from 'vitest';
import { Restroom, ANGRY } from '../server/wc.js';
import { Karaoke } from '../server/karaoke.js';

let hub, sent;
const ws = key => ({ key });
beforeEach(() => {
  sent = [];
  hub = { presence: new Map([['a', { display: 'A' }], ['b', { display: 'B' }], ['c', { display: 'C' }]]), sockets: new Map([['a', [ws('a')]], ['b', [ws('b')]], ['c', [ws('c')]]]),
    broadcast: m => sent.push({ to: '*', m }), send: (s, m) => sent.push({ to: s.key, m }) };
});

describe('nhà vệ sinh', () => {
  it('buồng có người: người khác bị quát, người trong buồng được báo; ra thì buồng trống', () => {
    const w = new Restroom(hub);
    w.onMessage(ws('a'), { t: 'wc:enter', stall: 0 });
    expect(w.state().stalls[0]).toMatchObject({ key: 'a', display: 'A' });
    w.onMessage(ws('b'), { t: 'wc:enter', stall: 0 });
    expect(w.state().stalls[0].key).toBe('a');
    const angry = sent.find(s => s.m.t === 'wcAngry');
    expect(angry.m).toMatchObject({ stall: 0, by: 'A', knocker: 'B' }); expect(ANGRY).toContain(angry.m.text);
    expect(sent.find(s => s.to === 'a' && s.m.t === 'wcKnock').m.by).toBe('B');
    w.onMessage(ws('b'), { t: 'wc:enter', stall: 1 });
    expect(w.state().stalls[1].key).toBe('b');
    w.onMessage(ws('a'), { t: 'wc:leave' }); w.leave('b');   // (b rời mạng)
    expect(w.state().stalls).toEqual([null, null]);
    w.onMessage(ws('c'), { t: 'wc:enter', stall: 7 }); expect(w.state().stalls).toEqual([null, null]);
  });
});

describe('đèn vũ trường (karaoke)', () => {
  it('người trong phòng bật/tắt được, người ngoài không; phòng trống thì tắt', () => {
    const k = new Karaoke(hub);
    k.onMessage(ws('a'), { t: 'ktv:join' });
    k.onMessage(ws('c'), { t: 'ktv:disco', on: true }); expect(k.state().disco).toBe(false);
    k.onMessage(ws('a'), { t: 'ktv:disco', on: true }); expect(k.state().disco).toBe(true);
    k.leave('a'); expect(k.state().disco).toBe(false);
  });
});
