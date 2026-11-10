// Thông báo kiểu game (máy tính: góc trên phải dưới hàng nút; điện thoại: giữa phía trên, rộng gần hết màn):
// thẻ có biểu tượng tròn theo loại, tiêu đề + nội dung + "vừa xong", nút ✕, thanh thời gian chạy ngược; tối đa 3 cái,
// mới nhất ở trên. Rê chuột / chạm giữ thì dừng đếm; vuốt ngang để tắt (điện thoại). Bấm thẻ có onClick thì làm việc đó.
import { esc } from '../session/ui.js';
import { icon as svg } from './icons.js';

let box = null;
export function notice({ title, text = '', icon = '', tone = 'info', onClick = null, ms = 5000 }) {
  if (!box) { box = document.createElement('div'); box.className = 'notices'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `notice notice-${tone}${onClick ? ' is-link' : ''}`;
  el.style.setProperty('--nt-ms', `${ms}ms`);
  el.innerHTML = `<span class="nt-ic">${svg(icon || 'chat', 16)}</span>
    <span class="nt-body"><span class="nt-top"><b>${esc(title)}</b><time>vừa xong</time></span>${text ? `<span class="nt-text">${esc(text)}</span>` : ''}</span>
    <button type="button" class="nt-x" aria-label="Đóng thông báo">${svg('close', 12)}</button><i class="nt-bar" aria-hidden="true"></i>`;
  const close = () => { if (el.dataset.out) return; el.dataset.out = '1'; el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  el.querySelector('.nt-x').onclick = e => { e.stopPropagation(); close(); };
  if (onClick) { el.tabIndex = 0; el.setAttribute('role', 'button'); el.onclick = () => { onClick(); close(); }; el.onkeydown = e => { if (e.key === 'Enter') el.onclick(); }; }
  box.prepend(el);
  while (box.children.length > 3) box.lastElementChild.remove();
  // tự ẩn; dừng khi rê chuột / chạm giữ
  let left = ms, started = performance.now(), t = setTimeout(close, ms);
  const pause = () => { clearTimeout(t); left -= performance.now() - started; el.classList.add('paused'); };
  const resume = () => { started = performance.now(); el.classList.remove('paused'); t = setTimeout(close, Math.max(1200, left)); };
  el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') pause(); });
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') resume(); });
  // vuốt ngang để tắt
  let sx = null, dx = 0;
  el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; sx = e.clientX; dx = 0; pause(); });
  el.addEventListener('pointermove', e => { if (sx === null) return; dx = e.clientX - sx; el.style.transform = `translateX(${dx}px)`; el.style.opacity = String(1 - Math.min(1, Math.abs(dx) / 160)); });
  const up = () => { if (sx === null) return; sx = null; if (Math.abs(dx) > 70) { el.style.transition = 'transform .2s ease, opacity .2s ease'; el.style.transform = `translateX(${Math.sign(dx) * 360}px)`; el.style.opacity = '0'; el.dataset.out = '1'; setTimeout(() => el.remove(), 200); } else { el.style.transform = ''; el.style.opacity = ''; resume(); } };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  return close;
}
