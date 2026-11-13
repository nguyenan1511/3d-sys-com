// Đặt phòng họp: lịch theo khung 30 phút (giờ Việt Nam, 07:00–21:00), người đặt (host) mời người tham dự.
//  • Chỉ host + người được mời vào được phòng (từ 10 phút trước giờ họp tới hết giờ); đúng giờ server nhắn cho từng người
//    (server/meetHub.js). Trong phòng: kênh chat riêng "meet:<id>" (bảng chat_messages), bảng vẽ chung, tài liệu.
//  • "Folder của tôi": mọi cuộc họp mình đặt / được mời — xem lại tài liệu, bảng vẽ, chat của cuộc họp đó (cả sau khi họp xong).
//  • Host sửa / huỷ được lịch của mình; CEO huỷ được mọi lịch. Không hai lịch trùng giờ trong cùng một phòng.
// Bảng meetings: { id, room, title, agenda, start, end, host, host_name, invitees: [khoá phiên], status: 'booked'|'cancelled',
//   created_at, updated_at }. Bảng meeting_files: { id, meeting_id, name, type, size, by, by_name, ts } (nội dung: db.blobs 'file:<id>').
import { HttpError } from './store.js';
import { audit } from './db.js';
import { parseBoard } from '../src/shared/whiteboard.js';

export const ROOMS = [{ id: 'MR1', name: 'Phòng họp tầng trệt', seats: 5, floor: 0 }];
export const SLOT = 30 * 60e3, OPEN_H = 7, CLOSE_H = 21, MAX_LEN = 4 * 3600e3, AHEAD = 30 * 86400e3, EARLY = 10 * 60e3;
export const MAX_INVITEES = 20, FILE_MAX = 5 * 1024 * 1024, MEETING_FILES_MAX = 30 * 1024 * 1024;
const VN = 7 * 3600e3;
/** Giờ trong ngày (giờ Việt Nam, đơn vị giờ thập phân) của một mốc thời gian. */
const vnHour = t => (((t + VN) % 86400e3) + 86400e3) % 86400e3 / 3600e3;
export const keyOf = a => a.kind === 'admin' ? `admin:${a.username}` : `employee:${a.code}`;

/** Loại file cho phép (tài liệu văn phòng, ảnh, PDF, văn bản). */
const TYPES = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};
export const ALLOWED_EXT = Object.keys(TYPES);

export const isParticipant = (m, key) => !!m && (m.host === key || (m.invitees || []).includes(key));
const arr = v => typeof v === 'string' ? JSON.parse(v) : (v || []);
const parse = r => r && ({ ...r, invitees: arr(r.invitees), hidden: arr(r.hidden) });
export const getMeeting = (store, id) => parse(store.db.meetings.get(Number(id)));
/** Đang trong giờ vào phòng (10 phút trước giờ họp → hết giờ). */
export const isOpen = (m, now = Date.now()) => m.status === 'booked' && now >= m.start - EARLY && now < m.end;

export class Meetings {
  constructor(store, names) { this.store = store; this.names = names; }   // names(key) → tên hiển thị
  get db() { return this.store.db; }
  all() { return this.db.meetings.all().map(parse); }

  view(m, key, now = Date.now()) {
    const mine = isParticipant(m, key);
    const room = ROOMS.find(r => r.id === m.room);
    return {
      id: m.id, room: m.room, roomName: room?.name || m.room, title: m.title, start: m.start, end: m.end, host: m.host, hostName: m.host_name, status: m.status,
      isHost: m.host === key, invited: mine, open: isOpen(m, now), past: now >= m.end,
      // người ngoài chỉ thấy phòng đã có người đặt (tên cuộc họp, host) — không thấy danh sách mời, nội dung
      ...(mine ? { agenda: m.agenda || '', invitees: m.invitees.map(k => ({ key: k, name: this.names(k) })), files: this.db.meeting_files.by('meeting_id', m.id).length } : {})
    };
  }
  /** Lịch phòng trong khoảng [from, to) (mọi người xem được để chọn giờ trống). */
  range(key, from, to) { return this.all().filter(m => m.status === 'booked' && m.end > from && m.start < to).sort((a, b) => a.start - b.start).map(m => this.view(m, key)); }
  /** Cuộc họp của tôi (đặt / được mời), gần đây trước. */
  mine(key) { return this.all().filter(m => isParticipant(m, key) && m.status === 'booked' && !m.hidden.includes(key)).sort((a, b) => b.start - a.start).map(m => this.view(m, key)); }

