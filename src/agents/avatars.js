// Nhân vật chibi đầu to, mặt kiểu Memoji (mắt, lông mày, mũi, miệng, tai, má, tóc, râu, kính, mũ),
// có khung xương (hông, thân, đầu, tay, chân) và động tác: đứng, đi, chạy, ngồi, gõ phím, nhảy, vẫy tay,
// hút thuốc, uống cà phê, gọi điện, nhảy múa, nói chuyện.
// Vẽ bằng InstancedMesh: mỗi bộ phận một mesh cho mọi nhân vật -> số draw call cố định.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GlbPool, characterDef } from './glbCharacters.js';
import { PixelBillboards, VIEW, chibiLookOf, billboardCamera } from '../pixel/billboard.js';
// người dùng thật ở chế độ 3D: nhân vật chibi tô theo nhân vật pixel đã chọn
// nhân vật dựng bằng code (characters.json format 'chibi', vd. con vật): ngoại hình khai báo sẵn + màu tuỳ chỉnh 3D của người
// dùng (Áo → áo, Quần → quần, Giày → giày, Da → lông, Tóc → bờm)
const chibiDefCache = new Map();
function chibiDefLook(a) {
  const el = a?.emp?.look, def = el?.model && characterDef(el.model);
  if (!def || def.format !== 'chibi' || VIEW.mode !== '3d') return null;
  const key = [def.id, el.topColor, el.bottomColor, el.shoeColor, el.skinColor, el.hairColor].join('|');
  let L = chibiDefCache.get(key);
  if (!L) {
    L = { ...def.look };
    if (el.topColor) L.shirt = el.topColor;
    if (el.bottomColor) L.pants = el.bottomColor;
    if (el.shoeColor) L.shoes = el.shoeColor;
    if (el.skinColor) { L.skin = el.skinColor; if (!def.look.earColor) L.earColor = el.skinColor; }
    if (el.hairColor) L.mane = el.hairColor;
    chibiDefCache.set(key, L);
  }
  return L;
}
const lookOf = a => chibiDefLook(a) || (a && a.key && VIEW.mode === '3d' && chibiLookOf(a)) || (a && a.emp && a.emp.look) || {};
import { gaitMotion, gaitLegs } from './gait.js';
import { MOCAP, loadMocap, mocapPose, segQuat, SEG } from './mocap.js';
// Nhân vật VRM / GLB có xương: thư viện nạp khi có người dùng tới (bộ nhân vật hiện tại toàn my-office 'mo') — gói chính
// nhẹ đi ~250 kB (@pixiv/three-vrm). Trong lúc nạp, get() trả null: nhân vật tạm ẩn như khi đang tải mô hình.
class LazyPool {
  constructor(load, group) { this.load = load; this.group = group; this.pool = null; this.req = false; }
  begin() { this.pool?.begin(); }
  get(a, def) {
    if (this.pool) return this.pool.get(a, def);
    if (!this.req) { this.req = true; this.load().then(P => { this.pool = new P(this.group); }).catch(e => { console.warn('Không nạp được bộ nhân vật', e); this.req = false; }); }
    return null;
  }
  loading(a) { return this.pool ? this.pool.loading(a) : this.req; }
  end() { this.pool?.end(); }
}
import { MoPool, moConfig } from './moCharacters.js';
import { toonRamp, outlineMaterial, characterToon, characterVinyl, OUTLINE } from './toon.js';
export { toonRamp, outlineMaterial };

// Kích thước (m) ở tỉ lệ 1.0. Khớp hông khi đứng cao 0.6 m; đầu to ~0.4 m.
export const DIM = { hip: 0.6, thigh: 0.28, shin: 0.26, spine: 0.05, neck: 0.35, upper: 0.2, fore: 0.19, shoulderX: 0.185, hipX: 0.072, headR: 0.2 };
// bộ phận không vẽ viền: chi tiết nhỏ trên mặt, hình mở (váy, tóc mái), logo, đạo cụ nhỏ
const NO_OUTLINE = new Set(['collar', 'neck', 'nose', 'eye', 'eyeWhite', 'iris', 'pupil', 'eyeHiC', 'eyeBig', 'eyeHi', 'eyeSmile', 'brow', 'browThick', 'mouthSmile', 'mouthGrin', 'mouthLine', 'mouthO', 'blush', 'mustache', 'beard', 'hairFringe', 'hairSides', 'skirt', 'dress', 'glassRing', 'glassBridge', 'stripeArm', 'stripeLeg', 'stripeShin', 'logoPatch', 'shirtLogo', 'cig', 'cigTip', 'braidTie']);
const HEAD_SCALE = new THREE.Vector3(1.28, 1.28, 1.28); // đầu to kiểu chibi (giống agent-office: đầu ~40% chiều cao)

const CHIBI_LEG = { hip: DIM.hip, L1: DIM.thigh, L2: DIM.shin, ankle: DIM.hip - DIM.thigh - DIM.shin, hipX: DIM.hipX };
const HEAD_C = 0.2; // tâm đầu so với khớp cổ

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
const T = (x, y, z, rx = 0, ry = 0, rz = 0) => {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_e), new THREE.Vector3(1, 1, 1));
};

function joint(parent, tx, ty, tz, rx = 0, ry = 0, rz = 0, out = new THREE.Matrix4(), sc = _one) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _v.set(tx, ty, tz);
  out.compose(_v, _q, sc);
  return out.premultiply(parent);
}

// ---------- hình học ----------
const capsuleDown = (r, len) => { const g = new THREE.CapsuleGeometry(r, len, 4, 10); g.translate(0, -(len / 2 + r * 0.6), 0); return g; };
const sphere = (r, ws = 16, hs = 12) => new THREE.SphereGeometry(r, ws, hs);
function hairCap(theta, r = DIM.headR * 1.06, bumpy = 0) {
  const g = new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, theta);
  if (bumpy) {
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = 1 + bumpy * Math.sin(v.x * 70) * Math.sin(v.y * 60) * Math.sin(v.z * 65); v.multiplyScalar(n); p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals();
  }
  return g;
}
const arc = (r, tube, len = Math.PI) => new THREE.TorusGeometry(r, tube, 6, 14, len);
const bar = (r, len) => { const g = new THREE.CapsuleGeometry(r, len, 3, 6); g.rotateZ(Math.PI / 2); return g; };
const scaled = (g, sx, sy, sz) => { g.scale(sx, sy, sz); return g; };
/** Mũ tóc ôm quanh đầu, chừa khoảng trước mặt (gap rad) — dùng cho tóc dài, bob. */
function hairWrap(theta, gap, r = DIM.headR * 1.07) {
  const s = 3 * Math.PI / 2 + gap / 2; // mặt nhìn về -z: phi = 3π/2
  return new THREE.SphereGeometry(r, 26, 14, s, 2 * Math.PI - gap, 0, theta);
}
/** Bờm sư tử: vòng lông xù bao quanh mặt (hình xuyến, mép gợn sóng). */
function maneRing() {
  const g = new THREE.TorusGeometry(DIM.headR * 1.08, 0.075, 12, 36);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ang = Math.atan2(v.y, v.x), r = Math.hypot(v.x, v.y), k = 1 + 0.12 * Math.max(0, Math.sin(ang * 11)) * Math.max(0, (r - DIM.headR * 1.08) / 0.075);
    v.x *= k; v.y *= k; p.setXYZ(i, v.x, v.y, v.z);
  }
  g.scale(1, 1.02, 0.7); g.computeVertexNormals();
  return g;
}
function spikes() {
  const parts = [];
  const tips = [[0, 0.21, 0.02, 0, 0], [0.07, 0.19, -0.03, -0.35, -0.5], [-0.07, 0.19, -0.03, -0.35, 0.5], [0.09, 0.17, 0.07, 0.4, -0.6], [-0.09, 0.17, 0.07, 0.4, 0.6], [0, 0.18, -0.09, -0.75, 0], [0, 0.17, 0.11, 0.7, 0]];
  for (const [x, y, z, rx, rz] of tips) { const c = new THREE.ConeGeometry(0.05, 0.13, 6); c.rotateX(rx); c.rotateZ(rz); c.translate(x, y, z); parts.push(c.toNonIndexed()); }
  return mergeGeometries(parts);
}

/**
 * Bộ phận: name, geo, màu (khóa trong bảng màu), khớp gắn vào, đối xứng trái/phải, ma trận cục bộ, điều kiện hiển thị theo look.
 * attach: pelvis | spine | head | upper | fore | thigh | shin | ankle
 */
