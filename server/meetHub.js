// Phòng họp — phần thời gian thực (WebSocket): ai đang ở trong phòng, bảng vẽ chung, nhắc giờ họp, chặn người ngoài.
//  • meet:join {id} — chỉ host / người được mời, từ 10 phút trước giờ họp tới hết giờ. Vào phòng: nhận trạng thái phòng
//    (người trong phòng, toàn bộ nét vẽ). meet:leave rời phòng; hết giờ server tự mời mọi người ra.
//  • Bảng vẽ = bản vẽ Excalidraw chung (cách làm của agent-office, MIT): meet:wb {elements} — các hình vừa đổi; máy chủ giữ
//    bản mới nhất của từng hình (ghép theo phiên bản — src/shared/whiteboard.js) rồi chuyển cho người khác trong phòng.
//    meet:ptr — con trỏ / vùng chọn của từng người. Ảnh dán lên bảng: REST (routes/meetings.js) → db.blobs 'wbf:<id>:<ảnh>'.
//    Bản vẽ lưu ở db.blobs 'board:<id>' ({ elements, files }) — không giữ trong bộ nhớ khi phòng trống; xem lại ở "Folder của tôi".
//  • Nhắc giờ: 10 phút trước và đúng giờ họp, server nhắn cho host + người được mời đang online (meet:remind) và ghi một
//    dòng vào kênh chat của cuộc họp. Được mời / đổi giờ / huỷ: báo ngay (meet:invited, meet:changed, meet:cancelled).
//  • Chặn người ngoài: trong giờ họp, vị trí của người không có trong danh sách mà nằm trong phòng họp sẽ bị bỏ qua
//    (client cũng tự đẩy nhân vật ra cửa).
import { getMeeting, isParticipant, isOpen, ROOMS, EARLY } from './meetings.js';
import { WB_MAX_BYTES, WB_MAX_ELEMENTS, WB_MAX_ELEMENT_BYTES, WB_MAX_FILES_BYTES, WB_ID, byIndex, checkElement, checkFile, newer, parseBoard } from '../src/shared/whiteboard.js';

const SAVE_MS = 2500;

export class MeetHub {
  constructor(hub, meetings) {
    this.hub = hub; this.meetings = meetings; this.rooms = new Map();   // id → { members: Map<key, {display}>, els: Map<id, element>, sizes, bytes, files: Map<id, size>, fileBytes, dirty }
    this.reminded = new Set();   // `${id}:soon` / `${id}:start` / `${id}:end`
    this.timer = setInterval(() => this.tick(), 15000); this.timer.unref?.();
  }
  close() { clearInterval(this.timer); return this.saveAll(); }
  get store() { return this.hub.store; }
  sendKey(key, msg) { for (const s of this.hub.sockets.get(key) || []) this.hub.send(s, msg); }
  err(ws, msg) { this.hub.send(ws, { t: 'meetErr', msg }); }
  /** Trạng thái gọn của phòng (ai đang trong phòng) gửi cho người trong phòng. */
  members(id) { const r = this.rooms.get(id); return r ? [...r.members].map(([key, v]) => ({ key, display: v.display })) : []; }
  toRoom(id, msg, except = null) { const r = this.rooms.get(id); if (!r) return; for (const k of r.members.keys()) for (const s of this.hub.sockets.get(k) || []) if (s !== except) this.hub.send(s, msg); }
  pushMembers(id) { this.toRoom(id, { t: 'meet:members', id, members: this.members(id) }); }
  /** Ai đang ở phòng nào (để client hiện số người trong phòng ở cửa). */
  roomOf(key) { for (const [id, r] of this.rooms) if (r.members.has(key)) return id; return null; }

