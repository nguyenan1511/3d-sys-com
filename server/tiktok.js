// Lướt TikTok trong buồng vệ sinh: danh sách video chung do nhân viên dán link (không tự lấy bảng tin của TikTok — TikTok
// không có API công khai cho việc đó, còn tự cào trang thì vi phạm điều khoản). Mỗi link được kiểm tra bằng oEmbed chính
// thức của TikTok (tiêu đề, tác giả); link rút gọn vt./vm.tiktok.com được mở để lấy link gốc. Phát bằng trình phát nhúng
// chính thức (https://www.tiktok.com/player/v1/<mã>) phía trình duyệt — src/ui/tiktokPhone.js.
// Lưu ở db.blobs 'tiktok:list' (mới nhất trước, tối đa MAX). Người dán, CEO hoặc HC-NS xoá được.
import { HttpError } from './store.js';

const KEY = 'tiktok:list';
export const TIKTOK_MAX = 300;

/** Mã video từ link TikTok (dạng .../@user/video/<mã>, /v/<mã>, /embed/v2/<mã>, /player/v1/<mã>) — hoặc null. */
export function tiktokId(url) {
  const m = String(url || '').match(/tiktok\.com\/(?:@[\w.-]+\/(?:video|photo)|v|embed(?:\/v2)?|player\/v1)\/(\d{8,25})/);
  return m ? m[1] : null;
}
/** Link https thuộc tiktok.com (kể cả vt./vm. rút gọn). */
export function isTiktokUrl(url) {
  try { const u = new URL(String(url).trim()); return u.protocol === 'https:' && /(^|\.)tiktok\.com$/i.test(u.hostname); } catch { return false; }
}

export class TikTokList {
  /** fetchFn: để kiểm thử thay mạng thật. */
  constructor(store, fetchFn = (...a) => fetch(...a)) { this.store = store; this.fetch = fetchFn; this.list = null; }
  async load() {
    if (this.list) return this.list;
    try { const b = await this.store.db.blobs.get(KEY); const j = b ? JSON.parse(b.data.toString()) : []; this.list = Array.isArray(j) ? j : []; }
    catch { this.list = []; }
    return this.list;
  }
  async save() { await this.store.db.blobs.put(KEY, Buffer.from(JSON.stringify(this.list)), 'application/json'); }

  /** Link → { id, title, author }. Lỗi người dùng: HttpError 400. */
  async resolve(raw) {
    const url = String(raw || '').trim();
    if (!isTiktokUrl(url)) throw new HttpError(400, 'Dán link video TikTok (https://www.tiktok.com/@…/video/… hoặc https://vt.tiktok.com/…).', { code: 'invalid', field: 'url' });
    let id = tiktokId(url), page = url;
    if (!id) {   // link rút gọn: mở để lấy link gốc
      try { const r = await this.fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(7000), headers: { 'user-agent': 'Mozilla/5.0 SYSONE' } }); page = r.url || url; id = tiktokId(page); } catch { /* mạng lỗi */ }
    }
    if (!id) throw new HttpError(400, 'Không đọc được video từ link này — mở video trên TikTok, bấm Chia sẻ → Sao chép liên kết rồi dán lại.', { code: 'invalid', field: 'url' });
    const meta = { id, title: '', author: '' };
    if (process.env.TIKTOK_OEMBED === 'off') return meta;   // (kiểm thử: không gọi TikTok)
    try {
      const r = await this.fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(page.includes('/video/') ? page.split('?')[0] : `https://www.tiktok.com/@_/video/${id}`)}`, { signal: AbortSignal.timeout(7000) });
      if (r.ok) { const j = await r.json(); meta.title = String(j.title || '').slice(0, 150); meta.author = String(j.author_name || j.author_unique_id || '').slice(0, 60); }
      else if (r.status === 400 || r.status === 404) throw new HttpError(400, 'Video này không còn hoặc không công khai trên TikTok.', { code: 'invalid', field: 'url' });
    } catch (e) { if (e instanceof HttpError) throw e; /* oEmbed chậm / lỗi mạng: vẫn nhận theo mã video */ }
    return meta;
  }
  view(it, actorKey, manage) { return { ...it, canDelete: manage || it.by === actorKey }; }
  async add(actorKey, byName, url) {
    const list = await this.load(), v = await this.resolve(url);
    if (list.some(x => x.id === v.id)) throw new HttpError(409, 'Video này đã có trong danh sách rồi.', { code: 'exists' });
    const item = { id: v.id, title: v.title, author: v.author, by: actorKey, byName: String(byName || '').slice(0, 80), ts: Date.now() };
    list.unshift(item); if (list.length > TIKTOK_MAX) list.length = TIKTOK_MAX;
    await this.save();
    return item;
  }
  async remove(actorKey, id, manage) {
    const list = await this.load(), i = list.findIndex(x => x.id === id);
    if (i < 0) throw new HttpError(404, 'Không còn video này.', { code: 'not_found' });
    if (!manage && list[i].by !== actorKey) throw new HttpError(403, 'Chỉ người dán, CEO hoặc Hành chính - Nhân sự được xoá video này.', { code: 'forbidden' });
    const [it] = list.splice(i, 1); await this.save();
    return it;
  }
}
