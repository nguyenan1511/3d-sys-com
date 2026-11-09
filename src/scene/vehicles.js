// Xe cộ đường phố Việt Nam: xe máy (Honda Vision, Air Blade, Yamaha Exciter, VinFast Klara), xe Grab,
// ô tô (BMW, Mercedes, VinFast VF8, GrabCar). Hệ toạ độ xe: đầu xe hướng +x, mặt đất y = 0, bề ngang theo z.
import * as THREE from 'three';
import { kitCar } from './carKit.js';

const matCache = new Map();
const L = (c, extra = {}) => { const k = c + JSON.stringify(extra); if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color: c, ...extra })); return matCache.get(k); };
const P = (c, shin = 60) => { const k = 'p' + c + shin; if (!matCache.has(k)) matCache.set(k, new THREE.MeshPhongMaterial({ color: c, shininess: shin, specular: 0x666666 })); return matCache.get(k); };
const GLASS = () => P(0x1c2530, 90);
const BASIC = c => { const k = 'b' + c; if (!matCache.has(k)) matCache.set(k, new THREE.MeshBasicMaterial({ color: c })); return matCache.get(k); };

function box(g, x0, x1, y0, y1, z0, z1, m) { const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m); b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); g.add(b); return b; }
function cylZ(g, x, y, z, r, w, m, seg = 16) { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, seg), m); c.rotation.x = Math.PI / 2; c.position.set(x, y, z); g.add(c); return c; }
/** Đùn một dáng nhìn ngang (các điểm [x,y]) theo bề ngang w, bo cạnh. */
function profile(g, pts, w, m, bevel = 0.04) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) s.lineTo(p[0], p[1]); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: w - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  geo.translate(0, 0, -(w - 2 * bevel) / 2);
  const mesh = new THREE.Mesh(geo, m); g.add(mesh); return mesh;
}
function textTex(text, { w = 256, h = 64, bg = null, fg = '#fff', font = 'bold 40px Arial', italic = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.fillStyle = fg; x.font = (italic ? 'italic ' : '') + font; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const texCache = new Map();
function decal(g, text, x, y, z, w, h, opts = {}, rotY = 0) {
  const key = text + JSON.stringify(opts);
  if (!texCache.has(key)) texCache.set(key, new THREE.MeshBasicMaterial({ map: textTex(text, opts), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), texCache.get(key)); m.position.set(x, y, z); m.rotation.y = rotY; g.add(m); return m;
}
/** Biển số kiểu Việt Nam (nền trắng, chữ đen, viền đen). */
function plate(g, x, y, z, rotY, text, w = 0.33, h = 0.165) {
  const key = 'plate' + text;
  if (!texCache.has(key)) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const t = c.getContext('2d');
    t.fillStyle = '#f4f4f0'; t.fillRect(0, 0, 256, 128); t.strokeStyle = '#111'; t.lineWidth = 8; t.strokeRect(4, 4, 248, 120);
    t.fillStyle = '#111'; t.font = 'bold 46px Arial'; t.textAlign = 'center'; const [a, b] = text.split(' '); t.fillText(a, 128, 46); t.fillText(b || '', 128, 100);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; texCache.set(key, new THREE.MeshBasicMaterial({ map: tx }));
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), texCache.get(key)); m.position.set(x, y, z); m.rotation.y = rotY; g.add(m);
}
const plateNo = () => { const r = n => Math.floor(Math.random() * n); return `5${r(10)}-${'ABCDEFGHKLMNPSTUVX'[r(18)]}${1 + r(9)} ${100 + r(899)}.${10 + r(89)}`; };

function wheel(g, x, y, z, r, w, rimColor = 0xb8bcc2, spokes = 5) {
  cylZ(g, x, y, z, r, w, L(0x1a1a1a), 20);
  cylZ(g, x, y, z, r * 0.64, w + 0.012, P(rimColor, 80), 18); // mâm
  // nan mâm: các thanh toả đều từ tâm, chỉ ở mặt ngoài
  const face = z + (z >= 0 ? 1 : -1) * (w / 2 + 0.008);
  for (let i = 0; i < spokes; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(r * 0.58, r * 0.1, 0.01), L(0x3a3d42));
    const a = i * 2 * Math.PI / spokes;
    s.position.set(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, face); s.rotation.z = a; g.add(s);
  }
  cylZ(g, x, y, face, r * 0.13, 0.012, P(0xd8dce0, 90), 12); // chụp mâm
}

