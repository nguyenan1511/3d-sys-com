// Phòng họp (kiểu agent-office): vào phòng là thấy cảnh 3D (src/rooms/meetingRoom.js) — mọi người ngồi quanh bàn họp, bảng
// trắng trên tường hiện nét vẽ thật. Thanh trên: tên cuộc họp, giờ, còn bao lâu, người trong phòng, "Bảng & nội dung",
// "Kết thúc họp" (host), "Rời phòng".
// Bấm vào bảng trắng (hoặc nút "Bảng & nội dung") → bảng vẽ chung Excalidraw (src/ui/excaliBoard.js) chiếm phần lớn màn hình, cột phải
// có thanh thẻ ở trên: Chat (kênh riêng của cuộc họp) · Tài liệu (tải lên / mở / tải về, lưu bảng vẽ) · Thành viên; cảnh 3D thu
// thành khung nhỏ ở góc trái dưới — kéo để dời chỗ (nhớ vị trí), bấm để phóng to lại.
// Điện thoại: Chat / Tài liệu / Thành viên là các thẻ trong tấm trượt từ dưới lên.
import { api } from '../net/api.js';
import { esc, confirmDanger } from '../session/ui.js';
import { icon } from './icons.js';
import { MeetingRoom } from '../rooms/meetingRoom.js';
import { ExcaliBoard } from './excaliBoard.js';
import { avatar, filesHtml, uploadFiles } from './meetPanel.js';
import { hm } from '../session/meetings.js';

