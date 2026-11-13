// Nghiệp vụ: nhân viên, chỗ ngồi (đọc từ layout.json), dụng cụ, quyền ngồi, thao tác quản trị.
// Không phụ thuộc Express để dễ kiểm thử. Mọi kiểm tra quyền nằm ở đây (server), client chỉ hiển thị.
import { setOfficeFromLayout } from '../src/shared/rules.js';
import fs from 'fs';
import { buildModel } from '../src/model/layoutModel.js';
import { parseLogin, nameKey, displayOf, normalizeText } from '../src/shared/identity.js';
import { normalizeEquipment, defaultEquipment, normalizeBySchema } from '../src/shared/equipment.js';
import { audit } from './db.js';
import { modeOfDesk } from '../src/core/mode.js';

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

/** Dòng nhân viên mới với đủ cột (các cột trước đây có mặc định trong SQLite). */
const newEmployee = r => ({ department: '', status: 'active', can_move: 0, can_music: 0, can_lights: 0, can_post: 0, last_seen: null, look: null, ...r });
const ownerOfficeOrReal = (deskId, mode) => (mode === 'real') === String(deskId).startsWith('R');

const csvCell = v => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export class Store {
  constructor(db, config) {
    this.db = db; this.config = config;
    this.listeners = new Set();
    this.loadEquipment();
    this.loadLayout();
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }

  // ---------- cấu hình ----------
  loadEquipment() {
    this.equipment = JSON.parse(fs.readFileSync(this.config.equipmentPath, 'utf8'));
    this.appearance = JSON.parse(fs.readFileSync(this.config.appearancePath, 'utf8'));
    // giá trị mặc định phải hợp lệ theo chính schema đó, nếu không người dùng không lưu được
    for (const [file, schema] of [['equipment.json', this.equipment], ['appearance.json', this.appearance]]) {
      const r = normalizeBySchema(schema, defaultEquipment(schema));
      if (!r.ok) throw new Error(`${file}: giá trị mặc định không hợp lệ — ${r.errors.join(' ')}`);
    }
    this.migrateLooks();
  }
  /** Ngoại hình đã lưu theo bộ nhân vật cũ (VRM, con vật, pixel cũ, kiểu áo…): đưa về lựa chọn hiện có trong appearance.json. */
  migrateLooks() {
    if (!this.db) return 0;
    let n = 0, repick = 0;
    const models = new Set((this.appearance.items || []).find(it => it.key === 'model')?.options?.map(o => o.value) || []);
    for (const e of this.db.employees.where(r => r.look != null)) {
      let old; try { old = JSON.parse(e.look); } catch { old = {}; }
      const v = normalizeBySchema(this.appearance, old).value;
      // nhân vật 3D đã chọn không còn trong bộ nhân vật: vẫn đưa về nhân vật mặc định (giữ màu còn hợp lệ) để hiển thị được,
      // và đánh dấu _repick — lần vào sau người đó được mời chọn lại (màn hình chọn nhân vật điền sẵn màu cũ). Dấu này giữ
      // qua các lần khởi động lại cho tới khi người đó lưu nhân vật mới (setLook ghi đè).
      if (old?._repick || (models.size && typeof old?.model === 'string' && old.model && !models.has(old.model))) { v._repick = true; if (!old?._repick) repick++; }
      const js = JSON.stringify(v);
      if (js !== e.look) { this.db.employees.update(e.code, { look: js }); n++; }
    }
    if (n) console.log(`Đã chuyển ${n} ngoại hình nhân vật cũ sang bộ nhân vật hiện tại.`);
    if (repick) console.log(`${repick} nhân viên có nhân vật không còn trong bộ nhân vật: sẽ được mời chọn lại khi vào.`);
    return n;
  }
  loadLayout() {
    const layout = JSON.parse(fs.readFileSync(this.config.layoutPath, 'utf8'));
    setOfficeFromLayout(layout);
    // phòng họp đặt được (server/meetings.js ROOMS): MR1 = phòng họp có tường ở tầng trệt (rooms[id=meeting] trong layout)
    this.meetRooms = (layout.rooms || []).filter(r => r.type === 'meeting' && r.id === 'meeting').map(r => ({ id: 'MR1', floor: r.floor, x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 })); // ranh giới toà nhà cho quy định (không hút thuốc trong văn phòng)
    this.model = buildModel(layout);
    // Real SYS: mô hình riêng (mã bàn R…); cùng bảng seats, mỗi người tối đa một chỗ ở mỗi chế độ
    const rp = this.config.realLayoutPath;
    this.modelReal = rp && fs.existsSync(rp) ? buildModel(JSON.parse(fs.readFileSync(rp, 'utf8'))) : null;
    this.syncSeats();
  }
  /** Thêm bàn mới trong layout.json; bàn bị bỏ khỏi layout thì đánh dấu và trả chỗ. */
  syncSeats() {
    const db = this.db, ids = new Set([...this.model.desks, ...(this.modelReal?.desks || [])].map(d => d.id)), now = Date.now();
    const removed = [];
    db.tx(() => {
      for (const id of ids) { const cur = db.seats.get(id); if (!cur) db.seats.insert({ desk_id: id, owner_code: null, locked: 0, equipment: null, in_layout: 1, updated_at: now }); else if (!cur.in_layout) db.seats.update(id, { in_layout: 1 }); }
      for (const s of db.seats.where(r => r.in_layout)) {
        if (ids.has(s.desk_id)) continue;
        if (!this.modelReal && modeOfDesk(s.desk_id) === 'real') continue; // (Real SYS đang tắt: giữ nguyên chỗ R… để bật lại không mất)
        db.seats.update(s.desk_id, { in_layout: 0, owner_code: null, updated_at: now });
        removed.push(s);
        audit(db, 'system', 'layout.desk_removed', s.desk_id, { previousOwner: s.owner_code });
      }
    });
    if (removed.length) this.emit({ type: 'seats' });
    return removed;
  }

  // ---------- truy vấn ----------
  employee(code) { return this.db.employees.get(code); }
  seatRow(deskId) { const r = this.db.seats.get(deskId); return r && r.in_layout ? r : undefined; }
  /** Chỗ của một người trong một chế độ ('office' | 'real'). */
  seatOf(code, mode = 'office') { return this.db.seats.by('owner_code', code).find(r => r.in_layout && ownerOfficeOrReal(r.desk_id, mode)); }
  /** Mọi chỗ của một người (cả hai chế độ). */
  seatsOf(code) { return this.db.seats.by('owner_code', code).filter(r => r.in_layout); }
  modelOf(deskId) { return modeOfDesk(deskId) === 'real' && this.modelReal ? this.modelReal : this.model; }
  desk(deskId) { return this.modelOf(deskId).deskById.get(deskId); }

  seatView(row) {
    const d = this.desk(row.desk_id);
    const owner = row.owner_code ? this.employee(row.owner_code) : null;
    return {
      deskId: row.desk_id, floor: d ? d.floor : null, kind: d?.kind || 'desk', locked: !!row.locked,
      owner: owner ? { code: owner.code, name: owner.name, display: displayOf(owner.code, owner.name), department: owner.department || '' } : null,
      equipment: row.equipment ? JSON.parse(row.equipment) : null
    };
  }
  /** mode: 'office' | 'real' — chỉ chỗ của chế độ đó; bỏ trống = cả hai (WebSocket, client tự lọc theo chế độ đang mở). */
  listSeats(mode = null) {
    return this.db.seats.where(r => r.in_layout).sort((a, b) => a.desk_id < b.desk_id ? -1 : a.desk_id > b.desk_id ? 1 : 0).filter(r => (!mode || modeOfDesk(r.desk_id) === mode) && (this.modelReal || modeOfDesk(r.desk_id) !== 'real')).map(r => this.seatView(r));
  }
  employeeView(e, isOnline = () => false) {
    const seat = this.seatOf(e.code), real = this.modelReal ? this.seatOf(e.code, 'real') : null;
    return {
      code: e.code, name: e.name, display: displayOf(e.code, e.name), department: e.department, status: e.status,
      canMove: !!e.can_move, canMusic: !!e.can_music, createdAt: e.created_at, lastSeen: e.last_seen, online: isOnline(e.code),
      look: e.look ? JSON.parse(e.look) : null,
      seat: seat ? { deskId: seat.desk_id, floor: this.desk(seat.desk_id)?.floor ?? null } : null,
      seatReal: real ? { deskId: real.desk_id, floor: this.desk(real.desk_id)?.floor ?? null } : null
    };
  }
  listEmployees(isOnline) { return this.db.employees.all().sort((a, b) => a.code < b.code ? -1 : 1).map(e => this.employeeView(e, isOnline)); }

  // ---------- đăng nhập nhân viên ----------
  /**
   * Quyết định đăng nhập theo DUPLICATE_POLICY:
   *  - mã đang online nơi khác: từ chối; mã đã đăng ký khác tên: từ chối;
   *  - mã đã đăng ký, offline, cùng tên (không phân biệt hoa thường): vào lại, giữ chỗ;
   *  - mã mới: tạo mới. Chế độ "strict": mọi mã đã đăng ký đều bị từ chối.
   */
  loginEmployee(input, isOnline) {
    const p = parseLogin(input);
    if (!p.ok) throw new HttpError(400, p.error, { field: 'code' });
    const db = this.db, now = Date.now();
    return db.tx(() => {
      const e = this.employee(p.code);
      if (e) {
        if (e.status === 'disabled') throw new HttpError(403, 'Mã này đã bị vô hiệu hóa. Liên hệ quản trị.', { reason: 'disabled' });
        if (this.config.duplicatePolicy === 'strict') throw new HttpError(409, `Mã ${p.code} đã được đăng ký. Hãy nhập mã khác.`, { reason: 'taken' });
        if (isOnline(p.code)) throw new HttpError(409, `Mã ${p.code} đang được dùng ở nơi khác. Hãy nhập mã khác.`, { reason: 'online' });
        if (e.name_key !== nameKey(p.name)) throw new HttpError(409, `Mã ${p.code} đã được đăng ký với tên khác. Kiểm tra lại mã và tên.`, { reason: 'name' });
        db.employees.update(p.code, { last_seen: now });
        db.sessions.delWhere(r => r.kind === 'employee' && r.subject === p.code); // phiên cũ ở máy khác hết hiệu lực
        audit(db, `emp:${p.code}`, 'login.return', p.code);
        return { code: p.code, created: false };
      }
      db.employees.insert(newEmployee({ code: p.code, name: p.name, name_key: nameKey(p.name), created_at: now, last_seen: now }));
      audit(db, `emp:${p.code}`, 'login.new', p.code, { name: p.name });
      return { code: p.code, created: true };
    });
  }

  /** Nhân viên tự tạo hình nhân vật (kiểm tra theo appearance.json). */
  setLook(actor, code, input) {
    if (actor.kind !== 'admin' && actor.code !== code) throw new HttpError(403, 'Chỉ được sửa nhân vật của chính mình.');
    const e = this.employee(code);
    if (!e) throw new HttpError(404, `Không có nhân viên ${code}.`);
    const r = normalizeBySchema(this.appearance, input);
    if (!r.ok) throw new HttpError(400, r.errors.join(' '));
    this.db.employees.update(code, { look: JSON.stringify(r.value) });
    audit(this.db, actor.key, e.look ? 'look.update' : 'look.create', code, r.value);
    this.emit({ type: 'look', code, look: r.value });
    this.emit({ type: 'employees', code });
    return r.value;
  }
  lookOf(code) { const e = this.employee(code); return e?.look ? JSON.parse(e.look) : null; }

  /** CEO tạo trước nhân viên "1151-An"; người đó đăng nhập đúng mã-tên là vào được. */
  adminCreateEmployee(actor, input, department = '') {
    const p = parseLogin(input);
    if (!p.ok) throw new HttpError(400, p.error);
    if (this.employee(p.code)) throw new HttpError(409, `Mã ${p.code} đã có người dùng.`);
    this.db.employees.insert(newEmployee({ code: p.code, name: p.name, name_key: nameKey(p.name), department: normalizeText(department).slice(0, 60), created_at: Date.now() }));
    audit(this.db, actor.key, 'admin.employee.create', p.code, { name: p.name, department });
    this.emit({ type: 'employees' });
    return { code: p.code, display: p.display };
  }

  // ---------- chỗ ngồi ----------
  ownerMessage(row) {
    if (row.locked) return 'Chỗ này đang bị khóa.';
    const o = row.owner_code && this.employee(row.owner_code);
    return o ? `Chỗ này thuộc về ${displayOf(o.code, o.name)}` : 'Chỗ này vừa có người nhận.';
  }
  requireDesk(deskId) {
    const row = this.seatRow(deskId);
    if (!row) throw new HttpError(404, `Không có chỗ "${deskId}" trong layout.json.`);
    return row;
  }
  equipmentOrThrow(input) {
    const r = normalizeEquipment(this.equipment, input);
    if (!r.ok) throw new HttpError(400, r.errors.join(' '));
    return r.value;
  }

  /** Nhận chỗ trống: nguyên tử nhờ UPDATE ... WHERE owner_code IS NULL trong transaction. */
  claim(code, deskId, equipmentInput) {
    const db = this.db;
    const equipment = this.equipmentOrThrow(equipmentInput ?? defaultEquipment(this.equipment));
    const result = db.tx(() => {
      const e = this.employee(code);
      if (!e || e.status !== 'active') throw new HttpError(403, 'Tài khoản không còn hiệu lực.');
      const row = this.requireDesk(deskId);
      const cur = this.seatOf(code, modeOfDesk(deskId));
      if (cur && cur.desk_id === deskId) return { deskId, moved: null };
      if (cur && !e.can_move) throw new HttpError(403, `Bạn đã có chỗ ${cur.desk_id}. Muốn đổi chỗ cần quản trị cho phép.`, { reason: 'has-seat' });
      if (cur) db.seats.update(cur.desk_id, { owner_code: null, equipment: null, updated_at: Date.now() });
      const free = this.seatRow(deskId);
      if (!free || free.owner_code || free.locked) throw new HttpError(409, this.ownerMessage(free || row), { reason: 'taken' });
      db.seats.update(deskId, { owner_code: code, equipment: JSON.stringify(equipment), updated_at: Date.now() });
      if (cur) db.employees.update(code, { can_move: 0 }); // quyền đổi chỗ dùng một lần
      audit(db, `emp:${code}`, cur ? 'seat.move' : 'seat.claim', deskId, { from: cur?.desk_id || null, equipment });
      return { deskId, moved: cur ? cur.desk_id : null };
    });
    this.emit({ type: 'seat', deskIds: [deskId, result.moved].filter(Boolean) });
    return this.seatView(this.seatRow(deskId));
  }

  updateEquipment(actor, deskId, input) {
    const equipment = this.equipmentOrThrow(input);
    const row = this.requireDesk(deskId);
    if (actor.kind !== 'admin' && row.owner_code !== actor.code) throw new HttpError(403, row.owner_code ? `Chỉ chủ chỗ được sửa dụng cụ. ${this.ownerMessage(row)}.` : 'Chỗ này chưa có chủ.');
    this.db.seats.update(deskId, { equipment: JSON.stringify(equipment), updated_at: Date.now() });
    audit(this.db, actor.key, 'seat.equipment', deskId, equipment);
    this.emit({ type: 'seat', deskIds: [deskId] });
    return this.seatView(this.seatRow(deskId));
  }

  /** Kiểm tra quyền ngồi. Chỉ chủ chỗ; CEO chỉ ngồi chỗ người khác khi ADMIN_CAN_SIT_ANYWHERE=true. */
  checkSit(actor, deskId) {
    const row = this.requireDesk(deskId);
    if (row.locked) throw new HttpError(403, 'Chỗ này đang bị khóa.', { reason: 'locked' });
    if (actor.kind === 'admin') {
      if (row.owner_code && !this.config.adminCanSitAnywhere) throw new HttpError(403, this.ownerMessage(row), { reason: 'owned' });
    } else if (row.owner_code !== actor.code) {
      if (!row.owner_code) throw new HttpError(403, 'Chỗ này chưa có chủ. Hãy nhận chỗ trước khi ngồi.', { reason: 'free' });
      throw new HttpError(403, this.ownerMessage(row), { reason: 'owned' });
    }
    const d = this.desk(deskId);
    return { deskId, floor: d.floor, x: d.seat.x, z: d.seat.z, facing: d.facing || 0 };
  }

  // ---------- quản trị ----------
  adminAssign(actor, deskId, code) {
    const db = this.db;
    const res = db.tx(() => {
      const e = this.employee(code);
      if (!e) throw new HttpError(404, `Không có nhân viên ${code}.`);
      const row = this.requireDesk(deskId);
      if (row.owner_code === code) return { from: deskId };
      if (row.locked) throw new HttpError(409, 'Chỗ này đang bị khóa. Mở khóa trước khi gán.');
      if (row.owner_code) throw new HttpError(409, `${this.ownerMessage(row)}. Giải phóng chỗ đó trước.`);
      const cur = this.seatOf(code, modeOfDesk(deskId));
      const equipment = cur?.equipment || JSON.stringify(defaultEquipment(this.equipment)); // dụng cụ đi theo người
      if (cur) db.seats.update(cur.desk_id, { owner_code: null, equipment: null, updated_at: Date.now() });
      const free = db.seats.get(deskId);
      if (!free || free.owner_code || free.locked) throw new HttpError(409, this.ownerMessage(this.seatRow(deskId)));
      db.seats.update(deskId, { owner_code: code, equipment, updated_at: Date.now() });
      audit(db, actor.key, 'admin.seat.assign', deskId, { code, from: cur?.desk_id || null });
      return { from: cur?.desk_id || null };
    });
    this.emit({ type: 'seat', deskIds: [deskId, res.from].filter(Boolean) });
    this.emit({ type: 'employees' });
  }
  adminRelease(actor, deskId) {
    const row = this.requireDesk(deskId);
    this.db.seats.update(deskId, { owner_code: null, equipment: null, updated_at: Date.now() });
    audit(this.db, actor.key, 'admin.seat.release', deskId, { previousOwner: row.owner_code });
    this.emit({ type: 'seat', deskIds: [deskId] }); this.emit({ type: 'employees' });
  }
  adminLock(actor, deskId, locked) {
    this.requireDesk(deskId);
    this.db.seats.update(deskId, { locked: locked ? 1 : 0, updated_at: Date.now() });
    audit(this.db, actor.key, locked ? 'admin.seat.lock' : 'admin.seat.unlock', deskId);
    this.emit({ type: 'seat', deskIds: [deskId] });
  }
  adminUpdateEmployee(actor, code, patch) {
    const e = this.employee(code);
    if (!e) throw new HttpError(404, `Không có nhân viên ${code}.`);
    const next = { name: e.name, department: e.department, status: e.status, can_move: e.can_move };
    if (patch.name !== undefined) { const p = parseLogin(`${code}-${patch.name}`); if (!p.ok) throw new HttpError(400, p.error); next.name = p.name; }
    if (patch.department !== undefined) next.department = normalizeText(patch.department).slice(0, 60);
    if (patch.status !== undefined) { if (!['active', 'disabled'].includes(patch.status)) throw new HttpError(400, 'Trạng thái không hợp lệ.'); next.status = patch.status; }
    if (patch.canMove !== undefined) next.can_move = patch.canMove ? 1 : 0;
    const released = this.db.tx(() => {
      this.db.employees.update(code, { name: next.name, name_key: nameKey(next.name), department: next.department, status: next.status, can_move: next.can_move });
      let seat = null;
      if (next.status === 'disabled' && e.status !== 'disabled') {
        seat = this.seatsOf(code);
        this.releaseAll(code);
        this.db.sessions.delWhere(r => r.kind === 'employee' && r.subject === code);
      }
      audit(this.db, actor.key, 'admin.employee.update', code, { before: { name: e.name, department: e.department, status: e.status, canMove: !!e.can_move }, after: { ...next, can_move: !!next.can_move } });
      return seat;
    });
    if (released?.length) this.emit({ type: 'seat', deskIds: released.map(r => r.desk_id) });
    if (next.status === 'disabled' && e.status !== 'disabled') this.emit({ type: 'kick', code, reason: 'Tài khoản đã bị vô hiệu hóa.' });
    this.emit({ type: 'employees' });
    if (next.name !== e.name) this.emit({ type: 'seat', deskIds: this.seatsOf(code).map(r => r.desk_id) });
  }
  adminDeleteEmployee(actor, code) {
    const e = this.employee(code);
    if (!e) throw new HttpError(404, `Không có nhân viên ${code}.`);
    const mine = this.seatsOf(code), seat = mine[0] || null;
    this.db.tx(() => {
      this.releaseAll(code);
      this.db.sessions.delWhere(r => r.kind === 'employee' && r.subject === code);
      this.db.employees.del(code);
      this.db.attendance.delWhere(r => r.code === code);   // (như ON DELETE CASCADE của bảng chấm công cũ)
      audit(this.db, actor.key, 'admin.employee.delete', code, { name: e.name, seat: seat?.desk_id || null, seats: mine.map(r => r.desk_id) });
    });
    this.emit({ type: 'kick', code, reason: 'Tài khoản đã bị xóa.' });
    if (mine.length) this.emit({ type: 'seat', deskIds: mine.map(r => r.desk_id) });
    this.emit({ type: 'employees' });
  }
  adminForceLogout(actor, code) {
    if (!this.employee(code)) throw new HttpError(404, `Không có nhân viên ${code}.`);
    this.db.sessions.delWhere(r => r.kind === 'employee' && r.subject === code);
    audit(this.db, actor.key, 'admin.employee.logout', code);
    this.emit({ type: 'kick', code, reason: 'Quản trị đã đăng xuất phiên của bạn.' });
  }

  /** Trả mọi chỗ của một người (vô hiệu hoá / xoá nhân viên). */
  releaseAll(code) { for (const s of this.db.seats.by('owner_code', code)) this.db.seats.update(s.desk_id, { owner_code: null, equipment: null, updated_at: Date.now() }); }

  exportCsv() {
    // (một dòng cho mỗi chỗ của người đó — như LEFT JOIN cũ; người chưa có chỗ: một dòng, cột bàn trống)
    const rows = this.db.employees.all().sort((a, b) => a.code < b.code ? -1 : 1).flatMap(e => { const ss = this.seatsOf(e.code); return ss.length ? ss.map(s => ({ ...e, desk_id: s.desk_id })) : [{ ...e, desk_id: '' }]; });
    return 'ma,ten,phong_ban,trang_thai,ma_ban\n' + rows.map(r => [r.code, r.name, r.department, r.status, r.desk_id || ''].map(csvCell).join(',')).join('\n') + '\n';
  }

  /** Nhập CSV (ma,ten,phong_ban,trang_thai,ma_ban). Tất cả hoặc không: lỗi một dòng thì không đổi gì. */
  importCsv(actor, text) {
    const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) throw new HttpError(400, 'File CSV rỗng.');
    const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
    const split = l => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === delim) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
    let rows = lines.map(split);
    const hasHead = !/^\d{4}$/.test(rows[0][0]) && !/^\d{4}\s*-/.test(rows[0][0]);
    if (hasHead) rows = rows.slice(1);
    const errors = [], items = [], seenCode = new Set(), seenDesk = new Map();
    rows.forEach((r, i) => {
      const line = i + 1 + (hasHead ? 1 : 0);
      let [c, name, dept, status, desk] = r;
      // cho phép cột đầu là "1151-An" và bỏ trống cột tên
      if (/^\d{4}\s*-/.test(c || '') && !name) { const p = parseLogin(c); if (p.ok) { c = p.code; name = p.name; } }
      const p = parseLogin(`${c}-${name}`);
      if (!p.ok) { errors.push(`Dòng ${line}: ${p.error}`); return; }
      if (seenCode.has(p.code)) { errors.push(`Dòng ${line}: mã ${p.code} lặp lại.`); return; }
      seenCode.add(p.code);
      status = status ? (/^(disabled|vô hiệu|khoa|khóa)/i.test(status) ? 'disabled' : 'active') : undefined;
      desk = desk ? desk.trim() : '';
      if (desk) {
        if (!this.desk(desk)) { errors.push(`Dòng ${line}: không có bàn "${desk}" trong layout.json.`); return; }
        if (seenDesk.has(desk)) { errors.push(`Dòng ${line}: bàn ${desk} đã gán cho ${seenDesk.get(desk)} ở dòng trước.`); return; }
        seenDesk.set(desk, p.code);
      }
      items.push({ code: p.code, name: p.name, department: dept !== undefined ? normalizeText(dept).slice(0, 60) : undefined, status, desk, line });
    });
    // bàn đích thuộc người không có trong CSV hoặc đang khóa
    for (const it of items) {
      if (!it.desk) continue;
      const row = this.seatRow(it.desk);
      if (row.locked) errors.push(`Dòng ${it.line}: bàn ${it.desk} đang bị khóa.`);
      else if (row.owner_code && row.owner_code !== it.code && !seenCode.has(row.owner_code)) errors.push(`Dòng ${it.line}: ${this.ownerMessage(row)} (người này không có trong CSV).`);
    }
    if (errors.length) throw new HttpError(400, `CSV có ${errors.length} lỗi, chưa thay đổi gì.`, { errors });
    const changed = new Set();
    this.db.tx(() => {
      const now = Date.now();
      for (const it of items) {
        const e = this.employee(it.code);
        if (e) this.db.employees.update(it.code, { name: it.name, name_key: nameKey(it.name), department: it.department ?? e.department, status: it.status ?? e.status });
        else this.db.employees.insert(newEmployee({ code: it.code, name: it.name, name_key: nameKey(it.name), department: it.department || '', status: it.status || 'active', created_at: now }));
      }
      // trả chỗ cũ của những người đổi bàn trước, rồi gán bàn mới (tránh vướng ràng buộc UNIQUE)
      const equipOf = new Map();
      for (const it of items) {
        const cur = it.desk ? this.seatOf(it.code, modeOfDesk(it.desk)) : null;
        if (it.desk && cur && cur.desk_id !== it.desk) { equipOf.set(it.code, cur.equipment); this.db.seats.update(cur.desk_id, { owner_code: null, equipment: null, updated_at: now }); changed.add(cur.desk_id); }
      }
      for (const it of items) {
        if (!it.desk) continue;
        const row = this.seatRow(it.desk);
        if (row.owner_code === it.code) continue;
        const free = this.db.seats.get(it.desk);
        if (!free || free.owner_code || free.locked) throw new HttpError(409, `Dòng ${it.line}: không gán được bàn ${it.desk} (${this.ownerMessage(this.seatRow(it.desk))}).`);
        this.db.seats.update(it.desk, { owner_code: it.code, equipment: equipOf.get(it.code) || JSON.stringify(defaultEquipment(this.equipment)), updated_at: now });
        changed.add(it.desk);
      }
      audit(this.db, actor.key, 'admin.csv.import', null, { rows: items.length, seats: [...changed] });
    });
    this.emit({ type: 'seat', deskIds: [...changed] }); this.emit({ type: 'employees' });
    return { updated: items.length, seats: changed.size };
  }

  auditLog(limit = 200) {
    return [...this.db.audit.rows.values()].sort((a, b) => b.id - a.id).slice(0, Math.min(1000, limit)).map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
  }
}