function partDefs() {
  const hy = HEAD_C, fz = -DIM.headR * 0.93; // mặt trước của đầu
  const L = l => l || {};
  const hasCap = l => ['short', 'long', 'ponytail', 'bun', 'sidepart', 'pigtails', 'spacebuns', 'bob', 'spiky', undefined].includes(L(l).hairStyle) && !L(l).hat;
  const outfit = l => L(l).outfit || 'tee';
  return [
    { name: 'pelvis', geo: scaled(new THREE.CapsuleGeometry(0.11, 0.04, 4, 12), 1.1, 0.75, 0.82), color: 'pelvisC', attach: 'pelvis', local: T(0, 0.03, 0) },
    { name: 'torso', geo: (() => { const g = new THREE.CapsuleGeometry(0.145, 0.13, 4, 16); g.scale(1.08, 1, 0.78); g.translate(0, 0.18, 0); return g; })(), color: 'shirt', attach: 'spine' },
    { name: 'collar', geo: new THREE.TorusGeometry(0.06, 0.018, 6, 16), color: 'shirt2', attach: 'spine', local: T(0, 0.335, 0, Math.PI / 2), when: l => !L(l).collar },
    { name: 'neck', geo: new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), color: 'skin', attach: 'spine', local: T(0, 0.35, 0) },
    { name: 'head', geo: scaled(sphere(DIM.headR, 22, 16), 1, 1.02, 0.95), color: 'skin', attach: 'head', local: T(0, hy, 0) },
    { name: 'ear', geo: scaled(sphere(0.042, 10, 8), 0.5, 1, 0.8), color: 'skin', attach: 'head', side: true, local: s => T(s * DIM.headR * 0.98, hy - 0.01, 0), when: l => !L(l).species },
    { name: 'nose', geo: scaled(sphere(0.022, 10, 8), 1, 0.85, 0.8), color: 'skinDark', attach: 'head', local: T(0, hy - 0.02, fz - 0.01), when: l => !L(l).species },
    // mắt
    { name: 'eye', geo: scaled(sphere(0.03, 12, 10), 0.85, 1.15, 0.5), color: 'eye', attach: 'head', side: true, local: s => T(s * 0.068, hy + 0.025, fz + 0.012), when: l => !['smile', 'big', 'cartoon'].includes(L(l).eyes) },
    // mắt hoạt hình: lòng trắng, mống mắt, con ngươi, điểm sáng
    { name: 'eyeWhite', geo: scaled(sphere(0.047, 16, 12), 0.82, 1.08, 0.42), color: 'white', attach: 'head', side: true, local: s => T(s * 0.07, hy + 0.02, fz + 0.02), when: l => L(l).eyes === 'cartoon' },
    { name: 'iris', geo: scaled(sphere(0.031, 14, 10), 0.92, 1.05, 0.4), color: 'eye', attach: 'head', side: true, local: s => T(s * 0.066, hy + 0.012, fz + 0.006), when: l => L(l).eyes === 'cartoon' },
    { name: 'pupil', geo: scaled(sphere(0.016, 10, 8), 1, 1.05, 0.4), color: 'pupil', attach: 'head', side: true, local: s => T(s * 0.065, hy + 0.01, fz + 0.0), when: l => L(l).eyes === 'cartoon' },
    { name: 'eyeHiC', geo: sphere(0.009, 8, 6), color: 'white', attach: 'head', side: true, local: s => T(s * 0.065 + 0.012, hy + 0.024, fz - 0.006), when: l => L(l).eyes === 'cartoon' },
    { name: 'eyeBig', geo: scaled(sphere(0.038, 12, 10), 0.9, 1.15, 0.5), color: 'eye', attach: 'head', side: true, local: s => T(s * 0.07, hy + 0.025, fz + 0.016), when: l => L(l).eyes === 'big' },
    { name: 'eyeHi', geo: sphere(0.011, 8, 6), color: 'white', attach: 'head', side: true, local: s => T(s * 0.07 + 0.01, hy + 0.04, fz - 0.002), when: l => !['smile', 'cartoon'].includes(L(l).eyes) },
    { name: 'eyeSmile', geo: arc(0.026, 0.0075), color: 'eye', attach: 'head', side: true, local: s => T(s * 0.068, hy + 0.012, fz + 0.012), when: l => L(l).eyes === 'smile' },
    // lông mày
    { name: 'brow', geo: bar(0.008, 0.045), color: 'brow', attach: 'head', side: true, local: s => T(s * 0.07, hy + 0.085, fz + 0.02, 0, 0, -s * 0.12), when: l => L(l).brows !== 'thick' && L(l).brows !== 'none' },
    { name: 'browThick', geo: bar(0.014, 0.05), color: 'brow', attach: 'head', side: true, local: s => T(s * 0.07, hy + 0.088, fz + 0.022, 0, 0, -s * 0.1), when: l => L(l).brows === 'thick' },
    // miệng
    { name: 'mouthSmile', geo: arc(0.032, 0.0075), color: 'mouth', attach: 'head', local: T(0, hy - 0.065, fz + 0.02, 0, 0, Math.PI), when: l => !L(l).species && (!L(l).mouth || L(l).mouth === 'smile') },
    { name: 'mouthGrin', geo: scaled(new THREE.SphereGeometry(0.036, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 1, 0.8, 0.5), color: 'white', attach: 'head', local: T(0, hy - 0.06, fz + 0.012), when: l => L(l).mouth === 'grin' },
    { name: 'mouthLine', geo: bar(0.006, 0.035), color: 'mouth', attach: 'head', local: T(0, hy - 0.07, fz + 0.022), when: l => L(l).mouth === 'neutral' },
    { name: 'mouthO', geo: scaled(sphere(0.018, 10, 8), 1, 1.2, 0.5), color: 'mouth', attach: 'head', local: T(0, hy - 0.07, fz + 0.016), when: l => L(l).mouth === 'open' },
    { name: 'blush', geo: scaled(sphere(0.028, 10, 8), 1, 0.6, 0.25), color: 'blush', attach: 'head', side: true, local: s => T(s * 0.11, hy - 0.03, fz + 0.035), when: l => !!L(l).blush },
    // râu
    { name: 'mustache', geo: bar(0.013, 0.05), color: 'hair', attach: 'head', local: T(0, hy - 0.045, fz + 0.005), when: l => ['mustache', 'beard'].includes(L(l).facialHair) },
    { name: 'beard', geo: new THREE.SphereGeometry(DIM.headR * 1.02, 24, 10, Math.PI * 0.05, Math.PI * 0.9, Math.PI * 0.55, Math.PI * 0.4), color: 'hair', attach: 'head', local: T(0, hy, 0, 0, Math.PI / 2), when: l => L(l).facialHair === 'beard' },
    // tóc
    { name: 'hairShort', geo: hairCap(1.2), color: 'hair', attach: 'head', local: T(0, hy + 0.01, 0.012, -0.18), when: hasCap },
    { name: 'hairFringe', geo: new THREE.SphereGeometry(DIM.headR * 1.07, 20, 8, Math.PI * 0.6, Math.PI * 0.8, 0.35, 0.65), color: 'hair', attach: 'head', local: T(0, hy + 0.012, 0, 0.05, 0, 0.18), when: l => ['sidepart', 'long', 'bun', 'ponytail', 'pigtails', 'spacebuns', 'bob'].includes(L(l).hairStyle) },
    { name: 'hairSides', geo: hairWrap(1.95, 1.7), color: 'hair', attach: 'head', local: T(0, hy + 0.01, 0.005), when: l => ['long', 'bob'].includes(L(l).hairStyle) },
    { name: 'braid', geo: (() => { const g = new THREE.CapsuleGeometry(0.038, 0.17, 4, 8); g.translate(0, -0.1, 0); return g; })(), color: 'hair', attach: 'head', side: true, local: s => T(s * 0.19, hy + 0.0, 0.03, 0.15, 0, s * 0.35), when: l => L(l).hairStyle === 'pigtails' },
    { name: 'braidTie', geo: sphere(0.03, 8, 6), color: 'tie', attach: 'head', side: true, local: s => T(s * 0.205, hy + 0.03, 0.03), when: l => L(l).hairStyle === 'pigtails' },
    { name: 'spaceBun', geo: sphere(0.065, 14, 10), color: 'hair', attach: 'head', side: true, local: s => T(s * 0.12, hy + 0.18, 0.02), when: l => L(l).hairStyle === 'spacebuns' && !L(l).hat },
    { name: 'afro', geo: scaled(hairCap(1.75, DIM.headR * 1.42, 0.07), 1, 0.95, 1), color: 'hair', attach: 'head', local: T(0, hy - 0.02, 0.04, -0.2), when: l => L(l).hairStyle === 'afro' && !L(l).hat },
    { name: 'spiky', geo: spikes(), color: 'hair', attach: 'head', local: T(0, hy, 0), when: l => L(l).hairStyle === 'spiky' && !L(l).hat },
    { name: 'hairCurly', geo: hairCap(1.35, DIM.headR * 1.1, 0.06), color: 'hair', attach: 'head', local: T(0, hy + 0.015, 0.012, -0.12), when: l => L(l).hairStyle === 'curly' && !L(l).hat },
    { name: 'hairBuzz', geo: hairCap(1.3, DIM.headR * 1.015), color: 'hair', attach: 'head', local: T(0, hy, 0.005, -0.15), when: l => L(l).hairStyle === 'buzz' && !L(l).hat },
    { name: 'hairLong', geo: scaled(new THREE.CapsuleGeometry(0.17, 0.12, 4, 14), 1.12, 1, 0.55), color: 'hair', attach: 'head', local: T(0, hy - 0.08, 0.1), when: l => L(l).hairStyle === 'long' },
    { name: 'pony', geo: new THREE.CapsuleGeometry(0.05, 0.16, 4, 10), color: 'hair', attach: 'head', local: T(0, hy - 0.04, 0.22, 0.45), when: l => L(l).hairStyle === 'ponytail' },
    { name: 'bun', geo: sphere(0.075, 14, 10), color: 'hair', attach: 'head', local: T(0, hy + 0.2, 0.06), when: l => L(l).hairStyle === 'bun' && !L(l).hat },
    // mũ
    { name: 'capTop', geo: hairCap(1.25, DIM.headR * 1.1), color: 'hat', attach: 'head', local: T(0, hy + 0.02, 0, -0.1), when: l => L(l).hat === 'cap' },
    { name: 'capBrim', geo: scaled(new THREE.CylinderGeometry(0.13, 0.13, 0.015, 18, 1, false, Math.PI / 2, Math.PI), 1, 1, 1.1), color: 'hat', attach: 'head', local: T(0, hy + 0.09, -0.15, -0.12), when: l => L(l).hat === 'cap' },
    { name: 'sunCrown', geo: new THREE.CylinderGeometry(0.15, 0.19, 0.13, 20), color: 'hat', attach: 'head', local: T(0, hy + 0.19, 0.01, -0.08), when: l => L(l).hat === 'sunhat' },
    { name: 'sunBrim', geo: new THREE.CylinderGeometry(0.36, 0.36, 0.014, 28), color: 'hat', attach: 'head', local: T(0, hy + 0.13, 0.0, -0.1), when: l => L(l).hat === 'sunhat' },
    { name: 'beanie', geo: scaled(hairCap(1.45, DIM.headR * 1.1), 1, 1.15, 1), color: 'hat', attach: 'head', local: T(0, hy + 0.01, 0.01, -0.06), when: l => L(l).hat === 'beanie' },
    // kính
    { name: 'glassRing', geo: new THREE.TorusGeometry(0.038, 0.007, 6, 18), color: 'glass', attach: 'head', side: true, local: s => T(s * 0.07, hy + 0.025, fz - 0.012), when: l => !!L(l).glasses },
    { name: 'glassBridge', geo: new THREE.BoxGeometry(0.06, 0.008, 0.008), color: 'glass', attach: 'head', local: T(0, hy + 0.03, fz - 0.014), when: l => !!L(l).glasses },
    // ---- con vật (look.species): mõm, mũi, miệng chữ w, ria, tai theo loài, bờm, đuôi, mảng mắt, sọc ----
    { name: 'muzzle', geo: scaled(sphere(0.075, 18, 12), 1.25, 0.82, 0.8), color: 'fur2', attach: 'head', local: T(0, hy - 0.06, fz + 0.03), when: l => !!L(l).species && !['panda', 'bear'].includes(L(l).species) && !L(l).snout },
    // mõm dài (cáo, chó): khối thuôn nhô ra trước, mũi ở đầu mõm
    { name: 'snout', geo: (() => { const g = new THREE.SphereGeometry(0.07, 20, 14); g.scale(1.05, 0.8, 1.55); return g; })(), color: 'fur2', attach: 'head', local: T(0, hy - 0.055, fz + 0.005, 0.12), when: l => !!L(l).snout },
    { name: 'snoutNose', geo: scaled(sphere(0.026, 14, 10), 1.3, 0.9, 0.9), color: 'nose', attach: 'head', local: T(0, hy - 0.035, fz - 0.098), when: l => !!L(l).snout },
    { name: 'muzzleSoft', geo: scaled(sphere(0.06, 16, 12), 1.2, 0.8, 0.7), color: 'fur2', attach: 'head', local: T(0, hy - 0.065, fz + 0.035), when: l => L(l).species === 'panda' || L(l).species === 'bear' },
    { name: 'animalNose', geo: scaled(sphere(0.024, 14, 10), 1.35, 0.85, 0.85), color: 'nose', attach: 'head', local: T(0, hy - 0.035, fz - 0.028), when: l => !!L(l).species && !L(l).snout },
    { name: 'noseHi', geo: sphere(0.007, 6, 5), color: 'white', attach: 'head', local: T(-0.01, hy - 0.028, fz - 0.046), when: l => !!L(l).species && !L(l).snout },
    { name: 'mouthW', geo: arc(0.014, 0.0055), color: 'mouth', attach: 'head', side: true, local: s => T(s * 0.014, hy - 0.072, fz - 0.016, 0, 0, Math.PI), when: l => !!L(l).species && !L(l).snout },
    { name: 'mouthWLong', geo: arc(0.014, 0.0055), color: 'mouth', attach: 'head', side: true, local: s => T(s * 0.014, hy - 0.085, fz - 0.07, 0.4, 0, Math.PI), when: l => !!L(l).snout },
    { name: 'whisker', geo: bar(0.0028, 0.07), color: 'nose', attach: 'head', side: true, local: s => T(s * 0.105, hy - 0.055, fz - 0.002, 0, s * 0.25, s * 0.08), when: l => ['cat', 'fox', 'tiger', 'rabbit'].includes(L(l).species) },
    { name: 'whisker2', geo: bar(0.0028, 0.07), color: 'nose', attach: 'head', side: true, local: s => T(s * 0.105, hy - 0.07, fz, 0, s * 0.25, -s * 0.12), when: l => ['cat', 'fox', 'tiger', 'rabbit'].includes(L(l).species) },
    // tai tròn (sư tử, gấu, gấu trúc, koala, hổ)
    { name: 'earRound', geo: scaled(sphere(0.062, 16, 12), 1, 1, 0.55), color: 'earC', attach: 'head', side: true, local: s => T(s * 0.14, hy + 0.17, -0.005, 0, 0, -s * 0.35), when: l => L(l).ears === 'round' },
    { name: 'earRoundIn', geo: scaled(sphere(0.038, 14, 10), 1, 1, 0.4), color: 'fur2', attach: 'head', side: true, local: s => T(s * 0.14, hy + 0.17, -0.028, 0, 0, -s * 0.35), when: l => L(l).ears === 'round' },
    // tai nhọn (mèo, cáo)
    { name: 'earPoint', geo: scaled(new THREE.ConeGeometry(0.065, 0.13, 4, 1), 1, 1, 0.55), color: 'earC', attach: 'head', side: true, local: s => T(s * 0.115, hy + 0.18, 0.02, 0, Math.PI / 4, -s * 0.32), when: l => L(l).ears === 'pointy' },
    { name: 'earPointIn', geo: scaled(new THREE.ConeGeometry(0.038, 0.085, 4, 1), 1, 1, 0.4), color: 'fur2', attach: 'head', side: true, local: s => T(s * 0.115, hy + 0.17, -0.002, 0, Math.PI / 4, -s * 0.32), when: l => L(l).ears === 'pointy' },
    { name: 'earTip', geo: scaled(new THREE.ConeGeometry(0.03, 0.05, 4, 1), 1, 1, 0.6), color: 'dark', attach: 'head', side: true, local: s => T(s * 0.137, hy + 0.225, 0.02, 0, Math.PI / 4, -s * 0.32), when: l => L(l).ears === 'pointy' && L(l).earTips },
    // tai dài (thỏ)
    { name: 'earLong', geo: (() => { const g = new THREE.CapsuleGeometry(0.038, 0.2, 4, 10); g.scale(1, 1, 0.55); g.translate(0, 0.13, 0); return g; })(), color: 'earC', attach: 'head', side: true, local: s => T(s * 0.07, hy + 0.15, 0.02, -0.12, 0, -s * 0.18), when: l => L(l).ears === 'long' },
    { name: 'earLongIn', geo: (() => { const g = new THREE.CapsuleGeometry(0.022, 0.16, 4, 8); g.scale(1, 1, 0.4); g.translate(0, 0.13, 0); return g; })(), color: 'fur2', attach: 'head', side: true, local: s => T(s * 0.07, hy + 0.15, 0.002, -0.12, 0, -s * 0.18), when: l => L(l).ears === 'long' },
    // tai cụp (chó)
    { name: 'earFlop', geo: (() => { const g = new THREE.CapsuleGeometry(0.045, 0.11, 4, 10); g.scale(1, 1, 0.5); g.translate(0, -0.08, 0); return g; })(), color: 'dark', attach: 'head', side: true, local: s => T(s * 0.17, hy + 0.11, 0.02, 0, 0, s * 0.35), when: l => L(l).ears === 'floppy' },
    // bờm sư tử: vòng lông bao quanh mặt (chừa phía trước)
    { name: 'mane', geo: maneRing(), color: 'mane', attach: 'head', local: T(0, hy - 0.005, 0.015), when: l => !!L(l).mane },
    { name: 'maneBack', geo: scaled(hairWrap(Math.PI * 0.95, 3.3, DIM.headR * 1.18), 1, 1, 0.95), color: 'mane', attach: 'head', local: T(0, hy, 0.03), when: l => !!L(l).mane },
    // mảng mắt (gấu trúc), sọc trán (hổ)
    { name: 'eyePatch', geo: scaled(sphere(0.052, 14, 10), 0.85, 1.15, 0.45), color: 'dark', attach: 'head', side: true, local: s => T(s * 0.07, hy + 0.012, fz + 0.026, 0, 0, s * 0.45), when: l => !!L(l).eyePatch },
    { name: 'stripe', geo: scaled(new THREE.ConeGeometry(0.018, 0.09, 6), 1, 1, 0.4), color: 'dark', attach: 'head', local: T(0, hy + 0.15, fz + 0.06, 0.55, 0, Math.PI), when: l => !!L(l).stripes },
    { name: 'stripeSide', geo: scaled(new THREE.ConeGeometry(0.014, 0.075, 6), 1, 1, 0.4), color: 'dark', attach: 'head', side: true, local: s => T(s * 0.045, hy + 0.14, fz + 0.07, 0.55, 0, Math.PI - s * 0.3), when: l => !!L(l).stripes },
    // đuôi (gắn sau hông)
    { name: 'tailTuft', geo: (() => { const g = new THREE.CapsuleGeometry(0.018, 0.22, 4, 8); g.translate(0, -0.13, 0); return g; })(), color: 'skin', attach: 'pelvis', local: T(0, 0.02, 0.1, -2.3), when: l => L(l).tail === 'tuft' },
    { name: 'tailTuftEnd', geo: sphere(0.045, 12, 10), color: 'mane', attach: 'pelvis', local: T(0, 0.21, 0.27), when: l => L(l).tail === 'tuft' },
    { name: 'tailBushy', geo: (() => { const g = new THREE.SphereGeometry(0.075, 16, 12); g.scale(0.9, 2.1, 0.9); g.translate(0, -0.14, 0); return g; })(), color: 'skin', attach: 'pelvis', local: T(0, 0.02, 0.1, -2.15), when: l => L(l).tail === 'bushy' },
    { name: 'tailBushyTip', geo: scaled(sphere(0.06, 14, 10), 0.95, 1.2, 0.95), color: 'fur2', attach: 'pelvis', local: T(0, 0.19, 0.31), when: l => L(l).tail === 'bushy' },
    { name: 'tailThin', geo: (() => { const g = new THREE.CapsuleGeometry(0.022, 0.26, 4, 8); g.translate(0, -0.15, 0); return g; })(), color: 'skin', attach: 'pelvis', local: T(0, 0.02, 0.1, -2.5), when: l => L(l).tail === 'thin' },
    { name: 'tailCurl', geo: new THREE.TorusGeometry(0.055, 0.028, 10, 18, Math.PI * 1.6), color: 'skin', attach: 'pelvis', local: T(0, 0.1, 0.16, 0, Math.PI / 2, 0.6), when: l => L(l).tail === 'curl' },
    { name: 'tailPuff', geo: sphere(0.06, 14, 10), color: 'fur2', attach: 'pelvis', local: T(0, 0.04, 0.13), when: l => L(l).tail === 'puff' },
    // cà vạt (đồ công sở)
    { name: 'tieKnot', geo: new THREE.BoxGeometry(0.036, 0.03, 0.02), color: 'tieC', attach: 'spine', local: T(0, 0.318, -0.112), when: l => !!L(l).necktie },
    { name: 'tieBlade', geo: (() => { const g = new THREE.ConeGeometry(0.032, 0.16, 4); g.rotateY(Math.PI / 4); g.rotateZ(Math.PI); g.scale(1, 1, 0.35); g.translate(0, -0.08, 0); return g; })(), color: 'tieC', attach: 'spine', local: T(0, 0.31, -0.118, -0.12), when: l => !!L(l).necktie },
    // trang phục
    { name: 'skirt', geo: (() => { const g = new THREE.CylinderGeometry(0.115, 0.19, 0.16, 18, 1, true); g.translate(0, -0.06, 0); return g; })(), color: 'bottom', attach: 'pelvis', local: T(0, 0.02, 0), when: l => outfit(l) === 'skirt' },
    { name: 'dress', geo: (() => { const g = new THREE.CylinderGeometry(0.12, 0.21, 0.22, 18, 1, true); g.translate(0, -0.08, 0); return g; })(), color: 'shirt', attach: 'pelvis', local: T(0, 0.04, 0), when: l => outfit(l) === 'dress' },
    { name: 'bib', geo: new THREE.BoxGeometry(0.17, 0.15, 0.025), color: 'bottom', attach: 'spine', local: T(0, 0.12, -0.112), when: l => outfit(l) === 'overalls' },
    { name: 'strap', geo: new THREE.BoxGeometry(0.03, 0.22, 0.236), color: 'bottom', attach: 'spine', side: true, local: s => T(s * 0.07, 0.24, 0.0), when: l => outfit(l) === 'overalls' },
    { name: 'hood', geo: (() => { const g = new THREE.TorusGeometry(0.1, 0.04, 8, 16, Math.PI); g.rotateX(-Math.PI / 2 + 0.4); return g; })(), color: 'shirt', attach: 'spine', local: T(0, 0.33, 0.06, 0, Math.PI), when: l => outfit(l) === 'hoodie' },
    { name: 'stripeArm', geo: new THREE.BoxGeometry(0.012, 0.16, 0.03), color: 'white', attach: 'upper', side: true, local: s => T(s * 0.058, -0.1, 0), when: l => outfit(l) === 'tracksuit' },
    { name: 'stripeLeg', geo: new THREE.BoxGeometry(0.012, 0.2, 0.03), color: 'white', attach: 'thigh', side: true, local: s => T(s * 0.074, -0.13, 0), when: l => outfit(l) === 'tracksuit' },
    { name: 'stripeShin', geo: new THREE.BoxGeometry(0.012, 0.18, 0.03), color: 'white', attach: 'shin', side: true, local: s => T(s * 0.064, -0.11, 0), when: l => outfit(l) === 'tracksuit' },
    // ---- quần áo công sở (look.collar): cổ bẻ, nẹp, cúc, viền tay áo; quần: thắt lưng, gấu quần ----
    { name: 'collarFlap', geo: (() => { const g = new THREE.BoxGeometry(0.075, 0.05, 0.012); g.translate(0.03, -0.018, 0); return g; })(), color: 'collarC', attach: 'spine', side: true, local: s => T(s * 0.012, 0.335, -0.098, 0.35, s * 0.25, s * (Math.PI / 2 + 0.55)), when: l => !!L(l).collar },
    { name: 'collarBand', geo: new THREE.TorusGeometry(0.058, 0.014, 6, 18, Math.PI * 1.25), color: 'collarC', attach: 'spine', local: T(0, 0.34, 0.004, Math.PI / 2, 0, Math.PI * 0.875), when: l => !!L(l).collar },
    { name: 'placket', geo: new THREE.BoxGeometry(0.018, 0.2, 0.006), color: 'shirt2', attach: 'spine', local: T(0, 0.2, -0.118), when: l => !!L(l).collar && !L(l).necktie },
    { name: 'button', geo: scaled(sphere(0.0085, 8, 6), 1, 1, 0.5), color: 'buttonC', attach: 'spine', local: T(0, 0.27, -0.122), when: l => !!L(l).collar && !L(l).necktie },
    { name: 'button2', geo: scaled(sphere(0.0085, 8, 6), 1, 1, 0.5), color: 'buttonC', attach: 'spine', local: T(0, 0.2, -0.124), when: l => !!L(l).collar && !L(l).necktie },
    { name: 'button3', geo: scaled(sphere(0.0085, 8, 6), 1, 1, 0.5), color: 'buttonC', attach: 'spine', local: T(0, 0.13, -0.122), when: l => !!L(l).collar && !L(l).necktie },
    { name: 'sleeveCuff', geo: new THREE.TorusGeometry(0.052, 0.009, 6, 16), color: 'shirt2', attach: 'upper', side: true, local: () => T(0, -DIM.upper + 0.035, 0, Math.PI / 2), when: l => !!L(l).collar },
    { name: 'belt', geo: scaled(new THREE.TorusGeometry(0.118, 0.016, 6, 24), 1.06, 0.8, 1), color: 'beltC', attach: 'pelvis', local: T(0, 0.07, 0, Math.PI / 2), when: l => !!L(l).collar },
    { name: 'buckle', geo: new THREE.BoxGeometry(0.034, 0.024, 0.008), color: 'buckleC', attach: 'pelvis', local: T(0, 0.07, -0.1), when: l => !!L(l).collar },
    { name: 'pantCuff', geo: new THREE.TorusGeometry(0.066, 0.012, 6, 16), color: 'cuffC', attach: 'shin', side: true, local: () => T(0, -DIM.shin + 0.035, 0, Math.PI / 2), when: l => !!L(l).collar },
    // tay chân
    { name: 'upper', geo: capsuleDown(0.058, DIM.upper - 0.075), color: 'shirt', attach: 'upper', side: true },
    { name: 'fore', geo: capsuleDown(0.05, DIM.fore - 0.08), color: 'skin', attach: 'fore', side: true },
    { name: 'hand', geo: sphere(0.056, 12, 10), color: 'skin', attach: 'fore', side: true, local: () => T(0, -DIM.fore - 0.01, 0), when: l => !L(l).species },
    // bàn chân thú: tròn to hơn, ba ngón nhô ở đầu
    { name: 'paw', geo: scaled(sphere(0.064, 16, 12), 1, 0.9, 0.92), color: 'skin', attach: 'fore', side: true, local: () => T(0, -DIM.fore - 0.015, 0), when: l => !!L(l).species },
    { name: 'toe', geo: sphere(0.02, 8, 6), color: 'skin', attach: 'fore', side: true, local: () => T(0, -DIM.fore - 0.07, -0.025), when: l => !!L(l).species },
    { name: 'toe2', geo: sphere(0.02, 8, 6), color: 'skin', attach: 'fore', side: true, local: () => T(0.028, -DIM.fore - 0.064, -0.02), when: l => !!L(l).species },
    { name: 'toe3', geo: sphere(0.02, 8, 6), color: 'skin', attach: 'fore', side: true, local: () => T(-0.028, -DIM.fore - 0.064, -0.02), when: l => !!L(l).species },
    { name: 'thigh', geo: capsuleDown(0.074, DIM.thigh - 0.1), color: 'thighC', attach: 'thigh', side: true },
    { name: 'shin', geo: capsuleDown(0.064, DIM.shin - 0.09), color: 'shinC', attach: 'shin', side: true },
    { name: 'foot', geo: (() => { const g = new THREE.CapsuleGeometry(0.056, 0.08, 4, 10); g.rotateX(Math.PI / 2); g.scale(1.05, 0.72, 1); g.translate(0, -0.035, -0.04); return g; })(), color: 'shoe', attach: 'ankle', side: true },
    // giày thể thao: đế dày bo tròn (trắng), mũi giày
    { name: 'sole', geo: (() => { const g = new THREE.CapsuleGeometry(0.06, 0.09, 4, 12); g.rotateX(Math.PI / 2); g.scale(1.12, 0.32, 1.04); g.translate(0, -0.066, -0.042); return g; })(), color: 'sole', attach: 'ankle', side: true },
    { name: 'toeCap', geo: scaled(sphere(0.045, 12, 8), 1.15, 0.6, 0.8), color: 'sole', attach: 'ankle', side: true, local: () => T(0, -0.045, -0.115) },
    // logo SYSONE in trên ngực áo (ảnh gốc), có nền trắng khi áo tối màu
    { name: 'logoPatch', geo: new THREE.BoxGeometry(0.235, 0.048, 0.004), color: 'patch', attach: 'spine', local: T(0, 0.245, -0.116), when: l => !L(l).necktie && !L(l).collar },
    { name: 'shirtLogo', geo: (() => { const g = new THREE.PlaneGeometry(0.22, 0.22 * 171 / 1296); g.rotateY(Math.PI); return g; })(), color: 'white', mat: 'logo', attach: 'spine', local: T(0, 0.245, -0.1195), when: l => !L(l).necktie && !L(l).collar },
    // áo sơ mi / đeo cà vạt: logo nhỏ ở ngực trái (bên trái nhân vật là -x khi nhìn về -z)
    { name: 'logoPatchL', geo: new THREE.BoxGeometry(0.105, 0.026, 0.004), color: 'white', attach: 'spine', local: T(-0.072, 0.27, -0.114, 0, -0.25), when: l => !!L(l).necktie || !!L(l).collar },
    { name: 'shirtLogoL', geo: (() => { const g = new THREE.PlaneGeometry(0.095, 0.095 * 171 / 1296); g.rotateY(Math.PI); return g; })(), color: 'white', mat: 'logo', attach: 'spine', local: T(-0.072, 0.27, -0.1175, 0, -0.25), when: l => !!L(l).necktie || !!L(l).collar },
    // đạo cụ cầm ở tay phải
    { name: 'cup', geo: new THREE.CylinderGeometry(0.035, 0.03, 0.09, 12), color: 'white', attach: 'fore', rightOnly: true, local: T(0, -DIM.fore - 0.02, -0.05), when: (l, a) => a.cup || a.act === 'drink' || a.anim === 'eat' },
    { name: 'cig', geo: (() => { const g = new THREE.CylinderGeometry(0.006, 0.006, 0.075, 6); g.rotateX(Math.PI / 2); return g; })(), color: 'white', attach: 'fore', rightOnly: true, local: T(0.02, -DIM.fore - 0.03, -0.05), when: (l, a) => a.act === 'smoke' },
    { name: 'cigTip', geo: sphere(0.008, 6, 5), color: 'ember', attach: 'fore', rightOnly: true, local: T(0.02, -DIM.fore - 0.03, -0.088), when: (l, a) => a.act === 'smoke' },
    { name: 'phone', geo: new THREE.BoxGeometry(0.04, 0.11, 0.012), color: 'phone', attach: 'fore', rightOnly: true, local: T(0, -DIM.fore - 0.03, -0.03), when: (l, a) => a.act === 'phone' }
  ];
}

