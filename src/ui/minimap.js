import { icon } from './icons.js';
// Bản đồ nhỏ góc dưới bên phải (cảnh 3D): mặt bằng tầng mình đang đứng (phòng, đồ đạc, tường, cầu thang, thang máy),
// mũi tên là mình (kèm hướng camera), chấm xanh là người online khác, chấm nhạt là nhân viên mô phỏng. Bấm lên bản đồ để
// tự đi tới chỗ đó. Thu gọn / mở bằng nút trên đầu (nhớ lựa chọn).

const ROOM = { office: '#e9dfd2', lobby: '#eadfce', lounge: '#d7e4d3', meeting: '#dcdcf0', pantry: '#efe6d6', wc: '#d6e5ec' };
const NAMES = ['Tầng trệt', 'Tầng 2', 'Tầng 3'];
const B = { x0: -13.6, x1: 13.6, z0: -14.2, z1: 10.2 };   // vùng vẽ (toà nhà, khối thang, sân trước tới cổng)
const W = 300, S = W / (B.x1 - B.x0), H = Math.round((B.z1 - B.z0) * S);

export class Minimap {
  constructor(root, app) {
    this.app = app; this.f = null; this.cache = new Map(); this.t = 0;
    const el = this.el = document.createElement('div'); el.className = 'minimap'; el.id = 'minimap';
    el.innerHTML = `<div class="mm-head"><span class="mm-floor">Bản đồ</span><button type="button" class="mm-tog" title="Thu gọn / mở bản đồ nhỏ" aria-label="Thu gọn / mở bản đồ nhỏ"></button></div><canvas width="${W * 2}" height="${H * 2}" style="width:${W}px;height:${H}px" aria-label="Bản đồ nhỏ: bấm để đi tới"></canvas>`;
    root.appendChild(el);
    this.cv = el.querySelector('canvas'); this.ctx = this.cv.getContext('2d'); this.ctx.scale(2, 2);
    this.label = el.querySelector('.mm-floor');
    const tog = el.querySelector('.mm-tog');
    const setCollapsed = c => { el.classList.toggle('collapsed', c); tog.innerHTML = icon(c ? 'plus' : 'minus', 14); tog.title = c ? 'Mở bản đồ nhỏ' : 'Thu gọn bản đồ nhỏ'; tog.setAttribute('aria-expanded', String(!c)); try { localStorage.setItem('sysone.minimap', c ? '0' : '1'); } catch { /* */ } };
    { const v = localStorage.getItem('sysone.minimap'); setCollapsed(v === '0' || (v === null && matchMedia('(max-width: 760px)').matches)); } // (điện thoại: mặc định thu gọn)
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
    g.fillStyle = f === 0 ? '#cfd8c4' : '#5a5e6e'; g.fillRect(0, 0, W, H);
    if (f === 0) { R(B.x0, 9.3, B.x1, B.z1, '#9aa0a8'); }                                         // vỉa hè
    for (const a of L.nav.areas) if (a.floor === f) R(a.x0, a.z0, a.x1, a.z1, a.name === 'sân trước' ? '#d9cfc0' : a.name?.startsWith('chiếu') || a.name?.startsWith('chân') ? '#c4b8a6' : '#f3ece2');
    for (const r of L.rooms || []) if (r.floor === f) R(r.x0, r.z0, r.x1, r.z1, ROOM[r.type] || ROOM.office);
    for (const b of L.nav.blocked) if (b.floor === f) R(b.x0, b.z0, b.x1, b.z1, 'rgba(120,108,96,.55)');  // đồ đạc
    for (const w of L.walls) if (w.floor === f) R(w.x0, w.z0, Math.max(w.x1, w.x0 + 0.12), Math.max(w.z1, w.z0 + 0.12), '#2b2d42');
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
      R(x0, z0, x0 + w, z0 + d, '#ffb23f'); g.fillStyle = '#2b2d42'; g.font = '800 10px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('TM', this.sx(cx), this.sy(f === 0 ? cz : cz - 0.9));
    }
    // khu của từng phòng ban: viền màu phòng + tên ngắn
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const z of L.deptZones || []) if (z.floor === f) {
      g.fillStyle = z.color + '33'; g.fillRect(this.sx(z.x0), this.sy(z.z0), (z.x1 - z.x0) * S, (z.z1 - z.z0) * S);
      g.strokeStyle = z.color; g.lineWidth = 1.2; g.strokeRect(this.sx(z.x0), this.sy(z.z0), (z.x1 - z.x0) * S, (z.z1 - z.z0) * S);
      const n = z.name.replace(/^(Phòng|Team) /, ''); g.font = '800 8.5px system-ui, sans-serif'; g.fillStyle = z.color;
      g.fillText(n.length > 16 ? n.slice(0, 15) + '…' : n, this.sx((z.x0 + z.x1) / 2), this.sy(z.z1) - 4);
    }
    // tên phòng (phòng không có khu phòng ban)
    g.fillStyle = 'rgba(43,45,66,.62)'; g.font = '700 9px system-ui, sans-serif';
    const hasZone = r => (L.deptZones || []).some(z => z.floor === r.floor && z.x0 >= r.x0 - 0.5 && z.x1 <= r.x1 + 0.5 && z.z0 >= r.z0 - 0.5 && z.z1 <= r.z1 + 0.5);
    for (const r of L.rooms || []) if (r.floor === f && (r.x1 - r.x0) * S > 34 && !hasZone(r)) g.fillText(r.name.length > 18 ? r.name.slice(0, 17) + '…' : r.name, this.sx((r.x0 + r.x1) / 2), this.sy((r.z0 + r.z1) / 2));
    this.cache.set(f, cv); return cv;
  }
  update(dt, sim, session) {
    if (this.el.classList.contains('collapsed')) return;
    this.t += dt; if (this.t < 1 / 15) return; this.t = 0;                                // ~15 lần/giây là đủ
    const me = session?.player?.agent, rig = this.app.rig;
    const f = me ? (me.onStair ? (this.app.model.stairById.get(me.onStair)?.to ?? me.f) : me.f) : (this.app.cutFloor() ?? 0);
    if (f !== this.f) { this.f = f; this.label.textContent = NAMES[f] || `Tầng ${f + 1}`; }
    const g = this.ctx; g.clearRect(0, 0, W, H); g.drawImage(this.base(f), 0, 0, W, H);
    const clampX = x => Math.min(W - 4, Math.max(4, this.sx(x))), clampY = z => Math.min(H - 4, Math.max(4, this.sy(z)));
    // nhân viên mô phỏng (chấm nhạt), người online khác (chấm xanh)
    g.fillStyle = 'rgba(43,45,66,.45)';
    for (const a of sim?.agents || []) if (a.visible && a.f === f) { g.beginPath(); g.arc(clampX(a.x), clampY(a.z), 2.2, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#06d6a0'; g.strokeStyle = '#fff'; g.lineWidth = 1;
    for (const a of session?.remote?.list || []) if (a !== me && a.visible !== false && a.f === f) { g.beginPath(); g.arc(clampX(a.x), clampY(a.z), 4, 0, Math.PI * 2); g.fill(); g.stroke(); }
    if (!me) return;
    const x = clampX(me.x), y = clampY(me.z);
    // hướng camera: hình quạt mờ
    if (rig.follow === me) {
      const th = rig.S.th, dx = -Math.sin(th), dz = -Math.cos(th), a0 = Math.atan2(dz, dx);
      g.fillStyle = 'rgba(255,138,91,.22)'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, 40, a0 - 0.5, a0 + 0.5); g.closePath(); g.fill();
    }
    // mình: mũi tên cam theo hướng nhân vật
    const yaw = me.yaw || 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw), px = -fz, pz = fx;
    g.fillStyle = '#ff8a5b'; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath();
    g.moveTo(x + fx * 9, y + fz * 9); g.lineTo(x - fx * 5 + px * 6, y - fz * 5 + pz * 6); g.lineTo(x - fx * 2, y - fz * 2); g.lineTo(x - fx * 5 - px * 6, y - fz * 5 - pz * 6); g.closePath();
    g.stroke(); g.fill();
  }
}
