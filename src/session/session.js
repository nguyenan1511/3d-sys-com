// Phiên người dùng trong cảnh 3D: thanh phiên, chọn/nhận chỗ (xem trước 3D), dụng cụ, ngồi/đứng,
// nhãn chủ chỗ, danh sách online, avatar người khác. Mọi quyết định quyền do server trả về.
import * as THREE from 'three';
import { api } from '../net/api.js';
import { Realtime } from './realtime.js';
import { RemoteAvatars } from './remote.js';
import { toast, modal, esc } from './ui.js';
import { openAvatarEditor } from './avatarEditor.js';
import { VIEW, ENABLE_2D } from '../pixel/billboard.js';
import { icon } from '../ui/icons.js';
import { Player } from './player.js';
import { SmokeFX } from './fx.js';
import { Blinds } from '../scene/blinds.js';
import { Elevator, LIFT_FLOORS } from '../scene/elevator.js';
import { LoungeTv } from '../scene/loungeTv.js';
import { Guide } from './guide.js';
import { Social } from '../ui/social.js';
import { Attendance } from './attendance.js';
import { defaultEquipment, normalizeEquipment } from '../shared/equipment.js';
import { footprint, seatApproach } from '../model/layoutModel.js';
import { facingVec } from '../core/util.js';
import { sound } from '../audio/notify.js';
import { Props } from '../scene/props.js';
import { Karaoke } from './karaoke.js';
import { Billiards } from './billiards.js';
import { LightSwitch } from './lightSwitch.js';
import { Restroom } from './restroom.js';
import { notice } from '../ui/notices.js';
import { MODES, getMode, switchMode, REAL_ENABLED } from '../core/mode.js';
const MODE = getMode(), COMPACT = '(max-width: 760px), (max-height: 500px) and (max-width: 1100px)';

const $ = id => document.getElementById(id);

function labelSprite(text, bg) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = 'bold 40px system-ui, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 26; c.width = w; c.height = 56;
  g.font = 'bold 40px system-ui, sans-serif'; g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, 56, 12); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, 13, 30);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  // nhãn là vật thể trong cảnh: cỡ thật (cao 9 cm), bị tường/sàn/trần che như mọi vật khác → không lộ nhãn tầng khác
  t.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, depthWrite: false, transparent: true, alphaTest: 0.1, sizeAttenuation: true }));
  s.scale.set(0.09 * w / 56, 0.09, 1); s.center.set(0.5, 0); s.renderOrder = 2;
  return s;
}

export class Session {
  constructor(app, me, hooks, { seats, equipment, appearance }) {
    this.app = app; this.me = me; this.hooks = hooks;
    this.isAdmin = me.kind === 'admin';
    this.key = this.isAdmin ? `admin:${me.admin.username}` : `employee:${me.employee.code}`;
    this.inMode = s => !!s && app.model.deskById.has(s.deskId); // chỉ chỗ của chế độ đang mở (server giữ chỗ của cả hai chế độ)
    this.seats = new Map(seats.filter(this.inMode).map(s => [s.deskId, s]));
    this.schema = equipment;
    this.appearance = appearance;
    this.online = [];
    this.seated = null;
    this.selecting = false; this.selected = null; this.draft = null; this.editing = false;
    this.labels = new THREE.Group(); this.labels.name = 'seatLabels'; this.labels.visible = false; app.scene.add(this.labels);
    this.remote = new RemoteAvatars(app.scene, app.model, app.quality);
    this.remote.setSelf(this.key);
    this.toast = toast;
    this.fx = new SmokeFX(app.scene);
    this.blinds = new Blinds(app.scene, app.model, app.outerBlinds || [], { big: app.big, real: app.real });
    this.lift = app.big ? new Elevator(app.scene) : null; // thang máy (toà nhà lớn)
    this.tv = app.big ? new LoungeTv(app.model) : null;   // sofa xem TV ở khu giải trí
    // mỗi người (cả CEO) điều khiển nhân vật của mình (góc nhìn thứ ba); CEO dùng nhân vật cố định mặc vest
    {
      this.player = new Player(app, this);
      this.remote.setLocal(this.player.agent);
      app.rig.clamp = pos => this.player.clampCamera(pos);
    }
    // người hướng dẫn ở sảnh: đón người mới, dẫn tới bàn, giao việc tuần đầu (toà nhà lớn)
    this.guide = app.big && this.player ? new Guide(this) : null;
    this.rt = new Realtime();
    this.social = new Social(this); // chat nội bộ + loa công ty
    this.ktv = app.big && this.player ? new Karaoke(this) : null;
    this.bil = app.big && this.player ? new Billiards(this) : null;   // bàn bi-a 2 người (phòng giải trí)   // phòng karaoke (buồng ở tầng trệt)
    this.att = app.big || app.real ? new Attendance(this) : null; // chấm công: máy ở sảnh, bản ghi trong ngày
    this.lights = this.att ? new LightSwitch(this, this.att.spot) : null;   // công tắc đèn công ty (cạnh máy chấm công)
    this.wc = app.big && this.player && app.bldRoot ? new Restroom(this) : null;   // nhà vệ sinh: buồng có khoá, gương
    this.listeners = new Set();
  }
  onSeats(fn) { this.listeners.add(fn); }

  // ---------- trạng thái ----------
  get mySeat() { if (this.isAdmin) return null; for (const s of this.seats.values()) if (s.owner && s.owner.code === this.me.employee.code) return s; return null; }
  get canPick() { return !this.isAdmin && (!this.mySeat || this.me.employee.canMove); }
  equipFor(d) {
    if (this.draft && this.draft.deskId === d.id) return { equipment: this.draft.equipment, nameplate: this.me.employee?.display };
    const s = this.seats.get(d.id);
    if (s?.owner) return { equipment: s.equipment, nameplate: s.owner.display };
    return { equipment: null };
  }
  seatedAt(deskId) { return this.seated === deskId || this.remote.seatedAt(deskId); }

