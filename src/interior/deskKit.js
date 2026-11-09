// Dựng một bàn làm việc theo cấu hình dụng cụ (equipment.json): số màn hình, PC/laptop, bàn phím, chuột,
// tai nghe, đèn bàn, điện thoại, bảng tên, chậu cây, màu bàn. Hệ cục bộ: người ngồi nhìn về -z.
import { plant } from './plants.js';
import * as THREE from 'three';
import { rbox, cyl, put, moMat, METAL } from '../scene/moBlocks.js';
import { deg2yaw } from '../core/util.js';

export const BASIC_EQUIPMENT = { monitors: 1, computer: 'pc', keyboard: true, mouse: true, headset: false, lamp: false, phone: false, nameplate: false, plant: false, deskColor: '#f4f0e8' };

/** Atlas chữ cho bảng tên: một texture cho mọi bàn -> gộp được thành 1 draw call. */
export class NameplateAtlas {
  constructor(cols = 4, rows = 16) {
    this.cols = cols; this.rows = rows; this.cw = 256; this.ch = 64;
    this.canvas = document.createElement('canvas'); this.canvas.width = cols * this.cw; this.canvas.height = rows * this.ch;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.tex });
    this.reset();
  }
  reset() { this.n = 0; this.g.fillStyle = '#fff'; this.g.fillRect(0, 0, this.canvas.width, this.canvas.height); }
  /** Vẽ chữ vào ô mới, trả về [u0, v0, u1, v1]. */
  add(text) {
    const i = this.n++ % (this.cols * this.rows), cx = (i % this.cols) * this.cw, cy = Math.floor(i / this.cols) * this.ch, g = this.g;
    g.fillStyle = '#1b2a8c'; g.fillRect(cx, cy, this.cw, this.ch);
    g.fillStyle = '#f3a21f'; g.fillRect(cx, cy + this.ch - 8, this.cw, 8);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let sz = 34; do { g.font = `bold ${sz}px system-ui, Arial, sans-serif`; sz -= 2; } while (g.measureText(text).width > this.cw - 16 && sz > 12);
    g.fillText(text, cx + this.cw / 2, cy + this.ch / 2 - 3);
    const W = this.canvas.width, H = this.canvas.height;
    return [cx / W, 1 - (cy + this.ch) / H, (cx + this.cw) / W, 1 - cy / H];
  }
  commit() { this.tex.needsUpdate = true; }
}