// ---------- người lái ----------
function rider(g, { shirt = 0x2f6db5, pants = 0x2d3440, helmet = 0xf0f0f0, skin = 0xd9b08c, grab = false, x = -0.15, seatY = 0.8, mask = true } = {}) {
  const r = new THREE.Group(); r.position.set(x, seatY, 0); g.add(r);
  const sh = L(grab ? 0x00b14f : shirt), pa = L(pants);
  // đùi về trước, cẳng chân xuống bàn để chân
  for (const z of [-0.12, 0.12]) {
    const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.3, 4, 8), pa); th.rotation.z = Math.PI / 2 - 0.15; th.position.set(0.17, 0.05, z); r.add(th);
    const sn = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.32, 4, 8), pa); sn.position.set(0.36, -0.2, z * 1.05); sn.rotation.z = -0.25; r.add(sn);
    box(r, 0.33, 0.5, -0.43, -0.37, z - 0.05, z + 0.05, L(0x222222)); // giày
  }
  // thân nghiêng về trước, tay ra ghi-đông
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.32, 4, 10), sh); torso.scale.z = 0.8; torso.position.set(0.05, 0.36, 0); torso.rotation.z = -0.22; r.add(torso);
  for (const z of [-0.2, 0.2]) {
    // vai -> tay lái (toạ độ người lái): tay duỗi ra trước, hơi chúi xuống
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.6, 4, 8), sh); arm.position.set(0.45, 0.37, z * 1.3); arm.rotation.z = -2.06; r.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), L(skin)); hand.position.set(0.78, 0.19, z * 1.6); r.add(hand);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), L(skin)); head.position.set(0.13, 0.72, 0); r.add(head);
  if (mask) { const mk = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.35), L(0x5a6b7d)); mk.rotation.z = -Math.PI / 2; mk.position.set(0.17, 0.69, 0); r.add(mk); }
  // mũ bảo hiểm nửa đầu
  const hm = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), P(grab ? 0x00b14f : helmet, 70)); hm.position.set(0.12, 0.74, 0); r.add(hm);
  box(r, 0.2, 0.31, 0.75, 0.77, -0.08, 0.08, L(0x222222)); // lưỡi trai mũ
  if (grab) { decal(r, 'Grab', -0.06, 0.4, 0, 0.26, 0.09, { fg: '#ffffff', font: 'bold 44px Arial' }, -Math.PI / 2); }
  return r;
}

// ---------- xe máy ----------
const BIKES = {
  vision: { name: 'Honda Vision', body: 0xc8202c, trim: 0xf2f2ee, scooter: true, badge: 'Vision', wheelR: 0.27 },
  airblade: { name: 'Honda Air Blade', body: 0x1d1f24, trim: 0xc8202c, scooter: true, badge: 'AIR BLADE', wheelR: 0.28, sporty: true },
  exciter: { name: 'Yamaha Exciter', body: 0x1c4fa8, trim: 0xf2f2ee, scooter: false, badge: 'Exciter', wheelR: 0.3 },
  klara: { name: 'VinFast Klara', body: 0xf2f2ee, trim: 0x2b6cb0, scooter: true, badge: 'VinFast', wheelR: 0.26, electric: true },
  wave: { name: 'Honda Wave', body: 0x2a2c30, trim: 0xc0c4ca, scooter: false, badge: 'Wave', wheelR: 0.3 }
};

