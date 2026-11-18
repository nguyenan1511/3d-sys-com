// API workspace dự án (server/projects.js — quyền, dữ liệu; server/projectHub.js — báo tin realtime).
// Chat dự án: WebSocket (kênh proj:<id>) + GET /api/chat/proj:<id>. Phòng dự án: WebSocket meet:join {id: "p<id>"}.
import { PROJECT_COLORS, MAX_MEMBERS, MAX_TASKS, PROJECT_FILES_MAX, roomOf } from '../projects.js';
import { FILE_MAX, ALLOWED_EXT, keyOf } from '../meetings.js';
import { history } from '../social.js';
import { check, v } from '../http.js';

const sendFile = (req, res, f, data) => {
  const inline = /^(image\/|application\/pdf|text\/plain)/.test(f.type) && req.query.dl !== '1';
  res.set('Content-Type', f.type).set('Content-Length', String(data.length)).set('X-Content-Type-Options', 'nosniff').set('Cache-Control', 'private, max-age=300')
    .set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
    .set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`).send(data);
};

export function projectRoutes(api, { store, hub, guards: { needAuth } }) {
  const P = hub.projects, H = hub.proj;
  const id = req => check(req.params, { id: v.int({ min: 1 }) }, 'yêu cầu').id;
  const sub = (req, name) => check(req.params, { id: v.int({ min: 1 }), [name]: v.int({ min: 1 }) }, 'yêu cầu')[name];
  const me = req => keyOf(req.actor);

  api.get('/projects/config', needAuth, (_req, res) => res.json({ colors: PROJECT_COLORS, maxMembers: MAX_MEMBERS, maxTasks: MAX_TASKS, fileMax: FILE_MAX, filesMax: PROJECT_FILES_MAX, ext: ALLOWED_EXT }));
  /** Dự án của tôi (CEO: mọi dự án) — thẻ trong danh sách. */
  api.get('/projects', needAuth, (req, res) => res.json({ projects: P.list(req.actor), now: Date.now() }));
  api.post('/projects', needAuth, (req, res) => {
    const { p, added } = P.create(req.actor, req.body);
    H.invited(p, added, me(req));
    res.json({ ok: true, project: P.view(p, me(req), { full: true }) });
  });
  /** Toàn bộ một dự án: thông tin, thành viên, ghi chú, công việc, tài liệu, cuộc họp sắp tới, người đang trong phòng. */
  api.get('/projects/:id', needAuth, (req, res) => {
    const { p } = P.need(req.actor, id(req)), key = me(req);
    const room = hub.meet.rooms.get(roomOf(p.id));
    res.json({ project: P.view(p, key, { full: true }), tasks: P.tasks(p.id), files: P.files(p.id), meetingFiles: P.meetingFiles(p.id), meetings: P.meetings(p.id), inRoom: room ? hub.meet.members(roomOf(p.id)) : [], online: P.members(p.id).filter(m => hub.sockets.has(m.key)).map(m => m.key), now: Date.now() });
  });
  api.patch('/projects/:id', needAuth, (req, res) => {
    const pid = id(req);
    let p;
    if (req.body?.archived !== undefined) p = P.setArchived(req.actor, pid, !!req.body.archived);
    const rest = { ...req.body }; delete rest.archived;
    if (Object.keys(rest).length) p = P.edit(req.actor, pid, rest);
    if (!p) p = P.need(req.actor, pid).p;
    H.changed(p.id);
    res.json({ ok: true, project: P.view(p, me(req), { full: true }) });
  });
  api.delete('/projects/:id', needAuth, async (req, res) => {
    const { p, keys } = await P.purge(req.actor, id(req));
    H.removed(p, keys, { purged: true });
    for (const k of hub.sockets.keys()) if (k.startsWith('admin:') && !keys.includes(k)) H.sendKey(k, { t: 'proj:removed', id: p.id, name: p.name, purged: true, quiet: true });
    res.json({ ok: true });
  });
  api.put('/projects/:id/notes', needAuth, (req, res) => {
    const pid = id(req), out = P.setNotes(req.actor, pid, req.body?.notes);
    H.toProject(pid, { t: 'proj:notes', id: pid, ...out, by: me(req) });
    res.json({ ok: true, ...out });
  });

  // ---------- thành viên ----------
  api.post('/projects/:id/members', needAuth, (req, res) => {
    const { p, added } = P.addMembers(req.actor, id(req), req.body?.keys);
    if (added.length) H.invited(p, added, me(req));
    res.json({ ok: true, added: added.length, members: P.members(p.id) });
  });
  api.patch('/projects/:id/members/:key', needAuth, (req, res) => {
    const p = P.setRole(req.actor, id(req), String(req.params.key), req.body?.role);
    H.changed(p.id);
    res.json({ ok: true, members: P.members(p.id) });
  });
  /** Xoá người khỏi dự án (Trưởng dự án / CEO) hoặc tự rời (key = chính mình). */
  api.delete('/projects/:id/members/:key', needAuth, (req, res) => {
    const who = String(req.params.key), { p } = P.removeMember(req.actor, id(req), who);
    H.removed(p, [who]);
    res.json({ ok: true });
  });

  // ---------- công việc ----------
  api.post('/projects/:id/tasks', needAuth, (req, res) => {
    const { p, t } = P.createTask(req.actor, id(req), req.body || {});
    H.task(p, 'add', t, me(req));
    res.json({ ok: true, task: P.taskView(t) });
  });
  api.get('/projects/:id/tasks/:tid', needAuth, (req, res) => res.json(P.task(req.actor, id(req), sub(req, 'tid'))));
  api.patch('/projects/:id/tasks/:tid', needAuth, (req, res) => {
    const { p, t, before } = P.editTask(req.actor, id(req), sub(req, 'tid'), req.body || {});
    H.task(p, 'edit', t, me(req), before);
    res.json({ ok: true, task: P.taskView(t) });
  });
  api.delete('/projects/:id/tasks/:tid', needAuth, (req, res) => {
    const { p, t } = P.delTask(req.actor, id(req), sub(req, 'tid'));
    H.task(p, 'del', t, me(req));
    res.json({ ok: true });
  });
  api.post('/projects/:id/tasks/:tid/comments', needAuth, (req, res) => {
    const { p, t, c } = P.addComment(req.actor, id(req), sub(req, 'tid'), req.body?.body);
    H.toProject(p.id, { t: 'proj:comment', id: p.id, taskId: t.id, comment: c, count: P.comments(t.id).length });
    res.json({ ok: true, comment: c });
  });
  api.delete('/projects/:id/tasks/:tid/comments/:cid', needAuth, (req, res) => {
    const { cid } = check(req.params, { id: v.int({ min: 1 }), tid: v.int({ min: 1 }), cid: v.int({ min: 1 }) }, 'yêu cầu');
    const { p, t } = P.delComment(req.actor, id(req), sub(req, 'tid'), cid);
    H.toProject(p.id, { t: 'proj:comment', id: p.id, taskId: t.id, removed: cid, count: P.comments(t.id).length });
    res.json({ ok: true });
  });

  // ---------- tài liệu ----------
  api.post('/projects/:id/files', needAuth, async (req, res) => {
    const { p, file } = await P.addFile(req.actor, id(req), req.body || {});
    H.toProject(p.id, { t: 'proj:files', id: p.id }); hub.meet.toRoom(roomOf(p.id), { t: 'meet:files', id: roomOf(p.id) });
    res.json({ ok: true, file });
  });
  api.get('/projects/:id/files/:fid', needAuth, async (req, res) => { const { f, data } = await P.getFile(req.actor, id(req), sub(req, 'fid')); sendFile(req, res, f, data); });
  api.get('/projects/:id/mfiles/:fid', needAuth, async (req, res) => { const { f, data } = await P.getMeetingFile(req.actor, id(req), sub(req, 'fid')); sendFile(req, res, f, data); });
  api.delete('/projects/:id/files/:fid', needAuth, async (req, res) => {
    const p = await P.delFile(req.actor, id(req), sub(req, 'fid'));
    H.toProject(p.id, { t: 'proj:files', id: p.id }); hub.meet.toRoom(roomOf(p.id), { t: 'meet:files', id: roomOf(p.id) });
    res.json({ ok: true });
  });

  // ---------- phòng dự án: bảng vẽ ----------
  /** Bảng vẽ của dự án (xem trong bảng dự án khi không ở trong phòng). */
  api.get('/projects/:id/board', needAuth, async (req, res) => { const { p } = P.need(req.actor, id(req)); res.json({ board: await hub.meet.board(roomOf(p.id)) }); });
  api.post('/projects/:id/wbfile', needAuth, async (req, res) => {
    const { p } = P.need(req.actor, id(req), { write: true }), err = await hub.meet.addFile(me(req), roomOf(p.id), req.body);
    if (err) return res.status(400).json({ error: err });
    res.json({ ok: true });
  });
  api.get('/projects/:id/wbfile/:fid', needAuth, async (req, res) => {
    const { p } = P.need(req.actor, id(req)), data = await hub.meet.getFile(roomOf(p.id), String(req.params.fid));
    if (!data) return res.status(404).json({ error: 'Không còn ảnh này.' });
    res.set('Content-Type', 'application/json').set('Cache-Control', 'private, max-age=86400').send(data);
  });
  /** Chat dự án (lịch sử) — gói cùng để bảng dự án mở một lần là có đủ. */
  api.get('/projects/:id/chat', needAuth, (req, res) => { const { p } = P.need(req.actor, id(req)); res.json({ messages: history(store, `proj:${p.id}`) }); });
}
