// Lướt TikTok trong buồng vệ sinh (src/session/restroom.js → nút "Lướt TikTok"): khung điện thoại dọc, phát video bằng trình
// phát nhúng chính thức của TikTok (https://www.tiktok.com/player/v1/<mã>, điều khiển qua postMessage). Video có sẵn từ các
// kênh TikTok cố định (CEO / HC-NS chọn — nút "Kênh") + video đồng nghiệp chia sẻ (nút "Chia sẻ" — tuỳ chọn), server/tiktok.js.
// Thao tác như TikTok: vuốt lên / xuống (hoặc lăn chuột, phím ↑ ↓) để chuyển video, chạm để dừng / phát, hết video tự sang
// video kế, hết danh sách thì quay lại đầu. Đang lướt: nhân vật cầm điện thoại.
import { api } from '../net/api.js';
import { esc, confirmDanger, modal } from '../session/ui.js';
import { icon } from './icons.js';
import { overlayOn, overlayOff } from './overlay.js';

const PLAYER = id => `https://www.tiktok.com/player/v1/${id}?autoplay=1&loop=0&controls=1&progress_bar=1&play_button=0&volume_control=1&fullscreen_button=0&timestamp=0&music_info=1&description=1&rel=0&native_context_menu=0&closed_caption=0`;

export class TikTokPhone {
  constructor(session) { this.s = session; this.items = []; this.i = 0; this.el = null; this.muted = false; }
  get open() { return !!this.el; }

