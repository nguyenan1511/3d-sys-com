// Văn phòng 2D (pixel, nhìn từ trên xuống) — dùng khi nhân vật ở TRONG toà nhà; ngoài trời vẫn là cảnh 3D.
// Toạ độ thế giới giữ nguyên (x sang phải, z hướng ra đường): màn hình lên trên = cuối nhà (−z), xuống dưới = cửa ra đường.
// Vẽ từ layout.json: sàn từng phòng, tường ngoài + cửa sổ, vách, cửa, cầu thang, bàn (màn hình, đèn, ghế, chủ chỗ),
// bàn họp, đồ đạc; nhân vật pixel của từng người (đi 4 hướng, tên, động tác). Bấm sàn để đi tới, bấm bàn để xem chủ chỗ.
import { moBase } from './moSprite.js';
import { characterDef } from '../agents/glbCharacters.js';
import { staffConfig } from '../agents/avatars.js';
import { drawCharacter } from './sprites.js';
import { custom } from './billboard.js';
import { facingVec } from '../core/util.js';
import { drawIcon } from '../ui/icons.js';

const ART = 28;                  // điểm ảnh mỹ thuật trên một mét (nhân vật cao 0.75 m ≈ 20 điểm ảnh)
const INK = '#2b2d42';
const ROOM = { office: '#b8aa9d', lobby: '#c2b4a4', lounge: '#97ab98', meeting: '#9497bd', pantry: '#c7beb0', wc: '#a9c0cc' };
const ACT_ICON = { wave: 'wave', smoke: 'smoke', drink: 'coffee', phone: 'phone', dance: 'music', jump: 'arrowUp' };
/** Vùng bản đồ 2D tầng trệt (cả đường phố trước nhà). */
export const WORLD = { x0: -14.6, x1: 15.1, z0: -7.3, z1: 30 };

/**
 * Có nằm trong khuôn viên SYSONE không (vẽ 2D): tầng trệt gồm cả sân trước tới cổng ngoài (hàng rào ở z ≈ 9);
 * tầng trên: cả tầng, kể cả ban công. Ra khỏi cổng (vỉa hè, đường phố) là cảnh 3D.
 */
export function insideBuilding(a) {
  if ((a.f || 0) > 0) return Math.abs(a.x) < 3.1 && a.z > -6.95 && a.z < 4.4;
  return a.x > -3.55 && a.x < 3.5 && a.z > -6.95 && a.z < 9.08;
}

export class OfficeMap2D {
  constructor(app, canvas) {
    this.app = app; this.canvas = canvas; this.ctx = canvas.getContext('2d');
    if (app.model?.layout?.world === 'sysone-mo') { Object.assign(WORLD, { x0: -24.6, x1: 25.1, z0: -16 }); this.art = 14; } // toà nhà lớn kích thước thật: phố dài hơn, thu nhỏ bản đồ
    this.cam = { x: 0, z: 0, ready: false }; this.floor = 0; this.t = 0;
    this.inset = { l: 0, r: 0 };
    // logo SYSONE gốc (ảnh nguyên bản, không vẽ lại) cho biển ở tường rào cổng
    this.logo = new Image(); this.logo.src = new URL('logo/sysone-logo.png', document.baseURI).href; // vùng bị thanh điều hướng (trái) / bảng (phải) che, theo điểm ảnh canvas
    this.specs = new Map(); this.defaultSpec = null;
    fetch(new URL('data/pixel-characters.json', document.baseURI)).then(r => r.json()).then(d => {
      for (const c of d.characters) this.specs.set(c.id, c);
      this.defaultSpec = d.characters[0]; this.list = d.characters;
    });
    canvas.addEventListener('click', e => this.onClick(e));
    canvas.addEventListener('mousemove', e => { const w = this.toWorld(e); canvas.style.cursor = this.deskAtWorld(w) ? 'pointer' : 'default'; });
  }

  get P() { return Math.max(2, Math.min(6, Math.round(this.canvas.height / (9 * ART)))); } // phóng to: thấy ~9 m theo chiều dọc (gần hết một tầng)
  get S() { return (this.art || ART) * this.P; } // (toà nhà kích thước thật: 14 điểm ảnh/m — bàn ghế, phòng to gấp đôi bản thu nhỏ cũ)
  get cx0() { return (this.inset.l + this.canvas.width - this.inset.r) / 2; } // tâm vùng nhìn thấy
  sx(x) { return Math.round((x - this.cam.x) * this.S + this.cx0); }
  sy(z) { return Math.round((z - this.cam.z) * this.S + this.canvas.height / 2); }
  toWorld(e) {
    const r = this.canvas.getBoundingClientRect(), k = this.canvas.width / r.width;
    return { x: ((e.clientX - r.left) * k - this.cx0) / this.S + this.cam.x, z: ((e.clientY - r.top) * k - this.canvas.height / 2) / this.S + this.cam.z };
  }
  rect(x0, z0, x1, z1, c) { const X0 = this.sx(Math.min(x0, x1)), Y0 = this.sy(Math.min(z0, z1)); this.ctx.fillStyle = c; this.ctx.fillRect(X0, Y0, this.sx(Math.max(x0, x1)) - X0, this.sy(Math.max(z0, z1)) - Y0); }
  // khung có viền mực 1 điểm ảnh mỹ thuật
  box(x0, z0, x1, z1, c, ink = INK) { const p = this.P / this.S; this.rect(x0 - p, z0 - p, x1 + p, z1 + p, ink); this.rect(x0, z0, x1, z1, c); }