  async room(id) {
    let r = this.rooms.get(id); if (r) { if (r.loading) await r.loading; return r; }
    r = { members: new Map(), els: new Map(), sizes: new Map(), bytes: 0, files: new Map(), fileBytes: 0, dirty: false, loading: null };
    this.rooms.set(id, r);
    r.loading = (async () => {
      try {
        const b = await this.store.db.blobs.get(`board:${id}`); if (!b) return;
        const { elements, files } = parseBoard(b.data);
        for (const raw of elements) { const el = checkElement(raw); if (el) this.put(r, el, JSON.stringify(el).length); }
        for (const [fid, size] of Object.entries(files)) if (WB_ID.test(fid) && size > 0) { r.files.set(fid, size); r.fileBytes += size; }
      } catch { /* bảng trống */ }
    })();
    await r.loading; r.loading = null;
    return r;
  }
  put(r, el, size) { r.bytes += size - (r.sizes.get(el.id) ?? 0); r.els.set(el.id, el); r.sizes.set(el.id, size); }
  drop(r, id) { r.bytes -= r.sizes.get(id) ?? 0; r.els.delete(id); r.sizes.delete(id); }
  scene(r) { return [...r.els.values()].sort(byIndex); }
  /** Bản vẽ của một cuộc họp: { elements (kể cả hình đã xoá — để ghép), files: [mã ảnh] } (xem lại sau khi họp). */
  async board(id) {
    const r = this.rooms.get(id);
    if (r) { if (r.loading) await r.loading; return { elements: this.scene(r), files: [...r.files.keys()] }; }
    try { const b = await this.store.db.blobs.get(`board:${id}`); if (!b) return { elements: [], files: [] }; const j = parseBoard(b.data); return { elements: j.elements, files: Object.keys(j.files) }; }
    catch { return { elements: [], files: [] }; }
  }
  save(id) {
    const r = this.rooms.get(id); if (!r || !r.dirty) return;
    clearTimeout(r.saveT); r.saveT = setTimeout(() => this.saveNow(id), SAVE_MS); r.saveT.unref?.();
  }
  async saveNow(id) {
    const r = this.rooms.get(id); if (!r || !r.dirty) return;
    r.dirty = false; clearTimeout(r.saveT);
    try { await this.store.db.blobs.put(`board:${id}`, Buffer.from(JSON.stringify({ v: 2, elements: this.scene(r), files: Object.fromEntries(r.files) })), 'application/json'); }
    catch (e) { r.dirty = true; console.warn(`[họp] chưa lưu được bảng vẽ #${id}: ${e.message}`); this.save(id); }
  }
  async saveAll() { await Promise.all([...this.rooms.keys()].map(id => this.saveNow(id))); }

  /** Nhận thay đổi của một người: hình nào mới hơn bản máy chủ đang giữ thì thay; chuyển các hình nhận được cho người khác. */
  wb(ws, id, raw) {
    const r = this.rooms.get(id); if (!r?.members.has(ws.key) || !Array.isArray(raw) || raw.length > 2000) return;
    const accepted = []; let error;
    for (const item of raw) {
      const el = checkElement(item); if (!el) continue;
      const had = r.els.get(el.id); if (!newer(el, had)) continue;
      const size = JSON.stringify(el).length;
      if (size > WB_MAX_ELEMENT_BYTES) { error = 'Hình vẽ quá lớn cho bảng — thử vẽ thành nhiều phần nhỏ.'; continue; }
      const fits = () => (had || r.els.size < WB_MAX_ELEMENTS) && r.bytes - (r.sizes.get(el.id) ?? 0) + size <= WB_MAX_BYTES;
      if (!fits()) this.forgetDeleted(r);
      if (!fits()) { error = 'Bảng vẽ đã đầy — xoá bớt hình để vẽ tiếp.'; continue; }
      this.put(r, el, size); accepted.push(el);
    }
    if (accepted.length) { r.dirty = true; this.save(id); this.toRoom(id, { t: 'meet:wb', id, elements: accepted }, ws); }
    if (error) this.err(ws, error);
  }
  /** Lấy chỗ: quên các hình đã xoá (xoá lâu nhất trước). */
  forgetDeleted(r) { for (const e of [...r.els.values()].filter(e => e.isDeleted).sort((a, b) => (a.updated ?? 0) - (b.updated ?? 0))) this.drop(r, e.id); }
  /** Ảnh dán lên bảng (REST). Trả về lỗi (chuỗi) hoặc undefined. */
  async addFile(key, id, raw) {
    const r = this.rooms.get(id); if (!r?.members.has(key)) return 'Vào phòng họp rồi mới dán ảnh lên bảng được.';
    const f = checkFile(raw); if (typeof f === 'string') return f;
    if (r.files.has(f.id)) return undefined;
    const json = JSON.stringify(f);
    if (r.fileBytes + json.length > WB_MAX_FILES_BYTES) return `Bảng đã có quá nhiều ảnh (tối đa ${WB_MAX_FILES_BYTES / 1024 / 1024} MB) — xoá bớt ảnh trước.`;
    await this.store.db.blobs.put(`wbf:${id}:${f.id}`, Buffer.from(json), 'application/json');
    r.files.set(f.id, json.length); r.fileBytes += json.length; r.dirty = true; this.save(id);
    return undefined;
  }
  async getFile(id, fid) {
    if (!WB_ID.test(fid)) return null;
    const b = await this.store.db.blobs.get(`wbf:${id}:${fid}`); return b ? b.data : null;
  }
  /** Con trỏ / vùng chọn của một người (toạ độ trong bản vẽ). */
  ptr(ws, id, m) {
    const r = this.rooms.get(id); if (!r?.members.has(ws.key)) return;
    const now = Date.now(); if (now - (ws.lastPtr || 0) < 30) return; ws.lastPtr = now;
    const num = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e7;
    if (!num(m.x) || !num(m.y)) return;
    const selected = Array.isArray(m.selected) ? m.selected.filter(x => typeof x === 'string' && WB_ID.test(x)).slice(0, 200) : undefined;
    this.toRoom(id, { t: 'meet:ptr', id, key: ws.key, x: m.x, y: m.y, tool: m.tool === 'laser' ? 'laser' : 'pointer', button: m.button === 'down' ? 'down' : 'up', selected }, ws);
  }

