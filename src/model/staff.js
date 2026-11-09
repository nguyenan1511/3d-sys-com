// Kiểm tra danh sách nhân viên với layout: bàn tồn tại, không trùng bàn, đủ sức chứa. Nhập sơ đồ chỗ ngồi CSV.
import { normEmployee } from '../sim/schedule.js';
import { parseTime } from '../core/util.js';

export function validateStaff(model, data) {
  const errors = [], warnings = [];
  const list = Array.isArray(data) ? data : (data.employees || []);
  const defaults = Array.isArray(data) ? {} : (data.defaults || {});
  const desks = model.desks;
  if (list.length > desks.length) {
    errors.push(`Có ${list.length} nhân viên nhưng layout.json chỉ có ${desks.length} bàn. Thêm bàn vào layout.json hoặc bớt nhân viên; ${list.length - desks.length} người sẽ không được đưa vào mô hình.`);
  }
  const seenId = new Set(), deskOwner = new Map(), out = [];
  for (const raw of list) {
    if (!raw.id) { errors.push(`Nhân viên "${raw.name || '?'}" thiếu id.`); continue; }
    if (seenId.has(raw.id)) { errors.push(`Trùng id nhân viên "${raw.id}".`); continue; }
    seenId.add(raw.id);
    let e;
    try {
      e = normEmployee(raw, defaults);
      parseTime(e.shift.arrive); parseTime(e.shift.leave); parseTime(e.lunch.start);
      for (const m of e.meetings) parseTime(m.start);
    } catch (err) { errors.push(`${raw.id}: ${err.message}`); continue; }
    e.meetings = e.meetings.filter(m => {
      if (model.meetingRooms.has(m.room)) return true;
      warnings.push(`${e.id}: không có phòng họp "${m.room}" trong layout.json, bỏ cuộc họp lúc ${m.start}.`);
      return false;
    });
    e.status = 'ok';
    if (e.deskId) {
      if (!model.deskById.has(e.deskId)) { errors.push(`${e.id} (${e.name}): bàn "${e.deskId}" không có trong layout.json.`); e.status = 'noDesk'; e.deskId = null; }
      else if (deskOwner.has(e.deskId)) { errors.push(`${e.id} (${e.name}): bàn "${e.deskId}" đã thuộc ${deskOwner.get(e.deskId)}. Không xếp hai người một bàn.`); e.status = 'conflict'; e.deskId = null; }
      else deskOwner.set(e.deskId, e.id);
    } else e.status = 'auto';
    out.push(e);
  }
  // người chưa có bàn: tự xếp vào bàn trống (cảnh báo), hết bàn thì báo lỗi
  const free = desks.filter(d => !deskOwner.has(d.id) && d.kind !== 'reception');
  for (const e of out) {
    if (e.status !== 'auto') continue;
    const d = free.shift();
    if (d) { e.deskId = d.id; deskOwner.set(d.id, e.id); e.status = 'ok'; warnings.push(`${e.id} (${e.name}) chưa có deskId, tạm xếp vào bàn ${d.id}.`); }
    else { e.status = 'noDesk'; errors.push(`${e.id} (${e.name}): hết bàn trống.`); }
  }
  return { employees: out, active: out.filter(e => e.status === 'ok'), errors, warnings, deskOwner };
}

/** Đọc CSV "nhân viên, mã bàn". Cột nhân viên có thể là id hoặc tên. Dòng tiêu đề tự nhận. */
export function parseSeatingCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (!lines.length) return { rows: [], errors: ['File CSV rỗng.'] };
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : (lines[0].includes('\t') ? '\t' : ',');
  const split = l => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === delim) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim()); return out;
  };
  let rows = lines.map(split);
  let ci = 0, cd = 1;
  const head = rows[0].map(h => h.toLowerCase());
  const isHead = head.some(h => /(desk|bàn|ban|mã|ma|nhân|nhan|employee|name|tên|ten|id)/.test(h)) && !rows[0].some(c => /^[A-Z]{1,3}\d?-\d+$/i.test(c));
  if (isHead) {
    const fd = head.findIndex(h => /(desk|bàn|ban|chỗ|cho)/.test(h));
    const fe = head.findIndex((h, i) => i !== fd && /(nhân|nhan|employee|name|tên|ten|id|nv)/.test(h));
    if (fd >= 0) cd = fd; if (fe >= 0) ci = fe;
    rows = rows.slice(1);
  }
  const errors = [];
  const out = [];
  rows.forEach((r, i) => {
    const emp = r[ci], desk = r[cd];
    if (!emp) { errors.push(`Dòng ${i + 1 + (isHead ? 1 : 0)}: thiếu nhân viên.`); return; }
    out.push({ employee: emp, deskId: desk || null, line: i + 1 + (isHead ? 1 : 0) });
  });
  return { rows: out, errors };
}

/** Áp sơ đồ chỗ ngồi vào dữ liệu nhân viên (trả về bản sao). */
export function applySeating(data, rows) {
  const copy = JSON.parse(JSON.stringify(data));
  const list = copy.employees;
  const errors = [];
  const norm = s => String(s).trim().toLowerCase().normalize('NFC');
  const touched = new Set();
  for (const r of rows) {
    const e = list.find(x => norm(x.id) === norm(r.employee)) || list.find(x => norm(x.name) === norm(r.employee));
    if (!e) { errors.push(`Dòng ${r.line}: không tìm thấy nhân viên "${r.employee}".`); continue; }
    e.deskId = r.deskId || undefined;
    touched.add(e.id);
  }
  // người không có trong CSV mà đang giữ bàn được CSV giao cho người khác -> bỏ bàn cũ để tránh trùng
  const taken = new Set(list.filter(e => touched.has(e.id) && e.deskId).map(e => e.deskId));
  for (const e of list) if (!touched.has(e.id) && e.deskId && taken.has(e.deskId)) { errors.push(`${e.id} (${e.name}) mất bàn ${e.deskId} vì CSV giao bàn này cho người khác.`); e.deskId = undefined; }
  return { data: copy, errors, updated: touched.size };
}

export function seatingCsv(employees) {
  return 'nhan_vien,ma_ban\n' + employees.map(e => `${e.id},${e.deskId || ''}`).join('\n') + '\n';
}
