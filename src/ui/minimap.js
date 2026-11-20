import { icon } from './icons.js';
// Bản đồ nhỏ góc dưới bên phải (cảnh 3D): mặt bằng tầng mình đang đứng (phòng, đồ đạc, tường, cầu thang, thang máy),
// mũi tên là mình (kèm hướng camera), chấm xanh là người online khác, chấm nhạt là nhân viên mô phỏng. Bấm lên bản đồ để
// tự đi tới chỗ đó. Thu gọn / mở bằng nút trên đầu (nhớ lựa chọn).

// bảng màu phòng (design_handoff_office_hud): nền / viền
const ROOM = { office: ['#F4EBDD', '#CDBFA9'], lobby: ['#FBF0C9', '#DDBF4C'], lounge: ['#E4F2EC', '#94C9B0'], meeting: ['#E3E1F5', '#9C97D6'], pantry: ['#F7EEDB', '#D7BE8A'], wc: ['#DCEAF5', '#8DB5D6'], server: ['#ECE6DC', '#BFB3A0'], library: ['#DDEFE2', '#8CC5A0'] };
const NAMES = ['Tầng trệt', 'Tầng 2', 'Tầng 3'];
let B = { x0: -13.6, x1: 13.6, z0: -14.2, z1: 10.2 };   // vùng vẽ (toà nhà, khối thang, sân trước tới cổng)
let W = 318, S = W / (B.x1 - B.x0), H = Math.round((B.z1 - B.z0) * S);
/** Real SYS: nhà hẹp và sâu — khung vẽ hẹp hơn để nhà không bé tí. */
function setBounds(b) { B = b; W = 318; S = W / (B.x1 - B.x0); H = Math.round((B.z1 - B.z0) * S); }

