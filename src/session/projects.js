// Workspace dự án — phía client (docs/design/projects-workspace.md).
//  • Nút "Dự án" trên thanh (cạnh Bảng tin / Họp / Chat) và bảng "Dự án" đứng cạnh cửa phòng họp (bấm E) → src/ui/projectPanel.js.
//  • Server báo (server/projectHub.js): được mời / bị xoá, công việc đổi, được giao việc, việc sắp tới hạn / quá hạn, bị @nhắc,
//    đồng đội vào phòng dự án → thông báo nhỏ (bấm để mở đúng chỗ); bảng đang mở tự cập nhật.
//  • Tin chưa đọc của từng dự án: so mã tin cuối (server gửi lastMsg) với mã tin đã đọc (localStorage) → chấm đỏ trên nút.
//  • Phòng dự án: meet:join {id: "p<id>"} — dùng chung phòng 3D / bảng vẽ / họp trực tuyến của phòng họp (src/session/meetings.js).
import * as THREE from 'three';
import { api } from '../net/api.js';
import { notice } from '../ui/notices.js';
import { sound } from '../audio/notify.js';
import { ProjectPanel } from '../ui/projectPanel.js';

const READ = 'sysone.projRead';
const BW = 1.25, BH = 0.82, BOTTOM = 0.9, TW = 1000, TH = Math.round(TW * BH / BW);

export class Projects {
  constructor(session) {
    this.s = session; this.app = session.app; this.rt = session.rt;
    this.list = []; this.read = this.loadRead();
    this.panel = new ProjectPanel(this);
    const rt = this.rt;
    rt.on('hello', () => this.load());
    rt.on('proj:changed', m => { this.load(); this.panel.onChanged(m.id); });
    rt.on('proj:invited', m => {
      this.load(); sound.play('message');
      notice({ title: `${m.by} thêm bạn vào dự án`, text: m.project.name, icon: 'grid', tone: 'msg', ms: 9000, onClick: () => this.panel.open(m.project.id) });
    });
    rt.on('proj:removed', m => {
      this.load(); this.panel.onRemoved(m.id);
      if (this.s.meet?.inRoom === `p${m.id}`) this.s.meet.closeRoom(false);
      if (!m.quiet) notice({ title: m.purged ? 'Dự án đã bị xoá' : 'Bạn không còn trong dự án', text: m.name, icon: 'grid', tone: 'info', ms: 7000 });
    });
    rt.on('proj:task', m => { this.panel.onTask(m); this.loadSoon(); });
    rt.on('proj:comment', m => this.panel.onComment(m));
    rt.on('proj:files', m => this.panel.onFiles(m.id));
    rt.on('proj:notes', m => this.panel.onNotes(m));
    rt.on('proj:assigned', m => { sound.play('message'); notice({ title: `${m.by} giao việc cho bạn`, text: `${m.task.title} · ${m.project.name}`, icon: 'check', tone: 'msg', ms: 10000, onClick: () => this.panel.open(m.project.id, { task: m.task.id }) }); });
    rt.on('proj:due', m => { sound.play('message'); notice({ title: m.kind === 'over' ? 'Việc đã quá hạn' : 'Việc sắp tới hạn (còn dưới 1 ngày)', text: `${m.task.title} · ${m.project.name}`, icon: 'clock', tone: 'msg', ms: 12000, onClick: () => this.panel.open(m.project.id, { task: m.task.id }) }); });
    rt.on('proj:mention', m => { sound.play('message'); notice({ title: `${m.msg.name.replace(/^\d{4}-/, '')} nhắc bạn trong ${m.project.name}`, text: m.msg.body, icon: 'chat', tone: 'msg', ms: 10000, onClick: () => this.panel.open(m.project.id, { tab: 'chat' }) }); });
    rt.on('proj:room', m => { notice({ title: `${m.who.replace(/^\d{4}-/, '')} vừa vào phòng dự án`, text: `${m.name} · bấm để vào cùng`, icon: 'grid', tone: 'info', ms: 9000, onClick: () => this.join(m.id) }); });
    rt.on('chat', m => { const ch = m.msg?.channel || ''; if (!ch.startsWith('proj:')) return; const id = +ch.slice(5); this.panel.onChat(id, m.msg); this.onMsg(id, m.msg); });
  }

