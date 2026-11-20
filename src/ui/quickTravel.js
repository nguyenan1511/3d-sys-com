// "Đi nhanh tới" (thay mục Góc nhìn trong bảng điều khiển): danh sách nơi trong công ty — bàn của tôi, ngoài đường, cổng, cửa
// chính, sảnh, máy chấm công, các phòng tầng trệt, góc âm nhạc, khu của từng phòng ban (tầng 2, 3), sân thượng. Bấm một nơi:
// màn hình tối dần, nhân vật có mặt ở ô đi được gần nơi đó nhất (theo lưới đi lại — không bao giờ rơi vào góc chết),
// camera chọn góc thấy trọn người.
import { esc } from '../session/ui.js';
import { icon } from './icons.js';
import { seatApproach } from '../model/layoutModel.js';
import { initialsOf } from './hud.js';

const FLOOR_NAMES = ['Tầng trệt', 'Tầng 2', 'Tầng 3'];
/** Màu ô vuông của một nơi (= màu phòng trên bản đồ nhỏ, bảng màu của thiết kế HUD). */
export const ROOM_COLORS = { meeting: '#9C97D6', pantry: '#D7BE8A', wc: '#8DB5D6', lounge: '#94C9B0', lobby: '#DDBF4C', office: '#CDBFA9', server: '#BFB3A0', director: '#CDBFA9', library: '#8CC5A0' };
function placeColor(it) {
  if (it.type) return ROOM_COLORS[it.type] || ROOM_COLORS.office;
  return { door: ROOM_COLORS.meeting, music: '#F7A27F', clipboard: '#DDBF4C', user: '#DDBF4C', cube: ROOM_COLORS.lounge, arrowUp: '#8A8D96', logout: '#BFB3A0' }[it.icon] || '#CDBFA9';
}