export class Minimap {
  constructor(root, app) {
    this.app = app; this.f = null; this.cache = new Map(); this.t = 0;
    this.real = (__REAL_SYS__ && app.model.layout.world === 'sysone-real');
    if (this.real) setBounds({ x0: -10, x1: 10, z0: -12.4, z1: 9.8 });
    const el = this.el = document.createElement('div'); el.className = 'minimap'; el.id = 'minimap';
    const nf = app.model.floors.length, fname = f => (this.real ? app.model.floorById.get(f)?.name : NAMES[f]) || `Tầng ${f + 1}`;
    el.innerHTML = `<div class="mm-head"><b class="mm-title">Bản đồ</b><span class="mm-floor sr-only" aria-live="polite">Bản đồ</span>
      <div class="mm-seg" role="group" aria-label="Xem tầng">${Array.from({ length: nf }, (_, f) => `<button type="button" data-mf="${f}">${fname(f)}</button>`).join('')}</div>
      <button type="button" class="mm-tog" title="Thu gọn / mở bản đồ nhỏ (M)" aria-label="Thu gọn / mở bản đồ nhỏ"></button></div>
      <div class="mm-body"><canvas width="${W * 2}" height="${H * 2}" style="width:${W}px;height:${H}px" aria-label="Bản đồ nhỏ: bấm để đi tới"></canvas>
      <div class="mm-leg"><span><i class="you"></i>Bạn</span><span><i class="col"></i>Đồng nghiệp</span><span><i class="mine"></i>Chỗ của tôi</span><em>Nhấn để đi tới</em></div></div>`;
    // chọn tầng để xem (tự về tầng mình đang đứng khi mình đổi tầng)
    el.querySelectorAll('[data-mf]').forEach(b => b.onclick = () => { this.pick = +b.dataset.mf; this.t = 1; });
    root.appendChild(el);
    this.cv = el.querySelector('canvas'); this.ctx = this.cv.getContext('2d'); this.ctx.scale(2, 2);
    this.label = el.querySelector('.mm-floor');
    const tog = el.querySelector('.mm-tog');
    const setCollapsed = c => { el.classList.toggle('collapsed', c); tog.innerHTML = icon(c ? 'map' : 'minus', c ? 17 : 14);   /* (thu gọn: biểu tượng bản đồ — bấm để mở) */ tog.title = c ? 'Mở bản đồ nhỏ' : 'Thu gọn bản đồ nhỏ'; tog.setAttribute('aria-expanded', String(!c)); try { localStorage.setItem('sysone.minimap', c ? '0' : '1'); } catch { /* */ } };
    { const v = localStorage.getItem('sysone.minimap'); setCollapsed(v === '0' || (v === null && matchMedia('(max-width: 760px), (max-height: 500px) and (max-width: 1100px)').matches)); } // (điện thoại: mặc định thu gọn)
    tog.onclick = () => setCollapsed(!el.classList.contains('collapsed'));
    // bấm lên bản đồ: tự đi tới (trên tầng đang xem)
    this.cv.addEventListener('click', e => {
      const pl = this.app.session?.player; if (!pl || this.f === null) return;
      const r = this.cv.getBoundingClientRect(), x = B.x0 + (e.clientX - r.left) / S, z = B.z0 + (e.clientY - r.top) / S;
      if (!pl.walkTo(x, z, this.f)) this.app.session.toast('Không đi tới chỗ đó được.', true);
    });
  }
  sx(x) { return (x - B.x0) * S; }
  sy(z) { return (z - B.z0) * S; }
  /** Mặt bằng tĩnh của tầng f (vẽ một lần). */
  base(f) {
    let cv = this.cache.get(f); if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = W * 2; cv.height = H * 2;
    const g = cv.getContext('2d'); g.scale(2, 2);
    const m = this.app.model, L = m.layout, R = (x0, z0, x1, z1, c) => { g.fillStyle = c; g.fillRect(this.sx(x0), this.sy(z0), (x1 - x0) * S, (z1 - z0) * S); };
    g.fillStyle = '#EFE8DC'; g.fillRect(0, 0, W, H);
    if (f === 0) { R(B.x0, 9.3, B.x1, B.z1, '#E2D6C4'); }                                         // vỉa hè
    for (const a of L.nav.areas) if (a.floor === f) R(a.x0, a.z0, a.x1, a.z1, a.name === 'sân trước' ? '#E8DECF' : a.name?.startsWith('chiếu') || a.name?.startsWith('chân') ? '#DCCFBD' : '#FBF7F0');
    // phòng: nền + viền 1.5px bo góc (bảng màu thiết kế)
    const kind = r => r.type && ROOM[r.type] ? r.type : /máy chủ/i.test(r.name || '') ? 'server' : /thư viện/i.test(r.name || '') ? 'library' : 'office';
    for (const r of L.rooms || []) if (r.floor === f) {
      const [fill, line] = ROOM[kind(r)], x = this.sx(r.x0) + 1, y = this.sy(r.z0) + 1, w = (r.x1 - r.x0) * S - 2, h = (r.z1 - r.z0) * S - 2;
      g.fillStyle = fill; g.strokeStyle = line; g.lineWidth = 1.5; g.beginPath(); g.roundRect?.(x, y, w, h, 4) ?? g.rect(x, y, w, h); g.fill(); g.stroke();
    }
    for (const b of L.nav.blocked) if (b.floor === f) R(b.x0, b.z0, b.x1, b.z1, 'rgba(150,135,115,.28)');  // đồ đạc
    for (const w of L.walls) if (w.floor === f) R(w.x0, w.z0, Math.max(w.x1, w.x0 + 0.12), Math.max(w.z1, w.z0 + 0.12), '#8F8476');
    // cầu thang
    for (const s of m.stairs) {
      if (s.from !== f && s.to !== f) continue;
      R(s.x0, s.z0, s.x1, s.z1, '#a38f75'); g.strokeStyle = 'rgba(43,45,66,.5)'; g.lineWidth = 0.6;
      for (let i = 1; i < 10; i++) { const z = s.z0 + (s.z1 - s.z0) * i / 10; g.beginPath(); g.moveTo(this.sx(s.x0), this.sy(z)); g.lineTo(this.sx(s.x1), this.sy(z)); g.stroke(); }
    }
    // thang máy (ô vàng "TM" ở chỗ cửa thang)
    const st = this.app.session?.lift?.stops?.[f];
    if (st) {
      const w = f === 0 ? 1.0 : 2 * (st.half || 1), d = f === 0 ? 2.2 : 0.5, cx = f === 0 ? st.door.x - 0.55 : st.door.x, cz = f === 0 ? st.door.z : st.door.z + 0.1;
      const x0 = cx - (f === 0 ? w / 2 : w / 2), z0 = cz - d / 2;
      R(x0, z0, x0 + w, z0 + d, '#F2C46B'); g.fillStyle = '#1F2533'; g.font = '700 9px "Be Vietnam Pro", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('TM', this.sx(cx), this.sy(f === 0 ? cz : cz - 0.9));
    }
    // khu của từng phòng ban: viền màu phòng + tên ngắn
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const z of L.deptZones || []) if (z.floor === f) {
      g.fillStyle = z.color + '33'; g.fillRect(this.sx(z.x0), this.sy(z.z0), (z.x1 - z.x0) * S, (z.z1 - z.z0) * S);
      g.strokeStyle = z.color; g.lineWidth = 1.2; g.strokeRect(this.sx(z.x0), this.sy(z.z0), (z.x1 - z.x0) * S, (z.z1 - z.z0) * S);
      const n = z.name.replace(/^(Phòng|Team) /, ''); g.font = '600 8.5px "Be Vietnam Pro", system-ui, sans-serif'; g.fillStyle = '#1F2533';
      g.fillText(n.length > 16 ? n.slice(0, 15) + '…' : n, this.sx((z.x0 + z.x1) / 2), this.sy(z.z1) - 4);
    }
    // tên phòng (phòng không có khu phòng ban)
    g.fillStyle = '#1F2533'; g.font = '600 9px "Be Vietnam Pro", system-ui, sans-serif';
    const hasZone = r => (L.deptZones || []).some(z => z.floor === r.floor && z.x0 >= r.x0 - 0.5 && z.x1 <= r.x1 + 0.5 && z.z0 >= r.z0 - 0.5 && z.z1 <= r.z1 + 0.5);
    for (const r of L.rooms || []) if (r.floor === f && (r.x1 - r.x0) * S > 34 && !hasZone(r)) g.fillText(r.name.length > 18 ? r.name.slice(0, 17) + '…' : r.name, this.sx((r.x0 + r.x1) / 2), this.sy((r.z0 + r.z1) / 2));
    this.cache.set(f, cv); return cv;
  }
  update(dt, sim, session) {
    if (this.el.classList.contains('collapsed')) return;
    this.t += dt; if (this.t < 1 / 15) return; this.t = 0;                                // ~15 lần/giây là đủ
    const me = session?.player?.agent, rig = this.app.rig;
    const own = me ? (me.onStair ? (this.app.model.stairById.get(me.onStair)?.to ?? me.f) : me.f) : (this.app.cutFloor() ?? 0);
    if (own !== this.ownF) { this.ownF = own; this.pick = null; }   // (mình đổi tầng: bản đồ theo về tầng của mình)
    const f = this.pick ?? own;
    if (f !== this.f) {
      this.f = f; this.label.textContent = (this.real ? this.app.model.floorById.get(f)?.name : NAMES[f]) || `Tầng ${f + 1}`;
      this.el.querySelectorAll('[data-mf]').forEach(b => { const on = +b.dataset.mf === f; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    }
    const g = this.ctx; g.clearRect(0, 0, W, H); g.drawImage(this.base(f), 0, 0, W, H);
    const clampX = x => Math.min(W - 4, Math.max(4, this.sx(x))), clampY = z => Math.min(H - 4, Math.max(4, this.sy(z)));
    // nhân viên mô phỏng (chấm nhạt), người online khác (chấm xanh)
    g.fillStyle = 'rgba(43,45,66,.45)';
    for (const a of sim?.agents || []) if (a.visible && a.f === f) { g.beginPath(); g.arc(clampX(a.x), clampY(a.z), 2.2, 0, Math.PI * 2); g.fill(); }
    // chỗ của tôi: ô vuông viền cam
    const mine = session?.mySeat && this.app.model.deskById.get(session.mySeat.deskId);
    if (mine && mine.floor === f) { const sx = mine.seat?.x ?? mine.x, sz = mine.seat?.z ?? mine.z; g.strokeStyle = '#F26B3A'; g.lineWidth = 1.8; g.strokeRect(clampX(sx) - 4.5, clampY(sz) - 4.5, 9, 9); }
    g.fillStyle = '#F26B3A'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    for (const a of session?.remote?.list || []) if (a !== me && a.visible !== false && a.f === f) { g.beginPath(); g.arc(clampX(a.x), clampY(a.z), 4, 0, Math.PI * 2); g.stroke(); g.fill(); }
    if (!me || me.f !== f && !me.onStair) return;
    const x = clampX(me.x), y = clampY(me.z);
    // hướng camera: hình quạt mờ
    if (rig.follow === me) {
      const th = rig.S.th, dx = -Math.sin(th), dz = -Math.cos(th), a0 = Math.atan2(dz, dx);
      g.fillStyle = 'rgba(43,182,115,.16)'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, 34, a0 - 0.5, a0 + 0.5); g.closePath(); g.fill();
    }
    // mình: chấm xanh 12px + quầng 34px
    g.fillStyle = 'rgba(43,182,115,.22)'; g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill();
    // mình: mũi tên cam theo hướng nhân vật
    const yaw = me.yaw || 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw), px = -fz, pz = fx;
    g.fillStyle = '#2BB673'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.stroke(); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x + fx * 4.5, y + fz * 4.5); g.lineTo(x - fx * 1.5 + px * 2.6, y - fz * 1.5 + pz * 2.6); g.lineTo(x - fx * 1.5 - px * 2.6, y - fz * 1.5 - pz * 2.6); g.closePath(); g.fill();   // (mũi nhỏ chỉ hướng đi)
  }
}
