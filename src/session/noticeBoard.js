// Bảng thông báo công ty.
//  • 3D: tấm bảng đứng ở sảnh tầng trệt (cạnh lối vào) hiện 10 tin đầu — tin ghim, sự kiện sắp diễn ra (ô ngày tháng),
//    tin mới. Đứng gần bấm E, hoặc bấm vào bảng → mở panel.
//  • Panel: lọc Tất cả / Sự kiện / Thông báo; khối "Sắp diễn ra" (sự kiện, đếm ngày) rồi "Mới nhất"; nút "Xem thêm tin cũ"
//    tải tiếp từng trang 10 tin. Bấm một tin để đọc đủ nội dung. Phòng HC-NS và quản trị: nút "+ Đăng tin", sửa / ghim / gỡ.
//  • Có tin mới: chấm đỏ trên nút "Bảng tin" và một thông báo nhỏ; bảng 3D vẽ lại ngay (server gửi 'board').
import * as THREE from 'three';
import { api } from '../net/api.js';
import { esc, confirmDanger } from './ui.js';
import { icon, drawIcon } from '../ui/icons.js';
import { notice } from '../ui/notices.js';
import { overlayOn, overlayOff } from '../ui/overlay.js';
import { DatePicker, vnDay, fmtLong } from '../ui/datePicker.js';
import { findDepartment } from '../shared/departments.js';