// ảnh gốc của logo (public/logo/sysone-logo.png), dùng chung cho mọi nhân vật
let _logoTex = null;
function logoTexture() {
  if (!_logoTex) {
    _logoTex = new THREE.TextureLoader().load(new URL('logo/sysone-logo.png', document.baseURI).href);
    _logoTex.colorSpace = THREE.SRGBColorSpace; _logoTex.anisotropy = 8;
  }
  return _logoTex;
}

// ---------- chuyển động người thật (mocap) → khớp chibi ----------
const MQ = Array.from({ length: 13 }, () => new THREE.Quaternion()), _pq = new THREE.Quaternion(), _pq2 = new THREE.Quaternion();
const MP = { pelvis: new THREE.Vector3(), spine: new THREE.Vector3(), head: new THREE.Vector3(), upper: [new THREE.Vector3(), new THREE.Vector3()], fore: [new THREE.Vector3(), new THREE.Vector3()], thigh: [new THREE.Vector3(), new THREE.Vector3()], shin: [new THREE.Vector3(), new THREE.Vector3()], ankle: [new THREE.Vector3(), new THREE.Vector3()] };
const _o = new THREE.Vector3(), _hp = new THREE.Vector3();
const ANKLE_Y = DIM.hip - DIM.thigh - DIM.shin; // độ cao mắt cá khi đứng thẳng (đáy giày chạm sàn)
/** Đặt ma trận các khớp chibi từ tư thế mocap; tay có thể trộn với tư thế tự dựng P (gõ phím, vẫy…). */
// dáng thú bông (look.build 'plush', giống nhân vật demo): chân ngắn mập, tay ngắn, thân tròn, đầu to
const BUILDS = { plush: { legK: 0.7, legT: 1.3, armK: 0.85, armT: 1.3, bodyT: 1.12, headK: 1.15 } };
const NORMAL_BUILD = { legK: 1, legT: 1, armK: 1, armT: 1, bodyT: 1, headK: 1 };
const _sc = { leg: new THREE.Vector3(), arm: new THREE.Vector3(), body: new THREE.Vector3(), head: new THREE.Vector3() };
function mocapJoints(J, mc, P, a, s, look) {
  for (let k = 0; k < 13; k++) segQuat(mc, k, MQ[k]);
  const sit = a.sit || 0, B = BUILDS[look?.build] || NORMAL_BUILD;
  const hipK = (DIM.thigh + DIM.shin) * B.legK + ANKLE_Y; // chiều cao hông theo độ dài chân
  // hông: theo mocap (đơn vị chiều cao hông); ngồi thì về đúng mặt ghế như tư thế tự dựng
  const hp = _hp.set(mc.hip[0] * hipK, mc.hip[1] * hipK, mc.hip[2] * hipK);
  if (sit > 0) hp.lerp(_o.set(0, P.hipY - (DIM.hip - hipK) * 0.5, P.pz / s), Math.min(1, sit));
  const qP = MQ[SEG.pelvis], qS = MQ[SEG.spine];
  MP.pelvis.copy(hp);
  MP.spine.copy(_o.set(0, DIM.spine, 0).applyQuaternion(qP)).add(MP.pelvis);
  MP.head.copy(_o.set(0, DIM.neck, 0).applyQuaternion(qS)).add(MP.spine);
  for (let k = 0; k < 2; k++) {
    const sx = k === 0 ? -1 : 1, U = MQ[k ? SEG.upperR : SEG.upperL], F = MQ[k ? SEG.foreR : SEG.foreL];
    // tay tự dựng (theo khung ngực mocap), trộn theo trọng số
    const w = mc.armW[k];
    if (w > 0.001) {
      _pq.copy(qS).multiply(_q.setFromEuler(_e.set(P.shP[k], 0, sx * Math.abs(P.shR[k]), 'YXZ')));
      _pq2.copy(_pq).multiply(_q.setFromEuler(_e.set(P.el[k], 0, 0, 'YXZ')));
      U.slerp(_pq, w); F.slerp(_pq2, w);
    }
    MP.upper[k].copy(_o.set(sx * DIM.shoulderX * B.bodyT, 0.29, 0).applyQuaternion(qS)).add(MP.spine);
    MP.fore[k].copy(_o.set(0, -DIM.upper * B.armK, 0).applyQuaternion(U)).add(MP.upper[k]);
    MP.thigh[k].copy(_o.set(sx * DIM.hipX * B.bodyT, 0, 0).applyQuaternion(qP)).add(MP.pelvis);
    MP.shin[k].copy(_o.set(0, -DIM.thigh * B.legK, 0).applyQuaternion(MQ[k ? SEG.thighR : SEG.thighL])).add(MP.thigh[k]);
    MP.ankle[k].copy(_o.set(0, -DIM.shin * B.legK, 0).applyQuaternion(MQ[k ? SEG.shinR : SEG.shinL])).add(MP.shin[k]);
  }
  // chân chibi ngắn hơn người thật: đẩy cả người lên/xuống để chân trụ chạm sàn (đứng; không áp khi ngồi/nhảy)
  if ((a.jumpH || 0) < 0.015) {
    const dy = (ANKLE_Y - Math.min(MP.ankle[0].y, MP.ankle[1].y)) * (1 - Math.min(1, sit));
    for (const v of [MP.pelvis, MP.spine, MP.head, ...MP.upper, ...MP.fore, ...MP.thigh, ...MP.shin, ...MP.ankle]) v.y += dy;
  }
  const put = (out, pos, q, sc = _one) => out.compose(pos, q, sc).premultiply(J.root);
  // tỉ lệ dáng: co giãn ma trận khớp → mọi bộ phận gắn vào khớp (gấu quần, viền tay áo, cà vạt…) co giãn theo
  const sLeg = _sc.leg.set(B.legT, B.legK, B.legT), sArm = _sc.arm.set(B.armT, B.armK, B.armT), sBody = _sc.body.set(B.bodyT, 1, B.bodyT), sHead = _sc.head.copy(HEAD_SCALE).multiplyScalar(B.headK);
  put(J.pelvis, MP.pelvis, qP, sBody); put(J.spine, MP.spine, qS, sBody); put(J.head, MP.head, MQ[SEG.head], sHead);
  for (let k = 0; k < 2; k++) {
    put(J.upper[k], MP.upper[k], MQ[k ? SEG.upperR : SEG.upperL], sArm); put(J.fore[k], MP.fore[k], MQ[k ? SEG.foreR : SEG.foreL], sArm);
    put(J.thigh[k], MP.thigh[k], MQ[k ? SEG.thighR : SEG.thighL], sLeg); put(J.shin[k], MP.shin[k], MQ[k ? SEG.shinR : SEG.shinL], sLeg);
    put(J.ankle[k], MP.ankle[k], MQ[k ? SEG.ankleR : SEG.ankleL]);
  }
}

