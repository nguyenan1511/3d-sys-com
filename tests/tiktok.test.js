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
    await again.remove('employee:9', '7300000000000000001', true);   // (CEO / HC-NS)
    await again.remove('employee:2', '7300000000000000002', false);  // (người dán)
    expect(await again.load()).toEqual([]);
  });
});