  cleanInvitees(list, host) {
    if (list === undefined) return undefined;
    if (!Array.isArray(list)) throw new HttpError(400, 'Danh sách người mời không hợp lệ.', { code: 'invalid', field: 'invitees' });
    const out = [];
    for (const k of list) {
      if (typeof k !== 'string') continue;
      const ok = /^employee:\d{4}$/.test(k) ? !!this.db.employees.get(k.slice(9)) && this.db.employees.get(k.slice(9)).status === 'active' : /^admin:[\w.-]{1,64}$/.test(k) && !!this.db.admins.get(k.slice(6));
      if (!ok) throw new HttpError(400, `Không tìm thấy người được mời (${k.replace(/^employee:/, '')}).`, { code: 'invalid', field: 'invitees' });
      if (k !== host && !out.includes(k)) out.push(k);
    }
    if (out.length > MAX_INVITEES) throw new HttpError(400, `Mời tối đa ${MAX_INVITEES} người.`, { code: 'invalid', field: 'invitees' });
    return out;
  }
  checkTime(room, start, end, skipId = null) {
    const now = Date.now();
    if (!ROOMS.some(r => r.id === room)) throw new HttpError(400, 'Phòng họp không hợp lệ.', { code: 'invalid', field: 'room' });
    if (!Number.isInteger(start) || !Number.isInteger(end) || start % SLOT || end % SLOT) throw new HttpError(400, 'Giờ họp phải theo khung 30 phút.', { code: 'invalid', field: 'start' });
    if (end <= start) throw new HttpError(400, 'Giờ kết thúc phải sau giờ bắt đầu.', { code: 'invalid', field: 'end' });
    if (end - start > MAX_LEN) throw new HttpError(400, 'Một cuộc họp dài tối đa 4 giờ.', { code: 'invalid', field: 'end' });
    if (end <= now) throw new HttpError(400, 'Khung giờ này đã qua.', { code: 'invalid', field: 'start' });
    if (start < Math.floor(now / SLOT) * SLOT) throw new HttpError(400, 'Giờ bắt đầu đã qua — chọn khung giờ khác.', { code: 'invalid', field: 'start' });
    if (start > now + AHEAD) throw new HttpError(400, 'Chỉ đặt trước tối đa 30 ngày.', { code: 'invalid', field: 'start' });
    const h0 = vnHour(start), h1 = vnHour(end) || 24, sameDay = Math.floor((start + VN) / 86400e3) === Math.floor((end - 1 + VN) / 86400e3);
    if (!sameDay || h0 < OPEN_H || h1 > CLOSE_H) throw new HttpError(400, `Phòng họp mở từ ${String(OPEN_H).padStart(2, '0')}:00 đến ${CLOSE_H}:00.`, { code: 'invalid', field: 'start' });
    const clash = this.all().find(m => m.id !== skipId && m.room === room && m.status === 'booked' && m.start < end && m.end > start);
    if (clash) throw new HttpError(409, `Phòng đã có lịch "${clash.title}" (${clash.host_name}) trùng giờ này.`, { code: 'clash' });
  }
  text(v, max, field, need = false) {
    const s = String(v ?? '').normalize('NFC').replace(/\r\n?/g, '\n').trim();
    if (need && !s) throw new HttpError(400, 'Cần nhập tên cuộc họp.', { code: 'invalid', field });
    if (s.length > max) throw new HttpError(400, `${field === 'title' ? 'Tên cuộc họp' : 'Nội dung'} tối đa ${max} ký tự.`, { code: 'invalid', field });
    return s;
  }