  start() {
    this.renderBar();
    this.renderSeatBox();
    sound.unlockOnGesture();
    this.rt.on('hello', m => {
      this.applySeats(m.seats, true);
      // kết nối lại: server không còn nhớ mình đang ngồi -> báo lại (server vẫn kiểm tra quyền)
      if (this.seated && !m.presence.some(p => p.key === this.key && p.seated === this.seated)) api('POST', `/api/seats/${encodeURIComponent(this.seated)}/sit`, {}).then(r => { if (!r.ok) { this.seated = null; this.renderSeatBox(); } });
      this.online = m.online; this.renderOnline();
      this.known = new Set(m.online.map(o => o.key));
      for (const p of m.presence) if ((p.mode || 'office') === MODE) this.remote.upsert(p);
      for (const [id, open] of Object.entries(m.blinds || {})) this.blinds.set(id, open, true);
      this.synced = true; // đã nhận trạng thái chung (chỗ ngồi, rèm…) từ server
    });
    this.rt.on('blind', m => { const it = this.blinds.byId.get(m.id); if (it && it.open !== m.open) { this.blinds.set(m.id, m.open); if (m.by) toast(`${m.by} ${m.open ? 'kéo' : 'hạ'} ${it.name.toLowerCase()}.`); } });
    this.rt.on('online', m => { this.announceArrivals(m.list); this.online = m.list; this.renderOnline(); for (const k of [...this.remote.byKey.keys()]) if (k !== 'guide' && !m.list.some(o => o.key === k)) this.remote.remove(k); }); // (chị hướng dẫn chỉ có trên máy mình, không nằm trong danh sách online)
    this.rt.on('positions', m => { for (const p of m.list) { if (p.key === this.key) this.syncSelf(p); if ((p.mode || 'office') === MODE) this.remote.upsert(p); else if (p.key !== this.key) this.remote.remove(p.key); } }); // (người ở chế độ kia: không hiện trong cảnh này)
    this.rt.on('gone', m => this.remote.remove(m.key));
    this.rt.on('seats', m => this.applySeats(m.list, m.full));
    this.rt.on('kick', m => this.hooks.logout?.(m.reason));
    this.rt.on('employees', () => this.app.dashboard?.refresh());
    this.rt.connect();
    this.firstSteps();
  }

  /** Lần đầu: tạo hình nhân vật (bắt buộc) rồi chọn chỗ; có chỗ rồi thì vào là ngồi luôn. */
  async firstSteps() {
    // chọn nhân vật chỉ khi chưa từng chọn, hoặc nhân vật đã lưu không còn trong bộ (server đánh dấu _repick); đã chọn rồi thì
    // lần nào vào cũng dùng lại nhân vật đã lưu trên tài khoản (mọi thiết bị)
    if (!this.isAdmin && (!this.me.employee.look || this.me.employee.look._repick)) await this.editLook(true);
    const mine = this.mySeat;
    if (mine) await this.sit(mine.deskId, { quiet: true, place: true });
    else if (!this.isAdmin && this.guide && !window.__NO_GUIDE) { this.player.follow(); this.guide.startAtGate(); return; } // người mới: bắt đầu trước cổng công ty; vào sảnh thì chị hướng dẫn đón và dẫn tới bàn (nhân viên không tự chọn chỗ)
    if (this.player && !this.isAdmin) this.player.follow(); // (CEO vào là xem toàn cảnh như trước; bấm WASD để điều khiển nhân vật)
  }

  async editLook(required = false) {
    const look = await openAvatarEditor({
      schema: this.appearance, look: this.me.employee.look, display: this.me.employee.display, required,
      title: required ? (this.me.employee.look?._repick ? 'Nhân vật cũ của bạn không còn — chọn nhân vật mới' : 'Chào mừng! Chọn nhân vật của bạn') : 'Nhân vật của tôi',
      save: async look => { const r = await api('PUT', '/api/me/look', { look }); return r.ok ? { ok: true, look: r.look } : { ok: false, error: r.error }; }
    });
    if (look) {
      this.me.employee.look = look;
      if (this.player) { this.player.agent.emp.look = look; this.remote.refreshColors(); }
      if (!required) toast('Đã lưu nhân vật.');
    }
    return look;
  }

  /** Server báo mình đã bị đứng dậy (vd. chỗ bị khóa/giải phóng). */
  syncSelf(p) {
    if (this.seated && !p.seated) { this.seated = null; this.player?.standUp(); toast('Bạn không còn ngồi ở chỗ đó.', true); this.renderSeatBox(); }
    // nhân vật vừa đổi ở thiết bị khác (cùng tài khoản): cập nhật ngay, không cần tải lại trang
    if (p.look && this.me.employee && !this.isAdmin) {
      const sig = JSON.stringify(p.look);
      if (sig !== this._lookSig) { this._lookSig = sig; if (sig !== JSON.stringify(this.me.employee.look)) { this.me.employee.look = p.look; if (this.player) { this.player.agent.emp.look = p.look; this.remote.refreshColors(); } } }
    }
  }

  applySeats(list, full) {
    list = list.filter(this.inMode);
    if (full) this.seats = new Map(list.map(s => [s.deskId, s]));
    else for (const s of list) this.seats.set(s.deskId, s);
    // bản nháp ở chỗ vừa bị người khác nhận
    if (this.draft && this.seats.get(this.draft.deskId)?.owner && this.seats.get(this.draft.deskId).owner.code !== this.me.employee?.code) {
      toast(`Chỗ ${this.draft.deskId} vừa có người nhận (${this.seats.get(this.draft.deskId).owner.display}).`, true);
      this.draft = null; this.selected = null;
    }
    if (this.me.employee) { const mine = this.mySeat; this.me.employee.seat = mine ? { deskId: mine.deskId } : null; }
    this.app.rebuildDesks();
    this.renderLabels();
    this.renderSeatBox();
    for (const fn of this.listeners) fn();
  }

