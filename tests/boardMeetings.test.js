// Bảng thông báo (server/board.js) + phòng họp (server/meetings.js, meetHub.js): quyền đăng tin, thứ tự / trang, đặt phòng
// (khung 30 phút, giờ mở cửa, trùng lịch, người mời), kênh chat riêng, tài liệu, bảng vẽ, chặn người ngoài vào phòng.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import path from 'path';
import { openDb } from '../server/db.js';
import { Store, HttpError } from '../server/store.js';
import * as board from '../server/board.js';
import { Meetings, SLOT } from '../server/meetings.js';
import { MeetHub } from '../server/meetHub.js';
import { canUseChannel } from '../server/social.js';
import { MemBlobs } from '../server/blobs.js';

const root = path.resolve(import.meta.dirname, '..');
const cfg = { layoutPath: path.join(root, 'public/data/layout.json'), equipmentPath: path.join(root, 'public/data/equipment.json'), appearancePath: path.join(root, 'public/data/appearance.json'), duplicatePolicy: 'online-or-name-mismatch', adminCanSitAnywhere: false };
const off = () => false;
const ADMIN = { kind: 'admin', username: 'admin' };
const emp = code => ({ kind: 'employee', code });
const who = (a) => ({ key: a.kind === 'admin' ? `admin:${a.username}` : `employee:${a.code}`, name: a.username || a.code });
const err = async fn => { try { await fn(); } catch (e) { if (e instanceof HttpError) return e; throw e; } return null; };
// 09:00 giờ Việt Nam ngày 2026-11-16 (thứ 2)
const DAY9 = Date.UTC(2026, 10, 16, 2, 0);

let store, M;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(DAY9 - 3600e3);   // (08:00)
  const db = openDb(); db.blobs = new MemBlobs();
  store = new Store(db, cfg);
  store.loginEmployee('1001-An', off); store.loginEmployee('1002-Bình', off); store.loginEmployee('1003-Chi', off);
  db.employees.update('1001', { department: 'Phòng Hành chính - Nhân sự' });
  db.admins.insert({ username: 'admin', pass_hash: 'x', is_initial: 0, updated_at: 1 });
  M = new Meetings(store, k => k);
});
afterEach(() => vi.useRealTimers());

