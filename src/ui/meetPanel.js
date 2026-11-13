// Cửa sổ "Phòng họp": 3 thẻ —
//  • Lịch phòng: chọn ngày (14 ngày tới), dòng thời gian 07:00–21:00 theo khung 30 phút; ô đã đặt hiện tên cuộc họp + host;
//    bấm ô trống để đặt (giờ bắt đầu điền sẵn). Đường đỏ = bây giờ.
//  • Cuộc họp của tôi: sắp tới / đang diễn ra — vào phòng, sửa, huỷ (host).
//  • Folder của tôi: mọi cuộc họp mình đặt / được mời (cả đã qua) — tài liệu (tải lên / tải về), bảng vẽ (xem lại, lưu PNG),
//    chat của cuộc họp.
// Đặt / sửa: tên, ngày, giờ bắt đầu – kết thúc (chỉ giờ còn trống), người tham dự (tìm theo tên / mã / phòng ban, thêm cả
// phòng ban), nội dung. Server kiểm tra lại mọi thứ (trùng lịch, giờ mở cửa, quyền).
import { api } from '../net/api.js';
import { esc, confirmDanger } from '../session/ui.js';
import { icon } from './icons.js';
import { overlayOn, overlayOff } from './overlay.js';
import { ExcaliBoard } from './excaliBoard.js';
import { DatePicker } from './datePicker.js';
import { hm, dayLabel, EARLY } from '../session/meetings.js';

const VN = 7 * 3600e3, DAY = 86400e3, SLOT = 30 * 60e3, ROW = 30;
const dayStart = t => Math.floor((t + VN) / DAY) * DAY - VN;
const fmtDate = t => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(t);
const fmtSize = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const initials = name => String(name || '?').replace(/^\d{4}-/, '').replace(/^CEO \((.*)\)$/, '$1').split(/\s+/).filter(Boolean).slice(-2).map(w => w[0]).join('').toUpperCase() || '?';
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const avatar = (key, name, cls = '') => `<span class="mt-av ${cls}" style="--h:${hue(key)}" title="${esc(name)}">${esc(initials(name))}</span>`;
const fileIcon = type => /^image\//.test(type) ? 'cube' : /pdf/.test(type) ? 'file' : /sheet|excel|csv/.test(type) ? 'grid' : /presentation|powerpoint/.test(type) ? 'play' : 'file';

/** Tải file lên tài liệu cuộc họp (đọc base64 trên máy, ≤ 5 MB / file). Trả về số file đã lưu. */
export async function uploadFiles(meetingId, files, toast, kind = 'file') {
  let ok = 0;
  for (const f of files) {
    if (f.size > 5 * 1024 * 1024) { toast(`"${f.name}" lớn hơn 5 MB — chưa tải lên.`, true); continue; }
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f); }).catch(() => null);
    if (data == null) { toast(`Không đọc được "${f.name}".`, true); continue; }
    const r = await api('POST', `/api/meetings/${meetingId}/files`, { name: f.name, data, kind });
    if (r.ok) ok++; else toast(r.error || `Chưa tải lên được "${f.name}".`, true);
  }
  if (ok) toast(ok === 1 ? 'Đã lưu tài liệu.' : `Đã lưu ${ok} tài liệu.`);
  return ok;
}
/** Danh sách tài liệu (dùng chung: phòng họp, folder). */
export function filesHtml(files, me, isHost) {
  if (!files.length) return `<div class="sx-empty sm">${icon('folder', 28)}<b>Chưa có tài liệu</b><span>Tải lên slide, biên bản, hình ảnh… (PDF, ảnh, Word, Excel, PowerPoint, txt — tối đa 5 MB / file). Mọi người trong cuộc họp đều xem được.</span></div>`;
  return `<ul class="mt-files">${files.map(f => `<li><span class="mt-fic ${f.kind === 'board' ? 'board' : ''}">${icon(f.kind === 'board' ? 'pen' : fileIcon(f.type), 17)}</span>
    <span class="mt-fn"><b title="${esc(f.name)}">${esc(f.name)}</b><small>${fmtSize(f.size)} · ${esc(f.byName.replace(/^\d{4}-/, ''))} · ${dayLabel(f.ts)} ${hm(f.ts)}</small></span>
    <a class="sx-icon" href="/api/meetings/{MID}/files/${f.id}" target="_blank" rel="noopener" title="Mở" aria-label="Mở ${esc(f.name)}">${icon('arrowRight', 15)}</a>
    <a class="sx-icon" href="/api/meetings/{MID}/files/${f.id}?dl=1" download="${esc(f.name)}" title="Tải về" aria-label="Tải ${esc(f.name)} về">${icon('download', 15)}</a>
    ${f.by === me || isHost ? `<button type="button" class="sx-icon danger" data-del="${f.id}" title="Xoá" aria-label="Xoá ${esc(f.name)}">${icon('trash', 15)}</button>` : ''}</li>`).join('')}</ul>`;
}

