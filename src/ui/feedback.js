// Góp ý & báo lỗi: nhắn cho Admin như chat thường (server/feedback.js).
//  - Nhân viên: danh sách cuộc trò chuyện của mình; "Cuộc mới" → chọn Góp ý / Báo lỗi → gõ chữ, dán / kéo thả / chọn ảnh → gửi.
//  - Admin: mọi cuộc (lọc Chưa xử lý / Tất cả / Góp ý / Báo lỗi), trả lời, đánh dấu Đã xử lý / Mở lại, xoá.
//  - Tin mới đến ngay (WebSocket { t: 'fb' }); nút trên thanh dock có số tin chưa đọc.
//  Máy tính: 2 cột (danh sách | khung chat). Điện thoại: một cột, bấm cuộc để mở, nút ‹ để quay lại.
import { api } from '../net/api.js';
import { esc, toast, confirmDanger } from '../session/ui.js';
import { icon } from './icons.js';
import { notice } from './notices.js';
import { sound } from '../audio/notify.js';

const KINDS = { idea: { label: 'Góp ý', icon: 'bulb', hint: 'Ý tưởng, đề xuất để văn phòng tốt hơn' }, bug: { label: 'Báo lỗi', icon: 'bug', hint: 'Có gì đó chạy sai, kèm ảnh chụp càng tốt' } };
const TEXT_MAX = 2000, IMG_SIDE = 1600;
const hm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const when = ts => { const d = new Date(ts), n = new Date(); if (d.toDateString() === n.toDateString()) return hm(ts); const y = new Date(n); y.setDate(n.getDate() - 1); if (d.toDateString() === y.toDateString()) return 'Hôm qua'; return `${d.getDate()}/${d.getMonth() + 1}`; };
const dayLine = ts => { const d = new Date(ts), n = new Date(); if (d.toDateString() === n.toDateString()) return 'Hôm nay'; const y = new Date(n); y.setDate(n.getDate() - 1); if (d.toDateString() === y.toDateString()) return 'Hôm qua'; return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; };