export function motorbike(kind = 'vision', { rider: rd = true, grab = false, riderOpts = {} } = {}) {
  const S = BIKES[kind] || BIKES.vision, g = new THREE.Group();
  const R = S.wheelR, body = P(S.body, 70), trim = P(S.trim, 70), dark = L(0x24262a);
  wheel(g, 0.63, R, 0, R, 0.1, 0x9aa0a6); wheel(g, -0.62, R, 0, R, 0.11, 0x9aa0a6);
  if (S.scooter) {
    // yếm trước, sàn để chân, thân sau tròn
    profile(g, [[0.38, 0.32], [0.62, 0.62], [0.66, 0.92], [0.55, 1.0], [0.45, 0.9], [0.3, 0.45]], 0.36, body, 0.04);
    box(g, -0.25, 0.36, 0.3, 0.36, -0.17, 0.17, dark);
    profile(g, [[-0.25, 0.32], [-0.2, 0.6], [-0.4, 0.74], [-0.85, 0.72], [-0.92, 0.55], [-0.75, 0.36]], 0.34, body, 0.05);
    profile(g, [[-0.78, 0.5], [-0.9, 0.56], [-0.88, 0.62], [-0.6, 0.66], [-0.5, 0.58]], 0.36, trim, 0.02);
    box(g, -0.75, -0.18, 0.74, 0.8, -0.14, 0.14, L(0x1b1b1d)); // yên
    if (!S.electric) { const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.42, 10), P(0x8a8f96, 90)); ex.rotation.z = Math.PI / 2 - 0.12; ex.position.set(-0.52, 0.3, 0.17); g.add(ex); }
    else box(g, -0.5, -0.1, 0.36, 0.42, -0.12, 0.12, L(0x2b6cb0)); // hộp pin
  } else {
    // xe số / côn tay: bình xăng, khung, yên dài
    profile(g, [[0.5, 0.55], [0.35, 0.95], [0.05, 0.92], [-0.1, 0.78], [0.2, 0.6]], 0.3, body, 0.05);
    profile(g, [[-0.1, 0.7], [-0.75, 0.74], [-0.95, 0.68], [-0.85, 0.6], [-0.2, 0.6]], 0.24, body, 0.04);
    box(g, -0.7, 0.0, 0.76, 0.84, -0.12, 0.12, L(0x1b1b1d));
    box(g, -0.2, 0.3, 0.3, 0.55, -0.1, 0.1, L(0x3a3d42)); // động cơ
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 10), P(0x8a8f96, 90)); ex.rotation.z = Math.PI / 2 - 0.2; ex.position.set(-0.45, 0.38, 0.16); g.add(ex);
    if (kind === 'exciter') decal(g, 'YAMAHA', 0.2, 0.78, 0.16, 0.3, 0.07, { fg: '#ffffff', font: 'bold 40px Arial', italic: true });
  }
  // phuộc trước, ghi-đông, đèn, gương, chắn bùn
  const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 8), P(0x9aa0a6, 80)); fork.position.set(0.6, 0.62, 0); fork.rotation.z = 0.35; g.add(fork);
  cylZ(g, 0.5, 1.0, 0, 0.016, 0.66, dark);
  for (const z of [-0.33, 0.33]) box(g, 0.47, 0.53, 0.98, 1.02, z - 0.04, z + 0.04, dark);
  for (const z of [-0.24, 0.24]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.25, 6), dark); st.position.set(0.46, 1.12, z); st.rotation.x = z > 0 ? -0.35 : 0.35; g.add(st); box(g, 0.43, 0.47, 1.22, 1.29, z * 1.3 - 0.05, z * 1.3 + 0.05, dark); }
  box(g, 0.62, 0.69, 0.88, 0.97, -0.07, 0.07, BASIC(0xfff7d6)); // đèn pha
  box(g, -0.93, -0.88, 0.6, 0.66, -0.08, 0.08, BASIC(0xd0211c)); // đèn hậu
  profile(g, [[0.4, R + 0.05], [0.63, R + 0.2], [0.85, R + 0.1], [0.82, R + 0.06], [0.63, R + 0.15]], 0.12, trim, 0.01);
  plate(g, -0.95, 0.5, 0, -Math.PI / 2, plateNo(), 0.19, 0.14);
  if (S.badge && kind !== 'exciter') decal(g, S.badge, -0.55, 0.62, 0.2, 0.32, 0.07, { fg: S.body === 0xf2f2ee ? '#2b6cb0' : '#ffffff', font: 'bold 42px Arial', italic: true });
  if (rd) rider(g, { ...riderOpts, grab, seatY: S.scooter ? 0.82 : 0.86, x: -0.32 });
  g.userData.vehicle = { kind, name: grab ? 'GrabBike' : S.name, len: 1.9, h: 1.7 };
  return g;
}

