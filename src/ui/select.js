// Ô chọn (select) tự vẽ theo giao diện SYSONE — thay cho <select> mặc định của trình duyệt ở mọi nơi.
// <select> gốc vẫn giữ (ẩn) làm nguồn dữ liệu: code cũ đọc .value / nghe 'change' như trước; gán .value bằng code thì ô
// hiển thị tự cập nhật. Tự áp dụng cho mọi <select> mới thêm vào trang (MutationObserver); muốn giữ ô gốc: data-native.
// Bàn phím: ↑ ↓ Home End để chọn, Enter / Space mở – chọn, Esc đóng, gõ chữ để nhảy tới mục. Danh sách dài (> 10 mục)
// có ô tìm. Danh sách mở nổi trên body (không bị khung cuộn cắt), tự lật lên khi gần mép dưới.
import { esc } from '../session/ui.js';
import { icon } from './icons.js';

let open = null;   // ô đang mở
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

export function enhanceSelect(sel) {
  if (sel.dataset.native !== undefined || sel._cs || sel.multiple) return;
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'cs';
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  const lab = sel.id && document.querySelector(`label[for="${CSS.escape(sel.id)}"]`);
  btn.setAttribute('aria-label', sel.getAttribute('aria-label') || lab?.textContent?.trim() || 'Chọn');
  for (const c of sel.classList) btn.classList.add(`cs-${c}`);
  sel.after(btn); sel.classList.add('cs-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  const cs = sel._cs = { sel, btn, refresh: () => paint(cs) };
  // gán .value / .selectedIndex bằng code: cập nhật ô hiển thị
  for (const prop of ['value', 'selectedIndex']) {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    Object.defineProperty(sel, prop, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); paint(cs); } });
  }
  sel.addEventListener('change', () => paint(cs));
  new MutationObserver(() => paint(cs)).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label'] });
  if (lab) lab.addEventListener('click', e => { e.preventDefault(); btn.focus(); });
  btn.addEventListener('click', () => (open?.cs === cs ? close() : show(cs)));
  btn.addEventListener('keydown', e => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); show(cs); }
    else if (e.key.length === 1 && /\S/.test(e.key)) { e.stopPropagation(); jump(cs, e.key); }
  });
  paint(cs);
}
function paint(cs) {
  const { sel, btn } = cs, o = sel.options[sel.selectedIndex];
  btn.disabled = sel.disabled;
  btn.innerHTML = `<span class="cs-v${o && !o.value ? ' ph' : ''}">${esc(o ? o.textContent : '')}</span>${icon('chevDown', 14, 'cs-ar')}`;
}
/** Gõ chữ khi ô đang đóng: chọn mục kế tiếp bắt đầu bằng chữ đó. */
function jump(cs, ch) {
  const opts = [...cs.sel.options], n = norm(ch), from = cs.sel.selectedIndex;
  for (let k = 1; k <= opts.length; k++) { const o = opts[(from + k) % opts.length]; if (!o.disabled && norm(o.textContent).trim().startsWith(n)) { pick(cs, o.index); return; } }
}
function pick(cs, i) {
  const { sel } = cs; if (sel.selectedIndex === i) return;
  sel.selectedIndex = i;
  sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function show(cs) {
  close();
  const { sel, btn } = cs, opts = [...sel.options], long = opts.length > 10;
  const pop = document.createElement('div'); pop.className = 'cs-pop'; pop.setAttribute('role', 'presentation');
  const id = `cs${Math.random().toString(36).slice(2, 8)}`;
  pop.innerHTML = `${long ? `<div class="cs-q">${icon('target', 13)}<input placeholder="Tìm…" aria-label="Tìm trong danh sách" autocomplete="off"></div>` : ''}<ul class="cs-list" role="listbox" id="${id}" tabindex="-1"></ul>`;
  document.body.appendChild(pop);
  const ul = pop.querySelector('ul'), q = pop.querySelector('input');
  let act = Math.max(0, sel.selectedIndex), shown = opts;
  const render = () => {
    const f = q ? norm(q.value.trim()) : '';
    shown = f ? opts.filter(o => norm(o.textContent).includes(f)) : opts;
    ul.innerHTML = shown.length ? shown.map(o => `<li role="option" id="${id}-${o.index}" data-i="${o.index}" aria-selected="${o.index === sel.selectedIndex}" ${o.disabled ? 'aria-disabled="true"' : ''} class="${o.index === sel.selectedIndex ? 'sel' : ''}${o.index === act ? ' act' : ''}${o.disabled ? ' dis' : ''}${o.value ? '' : ' ph'}">${o.index === sel.selectedIndex ? icon('check', 13, 'cs-ck') : ''}<span>${esc(o.textContent)}</span></li>`).join('') : '<li class="cs-none">Không có mục nào.</li>';
    if (!shown.some(o => o.index === act)) act = shown.find(o => !o.disabled)?.index ?? -1;
    mark();
  };
  const mark = () => { ul.querySelectorAll('li[data-i]').forEach(li => li.classList.toggle('act', +li.dataset.i === act)); const a = ul.querySelector('.act'); if (a) { a.scrollIntoView({ block: 'nearest' }); btn.setAttribute('aria-activedescendant', a.id); } };
  const move = d => { const en = shown.filter(o => !o.disabled); if (!en.length) return; let k = en.findIndex(o => o.index === act); k = k < 0 ? 0 : Math.max(0, Math.min(en.length - 1, k + d)); act = en[k].index; mark(); };
  ul.addEventListener('mousedown', e => e.preventDefault());   // (không mất focus của nút / ô tìm)
  ul.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (!li || li.classList.contains('dis')) return; pick(cs, +li.dataset.i); close(); btn.focus(); });
  ul.addEventListener('mousemove', e => { const li = e.target.closest('li[data-i]'); if (li && !li.classList.contains('dis') && +li.dataset.i !== act) { act = +li.dataset.i; mark(); } });
  const key = e => {
    if (e.key === 'ArrowDown') move(1); else if (e.key === 'ArrowUp') move(-1);
    else if (e.key === 'Home') { act = -1; move(1); } else if (e.key === 'End') { act = -1; move(1e6); }
    else if (e.key === 'Enter' || (e.key === ' ' && !q)) { if (act >= 0 && !opts[act]?.disabled) pick(cs, act); close(); btn.focus(); }
    else if (e.key === 'Escape') { close(); btn.focus(); }
    else if (e.key === 'Tab') { close(); return; }
    else if (!q && e.key.length === 1) { const n = norm(e.key), o = shown.find(o => !o.disabled && o.index !== act && norm(o.textContent).trim().startsWith(n)) || shown.find(o => !o.disabled && norm(o.textContent).trim().startsWith(n)); if (o) { act = o.index; mark(); } }
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  (q || btn).addEventListener('keydown', key);
  if (q) q.addEventListener('input', render);
  render();
  // vị trí: dưới ô (đủ chỗ) hoặc trên ô
  const place = () => {
    const r = btn.getBoundingClientRect(), vh = innerHeight, below = vh - r.bottom - 8, above = r.top - 8, up = below < 220 && above > below;
    pop.style.minWidth = `${Math.max(r.width, 180)}px`; pop.style.left = `${Math.min(r.left, innerWidth - Math.max(r.width, 180) - 8)}px`;
    pop.style.maxHeight = `${Math.min(320, up ? above : below)}px`;
    if (up) { pop.style.top = ''; pop.style.bottom = `${vh - r.top + 4}px`; } else { pop.style.bottom = ''; pop.style.top = `${r.bottom + 4}px`; }
    pop.classList.toggle('up', up);
  };
  place();
  btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-controls', id); btn.classList.add('on');
  const away = e => { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close(); };
  const onScroll = e => { if (!pop.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  window.addEventListener('scroll', onScroll, true); window.addEventListener('resize', close);
  open = { cs, pop, cleanup: () => { document.removeEventListener('pointerdown', away, true); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', close); (q || btn).removeEventListener('keydown', key); } };
  requestAnimationFrame(() => pop.classList.add('show'));
  if (q) q.focus({ preventScroll: true });
}
function close() {
  if (!open) return; const { cs, pop, cleanup } = open; open = null; cleanup();
  cs.btn.setAttribute('aria-expanded', 'false'); cs.btn.removeAttribute('aria-activedescendant'); cs.btn.classList.remove('on');
  pop.remove();
}

/** Áp dụng cho mọi <select> trong root, và tự áp dụng cho select thêm vào sau này. */
export function autoEnhanceSelects(root = document.body) {
  const run = n => { if (n.nodeType !== 1) return; if (n.tagName === 'SELECT') enhanceSelect(n); else n.querySelectorAll?.('select').forEach(enhanceSelect); };
  run(root);
  new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach(run); }).observe(root, { childList: true, subtree: true });
}
