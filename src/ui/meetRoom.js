// Phòng họp (kiểu agent-office): vào phòng là thấy cảnh 3D (src/rooms/meetingRoom.js) — mọi người ngồi quanh bàn họp, bảng
// trắng trên tường hiện nét vẽ thật. Thanh trên: tên cuộc họp, giờ, còn bao lâu, người trong phòng, "Bảng & nội dung",
// "Kết thúc họp" (host), "Rời phòng".
// Bấm vào bảng trắng (hoặc nút "Bảng & nội dung") → bảng vẽ chung Excalidraw (src/ui/excaliBoard.js) chiếm phần lớn màn hình, cột phải
// có thanh thẻ ở trên: Chat (kênh riêng của cuộc họp) · Tài liệu (tải lên / mở / tải về, lưu bảng vẽ) · Thành viên; cảnh 3D thu
// thành khung nhỏ ở góc trái dưới — kéo để dời chỗ (nhớ vị trí), bấm để phóng to lại.
// Điện thoại: Chat / Tài liệu / Thành viên là các thẻ trong tấm trượt từ dưới lên.
// Họp trực tuyến (src/ui/meetCall.js): thanh nút ở dưới — Mic · Camera · Chia sẻ màn hình · "Màn hình họp" (xem camera của
// mọi người; ai chia sẻ màn hình thì màn hình đó hiện to, camera xếp bên cạnh). Có người bắt đầu chia sẻ màn hình khi mình
// đang xem cảnh 3D: tự mở "Màn hình họp".
// Phòng dự án (meeting.kind === 'project', mã phòng "p<id>" — src/session/projects.js): cùng giao diện, không có giờ họp /
// nút kết thúc; chat là kênh proj:<id>, tài liệu là tài liệu của dự án.
import { api } from '../net/api.js';
import { esc, confirmDanger } from '../session/ui.js';
import { icon } from './icons.js';
import { MeetingRoom } from '../rooms/meetingRoom.js';
import { ExcaliBoard } from './excaliBoard.js';
import { avatar, filesHtml, uploadFiles } from './meetPanel.js';
import { hm } from '../session/meetings.js';
import { MeetCall, canCall, canShareScreen } from './meetCall.js';
import { spaceBase, spaceChannel } from './space.js';

