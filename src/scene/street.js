// Nhà hai bên, vỉa hè, lòng đường, cây, đèn đường, quán ăn, xe chạy.
import * as THREE from 'three';
import { stepTraffic, ROAD as ROAD_Z } from './traffic.js';
import { motorbike, TRAFFIC, PARKED } from './vehicles.js';

export let XL = -14.6, XR = 15.1;
/** Toà nhà lớn: kéo dài con đường hai phía (gọi trước khi dựng phố). */
export function setStreetSpan(l, r) { XL = l; XR = r; }
/** Dời các dãy nhà hàng xóm (và khối va chạm của chúng) ra hai bên: bên trái thêm dl, bên phải thêm dr (mét). */
export function spreadNeighbors(ctx, colFrom, dl, dr) {
  const b = new THREE.Box3(), c = new THREE.Vector3();
  for (const o of ctx.nb.children) { b.setFromObject(o); if (b.isEmpty()) continue; b.getCenter(c); o.position.x += c.x < 0.2 ? dl : dr; }
  for (let i = colFrom; i < ctx.COL.length; i++) { const k = ctx.COL[i], d = (k.x0 + k.x1) / 2 < 0.2 ? dl : dr; k.x0 += d; k.x1 += d; }
}

// câu tài xế buông ra khi có người đứng chặn đường
export const INSULTS = [
  'Đi đứng kiểu gì vậy hả?!', 'Muốn chết hả?! Tránh ra!', 'Nhìn đường dùm cái coi!', 'Đứng giữa đường làm gì vậy cha?!',
  'Bấm còi nãy giờ không nghe hả?!', 'Trời ơi, lên lề mà đi!', 'Có biết luật giao thông không vậy?!', 'Né ra coi, trễ giờ rồi nè!',
  'Đường của nhà bạn hả?!', 'Đi bộ mà như đi dạo công viên!'
];

