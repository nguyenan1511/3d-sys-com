// Bảng "Dự án" (src/session/projects.js mở; server: server/projects.js, routes/projects.js — docs/design/projects-workspace.md).
//  • Danh sách: thẻ dự án (màu, tên, mô tả, Trưởng dự án, việc của tôi / quá hạn / tin mới) — Đang làm · Đã lưu trữ; "+ Dự án mới".
//  • Một dự án: đầu trang (tên, mô tả, thành viên, "Vào phòng dự án", "Đặt họp", cuộc họp sắp tới) và các thẻ —
//    Công việc (Kanban 3 cột: kéo thả bằng chuột; cảm ứng: giữ một chút rồi kéo; "+ Thêm việc" ở mỗi cột; bấm thẻ → chi tiết:
//    cột, người làm, hạn chót, ưu tiên, mô tả, bình luận) · Chat (kênh riêng, gõ @ để nhắc tên) · Tài liệu (tải lên, tài liệu
//    từ các cuộc họp của dự án, xem bảng vẽ của phòng dự án) · Ghi chú (chung, tự lưu) · Thành viên · Cài đặt (Trưởng dự án).
//  • Mọi thay đổi của người khác tới ngay (server/projectHub.js) — bảng đang mở tự cập nhật.
import { api } from '../net/api.js';
import { esc, confirmDanger } from '../session/ui.js';
import { icon } from './icons.js';
import { overlayOn, overlayOff } from './overlay.js';
import { avatar, filesHtml, uploadFiles } from './meetPanel.js';
import { ExcaliBoard } from './excaliBoard.js';
import { DatePicker, vnDay } from './datePicker.js';
import { hm, dayLabel } from '../session/meetings.js';

const COLS = [['todo', 'Cần làm'], ['doing', 'Đang làm'], ['done', 'Xong']];
const PRIO = [[0, 'Bình thường'], [1, 'Cao'], [2, 'Gấp']];
const COLORS = ['#ef476f', '#ff8a5b', '#ffd166', '#06d6a0', '#118ab2', '#7b61ff', '#2b2d42', '#8d6e63'];
const DUE_H = 17;   // (hạn chót = 17:00 giờ VN của ngày chọn)
const short = n => String(n || '').replace(/^\d{4}-/, '');
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'vừa xong' : s < 3600 ? `${Math.floor(s / 60)} phút trước` : s < 86400 ? `${Math.floor(s / 3600)} giờ trước` : dayLabel(t); };
function dueInfo(t, done) {
  if (!t) return null;
  const now = Date.now(), d0 = vnDay(now), d = vnDay(t);
  const label = d === d0 ? `Hôm nay ${hm(t)}` : d === d0 + 86400e3 ? `Ngày mai ${hm(t)}` : d === d0 - 86400e3 ? 'Hôm qua' : (p => `${p.find(x => x.type === 'day').value}/${p.find(x => x.type === 'month').value}`)(new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).formatToParts(t));
  const cls = done ? 'ok' : t < now ? 'over' : t - now < 86400e3 ? 'soon' : '';
  return { label: cls === 'over' ? `Quá hạn · ${label}` : label, cls };
}

/** Logo dự án (ảnh vuông do Trưởng dự án tải lên) hoặc chữ cái đầu trên nền màu dự án. */
const logoUrl = p => `/api/projects/${p.id}/logo?v=${p.logoV}`;
export const projectMark = (p, cls = '') => p?.logoV ? `<span class="pj-mark has-logo ${cls}" style="--pc:${esc(p.color)}"><img src="${logoUrl(p)}" alt="" loading="lazy" decoding="async"></span>`
  : `<span class="pj-mark ${cls}" style="--pc:${esc(p?.color || '#8a8ca3')}">${esc(String(p?.name || '?').trim().slice(0, 1).toUpperCase())}</span>`;
// ---- ghi chú kiểu Notes (macOS): dòng đầu là tiêu đề, ☐/☑ danh sách việc, • gạch đầu dòng ----
const LIST_RE = /^(☐ |☑ |• |- )/;
const lines = b => String(b || '').split('\n');
const noteTitle = n => (lines(n.body).find(l => l.trim()) || '').replace(LIST_RE, '').trim().slice(0, 120) || 'Ghi chú mới';
const notePreview = n => { const ls = lines(n.body).filter(l => l.trim()); return (ls[1] || '').replace(LIST_RE, '').trim().slice(0, 140) || 'Không có thêm nội dung'; };
const VN = { timeZone: 'Asia/Ho_Chi_Minh' };
const noteWhen = t => { const d0 = vnDay(Date.now()), d = vnDay(t); return d === d0 ? hm(t) : d === d0 - 86400e3 ? 'Hôm qua' : d0 - d < 7 * 86400e3 ? new Intl.DateTimeFormat('vi-VN', { ...VN, weekday: 'long' }).format(t) : new Intl.DateTimeFormat('vi-VN', { ...VN, day: '2-digit', month: '2-digit', year: '2-digit' }).format(t); };
const noteGroup = t => { const d0 = vnDay(Date.now()), d = vnDay(t), k = (d0 - d) / 86400e3; return k < 1 ? 'Hôm nay' : k < 2 ? 'Hôm qua' : k < 7 ? '7 ngày qua' : k < 30 ? '30 ngày qua' : new Intl.DateTimeFormat('vi-VN', { ...VN, month: 'long', year: 'numeric' }).format(t).replace(/^./, c => c.toUpperCase()); };
const noteLong = t => new Intl.DateTimeFormat('vi-VN', { ...VN, day: 'numeric', month: 'long', year: 'numeric' }).format(t) + ' lúc ' + hm(t);
/** Vị trí con trỏ (số ký tự tính từ đầu) trong ô soạn chữ thuần, và đặt lại. */
function caretOf(el) { const s = getSelection(); if (!s.rangeCount || !el.contains(s.anchorNode)) return null; const r = s.getRangeAt(0), pre = r.cloneRange(); pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset); return pre.toString().length; }
function selectChars(el, a, b) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, pos = 0; const r = document.createRange(); let started = false;
  while ((n = w.nextNode())) { const len = n.length; if (!started && a <= pos + len) { r.setStart(n, a - pos); started = true; } if (started && b <= pos + len) { r.setEnd(n, b - pos); break; } pos += len; }
  if (!started) { r.selectNodeContents(el); r.collapse(false); }
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
/** Ảnh người dùng chọn → vuông size×size (cắt giữa), WebP (hoặc PNG nếu trình duyệt không xuất được WebP), base64. */
async function squareImage(file, size) {
  const bmp = await createImageBitmap(file), k = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, (bmp.width - k) / 2, (bmp.height - k) / 2, k, k, 0, 0, size, size); bmp.close?.();
  let blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.9));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const buf = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { type: blob.type, data: btoa(bin) };
}
/** Chèn chữ thuần tại con trỏ (giữ hoàn tác ⌘Z): xuống dòng bằng insertLineBreak — insertText bỏ mất "\n" trong ô plaintext-only. */
function insPlain(t) {
  String(t).split('\n').forEach((part, i) => { if (i) document.execCommand('insertLineBreak'); if (part) document.execCommand('insertText', false, part); });
}
const readNote = el => (el.querySelector('*') ? el.innerText : el.textContent).replace(/\u00a0/g, ' ');

export class ProjectPanel {
  constructor(ctl) { this.c = ctl; this.s = ctl.s; this.el = null; this.filter = 'active'; this.cur = null; this.tab = 'tasks'; this.mineOnly = false; this.people = null; this.chat = null; }
  get body() { return this.el?.querySelector('.pj-body'); }
  get pid() { return this.cur?.project.id ?? null; }
  /** Đang đọc chat của dự án này (để đánh dấu đã đọc). */
  reading(id) { return !!this.el && this.pid === id && this.view === 'project' && this.tab === 'chat' && !document.hidden; }

