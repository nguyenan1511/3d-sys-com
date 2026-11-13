// Bảng thông báo công ty: tin chính (thông báo) và sự kiện sắp tới / mới của công ty.
//  • Ai đăng: CEO (admin), nhân viên Phòng Hành chính - Nhân sự (theo hồ sơ hoặc bàn mình nhận), và nhân viên được CEO cấp quyền
//    đăng tin (employees.can_post — giống quyền mở nhạc / bật đèn). Sửa / gỡ / ghim mọi tin: CEO + HC-NS; người được cấp quyền
//    chỉ sửa / gỡ tin của chính mình (không ghim). Mọi người đọc.
//  • Thứ tự: tin ghim → sự kiện sắp diễn ra (gần nhất trước) → tin mới nhất. 10 tin đầu hiện trên bảng 3D ở sảnh, phần còn lại
//    xem trong danh sách "Xem thêm" (tải theo trang). Sự kiện đã qua xếp theo ngày đăng như tin thường.
// Bảng announcements: { id, kind: 'notice'|'event', title, body, pinned, event_at, place, by, by_name, created_at, updated_at }.
import { deptIdOf } from './social.js';
import { HttpError } from './store.js';
import { audit } from './db.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export const BOARD_TOP = 10;
const PAGE = 10;
const MAX = { title: 120, body: 2000, place: 80 };

/** CEO hoặc HC-NS: quản lý mọi tin (sửa, gỡ, ghim). */
export function canManage(store, actor) { return actor.kind === 'admin' || deptIdOf(store, actor) === 'hcns'; }
/** Được đăng tin: CEO, HC-NS, hoặc nhân viên được CEO cấp quyền. */
export function canPost(store, actor) { return canManage(store, actor) || (actor.kind === 'employee' && !!store.db.employees.get(actor.code)?.can_post); }
const keyOfActor = a => a.kind === 'admin' ? `admin:${a.username}` : `employee:${a.code}`;
/** Sửa / gỡ được tin này không. */
export function canEdit(store, actor, r) { return canManage(store, actor) || (canPost(store, actor) && r?.by === keyOfActor(actor)); }
/** CEO cấp / thu quyền đăng tin của một nhân viên. */
export function setPostPermission(store, code, allow) { return store.db.employees.update(code, { can_post: allow ? 1 : 0 }) === 1; }
export function postPermissions(store) { return store.db.employees.where(r => r.can_post).map(r => r.code); }
const NO = 'Bạn chưa được CEO cấp quyền đăng tin.', NOT_MINE = 'Bạn chỉ sửa / gỡ được tin của chính mình.';
function needEdit(store, actor, cur) { if (!canEdit(store, actor, cur)) throw new HttpError(403, canPost(store, actor) ? NOT_MINE : NO, { code: 'forbidden' }); }

const upcoming = (r, now) => r.kind === 'event' && r.event_at && r.event_at >= now - 2 * 3600e3;   // (sự kiện đang diễn ra 2 giờ vẫn tính "sắp diễn ra")
/** Thứ tự hiển thị chung (bảng 3D + danh sách). */
export function ordered(store, now = Date.now()) {
  const rank = r => r.pinned ? 0 : upcoming(r, now) ? 1 : 2;
  return store.db.announcements.all().sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? a.event_at - b.event_at : b.created_at - a.created_at) || b.id - a.id);
}
export const view = (r, now = Date.now()) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, pinned: !!r.pinned, eventAt: r.event_at || null, place: r.place || '', by: r.by, byName: r.by_name, createdAt: r.created_at, updatedAt: r.updated_at, upcoming: upcoming(r, now), image: r.image_v ? `/api/board/${r.id}/image?v=${r.image_v}` : null });

/** Trang tin: offset 0 = 10 tin trên bảng; offset ≥ 10 = tin cũ hơn ("Xem thêm"). */
export function page(store, { offset = 0, limit = offset < BOARD_TOP ? BOARD_TOP : PAGE, kind = null, actor = null } = {}) {
  const now = Date.now();
  let all = ordered(store, now); if (kind) all = all.filter(r => r.kind === kind);
  return { items: all.slice(offset, offset + limit).map(r => ({ ...view(r, now), canEdit: actor ? canEdit(store, actor, r) : false })), total: all.length, hasMore: offset + limit < all.length };
}

