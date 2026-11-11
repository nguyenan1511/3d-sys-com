// Công tắc đèn công ty: trên tường sảnh, cạnh máy chấm công. Đứng trước công tắc bấm E → bảng "Đèn công ty": bật đèn thì
// cả văn phòng chuyển sang buổi tối (trời tối, đèn các phòng sáng — main.js app.setLights), tắt là ban ngày. Giống góc âm
// nhạc: CEO luôn bật/tắt được và cấp/thu quyền cho từng nhân viên ngay trong bảng; người được cấp quyền bật/tắt được.
// Trạng thái chung cho cả công ty (server/lights.js), đồng bộ thời gian thực.
import * as THREE from 'three';
import { api } from '../net/api.js';
import { esc } from './ui.js';

export class LightSwitch {
  constructor(session, clock) {
    this.s = session; this.app = session.app; this.state = { on: false, by: '' }; this.can = false;
    // cạnh máy chấm công (cùng mặt tường, lệch sang một bên 1,1 m)
    const rot = clock.rot ?? Math.PI, sx = Math.cos(rot), sz = -Math.sin(rot), d = 1.1;
    this.spot = { x: clock.x + sx * d, z: clock.z + sz * d, rot, stand: { x: clock.stand.x + sx * d, z: clock.stand.z + sz * d } };
    this.build();
    const rt = session.rt;
    rt.on('hello', m => { this.can = !!m.canLights; if (m.lights) this.apply(m.lights, true); });
    rt.on('lights', m => { const prev = this.state.on; this.apply(m.state); if (prev !== m.state.on && m.state.by) this.s.toast(`${m.state.by} đã ${m.state.on ? 'bật' : 'tắt'} đèn công ty ${m.state.on ? '💡' : '☀️'}`); });
    rt.on('lightsPerm', m => { this.can = !!m.allow; this.refresh(); this.s.toast(m.allow ? 'CEO đã cấp cho bạn quyền bật/tắt đèn công ty 💡' : 'CEO đã tắt quyền bật/tắt đèn của bạn.'); });
  }
  get canControl() { return this.can || this.s.isAdmin; }