  // ---------- thanh phiên ----------
  renderBar() {
    const bar = $('sessionBar');
    const who = this.isAdmin ? `CEO · ${esc(this.me.admin.username)}` : esc(this.me.employee.display);
    // kiểu agent-office: bảng tên văn phòng bên trái, dock nút + menu ☰ bên phải
    bar.innerHTML = `<div class="project panel"><div class="proj-id"><div class="proj-top"><img src="logo/sysone-logo.svg" alt="SYSONE" class="bar-logo" width="174" height="20">${REAL_ENABLED || MODE !== 'office' ? `<div class="mode-sw" role="group" aria-label="Chế độ văn phòng">${Object.values(MODES).map(m => `<button type="button" data-mode="${m.id}" class="${MODE === m.id ? 'on' : ''}" aria-pressed="${MODE === m.id}" title="${m.hint}">${m.name}</button>`).join('')}</div>` : ''}</div>
        <div class="project-meta"><span class="who">${who}</span><span class="badge">${this.isAdmin ? 'Quản trị' : 'Nhân viên'}</span><span class="addr">33 Dương Quang Đông</span><span class="hdr-online" title="Số người đang online"><i aria-hidden="true"></i><b>0</b><span class="sr-only"> người đang online</span></span></div></div></div>
      <nav class="dock" aria-label="Văn phòng">
      ${this.isAdmin ? `<button id="btnDash" class="dock-btn">${icon('clipboard')} <span class="lbl">Bảng quản trị</span></button><button id="btnPw" class="dock-btn">${icon('key')} <span class="lbl">Đổi mật khẩu</span></button>` : ''}
      ${this.isAdmin ? '' : `<button id="btnLook" class="dock-btn">${icon('user')} <span class="lbl">Nhân vật của tôi</span></button>`}
      <label class="dock-btn dock-check"><input type="checkbox" id="cOwners"> ${icon('tag')} <span class="lbl">Hiện chủ chỗ</span></label>
      <label class="dock-btn dock-check"><input type="checkbox" id="cSound"> ${icon('volume')} <span class="lbl">Âm báo tin nhắn</span></label>
      ${this.player && ENABLE_2D ? `<div class="dock-seg" role="group" aria-label="Chế độ hiển thị"><button id="view2d" class="dock-btn${VIEW.mode === '2d' ? ' on' : ''}" aria-pressed="${VIEW.mode === '2d'}" title="2D: bản đồ pixel nhìn từ trên xuống (mặc định)">${icon('map')} <span class="lbl">2D</span></button><button id="view3d" class="dock-btn${VIEW.mode === '3d' ? ' on' : ''}" aria-pressed="${VIEW.mode === '3d'}" title="3D: cảnh 3D">${icon('cube')} <span class="lbl">3D</span></button></div>` : ''}
      <button id="btnLogout" class="dock-btn">${icon('logout')} <span class="lbl">Đăng xuất</span></button></nav>`;
    $('view2d')?.addEventListener('click', () => this.app.setView('2d')); $('view3d')?.addEventListener('click', () => this.app.setView('3d'));
    $('btnLogout').onclick = () => this.hooks.logout?.();
    bar.querySelectorAll('.mode-sw button').forEach(b => { b.onclick = () => { if (b.dataset.mode !== MODE) switchMode(b.dataset.mode); else if (matchMedia(COMPACT).matches) switchMode(Object.keys(MODES).find(k => k !== MODE)); }; }); // (điện thoại: chỉ hiện chế độ đang dùng — bấm để đổi)
    $('btnLook')?.addEventListener('click', () => this.editLook(false));
    const co = $('cOwners'); co.checked = !!this.showOwners;
    co.onchange = e => { this.showOwners = e.target.checked; this.labels.visible = this.showOwners || this.selecting; };
    const cs = $('cSound'); cs.checked = sound.on;
    cs.onchange = e => { sound.on = e.target.checked; if (sound.on) sound.play('message'); };
    if (this.isAdmin) {
      $('btnDash').onclick = () => this.app.dashboard?.toggle();
      $('btnPw').onclick = () => this.changePassword();
      if (this.me.admin.mustChangePassword) toast('Bạn đang dùng mật khẩu ban đầu. Hãy đổi mật khẩu.', true, 6000);
    }
  }

  async changePassword() {
    await modal({
      title: 'Đổi mật khẩu CEO',
      body: '<label for="pwCur">Mật khẩu hiện tại</label><input id="pwCur" type="password" autocomplete="current-password"><label for="pwNew">Mật khẩu mới (ít nhất 8 ký tự)</label><input id="pwNew" type="password" autocomplete="new-password"><label for="pwNew2">Nhập lại mật khẩu mới</label><input id="pwNew2" type="password" autocomplete="new-password">',
      okText: 'Đổi mật khẩu',
      onOk: async b => {
        const cur = b.querySelector('#pwCur').value, nx = b.querySelector('#pwNew').value, nx2 = b.querySelector('#pwNew2').value;
        if (nx !== nx2) return { error: 'Hai lần nhập mật khẩu mới không khớp.' };
        const r = await api('POST', '/api/admin/password', { current: cur, next: nx });
        if (!r.ok) return { error: r.error };
        toast('Đã đổi mật khẩu.'); this.me.admin.mustChangePassword = false; return true;
      }
    });
  }