  async onMessage(ws, m) {
    const id = Number(m.id);
    switch (m.t) {
      case 'meet:join': return this.join(ws, id);
      case 'meet:leave': return this.leave(ws.key, id);
      case 'meet:wb': return this.wb(ws, id, m.elements);
      case 'meet:ptr': return this.ptr(ws, id, m);
    }
  }
  async join(ws, id) {
    const m = getMeeting(this.store, id);
    if (!m || m.status !== 'booked') return this.err(ws, 'Không còn cuộc họp này.');
    if (!isParticipant(m, ws.key)) return this.err(ws, 'Bạn không có trong danh sách cuộc họp này — chỉ người được mời mới vào được phòng.');
    const now = Date.now();
    if (now < m.start - EARLY) return this.err(ws, `Phòng mở từ ${hhmm(m.start - EARLY)} (10 phút trước giờ họp).`);
    if (now >= m.end) return this.err(ws, 'Cuộc họp đã kết thúc. Xem lại tài liệu trong "Folder của tôi".');
    // đang ở cuộc họp khác: rời phòng đó trước
    const other = this.roomOf(ws.key); if (other && other !== id) this.leave(ws.key, other);
    const r = await this.room(id);
    r.members.set(ws.key, { display: this.hub.presence.get(ws.key)?.display || this.meetings.names(ws.key) });
    for (const s of this.hub.sockets.get(ws.key) || []) this.hub.send(s, { t: 'meet:state', id, meeting: this.meetings.view(m, ws.key), members: this.members(id), elements: this.scene(r), files: [...r.files.keys()] });
    this.pushMembers(id);
    this.hub.broadcast({ t: 'meet:busy', rooms: this.busy() });
  }
  leave(key, id) {
    const r = this.rooms.get(id); if (!r || !r.members.delete(key)) return;
    for (const s of this.hub.sockets.get(key) || []) this.hub.send(s, { t: 'meet:left', id });
    this.pushMembers(id);
    if (!r.members.size) { this.saveNow(id).finally(() => { if (!this.rooms.get(id)?.members.size) this.rooms.delete(id); }); }
    this.hub.broadcast({ t: 'meet:busy', rooms: this.busy() });
  }
  leaveAll(key) { for (const [id, r] of this.rooms) if (r.members.has(key)) this.leave(key, id); }
  /** Số người đang trong từng phòng họp (hiện ở cửa phòng). */
  busy() { const out = {}; for (const [id, r] of this.rooms) if (r.members.size) { const m = getMeeting(this.store, id); if (m) out[m.room] = { id, n: r.members.size, title: m.title }; } return out; }

