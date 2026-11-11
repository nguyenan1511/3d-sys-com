// Phòng karaoke (buồng karaoke của my-office ở tầng trệt): đi tới cửa buồng → "E Vào phòng karaoke" — vào một phòng hát 3D
// riêng (src/rooms/karaokeRoom.js: màn hình lớn chiếu video, sofa, đèn disco, nhân vật của người trong phòng). Trong phòng:
//  - danh sách người trong phòng (ai đang bật mic);
//  - dán link YouTube để thêm bài — cần ít nhất 2 người trong phòng; bài phát đồng bộ cho mọi người trong phòng
//    (video nhỏ trong khung phòng), hàng chờ;
//  - bật mic để hát: giọng truyền thẳng giữa các máy trong phòng (WebRTC, khử vọng / lọc ồn); người trong phòng nghe
//    giọng nhau, người ngoài phòng không nghe;
//  - nhân vật cầm mic đứng hát trước màn hình khi bật mic; bấm "Rời phòng" để về văn phòng.
// Kết nối WebRTC dùng máy chủ STUN công cộng miễn phí (đa số mạng chạy được; mạng chặn kết nối trực tiếp thì cần TURN:
// đặt VITE_TURN_URL / VITE_TURN_USER / VITE_TURN_PASS lúc build).
import { YoutubeMusic } from '../audio/youtube.js';
import { api } from '../net/api.js';
import { moToBuilding } from '../myoffice/building.js';
import * as HQ_KTV from '../vendor/my-office/src/office/world/props/karaoke.js';

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
if (import.meta.env?.VITE_TURN_URL) ICE.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USER, credential: import.meta.env.VITE_TURN_PASS });
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Karaoke {
  constructor(session) {
    this.s = session; this.app = session.app; this.state = null; this.inRoom = false; this.mic = false;
    this.stream = null; this.peers = new Map(); this.audios = new Map(); this.chat = [];
    this.spot = this.findBooth();
    const rt = session.rt;
    rt.on('hello', m => { if (m.ktv) this.apply(m.ktv); });
    rt.on('ktv', m => this.apply(m.state));
    rt.on('ktvErr', m => session.toast(m.msg, true));
    rt.on('rtc', m => this.onSignal(m.from, m.data));
    rt.on('ktvChat', m => {   // kênh chat riêng của phòng (server chỉ gửi cho người trong phòng)
      if (m.history) this.chat = m.history.slice(); else if (m.msg) { this.chat.push(m.msg); if (this.chat.length > 80) this.chat.shift(); }
      this.room?.onChat?.(m.msg || null);
    });
    rt.on('close', () => { if (this.inRoom) this.teardown(); });
  }

  /** Cửa buồng karaoke (toạ độ thế giới) — hoặc null nếu toà nhà không có buồng. */
  findBooth() {
    const K = HQ_KTV.KTV, root = this.app.bldRoot; if (!K || !root) return null;
    const w = ([x, z]) => { const b = moToBuilding(x, z); return { x: b.x + root.position.x, z: b.z + root.position.z, f: b.floor }; };
    const out = w(K.out), c = w([K.x, K.z]);
    return { x: out.x, z: out.z, f: out.f, cx: c.x, cz: c.z };
  }
  near(x, z, f) { const b = this.spot ||= this.findBooth(); return b && f === b.f && Math.hypot(x - b.x, z - b.z) < 1.6; }
  prompt() { const n = this.state?.members?.length || 0; return `<b>E</b> vào phòng karaoke${n ? ` (${n} người đang hát)` : ''}`; }

  join() { if (!this.inRoom) this.s.rt.send({ t: 'ktv:join' }); }
  enterRoom() { this.join(); }
  leave() { this.s.rt.send({ t: 'ktv:leave' }); this.teardown(); }

  // ---------- hàng chờ, chat, gợi ý, quẩy ----------
  add(videoId, title) { this.s.rt.send({ t: 'ktv:play', url: videoId, title }); }
  priority(i) { const q = this.state?.queue?.[i]; if (q) this.s.rt.send({ t: 'ktv:priority', index: i, videoId: q.videoId }); }
  remove(i) { const q = this.state?.queue?.[i]; if (q) this.s.rt.send({ t: 'ktv:remove', index: i, videoId: q.videoId }); }
  say(text) { const t = String(text || '').trim(); if (t) this.s.rt.send({ t: 'ktv:say', text: t }); }
  /** Gợi ý bài karaoke từ YouTube: { cat } (nhóm có sẵn) hoặc { q } (tên bài). */
  async suggest({ cat = '', q = '' } = {}) {
    const r = await api('GET', `/api/ktv/suggest?${new URLSearchParams(q ? { q } : { cat: cat || 'hot' })}`);
    return r.ok ? { items: r.items || [], categories: r.categories || [] } : { items: [], categories: [], error: r.error || 'Không tải được gợi ý.' };
  }
  get dancing() { return this.s.player?.agent.act === 'quay'; }
  /** Quẩy kiểu Audition (đang bật mic thì thôi quẩy là cầm mic hát lại). */
  setDance(on) { this.s.player?.setAct(on ? 'quay' : this.mic ? 'sing' : null); this.render(); }

  /** Trạng thái phòng từ server. */
  apply(st) {
    this.state = st;
    const me = this.s.key, mine = st.members.some(m => m.key === me);
    if (mine && !this.inRoom) { this.inRoom = true; this.openRoom(); }
    if (!mine && this.inRoom) this.teardown();
    if (!this.inRoom) return;
    // kết nối giọng với từng người trong phòng; ai rời thì đóng
    const others = st.members.map(m => m.key).filter(k => k !== me);
    for (const k of [...this.peers.keys()]) if (!others.includes(k)) this.dropPeer(k);
    for (const k of others) if (!this.peers.has(k) && me < k) this.makePeer(k, true);   // (khoá nhỏ hơn gửi lời mời)
    // bài hát: phát đồng bộ cho người trong phòng
    const s = st.song;
    this.yt?.set(s ? { on: true, videoId: s.videoId, startedAt: s.startedAt, paused: s.paused, position: s.position, serverNow: st.serverNow } : { on: false });
    this.render();
  }

  // ---------- giọng hát (WebRTC) ----------
  async setMic(on) {
    if (on && !this.stream) {
      try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
      catch { this.s.toast('Chưa được phép dùng micro — cho phép micro trong trình duyệt rồi thử lại.', true); return; }
    }
    this.mic = on;
    const track = on ? this.stream.getAudioTracks()[0] : null;
    for (const pc of this.peers.values()) for (const t of pc.getTransceivers()) if (t.sender && t.receiver.track?.kind === 'audio') t.sender.replaceTrack(track);
    this.s.rt.send({ t: 'ktv:mic', on });
    if (!this.dancing) this.s.player?.setAct(on ? 'sing' : null);
    this.render();
  }
  makePeer(key, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.peers.set(key, pc);
    pc.onicecandidate = e => { if (e.candidate) this.s.rt.send({ t: 'rtc', to: key, data: { ice: e.candidate } }); };
    pc.ontrack = e => {
      let a = this.audios.get(key); if (!a) { a = new Audio(); a.autoplay = true; this.audios.set(key, a); }
      a.srcObject = e.streams[0] || new MediaStream([e.track]); a.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this.s.toast('Không kết nối được giọng với một người trong phòng (mạng chặn kết nối trực tiếp).', true); };
    if (initiator) {
      const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (this.mic && this.stream) tr.sender.replaceTrack(this.stream.getAudioTracks()[0]);
      pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => this.s.rt.send({ t: 'rtc', to: key, data: { sdp: pc.localDescription } })).catch(e => console.warn('[karaoke] không tạo được lời mời giọng hát', e?.message));
    }
    return pc;
  }
  async onSignal(from, data) {
    if (!this.inRoom || !data) return;
    let pc = this.peers.get(from);
    // bắt tay WebRTC kiểu "perfect negotiation": hai bên cùng gửi lời mời một lúc (glare) thì bên "lịch sự" (khoá lớn hơn)
    // nhường; câu trả lời đến muộn / trùng thì bỏ qua — trước đây ném lỗi "Called in wrong state: stable" không ai bắt
    try {
      if (data.sdp) {
        if (data.sdp.type === 'offer') {
          if (!pc) pc = this.makePeer(from, false);
          if (pc.signalingState !== 'stable') {
            if (this.s.key < from) return;                                  // (mình không nhường: bỏ lời mời của họ)
            await pc.setLocalDescription({ type: 'rollback' });
          }
          await pc.setRemoteDescription(data.sdp);
          for (const t of pc.getTransceivers()) { t.direction = 'sendrecv'; if (this.mic && this.stream) t.sender.replaceTrack(this.stream.getAudioTracks()[0]); }
          await pc.setLocalDescription(await pc.createAnswer());
          this.s.rt.send({ t: 'rtc', to: from, data: { sdp: pc.localDescription } });
        } else if (pc && pc.signalingState === 'have-local-offer') await pc.setRemoteDescription(data.sdp);
      } else if (data.ice && pc) { try { await pc.addIceCandidate(data.ice); } catch { /* (ứng viên cũ) */ } }
    } catch (e) { console.warn('[karaoke] bắt tay giọng hát lỗi, nối lại', e?.message); this.dropPeer(from); if (this.s.key < from && this.inRoom) setTimeout(() => { if (this.inRoom && !this.peers.has(from)) this.makePeer(from, true); }, 800); }
  }
  dropPeer(k) { this.peers.get(k)?.close(); this.peers.delete(k); const a = this.audios.get(k); if (a) { a.srcObject = null; this.audios.delete(k); } }
  teardown() {
    this.inRoom = false;
    for (const k of [...this.peers.keys()]) this.dropPeer(k);
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    if (this.mic || this.dancing) { this.mic = false; this.s.player?.setAct(null); }
    this.chat = [];
    this.yt?.set({ on: false });
    this.s.social?.music?.applyVolume();   // (nhạc loa công ty: trả lại âm lượng như cũ)
    this.s.app.rooms?.exit('karaoke');
  }

  // ---------- phòng 3D ----------
  async openRoom() {
    const stage = this.s.app.rooms; if (!stage) return;
    const room = await stage.enter('karaoke', async st => { const { KaraokeRoom } = await import('../rooms/karaokeRoom.js'); return new KaraokeRoom(this.s.app, this, st.host, st.canvas); });
    if (!room) return;
    this.room = room;
    if (!this.yt) {
      this.yt = new YoutubeMusic('ktvSlot', { onChange: () => this.render() });
      setInterval(() => {   // hết bài → báo server sang bài tiếp (ai trong phòng báo trước cũng được)
        const s = this.state?.song; if (!this.inRoom || !s || s.paused || !this.yt) return;
        const d = this.yt.duration(); if (d && this.yt.target() > d + 0.5) this.s.rt.send({ t: 'ktv:control', action: 'ended', videoId: s.videoId });
      }, 1500);
    }
    if (!this.inRoom) { stage.exit('karaoke'); return; }
    const co = this.s.social?.music; if (co?.player && co.ready) co.player.mute();   // (nhạc loa công ty: tạm im trong phòng hát)
    if (this.state) this.apply(this.state);
  }
  render() { this.room?.render(); }
  /** (mỗi khung hình) đi xa khỏi buồng: tự rời phòng. */
  update() {
    if (!this.inRoom || !this.spot || this.s.app.rooms?.is('karaoke')) return;
    const a = this.s.player?.agent; if (!a) return;
    if (a.f !== this.spot.f || Math.hypot(a.x - this.spot.x, a.z - this.spot.z) > 6) { this.s.toast('Bạn đã rời phòng karaoke.'); this.leave(); }
  }
}
