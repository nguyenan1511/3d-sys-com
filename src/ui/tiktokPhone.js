// Lướt TikTok trong buồng vệ sinh (src/session/restroom.js → nút "Lướt TikTok"): khung điện thoại dọc, phát video bằng trình
// phát nhúng chính thức của TikTok (https://www.tiktok.com/player/v1/<mã>, điều khiển qua postMessage). Danh sách video chung
// do nhân viên dán link (server/tiktok.js). Thao tác như TikTok: vuốt lên / xuống (hoặc lăn chuột, phím ↑ ↓) để chuyển video,
// chạm để dừng / phát, hết video tự sang video kế. Ô "Dán link TikTok" ở dưới để thêm video. Đang lướt: nhân vật cầm điện thoại.
import { api } from '../net/api.js';
import { esc, confirmDanger } from '../session/ui.js';
import { icon } from './icons.js';
import { overlayOn, overlayOff } from './overlay.js';

const PLAYER = id => `https://www.tiktok.com/player/v1/${id}?autoplay=1&loop=0&controls=1&progress_bar=1&play_button=0&volume_control=1&fullscreen_button=0&timestamp=0&music_info=1&description=1&rel=0&native_context_menu=0&closed_caption=0`;

export class TikTokPhone {
  constructor(session) { this.s = session; this.items = []; this.i = 0; this.el = null; this.muted = false; }
  get open() { return !!this.el; }

