// Workspace dự án (docs/design/projects-workspace.md): mỗi dự án = không gian làm việc lâu dài của một nhóm — thành viên,
// kênh chat riêng "proj:<id>", tài liệu, ghi chú, Kanban 3 cột, phòng dự án 3D (bảng vẽ + họp trực tuyến — server/meetHub.js,
// mã phòng "p<id>").
//  • Ai cũng tạo được dự án (người tạo = Trưởng dự án). Vai trò: lead (sửa thông tin, mời / xoá người, đổi vai trò, lưu trữ /
//    xoá dự án — có thể nhiều người) · member. Admin (admin) xem và quản lý được mọi dự án.
//  • Riêng tư: người ngoài không thấy cả tên dự án — API trả 404 (không phải 403) để không lộ dự án có tồn tại.
//  • Lưu trữ: chỉ đọc (khôi phục được). Xoá hẳn: xoá task, bình luận, chat, file, bảng vẽ (ghi nhật ký quản trị).
//  • Nhân viên bị vô hiệu hoá: tự rời mọi dự án; mất Trưởng dự án cuối cùng thì người vào sớm nhất lên làm Trưởng.
// Bảng: projects, project_members, project_tasks, task_comments, project_files (nội dung file: db.blobs 'pfile:<id>').
import { HttpError } from './store.js';
import { audit } from './db.js';
import { parseBoard } from '../src/shared/whiteboard.js';
import { ALLOWED_EXT, FILE_MAX, keyOf, quotaErr } from './meetings.js';

export const PROJECT_COLORS = ['#ef476f', '#ff8a5b', '#ffd166', '#06d6a0', '#118ab2', '#7b61ff', '#2b2d42', '#8d6e63'];
export const STATUSES = ['todo', 'doing', 'done'];
export const MAX_MEMBERS = 50, MAX_ACTIVE = 20, MAX_TASKS = 500, PROJECT_FILES_MAX = 200 * 1024 * 1024, MAX_NOTES = 200, NOTE_MAX = 20000, LOGO_MAX = 300 * 1024;
const LOGO_TYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
export const DUE_SOON = 24 * 3600e3;
const TYPES = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

/** Mã phòng dự án trong server/meetHub.js ("p12") ↔ mã dự án (12). */
export const roomOf = id => `p${id}`;
export const projectOfRoom = r => { const m = /^p(\d{1,9})$/.exec(String(r)); return m ? Number(m[1]) : null; };
export const getProject = (store, id) => { const p = store.db.projects.get(Number(id)); return p && p.status !== 'deleted' ? p : null; };
/** Vai trò của một người trong dự án: 'lead' | 'member' | 'admin' (Admin, không phải thành viên) | null. */
export function roleIn(store, p, key) {
  if (!p) return null;
  const m = store.db.project_members.by('project_id', p.id).find(r => r.key === key);
  if (m) return m.role;
  return String(key).startsWith('admin:') ? 'admin' : null;
}
export const memberKeys = (store, id) => store.db.project_members.by('project_id', Number(id)).map(r => r.key);
const notFound = () => new HttpError(404, 'Không tìm thấy dự án (hoặc bạn không còn trong dự án này).', { code: 'not_found' });
const clean = (v, max, field, label, need = false) => {
  const s = String(v ?? '').normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (need && !s) throw new HttpError(400, `Cần nhập ${label}.`, { code: 'invalid', field });
  if (s.length > max) throw new HttpError(400, `${label[0].toUpperCase()}${label.slice(1)} tối đa ${max} ký tự.`, { code: 'invalid', field });
  return s;
};

export class Projects {
  constructor(store, names) { this.store = store; this.names = names; }   // names(key) → tên hiển thị
  get db() { return this.store.db; }

  /** Người hợp lệ để mời: nhân viên đang làm việc hoặc tài khoản Admin. */
  personOk(k) {
    if (typeof k !== 'string') return false;
    if (/^employee:\d{4}$/.test(k)) return this.db.employees.get(k.slice(9))?.status === 'active';
    return /^admin:[\w.-]{1,64}$/.test(k) && !!this.db.admins.get(k.slice(6));
  }
  members(id) {
    return this.db.project_members.by('project_id', Number(id)).sort((a, b) => a.added_at - b.added_at || a.id - b.id)
      .map(r => ({ key: r.key, name: this.names(r.key), role: r.role, addedAt: r.added_at }));
  }
  /** Dự án đang hoạt động mà người này là thành viên. */
  activeCount(key) { return this.db.project_members.by('key', key).filter(r => this.db.projects.get(r.project_id)?.status === 'active').length; }