  book(actor, body) {
    const key = keyOf(actor), room = String(body?.room || ROOMS[0].id), start = Number(body?.start), end = Number(body?.end);
    const title = this.text(body?.title, 120, 'title', true), agenda = this.text(body?.agenda, 1000, 'agenda');
    const invitees = this.cleanInvitees(body?.invitees ?? [], key);
    this.checkTime(room, start, end);
    const now = Date.now();
    const id = this.db.meetings.insert({ room, title, agenda, start, end, host: key, host_name: this.names(key), invitees: JSON.stringify(invitees), status: 'booked', created_at: now, updated_at: now });
    audit(this.db, key, 'meeting.book', String(id), { room, title, start, end, invitees: invitees.length });
    return getMeeting(this.store, id);
  }
  /** Host sửa lịch: tên, nội dung, giờ, người mời. Trả về { m, added } (added: người mới được mời). */
  edit(actor, id, body) {
    const key = keyOf(actor), m = getMeeting(this.store, id);
    if (!m || m.status !== 'booked') throw new HttpError(404, 'Không còn lịch họp này.', { code: 'not_found' });
    if (m.host !== key) throw new HttpError(403, 'Chỉ người đặt phòng được sửa lịch.', { code: 'forbidden' });
    if (Date.now() >= m.end) throw new HttpError(400, 'Cuộc họp đã kết thúc.', { code: 'ended' });
    const next = { ...m };
    if (body?.title !== undefined) next.title = this.text(body.title, 120, 'title', true);
    if (body?.agenda !== undefined) next.agenda = this.text(body.agenda, 1000, 'agenda');
    const inv = this.cleanInvitees(body?.invitees, key); if (inv) next.invitees = inv;
    if (body?.start !== undefined || body?.end !== undefined) {
      next.start = Number(body.start ?? m.start); next.end = Number(body.end ?? m.end);
      if (next.start !== m.start || next.end !== m.end) this.checkTime(m.room, next.start, next.end, m.id);
    }
    this.db.meetings.update(m.id, { title: next.title, agenda: next.agenda, start: next.start, end: next.end, invitees: JSON.stringify(next.invitees), updated_at: Date.now() });
    audit(this.db, key, 'meeting.edit', String(m.id), { title: next.title, invitees: next.invitees.length });
    return { m: getMeeting(this.store, m.id), added: next.invitees.filter(k => !m.invitees.includes(k)), removed: m.invitees.filter(k => !next.invitees.includes(k)) };
  }
  cancel(actor, id) {
    const key = keyOf(actor), m = getMeeting(this.store, id);
    if (!m || m.status !== 'booked') throw new HttpError(404, 'Không còn lịch họp này.', { code: 'not_found' });
    if (m.host !== key && actor.kind !== 'admin') throw new HttpError(403, 'Chỉ người đặt phòng (hoặc CEO) được huỷ lịch.', { code: 'forbidden' });
    this.db.meetings.update(m.id, { status: 'cancelled', updated_at: Date.now() });
    audit(this.db, key, 'meeting.cancel', String(m.id), { title: m.title });
    return m;
  }
  /** Host / CEO kết thúc cuộc họp sớm: giờ kết thúc = bây giờ (phòng trống ngay). Chưa tới giờ họp thì coi như huỷ. */
  endNow(actor, id) {
    const key = keyOf(actor), m = getMeeting(this.store, id), now = Date.now();
    if (!m || m.status !== 'booked') throw new HttpError(404, 'Không còn cuộc họp này.', { code: 'not_found' });
    if (m.host !== key && actor.kind !== 'admin') throw new HttpError(403, 'Chỉ host (hoặc CEO) được kết thúc cuộc họp.', { code: 'forbidden' });
    if (now >= m.end) throw new HttpError(400, 'Cuộc họp đã kết thúc.', { code: 'ended' });
    if (now < m.start) this.db.meetings.update(m.id, { status: 'cancelled', updated_at: now });
    else this.db.meetings.update(m.id, { end: now, ended_early: 1, updated_at: now });
    audit(this.db, key, 'meeting.end', String(m.id), { title: m.title });
    return getMeeting(this.store, m.id);
  }
  /** Host / CEO xoá cuộc họp cùng toàn bộ dữ liệu (tài liệu, bảng vẽ, chat). Không hoàn tác được. */
  async purge(actor, id) {
    const key = keyOf(actor), m = getMeeting(this.store, id);
    if (!m || m.status === 'deleted') throw new HttpError(404, 'Không còn cuộc họp này.', { code: 'not_found' });
    if (m.host !== key && actor.kind !== 'admin') throw new HttpError(403, 'Chỉ host (hoặc CEO) được xoá cuộc họp và dữ liệu. Bạn có thể ẩn cuộc họp khỏi folder của mình.', { code: 'forbidden' });
    const files = this.db.meeting_files.by('meeting_id', m.id);
    this.db.tx(() => {
      for (const f of files) this.db.meeting_files.del(f.id);
      this.db.chat_messages.delWhere(r => r.channel === `meet:${m.id}`);
      this.db.meetings.update(m.id, { status: 'deleted', agenda: '', updated_at: Date.now() });
    });
    let pics = []; try { const b = await this.db.blobs.get(`board:${m.id}`); if (b) pics = Object.keys(parseBoard(b.data).files); } catch { /* không có bảng */ }
    await Promise.all([...files.map(f => this.db.blobs.del(`file:${f.id}`)), ...pics.map(p => this.db.blobs.del(`wbf:${m.id}:${p}`)), this.db.blobs.del(`board:${m.id}`)].map(p => p.catch(() => {})));
    audit(this.db, key, 'meeting.delete', String(m.id), { title: m.title, files: files.length });
    return m;
  }
  /** Người được mời ẩn cuộc họp khỏi "Folder của tôi" (dữ liệu vẫn còn cho người khác). */
  hide(actor, id) {
    const key = keyOf(actor), m = this.need(actor, id);
    if (!m.hidden.includes(key)) this.db.meetings.update(m.id, { hidden: JSON.stringify([...m.hidden, key]) });
    return m;
  }
  need(actor, id) {
    const m = getMeeting(this.store, id);
    if (!m || m.status !== 'booked') throw new HttpError(404, 'Không còn cuộc họp này.', { code: 'not_found' });
    if (!isParticipant(m, keyOf(actor))) throw new HttpError(403, 'Bạn không có trong danh sách cuộc họp này.', { code: 'forbidden' });
    return m;
  }