export function buildDesk(ctx, d, yb, eq, { nameplate, atlas, screensOut, fs = 1, surfaceOnly = false, depth, zOffset = 0 }) {
  const { mc } = ctx;
  const e = { ...BASIC_EQUIPMENT, ...(eq || {}) };
  // surfaceOnly: chỉ đặt dụng cụ lên một mặt làm việc có sẵn (vd. quầy lễ tân), không dựng mặt bàn/chân
  const root = new THREE.Group(); root.position.set(d.x, yb, d.z); root.rotation.y = deg2yaw(d.facing || 0); root.scale.setScalar(fs);
  const g = new THREE.Group(); g.position.z = zOffset; root.add(g);
  // khối bo góc kiểu my-office (theo hai góc đối diện)
  const box = (x0, x1, y0, y1, z0, z1, m, parent = g, r = 0.012) => put(parent, rbox(x1 - x0, y1 - y0, z1 - z0, m, r), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const w = surfaceOnly ? Math.min(d.w || 1.0, 1.2) : (d.w || 1.0), dd = depth ?? (d.d || 0.6), top = 0.76;
  const dk = METAL(), blk = moMat('#2B2F36', { roughness: 0.5 }), mon = moMat('#1B1F26', { roughness: 0.4 }), grey = moMat('#C9CED6', { metalness: 0.5, roughness: 0.35 });
  const deskM = moMat('#' + new THREE.Color(e.deskColor || '#f4f0e8').getHexString(), { roughness: 0.45 });
  // mặt bàn bo góc, khung kim loại hai bên (2 chân + thanh đế), tấm chắn kim loại phía màn hình (kiểu my-office)
  if (!surfaceOnly) {
    box(-w / 2, w / 2, 0.72, top, -dd / 2, dd / 2, deskM, g, 0.02);
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 - 0.06);
      box(x - 0.025, x + 0.025, 0, 0.72, dd / 2 - 0.1, dd / 2 - 0.05, dk); box(x - 0.025, x + 0.025, 0, 0.72, -dd / 2 + 0.05, -dd / 2 + 0.1, dk);
      box(x - 0.025, x + 0.025, 0, 0.05, -dd / 2 + 0.05, dd / 2 - 0.05, dk);
    }
    box(-w / 2 + 0.1, w / 2 - 0.1, 0.42, 0.7, -dd / 2 + 0.06, -dd / 2 + 0.085, dk);
    box(-0.25, 0.4, top, top + 0.006, -0.02, dd / 2 - 0.04, moMat('#2C323C', { roughness: 0.8 }), g, 0.003); // tấm lót chuột/bàn phím
    put(g, cyl(0.035, 0.03, 0.08, moMat('#FFFFFF', { roughness: 0.35 }), 14), w / 2 - 0.14, top + 0.04, dd / 2 - 0.16); // cốc
  } else box(-w / 2, w / 2, 0.755, 0.762, -dd / 2, dd / 2, deskM); // tấm lót mặt quầy theo màu chọn

  // màn hình (1-3), xếp hình vòng cung
  const n = Math.max(0, Math.min(3, e.monitors | 0));
  const gap = 0.03, laptop = e.computer === 'laptop';
  const mw = Math.min(0.54, (w - 0.04 - gap * Math.max(0, n - 1)) / Math.max(1, n)); // không tràn khỏi mặt bàn
  const screens = [];
  const xs = n === 1 ? [laptop ? 0.1 : 0] : n === 2 ? [-(mw / 2 + gap / 2), mw / 2 + gap / 2] : [-(mw + gap), 0, mw + gap];
  xs.forEach((x, i) => {
    const ang = n === 3 ? [0.32, 0, -0.32][i] : n === 2 ? [0.12, -0.12][i] : 0;
    const zBase = -dd / 2 + 0.12 + (n === 3 && i !== 1 ? 0.04 : 0);
    const m = new THREE.Group(); m.position.set(x, top, zBase); m.rotation.y = ang; g.add(m);
    box(-0.1, 0.1, 0, 0.02, -0.07, 0.07, dk, m, 0.008); box(-0.02, 0.02, 0.02, 0.2, -0.03, 0.0, dk, m, 0.008);
    const mh = Math.min(0.32, mw * 0.62 + 0.04);
    box(-mw / 2, mw / 2, 0.18, 0.18 + mh, -0.012, 0.02, mon, m, 0.012);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(mw - 0.04, mh - 0.04), ctx.M.screenOff); s.position.y = 0.18 + mh / 2; s.position.set(0, s.position.y, 0.022); m.add(s); screens.push(s);
  });
  // máy tính
  if (laptop) {
    const lx = n === 0 ? 0 : (n === 1 ? -0.3 : -w / 2 + 0.2), lz = n === 0 ? 0.0 : dd / 2 - 0.3;
    const L = new THREE.Group(); L.position.set(lx, top, lz); L.rotation.y = n === 0 ? 0 : 0.25; g.add(L);
    box(-0.16, 0.16, 0, 0.018, -0.11, 0.11, grey, L);
    const lid = new THREE.Group(); lid.position.set(0, 0.018, -0.11); lid.rotation.x = -0.25; L.add(lid);
    box(-0.16, 0.16, 0, 0.21, -0.008, 0, grey, lid);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.18), ctx.M.screenOff); s.position.set(0, 0.105, 0.002); lid.add(s); screens.push(s);
  } else if (e.computer === 'pc' && !surfaceOnly) {
    box(w / 2 - 0.3, w / 2 - 0.12, 0, 0.42, -0.2, 0.2, moMat('#D8D3CA', { roughness: 0.6 }), g, 0.02); // thùng máy dưới gầm bàn (màu hộc tủ của my-office)
    box(w / 2 - 0.27, w / 2 - 0.15, 0.34, 0.36, 0.2, 0.206, moMat('#5F8FD8', { roughness: 0.4 }), g, 0.004);
  }
  if (e.keyboard) box(-0.21, 0.21, top + 0.006, top + 0.024, dd / 2 - 0.2, dd / 2 - 0.06, moMat('#E9EBEF', { roughness: 0.5 }), g, 0.008);
  if (e.mouse) put(g, rbox(0.055, 0.025, 0.09, moMat('#E9EBEF', { roughness: 0.5 }), 0.012), 0.31, top + 0.018, dd / 2 - 0.13);
  if (e.headset) {
    const h = new THREE.Group(); h.position.set(w / 2 - 0.12, top, -dd / 2 + 0.22); g.add(h);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 14, Math.PI), blk); band.position.y = 0.06; band.rotation.y = Math.PI / 2; h.add(band);
    box(-0.02, 0.02, 0.0, 0.07, -0.09, -0.05, mc(0x3a3d44), h); box(-0.02, 0.02, 0.0, 0.07, 0.05, 0.09, mc(0x3a3d44), h);
  }
  if (e.lamp) {
    const lx = -w / 2 + 0.1, lz = -dd / 2 + 0.1;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.02, 12), mc(0x30343a)); base.position.set(lx, top + 0.01, lz); g.add(base);
    box(lx - 0.012, lx + 0.012, top + 0.02, top + 0.38, lz - 0.012, lz + 0.012, mc(0x30343a));
    const arm = box(lx - 0.012, lx + 0.012, top + 0.36, top + 0.39, lz, lz + 0.22, mc(0x30343a)); void arm;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.08, 12, 1, true), mc(0xe8b62a)); head.position.set(lx, top + 0.34, lz + 0.22); g.add(head);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), ctx.M.lampPanel); bulb.position.set(lx, top + 0.31, lz + 0.22); g.add(bulb);
  }
  if (e.phone) {
    const px = -w / 2 + 0.16, pz = dd / 2 - 0.16;
    box(px - 0.09, px + 0.09, top, top + 0.05, pz - 0.1, pz + 0.1, mc(0x2b2e33));
    box(px - 0.1, px - 0.05, top + 0.05, top + 0.08, pz - 0.1, pz + 0.1, mc(0x1b1d21));
  }
  if (e.plant) {
    const px = w / 2 - 0.1, pz = -dd / 2 + 0.1;
    const p = plant('sansevieria', 0.26, px * 5); p.position.set(px, top, pz); g.add(p); // chậu lưỡi hổ mini trên bàn
  }
  if (e.nameplate && nameplate && atlas) {
    // bảng tên dựng đứng ở góc trước bên trái, quay ra phía sau lưng người ngồi (người đi ngang thấy)
    const [u0, v0, u1, v1] = atlas.add(nameplate);
    const px = -w / 2 + 0.16, pz = dd / 2 - 0.04;
    box(px - 0.11, px + 0.11, top, top + 0.012, pz - 0.03, pz + 0.01, mc(0xdcdfe3));
    const geo = new THREE.PlaneGeometry(0.2, 0.05); const uv = geo.attributes.uv;
    uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
    const plate = new THREE.Mesh(geo, atlas.material); plate.position.set(px, top + 0.04, pz + 0.002); g.add(plate);
    const back = new THREE.Mesh(geo, atlas.material); back.position.set(px, top + 0.04, pz - 0.022); back.rotation.y = Math.PI; g.add(back);
  }
  screens.forEach(s => { s.userData.screen = true; });
  if (screensOut) screensOut.push(...screens);
  return root;
}