export class MeetPanel {
  constructor(ctl) { this.c = ctl; this.s = ctl.s; this.el = null; this.tab = 'book'; this.day = dayStart(Date.now()); this.people = null; }

  async open(tab = this.tab, arg = null) {
    if (this.el) { this.show(tab, arg); return; }
    const back = this.el = document.createElement('div'); back.className = 'sx-back';
    back.innerHTML = `<div class="sx mp" role="dialog" aria-modal="true" aria-labelledby="mpTitle">
      <header class="sx-h mp-h"><span class="sx-ic">${icon('calendar', 22)}</span><div><h2 id="mpTitle">Phòng họp</h2><p>Phòng họp tầng trệt · 5 ghế · đặt theo khung 30 phút (07:00–21:00)</p></div>
        <button type="button" class="sx-primary mp-new">${icon('plus', 15)} Đặt phòng</button>
        <button type="button" class="sx-x" aria-label="Đóng">${icon('close', 16)}</button></header>
      <nav class="sx-tabs" role="tablist">${[['book', 'calendar', 'Lịch phòng'], ['mine', 'users', 'Cuộc họp của tôi'], ['folder', 'folder', 'Folder của tôi']].map(([k, ic, n]) => `<button type="button" role="tab" data-tab="${k}">${icon(ic, 15)} ${n}</button>`).join('')}</nav>
      <div class="sx-body mp-body" tabindex="-1"></div></div>`;
    document.body.appendChild(back); overlayOn();
    requestAnimationFrame(() => back.classList.add('show'));
    back.addEventListener('click', e => { if (e.target === back) this.close(); });
    back.querySelector('.sx-x').onclick = () => this.close();
    back.querySelector('.mp-new').onclick = () => this.form();
    back.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => this.show(b.dataset.tab));
    this._key = e => { if (!this.el || document.querySelector('.modal-back')) return; if (e.key === 'Escape') { e.preventDefault(); if (this.sub) this.show(this.tab); else this.close(); } if (!this.el?.contains(e.target)) e.stopPropagation(); };   // (phím trong ô nhập của panel vẫn tới ô nhập: Enter / mũi tên ở ô tìm người)
    window.addEventListener('keydown', this._key, true);
    // tới giờ mở phòng / bắt đầu / hết giờ: thẻ "Cuộc họp của tôi" tự đổi nút (không phải đóng mở lại)
    this.clock = setInterval(() => { if (this.tab === 'mine' && !this.sub && this.mineList) this.paintMine(); }, 15000);
    this.show(tab, arg);
  }
  close() {
    const el = this.el; if (!el) return; this.el = null; this.sub = null; clearInterval(this.clock);
    this.wb?.destroy(); this.wb = null;
    window.removeEventListener('keydown', this._key, true); overlayOff();
    el.classList.remove('show'); setTimeout(() => el.remove(), 200);
  }
  get body() { return this.el?.querySelector('.mp-body'); }
  show(tab, arg = null) {
    this.tab = tab; this.sub = null; this.wb?.destroy(); this.wb = null;
    this.el.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    this.body.scrollTop = 0;
    if (tab === 'book') this.renderBook(); else if (tab === 'mine') this.renderMine(); else if (arg) this.detail(arg); else this.renderFolder();
  }
  /** Lịch vừa đổi (server báo): vẽ lại thẻ đang xem nếu không đang điền form. */
  refresh() { if (!this.el || this.sub) return; if (this.tab === 'book') this.renderBook(); else if (this.tab === 'mine') this.renderMine(); }

  // ---------- lịch phòng ----------
  async renderBook() {
    const body = this.body, from = this.day, to = from + DAY;
    const days = Array.from({ length: 14 }, (_, i) => dayStart(Date.now()) + i * DAY);
    body.innerHTML = `<div class="mp-days" role="tablist" aria-label="Chọn ngày">${days.map(d => `<button type="button" data-day="${d}" class="${d === from ? 'on' : ''}"><small>${new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short' }).format(d)}</small><b>${new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: 'numeric' }).format(d)}</b></button>`).join('')}</div>
      <div class="mp-dayname">${esc(fmtDate(from))}</div><div class="mp-tl" aria-busy="true"></div>`;
    body.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { this.day = +b.dataset.day; this.renderBook(); });
    { const strip = body.querySelector('.mp-days'), on = strip.querySelector('.on'); if (on) strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.offsetWidth / 2; }   // (không dùng scrollIntoView: nó cuộn cả khung hộp thoại)
    const r = await api('GET', `/api/meetings?from=${from}&to=${to}`); if (!this.el || this.tab !== 'book' || this.day !== from) return;
    const list = r.ok ? r.meetings : [], now = Date.now(), open = from + 7 * 3600e3, close = from + 21 * 3600e3, n = (close - open) / SLOT;
    const tl = body.querySelector('.mp-tl'); tl.removeAttribute('aria-busy');
    tl.style.height = `${n * ROW}px`;
    let html = '';
    for (let i = 0; i < n; i++) {
      const t = open + i * SLOT, taken = list.some(m => m.start < t + SLOT && m.end > t), past = t + SLOT <= now;
      html += `<div class="mp-slot${i % 2 ? '' : ' hour'}" style="top:${i * ROW}px">${i % 2 ? '' : `<span class="mp-hr">${hm(t)}</span>`}${taken ? '' : past ? '<span class="mp-free past"></span>' : `<button type="button" class="mp-free" data-t="${t}" aria-label="Đặt phòng lúc ${hm(t)}"><span>${icon('plus', 13)} Đặt lúc ${hm(t)}</span></button>`}</div>`;
    }
    for (const m of list) {
      const top = (Math.max(m.start, open) - open) / SLOT * ROW, h = (Math.min(m.end, close) - Math.max(m.start, open)) / SLOT * ROW;
      html += `<button type="button" class="mp-bk${m.invited ? ' mine' : ''}${m.open ? ' live' : ''}" style="top:${top}px;height:${h - 3}px" data-m="${m.id}">
        <b>${esc(m.title)}</b><small>${hm(m.start)}–${hm(m.end)} · ${esc(m.hostName.replace(/^\d{4}-/, ''))}${m.open && m.start <= now ? ' · <em>đang họp</em>' : ''}</small></button>`;
    }
    if (now > open && now < close) html += `<i class="mp-now" style="top:${(now - open) / SLOT * ROW}px" aria-hidden="true"></i>`;
    tl.innerHTML = html;
    tl.querySelectorAll('[data-t]').forEach(b => b.onclick = () => this.form(null, +b.dataset.t));
    tl.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const m = list.find(x => x.id === +b.dataset.m); if (m?.invited) this.detail(m.id); else this.s.toast(`${m.title} · ${hm(m.start)}–${hm(m.end)} · đặt bởi ${m.hostName}`); });
    if (from === dayStart(now) && now > open) { const top = tl.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop; body.scrollTop = Math.max(0, top + (now - open) / SLOT * ROW - body.clientHeight / 3); }   // (hôm nay: giờ hiện tại ở khoảng 1/3 khung)
  }

  // ---------- cuộc họp của tôi ----------
  async renderMine() {
    const body = this.body; if (!this.mineList) body.innerHTML = '<div class="sx-loading">Đang tải…</div>';
    const r = await api('GET', '/api/meetings/mine'); if (!this.el || this.tab !== 'mine' || this.sub) return;
    this.mineList = r.meetings || []; this.mineSig = null; this.paintMine();
  }
  /** Vẽ thẻ từ danh sách đã tải (đồng hồ gọi lại mỗi 15 giây — chỉ vẽ lại khi trạng thái một thẻ đổi). */
  paintMine() {
    const body = this.body, now = Date.now(), list = this.mineList.filter(m => m.end > now).sort((a, b) => a.start - b.start);
    const sig = list.map(m => `${m.id}:${this.state(m, now)}`).join('|'); if (sig === this.mineSig) return; this.mineSig = sig;
    body.innerHTML = list.length ? `<div class="mp-cards">${list.map(m => this.card(m, now)).join('')}</div>`
      : `<div class="sx-empty">${icon('calendar', 34)}<b>Chưa có cuộc họp nào sắp tới</b><span>Đặt phòng rồi mời đồng nghiệp — tới giờ mọi người sẽ được nhắn để tới phòng.</span><button type="button" class="sx-primary" data-new>${icon('plus', 15)} Đặt phòng họp</button></div>`;
    body.querySelector('[data-new]')?.addEventListener('click', () => this.form());
    this.bindCards(body, list);
  }
  /** live: đang họp · open: phòng đã mở (10 phút trước giờ) · later: chưa tới giờ mở phòng. Tính theo giờ hiện tại, không theo lúc tải. */
  state(m, now) { return m.start <= now && now < m.end ? 'live' : now >= m.start - EARLY ? 'open' : 'later'; }
  card(m, now) {
    const st = this.state(m, now), live = st === 'live', opensAt = hm(m.start - EARLY);
    return `<article class="mp-card${live ? ' live' : ''}">
      <div class="mp-when"><b>${hm(m.start)}</b><small>${hm(m.end)}</small><em>${esc(dayLabel(m.start))}</em></div>
      <div class="mp-ci"><div class="mp-ct"><b>${esc(m.title)}</b>${live ? '<span class="chip live">Đang diễn ra</span>' : st === 'open' ? '<span class="chip soon">Sắp bắt đầu · phòng đã mở</span>' : `<span class="chip wait">${icon('clock', 11)} Mở phòng lúc ${opensAt}${dayStart(m.start) === dayStart(now) ? '' : ` · ${esc(dayLabel(m.start))}`}</span>`}${m.isHost ? '<span class="chip">Bạn là host</span>' : ''}</div>
        <small>${icon('door', 12)} ${esc(m.roomName)} · host ${esc(m.hostName)}</small>
        <div class="mp-avs">${avatar(m.host, m.hostName, 'host')}${(m.invitees || []).slice(0, 7).map(p => avatar(p.key, p.name)).join('')}${(m.invitees || []).length > 7 ? `<span class="mt-av more">+${m.invitees.length - 7}</span>` : ''}</div>
        ${m.agenda ? `<p class="mp-ag">${esc(m.agenda.slice(0, 160))}${m.agenda.length > 160 ? '…' : ''}</p>` : ''}
        <div class="mp-acts">${st !== 'later' ? `<button type="button" class="sx-primary" data-join="${m.id}">${icon('door', 14)} Vào phòng</button>` : `<button type="button" class="sx-primary" disabled title="Phòng mở 10 phút trước giờ họp">${icon('door', 14)} Vào phòng · ${opensAt}</button>`}
          <button type="button" class="sx-ghost" data-open="${m.id}">${icon('folder', 14)} Tài liệu</button>
          ${m.isHost && live ? `<button type="button" class="sx-ghost danger" data-end="${m.id}">${icon('stop', 13)} Kết thúc sớm</button>` : m.isHost ? `<button type="button" class="sx-ghost" data-edit="${m.id}">${icon('edit', 14)} Sửa</button><button type="button" class="sx-ghost danger" data-cancel="${m.id}">${icon('trash', 14)} Huỷ</button>` : ''}</div></div></article>`;
  }
  bindCards(root, list) {
    const find = id => list.find(m => m.id === +id);
    root.querySelectorAll('[data-join]').forEach(b => b.onclick = () => { this.close(); this.c.goJoin(find(b.dataset.join)); });
    root.querySelectorAll('[data-open]').forEach(b => b.onclick = () => this.detail(+b.dataset.open));
    root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => this.form(find(b.dataset.edit)));
    root.querySelectorAll('[data-end]').forEach(b => b.onclick = async () => {
      const m = find(b.dataset.end);
      if (!(await confirmDanger('Kết thúc cuộc họp?', `"${m.title}" kết thúc ngay — mọi người rời phòng, phòng trống cho lịch khác. Dữ liệu vẫn lưu trong folder.`, 'Kết thúc họp'))) return;
      const r = await api('POST', `/api/meetings/${m.id}/end`); if (r.ok) { this.s.toast('Đã kết thúc cuộc họp.'); this.c.loadSched(); this.c.loadMine(); this.show(this.tab); } else this.s.toast(r.error, true);
    });
    root.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
      const m = find(b.dataset.cancel);
      if (!(await confirmDanger('Huỷ cuộc họp?', `"${m.title}" (${hm(m.start)}–${hm(m.end)}) sẽ bị huỷ và mọi người được báo.`, 'Huỷ cuộc họp'))) return;
      const r = await api('DELETE', `/api/meetings/${m.id}`); if (r.ok) { this.s.toast('Đã huỷ cuộc họp.'); this.c.loadSched(); this.c.loadMine(); this.show(this.tab); } else this.s.toast(r.error, true);
    });
  }

  // ---------- folder ----------
  async renderFolder() {
    const body = this.body; body.innerHTML = '<div class="sx-loading">Đang tải…</div>';
    const r = await api('GET', '/api/meetings/mine'); if (!this.el || this.tab !== 'folder' || this.sub) return;
    const now = Date.now(), list = r.meetings || [];
    if (!list.length) { body.innerHTML = `<div class="sx-empty">${icon('folder', 34)}<b>Folder trống</b><span>Mỗi cuộc họp bạn đặt hoặc được mời có một thư mục: tài liệu, bảng vẽ và chat của cuộc họp đó.</span></div>`; return; }
    const groups = new Map();
    for (const m of list) { const k = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', month: 'long', year: 'numeric' }).format(m.start); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
    body.innerHTML = [...groups].map(([k, ms]) => `<div class="nb-sec">${esc(k)}</div><div class="mp-folders">${ms.map(m => `<button type="button" class="mp-fd" data-id="${m.id}">
      <span class="mp-fdic">${icon('folder', 22)}</span><span class="mp-fdt"><b>${esc(m.title)}</b><small>${esc(dayLabel(m.start))} · ${hm(m.start)}–${hm(m.end)}${m.past ? '' : m.start <= now ? ' · <em>đang diễn ra</em>' : ' · sắp tới'}</small></span>
      <span class="mp-fdn">${icon('file', 13)} ${m.files || 0}</span></button>`).join('')}</div>`).join('');
    body.querySelectorAll('[data-id]').forEach(b => b.onclick = () => this.detail(+b.dataset.id));
  }
  async detail(id, sub = 'files') {
    if (this.tab !== 'folder') { this.tab = 'folder'; this.el.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === 'folder')); }
    this.sub = 'detail'; this.wb?.destroy(); this.wb = null;
    const body = this.body; body.innerHTML = '<div class="sx-loading">Đang tải…</div>';
    const r = await api('GET', `/api/meetings/${id}`);
    if (!this.el || this.sub !== 'detail') return;
    if (!r.ok) { body.innerHTML = `<div class="sx-empty">${icon('folder', 30)}<b>Không mở được</b><span>${esc(r.error || '')}</span></div>`; return; }
    const m = r.meeting, me = this.s.key, now = Date.now();
    body.innerHTML = `<div class="mp-det">
      <button type="button" class="sx-back-link">${icon('chevLeft', 15)} Folder của tôi</button>
      <div class="mp-dh"><span class="mp-fdic big">${icon('folder', 26)}</span><div><h3>${esc(m.title)}</h3>
        <small>${esc(fmtDate(m.start))} · ${hm(m.start)}–${hm(m.end)} · ${esc(m.roomName)}</small>
        <div class="mp-avs">${avatar(m.host, m.hostName, 'host')}${(m.invitees || []).map(p => avatar(p.key, p.name)).join('')}</div></div>
        ${m.open ? `<button type="button" class="sx-primary" data-join>${icon('door', 14)} Vào phòng</button>` : ''}</div>
      ${m.agenda ? `<p class="mp-ag full">${esc(m.agenda).replace(/\n/g, '<br>')}</p>` : ''}
      <nav class="mp-sub" role="tablist">${[['files', 'file', `Tài liệu (${r.files.length})`], ['board', 'pen', 'Bảng vẽ'], ['chat', 'chat', `Chat (${r.chat.length})`]].map(([k, ic, n]) => `<button type="button" data-sub="${k}" class="${k === sub ? 'on' : ''}">${icon(ic, 14)} ${n}</button>`).join('')}</nav>
      <div class="mp-subbody"></div>
      <div class="mp-danger">${m.isHost || this.s.isAdmin ? `<button type="button" class="sx-ghost danger" data-purge>${icon('trash', 14)} Xoá cuộc họp &amp; toàn bộ dữ liệu</button><small>Xoá tài liệu, bảng vẽ, chat của cuộc họp với mọi người. Không hoàn tác được.</small>` : `<button type="button" class="sx-ghost danger" data-hide>${icon('trash', 14)} Xoá khỏi folder của tôi</button><small>Chỉ ẩn khỏi folder của bạn — người khác vẫn xem được.</small>`}</div></div>`;
    body.querySelector('.sx-back-link').onclick = () => this.show('folder');
    body.querySelector('[data-join]')?.addEventListener('click', () => { this.close(); this.c.goJoin(m); });
    body.querySelector('[data-purge]')?.addEventListener('click', async () => {
      if (!(await confirmDanger('Xoá cuộc họp và toàn bộ dữ liệu?', `"${m.title}": mọi tài liệu, bảng vẽ và tin nhắn của cuộc họp sẽ bị xoá với tất cả mọi người. Không hoàn tác được.`, 'Xoá vĩnh viễn'))) return;
      const x = await api('DELETE', `/api/meetings/${m.id}/data`); if (!x.ok) { this.s.toast(x.error, true); return; }
      this.s.toast('Đã xoá cuộc họp và dữ liệu.'); this.c.loadSched(); this.c.loadMine(); this.show('folder');
    });
    body.querySelector('[data-hide]')?.addEventListener('click', async () => {
      if (!(await confirmDanger('Xoá khỏi folder của bạn?', `"${m.title}" sẽ không còn trong folder của bạn. Người khác trong cuộc họp vẫn xem được.`, 'Xoá khỏi folder'))) return;
      const x = await api('POST', `/api/meetings/${m.id}/hide`); if (!x.ok) { this.s.toast(x.error, true); return; }
      this.s.toast('Đã xoá khỏi folder của bạn.'); this.c.loadMine(); this.show('folder');
    });
    const sb = body.querySelector('.mp-subbody');
    const showSub = k => {
      body.querySelectorAll('[data-sub]').forEach(b => b.classList.toggle('on', b.dataset.sub === k));
      this.wb?.destroy(); this.wb = null;
      if (k === 'files') {
        sb.innerHTML = `<div class="mp-up"><label class="sx-ghost">${icon('upload', 14)} Tải tài liệu lên<input type="file" multiple hidden></label><span>PDF, ảnh, Word, Excel, PowerPoint, txt · tối đa 5 MB / file</span></div>${filesHtml(r.files, me, m.isHost).replaceAll('{MID}', m.id)}`;
        sb.querySelector('input[type=file]').onchange = async e => { const n = await uploadFiles(m.id, [...e.target.files], (t, b) => this.s.toast(t, b)); if (n) this.detail(m.id, 'files'); };
        sb.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!(await confirmDanger('Xoá tài liệu?', 'Mọi người trong cuộc họp sẽ không xem được file này nữa.', 'Xoá'))) return; const x = await api('DELETE', `/api/meetings/${m.id}/files/${b.dataset.del}`); if (x.ok) this.detail(m.id, 'files'); else this.s.toast(x.error, true); });
      } else if (k === 'board') {
        const live = r.board.elements.filter(e => !e.isDeleted).length, fname = `bang-ve-${m.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}`;
        sb.innerHTML = `<div class="mp-wbv"></div><div class="mp-wbf"><span>${live ? `${live} hình trên bảng · kéo để xem, cuộn để phóng to` : 'Bảng chưa có hình nào.'}</span><button type="button" class="sx-ghost" data-png${live ? '' : ' disabled'}>${icon('download', 14)} Lưu ảnh PNG</button></div>`;
        this.wb = new ExcaliBoard(sb.querySelector('.mp-wbv'), { meetingId: m.id, elements: r.board.elements, files: r.board.files, name: fname, open: true });
        sb.querySelector('[data-png]').onclick = async () => { const b = await this.wb.png().catch(() => null); if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${fname}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
      } else {
        sb.innerHTML = r.chat.length ? `<ol class="mt-chat ro">${r.chat.map(x => `<li class="${x.from === 'system' ? 'sys' : x.from === me ? 'me' : ''}"><div class="mt-cm"><b>${esc(x.name)}</b><time>${dayLabel(x.ts)} ${hm(x.ts)}</time></div><p>${esc(x.body)}</p></li>`).join('')}</ol>`
          : `<div class="sx-empty sm">${icon('chat', 28)}<b>Chưa có tin nhắn</b><span>Kênh chat riêng của cuộc họp mở khi mọi người vào phòng.</span></div>`;
      }
    };
    body.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => showSub(b.dataset.sub));
    showSub(sub);
    void now;
  }

  // ---------- đặt / sửa ----------
  async loadPeople() { if (this.people) return this.people; const r = await api('GET', '/api/people'); this.people = r.ok ? r.people : []; return this.people; }
  async form(m = null, startAt = null) {
    if (!this.el) { await this.open(this.tab); }
    this.sub = 'form'; this.wb?.destroy(); this.wb = null;
    const body = this.body; body.innerHTML = '<div class="sx-loading">Đang tải…</div>';
    const people = await this.loadPeople(), me = this.s.key, now = Date.now();
    const firstFree = () => { let t = Math.ceil(now / SLOT) * SLOT; for (let i = 0; i < 28 * 14; i++, t += SLOT) { const d = dayStart(t), h = (t - d) / 3600e3; if (h >= 7 && h < 21 && !this.c.sched.some(x => x.start < t + SLOT && x.end > t)) return t; } return Math.ceil(now / SLOT) * SLOT; };
    let start = m?.start || startAt || firstFree(), end = m?.end || start + 2 * SLOT;
    const picked = new Map((m?.invitees || []).map(p => [p.key, p.name]));
    const depts = [...new Set(people.map(p => p.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
    const DURS = [[SLOT, '30 phút'], [2 * SLOT, '1 giờ'], [3 * SLOT, '1,5 giờ'], [4 * SLOT, '2 giờ'], [6 * SLOT, '3 giờ'], [8 * SLOT, '4 giờ']];
    let dur = end - start;
    body.innerHTML = `<form class="mp-form" novalidate>
      <button type="button" class="sx-back-link">${icon('chevLeft', 15)} ${m ? 'Huỷ sửa' : 'Quay lại'}</button>
      <h3>${m ? 'Sửa cuộc họp' : 'Đặt phòng họp'}</h3>
      <section class="mp-pickt" aria-label="Chọn thời gian">
        <div class="mp-step"><span class="mp-n">1</span><b>Chọn ngày</b></div>
        <div class="mp-step"><span class="mp-n">2</span><b>Giờ bắt đầu</b><small class="mp-dayname2"></small></div>
        <div class="mp-cal"></div>
        <div class="mp-slots" role="listbox" aria-label="Giờ bắt đầu"></div>
        <div class="mp-durw"><div class="mp-step"><span class="mp-n">3</span><b>Thời lượng</b></div>
          <div class="mp-durs" role="radiogroup" aria-label="Thời lượng">${DURS.map(([v, n]) => `<button type="button" role="radio" data-dur="${v}">${n}</button>`).join('')}</div>
          <div class="mp-sum" aria-live="polite"></div></div>
      </section>
      <label class="sx-field"><span>Tên cuộc họp <i>*</i></span><input name="title" maxlength="120" required value="${esc(m?.title || '')}" placeholder="Ví dụ: Họp kế hoạch sprint 12"></label>
      <div class="sx-field"><span>Người tham dự <small>(${picked.size} người · tối đa 20)</small></span>
        <div class="mp-chips"><span class="mp-chip host">${avatar(me, this.s.me.employee?.display || 'CEO')} Bạn (host)</span></div>
        <div class="mp-pick"><input class="mp-q" placeholder="Tìm theo tên, mã hoặc phòng ban…" autocomplete="off" aria-label="Tìm người để mời">
          ${depts.length ? `<select class="mp-dept" aria-label="Mời cả phòng ban"><option value="">+ Mời cả phòng ban…</option>${depts.map(d => `<option>${esc(d)}</option>`).join('')}</select>` : ''}</div>
        <ul class="mp-res" role="listbox" hidden></ul></div>
      <label class="sx-field"><span>Nội dung / chương trình</span><textarea name="agenda" rows="3" maxlength="1000" placeholder="Mục tiêu, các ý cần bàn…">${esc(m?.agenda || '')}</textarea></label>
      <p class="sx-err" role="alert"></p>
      <div class="sx-acts"><button type="button" class="sx-ghost" data-cancel>Huỷ</button><button type="submit" class="sx-primary">${m ? 'Lưu thay đổi' : 'Đặt phòng & mời'}</button></div>
    </form>`;
    body.scrollTop = 0;
    const f = body.querySelector('form'), back = () => this.show(this.tab);
    body.querySelector('.sx-back-link').onclick = back; f.querySelector('[data-cancel]').onclick = back;
    f.querySelectorAll('input,textarea').forEach(x => x.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); }));
    // ---- chọn thời gian: lịch tháng → giờ bắt đầu → thời lượng ----
    let day = dayStart(start), dayList = [], monthList = [];
    const loadMonth = async () => { const r = await api('GET', `/api/meetings?from=${dayStart(now)}&to=${dayStart(now) + 31 * DAY}`); monthList = (r.meetings || []).filter(x => x.id !== m?.id); };
    const marks = () => { const mk = new Map(); for (const x of monthList) { const d = dayStart(x.start); mk.set(d, (mk.get(d) || 0) + 1); } return mk; };
    const taken = (a, b) => dayList.find(x => x.start < b && x.end > a);
    const close = day => day + 21 * 3600e3;
    const fits = (t, d) => t + d <= close(dayStart(t)) && d <= 8 * SLOT && !taken(t, t + d);
    const cal = new DatePicker(f.querySelector('.mp-cal'), { value: day, min: now, max: dayStart(now) + 29 * DAY, label: 'Ngày họp', onPick: d => { day = d; start = null; renderDay(); } });
    const renderDay = () => {
      dayList = monthList.filter(x => dayStart(x.start) === day);
      f.querySelector('.mp-dayname2').textContent = fmtDate(day).replace(/^./, c => c.toUpperCase());
      const parts = [['Sáng', 7, 12], ['Chiều', 12, 17], ['Tối', 17, 21]];
      const free = []; for (let t = day + 7 * 3600e3; t < close(day); t += SLOT) if (t + SLOT > now && !taken(t, t + SLOT)) free.push(t);
      if (start == null || !free.includes(start)) start = free[0] ?? null;
      f.querySelector('.mp-slots').innerHTML = free.length ? parts.map(([n, h0, h1]) => {
        const items = []; for (let t = day + h0 * 3600e3; t < day + h1 * 3600e3; t += SLOT) {
          const past = t + SLOT <= now, tk = taken(t, t + SLOT);
          if (past) continue;
          items.push(tk ? `<span class="mp-sl busy" title="${esc(tk.title)} · ${esc(tk.hostName)}">${hm(t)}<small>Đã đặt</small></span>`
            : `<button type="button" role="option" class="mp-sl${t === start ? ' on' : ''}" data-st="${t}" aria-selected="${t === start}">${hm(t)}</button>`);
        }
        return items.length ? `<div class="mp-slg"><div class="mp-slh">${n}</div><div class="mp-slw">${items.join('')}</div></div>` : '';
      }).join('') : `<div class="sx-empty sm">${icon('calendar', 26)}<b>Hết giờ trống</b><span>Chọn ngày khác trên lịch.</span></div>`;
      f.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { start = +b.dataset.st; renderDay(); });
      renderDur();
    };
    const renderDur = () => {
      const okDur = d => start != null && fits(start, d);
      if (!okDur(dur)) dur = [2 * SLOT, SLOT, 3 * SLOT, 4 * SLOT].find(okDur) ?? SLOT;
      f.querySelectorAll('[data-dur]').forEach(b => { const v = +b.dataset.dur, ok = okDur(v); b.disabled = !ok; b.classList.toggle('on', ok && v === dur); b.setAttribute('aria-checked', String(ok && v === dur)); b.title = ok ? '' : 'Trùng lịch khác hoặc quá 21:00'; });
      const sum = f.querySelector('.mp-sum');
      sum.innerHTML = start == null ? `<span class="muted">Chưa chọn giờ.</span>` : `${icon('clock', 16)}<span><b>${hm(start)} – ${hm(start + dur)}</b><small>${esc(fmtDate(day).replace(/^./, c => c.toUpperCase()))} · Phòng họp tầng trệt</small></span>`;
      f.querySelector('[type=submit]').disabled = start == null;
    };
    f.querySelectorAll('[data-dur]').forEach(b => b.onclick = () => { dur = +b.dataset.dur; renderDur(); });
    await loadMonth(); cal.setMarks(marks()); renderDay();
    // người tham dự
    const chips = f.querySelector('.mp-chips'), res = f.querySelector('.mp-res'), q = f.querySelector('.mp-q');
    const drawChips = () => {
      chips.querySelectorAll('.mp-chip:not(.host)').forEach(x => x.remove());
      for (const [k, n] of picked) { const c = document.createElement('span'); c.className = 'mp-chip'; c.innerHTML = `${avatar(k, n)} ${esc(n)} <button type="button" aria-label="Bỏ ${esc(n)}">${icon('close', 11)}</button>`; c.querySelector('button').onclick = () => { picked.delete(k); drawChips(); }; chips.appendChild(c); }
      f.querySelector('.sx-field small').textContent = `(${picked.size} người · tối đa 20)`;
    };
    const search = () => {
      const s = q.value.trim().toLowerCase().normalize('NFC');
      if (!s) { res.hidden = true; return; }
      const hits = people.filter(p => p.key !== me && !picked.has(p.key) && (`${p.name} ${p.code} ${p.department}`.toLowerCase().includes(s))).slice(0, 8);
      res.hidden = false;
      res.innerHTML = hits.length ? hits.map((p, i) => `<li role="option" data-k="${esc(p.key)}" class="${i ? '' : 'act'}">${avatar(p.key, p.name)}<span><b>${esc(p.name)}</b><small>${esc(p.department || '—')}${p.online ? ' · <em>đang online</em>' : ''}</small></span></li>`).join('') : '<li class="none">Không tìm thấy ai.</li>';
      res.querySelectorAll('[data-k]').forEach(li => li.onmousedown = e => { e.preventDefault(); add(li.dataset.k); });
    };
    const add = k => { const p = people.find(x => x.key === k); if (!p) return; if (picked.size >= 20) { this.s.toast('Mời tối đa 20 người.', true); return; } picked.set(k, p.name); q.value = ''; res.hidden = true; drawChips(); q.focus(); };
    q.oninput = search; q.onblur = () => setTimeout(() => { res.hidden = true; }, 120);
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const a = res.querySelector('.act'); if (a) add(a.dataset.k); } if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const lis = [...res.querySelectorAll('[data-k]')], i = lis.findIndex(x => x.classList.contains('act')), j = Math.max(0, Math.min(lis.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); lis.forEach((x, k) => x.classList.toggle('act', k === j)); } });
    f.querySelector('.mp-dept')?.addEventListener('change', e => { const d = e.target.value; e.target.value = ''; if (!d) return; for (const p of people) if (p.department === d && p.key !== me && picked.size < 20) picked.set(p.key, p.name); drawChips(); });
    drawChips();
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => f.title.focus({ preventScroll: true }), 30);   // (điện thoại: không tự bật bàn phím, giữ lịch ở trên cùng)
    f.onsubmit = async e => {
      e.preventDefault();
      const err = f.querySelector('.sx-err'), btn = f.querySelector('[type=submit]');
      if (!f.title.value.trim()) { err.textContent = 'Cần nhập tên cuộc họp.'; f.title.focus(); return; }
      if (start == null) { err.textContent = 'Chọn ngày và giờ bắt đầu.'; return; }
      const data = { title: f.title.value, agenda: f.agenda.value, start, end: start + dur, invitees: [...picked.keys()], room: 'MR1' };
      btn.disabled = true;
      const r = m ? await api('PATCH', `/api/meetings/${m.id}`, data) : await api('POST', '/api/meetings', data);
      btn.disabled = false;
      if (!r.ok) { err.textContent = r.error || 'Chưa đặt được.'; return; }
      this.s.toast(m ? 'Đã lưu lịch họp — mọi người được báo.' : `Đã đặt phòng ${hm(data.start)}–${hm(data.end)}${picked.size ? ` và mời ${picked.size} người` : ''}.`);
      this.c.loadSched(); this.c.loadMine();
      this.day = dayStart(data.start); this.show('mine');
    };
  }
}
