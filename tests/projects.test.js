// Workspace dự án (server/projects.js, projectHub.js, meetHub.js phòng "p<id>"): quyền riêng tư (người ngoài: 404), vai trò,
// Trưởng dự án cuối cùng, Kanban (thứ tự, chuyển cột, người làm), bình luận, nhắc hạn, @nhắc tên, tài liệu, kênh chat,
// họp của dự án (mời cả dự án, tài liệu họp hiện trong dự án), nhân viên bị vô hiệu hoá, xoá dự án.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { openDb } from '../server/db.js';
import { Store, HttpError } from '../server/store.js';
import { Projects, MAX_ACTIVE, mentioned, roomOf } from '../server/projects.js';
import { ProjectHub } from '../server/projectHub.js';
import { Meetings, SLOT } from '../server/meetings.js';
import { MeetHub } from '../server/meetHub.js';
import { canUseChannel, postMessage } from '../server/social.js';
import { MemBlobs } from '../server/blobs.js';

const root = path.resolve(import.meta.dirname, '..');
const cfg = { layoutPath: path.join(root, 'public/data/layout.json'), equipmentPath: path.join(root, 'public/data/equipment.json'), appearancePath: path.join(root, 'public/data/appearance.json'), duplicatePolicy: 'online-or-name-mismatch', adminCanSitAnywhere: false };
const off = () => false;
const ADMIN = { kind: 'admin', username: 'admin' };
const emp = code => ({ kind: 'employee', code });
const K = code => `employee:${code}`;
const NAMES = { [K('1001')]: '1001-An', [K('1002')]: '1002-Bình', [K('1003')]: '1003-Chi Lê', [K('1004')]: '1004-Dũng' };
const err = async fn => { try { await fn(); } catch (e) { if (e instanceof HttpError) return e; throw e; } return null; };
const DAY9 = Date.UTC(2026, 10, 16, 2, 0);   // 09:00 giờ Việt Nam

let store, P;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(DAY9 - 3600e3);
  const db = openDb(); db.blobs = new MemBlobs();
  store = new Store(db, cfg);
  for (const n of Object.values(NAMES)) store.loginEmployee(n, off);
  db.admins.insert({ username: 'admin', pass_hash: 'x', is_initial: 0, updated_at: 1 });
  P = new Projects(store, k => NAMES[k] || k);
});
afterEach(() => vi.useRealTimers());

