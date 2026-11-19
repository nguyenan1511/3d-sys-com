// Lướt TikTok trong buồng vệ sinh. Nguồn video:
//  1. Kênh cố định (TikTokChannels): video mới nhất của vài kênh TikTok do CEO / HC-NS chọn, đọc từ trang nhúng hồ sơ CHÍNH THỨC
//     của TikTok (https://www.tiktok.com/embed/@kênh — trang TikTok làm sẵn để web khác nhúng), làm mới mỗi 30 phút. Nhân viên mở
//     điện thoại là có video, không cần dán link. (Bảng tin "Dành cho bạn" của TikTok thì không nhúng được — TikTok chặn.)
//  2. Video đồng nghiệp chia sẻ (TikTokList): dán link, kiểm tra bằng oEmbed chính thức (tiêu đề, tác giả); link rút gọn
//     vt./vm.tiktok.com được mở để lấy link gốc.
// Phát bằng trình phát nhúng chính thức (https://www.tiktok.com/player/v1/<mã>) phía trình duyệt — src/ui/tiktokPhone.js.
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

// ---------- kênh cố định ----------
const CH_KEY = 'tiktok:channels';
export const DEFAULT_CHANNELS = ['theanh28entertainment', 'yeah1.giaitri', 'vtv24news'];
const HANDLE = /^[\w.]{2,24}$/, CH_MAX = 12, TTL = 30 * 60e3;
export const cleanHandle = h => String(h || '').trim().replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '').toLowerCase();

/** Lấy danh sách video từ trang nhúng hồ sơ (JSON trong <script id="__FRONTITY_CONNECT_STATE__">); hỏng cấu trúc thì dò mã video. */
export function parseCreatorEmbed(html, handle) {
  const out = [], seen = new Set();
  const push = (id, desc, author) => { if (/^\d{8,25}$/.test(String(id)) && !seen.has(String(id))) { seen.add(String(id)); out.push({ id: String(id), title: String(desc || '').replace(/\s+/g, ' ').trim().slice(0, 150), author: String(author || handle).slice(0, 60) }); } };
  const m = /<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (m) {
    try {
      const walk = (o, author) => {
        if (!o || typeof o !== 'object') return;
        if (o.uniqueId && typeof o.uniqueId === 'string') author = o.nickname || o.uniqueId;
        const ui = Object.values(o).find(x => x && typeof x === 'object' && typeof x.uniqueId === 'string'); if (ui) author = ui.nickname || ui.uniqueId;   // (userInfo nằm cạnh videoList)
        if (Array.isArray(o.videoList)) for (const v of o.videoList) push(v?.id, v?.desc, author);
        for (const k of Object.keys(o)) if (k !== 'videoList') walk(o[k], author);
      };
      walk(JSON.parse(m[1]), handle);
    } catch { /* JSON đổi cấu trúc: dò bên dưới */ }
  }
  if (!out.length) for (const x of html.matchAll(new RegExp(`/@${handle.replace(/\./g, '\\.')}/video/(\\d{8,25})`, 'gi'))) push(x[1], '', handle);
  return out;
}

export class TikTokChannels {
  constructor(store, fetchFn = (...a) => fetch(...a)) { this.store = store; this.fetch = fetchFn; this.cache = new Map(); this.inflight = new Map(); }
  list() {
    const r = this.store.db.world_state.get(CH_KEY);
    try { const j = r ? JSON.parse(r.value) : null; if (Array.isArray(j)) return j; } catch { /* hỏng: dùng mặc định */ }
    return DEFAULT_CHANNELS.slice();
  }
  set(actorKey, raw) {
    if (!Array.isArray(raw)) throw new HttpError(400, 'Danh sách kênh không hợp lệ.', { code: 'invalid', field: 'channels' });
    const list = [...new Set(raw.map(cleanHandle).filter(Boolean))];
    const bad = list.find(h => !HANDLE.test(h)); if (bad) throw new HttpError(400, `Tên kênh "${bad}" không hợp lệ — nhập dạng @tenkenh.`, { code: 'invalid', field: 'channels' });
    if (list.length > CH_MAX) throw new HttpError(400, `Tối đa ${CH_MAX} kênh.`, { code: 'invalid', field: 'channels' });
    this.store.db.world_state.upsert({ key: CH_KEY, value: JSON.stringify(list), updated_at: Date.now(), updated_by: actorKey });
    return list;
  }
  /** Video mới nhất của một kênh (bộ nhớ đệm 30 phút; lỗi mạng: giữ bản cũ). */
  async channel(h) {
    const c = this.cache.get(h); if (c && Date.now() - c.at < TTL) return c.items;
    if (process.env.TIKTOK_OEMBED === 'off') return c?.items || [];   // (kiểm thử: không gọi TikTok)
    if (!this.inflight.has(h)) this.inflight.set(h, (async () => {
      try {
        const r = await this.fetch(`https://www.tiktok.com/embed/@${encodeURIComponent(h)}`, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'accept-language': 'vi-VN,vi;q=0.9' } });
        const items = r.ok ? parseCreatorEmbed(await r.text(), h) : [];
        if (items.length || !c) this.cache.set(h, { at: Date.now(), items });
        else this.cache.set(h, { at: Date.now() - TTL + 5 * 60e3, items: c.items });   // (lỗi: dùng bản cũ, thử lại sau 5 phút)
      } catch { this.cache.set(h, { at: Date.now() - TTL + 5 * 60e3, items: c?.items || [] }); }
      finally { this.inflight.delete(h); }
    })());
    await this.inflight.get(h);
    return this.cache.get(h)?.items || [];
  }
  /** Video của mọi kênh, xen kẽ kênh này kênh kia (mới nhất trước trong từng kênh). */
  async videos() {
    const chans = this.list(), lists = await Promise.all(chans.map(h => this.channel(h).then(l => l.map(x => ({ ...x, channel: h })))));
    const out = [], max = Math.max(0, ...lists.map(l => l.length));
    for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
    return out;
  }
}