  /** Vị trí, tầng và các nhân vật trên tầng; gọi mỗi khung hình khi đang ở 2D. */
  render(dt, focus) {
    const cv = this.canvas, W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    this.t += dt;
    const ctx = this.ctx; ctx.imageSmoothingEnabled = false;
    this.floor = focus.f || 0;
    // camera bám nhân vật, không ra ngoài bản đồ quá nhiều
    const k = this.cam.ready ? 1 - Math.exp(-dt * 8) : 1; this.cam.ready = true;
    // vùng nhìn thấy (trừ phần bị thanh điều hướng/bảng che); bản đồ nhỏ hơn vùng này thì căn giữa, lớn hơn thì bám nhân vật
    const dpr2 = cv.width / Math.max(1, W); this.inset = { l: (this.insetCss?.l || 0) * dpr2, r: (this.insetCss?.r || 0) * dpr2 };
    const halfW = (cv.width - this.inset.l - this.inset.r) / 2 / this.S, halfH = cv.height / 2 / this.S;
    const bx = this.floor === 0 ? [WORLD.x0, WORLD.x1] : [-3.4, 3.4], bz = this.floor === 0 ? [WORLD.z0, WORLD.z1] : [-7.3, 4.9];
    // tâm màn hình luôn theo nhân vật (không kẹp theo mép bản đồ)
    void bx; void bz; const cx = focus.x, cz = focus.z;
    this.cam.x += (cx - this.cam.x) * k; this.cam.z += (cz - this.cam.z) * k;
    ctx.fillStyle = '#3a3d4a'; ctx.fillRect(0, 0, cv.width, cv.height);
    this.drawFloor(this.floor);
    if (this.target) { // vòng đánh dấu nơi đang đi tới
      const r = this.S * (0.12 + 0.02 * Math.sin(this.t * 6));
      ctx.strokeStyle = '#ff8a5b'; ctx.lineWidth = this.P; ctx.beginPath(); ctx.ellipse(this.sx(this.target.x), this.sy(this.target.z), r, r * 0.6, 0, 0, Math.PI * 2); ctx.stroke();
    }
    this.drawPeople(this.floor);
  }

