// Chấm công (phía trình duyệt): máy chấm công gắn tường cạnh cửa chính (sảnh tầng trệt). Vào tới sảnh mà chưa chấm công
// hôm nay thì có gợi ý; đứng trước máy bấm E → thẻ chấm công (giờ hiện tại, "Chấm công vào ca" / "Chấm công ra về").
// Bản ghi trong ngày của mọi người (server/attendance.js) dùng cho bảng thông tin trên bàn làm việc; CEO xem bảng chấm công
// trong ngày bằng nút "Chấm công".
import * as THREE from 'three';
import { api } from '../net/api.js';
import { esc } from './ui.js';
import { icon } from '../ui/icons.js';
import { openMyTimesheet, openAdminTimesheet } from '../ui/timesheet.js';

const hm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const fmtDur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${String(m % 60).padStart(2, '0')}`; };
export const statusText = r => !r ? 'Chưa chấm công' : r.checkOut ? `Đã về lúc ${hm(r.checkOut)}` : `Đang làm việc · vào ${hm(r.checkIn)}`;

export class Attendance {
  constructor(session) {
    this.s = session; this.app = session.app; this.byCode = new Map(); this.version = 0; this.mine = null;
    this.code = session.me.employee?.code || null;
    const wp = this.app.model.waypoints;
    // máy chấm công: tường trước, bên trái cửa chính (nhìn từ trong nhà)
    this.spot = { x: (wp.door0?.x ?? 5.55) - 1.45, z: 4.5, stand: { x: (wp.door0?.x ?? 5.55) - 1.45, z: 3.95 }, f: 0 };
    this.build();
    session.rt.on('hello', () => this.refresh());
    session.rt.on('attendance', m => { if (!m.rec) return; this.byCode.set(m.rec.code, m.rec); if (m.rec.code === this.code) this.mine = m.rec; this.version++; });
  }
  async refresh() {
    const r = await api('GET', '/api/attendance/today'); if (!r.ok) return;
    this.byCode = new Map(r.list.map(x => [x.code, x])); this.mine = this.code ? this.byCode.get(this.code) || null : null; this.version++;
  }
  get checkedIn() { return !!this.mine; }

  // ---------- máy chấm công (3D) ----------
  build() {
    const g = this.group = new THREE.Group(); g.name = 'timeClock'; g.position.set(this.spot.x, this.app.model.floorY(0), this.spot.z); g.rotation.y = Math.PI; // mặt máy nhìn vào trong nhà (-z)
    this.app.scene.add(g);
    const body = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.5 }), trim = new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.6, roughness: 0.35 });
    const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
    box(0.34, 0.46, 0.08, body, 0, 1.38, 0.04);
    box(0.36, 0.02, 0.09, trim, 0, 1.62, 0.045);
    const cv = this.cv = document.createElement('canvas'); cv.width = 192; cv.height = 128;
    this.tex = new THREE.CanvasTexture(cv); this.tex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.18), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false })); scr.position.set(0, 1.46, 0.081); g.add(scr);
    this.pad = new THREE.Mesh(new THREE.CircleGeometry(0.045, 24), new THREE.MeshBasicMaterial({ color: '#3bd15a' })); this.pad.position.set(0, 1.25, 0.081); g.add(this.pad); // ô quẹt thẻ
    // biển nhỏ phía trên
    const lc = document.createElement('canvas'); lc.width = 256; lc.height = 56; const c = lc.getContext('2d');
    c.fillStyle = '#ff8a5b'; c.beginPath(); c.roundRect(0, 0, 256, 56, 12); c.fill(); c.fillStyle = '#fff'; c.font = 'bold 28px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('MÁY CHẤM CÔNG', 128, 30);
    const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.0875), new THREE.MeshBasicMaterial({ map: lt, toneMapped: false })); lab.position.set(0, 1.72, 0.06); g.add(lab);
    this.t = 0; this.draw();
  }
  draw() {
    const c = this.cv.getContext('2d'), now = new Date();
    c.fillStyle = '#0d1f17'; c.fillRect(0, 0, 192, 128);
    c.fillStyle = '#7CE38B'; c.font = 'bold 46px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, 96, 50);
    c.font = 'bold 16px system-ui, sans-serif'; c.fillStyle = '#a8f0b4';
    c.fillText(this.flash ? this.flash : 'Quẹt thẻ để chấm công', 96, 100);
    this.tex.needsUpdate = true;
  }
  update(dt) {
    this.t += dt; if (this.t > 1) { this.t = 0; if (this.flashUntil && performance.now() > this.flashUntil) this.flash = null; this.draw(); }
    this.pad.material.color.set(this.checkedIn ? '#3bd15a' : (Math.sin(performance.now() / 250) > 0 ? '#ffb23f' : '#5a4a1e'));
  }
  /** Đứng trước máy (cùng tầng, < 1,3 m). */
  near(x, z, f) { return f === 0 && Math.hypot(x - this.spot.stand.x, z - this.spot.stand.z) < 1.3; }
  prompt() { return !this.code ? '' : !this.mine ? '<b>E</b> chấm công vào ca' : !this.mine.checkOut ? '<b>E</b> chấm công ra về' : '<b>E</b> xem chấm công hôm nay'; }

  // ---------- thẻ chấm công ----------
  async open() {
    if (!this.code || this.card) return;
    const card = this.card = document.createElement('div'); card.className = 'att-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Chấm công');
    const render = () => {
      const r = this.mine, now = Date.now();
      card.innerHTML = `<header><b>${icon('clipboard', 16)} Chấm công</b><button type="button" class="att-x" aria-label="Đóng">✕</button></header>
        <div class="att-clock">${hm(now)}<small>${new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</small></div>
        <div class="att-rows">
          <div><span>Giờ vào</span><b>${r ? hm(r.checkIn) : '—'}</b>${r ? `<em class="${r.lateMin ? 'late' : 'ok'}">${r.lateMin ? `Muộn ${r.lateMin} phút` : 'Đúng giờ'}</em>` : ''}</div>
          <div><span>Giờ ra</span><b>${r?.checkOut ? hm(r.checkOut) : '—'}</b></div>
          <div><span>Đã làm hôm nay</span><b>${r ? fmtDur((r.checkOut || now) - r.checkIn) : '—'}</b></div>
        </div>
        <p class="att-shift">Giờ vào ca: ${esc(r?.shift || '08:00')} · <button type="button" class="att-month">${icon('clipboard', 13)} Bảng công tháng / năm</button></p>
        ${!r ? '<button type="button" class="att-go" data-act="in">Chấm công vào ca</button>' : !r.checkOut ? '<button type="button" class="att-go ghost" data-act="out">Chấm công ra về</button>' : '<p class="att-done">Bạn đã chấm công ra về hôm nay. Hẹn gặp lại ngày mai!</p>'}`;
      card.querySelector('.att-x').onclick = () => this.close();
      card.querySelector('.att-month').onclick = () => { this.close(); openMyTimesheet(); };
      card.querySelector('[data-act="in"]')?.addEventListener('click', () => this.checkIn().then(render));
      card.querySelector('[data-act="out"]')?.addEventListener('click', () => this.checkOut().then(render));
    };
    render();
    document.getElementById('appRoot').appendChild(card);
    card.querySelector('.att-go')?.focus();
    this._key = e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };
    window.addEventListener('keydown', this._key, true);
  }
  close() { this.card?.remove(); this.card = null; if (this._key) window.removeEventListener('keydown', this._key, true); this._key = null; }
  async checkIn() {
    const r = await api('POST', '/api/attendance/checkin', {}); if (!r.ok) { this.s.toast(r.error || 'Chưa chấm công được.', true); return null; }
    this.mine = r.record; this.byCode.set(this.code, r.record); this.version++;
    this.flash = `Xin chào ${this.s.me.employee.name}!`; this.flashUntil = performance.now() + 4000; this.draw();
    if (!r.already) this.s.toast(`Đã chấm công vào ca lúc ${hm(r.record.checkIn)}${r.record.lateMin ? ` (muộn ${r.record.lateMin} phút)` : ' — đúng giờ'}.`);
    this.hintShown = true; this.s.app.setPrompt?.('');
    return r.record;
  }
  async checkOut() {
    const r = await api('POST', '/api/attendance/checkout', {}); if (!r.ok) { this.s.toast(r.error, true); return null; }
    this.mine = r.record; this.byCode.set(this.code, r.record); this.version++;
    this.flash = 'Tạm biệt, về an toàn nhé!'; this.flashUntil = performance.now() + 4000; this.draw();
    this.s.toast(`Đã chấm công ra về lúc ${hm(r.record.checkOut)} · làm ${fmtDur(r.record.checkOut - r.record.checkIn)}.`);
    return r.record;
  }
  /** (mỗi khung hình) vào tới trong nhà mà chưa chấm công → nhắc một lần. */
  tick(a) {
    if (!this.code || this.mine || this.hintShown || !a) return;
    if (document.querySelector('#modalRoot .modal')) return; // (đang mở hộp thoại, vd. chọn nhân vật: nhắc sau khi đóng, không đè lên)
    if (a.f === 0 && a.z < (this.app.model.waypoints.door0?.z ?? 4.6) - 0.4 && a.z > -13) { this.hintShown = true; this.s.toast('Bạn chưa chấm công hôm nay — ghé máy chấm công cạnh cửa chính (sảnh) và bấm E nhé.'); }
  }

  // ---------- bảng công (tháng / năm) ----------
  openAdmin() { openAdminTimesheet(); }
  openMine() { openMyTimesheet(); }
}
