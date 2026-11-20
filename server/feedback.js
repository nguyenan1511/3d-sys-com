// Góp ý & báo lỗi: nhân viên nhắn cho Admin như chat thường. Mỗi cuộc trò chuyện ("phiếu") có loại Góp ý / Báo lỗi, trạng thái
// Đang mở / Đã xử lý. Tin nhắn có chữ và / hoặc một ảnh (máy người gửi đã thu nhỏ; nội dung ảnh ở db.blobs 'fb:<mã tin>').
// Chỉ chủ phiếu và Admin xem được. Admin (mọi tài khoản quản trị) thấy mọi phiếu, trả lời, đánh dấu đã xử lý, xoá.
import { HttpError } from './store.js';
import { audit } from './db.js';

export const FB_KINDS = { idea: 'Góp ý', bug: 'Báo lỗi' };
export const FB_TEXT_MAX = 2000, FB_IMAGE_MAX = 3 * 1024 * 1024, FB_OPEN_MAX = 20, FB_MSGS_MAX = 300;
const IMG = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46], 'image/gif': [0x47, 0x49, 0x46, 0x38] };
export const keyOf = a => a.kind === 'admin' ? `admin:${a.username}` : `employee:${a.code}`;

export class Feedback {
  constructor(store, nameOf) { this.store = store; this.db = store.db; this.nameOf = nameOf; }
  isAdmin(a) { return a?.kind === 'admin'; }
  need(actor, id) {
    const t = this.db.feedback_threads.get(Number(id));
    if (!t || (!this.isAdmin(actor) && t.owner !== keyOf(actor))) throw new HttpError(404, 'Không tìm thấy cuộc trò chuyện này.', { code: 'not_found' });
    return t;
  }
  /** Phiếu theo góc nhìn của người xem (unread: tin mới bên kia chưa đọc). */
  view(t, actor) {
    const admin = this.isAdmin(actor);
    return { id: t.id, kind: t.kind, status: t.status, owner: t.owner, ownerName: t.owner_name, preview: t.preview || '', lastBy: t.last_by, createdAt: t.created_at, updatedAt: t.updated_at, count: t.count || 0, unread: !!(admin ? t.unread_admin : t.unread_user) };
  }
  msgView(m) { return { id: m.id, thread: m.thread_id, by: m.by, byName: m.by_name, admin: !!m.admin, text: m.text || '', image: m.image_v ? `/api/feedback/${m.thread_id}/img/${m.id}?v=${m.image_v}` : null, ts: m.ts }; }
  list(actor) {
    const rows = this.isAdmin(actor) ? this.db.feedback_threads.all() : this.db.feedback_threads.by('owner', keyOf(actor));
    return rows.sort((a, b) => b.updated_at - a.updated_at).map(t => this.view(t, actor));
  }
  messages(actor, id) {
    const t = this.need(actor, id);
    const flag = this.isAdmin(actor) ? 'unread_admin' : 'unread_user';
    if (t[flag]) this.db.feedback_threads.update(t.id, { [flag]: 0 });
    return { thread: this.view(this.db.feedback_threads.get(t.id), actor), messages: this.db.feedback_messages.by('thread_id', t.id).sort((a, b) => a.id - b.id).map(m => this.msgView(m)) };
  }
  /** Kiểm tra nội dung tin: chữ (≤ 2000) và / hoặc ảnh base64 (đúng loại thật, ≤ 3 MB). */
  body({ text, image } = {}) {
    const s = typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '';
    if (s.length > FB_TEXT_MAX) throw new HttpError(400, `Tin nhắn tối đa ${FB_TEXT_MAX} ký tự.`, { code: 'invalid', field: 'text' });
    let img = null;
    if (image != null) {
      const magic = IMG[image?.type];
      if (!magic || typeof image.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) throw new HttpError(400, 'Ảnh phải là JPG, PNG, WebP hoặc GIF.', { code: 'bad_type' });
      const buf = Buffer.from(image.data, 'base64');
      if (!buf.length || !magic.every((b, i) => buf[i] === b) || (image.type === 'image/webp' && buf.toString('latin1', 8, 12) !== 'WEBP')) throw new HttpError(400, 'File không phải ảnh hợp lệ.', { code: 'bad_type' });
      if (buf.length > FB_IMAGE_MAX) throw new HttpError(413, 'Ảnh tối đa 3 MB.', { code: 'too_large' });
      img = { buf, type: image.type };
    }
    if (!s && !img) throw new HttpError(400, 'Nhập nội dung hoặc gửi kèm ảnh.', { code: 'invalid', field: 'text' });
    return { text: s, img };
  }
  async add(actor, tid, raw) {
    const t = this.need(actor, tid), admin = this.isAdmin(actor), { text, img } = this.body(raw);
    if (this.db.feedback_messages.by('thread_id', t.id).length >= FB_MSGS_MAX) throw new HttpError(400, 'Cuộc trò chuyện đã quá dài — tạo cuộc mới nhé.', { code: 'limit' });
    if (img && this.db.blobs.room && !this.db.blobs.room(img.buf.length)) throw new HttpError(507, 'Bộ nhớ lưu file của công ty đã đầy — gửi chữ trước, Admin sẽ dọn bớt.', { code: 'quota' });
    const now = Date.now(), key = keyOf(actor);
    const mid = this.db.feedback_messages.insert({ thread_id: t.id, by: key, by_name: admin ? 'Admin' : this.nameOf(key), admin: admin ? 1 : 0, text, image_v: null, ts: now });
    if (img) {
      try { await this.db.blobs.put(`fb:${mid}`, img.buf, img.type); this.db.feedback_messages.update(mid, { image_v: now }); }
      catch (e) { this.db.feedback_messages.del(mid); if (e.code === 'quota') throw new HttpError(507, e.message, { code: 'quota' }); throw e; }
    }
    const preview = text ? text.slice(0, 140) : '[Ảnh]';
    this.db.feedback_threads.update(t.id, { preview, last_by: admin ? 'admin' : 'user', updated_at: now, count: (t.count || 0) + 1, ...(admin ? { unread_user: 1 } : { unread_admin: 1, status: 'open' }) });
    return { thread: this.db.feedback_threads.get(t.id), msg: this.db.feedback_messages.get(mid) };
  }
  async create(actor, { kind, ...raw } = {}) {
    if (this.isAdmin(actor)) throw new HttpError(403, 'Admin trả lời trong cuộc trò chuyện của nhân viên.', { code: 'forbidden' });
    if (!FB_KINDS[kind]) throw new HttpError(400, 'Chọn Góp ý hoặc Báo lỗi.', { code: 'invalid', field: 'kind' });
    this.body(raw);   // (kiểm tra trước khi tạo phiếu)
    const key = keyOf(actor);
    if (this.db.feedback_threads.by('owner', key).filter(t => t.status === 'open').length >= FB_OPEN_MAX) throw new HttpError(400, `Bạn đang có ${FB_OPEN_MAX} cuộc chưa xử lý — nhắn tiếp trong cuộc cũ nhé.`, { code: 'limit' });
    const now = Date.now();
    const id = this.db.feedback_threads.insert({ owner: key, owner_name: this.nameOf(key), kind, status: 'open', preview: '', last_by: 'user', created_at: now, updated_at: now, count: 0, unread_admin: 1, unread_user: 0 });
    try { const out = await this.add(actor, id, raw); audit(this.db, key, 'feedback.create', String(id), { kind }); return out; }
    catch (e) { this.db.feedback_threads.del(id); throw e; }
  }
  setStatus(actor, id, status) {
    const t = this.need(actor, id);
    if (!['open', 'done'].includes(status)) throw new HttpError(400, 'Trạng thái không hợp lệ.', { code: 'invalid' });
    if (!this.isAdmin(actor) && status !== 'done') throw new HttpError(403, 'Chỉ Admin mở lại được.', { code: 'forbidden' });   // (người gửi được đóng cuộc của mình)
    this.db.feedback_threads.update(t.id, { status, updated_at: Date.now() });
    audit(this.db, keyOf(actor), 'feedback.status', String(t.id), { status });
    return this.db.feedback_threads.get(t.id);
  }
  async remove(actor, id) {
    if (!this.isAdmin(actor)) throw new HttpError(403, 'Chỉ Admin xoá được.', { code: 'forbidden' });
    const t = this.need(actor, id), msgs = this.db.feedback_messages.by('thread_id', t.id);
    for (const m of msgs) if (m.image_v) await this.db.blobs.del(`fb:${m.id}`).catch(() => {});
    this.db.tx(() => { for (const m of msgs) this.db.feedback_messages.del(m.id); this.db.feedback_threads.del(t.id); });
    audit(this.db, keyOf(actor), 'feedback.delete', String(t.id), { owner: t.owner, kind: t.kind });
    return t;
  }
  async image(actor, tid, mid) {
    const t = this.need(actor, tid), m = this.db.feedback_messages.get(Number(mid));
    if (!m || m.thread_id !== t.id || !m.image_v) return null;
    return this.db.blobs.get(`fb:${m.id}`);
  }
  /** Số phiếu có tin mới chưa đọc (Admin: của mọi người; nhân viên: Admin trả lời). */
  unread(actor) { return this.list(actor).filter(t => t.unread).length; }
}