describe('dự án: quyền và thành viên', () => {
  it('ai cũng tạo được; người ngoài không thấy (404); CEO thấy mọi dự án; chỉ Trưởng dự án sửa / mời', async () => {
    const { p, added } = P.create(emp('1001'), { name: '  Website mới ', description: 'Làm lại web', members: [K('1002'), K('1002'), K('1001')] });
    expect(p).toMatchObject({ name: 'Website mới', status: 'active' }); expect(added).toEqual([K('1002')]);
    expect(P.members(p.id).map(m => [m.key, m.role])).toEqual([[K('1001'), 'lead'], [K('1002'), 'member']]);
    expect(P.list(emp('1003'))).toEqual([]);
    expect((await err(() => P.need(emp('1003'), p.id))).status).toBe(404);                 // (riêng tư: không lộ dự án có tồn tại)
    expect(P.list(ADMIN).map(x => x.id)).toEqual([p.id]); expect(P.need(ADMIN, p.id).role).toBe('admin');
    expect((await err(() => P.edit(emp('1002'), p.id, { name: 'x' }))).status).toBe(403);
    expect((await err(() => P.addMembers(emp('1002'), p.id, [K('1003')]))).status).toBe(403);
    expect(P.addMembers(emp('1001'), p.id, [K('1003'), K('1002')]).added).toEqual([K('1003')]);
    expect((await err(() => P.create(emp('1001'), { name: '' }))).status).toBe(400);
    expect((await err(() => P.create(emp('1001'), { name: 'x', members: ['employee:9999'] }))).status).toBe(400);
  });
  it('Trưởng dự án cuối cùng: không hạ được vai; rời đi thì người vào sớm nhất lên làm Trưởng; việc của người rời bỏ trống', async () => {
    const { p } = P.create(emp('1001'), { name: 'A', members: [K('1002'), K('1003')] });
    expect((await err(() => P.setRole(emp('1001'), p.id, K('1001'), 'member'))).extra.code).toBe('last_lead');
    const { t } = P.createTask(emp('1001'), p.id, { title: 'Việc của Chi', assignee: K('1003') });
    expect((await err(() => P.removeMember(emp('1002'), p.id, K('1003')))).status).toBe(403);   // (thành viên không xoá được người khác)
    P.removeMember(emp('1003'), p.id, K('1003'));                                              // (tự rời)
    expect(store.db.project_tasks.get(t.id).assignee).toBe(null);
    const { promoted } = P.removeMember(emp('1001'), p.id, K('1001'));
    expect(promoted).toBe(K('1002')); expect(P.members(p.id)).toEqual([expect.objectContaining({ key: K('1002'), role: 'lead' })]);
  });
  it(`mỗi người tối đa ${MAX_ACTIVE} dự án đang làm; lưu trữ = chỉ đọc, khôi phục được`, async () => {
    for (let i = 0; i < MAX_ACTIVE; i++) P.create(emp('1004'), { name: `D${i}` });
    expect((await err(() => P.create(emp('1004'), { name: 'Quá' }))).extra.code).toBe('limit');
    const first = P.list(emp('1004')).at(-1);
    P.setArchived(emp('1004'), first.id, true);
    expect((await err(() => P.createTask(emp('1004'), first.id, { title: 'x' }))).extra.code).toBe('archived');
    expect(P.create(emp('1004'), { name: 'Mới' }).p.status).toBe('active');                   // (lưu trữ thì có chỗ cho dự án mới)
    expect((await err(() => P.setArchived(emp('1004'), first.id, false))).extra.code).toBe('limit');
  });
  it('nhân viên bị vô hiệu hoá: rời mọi dự án', () => {
    const { p } = P.create(emp('1001'), { name: 'A', members: [K('1002')] });
    P.disable('1001');
    expect(P.members(p.id)).toEqual([expect.objectContaining({ key: K('1002'), role: 'lead' })]);
  });
});