  /** Kiểm tra quyền: lead — chỉ Trưởng dự án / Admin; write — dự án chưa lưu trữ. Trả về { p, role }. */
  need(actor, id, { lead = false, write = false } = {}) {
    const key = keyOf(actor), p = getProject(this.store, id);
    const role = p ? roleIn(this.store, p, key) : null;
    if (!role) throw notFound();
    if (lead && role === 'member') throw new HttpError(403, 'Chỉ Trưởng dự án (hoặc Admin) làm được việc này.', { code: 'forbidden' });
    if (write && p.status === 'archived') throw new HttpError(400, 'Dự án đã lưu trữ — Trưởng dự án khôi phục lại để sửa tiếp.', { code: 'archived' });
    return { p, role, key };
  }
  /** Vào phòng dự án được không (thành viên / Admin, dự án đang làm). */
  canJoin(id, key) { const p = getProject(this.store, id); return !!p && p.status === 'active' && !!roleIn(this.store, p, key); }   // (lưu trữ: chỉ đọc — không vào phòng)

  view(p, key, { full = false } = {}) {
    const role = roleIn(this.store, p, key), tasks = this.db.project_tasks.by('project_id', p.id);
    const open = tasks.filter(t => t.status !== 'done');
    const now = Date.now();
    return {
      id: p.id, name: p.name, description: p.description || '', color: p.color, status: p.status, createdAt: p.created_at, updatedAt: p.updated_at, logoV: p.logo_v || null,
      role, isLead: role === 'lead' || role === 'admin', isMember: role === 'lead' || role === 'member',
      memberCount: this.db.project_members.by('project_id', p.id).length,
      lastMsg: Math.max(0, ...(this.db.chat_messages.idx.channel.get(`proj:${p.id}`) || [])),   // (đếm tin chưa đọc ở client)
      leads: this.db.project_members.by('project_id', p.id).filter(r => r.role === 'lead').map(r => ({ key: r.key, name: this.names(r.key) })),
      counts: { todo: tasks.filter(t => t.status === 'todo').length, doing: tasks.filter(t => t.status === 'doing').length, done: tasks.filter(t => t.status === 'done').length, mine: open.filter(t => t.assignee === key).length, overdue: open.filter(t => t.due && t.due < now).length },
      ...(full ? { members: this.members(p.id), notes: this.notes(p) } : {})
    };
  }
  /** Dự án của tôi (Admin: mọi dự án). Đang làm trước, mới cập nhật trước. */
  list(actor) {
    const key = keyOf(actor), mine = new Set(this.db.project_members.by('key', key).map(r => r.project_id));
    return this.db.projects.where(p => p.status !== 'deleted' && (mine.has(p.id) || actor.kind === 'admin'))
      .sort((a, b) => (a.status === 'archived') - (b.status === 'archived') || b.updated_at - a.updated_at).map(p => this.view(p, key));
  }
  touch(id) { this.db.projects.update(Number(id), { updated_at: Date.now() }); }

  cleanKeys(list, skip = []) {
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new HttpError(400, 'Danh sách thành viên không hợp lệ.', { code: 'invalid', field: 'members' });
    const out = [];
    for (const k of list) {
      if (!this.personOk(k)) throw new HttpError(400, `Không tìm thấy người (${String(k).replace(/^employee:/, '')}).`, { code: 'invalid', field: 'members' });
      if (!skip.includes(k) && !out.includes(k)) out.push(k);
    }
    return out;
  }
  checkRoom(keys) {
    const full = keys.filter(k => !k.startsWith('admin:') && this.activeCount(k) >= MAX_ACTIVE);
    if (full.length) throw new HttpError(400, `${full.map(k => this.names(k)).join(', ')} đã ở ${MAX_ACTIVE} dự án đang làm — rời bớt hoặc lưu trữ dự án cũ trước.`, { code: 'limit', field: 'members' });
  }

