// Dung lượng file (bảng Quản trị → Sao lưu): thống kê theo loại + dọn "file thừa" — nội dung file không còn chủ (dự án / cuộc họp /
// tin đã xoá, tài liệu đã gỡ, logo đã thay…). File lưu ở db.blobs (MongoDB collection "blobs", hoặc thư mục khi chạy dev), mã:
//   pfile:<id> tài liệu dự án · file:<id> tài liệu họp · board:<phòng> nội dung bảng vẽ · wbf:<phòng>:<ảnh> ảnh trên bảng vẽ
//   plogo:<id> logo dự án · ann:<id> ảnh bảng thông báo · fb:<id> ảnh góp ý · tiktok:list danh sách TikTok. Phòng: số (cuộc họp) hoặc p<id> (dự án).
const RE = /^(pfile|file|board|wbf|plogo|annimg|ann|tiktok|fb)[:_](.+)$/;
export const FILE_GROUPS = [['pfile', 'Tài liệu dự án'], ['file', 'Tài liệu cuộc họp'], ['wbf', 'Ảnh trên bảng vẽ'], ['board', 'Nội dung bảng vẽ'], ['plogo', 'Logo dự án'], ['ann', 'Ảnh bảng thông báo'], ['annimg', 'Ảnh trong nội dung tin'], ['fb', 'Ảnh góp ý / báo lỗi'], ['tiktok', 'Danh sách TikTok'], ['other', 'Khác']];

/** File còn được dùng không. */
function owned(db, kind, rest) {
  const num = s => Number(String(s).split(/[:_]/)[0]);
  const room = () => { const r = String(rest).split(/[:_]/)[0]; if (/^p\d+$/.test(r)) { const p = db.projects.get(Number(r.slice(1))); return !!p && p.status !== 'deleted'; } return /^\d+$/.test(r) && !!db.meetings.get(Number(r)); };
  switch (kind) {
    case 'pfile': return !!db.project_files.get(num(rest));
    case 'file': return !!db.meeting_files.get(num(rest));
    case 'board': case 'wbf': return room();
    case 'plogo': { const p = db.projects.get(num(rest)); return !!p && p.status !== 'deleted' && !!p.logo_v; }
    case 'ann': { const a = db.announcements.get(num(rest)); return !!a && !!a.image_v; }
    case 'annimg': { const id = String(rest); if (Date.now() - parseInt(id.split('-')[0], 36) < 86400e3) return true; return db.announcements.where(a => String(a.body || '').includes(`/api/board/img/${id}`)).length > 0; }   // (vừa tải, chưa đăng: còn 1 ngày)
    case 'fb': { const m = db.feedback_messages.get(num(rest)); return !!m && !!m.image_v; }
    default: return true;
  }
}

/** { used, max, groups: [{ key, label, count, bytes }], orphans: { count, bytes } } */
export function fileReport(db) {
  const list = db.blobs.list?.() || [], by = new Map(FILE_GROUPS.map(([k, l]) => [k, { key: k, label: l, count: 0, bytes: 0 }])), orphans = { count: 0, bytes: 0 };
  for (const f of list) {
    const m = RE.exec(f.key), kind = m ? m[1] : 'other', g = by.get(kind);
    g.count++; g.bytes += f.size;
    if (m && !owned(db, kind, m[2])) { orphans.count++; orphans.bytes += f.size; }
  }
  const u = db.blobs.usage?.() || { used: 0, max: 0 };
  return { used: u.used, max: u.max, groups: [...by.values()].filter(g => g.count), orphans };
}

/** Xoá các file thừa. Trả về { count, bytes } đã dọn. */
export async function pruneFiles(db) {
  const out = { count: 0, bytes: 0 };
  for (const f of db.blobs.list?.() || []) {
    const m = RE.exec(f.key); if (!m || owned(db, m[1], m[2])) continue;
    try { await db.blobs.del(f.id); out.count++; out.bytes += f.size; } catch { /* lần sau dọn tiếp */ }
  }
  return out;
}