  // ---------- dữ liệu ----------
  async load() {
    const r = await api('GET', '/api/projects'); if (!r.ok) return;
    this.list = r.projects; this.paintDot(); this.panel.onList(); this.draw();
  }
  /** Gộp nhiều thay đổi công việc liên tiếp thành một lần tải danh sách (đếm "việc của tôi"). */
  loadSoon() { clearTimeout(this._lt); this._lt = setTimeout(() => this.load(), 800); }
  loadRead() { try { return JSON.parse(localStorage.getItem(READ) || '{}') || {}; } catch { return {}; } }
  markRead(id, msgId) { if (!msgId || (this.read[id] || 0) >= msgId) return; this.read[id] = msgId; try { localStorage.setItem(READ, JSON.stringify(this.read)); } catch { /* */ } this.paintDot(); }
  unread(p) { return p.status === 'active' && p.isMember && p.lastMsg > (this.read[p.id] || 0); }
  onMsg(id, msg) {
    const p = this.list.find(x => x.id === id); if (!p) return;
    p.lastMsg = Math.max(p.lastMsg || 0, msg.id);
    if (msg.from === this.s.key || this.panel.reading(id) || this.s.meet?.inRoom === `p${id}`) this.markRead(id, msg.id);
    this.paintDot(); this.panel.onList();
  }
  paintDot() { this.s.social?.setProjDot?.(this.list.some(p => this.unread(p) || p.counts.overdue && p.counts.mine)); }

  // ---------- phòng dự án ----------
  join(id) { this.panel.close(); this.s.meet?.join(`p${id}`); }