const PIP_KEY = 'sysone.meetPip';
const narrow = () => matchMedia('(max-width: 760px)').matches;
const fmtLeft = ms => { const m = Math.max(0, Math.ceil(ms / 60e3)); return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60 ? `${m % 60} phút` : ''}` : `${m} phút`; };

export class MeetRoom {
  constructor(ctl, st) {
    this.c = ctl; this.s = ctl.s; this.m = st.meeting; this.id = st.id; this.inRoom = st.members; this.chat = []; this.files = []; this.tab = 'chat'; this.unread = 0;
    const el = this.el = document.createElement('div'); el.className = 'mt-room'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', `Phòng họp: ${this.m.title}`);
    el.innerHTML = `<header class="mt-top">
        <span class="mt-badge">${icon('door', 16)} Phòng họp</span>
        <div class="mt-title"><b>${esc(this.m.title)}</b><small class="mt-time"></small></div>
        <div class="mt-here" aria-label="Người trong phòng"></div>
        <button type="button" class="mt-open" aria-pressed="false">${icon('pen', 15)} <span>Bảng &amp; nội dung</span><i class="mt-un" hidden></i></button>
        ${this.m.isHost ? `<button type="button" class="mt-end" title="Kết thúc cuộc họp cho mọi người">${icon('stop', 14)} <span>Kết thúc họp</span></button>` : ''}
        <button type="button" class="mt-leave">${icon('logout', 15)} <span>Rời phòng</span></button>
      </header>
      <button type="button" class="mt-hint">${icon('hand', 16)} Bấm vào <b>bảng trắng</b> để mở bảng vẽ &amp; nội dung cuộc họp</button>
      <div class="mt-main"><section class="mt-wb"></section>
        <aside class="mt-side">
          <nav class="mt-tabs" role="tablist">${[['chat', 'chat', 'Chat'], ['files', 'folder', 'Tài liệu'], ['people', 'users', 'Thành viên']].map(([k, ic, n]) => `<button type="button" role="tab" data-tab="${k}">${icon(ic, 15)} <span>${n}</span><em class="mt-cnt" hidden></em><i class="mt-un" hidden></i></button>`).join('')}
            <button type="button" class="mt-sx" aria-label="Thu gọn">${icon('chevDown', 16)}</button></nav>
          <div class="mt-pane" data-pane="chat"><ol class="mt-chat" aria-live="polite"></ol>
            <form class="mt-form"><input maxlength="500" autocomplete="off" placeholder="Nhắn cho mọi người trong cuộc họp…" aria-label="Tin nhắn cuộc họp"><button type="submit" aria-label="Gửi">${icon('send', 16)}</button></form></div>
          <div class="mt-pane off" data-pane="files"><div class="mt-up"><label class="sx-ghost">${icon('upload', 14)} Tải lên<input type="file" multiple hidden></label><button type="button" class="sx-ghost" data-saveboard>${icon('pen', 14)} Lưu bảng vẽ vào tài liệu</button></div><div class="mt-flist"></div></div>
          <div class="mt-pane off" data-pane="people"><div class="mt-plist"></div></div>
        </aside></div>
      <div class="mt-pip" hidden role="button" tabindex="0" aria-label="Phòng 3D thu nhỏ — kéo để dời chỗ, bấm để phóng to"><canvas class="mt-pipc"></canvas>
        <div class="mt-pipbar"><span>${icon('cube', 13)} <b class="mt-pipn">Phòng 3D</b></span><button type="button" class="mt-pipmax" title="Phóng to phòng 3D" aria-label="Phóng to phòng 3D">${icon('arrowUp', 14)}</button></div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    this.wb = new ExcaliBoard(el.querySelector('.mt-wb'), { meetingId: this.id, me: this.s.key, names: k => this.name(k), send: msg => this.s.rt.send({ ...msg, id: this.id }), elements: st.elements, files: st.files,
      isHost: this.m.isHost, name: `bang-ve-${this.m.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}`, onChange: () => this.boardChanged(), onSaveDocs: () => this.saveBoard(), toast: (t, b) => this.s.toast(t, b) });
    this.wb.ready.then(() => this.boardChanged()).catch(() => this.s.toast('Chưa tải được bảng vẽ — kiểm tra mạng rồi vào lại phòng.', true));
    el.querySelector('.mt-leave').onclick = () => this.c.leave();
    el.querySelector('.mt-open').onclick = () => this.setMode(this.mode === 'split' ? 'scene' : 'split');
    el.querySelector('.mt-hint').onclick = () => this.setMode('split');
    this.bindPip();
    el.querySelector('.mt-end')?.addEventListener('click', () => this.endMeeting());
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => this.show(b.dataset.tab, true));
    el.querySelector('.mt-sx').onclick = () => el.classList.remove('sheet');
    const input = el.querySelector('.mt-form input');
    el.querySelector('.mt-form').onsubmit = e => { e.preventDefault(); const t = input.value.trim(); if (!t) return; if (!this.s.rt.connected) { this.s.toast('Mất kết nối, chưa gửi được.', true); return; } this.s.rt.send({ t: 'chat', channel: `meet:${this.id}`, body: t }); input.value = ''; };
    input.addEventListener('keydown', e => e.stopPropagation());
    el.querySelector('.mt-up input').onchange = async e => { await uploadFiles(this.id, [...e.target.files], (t, b) => this.s.toast(t, b)); e.target.value = ''; this.loadFiles(); };
    el.querySelector('[data-saveboard]').onclick = () => this.saveBoard();
    // phím trong phòng họp không điều khiển nhân vật (W A S D, E…); Esc: đóng tấm trượt (điện thoại)
    this._key = e => { if (e.key === 'Escape' && el.classList.contains('sheet') && !document.querySelector('.modal-back')) { el.classList.remove('sheet'); e.preventDefault(); } if (!el.contains(e.target)) e.stopPropagation(); };
    window.addEventListener('keydown', this._key, true);
    this.show('chat');
    this.mode = 'scene'; el.classList.add('mode-scene');
    this.open3d();
    this.members(st.members);
    this.tick(); this.timer = setInterval(() => this.tick(), 15000);
    this.loadChat(); this.loadFiles();
  }
  destroy() { this.gone = true; this.room?.setPip(null); clearInterval(this.timer); clearTimeout(this.prevT); this.wb?.destroy(); window.removeEventListener('keydown', this._key, true); window.removeEventListener('resize', this._resize); this.c.app.rooms?.exit('meet'); const el = this.el; el.classList.remove('show'); setTimeout(() => el.remove(), 220); }
  /** Cảnh 3D phòng họp (vẽ bằng canvas của văn phòng — RoomStage; dựng một lần, lần sau vào lại ngay). */
  async open3d() {
    const stage = this.c.app.rooms; if (!stage) { this.setMode('split'); return; }
    const room = await stage.enter('meet', st => new MeetingRoom(this.c.app, st.host, st.canvas));
    if (!room || this.gone) { if (room && this.gone) stage.exit('meet'); return; }
    this.room = room;
    room.onBoard = () => this.setMode('split');
    room.setPainter((g, w, h) => { const c = this.preview; if (!c) return; const k = Math.min(w / c.width, h / c.height); g.drawImage(c, (w - c.width * k) / 2, (h - c.height * k) / 2, c.width * k, c.height * k); });
    room.empty = !this.preview;
    room.members(this.inRoom, this.m.host);
    this.applyPip();
  }
  /** Khung 3D thu nhỏ: kéo để dời (giữ trong màn hình, nhớ vị trí), bấm (không kéo) để phóng to. */
  bindPip() {
    const pip = this.pipEl = this.el.querySelector('.mt-pip');
    let saved = null; try { saved = JSON.parse(localStorage.getItem(PIP_KEY) || 'null'); } catch { /* bỏ qua */ }
    this.pipPos = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;   // (x, y: phần trăm chỗ trống còn lại — đổi cỡ màn hình vẫn đúng góc)
    let d = null;
    pip.addEventListener('pointerdown', e => { if (e.button) return; const r = pip.getBoundingClientRect(); d = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false }; pip.setPointerCapture(e.pointerId); });
    pip.addEventListener('pointermove', e => {
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy; if (!d.moved && Math.hypot(dx, dy) < 5) return;
      d.moved = true; pip.classList.add('drag'); this.placePip(d.ox + dx, d.oy + dy);
    });
    const end = e => {
      if (!d || e.pointerId !== d.id) return; const moved = d.moved; d = null; pip.classList.remove('drag');
      if (moved) { try { localStorage.setItem(PIP_KEY, JSON.stringify(this.pipPos)); } catch { /* bỏ qua */ } }
      else if (e.type === 'pointerup') this.setMode('scene');
    };
    pip.addEventListener('pointerup', end); pip.addEventListener('pointercancel', end);
    pip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.setMode('scene'); } });
    this._resize = () => { if (this.mode === 'split') this.placePip(); };
    window.addEventListener('resize', this._resize);
  }
  /** Đặt khung thu nhỏ: (left, top) px — không truyền thì dùng vị trí đã nhớ (mặc định góc trái dưới). */
  placePip(left, top) {
    const pip = this.pipEl, W = innerWidth, H = innerHeight, w = pip.offsetWidth, h = pip.offsetHeight, M = 10;
    const minY = (this.el.querySelector('.mt-top')?.offsetHeight || 60) + M, maxX = Math.max(M, W - w - M), maxY = Math.max(minY, H - h - M - (narrow() ? 54 : 0));
    if (left === undefined) {
      if (this.pipPos) { left = M + this.pipPos.x * (maxX - M); top = minY + this.pipPos.y * (maxY - minY); }
      else { left = M; top = maxY - (narrow() ? 52 : 70); }   // (mặc định: góc trái dưới, ngay trên nút thu phóng / hoàn tác của bảng vẽ)
    }
    left = Math.min(maxX, Math.max(M, left)); top = Math.min(maxY, Math.max(minY, top));
    pip.style.left = `${left}px`; pip.style.top = `${top}px`;
    this.pipPos = { x: maxX > M ? (left - M) / (maxX - M) : 0, y: maxY > minY ? (top - minY) / (maxY - minY) : 1 };
  }
  applyPip() {
    const on = this.mode === 'split' && !!this.room;
    this.pipEl.hidden = !on;
    if (on) this.placePip();
    this.room?.setPip(on ? { el: this.pipEl, cv: this.pipEl.querySelector('canvas') } : null);
  }
  /** scene: cảnh 3D toàn màn · split: bảng vẽ + cột chat/tài liệu, cảnh 3D thu vào khung nhỏ kéo được. */
  setMode(mode) {
    this.mode = mode;
    this.el.classList.toggle('mode-split', mode === 'split'); this.el.classList.toggle('mode-scene', mode === 'scene');
    const b = this.el.querySelector('.mt-open'); b.classList.toggle('on', mode === 'split'); b.setAttribute('aria-pressed', String(mode === 'split'));
    if (mode === 'split') { this.unreadAll = 0; b.querySelector('.mt-un').hidden = true; requestAnimationFrame(() => this.wb.open()); }
    this.applyPip();
  }
  async endMeeting() {
    if (!(await confirmDanger('Kết thúc cuộc họp?', 'Mọi người sẽ rời phòng và phòng họp trống ngay cho lịch khác. Tài liệu, bảng vẽ, chat vẫn lưu trong "Folder của tôi".', 'Kết thúc họp'))) return;
    const r = await api('POST', `/api/meetings/${this.id}/end`);
    if (!r.ok) this.s.toast(r.error || 'Chưa kết thúc được.', true);
  }
  update(st) { this.m = st.meeting; this.wb.receive(st.elements); this.members(st.members); }
  /** Bản vẽ đổi → vẽ lại bảng trắng trên tường phòng 3D (tối đa ~3 lần/giây). */
  boardChanged() {
    if (this.prevT) { this.prevAgain = true; return; }
    this.prevT = setTimeout(async () => {
      try { this.preview = await this.wb.preview(1600, 900); } catch { /* giữ ảnh cũ */ }
      const r = this.room; if (r) { r.empty = !this.preview; r.markBoard(); }
      this.prevT = 0; if (this.prevAgain) { this.prevAgain = false; this.boardChanged(); }
    }, 300);
  }
  meetingChanged(m) { if (m.id === this.id) { this.m = { ...this.m, ...m }; this.el.querySelector('.mt-title b').textContent = m.title; this.tick(); this.renderPeople(); } }
  name(key) { if (key === this.m.host) return this.m.hostName; return this.m.invitees?.find(p => p.key === key)?.name || this.inRoom.find(p => p.key === key)?.display || key.replace(/^employee:/, ''); }

  tick() {
    const now = Date.now(), m = this.m, el = this.el.querySelector('.mt-time');
    el.textContent = now < m.start ? `${hm(m.start)}–${hm(m.end)} · bắt đầu sau ${fmtLeft(m.start - now)}` : `${hm(m.start)}–${hm(m.end)} · còn ${fmtLeft(m.end - now)}`;
    el.classList.toggle('warn', now >= m.start && m.end - now < 5 * 60e3);
  }
  show(tab, user = false) {
    this.tab = tab;
    this.el.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    this.el.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('off', p.dataset.pane !== tab));
    if (user) this.el.classList.add('sheet');
    if (tab === 'chat') { this.unread = 0; this.el.querySelector('[data-tab=chat] .mt-un').hidden = true; const ol = this.el.querySelector('.mt-chat'); ol.scrollTop = ol.scrollHeight; }
    if (tab === 'people') this.renderPeople();
  }

  // ---------- người ----------
  members(list) {
    const before = new Set(this.inRoom.map(p => p.key)); this.inRoom = list;
    for (const p of list) if (!before.has(p.key) && p.key !== this.s.key && before.size) this.s.toast(`${p.display} vừa vào phòng họp.`);
    for (const k of before) if (!list.some(p => p.key === k)) this.wb.dropPeer(k);
    this.room?.members(list, this.m.host);
    this.el.querySelector('.mt-here').innerHTML = list.slice(0, 6).map(p => avatar(p.key, p.display, p.key === this.m.host ? 'host' : '')).join('') + (list.length > 6 ? `<span class="mt-av more">+${list.length - 6}</span>` : '') + `<small>${list.length} trong phòng</small>`;
    this.el.querySelector('.mt-pipn').textContent = `Phòng 3D · ${list.length} người`;
    this.renderPeople();
  }
  /** Số nhỏ cạnh tên thẻ (dạng huy hiệu, luôn một hàng). */
  count(tab, v) { const e = this.el.querySelector(`[data-tab=${tab}] .mt-cnt`); e.textContent = v; e.hidden = v === ''; }
  renderPeople() {
    const here = new Set(this.inRoom.map(p => p.key)), all = [{ key: this.m.host, name: this.m.hostName }, ...(this.m.invitees || [])];
    const row = p => `<li>${avatar(p.key, p.name, p.key === this.m.host ? 'host' : '')}<span><b>${esc(p.name)}${p.key === this.s.key ? ' (bạn)' : ''}</b><small>${p.key === this.m.host ? 'Host · ' : ''}${here.has(p.key) ? '<em class="in">Đang trong phòng</em>' : 'Chưa vào'}</small></span></li>`;
    this.count('people', `${all.filter(p => here.has(p.key)).length}/${all.length}`);
    this.el.querySelector('.mt-plist').innerHTML = `<ul class="mt-people">${all.filter(p => here.has(p.key)).map(row).join('')}${all.filter(p => !here.has(p.key)).map(row).join('')}</ul>
      <p class="mt-note">${icon('info', 13)} Chỉ những người trong danh sách mới vào được phòng. ${this.m.isHost ? 'Thêm / bớt người: Phòng họp → Cuộc họp của tôi → Sửa.' : ''}</p>`;
  }

  // ---------- chat ----------
  async loadChat() {
    const r = await api('GET', `/api/chat/${encodeURIComponent(`meet:${this.id}`)}`);
    if (r.ok) { const ids = new Set(this.chat.map(x => x.id)); this.chat = [...r.messages, ...this.chat.filter(x => !r.messages.some(y => y.id === x.id))].sort((a, b) => a.id - b.id); void ids; this.renderChat(); }
  }
  onChat(msg) {
    if (msg.channel !== `meet:${this.id}` || this.chat.some(x => x.id === msg.id)) return;
    this.chat.push(msg); if (this.chat.length > 200) this.chat.shift();
    this.renderChat();
    if (msg.from !== 'system') this.room?.say(msg.from, msg.body);   // (bong bóng chat trên đầu người nói trong cảnh 3D)
    if (this.mode !== 'split' && msg.from !== this.s.key) this.el.querySelector('.mt-open .mt-un').hidden = false;
    if (this.tab !== 'chat' || narrow() && !this.el.classList.contains('sheet')) { if (msg.from !== this.s.key) { this.unread++; this.el.querySelector('[data-tab=chat] .mt-un').hidden = false; } }
  }
  renderChat() {
    const ol = this.el.querySelector('.mt-chat'), stick = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 60;
    ol.innerHTML = this.chat.length ? this.chat.map(x => `<li class="${x.from === 'system' ? 'sys' : x.from === this.s.key ? 'me' : ''}">${x.from === 'system' ? '' : `<div class="mt-cm"><b>${esc(x.name.replace(/^\d{4}-/, ''))}</b><time>${hm(x.ts)}</time></div>`}<p>${esc(x.body)}</p></li>`).join('')
      : '<li class="mt-empty">Kênh chat riêng của cuộc họp — chỉ người trong danh sách đọc được. Tin nhắn được lưu lại trong "Folder của tôi".</li>';
    if (stick) ol.scrollTop = ol.scrollHeight;
  }

  // ---------- tài liệu ----------
  async loadFiles() {
    const r = await api('GET', `/api/meetings/${this.id}`); if (!r.ok || !this.el.isConnected) return;
    this.files = r.files; const box = this.el.querySelector('.mt-flist');
    box.innerHTML = filesHtml(this.files, this.s.key, this.m.isHost).replaceAll('{MID}', this.id);
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!(await confirmDanger('Xoá tài liệu?', 'Mọi người trong cuộc họp sẽ không xem được file này nữa.', 'Xoá'))) return; const x = await api('DELETE', `/api/meetings/${this.id}/files/${b.dataset.del}`); if (!x.ok) this.s.toast(x.error, true); });
    this.count('files', this.files.length || '');
  }
  async saveBoard() {
    const blob = await this.wb.png().catch(() => null);
    if (!blob) { this.s.toast('Bảng chưa có gì để lưu.', true); return; }
    const d = new Date(Date.now() + 7 * 3600e3), name = `Bang-ve-${String(d.getUTCHours()).padStart(2, '0')}h${String(d.getUTCMinutes()).padStart(2, '0')}.png`;
    await uploadFiles(this.id, [new File([blob], name, { type: 'image/png' })], (t, b) => this.s.toast(t, b), 'board');
    this.loadFiles(); this.show('files');
  }
}