// ---------- danh sách chi tiết: mỗi file nằm ở đâu, ai tải lên (Admin quản lý được) ----------
const DAY = 86400e3;
/** Nơi chứa của một phòng bảng vẽ: dự án (p<id>) hoặc cuộc họp (<id>). */
function roomWhere(db, r) {
  if (/^p\d+$/.test(r)) { const p = db.projects.get(Number(r.slice(1))); return { type: 'project', id: p?.id ?? Number(r.slice(1)), title: p ? (p.status === 'deleted' ? `${p.name} (đã xoá)` : p.name) : 'Dự án đã xoá' }; }
  const m = /^\d+$/.test(r) ? db.meetings.get(Number(r)) : null;
  return { type: 'meeting', id: m?.id ?? Number(r), title: m ? m.title : 'Cuộc họp đã xoá' };
}
/** Một file: { key (mã để xoá), kind, name, where: { type, id, title }, by, ts, size, orphan, deletable }. */
function describe(db, f) {
  const m = RE.exec(f.key), kind = m ? m[1] : 'other', rest = m ? m[2] : f.key, num = Number(String(rest).split(/[:_]/)[0]);
  const out = { key: f.id, kind, name: '', where: null, by: '', ts: null, size: f.size, orphan: !!m && !owned(db, kind, rest), deletable: false };
  switch (kind) {
    case 'pfile': { const r = db.project_files.get(num), p = r && db.projects.get(r.project_id); Object.assign(out, { name: r?.name || '(tài liệu đã gỡ)', by: r?.by_name || '', ts: r?.ts || null, where: { type: 'project', id: r?.project_id ?? null, title: p ? p.name : 'Dự án đã xoá' }, deletable: true }); break; }
    case 'file': { const r = db.meeting_files.get(num), mt = r && db.meetings.get(r.meeting_id); Object.assign(out, { name: r?.name || '(tài liệu đã gỡ)', by: r?.by_name || '', ts: r?.ts || null, where: { type: 'meeting', id: r?.meeting_id ?? null, title: mt ? mt.title : 'Cuộc họp đã xoá' }, deletable: true }); break; }
    case 'wbf': { const [room, fid] = String(rest).split(/[:_]/); Object.assign(out, { name: `Ảnh dán lên bảng vẽ (${fid || '?'})`, where: { ...roomWhere(db, room), part: 'Bảng vẽ' } }); break; }
    case 'board': Object.assign(out, { name: 'Nội dung bảng vẽ', where: { ...roomWhere(db, String(rest)), part: 'Bảng vẽ' } }); break;
    case 'plogo': { const p = db.projects.get(num); Object.assign(out, { name: 'Logo dự án', ts: p?.logo_v || null, where: { type: 'project', id: num, title: p ? p.name : 'Dự án đã xoá' } }); break; }
    case 'ann': { const a = db.announcements.get(num); Object.assign(out, { name: 'Ảnh bìa của tin', by: a?.by_name || '', ts: a?.image_v || null, where: { type: 'board', id: num, title: a ? a.title : 'Tin đã gỡ' } }); break; }
    case 'annimg': { const id = String(rest), a = db.announcements.find(x => String(x.body || '').includes(`/api/board/img/${id}`)); Object.assign(out, { name: 'Ảnh trong nội dung tin', by: a?.by_name || '', ts: parseInt(id.split('-')[0], 36) || null, where: { type: 'board', id: a?.id ?? null, title: a ? a.title : 'Chưa gắn vào tin nào' } }); break; }
    case 'fb': { const msg = db.feedback_messages.get(num), t = msg && db.feedback_threads.get(msg.thread_id); Object.assign(out, { name: 'Ảnh đính kèm', by: msg?.by_name || '', ts: msg?.ts || null, where: { type: 'feedback', id: t?.id ?? null, title: t ? `${t.kind === 'bug' ? 'Báo lỗi' : 'Góp ý'} của ${t.owner_name}` : 'Cuộc đã xoá' } }); break; }
    case 'tiktok': Object.assign(out, { name: 'Danh sách video TikTok', where: { type: 'system', title: 'Buồng vệ sinh · TikTok' } }); break;
    default: Object.assign(out, { name: f.key, where: { type: 'system', title: 'Khác' } });
  }
  if (out.orphan) out.deletable = true;
  return out;
}
/** Mọi file, file lớn trước. */
export function fileList(db) { return (db.blobs.list?.() || []).map(f => describe(db, f)).sort((a, b) => b.size - a.size); }

/** Admin xoá một file: tài liệu dự án / cuộc họp (xoá cả dòng tài liệu) hoặc file thừa. Trả về mô tả file đã xoá. */
export async function adminDeleteFile(db, key) {
  const f = (db.blobs.list?.() || []).find(x => x.id === key || x.key === key); if (!f) return null;
  const d = describe(db, f); if (!d.deletable) return { ...d, refused: true };
  const m = RE.exec(f.key), num = m ? Number(String(m[2]).split(/[:_]/)[0]) : NaN;
  if (d.kind === 'pfile' && db.project_files.get(num)) db.project_files.del(num);
  if (d.kind === 'file' && db.meeting_files.get(num)) db.meeting_files.del(num);
  await db.blobs.del(f.id);
  return d;
}
export const FILE_RECENT_MS = DAY;