  // ---------- khung ----------
  async open(id = null, opts = {}) {
    if (!this.el) {
      const back = this.el = document.createElement('div'); back.className = 'sx-back';
      // đầu trang + thanh thẻ đổi theo màn: danh sách (Đang làm / Đã lưu trữ) · trong một dự án (tên, thành viên, Vào phòng,
      // Đặt họp + các thẻ Công việc · Chat · … — luôn ở trên, không cuộn mất)
      // bố cục dashboard: thanh bên (tìm dự án, Tổng quan, danh sách dự án) + vùng chính (đầu trang, thẻ, nội dung)
      back.innerHTML = `<div class="sx pj dash" role="dialog" aria-modal="true" aria-labelledby="pjTitle">
        <aside class="ds-side" aria-label="Danh sách dự án">
          <div class="ds-head"><span class="ds-logo">${icon('grid', 16)}</span><b>Dự án</b><button type="button" class="ds-add" data-s="new" title="Dự án mới" aria-label="Dự án mới">${icon('plus', 15)}</button></div>
          <label class="ds-search">${icon('target', 14)}<input type="search" placeholder="Tìm dự án…" aria-label="Tìm dự án" autocomplete="off"></label>
          <button type="button" class="ds-item ds-home" data-s="home">${icon('grid', 15)}<span>Tổng quan</span><em class="ds-n"></em></button>
          <div class="ds-scroll"></div>
          <p class="ds-foot">${icon('info', 13)} Chỉ thành viên mới thấy dự án.</p>
        </aside>
        <section class="ds-main"><header class="sx-h pj-h"></header><nav class="sx-tabs pj-nav" role="tablist"></nav>
        <div class="sx-body pj-body" tabindex="-1"></div></section></div>`;
      document.body.appendChild(back); overlayOn();
      requestAnimationFrame(() => back.classList.add('show'));
      back.addEventListener('click', e => { if (e.target === back) this.close(); });
      back.querySelector('.pj-h').addEventListener('click', e => {
        const b = e.target.closest('[data-h]'); if (!b) return;
        ({ close: () => this.close(), new: () => this.form(), back: () => this.showList(), room: () => this.c.join(this.pid), meet: () => this.bookMeeting() })[b.dataset.h]?.();
      });
      const side = back.querySelector('.ds-side');
      side.addEventListener('click', e => {
        const b = e.target.closest('[data-s], [data-p]'); if (!b) return;
        if (b.dataset.p) this.load(+b.dataset.p); else if (b.dataset.s === 'new') this.form(); else if (b.dataset.s === 'home') this.showList(); else if (b.dataset.s === 'arch') { this.showArch = !this.showArch; this.renderSide(); }
      });
      const sq = side.querySelector('.ds-search input');
      sq.addEventListener('input', () => { this.q = sq.value.trim().toLowerCase(); this.renderSide(); });
      sq.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
      back.querySelector('.pj-nav').addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.f) { this.filter = b.dataset.f; this.showList(); }
        else if (b.dataset.tab) { this.closeTask(true); this.showTab(b.dataset.tab); }
      });
      this._key = e => {
        if (!this.el || document.querySelector('.modal-back')) return;
        if (e.key === 'Escape' && !e.target.closest?.('.pj-mention')) { e.preventDefault(); if (this.taskOpen) this.closeTask(); else if (this.view !== 'list') this.showList(); else this.close(); }
        if (!this.el?.contains(e.target)) e.stopPropagation();   // (phím trong ô nhập của bảng vẫn tới ô nhập)
      };
      window.addEventListener('keydown', this._key, true);
    }
    if (id) await this.load(id, opts); else this.showList();
  }
  close() {
    const el = this.el; if (!el) return;
    this.saveNotesNow(); this.dropIfEmpty(); this.wb?.destroy(); this.wb = null;
    this.el = null; this.cur = null; this.view = null; this.taskOpen = null; this.drag = null;
    window.removeEventListener('keydown', this._key, true); overlayOff();
    el.classList.remove('show'); setTimeout(() => el.remove(), 200);
  }
  setMode(mode) {
    const changed = this.view !== mode; this.view = mode; this.el.querySelector('.sx.pj').dataset.view = mode;
    if (this.body) this.body._h = null;   // (màn khác vẽ vào thân: lần vẽ Tổng quan sau không được bỏ qua)
    if (changed) this.enter();
    this.renderHead(); this.renderSide();
  }
  /** Hiệu ứng hiện dần MỘT lần khi đổi màn / đổi thẻ — chạy trên khung thân, nên vẽ lại nội dung bên trong (dữ liệu mới tới)
   *  không làm hiệu ứng chạy lại (trước đây mỗi lần vẽ lại = mỗi khối con hiện dần lại → nhìn giật, như lặp). */
  enter() { const b = this.body; if (!b) return; b.classList.remove('enter'); void b.offsetWidth; b.classList.add('enter'); }
  /** Ghi HTML vào phần tử chỉ khi khác lần trước (không thay DOM vô ích). */
  put(el, html) { if (!el || el._h === html) return false; el._h = html; el.innerHTML = html; return true; }
  /** Thanh bên: Tổng quan + dự án đang làm (chấm tin mới, số việc của tôi) + dự án đã lưu trữ (thu gọn); lọc theo ô tìm. */
  renderSide() {
    const box = this.el?.querySelector('.ds-scroll'); if (!box) return;
    const q = this.q || '', match = p => !q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q);
    const act = this.c.list.filter(p => p.status === 'active' && match(p)), arch = this.c.list.filter(p => p.status === 'archived' && match(p));
    const item = p => `<button type="button" class="ds-item${p.id === this.pid ? ' on' : ''}" data-p="${p.id}" style="--pc:${esc(p.color)}" title="${esc(p.name)}">${p.logoV ? projectMark(p, 'xs') : '<i class="ds-dot"></i>'}<span>${esc(p.name)}</span>${this.c.unread(p) ? '<i class="pj-dot" title="Tin nhắn mới"></i>' : ''}${p.counts.overdue && p.counts.mine ? `<em class="ds-n over" title="Việc của bạn quá hạn">${p.counts.overdue}</em>` : p.counts.mine ? `<em class="ds-n" title="Việc của bạn">${p.counts.mine}</em>` : ''}</button>`;
    this.put(box, `<div class="ds-sec">Đang làm <em>${act.length}</em></div>${act.map(item).join('') || `<p class="ds-none">${q ? 'Không có dự án khớp.' : 'Chưa có dự án nào.'}</p>`}
      ${arch.length ? `<button type="button" class="ds-sec ds-toggle" data-s="arch" aria-expanded="${!!this.showArch || !!q}">${icon('chevDown', 13)} Đã lưu trữ <em>${arch.length}</em></button>${this.showArch || q ? arch.map(item).join('') : ''}` : ''}`);
    this.el.querySelector('.ds-home').classList.toggle('on', this.view === 'list');
    const mine = this.myTasks?.length || 0, n = this.el.querySelector('.ds-home .ds-n'); n.textContent = mine || ''; n.hidden = !mine; n.title = 'Việc của bạn';
  }
  /** Đầu trang + thanh thẻ theo màn đang xem. */
  renderHead() {
    const h = this.el?.querySelector('.pj-h'), nav = this.el?.querySelector('.pj-nav'); if (!h) return;
    const x = `<button type="button" class="sx-x" data-h="close" aria-label="Đóng">${icon('close', 16)}</button>`;
    if (this.view === 'project' && this.cur) {
      const p = this.p, open = this.cur.tasks.filter(t => t.status !== 'done').length, here = (this.cur.inRoom || []).length;
      this.put(h, `<button type="button" class="sx-icon pj-hb" data-h="back" aria-label="Tất cả dự án" title="Tất cả dự án">${icon('chevLeft', 18)}</button>
        ${projectMark(p, 'pj-hic')}
        <div><h2 id="pjTitle">${esc(p.name)}${p.status === 'archived' ? ' <em class="pj-tag">Đã lưu trữ</em>' : ''}</h2>
          <p>${p.description ? `${esc(p.description)} · ` : ''}${p.members.length} thành viên · ${open} việc đang mở${here ? ` · <b class="pj-live">${here} người trong phòng</b>` : ''}</p></div>
        <span class="mp-avs pj-havs">${p.members.slice(0, 5).map(m => avatar(m.key, m.name, m.role === 'lead' ? 'host' : '')).join('')}${p.members.length > 5 ? `<span class="mt-av more">+${p.members.length - 5}</span>` : ''}</span>
        ${p.status === 'active' ? `<button type="button" class="sx-ghost pj-hmeet" data-h="meet" title="Đặt phòng họp cho cả dự án">${icon('calendar', 15)} <span>Đặt họp</span></button>
        <button type="button" class="sx-primary pj-hroom" data-h="room" title="Vào phòng dự án 3D: bảng vẽ chung, họp video, chia sẻ màn hình">${icon('door', 15)} <span>Vào phòng</span></button>` : ''}${x}`);
      const tabs = [['tasks', 'check', 'Công việc'], ['chat', 'chat', 'Chat'], ['files', 'folder', 'Tài liệu'], ['notes', 'edit', 'Ghi chú'], ['people', 'users', 'Thành viên'], ...(p.isLead ? [['settings', 'key', 'Cài đặt']] : [])];
      nav.hidden = false;
      this.put(nav, tabs.map(([k, ic, n]) => `<button type="button" role="tab" data-tab="${k}" class="${k === this.tab ? 'on' : ''}" aria-selected="${k === this.tab}">${icon(ic, 14)} <span>${n}</span><i class="pj-dot" hidden></i></button>`).join(''));
      this.paintTabDots();
      return;
    }
    this.put(h, `${this.view === 'form' ? `<button type="button" class="sx-icon pj-hb" data-h="back" aria-label="Tổng quan" title="Tổng quan">${icon('chevLeft', 18)}</button>` : ''}<div><h2 id="pjTitle">${this.view === 'form' ? 'Dự án mới' : 'Tổng quan'}</h2><p>${this.view === 'form' ? 'Đặt tên, chọn màu, mời đồng đội — bạn là Trưởng dự án.' : 'Việc của bạn và các dự án của nhóm'}</p></div>
      ${this.view === 'list' ? `<button type="button" class="sx-primary" data-h="new">${icon('plus', 15)} <span>Dự án mới</span></button>` : ''}${x}`);
    nav.hidden = true; this.put(nav, '');
  }

  // ---------- danh sách ----------
  showList() {
    if (!this.el) return;
    this.saveNotesNow(); this.dropIfEmpty(); this.wb?.destroy(); this.wb = null; this.cur = null; this.taskOpen = null; this.chat = null;
    this.setMode('list'); this.renderList(); this.c.load(); this.loadMine();
  }
  async loadMine() { const r = await api('GET', '/api/projects/tasks/mine'); if (!r.ok || !this.el) return; this.myTasks = r.tasks; this.renderSide(); if (this.view === 'list') this.renderList(); }
  /** Tổng quan: ô số liệu + "Việc của tôi" (mọi dự án) + thẻ các dự án đang làm. */
  renderList() {
    const body = this.body; if (!body || this.view !== 'list') return;
    const all = this.c.list, act = all.filter(p => p.status === 'active'), arch = all.filter(p => p.status === 'archived'), mine = this.myTasks || [], now = Date.now();
    if (!all.length) {
      if (!this.put(body, `<div class="pj-start"><div class="pj-start-ic">${icon('grid', 30)}</div><h3>Làm việc nhóm ngay trong văn phòng</h3><p>Mỗi dự án là một không gian riêng của nhóm — chỉ thành viên mới thấy.</p>
        <ol class="pj-steps"><li><b>1</b><span><strong>Tạo dự án</strong>Đặt tên, chọn màu — bạn là Trưởng dự án.</span></li><li><b>2</b><span><strong>Mời đồng đội</strong>Tìm theo tên hoặc thêm cả phòng ban.</span></li><li><b>3</b><span><strong>Chia việc &amp; làm cùng nhau</strong>Bảng Kanban, chat riêng, tài liệu, phòng họp 3D.</span></li></ol>
        <button type="button" class="sx-primary" data-new>${icon('plus', 15)} Tạo dự án đầu tiên</button></div>`)) return;
      body.querySelector('[data-new]').onclick = () => this.form(); return;
    }
    const over = mine.filter(t => t.due && t.due < now).length, soon = mine.filter(t => t.due && t.due >= now && t.due - now < 86400e3).length;
    const stat = (ic, n, label, cls = '') => `<div class="ov-stat ${cls}"><span class="ov-ic">${icon(ic, 16)}</span><b>${n}</b><small>${label}</small></div>`;
    const row = t => { const d = dueInfo(t.due, false); return `<button type="button" class="ov-row" data-tp="${t.projectId}" data-tt="${t.id}" style="--pc:${esc(t.projectColor)}">
        <i class="pj-cd ${t.status}" title="${COLS.find(c => c[0] === t.status)[1]}"></i><span class="ov-t">${esc(t.title)}</span>
        <span class="ov-p">${(pp => pp?.logoV ? projectMark(pp, 'xs') : '<i class="ds-dot"></i>')(this.c.list.find(x => x.id === t.projectId))}${esc(t.projectName)}</span>
        ${t.priority ? `<em class="pj-pr p${t.priority}">${PRIO[t.priority][1]}</em>` : '<span></span>'}
        ${d ? `<em class="pj-due ${d.cls}">${icon('clock', 11)} ${esc(d.label)}</em>` : '<em class="pj-due none">Không hạn</em>'}</button>`; };
    if (!this.put(body, `<div class="ov">
      <div class="ov-stats">${stat('grid', act.length, 'Dự án đang làm')}${stat('check', mine.length, 'Việc của bạn')}${stat('clock', soon, 'Tới hạn trong 24 giờ', soon ? 'warn' : '')}${stat('info', over, 'Quá hạn', over ? 'bad' : '')}</div>
      ${this.s.isAdmin && all.some(p => !p.isMember) ? `<p class="pj-note">${icon('info', 14)} Bạn là CEO: thấy mọi dự án của công ty (dự án bạn không tham gia có nhãn "CEO xem").</p>` : ''}
      <section class="ov-card"><header><h4>${icon('check', 15)} Việc của bạn</h4><small>${mine.length ? 'Sắp xếp theo hạn chót · bấm để mở' : ''}</small></header>
        ${mine.length ? `<div class="ov-list">${mine.map(row).join('')}</div>` : `<p class="ov-empty">${icon('check', 18)} Không có việc nào đang chờ bạn. Tuyệt!</p>`}</section>
      <section class="ov-card"><header><h4>${icon('grid', 15)} Dự án đang làm <em>${act.length}</em></h4><button type="button" class="sx-ghost" data-new>${icon('plus', 14)} Dự án mới</button></header>
        ${act.length ? `<div class="pj-grid">${act.map(p => this.card(p)).join('')}</div>` : '<p class="ov-empty">Chưa có dự án đang làm.</p>'}</section>
      ${arch.length ? `<section class="ov-card"><header><h4>${icon('folder', 15)} Đã lưu trữ <em>${arch.length}</em></h4></header><div class="pj-grid sm">${arch.map(p => this.card(p)).join('')}</div></section>` : ''}
    </div>`)) return;   // (không đổi gì: giữ nguyên, không vẽ lại)
    body.querySelectorAll('[data-new]').forEach(b => b.onclick = () => this.form());
    body.querySelectorAll('[data-p]').forEach(b => b.onclick = () => this.load(+b.dataset.p));
    body.querySelectorAll('[data-tt]').forEach(b => b.onclick = () => this.load(+b.dataset.tp, { tab: 'tasks', task: +b.dataset.tt }));
  }
  card(p) {
    const un = this.c.unread(p), c = p.counts, open = c.todo + c.doing, total = open + c.done;
    return `<button type="button" class="pj-pc" data-p="${p.id}" style="--pc:${esc(p.color)}">
      <span class="pj-pct">${projectMark(p, 'sm')}<b>${esc(p.name)}</b>${un ? '<i class="pj-dot" title="Có tin nhắn mới"></i>' : ''}</span>
      ${p.description ? `<span class="pj-pcd">${esc(p.description)}</span>` : '<span class="pj-pcd muted">Chưa có mô tả.</span>'}
      <span class="pj-prog" aria-label="${c.done}/${total} việc xong"><i style="width:${total ? Math.round(c.done / total * 100) : 0}%"></i></span>
      <span class="pj-pcf"><span class="mp-avs">${p.leads.slice(0, 3).map(l => avatar(l.key, l.name, 'host')).join('')}</span><small>${p.memberCount} người · ${open} việc mở</small>
        <span class="pj-tags">${!p.isMember ? '<em class="pj-tag">CEO xem</em>' : ''}${c.mine ? `<em class="pj-tag mine">${c.mine} việc của bạn</em>` : ''}${c.overdue ? `<em class="pj-tag over">${c.overdue} quá hạn</em>` : ''}${un ? '<em class="pj-tag new">tin mới</em>' : ''}</span></span></button>`;
  }

  // ---------- chọn người (tạo dự án, thêm thành viên) ----------
  async loadPeople() { if (this.people) return this.people; const r = await api('GET', '/api/people'); this.people = r.ok ? r.people : []; return this.people; }
  /** Ô tìm người + chip; picked: Map(key → tên); skip: khoá không cho chọn (đã trong dự án). */
  picker(host, { people, picked, skip = new Set(), max = 49, onChange = () => {} }) {
    const me = this.s.key, depts = [...new Set(people.map(p => p.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
    host.innerHTML = `<div class="mp-chips"></div><div class="mp-pick"><input class="mp-q" placeholder="Tìm theo tên, mã hoặc phòng ban…" autocomplete="off" aria-label="Tìm người">
      ${depts.length ? `<select class="mp-dept" aria-label="Thêm cả phòng ban"><option value="">+ Thêm cả phòng ban…</option>${depts.map(d => `<option>${esc(d)}</option>`).join('')}</select>` : ''}</div><ul class="mp-res" role="listbox" hidden></ul>`;
    const chips = host.querySelector('.mp-chips'), res = host.querySelector('.mp-res'), q = host.querySelector('.mp-q');
    const draw = () => {
      chips.innerHTML = '';
      for (const [k, n] of picked) { const c = document.createElement('span'); c.className = 'mp-chip'; c.innerHTML = `${avatar(k, n)} ${esc(short(n))} <button type="button" aria-label="Bỏ ${esc(n)}">${icon('close', 11)}</button>`; c.querySelector('button').onclick = () => { picked.delete(k); draw(); }; chips.appendChild(c); }
      onChange(picked.size);
    };
    const ok = p => p.key !== me && !picked.has(p.key) && !skip.has(p.key);
    const add = k => { const p = people.find(x => x.key === k); if (!p) return; if (picked.size >= max) { this.s.toast(`Tối đa ${max + 1} người một dự án.`, true); return; } picked.set(k, p.name); q.value = ''; res.hidden = true; draw(); q.focus(); };
    q.oninput = () => {
      const s = q.value.trim().toLowerCase().normalize('NFC'); if (!s) { res.hidden = true; return; }
      const hits = people.filter(p => ok(p) && `${p.name} ${p.code} ${p.department}`.toLowerCase().includes(s)).slice(0, 8);
      res.hidden = false;
      res.innerHTML = hits.length ? hits.map((p, i) => `<li role="option" data-k="${esc(p.key)}" class="${i ? '' : 'act'}">${avatar(p.key, p.name)}<span class="mp-rt"><b>${esc(p.name)}</b>${p.department || p.online ? `<small>${esc(p.department || '')}${p.department && p.online ? ' · ' : ''}${p.online ? '<em>đang online</em>' : ''}</small>` : ''}</span></li>`).join('') : '<li class="none">Không tìm thấy ai.</li>';
      res.querySelectorAll('[data-k]').forEach(li => li.onmousedown = e => { e.preventDefault(); add(li.dataset.k); });
    };
    q.onblur = () => setTimeout(() => { res.hidden = true; }, 120);
    q.addEventListener('keydown', e => {
      if (e.key !== 'Escape') e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); const a = res.querySelector('.act'); if (a) add(a.dataset.k); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const lis = [...res.querySelectorAll('[data-k]')], i = lis.findIndex(x => x.classList.contains('act')), j = Math.max(0, Math.min(lis.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); lis.forEach((x, k) => x.classList.toggle('act', k === j)); }
    });
    host.querySelector('.mp-dept')?.addEventListener('change', e => { const d = e.target.value; e.target.value = ''; if (!d) return; for (const p of people) if (p.department === d && ok(p) && picked.size < max) picked.set(p.key, p.name); draw(); });
    draw();
  }
  colors(sel) { return `<div class="pj-colors" role="radiogroup" aria-label="Màu dự án">${COLORS.map(c => `<button type="button" role="radio" class="pj-sw${c === sel ? ' on' : ''}" data-c="${c}" style="--pc:${c}" aria-checked="${c === sel}" aria-label="Màu ${c}"></button>`).join('')}</div>`; }
  bindColors(root, set) { root.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { root.querySelectorAll('[data-c]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); set(b.dataset.c); }); }

  // ---------- tạo dự án ----------
  async form() {
    if (!this.el) await this.open();
    this.setMode('form');
    const body = this.body; body.innerHTML = '<div class="sx-loading">Đang tải…</div>';
    const people = await this.loadPeople(); if (!this.el || this.view !== 'form') return;
    let color = COLORS[(this.c.list.length + 3) % COLORS.length];
    const picked = new Map();
    body.innerHTML = `<form class="pj-form" novalidate>
      <label class="sx-field"><span>Tên dự án <i>*</i></span><input name="name" maxlength="80" required placeholder="Ví dụ: Website SYSONE 2027"></label>
      <label class="sx-field"><span>Mô tả</span><textarea name="description" rows="3" maxlength="1000" placeholder="Mục tiêu, phạm vi, link quan trọng…"></textarea></label>
      <div class="sx-field"><span>Màu</span>${this.colors(color)}</div>
      <div class="sx-field"><span>Thành viên <small class="pj-cnt">(bạn là Trưởng dự án)</small></span><div class="pj-pickhost"></div></div>
      <p class="sx-err" role="alert"></p>
      <div class="sx-acts"><button type="button" class="sx-ghost" data-cancel>Huỷ</button><button type="submit" class="sx-primary">${icon('plus', 15)} Tạo dự án</button></div></form>`;
    const f = body.querySelector('form');
    f.querySelector('[data-cancel]').onclick = () => this.showList();
    f.querySelectorAll('input,textarea').forEach(x => x.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); }));
    this.bindColors(f, c => { color = c; });
    this.picker(f.querySelector('.pj-pickhost'), { people, picked, onChange: n => { f.querySelector('.pj-cnt').textContent = n ? `(bạn + ${n} người)` : '(bạn là Trưởng dự án)'; } });
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => f.name.focus({ preventScroll: true }), 30);
    f.onsubmit = async e => {
      e.preventDefault();
      const err = f.querySelector('.sx-err'), btn = f.querySelector('[type=submit]');
      if (!f.name.value.trim()) { err.textContent = 'Cần nhập tên dự án.'; f.name.focus(); return; }
      btn.disabled = true;
      const r = await api('POST', '/api/projects', { name: f.name.value, description: f.description.value, color, members: [...picked.keys()] });
      btn.disabled = false;
      if (!r.ok) { err.textContent = r.error || 'Chưa tạo được dự án.'; return; }
      this.s.toast(picked.size ? `Đã tạo dự án và mời ${picked.size} người.` : 'Đã tạo dự án.');
      this.c.load(); this.load(r.project.id);
    };
  }

  // ---------- một dự án ----------
  async load(id, { tab = null, task = null } = {}) {
    if (!this.el) { await this.open(id, { tab, task }); return; }
    const same = this.pid === id;
    if (!same) { this.saveNotesNow(); this.dropIfEmpty(); this.wb?.destroy(); this.wb = null; this.chat = null; this.taskOpen = null; this.tab = tab || 'tasks'; }
    else if (tab) this.tab = tab;
    this.setMode('project');
    if (!same) { this.body.innerHTML = '<div class="sx-loading">Đang tải…</div>'; this.body._h = null; }
    const r = await api('GET', `/api/projects/${id}`);
    if (!this.el || this.view !== 'project') return;
    if (!r.ok) { this.cur = null; this.body.innerHTML = `<div class="sx-empty">${icon('grid', 30)}<b>Không mở được dự án</b><span>${esc(r.error || '')}</span><button type="button" class="sx-ghost" data-back>${icon('chevLeft', 14)} Tất cả dự án</button></div>`; this.body.querySelector('[data-back]').onclick = () => this.showList(); return; }
    this.cur = r;
    if (task) this.taskOpen = task;
    this.renderProject();
  }
  get p() { return this.cur.project; }
  get editable() { return this.p.status === 'active' && (this.p.isMember || this.p.role === 'admin'); }
  renderProject() {
    const body = this.body, p = this.p, r = this.cur; if (!body) return;
    const next = r.meetings.filter(m => m.end > Date.now()).slice(0, 3);
    if (!['tasks', 'chat', 'files', 'notes', 'people', ...(p.isLead ? ['settings'] : [])].includes(this.tab)) this.tab = 'tasks';
    this.renderHead(); this.renderSide();
    body._h = null;
    body.innerHTML = `<div class="pj-view" style="--pc:${esc(p.color)}"><div class="pj-sum"></div>
      ${next.length ? `<div class="pj-meets">${icon('calendar', 14)}<span>Họp sắp tới:</span>${next.map(m => `<span class="pj-meet"><b>${esc(m.title)}</b> · ${esc(dayLabel(m.start))} ${hm(m.start)}–${hm(m.end)}</span>`).join('')}</div>` : ''}
      <div class="pj-pane"></div></div>`;
    this.paintSum();
    this.showTab(this.tab);
  }
  async bookMeeting() {
    const meet = this.s.meet; if (!meet) return;
    const p = this.p, proj = { id: p.id, name: p.name, color: p.color, members: p.members };
    this.close(); await meet.panel.open('book'); meet.panel.form(null, null, proj);
  }
  paintTabDots() {
    const p = this.c.list.find(x => x.id === this.pid);
    const d = this.el?.querySelector('[data-tab=chat] .pj-dot'); if (d) d.hidden = !(p && this.c.unread(p)) || this.tab === 'chat';
  }
  showTab(tab) {
    if (tab !== this.tab) this.enter();
    this.saveNotesNow(); this.dropIfEmpty(); this.wb?.destroy(); this.wb = null;
    this.tab = tab;
    this.el.querySelectorAll('.pj-nav [data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    this.body.scrollTop = 0;
    this.paintTabDots();
    const fn = { tasks: () => { this.renderTasks(); if (this.taskOpen) this.renderTask(this.taskOpen); }, chat: () => this.renderChat(), files: () => { this.renderFiles(); this.reload(); }, notes: () => this.renderNotes(), people: () => this.renderPeople(), settings: () => this.renderSettings() }[tab];
    fn?.();
  }
  get pane() { return this.el?.querySelector('.pj-pane'); }

  // ---------- Kanban ----------
  renderTasks() {
    const pane = this.pane; if (!pane) return;
    const me = this.s.key, ts = this.cur.tasks.filter(t => !this.mineOnly || t.assignee === me), ed = this.editable;
    pane.innerHTML = `<div class="pj-kbar"><label class="sx-check pj-mine"><input type="checkbox" ${this.mineOnly ? 'checked' : ''}> Chỉ việc của tôi</label>
        <small>${ed ? `${icon('hand', 13)} ${matchMedia('(pointer: coarse)').matches ? 'Giữ thẻ rồi kéo' : 'Kéo thẻ'} để chuyển cột · bấm thẻ để xem chi tiết` : 'Dự án đã lưu trữ — chỉ xem.'}</small></div>
      <div class="pj-board">${COLS.map(([st, name]) => { const list = ts.filter(t => t.status === st).sort((a, b) => a.order - b.order || a.id - b.id); return `<section class="pj-col" data-st="${st}">
        <header><i class="pj-cd ${st}"></i><b>${name}</b><em>${list.length}</em>${ed ? `<button type="button" class="pj-cadd" data-cadd="${st}" aria-label="Thêm việc vào cột ${name}" title="Thêm việc">${icon('plus', 15)}</button>` : ''}</header>
        <div class="pj-cards">${list.map(t => this.taskCard(t)).join('')}${list.length ? '' : `<p class="pj-empty">${st === 'done' ? 'Kéo việc đã xong vào đây.' : 'Chưa có việc.'}</p>`}</div>
        ${ed ? `<button type="button" class="pj-add" data-add="${st}">${icon('plus', 14)} Thêm việc</button>` : ''}</section>`; }).join('')}</div>`;
    pane.querySelector('.pj-mine input').onchange = e => { this.mineOnly = e.target.checked; this.renderTasks(); };
    pane.querySelectorAll('[data-add]').forEach(b => b.onclick = () => this.addForm(b));
    pane.querySelectorAll('[data-cadd]').forEach(b => b.onclick = () => { const add = b.closest('.pj-col').querySelector('[data-add]'); if (add) this.addForm(add); else b.closest('.pj-col').querySelector('.pj-addf textarea')?.focus(); });
    pane.querySelectorAll('.pj-card').forEach(c => this.bindCard(c));
  }
  taskCard(t) {
    const due = dueInfo(t.due, t.status === 'done');
    return `<div class="pj-card${t.status === 'done' ? ' done' : ''}${t.priority ? ` p${t.priority}` : ''}${t.id === this.taskOpen ? ' sel' : ''}" data-t="${t.id}" role="button" tabindex="0" aria-label="${esc(t.title)}">
      <b>${esc(t.title)}</b>
      <span class="pj-cm">${t.priority ? `<em class="pj-pr p${t.priority}">${PRIO[t.priority][1]}</em>` : ''}${due ? `<em class="pj-due ${due.cls}">${icon('clock', 11)} ${esc(due.label)}</em>` : ''}${t.comments ? `<em class="pj-cc">${icon('chat', 11)} ${t.comments}</em>` : ''}
        <span class="pj-who">${t.assignee ? avatar(t.assignee, t.assigneeName) : '<span class="mt-av none" title="Chưa giao">?</span>'}</span></span></div>`;
  }
  addForm(btn) {
    const st = btn.dataset.add, col = btn.closest('.pj-col');
    const f = document.createElement('form'); f.className = 'pj-addf';
    f.innerHTML = `<textarea rows="2" maxlength="200" placeholder="Tên công việc… (Enter để thêm)" aria-label="Tên công việc mới"></textarea><div><button type="submit" class="sx-primary">Thêm</button><button type="button" class="sx-ghost" data-x>Huỷ</button></div>`;
    btn.replaceWith(f); const ta = f.querySelector('textarea'); ta.focus();
    const done = () => { if (f.isConnected) f.replaceWith(btn); };
    f.querySelector('[data-x]').onclick = done;
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } if (e.key === 'Escape') done(); });
    f.onsubmit = async e => {
      e.preventDefault(); const title = ta.value.trim(); if (!title) { ta.focus(); return; }
      ta.disabled = true;
      const r = await api('POST', `/api/projects/${this.pid}/tasks`, { title, status: st });
      ta.disabled = false;
      if (!r.ok) { this.s.toast(r.error || 'Chưa thêm được.', true); return; }
      this.upsert(r.task); this.paintSum(); ta.value = ''; ta.focus();
      const list = col.querySelector('.pj-cards'); list.querySelector('.pj-empty')?.remove();
      const tmp = document.createElement('div'); tmp.innerHTML = this.taskCard(r.task); const card = tmp.firstElementChild; list.appendChild(card); this.bindCard(card);
      col.querySelector('header em').textContent = list.querySelectorAll('.pj-card').length;
    };
    void col;
  }
  upsert(t) { const i = this.cur.tasks.findIndex(x => x.id === t.id); if (i >= 0) this.cur.tasks[i] = t; else this.cur.tasks.push(t); }
  /** Bấm → chi tiết; kéo (chuột: ngay; cảm ứng: giữ 0,3 giây) → đổi cột / thứ tự. */
  bindCard(card) {
    const id = +card.dataset.t;
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openTask(id); } });
    card.addEventListener('pointerdown', e => {
      if (e.button) return;
      const touch = e.pointerType !== 'mouse';
      const st = { id, card, x: e.clientX, y: e.clientY, pid: e.pointerId, active: false, touch };
      this.drag = st;
      if (touch && this.editable) st.hold = setTimeout(() => { if (this.drag === st) this.startDrag(st); }, 300);
    });
    card.addEventListener('touchmove', e => { if (this.drag?.active) e.preventDefault(); }, { passive: false });   // (đang kéo: không cuộn trang)
    card.addEventListener('pointermove', e => {
      const st = this.drag; if (!st || st.card !== card || e.pointerId !== st.pid) return;
      const moved = Math.hypot(e.clientX - st.x, e.clientY - st.y);
      if (!st.active) {
        if (st.touch) { if (moved > 8) { clearTimeout(st.hold); this.drag = null; } return; }   // (cảm ứng: di ngón trước khi giữ đủ lâu = cuộn)
        if (moved < 6 || !this.editable) return;
        this.startDrag(st);
      }
      this.moveDrag(e.clientX, e.clientY);
    });
    const end = e => {
      const st = this.drag; if (!st || st.card !== card || e.pointerId !== st.pid) return;
      clearTimeout(st.hold); this.drag = null;
      if (st.active) this.endDrag(st, e.type === 'pointerup');
      else if (e.type === 'pointerup') this.openTask(id);
    };
    card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
  }
  startDrag(st) {
    st.active = true;
    try { st.card.setPointerCapture(st.pid); } catch { /* */ }
    const r = st.card.getBoundingClientRect();
    const g = st.ghost = st.card.cloneNode(true); g.classList.add('pj-ghost'); g.style.width = `${r.width}px`; document.body.appendChild(g);
    st.dx = st.x - r.left; st.dy = st.y - r.top;
    st.ph = document.createElement('div'); st.ph.className = 'pj-ph'; st.ph.style.height = `${r.height}px`;
    st.card.after(st.ph); st.card.classList.add('dragging');
    navigator.vibrate?.(12);
    this.moveDrag(st.x, st.y);
    const loop = () => { if (!st.active) return; this.autoScroll(st); st.raf = requestAnimationFrame(loop); }; st.raf = requestAnimationFrame(loop);
  }
  moveDrag(x, y) {
    const st = this.drag; if (!st?.active) return;
    st.cx = x; st.cy = y;
    st.ghost.style.transform = `translate(${x - st.dx}px, ${y - st.dy}px) rotate(2deg)`;
    st.ghost.hidden = true; const under = document.elementFromPoint(x, y); st.ghost.hidden = false;
    const col = under?.closest?.('.pj-col'); if (!col || !this.el?.contains(col)) return;
    const list = col.querySelector('.pj-cards'), cards = [...list.querySelectorAll('.pj-card:not(.dragging)')];
    const before = cards.find(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
    if (before) { if (st.ph.nextElementSibling !== before) list.insertBefore(st.ph, before); } else if (list.lastElementChild !== st.ph) list.appendChild(st.ph);
    list.querySelector('.pj-empty')?.setAttribute('hidden', '');
  }
  /** Kéo gần mép: cuộn bảng (ngang, điện thoại) / khung (dọc). */
  autoScroll(st) {
    const board = this.el?.querySelector('.pj-board'), body = this.body; if (!board || st.cx == null) return;
    const rb = board.getBoundingClientRect(), ry = body.getBoundingClientRect(), E = 48;
    if (board.scrollWidth > board.clientWidth) { if (st.cx < rb.left + E) board.scrollLeft -= 10; else if (st.cx > rb.right - E) board.scrollLeft += 10; }
    if (st.cy < ry.top + E) body.scrollTop -= 10; else if (st.cy > ry.bottom - E) body.scrollTop += 10;
  }
  async endDrag(st, drop) {
    st.active = false; cancelAnimationFrame(st.raf); st.ghost.remove(); st.card.classList.remove('dragging');
    const col = st.ph.closest('.pj-col'), t = this.cur?.tasks.find(x => x.id === st.id);
    if (!drop || !col || !t) { st.ph.remove(); this.renderTasks(); return; }
    const status = col.dataset.st, order = (el => el?.classList.contains('pj-card') ? this.cur.tasks.find(x => x.id === +el.dataset.t)?.order : undefined);
    let prev = st.ph.previousElementSibling, next = st.ph.nextElementSibling;
    while (prev && !prev.classList.contains('pj-card')) prev = prev.previousElementSibling;
    while (next && !next.classList.contains('pj-card')) next = next.nextElementSibling;
    const a = order(prev), b = order(next);
    const o = a != null && b != null ? (a + b) / 2 : a != null ? a + 1 : b != null ? b - 1 : 1;
    st.ph.remove();
    if (status === t.status && (prev?.dataset.t === String(t.id) || next?.dataset.t === String(t.id) || (a != null && b != null && t.order > a && t.order < b))) { this.renderTasks(); return; }
    const before = { ...t }; Object.assign(t, { status, order: o, doneAt: status === 'done' ? Date.now() : null }); this.paintSum();
    this.renderTasks();
    const r = await api('PATCH', `/api/projects/${this.pid}/tasks/${t.id}`, { status, order: o });
    if (!r.ok) { Object.assign(t, before); this.s.toast(r.error || 'Chưa chuyển được.', true); this.renderTasks(); return; }
    this.upsert(r.task);
    if (status === 'done' && before.status !== 'done') this.s.toast(`Xong: ${t.title} 🎉`);
  }

  // ---------- chi tiết công việc ----------
  openTask(id) { this.taskOpen = id; this.markSel(); this.renderTask(id); }
  /** Tô viền thẻ đang mở chi tiết trên bảng Kanban. */
  markSel() { this.el?.querySelectorAll('.pj-card').forEach(c => c.classList.toggle('sel', +c.dataset.t === this.taskOpen)); }
  /** Ngăn chi tiết công việc: trượt từ phải (điện thoại: từ dưới lên), bảng Kanban vẫn ở phía sau. */
  drawer() {
    const sx = this.el.querySelector('.sx.pj'); let d = sx.querySelector('.pj-drawer:not(.out)');
    if (!d) {
      const scrim = document.createElement('div'); scrim.className = 'pj-scrim'; scrim.onclick = () => this.closeTask();
      d = document.createElement('aside'); d.className = 'pj-drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Chi tiết công việc'); d.tabIndex = -1;
      sx.append(scrim, d); requestAnimationFrame(() => { scrim.classList.add('show'); d.classList.add('show'); });
    }
    return d;
  }
  get dbody() { return this.el?.querySelector('.pj-drawer:not(.out)') || null; }
  closeTask() {
    this.taskOpen = null; this.markSel();
    const sx = this.el?.querySelector('.sx.pj'); if (!sx) return;
    for (const e of sx.querySelectorAll('.pj-drawer:not(.out), .pj-scrim:not(.out)')) { e.classList.add('out'); e.classList.remove('show'); setTimeout(() => e.remove(), 240); }
  }
  async renderTask(id, keepComments = false) {
    if (!this.el || !this.cur) return;
    const t = this.cur.tasks.find(x => x.id === id); if (!t) { this.closeTask(); return; }
    const pane = this.drawer();
    if (!keepComments || !this.tcomments || this.tcomments.id !== id) {
      if (!pane.firstChild) pane.innerHTML = '<div class="sx-loading">Đang tải…</div>';
      const r = await api('GET', `/api/projects/${this.pid}/tasks/${id}`); if (!this.el || this.taskOpen !== id) return;
      this.tcomments = { id, list: r.ok ? r.comments : [] };
    }
    const p = this.p, ed = this.editable, me = this.s.key, canDel = ed && (p.isLead || t.createdBy === me);
    const due = dueInfo(t.due, t.status === 'done');
    const col = COLS.find(c => c[0] === t.status)[1];
    pane.innerHTML = `<article class="pj-task">
      <header class="pj-dh"><span><i class="pj-cd ${t.status}"></i> ${col}</span><button type="button" class="sx-x" data-x aria-label="Đóng chi tiết">${icon('close', 16)}</button></header>
      <div class="pj-tsheet">
        <textarea class="pj-ttl" rows="1" maxlength="200" aria-label="Tên công việc" ${ed ? '' : 'readonly'}>${esc(t.title)}</textarea>
        <dl class="pj-tmeta">
          <dt>Cột</dt><dd><div class="mp-durs pj-seg" role="radiogroup" aria-label="Cột">${COLS.map(([k, n]) => `<button type="button" role="radio" data-st="${k}" class="${t.status === k ? 'on' : ''}" aria-checked="${t.status === k}" ${ed ? '' : 'disabled'}>${n}</button>`).join('')}</div></dd>
          <dt>Người làm</dt><dd><select class="pj-asg" aria-label="Người làm" ${ed ? '' : 'disabled'}><option value="">Chưa giao</option>${p.members.map(m => `<option value="${esc(m.key)}" ${m.key === t.assignee ? 'selected' : ''}>${esc(short(m.name))}${m.key === me ? ' (bạn)' : ''}</option>`).join('')}</select></dd>
          <dt>Hạn chót</dt><dd class="pj-dued"><button type="button" class="nb-dbtn pj-dbtn" aria-expanded="false" ${ed ? '' : 'disabled'}>${icon('calendar', 15)}<span class="${due?.cls || ''}">${due ? esc(due.cls === 'over' ? due.label : `${dayLabel(t.due).replace(/^./, c => c.toUpperCase())} · ${hm(t.due)}`) : 'Chưa đặt hạn'}</span>${icon('chevDown', 14)}</button>${t.due && ed ? '<button type="button" class="sx-ghost pj-nodue">Bỏ hạn</button>' : ''}<div class="nb-cal pj-cal" hidden></div></dd>
          <dt>Ưu tiên</dt><dd><div class="mp-durs pj-seg" role="radiogroup" aria-label="Ưu tiên">${PRIO.map(([v, n]) => `<button type="button" role="radio" data-pr="${v}" class="${t.priority === v ? 'on' : ''}" aria-checked="${t.priority === v}" ${ed ? '' : 'disabled'}>${n}</button>`).join('')}</div></dd>
        </dl>
        <label class="sx-field"><span>Mô tả</span><textarea class="pj-tbody" rows="4" maxlength="5000" placeholder="${ed ? 'Chi tiết, tiêu chí hoàn thành, link…' : ''}" ${ed ? '' : 'readonly'}>${esc(t.body)}</textarea></label>
        <p class="pj-tby">Tạo bởi ${esc(short(t.createdByName))} · ${ago(t.createdAt)}${t.doneAt ? ` · xong ${ago(t.doneAt)}` : ''}</p>
        <section class="pj-cmts"><h4>${icon('chat', 15)} Bình luận <em>${this.tcomments.list.length || ''}</em></h4>
          <ol>${this.tcomments.list.map(c => `<li data-c="${c.id}">${avatar(c.by, c.byName)}<div><div class="mt-cm"><b>${esc(short(c.byName))}</b><time>${ago(c.ts)}</time>${ed && (c.by === me || p.isLead) ? `<button type="button" class="pj-cdel" data-cdel="${c.id}" aria-label="Xoá bình luận">${icon('trash', 12)}</button>` : ''}</div><p>${esc(c.body).replace(/\n/g, '<br>')}</p></div></li>`).join('') || '<li class="pj-none">Chưa có bình luận.</li>'}</ol>
          ${ed ? `<form class="pj-cform"><textarea rows="2" maxlength="2000" placeholder="Viết bình luận… (Enter để gửi, Shift+Enter xuống dòng)" aria-label="Bình luận"></textarea><button type="submit" class="sx-primary">Gửi</button></form>` : ''}</section>
        ${canDel ? `<div class="mp-danger"><button type="button" class="sx-ghost danger" data-del>${icon('trash', 14)} Xoá công việc</button></div>` : ''}
      </div></article>`;
    pane.querySelector('[data-x]').onclick = () => this.closeTask();
    const patch = async (data, quiet = false) => {
      const r = await api('PATCH', `/api/projects/${this.pid}/tasks/${id}`, data);
      if (!r.ok) { this.s.toast(r.error || 'Chưa lưu được.', true); return false; }
      this.upsert(r.task); this.refreshBoard(); this.paintSum(); if (!quiet && this.taskOpen === id) this.renderTask(id, true); return true;
    };
    const ttl = pane.querySelector('.pj-ttl'), fit = () => { ttl.style.height = 'auto'; ttl.style.height = `${ttl.scrollHeight}px`; }; fit();
    ttl.addEventListener('input', fit);
    ttl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); ttl.blur(); } if (e.key === 'Escape') { ttl.value = t.title; ttl.blur(); } });
    ttl.addEventListener('change', () => { const v = ttl.value.trim(); if (v && v !== t.title) patch({ title: v }, true); else ttl.value = t.title; });
    const tb = pane.querySelector('.pj-tbody');
    tb.addEventListener('keydown', e => e.stopPropagation());
    tb.addEventListener('change', () => { if (tb.value !== t.body) patch({ body: tb.value }, true).then(ok => ok && this.s.toast('Đã lưu mô tả.')); });
    pane.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { if (b.dataset.st !== t.status) patch({ status: b.dataset.st }).then(ok => ok && b.dataset.st === 'done' && this.s.toast(`Xong: ${t.title} 🎉`)); });
    pane.querySelectorAll('[data-pr]').forEach(b => b.onclick = () => { if (+b.dataset.pr !== t.priority) patch({ priority: +b.dataset.pr }); });
    pane.querySelector('.pj-asg').onchange = e => patch({ assignee: e.target.value || null });
    pane.querySelector('.pj-nodue')?.addEventListener('click', () => patch({ due: null }));
    const dbtn = pane.querySelector('.pj-dbtn'), cal = pane.querySelector('.pj-cal');
    dbtn.onclick = () => {
      const show = cal.hidden; cal.hidden = !show; dbtn.setAttribute('aria-expanded', String(show));
      if (show && !cal._dp) cal._dp = new DatePicker(cal, { value: t.due || Date.now(), min: Date.now() - 30 * 86400e3, max: Date.now() + 365 * 86400e3, label: 'Hạn chót', onPick: d => { cal.hidden = true; patch({ due: d + DUE_H * 3600e3 }); } });
    };
    pane.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmDanger('Xoá công việc?', `"${t.title}" và các bình luận sẽ bị xoá với cả dự án.`, 'Xoá'))) return;
      const r = await api('DELETE', `/api/projects/${this.pid}/tasks/${id}`); if (!r.ok) { this.s.toast(r.error, true); return; }
      this.cur.tasks = this.cur.tasks.filter(x => x.id !== id); this.s.toast('Đã xoá công việc.'); this.closeTask(); this.refreshBoard();
    });
    pane.querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => {
      if (!(await confirmDanger('Xoá bình luận?', 'Bình luận sẽ bị xoá với cả dự án.', 'Xoá'))) return;
      const r = await api('DELETE', `/api/projects/${this.pid}/tasks/${id}/comments/${b.dataset.cdel}`); if (!r.ok) this.s.toast(r.error, true);
    });
    const cf = pane.querySelector('.pj-cform');
    if (cf) {
      const ta = cf.querySelector('textarea');
      ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); cf.requestSubmit(); } });
      cf.onsubmit = async e => {
        e.preventDefault(); const v = ta.value.trim(); if (!v) return;
        ta.disabled = true; const r = await api('POST', `/api/projects/${this.pid}/tasks/${id}/comments`, { body: v }); ta.disabled = false;
        if (!r.ok) { this.s.toast(r.error || 'Chưa gửi được.', true); return; }
        ta.value = ''; this.addComment(id, r.comment); pane.querySelector('.pj-cform textarea')?.focus();
      };
    }
  }
  addComment(tid, c) {
    if (this.tcomments?.id !== tid || this.tcomments.list.some(x => x.id === c.id)) return;
    this.tcomments.list.push(c);
    if (this.taskOpen === tid) { const typing = this.dbody?.querySelector('.pj-cform textarea')?.value; this.renderTask(tid, true).then(() => { const ta = this.dbody?.querySelector('.pj-cform textarea'); if (ta && typing) ta.value = typing; const ol = this.dbody?.querySelector('.pj-cmts ol'); ol?.lastElementChild?.scrollIntoView({ block: 'nearest' }); }); }
  }

  // ---------- chat ----------
  async renderChat() {
    const pane = this.pane; if (!pane) return;
    const ed = this.editable;
    pane.innerHTML = `<div class="pj-chat"><ol class="mt-chat" aria-live="polite"><li class="mt-empty">Đang tải…</li></ol>
      ${ed ? `<form class="mt-form pj-cf"><div class="pj-mention" role="listbox" hidden></div><input maxlength="500" autocomplete="off" placeholder="Nhắn cho cả dự án… (gõ @ để nhắc tên)" aria-label="Tin nhắn dự án"><button type="submit" aria-label="Gửi">${icon('send', 16)}</button></form>` : '<p class="pj-note">Dự án đã lưu trữ — chỉ xem lại tin nhắn.</p>'}</div>`;
    if (!this.chat) { const r = await api('GET', `/api/projects/${this.pid}/chat`); if (!this.el || this.tab !== 'chat') return; this.chat = r.ok ? r.messages.slice().sort((a, b) => a.id - b.id) : []; }
    this.paintChat(true);
    const f = pane.querySelector('.pj-cf'); if (!f) return;
    const input = f.querySelector('input'), box = f.querySelector('.pj-mention');
    const members = this.p.members.filter(m => m.key !== this.s.key);
    const mention = () => {
      const pos = input.selectionStart, m = /@([\p{L}\p{N}._-]*)$/u.exec(input.value.slice(0, pos));
      if (!m) { box.hidden = true; return; }
      const q = m[1].toLowerCase(), hits = members.filter(x => `${x.name} ${x.key}`.toLowerCase().includes(q)).slice(0, 6);
      if (!hits.length) { box.hidden = true; return; }
      box.hidden = false; box.innerHTML = hits.map((x, i) => `<div role="option" data-k="${esc(x.key)}" class="pj-mo${i ? '' : ' act'}" aria-selected="${!i}">${avatar(x.key, x.name)} ${esc(short(x.name))}</div>`).join('');
      box.querySelectorAll('[data-k]').forEach(b => b.onmousedown = e => { e.preventDefault(); pick(b.dataset.k); });
    };
    const pick = k => {
      const x = members.find(m => m.key === k); if (!x) return;
      const pos = input.selectionStart, head = input.value.slice(0, pos).replace(/@([\p{L}\p{N}._-]*)$/u, `@${short(x.name)} `);
      input.value = head + input.value.slice(pos); input.setSelectionRange(head.length, head.length); box.hidden = true; input.focus();
    };
    input.addEventListener('input', mention);
    input.addEventListener('keydown', e => {
      if (!box.hidden && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
        const bs = [...box.querySelectorAll('[data-k]')], i = bs.findIndex(b => b.classList.contains('act'));
        if (e.key === 'Escape') { box.hidden = true; return; }
        if (e.key === 'Enter' || e.key === 'Tab') { pick(bs[Math.max(0, i)].dataset.k); return; }
        const j = Math.max(0, Math.min(bs.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); bs.forEach((b, k) => b.classList.toggle('act', k === j)); return;
      }
      if (e.key !== 'Escape') e.stopPropagation();
    });
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
    f.onsubmit = e => { e.preventDefault(); const t = input.value.trim(); if (!t) return; if (!this.s.rt.connected) { this.s.toast('Mất kết nối, chưa gửi được.', true); return; } this.s.rt.send({ t: 'chat', channel: `proj:${this.pid}`, body: t }); input.value = ''; };
    if (!matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
  }
  paintChat(jump = false) {
    const ol = this.pane?.querySelector('.pj-chat .mt-chat'); if (!ol || !this.chat) return;
    const me = this.s.key, stick = jump || ol.scrollHeight - ol.scrollTop - ol.clientHeight < 80;
    const hl = s => esc(s).replace(/@([\p{L}\p{N}._-]+(?: [\p{L}\p{N}._-]+)?)/gu, '<mark>@$1</mark>');
    ol.innerHTML = this.chat.length ? this.chat.map(x => `<li class="${x.from === 'system' ? 'sys' : x.from === me ? 'me' : ''}">${x.from === 'system' ? '' : `<div class="mt-cm"><b>${esc(short(x.name))}</b><time>${vnDay(x.ts) === vnDay(Date.now()) ? hm(x.ts) : `${dayLabel(x.ts)} ${hm(x.ts)}`}</time></div>`}<p>${hl(x.body)}</p></li>`).join('')
      : '<li class="mt-empty">Kênh chat riêng của dự án — chỉ thành viên đọc được. Gõ @tên để nhắc ai đó.</li>';
    if (stick) ol.scrollTop = ol.scrollHeight;
    const last = this.chat.at(-1); if (last) this.c.markRead(this.pid, last.id);
    this.paintTabDots();
  }

  // ---------- tài liệu ----------
  renderFiles() {
    const pane = this.pane; if (!pane) return;
    const r = this.cur, p = this.p, ed = this.editable, me = this.s.key, base = `/api/projects/${p.id}`;
    const mlist = r.meetingFiles || [];
    pane.innerHTML = `<div class="pj-files">
      <div class="pj-wbcard"><span class="mp-fdic">${icon('pen', 20)}</span><span><b>Bảng vẽ của dự án</b><small>Vẽ chung trong phòng dự án — mọi thay đổi được lưu lại.</small></span><button type="button" class="sx-ghost" data-wb>${icon('arrowRight', 14)} Xem bảng vẽ</button></div>
      <div class="pj-wbv" hidden></div>
      ${ed ? `<div class="mp-up"><label class="sx-ghost">${icon('upload', 14)} Tải tài liệu lên<input type="file" multiple hidden></label><span>PDF, ảnh, Word, Excel, PowerPoint, txt · tối đa 5 MB / file</span></div>` : ''}
      <div class="nb-sec">${icon('folder', 13)} Tài liệu dự án</div>
      ${filesHtml(r.files, me, p.isLead).replaceAll('{BASE}', base).replace('Mọi người trong cuộc họp đều xem được.', 'Mọi người trong dự án đều xem được.')}
      ${mlist.length ? `<div class="nb-sec">${icon('calendar', 13)} Từ các cuộc họp của dự án</div>${mlist.map(m => `<div class="pj-mf"><div class="pj-mfh"><b>${esc(m.title)}</b><small>${esc(dayLabel(m.start))} ${hm(m.start)}–${hm(m.end)}</small></div>${filesHtml(m.files, '', false).replaceAll('{BASE}/files/', `${base}/mfiles/`)}</div>`).join('')}` : ''}
    </div>`;
    pane.querySelector('input[type=file]')?.addEventListener('change', async e => { const n = await uploadFiles(`p${p.id}`, [...e.target.files], (t, b) => this.s.toast(t, b)); e.target.value = ''; if (n) this.reload(); });
    pane.querySelectorAll('.pj-files > .mt-files [data-del]').forEach(b => b.onclick = async () => {
      if (!(await confirmDanger('Xoá tài liệu?', 'Mọi người trong dự án sẽ không xem được file này nữa.', 'Xoá'))) return;
      const x = await api('DELETE', `${base}/files/${b.dataset.del}`); if (!x.ok) this.s.toast(x.error, true); else this.reload();
    });
    pane.querySelector('[data-wb]').onclick = async e => {
      const box = pane.querySelector('.pj-wbv'), btn = e.currentTarget;
      if (!box.hidden) { box.hidden = true; this.wb?.destroy(); this.wb = null; btn.innerHTML = `${icon('arrowRight', 14)} Xem bảng vẽ`; return; }
      btn.disabled = true; const x = await api('GET', `${base}/board`); btn.disabled = false; if (!x.ok || this.tab !== 'files') return;
      box.hidden = false; btn.innerHTML = `${icon('chevUp', 14)} Ẩn bảng vẽ`;
      if (!x.board.elements.some(el => !el.isDeleted)) { box.innerHTML = `<div class="sx-empty sm">${icon('pen', 26)}<b>Bảng vẽ còn trống</b><span>Vào phòng dự án rồi bấm vào bảng trắng để vẽ cùng nhau.</span></div>`; return; }
      box.innerHTML = '<div class="mp-wbv"></div>';
      this.wb = new ExcaliBoard(box.querySelector('.mp-wbv'), { meetingId: `p${p.id}`, elements: x.board.elements, files: x.board.files, name: `bang-ve-${p.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}`, open: true });
    };
    const n = r.files.length + mlist.reduce((s, m) => s + m.files.length, 0);
    const b = this.el.querySelector('[data-tab=files] span'); if (b) b.textContent = n ? `Tài liệu (${n})` : 'Tài liệu';
  }
  /** Tải lại dữ liệu dự án (giữ thẻ đang xem). */
  async reload() {
    if (!this.pid) return;
    const r = await api('GET', `/api/projects/${this.pid}`); if (!this.el || !r.ok || r.project.id !== this.pid) return;
    this.cur = r;
    if (this.tab === 'files') this.renderFiles();
  }

  // ---------- ghi chú (kiểu Notes của macOS) ----------
  // Trái: tìm, "Ghi chú mới", danh sách (Đã ghim · Hôm nay · Hôm qua · 7 ngày qua · …), mỗi dòng: tiêu đề (dòng đầu), giờ + dòng kế.
  // Phải: ngày giờ sửa, ô soạn chữ thuần (dòng đầu to đậm = tiêu đề), ☐ danh sách việc (bấm ô để đánh dấu, Enter tự thêm ô mới),
  // ghim, xoá; tự lưu sau khi ngừng gõ. Ghi chú mới để trống mà rời đi thì tự bỏ (như Notes). Điện thoại: danh sách ↔ trang soạn.
  get notes() { return this.p.notes || (this.p.notes = []); }
  get note() { return this.notes.find(n => n.id === this.noteSel) || null; }
  renderNotes() {
    const pane = this.pane; if (!pane) return;
    const ed = this.editable, phone = matchMedia('(max-width: 760px)').matches;
    if (!this.note) this.noteSel = phone ? null : this.sortedNotes()[0]?.id ?? null;
    pane.innerHTML = `<div class="pj-nt${this.noteSel ? ' has-sel' : ''}">
      <aside class="nt-side"><div class="nt-top"><label class="ds-search nt-q">${icon('target', 14)}<input type="search" placeholder="Tìm ghi chú" aria-label="Tìm ghi chú" value="${esc(this.nq || '')}" autocomplete="off"></label>
        ${ed ? `<button type="button" class="nt-ib" data-nnew title="Ghi chú mới" aria-label="Ghi chú mới">${icon('edit', 16)}</button>` : ''}</div>
        <div class="nt-list" role="listbox" aria-label="Danh sách ghi chú"></div><p class="nt-count"></p></aside>
      <section class="nt-main" aria-live="off"></section></div>`;
    const q = pane.querySelector('.nt-q input');
    q.addEventListener('input', () => { this.nq = q.value; this.paintNoteList(); });
    q.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
    pane.querySelector('[data-nnew]')?.addEventListener('click', () => this.newNote());
    pane.querySelector('.nt-list').addEventListener('click', e => { const b = e.target.closest('[data-n]'); if (b) this.selectNote(+b.dataset.n); });
    this.paintNoteList(); this.paintNote();
  }
  sortedNotes() { return [...this.notes].sort((a, b) => (b.pinned - a.pinned) || b.updatedAt - a.updatedAt); }
  paintNoteList() {
    const box = this.pane?.querySelector('.nt-list'); if (!box) return;
    const q = (this.nq || '').trim().toLowerCase().normalize('NFC');
    const list = this.sortedNotes().filter(n => !q || n.body.toLowerCase().normalize('NFC').includes(q));
    let html = '', last = '';
    for (const n of list) {
      const g = n.pinned ? 'Đã ghim' : noteGroup(n.updatedAt);
      if (g !== last) { last = g; html += `<div class="nt-g">${n.pinned ? icon('pin', 12) : ''}${esc(g)}</div>`; }
      html += `<button type="button" class="nt-item${n.id === this.noteSel ? ' on' : ''}" data-n="${n.id}" role="option" aria-selected="${n.id === this.noteSel}"><b>${esc(noteTitle(n))}</b><span><time>${esc(noteWhen(n.updatedAt))}</time>${esc(notePreview(n))}</span></button>`;
    }
    this.put(box, html || `<p class="nt-none">${q ? 'Không có ghi chú khớp.' : this.editable ? 'Chưa có ghi chú nào.' : 'Chưa có ghi chú.'}</p>`);
    this.put(this.pane.querySelector('.nt-count'), `${this.notes.length} ghi chú`);
  }
  paintNote() {
    const main = this.pane?.querySelector('.nt-main'); if (!main) return;
    const n = this.note, ed = this.editable;
    this.pane.querySelector('.pj-nt').classList.toggle('has-sel', !!n);
    if (!n) {
      main.innerHTML = `<div class="nt-empty">${icon('edit', 30)}<p>${this.notes.length ? 'Chọn một ghi chú để xem.' : 'Ghi lại quyết định, link, thông tin môi trường test, việc cần nhớ… cho cả nhóm.'}</p>${ed ? `<button type="button" class="sx-primary" data-nnew2>${icon('plus', 15)} Ghi chú mới</button>` : ''}</div>`;
      main.querySelector('[data-nnew2]')?.addEventListener('click', () => this.newNote());
      return;
    }
    main.innerHTML = `<div class="nt-bar"><button type="button" class="nt-back" data-nback>${icon('chevLeft', 16)} Ghi chú</button><span class="nt-st" aria-live="polite"></span>
        ${ed ? `<div class="nt-tools"><button type="button" class="nt-ib" data-nchk title="Danh sách việc (⇧⌘L)" aria-label="Danh sách việc">${icon('check', 16)}</button>
          <button type="button" class="nt-ib" data-nbul title="Gạch đầu dòng" aria-label="Gạch đầu dòng"><b aria-hidden="true">•</b></button>
          <button type="button" class="nt-ib${n.pinned ? ' on' : ''}" data-npin title="${n.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'}" aria-label="${n.pinned ? 'Bỏ ghim' : 'Ghim'}" aria-pressed="${n.pinned}">${icon('pin', 16)}</button>
          <button type="button" class="nt-ib danger" data-ndel title="Xoá ghi chú" aria-label="Xoá ghi chú">${icon('trash', 16)}</button></div>` : ''}</div>
      <div class="nt-scroll"><p class="nt-date">${esc(noteLong(n.updatedAt))}</p>
        <div class="nt-ed" ${ed ? 'contenteditable="plaintext-only"' : ''} role="textbox" aria-multiline="true" aria-label="Nội dung ghi chú" spellcheck="false" data-ph="${ed ? 'Dòng đầu là tiêu đề…' : ''}"></div>
        <p class="nt-by">${n.byName ? `Sửa lần cuối: ${esc(short(n.byName))}` : ''}</p></div>`;
    const box = main.querySelector('.nt-ed'); box.textContent = n.body;
    main.querySelector('[data-nback]').onclick = () => { this.saveNotesNow(); this.dropIfEmpty(); this.noteSel = null; this.paintNote(); this.paintNoteList(); };
    if (!ed) return;
    if (box.contentEditable !== 'plaintext-only') box.contentEditable = 'true';   // (trình duyệt cũ: vẫn sửa được, Enter / dán đã tự xử lý thành chữ thuần)
    const ins = insPlain;
    box.addEventListener('keydown', e => {
      e.stopPropagation();   // (phím không tới nhân vật 3D)
      if (e.key === 'Escape') { box.blur(); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); this.toggleLine('☐ '); return; }
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const text = readNote(box), at = caretOf(box) ?? text.length, ls = text.lastIndexOf('\n', at - 1) + 1, line = text.slice(ls, at), m = LIST_RE.exec(line);
      if (m && line.trim() === m[1].trim()) { selectChars(box, ls, ls + m[1].length); document.execCommand('delete'); return; }   // (dòng chỉ có ô / gạch: thoát danh sách)
      ins('\n' + (m ? (m[1] === '☑ ' ? '☐ ' : m[1]) : ''));
    });
    box.addEventListener('paste', e => { e.preventDefault(); ins((e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n')); });
    box.addEventListener('drop', e => e.preventDefault());
    box.addEventListener('input', () => this.noteInput());
    box.addEventListener('blur', () => this.saveNotesNow());
    box.addEventListener('click', () => {   // bấm vào ô ☐/☑ ở đầu dòng: đánh dấu / bỏ đánh dấu
      const text = readNote(box), at = caretOf(box); if (at == null) return;
      const ls = text.lastIndexOf('\n', at - 1) + 1, ch = text[ls];
      if ((ch === '☐' || ch === '☑') && at - ls <= 1) { selectChars(box, ls, ls + 1); ins(ch === '☐' ? '☑' : '☐'); selectChars(box, at, at); }
    });
    main.querySelector('[data-nchk]').onclick = () => this.toggleLine('☐ ');
    main.querySelector('[data-nbul]').onclick = () => this.toggleLine('• ');
    main.querySelector('[data-npin]').onclick = async () => {
      const r = await api('PATCH', `/api/projects/${this.pid}/notes/${n.id}`, { pinned: !n.pinned }); if (!r.ok) { this.s.toast(r.error, true); return; }
      n.pinned = r.note.pinned; this.paintNote(); this.paintNoteList();
    };
    main.querySelector('[data-ndel]').onclick = async () => {
      if (!(await confirmDanger('Xoá ghi chú?', `"${noteTitle(n)}" sẽ bị xoá với mọi người trong dự án. Không hoàn tác được.`, 'Xoá'))) return;
      clearTimeout(this.noteT); this.noteDirty = null;
      const r = await api('DELETE', `/api/projects/${this.pid}/notes/${n.id}`); if (!r.ok) { this.s.toast(r.error, true); return; }
      this.removeNote(n.id);
    };
  }
  /** Bật / tắt tiền tố (☐ danh sách việc, • gạch đầu dòng) cho các dòng đang chọn. */
  toggleLine(prefix) {
    const box = this.pane?.querySelector('.nt-ed'); if (!box) return;
    box.focus();
    const text = readNote(box), s = getSelection(), r = s.rangeCount ? s.getRangeAt(0) : null;
    const a = caretOf(box) ?? text.length, b = r ? a + r.toString().length : a;
    const ls = text.lastIndexOf('\n', a - 1) + 1, le = (i => i < 0 ? text.length : i)(text.indexOf('\n', b));
    const block = text.slice(ls, le).split('\n'), on = block.every(l => l.startsWith(prefix) || (prefix === '☐ ' && l.startsWith('☑ ')));
    const out = block.map(l => on ? l.replace(LIST_RE, '') : prefix + l.replace(LIST_RE, '')).join('\n');
    selectChars(box, ls, le); insPlain(out);
  }
  noteInput() {
    const n = this.note, box = this.pane?.querySelector('.nt-ed'); if (!n || !box) return;
    n.body = readNote(box); this.noteDirty = { pid: this.pid, nid: n.id };
    const st = this.pane.querySelector('.nt-st'); if (st) st.textContent = 'Đang gõ…';
    clearTimeout(this.noteT); this.noteT = setTimeout(() => this.saveNotesNow(), 700);
    clearTimeout(this.noteLT); this.noteLT = setTimeout(() => this.paintNoteList(), 250);
  }
  /** Lưu ngay ghi chú đang sửa (rời thẻ, đổi ghi chú, đóng bảng, sau khi ngừng gõ). */
  async saveNotesNow() {
    clearTimeout(this.noteT); const d = this.noteDirty; if (!d || d.nid < 0) return;   // (ghi chú đang được tạo: lưu khi có mã thật)
    this.noteDirty = null;
    const n = this.cur?.project.id === d.pid ? this.notes.find(x => x.id === d.nid) : null; if (!n) return;
    const sent = n.body, r = await api('PATCH', `/api/projects/${d.pid}/notes/${d.nid}`, { body: sent });
    const st = this.pid === d.pid && this.noteSel === d.nid && this.pane?.querySelector('.nt-st');
    if (!r.ok) { if (!this.noteDirty) this.noteDirty = d; if (st) st.textContent = r.error || 'Chưa lưu được — thử lại sau.'; return; }
    Object.assign(n, { updatedAt: r.note.updatedAt, by: r.note.by, byName: r.note.byName });
    if (st) { st.textContent = `Đã lưu · ${hm(r.note.updatedAt)}`; const dt = this.pane.querySelector('.nt-date'); if (dt) dt.textContent = noteLong(r.note.updatedAt); }
    this.paintNoteList();
  }
  /** Ghi chú mới: hiện + đặt con trỏ NGAY (bản tạm trên máy), tạo trên server song song — gõ liền không mất chữ. */
  async newNote() {
    if (!this.editable || this.creating) return;
    this.saveNotesNow(); this.dropIfEmpty();
    const pid = this.pid, now = Date.now(), tmp = { id: -now, body: '', pinned: false, createdAt: now, updatedAt: now, by: this.s.key, byName: '' };
    this.notes.push(tmp); this.noteSel = tmp.id; this.nq = '';
    const q = this.pane?.querySelector('.nt-q input'); if (q) q.value = '';
    this.paintNoteList(); this.paintNote(); this.pane?.querySelector('.nt-ed')?.focus();
    this.creating = true;
    const r = await api('POST', `/api/projects/${pid}/notes`, { body: '' }).finally(() => { this.creating = false; });
    if (this.pid !== pid) return;
    if (!r.ok) { this.s.toast(r.error, true); this.removeNote(tmp.id); return; }
    const tid = tmp.id;
    this.p.notes = this.notes.filter(x => x.id !== r.note.id);   // (tin realtime của chính mình có thể tới trước)
    Object.assign(tmp, { id: r.note.id, createdAt: r.note.createdAt, updatedAt: r.note.updatedAt, byName: r.note.byName });
    if (this.noteSel === tid) this.noteSel = tmp.id;
    if (this.noteDirty?.nid === tid) this.noteDirty.nid = tmp.id;
    this.mineEmpty = tmp.id;
    if (tmp.body) { this.noteDirty = { pid, nid: tmp.id }; this.saveNotesNow(); }   // (đã gõ trong lúc chờ: lưu luôn)
    this.paintNoteList();
  }
  async selectNote(id) {
    if (id === this.noteSel) return;
    await this.saveNotesNow(); this.dropIfEmpty();
    this.noteSel = id; this.paintNoteList(); this.paintNote();
  }
  /** Ghi chú mới mình vừa tạo mà còn trống: rời đi thì bỏ (như Notes của macOS). */
  dropIfEmpty() {
    const id = this.mineEmpty; this.mineEmpty = null;
    const n = id && this.notes.find(x => x.id === id); if (!n || n.body.trim()) return;
    this.removeNote(id, true); api('DELETE', `/api/projects/${this.pid}/notes/${id}`);
  }
  removeNote(id, quiet = false) {
    this.p.notes = this.notes.filter(x => x.id !== id);
    if (this.noteSel === id) this.noteSel = matchMedia('(max-width: 760px)').matches ? null : this.sortedNotes()[0]?.id ?? null;
    if (this.tab === 'notes' && this.pane?.querySelector('.pj-nt')) { this.paintNoteList(); if (!quiet || !this.note) this.paintNote(); }
  }

  // ---------- thành viên ----------
  async renderPeople() {
    const pane = this.pane; if (!pane) return;
    const p = this.p, me = this.s.key, lead = p.isLead && p.status === 'active', online = new Set(this.cur.online || []), here = new Set((this.cur.inRoom || []).map(x => x.key));
    pane.innerHTML = `<div class="pj-people">
      ${lead ? `<div class="pj-addp"><b>${icon('plus', 14)} Thêm thành viên</b><div class="pj-pickhost"></div><button type="button" class="sx-primary" data-addp disabled>Thêm vào dự án</button></div>` : ''}
      <ul class="mt-people">${p.members.map(m => `<li>${avatar(m.key, m.name, m.role === 'lead' ? 'host' : '')}<span><b>${esc(m.name)}${m.key === me ? ' (bạn)' : ''}</b>
        <small>${m.role === 'lead' ? '<em class="pj-tag lead">Trưởng dự án</em> ' : ''}${here.has(m.key) ? '<em class="in">Đang trong phòng dự án</em>' : online.has(m.key) ? '<em class="on">Đang online</em>' : 'Offline'}</small></span>
        <span class="pj-pa">${lead && m.key !== me ? `<button type="button" class="sx-ghost" data-role="${esc(m.key)}" data-to="${m.role === 'lead' ? 'member' : 'lead'}">${m.role === 'lead' ? 'Bỏ vai Trưởng' : 'Làm Trưởng dự án'}</button><button type="button" class="sx-icon danger" data-rm="${esc(m.key)}" aria-label="Xoá ${esc(m.name)} khỏi dự án" title="Xoá khỏi dự án">${icon('close', 14)}</button>` : ''}</span></li>`).join('')}</ul>
      ${p.isMember ? `<div class="mp-danger"><button type="button" class="sx-ghost danger" data-leave>${icon('logout', 14)} Rời dự án</button><small>${p.role === 'lead' && p.members.filter(m => m.role === 'lead').length === 1 && p.members.length > 1 ? 'Bạn là Trưởng dự án duy nhất — rời đi thì người vào dự án sớm nhất sẽ làm Trưởng.' : 'Bạn sẽ không xem được dự án nữa cho tới khi được mời lại.'}</small></div>` : ''}
    </div>`;
    pane.querySelectorAll('[data-role]').forEach(b => b.onclick = async () => { const r = await api('PATCH', `/api/projects/${p.id}/members/${encodeURIComponent(b.dataset.role)}`, { role: b.dataset.to }); if (!r.ok) this.s.toast(r.error, true); });
    pane.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
      const m = p.members.find(x => x.key === b.dataset.rm);
      if (!(await confirmDanger('Xoá khỏi dự án?', `${m.name} sẽ không xem được dự án nữa. Việc đang giao cho người này sẽ thành "Chưa giao".`, 'Xoá khỏi dự án'))) return;
      const r = await api('DELETE', `/api/projects/${p.id}/members/${encodeURIComponent(m.key)}`); if (!r.ok) this.s.toast(r.error, true);
    });
    pane.querySelector('[data-leave]')?.addEventListener('click', async () => {
      if (!(await confirmDanger('Rời dự án?', `Bạn sẽ không xem được "${p.name}" nữa cho tới khi được mời lại.`, 'Rời dự án'))) return;
      const r = await api('DELETE', `/api/projects/${p.id}/members/${encodeURIComponent(me)}`); if (!r.ok) { this.s.toast(r.error, true); return; }
      this.s.toast(`Đã rời dự án ${p.name}.`); this.showList();
    });
    if (lead) {
      const people = await this.loadPeople(); if (!this.el || this.tab !== 'people') return;
      const picked = new Map(), btn = pane.querySelector('[data-addp]');
      this.picker(pane.querySelector('.pj-pickhost'), { people, picked, skip: new Set(p.members.map(m => m.key)), max: 49 - p.members.length + 1, onChange: n => { btn.disabled = !n; btn.textContent = n ? `Thêm ${n} người vào dự án` : 'Thêm vào dự án'; } });
      btn.onclick = async () => { btn.disabled = true; const r = await api('POST', `/api/projects/${p.id}/members`, { keys: [...picked.keys()] }); if (!r.ok) { btn.disabled = false; this.s.toast(r.error, true); return; } this.s.toast(`Đã thêm ${r.added} người — họ được báo ngay.`); };
    }
  }

  // ---------- cài đặt (Trưởng dự án) ----------
  renderSettings() {
    const pane = this.pane; if (!pane) return;
    const p = this.p; let color = p.color;
    pane.innerHTML = `<div class="pj-set">${p.status === 'active' ? `<div class="pj-logo-set"><span class="pj-logo-prev">${projectMark(p, 'lg')}</span>
        <div><b>Logo dự án</b><small>Hiện ở danh sách dự án, đầu trang và thẻ dự án. Ảnh PNG / JPG / WebP, tự cắt vuông và thu nhỏ.</small>
          <div class="pj-logo-acts"><label class="sx-ghost pj-logo-up">${icon('upload', 14)} ${p.logoV ? 'Đổi logo' : 'Tải logo lên'}<input type="file" accept="image/png,image/jpeg,image/webp" data-logo></label>${p.logoV ? `<button type="button" class="sx-ghost danger" data-nologo>${icon('trash', 14)} Gỡ logo</button>` : ''}</div></div></div>
      <form class="pj-form" novalidate>
        <label class="sx-field"><span>Tên dự án <i>*</i></span><input name="name" maxlength="80" required value="${esc(p.name)}"></label>
        <label class="sx-field"><span>Mô tả</span><textarea name="description" rows="3" maxlength="1000">${esc(p.description)}</textarea></label>
        <div class="sx-field"><span>Màu</span>${this.colors(color)}</div>
        <p class="sx-err" role="alert"></p><div class="sx-acts"><button type="submit" class="sx-primary">Lưu thay đổi</button></div></form>` : ''}
      <div class="pj-zone"><div><b>${p.status === 'active' ? 'Lưu trữ dự án' : 'Khôi phục dự án'}</b><small>${p.status === 'active' ? 'Dự án đã xong: cất vào "Đã lưu trữ" — mọi người vẫn xem lại được nhưng không sửa, không vào phòng.' : 'Đưa dự án về "Đang làm" để tiếp tục.'}</small></div><button type="button" class="sx-ghost" data-arch>${icon('folder', 14)} ${p.status === 'active' ? 'Lưu trữ' : 'Khôi phục'}</button></div>
      <div class="pj-zone danger"><div><b>Xoá dự án</b><small>Xoá công việc, bình luận, chat, tài liệu, bảng vẽ của dự án với mọi người. Không hoàn tác được.</small></div><button type="button" class="sx-ghost danger" data-purge>${icon('trash', 14)} Xoá dự án</button></div></div>`;
    const f = pane.querySelector('form');
    if (f) {
      f.querySelectorAll('input,textarea').forEach(x => x.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); }));
      this.bindColors(f, c => { color = c; });
      f.onsubmit = async e => { e.preventDefault(); const r = await api('PATCH', `/api/projects/${p.id}`, { name: f.name.value, description: f.description.value, color }); if (!r.ok) { f.querySelector('.sx-err').textContent = r.error; return; } this.s.toast('Đã lưu.'); };
    }
    pane.querySelector('[data-logo]')?.addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const lbl = pane.querySelector('.pj-logo-up'); lbl.classList.add('busy');
      try {
        const { type, data } = await squareImage(f, 256);
        const r = await api('PUT', `/api/projects/${p.id}/logo`, { type, data });
        if (!r.ok) { this.s.toast(r.error, true); return; }
        p.logoV = r.logoV; this.s.toast('Đã cập nhật logo dự án.'); this.renderHead(); this.renderSettings(); this.c.load();
      } catch { this.s.toast('Không đọc được ảnh này — thử ảnh PNG hoặc JPG khác.', true); }
      finally { lbl.classList.remove('busy'); }
    });
    pane.querySelector('[data-nologo]')?.addEventListener('click', async () => {
      const r = await api('DELETE', `/api/projects/${p.id}/logo`); if (!r.ok) { this.s.toast(r.error, true); return; }
      p.logoV = null; this.s.toast('Đã gỡ logo.'); this.renderHead(); this.renderSettings(); this.c.load();
    });
    pane.querySelector('[data-arch]').onclick = async () => {
      const arch = p.status === 'active';
      if (arch && !(await confirmDanger('Lưu trữ dự án?', `"${p.name}" chuyển sang "Đã lưu trữ": chỉ xem, không sửa. Khôi phục lại được bất cứ lúc nào.`, 'Lưu trữ'))) return;
      const r = await api('PATCH', `/api/projects/${p.id}`, { archived: arch }); if (!r.ok) { this.s.toast(r.error, true); return; }
      this.s.toast(arch ? 'Đã lưu trữ dự án.' : 'Đã khôi phục dự án.');
    };
    pane.querySelector('[data-purge]').onclick = async () => {
      if (!(await confirmDanger('Xoá dự án vĩnh viễn?', `"${p.name}": mọi công việc, bình luận, tin nhắn, tài liệu, bảng vẽ sẽ bị xoá với tất cả ${p.members.length} thành viên. Không hoàn tác được.`, 'Xoá vĩnh viễn'))) return;
      const r = await api('DELETE', `/api/projects/${p.id}`); if (!r.ok) { this.s.toast(r.error, true); return; }
      this.s.toast('Đã xoá dự án.'); this.showList();
    };
  }

  // ---------- cập nhật từ server ----------
  onList() { this.renderSide(); if (this.view === 'list') { this.renderList(); this.loadMine(); } else this.paintTabDots(); }
  async onChanged(id) {
    if (this.pid !== id || this.view !== 'project') return;
    const r = await api('GET', `/api/projects/${id}`); if (!this.el || this.pid !== id) return;
    if (!r.ok) { this.onRemoved(id); return; }
    const notes = this.p?.notes;   // (ghi chú: giữ bản trên máy — đang gõ dở; ghi chú của người khác tới qua proj:notes)
    this.cur = r; if (notes) this.p.notes = notes;
    if (this.drag?.active) return;
    const keepTab = this.tab, typing = document.activeElement && this.el.contains(document.activeElement) && (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable);
    if (typing && (keepTab === 'chat' || keepTab === 'notes' || keepTab === 'settings' || this.taskOpen)) return;   // (đang gõ: không vẽ lại — lần sau mở thẻ sẽ có dữ liệu mới)
    this.renderProject();
  }
  onRemoved(id) { if (this.pid === id && this.el) { this.s.toast('Bạn không còn xem được dự án này.', true); this.showList(); } }
  /** Dải số liệu của dự án: tiến độ, số việc từng cột, quá hạn, việc của tôi. */
  paintSum() {
    const box = this.el?.querySelector('.pj-sum'); if (!box || !this.cur) return;
    const ts = this.cur.tasks, n = k => ts.filter(t => t.status === k).length, total = ts.length, done = n('done'), pct = total ? Math.round(done / total * 100) : 0, now = Date.now();
    const over = ts.filter(t => t.status !== 'done' && t.due && t.due < now).length, mine = ts.filter(t => t.status !== 'done' && t.assignee === this.s.key).length;
    box.innerHTML = `<div class="pj-prog2" title="${done}/${total} việc xong"><b>${pct}%</b><span><i style="width:${pct}%"></i></span><small>${done}/${total} xong</small></div>
      ${COLS.map(([k, name]) => `<span class="pj-st"><i class="pj-cd ${k}"></i><b>${n(k)}</b> ${name.toLowerCase()}</span>`).join('')}
      <span class="pj-st me"><b>${mine}</b> việc của bạn</span>${over ? `<span class="pj-st bad">${icon('clock', 12)} <b>${over}</b> quá hạn</span>` : ''}`;
  }
  /** Vẽ lại bảng Kanban (phía sau ngăn chi tiết) — trừ khi đang kéo thẻ / đang gõ việc mới. */
  refreshBoard() {
    if (this.view !== 'project' || this.tab !== 'tasks' || this.drag?.active || !this.pane) return;
    if (this.el.querySelector('.pj-addf textarea') === document.activeElement) return;
    const sc = this.body.scrollTop, bl = this.el.querySelector('.pj-board')?.scrollLeft || 0;
    this.renderTasks(); this.body.scrollTop = sc; const nb = this.el.querySelector('.pj-board'); if (nb) nb.scrollLeft = bl;
  }
  onTask(m) {
    if (this.pid !== m.id || !this.cur) return;
    if (m.kind === 'del') this.cur.tasks = this.cur.tasks.filter(t => t.id !== m.taskId); else this.upsert(m.task);
    this.refreshBoard(); this.renderHead(); this.paintSum();
    if (this.taskOpen === m.taskId && m.by !== this.s.key) {
      if (m.kind === 'del') { this.s.toast('Công việc này vừa bị xoá.', true); this.closeTask(); return; }
      if (!this.dbody?.contains(document.activeElement)) this.renderTask(m.taskId, true);
    }
  }
  onComment(m) {
    if (this.pid !== m.id || !this.cur) return;
    const t = this.cur.tasks.find(x => x.id === m.taskId); if (t) t.comments = m.count;
    if (m.comment) this.addComment(m.taskId, m.comment);
    else if (m.removed && this.tcomments?.id === m.taskId) { this.tcomments.list = this.tcomments.list.filter(c => c.id !== m.removed); if (this.taskOpen === m.taskId) this.renderTask(m.taskId, true); }
  }
  onFiles(id) { if (this.pid === id && this.tab === 'files') this.reload(); }
  onNotes(m) {
    if (this.pid !== m.id || !this.cur) return;
    if (m.removed) { if (this.noteDirty?.nid === m.removed) { this.noteDirty = null; clearTimeout(this.noteT); } this.removeNote(m.removed); if (this.noteSel == null && this.tab === 'notes') this.paintNote(); return; }
    const n = m.note; if (!n) return;
    const cur = this.notes.find(x => x.id === n.id);
    if (m.by === this.s.key && (cur || this.creating)) return;   // (của chính mình: đã có trên máy / đang tạo)
    const editing = this.noteSel === n.id && (this.noteDirty?.nid === n.id || document.activeElement === this.pane?.querySelector('.nt-ed'));
    if (cur && editing) {   // đang sửa cùng ghi chú: giữ bản đang gõ, báo có bản mới (lưu tiếp sẽ ghi đè)
      Object.assign(cur, { pinned: n.pinned }); const st = this.pane.querySelector('.nt-st'); if (st) st.textContent = `${short(n.byName)} cũng vừa sửa ghi chú này`;
    } else if (cur) Object.assign(cur, n); else this.notes.push(n);
    if (this.tab !== 'notes' || !this.pane?.querySelector('.pj-nt')) return;
    this.paintNoteList();
    if (this.noteSel === n.id && !editing) this.paintNote();
    else if (this.noteSel == null && !matchMedia('(max-width: 760px)').matches) { this.noteSel = n.id; this.paintNote(); }
  }
  onChat(id, msg) {
    if (this.pid !== id || !this.chat) return;
    if (this.chat.some(x => x.id === msg.id)) return;
    this.chat.push(msg); if (this.chat.length > 300) this.chat.shift();
    if (this.tab === 'chat' && this.view === 'project') this.paintChat();
  }
}
