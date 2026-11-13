// Phòng karaoke (buồng karaoke ở tầng trệt): vào phòng, có ít nhất 2 người thì mới mở bài; bài lấy từ link YouTube,
// phát đồng bộ theo giờ server cho người trong phòng (tối đa 10 người); hàng chờ tối đa 20 bài, người trong phòng ưu tiên
// được một bài lên đầu, người chọn bài xoá được bài của mình. Kênh chat riêng của phòng: chỉ gửi cho người trong phòng,
// người vào sau thấy lại tin cũ; phòng trống thì xoá hết tin. Giọng hát đi thẳng giữa các máy (WebRTC) — server chỉ chuyển
// tin bắt tay ('rtc') giữa hai người cùng trong phòng. Trạng thái chỉ nằm trong bộ nhớ.
import { youtubeId, youtubeTitle } from './social.js';

const MAX = 10, MIN_TO_PLAY = 2, QUEUE = 20, CHAT = 80, CHAT_LEN = 300;

export class Karaoke {
  constructor(hub) { this.hub = hub; this.members = new Map(); this.song = null; this.queue = []; this.chat = []; this.lastSay = new Map(); this.disco = false; }
  state() {
    return { members: [...this.members].map(([key, v]) => ({ key, display: v.display, mic: v.mic, pos: v.pos || null })), song: this.song, queue: this.queue, disco: this.disco, min: MIN_TO_PLAY, max: MAX, serverNow: Date.now() };
  }
  push() { this.hub.broadcast({ t: 'ktv', state: this.state() }); }
  err(ws, msg) { this.hub.send(ws, { t: 'ktvErr', msg }); }
  display(ws) { return this.hub.presence.get(ws.key)?.display || ws.key; }
  /** Gửi riêng cho người trong phòng (mọi thẻ/tab của họ). */
  toMembers(msg) { for (const k of this.members.keys()) for (const s of this.hub.sockets.get(k) || []) this.hub.send(s, msg); }