// ---------- ô tô ----------
const CARS = {
  // kit: mẫu trong Kenney Car Kit; paint: màu sơn kiểu đồ chơi (tươi hơn xe thật một chút)
  bmw: { name: 'BMW 5 Series', len: 4.95, w: 1.87, body: 0x1d2a3a, type: 'sedan', kit: 'sedan-sports', paint: '#2F4A6B' },
  mercedes: { name: 'Mercedes-Benz E-Class', len: 4.92, w: 1.85, body: 0xc5c9ce, type: 'sedan', kit: 'sedan', paint: '#C9CED4' },
  vf8: { name: 'VinFast VF8', len: 4.75, w: 1.93, body: 0x1f4fa0, type: 'suv', kit: 'suv-luxury', paint: '#2F6FCB' },
  grabcar: { name: 'GrabCar', len: 4.42, w: 1.73, body: 0xf2f2ee, type: 'sedan', kit: 'sedan', paint: '#F4F4F0' },
  van: { name: 'Mitsubishi Xpander', len: 4.6, w: 1.75, body: 0xc0392b, type: 'suv', kit: 'van', paint: '#E76F51' },
  taxi: { name: 'Taxi', len: 4.4, w: 1.73, body: 0x2a9d8f, type: 'sedan', kit: 'taxi', paint: '#3BB273' },
  delivery: { name: 'Xe tải giao hàng', len: 5.2, w: 1.9, body: 0xf2f2ee, type: 'suv', kit: 'delivery', paint: '#F2F2EE' }
};