  // ---------- công tắc 3D ----------
  build() {
    const g = this.group = new THREE.Group(); g.name = 'lightSwitch';
    g.position.set(this.spot.x, this.app.model.floorY(0), this.spot.z); g.rotation.y = this.spot.rot;
    this.app.scene.add(g);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.02), new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.4 }));
    plate.position.set(0, 1.3, 0.01); g.add(plate);
    this.rocker = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.025), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 }));
    this.rocker.position.set(0, 1.3, 0.025); g.add(this.rocker);
    this.led = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), new THREE.MeshBasicMaterial({ color: '#3bd15a', toneMapped: false }));
    this.led.position.set(0, 1.39, 0.0215); g.add(this.led);
    const lc = document.createElement('canvas'); lc.width = 192; lc.height = 56; const c = lc.getContext('2d');
    c.fillStyle = '#2b2d42'; c.beginPath(); c.roundRect(0, 0, 192, 56, 12); c.fill(); c.fillStyle = '#ffd23f'; c.font = 'bold 26px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('💡 ĐÈN', 96, 30);
    const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.058), new THREE.MeshBasicMaterial({ map: lt, toneMapped: false })); lab.position.set(0, 1.47, 0.012); g.add(lab);
    this.show();
  }
  show() { this.rocker.rotation.x = this.state.on ? -0.28 : 0.28; this.led.material.color.set(this.state.on ? '#ffd23f' : '#3bd15a'); }
  near(x, z, f) { return f === 0 && Math.hypot(x - this.spot.stand.x, z - this.spot.stand.z) < 0.8; }
  prompt() { return `<b>E</b> công tắc đèn công ty (${this.state.on ? 'đang bật' : 'đang tắt'})`; }

  apply(st, instant = false) { this.state = { on: !!st.on, by: st.by || '' }; this.show(); this.app.setLights?.(this.state.on, instant); this.refresh(); }
  async toggle() {
    if (!this.canControl) { this.s.toast('Chỉ CEO và người được CEO cấp quyền mới bật/tắt đèn công ty.', true); return; }
    const r = await api('POST', '/api/v1/lights', { on: !this.state.on });
    if (!r.ok) this.s.toast(r.error || 'Chưa bật/tắt được đèn.', true);
  }

  // ---------- bảng "Đèn công ty" ----------
  async open() {
    if (this.pop?.isConnected) return;
    const isAdmin = this.s.isAdmin;
    const pop = this.pop = document.createElement('div'); pop.className = 'speaker-pop light-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Đèn công ty');
    pop.innerHTML = `<header><b>💡 Đèn công ty</b><button type="button" class="sp-x" aria-label="Đóng">✕</button></header>
      <p class="sp-hint">Bật đèn: cả văn phòng chuyển sang buổi tối, đèn các phòng sáng lên. Tắt đèn: trở lại ban ngày.</p>
      <button type="button" class="lp-toggle" role="switch" aria-checked="false"><span class="lp-knob"></span><b></b></button>
      <p class="sp-note lp-by"></p>
      <p class="sp-note lp-deny">Chỉ CEO và người được CEO cấp quyền mới bật/tắt đèn.</p>
      ${isAdmin ? '<div class="sp-perm"><div class="sp-sec">Cấp quyền bật/tắt đèn</div><ul class="sp-list"><li class="sp-load">Đang tải…</li></ul></div>' : ''}`;
    document.getElementById('appRoot').appendChild(pop);
    const close = () => { window.removeEventListener('keydown', escK, true); pop.classList.add('closing'); setTimeout(() => pop.remove(), 180); this.pop = null; };
    const escK = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', escK, true);
    pop.querySelector('.sp-x').onclick = close;
    pop.querySelector('.lp-toggle').onclick = () => this.toggle();
    this.refresh();
    pop.querySelector('.lp-toggle').focus();
    if (isAdmin) {
      const [emps, perm] = await Promise.all([api('GET', '/api/v1/admin/employees'), api('GET', '/api/v1/admin/lights')]);
      const ul = pop.querySelector('.sp-list'); if (!ul) return;
      const allowed = new Set(perm.ok ? perm.allowed : []);
      const list = (emps.ok ? emps.employees : []).filter(e => e.status === 'active');
      ul.innerHTML = list.length ? list.map(e => `<li><label><input type="checkbox" data-code="${esc(e.code)}" ${allowed.has(e.code) ? 'checked' : ''}> ${esc(e.display)}${e.department ? `<small>${esc(e.department)}</small>` : ''}</label></li>`).join('') : '<li class="sp-load">Chưa có nhân viên nào.</li>';
      ul.querySelectorAll('input[data-code]').forEach(c => c.onchange = async () => {
        const r = await api('POST', `/api/v1/admin/lights/${encodeURIComponent(c.dataset.code)}`, { allow: c.checked });
        if (!r.ok) { c.checked = !c.checked; this.s.toast(r.error || 'Không cập nhật được quyền.', true); }
      });
    }
  }
  /** Cập nhật phần động của bảng (không dựng lại cả bảng). */
  refresh() {
    const pop = this.pop; if (!pop?.isConnected) return;
    const on = this.state.on, can = this.canControl, t = pop.querySelector('.lp-toggle');
    t.classList.toggle('on', on); t.setAttribute('aria-checked', String(on)); t.disabled = !can;
    t.querySelector('b').textContent = on ? 'Đèn đang BẬT · buổi tối' : 'Đèn đang TẮT · ban ngày';
    pop.querySelector('.lp-by').textContent = this.state.by ? `${on ? 'Bật' : 'Tắt'} bởi ${this.state.by}` : '';
    pop.querySelector('.lp-deny').hidden = can;
  }
}
