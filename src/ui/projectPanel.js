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
      back.innerHTML = `<div class="sx pj" role="dialog" aria-modal="true" aria-labelledby="pjTitle">
        <header class="sx-h pj-h"></header><nav class="sx-tabs pj-nav" role="tablist"></nav>
        <div class="sx-body pj-body" tabindex="-1"></div></div>`;
      document.body.appendChild(back); overlayOn();
      requestAnimationFrame(() => back.classList.add('show'));
      back.addEventListener('click', e => { if (e.target === back) this.close(); });
      back.querySelector('.pj-h').addEventListener('click', e => {
        const b = e.target.closest('[data-h]'); if (!b) return;
        ({ close: () => this.close(), new: () => this.form(), back: () => this.showList(), room: () => this.c.join(this.pid), meet: () => this.bookMeeting() })[b.dataset.h]?.();
      });
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
    this.saveNotesNow(); this.wb?.destroy(); this.wb = null;
    this.el = null; this.cur = null; this.view = null; this.taskOpen = null; this.drag = null;
    window.removeEventListener('keydown', this._key, true); overlayOff();
    el.classList.remove('show'); setTimeout(() => el.remove(), 200);
  }
  setMode(mode) { this.view = mode; this.renderHead(); }
  /** Đầu trang + thanh thẻ theo màn đang xem. */
  renderHead() {
    const h = this.el?.querySelector('.pj-h'), nav = this.el?.querySelector('.pj-nav'); if (!h) return;
    const x = `<button type="button" class="sx-x" data-h="close" aria-label="Đóng">${icon('close', 16)}</button>`;
    if (this.view === 'project' && this.cur) {
      const p = this.p, open = this.cur.tasks.filter(t => t.status !== 'done').length, here = (this.cur.inRoom || []).length;
      h.innerHTML = `<button type="button" class="sx-icon pj-hb" data-h="back" aria-label="Tất cả dự án" title="Tất cả dự án">${icon('chevLeft', 18)}</button>
        <span class="pj-hic" style="--pc:${esc(p.color)}">${esc(p.name.trim().slice(0, 1).toUpperCase())}</span>
        <div><h2 id="pjTitle">${esc(p.name)}${p.status === 'archived' ? ' <em class="pj-tag">Đã lưu trữ</em>' : ''}</h2>
          <p>${p.description ? `${esc(p.description)} · ` : ''}${p.members.length} thành viên · ${open} việc đang mở${here ? ` · <b class="pj-live">${here} người trong phòng</b>` : ''}</p></div>
        <span class="mp-avs pj-havs">${p.members.slice(0, 5).map(m => avatar(m.key, m.name, m.role === 'lead' ? 'host' : '')).join('')}${p.members.length > 5 ? `<span class="mt-av more">+${p.members.length - 5}</span>` : ''}</span>
        ${p.status === 'active' ? `<button type="button" class="sx-ghost pj-hmeet" data-h="meet" title="Đặt phòng họp cho cả dự án">${icon('calendar', 15)} <span>Đặt họp</span></button>
        <button type="button" class="sx-primary pj-hroom" data-h="room" title="Vào phòng dự án 3D: bảng vẽ chung, họp video, chia sẻ màn hình">${icon('door', 15)} <span>Vào phòng</span></button>` : ''}${x}`;
      const tabs = [['tasks', 'check', 'Công việc'], ['chat', 'chat', 'Chat'], ['files', 'folder', 'Tài liệu'], ['notes', 'edit', 'Ghi chú'], ['people', 'users', 'Thành viên'], ...(p.isLead ? [['settings', 'key', 'Cài đặt']] : [])];
      nav.hidden = false;
      nav.innerHTML = tabs.map(([k, ic, n]) => `<button type="button" role="tab" data-tab="${k}" class="${k === this.tab ? 'on' : ''}" aria-selected="${k === this.tab}">${icon(ic, 14)} <span>${n}</span><i class="pj-dot" hidden></i></button>`).join('');
      this.paintTabDots();
      return;
    }
    h.innerHTML = `<span class="sx-ic">${icon('grid', 22)}</span><div><h2 id="pjTitle">${this.view === 'form' ? 'Dự án mới' : 'Dự án'}</h2><p>${this.view === 'form' ? 'Đặt tên, chọn màu, mời đồng đội — bạn là Trưởng dự án.' : 'Không gian làm việc của nhóm: công việc, chat, tài liệu, phòng họp riêng'}</p></div>
      ${this.view === 'list' ? `<button type="button" class="sx-primary" data-h="new">${icon('plus', 15)} <span>Dự án mới</span></button>` : ''}${x}`;
    nav.hidden = this.view !== 'list';
    nav.innerHTML = [['active', 'Đang làm'], ['archived', 'Đã lưu trữ']].map(([k, n]) => { const c = this.c.list.filter(p => p.status === k).length; return `<button type="button" role="tab" data-f="${k}" class="${k === this.filter ? 'on' : ''}" aria-selected="${k === this.filter}">${n}${c ? ` <em class="mt-cnt">${c}</em>` : ''}</button>`; }).join('');
  }

  // ---------- danh sách ----------
  showList() {
    if (!this.el) return;
    this.saveNotesNow(); this.wb?.destroy(); this.wb = null; this.cur = null; this.taskOpen = null; this.chat = null;
    this.setMode('list'); this.renderList(); this.c.load();
  }
  renderList() {
    const body = this.body; if (!body || this.view !== 'list') return;
    const all = this.c.list, list = all.filter(p => p.status === this.filter);
    const ceo = this.s.isAdmin && all.some(p => !p.isMember);
    body.innerHTML = list.length ? `${ceo ? `<p class="pj-note">${icon('info', 14)} Bạn là CEO: thấy mọi dự án của công ty (dự án bạn không tham gia có nhãn "CEO xem").</p>` : ''}<div class="pj-grid">${list.map(p => this.card(p)).join('')}</div>`
      : this.filter === 'active' ? `<div class="pj-start"><div class="pj-start-ic">${icon('grid', 30)}</div><h3>Làm việc nhóm ngay trong văn phòng</h3><p>Mỗi dự án là một không gian riêng của nhóm — chỉ thành viên mới thấy.</p>
          <ol class="pj-steps"><li><b>1</b><span><strong>Tạo dự án</strong>Đặt tên, chọn màu — bạn là Trưởng dự án.</span></li><li><b>2</b><span><strong>Mời đồng đội</strong>Tìm theo tên hoặc thêm cả phòng ban.</span></li><li><b>3</b><span><strong>Chia việc &amp; làm cùng nhau</strong>Bảng Kanban, chat riêng, tài liệu, phòng họp 3D.</span></li></ol>
          <button type="button" class="sx-primary" data-new>${icon('plus', 15)} Tạo dự án đầu tiên</button></div>`
        : `<div class="sx-empty">${icon('folder', 34)}<b>Chưa có dự án lưu trữ</b><span>Dự án đã xong: Trưởng dự án vào Cài đặt → "Lưu trữ" để cất đi (vẫn xem lại được).</span></div>`;
    body.querySelector('[data-new]')?.addEventListener('click', () => this.form());
    body.querySelectorAll('[data-p]').forEach(b => b.onclick = () => this.load(+b.dataset.p));
  }
  card(p) {
    const un = this.c.unread(p), c = p.counts, open = c.todo + c.doing, total = open + c.done;
    return `<button type="button" class="pj-pc" data-p="${p.id}" style="--pc:${esc(p.color)}">
      <span class="pj-pct"><b>${esc(p.name)}</b>${un ? '<i class="pj-dot" title="Có tin nhắn mới"></i>' : ''}</span>
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
      res.innerHTML = hits.length ? hits.map((p, i) => `<li role="option" data-k="${esc(p.key)}" class="${i ? '' : 'act'}">${avatar(p.key, p.name)}<span><b>${esc(p.name)}</b><small>${esc(p.department || '—')}${p.online ? ' · <em>đang online</em>' : ''}</small></span></li>`).join('') : '<li class="none">Không tìm thấy ai.</li>';
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
      <button type="button" class="sx-back-link">${icon('chevLeft', 15)} Tất cả dự án</button>
      <h3>Dự án mới</h3>
      <label class="sx-field"><span>Tên dự án <i>*</i></span><input name="name" maxlength="80" required placeholder="Ví dụ: Website SYSONE 2027"></label>
      <label class="sx-field"><span>Mô tả</span><textarea name="description" rows="3" maxlength="1000" placeholder="Mục tiêu, phạm vi, link quan trọng…"></textarea></label>
      <div class="sx-field"><span>Màu</span>${this.colors(color)}</div>
      <div class="sx-field"><span>Thành viên <small class="pj-cnt">(bạn là Trưởng dự án)</small></span><div class="pj-pickhost"></div></div>
      <p class="sx-err" role="alert"></p>
      <div class="sx-acts"><button type="button" class="sx-ghost" data-cancel>Huỷ</button><button type="submit" class="sx-primary">${icon('plus', 15)} Tạo dự án</button></div></form>`;
    const f = body.querySelector('form');
    body.querySelector('.sx-back-link').onclick = f.querySelector('[data-cancel]').onclick = () => this.showList();
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
    if (!same) { this.saveNotesNow(); this.wb?.destroy(); this.wb = null; this.chat = null; this.taskOpen = null; this.tab = tab || 'tasks'; }
    else if (tab) this.tab = tab;
    this.setMode('project');
    if (!same) this.body.innerHTML = '<div class="sx-loading">Đang tải…</div>';
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
    this.renderHead();
    body.innerHTML = `<div class="pj-view" style="--pc:${esc(p.color)}">
      ${next.length ? `<div class="pj-meets">${icon('calendar', 14)}<span>Họp sắp tới:</span>${next.map(m => `<span class="pj-meet"><b>${esc(m.title)}</b> · ${esc(dayLabel(m.start))} ${hm(m.start)}–${hm(m.end)}</span>`).join('')}</div>` : ''}
      <div class="pj-pane"></div></div>`;
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
    this.saveNotesNow(); this.wb?.destroy(); this.wb = null;
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
      this.upsert(r.task); ta.value = ''; ta.focus();
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
    const before = { ...t }; Object.assign(t, { status, order: o, doneAt: status === 'done' ? Date.now() : null });
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
      this.upsert(r.task); this.refreshBoard(); if (!quiet && this.taskOpen === id) this.renderTask(id, true); return true;
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

  // ---------- ghi chú ----------
  renderNotes() {
    const pane = this.pane; if (!pane) return;
    const p = this.p, ed = this.editable;
    pane.innerHTML = `<div class="pj-notes"><textarea class="pj-nta" maxlength="20000" placeholder="${ed ? 'Ghi chú chung của dự án: quyết định, link, thông tin đăng nhập môi trường test, việc cần nhớ… (tự lưu)' : ''}" ${ed ? '' : 'readonly'}>${esc(p.notes)}</textarea>
      <small class="pj-nst">${p.notesAt ? `Sửa lần cuối: ${esc(short(p.notesBy))} · ${ago(p.notesAt)}` : ed ? 'Ai trong dự án cũng sửa được — tự lưu sau khi ngừng gõ.' : ''}</small></div>`;
    const ta = pane.querySelector('.pj-nta');
    ta.addEventListener('keydown', e => e.stopPropagation());
    ta.addEventListener('input', () => { this.notesDirty = true; pane.querySelector('.pj-nst').textContent = 'Đang gõ…'; clearTimeout(this.notesT); this.notesT = setTimeout(() => this.saveNotesNow(), 1200); });
    ta.addEventListener('blur', () => this.saveNotesNow());
  }
  async saveNotesNow() {
    clearTimeout(this.notesT); if (!this.notesDirty || !this.pid) return;
    const ta = this.pane?.querySelector('.pj-nta'); if (!ta) { this.notesDirty = false; return; }
    this.notesDirty = false; const pid = this.pid, v = ta.value;
    const r = await api('PUT', `/api/projects/${pid}/notes`, { notes: v });
    const st = this.pid === pid && this.pane?.querySelector('.pj-nst');
    if (!r.ok) { this.notesDirty = true; if (st) st.textContent = r.error || 'Chưa lưu được — thử lại sau.'; return; }
    if (this.pid === pid) Object.assign(this.p, { notes: r.notes, notesBy: r.notesBy, notesAt: r.notesAt });
    if (st) st.textContent = `Đã lưu · ${hm(r.notesAt)}`;
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
    pane.innerHTML = `<div class="pj-set">${p.status === 'active' ? `<form class="pj-form" novalidate>
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
  onList() { if (this.view === 'list') this.renderList(); else this.paintTabDots(); }
  async onChanged(id) {
    if (this.pid !== id || this.view !== 'project') return;
    const r = await api('GET', `/api/projects/${id}`); if (!this.el || this.pid !== id) return;
    if (!r.ok) { this.onRemoved(id); return; }
    const notes = this.notesDirty ? this.p.notes : null;
    this.cur = r; if (notes != null) this.p.notes = notes;
    if (this.drag?.active) return;
    const keepTab = this.tab, typing = document.activeElement && this.el.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (typing && (keepTab === 'chat' || keepTab === 'notes' || keepTab === 'settings' || this.taskOpen)) return;   // (đang gõ: không vẽ lại — lần sau mở thẻ sẽ có dữ liệu mới)
    this.renderProject();
  }
  onRemoved(id) { if (this.pid === id && this.el) { this.s.toast('Bạn không còn xem được dự án này.', true); this.showList(); } }
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
    this.refreshBoard(); this.renderHead();
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
    if (m.by === this.s.key) return;
    Object.assign(this.p, { notes: m.notes, notesBy: m.notesBy, notesAt: m.notesAt });
    const ta = this.pane?.querySelector('.pj-nta');
    if (ta && this.tab === 'notes' && !this.notesDirty && document.activeElement !== ta) { ta.value = m.notes; this.pane.querySelector('.pj-nst').textContent = `${short(m.notesBy)} vừa sửa · ${hm(m.notesAt)}`; }
  }
  onChat(id, msg) {
    if (this.pid !== id || !this.chat) return;
    if (this.chat.some(x => x.id === msg.id)) return;
    this.chat.push(msg); if (this.chat.length > 300) this.chat.shift();
    if (this.tab === 'chat' && this.view === 'project') this.paintChat();
  }
}
