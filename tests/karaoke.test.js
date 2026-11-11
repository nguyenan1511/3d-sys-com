// Phòng karaoke phía server (server/karaoke.js): tối đa 10 người, ưu tiên / xoá bài trong hàng chờ, kênh chat riêng của
// phòng (chỉ người trong phòng nhận, phòng trống thì xoá); gợi ý bài: đọc kết quả tìm kiếm YouTube (server/ktvSuggest.js).
import { describe, it, expect, beforeEach } from 'vitest';
import { Karaoke } from '../server/karaoke.js';
import { parseResults } from '../server/ktvSuggest.js';

let hub, k, sent;
const ws = key => ({ key });
beforeEach(() => {
  sent = [];
  hub = { presence: new Map(), sockets: new Map(), broadcast: m => sent.push({ to: '*', m }), send: (s, m) => sent.push({ to: s.key, m }) };
  k = new Karaoke(hub);
});
const join = key => { hub.sockets.set(key, [ws(key)]); hub.presence.set(key, { display: key.toUpperCase() }); k.onMessage(ws(key), { t: 'ktv:join' }); };
const errs = key => sent.filter(x => x.to === key && x.m.t === 'ktvErr').map(x => x.m.msg);

describe('phòng karaoke', () => {
  it('tối đa 10 người', () => {
    for (let i = 0; i < 11; i++) join(`u${i}`);
    expect(k.members.size).toBe(10);
    expect(errs('u10')[0]).toMatch('đủ 10 người');
  });
  it('ưu tiên đưa bài lên đầu hàng chờ; chỉ người chọn mới xoá được; không thêm trùng bài', async () => {
    join('a'); join('b');
    for (const id of ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']) await k.play(ws('a'), id, `Bài ${id[0]}`);
    await k.play(ws('b'), 'ddddddddddd', 'Bài d');
    expect(k.song.videoId).toBe('aaaaaaaaaaa');
    expect(k.queue.map(q => q.videoId[0])).toEqual(['b', 'c', 'd']);
    await k.play(ws('b'), 'ccccccccccc'); expect(errs('b').pop()).toMatch('đã có');
    k.onMessage(ws('b'), { t: 'ktv:priority', index: 2, videoId: 'ddddddddddd' });
    expect(k.queue.map(q => q.videoId[0])).toEqual(['d', 'b', 'c']);
    k.onMessage(ws('b'), { t: 'ktv:priority', index: 0, videoId: 'ccccccccccc' }); expect(errs('b').pop()).toMatch('vừa thay đổi');
    k.onMessage(ws('b'), { t: 'ktv:remove', index: 1, videoId: 'bbbbbbbbbbb' }); expect(errs('b').pop()).toMatch('Chỉ người chọn');
    k.onMessage(ws('a'), { t: 'ktv:remove', index: 1, videoId: 'bbbbbbbbbbb' });
    expect(k.queue.map(q => q.videoId[0])).toEqual(['d', 'c']);
    k.onMessage(ws('a'), { t: 'ktv:control', action: 'next' });
    expect(k.song).toMatchObject({ videoId: 'ddddddddddd', title: 'Bài d' }); expect(k.song.byKey).toBeUndefined();
  });
  it('chat chỉ gửi cho người trong phòng, người vào sau thấy tin cũ, phòng trống thì xoá', () => {
    join('a'); hub.sockets.set('x', [ws('x')]);
    k.onMessage(ws('a'), { t: 'ktv:say', text: '  hát   bài gì đây? ' });
    expect(sent.filter(s => s.m.t === 'ktvChat' && s.m.msg).map(s => s.to)).toEqual(['a']);
    k.onMessage(ws('x'), { t: 'ktv:say', text: 'ngoài phòng' }); expect(k.chat).toHaveLength(1);
    join('b');
    expect(sent.find(s => s.to === 'b' && s.m.t === 'ktvChat').m.history[0]).toMatchObject({ by: 'A', text: 'hát bài gì đây?' });
    k.leave('a'); k.leave('b');
    expect(k.chat).toEqual([]);
  });
});

describe('gợi ý bài karaoke', () => {
  it('đọc danh sách video từ trang kết quả YouTube, bỏ video phát trực tiếp và trùng lặp', () => {
    const v = (id, len) => ({ videoRenderer: { videoId: id, title: { runs: [{ text: 'Karaoke ' }, { text: id }] }, ...(len ? { lengthText: { simpleText: len } } : {}), ownerText: { runs: [{ text: 'Kênh' }] }, viewCountText: { simpleText: '1.000 lượt xem' } } });
    const data = { contents: [{ list: [v('AAAAAAAAAAA', '4:12'), v('BBBBBBBBBBB'), v('AAAAAAAAAAA', '4:12'), v('CCCCCCCCCCC', '3:01')] }] };
    const html = `<script>var ytInitialData = ${JSON.stringify(data)};</script>`;
    expect(parseResults(html)).toEqual([
      { videoId: 'AAAAAAAAAAA', title: 'Karaoke AAAAAAAAAAA', duration: '4:12', channel: 'Kênh', views: '1.000 lượt xem' },
      { videoId: 'CCCCCCCCCCC', title: 'Karaoke CCCCCCCCCCC', duration: '3:01', channel: 'Kênh', views: '1.000 lượt xem' }
    ]);
    expect(parseResults('<html>no data</html>')).toEqual([]);
  });
});