function badgeTex(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.translate(64, 64);
  if (kind === 'bmw') {
    x.fillStyle = '#111'; x.beginPath(); x.arc(0, 0, 62, 0, 7); x.fill();
    x.fillStyle = '#e8e8e8'; x.beginPath(); x.arc(0, 0, 40, 0, 7); x.fill();
    x.fillStyle = '#2f7fd1'; for (const a of [0, Math.PI]) { x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, 40, a - Math.PI / 2, a); x.fill(); }
  } else if (kind === 'mercedes') {
    x.strokeStyle = '#e6e8ea'; x.lineWidth = 9; x.beginPath(); x.arc(0, 0, 54, 0, 7); x.stroke();
    x.fillStyle = '#e6e8ea'; for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 3; x.beginPath(); x.moveTo(Math.cos(a) * 52, Math.sin(a) * 52); x.lineTo(Math.cos(a + 1.2) * 9, Math.sin(a + 1.2) * 9); x.lineTo(Math.cos(a - 1.2) * 9, Math.sin(a - 1.2) * 9); x.fill(); }
  } else {
    x.fillStyle = '#d9dde2'; x.font = 'bold 96px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('V', 0, 6);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function car(kind = 'bmw') {
  const S = CARS[kind] || CARS.bmw;
  // ô tô kiểu đồ chơi từ Kenney Car Kit (giống dự án my-office) — khi bộ kit đã nạp
  const k = kitCar(S.kit, S.paint || '#' + new THREE.Color(S.body).getHexString(), S.type === 'suv' ? 1.7 : 1.5);
  if (k) {
    const [len, h, w] = k.userData.kit.size, Lh = len / 2;
    plate(k, Lh + 0.01, h * 0.28, 0, Math.PI / 2, plateNo().replace(/^(\d\d)-(\w\d)/, '$1$2'), 0.52, 0.12);
    plate(k, -Lh - 0.01, h * 0.32, 0, -Math.PI / 2, plateNo().replace(/^(\d\d)-(\w\d)/, '$1$2'), 0.52, 0.12);
    if (kind === 'grabcar') for (const s of [-1, 1]) decal(k, 'GrabCar', -0.1, h * 0.36, s * (w / 2 + 0.01), 1.1, 0.27, { fg: '#00b14f', font: 'bold 46px Arial' }, s > 0 ? 0 : Math.PI);
    k.userData.vehicle = { kind, name: S.name, len, h };
    return k;
  }
  const g = new THREE.Group();
  const Lh = S.len / 2, W = S.w, suv = S.type === 'suv';
  const body = P(S.body, 85), chrome = P(0xd8dce0, 120), dark = L(0x1a1c20);
  const sill = 0.22, belt = suv ? 1.02 : 0.9, roof = suv ? 1.66 : 1.45;
  // thân dưới (tới dây đai cửa sổ): dáng nhìn ngang có nắp capo dốc, cốp sau
  profile(g, [[-Lh, sill + 0.12], [-Lh + 0.05, belt - 0.05], [-Lh + 0.5, belt + 0.03], [Lh - 1.25, belt], [Lh - 0.15, belt - 0.12], [Lh, belt - 0.3], [Lh, sill + 0.1], [Lh - 0.2, sill]], W, body, 0.08);
  // khoang kính
  const cab = suv ? [[-Lh + 0.35, belt], [-Lh + 0.5, roof - 0.04], [Lh - 1.85, roof], [Lh - 1.2, belt]] : [[-Lh + 0.65, belt], [-Lh + 1.15, roof - 0.03], [Lh - 2.05, roof], [Lh - 1.25, belt]];
  profile(g, cab, W - 0.16, GLASS(), 0.05);
  // mui xe sơn màu thân, cột A/B/C
  const r0 = cab[1][0] + 0.05, r1 = cab[2][0] - 0.05;
  box(g, r0, r1, roof - 0.02, roof + 0.03, -(W - 0.22) / 2, (W - 0.22) / 2, body);
  for (const z of [-(W - 0.17) / 2, (W - 0.17) / 2]) {
    const bx = (cab[0][0] + cab[3][0]) / 2 - 0.15;
    box(g, bx - 0.05, bx + 0.05, belt, roof, z - 0.01, z + 0.01, dark); // cột B
    box(g, -Lh + 0.4, Lh - 0.3, belt + 0.02, belt + 0.05, z - 0.02, z + 0.02, chrome); // nẹp kính
    box(g, bx + 0.45, bx + 0.6, belt - 0.12, belt - 0.09, z * 1.04, z * 1.04 + Math.sign(z) * 0.01, chrome); // tay nắm
    box(g, bx - 0.75, bx - 0.6, belt - 0.12, belt - 0.09, z * 1.04, z * 1.04 + Math.sign(z) * 0.01, chrome);
    box(g, Lh - 1.3, Lh - 1.15, belt + 0.05, belt + 0.17, z * 1.06 - 0.06, z * 1.06 + 0.06, body); // gương
  }
  // bánh xe + hốc bánh
  const wr = suv ? 0.37 : 0.33, wx = S.len * 0.33;
  for (const x of [-wx, wx]) for (const z of [-W / 2 + 0.12, W / 2 - 0.12]) wheel(g, x, wr, z, wr, 0.24, kind === 'vf8' ? 0x2b2d31 : 0xc0c4ca, 5);
  // đèn
  const fz = W / 2 - 0.3;
  for (const z of [-fz, fz]) {
    box(g, Lh - 0.06, Lh + 0.01, belt - 0.24, belt - 0.15, z - 0.2, z + 0.2, BASIC(0xf8f6ea)); // đèn pha
    box(g, -Lh - 0.01, -Lh + 0.05, belt - 0.2, belt - 0.1, z - 0.22, z + 0.22, BASIC(0xc81e1e)); // đèn hậu
  }
  // mặt ca-lăng theo hãng
  const gx = Lh + 0.015;
  if (kind === 'bmw') {
    for (const z of [-0.17, 0.17]) { box(g, gx - 0.03, gx, sill + 0.32, sill + 0.55, z - 0.13, z + 0.13, chrome); box(g, gx - 0.025, gx + 0.003, sill + 0.34, sill + 0.53, z - 0.11, z + 0.11, dark); }
  } else if (kind === 'mercedes') {
    box(g, gx - 0.03, gx, sill + 0.3, sill + 0.55, -0.45, 0.45, dark);
    box(g, gx - 0.025, gx + 0.004, sill + 0.41, sill + 0.44, -0.45, 0.45, chrome);
  } else if (kind === 'vf8') {
    box(g, gx - 0.02, gx + 0.003, belt - 0.2, belt - 0.17, -W / 2 + 0.25, W / 2 - 0.25, chrome); // đường crôm chữ V dọc đầu xe
    box(g, gx - 0.03, gx, sill + 0.15, sill + 0.35, -0.5, 0.5, dark);
  } else {
    box(g, gx - 0.03, gx, sill + 0.3, sill + 0.5, -0.4, 0.4, dark);
  }
  if (kind !== 'grabcar') {
    const bm = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), new THREE.MeshBasicMaterial({ map: badgeTex(kind), transparent: true }));
    bm.rotation.y = Math.PI / 2; bm.position.set(gx + 0.012, kind === 'bmw' ? belt - 0.02 : sill + 0.43, 0); g.add(bm);
  }
  // cản trước/sau, biển số
  box(g, Lh - 0.12, Lh + 0.03, sill, sill + 0.14, -W / 2 + 0.05, W / 2 - 0.05, dark);
  box(g, -Lh - 0.03, -Lh + 0.12, sill, sill + 0.14, -W / 2 + 0.05, W / 2 - 0.05, dark);
  plate(g, Lh + 0.035, sill + 0.2, 0, Math.PI / 2, plateNo().replace(/^(\d\d)-(\w\d)/, '$1$2'), 0.52, 0.12);
  plate(g, -Lh - 0.035, sill + 0.25, 0, -Math.PI / 2, plateNo().replace(/^(\d\d)-(\w\d)/, '$1$2'), 0.52, 0.12);
  // tên dòng xe ở đuôi, tem Grab
  decal(g, S.name.replace('Mercedes-Benz ', ''), -Lh - 0.04, belt - 0.02, 0.45, 0.4, 0.08, { fg: '#e6e8ea', font: 'bold 34px Arial' }, -Math.PI / 2);
  if (kind === 'grabcar') for (const s of [-1, 1]) decal(g, 'GrabCar', 0.2, belt - 0.32, s * (W / 2 + 0.002), 0.9, 0.22, { fg: '#00b14f', font: 'bold 46px Arial' }, s > 0 ? 0 : Math.PI);
  if (kind === 'vf8') decal(g, 'VinFast', -Lh - 0.04, belt - 0.12, 0, 0.5, 0.1, { fg: '#e6e8ea', font: 'bold 40px Arial' }, -Math.PI / 2);
  // tài xế thấp thoáng sau kính
  const drv = new THREE.Group(); drv.position.set(cab[3][0] - 0.75, belt - 0.15, -0.38); g.add(drv);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), L(0xd9b08c)); hd.position.y = 0.42; drv.add(hd);
  box(drv, -0.15, 0.15, 0.0, 0.35, -0.18, 0.18, L(0x3a3f4a));
  g.userData.vehicle = { kind, name: S.name, len: S.len, h: roof };
  return g;
}