describe('bảng thông báo', () => {
  it('CEO cấp quyền đăng tin: người được cấp đăng tin, chỉ sửa / gỡ tin của mình, không ghim; thu quyền thì thôi', async () => {
    const it0 = board.create(store, emp('1001'), who(emp('1001')), { title: 'Tin của HC-NS' });
    expect(board.canPost(store, emp('1002'))).toBe(false);
    board.setPostPermission(store, '1002', true);
    expect(board.postPermissions(store)).toEqual(['1002']);
    const mine = board.create(store, emp('1002'), who(emp('1002')), { title: 'Team building', pinned: true });
    expect(mine.pinned).toBe(false);                                                          // (không được ghim)
    expect(board.update(store, emp('1002'), who(emp('1002')), mine.id, { title: 'Team building quý 4', pinned: true })).toMatchObject({ title: 'Team building quý 4', pinned: false });
    expect((await err(() => board.update(store, emp('1002'), who(emp('1002')), it0.id, { title: 'sửa tin người khác' }))).message).toMatch('của chính mình');
    expect((await err(() => board.remove(store, emp('1002'), who(emp('1002')), it0.id))).status).toBe(403);
    const pg = board.page(store, { actor: emp('1002') });
    expect(pg.items.find(x => x.id === mine.id).canEdit).toBe(true); expect(pg.items.find(x => x.id === it0.id).canEdit).toBe(false);
    expect(board.page(store, { actor: emp('1001') }).items.every(x => x.canEdit)).toBe(true);   // (HC-NS quản lý mọi tin)
    board.setPostPermission(store, '1002', false);
    expect((await err(() => board.create(store, emp('1002'), who(emp('1002')), { title: 'x' }))).message).toMatch('chưa được CEO cấp quyền');
    expect((await err(() => board.remove(store, emp('1002'), who(emp('1002')), mine.id))).status).toBe(403);
    board.remove(store, emp('1001'), who(emp('1001')), mine.id);
  });
  it('chỉ HC-NS và quản trị được đăng / sửa / gỡ; sự kiện cần ngày giờ', async () => {
    expect(board.canPost(store, emp('1001'))).toBe(true);
    expect(board.canPost(store, emp('1002'))).toBe(false);
    expect(board.canPost(store, ADMIN)).toBe(true);
    expect((await err(() => board.create(store, emp('1002'), who(emp('1002')), { title: 'x' }))).status).toBe(403);
    expect((await err(() => board.create(store, ADMIN, who(ADMIN), { kind: 'event', title: 'Tiệc' }))).message).toMatch('ngày giờ');
    expect((await err(() => board.create(store, ADMIN, who(ADMIN), { title: '   ' }))).status).toBe(400);
    const it1 = board.create(store, emp('1001'), who(emp('1001')), { title: 'Nghỉ lễ', body: 'Chi tiết' });
    expect(board.update(store, ADMIN, who(ADMIN), it1.id, { pinned: true }).pinned).toBe(true);
    expect((await err(() => board.remove(store, emp('1003'), who(emp('1003')), it1.id))).status).toBe(403);
    board.remove(store, ADMIN, who(ADMIN), it1.id);
    expect(board.page(store).items).toHaveLength(0);
  });
  it('thứ tự: ghim → sự kiện sắp tới (gần nhất trước) → mới nhất; 10 tin trên bảng, phần còn lại theo trang', () => {
    const now = Date.now(), add = (t, x = {}) => { vi.setSystemTime(now + store.db.announcements.count() * 1000); return board.create(store, ADMIN, who(ADMIN), { title: t, ...x }); };
    for (let i = 0; i < 12; i++) add(`tin ${i}`);
    add('sự kiện xa', { kind: 'event', eventAt: now + 5 * 86400e3 });
    add('sự kiện gần', { kind: 'event', eventAt: now + 86400e3 });
    add('sự kiện đã qua', { kind: 'event', eventAt: now - 3 * 86400e3 });
    add('ghim', { pinned: true });
    const p0 = board.page(store);
    expect(p0.items.map(x => x.title).slice(0, 5)).toEqual(['ghim', 'sự kiện gần', 'sự kiện xa', 'sự kiện đã qua', 'tin 11']);
    expect(p0.items).toHaveLength(10); expect(p0.hasMore).toBe(true); expect(p0.total).toBe(16);
    const p1 = board.page(store, { offset: 10 });
    expect(p1.items.map(x => x.title)).toEqual(['tin 5', 'tin 4', 'tin 3', 'tin 2', 'tin 1', 'tin 0']); expect(p1.hasMore).toBe(false);
    expect(board.page(store, { kind: 'event' }).items).toHaveLength(3);
  });
});

