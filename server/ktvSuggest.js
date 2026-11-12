// Gợi ý bài karaoke từ YouTube cho phòng hát. Có YOUTUBE_API_KEY (.env): dùng YouTube Data API v3 chính thức — search.list
// (chỉ video cho phép nhúng, khu vực VN) + videos.list (thời lượng, lượt xem); mỗi lần tìm tốn ~101 đơn vị quota (mặc định
// 10.000/ngày), có đệm 6 giờ nên đủ dùng. Không có khoá / API lỗi / hết quota: đọc trang kết quả tìm kiếm công khai.
// Mỗi video: id, tên, thời lượng, kênh, lượt xem. Có sẵn các nhóm "hot" (nhạc trẻ, tone nam/nữ, song ca,
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

const fmtDur = iso => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || ''); if (!m) return ''; const h = +m[1] || 0, mi = +m[2] || 0, se = +m[3] || 0; return h ? `${h}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}` : `${mi}:${String(se).padStart(2, '0')}`; };
const fmtViews = n => { n = +n; if (!Number.isFinite(n)) return ''; return n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} Tr lượt xem` : n >= 1e3 ? `${Math.round(n / 1e3)} N lượt xem` : `${n} lượt xem`; };
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
/** Tìm qua YouTube Data API v3. Trả về danh sách (rỗng nếu không có kết quả); ném lỗi nếu API lỗi (để rơi về cách đọc trang). */
export async function searchApi(query, key, fetchFn = fetch, limit = 20) {
  const get = async url => { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000); try { const r = await fetchFn(url, { signal: ctl.signal }); if (!r.ok) throw new Error(`YouTube API ${r.status}`); return await r.json(); } finally { clearTimeout(t); } };
  const sp = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: String(limit), q: query, regionCode: 'VN', relevanceLanguage: 'vi', safeSearch: 'moderate', key });
  const s = await get(`https://www.googleapis.com/youtube/v3/search?${sp}`);
  const ids = (s.items || []).map(i => i.id?.videoId).filter(id => /^[\w-]{11}$/.test(id || ''));
  if (!ids.length) return [];
  const v = await get(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'contentDetails,statistics', id: ids.join(','), key })}`);
  const info = new Map((v.items || []).map(x => [x.id, x]));
  const snip = new Map((s.items || []).map(i => [i.id?.videoId, i.snippet]));
  return ids.filter(id => info.get(id)?.contentDetails?.duration && info.get(id).contentDetails.duration !== 'P0D')   // (bỏ video đang phát trực tiếp)
    .map(id => ({ videoId: id, title: decode(snip.get(id)?.title).slice(0, 200), duration: fmtDur(info.get(id).contentDetails.duration), channel: decode(snip.get(id)?.channelTitle).slice(0, 80), views: fmtViews(info.get(id).statistics?.viewCount) }));
}

/** cat: id nhóm, hoặc q: chữ người dùng gõ; key: YOUTUBE_API_KEY (tuỳ chọn). Trả về { items, cached, source }. */
export async function suggest({ cat, q, key = '' }) {
  let query = CATEGORIES.find(c => c.id === cat)?.q;
  if (!query) { const t = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 80); if (!t) query = CATEGORIES[0].q; else query = /karaoke/i.test(t) ? t : `karaoke ${t}`; }
  const ck = query.toLowerCase(), hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return { items: hit.items, cached: true };
  if (process.env.VITEST || process.env.NO_NET) return { items: [] };
  let items = [], source = 'page';
  if (key) { try { items = await searchApi(query, key); source = 'api'; } catch (e) { console.warn('[karaoke] YouTube API lỗi, dùng trang tìm kiếm:', e.message); } }
  if (!items.length) try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
    // sp=EgIQAQ%3D%3D: chỉ video (không kênh / danh sách phát)
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D&hl=vi&gl=VN`, { signal: ctl.signal, headers: { 'user-agent': UA, 'accept-language': 'vi-VN,vi;q=0.9,en;q=0.6' } });
    clearTimeout(t);
    if (r.ok) { items = parseResults(await r.text()); source = 'page'; }
  } catch { /* (mạng lỗi: trả rỗng) */ }
  if (items.length) { cache.set(ck, { at: Date.now(), items }); if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); }
  return { items, source };
}
