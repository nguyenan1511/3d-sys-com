// Danh sách video TikTok cho buồng vệ sinh (server/tiktok.js): nhận link, kiểm tra bằng oEmbed (mạng giả), trùng, quyền xoá.
import { describe, it, expect } from 'vitest';
import { TikTokList, tiktokId, isTiktokUrl } from '../server/tiktok.js';

const blobs = () => { const m = new Map(); return { get: async k => m.get(k) || null, put: async (k, data) => { m.set(k, { data: Buffer.from(data) }); } }; };
const store = () => ({ db: { blobs: blobs() } });
/** Mạng giả: link rút gọn chuyển tới link gốc; oEmbed trả tiêu đề, mã 999… là video không công khai. */
const fakeFetch = async (url) => {
  if (url.startsWith('https://vt.tiktok.com/')) return { url: 'https://www.tiktok.com/@sysone/video/7300000000000000123?is_from_webapp=1' };
  if (url.startsWith('https://www.tiktok.com/oembed')) {
    if (url.includes('9990000000000000000')) return { ok: false, status: 400 };
    return { ok: true, status: 200, json: async () => ({ title: 'Một ngày ở SYSONE', author_name: 'sysone' }) };
  }
  throw new Error('no network');
};

describe('TikTok: nhận link', () => {
  it('đọc mã video từ các dạng link; chỉ nhận https tiktok.com', () => {
    expect(tiktokId('https://www.tiktok.com/@a.b/video/7300000000000000001?lang=vi')).toBe('7300000000000000001');
    expect(tiktokId('https://www.tiktok.com/embed/v2/7300000000000000002')).toBe('7300000000000000002');
    expect(tiktokId('https://www.tiktok.com/player/v1/7300000000000000003')).toBe('7300000000000000003');
    expect(tiktokId('https://vt.tiktok.com/ZSabc123/')).toBe(null);
    expect(isTiktokUrl('https://vt.tiktok.com/ZSabc123/')).toBe(true);
    expect(isTiktokUrl('http://www.tiktok.com/@a/video/1')).toBe(false);
    expect(isTiktokUrl('https://tiktok.com.evil.example/@a/video/7300000000000000001')).toBe(false);
  });
  it('link rút gọn được mở để lấy link gốc; tiêu đề / tác giả từ oEmbed', async () => {
    const tt = new TikTokList(store(), fakeFetch);
    const it = await tt.add('employee:1234', '1234-Lan', 'https://vt.tiktok.com/ZSabc123/');
    expect(it).toMatchObject({ id: '7300000000000000123', title: 'Một ngày ở SYSONE', author: 'sysone', by: 'employee:1234' });
  });
  it('video không công khai / không còn: báo lỗi; link khác trang: báo lỗi; trùng: 409', async () => {
    const tt = new TikTokList(store(), fakeFetch);
    await expect(tt.add('employee:1', 'x', 'https://www.tiktok.com/@a/video/9990000000000000000')).rejects.toMatchObject({ status: 400 });
    await expect(tt.add('employee:1', 'x', 'https://youtube.com/watch?v=abc')).rejects.toMatchObject({ status: 400 });
    await tt.add('employee:1', 'x', 'https://www.tiktok.com/@a/video/7300000000000000001');
    await expect(tt.add('employee:2', 'y', 'https://www.tiktok.com/@b/video/7300000000000000001')).rejects.toMatchObject({ status: 409 });
  });
  it('mới nhất đứng đầu, lưu lại được; chỉ người dán hoặc người quản lý xoá được', async () => {
    const st = store(), tt = new TikTokList(st, fakeFetch);
    await tt.add('employee:1', 'A', 'https://www.tiktok.com/@a/video/7300000000000000001');
    await tt.add('employee:2', 'B', 'https://www.tiktok.com/@a/video/7300000000000000002');
    const again = new TikTokList(st, fakeFetch);
    expect((await again.load()).map(x => x.id)).toEqual(['7300000000000000002', '7300000000000000001']);
    await expect(again.remove('employee:2', '7300000000000000001', false)).rejects.toMatchObject({ status: 403 });
    await again.remove('employee:9', '7300000000000000001', true);   // (Admin / HC-NS)
    await again.remove('employee:2', '7300000000000000002', false);  // (người dán)
    expect(await again.load()).toEqual([]);
  });
});

describe('kênh TikTok cố định (trang nhúng hồ sơ chính thức)', () => {
  const page = (handle, vids) => `<html><script id="__FRONTITY_CONNECT_STATE__" type="application/json">${JSON.stringify({ source: { data: { x: { userInfo: { uniqueId: handle, nickname: handle.toUpperCase() }, videoList: vids.map(([id, desc]) => ({ id, desc })) } } } })}</script></html>`;
  it('đọc mã + mô tả video từ trang nhúng; JSON đổi cấu trúc thì dò link /@kênh/video/<mã>', async () => {
    const { parseCreatorEmbed } = await import('../server/tiktok.js');
    expect(parseCreatorEmbed(page('vtv24news', [['7705605760830442759', 'Tin  nóng\nhôm nay'], ['7705605760830442759', 'trùng']]), 'vtv24news'))
      .toEqual([{ id: '7705605760830442759', title: 'Tin nóng hôm nay', author: 'VTV24NEWS' }]);
    expect(parseCreatorEmbed('<a href="https://www.tiktok.com/@abc.xyz/video/7111111111111111111?x=1">', 'abc.xyz').map(x => x.id)).toEqual(['7111111111111111111']);
  });
  it('xen kẽ video các kênh; lỗi mạng giữ bản cũ; Admin đổi kênh (chuẩn hoá @ / link, chặn tên sai, tối đa 12)', async () => {
    const { TikTokChannels, DEFAULT_CHANNELS } = await import('../server/tiktok.js');
    const prev = process.env.TIKTOK_OEMBED; delete process.env.TIKTOK_OEMBED;
    try {
      let fail = false;
      const store = { db: { world_state: new Map(), } };
      store.db.world_state.upsert = r => store.db.world_state.set(r.key, r);
      const ch = new TikTokChannels(store, async url => { if (fail) throw new Error('mạng'); const h = url.split('@')[1]; return { ok: true, text: async () => page(h, [[`${h.length}000000001`, `${h} 1`], [`${h.length}000000002`, `${h} 2`]]) }; });
      expect(ch.list()).toEqual(DEFAULT_CHANNELS);
      expect(ch.set('admin:a', ['@AbC', 'https://www.tiktok.com/@de.f?lang=vi', 'abc'])).toEqual(['abc', 'de.f']);
      expect(() => ch.set('admin:a', ['bad name!'])).toThrow(/không hợp lệ/);
      expect(() => ch.set('admin:a', Array.from({ length: 13 }, (_, i) => `k${i}`))).toThrow(/Tối đa 12/);
      const v = await ch.videos();
      expect(v.map(x => [x.channel, x.title])).toEqual([['abc', 'abc 1'], ['de.f', 'de.f 1'], ['abc', 'abc 2'], ['de.f', 'de.f 2']]);
      fail = true; for (const c of ch.cache.values()) c.at = 0;
      expect((await ch.videos()).length).toBe(4);   // (lỗi mạng: vẫn còn bản cũ)
    } finally { if (prev !== undefined) process.env.TIKTOK_OEMBED = prev; }
  });
});
