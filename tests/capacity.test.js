// Giới hạn tải cho gói Render free (docs: báo cáo release 19/11/2026): cổng MAX_ONLINE + hàng chờ, chỉ gửi vị trí cùng tầng
// đang xem, bỏ gói khi client mạng chậm, giới hạn tần suất tin WS, hạn mức dung lượng file tổng, xoá nhân viên không để lại quyền.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import { Hub } from '../server/realtime.js';
import { QuotaBlobs, MemBlobs } from '../server/blobs.js';
import { createApp } from '../server/app.js';

let hub;
afterEach(() => hub?.close());
const fakeWs = (key, extra = {}) => ({ key, sess: { kind: key.startsWith('admin:') ? 'admin' : 'employee' }, readyState: 1, bufferedAmount: 0, viewF: -1, got: [], send(b) { this.got.push(JSON.parse(String(b))); }, terminate() { this.dead = true; }, close() { this.closed = true; }, ...extra });
const make = cfg => { hub = new Hub({ on() {} }, { maxOnline: 2, ...cfg }); return hub; };
const online = (h, ws) => { h.sockets.set(ws.key, new Set([ws])); return ws; };

describe('cổng giới hạn người online + hàng chờ', () => {
  it('đủ người: người mới vào hàng chờ theo thứ tự; có chỗ thì người chờ trước vào trước; CEO không bị giới hạn', () => {
    const h = make();
    online(h, fakeWs('employee:1001')); online(h, fakeWs('employee:1002'));
    expect(h.gate.check('employee:1003')).toMatchObject({ ok: false, pos: 1, online: 2, max: 2 });
    expect(h.gate.check('employee:1004')).toMatchObject({ ok: false, pos: 2 });
    expect(h.gate.check('employee:1001')).toEqual({ ok: true });            // (đang online, mở thêm tab)
    expect(h.gate.check('admin:admin')).toEqual({ ok: true });
    h.sockets.delete('employee:1002');                                       // một người ra về
    expect(h.gate.check('employee:1004')).toMatchObject({ ok: false, pos: 2 }); // (người chờ sau không chen lên)
    expect(h.gate.check('employee:1003')).toEqual({ ok: true });
    online(h, fakeWs('employee:1003'));
    expect(h.gate.check('employee:1004')).toMatchObject({ ok: false, pos: 1 });
    expect(h.gate.waitingCount()).toBe(1);
  });
  it('người chờ bỏ đi (không thử lại quá 45 giây) thì rời hàng', () => {
    const h = make(); online(h, fakeWs('employee:1001')); online(h, fakeWs('employee:1002'));
    h.gate.check('employee:1003'); h.gate.waiting.get('employee:1003').seen -= 60e3;
    expect(h.gate.check('employee:1004')).toMatchObject({ pos: 1 });
  });
});

describe('vị trí chỉ gửi cho người xem cùng tầng', () => {
  it('người xem tầng khác không nhận cập nhật thường; đổi tầng / người mới thì ai cũng nhận; CEO nhận hết', () => {
    const h = make({ maxOnline: 80 });
    const a = online(h, fakeWs('employee:1001', { viewF: 1 })), b = online(h, fakeWs('employee:1002', { viewF: 2 })), ceo = online(h, fakeWs('admin:admin', { viewF: 2 }));
    const p = { key: 'employee:1001', kind: 'employee', code: '1001', display: 'An', x: 1, y: 0, z: 1, f: 1, yaw: 0 };
    h.presence.set(p.key, p);
    h.dirty.add(p.key); h.flush();                                           // lần đầu: ai cũng nhận (hồ sơ + tầng)
    expect([a, b, ceo].map(w => w.got.length)).toEqual([1, 1, 1]);
    p.x = 2; h.dirty.add(p.key); h.flush();                                  // đi lại trong tầng 1
    expect([a, b, ceo].map(w => w.got.length)).toEqual([2, 1, 2]);
    p.f = 2; h.dirty.add(p.key); h.flush();                                  // lên tầng 2: ai cũng biết
    expect([a, b, ceo].map(w => w.got.length)).toEqual([3, 2, 3]);
    expect(b.got.at(-1).list[0]).toMatchObject({ key: 'employee:1001', f: 2 });
  });
  it('đổi tầng đang xem: nhận ngay vị trí mọi người ở tầng đó', () => {
    const h = make({ maxOnline: 80 });
    const a = online(h, fakeWs('employee:1001'));
    h.presence.set('employee:1002', { key: 'employee:1002', x: 3, y: 0, z: 3, f: 2 }); h.presence.set('employee:1003', { key: 'employee:1003', x: 1, y: 0, z: 1, f: 1 });
    h.onMessage(a, Buffer.from(JSON.stringify({ t: 'view', f: 2 })));
    expect(a.viewF).toBe(2); expect(a.got[0].list.map(x => x.key)).toEqual(['employee:1002']);
  });
});

