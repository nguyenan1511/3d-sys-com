import { migrateSocial } from './social.js';
import { migrateAttendance } from './attendance.js';
// Nghiệp vụ: nhân viên, chỗ ngồi (đọc từ layout.json), dụng cụ, quyền ngồi, thao tác quản trị.
// Không phụ thuộc Express để dễ kiểm thử. Mọi kiểm tra quyền nằm ở đây (server), client chỉ hiển thị.
import { setOfficeFromLayout } from '../src/shared/rules.js';
import fs from 'fs';
import { buildModel } from '../src/model/layoutModel.js';
import { parseLogin, nameKey, displayOf, normalizeText } from '../src/shared/identity.js';
import { normalizeEquipment, defaultEquipment, normalizeBySchema } from '../src/shared/equipment.js';
import { audit } from './db.js';

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const csvCell = v => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export class Store {
  constructor(db, config) {
    this.db = db; this.config = config;
    migrateSocial(db); // chat + quyền bật nhạc (server/social.js)
    migrateAttendance(db); // chấm công (server/attendance.js)
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
    let n = 0;
    for (const e of this.db.prepare('SELECT code, look FROM employees WHERE look IS NOT NULL').all()) {
      let old; try { old = JSON.parse(e.look); } catch { old = {}; }
      const v = normalizeBySchema(this.appearance, old).value, js = JSON.stringify(v);
      if (js !== e.look) { this.db.prepare('UPDATE employees SET look = ? WHERE code = ?').run(js, e.code); n++; }
    }
    if (n) console.log(`Đã chuyển ${n} ngoại hình nhân vật cũ sang bộ nhân vật hiện tại.`);
    return n;
  }
  loadLayout() {
    const layout = JSON.parse(fs.readFileSync(this.config.layoutPath, 'utf8'));
    setOfficeFromLayout(layout); // ranh giới toà nhà cho quy định (không hút thuốc trong văn phòng)
    this.model = buildModel(layout);
    this.syncSeats();
  }
  /** Thêm bàn mới trong layout.json; bàn bị bỏ khỏi layout thì đánh dấu và trả chỗ. */
  syncSeats() {
    const db = this.db, ids = new Set(this.model.desks.map(d => d.id)), now = Date.now();
    const removed = [];
    db.tx(() => {
      const ins = db.prepare('INSERT INTO seats (desk_id, in_layout, updated_at) VALUES (?, 1, ?) ON CONFLICT(desk_id) DO UPDATE SET in_layout = 1');
      for (const id of ids) ins.run(id, now);
      for (const s of db.prepare('SELECT desk_id, owner_code FROM seats WHERE in_layout = 1').all()) {
        if (ids.has(s.desk_id)) continue;
        db.prepare('UPDATE seats SET in_layout = 0, owner_code = NULL, updated_at = ? WHERE desk_id = ?').run(now, s.desk_id);
        removed.push(s);
        audit(db, 'system', 'layout.desk_removed', s.desk_id, { previousOwner: s.owner_code });
      }
    });
    if (removed.length) this.emit({ type: 'seats' });
    return removed;
  }

  // ---------- truy vấn ----------
  employee(code) { return this.db.prepare('SELECT * FROM employees WHERE code = ?').get(code); }
  seatRow(deskId) { return this.db.prepare('SELECT * FROM seats WHERE desk_id = ? AND in_layout = 1').get(deskId); }
  seatOf(code) { return this.db.prepare('SELECT * FROM seats WHERE owner_code = ? AND in_layout = 1').get(code); }

  seatView(row) {
    const d = this.model.deskById.get(row.desk_id);
    const owner = row.owner_code ? this.employee(row.owner_code) : null;
    return {
      deskId: row.desk_id, floor: d ? d.floor : null, kind: d?.kind || 'desk', locked: !!row.locked,
      owner: owner ? { code: owner.code, name: owner.name, display: displayOf(owner.code, owner.name), department: owner.department || '' } : null,
      equipment: row.equipment ? JSON.parse(row.equipment) : null
    };
  }
  listSeats() {
    return this.db.prepare('SELECT * FROM seats WHERE in_layout = 1 ORDER BY desk_id').all().map(r => this.seatView(r));
  }
  employeeView(e, isOnline = () => false) {
    const seat = this.seatOf(e.code);
    return {
      code: e.code, name: e.name, display: displayOf(e.code, e.name), department: e.department, status: e.status,
      canMove: !!e.can_move, canMusic: !!e.can_music, createdAt: e.created_at, lastSeen: e.last_seen, online: isOnline(e.code),
      look: e.look ? JSON.parse(e.look) : null,
      seat: seat ? { deskId: seat.desk_id, floor: this.model.deskById.get(seat.desk_id)?.floor ?? null } : null
    };
  }
  listEmployees(isOnline) { return this.db.prepare('SELECT * FROM employees ORDER BY code').all().map(e => this.employeeView(e, isOnline)); }

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
        db.prepare('UPDATE employees SET last_seen = ? WHERE code = ?').run(now, p.code);
        db.prepare("DELETE FROM sessions WHERE kind = 'employee' AND subject = ?").run(p.code); // phiên cũ ở máy khác hết hiệu lực
        audit(db, `emp:${p.code}`, 'login.return', p.code);
        return { code: p.code, created: false };
      }
      db.prepare('INSERT INTO employees (code, name, name_key, created_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(p.code, p.name, nameKey(p.name), now, now);
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
    this.db.prepare('UPDATE employees SET look = ? WHERE code = ?').run(JSON.stringify(r.value), code);
    audit(this.db, actor.key, e.look ? 'look.update' : 'look.create', code, r.value);
    this.emit({ type: 'look', code, look: r.value });
    this.emit({ type: 'employees' });
    return r.value;
  }
  lookOf(code) { const e = this.employee(code); return e?.look ? JSON.parse(e.look) : null; }

  /** CEO tạo trước nhân viên "1151-An"; người đó đăng nhập đúng mã-tên là vào được. */
  adminCreateEmployee(actor, input, department = '') {
    const p = parseLogin(input);
    if (!p.ok) throw new HttpError(400, p.error);
    if (this.employee(p.code)) throw new HttpError(409, `Mã ${p.code} đã có người dùng.`);
    this.db.prepare('INSERT INTO employees (code, name, name_key, department, created_at) VALUES (?, ?, ?, ?, ?)').run(p.code, p.name, nameKey(p.name), normalizeText(department).slice(0, 60), Date.now());
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
      const cur = this.seatOf(code);
      if (cur && cur.desk_id === deskId) return { deskId, moved: null };
      if (cur && !e.can_move) throw new HttpError(403, `Bạn đã có chỗ ${cur.desk_id}. Muốn đổi chỗ cần quản trị cho phép.`, { reason: 'has-seat' });
      if (cur) db.prepare('UPDATE seats SET owner_code = NULL, equipment = NULL, updated_at = ? WHERE desk_id = ?').run(Date.now(), cur.desk_id);
      const r = db.prepare('UPDATE seats SET owner_code = ?, equipment = ?, updated_at = ? WHERE desk_id = ? AND owner_code IS NULL AND locked = 0 AND in_layout = 1')
        .run(code, JSON.stringify(equipment), Date.now(), deskId);
      if (r.changes !== 1) throw new HttpError(409, this.ownerMessage(this.seatRow(deskId) || row), { reason: 'taken' });
      if (cur) db.prepare('UPDATE employees SET can_move = 0 WHERE code = ?').run(code); // quyền đổi chỗ dùng một lần
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
    this.db.prepare('UPDATE seats SET equipment = ?, updated_at = ? WHERE desk_id = ?').run(JSON.stringify(equipment), Date.now(), deskId);
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
    const d = this.model.deskById.get(deskId);
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
      const cur = this.seatOf(code);
      const equipment = cur?.equipment || JSON.stringify(defaultEquipment(this.equipment)); // dụng cụ đi theo người
      if (cur) db.prepare('UPDATE seats SET owner_code = NULL, equipment = NULL, updated_at = ? WHERE desk_id = ?').run(Date.now(), cur.desk_id);
      const r = db.prepare('UPDATE seats SET owner_code = ?, equipment = ?, updated_at = ? WHERE desk_id = ? AND owner_code IS NULL AND locked = 0').run(code, equipment, Date.now(), deskId);
      if (r.changes !== 1) throw new HttpError(409, this.ownerMessage(this.seatRow(deskId)));
      audit(db, actor.key, 'admin.seat.assign', deskId, { code, from: cur?.desk_id || null });
      return { from: cur?.desk_id || null };
    });
    this.emit({ type: 'seat', deskIds: [deskId, res.from].filter(Boolean) });
    this.emit({ type: 'employees' });
  }
  adminRelease(actor, deskId) {
    const row = this.requireDesk(deskId);
    this.db.prepare('UPDATE seats SET owner_code = NULL, equipment = NULL, updated_at = ? WHERE desk_id = ?').run(Date.now(), deskId);
    audit(this.db, actor.key, 'admin.seat.release', deskId, { previousOwner: row.owner_code });
    this.emit({ type: 'seat', deskIds: [deskId] }); this.emit({ type: 'employees' });
  }
  adminLock(actor, deskId, locked) {
    this.requireDesk(deskId);
    this.db.prepare('UPDATE seats SET locked = ?, updated_at = ? WHERE desk_id = ?').run(locked ? 1 : 0, Date.now(), deskId);
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
      this.db.prepare('UPDATE employees SET name = ?, name_key = ?, department = ?, status = ?, can_move = ? WHERE code = ?').run(next.name, nameKey(next.name), next.department, next.status, next.can_move, code);
      let seat = null;
      if (next.status === 'disabled' && e.status !== 'disabled') {
        seat = this.seatOf(code);
        if (seat) this.db.prepare('UPDATE seats SET owner_code = NULL, equipment = NULL, updated_at = ? WHERE desk_id = ?').run(Date.now(), seat.desk_id);
        this.db.prepare("DELETE FROM sessions WHERE kind = 'employee' AND subject = ?").run(code);
      }
      audit(this.db, actor.key, 'admin.employee.update', code, { before: { name: e.name, department: e.department, status: e.status, canMove: !!e.can_move }, after: { ...next, can_move: !!next.can_move } });
      return seat;
    });
    if (released) this.emit({ type: 'seat', deskIds: [released.desk_id] });
    if (next.status === 'disabled' && e.status !== 'disabled') this.emit({ type: 'kick', code, reason: 'Tài khoản đã bị vô hiệu hóa.' });
    this.emit({ type: 'employees' });
    if (next.name !== e.name) this.emit({ type: 'seat', deskIds: [this.seatOf(code)?.desk_id].filter(Boolean) });
  }
  adminDeleteEmployee(actor, code) {
    const e = this.employee(code);
    if (!e) throw new HttpError(404, `Không có nhân viên ${code}.`);
    const seat = this.seatOf(code);
    this.db.tx(() => {
      if (seat) this.db.prepare('UPDATE seats SET owner_code = NULL, equipment = NULL, updated_at = ? WHERE desk_id = ?').run(Date.now(), seat.desk_id);
      this.db.prepare("DELETE FROM sessions WHERE kind = 'employee' AND subject = ?").run(code);
      this.db.prepare('DELETE FROM employees WHERE code = ?').run(code);
      audit(this.db, actor.key, 'admin.employee.delete', code, { name: e.name, seat: seat?.desk_id || null });
    });
    this.emit({ type: 'kick', code, reason: 'Tài khoản đã bị xóa.' });
    if (seat) this.emit({ type: 'seat', deskIds: [seat.desk_id] });
    this.emit({ type: 'employees' });
  }
  adminForceLogout(actor, code) {
    if (!this.employee(code)) throw new HttpError(404, `Không có nhân viên ${code}.`);
    this.db.prepare("DELETE FROM sessions WHERE kind = 'employee' AND subject = ?").run(code);
    audit(this.db, actor.key, 'admin.employee.logout', code);
    this.emit({ type: 'kick', code, reason: 'Quản trị đã đăng xuất phiên của bạn.' });
  }

  exportCsv() {
    const rows = this.db.prepare('SELECT e.code, e.name, e.department, e.status, s.desk_id FROM employees e LEFT JOIN seats s ON s.owner_code = e.code AND s.in_layout = 1 ORDER BY e.code').all();
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
        if (!this.model.deskById.has(desk)) { errors.push(`Dòng ${line}: không có bàn "${desk}" trong layout.json.`); return; }
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
        if (e) this.db.prepare('UPDATE employees SET name = ?, name_key = ?, department = COALESCE(?, department), status = COALESCE(?, status) WHERE code = ?').run(it.name, nameKey(it.name), it.department ?? null, it.status ?? null, it.code);
        else this.db.prepare('INSERT INTO employees (code, name, name_key, department, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(it.code, it.name, nameKey(it.name), it.department || '', it.status || 'active', now);
      }
      // trả chỗ cũ của những người đổi bàn trước, rồi gán bàn mới (tránh vướng ràng buộc UNIQUE)
      const equipOf = new Map();
      for (const it of items) {
        const cur = this.seatOf(it.code);
        if (it.desk && cur && cur.desk_id !== it.desk) { equipOf.set(it.code, cur.equipment); this.db.prepare('UPDATE seats SET owner_code = NULL, equipment = NULL, updated_at = ? WHERE desk_id = ?').run(now, cur.desk_id); changed.add(cur.desk_id); }
      }
      for (const it of items) {
        if (!it.desk) continue;
        const row = this.seatRow(it.desk);
        if (row.owner_code === it.code) continue;
        const r = this.db.prepare('UPDATE seats SET owner_code = ?, equipment = ?, updated_at = ? WHERE desk_id = ? AND owner_code IS NULL AND locked = 0')
          .run(it.code, equipOf.get(it.code) || JSON.stringify(defaultEquipment(this.equipment)), now, it.desk);
        if (r.changes !== 1) throw new HttpError(409, `Dòng ${it.line}: không gán được bàn ${it.desk} (${this.ownerMessage(this.seatRow(it.desk))}).`);
        changed.add(it.desk);
      }
      audit(this.db, actor.key, 'admin.csv.import', null, { rows: items.length, seats: [...changed] });
    });
    this.emit({ type: 'seat', deskIds: [...changed] }); this.emit({ type: 'employees' });
    return { updated: items.length, seats: changed.size };
  }

  auditLog(limit = 200) {
    return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(Math.min(1000, limit)).map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
  }
}