  async show() {
    if (this.el) return;
    const back = this.el = document.createElement('div'); back.className = 'tt-back'; back.setAttribute('role', 'dialog'); back.setAttribute('aria-label', 'Lướt TikTok');
    back.innerHTML = `<div class="tt-phone">
        <div class="tt-status" aria-hidden="true"><span class="tt-clock"></span><i class="tt-island"></i><span class="tt-sys"><svg viewBox="0 0 18 12" width="17" height="11"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg viewBox="0 0 26 12" width="24" height="11"><rect x=".5" y=".5" width="22" height="11" rx="3.5" fill="none" stroke="currentColor" opacity=".45"/><rect x="2.5" y="2.5" width="15" height="7" rx="2"/><rect x="23.5" y="4" width="2" height="4" rx="1" opacity=".45"/></svg></span></div>
        <div class="tt-screen"><iframe class="tt-frame" title="Video TikTok" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>
          <div class="tt-swipe" aria-hidden="true"></div>
          <div class="tt-empty" hidden><b>📱 Chưa có video nào</b><span>Dán link video TikTok ở ô bên dưới để cả công ty cùng lướt.</span></div>
          </div>
        <div class="tt-info"><b class="tt-title"></b><small class="tt-by"></small></div>
        <div class="tt-rail">
          <button type="button" class="tt-btn" data-prev aria-label="Video trước">${icon('chevUp', 18)}</button>
          <span class="tt-pos"></span>
          <button type="button" class="tt-btn" data-next aria-label="Video sau">${icon('chevDown', 18)}</button>
          <button type="button" class="tt-btn" data-mute aria-label="Tắt tiếng">${icon('volume', 17)}</button>
          <button type="button" class="tt-btn" data-del aria-label="Xoá video này" hidden>${icon('trash', 16)}</button>
        </div>
        <form class="tt-add"><input maxlength="500" inputmode="url" autocomplete="off" placeholder="Dán link TikTok…" aria-label="Link video TikTok"><button type="submit" class="sx-primary">Thêm</button></form>
        <button type="button" class="tt-close sx-x" aria-label="Cất điện thoại">${icon('close', 18)}</button>
      </div>`;
    document.body.appendChild(back); overlayOn();   // (thôi vẽ 3D bên dưới; bộ đếm chung với bảng tin / phòng họp)
    requestAnimationFrame(() => back.classList.add('show'));
    this.frame = back.querySelector('.tt-frame');
    back.querySelector('[data-prev]').onclick = () => this.go(-1);
    back.querySelector('[data-next]').onclick = () => this.go(1);
    back.querySelector('[data-mute]').onclick = () => this.toggleMute();
    back.querySelector('[data-del]').onclick = () => this.del();
    back.querySelector('.tt-close').onclick = () => this.close();
    back.addEventListener('click', e => { if (e.target === back) this.close(); });
    const input = back.querySelector('.tt-add input');
    input.addEventListener('keydown', e => e.stopPropagation());
    back.querySelector('.tt-add').onsubmit = async e => { e.preventDefault(); const url = input.value.trim(); if (!url) return; const b = e.submitter || back.querySelector('.tt-add button'); b.disabled = true; const r = await api('POST', '/api/tiktok', { url }); b.disabled = false; if (!r.ok) { this.s.toast(r.error || 'Chưa thêm được video.', true); return; } input.value = ''; this.items.unshift(r.item); this.i = 0; this.render(); this.s.toast('Đã thêm video — cả công ty lướt được rồi.'); };
    this.bindSwipe(back.querySelector('.tt-swipe'));
    this._key = e => {
      if (!this.el || e.target.closest?.('.tt-add')) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); this.go(1); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); this.go(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      else if (e.key === ' ' || e.key === 'k') { e.preventDefault(); e.stopPropagation(); this.togglePlay(); }
      else e.stopPropagation();   // (đang lướt: phím không điều khiển nhân vật)
    };
    window.addEventListener('keydown', this._key, true);
    this._msg = e => this.onPlayer(e);
    window.addEventListener('message', this._msg);
    const tick = () => { const c = this.el?.querySelector('.tt-clock'); if (c) c.textContent = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); };
    tick(); this._clock = setInterval(tick, 15000);
    this.s.player?.setAct?.('phone');   // (nhân vật cầm điện thoại)
    const r = await api('GET', '/api/tiktok');
    if (!this.el) return;
    this.items = r.ok ? r.items : []; this.i = 0; this.render();
    if (!r.ok) this.s.toast(r.error || 'Chưa tải được danh sách video.', true);
  }
  close() {
    const el = this.el; if (!el) return;
    this.el = null; this.frame = null; clearInterval(this._clock);
    window.removeEventListener('keydown', this._key, true); window.removeEventListener('message', this._msg);
    overlayOff();   // (trước đây tự dò ".tt-back.show" TRƯỚC khi gỡ class show → tìm thấy chính nó → không bao giờ gỡ overlay-open → cảnh 3D thôi vẽ, màn hình đứng im)
    if (this.s.player?.agent?.act === 'phone') this.s.player.setAct(null);
    el.classList.remove('show'); el.classList.add('out'); setTimeout(() => el.remove(), 220);
  }

  // ---------- lướt ----------
  go(d) {
    if (!this.items.length) return;
    const n = this.i + d; if (n < 0 || n >= this.items.length) { this.bump(d); return; }
    this.i = n; this.render(d);
  }
  bump(d) { const sc = this.el?.querySelector('.tt-screen'); if (!sc) return; sc.classList.remove('bump-up', 'bump-down'); void sc.offsetWidth; sc.classList.add(d > 0 ? 'bump-up' : 'bump-down'); this.s.toast(d > 0 ? 'Hết video rồi — dán thêm link ở dưới nhé.' : 'Đây là video mới nhất.'); }
  render(dir = 0) {
    const el = this.el; if (!el) return;
    const it = this.items[this.i], empty = !it;
    el.querySelector('.tt-empty').hidden = !empty; this.frame.hidden = empty;
    el.querySelector('.tt-pos').textContent = empty ? '0/0' : `${this.i + 1}/${this.items.length}`;
    el.querySelector('[data-prev]').disabled = this.i <= 0; el.querySelector('[data-next]').disabled = this.i >= this.items.length - 1;
    el.querySelector('[data-del]').hidden = !it?.canDelete;
    el.querySelector('.tt-title').textContent = it ? (it.title || 'Video TikTok') : '';
    el.querySelector('.tt-by').innerHTML = it ? `${it.author ? `@${esc(it.author)} · ` : ''}${esc(it.byName || '')} chia sẻ` : '';
    if (empty) { this.frame.removeAttribute('src'); return; }
    const sc = el.querySelector('.tt-screen');
    if (dir) { sc.classList.remove('slide-up', 'slide-down'); void sc.offsetWidth; sc.classList.add(dir > 0 ? 'slide-up' : 'slide-down'); }
    this.ready = false;
    this.frame.src = PLAYER(it.id);
  }
  async del() {
    const it = this.items[this.i]; if (!it) return;
    if (!(await confirmDanger('Xoá video khỏi danh sách?', `"${it.title || 'Video TikTok'}" sẽ không còn trong danh sách lướt của cả công ty.`, 'Xoá'))) return;
    const r = await api('DELETE', `/api/tiktok/${it.id}`, {}); if (!r.ok) { this.s.toast(r.error, true); return; }
    this.items.splice(this.i, 1); this.i = Math.min(this.i, Math.max(0, this.items.length - 1)); this.render();
  }

  // ---------- trình phát TikTok (postMessage) ----------
  post(type, value) { try { this.frame?.contentWindow?.postMessage({ type, value, 'x-tiktok-player': true }, 'https://www.tiktok.com'); } catch { /* bỏ qua */ } }
  onPlayer(e) {
    if (e.origin !== 'https://www.tiktok.com' || !this.frame || e.source !== this.frame.contentWindow) return;
    const d = e.data; if (!d || !d['x-tiktok-player']) return;
    if (d.type === 'onPlayerReady') { this.ready = true; if (this.muted) this.post('mute'); }
    if (d.type === 'onStateChange') { this.playing = d.value === 1; if (d.value === 0) setTimeout(() => this.go(1), 400); }   // (0: hết video → sang video kế)
  }
  togglePlay() { this.post(this.playing ? 'pause' : 'play'); this.playing = !this.playing; }
  toggleMute() {
    this.muted = !this.muted; this.post(this.muted ? 'mute' : 'unMute');
    const b = this.el?.querySelector('[data-mute]'); if (b) { b.innerHTML = icon(this.muted ? 'mute' : 'volume', 17); b.setAttribute('aria-label', this.muted ? 'Bật tiếng' : 'Tắt tiếng'); }
  }
  /** Lớp vuốt phủ trên video: vuốt lên / xuống chuyển video, chạm để dừng / phát, lăn chuột cũng chuyển. Chừa dải dưới cho thanh điều khiển của TikTok. */
  bindSwipe(z) {
    let st = null, wheelT = 0;
    z.addEventListener('pointerdown', e => { st = { y: e.clientY, x: e.clientX, t: performance.now() }; z.setPointerCapture(e.pointerId); });
    z.addEventListener('pointerup', e => {
      if (!st) return; const dy = e.clientY - st.y, dx = e.clientX - st.x, dt = performance.now() - st.t; st = null;
      if (Math.abs(dy) > 45 && Math.abs(dy) > Math.abs(dx)) this.go(dy < 0 ? 1 : -1);
      else if (Math.hypot(dx, dy) < 10 && dt < 400) this.togglePlay();
    });
    z.addEventListener('pointercancel', () => { st = null; });
    z.addEventListener('wheel', e => { e.preventDefault(); const now = performance.now(); if (now - wheelT < 550 || Math.abs(e.deltaY) < 12) return; wheelT = now; this.go(e.deltaY > 0 ? 1 : -1); }, { passive: false });
  }
}
