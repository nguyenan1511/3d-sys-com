// HUD văn phòng (design_handoff_office_hud): thẻ hồ sơ có menu thả xuống, gợi ý phím gọn có thể ẩn, phím tắt chung.
//  - Thẻ hồ sơ (đầu cột trái): dải logo SYSONE + hàng danh tính (ảnh chữ cái, tên, vai trò, địa chỉ). Bấm hàng → menu nổi
//    (KHÔNG đẩy các thẻ bên dưới): Nhân vật của tôi · Hướng dẫn: Có gì ở đây? · [Admin: Bảng quản trị, Đổi mật khẩu] ·
//    CÀI ĐẶT NHANH (Hiện chủ chỗ, Âm báo tin nhắn — công tắc) · Đăng xuất (tách riêng, chữ đỏ). Esc / bấm ra ngoài để đóng.
//  - Gợi ý phím: W A S D Di chuyển · Shift Chạy · E Tương tác · ? (mọi phím tắt) · × (thu về viên "Phím tắt ?", nhớ lựa chọn).
//  - Phím: ? mở Phím tắt · G mở "Đi nhanh tới" + ô tìm · M ẩn / hiện bản đồ (không bắt khi đang gõ chữ).
import { esc } from '../session/ui.js';
import { icon } from './icons.js';

const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };
export const initialsOf = name => { const w = String(name || '?').replace(/^\d{3,5}-/, '').replace(/^Admin \((.*)\)$/, '$1').split(/\s+/).filter(Boolean); return (w.length > 1 ? w.slice(-2).map(x => x[0]).join('') : (w[0] || '?').slice(0, 2)).toUpperCase(); };
const typing = () => { const t = document.activeElement; return !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); };

/** Thẻ hồ sơ + menu. Các nút cũ (#btnLook, #btnDash, #btnPw, #cOwners, #cSound, #btnLogout, .intro-btn) được chuyển vào menu
 *  (giữ nguyên id → mọi chỗ khác vẫn dùng được). */
export function mountProfile(session, introBtn) {
  const panel = document.getElementById('panel'); if (!panel) return;
  let card = document.getElementById('hudProfile');
  const admin = session.isAdmin, me = admin ? session.me.admin : session.me.employee;
  const name = admin ? (me.username === 'admin' ? 'Admin' : `Admin · ${me.username}`) : me.display;
  const ini = admin ? 'AD' : initialsOf(me.display);
  if (!card) {
    card = document.createElement('section'); card.id = 'hudProfile'; card.className = 'hud-card hud-profile';
    const host = panel.querySelector('.drawer-scroll') || panel; host.insertBefore(card, host.firstChild);   // (đầu ngăn kéo / cột trái)
  }
  card.innerHTML = `<div class="hp-logo"><img src="logo/sysone-logo.svg" alt="SYSONE" width="174" height="20"></div>
    <button type="button" id="hudMe" class="hp-me" aria-haspopup="menu" aria-expanded="false" aria-controls="hudMenu">
      <span class="hp-av">${esc(ini)}<i aria-hidden="true"></i></span>
      <span class="hp-id"><span class="hp-r1"><b>${esc(name)}</b><em>${admin ? 'Quản trị' : 'Nhân viên'}</em></span><small>33 Dương Quang Đông</small></span>
      <span class="hp-chev">${icon('chevDown', 18)}</span></button>`;
  // menu nổi (ở gốc #appRoot: không bị cột trái cắt, không đẩy bố cục)
  let menu = document.getElementById('hudMenu');
  if (!menu) {
    menu = document.createElement('div'); menu.id = 'hudMenu'; menu.className = 'hud-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
    const catcher = document.createElement('div'); catcher.className = 'hud-catch'; catcher.hidden = true;
    document.getElementById('appRoot').append(catcher, menu);
    catcher.onclick = () => closeMenu();
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); closeMenu(true); } }, true);
    menu.addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.closest('.hm-tog')) setTimeout(() => closeMenu(), 0); });
  }
  const look = document.getElementById('btnLook'), dash = document.getElementById('btnDash'), pw = document.getElementById('btnPw');
  const owners = document.getElementById('cOwners')?.closest('label'), snd = document.getElementById('cSound')?.closest('label'), out = document.getElementById('btnLogout');
  const item = (el, ic, label, sub = '') => { if (!el) return null; el.classList.add('hm-item'); el.setAttribute('role', el.tagName === 'LABEL' ? 'menuitemcheckbox' : 'menuitem'); el.innerHTML = el.tagName === 'LABEL' ? '' : `${icon(ic, 18)}<span class="hm-t">${label}</span>`; return el; };
  const tog = (lbl, ic, label, sub) => {
    if (!lbl) return null; const input = lbl.querySelector('input');
    lbl.className = 'hm-item hm-tog'; lbl.replaceChildren();
    lbl.insertAdjacentHTML('beforeend', `${icon(ic, 18)}<span class="hm-t">${label}<small>${sub}</small></span>`);
    lbl.appendChild(input); lbl.insertAdjacentHTML('beforeend', '<span class="hm-sw" aria-hidden="true"><i></i></span>');
    return lbl;
  };
  if (introBtn) { introBtn.className = 'intro-btn hm-item'; introBtn.innerHTML = `${icon('info', 18)}<span class="hm-t">Hướng dẫn: Có gì ở đây?</span>`; }
  const sep = () => Object.assign(document.createElement('div'), { className: 'hm-sep' });
  const lbl = t => Object.assign(document.createElement('div'), { className: 'hm-lbl', textContent: t });
  menu.replaceChildren(...[
    item(look, 'user', 'Nhân vật của tôi'), introBtn,
    item(dash, 'clipboard', 'Bảng quản trị'), item(pw, 'key', 'Đổi mật khẩu'),
    sep(), lbl('CÀI ĐẶT NHANH'),
    tog(owners, 'tag', 'Hiện chủ chỗ', 'Tên trên mỗi bàn làm việc'), tog(snd, 'volume', 'Âm báo tin nhắn', 'Phát âm khi có chat mới'),
    sep(), out && (out.className = 'hm-item hm-out', out.innerHTML = `${icon('logout', 18)}<span class="hm-t">Đăng xuất</span>`, out)
  ].filter(Boolean));
  const btn = card.querySelector('#hudMe');
  const place = () => { const r = card.getBoundingClientRect(), root = document.getElementById('appRoot').getBoundingClientRect(); menu.style.top = `${Math.round(r.bottom - root.top + 8)}px`; menu.style.left = `${Math.round(r.left - root.left)}px`; menu.style.width = `${Math.round(r.width)}px`; };
  function closeMenu(focus = false) { if (menu.hidden) return; menu.classList.remove('show'); menu.hidden = true; menu.previousElementSibling.hidden = true; document.getElementById('hudMe')?.setAttribute('aria-expanded', 'false'); document.getElementById('hudMe')?.classList.remove('open'); if (focus) document.getElementById('hudMe')?.focus(); }
  btn.onclick = () => {
    if (!menu.hidden) { closeMenu(); return; }
    place(); menu.hidden = false; menu.previousElementSibling.hidden = false; btn.setAttribute('aria-expanded', 'true'); btn.classList.add('open');
    requestAnimationFrame(() => menu.classList.add('show'));
    document.dispatchEvent(new CustomEvent('hud:menu'));   // (mở menu thì đóng ngăn kéo khác)
  };
}