  // ---------- dự án ----------
  create(actor, body) {
    const key = keyOf(actor);
    const name = clean(body?.name, 80, 'name', 'tên dự án', true), description = clean(body?.description, 1000, 'description', 'mô tả');
    const color = PROJECT_COLORS.includes(body?.color) ? body.color : PROJECT_COLORS[this.db.projects.count() % PROJECT_COLORS.length];
    const others = this.cleanKeys(body?.members ?? [], [key]);
    if (others.length + 1 > MAX_MEMBERS) throw new HttpError(400, `Một dự án tối đa ${MAX_MEMBERS} người.`, { code: 'invalid', field: 'members' });
    this.checkRoom([key, ...others]);
    const now = Date.now();
    const id = this.db.tx(() => {
      const id = this.db.projects.insert({ name, description, notes: '', color, status: 'active', created_by: key, created_at: now, updated_at: now });
      this.db.project_members.insert({ project_id: id, key, role: 'lead', added_by: key, added_at: now });
      others.forEach((k, i) => this.db.project_members.insert({ project_id: id, key: k, role: 'member', added_by: key, added_at: now + i + 1 }));
      return id;
    });
    audit(this.db, key, 'project.create', String(id), { name, members: others.length + 1 });
    return { p: getProject(this.store, id), added: others };
  }
  edit(actor, id, body) {
    const { p, key } = this.need(actor, id, { lead: true, write: true }), patch = { updated_at: Date.now() };
    if (body?.name !== undefined) patch.name = clean(body.name, 80, 'name', 'tên dự án', true);
    if (body?.description !== undefined) patch.description = clean(body.description, 1000, 'description', 'mô tả');
    if (body?.color !== undefined) { if (!PROJECT_COLORS.includes(body.color)) throw new HttpError(400, 'Màu không hợp lệ.', { code: 'invalid', field: 'color' }); patch.color = body.color; }
    this.db.projects.update(p.id, patch);
    audit(this.db, key, 'project.edit', String(p.id), { name: patch.name ?? p.name });
    return getProject(this.store, p.id);
  }
  setArchived(actor, id, archived) {
    const { p, key } = this.need(actor, id, { lead: true });
    if (!archived && p.status === 'active') return p;
    if (!archived) { const keys = memberKeys(this.store, p.id); this.checkRoom(keys); }
    this.db.projects.update(p.id, { status: archived ? 'archived' : 'active', updated_at: Date.now() });
    audit(this.db, key, archived ? 'project.archive' : 'project.restore', String(p.id), { name: p.name });
    return getProject(this.store, p.id);
  }
  /** Xoá hẳn dự án cùng mọi dữ liệu (không hoàn tác). Trả về { p, keys: thành viên trước khi xoá }. */
  async purge(actor, id) {
    const { p, key } = this.need(actor, id, { lead: true }), keys = memberKeys(this.store, p.id), files = this.db.project_files.by('project_id', p.id);
    this.db.tx(() => {
      this.db.project_members.delWhere(r => r.project_id === p.id);
      this.db.task_comments.delWhere(r => r.project_id === p.id);
      this.db.project_tasks.delWhere(r => r.project_id === p.id);
      for (const f of files) this.db.project_files.del(f.id);
      this.db.chat_messages.delWhere(r => r.channel === `proj:${p.id}`);
      this.db.project_notes.delWhere(r => r.project_id === p.id);
      this.db.meetings.updateWhere(m => m.project_id === p.id, { project_id: null });
      this.db.projects.update(p.id, { status: 'deleted', description: '', notes: '', logo_v: null, updated_at: Date.now() });
    });
    const room = roomOf(p.id);
    let pics = []; try { const b = await this.db.blobs.get(`board:${room}`); if (b) pics = Object.keys(parseBoard(b.data).files); } catch { /* không có bảng */ }
    await Promise.all([...files.map(f => this.db.blobs.del(`pfile:${f.id}`)), ...pics.map(x => this.db.blobs.del(`wbf:${room}:${x}`)), this.db.blobs.del(`board:${room}`), this.db.blobs.del(`plogo:${p.id}`)].map(x => x.catch(() => {})));
    audit(this.db, key, 'project.delete', String(p.id), { name: p.name, members: keys.length, files: files.length });
    return { p, keys };
  }
  // ---------- ghi chú (nhiều tờ, kiểu Notes của macOS: dòng đầu là tiêu đề, ghim, ai trong dự án cũng sửa được) ----------
  noteView(n) { return { id: n.id, body: n.body || '', pinned: !!n.pinned, createdAt: n.created_at, updatedAt: n.updated_at, by: n.updated_by, byName: this.names(n.updated_by), createdBy: n.created_by }; }
  /** Ghi chú của dự án: ghim trước, mới sửa trước. Ghi chú một ô kiểu cũ (projects.notes) tự chuyển thành tờ đầu tiên. */
  notes(p) {
    if (p.notes && !this.db.project_notes.by('project_id', p.id).length) {
      const at = p.notes_at || p.updated_at || Date.now(), by = p.notes_by || p.created_by;
      this.db.tx(() => { this.db.project_notes.insert({ project_id: p.id, body: p.notes, pinned: 0, created_by: by, created_at: at, updated_by: by, updated_at: at }); this.db.projects.update(p.id, { notes: '' }); });
    }
    return this.db.project_notes.by('project_id', p.id).sort((a, b) => (b.pinned || 0) - (a.pinned || 0) || b.updated_at - a.updated_at).map(n => this.noteView(n));
  }
  noteText(v) {
    const s = String(v ?? '').normalize('NFC').replace(/\r\n?/g, '\n');   // (không cắt khoảng trắng: đang gõ dở xuống dòng)
    if (s.length > NOTE_MAX) throw new HttpError(400, `Một ghi chú tối đa ${NOTE_MAX} ký tự.`, { code: 'invalid', field: 'body' });
    return s;
  }
  needNote(actor, id, nid) {
    const r = this.need(actor, id, { write: true }), n = this.db.project_notes.get(Number(nid));
    if (!n || n.project_id !== r.p.id) throw new HttpError(404, 'Ghi chú này không còn.', { code: 'not_found' });
    return { ...r, n };
  }
  addNote(actor, id, body = {}) {
    const { p, key } = this.need(actor, id, { write: true });
    if (this.db.project_notes.by('project_id', p.id).length >= MAX_NOTES) throw new HttpError(400, `Một dự án tối đa ${MAX_NOTES} ghi chú — xoá bớt ghi chú cũ.`, { code: 'limit' });
    const now = Date.now(), nid = this.db.project_notes.insert({ project_id: p.id, body: this.noteText(body.body), pinned: body.pinned ? 1 : 0, created_by: key, created_at: now, updated_by: key, updated_at: now });
    this.touch(p.id); audit(this.db, key, 'project.note.add', String(p.id));
    return { p, note: this.noteView(this.db.project_notes.get(nid)) };
  }
  editNote(actor, id, nid, body = {}) {
    const { p, key, n } = this.needNote(actor, id, nid), patch = {};
    if (body.body !== undefined) { patch.body = this.noteText(body.body); patch.updated_by = key; patch.updated_at = Date.now(); }
    if (body.pinned !== undefined) patch.pinned = body.pinned ? 1 : 0;   // (ghim không đổi "sửa lần cuối")
    if (Object.keys(patch).length) this.db.project_notes.update(n.id, patch);
    if (patch.updated_at) this.touch(p.id);
    return { p, note: this.noteView(this.db.project_notes.get(n.id)) };
  }
  delNote(actor, id, nid) {
    const { p, key, n } = this.needNote(actor, id, nid);
    this.db.project_notes.del(n.id); audit(this.db, key, 'project.note.delete', String(p.id), { title: (n.body || '').split('\n')[0].slice(0, 60) });
    return { p, id: n.id };
  }