  // ---------- tài liệu ----------
  files(id) { return this.db.meeting_files.by('meeting_id', Number(id)).sort((a, b) => b.ts - a.ts).map(f => ({ id: f.id, name: f.name, type: f.type, size: f.size, by: f.by, byName: f.by_name, ts: f.ts, kind: f.kind || 'file' })); }
  async addFile(actor, id, { name, data, kind }) {
    const m = this.need(actor, id), key = keyOf(actor);
    const clean = String(name || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 120);
    const ext = (clean.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    if (!clean || !TYPES[ext]) throw new HttpError(400, `Chỉ nhận file: ${ALLOWED_EXT.join(', ')}.`, { code: 'bad_type' });
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new HttpError(400, 'Nội dung file không hợp lệ.', { code: 'invalid' });
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) throw new HttpError(400, 'File trống.', { code: 'invalid' });
    if (buf.length > FILE_MAX) throw new HttpError(413, 'Mỗi file tối đa 5 MB.', { code: 'too_large' });
    const used = this.db.meeting_files.by('meeting_id', m.id).reduce((s, f) => s + f.size, 0);
    if (used + buf.length > MEETING_FILES_MAX) throw new HttpError(413, 'Tài liệu của cuộc họp này đã đủ 30 MB.', { code: 'too_large' });
    const fid = this.db.meeting_files.insert({ meeting_id: m.id, name: clean, type: TYPES[ext], size: buf.length, by: key, by_name: this.names(key), ts: Date.now(), kind: kind === 'board' ? 'board' : 'file' });
    try { await this.db.blobs.put(`file:${fid}`, buf, TYPES[ext]); }
    catch (e) { this.db.meeting_files.del(fid); throw new HttpError(503, 'Chưa lưu được file, thử lại sau.', { code: 'store_failed', detail: e.message }); }
    audit(this.db, key, 'meeting.file.add', String(m.id), { name: clean, size: buf.length });
    return { m, file: this.files(m.id).find(f => f.id === fid) };
  }
  async getFile(actor, id, fid) {
    const m = this.need(actor, id), f = this.db.meeting_files.get(Number(fid));
    if (!f || f.meeting_id !== m.id) throw new HttpError(404, 'Không còn file này.', { code: 'not_found' });
    const b = await this.db.blobs.get(`file:${f.id}`); if (!b) throw new HttpError(404, 'Không đọc được nội dung file.', { code: 'not_found' });
    return { f, data: b.data };
  }
  async delFile(actor, id, fid) {
    const m = this.need(actor, id), key = keyOf(actor), f = this.db.meeting_files.get(Number(fid));
    if (!f || f.meeting_id !== m.id) throw new HttpError(404, 'Không còn file này.', { code: 'not_found' });
    if (f.by !== key && m.host !== key) throw new HttpError(403, 'Chỉ người tải lên hoặc host được xoá file.', { code: 'forbidden' });
    this.db.meeting_files.del(f.id); await this.db.blobs.del(`file:${f.id}`).catch(() => {});
    audit(this.db, key, 'meeting.file.delete', String(m.id), { name: f.name });
    return m;
  }
}
