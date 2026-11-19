// Màn chờ khi văn phòng đủ người (server giới hạn MAX_ONLINE — server/realtime.js Gate): báo vị trí trong hàng chờ, đếm ngược
// lần thử lại, nút "Thử lại ngay". Có chỗ là tự vào (server gửi hello → ẩn). Che cả cảnh 3D và chặn phím tới nhân vật.
import { overlayOn, overlayOff } from './overlay.js';
import { icon } from './icons.js';

export class WaitRoom {
  constructor(rt) { this.rt = rt; this.el = null; }
  show(m) {
    if (!this.el) {
      const el = this.el = document.createElement('div');
      el.className = 'wr-back'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'wrTitle');
      el.innerHTML = `<div class="wr"><span class="wr-ic">${icon('users', 26)}</span>
        <h2 id="wrTitle">Văn phòng đang quá tải</h2>
        <p class="wr-txt"></p>
        <div class="wr-pos"><b></b><span>vị trí của bạn trong hàng chờ</span></div>
        <p class="wr-next" aria-live="polite"></p>
        <button type="button" class="sx-primary wr-go">${icon('reset', 15)} <span>Thử lại ngay</span></button>
        <p class="wr-note">${icon('info', 13)} Đừng tắt trang — có chỗ trống là bạn tự vào văn phòng.</p></div>`;
      document.body.appendChild(el); overlayOn();
      requestAnimationFrame(() => el.classList.add('show'));
      el.querySelector('.wr-go').onclick = () => { this.rt.retryNow(); this.paintNext(); };
      this._key = e => { if (this.el) e.stopPropagation(); };
      window.addEventListener('keydown', this._key, true);
      this._tick = setInterval(() => this.paintNext(), 500);
    }
    this.el.querySelector('.wr-txt').textContent = `Hệ thống đang có ${m.online}/${m.max} người online — mức tối đa hiện tại. Vui lòng chờ trong giây lát.`;
    this.el.querySelector('.wr-pos b').textContent = m.pos;
    this.paintNext();
  }
  paintNext() {
    const p = this.el?.querySelector('.wr-next'); if (!p) return;
    const s = Math.max(0, Math.ceil(((this.rt.nextTry || 0) - Date.now()) / 1000));
    p.textContent = s ? `Tự thử vào lại sau ${s} giây…` : 'Đang thử vào lại…';
  }
  hide() {
    const el = this.el; if (!el) return;
    this.el = null; clearInterval(this._tick); window.removeEventListener('keydown', this._key, true); overlayOff();
    el.classList.remove('show'); setTimeout(() => el.remove(), 220);
  }
}