export function buildNeighbors(ctx) {
  const { B, mc: L, LD, M, nb, COL, T, tmat, sgn } = ctx;
  const ZF = 9.0;
  const nbBox = (x0, x1, z0, z1, H) => COL.push({ x0, x1, y0: 0, y1: H, z0, z1 });
  function block(x0, x1, H, col, zf) { B(x0, x1, 0, H, -10, zf, L(col), nb); nbBox(x0, x1, -10, zf, H); [2.7, 5.4, 8.1].forEach(y => { if (y < H - 0.5) B(x0, x1, y - 0.1, y + 0.05, -10, zf + 0.05, M.trim, nb); }); B(x0 - 0.05, x1 + 0.05, H, H + 0.25, -10, zf + 0.1, M.trim, nb); }
  function nbWin(xc, yc, w, h, z) { B(xc - w / 2 - 0.06, xc + w / 2 + 0.06, yc - h / 2 - 0.06, yc + h / 2 + 0.06, z, z + 0.06, M.trim, nb); B(xc - w / 2, xc + w / 2, yc - h / 2, yc + h / 2, z + 0.06, z + 0.09, M.glass, nb); B(xc - 0.02, xc + 0.02, yc - h / 2, yc + h / 2, z + 0.09, z + 0.12, M.trim, nb); }
  function curveBal(xc, y, zf, r, col) {
    const sl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.18, 24, 1, false, 0, Math.PI), L(col)); sl.rotation.y = -Math.PI / 2; sl.position.set(xc, y - 0.09, zf); nb.add(sl);
    const pa = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.9, 24, 1, true, 0, Math.PI), LD(col)); pa.rotation.y = -Math.PI / 2; pa.position.set(xc, y + 0.45, zf); nb.add(pa);
  }
  function canopy(xc, w, y, zf, col, d) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), L(col)); m.position.set(xc, y, zf + d / 2); m.rotation.x = 0.14; nb.add(m); }
  function balc(x0, x1, y, zf) { B(x0, x1, y - 0.15, y, zf, zf + 0.8, M.white, nb); ctx.railX(x0, x1, y, zf + 0.78, nb); }
  function pediment(xc, y0, w, h, z, col) { const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(0, h); sh.closePath(); const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false }), L(col)); m.position.set(xc, y0, z); nb.add(m); const k = 0.55, s2 = new THREE.Shape(); s2.moveTo(-w / 2 * k, 0.15); s2.lineTo(w / 2 * k, 0.15); s2.lineTo(0, h * k + 0.05); s2.closePath(); const m2 = new THREE.Mesh(new THREE.ShapeGeometry(s2), LD(0xf0f0ee)); m2.position.set(xc, y0, z + 0.32); nb.add(m2); }
  function signBoard(tex, xc, yc, w, h, z, g) { B(xc - w / 2, xc + w / 2, yc - h / 2, yc + h / 2, z, z + 0.1, M.base, g); const p = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.04, h - 0.04), new THREE.MeshBasicMaterial({ map: tex })); p.position.set(xc, yc, z + 0.105); g.add(p); return p; }
  ctx.signBoard = signBoard;

  function mkText(w, h, bg, lines, extra) { return sgn(w, h, g => { g.fillStyle = bg; g.fillRect(0, 0, w, h); if (extra) extra(g, w, h); lines.forEach(l => { const fam = 'Arial, Helvetica, sans-serif'; g.fillStyle = l.c; g.textAlign = 'center'; g.textBaseline = 'middle'; let sz = l.s; do { g.font = 'bold ' + sz + 'px ' + fam; sz -= 2; } while (g.measureText(l.t).width > l.w && sz > 10); g.fillText(l.t, l.x || w / 2, l.y); }); }); }
  const texHT = mkText(512, 276, '#f4f4f0', [{ t: 'ĐÈN LED', y: 58, s: 56, c: '#4a4f57', w: 400 }, { t: 'HỢP THÀNH', y: 182, s: 84, c: '#ffffff', w: 450 }, { t: 'THIẾT BỊ ĐIỆN - NƯỚC - ĐÈN LED', y: 244, s: 24, c: '#ffffff', w: 470 }], (g, w, h) => { g.fillStyle = '#2f8a3e'; g.fillRect(0, 120, w, h - 120); g.fillStyle = '#3a5fa8'; g.fillRect(0, 100, w, 8); g.fillStyle = '#d23a2e'; g.fillRect(0, 110, w, 8); });
  const texRed = mkText(512, 128, '#d23a2e', [{ t: 'ỐNG NHỰA - PHỤ KIỆN NƯỚC', y: 42, s: 44, c: '#ffffff', w: 470 }, { t: 'HỢP THÀNH', y: 106, s: 34, c: '#2f8a3e', w: 300 }], (g, w) => { g.fillStyle = '#f4f4f0'; g.fillRect(0, 80, w, 48); });
  const texStrip = mkText(512, 64, '#3f9b3a', [{ t: 'THIẾT BỊ ĐIỆN - NƯỚC - ĐÈN LED', y: 34, s: 32, c: '#f2d542', w: 480 }]);
  const texBun = sgn(760, 200, (g, w, h) => {
    g.fillStyle = '#f2c718'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8a6a00'; g.lineWidth = 6; g.strokeRect(4, 4, w - 8, h - 8);
    const fam = 'Arial, Helvetica, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = 'bold 40px ' + fam; const a = 'Quán ', wa = g.measureText(a).width; g.font = 'bold 78px ' + fam; const b = 'BÚN HUẾ', wb = g.measureText(b).width;
    const x = (w - wa - wb) / 2; g.font = 'bold 40px ' + fam; g.fillStyle = '#1a1a1a'; g.fillText(a, x, 66); g.font = 'bold 78px ' + fam; g.fillStyle = '#c4281c'; g.fillText(b, x + wa, 60);
    g.textAlign = 'center'; g.fillStyle = '#1a1a1a'; g.font = 'bold 32px ' + fam; g.fillText('CHẢ MỌC - BẮP BÒ - GIÒ HEO', w / 2, 120, 700); g.fillText('TÁI - GÂN - XÍ QUÁCH', w / 2, 162, 700);
  });
  ctx.texStand = sgn(256, 400, (g, w, h) => { g.fillStyle = '#f2c718'; g.fillRect(0, 0, w, h); g.fillStyle = '#c4281c'; g.fillRect(0, 0, w, 80); g.fillStyle = '#1a1a1a'; for (let i = 0; i < 4; i++) g.fillRect(24, 130 + i * 60, w - 48, 16); });

  block(-8.0, -3.5, 9.6, 0xeadfce, ZF);
  B(-8.0, -6.95, 0, 2.5, ZF, ZF + 0.05, M.void_, nb);
  B(-6.95, -6.3, 0, 2.9, ZF, ZF + 0.15, tmat(T.zig, 1, 5), nb);
  B(-6.3, -4.0, 0, 2.5, ZF, ZF + 0.06, tmat(T.shutter, 3, 1), nb);
  B(-3.95, -3.5, 0, 2.9, ZF, ZF + 0.15, tmat(T.zig, 1, 5), nb);
  canopy(-5.15, 3.6, 2.7, ZF, 0x8d9299, 1.2);
  signBoard(texStrip, -6.6, 2.95, 3.0, 0.4, ZF, nb);
  signBoard(texRed, -6.5, 3.75, 2.8, 0.78, ZF, nb);
  signBoard(texHT, -6.2, 5.25, 2.6, 1.4, ZF, nb);
  B(-4.85, -3.55, 3.0, 4.1, ZF, ZF + 0.08, L(0xd9a69b), nb);
  curveBal(-5.25, 6.4, ZF, 0.95, 0xe3b98e);
  nbWin(-5.25, 7.6, 1.6, 1.4, ZF); nbWin(-7.2, 7.6, 1.0, 1.4, ZF);
  pediment(-5.25, 8.2, 2.6, 1.6, ZF, 0x7d818a);

  block(-14.5, -8.0, 10.0, 0xe8dcc4, ZF);
  B(-14.0, -8.6, 0, 2.6, ZF, ZF + 0.05, M.void_, nb);
  [2.7, 5.4, 8.1].forEach(y => { nbWin(-12.8, y + 1.2, 1.4, 1.5, ZF); nbWin(-9.8, y + 1.2, 1.4, 1.5, ZF); });
  balc(-13.6, -9.0, 5.4, ZF); balc(-13.6, -9.0, 8.1, ZF);
  const rf = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 2.4), tmat(T.roofRed, 3, 2)); rf.position.set(-9.8, 10.4, ZF - 1.0); rf.rotation.x = 0.35; nb.add(rf);

  B(3.45, 7.4, 0, 2.6, ZF, ZF + 0.25, M.wcream, nb); COL.push({ x0: 3.45, x1: 7.4, y0: 0, y1: 2.6, z0: ZF, z1: ZF + 0.25 }); B(3.45, 7.4, 0, 0.3, ZF, ZF + 0.28, L(0xd2c397), nb); B(3.4, 7.45, 2.6, 2.7, ZF - 0.05, ZF + 0.3, L(0xdccd9a), nb);
  [[3.75, 4.75], [5.05, 6.05], [6.35, 7.35]].forEach((p, i) => { B(p[0], p[1], 0.45, 2.25, ZF + 0.25, ZF + 0.29, i === 1 ? tmat(T.lattice, 1.5, 2) : M.wpanel, nb); });
  B(3.5, 7.4, 0, 0.07, 1.0, ZF, L(0x6f9450), nb);
  block(3.5, 8.2, 8.4, 0xefe7d6, 1.0);
  [2.7, 5.4].forEach(y => { nbWin(4.6, y + 1.3, 1.0, 1.3, 1.0); nbWin(7.0, y + 1.3, 1.0, 1.3, 1.0); });
  balc(4.1, 7.5, 5.4, 1.0);
  block(3.5, 13.0, 12.0, 0xcddcea, -4.0);
  [2.7, 5.4, 8.1].forEach(y => { nbWin(5.5, y + 1.3, 1.1, 1.4, -4.0); nbWin(9.0, y + 1.3, 1.1, 1.4, -4.0); nbWin(12.0, y + 1.3, 1.1, 1.4, -4.0); });

  const leafCache = {}, leafMat = c => leafCache[c] || (leafCache[c] = new THREE.MeshLambertMaterial({ color: c, flatShading: true }));
  ctx.leafMat = leafMat;
  function palm(x, z, h, fl, g) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, h, 8), M.trunk); t.position.set(x, h / 2, z); g.add(t);
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * Math.PI * 2, gr = new THREE.Group(); gr.position.set(x, h, z); gr.rotation.y = -a; g.add(gr);
      const l1 = fl * 0.5, l2 = fl * 0.55, c = leafMat(i % 2 ? 0x3f7a35 : 0x4a8a3c);
      const s1 = new THREE.Mesh(new THREE.BoxGeometry(l1, 0.04, 0.3), c); s1.position.set(l1 * 0.45, l1 * 0.2, 0); s1.rotation.z = 0.45; gr.add(s1);
      const s2 = new THREE.Mesh(new THREE.BoxGeometry(l2, 0.04, 0.26), c); s2.position.set(0.9 * l1 + 0.44 * l2, 0.435 * l1 - 0.24 * l2, 0); s2.rotation.z = -0.5; gr.add(s2);
    }
  }
  function banana(x, z, g) { for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + 0.3; const f = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.03, 0.6), leafMat(i % 2 ? 0x5e9a3a : 0x6aa844)); f.position.set(x + Math.cos(a) * 0.6, 2.1, z + Math.sin(a) * 0.6); f.rotation.y = -a; f.rotation.z = 0.7; g.add(f); } const s = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 2.1, 6), L(0x6c8f4a)); s.position.set(x, 1.05, z); g.add(s); }
  function bush(x, z, r, c, g) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMat(c)); m.scale.y = 0.85; m.position.set(x, r * 0.95, z); g.add(m); }
  palm(4.2, 6.0, 6.0, 2.8, nb); palm(5.8, 7.6, 3.8, 2.0, nb); palm(5.0, 4.2, 4.4, 2.3, nb);
  banana(3.9, 7.7, nb); banana(6.4, 7.9, nb); banana(5.0, 6.6, nb);
  bush(4.5, 8.3, 0.9, 0x4a7d38, nb); bush(5.8, 8.4, 1.0, 0x58893f, nb); bush(7.0, 8.3, 0.9, 0x3f7030, nb); bush(6.6, 5.2, 1.0, 0x55853d, nb); bush(4.2, 3.0, 0.9, 0x4a7d38, nb); bush(6.8, 3.2, 1.1, 0x58893f, nb); bush(3.9, 5.2, 0.7, 0x62934a, nb);

  B(7.4, 15.0, 0, 9.4, -10, ZF, L(0xefe3cf), nb); nbBox(7.4, 15.0, -10, ZF, 9.4);
  B(7.35, 15.05, 3.3, 3.45, -10, ZF + 0.05, M.trim, nb); B(7.35, 15.05, 6.1, 6.25, -10, ZF + 0.05, M.trim, nb); B(7.35, 15.05, 9.4, 9.65, -10, ZF + 0.1, L(0xc98a63), nb);
  B(7.9, 14.5, 0, 3.3, ZF, ZF + 0.05, M.void_, nb);
  signBoard(texBun, 9.2, 4.05, 4.2, 1.1, ZF, nb);
  const qaw = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.05, 2.3), tmat(T.awnG, 7.4 / 1.6, 1)); qaw.position.set(11.2, 2.75, ZF + 1.15); qaw.rotation.x = 0.51; nb.add(qaw);
  nbWin(8.6, 5.4, 1.2, 1.4, ZF); nbWin(11.0, 5.4, 1.8, 1.4, ZF); nbWin(13.8, 5.4, 1.2, 1.4, ZF);
  balc(8.2, 14.4, 6.1, ZF);
  B(9.6, 10.5, 6.4, 6.9, ZF + 0.3, ZF + 0.6, M.white, nb); B(12.6, 13.5, 6.4, 6.9, ZF + 0.3, ZF + 0.6, M.white, nb);
  nbWin(8.8, 7.7, 1.2, 1.4, ZF); nbWin(11.0, 7.7, 1.8, 1.4, ZF); nbWin(13.6, 7.7, 1.2, 1.4, ZF);
}