  // ---------- logo dự án (Trưởng dự án; ảnh vuông đã thu nhỏ ở máy người tải) ----------
  async setLogo(actor, id, { data, type } = {}) {
    const { p, key } = this.need(actor, id, { lead: true, write: true }), magic = LOGO_TYPES[type];
    if (!magic || typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new HttpError(400, 'Logo phải là ảnh PNG, JPG hoặc WebP.', { code: 'bad_type' });
    const buf = Buffer.from(data, 'base64');
    if (!buf.length || !magic.every((b, i) => buf[i] === b) || (type === 'image/webp' && buf.toString('latin1', 8, 12) !== 'WEBP')) throw new HttpError(400, 'File không phải ảnh hợp lệ.', { code: 'bad_type' });
    if (buf.length > LOGO_MAX) throw new HttpError(413, 'Logo tối đa 300 KB.', { code: 'too_large' });
    try { await this.db.blobs.put(`plogo:${p.id}`, buf, type); }
    catch (e) { if (e.code === 'quota') throw quotaErr(this.db); throw new HttpError(503, 'Chưa lưu được logo, thử lại sau.', { code: 'store_failed' }); }
    this.db.projects.update(p.id, { logo_v: Date.now(), updated_at: Date.now() });
    audit(this.db, key, 'project.logo', String(p.id));
    return getProject(this.store, p.id);
  }
  async dropLogo(actor, id) {
    const { p, key } = this.need(actor, id, { lead: true, write: true });
    await this.db.blobs.del(`plogo:${p.id}`).catch(() => {});
    this.db.projects.update(p.id, { logo_v: null, updated_at: Date.now() });
    audit(this.db, key, 'project.logo.delete', String(p.id));
    return getProject(this.store, p.id);
  }
  async getLogo(actor, id) {
    const { p } = this.need(actor, id); if (!p.logo_v) throw notFound();
    const b = await this.db.blobs.get(`plogo:${p.id}`); if (!b) throw notFound();
    return b;
  }

  // ---------- thành viên ----------
  addMembers(actor, id, list) {
    const { p, key } = this.need(actor, id, { lead: true, write: true });
    const have = memberKeys(this.store, p.id), add = this.cleanKeys(list, have);
    if (!add.length) return { p, added: [] };
    if (have.length + add.length > MAX_MEMBERS) throw new HttpError(400, `Một dự án tối đa ${MAX_MEMBERS} người.`, { code: 'invalid', field: 'members' });
    this.checkRoom(add);
    const now = Date.now();
    this.db.tx(() => add.forEach((k, i) => this.db.project_members.insert({ project_id: p.id, key: k, role: 'member', added_by: key, added_at: now + i })));
    this.touch(p.id);
    audit(this.db, key, 'project.members.add', String(p.id), { added: add });
    return { p, added: add };
  }
  setRole(actor, id, who, role) {
    const { p, key } = this.need(actor, id, { lead: true, write: true });
    if (!['lead', 'member'].includes(role)) throw new HttpError(400, 'Vai trò không hợp lệ.', { code: 'invalid', field: 'role' });
    const rows = this.db.project_members.by('project_id', p.id), m = rows.find(r => r.key === who);
    if (!m) throw new HttpError(404, 'Người này không còn trong dự án.', { code: 'not_found' });
    if (m.role === role) return p;
    if (role === 'member' && rows.filter(r => r.role === 'lead').length <= 1) throw new HttpError(400, 'Dự án cần ít nhất một Trưởng dự án — chọn người khác làm Trưởng trước.', { code: 'last_lead' });
    this.db.project_members.update(m.id, { role });
    this.touch(p.id);
    audit(this.db, key, 'project.role', String(p.id), { who, role });
    return p;
  }
  /** Xoá người khỏi dự án (Trưởng dự án / Admin), hoặc tự rời. Trả về { p, promoted: khoá người vừa lên làm Trưởng | null }. */
  removeMember(actor, id, who) {
    const { p, key, role } = this.need(actor, id);
    if (who !== key && role === 'member') throw new HttpError(403, 'Chỉ Trưởng dự án (hoặc Admin) được xoá người khỏi dự án.', { code: 'forbidden' });
    const out = this.drop(p, who);
    audit(this.db, key, who === key ? 'project.leave' : 'project.members.remove', String(p.id), { who });
    return out;
  }
  drop(p, who) {
    const rows = this.db.project_members.by('project_id', p.id), m = rows.find(r => r.key === who);
    if (!m) throw new HttpError(404, 'Người này không còn trong dự án.', { code: 'not_found' });
    let promoted = null;
    this.db.tx(() => {
      this.db.project_members.del(m.id);
      // việc đang giao cho người rời đi: bỏ người làm (để Trưởng dự án giao lại)
      this.db.project_tasks.updateWhere(t => t.project_id === p.id && t.assignee === who && t.status !== 'done', { assignee: null, updated_at: Date.now() });
      if (m.role === 'lead' && !rows.some(r => r.id !== m.id && r.role === 'lead')) {
        const next = rows.filter(r => r.id !== m.id).sort((a, b) => a.added_at - b.added_at || a.id - b.id)[0];
        if (next) { this.db.project_members.update(next.id, { role: 'lead' }); promoted = next.key; }
      }
    });
    this.touch(p.id);
    return { p, promoted };
  }
  /** Nhân viên bị vô hiệu hoá: rời mọi dự án. Trả về [{ p, promoted }]. */
  disable(code) {
    const key = `employee:${code}`, out = [];
    for (const r of this.db.project_members.by('key', key)) {
      const p = getProject(this.store, r.project_id); if (!p) continue;
      out.push(this.drop(p, key));
      audit(this.db, 'system', 'project.members.remove', String(p.id), { who: key, reason: 'disabled' });
    }
    return out;
  }

  // ---------- công việc (Kanban) ----------
  taskView(t, comments) {
    return { id: t.id, projectId: t.project_id, title: t.title, body: t.body || '', status: t.status, assignee: t.assignee || null, assigneeName: t.assignee ? this.names(t.assignee) : '', due: t.due || null, priority: t.priority || 0, order: t.order, createdBy: t.created_by, createdByName: this.names(t.created_by), createdAt: t.created_at, updatedAt: t.updated_at, doneAt: t.done_at || null, comments: comments ?? this.db.task_comments.by('task_id', t.id).length };
  }
  tasks(id) {
    const cnt = new Map(); for (const c of this.db.task_comments.by('project_id', Number(id))) cnt.set(c.task_id, (cnt.get(c.task_id) || 0) + 1);
    return this.db.project_tasks.by('project_id', Number(id)).sort((a, b) => a.order - b.order || a.id - b.id).map(t => this.taskView(t, cnt.get(t.id) || 0));
  }
  /** Việc chưa xong giao cho tôi ở mọi dự án đang làm (trang Tổng quan): hạn gần trước, không hạn sau. */
  myTasks(actor) {
    const key = keyOf(actor), mine = new Set(this.db.project_members.by('key', key).map(r => r.project_id));
    const out = [];
    for (const pid of mine) {
      const p = getProject(this.store, pid); if (!p || p.status !== 'active') continue;
      for (const t of this.db.project_tasks.by('project_id', pid)) if (t.assignee === key && t.status !== 'done') out.push({ ...this.taskView(t), projectName: p.name, projectColor: p.color });
    }
    return out.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || b.priority - a.priority || a.id - b.id).slice(0, 100);
  }
  lastOrder(pid, status) { return this.db.project_tasks.by('project_id', pid).filter(t => t.status === status).reduce((m, t) => Math.max(m, t.order), 0); }
  cleanTask(p, body, base = {}) {
    const out = {};
    if (body.title !== undefined || !base.id) out.title = clean(body.title, 200, 'title', 'tên công việc', true);
    if (body.body !== undefined) out.body = clean(body.body, 5000, 'body', 'mô tả');
    if (body.status !== undefined) { if (!STATUSES.includes(body.status)) throw new HttpError(400, 'Cột không hợp lệ.', { code: 'invalid', field: 'status' }); out.status = body.status; }
    if (body.assignee !== undefined) {
      if (body.assignee === null || body.assignee === '') out.assignee = null;
      else if (!memberKeys(this.store, p.id).includes(body.assignee)) throw new HttpError(400, 'Người làm phải là thành viên dự án.', { code: 'invalid', field: 'assignee' });
      else out.assignee = body.assignee;
    }
    if (body.due !== undefined) {
      if (body.due === null || body.due === '') out.due = null;
      else { const d = Number(body.due); if (!Number.isInteger(d) || d < Date.now() - 365 * 86400e3 || d > Date.now() + 3 * 365 * 86400e3) throw new HttpError(400, 'Hạn chót không hợp lệ.', { code: 'invalid', field: 'due' }); out.due = d; }
    }
    if (body.priority !== undefined) { const v = Number(body.priority); if (![0, 1, 2].includes(v)) throw new HttpError(400, 'Độ ưu tiên không hợp lệ.', { code: 'invalid', field: 'priority' }); out.priority = v; }
    if (body.order !== undefined) { const o = Number(body.order); if (!Number.isFinite(o) || Math.abs(o) > 1e12) throw new HttpError(400, 'Thứ tự không hợp lệ.', { code: 'invalid', field: 'order' }); out.order = o; }
    return out;
  }
  createTask(actor, id, body = {}) {
    const { p, key } = this.need(actor, id, { write: true });
    if (this.db.project_tasks.by('project_id', p.id).length >= MAX_TASKS) throw new HttpError(400, `Một dự án tối đa ${MAX_TASKS} công việc — xoá bớt việc đã xong.`, { code: 'limit' });
    const v = this.cleanTask(p, body), status = v.status || 'todo', now = Date.now();
    const tid = this.db.project_tasks.insert({ project_id: p.id, title: v.title, body: v.body || '', status, assignee: v.assignee ?? null, due: v.due ?? null, priority: v.priority ?? 0, order: v.order ?? this.lastOrder(p.id, status) + 1, created_by: key, created_at: now, updated_at: now, done_at: status === 'done' ? now : null, reminded: '' });
    this.touch(p.id);
    return { p, t: this.db.project_tasks.get(tid) };
  }
  needTask(p, tid) { const t = this.db.project_tasks.get(Number(tid)); if (!t || t.project_id !== p.id) throw new HttpError(404, 'Không còn công việc này.', { code: 'not_found' }); return t; }
  /** Sửa / chuyển cột / kéo thả. Trả về { p, t, before }. */
  editTask(actor, id, tid, body = {}) {
    const { p } = this.need(actor, id, { write: true }), before = this.needTask(p, tid);
    const v = this.cleanTask(p, body, before), now = Date.now(), patch = { ...v, updated_at: now };
    if (v.status && v.status !== before.status) {
      patch.done_at = v.status === 'done' ? now : null;
      if (v.order === undefined) patch.order = this.lastOrder(p.id, v.status) + 1;
    }
    if ((v.assignee !== undefined && v.assignee !== before.assignee) || (v.due !== undefined && v.due !== before.due)) patch.reminded = '';
    this.db.project_tasks.update(before.id, patch);
    this.touch(p.id);
    return { p, t: this.db.project_tasks.get(before.id), before };
  }
  delTask(actor, id, tid) {
    const { p, key, role } = this.need(actor, id, { write: true }), t = this.needTask(p, tid);
    if (role === 'member' && t.created_by !== key) throw new HttpError(403, 'Chỉ người tạo công việc hoặc Trưởng dự án được xoá.', { code: 'forbidden' });
    this.db.tx(() => { this.db.task_comments.delWhere(c => c.task_id === t.id); this.db.project_tasks.del(t.id); });
    this.touch(p.id);
    return { p, t };
  }
  comments(tid) { return this.db.task_comments.by('task_id', Number(tid)).sort((a, b) => a.ts - b.ts || a.id - b.id).map(c => ({ id: c.id, by: c.by, byName: c.by_name, body: c.body, ts: c.ts })); }
  task(actor, id, tid) { const { p } = this.need(actor, id), t = this.needTask(p, tid); return { task: this.taskView(t), comments: this.comments(t.id) }; }
  addComment(actor, id, tid, body) {
    const { p, key } = this.need(actor, id, { write: true }), t = this.needTask(p, tid);
    const text = clean(body, 2000, 'body', 'bình luận', true);
    const cid = this.db.task_comments.insert({ task_id: t.id, project_id: p.id, by: key, by_name: this.names(key), body: text, ts: Date.now() });
    this.db.project_tasks.update(t.id, { updated_at: Date.now() });
    return { p, t, c: this.comments(t.id).find(c => c.id === cid) };
  }
  delComment(actor, id, tid, cid) {
    const { p, key, role } = this.need(actor, id, { write: true }), t = this.needTask(p, tid), c = this.db.task_comments.get(Number(cid));
    if (!c || c.task_id !== t.id) throw new HttpError(404, 'Không còn bình luận này.', { code: 'not_found' });
    if (c.by !== key && role === 'member') throw new HttpError(403, 'Chỉ người viết hoặc Trưởng dự án được xoá bình luận.', { code: 'forbidden' });
    this.db.task_comments.del(c.id);
    return { p, t };
  }
  /** Nhắc hạn: việc chưa xong có người làm — còn ≤ 24 giờ ('soon') hoặc đã quá hạn ('over'); mỗi mốc nhắc một lần. */
  dueScan(now = Date.now()) {
    const out = [];
    for (const t of this.db.project_tasks.where(t => t.status !== 'done' && t.assignee && t.due)) {
      const p = getProject(this.store, t.project_id); if (!p || p.status !== 'active') continue;
      const kind = t.due <= now ? 'over' : t.due - now <= DUE_SOON ? 'soon' : null; if (!kind) continue;
      const mark = `${kind}:${t.due}`; if (String(t.reminded || '').includes(mark)) continue;
      this.db.project_tasks.update(t.id, { reminded: kind === 'over' ? `soon:${t.due} ${mark}` : mark });
      out.push({ p, t: this.db.project_tasks.get(t.id), kind });
    }
    return out;
  }