  // ---------- khung chỗ ngồi ----------
  renderSeatBox() {
    let box = $('seatBox');
    if (!box) { box = document.createElement('section'); box.className = 'box'; box.id = 'seatBox'; $('simBox').parentNode.insertBefore(box, $('simBox')); }
    if (this.isAdmin) {
      box.innerHTML = `<h2>Chỗ ngồi</h2><p class="muted small">CEO ${this.app.meConfig.adminCanSitAnywhere ? 'được phép ngồi mọi chỗ' : 'không ngồi chỗ của nhân viên'} (ADMIN_CAN_SIT_ANYWHERE). Quản lý chỗ trong Bảng quản trị.</p>${this.seated ? `<p>Đang ngồi ở ${esc(this.seated)}. <button id="btnStand">Đứng dậy</button></p>` : ''}`;
      $('btnStand')?.addEventListener('click', () => this.stand());
      this.renderOnline(); return;
    }
    const mine = this.mySeat, e = this.me.employee;
    let html = '<h2>Chỗ ngồi của tôi</h2>';
    if (this.selecting) html += this.pickHtml();
    else if (mine) {
      const fl = this.app.model.floorById.get(this.app.model.deskById.get(mine.deskId).floor).name;
      html += `<p><b>${esc(mine.deskId)}</b> · ${esc(fl)}${mine.locked ? ' · <span class="err">đang bị khóa</span>' : ''}</p>
        <div class="row tight wrap">
          ${this.seated ? '<button id="btnStand">Đứng dậy (E)</button>' : '<button id="btnSit" class="primary">Ngồi vào chỗ (E khi đứng gần)</button>'}
          ${this.seated ? '' : '<button id="btnGoDesk">Về bàn làm việc (B)</button>'}
          <button id="btnGo">Xem chỗ của tôi</button>
          <button id="btnEquip">Thiết lập bàn làm việc</button>
          ${this.att ? '<button id="btnTimesheet">Bảng công của tôi</button>' : ''}
        </div>${this.editing ? this.equipHtml(this.draft.equipment) + '<div class="row tight"><button id="btnSaveEq" class="primary">Lưu thiết lập</button><button id="btnCancelEq">Hủy</button></div>' : ''}
        <p class="muted small">Chỗ ngồi do công ty xếp theo phòng ban. Muốn đổi chỗ, liên hệ Phòng Hành chính - Nhân sự.</p>`;
    } else html += `<p>Bạn chưa có chỗ ngồi.</p>${this.att ? '<button id="btnTimesheet">Bảng công của tôi</button>' : ''}<p class="muted small">Chỗ ngồi được xếp theo phòng ban của bạn.${this.guide ? ' Chị Mai (hướng dẫn viên) sẽ dẫn bạn tới bàn.' : ' Liên hệ quản trị để được xếp chỗ.'}</p>${this.guide ? '<button id="btnGuide" class="primary">Gặp chị Mai</button>' : ''}`;
    void e;
    box.innerHTML = html;
    $('btnSit')?.addEventListener('click', () => this.sit(mine.deskId));
    $('btnStand')?.addEventListener('click', () => this.stand(true));
    $('btnGo')?.addEventListener('click', () => this.focusDesk(mine.deskId));
    $('btnGoDesk')?.addEventListener('click', () => this.goToDesk());
    $('btnGuide')?.addEventListener('click', () => this.guide?.welcome());
    $('btnTimesheet')?.addEventListener('click', () => this.att?.openMine());
    $('btnEquip')?.addEventListener('click', () => { this.editing = true; this.draft = { deskId: mine.deskId, equipment: { ...defaultEquipment(this.schema), ...(mine.equipment || {}) } }; this.focusDesk(mine.deskId); this.renderSeatBox(); });
    $('btnCancelEq')?.addEventListener('click', () => { this.editing = false; this.draft = null; this.app.rebuildDesks(); this.renderSeatBox(); });
    $('btnSaveEq')?.addEventListener('click', () => this.saveEquipment());
    if (this.selecting) this.bindPick();
    if (this.editing || (this.selecting && this.selected)) this.bindEquip();
    this.renderOnline();
  }

  pickHtml() {
    const m = this.app.model, f = this.pickFloor ?? 1;
    const desks = m.desks.filter(d => d.floor === f);
    const tabs = m.floors.map(fl => `<button data-pf="${fl.id}" class="${fl.id === f ? 'on' : ''}">${esc(fl.name)}</button>`).join('');
    const items = desks.map(d => {
      const s = this.seats.get(d.id), own = s?.owner, mine = own && own.code === this.me.employee.code;
      const st = s?.locked ? 'khóa' : mine ? 'của bạn' : own ? own.display : 'trống';
      const dis = s?.locked || (own && !mine);
      return `<button data-desk="${esc(d.id)}" class="desk-pick ${this.selected === d.id ? 'on' : ''} ${dis ? 'taken' : ''}" aria-pressed="${this.selected === d.id}" title="${esc(st)}"><b>${esc(d.id)}</b><span>${esc(st)}</span></button>`;
    }).join('');
    const sel = this.selected;
    return `<p class="muted small">Chọn chỗ trống trên sơ đồ hoặc bấm vào bàn trên bản đồ. Chỗ có chủ hiện mã-tên chủ chỗ.</p>
      <div class="seg" role="group" aria-label="Tầng">${tabs}</div>
      <div class="desk-grid">${items}</div>
      ${sel ? `<h3 class="small-h">Dụng cụ cho ${esc(sel)}</h3>${this.equipHtml(this.draft.equipment)}
        <div class="row tight"><button id="btnClaim" class="primary">Xác nhận nhận chỗ ${esc(sel)}</button></div>` : ''}
      ${this.mySeat ? '<button id="btnCancelPick">Hủy đổi chỗ</button>' : ''}`;
  }
  bindPick() {
    document.querySelectorAll('[data-pf]').forEach(b => b.onclick = () => { this.pickFloor = +b.dataset.pf; this.markPickFocus(); this.app.showFloor(this.pickFloor); this.renderSeatBox(); });
    document.querySelectorAll('[data-desk]').forEach(b => b.onclick = () => this.selectDesk(b.dataset.desk));
    $('btnClaim')?.addEventListener('click', () => this.claim());
    $('btnCancelPick')?.addEventListener('click', () => this.endPick());
  }