/** Ảnh → { type, data (base64), url (xem trước) }: thu nhỏ cạnh dài ≤ 1600 px, JPEG (giữ GIF động nếu ≤ 3 MB). */
export async function readImage(file) {
  if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Chỉ gửi được ảnh PNG, JPG, WebP hoặc GIF.');
  if (file.type === 'image/gif' && file.size <= 3 * 1024 * 1024) {
    const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
    return { type: 'image/gif', data: url.split(',')[1], url };
  }
  const bmp = await createImageBitmap(file).catch(() => null); if (!bmp) throw new Error('Không đọc được ảnh này.');
  const k = Math.min(1, IMG_SIDE / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  let url = c.toDataURL('image/jpeg', 0.86); if (url.length > 2.6e6) url = c.toDataURL('image/jpeg', 0.7);
  return { type: 'image/jpeg', data: url.split(',')[1], url };
}

export class FeedbackPanel {
  /** @param s phiên (src/session/session.js): isAdmin, rt (WebSocket) */
  constructor(s) {
    this.s = s; this.admin = !!s.isAdmin; this.threads = []; this.cur = null; this.msgs = []; this.filter = this.admin ? 'open' : 'all'; this.draftImg = null; this.newKind = null;
    s.rt?.on('fb', m => this.onPush(m));
    this.refresh();
  }
  get unread() { return this.threads.filter(t => t.unread).length; }
  async refresh() { const r = await api('GET', '/api/feedback'); if (r.ok) { this.threads = r.threads; this.badge(); if (this.el) this.paintList(); } }
  /** Số trên nút dock (#btnFb). */
  badge() { const b = document.querySelector('#btnFb .fb-n'); if (!b) return; const n = this.unread; b.textContent = n > 9 ? '9+' : String(n); b.hidden = !n; }

  // ---------- realtime ----------
  onPush({ thread, msg }) {
    if (thread.removed) { this.threads = this.threads.filter(t => t.id !== thread.id); if (this.cur === thread.id) this.show(null); }
    else {
      const open = this.el && this.cur === thread.id && document.visibilityState === 'visible';
      if (open && thread.unread) { thread.unread = false; api('GET', `/api/feedback/${thread.id}`); }   // (đang xem cuộc này: đánh dấu đã đọc)
      const i = this.threads.findIndex(t => t.id === thread.id); if (i >= 0) this.threads[i] = thread; else this.threads.unshift(thread);
      this.threads.sort((a, b) => b.updatedAt - a.updatedAt);
      if (open && msg && !this.msgs.some(x => x.id === msg.id)) { this.msgs.push(msg); this.paintMsgs(true); }
      if (open && !msg) { this.paintHead(); this.paintMsgs(false); }   // (đổi trạng thái: tiêu đề + dòng "Đã xử lý")
      const mine = msg && (this.admin ? msg.admin : !msg.admin);
      if (msg && !mine && !open) {
        sound.play('message');
        notice({ title: this.admin ? `${thread.ownerName} · ${KINDS[thread.kind].label}` : 'Admin đã trả lời bạn', text: msg.text ? msg.text.slice(0, 90) : 'Đã gửi một ảnh', icon: this.admin ? KINDS[thread.kind].icon : 'chat', tone: 'msg', ms: 8000, onClick: () => this.open(thread.id) });
      }
    }
    this.badge(); if (this.el) this.paintList();
  }

  // ---------- khung ----------
  toggle() { if (this.el) this.close(); else this.open(); }
  open(id = null) {
    if (!this.el) this.build();
    this.refresh().then(() => { if (id) this.show(id); else if (!this.cur && !this.mobile()) { const first = this.list()[0]; if (first) this.show(first.id); else if (!this.admin) this.startNew(); else this.show(null); } });
  }
  mobile() { return matchMedia('(max-width: 760px)').matches; }
  build() {
    const el = this.el = document.createElement('div'); el.className = 'fb-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false'); el.setAttribute('aria-label', this.admin ? 'Hộp thư góp ý & báo lỗi' : 'Góp ý & báo lỗi');
    el.innerHTML = `<header class="fb-top"><b>${icon(this.admin ? 'inbox' : 'chat', 17)} ${this.admin ? 'Hộp thư góp ý & báo lỗi' : 'Góp ý & báo lỗi'}</b><button type="button" class="sx-x fb-x" aria-label="Đóng (Esc)">${icon('close', 15)}</button></header>
      <div class="fb-body"><aside class="fb-side">
        ${this.admin ? `<div class="sx-tabs fb-filter" role="tablist">${[['open', 'Chưa xử lý'], ['all', 'Tất cả'], ['bug', 'Báo lỗi'], ['idea', 'Góp ý']].map(([k, l]) => `<button type="button" role="tab" data-f="${k}" class="${this.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>`
          : `<button type="button" class="sx-primary fb-new">${icon('plus', 15)} Cuộc mới</button>`}
        <ul class="fb-list" role="listbox" aria-label="Các cuộc trò chuyện"></ul></aside>
      <section class="fb-main" aria-live="polite"></section></div>`;
    document.getElementById('appRoot').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show')); document.getElementById('btnFb')?.classList.add('on');
    el.querySelector('.fb-x').onclick = () => this.close();
    el.querySelector('.fb-new')?.addEventListener('click', () => this.startNew());
    el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { this.filter = b.dataset.f; el.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x === b)); this.paintList(); });
    this.onEsc = e => { if (e.key !== 'Escape' || !this.el) return; if (this.el.querySelector('.fb-zoom')) { this.el.querySelector('.fb-zoom').remove(); } else this.close(); e.stopPropagation(); };
    window.addEventListener('keydown', this.onEsc, true);
    this.paintList(); this.paintMain();
  }
  close() {
    const el = this.el; if (!el) return; this.el = null; this.cur = null; this.newKind = null; this.draftImg = null;
    window.removeEventListener('keydown', this.onEsc, true);
    el.classList.remove('show'); setTimeout(() => el.remove(), 220); document.getElementById('btnFb')?.classList.remove('on');
  }
  list() {
    const f = this.filter;
    return this.threads.filter(t => f === 'all' ? true : f === 'open' ? t.status === 'open' : t.kind === f);
  }
  paintList() {
    const ul = this.el?.querySelector('.fb-list'); if (!ul) return;
    const rows = this.list();
    ul.innerHTML = rows.length ? rows.map(t => `<li><button type="button" role="option" data-id="${t.id}" class="fb-row${t.id === this.cur ? ' on' : ''}${t.unread ? ' unread' : ''}" aria-selected="${t.id === this.cur}">
        <span class="fb-ic ${t.kind}">${icon(KINDS[t.kind].icon, 16)}</span>
        <span class="fb-rt"><span class="fb-r1"><b>${esc(this.admin ? t.ownerName : KINDS[t.kind].label)}</b><time>${when(t.updatedAt)}</time></span>
        <span class="fb-r2">${t.lastBy === 'admin' && !this.admin ? '<em>Admin:</em> ' : ''}${esc(t.preview)}</span>
        <span class="fb-r3">${this.admin ? `<i class="fb-chip ${t.kind}">${KINDS[t.kind].label}</i>` : ''}<i class="fb-st ${t.status}">${t.status === 'done' ? 'Đã xử lý' : 'Đang mở'}</i>${t.unread ? '<i class="fb-dot" aria-label="Có tin mới"></i>' : ''}</span></span></button></li>`).join('')
      : `<li class="fb-empty">${icon(this.admin ? 'inbox' : 'chat', 26)}<span>${this.admin ? (this.filter === 'open' ? 'Không còn góp ý nào chờ xử lý.' : 'Chưa có cuộc nào.') : 'Bạn chưa gửi góp ý / báo lỗi nào.'}</span></li>`;
    ul.querySelectorAll('[data-id]').forEach(b => b.onclick = () => this.show(+b.dataset.id));
  }

  // ---------- khung chat ----------
  async show(id) {
    this.cur = id; this.newKind = null; this.msgs = []; this.draftImg = null;
    this.el?.classList.toggle('in-chat', !!id);
    this.paintList(); this.paintMain();
    if (!id) return;
    const r = await api('GET', `/api/feedback/${id}`);
    if (this.cur !== id || !this.el) return;
    if (!r.ok) { toast(r.error, true); this.show(null); return; }
    this.msgs = r.messages; const i = this.threads.findIndex(t => t.id === id); if (i >= 0) this.threads[i] = r.thread;
    this.badge(); this.paintList(); this.paintHead(); this.paintMsgs(false);
  }
  startNew() { this.cur = null; this.newKind = 'pick'; this.draftImg = null; this.el?.classList.add('in-chat'); this.paintList(); this.paintMain(); }
  thread() { return this.threads.find(t => t.id === this.cur); }
  paintMain() {
    const m = this.el?.querySelector('.fb-main'); if (!m) return;
    if (this.newKind === 'pick' || KINDS[this.newKind]) {
      const k = this.newKind;
      m.innerHTML = `<header class="fb-head"><button type="button" class="sx-icon fb-back" aria-label="Quay lại">${icon('back', 16)}</button><div><b>Gửi cho Admin</b><small>Admin đọc và trả lời ngay trong khung này</small></div></header>
        <div class="fb-msgs fb-pick"><p class="fb-ask">Bạn muốn gửi gì?</p><div class="fb-kinds" role="radiogroup" aria-label="Loại">${Object.entries(KINDS).map(([key, x]) => `<button type="button" role="radio" aria-checked="${k === key}" data-kind="${key}" class="fb-kind ${key}${k === key ? ' on' : ''}"><span class="fb-ic ${key}">${icon(x.icon, 22)}</span><b>${x.label}</b><small>${x.hint}</small></button>`).join('')}</div></div>
        ${this.composer(KINDS[k] ? `Viết ${KINDS[k].label.toLowerCase()} của bạn…` : 'Chọn Góp ý hoặc Báo lỗi trước', !KINDS[k])}`;
      m.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { this.newKind = b.dataset.kind; const ta = m.querySelector('textarea'), keep = ta?.value || ''; const img = this.draftImg; this.paintMain(); this.draftImg = img; this.paintDraft(); const t2 = m.querySelector('textarea'); t2.value = keep; t2.focus(); });
    } else if (!this.cur) {
      m.innerHTML = `<div class="fb-blank">${icon(this.admin ? 'inbox' : 'chat', 34)}<b>${this.admin ? 'Chọn một cuộc để đọc và trả lời' : 'Góp ý hoặc báo lỗi cho Admin'}</b><span>${this.admin ? 'Tin mới từ nhân viên hiện ở danh sách bên trái.' : 'Bấm "Cuộc mới" để bắt đầu.'}</span></div>`;
      return;
    } else {
      m.innerHTML = `<header class="fb-head"></header><div class="fb-msgs" tabindex="0" aria-label="Tin nhắn"><div class="fb-load">Đang tải…</div></div>${this.composer('Nhắn tin…', false)}`;
      this.paintHead();
    }
    this.wireComposer(m);
  }
  composer(ph, off) {
    return `<form class="fb-form${off ? ' off' : ''}" novalidate><div class="fb-draft" hidden></div>
      <div class="fb-row2"><label class="sx-icon fb-attach" title="Gửi ảnh (hoặc dán / kéo thả ảnh vào đây)" aria-label="Gửi ảnh"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden ${off ? 'disabled' : ''}>${icon('image', 17)}</label>
      <textarea rows="1" maxlength="${TEXT_MAX}" placeholder="${esc(ph)}" aria-label="Nội dung" ${off ? 'disabled' : ''}></textarea>
      <button type="submit" class="sx-primary fb-send" aria-label="Gửi" ${off ? 'disabled' : ''}>${icon('send', 15)}<span>Gửi</span></button></div></form>`;
  }
  paintHead() {
    const h = this.el?.querySelector('.fb-head'); const t = this.thread(); if (!h || !t || this.newKind) return;
    h.innerHTML = `<button type="button" class="sx-icon fb-back" aria-label="Quay lại">${icon('back', 16)}</button>
      <div><b><span class="fb-ic ${t.kind} sm">${icon(KINDS[t.kind].icon, 13)}</span>${esc(this.admin ? t.ownerName : KINDS[t.kind].label)}</b><small>${this.admin ? `${KINDS[t.kind].label} · ` : ''}bắt đầu ${dayLine(t.createdAt).toLowerCase()} · <i class="fb-st ${t.status}">${t.status === 'done' ? 'Đã xử lý' : 'Đang mở'}</i></small></div>
      <span class="fb-acts">${t.status === 'open' ? `<button type="button" class="sx-ghost" data-st="done">${icon('check', 14)}<span>${this.admin ? 'Đã xử lý' : 'Đóng'}</span></button>` : this.admin ? `<button type="button" class="sx-ghost" data-st="open">${icon('undo', 14)}<span>Mở lại</span></button>` : ''}
      ${this.admin ? `<button type="button" class="sx-icon fb-del" aria-label="Xoá cuộc trò chuyện" title="Xoá">${icon('trash', 15)}</button>` : ''}</span>`;
    h.querySelector('.fb-back').onclick = () => this.back();
    h.querySelector('[data-st]')?.addEventListener('click', async e => { const st = e.currentTarget.dataset.st; e.currentTarget.disabled = true; const r = await api('PUT', `/api/feedback/${t.id}`, { status: st }); if (!r.ok) { toast(r.error, true); e.currentTarget.disabled = false; return; } this.onPush({ thread: r.thread }); toast(st === 'done' ? 'Đã đánh dấu đã xử lý.' : 'Đã mở lại.'); });
    h.querySelector('.fb-del')?.addEventListener('click', async () => { if (!(await confirmDanger('Xoá cuộc trò chuyện?', 'Xoá vĩnh viễn mọi tin nhắn và ảnh của cuộc này. Không hoàn tác được.', 'Xoá'))) return; const r = await api('DELETE', `/api/feedback/${t.id}`); if (!r.ok) return toast(r.error, true); this.onPush({ thread: { id: t.id, removed: true } }); });
  }
  back() { this.cur = null; this.newKind = null; this.el?.classList.remove('in-chat'); this.paintList(); if (this.mobile()) return; const f = this.list()[0]; if (f) this.show(f.id); else this.paintMain(); }
  paintMsgs(animate) {
    const box = this.el?.querySelector('.fb-msgs'); const t = this.thread(); if (!box || !t) return;
    const nearEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    let day = '';
    box.innerHTML = this.msgs.map((m, i) => {
      const mine = this.admin ? m.admin : !m.admin, d = dayLine(m.ts), sep = d !== day ? `<div class="fb-day"><span>${d}</span></div>` : ''; day = d;
      const prev = this.msgs[i - 1], cont = prev && prev.by === m.by && m.ts - prev.ts < 5 * 60e3 && dayLine(prev.ts) === d;
      return `${sep}<div class="fb-msg${mine ? ' me' : ''}${cont ? ' cont' : ''}${animate && i === this.msgs.length - 1 ? ' new' : ''}">${!mine && !cont ? `<span class="fb-who">${esc(m.admin ? 'Admin' : m.byName)}</span>` : ''}
        <div class="fb-bub">${m.image ? `<button type="button" class="fb-img" data-src="${esc(m.image)}" aria-label="Xem ảnh lớn"><img src="${esc(m.image)}" alt="Ảnh đính kèm" loading="lazy" decoding="async"></button>` : ''}${m.text ? `<p>${esc(m.text)}</p>` : ''}<time>${hm(m.ts)}</time></div></div>`;
    }).join('') + (t.status === 'done' ? `<div class="fb-done">${icon('check', 14)} ${this.admin ? 'Đã đánh dấu đã xử lý — nhân viên nhắn tiếp thì tự mở lại.' : 'Admin đã xử lý. Nhắn tiếp nếu vẫn còn vấn đề.'}</div>` : '');
    box.querySelectorAll('.fb-img').forEach(b => b.onclick = () => this.zoom(b.dataset.src));
    const last = this.msgs.at(-1), lastMine = last && (this.admin ? last.admin : !last.admin);
    if (!animate || nearEnd || lastMine) box.scrollTop = box.scrollHeight;   // (đang đọc tin cũ ở trên: không kéo xuống khi bên kia nhắn)
    box.querySelectorAll('img').forEach(im => im.addEventListener('load', () => { if (box.scrollHeight - box.scrollTop - box.clientHeight < 240) box.scrollTop = box.scrollHeight; }, { once: true }));
  }
  zoom(src) {
    const z = document.createElement('div'); z.className = 'fb-zoom'; z.innerHTML = `<img src="${esc(src)}" alt="Ảnh đính kèm"><button type="button" class="sx-x" aria-label="Đóng">${icon('close', 15)}</button>`;
    z.onclick = () => z.remove(); this.el.appendChild(z);
  }

  // ---------- soạn tin ----------
  wireComposer(m) {
    const f = m.querySelector('.fb-form'); if (!f) return;
    const ta = f.querySelector('textarea'), file = f.querySelector('input[type=file]');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } });
    const take = async fl => { if (!fl || f.classList.contains('off')) return; try { this.draftImg = await readImage(fl); this.paintDraft(); ta.focus(); } catch (e) { toast(e.message, true); } };
    file.onchange = () => { take(file.files[0]); file.value = ''; };
    ta.addEventListener('paste', e => { const it = [...(e.clipboardData?.items || [])].find(x => x.kind === 'file' && x.type.startsWith('image/')); if (it) { e.preventDefault(); take(it.getAsFile()); } });
    m.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); m.classList.add('drop'); } });
    m.addEventListener('dragleave', e => { if (!m.contains(e.relatedTarget)) m.classList.remove('drop'); });
    m.addEventListener('drop', e => { m.classList.remove('drop'); const fl = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/')); if (fl) { e.preventDefault(); take(fl); } });
    f.onsubmit = async e => {
      e.preventDefault(); if (f.classList.contains('off') || this.sending) return;
      const text = ta.value.trim(), img = this.draftImg;
      if (!text && !img) { ta.focus(); return; }
      this.sending = true; const btn = f.querySelector('.fb-send'); btn.disabled = true; f.classList.add('busy');
      const body = { text, image: img ? { type: img.type, data: img.data } : undefined };
      const creating = !this.cur, r = creating ? await api('POST', '/api/feedback', { kind: this.newKind, ...body }) : await api('POST', `/api/feedback/${this.cur}/messages`, body);
      this.sending = false; btn.disabled = false; f.classList.remove('busy');
      if (!r.ok) { toast(r.error, true); return; }
      ta.value = ''; grow(); this.draftImg = null; this.paintDraft();
      if (creating) {
        this.threads = [r.thread, ...this.threads.filter(t => t.id !== r.thread.id)];
        toast(`Đã gửi ${KINDS[r.thread.kind].label.toLowerCase()} cho Admin. Cảm ơn bạn!`);
        await this.show(r.thread.id);
      } else { this.onPush({ thread: r.thread, msg: r.msg }); }
      this.el?.querySelector('.fb-form textarea')?.focus();
    };
    if (!this.mobile() && !f.classList.contains('off')) setTimeout(() => { if (!f.contains(document.activeElement)) ta.focus({ preventScroll: true }); }, 60);
  }
  paintDraft() {
    const d = this.el?.querySelector('.fb-draft'); if (!d) return;
    const im = this.draftImg; d.hidden = !im;
    d.innerHTML = im ? `<img src="${im.url}" alt="Ảnh sẽ gửi"><span>Ảnh đính kèm</span><button type="button" class="sx-icon" aria-label="Bỏ ảnh">${icon('close', 13)}</button>` : '';
    d.querySelector('button')?.addEventListener('click', () => { this.draftImg = null; this.paintDraft(); });
  }
}