// vân nhựa đường và ô lát vỉa hè (vẽ một lần, dùng lại)
let _tex = null;
function roadTextures() {
  if (_tex) return _tex;
  let seed = 20261026; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const cv = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  const asphalt = cv(256, 256, g => {   // (như my-office: hạt mịn, vài mảng vá và vết nứt)
    g.fillStyle = '#E4E4E4'; g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 9000; k++) { const v = 180 + Math.floor(r() * 75); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 1.5, 1 + r() * 1.5); }
    for (let k = 0; k < 5; k++) { g.fillStyle = 'rgba(0,0,0,.07)'; g.beginPath(); g.ellipse(r() * 256, r() * 256, 18 + r() * 40, 10 + r() * 25, r() * 3, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1;
    for (let k = 0; k < 4; k++) { let x = r() * 256, y = r() * 256; g.beginPath(); g.moveTo(x, y); for (let n = 0; n < 6; n++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
  });
  const slab = cv(128, 128, (g, w, h) => {   // bê tông xám nhạt, ô 1,2 m, mạch tối
    g.fillStyle = '#B7BCC2'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 1400; k++) { const v = 170 + Math.floor(r() * 40); g.fillStyle = `rgba(${v},${v + 3},${v + 7},.5)`; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
    g.fillStyle = '#8D939B'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h);
  });
  return (_tex = { asphalt, slab });
}

export function buildStreet(ctx, clipPlanes) {
  const { B, mc: L, M, st, COL, T, tmat, walk, rng } = ctx;
  // chất liệu đường phố theo thành phố my-office (src/vendor/my-office world/backdrops/city.js): nhựa đường xám có vân,
  // vỉa hè bê tông xám lát ô, vạch kẻ nhạt, vạch qua đường xám bạc; bố cục con đường SYSONE giữ nguyên
  const pav = new THREE.MeshLambertMaterial({ color: 0xffffff, map: roadTextures().slab });
  pav.map.repeat.set((XR - XL) / 1.2, 3.25 / 1.2);
  const pav2 = pav.clone(); pav2.map = pav.map.clone(); pav2.map.repeat.set((XR - XL) / 1.2, 3.3 / 1.2); pav2.map.needsUpdate = true;
  const asphalt = new THREE.MeshLambertMaterial({ color: 0x5b616a, map: roadTextures().asphalt });
  asphalt.map.repeat.set((XR - XL) / 5, 14 / 5);
  const curb = L(0xb9bdc2), dash = L(0x8a9098), line = L(0xc9cdd2), zebra = L(0xd4d7db);
  B(XL, XR, 0, 0.1, 9.0, 9.25, curb, st); walk(XL, XR, 9.0, 9.25, 0.1);
  B(XL, XR, 0, 0.15, 9.25, 12.5, pav, st); walk(XL, XR, 9.25, 12.5, 0.15);
  B(XL, XR, 0, 0.18, 12.5, 12.7, curb, st); walk(XL, XR, 12.5, 12.7, 0.18);
  B(XL, XR, 0, 0.18, 26.7, 26.9, curb, st);
  B(XL, XR, 0, 0.15, 26.9, 30, pav2, st); walk(XL, XR, 26.7, 30, 0.15);
  B(XL, XR, -0.02, 0.01, 12.7, 26.7, asphalt, st); walk(XL, XR, 12.7, 26.7, 0.01);
  B(XL, XR, 0.01, 0.02, 14.4, 14.5, line, st); B(XL, XR, 0.01, 0.02, 25.9, 26.0, line, st);      // mép làn xe máy
  for (let dx = -14; dx <= 14; dx += 3) B(dx, dx + 1.4, 0.01, 0.02, 19.64, 19.76, dash, st);   // vạch giữa đường: đứt đoạn 1,4 m mỗi 3 m
  // vạch qua đường trước cổng (vằn ngựa, như ngã tư my-office) và vạch dừng hai bên
  for (let z = 12.95; z < 26.5; z += 0.55) B(0.35, 2.75, 0.012, 0.022, z, z + 0.32, zebra, st);
  B(-1.6, -1.4, 0.012, 0.022, 14.6, 19.6, line, st); B(4.5, 4.7, 0.012, 0.022, 19.8, 25.8, line, st);

  function tree(x, z, o) {
    const r = rng(o.seed), g = st;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(o.tr * 0.7, o.tr, o.h, 8), M.trunk); trunk.position.set(x, o.h / 2, z); g.add(trunk);
    COL.push({ x0: x - o.tr, x1: x + o.tr, y0: 0, y1: o.h, z0: z - o.tr, z1: z + o.tr });
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + r() * 0.7, len = o.R * 0.85, gr = new THREE.Group(); gr.position.set(x, o.h * 0.82, z); gr.rotation.y = -a; g.add(gr); const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, len, 6), M.trunk); br.geometry.translate(0, len / 2, 0); br.rotation.z = -(0.9 + r() * 0.3); gr.add(br); }
    const cols = [0x4f7d3a, 0x5b8a42, 0x46722f, 0x62934a, 0x3f6a2b, 0x6a9a50];
    for (let j = 0; j < o.n; j++) {
      const ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * o.R, v = r() * 2 - 1, k = rad / o.R, s = o.R * (0.26 + r() * 0.16);
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), ctx.leafMat(cols[j % 6]));
      m.scale.set(1, 0.78, 1);
      m.position.set(x + Math.cos(ang) * rad, o.cy + (1 - k * k) * o.R * 0.42 + v * o.R * 0.16, z + Math.sin(ang) * rad);
      m.rotation.set(r() * 3, r() * 3, r() * 3); g.add(m);
    }
  }
  tree(-3.3, 11.0, { h: 4.6, tr: 0.17, R: 2.8, cy: 7.0, n: 20, seed: 5 });
  tree(7.3, 11.2, { h: 5.0, tr: 0.2, R: 4.2, cy: 7.8, n: 28, seed: 9 });
  tree(-12.6, 11.3, { h: 3.6, tr: 0.13, R: 2.0, cy: 5.6, n: 12, seed: 2 });
  function lamp(x, z) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 7.5, 8), M.iron); p.position.set(x, 3.75, z); st.add(p); B(x - 0.05, x + 0.05, 7.4, 7.5, z, z + 2.8, M.iron, st); B(x - 0.3, x + 0.3, 7.3, 7.4, z + 2.6, z + 3.0, M.lampHead, st); COL.push({ x0: x - 0.1, x1: x + 0.1, y0: 0, y1: 7.5, z0: z - 0.1, z1: z + 0.1 }); }
  lamp(-9.0, 11.8); lamp(12.8, 11.8);
  function umb(x, z, c) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), M.iron); p.position.set(x, 1.25, z); st.add(p); const u = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.5, 12), L(c)); u.position.set(x, 2.5, z); st.add(u); }
  umb(-12.4, 10.7, 0x5a9a3f);
  function ped(x, z, c) { const g = new THREE.Group(); B(-0.17, 0.17, 0.45, 1.3, -0.12, 0.12, L(c), g); B(-0.14, -0.02, 0, 0.5, -0.08, 0.08, M.iron, g); B(0.02, 0.14, 0, 0.5, -0.08, 0.08, M.iron, g); const h = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), L(0xd9b08c)); h.position.y = 1.45; g.add(h); g.position.set(x, 0.15, z); st.add(g); }
  ped(-10.9, 10.3, 0x4a5d7a);
  function sitter(x, z, c) { const g = new THREE.Group(); B(-0.17, 0.17, 0.5, 1.15, -0.12, 0.12, L(c), g); B(-0.15, 0.15, 0.4, 0.55, -0.12, 0.45, M.iron, g); const h = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), L(0xd9b08c)); h.position.y = 1.3; g.add(h); g.position.set(x, 0.15, z); st.add(g); }
  const stool = (x, z) => { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.3, 10), L(0xd33a2c)); s.position.set(x, 0.3, z); st.add(s); };
  [[9.6, 10.7], [10.3, 11.1], [11.0, 10.6], [11.7, 11.1], [12.4, 10.7], [13.1, 11.0]].forEach(p => stool(p[0], p[1]));
  B(10.2, 10.9, 0.15, 0.62, 10.0, 10.5, L(0x8a8f96), st); B(12.0, 12.7, 0.15, 0.62, 10.0, 10.5, L(0x8a8f96), st);
  sitter(11.0, 10.45, 0x6b4aa5);
  B(7.95, 8.0, 0.15, 1.6, 10.5, 10.55, M.iron, st); ctx.signBoard(ctx.texStand, 8.0, 1.0, 0.6, 0.9, 10.55, st);

  // xe đỗ trên vỉa hè và xe chạy: mẫu xe thật ở Việt Nam (vehicles.js)
  for (const p of PARKED) { const b = motorbike(p.kind, { rider: false }); b.position.set(p.x, 0.15, p.z); b.rotation.y = p.ry; st.add(b); }

  const vm = new THREE.Group(); vm.userData.noMerge = true; st.add(vm);
  const movers = [];
  for (const t of TRAFFIC) {
    const o = t.make(), info = o.userData.vehicle, kind = info.len > 3 ? 'car' : 'bike';
    o.position.set(t.x, 0, t.lane); o.rotation.y = t.dir > 0 ? 0 : Math.PI; vm.add(o);
    movers.push({ o, v: t.v * t.dir, dir: t.dir, v0: t.v, speed: t.v, kind, model: info.kind, name: info.name, len: info.len + 0.1, h: info.h, blockT: 0, bubbleT: 0 });
  }
  // vật liệu riêng cho xe chạy để cắt ở mép mô hình mà không ảnh hưởng chỗ khác
  const clipped = new Map();
  vm.traverse(o => { if (o.isMesh) { let m = clipped.get(o.material); if (!m) { m = o.material.clone(); m.clippingPlanes = clipPlanes; clipped.set(o.material, m); } o.material = m; } });
  for (const m of movers) m.o.userData.noMerge = true;
  ctx.mergeLater = [...(ctx.mergeLater || []), ...movers.map(m => m.o)];
  // bong bóng lời tài xế
  const bubbles = new THREE.Group(); bubbles.name = 'driverBubbles'; bubbles.userData.keep = true; bubbles.userData.noMerge = true; st.add(bubbles);
  function bubble(text) {
    const c = document.createElement('canvas'), g = c.getContext('2d');
    g.font = 'bold 34px system-ui, sans-serif';
    const w = Math.min(900, Math.ceil(g.measureText(text).width) + 40); c.width = w; c.height = 84;
    g.fillStyle = '#fff'; g.strokeStyle = '#c2402f'; g.lineWidth = 6; g.beginPath(); g.roundRect(3, 3, w - 6, 62, 16); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(w / 2 - 14, 64); g.lineTo(w / 2, 82); g.lineTo(w / 2 + 14, 64); g.fill();
    g.font = 'bold 34px system-ui, sans-serif'; g.fillStyle = '#b3261e'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(text, w / 2, 35);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(0.75 * w / 84, 0.75, 1); s.renderOrder = 12;
    return s;
  }
  const ROAD = ROAD_Z;
  return {
    vm, movers, ROAD,
    /**
     * Xe chạy; gặp người trong làn phía trước thì phanh dừng, bấm còi, tài xế chửi.
     * chars: [{x, z, visible, local}], hooks.honk(mover, char), hooks.insult(text, mover, char).
     */
    update(dt, chars = [], hooks = {}, now = performance.now()) {
      if (!vm.visible || !st.visible) return;
      stepTraffic(movers, dt, chars, XL, XR);
      for (const m of movers) {
        const p = m.o.position, person = m.person;
        if (person && m.speed < 1.5) {
          m.blockT += dt;
          if (m.blockT > 0.3 && now - (m.lastHonk || -1e9) > 3500) {
            m.lastHonk = now;
            hooks.honk?.(m, person);
            const text = INSULTS[Math.floor(Math.random() * INSULTS.length)];
            if (m.bubble) bubbles.remove(m.bubble);
            m.bubble = bubble(text); bubbles.add(m.bubble); m.bubbleT = 2.8;
            hooks.insult?.(text, m, person);
          }
        } else m.blockT = 0;
        if (m.bubble) {
          m.bubble.position.set(p.x, m.h + 0.75, p.z);
          m.bubbleT -= dt;
          if (m.bubbleT <= 0) { bubbles.remove(m.bubble); m.bubble.material.map.dispose(); m.bubble = null; }
        }
      }
    }
  };
}
