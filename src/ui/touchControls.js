// Điều khiển trên điện thoại / máy tính bảng:
//  - cần điều khiển ảo góc trái: kéo để đi (theo hướng camera, như W A S D), kéo gần hết vòng thì chạy;
//  - nút góc phải: Tương tác (= phím E: ngồi/đứng, chấm công, thang máy, nói chuyện…), Nhảy, Về bàn (= phím B);
//  - dòng gợi ý "E …" bấm được.
// Chỉ bật khi màn hình nhỏ hoặc thiết bị cảm ứng (isTouchUI). Kéo trên cảnh vẫn xoay camera, chụm 2 ngón để zoom.
import { icon } from './icons.js';

const MQ = '(max-width: 760px), (max-height: 500px) and (max-width: 1100px), (pointer: coarse) and (max-width: 1100px)';
export const isTouchUI = () => typeof matchMedia === 'function' && matchMedia(MQ).matches;

export class TouchControls {
  constructor(app, session) {
    this.app = app; this.s = session;
    const root = this.el = document.createElement('div'); root.className = 'touch-ui';
    root.innerHTML = `<div class="joy" aria-label="Cần điều khiển: kéo để đi" role="application"><div class="joy-knob"></div></div>
      <div class="tbtns">
        <button type="button" class="tbtn tbtn-main" data-key="e" aria-label="Tương tác (E)">${icon('target', 22)}<span>Tương tác</span></button>
        <button type="button" class="tbtn" data-key=" " aria-label="Nhảy">${icon('chevUp', 20)}<span>Nhảy</span></button>
        <button type="button" class="tbtn" data-key="b" aria-label="Về bàn làm việc">${icon('clipboard', 18)}<span>Về bàn</span></button>
      </div>`;
    document.getElementById('stage').appendChild(root);
    document.body.classList.add('touch-ui-on');
    this.bindJoy(root.querySelector('.joy'), root.querySelector('.joy-knob'));
    root.querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); this.press(b.dataset.key); }));
    // điện thoại: chạm vào cảnh 3D thì đóng tấm bảng điều khiển đang mở
    document.getElementById('c3')?.addEventListener('pointerdown', () => {
      const p = document.getElementById('panel'); if (p && !p.classList.contains('collapsed') && matchMedia('(max-width: 760px), (max-height: 500px) and (max-width: 1100px)').matches) document.getElementById('panelToggle')?.click();
    });
    // bấm một nút trong tấm bảng điều khiển để mở thứ khác (bảng công, nhân vật, đi nhanh tới…): đóng tấm lại để hộp
    // thoại / cảnh không bị che. (Bật/tắt công tắc, mở mục con thì giữ nguyên.)
    document.getElementById('panel')?.addEventListener('click', e => {
      const b = e.target.closest('button, a'); if (!b || b.id === 'panelToggle' || b.closest('summary') || b.closest('label')) return;
      if (!matchMedia(MQ).matches) return;
      setTimeout(() => { const p = document.getElementById('panel'); if (p && !p.classList.contains('collapsed')) document.getElementById('panelToggle')?.click(); }, 60);
    });
    // dòng gợi ý "E chấm công", "F kéo rèm"…: chạm vào là bấm đúng phím đang được nhắc (điện thoại không có bàn phím)
    document.addEventListener('click', e => {
      const el = e.target.closest('#hudPrompt'); if (!el) return;
      const k = (el.querySelector('b, kbd, .key')?.textContent || 'E').trim().toLowerCase();
      this.press(/^[a-z]$/.test(k) ? k : 'e');
    });
  }
  get player() { return this.s.player; }
  press(key) {
    const pl = this.player; if (!pl) return;
    const ev = { key, type: 'keydown', repeat: false, preventDefault() {} };
    pl.onKey(ev); pl.onKey({ ...ev, type: 'keyup' });
  }
  bindJoy(base, knob) {
    let id = null, cx = 0, cy = 0;
    const R = 46;
    const set = (dx, dy) => {
      const len = Math.hypot(dx, dy), k = len > R ? R / len : 1, x = dx * k, y = dy * k;
      knob.style.transform = `translate(${x}px, ${y}px)`;
      const nx = x / R, ny = y / R, pl = this.player; if (!pl) return;
      const keys = { f: ny < -0.35, b: ny > 0.35, l: nx < -0.35, r: nx > 0.35 };
      const moving = keys.f || keys.b || keys.l || keys.r;
      if (moving && !pl._joyMoving) { pl.follow(); pl.stopPath?.(); }
      pl._joyMoving = moving;
      Object.assign(pl.keys, keys); pl.run = Math.hypot(nx, ny) > 0.92;
      pl.stick = { x: nx, y: -ny };   // (analog: nghiêng ít đi chậm, như hangmu.online)
    };
    const end = () => { id = null; knob.style.transform = ''; base.classList.remove('on'); const pl = this.player; if (pl) { Object.assign(pl.keys, { f: false, b: false, l: false, r: false }); pl.run = false; pl._joyMoving = false; pl.stick = null; } };
    base.addEventListener('pointerdown', e => {
      e.preventDefault(); base.setPointerCapture(e.pointerId); id = e.pointerId; base.classList.add('on');
      const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; set(e.clientX - cx, e.clientY - cy);
    });
    base.addEventListener('pointermove', e => { if (e.pointerId === id) set(e.clientX - cx, e.clientY - cy); });
    base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end); base.addEventListener('lostpointercapture', end);
  }
}
