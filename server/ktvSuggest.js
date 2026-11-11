// Gợi ý bài karaoke từ YouTube cho phòng hát: đọc trang kết quả tìm kiếm công khai của YouTube (không cần khoá API),
// lấy danh sách video (id, tên, thời lượng, kênh, lượt xem). Có sẵn các nhóm "hot" (nhạc trẻ, tone nam/nữ, song ca,
// bolero…) và ô tìm theo tên bài (tự thêm chữ "karaoke"). Kết quả lưu đệm 6 giờ / mỗi truy vấn; YouTube đổi giao diện
// hoặc mạng lỗi thì trả danh sách rỗng (phòng hát vẫn dán link được như cũ).
export const CATEGORIES = [
  { id: 'hot', label: 'Hot nhất', q: 'karaoke nhạc trẻ hot nhất' },
  { id: 'nam', label: 'Tone nam', q: 'karaoke tone nam beat chuẩn hot' },
  { id: 'nu', label: 'Tone nữ', q: 'karaoke tone nữ beat chuẩn hot' },
  { id: 'songca', label: 'Song ca', q: 'karaoke song ca nam nữ hot' },
  { id: 'bolero', label: 'Bolero', q: 'karaoke bolero tone nam nữ hay nhất' },
  { id: 'remix', label: 'Remix quẩy', q: 'karaoke remix sôi động' },
  { id: 'usuk', label: 'US-UK', q: 'karaoke english songs popular' }
];
const TTL = 6 * 3600e3, MAX_CACHE = 200, cache = new Map();
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Trích video từ dữ liệu trang kết quả (ytInitialData). Tách riêng để kiểm thử. */
export function parseResults(html, limit = 20) {
  const m = String(html).match(/var ytInitialData = (\{.*?\});<\/script>/s); if (!m) return [];
  let data; try { data = JSON.parse(m[1]); } catch { return []; }
  const out = [], seen = new Set();
  (function walk(o) {
    if (!o || typeof o !== 'object' || out.length >= limit) return;
    if (o.videoRenderer) {
      const v = o.videoRenderer, id = v.videoId;
      if (/^[\w-]{11}$/.test(id || '') && !seen.has(id) && v.lengthText) {   // (bỏ video đang phát trực tiếp: không có thời lượng)
        seen.add(id);
        out.push({ videoId: id, title: (v.title?.runs || []).map(r => r.text).join('').slice(0, 200), duration: v.lengthText?.simpleText || '',
          channel: v.ownerText?.runs?.[0]?.text?.slice(0, 80) || '', views: v.shortViewCountText?.simpleText || v.viewCountText?.simpleText || '' });
      }
      return;
    }
    for (const k in o) walk(o[k]);
  })(data);
  return out;
}

/** cat: id nhóm, hoặc q: chữ người dùng gõ. Trả về { items, cached }. */
export async function suggest({ cat, q }) {
  let query = CATEGORIES.find(c => c.id === cat)?.q;
  if (!query) { const t = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 80); if (!t) query = CATEGORIES[0].q; else query = /karaoke/i.test(t) ? t : `karaoke ${t}`; }
  const key = query.toLowerCase(), hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { items: hit.items, cached: true };
  if (process.env.VITEST || process.env.NO_NET) return { items: [] };
  let items = [];
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
    // sp=EgIQAQ%3D%3D: chỉ video (không kênh / danh sách phát)
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D&hl=vi&gl=VN`, { signal: ctl.signal, headers: { 'user-agent': UA, 'accept-language': 'vi-VN,vi;q=0.9,en;q=0.6' } });
    clearTimeout(t);
    if (r.ok) items = parseResults(await r.text());
  } catch { /* (mạng lỗi: trả rỗng) */ }
  if (items.length) { cache.set(key, { at: Date.now(), items }); if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); }
  return { items };
}