  // ---------- bảng "Dự án" 3D cạnh cửa phòng họp ----------
  /** Chỗ đặt: sát vách phòng họp, bên cạnh cửa (theo lưới đi lại), mặt quay ra lối đi. */
  place() {
    const d = this.s.meet?.door, g = this.app.nav?.grid(d?.f ?? 0); if (!d || !g) return null;
    const nx = Math.sin(d.yawOut), nz = Math.cos(d.yawOut), tx = nz, tz = -nx;   // (n: ra khỏi phòng; t: dọc theo vách)
    const wx = d.x - nx * 0.7, wz = d.z - nz * 0.7;                               // (điểm trên vách, ngay cửa)
    const r = d.rect, ax = Math.abs(tx) > 0.5, along = (x, z) => ax ? x : z, lo = ax ? r.x0 : r.z0, hi = ax ? r.x1 : r.z1;   // (chỉ dọc theo vách phòng họp)
    for (const s of [-1.7, 1.7, -2.1, 2.1, -2.5, 2.5, -2.9, 2.9, -3.3, 3.3, -3.7, 3.7]) {
      const bx = wx + tx * s, bz = wz + tz * s, x = bx + nx * 0.55, z = bz + nz * 0.55, u = along(bx, bz);
      if (u - 0.7 < Math.min(lo, hi) || u + 0.7 > Math.max(lo, hi)) continue;          // (cả bảng nằm trước vách, không lấn sang lối đi bên cạnh)
      if (g.isFree(bx, bz, 0.05) || g.isFree(bx + tx * 0.5, bz + tz * 0.5, 0.05) || g.isFree(bx - tx * 0.5, bz - tz * 0.5, 0.05)) continue;   // (sau lưng là vách)
      if (!g.isFree(x, z, 0.25) || !g.isFree(x + nx * 1.1, z + nz * 1.1, 0.3)) continue;   // (chỗ đứng + phía trước thoáng)
      return { x, z, f: d.f, yaw: d.yawOut };
    }
    return null;
  }
  ensure() { if (!this.group && !this.failed && this.app.nav?.grid(0) && this.app.bldRoot && this.s.meet?.door) { this.build3d(); if (!this.group) this.failed = true; } }
  build3d() {
    const spot = this.place(); if (!spot) return;
    this.spot = spot;
    const g = new THREE.Group(); g.name = 'projectBoard';
    g.position.set(spot.x, this.app.model.floorY(spot.f), spot.z); g.rotation.y = spot.yaw;
    const frameM = new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.6 }), legM = new THREE.MeshStandardMaterial({ color: 0x8a8ca3, roughness: 0.4, metalness: 0.5 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.07, BH + 0.07, 0.04), frameM); frame.position.set(0, BOTTOM + BH / 2, 0); g.add(frame);
    for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, BOTTOM + BH, 8), legM); leg.position.set(sx * (BW / 2 - 0.05), (BOTTOM + BH) / 2, -0.05); g.add(leg); const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.42), legM); foot.position.set(sx * (BW / 2 - 0.05), 0.015, -0.05); g.add(foot); }
    this.canvas = document.createElement('canvas'); this.canvas.width = TW; this.canvas.height = TH;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    face.position.set(0, BOTTOM + BH / 2, 0.022); g.add(face);
    this.app.scene.add(g); this.group = g;
    this.stand = { x: spot.x + Math.sin(spot.yaw) * 0.95, z: spot.z + Math.cos(spot.yaw) * 0.95, f: spot.f };
    this.draw();
  }
  /** Mặt bảng: "DỰ ÁN CỦA TÔI" + tối đa 4 dự án (màu, tên, việc của tôi / tin mới) — chỉ người xem thấy dự án của chính mình. */
  draw() {
    const c = this.canvas; if (!c) return;
    const g = c.getContext('2d'), F = getComputedStyle(document.body).getPropertyValue('--font') || 'sans-serif', W = c.width, H = c.height, P = 44;
    g.fillStyle = '#fffaf3'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2b2d42'; g.fillRect(0, 0, W, 112);
    g.fillStyle = '#ffd166'; g.font = `900 52px ${F}`; g.textBaseline = 'middle'; g.fillText('DỰ ÁN', P, 58);
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `700 28px ${F}`; g.textAlign = 'right'; g.fillText('Bấm E để mở', W - P, 58); g.textAlign = 'left';
    const list = this.list.filter(p => p.status === 'active').slice(0, 4), rh = (H - 150) / 4;
    if (!list.length) {
      g.fillStyle = '#6b6d85'; g.font = `800 34px ${F}`; g.fillText('Chưa có dự án nào', P, 200);
      g.font = `600 28px ${F}`; g.fillText('Tạo dự án, mời đồng đội, chia việc', P, 250); g.fillText('theo bảng Kanban — ngay trong văn phòng.', P, 290);
    }
    list.forEach((p, i) => {
      const y = 140 + i * rh;
      g.fillStyle = '#fff'; g.beginPath(); g.roundRect(P - 10, y, W - 2 * P + 20, rh - 16, 18); g.fill();
      g.fillStyle = p.color; g.beginPath(); g.roundRect(P - 10, y, 14, rh - 16, 7); g.fill();
      g.fillStyle = '#2b2d42'; g.font = `900 36px ${F}`;
      let name = p.name; while (g.measureText(name).width > W - 2 * P - 220 && name.length > 3) name = name.slice(0, -2); if (name !== p.name) name += '…';
      g.fillText(name, P + 24, y + (rh - 16) * 0.38);
      g.fillStyle = '#6b6d85'; g.font = `700 25px ${F}`;
      g.fillText(`${p.memberCount} người · ${p.counts.todo + p.counts.doing} việc đang mở`, P + 24, y + (rh - 16) * 0.74);
      const tag = this.unread(p) ? ['tin mới', '#ef476f'] : p.counts.mine ? [`${p.counts.mine} việc của bạn`, '#ff8a5b'] : null;
      if (tag) { g.font = `900 24px ${F}`; const w = g.measureText(tag[0]).width + 28; g.fillStyle = tag[1]; g.beginPath(); g.roundRect(W - P - w, y + (rh - 16) / 2 - 20, w, 40, 20); g.fill(); g.fillStyle = '#fff'; g.fillText(tag[0], W - P - w + 14, y + (rh - 16) / 2); }
    });
    this.tex.needsUpdate = true;
  }
  near(x, z, f) { this.ensure(); return !!this.stand && f === this.stand.f && Math.hypot(x - this.stand.x, z - this.stand.z) < 0.9; }
  prompt() { const n = this.list.filter(p => this.unread(p)).length; return `<b>E</b> mở bảng Dự án${n ? ` <span class="pr-new">${n} dự án có tin mới</span>` : ''}`; }
}
