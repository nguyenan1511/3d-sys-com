// Màn hình đăng nhập: tab Nhân viên (mã "1151-An") và tab Admin (tài khoản CEO: tên đăng nhập + mật khẩu).
// Kiểm tra định dạng ngay khi gõ; quyết định cuối cùng ở server.
import { parseLogin } from '../shared/identity.js';
import { api } from '../net/api.js';
import { MODES, getMode, saveMode, REAL_ENABLED } from '../core/mode.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

import { rememberLogin, forgetLogin } from './remember.js';

export function showLogin(root, { onSuccess, notice, prefill = '' } = {}) {
  root.hidden = false;
  root.innerHTML = `
  <div class="login-card" role="main">
    <div class="login-brand"><h1><img src="logo/sysone-logo.svg" alt="SYSONE" class="login-logo" width="174" height="20"></h1><p>Văn phòng 33 Dương Quang Đông</p></div>
    ${notice ? `<p class="login-notice" role="status">${esc(notice)}</p>` : ''}
    ${REAL_ENABLED ? `<fieldset class="mode-pick"><legend>Chọn chế độ</legend>
      ${Object.values(MODES).map(m => `<label class="mode-opt"><input type="radio" name="mode" value="${m.id}"${getMode() === m.id ? ' checked' : ''}><span><b>${m.name}</b><small>${m.hint}</small></span></label>`).join('')}
    </fieldset>` : ''}
    <div class="tabs" role="tablist" aria-label="Loại tài khoản">
      <button role="tab" id="tabEmp" aria-selected="true" aria-controls="paneEmp">Nhân viên</button>
      <button role="tab" id="tabCeo" aria-selected="false" aria-controls="paneCeo" tabindex="-1">Admin</button>
    </div>
    <form id="paneEmp" role="tabpanel" aria-labelledby="tabEmp" novalidate>
      <label for="empInput">Mã nhân viên</label>
      <input id="empInput" name="code" autocomplete="username" placeholder="1151-An" spellcheck="false" aria-describedby="empHelp empErr" required>
      <p id="empHelp" class="help">4 chữ số, dấu gạch ngang, rồi tên của bạn (có dấu).</p>
      <p id="empErr" class="err" role="alert" aria-live="polite"></p>
      <button type="submit" id="empSubmit" class="primary" disabled>Vào văn phòng</button>
    </form>
    <form id="paneCeo" role="tabpanel" aria-labelledby="tabCeo" hidden novalidate>
      <label for="ceoUser">Tên đăng nhập</label>
      <input id="ceoUser" name="username" autocomplete="username" required>
      <label for="ceoPass">Mật khẩu</label>
      <input id="ceoPass" name="password" type="password" autocomplete="current-password" required>
      <p id="ceoErr" class="err" role="alert" aria-live="polite"></p>
      <button type="submit" id="ceoSubmit" class="primary">Đăng nhập</button>
    </form>
  </div>`;
  const $ = id => root.querySelector('#' + id);
  if (REAL_ENABLED) saveMode(getMode());
  root.querySelectorAll('input[name=mode]').forEach(r => { r.onchange = () => saveMode(r.value); });
  const tabs = [$('tabEmp'), $('tabCeo')], panes = [$('paneEmp'), $('paneCeo')];
  const select = i => {
    tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; panes[k].hidden = k !== i; });
    (i === 0 ? $('empInput') : $('ceoUser')).focus();
  };
  tabs.forEach((t, i) => {
    t.onclick = () => select(i);
    t.onkeydown = e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { select(1 - i); tabs[1 - i].focus(); } };
  });

  // ----- nhân viên -----
  const inp = $('empInput'), err = $('empErr'), btn = $('empSubmit');
  if (prefill) inp.value = prefill;
  let touched = false;
  const validate = () => {
    const p = parseLogin(inp.value);
    btn.disabled = !p.ok;
    const show = touched && !p.ok && inp.value.trim() !== '';
    err.textContent = show ? p.error : '';
    inp.setAttribute('aria-invalid', String(show));
    return p;
  };
  inp.addEventListener('input', () => { touched = touched || inp.value.length >= 5 || /-/.test(inp.value); validate(); });
  inp.addEventListener('blur', () => { touched = true; validate(); });
  $('paneEmp').onsubmit = async e => {
    e.preventDefault(); touched = true;
    const p = validate();
    if (!p.ok) { err.textContent = p.error; inp.focus(); return; }
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Đang kiểm tra…';
    const r = await api('POST', '/api/login/employee', { input: inp.value });
    btn.textContent = 'Vào văn phòng';
    if (!r.ok) {
      err.textContent = r.error; inp.setAttribute('aria-invalid', 'true'); btn.disabled = false;
      inp.focus(); inp.select();
      return;
    }
    rememberLogin(inp.value);   // (lần sau server mất phiên: máy tự đăng nhập lại)
    onSuccess?.();
  };

  // ----- CEO -----
  $('paneCeo').onsubmit = async e => {
    e.preventDefault();
    const u = $('ceoUser').value.trim(), pw = $('ceoPass').value, cerr = $('ceoErr'), cb = $('ceoSubmit');
    cerr.textContent = '';
    if (!u || !pw) { cerr.textContent = 'Nhập tên đăng nhập và mật khẩu.'; return; }
    cb.disabled = true; cb.textContent = 'Đang đăng nhập…';
    const r = await api('POST', '/api/login/admin', { username: u, password: pw });
    cb.disabled = false; cb.textContent = 'Đăng nhập';
    if (!r.ok) { cerr.textContent = r.error; $('ceoPass').value = ''; $('ceoPass').focus(); return; }
    forgetLogin();   // (máy này giờ dùng tài khoản CEO: không tự đăng nhập lại mã nhân viên cũ)
    onSuccess?.();
  };
  inp.focus();
}