const SEEN = 'sysone.board.seen';
const BW = 3.2, BH = BW * 1000 / 1640, BOTTOM = 0.7;   // kích thước mặt bảng (m) ~3,2 × 1,95 — to, đứng trước bảng đọc được luôn; mép dưới cách sàn
const TW = 1640, TH = 1000, SC = 1.5;                // toạ độ vẽ mặt bảng (tỉ lệ 1,64 : 1); canvas thật lớn gấp SC lần cho chữ sắc khi bảng to
const VN = { timeZone: 'Asia/Ho_Chi_Minh' };
const fmtDay = t => new Intl.DateTimeFormat('vi-VN', { ...VN, day: '2-digit', month: '2-digit' }).format(t);
const fmtFull = t => new Intl.DateTimeFormat('vi-VN', { ...VN, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
const fmtHM = t => new Intl.DateTimeFormat('vi-VN', { ...VN, hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
const monthVN = t => 'TH' + new Intl.DateTimeFormat('vi-VN', { ...VN, month: 'numeric' }).format(t);
const dayNum = t => new Intl.DateTimeFormat('vi-VN', { ...VN, day: 'numeric' }).format(t);
export function ago(t, now = Date.now()) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'vừa xong'; if (s < 3600) return `${Math.floor(s / 60)} phút trước`; if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} ngày trước`; return fmtDay(t);
}
function until(t, now = Date.now()) {
  const d = (t - now) / 86400e3;
  if (t <= now) return 'đang diễn ra';
  if (d < 1 / 24) return `còn ${Math.max(1, Math.round((t - now) / 60e3))} phút`;
  if (d < 1) return `còn ${Math.round(d * 24)} giờ`;
  return `còn ${Math.ceil(d)} ngày`;
}

export class NoticeBoard {
  constructor(session) {
    this.s = session; this.app = session.app;
    this.top = []; this.canPost = false; this.list = []; this.hasMore = false; this.filter = 'all'; this.el = null;
    session.rt.on('hello', () => this.refresh());
    session.rt.on('board', () => this.refresh(true));
    session.rt.on('boardPerm', m => { session.toast(m.allow ? 'CEO đã cấp cho bạn quyền đăng tin lên bảng thông báo 📣' : 'CEO đã thu quyền đăng tin của bạn.'); this.refresh(); });
  }

  // ---------- dữ liệu ----------
  async refresh(live = false) {
    const r = await api('GET', '/api/board'); if (!r.ok) return;
    const before = new Set(this.top.map(x => x.id));
    this.top = r.items; this.perms(r); this.total = r.total;
    this.draw();
    const fresh = live ? r.items.filter(x => !before.has(x.id)) : [];
    if (fresh.length) notice({ title: fresh[0].kind === 'event' ? 'Sự kiện mới trên bảng thông báo' : 'Thông báo mới của công ty', text: fresh[0].title, icon: 'megaphone', tone: 'info', onClick: () => this.open(fresh[0].id) });
    this.s.social?.setBoardDot?.(this.unseen());
    if (this.el) this.load(true);
  }
  /** Quyền của mình (server gửi kèm mỗi lần tải): đăng tin / quản lý mọi tin / CEO. Nút "Đăng tin" hiện / ẩn theo quyền. */
  perms(r) {
    this.canPost = !!r.canPost; this.canManage = !!r.canManage; this.isAdmin = !!r.isAdmin;
    const add = this.el?.querySelector('.nb-add'); if (add) add.hidden = !this.canPost;
  }
  seen() { try { return +localStorage.getItem(SEEN) || 0; } catch { return 0; } }
  unseen() { const s = this.seen(); return this.top.some(x => x.createdAt > s); }
  markSeen() { const t = Math.max(0, ...this.top.map(x => x.createdAt)); try { localStorage.setItem(SEEN, String(t)); } catch { /* */ } this.s.social?.setBoardDot?.(false); }

  // ---------- 3D ----------
  /** Chỗ đặt bảng: sát tường sảnh, gần máy chấm công / lối vào (theo lưới đi lại: đặt ở ô trống, quay mặt ra lối đi). */
  place() {
    const m = this.app.model, wp = m.waypoints || {}, g = this.app.nav?.grid(0);
    // vị trí khai báo trong layout.json (noticeBoard: {x, z, yaw}) — hoặc chỗ đã chọn sẵn cho toà nhà SYSONE: vách bên phải
    // ngay khi bước vào cửa chính, mặt quay ra sảnh (ai vào cũng thấy; không trùng máy chấm công, công tắc đèn, chị Mai)
    if (m.layout.noticeBoard) return { ...m.layout.noticeBoard };
    if (m.layout.world === 'sysone-mo') return { x: 6.6, z: 2.35, yaw: -Math.PI / 2 };
    const base = wp.lobby || this.s.att?.spot?.stand || wp.porch; if (!base || !g) return null;
    // chỉ trong nhà (vùng "tầng trệt" của lưới đi lại), không ra sân / vỉa hè
    const room = (m.layout.nav?.areas || []).find(r => r.floor === 0 && /^tầng/.test(r.name || ''));
    // tránh chỗ đứng của máy chấm công, công tắc đèn, thang máy, chị Mai (gợi ý "E" của chúng không bị bảng tin chiếm)
    const s = this.s, avoid = [s.att?.spot?.stand, s.att?.spot, s.lights?.spot?.stand, s.lights?.spot, s.lift?.stops?.[0], s.guide?.home, wp.door0].filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.z));
    const indoor = (x, z) => !room || (x > room.x0 + 0.4 && x < room.x1 - 0.4 && z > room.z0 + 0.4 && z < room.z1 - 0.5);
    // thử các điểm quanh lối vào; chọn điểm có tường sau lưng (ô phía sau bị chặn) và phía trước thoáng
    let best = null;
    for (let r = 1.4; r <= 4.2 && !best; r += 0.35) for (let i = 0; i < 24; i++) {
      const th = i / 24 * Math.PI * 2, x = base.x + Math.cos(th) * r, z = base.z + Math.sin(th) * r;
      if (!indoor(x, z) || !g.isFree(x, z, 0.35) || avoid.some(p => Math.hypot(x - p.x, z - p.z) < 2.2)) continue;
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (g.isFree(x + dx * 0.55, z + dz * 0.55, 0.05)) continue;              // sau lưng là tường / đồ
        if (!g.isFree(x - dx * 0.8, z - dz * 0.8, 0.3) || !g.isFree(x - dx * 1.6, z - dz * 1.6, 0.3)) continue;   // phía trước thoáng, đủ chỗ đứng đọc
        if (!g.isFree(x + dz * 0.8, z - dx * 0.8, 0.12) || !g.isFree(x - dz * 0.8, z + dx * 0.8, 0.12)) continue;   // hai bên đủ rộng cho bảng
        best = { x: x + dx * 0.32, z: z + dz * 0.32, yaw: Math.atan2(-dx, -dz) }; break;
      }
      if (best) break;
    }
    return best;
  }
  build3d() {
    const spot = this.place(); if (!spot) return;
    this.spot = spot;
    const y0 = this.app.model.floorY(0), g = new THREE.Group(); g.name = 'noticeBoard';
    g.position.set(spot.x, y0, spot.z); g.rotation.y = spot.yaw;
    const frameM = new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.6 }), legM = new THREE.MeshStandardMaterial({ color: 0x3a3d55, roughness: 0.5, metalness: 0.3 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.08, BH + 0.08, 0.05), frameM); frame.position.set(0, BOTTOM + BH / 2, 0); g.add(frame);
    // hai chân đứng ở hai mép (bảng rộng hơn vách thấp bên dưới) + đế
    for (const sx of [-1, 1]) { const x = sx * (BW / 2 - 0.06); const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, BOTTOM + BH, 0.07), legM); leg.position.set(x, (BOTTOM + BH) / 2, -0.06); g.add(leg); const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.46), legM); foot.position.set(x, 0.02, -0.06); g.add(foot); }
    const header = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.08, 0.05, 0.12), frameM); header.position.set(0, BOTTOM + BH + 0.065, 0.02); g.add(header);
    this.canvas = document.createElement('canvas'); this.canvas.width = TW * SC; this.canvas.height = TH * SC;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.face.position.set(0, BOTTOM + BH / 2, 0.027); this.face.userData.noticeBoard = true; g.add(this.face);
    this.app.scene.add(g); this.group = g;
    // điểm đứng đọc (trước mặt bảng)
    this.stand = { x: spot.x + Math.sin(spot.yaw) * 1.1, z: spot.z + Math.cos(spot.yaw) * 1.1, f: 0 };   // (bảng to: đứng lùi ra một chút để thấy cả bảng)
    this.draw();
  }
  /** Dựng bảng 3D khi toà nhà + lưới đi lại đã sẵn sàng (gọi mỗi khung hình, chỉ dựng một lần). */
  ensure() { if (!this.group && !this.failed && this.app.nav?.grid(0) && this.app.bldRoot) { this.build3d(); if (!this.group) this.failed = true; } }
  near(x, z, f) { this.ensure(); return this.stand && f === 0 && Math.hypot(x - this.stand.x, z - this.stand.z) < 1.0; }
  prompt() { return `<b>E</b> xem bảng thông báo${this.unseen() ? ' <span class="pr-new">tin mới</span>' : ''}`; }
  hit(ray) { return this.face && this.group.visible ? ray.intersectObject(this.face, false)[0] || null : null; }

  /** Vẽ mặt bảng: tiêu đề + 10 tin (2 cột × 5), chữ to đọc được từ xa. */
  /** Ảnh của tin (tải một lần; tải xong thì vẽ lại bảng). */
  img(url) {
    if (!url) return null;
    this.imgs ||= new Map();
    let im = this.imgs.get(url);
    if (!im) { im = new Image(); im.decoding = 'async'; im.onload = () => this.draw(); im.src = url; this.imgs.set(url, im); }
    return im.complete && im.naturalWidth ? im : null;
  }
  /** Vẽ mặt bảng: tiêu đề; bên trái tin nổi bật (ghim / đầu bảng, ảnh lớn); bên phải 9 tin tiếp theo (ảnh nhỏ / ô ngày). */
  draw() {
    const c = this.canvas; if (!c) return;
    const g = c.getContext('2d'), F = '"Nunito", ui-rounded, system-ui, sans-serif', now = Date.now();
    g.setTransform(SC, 0, 0, SC, 0, 0);   // (vẽ theo toạ độ TW×TH, canvas lớn hơn SC lần)
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = '#f4efe6'; g.fillRect(0, 0, TW, TH);
    // tiêu đề
    const HH = 118, grad = g.createLinearGradient(0, 0, TW, 0); grad.addColorStop(0, '#2b2d42'); grad.addColorStop(1, '#3d4063');
    g.fillStyle = grad; g.fillRect(0, 0, TW, HH);
    g.fillStyle = '#ff8a5b'; g.fillRect(0, HH - 6, TW, 6);
    g.fillStyle = '#ffd166'; rr(g, 34, 26, 66, 66, 18); g.fill(); drawIcon(g, 'megaphone', 67, 59, 40, '#2b2d42', 2.4);
    g.fillStyle = '#fff'; g.font = `900 52px ${F}`; g.textBaseline = 'middle'; g.fillText('BẢNG THÔNG BÁO', 122, 52);
    g.font = `700 25px ${F}`; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText('Tin chính & sự kiện của SYSONE', 124, 92);
    g.textAlign = 'right'; g.font = `900 30px ${F}`; g.fillStyle = '#fff'; g.fillText(new Intl.DateTimeFormat('vi-VN', { ...VN, weekday: 'long' }).format(now).replace(/^./, x => x.toUpperCase()), TW - 40, 50);
    g.font = `700 25px ${F}`; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(new Intl.DateTimeFormat('vi-VN', { ...VN, day: '2-digit', month: '2-digit', year: 'numeric' }).format(now), TW - 40, 88);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const items = this.top.slice(0, 10);
    if (!items.length) { g.fillStyle = '#8a8ca3'; g.font = `800 40px ${F}`; g.textAlign = 'center'; g.fillText('Chưa có thông báo nào', TW / 2, TH / 2 + 40); g.textAlign = 'left'; this.tex.needsUpdate = true; return; }
    const P = 30, top = HH + 26, bottom = TH - 40, LW = 690;
    // ---- tin nổi bật ----
    const f = items[0], fx = P, fy = top, fh = bottom - top;
    g.save(); g.shadowColor = 'rgba(43,45,66,.18)'; g.shadowBlur = 24; g.shadowOffsetY = 6; g.fillStyle = '#fff'; rr(g, fx, fy, LW, fh, 26); g.fill(); g.restore();
    g.save(); rr(g, fx, fy, LW, fh, 26); g.clip();
    const im = this.img(f.image), ih = Math.round(fh * (im ? 0.5 : 0.3));   // (không có ảnh: dải màu thấp hơn, nhường chỗ cho chữ)
    if (im) cover(g, im, fx, fy, LW, ih);
    else { const gg = g.createLinearGradient(fx, fy, fx + LW, fy + ih); gg.addColorStop(0, f.kind === 'event' ? '#ffd6de' : '#dfe7ff'); gg.addColorStop(1, f.kind === 'event' ? '#ffe9d6' : '#e9f5ff'); g.fillStyle = gg; g.fillRect(fx, fy, LW, ih); drawIcon(g, f.kind === 'event' ? 'calendar' : 'megaphone', fx + LW - 110, fy + ih / 2 + 10, 120, f.kind === 'event' ? '#ef476f' : '#1b2a8c', 1.4); }
    g.restore();
    // nhãn trên ảnh
    let tx = fx + 22;
    const tag = (text, bg, fg = '#fff') => { g.font = `900 22px ${F}`; const w = g.measureText(text).width + 30; g.fillStyle = bg; rr(g, tx, fy + 20, w, 40, 20); g.fill(); g.fillStyle = fg; g.fillText(text, tx + 15, fy + 48); tx += w + 10; };
    if (f.pinned) tag('📌 ĐÃ GHIM', '#ffd166', '#2b2d42');
    tag(f.kind === 'event' ? 'SỰ KIỆN' : 'THÔNG BÁO', f.kind === 'event' ? '#ef476f' : '#1b2a8c');
    if (now - f.createdAt < 2 * 86400e3) tag('MỚI', '#06d6a0');
    // chữ
    let y = fy + ih + 62;
    if (f.kind === 'event' && f.eventAt) {
      g.fillStyle = f.upcoming ? '#ef476f' : '#8a8ca3'; rr(g, fx + 28, fy + ih + 24, 96, 104, 18); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `900 50px ${F}`; g.fillText(dayNum(f.eventAt), fx + 76, fy + ih + 84); g.font = `900 21px ${F}`; g.fillText(monthVN(f.eventAt), fx + 76, fy + ih + 114); g.textAlign = 'left';
      g.fillStyle = '#2b2d42'; g.font = `900 38px ${F}`; const tl = wrap(g, f.title, LW - 180, 2); tl.forEach((l, i) => g.fillText(l, fx + 146, fy + ih + 62 + i * 46));
      y = fy + ih + 62 + tl.length * 46 + 6; y = Math.max(y, fy + ih + 156);
      g.font = `800 25px ${F}`; g.fillStyle = '#d0582b'; g.fillText(fit(g, `${fmtHM(f.eventAt)}${f.place ? ' · ' + f.place : ''} · ${until(f.eventAt, now)}`, LW - 56), fx + 28, y); y += 44;
    } else {
      g.fillStyle = '#2b2d42'; g.font = `900 40px ${F}`; const tl = wrap(g, f.title, LW - 56, 2); tl.forEach((l, i) => g.fillText(l, fx + 28, y + i * 48)); y += tl.length * 48 + 4;
      g.font = `800 24px ${F}`; g.fillStyle = '#6b6d85'; g.fillText(fit(g, `${f.byName} · ${ago(f.createdAt, now)}`, LW - 56), fx + 28, y); y += 44;
    }
    if (f.body) { g.font = `600 25px ${F}`; g.fillStyle = '#4a4c63'; const lines = wrap(g, f.body.replace(/\s+/g, ' '), LW - 56, Math.max(1, Math.floor((fy + fh - 26 - y) / 36) + 1)); lines.forEach((l, i) => g.fillText(l, fx + 28, y + i * 36)); }
    // ---- danh sách ----
    const rx = P + LW + 26, rw = TW - rx - P, rest = items.slice(1), n = 9, gap = 10, rh = (fh - gap * (n - 1)) / n;
    rest.forEach((it, i) => {
      const yy = top + i * (rh + gap);
      g.fillStyle = it.pinned ? '#fff6e6' : '#fff'; rr(g, rx, yy, rw, rh, 16); g.fill();
      g.strokeStyle = it.pinned ? 'rgba(243,162,31,.55)' : 'rgba(43,45,66,.08)'; g.lineWidth = 2; g.stroke();
      const th = rh - 16, im2 = this.img(it.image), bx = rx + 8, by = yy + 8;
      if (im2) { g.save(); rr(g, bx, by, th * 1.25, th, 12); g.clip(); cover(g, im2, bx, by, th * 1.25, th); g.restore(); }
      else if (it.kind === 'event' && it.eventAt) { g.fillStyle = it.upcoming ? '#ef476f' : '#a3a6ba'; rr(g, bx, by, th * 1.25, th, 12); g.fill(); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = `900 34px ${F}`; g.fillText(dayNum(it.eventAt), bx + th * 0.625, by + th * 0.55); g.font = `900 16px ${F}`; g.fillText(monthVN(it.eventAt), bx + th * 0.625, by + th * 0.85); g.textAlign = 'left'; }
      else { g.fillStyle = it.pinned ? '#fff1de' : '#eef1fb'; rr(g, bx, by, th * 1.25, th, 12); g.fill(); drawIcon(g, it.pinned ? 'pin' : 'megaphone', bx + th * 0.625, by + th / 2, th * 0.5, it.pinned ? '#c97c00' : '#1b2a8c', 2.2); }
      const tx2 = bx + th * 1.25 + 18, mw = rx + rw - tx2 - 16;
      let mw2 = mw; if (now - it.createdAt < 2 * 86400e3) { g.font = `900 17px ${F}`; const w = g.measureText('MỚI').width + 18; g.fillStyle = '#06d6a0'; rr(g, rx + rw - w - 12, yy + 12, w, 26, 13); g.fill(); g.fillStyle = '#fff'; g.fillText('MỚI', rx + rw - w - 3, yy + 31); mw2 = mw - w - 8; }
      g.fillStyle = '#2b2d42'; g.font = `900 29px ${F}`; g.fillText(fit(g, (it.pinned ? '📌 ' : '') + it.title, mw2), tx2, yy + rh * 0.47);
      g.font = `700 21px ${F}`; g.fillStyle = it.kind === 'event' && it.upcoming ? '#d0582b' : '#6b6d85';
      g.fillText(fit(g, it.kind === 'event' && it.eventAt ? `${fmtHM(it.eventAt)} ${fmtDay(it.eventAt)}${it.place ? ' · ' + it.place : ''} · ${until(it.eventAt, now)}` : `${it.byName} · ${ago(it.createdAt, now)}`, mw), tx2, yy + rh * 0.8);
    });
    if (this.total > 10) { g.fillStyle = '#6b6d85'; g.font = `800 22px ${F}`; g.textAlign = 'right'; g.fillText(`+${this.total - 10} tin cũ hơn — bấm vào bảng để xem tất cả`, TW - P, TH - 12); g.textAlign = 'left'; }
    this.tex.needsUpdate = true;
  }

  // ---------- panel ----------
  async open(focusId = null) {
    if (this.el) { if (focusId) this.read(focusId); return; }
    const back = this.el = document.createElement('div'); back.className = 'sx-back';
    back.innerHTML = `<div class="sx nb" role="dialog" aria-modal="true" aria-labelledby="nbTitle">
      <header class="sx-h nb-h"><span class="sx-ic">${icon('megaphone', 22)}</span><div><h2 id="nbTitle">Bảng thông báo</h2><p>Tin chính và sự kiện của SYSONE</p></div>
        ${this.isAdmin ? `<button type="button" class="sx-ghost nb-perm" title="CEO cấp quyền đăng tin cho nhân viên">${icon('key', 15)} <span>Quyền đăng tin</span></button>` : ''}
        <button type="button" class="sx-primary nb-add"${this.canPost ? '' : ' hidden'}>${icon('plus', 15)} Đăng tin</button>
        <button type="button" class="sx-x" aria-label="Đóng">${icon('close', 16)}</button></header>
      <nav class="sx-tabs" role="tablist">${[['all', 'Tất cả'], ['event', 'Sự kiện'], ['notice', 'Thông báo']].map(([k, n]) => `<button type="button" role="tab" data-f="${k}" class="${k === this.filter ? 'on' : ''}" aria-selected="${k === this.filter}">${n}</button>`).join('')}</nav>
      <div class="sx-body nb-body" tabindex="-1"></div></div>`;
    document.body.appendChild(back); overlayOn();
    requestAnimationFrame(() => back.classList.add('show'));
    back.addEventListener('click', e => { if (e.target === back) this.close(); });
    back.querySelector('.sx-x').onclick = () => this.close();
    back.querySelector('.nb-add')?.addEventListener('click', () => this.form());
    back.querySelector('.nb-perm')?.addEventListener('click', () => this.permView());
    back.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { this.filter = b.dataset.f; back.querySelectorAll('[data-f]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); }); this.load(true); });
    this._key = e => { if (!this.el) return; if (e.key === 'Escape' && !document.querySelector('.modal-back')) { e.preventDefault(); if (this.reading) this.render(); else this.close(); } if (!this.el?.contains(e.target)) e.stopPropagation(); };   // (phím trong ô nhập của panel vẫn tới ô nhập)
    window.addEventListener('keydown', this._key, true);
    await this.load(true);
    this.markSeen();
    if (focusId) this.read(focusId);
  }
  close() {
    const el = this.el; if (!el) return; this.el = null; this.reading = null;
    window.removeEventListener('keydown', this._key, true);
    overlayOff();
    el.classList.remove('show'); setTimeout(() => el.remove(), 200);
  }
  async load(reset = false) {
    if (!this.el) return;
    const offset = reset ? 0 : this.list.length;
    const r = await api('GET', `/api/board?offset=${offset}${this.filter !== 'all' ? `&kind=${this.filter}` : ''}`);
    if (!r.ok) { this.s.toast(r.error || 'Không tải được bảng thông báo.', true); return; }
    this.list = reset ? r.items : [...this.list, ...r.items]; this.hasMore = r.hasMore; this.perms(r);
    if (this.reading === 'perm') return;   // (đang ở màn cấp quyền: giữ nguyên)
    if (!this.reading) this.render(); else this.read(this.reading);
  }
  render() {
    this.reading = null;
    const body = this.el?.querySelector('.nb-body'); if (!body) return;
    const now = Date.now(), up = this.list.filter(x => x.kind === 'event' && x.upcoming && !x.pinned), pin = this.list.filter(x => x.pinned), rest = this.list.filter(x => !x.pinned && !(x.kind === 'event' && x.upcoming));
    const row = it => `<button type="button" class="nb-row${it.pinned ? ' pinned' : ''}" data-id="${it.id}">
        ${it.kind === 'event' && it.eventAt ? `<span class="nb-date${it.upcoming ? '' : ' past'}"><b>${dayNum(it.eventAt)}</b><small>${monthVN(it.eventAt)}</small></span>` : `<span class="nb-dot ${it.pinned ? 'pin' : ''}">${icon(it.pinned ? 'pin' : 'megaphone', 15)}</span>`}
        <span class="nb-tx"><b>${esc(it.title)}${now - it.createdAt < 2 * 86400e3 ? ' <i class="nb-new">MỚI</i>' : ''}</b>
          <small>${it.kind === 'event' && it.eventAt ? `${icon('clock', 12)} ${fmtHM(it.eventAt)}${it.place ? ` · ${esc(it.place)}` : ''} · <em>${until(it.eventAt, now)}</em>` : ''}${it.kind === 'event' ? ' · ' : ''}${esc(it.byName)} · ${ago(it.createdAt, now)}</small>
          ${it.body ? `<span class="nb-snip">${esc(it.body.slice(0, 140))}${it.body.length > 140 ? '…' : ''}</span>` : ''}</span>${it.image ? `<img class="nb-thumb" src="${esc(it.image)}" alt="" loading="lazy" decoding="async">` : ''}</button>`;
    const sec = (title, list) => list.length ? `<div class="nb-sec">${title}</div><div class="nb-list">${list.map(row).join('')}</div>` : '';
    body.innerHTML = this.list.length
      ? `${sec(`${icon('pin', 13)} Đã ghim`, pin)}${sec(`${icon('calendar', 13)} Sắp diễn ra`, up)}${sec('Mới nhất', rest)}
         ${this.hasMore ? '<div class="nb-more"><button type="button" class="sx-ghost nb-load">Xem thêm tin cũ</button></div>' : this.list.length > 10 ? '<p class="sx-end">Đã hết tin.</p>' : ''}`
      : `<div class="sx-empty">${icon('megaphone', 34)}<b>Chưa có tin nào</b><span>${this.canPost ? 'Bấm "Đăng tin" để thông báo cho cả công ty.' : 'Phòng Hành chính - Nhân sự (và người được CEO cấp quyền) sẽ đăng thông báo, sự kiện ở đây.'}</span></div>`;
    body.querySelectorAll('[data-id]').forEach(b => b.onclick = () => this.read(+b.dataset.id));
    body.querySelector('.nb-load')?.addEventListener('click', e => { e.target.disabled = true; e.target.textContent = 'Đang tải…'; this.load(false); });
  }
  read(id) {
    const it = this.list.find(x => x.id === id) || this.top.find(x => x.id === id); const body = this.el?.querySelector('.nb-body'); if (!it || !body) return;
    this.reading = id;
    body.innerHTML = `<article class="nb-read">
      <button type="button" class="sx-back-link">${icon('chevLeft', 15)} Tất cả tin</button>
      ${it.image ? `<a class="nb-cover" href="${esc(it.image)}" target="_blank" rel="noopener" title="Xem ảnh gốc"><img src="${esc(it.image)}" alt="Ảnh của tin: ${esc(it.title)}" decoding="async"></a>` : ''}
      <div class="nb-kind ${it.kind}">${it.kind === 'event' ? 'Sự kiện' : 'Thông báo'}${it.pinned ? ` · ${icon('pin', 12)} Đã ghim` : ''}</div>
      <h3>${esc(it.title)}</h3>
      ${it.kind === 'event' && it.eventAt ? `<div class="nb-when">${icon('calendar', 16)}<span><b>${esc(fmtFull(it.eventAt))}</b>${it.place ? `<br>${esc(it.place)}` : ''}</span><em>${until(it.eventAt)}</em></div>` : ''}
      ${it.body ? `<div class="nb-text">${esc(it.body).replace(/\n/g, '<br>')}</div>` : ''}
      <p class="nb-by">${esc(it.byName)} · đăng ${ago(it.createdAt)}${it.updatedAt > it.createdAt + 60e3 ? ` · sửa ${ago(it.updatedAt)}` : ''}</p>
      ${it.canEdit ? `<div class="nb-acts"><button type="button" class="sx-ghost" data-a="edit">${icon('edit', 14)} Sửa</button>${this.canManage ? `<button type="button" class="sx-ghost" data-a="pin">${icon('pin', 14)} ${it.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'}</button>` : ''}<button type="button" class="sx-ghost danger" data-a="del">${icon('trash', 14)} Gỡ tin</button></div>` : ''}
    </article>`;
    body.scrollTop = 0;
    body.querySelector('.sx-back-link').onclick = () => this.render();
    body.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      if (b.dataset.a === 'edit') return this.form(it);
      if (b.dataset.a === 'pin') { const r = await api('PATCH', `/api/board/${it.id}`, { pinned: !it.pinned }); if (!r.ok) this.s.toast(r.error, true); return; }
      if (await confirmDanger('Gỡ tin này?', `"${it.title}" sẽ bị gỡ khỏi bảng thông báo.`, 'Gỡ tin')) { const r = await api('DELETE', `/api/board/${it.id}`); if (r.ok) { this.s.toast('Đã gỡ tin.'); this.reading = null; } else this.s.toast(r.error, true); }
    });
  }
  /** Đăng / sửa tin (HC-NS, quản trị). */
  /** (CEO) Cấp quyền đăng tin: bật / tắt cho từng nhân viên, hoặc cho tất cả một lần. HC-NS luôn được đăng. */
  async permView() {
    this.reading = 'perm';
    const body = this.el?.querySelector('.nb-body'); if (!body) return;
    body.innerHTML = '<div class="sx-loading">Đang tải…</div>';
    const [emps, perm] = await Promise.all([api('GET', '/api/v1/admin/employees'), api('GET', '/api/v1/admin/board-perms')]);
    if (this.reading !== 'perm' || !this.el) return;
    const allowed = new Set(perm.ok ? perm.allowed : []);
    const list = (emps.ok ? emps.employees : []).filter(e => e.status === 'active').map(e => ({ ...e, hcns: findDepartment(e.department)?.id === 'hcns' }));
    body.innerHTML = `<div class="nb-perm-v">
      <button type="button" class="sx-back-link">${icon('chevLeft', 15)} Bảng thông báo</button>
      <h3>${icon('key', 18)} Quyền đăng tin</h3>
      <p class="nb-perm-note">Người được cấp quyền đăng được tin mới, sửa / gỡ tin của chính mình. Phòng Hành chính - Nhân sự và CEO luôn được đăng, sửa, ghim mọi tin.</p>
      <div class="nb-perm-bar"><input type="search" class="nb-perm-q" placeholder="Tìm theo mã, tên, phòng ban…" aria-label="Tìm nhân viên">
        <span class="nb-perm-n" aria-live="polite"></span>
        <button type="button" class="sx-ghost" data-all="1">${icon('check', 14)} Cấp cho tất cả</button><button type="button" class="sx-ghost danger" data-all="0">${icon('close', 13)} Thu hồi tất cả</button></div>
      <ul class="nb-perm-list">${list.length ? list.map(e => `<li data-q="${esc(`${e.code} ${e.display} ${e.department || ''}`.toLowerCase())}">
        <span class="nb-perm-who"><b>${esc(e.display)}</b><small>${esc(e.department || 'Chưa có phòng ban')}</small></span>
        ${e.hcns ? '<em class="nb-perm-always">Luôn được đăng</em>' : `<label class="nb-sw"><input type="checkbox" data-code="${esc(e.code)}" ${allowed.has(e.code) ? 'checked' : ''} aria-label="Cho ${esc(e.display)} đăng tin"><i></i></label>`}</li>`).join('') : '<li class="nb-perm-empty">Chưa có nhân viên nào.</li>'}</ul></div>`;
    body.scrollTop = 0;
    const count = () => { body.querySelector('.nb-perm-n').textContent = `${body.querySelectorAll('input[data-code]:checked').length + list.filter(e => e.hcns).length}/${list.length} người được đăng`; };
    count();
    body.querySelector('.sx-back-link').onclick = () => this.render();
    const send = async (codes, allow) => { const r = await api('POST', '/api/v1/admin/board-perms', { codes, allow }); if (!r.ok) this.s.toast(r.error || 'Chưa cập nhật được quyền.', true); return r.ok; };
    body.querySelectorAll('input[data-code]').forEach(c => c.onchange = async () => { if (!(await send([c.dataset.code], c.checked))) c.checked = !c.checked; count(); });
    body.querySelector('.nb-perm-q').oninput = e => { const q = e.target.value.trim().toLowerCase(); body.querySelectorAll('.nb-perm-list li[data-q]').forEach(li => { li.hidden = !!q && !li.dataset.q.includes(q); }); };
    body.querySelectorAll('[data-all]').forEach(b => b.onclick = async () => {
      const allow = b.dataset.all === '1', boxes = [...body.querySelectorAll('.nb-perm-list li:not([hidden]) input[data-code]')].filter(c => c.checked !== allow);
      if (!boxes.length) return;
      if (!allow && !(await confirmDanger('Thu hồi quyền đăng tin?', `${boxes.length} người sẽ không đăng tin được nữa (tin đã đăng vẫn giữ).`, 'Thu hồi'))) return;
      if (await send(boxes.map(c => c.dataset.code), allow)) { boxes.forEach(c => { c.checked = allow; }); count(); this.s.toast(allow ? `Đã cấp quyền đăng tin cho ${boxes.length} người.` : `Đã thu hồi quyền của ${boxes.length} người.`); }
    });
  }
  form(it = null) {
    const body = this.el?.querySelector('.nb-body'); if (!body) return;
    const kind = it?.kind || 'notice', ev = it?.eventAt || (Math.ceil(Date.now() / 3600e3) + 24) * 3600e3;
    body.innerHTML = `<form class="nb-form" novalidate>
      <button type="button" class="sx-back-link">${icon('chevLeft', 15)} ${it ? 'Huỷ sửa' : 'Quay lại'}</button>
      <h3>${it ? 'Sửa tin' : 'Đăng tin mới'}</h3>
      <div class="sx-seg" role="radiogroup" aria-label="Loại tin">${[['notice', 'megaphone', 'Thông báo'], ['event', 'calendar', 'Sự kiện']].map(([k, ic, n]) => `<label><input type="radio" name="kind" value="${k}" ${k === kind ? 'checked' : ''}><span>${icon(ic, 15)} ${n}</span></label>`).join('')}</div>
      <label class="sx-field"><span>Tiêu đề <i>*</i></span><input name="title" maxlength="120" required value="${esc(it?.title || '')}" placeholder="Ví dụ: Tiệc cuối năm SYSONE 2026"></label>
      <div class="nb-evf" ${kind === 'event' ? '' : 'hidden'}>
        <div class="sx-field"><span>Ngày <i>*</i></span><button type="button" class="nb-dbtn" aria-expanded="false">${icon('calendar', 15)}<span></span>${icon('chevDown', 14)}</button><div class="nb-cal" hidden></div></div>
        <label class="sx-field"><span>Giờ <i>*</i></span><select name="time" aria-label="Giờ diễn ra">${Array.from({ length: 72 }, (_, i) => 6 * 60 + i * 15).map(mm => { const v = `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; return `<option value="${mm}" ${mm === Math.round(((ev + 7 * 3600e3) % 86400e3) / 60e3) ? 'selected' : ''}>${v}</option>`; }).join('')}</select></label>
        <label class="sx-field"><span>Địa điểm</span><input name="place" maxlength="80" value="${esc(it?.place || '')}" placeholder="Ví dụ: Sảnh tầng trệt"></label>
      </div>
      <div class="sx-field"><span>Ảnh <small>(tuỳ chọn · JPG, PNG, WebP — tự thu nhỏ)</small></span>
        <label class="nb-drop${it?.image ? ' has' : ''}" tabindex="0"><input type="file" accept="image/jpeg,image/png,image/webp" hidden>
          <img class="nb-prev" alt="" ${it?.image ? `src="${esc(it.image)}"` : 'hidden'}>
          <span class="nb-dropt">${icon('upload', 22)}<b>Bấm hoặc kéo ảnh vào đây</b><small>Ảnh ngang 16:9 hiển thị đẹp nhất trên bảng ở sảnh</small></span>
          <button type="button" class="sx-icon nb-rm" aria-label="Bỏ ảnh" ${it?.image ? '' : 'hidden'}>${icon('trash', 15)}</button></label></div>
      <label class="sx-field"><span>Nội dung</span><textarea name="body" rows="6" maxlength="2000" placeholder="Chi tiết cho mọi người…">${esc(it?.body || '')}</textarea></label>
      ${this.canManage ? `<label class="sx-check"><input type="checkbox" name="pinned" ${it?.pinned ? 'checked' : ''}> ${icon('pin', 14)} Ghim lên đầu bảng</label>` : ''}
      <p class="sx-err" role="alert"></p>
      <div class="sx-acts"><button type="button" class="sx-ghost" data-cancel>Huỷ</button><button type="submit" class="sx-primary">${it ? 'Lưu thay đổi' : 'Đăng lên bảng'}</button></div>
    </form>`;
    const f = body.querySelector('form'), back = () => it ? this.read(it.id) : this.render();
    body.querySelector('.sx-back-link').onclick = back; f.querySelector('[data-cancel]').onclick = back;
    f.querySelectorAll('input[name=kind]').forEach(r => r.onchange = () => { f.querySelector('.nb-evf').hidden = f.kind.value !== 'event'; });
    // ngày sự kiện: nút → lịch tháng (không dùng ô ngày giờ mặc định của trình duyệt)
    let evDay = vnDay(ev);
    const dbtn = f.querySelector('.nb-dbtn'), calBox = f.querySelector('.nb-cal');
    const showDay = () => { dbtn.querySelector('span').textContent = fmtLong(evDay).replace(/^./, c => c.toUpperCase()); };
    new DatePicker(calBox, { value: evDay, min: Math.min(evDay, Date.now() - 365 * 86400e3), label: 'Ngày diễn ra', onPick: d => { evDay = d; showDay(); calBox.hidden = true; dbtn.setAttribute('aria-expanded', 'false'); dbtn.focus(); } });
    dbtn.onclick = () => { calBox.hidden = !calBox.hidden; dbtn.setAttribute('aria-expanded', String(!calBox.hidden)); if (!calBox.hidden) calBox.querySelector('[tabindex="0"]')?.focus(); };
    showDay();
    // ảnh: chọn / kéo thả → thu nhỏ trên máy (tối đa 1600 px, WebP) → xem trước; gửi lên khi lưu tin
    let img = undefined;   // undefined: giữ nguyên · null: bỏ ảnh · { data, type }: ảnh mới
    const drop = f.querySelector('.nb-drop'), prev = f.querySelector('.nb-prev'), rm = f.querySelector('.nb-rm'), file = drop.querySelector('input');
    const take = async fl => {
      if (!fl) return;
      if (!/^image\/(jpeg|png|webp)$/.test(fl.type)) { this.s.toast('Chỉ nhận ảnh JPG, PNG hoặc WebP.', true); return; }
      try { img = await shrink(fl); prev.src = `data:${img.type};base64,${img.data}`; prev.hidden = false; rm.hidden = false; drop.classList.add('has'); }
      catch { this.s.toast('Không đọc được ảnh này.', true); }
    };
    file.onchange = () => take(file.files[0]);
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files[0]); });
    rm.onclick = e => { e.preventDefault(); e.stopPropagation(); img = null; prev.hidden = true; prev.removeAttribute('src'); rm.hidden = true; drop.classList.remove('has'); file.value = ''; };
    f.querySelectorAll('input,textarea').forEach(x => x.addEventListener('keydown', e => e.stopPropagation()));
    setTimeout(() => f.title.focus(), 30);
    f.onsubmit = async e => {
      e.preventDefault();
      const err = f.querySelector('.sx-err'), btn = f.querySelector('[type=submit]');
      const data = { kind: f.kind.value, title: f.title.value, body: f.body.value, ...(f.pinned ? { pinned: f.pinned.checked } : {}), place: f.place.value, eventAt: f.kind.value === 'event' ? evDay + (+f.time.value) * 60e3 : null };
      if (!data.title.trim()) { err.textContent = 'Cần nhập tiêu đề.'; f.title.focus(); return; }
      if (data.kind === 'event' && !data.eventAt) { err.textContent = 'Chọn thời gian diễn ra sự kiện.'; return; }
      btn.disabled = true;
      const r = it ? await api('PATCH', `/api/board/${it.id}`, data) : await api('POST', '/api/board', data);
      if (!r.ok) { btn.disabled = false; err.textContent = r.error || 'Chưa lưu được.'; return; }
      if (img) { btn.disabled = true; const x = await api('PUT', `/api/board/${r.item.id}/image`, img); btn.disabled = false; if (!x.ok) { err.textContent = `Đã lưu tin nhưng chưa tải được ảnh: ${x.error || ''}`; this.s.toast('Chưa tải được ảnh — thử lại trong phần Sửa.', true); } }
      else if (img === null && it?.image) await api('DELETE', `/api/board/${r.item.id}/image`);
      this.s.toast(it ? 'Đã lưu thay đổi.' : 'Đã đăng lên bảng thông báo.');
      await this.load(true); this.read(r.item.id);
    };
  }
}

function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
/** Vẽ ảnh phủ kín khung (cắt bớt phần thừa, giữ tỉ lệ). */
function cover(g, im, x, y, w, h) { const s = Math.max(w / im.naturalWidth, h / im.naturalHeight), sw = w / s, sh = h / s; g.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, x, y, w, h); }
/** Ngắt chữ theo bề ngang, tối đa n dòng (dòng cuối có … nếu còn thừa). */
function wrap(g, text, max, n) {
  const words = String(text).split(' '), out = []; let cur = '';
  for (let i = 0; i < words.length; i++) {
    const t = cur ? cur + ' ' + words[i] : words[i];
    if (g.measureText(t).width <= max || !cur) { cur = t; continue; }
    out.push(cur); cur = words[i];
    if (out.length === n - 1) { out.push(fit(g, words.slice(i).join(' '), max)); return out; }
  }
  if (cur) out.push(fit(g, cur, max));
  return out.slice(0, n);
}
function fit(g, text, max) { if (g.measureText(text).width <= max) return text; let lo = 0, hi = text.length; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (g.measureText(text.slice(0, m) + '…').width <= max) lo = m; else hi = m - 1; } return text.slice(0, lo).trimEnd() + '…'; }

/** Thu nhỏ ảnh trên máy người đăng (cạnh dài ≤ 1600 px, WebP chất lượng 0,85; trình duyệt không hỗ trợ WebP thì JPEG). */
async function shrink(fl) {
  const bmp = await createImageBitmap(fl), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  let url = c.toDataURL('image/webp', 0.85); if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', 0.85);
  const [head, data] = url.split(','); return { type: head.slice(5, head.indexOf(';')), data };
}