// nhân viên mô phỏng → cấu hình my-office (màu áo/tóc/kiểu theo ngoại hình sẵn có hoặc theo id)
const STAFF_SHIRTS = ['#E76F51', '#5F8FD8', '#2A9D8F', '#F4A261', '#8E7CC3', '#E9C46A', '#6BA368', '#D46A92'];
const STAFF_HAIR = ['plain', 'bob', 'spiky', 'ponytail', 'bun', 'curly'];
/** Màu áo đang mặc của một người (nhân viên mô phỏng, người chơi, người online) — ghế của họ đổi theo màu này như my-office. */
export function shirtColorOf(a, def = null) {
  const L = a?.emp?.look || {};
  if (L.topColor) return L.topColor;
  if (L.shirt) return L.shirt;
  if (a?.local || a?.key) return def?.look?.shirt || '#5F8FD8';
  const h = [...String(a?.id ?? a?.idx ?? 0)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  return STAFF_SHIRTS[h % STAFF_SHIRTS.length];
}
export function staffConfig(a, def) {
  const L = a?.emp?.look || {}, h = [...String(a?.id ?? a?.idx ?? 0)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  const long = ['long', 'bob', 'ponytail', 'bun', 'pigtails', 'spacebuns'].includes(L.hairStyle);
  return { look: def.look?.style === 'toy' ? 'toy' : 'pixar', name: 'staff' + h, shirt: L.shirt || STAFF_SHIRTS[h % STAFF_SHIRTS.length], pants: L.pants || '#3A4150',
    hair: L.hair, skin: L.skin, style: long ? (['bob', 'ponytail', 'bun'][h % 3]) : STAFF_HAIR[h % STAFF_HAIR.length], outfit: h % 5 === 0 ? 'suit' : h % 2 ? 'hoodie' : 'shirt',
    acc: L.glasses ? 'glasses' : (h % 7 === 0 ? 'headphones' : null) };
}

// Cấp chi tiết khi đông người (100 người online): chỉ ~N người gần camera nhất được dựng nhân vật 3D đầy đủ (mỗi người
// ~4 MB bộ nhớ, ~7 lệnh vẽ, ~9 nghìn tam giác); người xa hơn vẽ bằng hình pixel phẳng (2 lệnh vẽ, gần như không tốn bộ nhớ).
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sp = new THREE.Sphere(), _v2 = new THREE.Vector3();
export const LOD_NEAR = { phone: 10, low: 12, desktop: 36 };

export class AvatarSystem {
  /** opts.scale: tỉ lệ nhân vật (layout.json → scale.character); opts.seatH: cao độ khớp hông khi ngồi (theo ghế đã thu nhỏ). */
  constructor(scene, capacity, quality = 'high', opts = {}) {
    this.capacity = capacity;
    this.near = COARSE ? LOD_NEAR.phone : quality === 'low' ? LOD_NEAR.low : LOD_NEAR.desktop;
    this.scale = opts.scale ?? 1; this.seatH = opts.seatH ?? 0.53;
    this.group = new THREE.Group(); this.group.name = 'avatars';
    scene.add(this.group);
    this.parts = partDefs();
    this.meshes = {};
    // toon sáng hơn Lambert ở phần lớn bề mặt: hạ màu gốc để da/áo sáng màu không bị cháy trắng dưới đèn văn phòng
    // kiểu mặc định: vinyl / thú bông (giống bản demo), không viền; opts.style 'toon' giữ kiểu hoạt hình có viền mực cũ
    const toon = opts.style === 'toon';
    const mat = toon ? characterToon() : characterVinyl();
    const outline = toon && quality !== 'low' ? outlineMaterial(0.011) : null;
    const noShadow = new Set(['eye', 'eyeBig', 'eyeHi', 'eyeSmile', 'brow', 'browThick', 'blush', 'mouthSmile', 'mouthGrin', 'mouthLine', 'mouthO', 'nose', 'glassRing', 'glassBridge', 'cigTip', 'logoPatch', 'shirtLogo']);
    const logoMat = new THREE.MeshLambertMaterial({ map: logoTexture(), transparent: true, alphaTest: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const p of this.parts) {
      const n = Math.max(1, capacity * (p.side ? 2 : 1));
      const im = new THREE.InstancedMesh(p.geo, p.mat === 'logo' ? logoMat : mat, n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = quality !== 'low' && !noShadow.has(p.name);
      im.frustumCulled = false;
      im.userData.part = p.name; im.userData.per = !!p.side;
      for (let i = 0; i < n; i++) im.setMatrixAt(i, HIDE);
      this.group.add(im); this.meshes[p.name] = im; p.mesh = im;
      if (outline && !NO_OUTLINE.has(p.name) && p.mat !== 'logo') {
        // viền dùng chung ma trận các bản sao với bộ phận (ẩn/hiện, cử động theo cùng)
        const ol = new THREE.InstancedMesh(p.geo, outline, n); ol.instanceMatrix = im.instanceMatrix; ol.frustumCulled = false; ol.userData.outline = true;
        this.group.add(ol); p.outline = ol;
      }
      // chuẩn hóa ma trận cục bộ thành hàm (tính sẵn cho hai bên)
      if (p.local instanceof THREE.Matrix4) { const m = p.local; p.local = () => m; }
      else if (p.local && p.side) { const f = p.local, mats = { [-1]: f(-1), 1: f(1) }; p.local = s => mats[s]; }
      else if (p.local) { const m = p.local(); p.local = () => m; }
    }
    this.glb = new GlbPool(this.group); // nhân vật 3D làm sẵn (GLB)
    this.vrm = new LazyPool(() => import('./vrmCharacters.js').then(m => m.VrmPool), this.group); // nhân vật VRM (xương chuẩn, biểu cảm, vật lý tóc)
    this.rigged = new LazyPool(() => import('./riggedCharacters.js').then(m => m.RiggedPool), this.group); // nhân vật GLB có sẵn bộ xương (gấu trúc, thỏ…)
    this.mo = new MoPool(this.group); // nhân vật kiểu my-office (chibi đồ chơi / hoạt hình)
    this.moStaff = opts.moStaff ?? null; // định nghĩa nhân vật my-office cho nhân viên mô phỏng (null = chibi cũ)
    this.mocap = opts.mocap !== false; if (this.mocap && typeof window !== 'undefined') loadMocap(); // chuyển động người thật
    this.pixel = new PixelBillboards(this.group); // nhân vật pixel (người dùng thật) — sprite quay về camera
    const M = () => new THREE.Matrix4();
    this.J = { root: M(), pelvis: M(), spine: M(), head: M(), upper: [M(), M()], fore: [M(), M()], thigh: [M(), M()], shin: [M(), M()], ankle: [M(), M()] };
  }

  setColors(agents) {
    const c = new THREE.Color();
    agents.forEach((a, i) => {
      if (i >= this.capacity) return;
      const L = lookOf(a);
      const shirt = new THREE.Color(L.shirt || '#3a6aa8'), skin = new THREE.Color(L.skin || '#ecc9a8'), hair = new THREE.Color(L.hair || '#1d1a17');
      const col = {
        shirt, shirt2: shirt.clone().multiplyScalar(0.8), pants: L.pants || '#2d3440', skin, skinDark: skin.clone().multiplyScalar(0.92),
        hair, brow: hair.clone().multiplyScalar(0.85), eye: L.eyeColor || '#20160f', white: '#ffffff', mouth: '#8a2f35', blush: '#f2a1a1',
        pupil: '#0d0b0a', tie: L.hatColor || '#e0577a',
        bottom: L.pants || '#2d3440', pelvisC: L.outfit === 'dress' ? shirt : L.outfit === 'tracksuit' ? shirt : (L.pants || '#2d3440'),
        // váy, chân váy: chân để trần; quần short: cẳng chân trần; còn lại theo màu quần (đồ thể thao: cùng màu áo)
        thighC: ['dress', 'skirt'].includes(L.outfit) ? skin : L.outfit === 'tracksuit' ? shirt : (L.pants || '#2d3440'),
        shinC: ['dress', 'skirt', 'shorts'].includes(L.outfit) ? skin : L.outfit === 'tracksuit' ? shirt : (L.pants || '#2d3440'),
        // con vật: lông phụ (mõm, lòng tai, ngực), mũi, bờm, mảng tối (sọc, mảng mắt, chóp tai), màu tai, cà vạt
        collarC: L.collarColor || '#f6f6f2', buttonC: L.buttonColor || '#e8e4dc', beltC: L.belt || '#3a2a20', buckleC: '#c9a227', cuffC: new THREE.Color(L.pants || '#2d3440').multiplyScalar(0.8), sole: L.sole || '#f2f2ee',
        fur2: L.fur2 || '#f4efe6', nose: L.nose || '#3a2a24', mane: L.mane || L.hair || '#8a4a1e', dark: L.dark || '#2b2d42', earC: L.earColor || L.skin || '#ecc9a8', tieC: L.tie || '#b8322e',
        shoe: L.shoes || '#1b1b1d', patch: (shirt.r * 0.299 + shirt.g * 0.587 + shirt.b * 0.114) < 0.45 ? '#ffffff' : shirt, glass: '#18191c', hat: L.hatColor || '#c2402f', ember: '#ff7a1a', phone: '#16181c'
      };
      for (const p of this.parts) {
        c.set(col[p.color] ?? '#ff00ff');
        if (p.side) { p.mesh.setColorAt(i * 2, c); p.mesh.setColorAt(i * 2 + 1, c); } else p.mesh.setColorAt(i, c);
      }
    });
    for (const p of this.parts) if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
  }

  /** Góc khớp theo trạng thái: sit (0..1), walkAmt (0..1, tới 2 khi chạy), anim (type/talk/cup/eat/pour), act (động tác người chơi). */
  /**
   * Tư thế của một nhân vật. unit: số mét thế giới trên một đơn vị khung xương; leg: kích thước chân theo đơn vị đó
   * (mặc định là chibi). Dáng đi tính bằng quỹ đạo bàn chân + IK hai khớp nên chân trụ không trượt trên sàn.
   */
  pose(a, scale = 1, leg = CHIBI_LEG) {
    const sit = a.sit || 0, t = a.animT || 0, u = leg.hip / DIM.hip; // u: quy đổi các biên độ viết theo chibi
    const g = gaitMotion(a, scale, leg);
    const P = { hipY: leg.hip, pz: 0, lean: 0, spineYaw: 0, headYaw: 0, headPitch: 0, headRoll: 0, pelvisYaw: 0, bank: 0, hip: [0, 0], knee: [0, 0], shP: [0, 0], shR: [0.12, 0.12], el: [0.15, 0.15] };
    const G = gaitLegs(g, scale, leg, 1 - sit); a._gl = G;
    const w = G.w, run = G.run;
    P.hip = G.hip; P.knee = G.knee; P.hipY = G.hipY; P.legRoll = G.roll;
    // tay đánh ngược chân cùng bên; chạy thì gập khuỷu ~90° và đánh mạnh hơn
    const armA = (0.38 + 0.4 * run) * w;
    P.shP = [-armA * G.ff[0] + 0.12 * run * w, -armA * G.ff[1] + 0.12 * run * w];
    P.el = G.ff.map(f => 0.18 + (0.25 + 0.15 * Math.max(0, f)) * w + 1.05 * run * w);
    P.shR = [0.12 + 0.06 * run * w, 0.12 + 0.06 * run * w];
    // hông xoay theo chân bước, vai xoay ngược lại, đầu giữ nhìn thẳng
    P.pelvisYaw = G.pelvisYaw;
    P.spineYaw = -1.7 * P.pelvisYaw;
    P.headYaw = -(P.pelvisYaw + P.spineYaw) * 0.9;
    // ngả người theo tốc độ và gia tốc, nghiêng vào trong khi rẽ
    const accLean = Math.max(-0.12, Math.min(0.22, g.acc / 9.8 * 0.9)) * (1 - sit);
    P.lean = (0.04 + 0.17 * run) * w + accLean;
    P.bank = Math.max(-0.22, Math.min(0.22, g.turn * g.v / Math.max(0.05, leg.hip * scale) * 0.035)) * (1 - sit);
    P.headPitch = -0.55 * P.lean; P.headRoll = -0.5 * P.bank;
    if (sit > 0) {
      const seatH = this.seatH / scale;
      P.hipY += (seatH - P.hipY) * sit; P.pz = 0.06 * sit;
      P.pelvisYaw *= 1 - sit; P.spineYaw *= 1 - sit; P.headYaw *= 1 - sit; P.legRoll = P.legRoll.map(v => v * (1 - sit));
      P.hip = P.hip.map(v => v + (Math.PI / 2 - v) * sit);
      P.knee = P.knee.map(v => v + (Math.PI / 2 - v) * sit);
      P.lean += (0.08 - P.lean) * sit;
    }
    const anim = a.anim;
    if (sit > 0.5 && anim === 'type' && !a.act) {
      const k = (sit - 0.5) * 2, tap = Math.sin(t * 13), tap2 = Math.sin(t * 11 + 1.3);
      P.shP = [1.0 * k, 1.0 * k]; P.shR = [0.25, 0.25]; P.el = [0.55 * k + 0.05 * tap, 0.55 * k + 0.05 * tap2];
      P.headPitch = 0.08 + 0.03 * Math.sin(t * 0.7); P.headYaw = 0.08 * Math.sin(t * 0.31); P.lean = 0.12;
    } else if (anim === 'talk' && !a.act) {
      const g = Math.max(0, Math.sin(t * 0.9 + (a.idx || 0))) ** 3;
      P.headYaw = 0.45 * Math.sin(t * 0.35 + (a.idx || 0) * 1.7);
      P.shP = [0.6 + 0.5 * g, 0.5]; P.el = [0.9 + 0.5 * g * Math.sin(t * 5), 0.8]; P.shR = [0.2, 0.2];
    } else if ((anim === 'cup' || anim === 'eat' || anim === 'pour') && !a.act) {
      const sip = anim === 'pour' ? 0 : Math.max(0, Math.sin(t * 0.5 + (a.idx || 0))) ** 8;
      P.shP = [P.shP[0], 0.6 + 0.9 * sip]; P.el = [P.el[0], 1.6 + 0.7 * sip]; P.headPitch = -0.15 * sip;
    } else if (!a.act && sit < 0.05 && w < 0.05 && !g.settle) {
      // đứng yên: thở, dồn trọng tâm qua lại, nhìn quanh
      const br = Math.sin(t * 2.1 + (a.idx || 0)), sway = Math.sin(t * 0.45 + (a.idx || 0) * 2.3);
      P.headYaw = 0.25 * Math.sin(t * 0.21 + (a.idx || 0)); P.headRoll = 0.04 * Math.sin(t * 0.5);
      P.lean += 0.012 * br; P.shR = [0.12 + 0.015 * br, 0.12 + 0.015 * br]; P.hipY -= 0.004 * u * (1 + br);
      P.bank += 0.025 * sway; P.hip = [P.hip[0] + 0.03 * sway, P.hip[1] - 0.03 * sway]; P.knee = [P.knee[0] + 0.05 * Math.max(0, sway), P.knee[1] + 0.05 * Math.max(0, -sway)];
      P.shP = [0.03 * Math.sin(t * 0.7), -0.03 * Math.sin(t * 0.7)];
    }
    // nhún khi vừa tiếp đất
    if (a.landT !== undefined && a.landT < 0.18 && !sit) { const q = 1 - a.landT / 0.18; P.hipY -= 0.06 * u * q; P.hip = P.hip.map(v => v + 0.35 * q); P.knee = P.knee.map(v => v + 0.7 * q); P.lean += 0.15 * q; }
    // động tác người chơi (chỉ số 1 = tay phải)
    const at = a.actT || 0;
    switch (a.act) {
      case 'wave': P.shP[1] = 0.4; P.shR[1] = 2.5; P.el[1] = 0.6 + 0.5 * Math.sin(at * 10); P.headRoll = 0.12; break;
      case 'smoke': {
        const puff = Math.max(0, Math.sin(at * 0.9)) ** 6;
        P.shP[1] = 0.45 + 0.75 * puff; P.shR[1] = 0.25 + 0.15 * puff; P.el[1] = 1.4 + 1.1 * puff; P.headPitch = -0.08 * puff;
        if (sit < 0.5) { P.shP[0] = 0.15; P.el[0] = 1.5; P.shR[0] = 0.35; } // tay trái chống hông
        break;
      }
      case 'drink': { const sip = Math.max(0, Math.sin(at * 1.2)) ** 6; P.shP[1] = 0.6 + 0.9 * sip; P.el[1] = 1.6 + 0.8 * sip; P.headPitch = -0.2 * sip; break; }
      case 'phone': P.shP[1] = 0.35; P.shR[1] = 0.55; P.el[1] = 2.6; P.headRoll = 0.15; P.headYaw = 0.2 * Math.sin(at * 0.6); P.shP[0] = 0.2 * Math.sin(at * 1.5); P.el[0] = 0.5 + 0.3 * Math.sin(at * 1.5); break;
      case 'dance': {
        const b = Math.sin(at * 7);
        P.shP = [0.8 + 0.6 * b, 0.8 - 0.6 * b]; P.shR = [1.6, 1.6]; P.el = [0.8, 0.8];
        P.spineYaw = 0.35 * Math.sin(at * 3.5); P.headRoll = 0.15 * b; P.hipY -= 0.04 * u * (1 + b) * (1 - sit);
        if (sit < 0.5) { P.hip = [0.3 * Math.max(0, b), 0.3 * Math.max(0, -b)]; P.knee = [0.6 * Math.max(0, b), 0.6 * Math.max(0, -b)]; }
        break;
      }
      case 'jump': {
        const k = Math.min(1, at / 0.12) * Math.max(0, 1 - Math.max(0, at - 0.45) / 0.2);
        P.hip = [0.6 * k, 0.6 * k]; P.knee = [1.0 * k, 1.0 * k]; P.shP = [1.1 * k, 1.1 * k]; P.shR = [0.35 * k + 0.12, 0.35 * k + 0.12]; P.el = [0.6 * k, 0.6 * k]; // vung tay lên trước lấy đà, khuỷu hơi gập
        break;
      }
    }
    return P;
  }

  /** Ẩn suất chibi dùng chung thứ i (bỏ qua nếu đã ẩn: đông người thì đỡ ~6.000 lần ghi ma trận mỗi khung hình). */
  hideAt(i) {
    const h = (this._hid ||= []); if (h[i]) return; h[i] = true;
    for (const p of this.parts) { if (p.side) { p.mesh.setMatrixAt(i * 2, HIDE); p.mesh.setMatrixAt(i * 2 + 1, HIDE); } else p.mesh.setMatrixAt(i, HIDE); }
  }
  /** Người ở tầng khác tầng mình đang đứng (không đứng trên cầu thang): bị sàn che, không cần vẽ. */
  otherFloor(a, floor) { return floor != null && !a.local && a.onStair == null && (a.f ?? 0) !== floor; }
  /** Tập người được vẽ 3D đầy đủ (null = không giới hạn): this.near người gần camera nhất, xếp lại ~3 lần/giây; người
   *  đang được vẽ đầy đủ được ưu tiên giữ (tránh nhấp nháy đổi qua lại khi hai người cách camera gần bằng nhau). */
  nearSet(agents, n, floor) {
    let count = 0; for (let i = 0; i < n; i++) { const a = agents[i]; if (a && a.visible && !this.otherFloor(a, floor)) count++; }
    if (count <= this.near) { this._full = null; return null; }
    const now = performance.now();
    if (this._full && now - (this._lodT || 0) < 330) return this._full;
    this._lodT = now;
    const camera = billboardCamera(), cam = camera?.position, cand = [];
    // người ngoài khung nhìn (sau lưng camera…) xếp sau cùng: suất 3D dành cho người đang nhìn thấy
    if (camera) { camera.updateMatrixWorld(); _fr.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); }
    for (let i = 0; i < n; i++) {
      const a = agents[i]; if (!a || !a.visible || this.otherFloor(a, floor)) continue;
      let d = a.local ? -1 : cam ? (cam.x - a.x) ** 2 + (cam.y - a.y) ** 2 + (cam.z - a.z) ** 2 : i;
      if (camera && d > 0 && !_fr.intersectsSphere(_sp.set(_v2.set(a.x, a.y + 0.8, a.z), 1))) d += 1e6;
      if (d > 0 && this._full?.has(a)) d *= 0.6;
      cand.push([d, a]);
    }
    cand.sort((p, q) => p[0] - q[0]);
    return (this._full = new Set(cand.slice(0, this.near).map(c => c[1])));
  }

  update(agents, opts = {}) {
    const J = this.J, hiddenY = opts.hideAbove;
    // chỉ vẽ đúng số nhân vật đang có (không vẽ các suất dự phòng)
    const n = Math.min(this.capacity, agents.length);
    for (const p of this.parts) { p.mesh.count = n * (p.side ? 2 : 1); p.mesh.visible = n > 0; if (p.outline) { p.outline.count = p.mesh.count; p.outline.visible = n > 0 && OUTLINE.on; } }
    this.glb.begin(); this.pixel.begin(); this.vrm.begin(); this.rigged.begin(); this.mo.begin();
    let instUsed = 0; // số người vẽ bằng chibi dùng chung mesh (còn lại: chibi my-office, pixel…)
    const full = this.nearSet(agents, n, opts.floor);
    // đầu tự quay nhìn người ở gần (mỗi 0,3 s): người gần nhất trong 2,5 m, phía trước (±100°)
    { const now = performance.now(); if (now - (this._lookT || 0) > 300) { this._lookT = now;
      for (let i = 0; i < n; i++) { const a = agents[i]; if (!a) continue; let best = 6.25, yaw = 0;
        for (let j = 0; j < n; j++) { const b = agents[j]; if (!b || b === a || !b.visible || (b.f ?? 0) !== (a.f ?? 0)) continue;
          const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz; if (d2 > best || d2 < 0.04) continue;
          let rel = Math.atan2(-dx, -dz) - a.yaw; rel = ((rel + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          if (Math.abs(rel) > 1.75) continue; best = d2; yaw = Math.max(-0.9, Math.min(0.9, rel)); }
        a._lookYaw = yaw; } } }
    for (let i = 0; i < n; i++) {
      const a = agents[i];
      const show = a && a.visible && !a._fpHide && !(hiddenY != null && a.y > hiddenY) && !this.otherFloor(a, opts.floor);
      // nhân vật chọn model GLB: vẽ bằng SkinnedMesh (khi model chưa tải xong thì tạm vẽ chibi)
      // người dùng thật (có key): nhân vật pixel (sprite quay về camera); model 3D chỉ khi chọn rõ; nhân viên mô phỏng: chibi
      const mid = show && a.emp && a.emp.look && a.emp.look.model;
      // nhân vật my-office: người chơi chọn (format 'mo'), hoặc nhân viên mô phỏng khi bật moStaff
      {
        const md = mid && characterDef(mid), staffMo = !a?.key && !mid && this.moStaff && VIEW.mode === '3d';
        if (show && VIEW.mode === '3d' && ((md && md.format === 'mo') || staffMo) && full && !full.has(a)) {   // (ở xa khi đông người: hình pixel)
          this.pixel.draw(a, (a.emp?.look?.height || 1) * this.scale);
          this.hideAt(i);
          continue;
        }
        if (show && VIEW.mode === '3d' && ((md && md.format === 'mo') || staffMo)) {
          const def = md && md.format === 'mo' ? md : this.moStaff;
          const cfg = md && md.format === 'mo' ? moConfig(def, a.emp.look, a.key) : staffConfig(a, def);
          const nowS = performance.now() / 1000, dt = Math.min(0.1, Math.max(0, nowS - (a._mcNow ?? nowS))); a._mcNow = nowS;
          gaitMotion(a, (a.emp?.look?.height || 1) * this.scale, CHIBI_LEG); // pha bước theo quãng đường thật (chân không trượt)
          this.mo.get(a, def, cfg).apply(a, (a.emp?.look?.height || 1) * this.scale, this.seatH, dt);
          this.hideAt(i);
          continue;
        }
      }
      const cdef = mid && characterDef(mid), isVrm = cdef && (cdef.format === 'vrm' || cdef.format === 'rigged') && VIEW.mode === '3d';
      // VRM / có xương sẵn: chưa tải xong (hoặc chưa có dữ liệu chuyển động) thì ẩn hẳn — không vẽ chibi tạm (trông như bộ xương trắng)
      const vi = isVrm ? (cdef.format === 'vrm' ? this.vrm : this.rigged).get(a, cdef) : null;
      if (isVrm && (!vi || !(this.mocap && MOCAP.ready))) {
        if (vi) vi.group.visible = false;
        this.hideAt(i);
        continue;
      }
      const gi = vi || (cdef && !isVrm && !['vrm', 'rigged', 'chibi', 'mo'].includes(cdef.format) ? this.glb.get(a, mid) : null);
      const px = !gi && show && a.key && VIEW.mode === '2d' && this.pixel.draw(a, (a.emp?.look?.height || 1) * this.scale);
      if (px) { this.hideAt(i); continue; }
      if (gi) {
        const s = (a.emp?.look?.height || 1) * this.scale, u = gi.unit(s), P = this.pose(a, u, gi.leg);
        const nowS = performance.now() / 1000, dt = Math.min(0.1, Math.max(0, nowS - (a._mcNow ?? nowS))); a._mcNow = nowS;
        const mc = this.mocap && MOCAP.ready && mocapPose(a, a._g ? a._g.v : 0, gi.leg.hip * u, dt);
        if (vi) vi.apply(a, P, s, mc, dt);
        else if (mc) gi.applyMocap(a, P, s, mc); else gi.apply(a, P, s);
      }
      if (!show || gi) {
        this.hideAt(i);
        continue;
      }
      instUsed++; if (this._hid) this._hid[i] = false;
      const look = lookOf(a);
      const s = (look.height || 1) * this.scale, P = this.pose(a, s);
      J.root.compose(_v.set(a.x, a.y + (a.jumpH || 0), a.z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.yaw), new THREE.Vector3(s, s, s));
      const nowS = performance.now() / 1000, dt = Math.min(0.1, Math.max(0, nowS - (a._mcNow ?? nowS))); a._mcNow = nowS;
      const mc = this.mocap && MOCAP.ready && mocapPose(a, a._g ? a._g.v : 0, DIM.hip * s, dt);
      if (mc) mocapJoints(J, mc, P, a, s, look);
      else {
        joint(J.root, 0, P.hipY, P.pz / s, 0, P.pelvisYaw, P.bank, J.pelvis);
        joint(J.pelvis, 0, DIM.spine, 0, -P.lean, P.spineYaw, 0, J.spine);
        joint(J.spine, 0, DIM.neck, 0, -P.headPitch, P.headYaw, P.headRoll, J.head, HEAD_SCALE);
        for (let k = 0; k < 2; k++) {
          const sx = k === 0 ? -1 : 1;
          joint(J.spine, sx * DIM.shoulderX, 0.29, 0, P.shP[k], 0, sx * Math.abs(P.shR[k]), J.upper[k]);
          joint(J.upper[k], 0, -DIM.upper, 0, P.el[k], 0, 0, J.fore[k]);
          joint(J.pelvis, sx * DIM.hipX, 0, 0, P.hip[k], -P.pelvisYaw, P.legRoll[k], J.thigh[k]); // đùi giữ hướng đi dù hông xoay
          joint(J.thigh[k], 0, -DIM.thigh, 0, -P.knee[k], 0, 0, J.shin[k]);
          joint(J.shin[k], 0, -DIM.shin, 0, -(P.hip[k] - P.knee[k]), 0, -P.legRoll[k], J.ankle[k]);
        }
      }
      for (const p of this.parts) {
        const vis = !p.when || p.when(look, a);
        if (p.side) {
          for (let k = 0; k < 2; k++) {
            if (!vis) { p.mesh.setMatrixAt(i * 2 + k, HIDE); continue; }
            const par = Array.isArray(J[p.attach]) ? J[p.attach][k] : J[p.attach];
            p.mesh.setMatrixAt(i * 2 + k, p.local ? _m.multiplyMatrices(par, p.local(k === 0 ? -1 : 1)) : par);
          }
        } else {
          if (!vis) { p.mesh.setMatrixAt(i, HIDE); continue; }
          const par = Array.isArray(J[p.attach]) ? J[p.attach][p.rightOnly ? 1 : 0] : J[p.attach];
          p.mesh.setMatrixAt(i, p.local ? _m.multiplyMatrices(par, p.local()) : par);
        }
      }
      // đầu điếu thuốc và miệng (cho hiệu ứng khói)
      if (a.act === 'smoke') {
        a._tip = (a._tip || new THREE.Vector3()).set(0.02, -DIM.fore - 0.03, -0.088).applyMatrix4(J.fore[1]);
        a._mouth = (a._mouth || new THREE.Vector3()).set(0, HEAD_C - 0.07, -DIM.headR).applyMatrix4(J.head);
      }
    }
    this.glb.end(); this.pixel.end(); this.vrm.end(); this.rigged.end(); this.mo.end();
    // không ai dùng chibi dùng chung mesh: tắt hẳn (các suất ẩn bằng ma trận 0 vẫn tốn GPU — ~27 nghìn tam giác mỗi người)
    if (!instUsed) for (const p of this.parts) { p.mesh.visible = false; if (p.outline) p.outline.visible = false; }
    for (const p of this.parts) p.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Tìm agent bị bấm trúng (raycast lên các InstancedMesh). */
  pick(raycaster, agents, blockers = [], maxY = Infinity) {
    const parts = ['torso', 'head', 'pelvis', 'thigh', 'upper'].map(n => this.meshes[n]);
    for (const p of parts) { p.boundingSphere = null; p.boundingBox = null; }
    const hits = raycaster.intersectObjects([...parts, ...this.glb.meshes(), ...this.mo.groups(), ...blockers], true);
    for (const h of hits) {
      if (h.point.y > maxY) continue;
      if ((h.object.isSkinnedMesh || h.object.isMesh) && h.object.userData.agent) return h.object.userData.agent; // (nhân vật GLB / my-office)
      if (h.object.isInstancedMesh && h.object.parent === this.group) {
        const idx = h.object.userData.per ? Math.floor(h.instanceId / 2) : h.instanceId;
        return agents[idx] || null;
      }
      if (h.object.material && h.object.material.transparent) continue;
      return null;
    }
    return null;
  }
}