  onMessage(ws, m) {
    switch (m.t) {
      case 'ktv:join':
        if (this.members.has(ws.key)) return;
        if (this.members.size >= MAX) return this.err(ws, `Phòng karaoke đã đủ ${MAX} người.`);
        this.members.set(ws.key, { display: this.display(ws), mic: false });
        for (const s of this.hub.sockets.get(ws.key) || []) this.hub.send(s, { t: 'ktvChat', history: this.chat });   // (tin cũ của phòng)
        return this.push();
      case 'ktv:leave': return this.leave(ws.key);
      case 'ktv:pos': {   // đi lại trong phòng hát: vị trí tự chọn (null = về ghế) — chỉ chuyển cho người trong phòng, không gửi lại cả trạng thái
        const v = this.members.get(ws.key); if (!v) return;
        const now = Date.now(); if (m.pos && now - (ws.lastKtvPos || 0) < 50) return; ws.lastKtvPos = now;   // (chống gửi dồn)
        const ok = n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 6;
        v.pos = m.pos && ok(m.pos.x) && ok(m.pos.z) && ok(m.pos.yaw ?? 0) ? { x: +m.pos.x.toFixed(3), z: +m.pos.z.toFixed(3), yaw: +(m.pos.yaw ?? 0).toFixed(3) } : null;
        for (const k of this.members.keys()) if (k !== ws.key) for (const s of this.hub.sockets.get(k) || []) this.hub.send(s, { t: 'ktvPos', key: ws.key, pos: v.pos });
        return;
      }
      case 'ktv:mic': { const v = this.members.get(ws.key); if (!v) return; v.mic = !!m.on; return this.push(); }
      case 'ktv:play': return this.play(ws, m.url, m.title);
      case 'ktv:priority': return this.reorder(ws, m.index, m.videoId, 'top');
      case 'ktv:remove': return this.reorder(ws, m.index, m.videoId, 'remove');
      case 'ktv:say': return this.say(ws, m.text);
      case 'ktv:disco': if (!this.members.has(ws.key)) return; this.disco = !!m.on; return this.push();   // (đèn vũ trường: ai trong phòng cũng bật/tắt được)
      case 'ktv:control': return this.control(ws, m.action, m.videoId);
      case 'rtc': {   // chuyển tin bắt tay WebRTC giữa hai người cùng phòng
        if (typeof m.to !== 'string' || !this.members.has(ws.key) || !this.members.has(m.to)) return;
        if (JSON.stringify(m.data || null).length > 20000) return;
        for (const s of this.hub.sockets.get(m.to) || []) this.hub.send(s, { t: 'rtc', from: ws.key, data: m.data });
      }
    }
  }
  leave(key) {
    if (!this.members.delete(key)) return;
    if (this.members.size === 0) { this.song = null; this.queue = []; this.chat = []; this.lastSay.clear(); this.disco = false; }   // (phòng trống: xoá kênh chat, tắt đèn vũ trường)
    else if (this.members.size < MIN_TO_PLAY && this.song) this.song = { ...this.song, paused: true, position: this.pos() };
    this.push();
  }
  pos() { const s = this.song; return !s ? 0 : s.paused ? s.position : Math.max(0, (Date.now() - s.startedAt) / 1000); }
  /** Ưu tiên (đưa lên đầu hàng chờ) hoặc xoá một bài; videoId kèm theo để chắc đúng bài (hàng chờ có thể vừa đổi). */
  reorder(ws, index, videoId, how) {
    if (!this.members.has(ws.key)) return;
    const i = Number(index), it = this.queue[i];
    if (!Number.isInteger(i) || !it || it.videoId !== videoId) return this.err(ws, 'Hàng chờ vừa thay đổi — thử lại.');
    if (how === 'remove' && it.byKey !== ws.key) return this.err(ws, 'Chỉ người chọn bài mới xoá được bài đó.');
    this.queue.splice(i, 1); if (how === 'top') this.queue.unshift({ ...it, prio: this.display(ws) });
    this.push();
  }
  say(ws, text) {
    if (!this.members.has(ws.key)) return this.err(ws, 'Vào phòng karaoke trước đã.');
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_LEN); if (!t) return;
    const now = Date.now(); if (now - (this.lastSay.get(ws.key) || 0) < 400) return; this.lastSay.set(ws.key, now);
    const msg = { key: ws.key, by: this.display(ws), text: t, at: now };
    this.chat.push(msg); if (this.chat.length > CHAT) this.chat.shift();
    this.toMembers({ t: 'ktvChat', msg });
  }
  async play(ws, url, hint) {
    if (!this.members.has(ws.key)) return this.err(ws, 'Vào phòng karaoke trước đã.');
    if (this.members.size < MIN_TO_PLAY) return this.err(ws, `Cần ít nhất ${MIN_TO_PLAY} người trong phòng mới mở bài được.`);
    const id = youtubeId(url); if (!id) return this.err(ws, 'Link YouTube không hợp lệ.');
    if (this.queue.length >= QUEUE) return this.err(ws, 'Hàng chờ đã đầy.');
    if (this.song?.videoId === id || this.queue.some(q => q.videoId === id)) return this.err(ws, 'Bài này đã có trong hàng chờ.');
    const item = { videoId: id, title: await youtubeTitle(id) || String(hint || '').slice(0, 200) || id, by: this.display(ws), byKey: ws.key };
    if (!this.song) this.start(item); else this.queue.push(item);
    this.push();
  }
  start(item) { if (item) { const { byKey, prio, ...it } = item; void byKey; void prio; this.song = { ...it, startedAt: Date.now(), paused: false, position: 0 }; } else this.song = null; }
  control(ws, action, videoId) {
    if (!this.members.has(ws.key) || !this.song) return;
    const s = this.song;
    if (action === 'pause' && !s.paused) this.song = { ...s, paused: true, position: this.pos() };
    else if (action === 'resume' && s.paused) { if (this.members.size < MIN_TO_PLAY) return this.err(ws, `Cần ít nhất ${MIN_TO_PLAY} người.`); this.song = { ...s, paused: false, startedAt: Date.now() - s.position * 1000 }; }
    else if (action === 'next' || (action === 'ended' && videoId === s.videoId)) this.start(this.queue.shift() || null);
    else if (action === 'stop') { this.song = null; this.queue = []; }
    else return;
    this.push();
  }
}