  // ---------- tài liệu ----------
  files(id) { return this.db.project_files.by('project_id', Number(id)).sort((a, b) => b.ts - a.ts).map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size, by: f.by, byName: f.by_name, ts: f.ts, kind: f.kind || 'file' })); }
  /** Tài liệu của các cuộc họp thuộc dự án (không chép — đọc thẳng từ meeting_files). */
  meetingFiles(id) {
    const ms = this.db.meetings.where(m => m.project_id === Number(id) && m.status !== 'deleted');
    return ms.sort((a, b) => b.start - a.start).map(m => ({ id: m.id, title: m.title, start: m.start, end: m.end, files: this.db.meeting_files.by('meeting_id', m.id).sort((a, b) => b.ts - a.ts).map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size, by: f.by, byName: f.by_name, ts: f.ts, kind: f.kind || 'file' })) }))
      .filter(m => m.files.length);
  }
  meetings(id) {
    return this.db.meetings.where(m => m.project_id === Number(id) && m.status === 'booked').sort((a, b) => a.start - b.start)
      .map(m => ({ id: m.id, title: m.title, start: m.start, end: m.end, hostName: m.host_name }));
  }
  async addFile(actor, id, { name, data, kind }) {
    const { p, key } = this.need(actor, id, { write: true });
    const nm = String(name || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 120);
    const ext = (nm.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    if (!nm || !TYPES[ext]) throw new HttpError(400, `Chỉ nhận file: ${ALLOWED_EXT.join(', ')}.`, { code: 'bad_type' });
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new HttpError(400, 'Nội dung file không hợp lệ.', { code: 'invalid' });
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) throw new HttpError(400, 'File trống.', { code: 'invalid' });
    if (buf.length > FILE_MAX) throw new HttpError(413, 'Mỗi file tối đa 5 MB.', { code: 'too_large' });
    const used = this.db.project_files.by('project_id', p.id).reduce((s, f) => s + f.size, 0);
    if (used + buf.length > PROJECT_FILES_MAX) throw new HttpError(413, 'Tài liệu của dự án đã đủ 200 MB — xoá bớt file cũ.', { code: 'too_large' });
    if (this.db.blobs.room && !this.db.blobs.room(buf.length)) throw quotaErr(this.db);
    const fid = this.db.project_files.insert({ project_id: p.id, name: nm, type: TYPES[ext], size: buf.length, by: key, by_name: this.names(key), ts: Date.now(), kind: kind === 'board' ? 'board' : 'file' });
    try { await this.db.blobs.put(`pfile:${fid}`, buf, TYPES[ext]); }
    catch (e) { this.db.project_files.del(fid); if (e.code === 'quota') throw quotaErr(this.db); throw new HttpError(503, 'Chưa lưu được file, thử lại sau.', { code: 'store_failed', detail: e.message }); }
    this.touch(p.id);
    audit(this.db, key, 'project.file.add', String(p.id), { name: nm, size: buf.length });
    return { p, file: this.files(p.id).find(f => f.id === fid) };
  }
  async getFile(actor, id, fid) {
    const { p } = this.need(actor, id), f = this.db.project_files.get(Number(fid));
    if (!f || f.project_id !== p.id) throw new HttpError(404, 'Không còn file này.', { code: 'not_found' });
    const b = await this.db.blobs.get(`pfile:${f.id}`); if (!b) throw new HttpError(404, 'Không đọc được nội dung file.', { code: 'not_found' });
    return { f, data: b.data };
  }
  /** File của một cuộc họp thuộc dự án (thành viên dự án xem được, kể cả khi không được mời họp). */
  async getMeetingFile(actor, id, fid) {
    const { p } = this.need(actor, id), f = this.db.meeting_files.get(Number(fid)), m = f && this.db.meetings.get(f.meeting_id);
    if (!f || !m || m.project_id !== p.id || m.status === 'deleted') throw new HttpError(404, 'Không còn file này.', { code: 'not_found' });
    const b = await this.db.blobs.get(`file:${f.id}`); if (!b) throw new HttpError(404, 'Không đọc được nội dung file.', { code: 'not_found' });
    return { f, data: b.data };
  }
  async delFile(actor, id, fid) {
    const { p, key, role } = this.need(actor, id, { write: true }), f = this.db.project_files.get(Number(fid));
    if (!f || f.project_id !== p.id) throw new HttpError(404, 'Không còn file này.', { code: 'not_found' });
    if (f.by !== key && role === 'member') throw new HttpError(403, 'Chỉ người tải lên hoặc Trưởng dự án được xoá file.', { code: 'forbidden' });
    this.db.project_files.del(f.id); await this.db.blobs.del(`pfile:${f.id}`).catch(() => {});
    audit(this.db, key, 'project.file.delete', String(p.id), { name: f.name });
    return p;
  }
}

/** Tên được @nhắc trong tin nhắn: "@Lan", "@1234", "@Nguyễn Văn A" → khoá thành viên được nhắc (không tính người gửi). */
export function mentioned(text, members, from) {
  const t = String(text || '').normalize('NFC').toLowerCase(); if (!t.includes('@')) return [];
  const out = [];
  for (const m of members) {
    if (m.key === from) continue;
    const name = String(m.name || '').normalize('NFC').toLowerCase(), code = m.key.startsWith('employee:') ? m.key.slice(9) : '';
    const bare = name.replace(/^\d{4}-/, ''), last = bare.split(/\s+/).pop();
    if ((code && t.includes(`@${code}`)) || (bare && t.includes(`@${bare}`)) || (last && last.length >= 2 && new RegExp(`@${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(t))) out.push(m.key);
  }
  return out;
}
