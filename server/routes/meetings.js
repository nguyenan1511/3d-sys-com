// API phòng họp (server/meetings.js): lịch phòng, đặt / sửa / huỷ, cuộc họp của tôi ("Folder của tôi"), tài liệu, bảng vẽ,
// danh bạ để mời người. Vào phòng, vẽ, chat: qua WebSocket (server/meetHub.js, kênh chat meet:<id>).
import { ROOMS, SLOT, OPEN_H, CLOSE_H, MAX_INVITEES, FILE_MAX, MEETING_FILES_MAX, ALLOWED_EXT, keyOf } from '../meetings.js';
import { history } from '../social.js';
import { check, v } from '../http.js';
import { displayOf } from '../../src/shared/identity.js';

export function meetingRoutes(api, { store, hub, guards: { needAuth } }) {
  const M = hub.meetings, id = req => check(req.params, { id: v.int({ min: 1 }) }).id;
  api.get('/meetings/config', needAuth, (_req, res) => res.json({ rooms: ROOMS, slotMin: SLOT / 60e3, openH: OPEN_H, closeH: CLOSE_H, maxInvitees: MAX_INVITEES, fileMax: FILE_MAX, meetingFilesMax: MEETING_FILES_MAX, ext: ALLOWED_EXT, now: Date.now() }));
  /** Lịch phòng trong khoảng thời gian (?from=&to=, tối đa 35 ngày). */
  api.get('/meetings', needAuth, (req, res) => {
    const q = check(req.query, { from: v.int({ min: 0 }), to: v.int({ min: 0 }) }, 'yêu cầu');
    const to = Math.min(q.to, q.from + 35 * 86400e3);
    res.json({ meetings: M.range(keyOf(req.actor), q.from, to), busy: hub.meet.busy(), now: Date.now() });
  });
  api.get('/meetings/mine', needAuth, (req, res) => res.json({ meetings: M.mine(keyOf(req.actor)), now: Date.now() }));
  api.post('/meetings', needAuth, (req, res) => {
    const m = M.book(req.actor, req.body);
    hub.meet.invited(m, m.invitees); hub.broadcast({ t: 'meet:sched' });
    res.json({ ok: true, meeting: M.view(m, keyOf(req.actor)) });
  });
  api.patch('/meetings/:id', needAuth, (req, res) => {
    const { m, added, removed } = M.edit(req.actor, id(req), req.body);
    hub.meet.changed(m, removed); hub.meet.invited(m, added); hub.broadcast({ t: 'meet:sched' });
    res.json({ ok: true, meeting: M.view(m, keyOf(req.actor)) });
  });
  api.delete('/meetings/:id', needAuth, (req, res) => { const m = M.cancel(req.actor, id(req)); hub.meet.cancelled(m); hub.broadcast({ t: 'meet:sched' }); res.json({ ok: true }); });
  api.post('/meetings/:id/end', needAuth, (req, res) => { const m = M.endNow(req.actor, id(req)); hub.meet.ended(m); hub.broadcast({ t: 'meet:sched' }); res.json({ ok: true, meeting: M.view(m, keyOf(req.actor)) }); });
  api.delete('/meetings/:id/data', needAuth, async (req, res) => { const m = await M.purge(req.actor, id(req)); hub.meet.ended(m, true); hub.broadcast({ t: 'meet:sched' }); res.json({ ok: true }); });
  api.post('/meetings/:id/hide', needAuth, (req, res) => { M.hide(req.actor, id(req)); res.json({ ok: true }); });
  /** Chi tiết một cuộc họp của tôi: thông tin, tài liệu, chat, bảng vẽ (xem lại trong "Folder của tôi"). */
  api.get('/meetings/:id', needAuth, async (req, res) => {
    const m = M.need(req.actor, id(req)), key = keyOf(req.actor);
    res.json({ meeting: M.view(m, key), files: M.files(m.id), chat: history(store, `meet:${m.id}`), board: await hub.meet.board(m.id) });
  });
  /** Ảnh dán lên bảng vẽ (Excalidraw): người trong phòng gửi lên; người trong danh sách tải về (cả khi xem lại). */
  api.post('/meetings/:id/wbfile', needAuth, async (req, res) => {
    const m = M.need(req.actor, id(req)), err = await hub.meet.addFile(keyOf(req.actor), m.id, req.body);
    if (err) return res.status(400).json({ error: err });
    res.json({ ok: true });
  });
  api.get('/meetings/:id/wbfile/:fid', needAuth, async (req, res) => {
    const m = M.need(req.actor, id(req)), data = await hub.meet.getFile(m.id, String(req.params.fid));
    if (!data) return res.status(404).json({ error: 'Không còn ảnh này.' });
    res.set('Content-Type', 'application/json').set('Cache-Control', 'private, max-age=86400').send(data);
  });
  api.post('/meetings/:id/files', needAuth, async (req, res) => {
    const { m, file } = await M.addFile(req.actor, id(req), req.body || {});
    hub.meet.toRoom(m.id, { t: 'meet:files', id: m.id });
    res.json({ ok: true, file });
  });
  api.get('/meetings/:id/files/:fid', needAuth, async (req, res) => {
    const { fid } = check(req.params, { id: v.int({ min: 1 }), fid: v.int({ min: 1 }) });
    const { f, data } = await M.getFile(req.actor, id(req), fid);
    const inline = /^(image\/|application\/pdf|text\/plain)/.test(f.type) && req.query.dl !== '1';
    res.set('Content-Type', f.type).set('Content-Length', String(data.length)).set('X-Content-Type-Options', 'nosniff').set('Cache-Control', 'private, max-age=300')
      .set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
      .set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`).send(data);
  });
  api.delete('/meetings/:id/files/:fid', needAuth, async (req, res) => {
    const { fid } = check(req.params, { id: v.int({ min: 1 }), fid: v.int({ min: 1 }) });
    const m = await M.delFile(req.actor, id(req), fid);
    hub.meet.toRoom(m.id, { t: 'meet:files', id: m.id });
    res.json({ ok: true });
  });
  /** Danh bạ để mời người họp: nhân viên đang làm việc + CEO (mã, tên, phòng ban, đang online). */
  api.get('/people', needAuth, (_req, res) => {
    const people = store.db.employees.where(e => e.status === 'active').map(e => ({ key: `employee:${e.code}`, code: e.code, name: displayOf(e.code, e.name), department: e.department || '', online: hub.isOnline(e.code) }))
      .sort((a, b) => a.code < b.code ? -1 : 1);
    for (const a of store.db.admins.all()) people.unshift({ key: `admin:${a.username}`, code: '', name: `CEO (${a.username})`, department: 'Ban giám đốc', online: hub.sockets.has(`admin:${a.username}`) });
    res.json({ people });
  });
}
