// "Đi nhanh tới" (thay mục Góc nhìn trong bảng điều khiển): danh sách nơi trong công ty — bàn của tôi, ngoài đường, cổng, cửa
// chính, sảnh, máy chấm công, các phòng tầng trệt, góc âm nhạc, khu của từng phòng ban (tầng 2, 3), sân thượng. Bấm một nơi:
// màn hình tối dần, nhân vật có mặt ở ô đi được gần nơi đó nhất (theo lưới đi lại — không bao giờ rơi vào góc chết),
// camera chọn góc thấy trọn người.
import { esc } from '../session/ui.js';
import { icon } from './icons.js';
import { seatApproach } from '../model/layoutModel.js';

const FLOOR_NAMES = ['Tầng trệt', 'Tầng 2', 'Tầng 3'];

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
      for (const r of L.rooms || []) if (r.floor === f && !(L.deptZones || []).some(z => z.floor === f && z.x0 >= r.x0 - 0.5 && z.x1 <= r.x1 + 0.5 && z.z0 >= r.z0 - 0.5 && z.z1 <= r.z1 + 0.5))
        items.push(r.type === 'meeting' && this.s.meet?.door ? { name: r.name, icon: 'door', f, x: this.s.meet.door.x, z: this.s.meet.door.z, r: 1.0 } : { name: r.name, icon: 'map', f, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, r: 3 });   // (phòng họp: tới cửa — phòng có thể đang họp)
      for (const z of L.deptZones || []) if (z.floor === f) items.push({ name: z.name.replace(/^Phòng /, ''), color: z.color, f, x: (z.x0 + z.x1) / 2, z: z.z1 + 0.4, r: 2.5 });
      const lift = this.s.lift?.stops?.[f]; if (lift) items.push({ name: 'Thang máy', icon: 'arrowUp', f, x: lift.x, z: lift.z, r: 1.0 });
      if (f === 2 && (!__REAL_SYS__ || L.world !== 'sysone-real')) { const t = (L.nav.areas || []).find(a => a.floor === 2 && /sân thượng/i.test(a.name || '')); items.push({ name: 'Sân thượng', icon: 'map', f, x: t ? (t.x0 + t.x1) / 2 : 1.0, z: t ? (t.z0 + t.z1) / 2 : 3.5, r: 3 }); }
      if (items.length) groups.push({ title: ((__REAL_SYS__ && this.app?.model?.layout?.world === 'sysone-real') ? this.app.model.floorById.get(+f)?.name : FLOOR_NAMES[f]) || `Tầng ${f + 1}`, items });
    }
    return groups;
  }
  render() {
    const groups = this.places(); this.flat = groups.flatMap(g => g.items);
    const mine = this.s.mySeat;
    let k = 0;
    this.host.innerHTML = `<div class="qt">
      ${mine ? `<button type="button" class="qt-desk" data-desk>${icon('target', 15)}<span>Bàn làm việc của tôi<small>${esc(mine.deskId)} · ngồi vào luôn</small></span></button>` : ''}
      ${groups.map(g => `<div class="qt-sec">${esc(g.title)}</div><div class="qt-list">${g.items.map(it => `<button type="button" class="qt-item" data-i="${k++}" title="Đi nhanh tới ${esc(it.name)}">${it.color ? `<i class="qt-dot" style="background:${it.color}"></i>` : icon(it.icon || 'map', 13)}<span>${esc(it.name)}</span></button>`).join('')}</div>`).join('')}
    </div>`;
    this.host.querySelectorAll('[data-i]').forEach(b => b.onclick = () => this.go(this.flat[+b.dataset.i]));
    this.host.querySelector('[data-desk]')?.addEventListener('click', () => this.goDesk());
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