  drawFloor(f) {
    const m = this.app.model, L = m.layout, ctx = this.ctx, P = this.P, px = P / this.S;
    // thế giới văn phòng my-office (layout sinh tự động): sàn, phòng, tường bao theo vùng đi được; không có sân/cổng/phố cũ
    if (L.world === 'my-office') return this.drawFloorMO(f);
    if (L.world === 'sysone-mo') return this.drawFloorBig(f);
    // --- sàn ---
    if (f === 0) {
      this.drawStreet();
      // sân trước tới cổng ngoài: cỏ, lối đi lát gạch, hiên
      this.rect(-3.5, 2.0, 3.45, 9.0, '#7fa06a');
      for (let i = 0; i < 40; i++) { const gx = -3.3 + ((i * 37) % 64) / 10, gz = 2.3 + ((i * 53) % 66) / 10; if (gx < 0.2 || gx > 3.0) this.rect(gx, gz, gx + 0.05, gz + 0.05, '#6c8f58'); }
      this.rect(0.35, 2.0, 2.85, 9.0, '#a89a88');
      for (let z = 2.2; z < 9; z += 0.5) this.rect(0.35, z, 2.85, z + px, 'rgba(43,45,66,.12)');
      this.rect(0.35, 2.0, 2.85, 4.5, '#b9a58f');                       // hiên (mái ngói phía trên ở cảnh 3D)
      this.rect(-3, -6.8, 3, 2.0, ROOM.office); this.rect(-3, 1.0, -0.2, 3.6, ROOM.office);
    } else {
      this.rect(-3, -6.8, 3, 3.6, ROOM.office);
      this.rect(0, 3.6, 3, 4.3, '#9c8f80');                            // ban công
    }
    for (const r of L.rooms || []) if (r.floor === f) this.rect(r.x0, r.z0, r.x1, r.z1, ROOM[r.type] || ROOM.office);
    // ô gạch
    ctx.fillStyle = 'rgba(43,45,66,.07)';
    const z1 = f === 0 ? 3.6 : 4.3;
    for (let x = -3; x <= 3.001; x += 0.5) ctx.fillRect(this.sx(x), this.sy(-6.8), Math.max(1, P / 2), this.sy(z1) - this.sy(-6.8));
    for (let z = -6.8; z <= z1 + 0.001; z += 0.5) ctx.fillRect(this.sx(-3), this.sy(z), this.sx(3) - this.sx(-3), Math.max(1, P / 2));
    // thảm
    const fsr = m.fs || 1;
    for (const it of L.items || []) if (it.floor === f && it.type === 'rug') this.box(it.x - it.w * fsr / 2, it.z - it.d * fsr / 2, it.x + it.w * fsr / 2, it.z + it.d * fsr / 2, it.color || '#c9a26b', 'rgba(43,45,66,.35)');
    // --- cầu thang ---
    for (const s of m.stairs) {
      if (s.from !== f && s.to !== f) continue;
      this.box(s.x0, s.z0, s.x1, s.z1, '#8d8378');
      const n = s.steps || 16;
      for (let i = 1; i < n; i++) { const z = s.z0 + (s.z1 - s.z0) * i / n; this.rect(s.x0, z, s.x1, z + px, 'rgba(43,45,66,.45)'); }
      const up = s.from === f, other = m.floorById.get(up ? s.to : s.from);
      this.label(`${up ? '↑' : '↓'} ${other.name}`, (s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2, '#fffaf3', true);
    }
    // --- vách / tường trong ---
    for (const w of L.walls || []) {
      if (w.floor !== f) continue;
      const glass = w.material === 'glass', alongX = (w.x1 - w.x0) >= (w.z1 - w.z0), t = 0.06;
      const a0 = alongX ? w.x0 : w.z0, a1 = alongX ? w.x1 : w.z1, ops = (w.openings || []).slice().sort((p, q) => p.from - q.from);
      let cur = a0; const seg = (s0, s1) => alongX ? this.rect(s0, (w.z0 + w.z1) / 2 - t, s1, (w.z0 + w.z1) / 2 + t, glass ? 'rgba(191,227,255,.85)' : '#5c5450') : this.rect((w.x0 + w.x1) / 2 - t, s0, (w.x0 + w.x1) / 2 + t, s1, glass ? 'rgba(191,227,255,.85)' : '#5c5450');
      for (const o of ops) { if (o.from > cur) seg(cur, o.from); cur = Math.max(cur, o.to); }
      if (a1 > cur) seg(cur, a1);
    }
    // --- tường ngoài + cửa sổ ---
    const T = 0.16, wall = '#5c5450', top = '#6f6763';
    const hwall = (x0, x1, z, gaps = []) => { let c = x0; for (const [g0, g1] of gaps) { if (g0 > c) { this.rect(c, z - T, g0, z, wall); this.rect(c, z - T, g0, z - T + px * 2, top); } c = g1; } if (x1 > c) { this.rect(c, z - T, x1, z, wall); this.rect(c, z - T, x1, z - T + px * 2, top); } };
    const vwall = (x, z0, z1) => this.rect(x - T / 2, z0, x + T / 2, z1, wall);
    hwall(-3.08, 3.08, -6.8 + T / 2);
    // cửa sổ trên tường sau
    for (const wx of [-2.2, -0.6, 1.0, 2.3]) { this.box(wx - 0.32, -6.8 - 0.13, wx + 0.32, -6.8 + 0.02, '#2a3a6b'); this.rect(wx - px, -6.8 - 0.13, wx + px, -6.8 + 0.02, INK); }
    vwall(-3.04, -6.8, f === 0 ? 3.6 : 3.6); vwall(3.04, -6.8, f === 0 ? 2.0 : 3.6);
    if (f === 0) {
      hwall(-0.2, 3.08, 2.08, [[0.45, 2.75]]);                        // mặt tiền sảnh, cửa chính
      vwall(-0.2, 2.0, 3.6); hwall(-3.08, -0.12, 3.68);                 // phòng khách
      this.rect(0.5, 2.0, 2.7, 2.24, '#8a5a3c'); this.label('CỬA CHÍNH', 1.6, 2.5, '#fffaf3', true);
      // hàng rào + trụ cổng + cổng sắt (mở khi có người tới gần) ở z ≈ 9; hai bên khuôn viên
      // tường rào + biển logo (mặt biển quay ra vỉa hè): tấm biển trắng viền mực, logo gốc giữ đúng tỉ lệ 1296:171
      this.rect(-3.5, 8.95, -0.35, 9.25, '#e8e4dc');
      this.box(-3.1, 9.25, -0.4, 9.72, '#ffffff');
      if (this.logo.complete && this.logo.naturalWidth) {
        const w = 2.45, h = w * this.logo.naturalHeight / this.logo.naturalWidth, x0 = -1.75 - w / 2, z0 = 9.485 - h / 2;
        this.ctx.imageSmoothingEnabled = true; this.ctx.imageSmoothingQuality = 'high';
        this.ctx.drawImage(this.logo, this.sx(x0), this.sy(z0), w * this.S, h * this.S);
        this.ctx.imageSmoothingEnabled = false;
      }
      this.box(-0.35, 8.9, 0.15, 9.35, '#d9d2c4'); this.box(2.95, 8.9, 3.45, 9.35, '#efe6cf');
      for (let x = 0.2; x < 0.75; x += 0.1) this.rect(x, 9.08, x + 0.025, 9.16, '#2b2d42');
      for (let x = 2.4; x < 2.92; x += 0.1) this.rect(x, 9.08, x + 0.025, 9.16, '#2b2d42');
      this.label('CỔNG', 1.55, 8.65, '#fffaf3', true);
      this.rect(-3.58, 3.6, -3.5, 9.25, '#8d8378'); this.rect(3.45, 2.0, 3.53, 9.25, '#8d8378');
      for (const [x, z] of [[-3.2, 5.0], [-3.2, 7.6], [3.15, 5.4], [3.15, 7.8], [0.1, 4.8]]) this.item({ type: 'plant', x, z });
      for (const wx of [-2.2, -1.0]) this.box(wx - 0.32, 3.6, wx + 0.32, 3.72, '#bfe3ff');
    } else {
      hwall(-3.08, 0.02, 3.68); vwall(0.02, 3.6, 4.3);
      this.rect(0, 4.26, 3.04, 4.32, '#4a4d5c'); this.rect(3.0, 3.6, 3.06, 4.32, '#4a4d5c'); // lan can ban công
      for (const wx of [-2.2, -1.0]) this.box(wx - 0.32, 3.6, wx + 0.32, 3.72, '#bfe3ff');
    }
    // --- đồ đạc ---
    for (const it of L.items || []) if (it.floor === f && it.type !== 'rug') this.item(it);
    for (const t of m.tables || []) if (t.floor === f) this.table(t);
    for (const d of m.desks) if (d.floor === f) this.desk(d);
    // tên phòng
    for (const r of L.rooms || []) if (r.floor === f) this.label(r.name.toUpperCase(), (r.x0 + r.x1) / 2, r.z0 + 0.32, 'rgba(43,45,66,.55)');
  }

  /** Nhãn nhỏ dạng thẻ có nền (chủ chỗ), không tràn sang bàn bên cạnh: cắt bớt chữ theo bề rộng tối đa. */
  tag(text, x, z, bg, maxM = 0.62) {
    const ctx = this.ctx, fs = Math.max(9, Math.round(this.P * 2.3)), maxW = this.S * maxM;
    ctx.font = `800 ${fs}px ui-rounded, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let t = text; while (t.length > 3 && ctx.measureText(t).width > maxW) t = t.slice(0, -2) + '…';
    const w = ctx.measureText(t).width + fs * 0.8, X = this.sx(x), Y = this.sy(z);
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(X - w / 2, Y - fs * 0.65, w, fs * 1.3, fs * 0.5); ctx.fill();
    ctx.fillStyle = '#fffaf3'; ctx.fillText(t, X, Y + 1);
  }

  /** Bản đồ 2D cho văn phòng my-office: đường quanh toà nhà, sàn, phòng, vách, đồ đạc, bàn. */
  drawFloorMO(f) {
    const m = this.app.model, L = m.layout, P = this.P, px = P / this.S, a = L.nav.areas[0];
    const B = { x0: a.x0 - 0.15, x1: a.x1 + 0.15, z0: a.z0 - 0.15, z1: a.z1 + 0.15 };
    this.rect(B.x0 - 40, B.z0 - 40, B.x1 + 40, B.z1 + 40, '#4a4d57');                    // đường phố quanh toà nhà
    this.rect(B.x0 - 2.6, B.z0 - 2.6, B.x1 + 2.6, B.z1 + 2.6, '#c9b9a6');                  // vỉa hè, sân quanh nhà
    for (let x = B.x0 - 2.6; x < B.x1 + 2.6; x += 0.6) this.rect(x, B.z0 - 2.6, x + px, B.z1 + 2.6, 'rgba(43,45,66,.06)');
    this.rect(B.x0, B.z0, B.x1, B.z1, ROOM.office);
    for (const r of L.rooms || []) if (r.floor === f) this.rect(r.x0, r.z0, r.x1, r.z1, ROOM[r.type] || ROOM.office);
    const ctx = this.ctx; ctx.fillStyle = 'rgba(43,45,66,.06)';
    for (let x = Math.ceil(B.x0); x <= B.x1; x += 1) ctx.fillRect(this.sx(x), this.sy(B.z0), Math.max(1, P / 2), this.sy(B.z1) - this.sy(B.z0));
    for (let z = Math.ceil(B.z0); z <= B.z1; z += 1) ctx.fillRect(this.sx(B.x0), this.sy(z), this.sx(B.x1) - this.sx(B.x0), Math.max(1, P / 2));
    for (const w of L.walls || []) if (w.floor === f) this.rect(w.x0, w.z0, w.x1, w.z1, w.material === 'glass' ? 'rgba(191,227,255,.85)' : '#5c5450');
    const T = 0.16, wall = '#5c5450';
    this.rect(B.x0 - T, B.z0 - T, B.x1 + T, B.z0, wall); this.rect(B.x0 - T, B.z1, B.x1 + T, B.z1 + T, wall);
    this.rect(B.x0 - T, B.z0, B.x0, B.z1, wall); this.rect(B.x1, B.z0, B.x1 + T, B.z1, wall);
    for (const t of m.tables || []) if (t.floor === f && t.type === 'meeting') this.box(t.x - 1.8, t.z - 0.65, t.x + 1.8, t.z + 0.65, '#f2efea');
    for (const d of m.desks) if (d.floor === f) this.desk(d);
    for (const r of L.rooms || []) if (r.floor === f) this.label(r.name.toUpperCase(), (r.x0 + r.x1) / 2, r.z0 + 0.45, 'rgba(43,45,66,.55)');
  }

  /** Ngôi nhà SYSONE 3 tầng (nội thất my-office): tầng trệt có đường phố, sân trước; mỗi tầng: sàn, phòng, tường, bàn, cầu thang. */
  drawFloorBig(f) {
    const m = this.app.model, L = m.layout, px = this.P / this.S;
    const areas = L.nav.areas.filter(a => a.floor === f);
    if (f === 0) {
      this.drawStreet();
      const y = areas.find(a => a.name === 'sân trước');
      if (y) { this.rect(y.x0, y.z0, y.x1, y.z1, '#a89a88'); for (let z = y.z0 + 0.5; z < y.z1; z += 0.5) this.rect(y.x0, z, y.x1, z + px, 'rgba(43,45,66,.10)'); }
    } else this.rect(-60, -60, 60, 60, '#3a3d4a');                                      // tầng trên: nền tối quanh toà nhà
    for (const a of areas) if (a.name !== 'sân trước' && a.name !== 'vỉa hè' && a.name !== 'cổng') this.rect(a.x0, a.z0, a.x1, a.z1, a.name?.startsWith('chiếu') || a.name?.startsWith('chân') ? '#8d8378' : ROOM.office);
    for (const r of L.rooms || []) if (r.floor === f) this.rect(r.x0, r.z0, r.x1, r.z1, ROOM[r.type] || ROOM.office);
    const ctx = this.ctx; ctx.fillStyle = 'rgba(43,45,66,.06)';
    for (const a of areas.filter(a => a.name?.startsWith('tầng'))) {
      for (let x = Math.ceil(a.x0); x <= a.x1; x += 1) ctx.fillRect(this.sx(x), this.sy(a.z0), Math.max(1, this.P / 2), this.sy(a.z1) - this.sy(a.z0));
      for (let z = Math.ceil(a.z0); z <= a.z1; z += 1) ctx.fillRect(this.sx(a.x0), this.sy(z), this.sx(a.x1) - this.sx(a.x0), Math.max(1, this.P / 2));
    }
    // cầu thang
    for (const s of m.stairs) {
      if (s.from !== f && s.to !== f) continue;
      this.box(s.x0, s.z0, s.x1, s.z1, '#8d8378');
      const n = s.steps || 16;
      for (let i = 1; i < n; i++) { const z = s.z0 + (s.z1 - s.z0) * i / n; this.rect(s.x0, z, s.x1, z + px, 'rgba(43,45,66,.45)'); }
      const up = s.from === f, other = m.floorById.get(up ? s.to : s.from);
      this.label(`${up ? '↑' : '↓'} ${other.name}`, (s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2, '#fffaf3', true);
    }
    // tường (vách kính xanh nhạt), chừa ô cửa
    for (const w of L.walls || []) {
      if (w.floor !== f) continue;
      const glass = w.material === 'glass', alongX = (w.x1 - w.x0) >= (w.z1 - w.z0), col = glass ? 'rgba(191,227,255,.85)' : '#5c5450';
      const a0 = alongX ? w.x0 : w.z0, a1 = alongX ? w.x1 : w.z1, ops = (w.openings || []).slice().sort((p, q) => p.from - q.from);
      let cur = a0; const seg = (s0, s1) => alongX ? this.rect(s0, w.z0, s1, w.z1, col) : this.rect(w.x0, s0, w.x1, s1, col);
      for (const o of ops) { if (o.from > cur) seg(cur, o.from); cur = Math.max(cur, o.to); }
      if (a1 > cur) seg(cur, a1);
    }
    for (const t of m.tables || []) if (t.floor === f) for (const st of t.seats) this.box(st.x - 0.13, st.z - 0.13, st.x + 0.13, st.z + 0.13, '#4a4d5c');
    // khu của từng phòng ban: nền màu nhạt + viền màu phòng (vẽ dưới bàn)
    for (const z of L.deptZones || []) if (z.floor === f) { this.ctx.fillStyle = z.color + '22'; this.ctx.fillRect(this.sx(z.x0), this.sy(z.z0), this.sx(z.x1) - this.sx(z.x0), this.sy(z.z1) - this.sy(z.z0)); this.ctx.strokeStyle = z.color; this.ctx.lineWidth = Math.max(1, this.P / 3); this.ctx.strokeRect(this.sx(z.x0), this.sy(z.z0), this.sx(z.x1) - this.sx(z.x0), this.sy(z.z1) - this.sy(z.z0)); }
    for (const d of m.desks) if (d.floor === f) this.desk(d);
    for (const r of L.rooms || []) if (r.floor === f) this.label(r.name.toUpperCase(), (r.x0 + r.x1) / 2, r.z0 + 0.5, 'rgba(43,45,66,.55)');
    for (const z of L.deptZones || []) if (z.floor === f) this.label(z.name.replace(/^(Phòng|Team) /, ''), (z.x0 + z.x1) / 2, z.z1 - 0.25, '#fffaf3', true);
  }

  /** Vỉa hè, lòng đường (vạch kẻ), vỉa hè bên kia, nhà hàng xóm (mái nhìn từ trên). */
  drawStreet() {
    const px = this.P / this.S;
    this.rect(WORLD.x0, 9.0, WORLD.x1, 12.5, '#c9b9a6');                         // vỉa hè trước nhà
    for (let x = WORLD.x0; x < WORLD.x1; x += 0.6) this.rect(x, 9.0, x + px, 12.5, 'rgba(43,45,66,.07)');
    this.rect(WORLD.x0, 12.5, WORLD.x1, 12.7, '#8d8378');                         // bó vỉa
    this.rect(WORLD.x0, 12.7, WORLD.x1, 26.7, '#4a4d57');                         // lòng đường
    this.rect(WORLD.x0, 13.0, WORLD.x1, 13.1, '#e9c46a');
    this.rect(WORLD.x0, 14.4, WORLD.x1, 14.5, '#e6e6e6'); this.rect(WORLD.x0, 25.9, WORLD.x1, 26.0, '#e6e6e6');
    for (let x = -14; x <= 14; x += 5) this.rect(x, 19.6, x + 2.5, 19.75, '#e6e6e6');      // vạch giữa đường
    this.rect(WORLD.x0, 26.7, WORLD.x1, WORLD.z1, '#c9b9a6');                     // vỉa hè bên kia
    this.label('ĐƯỜNG DƯƠNG QUANG ĐÔNG', 0, 22.6, 'rgba(255,250,243,.35)');
    // nhà hàng xóm: mái nhìn từ trên + viền mực
    const roof = (x0, x1, z0, z1, c) => { this.box(x0, z0, x1, z1, c); this.rect(x0, z1 - 0.25, x1, z1, 'rgba(43,45,66,.18)'); };
    const big = this.app.model.layout.world === 'sysone-mo', dl = big ? -10 : 0, dr = big ? 10 : 0; // (toà nhà lớn: nhà hàng xóm dời ra hai bên)
    roof(-14.5 + dl, -8.0 + dl, -7.3, 9.0, '#b98f6a'); roof(-8.0 + dl, -3.6 + dl, -7.3, 9.0, '#c9a47e');
    roof(3.55 + dr, 13.0 + dr, -7.3, -4.0, '#9fb0c2'); roof(3.55 + dr, 8.2 + dr, -4.0, 1.0, '#c4b39a'); roof(8.2 + dr, 15.1 + dr, -4.0, 9.0, '#a99a86');
    for (const [x, z] of [[-11, 11.2], [-5.5, 11.2], [6, 11.2], [11.5, 11.2], [-9, 28.2], [0, 28.2], [9, 28.2]]) { // cây vỉa hè
      this.ctx.fillStyle = 'rgba(43,45,66,.18)'; this.ctx.beginPath(); this.ctx.ellipse(this.sx(x), this.sy(z + 0.25), this.S * 0.62, this.S * 0.3, 0, 0, Math.PI * 2); this.ctx.fill();
      this.ctx.fillStyle = '#4f9a4a'; this.ctx.beginPath(); this.ctx.arc(this.sx(x), this.sy(z), this.S * 0.6, 0, Math.PI * 2); this.ctx.fill();
      this.ctx.fillStyle = '#6cc466'; this.ctx.beginPath(); this.ctx.arc(this.sx(x - 0.15), this.sy(z - 0.15), this.S * 0.3, 0, Math.PI * 2); this.ctx.fill();
    }
  }

  /** Xe đang chạy (vị trí thật từ mô phỏng giao thông), nhìn từ trên xuống. */
  drawVehicles() {
    const movers = this.app.street?.movers || [], CAR = ['#2f6db5', '#d9473c', '#f2f2ee', '#2b2d42', '#9aa3ad', '#e9c46a'];
    movers.forEach((m, i) => {
      const p = m.o.position, len = m.len || (m.kind === 'car' ? 4.3 : 1.8), half = len / 2, dir = m.dir || 1;
      if (m.kind === 'car') {
        const w = 0.9, c = CAR[i % CAR.length];
        this.box(p.x - half, p.z - w, p.x + half, p.z + w, c);
        const wx = p.x + dir * half * 0.35; this.rect(wx - 0.35, p.z - w + 0.12, wx + 0.35, p.z + w - 0.12, '#1c2530'); // kính lái
        this.rect(p.x - half * 0.55, p.z - w + 0.15, p.x + half * 0.2, p.z + w - 0.15, 'rgba(255,255,255,.12)');   // nóc
        const hx = p.x + dir * (half - 0.05); this.rect(hx - 0.05, p.z - w + 0.1, hx + 0.05, p.z - w + 0.35, '#fff3b0'); this.rect(hx - 0.05, p.z + w - 0.35, hx + 0.05, p.z + w - 0.1, '#fff3b0');
      } else {
        this.box(p.x - half, p.z - 0.18, p.x + half, p.z + 0.18, '#3a3d4a');                                       // xe máy
        this.ctx.fillStyle = i % 3 === 0 ? '#06b14f' : ['#f2f2ee', '#d9473c', '#2f6db5'][i % 3];                  // mũ bảo hiểm người lái
        this.ctx.beginPath(); this.ctx.arc(this.sx(p.x - dir * 0.1), this.sy(p.z), this.S * 0.2, 0, Math.PI * 2); this.ctx.fill();
        this.ctx.strokeStyle = INK; this.ctx.lineWidth = this.P * 0.5; this.ctx.stroke();
      }
    });
  }

  label(text, x, z, color, pill = false) {
    const ctx = this.ctx, fs = Math.max(10, Math.round(this.P * 3.4));
    ctx.font = `800 ${fs}px ui-rounded, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const X = this.sx(x), Y = this.sy(z);
    if (pill) { const w = ctx.measureText(text).width + fs; ctx.fillStyle = 'rgba(43,45,66,.78)'; ctx.beginPath(); ctx.roundRect(X - w / 2, Y - fs * 0.75, w, fs * 1.5, fs * 0.7); ctx.fill(); }
    ctx.fillStyle = color; ctx.fillText(text, X, Y + 1);
  }

  item(it) {
    // nội thất thu nhỏ theo tỉ lệ như bản 3D (layout.json → scale.furniture), vị trí giữ nguyên
    const fs = this.app.model.fs || 1, x = it.x, z = it.z, w = (it.w || 0.4) * fs, d = (it.d || 0.4) * fs, px = this.P / this.S;
    switch (it.type) {
      case 'plant': this.box(x - 0.12, z - 0.02, x + 0.12, z + 0.16, '#a85c3c'); this.box(x - 0.17, z - 0.22, x + 0.17, z + 0.02, '#4f9a4a'); this.rect(x - 0.08, z - 0.2, x + 0.02, z - 0.12, '#6cc466'); break;
      case 'sofa': { const vertical = it.facing === 90 || it.facing === 270, W = vertical ? d : w, D = vertical ? w : d; this.box(x - W / 2, z - D / 2, x + W / 2, z + D / 2, it.color || '#8a5a5a'); for (let i = 0; i < 2; i++) this.rect(x - W / 2 + 0.1 + i * (W - 0.2) / 2, z - D / 2 + 0.25, x - W / 2 + 0.1 + (i + 1) * (W - 0.2) / 2 - 0.04, z + D / 2 - 0.1, 'rgba(255,255,255,.18)'); break; }
      case 'lowtable': this.box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, '#b08a5b'); break;
      case 'counter': this.box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, '#d9d6cf'); this.rect(x - w / 2 + 0.08, z - 0.25, x + w / 2 - 0.08, z + 0.1, '#9fa6ad'); break;
      case 'fridge': this.box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, '#f2f2ee'); this.rect(x - w / 2, z - px, x + w / 2, z + px, '#c9c9c4'); break;
      case 'toilet': this.box(x - 0.16, z - 0.22, x + 0.16, z + 0.2, '#f6f6f2'); this.rect(x - 0.1, z - 0.05, x + 0.1, z + 0.14, '#cfe3ea'); break;
      case 'sink': this.box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, '#f6f6f2'); break;
      case 'printer': this.box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, '#c9ccd2'); this.rect(x - w / 2 + 0.08, z - 0.05, x + w / 2 - 0.08, z + 0.05, INK); break;
      case 'tv': this.box(x - 0.05, z - w / 2, x + 0.02, z + w / 2, '#16181c'); break;
      default: this.box(x - w / 2, z - d / 2, x + w / 2, z + d / 2, '#8d8378');
    }
  }

  table(t) {
    const fs = this.app.model.fs || 1, w = t.w * fs, d = t.d * fs;
    for (const s of t.seats) this.box(s.x - 0.11, s.z - 0.11, s.x + 0.11, s.z + 0.11, '#4a4d5c');
    this.box(t.x - w / 2, t.z - d / 2, t.x + w / 2, t.z + d / 2, t.color || '#b08a5b');
    this.rect(t.x - w / 2, t.z - d / 2, t.x + w / 2, t.z - d / 2 + this.P / this.S * 2, 'rgba(255,255,255,.2)');
  }

  desk(d) {
    const fs = this.app.model.fs || 1, f = facingVec(d.facing || 0), session = this.app.session;
    const side = (d.facing || 0) % 180 !== 0, w = (d.w || 1) * fs, dd = (d.d || 0.6) * fs, W = side ? dd : w, D = side ? w : dd;
    const s = session?.seats.get(d.id), mine = s?.owner && session.me.employee && s.owner.code === session.me.employee.code;
    // ghế ở chỗ ngồi
    this.box(d.seat.x - 0.12, d.seat.z - 0.12, d.seat.x + 0.12, d.seat.z + 0.12, '#4a4d5c');
    // mặt bàn (chỗ của mình viền xanh)
    this.box(d.x - W / 2, d.z - D / 2, d.x + W / 2, d.z + D / 2, d.kind === 'reception' ? '#7a4f36' : '#9b6a48', mine ? '#06d6a0' : INK);
    this.rect(d.x - W / 2, d.z - D / 2, d.x + W / 2, d.z - D / 2 + this.P / this.S * 2, 'rgba(255,255,255,.18)');
    // màn hình phía xa người ngồi, đèn bàn
    if (d.kind !== 'reception') {
      const mx = d.x + f.x * D * 0.22, mz = d.z + f.z * D * 0.22, mw = side ? 0.06 : 0.22, md = side ? 0.22 : 0.06;
      this.box(mx - mw / 2, mz - md / 2, mx + mw / 2, mz + md / 2, '#3d7fd6');
      const lx = d.x + (side ? f.x * 0.08 : W / 2 - 0.08), lz = d.z + (side ? D / 2 - 0.08 : f.z * 0.08);
      this.rect(lx - 0.035, lz - 0.035, lx + 0.035, lz + 0.035, '#f2c230');
      this.ctx.fillStyle = `rgba(242,194,48,${0.12 + 0.04 * Math.sin(this.t * 2 + d.x)})`; this.ctx.beginPath(); this.ctx.arc(this.sx(lx), this.sy(lz), this.S * 0.16, 0, Math.PI * 2); this.ctx.fill();
    }
    // chủ chỗ / mã bàn
    // chỗ của mình luôn ghi rõ; tên chủ các chỗ khác chỉ hiện khi bật "Hiện chủ chỗ"
    // đang chọn chỗ: bàn đang chọn viền cam
    if (session?.selecting && session.selected === d.id) { const p = this.P / this.S * 3; this.ctx.strokeStyle = '#ff8a5b'; this.ctx.lineWidth = this.P * 1.2; this.ctx.strokeRect(this.sx(d.x - W / 2 - p), this.sy(d.z - D / 2 - p), (W + 2 * p) * this.S, (D + 2 * p) * this.S); }
    // nhãn dính trên mặt bàn (chỗ của mình luôn hiện; chỗ khác khi bật "Hiện chủ chỗ" hoặc đang chọn chỗ)
    if (mine) this.tag('Của bạn', d.x, d.z, '#05a57c', Math.max(W, D) * 0.95);
    else if (session?.showOwners || session?.selecting) this.tag(s?.locked ? 'khóa' : s?.owner ? s.owner.display.replace(/^\d+-/, '') : d.id, d.x, d.z, s?.locked ? '#b3261e' : s?.owner ? '#2b2d42' : '#2d7a4a', Math.max(W, D) * 0.95); // nhãn nhỏ: tên chủ chỗ (bỏ mã) / mã bàn trống
  }

  /** Mọi người trên tầng: người chơi, người khác đang online, nhân viên mô phỏng — vẽ theo thứ tự trên xuống dưới. */
  drawPeople(f) {
    const app = this.app, s = app.session, list = [];
    if (s?.player) list.push(s.player.agent);
    for (const a of s?.remote.list || []) if (a !== s.player?.agent) list.push(a);
    for (const a of app.sim?.agents || []) list.push(a);
    const inMap = a => ['my-office', 'sysone-mo'].includes(this.app.model.layout.world) ? true : f > 0 ? insideBuilding(a) : a.x > WORLD.x0 && a.x < WORLD.x1 && a.z > WORLD.z0 && a.z < WORLD.z1;
    const people = list.filter(a => a && a.visible !== false && (a.f || 0) === f && inMap(a)).sort((a, b) => a.z - b.z);
    if (f === 0 && this.app.model.layout.world !== 'my-office') this.drawVehicles(); // (my-office: xe của thành phố 3D, không vẽ ở 2D)
    for (const a of people) this.person(a);
  }

  specOf(a) {
    const look = a.emp?.look, id = look?.pixel;
    // nhân vật my-office (cùng bộ với 3D): người dùng theo lựa chọn 2D; nhân viên mô phỏng như ở 3D
    if (id && id.startsWith('mo-') && characterDef(id)) return custom(moBase(characterDef(id)), look);
    if (!a.key) { const def = characterDef('mo-nam'); if (def) return (a._moSpec ??= { mo: true, def, cfg: staffConfig(a, def), key: 'staff:' + (a.id ?? a.idx) }); }
    if (a.key && characterDef('mo-nam')) return custom(moBase(characterDef('mo-nam')), look);
    if (id && this.specs.has(id)) return custom(this.specs.get(id), look); // kèm tuỳ chỉnh màu/kiểu áo của người dùng
    if (!this.list) return null;
    if (a.key) return custom(this.defaultSpec, look);
    const h = [...String(a.id ?? a.idx ?? 0)].reduce((n, c) => n * 31 + c.charCodeAt(0), 7);
    return this.list[Math.abs(h) % this.list.length];
  }

  person(a) {
    const spec = this.specOf(a); if (!spec) return;
    const dirx = -Math.sin(a.yaw || 0), dirz = -Math.cos(a.yaw || 0);
    const facing = Math.abs(dirx) > Math.abs(dirz) ? (dirx > 0 ? 'right' : 'left') : (dirz > 0 ? 'down' : 'up');
    const walking = (a.walkAmt || 0) > 0.25 && !(a.sit > 0.5);
    const frame = walking ? 1 + (Math.floor((a.walkPhase || this.t * 6) / Math.PI) % 2) : 0;
    const X = this.sx(a.x), Y = this.sy(a.z) - Math.round((a.jumpH || 0) * this.S);
    drawCharacter(this.ctx, spec, X, Y, this.P, facing, frame);
    // tên và động tác trên đầu
    const name = a.local ? (a.display || 'Bạn') : (a.display || a.emp?.display || a.emp?.name || '');
    const top = Y - (spec.mo ? 27 : 23) * this.P;
    if (name) {
      const ctx = this.ctx, fs = Math.max(10, Math.round(this.P * 3)); ctx.font = `800 ${fs}px ui-rounded, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const w = ctx.measureText(name).width + fs * 0.9;
      ctx.fillStyle = a.local ? 'rgba(6,214,160,.92)' : 'rgba(43,45,66,.78)'; ctx.beginPath(); ctx.roundRect(X - w / 2, top - fs * 0.7, w, fs * 1.4, fs * 0.6); ctx.fill();
      ctx.fillStyle = '#fffaf3'; ctx.fillText(name, X, top + 1);
    }
    const icon = ACT_ICON[a.act];
    if (icon) { // bong bóng nhỏ có biểu tượng nét, ngay trên tên
      const r = this.P * 4.2, by = top - 7 * this.P + Math.sin(this.t * 6) * this.P * 0.6, ctx = this.ctx;
      ctx.fillStyle = '#fffaf3'; ctx.strokeStyle = 'rgba(43,45,66,.85)'; ctx.lineWidth = Math.max(1, this.P * 0.4);
      ctx.beginPath(); ctx.arc(X, by, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      drawIcon(ctx, icon, X, by, r * 1.25, '#2b2d42', Math.max(1.2, this.P * 0.45));
    }
  }

  deskAtWorld(w) {
    const m = this.app.model, fs = m.fs || 1;
    for (const d of m.desks) {
      if (d.floor !== this.floor) continue;
      const side = (d.facing || 0) % 180 !== 0, W = (side ? d.d || 0.6 : d.w || 1) * fs, D = (side ? d.w || 1 : d.d || 0.6) * fs;
      if (Math.abs(w.x - d.x) < W / 2 + 0.06 && Math.abs(w.z - d.z) < D / 2 + 0.06) return d;
    }
    return null;
  }

  onClick(e) {
    const w = this.toWorld(e), s = this.app.session, d = this.deskAtWorld(w);
    if (d) { s.onDeskClick(d); return; }
    if (s?.player && s.player.walkTo(w.x, w.z, this.floor)) this.app.onWalkTarget2D?.(w);
  }
}
