// Họp trực tuyến trong phòng họp: mic, camera, chia sẻ màn hình — truyền thẳng giữa các máy trong phòng (WebRTC, nối từng
// cặp như phòng karaoke; máy chủ chỉ chuyển tin bắt tay 'meet:rtc' giữa hai người cùng phòng, không ghi âm, không lưu hình).
//  • Mỗi cặp có đúng 3 kênh cố định, theo thứ tự: tiếng (mic) · hình camera · hình màn hình. Bật / tắt chỉ thay track trên
//    kênh (replaceTrack) — không phải bắt tay lại, nên bật camera / chia sẻ màn hình hiện ngay.
//  • Người có khoá nhỏ hơn gửi lời mời (không bao giờ hai bên cùng mời). Kết nối hỏng: bên mời nối lại (tối đa vài lần).
//  • Ai đang bật gì: báo máy chủ (meet:media) → có trong danh sách người trong phòng (members[].media) để mọi máy hiện đúng
//    ô hình / ảnh đại diện / biểu tượng mic.
// Mạng chặn kết nối trực tiếp (một số mạng công ty / 4G) cần máy chủ TURN: đặt VITE_TURN_URL / VITE_TURN_USER / VITE_TURN_PASS lúc build.
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
if (import.meta.env?.VITE_TURN_URL) ICE.push({ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USER, credential: import.meta.env.VITE_TURN_PASS });

export const SLOTS = ['mic', 'cam', 'screen'];
const KIND = { mic: 'audio', cam: 'video', screen: 'video' };
const BITRATE = { cam: 450_000, screen: 1_500_000 };
export const canShareScreen = () => !!navigator.mediaDevices?.getDisplayMedia;
export const canCall = () => typeof RTCPeerConnection === 'function' && !!navigator.mediaDevices?.getUserMedia;

export class MeetCall {
  /** o: { me, send(msg), toast(text, bad), onChange() } */
  constructor(o) {
    this.o = o; this.me = o.me;
    this.peers = new Map();                               // key → { pc, initiator, tracks: {mic, cam, screen}, audio, ice: [], tries }
    this.local = { mic: null, cam: null, screen: null };  // MediaStream của mình
    this.on = { mic: false, cam: false, screen: false };
    this.levels = new Map();                              // key → mức tiếng 0..1 (ai đang nói)
    this.busy = {};
  }

