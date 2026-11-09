// Thông báo ngắn, hộp thoại, hộp xác nhận cho thao tác nguy hiểm (không dùng window.confirm để không chặn trang).
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer = null;
export function toast(msg, bad = false, ms = 3500) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.className = 'toast' + (bad ? ' bad' : ''); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/** Hộp thoại; body là HTML đã escape. Trả về Promise<giá trị> (null khi hủy). */
export function modal({ title, body, okText = 'Đồng ý', cancelText = 'Hủy', danger = false, onOk }) {
  return new Promise(resolve => {
    const back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle"><h2 id="mTitle">${esc(title)}</h2><div class="mBody">${body || ''}</div><p class="err" id="mErr" role="alert"></p>
      <div class="actions"><button type="button" id="mCancel">${esc(cancelText)}</button><button type="button" id="mOk" class="${danger ? 'primary danger-fill' : 'primary'}">${esc(okText)}</button></div></div>`;
    document.getElementById('modalRoot').appendChild(back);
    const prev = document.activeElement;
    const close = v => { back.remove(); prev?.focus?.(); resolve(v); };
    back.querySelector('#mCancel').onclick = () => close(null);
    back.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
    back.querySelector('#mOk').onclick = async () => {
      if (!onOk) return close(true);
      const r = await onOk(back);
      if (r && r.error) { back.querySelector('#mErr').textContent = r.error; return; }
      close(r ?? true);
    };
    (back.querySelector('input,select') || back.querySelector('#mOk')).focus();
  });
}

export const confirmDanger = (title, text, okText = 'Xác nhận') => modal({ title, body: `<p>${esc(text)}</p>`, okText, danger: true });
