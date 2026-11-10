// Phòng karaoke (buồng karaoke của my-office ở tầng trệt): đi tới cửa buồng → "E Vào phòng karaoke". Trong phòng:
//  - danh sách người trong phòng (ai đang bật mic);
//  - dán link YouTube để thêm bài — cần ít nhất 2 người trong phòng; bài phát đồng bộ cho mọi người trong phòng
//    (video nhỏ trong khung phòng), hàng chờ;
//  - bật mic để hát: giọng truyền thẳng giữa các máy trong phòng (WebRTC, khử vọng / lọc ồn); người trong phòng nghe
//    giọng nhau, người ngoài phòng không nghe;
//  - nhân vật cầm mic hát khi bật mic; đi xa khỏi buồng (> 6 m) là tự rời phòng.
// Kết nối WebRTC dùng máy chủ STUN công cộng miễn phí (đa số mạng chạy được; mạng chặn kết nối trực tiếp thì cần TURN:
// đặt VITE_TURN_URL / VITE_TURN_USER / VITE_TURN_PASS lúc build).
import { YoutubeMusic } from '../audio/youtube.js';
import { esc } from './ui.js';
import { icon } from '../ui/icons.js';
import { moToBuilding } from '../myoffice/building.js';
import * as HQ_KTV from '../vendor/my-office/src/office/world/props/karaoke.js';

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
if (import.meta.env?.VITE_TURN_URL) ICE.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USER, credential: import.meta.env.VITE_TURN_PASS });
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Karaoke {
  constructor(session) {
    this.s = session; this.app = session.app; this.state = null; this.inRoom = false; this.mic = false;
    this.stream = null; this.peers = new Map(); this.audios = new Map();
    this.spot = this.findBooth();
    const rt = session.rt;
    rt.on('hello', m => { if (m.ktv) this.apply(m.ktv); });
    rt.on('ktv', m => this.apply(m.state));
    rt.on('ktvErr', m => session.toast(m.msg, true));
    rt.on('rtc', m => this.onSignal(m.from, m.data));
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
  leave() { this.s.rt.send({ t: 'ktv:leave' }); this.teardown(); }

  /** Trạng thái phòng từ server. */
  apply(st) {
    this.state = st;
    const me = this.s.key, mine = st.members.some(m => m.key === me);
    if (mine && !this.inRoom) { this.inRoom = true; this.openPanel(); }
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
    this.s.player?.setAct(on ? 'sing' : null);
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
      pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => this.s.rt.send({ t: 'rtc', to: key, data: { sdp: pc.localDescription } }));
    }
    return pc;
  }
  async onSignal(from, data) {
    if (!this.inRoom || !data) return;
    let pc = this.peers.get(from);
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        if (!pc) pc = this.makePeer(from, false);
        await pc.setRemoteDescription(data.sdp);
        for (const t of pc.getTransceivers()) { t.direction = 'sendrecv'; if (this.mic && this.stream) t.sender.replaceTrack(this.stream.getAudioTracks()[0]); }
        await pc.setLocalDescription(await pc.createAnswer());
        this.s.rt.send({ t: 'rtc', to: from, data: { sdp: pc.localDescription } });
      } else if (pc) await pc.setRemoteDescription(data.sdp);
    } else if (data.ice && pc) { try { await pc.addIceCandidate(data.ice); } catch { /* (ứng viên cũ) */ } }
  }
  dropPeer(k) { this.peers.get(k)?.close(); this.peers.delete(k); const a = this.audios.get(k); if (a) { a.srcObject = null; this.audios.delete(k); } }
  teardown() {
    this.inRoom = false;
    for (const k of [...this.peers.keys()]) this.dropPeer(k);
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null;
    if (this.mic) { this.mic = false; this.s.player?.setAct(null); }
    this.yt?.set({ on: false });
    this.panel?.classList.remove('show'); setTimeout(() => { if (!this.inRoom && this.panel) this.panel.hidden = true; }, 220);
  }

  // ---------- giao diện ----------
  openPanel() {
    if (!this.panel) {
      const el = this.panel = document.createElement('section'); el.className = 'ktv-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Phòng karaoke');
      el.innerHTML = `<header><b>${icon('music', 16)} Phòng karaoke</b><button type="button" class="ktv-x" aria-label="Rời phòng">${icon('close', 14)}</button></header>
        <div class="ktv-video"><div id="ktvSlot"></div><p class="ktv-empty"></p></div>
        <div class="ktv-now"></div>
        <form class="ktv-add"><input type="url" inputmode="url" placeholder="Dán link bài hát YouTube…" aria-label="Link YouTube" required><button type="submit">Thêm bài</button></form>
        <div class="ktv-ctrl"><button type="button" class="ktv-mic">${icon('volume', 15)}<span>Bật mic để hát</span></button><button type="button" class="ktv-pp">Tạm dừng</button><button type="button" class="ktv-next">Bài tiếp</button></div>
        <div class="ktv-sec">Trong phòng</div><ul class="ktv-members"></ul>
        <div class="ktv-sec ktv-qh">Hàng chờ</div><ol class="ktv-queue"></ol>
        <p class="ktv-note">Đeo tai nghe để giọng không bị vọng. Đi ra xa buồng là tự rời phòng.</p>`;
      document.getElementById('appRoot').appendChild(el);
      const q = c => el.querySelector(c);
      q('.ktv-x').onclick = () => this.leave();
      q('.ktv-add').onsubmit = e => { e.preventDefault(); const i = q('.ktv-add input'); this.s.rt.send({ t: 'ktv:play', url: i.value.trim() }); i.value = ''; };
      q('.ktv-mic').onclick = () => this.setMic(!this.mic);
      q('.ktv-pp').onclick = () => this.s.rt.send({ t: 'ktv:control', action: this.state?.song?.paused ? 'resume' : 'pause' });
      q('.ktv-next').onclick = () => this.s.rt.send({ t: 'ktv:control', action: 'next' });
      this.yt = new YoutubeMusic('ktvSlot', { onChange: () => this.render() });
      const yEnded = setInterval(() => {   // hết bài → báo server sang bài tiếp (ai trong phòng báo trước cũng được)
        const s = this.state?.song; if (!this.inRoom || !s || s.paused || !this.yt) return;
        const d = this.yt.duration(); if (d && this.yt.target() > d + 0.5) this.s.rt.send({ t: 'ktv:control', action: 'ended', videoId: s.videoId });
      }, 1500);
      void yEnded;
    }
    this.panel.hidden = false; requestAnimationFrame(() => this.panel.classList.add('show'));
  }
  render() {
    const el = this.panel, st = this.state; if (!el || !st) return;
    const q = c => el.querySelector(c), enough = st.members.length >= st.min, s = st.song;
    q('.ktv-members').innerHTML = st.members.map(m => `<li class="${m.mic ? 'on' : ''}"><i aria-hidden="true">${m.mic ? '🎤' : '🎧'}</i>${esc(m.display)}${m.key === this.s.key ? ' (bạn)' : ''}</li>`).join('');
    q('.ktv-queue').innerHTML = st.queue.map(x => `<li>${esc(x.title)} <small>· ${esc(x.by)}</small></li>`).join('');
    q('.ktv-qh').hidden = !st.queue.length;
    q('.ktv-empty').textContent = s ? '' : enough ? 'Dán link YouTube bên dưới để mở bài đầu tiên.' : `Đang chờ thêm người — cần ít nhất ${st.min} người trong phòng mới mở bài được.`;
    q('.ktv-empty').hidden = !!s;
    q('.ktv-now').innerHTML = s ? `<b>${esc(s.title)}</b><small>${esc(s.by)} chọn${s.paused ? ' · đang tạm dừng' : ''}</small>` : '';
    q('.ktv-add input').disabled = q('.ktv-add button').disabled = !enough;
    q('.ktv-pp').disabled = q('.ktv-next').disabled = !s; q('.ktv-pp').textContent = s?.paused ? 'Phát tiếp' : 'Tạm dừng';
    const mb = q('.ktv-mic'); mb.classList.toggle('on', this.mic); mb.querySelector('span').textContent = this.mic ? 'Đang hát — tắt mic' : 'Bật mic để hát';
  }
  /** (mỗi khung hình) đi xa khỏi buồng: tự rời phòng. */
  update() {
    if (!this.inRoom || !this.spot) return;
    const a = this.s.player?.agent; if (!a) return;
    if (a.f !== this.spot.f || Math.hypot(a.x - this.spot.x, a.z - this.spot.z) > 6) { this.s.toast('Bạn đã rời phòng karaoke.'); this.leave(); }
  }
}