function clean(body, partial = false) {
  const out = {};
  const str = (k, max, need) => {
    const x = body?.[k]; if (x === undefined) { if (need && !partial) throw new HttpError(400, `Thiếu ${k === 'title' ? 'tiêu đề' : k}.`, { code: 'invalid', field: k }); return; }
    const s = String(x ?? '').normalize('NFC').replace(/\r\n?/g, '\n').trim();
    if (need && !s) throw new HttpError(400, 'Tiêu đề không được để trống.', { code: 'invalid', field: k });
    if (s.length > max) throw new HttpError(400, `${k === 'title' ? 'Tiêu đề' : k === 'body' ? 'Nội dung' : 'Địa điểm'} tối đa ${max} ký tự.`, { code: 'invalid', field: k });
    out[k] = s;
  };
  str('title', MAX.title, true); str('body', MAX.body, false); str('place', MAX.place, false);
  if (body?.kind !== undefined) { if (!['notice', 'event'].includes(body.kind)) throw new HttpError(400, 'Loại tin không hợp lệ.', { code: 'invalid', field: 'kind' }); out.kind = body.kind; }
  else if (!partial) out.kind = 'notice';
  if (body?.pinned !== undefined) out.pinned = body.pinned ? 1 : 0;
  if (body?.eventAt !== undefined) {
    const t = body.eventAt == null || body.eventAt === '' ? null : Number(body.eventAt);
    if (t != null && (!Number.isFinite(t) || t < Date.UTC(2020, 0) || t > Date.now() + 3 * 365 * 86400e3)) throw new HttpError(400, 'Thời gian sự kiện không hợp lệ.', { code: 'invalid', field: 'eventAt' });
    out.event_at = t;
  }
  return out;
}

export function create(store, actor, who, body) {
  if (!canPost(store, actor)) throw new HttpError(403, NO, { code: 'forbidden' });
  const r = clean(body); if (!canManage(store, actor)) delete r.pinned;   // (ghim: chỉ CEO / HC-NS)
  if (r.kind === 'event' && !r.event_at) throw new HttpError(400, 'Sự kiện cần có ngày giờ diễn ra.', { code: 'invalid', field: 'eventAt' });
  if (r.kind !== 'event') { r.event_at = null; r.place = ''; }
  const now = Date.now();
  const id = store.db.announcements.insert({ kind: r.kind, title: r.title, body: r.body || '', pinned: r.pinned || 0, event_at: r.event_at || null, place: r.place || '', by: who.key, by_name: who.name, created_at: now, updated_at: now });
  audit(store.db, who.key, 'board.post', String(id), { title: r.title, kind: r.kind });
  return view(store.db.announcements.get(id));
}
export function update(store, actor, who, id, body) {
  const cur = store.db.announcements.get(id); if (!cur) throw new HttpError(404, 'Tin này không còn.', { code: 'not_found' });
  needEdit(store, actor, cur);
  const r = clean(body, true); if (!canManage(store, actor)) delete r.pinned;
  const next = { ...cur, ...r };
  if (next.kind === 'event' && !next.event_at) throw new HttpError(400, 'Sự kiện cần có ngày giờ diễn ra.', { code: 'invalid', field: 'eventAt' });
  if (next.kind !== 'event') { next.event_at = null; next.place = ''; }
  store.db.announcements.update(id, { ...next, updated_at: Date.now() });
  audit(store.db, who.key, 'board.edit', String(id), { title: next.title });
  return view(store.db.announcements.get(id));
}
export function remove(store, actor, who, id) {
  const cur = store.db.announcements.get(id); if (!cur) throw new HttpError(404, 'Tin này không còn.', { code: 'not_found' });
  needEdit(store, actor, cur);
  store.db.announcements.del(id);
  if (cur.image_v) store.db.blobs?.del(`ann:${id}`).catch(() => {});
  audit(store.db, who.key, 'board.delete', String(id), { title: cur.title });
}

