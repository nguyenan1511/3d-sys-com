// Phòng karaoke (buồng karaoke ở tầng trệt): vào phòng, có ít nhất 2 người thì mới mở bài; bài lấy từ link YouTube,
// phát đồng bộ theo giờ server cho người trong phòng; hàng chờ tối đa 20 bài. Giọng hát đi thẳng giữa các máy
// (WebRTC) — server chỉ chuyển tin bắt tay ('rtc') giữa hai người cùng trong phòng. Trạng thái chỉ nằm trong bộ nhớ.
import { youtubeId, youtubeTitle } from './social.js';

const MAX = 8, MIN_TO_PLAY = 2, QUEUE = 20;

export class Karaoke {
  constructor(hub) { this.hub = hub; this.members = new Map(); this.song = null; this.queue = []; }
  state() {
    return { members: [...this.members].map(([key, v]) => ({ key, display: v.display, mic: v.mic })), song: this.song, queue: this.queue, min: MIN_TO_PLAY, max: MAX, serverNow: Date.now() };
  }
  push() { this.hub.broadcast({ t: 'ktv', state: this.state() }); }
  err(ws, msg) { this.hub.send(ws, { t: 'ktvErr', msg }); }
  display(ws) { return this.hub.presence.get(ws.key)?.display || ws.key; }

  onMessage(ws, m) {
    switch (m.t) {
      case 'ktv:join':
        if (this.members.has(ws.key)) return;
        if (this.members.size >= MAX) return this.err(ws, `Phòng karaoke đã đủ ${MAX} người.`);
        this.members.set(ws.key, { display: this.display(ws), mic: false }); return this.push();
      case 'ktv:leave': return this.leave(ws.key);
      case 'ktv:mic': { const v = this.members.get(ws.key); if (!v) return; v.mic = !!m.on; return this.push(); }
      case 'ktv:play': return this.play(ws, m.url);
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
    if (this.members.size === 0) { this.song = null; this.queue = []; }
    else if (this.members.size < MIN_TO_PLAY && this.song) this.song = { ...this.song, paused: true, position: this.pos() };
    this.push();
  }
  pos() { const s = this.song; return !s ? 0 : s.paused ? s.position : Math.max(0, (Date.now() - s.startedAt) / 1000); }
  async play(ws, url) {
    if (!this.members.has(ws.key)) return this.err(ws, 'Vào phòng karaoke trước đã.');
    if (this.members.size < MIN_TO_PLAY) return this.err(ws, `Cần ít nhất ${MIN_TO_PLAY} người trong phòng mới mở bài được.`);
    const id = youtubeId(url); if (!id) return this.err(ws, 'Link YouTube không hợp lệ.');
    if (this.queue.length >= QUEUE) return this.err(ws, 'Hàng chờ đã đầy.');
    const item = { videoId: id, title: await youtubeTitle(id) || id, by: this.display(ws) };
    if (!this.song) this.start(item); else this.queue.push(item);
    this.push();
  }
  start(item) { this.song = item ? { ...item, startedAt: Date.now(), paused: false, position: 0 } : null; }
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
