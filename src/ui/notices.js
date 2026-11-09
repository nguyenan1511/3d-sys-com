// Thông báo nhỏ góc trên bên phải (kiểu game): trượt vào, tự ẩn sau vài giây, tối đa 3 cái chồng nhau.
// Bấm vào thông báo có onClick thì làm việc đó (vd. mở đúng kênh chat).
import { esc } from '../session/ui.js';
import { icon as svg } from './icons.js';

let box = null;
export function notice({ title, text = '', icon = '', tone = 'info', onClick = null, ms = 4500 }) {
  if (!box) { box = document.createElement('div'); box.className = 'notices'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const el = document.createElement(onClick ? 'button' : 'div');
  if (onClick) el.type = 'button';
  el.className = `notice notice-${tone}`;
  el.innerHTML = `${icon ? `<span class="nt-ic">${svg(icon, 16)}</span>` : ''}<span class="nt-body"><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</span>`;
  const close = () => { if (el.dataset.out) return; el.dataset.out = '1'; el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  if (onClick) el.onclick = () => { onClick(); close(); };
  box.prepend(el);
  while (box.children.length > 3) box.lastElementChild.remove();
  let t = setTimeout(close, ms);
  el.onmouseenter = () => clearTimeout(t); el.onmouseleave = () => { t = setTimeout(close, 1800); };
  return close;
}