describe('đặt phòng họp', () => {
  const book = (a, x = {}) => M.book(a, { title: 'Họp', start: DAY9, end: DAY9 + 2 * SLOT, invitees: [], ...x });
  it('khung 30 phút, giờ mở cửa 07–21, tối đa 4 giờ, không trùng lịch, không đặt giờ đã qua', async () => {
    const m = book(emp('1002'), { invitees: ['employee:1003', 'employee:1003', 'employee:1002'] });
    expect(m.invitees).toEqual(['employee:1003']);                                        // (bỏ trùng, bỏ chính host)
    expect((await err(() => book(emp('1001'), { start: DAY9 + SLOT, end: DAY9 + 3 * SLOT }))).status).toBe(409);
    expect(book(emp('1001'), { start: DAY9 + 2 * SLOT, end: DAY9 + 3 * SLOT }).id).toBeGreaterThan(m.id);   // (sát giờ: được)
    expect((await err(() => book(emp('1001'), { start: DAY9 + 600e3, end: DAY9 + SLOT * 8 }))).message).toMatch('30 phút');
    expect((await err(() => book(emp('1001'), { start: DAY9 + 12 * 3600e3, end: DAY9 + 12 * 3600e3 + SLOT }))).message).toMatch(/07:00.*21:00/);   // 21:00
    expect((await err(() => book(emp('1001'), { start: DAY9 + 3600e3 * 3, end: DAY9 + 3600e3 * 8 }))).message).toMatch('4 giờ');
    expect((await err(() => book(emp('1001'), { start: DAY9 - 4 * 3600e3, end: DAY9 - 3 * 3600e3 }))).status).toBe(400);
    expect((await err(() => book(emp('1001'), { start: DAY9 + 5 * 3600e3, end: DAY9 + 6 * 3600e3, invitees: ['employee:9999'] }))).message).toMatch('9999');
  });
  it('chỉ host sửa được; CEO huỷ được mọi lịch; người được mời thấy chi tiết, người ngoài chỉ thấy phòng đã đặt', async () => {
    const m = book(emp('1002'), { invitees: ['employee:1003'], agenda: 'Bí mật' });
    expect((await err(() => M.edit(emp('1003'), m.id, { title: 'đổi' }))).status).toBe(403);
    const r = M.edit(emp('1002'), m.id, { invitees: ['employee:1001'] });
    expect(r.added).toEqual(['employee:1001']); expect(r.removed).toEqual(['employee:1003']);
    const outsider = M.range('employee:1003', DAY9 - 3600e3, DAY9 + 86400e3)[0];
    expect(outsider.title).toBe('Họp'); expect(outsider.agenda).toBeUndefined(); expect(outsider.invitees).toBeUndefined();
    expect(M.range('employee:1001', DAY9, DAY9 + 3600e3)[0].agenda).toBe('Bí mật');
    expect((await err(() => M.cancel(emp('1001'), m.id))).status).toBe(403);
    M.cancel(ADMIN, m.id);
    expect(M.range('employee:1001', DAY9, DAY9 + 3600e3)).toHaveLength(0);
  });
  it('kênh chat meet:<id> chỉ host + người được mời; tài liệu ≤ 5 MB, đúng loại, chỉ người trong cuộc họp', async () => {
    const m = book(emp('1002'), { invitees: ['employee:1003'] });
    expect(canUseChannel(store, emp('1003'), 'employee:1003', `meet:${m.id}`)).toBe(true);
    expect(canUseChannel(store, emp('1001'), 'employee:1001', `meet:${m.id}`)).toBe(false);
    expect(canUseChannel(store, emp('1001'), 'employee:1001', 'meet:999')).toBe(false);
    const data = Buffer.from('xin chào').toString('base64');
    const { file } = await M.addFile(emp('1003'), m.id, { name: 'bien-ban.txt', data });
    expect(file).toMatchObject({ name: 'bien-ban.txt', type: 'text/plain', size: 9 });
    expect((await M.getFile(emp('1002'), m.id, file.id)).data.toString()).toBe('xin chào');
    expect((await err(() => M.getFile(emp('1001'), m.id, file.id))).status).toBe(403);
    expect((await err(() => M.addFile(emp('1003'), m.id, { name: 'virus.exe', data }))).message).toMatch('Chỉ nhận');
    expect((await err(() => M.addFile(emp('1003'), m.id, { name: 'to.pdf', data: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }))).status).toBe(413);
    expect((await err(() => M.delFile(emp('1001'), m.id, file.id))).status).toBe(403);
    await M.delFile(emp('1002'), m.id, file.id);                                           // (host xoá được file của người khác)
    expect(M.files(m.id)).toHaveLength(0);
  });
});