/** Danh sách xe chạy trên đường (làn, hướng, tốc độ). */
export const TRAFFIC = [
  { lane: 15.0, dir: -1, x: 12, v: 8, make: () => motorbike('vision', { riderOpts: { shirt: 0x2f6db5, helmet: 0xf0f0f0 } }) },
  { lane: 15.0, dir: -1, x: 2, v: 7.5, make: () => motorbike('wave', { grab: true }) },
  { lane: 15.0, dir: -1, x: -8, v: 9, make: () => motorbike('exciter', { riderOpts: { shirt: 0x202124, helmet: 0x1c4fa8, mask: false } }) },
  { lane: 17.6, dir: -1, x: 6, v: 7, make: () => car('bmw') },
  { lane: 17.6, dir: -1, x: -9, v: 8, make: () => motorbike('klara', { riderOpts: { shirt: 0xe0577a, pants: 0xe6e1d6, helmet: 0xf2a1b8 } }) },
  { lane: 21.8, dir: 1, x: -8, v: 8, make: () => car('mercedes') },
  { lane: 21.8, dir: 1, x: 4, v: 9, make: () => motorbike('airblade', { riderOpts: { shirt: 0xc2402f, helmet: 0x202124 } }) },
  { lane: 24.4, dir: 1, x: -11, v: 7.5, make: () => car('vf8') },
  { lane: 24.4, dir: 1, x: 0, v: 7, make: () => motorbike('vision', { grab: true }) },
  { lane: 24.4, dir: 1, x: 9, v: 8, make: () => car('grabcar') },
  { lane: 17.6, dir: -1, x: -2, v: 7.5, make: () => car('taxi') },
  { lane: 21.8, dir: 1, x: 12, v: 7, make: () => car('van') }
];

/** Xe máy đỗ trên vỉa hè (không người). */
export const PARKED = [
  { kind: 'vision', x: -9.6, z: 10.6, ry: -Math.PI / 2 }, { kind: 'airblade', x: -8.8, z: 10.8, ry: -Math.PI / 2 }, { kind: 'wave', x: -7.6, z: 10.6, ry: -1.4 },
  { kind: 'klara', x: -11.5, z: 10.8, ry: -Math.PI / 2 }, { kind: 'exciter', x: 5.9, z: 10.7, ry: 0.25 }
];
