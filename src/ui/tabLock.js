// Một tài khoản chỉ dùng ở MỘT tab (server/realtime.js onConnect): mở thêm tab / trình duyệt / máy khác với cùng tài khoản thì
// vị trí nhân vật bị hai nơi gửi chồng lên nhau (nhảy qua lại). Tab đến sau (dup) hoặc tab vừa bị chuyển đi (replaced) hiện màn
// này, che cảnh 3D, chặn phím; nút "Dùng ở tab này" giành quyền về tab hiện tại (tab kia chuyển sang màn này).
import { overlayOn, overlayOff } from './overlay.js';
import { icon } from './icons.js';

const TEXT = {
  dup: ['Văn phòng đang mở ở tab khác', 'Tài khoản của bạn đang được dùng ở một tab, trình duyệt hoặc máy khác. Mỗi tài khoản chỉ dùng được ở 1 tab để nhân vật không bị nhảy vị trí.'],
  replaced: ['Bạn đã chuyển sang tab khác', 'Văn phòng vừa được mở ở một tab, trình duyệt hoặc máy khác với cùng tài khoản. Tab này đã tạm dừng.']
};

export class TabLock {
  constructor(rt) { this.rt = rt; this.el = null; }
  show(kind) {
    const [title, txt] = TEXT[kind] || TEXT.dup;
    if (!this.el) {
      const el = this.el = document.createElement('div');
      el.className = 'wr-back tl-back'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'tlTitle');
      el.innerHTML = `<div class="wr"><span class="wr-ic tl-ic">${icon('window', 26)}</span>
        <h2 id="tlTitle"></h2><p class="wr-txt"></p>
        <button type="button" class="sx-primary tl-go">${icon('arrowRight', 15)} <span>Dùng ở tab này</span></button>
        <p class="wr-note">${icon('info', 13)} Tab còn lại sẽ tự tạm dừng. Bạn có thể đóng tab không dùng.</p></div>`;
      document.body.appendChild(el); overlayOn();
      requestAnimationFrame(() => el.classList.add('show'));
      el.querySelector('.tl-go').onclick = () => { el.querySelector('.tl-go').disabled = true; this.rt.takeover(); };
      this._key = e => { if (this.el) e.stopPropagation(); };
      window.addEventListener('keydown', this._key, true);
    }
    this.el.querySelector('#tlTitle').textContent = title;
    this.el.querySelector('.wr-txt').textContent = txt;
    this.el.querySelector('.tl-go').disabled = false;
    setTimeout(() => this.el?.querySelector('.tl-go')?.focus(), 60);
  }
  hide() {
    const el = this.el; if (!el) return;
    this.el = null; window.removeEventListener('keydown', this._key, true); overlayOff();
    el.classList.remove('show'); setTimeout(() => el.remove(), 220);
  }
}
