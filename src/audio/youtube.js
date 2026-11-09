// Trình phát YouTube của loa công ty (YouTube IFrame Player API). Mọi máy phát cùng một video, khớp vị trí theo giờ server
// (trạng thái từ server: videoId, startedAt, paused, position). Âm lượng / tắt tiếng là riêng từng máy (lưu localStorage).
// Trình duyệt chỉ cho phát có tiếng sau khi người dùng đã bấm/gõ trên trang; nếu bị chặn → blocked = true (thanh điều khiển
// hiện nút "Bấm để nghe").
let apiPromise = null;
function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return (apiPromise ??= new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); res(window.YT); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
    s.onerror = () => { apiPromise = null; rej(new Error('Không tải được YouTube.')); };
    document.head.appendChild(s);
  }));
}

export class YoutubeMusic {
  constructor(slotId, { onChange } = {}) {
    this.slotId = slotId; this.onChange = onChange || (() => {});
    this.player = null; this.ready = false; this.state = null; this.offset = 0; // giờ server − giờ máy
    this.vol = +(localStorage.getItem('sysone.music.vol') ?? 70); this.muted = localStorage.getItem('sysone.music.muted') === '1';
    this.blocked = false; this.error = '';
    this.timer = setInterval(() => this.resync(), 4000);
  }
  /** Vị trí đúng (giây) theo trạng thái chung. */
  target() { const s = this.state; if (!s?.on) return 0; return s.paused ? s.position : Math.max(0, (Date.now() + this.offset - s.startedAt) / 1000); }
  async ensure() {
    if (this.player) return this.player;
    const YT = await loadApi();
    return (this.player = await new Promise(res => {
      const p = new YT.Player(this.slotId, {
        width: '100%', height: '100%', host: 'https://www.youtube.com',
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, origin: location.origin },
        events: {
          onReady: () => { this.ready = true; this.applyVolume(); res(p); },
          onStateChange: e => { if (e.data === YT.PlayerState.PLAYING) this.blocked = false; this.onChange(); },
          onAutoplayBlocked: () => { this.blocked = true; this.onChange(); },
          onError: e => { this.error = { 2: 'Link không hợp lệ.', 5: 'Video không phát được trên trình duyệt này.', 100: 'Video không tồn tại hoặc đã bị gỡ.', 101: 'Chủ video không cho phát nhúng.', 150: 'Chủ video không cho phát nhúng.' }[e.data] || 'Không phát được video.'; this.onChange(); }
        }
      });
    }));
  }
  /** Trạng thái mới từ server. */
  async set(state) {
    if (state?.serverNow) this.offset = state.serverNow - Date.now();
    const prev = this.state; this.state = state;
    if (!state?.on) { if (this.player && this.ready) this.player.stopVideo(); this.onChange(); return; }
    this.error = '';
    try { await this.ensure(); } catch (e) { this.error = e.message; this.onChange(); return; }
    const p = this.player, t = this.target();
    if (!prev?.on || prev.videoId !== state.videoId) { state.paused ? p.cueVideoById(state.videoId, t) : p.loadVideoById(state.videoId, t); }
    else if (state.paused) { p.pauseVideo(); p.seekTo(t, true); }
    else { if (Math.abs((p.getCurrentTime?.() || 0) - t) > 1.5) p.seekTo(t, true); p.playVideo(); }
    this.onChange();
  }
  /** (mỗi 4 giây) lệch quá 2 giây so với vị trí chung thì tua lại cho khớp. */
  resync() {
    const s = this.state, p = this.player; if (!s?.on || !p || !this.ready || s.paused || this.blocked) return;
    const cur = p.getCurrentTime?.() || 0, t = this.target(), dur = p.getDuration?.() || 0;
    if (dur && t > dur + 1) return;                                   // (đã hết bài)
    if (Math.abs(cur - t) > 2) p.seekTo(t, true);
    if (p.getPlayerState?.() !== 1 && p.getPlayerState?.() !== 3) p.playVideo();
  }
  /** Người dùng bấm "Bấm để nghe" (cử chỉ người dùng → được phép phát có tiếng). */
  unblock() { const p = this.player; if (!p) return; this.blocked = false; p.unMute(); this.applyVolume(); p.seekTo(this.target(), true); p.playVideo(); }
  setVolume(v) { this.vol = Math.max(0, Math.min(100, v)); localStorage.setItem('sysone.music.vol', String(this.vol)); this.applyVolume(); }
  setMuted(m) { this.muted = !!m; localStorage.setItem('sysone.music.muted', this.muted ? '1' : '0'); this.applyVolume(); this.onChange(); }
  applyVolume() { const p = this.player; if (!p || !this.ready) return; p.setVolume(this.vol); this.muted ? p.mute() : p.unMute(); }
  current() { const p = this.player; return p && this.ready ? (p.getCurrentTime?.() || 0) : this.target(); }
  duration() { const p = this.player; return p && this.ready ? (p.getDuration?.() || 0) : 0; }
}