describe('chống quá tải WebSocket', () => {
  it('client mạng chậm: bỏ gói vị trí khi tồn > 1 MB, ngắt khi > 4 MB; tin quan trọng vẫn gửi', () => {
    const h = make(), w = fakeWs('employee:1001', { bufferedAmount: 2 << 20 });
    h.sendBuf(w, Buffer.from('{"t":"positions","list":[]}'), true); expect(w.got).toHaveLength(0);
    h.sendBuf(w, Buffer.from('{"t":"seats","list":[]}')); expect(w.got).toHaveLength(1);
    w.bufferedAmount = 5 << 20; h.sendBuf(w, Buffer.from('{"t":"seats"}')); expect(w.dead).toBe(true);
  });
  it('gửi dồn quá ~80 tin thì bị bỏ; gửi dồn mãi thì bị ngắt; tin lớn không phải bảng vẽ bị bỏ', () => {
    const h = make(), w = fakeWs('employee:1001'); let n = 0; h.onBlind = () => { n++; };
    for (let i = 0; i < 200; i++) h.onMessage(w, Buffer.from('{"t":"blind","id":"w1","open":true}'));
    expect(n).toBeGreaterThanOrEqual(80); expect(n).toBeLessThan(90);
    for (let i = 0; i < 500; i++) h.onMessage(w, Buffer.from('{"t":"blind","id":"w1"}'));
    expect(w.closed).toBe(true);
    const w2 = fakeWs('employee:1002'); let big = 0; h.onChat = () => { big++; }; h.meet.onMessage = () => { big += 10; };
    h.onMessage(w2, Buffer.from(JSON.stringify({ t: 'chat', body: 'x'.repeat(70000) })));
    h.onMessage(w2, Buffer.from(JSON.stringify({ t: 'meet:wb', elements: ['x'.repeat(70000)] })));
    expect(big).toBe(10);
  });
});

describe('hạn mức dung lượng file tổng', () => {
  it('quá hạn mức thì báo lỗi quota; ghi đè chỉ tính phần chênh; xoá trả lại chỗ; bảng vẽ luôn ghi được', async () => {
    const q = await new QuotaBlobs(new MemBlobs(), 100).init();
    await q.put('pfile:1', Buffer.alloc(60), 'x');
    await expect(q.put('pfile:2', Buffer.alloc(60), 'x')).rejects.toMatchObject({ code: 'quota' });
    await q.put('pfile:1', Buffer.alloc(90), 'x'); expect(q.usage().used).toBe(90);
    await q.put('board:p1', Buffer.alloc(30), 'x'); expect(q.usage().used).toBe(120);
    await q.del('pfile:1'); expect(q.usage()).toMatchObject({ used: 30, files: 1 }); expect(q.room(70)).toBe(true);
    const again = await new QuotaBlobs(q.inner, 100).init(); expect(again.usage().used).toBe(30);   // (khởi động lại: đọc dung lượng đang có)
  });
});

describe('xoá nhân viên không để lại quyền cho người tạo lại cùng mã', () => {
  it('bỏ khỏi lời mời họp, huỷ họp sắp tới do người đó chủ trì, xoá tin nhắn riêng', async () => {
    const root = path.resolve(import.meta.dirname, '..');
    const r = await createApp({ port: 0, production: false, dbPath: ':memory:', sessionSecret: 'x'.repeat(64), duplicatePolicy: 'online-or-name-mismatch', adminCanSitAnywhere: false, adminInitialPassword: 'ceo-pass-123', cookieSecure: false,
      layoutPath: path.join(root, 'public/data/layout.json'), equipmentPath: path.join(root, 'public/data/equipment.json'), appearancePath: path.join(root, 'public/data/appearance.json'), simEmployeesPath: null, employeeSessionHours: 24, adminSessionHours: 12, onlineGraceMs: 0, loginWindowMin: 15, loginMaxFailures: 5 });
    try {
      const { store } = r.hub, db = store.db, now = Date.now(), K = 'employee:4401';
      store.adminCreateEmployee({ kind: 'admin', key: 'admin:admin', username: 'admin' }, '4401-Lan', '');
      const m1 = db.meetings.insert({ room: 'MR1', title: 'A', start: now + 3600e3, end: now + 7200e3, host: 'employee:9999', invitees: JSON.stringify([K, 'employee:9998']), status: 'booked' });
      const m2 = db.meetings.insert({ room: 'MR1', title: 'B', start: now + 3600e3, end: now + 7200e3, host: K, invitees: '[]', status: 'booked' });
      const m3 = db.meetings.insert({ room: 'MR1', title: 'C', start: now - 7200e3, end: now - 3600e3, host: K, invitees: '[]', status: 'booked' });
      db.chat_messages.insert({ channel: `dm:${['employee:4402', K].sort().join('|')}`, sender: K, body: 'hi', ts: now });
      db.chat_messages.insert({ channel: 'all', sender: K, body: 'chào', ts: now });
      store.adminDeleteEmployee({ kind: 'admin', key: 'admin:admin', username: 'admin' }, '4401');
      expect(JSON.parse(db.meetings.get(m1).invitees)).toEqual(['employee:9998']);
      expect(db.meetings.get(m2)).toMatchObject({ status: 'cancelled' }); expect(db.meetings.get(m2).host).not.toBe(K);
      expect(db.meetings.get(m3).status).toBe('booked'); expect(db.meetings.get(m3).host).toMatch(/^deleted:/);
      expect(db.chat_messages.all().map(x => x.channel)).toEqual(['all']);
    } finally { await r.close(); }
  });
});