/** Thanh gợi ý phím (3D). Trả về HTML; gắn sự kiện qua bindHints(). */
export function hintsHtml() {
  const cap = k => `<kbd>${k}</kbd>`;
  return `<div class="hk-bar"><span class="hk">${['W', 'A', 'S', 'D'].map(cap).join('')}<span>Di chuyển</span></span><span class="hk">${cap('Shift')}<span>Chạy</span></span><span class="hk">${cap('E')}<span>Tương tác</span></span>
    <button type="button" class="keys-btn hk-q" title="Tất cả phím tắt (?)" aria-label="Tất cả phím tắt">${cap('?')}</button>
    <button type="button" class="hk-x" title="Ẩn gợi ý" aria-label="Ẩn gợi ý phím">${icon('close', 12)}</button></div>
    <button type="button" class="keys-btn hk-pill" title="Tất cả phím tắt">Phím tắt ${cap('?')}</button>`;
}
export function bindHints(host) {
  const set = off => { host.classList.toggle('hk-off', off); store.set('sysone.hints', off ? '0' : '1'); };
  host.classList.toggle('hk-off', store.get('sysone.hints') === '0');
  host.querySelector('.hk-x')?.addEventListener('click', () => set(true));
}

/** Phím chung của HUD: ? · G · M. */
export function bindHudKeys(app) {
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing() || document.querySelector('.modal-back') || document.body.classList.contains('overlay-open')) return;
    if (e.key === '?') { e.preventDefault(); app.openKeys?.(); return; }
    const k = e.key.toLowerCase();
    if (k === 'm' && !e.repeat) { const t = document.querySelector('#minimap .mm-tog'); if (t) { e.preventDefault(); t.click(); } return; }
    if (k === 'g' && !e.repeat && app.session?.player) {
      const v = document.getElementById('viewBox'); if (!v) return;
      e.preventDefault(); v.open = true; document.getElementById('panel')?.classList.remove('collapsed');
      setTimeout(() => v.querySelector('.qt-q')?.focus(), 30);
    }
  });
}