describe('dự án: Kanban, bình luận, nhắc hạn', () => {
  it('thêm vào cuối cột; kéo thả theo order; chuyển cột thì xuống cuối cột mới; người làm phải là thành viên', async () => {
    const { p } = P.create(emp('1001'), { name: 'A', members: [K('1002')] });
    const a = P.createTask(emp('1001'), p.id, { title: 'A' }).t, b = P.createTask(emp('1002'), p.id, { title: 'B' }).t, c = P.createTask(emp('1001'), p.id, { title: 'C', status: 'doing' }).t;
    expect([a.order, b.order, c.order]).toEqual([1, 2, 1]);
    P.editTask(emp('1002'), p.id, b.id, { order: 0.5 });
    expect(P.tasks(p.id).filter(t => t.status === 'todo').map(t => t.title)).toEqual(['B', 'A']);
    const moved = P.editTask(emp('1002'), p.id, a.id, { status: 'doing' }).t;
    expect(moved.order).toBe(2);
    expect(P.editTask(emp('1002'), p.id, a.id, { status: 'done' }).t.done_at).toBe(Date.now());
    expect((await err(() => P.editTask(emp('1001'), p.id, a.id, { assignee: K('1003') }))).status).toBe(400);
    expect((await err(() => P.editTask(emp('1001'), p.id, a.id, { status: 'later' }))).status).toBe(400);
    expect((await err(() => P.delTask(emp('1002'), p.id, a.id))).status).toBe(403);           // (thành viên chỉ xoá việc mình tạo)
    P.delTask(emp('1002'), p.id, b.id); P.delTask(emp('1001'), p.id, a.id);
    expect(P.tasks(p.id).map(t => t.title)).toEqual(['C']);
  });
  it('việc của tôi ở mọi dự án: chưa xong, hạn gần trước; dự án lưu trữ không tính', () => {
    const a = P.create(emp('1001'), { name: 'A', members: [K('1002')] }).p, b = P.create(emp('1002'), { name: 'B' }).p;
    P.createTask(emp('1001'), a.id, { title: 'không hạn', assignee: K('1002') });
    P.createTask(emp('1001'), a.id, { title: 'gần', assignee: K('1002'), due: Date.now() + 3600e3 });
    P.createTask(emp('1002'), b.id, { title: 'xa', assignee: K('1002'), due: Date.now() + 86400e3 });
    P.createTask(emp('1002'), b.id, { title: 'xong', assignee: K('1002'), status: 'done' });
    expect(P.myTasks(emp('1002')).map(t => [t.title, t.projectName])).toEqual([['gần', 'A'], ['xa', 'B'], ['không hạn', 'A']]);
    P.setArchived(emp('1002'), b.id, true);
    expect(P.myTasks(emp('1002')).map(t => t.title)).toEqual(['gần', 'không hạn']);
  });
  it('bình luận: thành viên viết; chỉ người viết / Trưởng dự án xoá', async () => {
    const { p } = P.create(emp('1001'), { name: 'A', members: [K('1002'), K('1003')] });
    const { t } = P.createTask(emp('1001'), p.id, { title: 'A' });
    const { c } = P.addComment(emp('1002'), p.id, t.id, '  Mình làm phần này ');
    expect(c).toMatchObject({ by: K('1002'), body: 'Mình làm phần này' });
    expect((await err(() => P.delComment(emp('1003'), p.id, t.id, c.id))).status).toBe(403);
    P.delComment(emp('1001'), p.id, t.id, c.id); expect(P.task(emp('1003'), p.id, t.id).comments).toEqual([]);
  });
  it('nhắc hạn: còn ≤ 24 giờ nhắc một lần, quá hạn nhắc thêm một lần; đổi hạn thì nhắc lại', () => {
    const { p } = P.create(emp('1001'), { name: 'A', members: [K('1002')] });
    const { t } = P.createTask(emp('1001'), p.id, { title: 'Báo cáo', assignee: K('1002'), due: Date.now() + 30 * 3600e3 });
    P.createTask(emp('1001'), p.id, { title: 'Không ai làm', due: Date.now() + 3600e3 });
    expect(P.dueScan()).toEqual([]);
    vi.setSystemTime(Date.now() + 7 * 3600e3); expect(P.dueScan().map(x => x.kind)).toEqual(['soon']); expect(P.dueScan()).toEqual([]);
    vi.setSystemTime(Date.now() + 24 * 3600e3); expect(P.dueScan().map(x => x.kind)).toEqual(['over']); expect(P.dueScan()).toEqual([]);
    P.editTask(emp('1001'), p.id, t.id, { due: Date.now() + 3600e3 }); expect(P.dueScan().map(x => x.kind)).toEqual(['soon']);
    P.editTask(emp('1002'), p.id, t.id, { status: 'done' }); vi.setSystemTime(Date.now() + 2 * 3600e3); expect(P.dueScan()).toEqual([]);
  });
  it('@nhắc tên: theo mã, tên đầy đủ, tên gọi; không tính người gửi', () => {
    const ms = [{ key: K('1001'), name: '1001-An' }, { key: K('1003'), name: '1003-Chi Lê' }];
    expect(mentioned('nhờ @1001 xem', ms, K('1003'))).toEqual([K('1001')]);
    expect(mentioned('@Lê ơi', ms, K('1001'))).toEqual([K('1003')]);
    expect(mentioned('@chi lê check giúp', ms, K('1001'))).toEqual([K('1003')]);
    expect(mentioned('email an@x.com', ms, K('1003'))).toEqual([]);
    expect(mentioned('@An', ms, K('1001'))).toEqual([]);
  });
});