// ---------- tin mẫu ----------
const vn = (y, mo, d, h = 8, mi = 0) => Date.UTC(y, mo - 1, d, h - 7, mi);
/** Bảng còn trống lần đầu chạy: đăng sẵn vài tin mẫu của Phòng HC-NS (lịch nghỉ lễ, sinh nhật, sự kiện) — chỉ một lần
 *  (world_state 'board_seeded'); gỡ đi thì không tự đăng lại. Sự kiện đã qua thì bỏ. */
export function seedBoard(store, now = Date.now()) {
  const db = store.db;
  if (db.world_state.get('board_seeded') || db.announcements.count()) return 0;
  const items = [
    { kind: 'event', pinned: 1, title: 'Lịch nghỉ Tết Dương lịch 2027', event_at: vn(2027, 1, 1, 8), place: 'Toàn công ty', body: 'Toàn công ty nghỉ Thứ Sáu 01/01/2027 (Tết Dương lịch), đi làm lại Thứ Hai 04/01/2027.\nCác bộ phận trực vận hành sắp xếp lịch trực và gửi Phòng Hành chính - Nhân sự trước 25/12.' },
    { kind: 'event', title: 'Tết Nguyên Đán Đinh Mùi 2027', event_at: vn(2027, 2, 6, 8), place: 'Toàn công ty', body: 'Mùng 1 Tết rơi vào Thứ Bảy 06/02/2027. Lịch nghỉ chính thức sẽ được Phòng HC-NS thông báo sau khi có hướng dẫn của Nhà nước.\nMọi người chủ động sắp xếp công việc và kế hoạch về quê nhé.' },
    { kind: 'event', title: 'Tri ân Ngày Nhà giáo Việt Nam 20/11', event_at: vn(2026, 11, 20, 16), place: 'Pantry tầng trệt', body: 'Cùng gửi lời cảm ơn tới các anh chị mentor, người hướng dẫn của các bạn Fresher. Có trà bánh tại Pantry lúc 16:00.' },
    { kind: 'notice', title: '🎂 Chúc mừng sinh nhật các thành viên tháng 11', body: 'SYSONE chúc mừng sinh nhật các thành viên có ngày sinh trong tháng 11! Chúc mọi người thật nhiều sức khoẻ, niềm vui và thành công.\nTiệc sinh nhật chung của tháng diễn ra chiều Thứ Sáu 27/11 tại Pantry — mời cả nhà tới chung vui.' },
    { kind: 'event', title: '🎂 Tiệc sinh nhật chung tháng 11', event_at: vn(2026, 11, 27, 16), place: 'Pantry tầng trệt', body: 'Bánh kem, trà sữa và một chút bất ngờ cho các bạn sinh tháng 11. Nhớ ghé Pantry lúc 16:00 nhé!' },
    { kind: 'event', title: 'Khám sức khoẻ định kỳ năm 2026', event_at: vn(2026, 11, 25, 7, 30), place: 'Phòng khám đối tác (HC-NS gửi địa chỉ)', body: 'Toàn bộ nhân viên chính thức khám sức khoẻ định kỳ. Nhịn ăn sáng trước khi lấy máu. Ai bận lịch này vui lòng báo HC-NS để xếp đợt sau.' },
    { kind: 'event', image: 'tv', title: 'Tiệc Giáng sinh văn phòng', event_at: vn(2026, 12, 24, 17, 30), place: 'Sảnh tầng trệt', body: 'Trang trí cây thông, trao quà Secret Santa (quà khoảng 150.000đ). Đăng ký tham gia trước 18/12 với Phòng HC-NS.' },
    { kind: 'event', title: 'Tiệc tất niên SYSONE 2026', event_at: vn(2027, 1, 22, 18), place: 'HC-NS sẽ gửi địa điểm sau', body: 'Tổng kết năm 2026, vinh danh cá nhân và phòng ban xuất sắc, bốc thăm trúng thưởng. Trang phục: lịch sự.' },
    { kind: 'notice', image: 'clock', title: 'Nhắc kiểm tra bảng công tháng 11 trước 30/11', body: 'Mọi người mở "Bảng công của tôi" trong văn phòng 3D để kiểm tra giờ vào / ra. Có sai sót thì báo Phòng HC-NS trước ngày 30/11 để điều chỉnh.' },
    { kind: 'notice', image: 'meeting', title: 'Đặt phòng họp ngay trong văn phòng 3D', body: 'Bấm nút "Họp" ở góc trên để đặt phòng họp tầng trệt theo khung 30 phút và mời đồng nghiệp. Tới giờ mọi người được nhắn tự động.\nKhông dùng nữa thì nhớ huỷ lịch để nhường phòng cho người khác.' },
    { kind: 'notice', image: 'guide', title: 'Chào mừng các thành viên mới tháng 11', body: 'Chào mừng các bạn mới gia nhập SYSONE! Chị Mai ở sảnh sẽ hướng dẫn chỗ ngồi và việc tuần đầu. Cả nhà nhớ chào hỏi và giúp đỡ các bạn nhé.' },
    { kind: 'notice', title: 'Nội quy: không hút thuốc trong văn phòng', body: 'Khu vực hút thuốc ở ngoài vỉa hè. Giữ không gian làm việc sạch sẽ, thoáng mát cho mọi người.' }
  ].filter(x => x.kind !== 'event' || x.event_at > now);
  const pics = [];
  db.tx(() => {
    items.forEach((x, i) => {
      const t = now - (items.length - i) * 3 * 3600e3;   // (tin trên cùng là tin đăng gần nhất)
      const pic = x.image && path.join(ROOT, 'public/intro', `${x.image}.webp`);
      const id = db.announcements.insert({ image_v: pic && fs.existsSync(pic) ? t : null, kind: x.kind, title: x.title, body: x.body, pinned: x.pinned || 0, event_at: x.event_at || null, place: x.place || '', by: 'system:hcns', by_name: 'Phòng Hành chính - Nhân sự', created_at: t, updated_at: t });
      if (pic && fs.existsSync(pic)) pics.push([id, pic]);
    });
    db.world_state.upsert({ key: 'board_seeded', value: String(now), updated_at: now, updated_by: 'system' });
  });
  // ảnh mẫu: ảnh 3D của văn phòng (public/intro) — ghi vào kho file sau giao dịch
  for (const [id, pic] of pics) db.blobs?.put(`ann:${id}`, fs.readFileSync(pic), 'image/webp').catch(() => db.announcements.update(id, { image_v: null }));
  return items.length;
}