  // ---------- nối / ngắt theo danh sách người trong phòng ----------
  sync(members) {
    if (this.gone) return;
    const keys = new Set(members.map(m => m.key).filter(k => k !== this.me));
    for (const k of [...this.peers.keys()]) if (!keys.has(k)) this.drop(k);
    for (const k of keys) if (!this.peers.has(k) && this.me < k) this.connect(k, true);   // (khoá nhỏ hơn gửi lời mời)
  }
  connect(key, initiator) {
    const old = this.peers.get(key);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const p = { pc, initiator, tracks: { mic: null, cam: null, screen: null }, audio: null, ice: [], tries: old?.tries || 0 };
    if (old) this.drop(key, true);
    this.peers.set(key, p);
    pc.onicecandidate = e => { if (e.candidate) this.o.send({ t: 'meet:rtc', to: key, data: { ice: e.candidate } }); };
    pc.ontrack = e => {
      const slot = SLOTS[pc.getTransceivers().indexOf(e.transceiver)]; if (!slot) return;
      p.tracks[slot] = e.track;
      if (slot === 'mic') {
        if (!p.audio) { p.audio = new Audio(); p.audio.autoplay = true; }
        p.audio.srcObject = new MediaStream([e.track]); p.audio.play().catch(() => {});
        this.meter(key, p.audio.srcObject);
      }
      e.track.onunmute = () => this.o.onChange();
      this.o.onChange();
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(key) !== p) return;
      if (pc.connectionState === 'connected') { p.tries = 0; this.o.onChange(); }
      if (pc.connectionState !== 'failed') return;
      if (!this.warned) { this.warned = true; this.o.toast('Chưa nối được tiếng / hình với một người trong phòng (mạng chặn kết nối trực tiếp) — đang thử lại.', true); }
      if (p.initiator && p.tries < 3) { p.tries++; setTimeout(() => { if (!this.gone && this.peers.get(key) === p) this.connect(key, true); }, 1500 * p.tries); }
    };
    if (initiator) {
      for (const s of SLOTS) pc.addTransceiver(KIND[s], { direction: 'sendrecv' });
      this.attach(p);
      pc.createOffer().then(o => pc.setLocalDescription(o))
        .then(() => this.o.send({ t: 'meet:rtc', to: key, data: { sdp: pc.localDescription } }))
        .catch(e => console.warn('[họp] không tạo được lời mời', e?.message));
    }
    return p;
  }
  /** Gắn track của mình vào các kênh của một cặp. */
  attach(p) { p.pc.getTransceivers().forEach((t, i) => { const s = SLOTS[i]; if (s) this.setSender(t.sender, s); }); }
  async setSender(sender, slot) {
    const track = this.local[slot]?.getTracks()[0] || null;
    try { await sender.replaceTrack(track); } catch { /* kết nối đã đóng */ }
    if (!track || !BITRATE[slot]) return;
    try { const prm = sender.getParameters(); if (!prm.encodings?.length) prm.encodings = [{}]; prm.encodings[0].maxBitrate = BITRATE[slot]; await sender.setParameters(prm); } catch { /* trình duyệt không cho chỉnh */ }
  }
  async signal(from, data) {
    if (this.gone || !data) return;
    let p = this.peers.get(from);
    try {
      if (data.sdp?.type === 'offer') {
        p = this.connect(from, false);
        await p.pc.setRemoteDescription(data.sdp);
        for (const t of p.pc.getTransceivers()) t.direction = 'sendrecv';
        this.attach(p);
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        this.o.send({ t: 'meet:rtc', to: from, data: { sdp: p.pc.localDescription } });
        this.flushIce(p);
      } else if (data.sdp?.type === 'answer') {
        if (p?.pc.signalingState === 'have-local-offer') { await p.pc.setRemoteDescription(data.sdp); this.flushIce(p); }
      } else if (data.ice && p) {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.ice).catch(() => {}); else p.ice.push(data.ice);
      }
    } catch (e) {
      console.warn('[họp] bắt tay lỗi, nối lại', e?.message);
      if (this.me < from) setTimeout(() => { if (!this.gone) this.connect(from, true); }, 900); else this.drop(from);
    }
  }
  flushIce(p) { const q = p.ice.splice(0); for (const c of q) p.pc.addIceCandidate(c).catch(() => {}); }
  drop(key, keepEntry = false) {
    const p = this.peers.get(key); if (!p) return;
    try { p.pc.close(); } catch { /* bỏ qua */ }
    if (p.audio) { p.audio.srcObject = null; }
    this.unmeter(key);
    if (!keepEntry) { this.peers.delete(key); this.o.onChange(); }
  }

  // ---------- mic / camera / màn hình của mình ----------
  async toggle(slot) { return this.set(slot, !this.on[slot]); }
  async set(slot, on) {
    if (this.busy[slot] || this.gone) return; this.busy[slot] = true;
    try {
      if (on) {
        let stream;
        try { stream = await this.capture(slot); }
        catch (e) { this.captureError(slot, e); return; }
        if (this.gone) { stream.getTracks().forEach(t => t.stop()); return; }
        this.local[slot] = stream;
        const tr = stream.getTracks()[0];
        if (slot === 'screen') { tr.contentHint = 'detail'; tr.onended = () => this.set('screen', false); }
        if (slot === 'mic') this.meter(this.me, stream);
      } else {
        this.local[slot]?.getTracks().forEach(t => t.stop()); this.local[slot] = null;
        if (slot === 'mic') this.unmeter(this.me);
      }
      this.on[slot] = on;
      const i = SLOTS.indexOf(slot);
      await Promise.all([...this.peers.values()].map(p => { const t = p.pc.getTransceivers()[i]; return t ? this.setSender(t.sender, slot) : null; }));
      this.o.send({ t: 'meet:media', ...this.on });
      this.o.onChange();
    } finally { this.busy[slot] = false; }
  }
  capture(slot) {
    const md = navigator.mediaDevices;
    if (slot === 'mic') return md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (slot === 'cam') return md.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 24 }, facingMode: 'user' } });
    if (!md.getDisplayMedia) return Promise.reject(Object.assign(new Error('unsupported'), { name: 'NotSupportedError' }));
    return md.getDisplayMedia({ video: { frameRate: { ideal: 10, max: 15 } }, audio: false });
  }
  captureError(slot, e) {
    const what = { mic: 'micro', cam: 'camera', screen: 'chia sẻ màn hình' }[slot];
    if (slot === 'screen' && e?.name === 'NotAllowedError') return;   // (bấm Huỷ ở hộp chọn màn hình)
    if (e?.name === 'NotSupportedError') this.o.toast('Trình duyệt này chưa hỗ trợ chia sẻ màn hình — dùng Chrome / Edge / Firefox trên máy tính.', true);
    else if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') this.o.toast(`Không tìm thấy ${what} trên máy này.`, true);
    else if (e?.name === 'NotReadableError') this.o.toast(`${what[0].toUpperCase()}${what.slice(1)} đang được ứng dụng khác dùng — tắt ứng dụng đó rồi thử lại.`, true);
    else this.o.toast(`Chưa được phép dùng ${what} — cho phép trong trình duyệt (biểu tượng ổ khoá cạnh địa chỉ trang) rồi thử lại.`, true);
  }

  // ---------- hình / tiếng để hiện ----------
  /** Track video đang có của một người (mình: track tại chỗ). */
  track(key, slot) { return key === this.me ? this.local[slot]?.getTracks()[0] || null : this.peers.get(key)?.tracks[slot] || null; }
  connected(key) { const s = this.peers.get(key)?.pc.connectionState; return s === 'connected'; }

  /** Đo mức tiếng để tô viền "đang nói" (một AudioContext chung, đọc ~5 lần/giây). */
  meter(key, stream) {
    try {
      this.ac ||= new (window.AudioContext || window.webkitAudioContext)();
      this.ac.resume?.().catch(() => {});
      this.unmeter(key);
      const src = this.ac.createMediaStreamSource(stream), an = this.ac.createAnalyser(); an.fftSize = 256; src.connect(an);
      (this.meters ||= new Map()).set(key, { src, an, buf: new Uint8Array(an.fftSize) });
      if (!this.meterT) this.meterT = setInterval(() => this.readLevels(), 200);
    } catch { /* không đo được: bỏ qua viền */ }
  }
  unmeter(key) { const m = this.meters?.get(key); if (!m) return; try { m.src.disconnect(); } catch { /* bỏ qua */ } this.meters.delete(key); this.levels.delete(key); }
  readLevels() {
    let changed = false;
    for (const [k, m] of this.meters || []) {
      m.an.getByteTimeDomainData(m.buf); let peak = 0; for (const v of m.buf) peak = Math.max(peak, Math.abs(v - 128));
      const talk = peak > 14, was = (this.levels.get(k) || 0) > 0;
      if (talk !== was) { this.levels.set(k, talk ? 1 : 0); changed = true; }
    }
    if (changed) this.o.onTalk?.();
  }
  talking(key) { return (this.levels.get(key) || 0) > 0 && (key === this.me ? this.on.mic : true); }

  destroy() {
    this.gone = true;
    for (const k of [...this.peers.keys()]) this.drop(k);
    for (const s of SLOTS) { this.local[s]?.getTracks().forEach(t => t.stop()); this.local[s] = null; }
    clearInterval(this.meterT); this.ac?.close?.().catch(() => {});
  }
}