  equipHtml(eq) {
    return '<div class="equip">' + this.schema.items.map(it => {
      const v = eq[it.key], id = `eq_${it.key}`;
      switch (it.type) {
        case 'int': return `<label for="${id}">${esc(it.label)}</label><select id="${id}" data-eq="${it.key}" data-type="int">${Array.from({ length: it.max - it.min + 1 }, (_, i) => it.min + i).map(n => `<option ${n === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
        case 'bool': return `<label class="chk"><input type="checkbox" id="${id}" data-eq="${it.key}" data-type="bool" ${v ? 'checked' : ''}> ${esc(it.label)}</label>`;
        case 'select': return `<label for="${id}">${esc(it.label)}</label><select id="${id}" data-eq="${it.key}" data-type="select">${it.options.map(o => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
        case 'color': return `<fieldset class="swatches"><legend>${esc(it.label)}</legend>${it.options.map(c => `<label class="sw" title="${c}"><input type="radio" name="${id}" data-eq="${it.key}" data-type="color" value="${c}" ${c.toLowerCase() === String(v).toLowerCase() ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</fieldset>`;
        default: return '';
      }
    }).join('') + '</div>';
  }
  bindEquip() {
    document.querySelectorAll('[data-eq]').forEach(el => el.onchange = () => {
      const k = el.dataset.eq, t = el.dataset.type;
      this.draft.equipment[k] = t === 'int' ? +el.value : t === 'bool' ? el.checked : el.value;
      clearTimeout(this._eqT); this._eqT = setTimeout(() => this.app.rebuildDesks(), 60); // xem trước 3D
    });
  }

  beginPick() {
    this.selecting = true; this.selected = null; this.draft = null; this.editing = false;
    this.labels.visible = true;
    const free = this.app.model.desks.find(d => { const s = this.seats.get(d.id); return d.kind !== 'reception' && !s?.owner && !s?.locked; });
    this.pickFloor = free ? free.floor : 1;
    this.app.showFloor(this.pickFloor);
    this.renderSeatBox();
  }
  endPick() {
    this.pickFocus = null;
    this.selecting = false; this.selected = null; this.draft = null;
    this.labels.visible = !!this.showOwners;
    this.app.rebuildDesks(); this.renderSeatBox();
  }

  /** Bản đồ 2D tạm nhìn bàn/tầng vừa chọn cho tới khi nhân vật bước đi. */
  markPickFocus() { const a = this.player?.agent; this.pickFocus = a ? { ax: a.x, az: a.z, af: a.f } : null; }

  selectDesk(deskId) {
    const s = this.seats.get(deskId);
    if (!s) return;
    if (s.locked) { toast('Chỗ này đang bị khóa.', true); return; }
    if (s.owner && s.owner.code !== this.me.employee.code) { toast(`Chỗ này thuộc về ${s.owner.display}`, true); return; }
    this.selected = deskId;
    this.markPickFocus();
    this.draft = { deskId, equipment: normalizeEquipment(this.schema, this.draft?.equipment || defaultEquipment(this.schema)).value };
    this.pickFloor = this.app.model.deskById.get(deskId).floor;
    this.app.rebuildDesks();
    this.focusDesk(deskId);
    this.renderSeatBox();
  }

  async claim() {
    const d = this.draft; if (!d) return;
    const btn = $('btnClaim'); if (btn) { btn.disabled = true; btn.textContent = 'Đang nhận chỗ…'; }
    const r = await api('POST', `/api/seats/${encodeURIComponent(d.deskId)}/claim`, { equipment: d.equipment });
    if (!r.ok) { toast(r.error, true); if (btn) { btn.disabled = false; btn.textContent = `Xác nhận nhận chỗ ${d.deskId}`; } return; }
    this.seats.set(r.seat.deskId, r.seat);
    this.me.employee.canMove = false;
    toast(`Đã nhận chỗ ${r.seat.deskId}. Chỗ này giờ chỉ dành cho bạn.`);
    this.selecting = false; this.selected = null; this.draft = null;
    this.labels.visible = !!this.showOwners;
    this.app.rebuildDesks();
    await this.sit(r.seat.deskId, { quiet: true });
    this.renderSeatBox();
  }

  async saveEquipment() {
    const d = this.draft;
    const r = await api('PUT', `/api/seats/${encodeURIComponent(d.deskId)}/equipment`, { equipment: d.equipment });
    if (!r.ok) { toast(r.error, true); return; }
    this.seats.set(r.seat.deskId, r.seat);
    this.editing = false; this.draft = null; toast('Đã lưu dụng cụ.');
    this.app.rebuildDesks(); this.renderSeatBox();
  }

  // ---------- ngồi / đứng ----------
  async sit(deskId, { quiet, place } = {}) {
    const r = await api('POST', `/api/seats/${encodeURIComponent(deskId)}/sit`, {});
    if (!r.ok) { toast(r.error, true); return false; }
    this.seated = deskId;
    if (this.app.rig.walkMode) this.app.rig.setWalk(false);
    const desk = this.app.model.deskById.get(deskId);
    if (this.player) {
      const pa = this.player.agent, far = Math.hypot(pa.x - desk.seat.x, pa.z - desk.seat.z) > 1.6 || pa.f !== desk.floor;
      (place || far) ? this.player.placeSeated(desk) : this.player.sitAt(desk); this.player.follow();
    }
    else this.focusDesk(deskId);
    if (!quiet) toast(`Đã ngồi vào ${deskId}.`);
    this.renderSeatBox();
    return true;
  }
  async stand(walk = false) {
    if (!this.seated) return;
    const deskId = this.seated;
    await api('POST', '/api/seats/stand', {});
    this.seated = null;
    if (this.player) { this.player.standUp(); this.player.follow(); this.renderSeatBox(); return; }
    if (walk) {
      const d = this.app.model.deskById.get(deskId), f = facingVec(d.facing || 0);
      this.app.rig.tele(d.seat.x - f.x * 0.45, d.seat.z - f.z * 0.45, d.facing * Math.PI / 180, this.app.model.floorY(d.floor));
    }
    this.renderSeatBox();
  }

  focusDesk(deskId) {
    const d = this.app.model.deskById.get(deskId); if (!d) return;
    this.app.showFloor(d.floor, false);
    const f = facingVec(d.facing || 0);
    const th = Math.atan2(-f.x, -f.z) + 0.6; // nhìn từ phía sau-chéo người ngồi
    this.app.rig.follow = null;
    const fs = this.app.model.fs || 1;
    this.app.rig.view(th, 0.85, 1.4 + 2.2 * fs, [d.x, this.app.model.floorY(d.floor) + 0.85 * fs, d.z]);
  }

  // ---------- bấm vào bàn trong cảnh 3D ----------
  /** Tìm bàn tại điểm trúng (gồm cả vùng ghế). */
  deskAt(point) {
    const m = this.app.model;
    let best = null, bd = Infinity;
    for (const d of m.desks) {
      const y = m.floorY(d.floor);
      if (point.y < y - 0.2 || point.y > y + 1.6) continue;
      const fp = footprint(d.x, d.z, (d.w || 1) + 0.1, (d.d || 0.6) + 0.1, d.facing);
      const inDesk = point.x >= fp.x0 && point.x <= fp.x1 && point.z >= fp.z0 && point.z <= fp.z1;
      const ds = Math.hypot(point.x - d.seat.x, point.z - d.seat.z);
      const score = inDesk ? 0 : ds;
      if ((inDesk || ds < 0.4) && score < bd) { bd = score; best = d; }
    }
    return best;
  }
  async onDeskClick(d) {
    if (this.selecting) { this.selectDesk(d.id); return; }
    if (this.isAdmin && this.app.dashboard) { this.app.dashboard.deskActions(d.id); return; }
    if (this.player) {
      // đang điều khiển nhân vật: chỉ báo chủ chỗ, ngồi bằng phím E khi đứng cạnh ghế
      const s0 = this.seats.get(d.id), mine0 = s0?.owner && s0.owner.code === this.me.employee.code;
      toast(`${d.id}: ${s0?.locked ? 'đang khóa' : mine0 ? 'chỗ của bạn — lại gần bấm E để ngồi' : s0?.owner ? `thuộc về ${s0.owner.display}` : 'chỗ trống'}`);
      return;
    }
    const s = this.seats.get(d.id);
    const owner = s?.owner ? s.owner.display : (s?.locked ? 'đang khóa' : 'trống');
    const mine = s?.owner && this.me.employee && s.owner.code === this.me.employee.code;
    const r = await modal({
      title: `Chỗ ${d.id}`,
      body: `<p>${esc(this.app.model.floorById.get(d.floor).name)} · ${s?.owner ? `Chủ chỗ: <b>${esc(owner)}</b>` : esc(owner === 'trống' ? 'Chỗ trống' : 'Chỗ đang khóa')}</p>${!s?.owner && !s?.locked && this.canPick ? '<p class="muted small">Bạn có thể nhận chỗ này ở khung "Chỗ ngồi của tôi".</p>' : ''}`,
      okText: mine ? 'Ngồi vào chỗ' : 'Thử ngồi vào chỗ này', cancelText: 'Đóng'
    });
    if (!r) return;
    await this.sit(d.id); // server quyết định: chỉ chủ chỗ được ngồi
  }

  // ---------- nhãn chủ chỗ ----------
  renderLabels() {
    for (const c of [...this.labels.children]) { this.labels.remove(c); c.material.map.dispose(); c.material.dispose(); }
    const m = this.app.model, myCode = this.me.employee?.code;
    for (const d of m.desks) {
      const s = this.seats.get(d.id);
      const mine = s?.owner && s.owner.code === myCode;
      const text = s?.locked ? `${d.id} khóa` : s?.owner ? (mine ? 'Chỗ của bạn' : s.owner.display) : d.id;
      const bg = s?.locked ? '#8a2417' : mine ? '#d9822b' : s?.owner ? '#3a3f4a' : '#2d7a4a';
      const l = labelSprite(text, bg);
      l.position.set(d.x, m.floorY(d.floor) + 1.25 * (m.fs || 1), d.z); // dính trên bàn, ngay trên đỉnh màn hình
      l.userData.floor = d.floor;
      l.userData.deskId = d.id;
      this.labels.add(l);
    }
  }

  // ---------- danh sách online ----------
  /**
   * Có người vừa vào công ty: thông báo góc phải + âm báo. Người vừa rời đi dưới 2 phút rồi vào lại (tải lại trang, rớt mạng)
   * thì không báo, đỡ ồn.
   */
  announceArrivals(list) {
    if (!this.known) return;
    const now = Date.now(), left = this.leftAt || (this.leftAt = new Map()), keys = new Set(list.map(o => o.key));
    for (const k of this.known) if (!keys.has(k)) left.set(k, now);
    const fresh = list.filter(o => !this.known.has(o.key) && o.key !== this.key && !(now - (left.get(o.key) || 0) < 120e3));
    this.known = keys;
    if (!fresh.length) return;
    const names = fresh.map(o => o.display);
    notice({ title: names.length === 1 ? `${names[0]} vừa vào công ty` : `${names.length} người vừa vào công ty`, text: names.length > 1 ? names.join(', ') : 'Chào mừng tới SYSONE!', icon: 'user', tone: 'join' });
    sound.play('join');
  }
  renderOnline() {
    let box = $('onlineBox');
    if (!box) { box = document.createElement('section'); box.className = 'box'; box.id = 'onlineBox'; $('simBox').parentNode.insertBefore(box, $('simBox')); }
    const list = this.online;
    box.innerHTML = `<h2><span class="ol-lbl">Đang online </span><span class="ol-n">(${list.length})</span></h2><ul class="online-list">${list.map(o => `<li><button data-follow="${esc(o.key)}" title="Bấm để camera bám theo"><span class="dot" style="background:${o.kind === 'admin' ? '#202124' : '#2bb673'}"></span>${esc(o.display)}${o.key === this.key ? ' (bạn)' : ''}<span class="muted small">${o.seated ? ` · ngồi ${esc(o.seated)}` : ''}</span></button>${o.key !== this.key ? `<button class="ol-dm" data-dm="${esc(o.key)}" title="Nhắn riêng" aria-label="Nhắn riêng với ${esc(o.display)}">✉</button>` : ''}</li>`).join('')}</ul>`;
    box.querySelectorAll('[data-follow]').forEach(b => b.onclick = () => this.follow(b.dataset.follow));
    const ho = document.querySelector('#sessionBar .hdr-online b'); if (ho) ho.textContent = String(list.length);   // (điện thoại: số online trong thẻ logo)
    box.querySelectorAll('[data-dm]').forEach(b => b.onclick = e => { e.stopPropagation(); this.social?.dm(b.dataset.dm); });
  }
  follow(key) {
    if (key === this.key && this.player) { this.player.follow(); return; }
    const a = this.remote.byKey.get(key);
    if (!a) { toast('Người này đang online nhưng chưa vào trong văn phòng 3D.', true); return; }
    this.app.followTarget(a);
  }

  // ---------- mỗi khung hình ----------
  update(dt, cutY, rawDt = dt) {
    this.remote.selfHidden = this.app.rig.walkMode;
    if (this.player) this.player.update(rawDt); // (thời gian thật, tối đa 1 s — nhân vật tự chia bước)
    this.remote.update(dt, cutY);
    this.fx.update(dt, this.remote.list);
    this.blinds.update(dt);
    // gợi ý kéo rèm khi đứng gần cửa sổ; gọi thang máy khi đứng trước cửa thang
    if (this.player) {
      const a = this.player.agent, free = !this.player.seated && !this.player.seq;
      const ls = free && this.lift && !a.onStair ? this.lift.near(a.x, a.z, a.f) : null;
      this.lift?.update(dt, ls ? ls.f : null);
      if (!ls && this._liftBox) this.closeLift();
      // sofa xem TV: TV bật khi có người đang ngồi xem (mình hoặc người online khác)
      const sofa = free && !ls && this.tv ? this.tv.near(a.x, a.z, a.f) : null;
      this.tv?.update(dt, !!this.player.sofa || this.remote.list.some(x => x !== a && x.act === 'tv'));
      const it = free && !ls && !sofa ? this.blinds.near(a.x, a.z, a.f) : null;
      this.guide?.update(dt);
      this.att?.update(dt); this.att?.tick(a);
      const lt = free && !ls && this.lights?.near(a.x, a.z, a.f);
      this.nearLights = lt;
      const tc = free && !ls && !lt && this.att?.code && this.att.near(a.x, a.z, a.f);
      const mc = free && !ls && this.app.musicCorner?.near(a.x, a.z, a.f);
      const gd = free && !ls && !sofa && this.guide?.near(a.x, a.z, a.f);
      // đồ vật dùng được (pha cà phê, máy in, sách, cá, mèo, đèn, game…): tạo khi toà nhà đã dựng xong
      if (!this.props && this.app.bldRoot && this.app.nav) this.props = new Props(this.app, this);
      this.props?.update(dt);
      this.ktv?.update(); this.bil?.update(dt);
      this.wc?.update(dt);
      const ws = free && !ls && !lt && !tc && this.wc ? this.wc.nearStall(a.x, a.z, a.f) : null, wk = free && !ls && !lt && !tc && !ws && this.wc?.nearSink(a.x, a.z, a.f);
      this.nearStall = ws; this.nearSink = wk;
      const kt = free && !ls && !sofa && !tc && !mc && !gd && this.ktv && !this.ktv.inRoom && this.ktv.near(a.x, a.z, a.f);
      this.nearKtv = kt;
      const bl = free && !ls && !sofa && !tc && !mc && !gd && !kt && this.bil && !this.bil.mine && this.bil.near(a.x, a.z, a.f) && this.bil.prompt() ? true : false;
      this.nearBil = bl;
      const pr = free && !ls && !sofa && !tc && !mc && !gd && !kt && !bl && !this.props?.busy && !this.bil?.mine && !this.ktv?.inRoom ? this.props?.near(a.x, a.z, a.f, a.yaw) : null;
      this.nearProp = pr;
      const prompt = this.player.sofa ? '<b>E</b> đứng dậy (đang xem TV)' : this.wc?.locked ? '' : lt ? this.lights.prompt() : ws ? this.wc.prompt(ws) : wk ? (this.wc.looking ? '<b>E</b> thôi soi gương' : '<b>E</b> soi gương 🪞') : tc ? this.att.prompt() : mc ? `<b>E</b> ${this.social?.musicState?.on ? 'đổi / tắt nhạc' : 'bật nhạc cho cả công ty'}` : gd ? '<b>E</b> nói chuyện với chị Mai (hướng dẫn)' : ls ? `<b>E</b> đi thang máy (đang ở ${LIFT_FLOORS[ls.f].toLowerCase()})` : sofa ? '<b>E</b> ngồi sofa xem TV' : kt ? this.ktv.prompt() : bl ? this.bil.prompt() : pr ? this.props.prompt(pr) : it ? `<b>F</b> ${it.open ? 'hạ' : 'kéo'} ${it.name.toLowerCase()}` : '';
      if (prompt !== this._prompt) { this._prompt = prompt; this.app.setPrompt?.(prompt); }
    }
    if (this.labels.visible) {
      // đang điều khiển nhân vật: chỉ hiện nhãn tầng mình đang đứng (không lộ nhãn tầng khác xuyên trần)
      const cf = this.player && !this.selecting && this.app.rig.follow === this.player.agent ? this.player.agent.f : this.app.cutFloor();
      for (const l of this.labels.children) l.visible = cf === null || l.userData.floor === cf;
    }
    const rig = this.app.rig;
    if (!this.player && rig.walkMode) {
      const PL = rig.PL, m = this.app.model;
      let f = 0; for (const fl of m.floors) if (PL.feet >= fl.y - 0.3) f = fl.id;
      const moving = !!(rig.keys.w || rig.keys.s || rig.keys.a || rig.keys.d || rig.keys.up || rig.keys.down || rig.holds.f || rig.holds.b || rig.holds.l || rig.holds.r);
      this.rt.sendPos({ x: +PL.x.toFixed(3), y: +PL.feet.toFixed(3), z: +PL.z.toFixed(3), f, yaw: +PL.yaw.toFixed(3), walk: moving });
    }
  }

  // ---------- về bàn làm việc (phím B) ----------
  /** Tự đi về bàn của mình rồi ngồi: khác tầng thì đi tới thang máy, lên/xuống, rồi đi tiếp tới ghế. Bấm phím đi để huỷ. */
  async goToDesk() {
    const pl = this.player, a = pl?.agent, mine = this.mySeat; if (!pl) return;
    if (!mine) { toast('Bạn chưa có chỗ ngồi — gặp chị Mai ở sảnh để được xếp chỗ.', true); return; }
    if (this.seated === mine.deskId) { toast('Bạn đang ngồi ở bàn làm việc rồi.'); return; }
    if (this._goingDesk) return;
    const desk = this.app.model.deskById.get(mine.deskId), ap = seatApproach(desk.seat), my = this._goingDesk = Symbol('go');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const walk = async (x, z, f) => {                                        // đi theo lưới; true khi tới nơi (≤ 1,2 m)
      if (!pl.walkTo(x, z, f)) return Math.hypot(a.x - x, a.z - z) < 1.2 && a.f === f;
      for (let t = 0; t < 600 && pl.path && this._goingDesk === my; t++) await sleep(100);
      return this._goingDesk === my && a.f === f && Math.hypot(a.x - x, a.z - z) < 1.2;
    };
    try {
      if (pl.sofa) { pl.standSofa(); await sleep(700); }
      if (pl.seated) { await this.stand(); await sleep(900); }
      toast(`Đang về bàn ${mine.deskId}…`);
      if (a.f !== desk.floor && this.lift) {
        const st = this.lift.stops[a.f];
        if (!(await walk(st.x, st.z, a.f))) return;
        this.rideLift(desk.floor); await sleep(1400);
      }
      if (!(await walk(ap.x, ap.z, desk.floor))) { if (this._goingDesk === my && pl.lastStop === 'stuck') toast('Bị vướng trên đường về bàn — đi ra chỗ thoáng rồi bấm B lại nhé.', true); return; }
      await this.sit(mine.deskId);
    } finally { if (this._goingDesk === my) this._goingDesk = null; }
  }

  // ---------- thang máy ----------
  /** Đứng trước cửa thang máy: bảng chọn tầng (bấm hoặc phím 1/2/3; Esc đóng). click: bấm vào cửa thang từ xa. */
  openLift(click = false) {
    const a = this.player?.agent; if (!a || !this.lift) return false;
    const st = this.lift.near(a.x, a.z, a.f);
    if (!st) { if (click) toast('Lại gần cửa thang máy rồi bấm E (hoặc bấm vào cửa) để chọn tầng.'); return false; }
    if (this.player.seated || this.player.seq) return true;
    if (this._liftBox) { this.closeLift(); return true; }
    const box = document.createElement('div'); box.className = 'lift-box'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Thang máy');
    box.innerHTML = `<div class="lift-title">Thang máy <span>· chọn tầng</span></div><div class="lift-btns">${LIFT_FLOORS.map((n, f) => `<button type="button" data-f="${f}" ${f === st.f ? 'disabled' : ''}><b>${f === 0 ? 'T' : f + 1}</b><span>${n}${f === st.f ? ' · bạn đang ở đây' : ''}</span></button>`).join('')}</div><div class="lift-hint">Phím <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> · <kbd>Esc</kbd> đóng</div>`;
    box.querySelectorAll('button[data-f]').forEach(b => b.onclick = () => this.rideLift(+b.dataset.f));
    document.getElementById('appRoot').appendChild(box); this._liftBox = box;
    this._liftKey = e => {
      if (e.key === 'Escape') { this.closeLift(); e.stopPropagation(); return; }
      const n = { '1': 0, '2': 1, '3': 2 }[e.key]; if (n !== undefined && n !== st.f) { e.preventDefault(); e.stopPropagation(); this.rideLift(n); }
    };
    window.addEventListener('keydown', this._liftKey, true);
    this.lift.openAt(st.f, 1.5);
    return true;
  }
  closeLift() { this._liftBox?.remove(); this._liftBox = null; if (this._liftKey) window.removeEventListener('keydown', this._liftKey, true); this._liftKey = null; }
  /** Đi thang máy tới tầng f: màn hình tối dần, ra trước cửa thang tầng f (cửa mở rồi tự đóng). */
  rideLift(f) {
    const pl = this.player, a = pl?.agent, to = this.lift?.stops[f]; if (!to) return;
    if (this._riding) { this.closeLift(); setTimeout(() => this.rideLift(f), 300); return; } // (chuyến trước chưa xong: chờ rồi đi, không bỏ qua lệnh)
    this.closeLift(); this._riding = true; pl.stopPath?.();
    const fade = document.createElement('div'); fade.className = 'lift-fade'; document.getElementById('appRoot').appendChild(fade);
    requestAnimationFrame(() => fade.classList.add('on'));
    setTimeout(() => {
      Object.assign(a, { x: to.x, z: to.z, y: to.y, f, onStair: null, sit: 0, walkAmt: 0, yaw: to.yaw }); // ra khỏi thang: quay mặt vào trong
      pl.vx = pl.vz = pl.vy = 0; pl.onGround = true;
      const rig = this.app.rig; if (rig.follow === a) { rig.S.t.set(a.x, a.y + 0.65 * pl.H, a.z); rig.G.t.copy(rig.S.t); rig.camDist = null;
        // sau lưng là tường thang: chọn góc nhìn thấy trọn người (ưu tiên chéo ra phía trước)
        const cands = [a.yaw + Math.PI - 0.7, a.yaw + Math.PI + 0.7, a.yaw - 1.6, a.yaw + 1.6, a.yaw + Math.PI];
        let best = cands[0], bs = -1; for (const th of cands) { const v = rig.viewScore ? rig.viewScore(a, th, rig.S.ph, rig.S.r, pl.H) : 0; if (v > bs) { bs = v; best = th; } }
        rig.S.th = rig.G.th = best; }
      this.lift.openAt(f, 2.6); pl.send(true);
      fade.classList.remove('on'); setTimeout(() => { fade.remove(); this._riding = false; }, 450);
      toast(`Thang máy: đã tới ${LIFT_FLOORS[f].toLowerCase()}.`);
    }, 700);
  }

  /** Kéo/hạ rèm (gửi cho mọi người; server lưu trạng thái). */
  toggleBlind(it) {
    if (!it) return false;
    this.blinds.set(it.id, !it.open);
    this.rt.ws?.readyState === 1 && this.rt.ws.send(JSON.stringify({ t: 'blind', id: it.id, open: it.open }));
    return true;
  }
  toggleBlindNear() {
    const a = this.player?.agent;
    if (!a) return;
    if (!this.toggleBlind(this.blinds.near(a.x, a.z, a.f))) toast('Lại gần cửa sổ rồi bấm F để kéo rèm.');
  }

  /** Phím E khi đi bộ: ngồi vào bàn gần nhất trước mặt (server kiểm tra quyền). */
  sitNearest() {
    const PL = this.app.rig.PL, m = this.app.model;
    let best = null, bd = 1.3;
    for (const d of m.desks) { if (Math.abs(m.floorY(d.floor) - PL.feet) > 0.5) continue; const dd = Math.hypot(d.seat.x - PL.x, d.seat.z - PL.z); if (dd < bd) { bd = dd; best = d; } }
    if (!best) { toast('Không có chỗ ngồi nào ở gần.', true); return; }
    this.sit(best.id);
  }
}
