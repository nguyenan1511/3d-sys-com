// Bảng thông tin làm việc trong ngày đặt trên mỗi bàn có chủ (màn hình nhỏ dựng đứng ở góc bàn, quay ra lối đi sau ghế):
// tên, phòng ban (vạch màu), trạng thái hôm nay (đang làm việc / chưa chấm công / đã về / đang họp…), giờ vào, số giờ đã làm.
// Người dùng thật: theo chấm công (session.att); nhân viên mô phỏng: theo lịch mô phỏng (giờ mô phỏng).
import * as THREE from 'three';
import { deg2yaw, fmtTime } from '../core/util.js';
import { findDepartment, departmentOfDesk } from '../shared/departments.js';
import { ST_LABEL } from '../sim/sim.js';
import { fmtDur } from '../session/attendance.js';

const W = 320, H = 196;
const hm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function drawCard(c, info) {
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#16191f'; c.beginPath(); c.roundRect(0, 0, W, H, 18); c.fill();
  c.fillStyle = info.color; c.fillRect(0, 0, W, 10);
  c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  c.fillStyle = '#ffffff'; c.font = 'bold 30px system-ui, sans-serif';
  let name = info.name; while (c.measureText(name).width > W - 32 && name.length > 4) name = name.slice(0, -2) + '…'; c.fillText(name, 16, 50);
  c.fillStyle = info.color; c.beginPath(); c.arc(22, 74, 6, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(255,255,255,.72)'; c.font = '600 19px system-ui, sans-serif';
  let dept = info.dept || 'Chưa có phòng ban'; while (c.measureText(dept).width > W - 52 && dept.length > 4) dept = dept.slice(0, -2) + '…'; c.fillText(dept, 34, 81);
  // trạng thái
  const st = info.status, pill = st.tone === 'ok' ? '#3ddc84' : st.tone === 'warn' ? '#f2b33d' : st.tone === 'off' ? '#8b93a1' : '#6aaeff';
  c.font = 'bold 19px system-ui, sans-serif'; const tw = c.measureText(st.text).width + 30;
  c.fillStyle = pill + '33'; c.beginPath(); c.roundRect(14, 98, Math.min(tw, W - 28), 32, 16); c.fill();
  c.fillStyle = pill; c.beginPath(); c.arc(30, 114, 5, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#eef1f7'; c.fillText(st.text, 42, 121);
  // giờ vào · đã làm
  c.fillStyle = 'rgba(255,255,255,.62)'; c.font = '600 17px system-ui, sans-serif';
  c.fillText(`Vào: ${info.inAt || '—'}`, 16, 160); c.fillText(`Đã làm: ${info.worked || '—'}`, 140, 160);
  c.fillStyle = info.late ? '#f2b33d' : 'rgba(255,255,255,.4)'; c.font = '700 14px system-ui, sans-serif'; c.fillText(info.foot || 'Hôm nay', 16, 184);
}

export class DeskInfoBoards {
  constructor(scene, model) {
    this.model = model; this.group = new THREE.Group(); this.group.name = 'deskInfo'; scene.add(this.group);
    // mỗi tầng một nhóm con (userData.floor): main.js ẩn cả nhóm khi tầng đó bị sàn che hết (camera ở tầng khác, trong nhà)
    this.floors = new Map(model.floors.map(f => { const g = new THREE.Group(); g.name = `deskInfo-floor-${f.id}`; g.userData.floor = f.id; this.group.add(g); return [f.id, g]; }));
    this.items = new Map(); this.t = 0; this.simArrive = new Map();
    this.standM = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.4, metalness: 0.4 });
  }
  item(d) {
    let it = this.items.get(d.id); if (it) return it;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const g = new THREE.Group(), fs = this.model.fs || 1, ry = deg2yaw(d.facing || 0), w = (d.w || 1.5) * fs, dd = (d.d || 0.74) * fs;
    // góc bàn phía ghế, bên phải người ngồi; mặt bảng quay ra sau lưng người ngồi (lối đi), hơi ngửa
    g.position.set(d.x, this.model.floorY(d.floor) + 0.765 * fs, d.z); g.rotation.y = ry; (this.floors.get(d.floor) || this.group).add(g);
    const inner = new THREE.Group(); inner.position.set(w / 2 - 0.2, 0, dd / 2 - 0.1); inner.rotation.y = Math.PI; g.add(inner);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 0.09), this.standM); foot.position.set(0, 0.006, 0); inner.add(foot);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), this.standM); post.position.set(0, 0.06, 0.02); inner.add(post);
    const pw = 0.4, ph = pw * H / W;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    panel.position.set(0, 0.1 + ph / 2, 0.02); panel.rotation.x = -0.18; panel.rotation.y = Math.PI; inner.add(panel); // (mặt có chữ hướng ra sau ghế)
    const back = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), this.standM); back.position.copy(panel.position); back.rotation.x = -0.18; back.position.z += 0.004; inner.add(back);
    it = { g, cv, tex, sig: '' }; this.items.set(d.id, it);
    return it;
  }
  /** Mỗi ~2 giây: vẽ lại bảng của các bàn có chủ. */
  update(dt, { session, sim }) {
    this.t -= dt; if (this.t > 0) return; this.t = 2;
    const att = session.att, used = new Set(), now = Date.now();
    const simByDesk = new Map(); for (const a of sim.agents) if (a.emp?.deskId) simByDesk.set(a.emp.deskId, a);
    for (const d of this.model.desks) {
      if (d.kind === 'reception') continue;
      const seat = session.seats.get(d.id), owner = seat?.owner, a = !owner && simByDesk.get(d.id);
      if (!owner && !a) continue;
      let info;
      if (owner) {
        const rec = att?.byCode.get(owner.code), dep = findDepartment(owner.department) || departmentOfDesk(d.id);
        const seated = session.seatedAt(d.id);
        info = { name: owner.display, dept: dep?.name, color: dep?.color || '#8b93a1',
          status: !rec ? { text: 'Chưa chấm công', tone: 'off' } : rec.checkOut ? { text: `Đã về ${hm(rec.checkOut)}`, tone: 'off' } : seated ? { text: 'Đang làm việc', tone: 'ok' } : { text: 'Đã đến · đang đi lại', tone: 'info' },
          inAt: rec ? hm(rec.checkIn) : '', worked: rec ? fmtDur((rec.checkOut || now) - rec.checkIn) : '', foot: rec?.lateMin ? `Đi muộn ${rec.lateMin} phút` : rec ? 'Đúng giờ · theo chấm công' : 'Hôm nay · theo chấm công', late: !!rec?.lateMin };
      } else {
        const dep = findDepartment(a.emp.department) || departmentOfDesk(d.id), here = a.visible && a.state !== 'gone' && a.state !== 'outside';
        if (here && !this.simArrive.has(a.id)) this.simArrive.set(a.id, sim.t);
        if (!here && a.state === 'outside') this.simArrive.delete(a.id);
        const arr = this.simArrive.get(a.id);
        info = { name: a.emp.name, dept: dep?.name, color: dep?.color || '#8b93a1',
          status: a.state === 'working' ? { text: 'Đang làm việc', tone: 'ok' } : a.state === 'gone' ? { text: 'Đã về', tone: 'off' } : !here ? { text: 'Chưa đến', tone: 'off' } : { text: ST_LABEL[a.state] || 'Đi lại', tone: a.state === 'meeting' ? 'info' : 'warn' },
          inAt: arr != null ? fmtTime(arr) : '', worked: arr != null ? fmtDur((sim.t - arr) * 1000) : '', foot: 'Hôm nay · nhân viên mô phỏng' };
      }
      const it = this.item(d); used.add(d.id); it.g.visible = true;
      const sig = JSON.stringify(info); if (sig !== it.sig) { it.sig = sig; drawCard(it.cv.getContext('2d'), info); it.tex.needsUpdate = true; }
    }
    for (const [id, it] of this.items) if (!used.has(id)) it.g.visible = false;
  }
}