const PIP_KEY = 'sysone.meetPip';
const narrow = () => matchMedia('(max-width: 760px)').matches;
const fmtLeft = ms => { const m = Math.max(0, Math.ceil(ms / 60e3)); return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60 ? `${m % 60} phút` : ''}` : `${m} phút`; };

export class MeetRoom {
  constructor(ctl, st) {
    this.c = ctl; this.s = ctl.s; this.m = st.meeting; this.id = st.id; this.inRoom = st.members; this.chat = []; this.files = []; this.tab = 'chat'; this.unread = 0;
    this.proj = this.m.kind === 'project'; this.channel = spaceChannel(this.id); this.base = spaceBase(this.id);
    const el = this.el = document.createElement('div'); el.className = `mt-room${this.proj ? ' is-proj' : ''}`; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', `${this.proj ? 'Phòng dự án' : 'Phòng họp'}: ${this.m.title}`);
    if (this.proj && this.m.color) el.style.setProperty('--pc', this.m.color);
    el.innerHTML = `<header class="mt-top">
        <span class="mt-badge">${icon(this.proj ? 'grid' : 'door', 16)} ${this.proj ? 'Phòng dự án' : 'Phòng họp'}</span>
        <div class="mt-title"><b>${esc(this.m.title)}</b><small class="mt-time"></small></div>
        <div class="mt-here" aria-label="Người trong phòng"></div>
        <button type="button" class="mt-open" aria-pressed="false">${icon('pen', 15)} <span>Bảng &amp; nội dung</span><i class="mt-un" hidden></i></button>
        ${this.m.isHost ? `<button type="button" class="mt-end" title="Kết thúc cuộc họp cho mọi người">${icon('stop', 14)} <span>Kết thúc họp</span></button>` : ''}
        <button type="button" class="mt-leave">${icon('logout', 15)} <span>Rời phòng</span></button>
      </header>
      <button type="button" class="mt-hint">${icon('hand', 16)} Bấm vào <b>bảng trắng</b> để mở bảng vẽ &amp; nội dung ${this.proj ? 'dự án' : 'cuộc họp'}</button>
      <div class="mt-main"><section class="mt-wb"><div class="mt-vids" aria-label="Màn hình họp"><div class="mt-vmain"></div><div class="mt-vstrip"></div></div></section>
        <aside class="mt-side">
          <nav class="mt-tabs" role="tablist">${[['chat', 'chat', 'Chat'], ['files', 'folder', 'Tài liệu'], ['people', 'users', 'Thành viên']].map(([k, ic, n]) => `<button type="button" role="tab" data-tab="${k}">${icon(ic, 15)} <span>${n}</span><em class="mt-cnt" hidden></em><i class="mt-un" hidden></i></button>`).join('')}
            <button type="button" class="mt-sx" aria-label="Thu gọn">${icon('chevDown', 16)}</button></nav>
          <div class="mt-pane" data-pane="chat"><ol class="mt-chat" aria-live="polite"></ol>
            <form class="mt-form"><input maxlength="500" autocomplete="off" placeholder="${this.proj ? 'Nhắn cho cả dự án… (@tên để nhắc)' : 'Nhắn cho mọi người trong cuộc họp…'}" aria-label="${this.proj ? 'Tin nhắn dự án' : 'Tin nhắn cuộc họp'}"><button type="submit" aria-label="Gửi">${icon('send', 16)}</button></form></div>
          <div class="mt-pane off" data-pane="files"><div class="mt-up"><label class="sx-ghost">${icon('upload', 14)} Tải lên<input type="file" multiple hidden></label><button type="button" class="sx-ghost" data-saveboard>${icon('pen', 14)} Lưu bảng vẽ vào tài liệu</button></div><div class="mt-flist"></div></div>
          <div class="mt-pane off" data-pane="people"><div class="mt-plist"></div></div>
        </aside></div>
      <div class="mt-pip" hidden role="button" tabindex="0" aria-label="Phòng 3D thu nhỏ — kéo để dời chỗ, bấm để phóng to"><canvas class="mt-pipc"></canvas>
        <div class="mt-pipbar"><span>${icon('cube', 13)} <b class="mt-pipn">Phòng 3D</b></span><button type="button" class="mt-pipmax" title="Phóng to phòng 3D" aria-label="Phóng to phòng 3D">${icon('arrowUp', 14)}</button></div></div>
      <div class="mt-call" role="toolbar" aria-label="Họp trực tuyến">
        <button type="button" class="mt-cb" data-m="mic"></button><button type="button" class="mt-cb" data-m="cam"></button>${canShareScreen() ? '<button type="button" class="mt-cb" data-m="screen"></button>' : ''}
        <button type="button" class="mt-cb mt-vview" aria-pressed="false" title="Xem camera &amp; màn hình chia sẻ của mọi người">${icon('users', 16)}<span>Màn hình họp</span><em class="mt-cnt" hidden></em></button></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    this.wb = new ExcaliBoard(el.querySelector('.mt-wb'), { meetingId: this.id, me: this.s.key, names: k => this.name(k), send: msg => this.s.rt.send({ ...msg, id: this.id }), elements: st.elements, files: st.files,
      isHost: this.m.isHost, name: `bang-ve-${this.m.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}`, onChange: () => this.boardChanged(), onSaveDocs: () => this.saveBoard(), toast: (t, b) => this.s.toast(t, b) });
    this.call = canCall() ? new MeetCall({ me: this.s.key, send: msg => this.s.rt.send({ ...msg, id: this.id }), toast: (t, b) => this.s.toast(t, b), onChange: () => this.renderCall(), onTalk: () => this.paintTalk() }) : null;
    el.querySelectorAll('.mt-cb[data-m]').forEach(b => b.onclick = () => { if (!this.call) { this.s.toast('Trình duyệt này chưa hỗ trợ họp trực tuyến (mic / camera).', true); return; } this.call.toggle(b.dataset.m); });
    el.querySelector('.mt-vview').onclick = () => this.setMode(this.mode === 'call' ? this.back || 'scene' : 'call');
    el.querySelector('.mt-vids').addEventListener('click', e => { const t = e.target.closest('.mt-tile'); if (t) { this.pin = this.pin === t.dataset.id ? null : t.dataset.id; this.renderCall(); } });
    this.wb.ready.then(() => this.boardChanged()).catch(() => this.s.toast('Chưa tải được bảng vẽ — kiểm tra mạng rồi vào lại phòng.', true));
    el.querySelector('.mt-leave').onclick = () => this.c.leave();
    el.querySelector('.mt-open').onclick = () => this.setMode(this.mode === 'split' ? 'scene' : 'split');
    el.querySelector('.mt-hint').onclick = () => this.setMode('split');
    this.bindPip();
    el.querySelector('.mt-end')?.addEventListener('click', () => this.endMeeting());
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => this.show(b.dataset.tab, true));
    el.querySelector('.mt-sx').onclick = () => el.classList.remove('sheet');
    const input = el.querySelector('.mt-form input');
    el.querySelector('.mt-form').onsubmit = e => { e.preventDefault(); const t = input.value.trim(); if (!t) return; if (!this.s.rt.connected) { this.s.toast('Mất kết nối, chưa gửi được.', true); return; } this.s.rt.send({ t: 'chat', channel: this.channel, body: t }); input.value = ''; };
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
  destroy() { this.gone = true; this.call?.destroy(); this.room?.setPip(null); clearInterval(this.timer); clearTimeout(this.prevT); this.wb?.destroy(); window.removeEventListener('keydown', this._key, true); window.removeEventListener('resize', this._resize); this.c.app.rooms?.exit('meet'); const el = this.el; el.classList.remove('show'); setTimeout(() => el.remove(), 220); }
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
    room.lowFps = this.mode === 'call';
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
      else { left = M; top = maxY - (narrow() ? 116 : 70); }   // (mặc định: góc trái dưới, trên nút thu phóng / hoàn tác của bảng vẽ và thanh nút họp (điện thoại))
    }
    left = Math.min(maxX, Math.max(M, left)); top = Math.min(maxY, Math.max(minY, top));
    pip.style.left = `${left}px`; pip.style.top = `${top}px`;
    this.pipPos = { x: maxX > M ? (left - M) / (maxX - M) : 0, y: maxY > minY ? (top - minY) / (maxY - minY) : 1 };
  }
  applyPip() {
    const on = this.mode !== 'scene' && !!this.room;
    this.pipEl.hidden = !on;
    if (on) this.placePip();
    this.room?.setPip(on ? { el: this.pipEl, cv: this.pipEl.querySelector('canvas') } : null);
  }
  /** scene: cảnh 3D toàn màn · split: bảng vẽ + cột chat/tài liệu · call: màn hình họp (camera, màn hình chia sẻ) + cột chat;
   *  hai chế độ sau thu cảnh 3D vào khung nhỏ kéo được. */
  setMode(mode) {
    if (mode === 'call' && this.mode !== 'call') this.back = this.mode;
    this.mode = mode;
    for (const k of ['scene', 'split', 'call']) this.el.classList.toggle(`mode-${k}`, mode === k);
    const v = this.el.querySelector('.mt-vview'); v.classList.toggle('on', mode === 'call'); v.setAttribute('aria-pressed', String(mode === 'call'));
    if (mode === 'call') this.renderCall();
    if (this.room) this.room.lowFps = mode === 'call';
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
    if (this.proj) { el.textContent = `Dự án · ${(m.invitees || []).length} thành viên · phòng luôn mở`; return; }
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
    this.call?.sync(list);
    this.watchShares(list);
    this.renderCall();
    this.el.querySelector('.mt-here').innerHTML = list.slice(0, 6).map(p => avatar(p.key, p.display, p.key === this.m.host ? 'host' : '')).join('') + (list.length > 6 ? `<span class="mt-av more">+${list.length - 6}</span>` : '') + `<small>${list.length} trong phòng</small>`;
    this.el.querySelector('.mt-pipn').textContent = `Phòng 3D · ${list.length} người`;
    this.renderPeople();
  }
  /** Số nhỏ cạnh tên thẻ (dạng huy hiệu, luôn một hàng). */
  count(tab, v) { const e = this.el.querySelector(`[data-tab=${tab}] .mt-cnt`); e.textContent = v; e.hidden = v === ''; }
  renderPeople() {
    const here = new Set(this.inRoom.map(p => p.key)), all = this.proj ? [...(this.m.invitees || [])] : [{ key: this.m.host, name: this.m.hostName }, ...(this.m.invitees || [])];
    const lead = p => this.proj ? p.role === 'lead' : p.key === this.m.host;
    const row = p => `<li>${avatar(p.key, p.name, lead(p) ? 'host' : '')}<span><b>${esc(p.name)}${p.key === this.s.key ? ' (bạn)' : ''}</b><small>${lead(p) ? (this.proj ? 'Trưởng dự án · ' : 'Host · ') : ''}${here.has(p.key) ? '<em class="in">Đang trong phòng</em>' : 'Chưa vào'}</small></span>${here.has(p.key) ? this.mediaIcons(p.key) : ''}</li>`;
    this.count('people', `${all.filter(p => here.has(p.key)).length}/${all.length}`);
    this.el.querySelector('.mt-plist').innerHTML = `<ul class="mt-people">${all.filter(p => here.has(p.key)).map(row).join('')}${all.filter(p => !here.has(p.key)).map(row).join('')}</ul>
      <p class="mt-note">${icon('info', 13)} ${this.proj ? `Chỉ thành viên dự án mới vào được phòng. ${this.m.isLead ? 'Thêm / bớt người: Dự án → Thành viên.' : ''}` : `Chỉ những người trong danh sách mới vào được phòng. ${this.m.isHost ? 'Thêm / bớt người: Phòng họp → Cuộc họp của tôi → Sửa.' : ''}`}</p>`;
  }

  // ---------- họp trực tuyến ----------
  media(key) { return key === this.s.key && this.call ? this.call.on : this.inRoom.find(p => p.key === key)?.media || {}; }
  mediaIcons(key) { const m = this.media(key); return `<span class="mt-pm">${icon(m.mic ? 'mic' : 'micOff', 14, m.mic ? 'on' : '')}${m.cam ? icon('video', 14, 'on') : ''}${m.screen ? icon('screen', 14, 'on') : ''}</span>`; }
  /** Có người vừa bắt đầu chia sẻ màn hình: báo; đang xem cảnh 3D thì tự mở màn hình họp. */
  watchShares(list) {
    const now = new Set(list.filter(p => p.media?.screen && p.key !== this.s.key).map(p => p.key)), was = this.sharing || new Set();
    this.sharing = now;
    for (const k of now) if (!was.has(k)) {
      this.pin = `${k}:screen`;
      this.s.toast(`${this.name(k)} đang chia sẻ màn hình.`);
      if (this.mode === 'scene') this.setMode('call');
    }
  }
  /** Ô hình: màn hình chia sẻ (to) + camera / ảnh đại diện của từng người trong phòng. Giữ nguyên thẻ <video> giữa các lần vẽ. */
  renderCall() {
    if (this.gone) return;
    const el = this.el, me = this.s.key, on = this.call?.on || {};
    // nút
    const lab = { mic: on.mic ? ['mic', 'Tắt mic'] : ['micOff', 'Bật mic'], cam: on.cam ? ['video', 'Tắt camera'] : ['videoOff', 'Bật camera'], screen: on.screen ? ['screenOff', 'Dừng chia sẻ'] : ['screen', 'Chia sẻ màn hình'] };
    el.querySelectorAll('.mt-cb[data-m]').forEach(b => {
      const k = b.dataset.m, [ic, t] = lab[k], key = `${ic}|${t}`;
      if (b._k !== key) { b._k = key; b.innerHTML = `${icon(ic, 16)}<span>${t}</span>`; }
      b.classList.toggle('on', !!on[k]); b.classList.toggle('off', (k === 'mic' || k === 'cam') && !on[k]);
      b.setAttribute('aria-pressed', String(!!on[k])); b.title = t; b.setAttribute('aria-label', t);
    });
    const people = this.inRoom.length ? this.inRoom : [{ key: me, display: this.name(me) }];
    const tiles = [];
    for (const p of people) if (this.media(p.key).screen) tiles.push({ id: `${p.key}:screen`, key: p.key, slot: 'screen' });
    for (const p of people) tiles.push({ id: `${p.key}:cam`, key: p.key, slot: 'cam' });
    const live = tiles.filter(t => t.slot === 'screen' || this.media(t.key).cam).length;
    const cnt = el.querySelector('.mt-vview .mt-cnt'); cnt.textContent = live || ''; cnt.hidden = !live;
    if (this.mode !== 'call') return;
    const box = el.querySelector('.mt-vids'), main = box.querySelector('.mt-vmain'), strip = box.querySelector('.mt-vstrip');
    if (this.pin && !tiles.some(t => t.id === this.pin)) this.pin = null;
    const big = this.pin || tiles.find(t => t.slot === 'screen')?.id || null;   // (có màn hình chia sẻ / ô được ghim: hiện to)
    box.classList.toggle('has-big', !!big);
    this.tiles ||= new Map();
    const keep = new Set();
    for (const t of tiles) {
      keep.add(t.id);
      let d = this.tiles.get(t.id);
      if (!d) {
        d = document.createElement('div'); d.className = `mt-tile ${t.slot}`; d.dataset.id = t.id; d.tabIndex = 0;
        d.innerHTML = `<video autoplay playsinline muted></video><div class="mt-tav">${avatar(t.key, this.name(t.key), t.key === this.m.host ? 'host' : '')}</div><span class="mt-tname"></span>`;
        d.querySelector('video').muted = true;   // (tiếng phát riêng qua <audio> — không phát hai lần)
        this.tiles.set(t.id, d);
      }
      const m = this.media(t.key), track = (t.slot === 'screen' || m.cam) ? this.call?.track(t.key, t.slot) : null;
      const v = d.querySelector('video'), mine = t.key === me;
      const show = !!track && !(mine && t.slot === 'screen');   // (màn hình của chính mình: không chiếu lại — tránh "gương trong gương")
      if (show && v._track !== track) { v._track = track; v.srcObject = new MediaStream([track]); v.play().catch(() => {}); }
      if (!show && v._track) { v._track = null; v.srcObject = null; }
      d.classList.toggle('live', show); d.classList.toggle('me', mine); d.classList.toggle('big', t.id === big);
      d.classList.toggle('wait', !mine && (t.slot === 'screen' || m.cam) && !show);
      const nm = `${esc(this.name(t.key))}${mine ? ' (bạn)' : ''}`;
      d.querySelector('.mt-tname').innerHTML = t.slot === 'screen' ? `${icon('screen', 13)} ${mine ? 'Bạn đang chia sẻ màn hình' : `Màn hình của ${nm}`}` : `${icon(m.mic ? 'mic' : 'micOff', 13, m.mic ? '' : 'mut')} ${nm}`;
      const parent = t.id === big ? main : big ? strip : main;
      parent.appendChild(d);   // (appendChild giữ thứ tự, không tạo lại thẻ video)
    }
    for (const [id, d] of this.tiles) if (!keep.has(id)) { const v = d.querySelector('video'); v.srcObject = null; d.remove(); this.tiles.delete(id); }
    main.dataset.n = main.children.length;
    this.paintTalk();
  }
  paintTalk() { if (!this.tiles) return; for (const [id, d] of this.tiles) { const [key, slot] = [id.slice(0, id.lastIndexOf(':')), id.slice(id.lastIndexOf(':') + 1)]; d.classList.toggle('talk', slot === 'cam' && !!this.call?.talking(key)); } }

  // ---------- chat ----------
  async loadChat() {
    const r = await api('GET', `/api/chat/${encodeURIComponent(this.channel)}`);
    if (r.ok) { const ids = new Set(this.chat.map(x => x.id)); this.chat = [...r.messages, ...this.chat.filter(x => !r.messages.some(y => y.id === x.id))].sort((a, b) => a.id - b.id); void ids; this.renderChat(); }
  }
  onChat(msg) {
    if (msg.channel !== this.channel || this.chat.some(x => x.id === msg.id)) return;
    this.chat.push(msg); if (this.chat.length > 200) this.chat.shift();
    this.renderChat();
    if (msg.from !== 'system') this.room?.say(msg.from, msg.body);   // (bong bóng chat trên đầu người nói trong cảnh 3D)
    if (this.mode !== 'split' && msg.from !== this.s.key) this.el.querySelector('.mt-open .mt-un').hidden = false;
    if (this.tab !== 'chat' || narrow() && !this.el.classList.contains('sheet')) { if (msg.from !== this.s.key) { this.unread++; this.el.querySelector('[data-tab=chat] .mt-un').hidden = false; } }
  }
  renderChat() {
    const ol = this.el.querySelector('.mt-chat'), stick = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 60;
    ol.innerHTML = this.chat.length ? this.chat.map(x => `<li class="${x.from === 'system' ? 'sys' : x.from === this.s.key ? 'me' : ''}">${x.from === 'system' ? '' : `<div class="mt-cm"><b>${esc(x.name.replace(/^\d{4}-/, ''))}</b><time>${hm(x.ts)}</time></div>`}<p>${esc(x.body)}</p></li>`).join('')
      : `<li class="mt-empty">${this.proj ? 'Kênh chat riêng của dự án — chỉ thành viên đọc được. Gõ @tên để nhắc ai đó.' : 'Kênh chat riêng của cuộc họp — chỉ người trong danh sách đọc được. Tin nhắn được lưu lại trong "Folder của tôi".'}</li>`;
    if (stick) ol.scrollTop = ol.scrollHeight;
  }

  // ---------- tài liệu ----------
  async loadFiles() {
    const r = await api('GET', this.base); if (!r.ok || !this.el.isConnected) return;
    this.files = r.files; const box = this.el.querySelector('.mt-flist');
    box.innerHTML = filesHtml(this.files, this.s.key, this.m.isHost || this.m.isLead).replaceAll('{BASE}', spaceBase(this.id));
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!(await confirmDanger('Xoá tài liệu?', `Mọi người trong ${this.proj ? 'dự án' : 'cuộc họp'} sẽ không xem được file này nữa.`, 'Xoá'))) return; const x = await api('DELETE', `${this.base}/files/${b.dataset.del}`); if (!x.ok) this.s.toast(x.error, true); });
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