describe('phòng họp thời gian thực', () => {
  /** Hub giả: ghi lại tin gửi cho từng người. */
  function fakeHub() {
    const sent = new Map(), sockets = new Map();
    const sock = key => { const ws = { key, readyState: 1 }; sockets.set(key, new Set([ws])); return ws; };
    return { store, sent, sockets, sock, presence: new Map(), send: (ws, msg) => { if (!sent.has(ws.key)) sent.set(ws.key, []); sent.get(ws.key).push(msg); }, broadcast() {} };
  }
  it('chỉ người được mời vào phòng (từ 10 phút trước); bảng vẽ Excalidraw ghép theo phiên bản, con trỏ, ảnh; chặn vị trí người ngoài', async () => {
    const m = M.book(emp('1002'), { title: 'Sprint', start: DAY9, end: DAY9 + 2 * SLOT, invitees: ['employee:1003'] });
    const hub = fakeHub(), mh = new MeetHub(hub, M); mh.close();
    const host = hub.sock('employee:1002'), guest = hub.sock('employee:1003'), out = hub.sock('employee:1001');
    await mh.onMessage(guest, { t: 'meet:join', id: m.id });
    expect(hub.sent.get('employee:1003').at(-1)).toMatchObject({ t: 'meetErr' });       // (08:00: chưa tới giờ mở phòng)
    vi.setSystemTime(DAY9 - 5 * 60e3);
    await mh.onMessage(out, { t: 'meet:join', id: m.id });
    expect(hub.sent.get('employee:1001').at(-1).msg).toMatch('không có trong danh sách');
    await mh.onMessage(host, { t: 'meet:join', id: m.id }); await mh.onMessage(guest, { t: 'meet:join', id: m.id });
    expect(mh.members(m.id).map(x => x.key).sort()).toEqual(['employee:1002', 'employee:1003']);
    // bảng vẽ Excalidraw: hình ghép theo phiên bản (mới hơn thì thay, cũ hơn thì bỏ); người khác nhận; sai định dạng bỏ qua
    const el = (id, version, extra = {}) => ({ id, type: 'rectangle', version, versionNonce: 5, index: `a${id.length}`, x: 0, y: 0, width: 10, height: 10, ...extra });
    await mh.onMessage(guest, { t: 'meet:wb', id: m.id, elements: [el('r1', 1), el('bad id!', 1), { id: 'x', type: 'selection', version: 1, versionNonce: 1 }] });
    await mh.onMessage(host, { t: 'meet:wb', id: m.id, elements: [el('r1', 3, { x: 50 }), el('t22', 1, { type: 'text', text: 'Chào' })] });
    await mh.onMessage(guest, { t: 'meet:wb', id: m.id, elements: [el('r1', 2, { x: 99 })] });   // (cũ hơn bản máy chủ: bỏ)
    const r = mh.rooms.get(m.id);
    expect([...r.els.values()].map(e => [e.id, e.version, e.x])).toEqual([['r1', 3, 50], ['t22', 1, 0]]);
    expect(hub.sent.get('employee:1002').some(x => x.t === 'meet:wb' && x.elements.some(e => e.id === 'r1' && e.version === 1))).toBe(true);
    expect(hub.sent.get('employee:1002').some(x => x.t === 'meet:wb' && x.elements.some(e => e.version === 3))).toBe(false);   // (không gửi lại cho chính người vẽ)
    // con trỏ: chuyển cho người khác (không gửi cho người ngoài phòng)
    await mh.onMessage(host, { t: 'meet:ptr', id: m.id, x: 12.5, y: -4, tool: 'pointer', button: 'up', selected: ['r1'] });
    expect(hub.sent.get('employee:1003').at(-1)).toMatchObject({ t: 'meet:ptr', key: 'employee:1002', x: 12.5, selected: ['r1'] });
    await mh.onMessage(out, { t: 'meet:wb', id: m.id, elements: [el('zz', 1)] }); expect(r.els.has('zz')).toBe(false);
    // ảnh dán lên bảng: chỉ người trong phòng, đúng loại ảnh
    expect(await mh.addFile('employee:1003', m.id, { id: 'f1', mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml;base64,AA==' })).toMatch('PNG');
    expect(await mh.addFile('employee:1001', m.id, { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==' })).toMatch('Vào phòng');
    expect(await mh.addFile('employee:1003', m.id, { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==' })).toBeUndefined();
    expect(JSON.parse(await mh.getFile(m.id, 'f1')).mimeType).toBe('image/png');
    // xoá (Excalidraw gửi hình isDeleted) + lưu khi phòng trống
    await mh.onMessage(host, { t: 'meet:wb', id: m.id, elements: [el('t22', 2, { type: 'text', isDeleted: true })] });
    mh.leave('employee:1002', m.id); mh.leave('employee:1003', m.id); await mh.saveAll(); await new Promise(res => setTimeout(res, 0));
    const saved = await mh.board(m.id);
    expect(saved.elements.filter(e => !e.isDeleted).map(e => e.id)).toEqual(['r1']); expect(saved.files).toEqual(['f1']);
    // chặn vị trí: đang họp, người ngoài trong phòng họp → chặn; người được mời / ngoài phòng → không
    vi.setSystemTime(DAY9 + 60e3);
    store.meetRooms = [{ id: 'MR1', floor: 0, x0: -4.45, x1: 1.15, z0: -12.8, z1: -7.8 }];
    expect(mh.blocked('employee:1001', -1.6, -10, 0)).toBe(true);
    expect(mh.blocked('employee:1003', -1.6, -10, 0)).toBe(false);
    expect(mh.blocked('employee:1001', 3, 2, 0)).toBe(false);
    expect(mh.blocked('employee:1001', -1.6, -10, 1)).toBe(false);
    vi.setSystemTime(DAY9 + 2 * SLOT + 1); expect(mh.blocked('employee:1001', -1.6, -10, 0)).toBe(false);   // (hết giờ: phòng mở)
  });
  it('nhắc giờ: 10 phút trước và đúng giờ, mỗi lần một lần; đúng giờ ghi một dòng vào kênh chat của cuộc họp', () => {
    const m = M.book(emp('1002'), { title: 'Sprint', start: DAY9, end: DAY9 + 2 * SLOT, invitees: ['employee:1003'] });
    const hub = fakeHub(), mh = new MeetHub(hub, M); mh.close(); hub.sock('employee:1002'); hub.sock('employee:1003');
    mh.tick(DAY9 - 9 * 60e3); mh.tick(DAY9 - 8 * 60e3);
    expect(hub.sent.get('employee:1003').filter(x => x.t === 'meet:remind').map(x => x.kind)).toEqual(['soon']);
    mh.tick(DAY9 + 30e3); mh.tick(DAY9 + 45e3);
    expect(hub.sent.get('employee:1003').filter(x => x.t === 'meet:remind').map(x => x.kind)).toEqual(['soon', 'start']);
    expect(store.db.chat_messages.by('channel', `meet:${m.id}`)).toHaveLength(1);
  });
});

describe('tin mẫu bảng thông báo', () => {
  it('đăng một lần khi bảng trống, bỏ sự kiện đã qua; gỡ hết cũng không đăng lại', () => {
    const n = board.seedBoard(store, Date.UTC(2026, 10, 13, 2));
    expect(n).toBeGreaterThan(10);
    const p = board.page(store);
    expect(p.items[0].title).toMatch('Tết Dương lịch');          // (ghim)
    expect(p.hasMore).toBe(true);
    for (const r of store.db.announcements.all()) store.db.announcements.del(r.id);
    expect(board.seedBoard(store)).toBe(0);
    const fresh = new Store(openDb(), cfg);
    expect(board.seedBoard(fresh, Date.UTC(2026, 11, 26, 2))).toBeLessThan(n);   // (26/12: các sự kiện tháng 11–12 đã qua)
  });
});

describe('ảnh của tin', () => {
  it('chỉ HC-NS / quản trị gắn ảnh; kiểm tra loại thật của file và kích thước; gỡ tin thì xoá ảnh', async () => {
    const it1 = board.create(store, ADMIN, who(ADMIN), { title: 'Tiệc' });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString('base64');
    expect((await err(() => board.setImage(store, emp('1002'), who(emp('1002')), it1.id, { data: png, type: 'image/png' }))).status).toBe(403);
    expect((await err(() => board.setImage(store, ADMIN, who(ADMIN), it1.id, { data: Buffer.from('<svg/>').toString('base64'), type: 'image/png' }))).status).toBe(400);
    expect((await err(() => board.setImage(store, ADMIN, who(ADMIN), it1.id, { data: png, type: 'image/gif' }))).status).toBe(400);
    const v1 = await board.setImage(store, emp('1001'), who(emp('1001')), it1.id, { data: png, type: 'image/png' });
    expect(v1.image).toMatch(new RegExp(`^/api/board/${it1.id}/image\\?v=\\d+$`));
    expect((await store.db.blobs.get(`ann:${it1.id}`)).type).toBe('image/png');
    expect((await board.dropImage(store, ADMIN, who(ADMIN), it1.id)).image).toBeNull();
    await board.setImage(store, ADMIN, who(ADMIN), it1.id, { data: png, type: 'image/png' });
    board.remove(store, ADMIN, who(ADMIN), it1.id); await new Promise(r => setTimeout(r, 0));
    expect(await store.db.blobs.get(`ann:${it1.id}`)).toBeNull();
  });
});

describe('kết thúc sớm, xoá dữ liệu, ẩn khỏi folder', () => {
  it('host kết thúc sớm (phòng trống ngay); xoá cuộc họp xoá tài liệu + chat + bảng vẽ; người được mời chỉ ẩn được', async () => {
    const m = M.book(emp('1002'), { title: 'Sprint', start: DAY9, end: DAY9 + 4 * SLOT, invitees: ['employee:1003'] });
    vi.setSystemTime(DAY9 + 600e3);
    expect((await err(() => M.endNow(emp('1003'), m.id))).status).toBe(403);
    const e = M.endNow(emp('1002'), m.id);
    expect(e.end).toBe(DAY9 + 600e3); expect(M.view(e, 'employee:1002').past).toBe(true);
    // tài liệu, chat, bảng vẽ
    await M.addFile(emp('1003'), m.id, { name: 'a.txt', data: Buffer.from('x').toString('base64') });
    store.db.chat_messages.insert({ channel: `meet:${m.id}`, sender: 'employee:1003', sender_name: 'C', body: 'hi', ts: 1 });
    await store.db.blobs.put(`board:${m.id}`, Buffer.from(JSON.stringify({ v: 2, elements: [], files: { p1: 10 } })), 'application/json');
    await store.db.blobs.put(`wbf:${m.id}:p1`, Buffer.from('{}'), 'application/json');
    // người được mời: không xoá được dữ liệu, chỉ ẩn khỏi folder của mình
    expect((await err(() => M.purge(emp('1003'), m.id))).status).toBe(403);
    M.hide(emp('1003'), m.id);
    expect(M.mine('employee:1003')).toHaveLength(0); expect(M.mine('employee:1002')).toHaveLength(1);
    await M.purge(emp('1002'), m.id);
    expect(M.mine('employee:1002')).toHaveLength(0);
    expect(store.db.meeting_files.count()).toBe(0);
    expect(store.db.chat_messages.by('channel', `meet:${m.id}`)).toHaveLength(0);
    expect(await store.db.blobs.get(`board:${m.id}`)).toBeNull();
    expect(await store.db.blobs.get(`wbf:${m.id}:p1`)).toBeNull();
    expect((await err(() => M.need(emp('1002'), m.id))).status).toBe(404);
  });
});