export class QuickTravel {
  constructor(app, session, host) {
    this.app = app; this.s = session; this.host = host;
    this.render();
  }
  /** Các nơi đi tới được, theo nhóm. */
  places() {
    const m = this.app.model, L = m.layout, wp = m.waypoints, groups = [];
    const out = [];
    if (wp.sidewalk) out.push({ name: 'Ngoài đường (vỉa hè)', icon: 'map', f: 0, x: wp.sidewalk.x, z: wp.sidewalk.z, r: 1.2 });
    if (wp.gate) out.push({ name: 'Cổng công ty', icon: 'logout', f: 0, x: wp.gate.x, z: wp.gate.z - 0.6, r: 1.2 });
    if (wp.porch) out.push({ name: 'Trước cửa chính', icon: 'logout', f: 0, x: wp.porch.x, z: wp.porch.z, r: 1.2 });
    groups.push({ title: 'Bên ngoài', items: out });
    for (let f = 0; f < m.floors.length; f++) {
      const items = [];
      if (f === 0) {
        if (wp.lobby) items.push({ name: (__REAL_SYS__ && L.world === 'sysone-real') ? 'Sảnh · cửa chính' : 'Sảnh · lễ tân', icon: 'user', f, x: wp.lobby.x, z: wp.lobby.z, r: 1.5 });
        const at = this.s.att; if (at) items.push({ name: 'Máy chấm công', icon: 'clipboard', f, x: at.spot.stand.x, z: at.spot.stand.z, r: 1.0 });
        const mc = this.app.musicCorner; if (mc) items.push({ name: 'Góc âm nhạc', icon: 'music', f, x: mc.stand.x, z: mc.stand.z, r: 1.0 });
        const tv = this.s.tv; if (tv) items.push({ name: 'Sofa xem TV', icon: 'cube', f, x: tv.seats[0].front.x, z: tv.seats[0].front.z + 0.4, r: 1.0 });
      }
      for (const r of L.rooms || []) if (r.floor === f && !(r.type === 'lobby' && wp.lobby && f === 0) && !(L.deptZones || []).some(z => z.floor === f && z.x0 >= r.x0 - 0.5 && z.x1 <= r.x1 + 0.5 && z.z0 >= r.z0 - 0.5 && z.z1 <= r.z1 + 0.5))
        items.push(r.type === 'meeting' && this.s.meet?.door ? { name: r.name, icon: 'door', type: r.type, box: r, f, x: this.s.meet.door.x, z: this.s.meet.door.z, r: 1.0 } : { name: r.name, icon: 'map', type: r.type || 'office', box: r, f, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, r: 3 });   // (phòng họp: tới cửa — phòng có thể đang họp)
      for (const z of L.deptZones || []) if (z.floor === f) items.push({ name: z.name.replace(/^Phòng /, ''), color: z.color, box: z, f, x: (z.x0 + z.x1) / 2, z: z.z1 + 0.4, r: 2.5 });
      const lift = this.s.lift?.stops?.[f]; if (lift) items.push({ name: 'Thang máy', icon: 'arrowUp', f, x: lift.x, z: lift.z, r: 1.0 });
      if (f === 2 && (!__REAL_SYS__ || L.world !== 'sysone-real')) { const t = (L.nav.areas || []).find(a => a.floor === 2 && /sân thượng/i.test(a.name || '')); items.push({ name: 'Sân thượng', icon: 'map', f, x: t ? (t.x0 + t.x1) / 2 : 1.0, z: t ? (t.z0 + t.z1) / 2 : 3.5, r: 3 }); }
      if (items.length) groups.push({ title: ((__REAL_SYS__ && this.app?.model?.layout?.world === 'sysone-real') ? this.app.model.floorById.get(+f)?.name : FLOOR_NAMES[f]) || `Tầng ${f + 1}`, items });
    }
    return groups;
  }
  /** Đồng nghiệp đang ở trong văn phòng 3D (đi nhanh tới cạnh họ). */
  people() {
    const out = [], me = this.s.key, names = ['Tầng trệt', 'Tầng 2', 'Tầng 3'];
    for (const o of this.s.online || []) {
      if (o.key === me) continue; const a = this.s.remote?.byKey?.get(o.key); if (!a || a.visible === false || a.f == null) continue;
      out.push({ name: o.kind === 'admin' ? 'Admin' : o.display, person: o.key, f: a.f, x: a.x, z: a.z, r: 2, color: '#F26B3A', meta: names[a.f] || `Tầng ${a.f + 1}` });
    }
    return out;
  }
  /** Cột phải: tầng (hoặc "Bên ngoài") · số người đang ở đó (đồng nghiệp online trong phòng / khu). */
  meta(x) {
    if (x.person) return x.meta;
    const where = x.group, n = x.box ? this.countIn(x) : 0;
    return n ? `${where} · ${n} người` : where;
  }
  countIn(x) {
    const b = x.box; let n = 0;
    for (const a of this.s.remote?.list || []) if (a !== this.s.player?.agent && a.visible !== false && a.f === x.f && a.x >= b.x0 && a.x <= b.x1 && a.z >= b.z0 && a.z <= b.z1) n++;
    return n;
  }
  /** Cập nhật số người mỗi 5 giây khi danh sách đang mở (không vẽ lại cả danh sách). */
  tickMeta() {
    if (!this.host.isConnected || !this.host.closest('details')?.open) return;
    this.host.querySelectorAll('[data-meta]').forEach(m => { const t = this.meta(this.flat[+m.dataset.meta]); if (m.textContent !== t) m.textContent = t; });
  }
  /** Máy tính: danh sách tự cuộn trong phần còn lại của cột trái (thẻ <details> không co theo flex nên phải tính chiều cao). */
  fit() {
    const list = this.host.querySelector('.qt-list'); if (!list) return;
    if (!this.fitOn) {
      this.fitOn = true; const run = () => this.fit();
      addEventListener('resize', run); this.host.closest('details')?.addEventListener('toggle', run);
      if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(run); for (const id of ['hudProfile', 'seatBox']) { const el = document.getElementById(id); if (el) ro.observe(el); } }
    }
    if (innerWidth < 1024) { list.style.maxHeight = ''; return; }   // (điện thoại / máy tính bảng: cả ngăn kéo cuộn như cũ)
    const top = list.getBoundingClientRect().top, bottom = innerHeight - 88 - 10 - 10;   // (chừa hàng dưới 20 + 48 + 20, lề thẻ)
    const sim = document.getElementById('simBox'), simOn = sim && !sim.hidden;   // (chế độ mô phỏng: còn các thẻ khác bên dưới → danh sách gọn, cả cột cuộn)
    list.style.maxHeight = `${simOn ? 260 : Math.max(140, Math.round(bottom - top))}px`;
  }
  render() {
    if (!this.metaT) this.metaT = setInterval(() => this.tickMeta(), 5000);
    const groups = this.places(), ppl = this.people();
    if (ppl.length) groups.push({ title: 'Đồng nghiệp đang online', items: ppl });
    this.flat = groups.flatMap(g => g.items.map(it => ({ ...it, meta: it.meta || g.title, group: g.title })));
    const mine = this.s.mySeat;
    // (design_handoff_office_hud) ô tìm + danh sách theo nhóm (Bên ngoài · Tầng trệt · Tầng 2 · Tầng 3 · Đồng nghiệp): ô màu (= màu
    // trên bản đồ) · tên · tầng; chỉ danh sách cuộn. Mũi tên tiêu đề: cùng kiểu với thẻ hồ sơ.
    const sum = this.host.closest('details')?.querySelector('summary');
    if (sum && !sum.querySelector('.qt-g')) sum.insertAdjacentHTML('beforeend', `<kbd class="qt-g" title="Phím G">G</kbd><span class="qt-chev" aria-hidden="true">${icon('chevDown', 18)}</span>`);
    const old = this.host.querySelector('.qt-q'), q = old?.value || '', focused = old && document.activeElement === old;
    let k = 0;
    this.host.innerHTML = `<div class="qt">
      <label class="qt-search">${icon('search', 16)}<input class="qt-q" type="search" placeholder="Tìm phòng, khu vực, đồng nghiệp…" aria-label="Tìm nơi để đi nhanh tới" autocomplete="off"></label>
      <div class="qt-list" role="list">
      ${mine ? `<button type="button" class="qt-desk qt-row" data-desk data-name="bàn làm việc của tôi ${esc(mine.deskId.toLowerCase())}"><i class="qt-ic" style="--c:#F26B3A">${icon('target', 13)}</i><span class="qt-n">Bàn làm việc của tôi</span><span class="qt-m">${esc(mine.deskId)}</span></button>` : ''}
      ${groups.map(g => `<div class="qt-sec" data-sec>${esc(g.title)}</div>${g.items.map(it => { const i = k++, x = this.flat[i]; return `<button type="button" class="qt-item qt-row" data-i="${i}" data-name="${esc(x.name.toLowerCase())} ${esc(x.group.toLowerCase())}" title="Đi nhanh tới ${esc(x.name)}">${x.person ? `<i class="qt-ic p" style="--c:#F26B3A">${esc(initialsOf(x.name))}</i>` : x.icon ? `<i class="qt-ic" style="--c:${placeColor(x)}">${icon(x.icon, 13)}</i>` : `<i class="qt-ic sq" style="--c:${x.color || placeColor(x)}"></i>`}<span class="qt-n">${esc(x.name)}</span><span class="qt-m" data-meta="${i}">${esc(this.meta(x))}</span></button>`; }).join('')}`).join('')}
      <p class="qt-none" hidden>Không tìm thấy kết quả.</p></div>
    </div>`;
    this.host.querySelectorAll('[data-i]').forEach(b => b.onclick = () => this.go(this.flat[+b.dataset.i]));
    this.host.querySelector('[data-desk]')?.addEventListener('click', () => this.goDesk());
    const input = this.host.querySelector('.qt-q'), filter = () => {
      const t = input.value.trim().toLowerCase(); let n = 0;
      this.host.querySelectorAll('.qt-row').forEach(b => { const ok = !t || b.dataset.name.includes(t); b.hidden = !ok; if (ok) n++; });
      // tiêu đề nhóm: ẩn khi cả nhóm bị lọc hết
      this.host.querySelectorAll('[data-sec]').forEach(h => { let e = h.nextElementSibling, any = false; while (e && !e.hasAttribute('data-sec')) { if (e.classList.contains('qt-row') && !e.hidden) any = true; e = e.nextElementSibling; } h.hidden = !any; });
      this.host.querySelector('.qt-none').hidden = n > 0;
    };
    input.value = q; input.oninput = filter; if (q) filter();
    this.fit();
    if (focused) { input.focus(); input.setSelectionRange(q.length, q.length); }
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { input.value = ''; filter(); input.blur(); } if (e.key === 'Enter') { const b = [...this.host.querySelectorAll('.qt-row')].find(x => !x.hidden); b?.click(); } });
  }
  /** Ô đi được gần (x, z) nhất trên tầng f (trong bán kính r), hoặc null. */
  spot(f, x, z, r) {
    const g = this.app.nav.grid(f); if (!g) return null;
    if (g.isFree(x, z, 0.2)) return { x, z };
    const k = g.nearestFree(x, z, r); return k >= 0 ? { x: g.cx(k), z: g.cz(k) } : null;
  }
  /** Màn hình tối dần → đặt nhân vật → sáng lại. */
  async jump(f, x, z, yaw) {
    const pl = this.s.player, a = pl?.agent; if (!a || this.busy) return false;
    this.busy = true;
    try {
      if (pl.sofa) pl.standSofa();
      if (pl.seated) { await this.s.stand(); }
      pl.stopPath(); pl.seq = null;
      const fade = document.createElement('div'); fade.className = 'lift-fade'; document.getElementById('appRoot').appendChild(fade);
      requestAnimationFrame(() => fade.classList.add('on'));
      await new Promise(r => setTimeout(r, 380));
      Object.assign(a, { x, z, y: this.app.model.floorY(f), f, onStair: null, sit: 0, walkAmt: 0, ...(yaw != null ? { yaw } : {}) });
      pl.vx = pl.vz = pl.vy = 0; pl.onGround = true; pl.follow();
      const rig = this.app.rig; rig.S.t.set(a.x, a.y + 0.65 * pl.H, a.z); rig.G.t.copy(rig.S.t); rig.camDist = null;
      // góc camera thấy trọn người (ưu tiên sau lưng)
      let best = a.yaw, bs = -1; for (let i = 0; i < 12; i++) { const th = a.yaw + i * Math.PI / 6, v = rig.viewScore ? rig.viewScore(a, th, rig.S.ph, rig.S.r, pl.H) : 0; if (v > bs + 0.01) { bs = v; best = th; } if (bs >= 2) break; }
      rig.S.th = rig.G.th = best; rig.lastUserOrbit = 0;
      pl.send(true);
      fade.classList.remove('on'); setTimeout(() => fade.remove(), 450);
      return true;
    } finally { this.busy = false; }
  }
  async go(it) {
    if (it.person) { const a = this.s.remote?.byKey?.get(it.person); if (!a || a.f == null) { this.s.toast(`${it.name} không còn trong văn phòng.`, true); return; } it = { ...it, f: a.f, x: a.x, z: a.z }; }   // (vị trí lúc bấm)
    const p = this.spot(it.f, it.x, it.z, it.r || 2);
    if (!p) { this.s.toast(`Chưa tới được ${it.name}.`, true); return; }
    if (await this.jump(it.f, p.x, p.z)) this.s.toast(`Đã tới ${it.name}.`);
  }
  async goDesk() {
    const mine = this.s.mySeat; if (!mine) return;
    const d = this.app.model.deskById.get(mine.deskId), ap = seatApproach(d.seat), p = this.spot(d.floor, ap.x, ap.z, 1.2);
    if (!p) { this.s.goToDesk(); return; }
    if (await this.jump(d.floor, p.x, p.z)) await this.s.sit(mine.deskId);
  }
}