// ---------- ảnh của tin ----------
export const IMAGE_MAX = 1.5 * 1024 * 1024;
const IMG_TYPES = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
/** Gắn / thay ảnh cho tin (máy người đăng đã thu nhỏ ảnh; server kiểm tra lại loại thật của file + kích thước). */
export async function setImage(store, actor, who, id, { data, type } = {}) {
  const cur = store.db.announcements.get(id); if (!cur) throw new HttpError(404, 'Tin này không còn.', { code: 'not_found' });
  needEdit(store, actor, cur);
  const magic = IMG_TYPES[type];
  if (!magic || typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new HttpError(400, 'Ảnh phải là JPG, PNG hoặc WebP.', { code: 'bad_type' });
  const buf = Buffer.from(data, 'base64');
  if (!buf.length || !magic.every((b, i) => buf[i] === b) || (type === 'image/webp' && buf.toString('latin1', 8, 12) !== 'WEBP')) throw new HttpError(400, 'File không phải ảnh hợp lệ.', { code: 'bad_type' });
  if (buf.length > IMAGE_MAX) throw new HttpError(413, 'Ảnh tối đa 1,5 MB.', { code: 'too_large' });
  await store.db.blobs.put(`ann:${id}`, buf, type);
  store.db.announcements.update(id, { image_v: Date.now(), updated_at: Date.now() });
  audit(store.db, who.key, 'board.image', String(id), { size: buf.length });
  return view(store.db.announcements.get(id));
}
export async function dropImage(store, actor, who, id) {
  const cur = store.db.announcements.get(id); if (!cur) throw new HttpError(404, 'Tin này không còn.', { code: 'not_found' });
  needEdit(store, actor, cur);
  await store.db.blobs.del(`ann:${id}`).catch(() => {});
  store.db.announcements.update(id, { image_v: null, updated_at: Date.now() });
  return view(store.db.announcements.get(id));
}