  // ---------- nhắc giờ, báo thay đổi ----------
  /** Dòng hệ thống trong kênh chat của cuộc họp. */
  system(m, body) {
    const ch = `meet:${m.id}`, ts = Date.now();
    const id = this.store.db.chat_messages.insert({ channel: ch, sender: 'system', sender_name: 'Lịch họp', body, ts });
    const msg = { id, channel: ch, from: 'system', name: 'Lịch họp', body, ts };
    for (const k of [m.host, ...m.invitees]) this.sendKey(k, { t: 'chat', msg });
  }
  notify(m, kind, keys = [m.host, ...m.invitees]) {
    for (const k of keys) this.sendKey(k, { t: 'meet:remind', kind, meeting: this.meetings.view(m, k) });
  }
  invited(m, keys) { for (const k of keys) this.sendKey(k, { t: 'meet:invited', meeting: this.meetings.view(m, k) }); }
  changed(m, removed = []) {
    for (const k of [m.host, ...m.invitees]) this.sendKey(k, { t: 'meet:changed', meeting: this.meetings.view(m, k) });
    for (const k of removed) { this.sendKey(k, { t: 'meet:cancelled', id: m.id, title: m.title, removed: true }); this.leave(k, m.id); }
  }
  cancelled(m) {
    for (const k of [m.host, ...m.invitees]) this.sendKey(k, { t: 'meet:cancelled', id: m.id, title: m.title });
    const r = this.rooms.get(m.id); if (r) for (const k of [...r.members.keys()]) this.leave(k, m.id);
  }
  /** Kết thúc / xoá cuộc họp: mời mọi người ra; xoá thì bỏ luôn bảng vẽ đang giữ (không lưu lại). */
  ended(m, purged = false) {
    const r = this.rooms.get(m.id);
    if (r) { this.toRoom(m.id, { t: 'meet:ended', id: m.id, early: true, purged }); if (purged) { r.els.clear(); r.files.clear(); r.dirty = false; clearTimeout(r.saveT); } for (const k of [...r.members.keys()]) this.leave(k, m.id); }
    if (purged) this.rooms.delete(m.id);
    for (const k of [m.host, ...m.invitees]) this.sendKey(k, { t: 'meet:changed', meeting: this.meetings.view(getMeeting(this.store, m.id), k) });
  }
  tick(now = Date.now()) {
    for (const m of this.meetings.all()) {
      if (m.status !== 'booked' || m.end < now - 60e3 || m.start > now + EARLY + 60e3) continue;
      const soon = `${m.id}:${m.start}:soon`, start = `${m.id}:${m.start}:start`, end = `${m.id}:${m.end}:end`;
      if (now >= m.start - EARLY && now < m.start && !this.reminded.has(soon)) { this.reminded.add(soon); this.notify(m, 'soon'); }
      if (now >= m.start && now < m.end && !this.reminded.has(start)) {
        this.reminded.add(start); this.reminded.add(soon);
        if (now - m.start < 5 * 60e3) { this.notify(m, 'start'); this.system(m, `Cuộc họp "${m.title}" bắt đầu (${hhmm(m.start)}–${hhmm(m.end)}). Mời mọi người tới ${ROOMS.find(r => r.id === m.room)?.name || 'phòng họp'}.`); }
      }
      if (now >= m.end && !this.reminded.has(end)) {
        this.reminded.add(end);
        const r = this.rooms.get(m.id);
        if (r) { this.toRoom(m.id, { t: 'meet:ended', id: m.id }); for (const k of [...r.members.keys()]) this.leave(k, m.id); }
      }
    }
    if (this.reminded.size > 5000) this.reminded.clear();
  }

  // ---------- chặn người ngoài ----------
  /** Cuộc họp đang diễn ra ở phòng chứa điểm (x, z, f) — hoặc null. */
  activeAt(x, z, f, now = Date.now()) {
    for (const rm of this.store.meetRooms || []) {
      if (f !== rm.floor || x < rm.x0 || x > rm.x1 || z < rm.z0 || z > rm.z1) continue;
      for (const m of this.meetings.all()) if (m.room === rm.id && isOpen(m, now) && now >= m.start) return m;
    }
    return null;
  }
  /** Vị trí này có bị chặn với người này không (đang họp, không có trong danh sách). */
  blocked(key, x, z, f) { const m = this.activeAt(x, z, f); return !!m && !isParticipant(m, key); }
}

const hhmm = t => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
