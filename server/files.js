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