  async show() {
    if (this.el) return;
    const back = this.el = document.createElement('div'); back.className = 'tt-back'; back.setAttribute('role', 'dialog'); back.setAttribute('aria-label', 'Lướt TikTok');
    // máy tính / máy tính bảng: góc nhìn thứ nhất — cảnh văn phòng mờ dần, điện thoại 3D (thân máy dày, khung kim loại, mặt kính
    // phản chiếu theo góc nghiêng) được nâng lên, khẽ nhấp nhô, nghiêng theo chuột. Điện thoại thật (màn nhỏ): toàn màn hình như cũ.
    const pov = this.pov = matchMedia('(min-width: 761px) and (min-height: 600px)').matches;
    back.classList.toggle('pov', pov);
    back.innerHTML = `<div class="tt-stage"><div class="tt-hold"><div class="tt-bob"><div class="tt-tilt"><i class="tt-shadow" aria-hidden="true"></i><div class="tt-phone">
        <div class="tt-status" aria-hidden="true"><span class="tt-clock"></span><i class="tt-island"></i><span class="tt-sys"><svg viewBox="0 0 18 12" width="17" height="11"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg viewBox="0 0 26 12" width="24" height="11"><rect x=".5" y=".5" width="22" height="11" rx="3.5" fill="none" stroke="currentColor" opacity=".45"/><rect x="2.5" y="2.5" width="15" height="7" rx="2"/><rect x="23.5" y="4" width="2" height="4" rx="1" opacity=".45"/></svg></span></div>
        <div class="tt-screen"><iframe class="tt-frame" title="Video TikTok" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>
          <div class="tt-swipe" aria-hidden="true"></div><i class="tt-black" aria-hidden="true"></i>
          <div class="tt-empty" hidden>${icon('phone', 30)}<b>Chưa tải được video</b><span>Các kênh TikTok chưa phản hồi — thử lại sau ít phút, hoặc bấm "Chia sẻ" để thêm video.</span></div>
          <div class="tt-load">${icon('phone', 26)}<span>Đang tải video…</span></div>
          </div>
        <div class="tt-info"><b class="tt-title"></b><small class="tt-by"></small></div>
        <div class="tt-rail">
          <button type="button" class="tt-btn" data-prev aria-label="Video trước">${icon('chevUp', 18)}</button>
          <span class="tt-pos"></span>
          <button type="button" class="tt-btn" data-next aria-label="Video sau">${icon('chevDown', 18)}</button>
          <button type="button" class="tt-btn" data-mute aria-label="Tắt tiếng">${icon('volume', 17)}</button>
          <button type="button" class="tt-btn" data-del aria-label="Xoá video này" hidden>${icon('trash', 16)}</button>
        </div>
        <div class="tt-acts"><button type="button" class="tt-act" data-share>${icon('plus', 14)} Chia sẻ video</button><button type="button" class="tt-act" data-chans hidden>${icon('edit', 14)} Kênh</button></div>
        <form class="tt-add" hidden><input maxlength="500" inputmode="url" autocomplete="off" placeholder="Dán link video TikTok…" aria-label="Link video TikTok"><button type="submit" class="sx-primary">Thêm</button></form>
        <button type="button" class="tt-close sx-x" aria-label="Cất điện thoại">${icon('close', 18)}</button>
      </div></div></div></div></div>`;
    if (pov) {
      document.body.classList.add('tt-pov');   // (cảnh 3D phía sau: phóng to + mờ + tối — như mắt nhìn xuống tay; style.css)
      const tilt = back.querySelector('.tt-tilt');
      // đang thao tác (di chuột, bấm phím): giữ máy đứng yên — nhấp nhô lại sau 2,5 giây; trình duyệt tự động (kiểm thử): luôn đứng yên
      const still = () => { back.classList.add('still'); clearTimeout(this._stillT); this._stillT = setTimeout(() => back.classList.remove('still'), 2500); };
      back.addEventListener('pointermove', still); back.addEventListener('pointerdown', still); window.addEventListener('keydown', this._still = still, true);
      if (navigator.webdriver) back.classList.add('auto');
      back.addEventListener('pointermove', e => {   // nghiêng nhẹ theo chuột (cầm máy thật)
        const nx = e.clientX / innerWidth - 0.5, ny = e.clientY / innerHeight - 0.5;
        tilt.style.setProperty('--ry', `${(nx * 9).toFixed(2)}deg`); tilt.style.setProperty('--rx', `${(-ny * 6).toFixed(2)}deg`);
        tilt.style.setProperty('--gx', `${(50 + nx * 70).toFixed(1)}%`);   // (ánh phản chiếu mặt kính chạy theo góc nghiêng)
        tilt.style.setProperty('--ex', `${(-nx * 6).toFixed(1)}px`);       // (thấy cạnh thân máy phía bị nghiêng ra)
      });
    }
    document.body.appendChild(back); overlayOn();   // (thôi vẽ 3D bên dưới; bộ đếm chung với bảng tin / phòng họp)
    requestAnimationFrame(() => back.classList.add('show'));
    // mở máy: nâng lên khi màn hình còn tắt, đưa tới trước mặt rồi màn hình mới sáng (như vừa mở khoá)
    if (pov) setTimeout(() => { if (this.el === back) back.classList.add('awake'); }, 560); else back.classList.add('awake');
    this.frame = back.querySelector('.tt-frame');
    back.querySelector('[data-prev]').onclick = () => this.go(-1);
    back.querySelector('[data-next]').onclick = () => this.go(1);
    back.querySelector('[data-mute]').onclick = () => this.toggleMute();
    back.querySelector('[data-del]').onclick = () => this.del();
    back.querySelector('.tt-close').onclick = () => this.close();
    back.querySelector('[data-share]').onclick = () => { const f = back.querySelector('.tt-add'); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); };
    back.querySelector('[data-chans]').onclick = () => this.editChannels();
    back.addEventListener('click', e => { if (e.target === back) this.close(); });
    const input = back.querySelector('.tt-add input');
    input.addEventListener('keydown', e => e.stopPropagation());
    back.querySelector('.tt-add').onsubmit = async e => { e.preventDefault(); const url = input.value.trim(); if (!url) return; const b = e.submitter || back.querySelector('.tt-add button'); b.disabled = true; const r = await api('POST', '/api/tiktok', { url }); b.disabled = false; if (!r.ok) { this.s.toast(r.error || 'Chưa thêm được video.', true); return; } input.value = ''; back.querySelector('.tt-add').hidden = true; if (!this.items.length) { this.items = [r.item]; this.i = 0; this.render(); } else { this.items.splice(this.i + 1, 0, r.item); this.go(1); } this.s.toast('Đã thêm video — cả công ty lướt được rồi.'); };
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
    await this.load();
  }
  async load() {
    const r = await api('GET', '/api/tiktok');
    if (!this.el) return;
    this.el.querySelector('.tt-load')?.remove();
    this.items = r.ok ? r.items : []; this.channels = r.channels || []; this.i = 0;
    this.el.querySelector('[data-chans]').hidden = !r.canManage;
    this.render();
    if (!r.ok) this.s.toast(r.error || 'Chưa tải được danh sách video.', true);
  }
  /** CEO / HC-NS: chọn các kênh TikTok cố định (mỗi dòng một @kênh). */
  async editChannels() {
    const r = await modal({
      title: 'Kênh TikTok để lướt',
      body: `<p class="muted small">Video mới nhất của các kênh này hiện sẵn trong điện thoại (tự cập nhật mỗi 30 phút). Mỗi dòng một kênh, dạng <b>@tenkenh</b> hoặc link kênh. Tối đa 12 kênh.</p>
        <textarea id="ttCh" rows="6" spellcheck="false" style="width:100%;box-sizing:border-box;font:600 14px/1.6 var(--font)">${esc((this.channels || []).map(h => '@' + h).join('\n'))}</textarea>`,
      okText: 'Lưu kênh',
      onOk: async b => {
        const list = b.querySelector('#ttCh').value.split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
        const x = await api('PUT', '/api/tiktok/channels', { channels: list });
        if (!x.ok) return { error: x.error };
        const none = Object.entries(x.found).filter(([, n]) => !n).map(([h]) => '@' + h);
        return { msg: none.length ? `Đã lưu. Chưa lấy được video của ${none.join(', ')} — kiểm tra lại tên kênh.` : 'Đã lưu kênh.', bad: !!none.length };
      }
    });
    if (!r) return;
    this.s.toast(r.msg, r.bad);
    await this.load();
  }
  close() {
    const el = this.el; if (!el) return;
    this.el = null; this.frame = null; clearInterval(this._clock);
    window.removeEventListener('keydown', this._key, true); window.removeEventListener('message', this._msg); if (this._still) window.removeEventListener('keydown', this._still, true); clearTimeout(this._stillT);
    // (overlayOff: trước đây tự dò ".tt-back.show" TRƯỚC khi gỡ class show → tìm thấy chính nó → không bao giờ gỡ overlay-open → cảnh 3D thôi vẽ, màn hình đứng im)
    if (this.s.player?.agent?.act === 'phone') this.s.player.setAct(null);
    if (!this.pov) { overlayOff(); el.classList.remove('show'); el.classList.add('out'); setTimeout(() => el.remove(), 220); return; }
    // tắt máy: bấm nút nguồn → màn hình tắt đen → hạ máy xuống, ngửa ra như đặt xuống đùi; cảnh văn phòng rõ dần trong lúc hạ máy
    el.classList.add('off'); el.style.pointerEvents = 'none';
    // (cảnh 3D chỉ vẽ lại khi đã hạ máy xong — trong lúc hạ, nền bỏ mờ trên khung hình đứng yên: chuyển cảnh mượt)
    setTimeout(() => { document.body.classList.remove('tt-pov'); el.classList.remove('show'); el.classList.add('out'); setTimeout(() => { el.remove(); overlayOff(); }, 620); }, 190);
  }

  // ---------- lướt ----------
  go(d) {
    if (!this.items.length) return;
    let n = this.i + d;
    if (n >= this.items.length && this.items.length > 1) { n = 0; this.s.toast('Đã xem hết — xem lại từ đầu.'); }   // (hết danh sách: quay lại đầu)
    if (n < 0 || n >= this.items.length) { this.bump(d); return; }
    this.i = n; this.render(d);
  }
  bump(d) { const sc = this.el?.querySelector('.tt-screen'); if (!sc) return; sc.classList.remove('bump-up', 'bump-down'); void sc.offsetWidth; sc.classList.add(d > 0 ? 'bump-up' : 'bump-down'); this.s.toast(d > 0 ? 'Hết video rồi.' : 'Đây là video đầu tiên.'); }
  render(dir = 0) {
    const el = this.el; if (!el) return;
    const it = this.items[this.i], empty = !it;
    el.querySelector('.tt-empty').hidden = !empty; this.frame.hidden = empty;
    el.querySelector('.tt-pos').textContent = empty ? '0/0' : `${this.i + 1}/${this.items.length}`;
    el.querySelector('[data-prev]').disabled = this.i <= 0; el.querySelector('[data-next]').disabled = this.items.length < 2;
    el.querySelector('[data-del]').hidden = !it?.canDelete;
    el.querySelector('.tt-title').textContent = it ? (it.title || 'Video TikTok') : '';
    el.querySelector('.tt-by').innerHTML = !it ? '' : it.channel ? `@${esc(it.channel)}${it.author && it.author !== it.channel ? ` · ${esc(it.author)}` : ''}` : `${it.author ? `@${esc(it.author)} · ` : ''}${esc(it.byName || '')} chia sẻ`;
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