describe('dự án: chat, tài liệu, họp, phòng 3D, xoá', () => {
  it('kênh proj:<id>: thành viên + CEO đọc / gửi; người ngoài không; lưu trữ thì chỉ đọc', () => {
    const { p } = P.create(emp('1001'), { name: 'A', members: [K('1002')] }), ch = `proj:${p.id}`;
    expect(canUseChannel(store, emp('1002'), K('1002'), ch)).toBe(true);
    expect(canUseChannel(store, ADMIN, 'admin:admin', ch)).toBe(true);
    expect(canUseChannel(store, emp('1003'), K('1003'), ch)).toBe(false);
    expect(postMessage(store, emp('1002'), K('1002'), 'Bình', ch, 'chào')).toMatchObject({ channel: ch });
    P.setArchived(emp('1001'), p.id, true);
    expect(postMessage(store, emp('1002'), K('1002'), 'Bình', ch, 'còn ai không')).toBe(null);
    expect(canUseChannel(store, emp('1002'), K('1002'), ch)).toBe(true);
  });
  it('tài liệu: thành viên tải lên; chỉ người tải / Trưởng dự án xoá; người ngoài 404', async () => {
    const { p } = P.create(emp('1001'), { name: 'A', members: [K('1002'), K('1003')] });
    const { file } = await P.addFile(emp('1002'), p.id, { name: 'ke-hoach.pdf', data: Buffer.from('%PDF-1').toString('base64') });
    expect((await P.getFile(emp('1003'), p.id, file.id)).data.toString()).toBe('%PDF-1');
    expect((await err(() => P.getFile(emp('1004'), p.id, file.id))).status).toBe(404);
    expect((await err(() => P.addFile(emp('1002'), p.id, { name: 'virus.exe', data: 'AA==' }))).status).toBe(400);
    expect((await err(() => P.delFile(emp('1003'), p.id, file.id))).status).toBe(403);
    await P.delFile(emp('1001'), p.id, file.id); expect(P.files(p.id)).toEqual([]);
  });
  it('họp của dự án: mời cả dự án; người ngoài dự án không đặt được; tài liệu họp hiện trong dự án', async () => {
    const M = new Meetings(store, k => NAMES[k] || k); M.projects = P;
    const { p } = P.create(emp('1001'), { name: 'A', members: [K('1002'), K('1003')] });
    vi.setSystemTime(DAY9 - 3600e3);
    const m = M.book(emp('1002'), { title: 'Sprint review', start: DAY9, end: DAY9 + SLOT, projectId: p.id });
    expect(m.invitees.sort()).toEqual([K('1001'), K('1003')]); expect(m.project_id).toBe(p.id);
    expect(M.view(m, K('1003'))).toMatchObject({ projectId: p.id, projectName: 'A' });
    expect((await err(() => M.book(emp('1004'), { title: 'x', start: DAY9 + SLOT, end: DAY9 + 2 * SLOT, projectId: p.id }))).status).toBe(404);
    const { file } = await M.addFile(emp('1002'), m.id, { name: 'bien-ban.txt', data: Buffer.from('ok').toString('base64') });
    expect(P.meetingFiles(p.id)).toEqual([expect.objectContaining({ id: m.id, files: [expect.objectContaining({ id: file.id })] })]);
    P.addMembers(emp('1001'), p.id, [K('1004')]);
    expect((await P.getMeetingFile(emp('1004'), p.id, file.id)).data.toString()).toBe('ok');   // (thành viên mới của dự án xem được biên bản cũ)
    expect(P.meetings(p.id).map(x => x.id)).toEqual([m.id]);
  });
  it('phòng dự án p<id>: thành viên vào lúc nào cũng được, người ngoài không; đồng đội được báo; bảng vẽ riêng của dự án', async () => {
    const sent = new Map(), sockets = new Map();
    const sock = key => { const ws = { key, readyState: 1 }; sockets.set(key, new Set([ws])); return ws; };
    const hub = { store, sent, sockets, presence: new Map(), send: (ws, msg) => { if (!sent.has(ws.key)) sent.set(ws.key, []); sent.get(ws.key).push(msg); }, broadcast() {}, nameOf: k => NAMES[k] || k };
    const M = new Meetings(store, k => NAMES[k] || k), mh = new MeetHub(hub, M); mh.close(); mh.projects = P; hub.meet = mh;
    const ph = hub.proj = new ProjectHub(hub, P); ph.close();
    const { p } = P.create(emp('1001'), { name: 'A', members: [K('1002')] });
    const a = sock(K('1001')), b = sock(K('1002')), out = sock(K('1003'));
    await mh.onMessage(out, { t: 'meet:join', id: roomOf(p.id) });
    expect(sent.get(K('1003')).at(-1)).toMatchObject({ t: 'meetErr' });
    await mh.onMessage(a, { t: 'meet:join', id: roomOf(p.id) });
    expect(sent.get(K('1001')).find(x => x.t === 'meet:state')).toMatchObject({ id: roomOf(p.id), meeting: { kind: 'project', projectId: p.id, title: 'A' } });
    expect(sent.get(K('1002')).at(-1)).toMatchObject({ t: 'proj:room', id: p.id, who: '1001-An' });
    const el = { id: 'r1', type: 'rectangle', version: 1, versionNonce: 1, index: 'a0', x: 0, y: 0, width: 5, height: 5 };
    await mh.onMessage(a, { t: 'meet:wb', id: roomOf(p.id), elements: [el] });
    mh.leave(K('1001'), roomOf(p.id)); await mh.saveAll(); await new Promise(r => setTimeout(r, 0));
    expect((await mh.board(roomOf(p.id))).elements.map(e => e.id)).toEqual(['r1']);
    expect(await store.db.blobs.get(`board:${roomOf(p.id)}`)).toBeTruthy();
    // xoá dự án: bảng vẽ, chat, thành viên không còn
    postMessage(store, emp('1001'), K('1001'), 'An', `proj:${p.id}`, 'hi');
    const { keys } = await P.purge(emp('1001'), p.id); ph.removed(p, keys, { purged: true });
    expect(await store.db.blobs.get(`board:${roomOf(p.id)}`)).toBeFalsy();
    expect(store.db.chat_messages.by('channel', `proj:${p.id}`)).toEqual([]);
    expect(sent.get(K('1002')).at(-1)).toMatchObject({ t: 'proj:removed', purged: true });
    expect((await err(() => P.need(ADMIN, p.id))).status).toBe(404);
  });
  it('báo tin: được giao việc / bị @nhắc / sắp tới hạn — đúng người', () => {
    const sent = new Map(), sockets = new Map();
    for (const k of [K('1001'), K('1002'), K('1003')]) sockets.set(k, new Set([{ key: k, readyState: 1 }]));
    const hub = { store, sockets, send: (ws, msg) => { if (!sent.has(ws.key)) sent.set(ws.key, []); sent.get(ws.key).push(msg); }, nameOf: k => NAMES[k] || k };
    const ph = new ProjectHub(hub, P); ph.close();
    const { p } = P.create(emp('1001'), { name: 'A', members: [K('1002'), K('1003')] });
    const { t } = P.createTask(emp('1001'), p.id, { title: 'Viết spec', assignee: K('1002'), due: Date.now() + 3600e3 });
    ph.task(p, 'add', t, K('1001'));
    expect(sent.get(K('1002')).map(x => x.t)).toEqual(['proj:task', 'proj:assigned']);
    expect(sent.get(K('1003')).map(x => x.t)).toEqual(['proj:task']);
    ph.onChat({ channel: `proj:${p.id}`, from: K('1002'), body: '@Lê xem giúp nhé', id: 1, ts: 1 });
    expect(sent.get(K('1003')).at(-1)).toMatchObject({ t: 'proj:mention', project: { id: p.id } });
    ph.dueTick(); expect(sent.get(K('1002')).at(-1)).toMatchObject({ t: 'proj:due', kind: 'soon' });
  });
});
