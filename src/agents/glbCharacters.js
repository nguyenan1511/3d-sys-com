// Nhân vật 3D làm sẵn (GLB, thường không có khung xương, đứng ở tư thế bất kỳ: thẳng, chữ T, chữ A, đang bước…).
// Tự dựng khung theo vị trí 3D các khớp khai báo trong characters.json (rig.joints, tỉ lệ theo chiều cao model):
//  - mỗi đỉnh thuộc đoạn xương gần nhất (trừ đi độ dày của phần cơ thể đó), hoà trộn mềm ở các khớp;
//  - mỗi đoạn xương có một phép quay "về tư thế chuẩn" (thân/đầu thẳng đứng, chân tay buông thẳng xuống),
//    rồi mới áp tư thế từ AvatarSystem.pose() (đi, chạy, ngồi, gõ phím, vẫy tay…) — nên model đang bước vẫn đứng/ngồi được.
// Mỗi người một SkinnedMesh dùng chung hình học và vật liệu.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { outlineMaterial } from './toon.js';

let DEFS = new Map(), DEFAULT = null;
export function setCharacterDefs(list) { DEFS = new Map((list || []).map(d => [d.id, d])); DEFAULT = (list || [])[0]?.id || null; }
export const characterDef = id => DEFS.get(id);
/** Nhân vật mặc định (nhân vật đầu tiên trong characters.json) cho người chưa chọn. */
export const defaultCharacter = () => DEFAULT;

const templates = new Map(); // id -> { ready, promise, root, H, def }

// xương: 0 hông, 1 thân, 2 đầu, 3/4 đùi trái/phải, 5/6 cẳng chân, 7/8 cánh tay, 9/10 cẳng tay (trái = +x, mặt nhìn +z)
export const BONES = ['hips', 'spine', 'head', 'thighL', 'thighR', 'shinL', 'shinR', 'upperL', 'upperR', 'foreL', 'foreR'];
const DOWN = new THREE.Vector3(0, -1, 0), UP = new THREE.Vector3(0, 1, 0);
const J = (rig, k, H) => new THREE.Vector3(...rig.joints[k]).multiplyScalar(H);

/** Các đoạn của từng xương (đầu, cuối) và độ dày phần cơ thể bao quanh (theo H). */
function segments(rig, H) {
  const j = k => J(rig, k, H), r = rig.radius || {};
  const seg = (b, pts, rad) => ({ b, pts: pts.map(j), r: rad * H });
  return [
    seg(0, ['hip', 'spine'], r.hips ?? 0.08),
    seg(1, ['spine', 'neck'], r.torso ?? 0.085),
    seg(2, ['neck', 'headTop'], r.head ?? 0.07),
    seg(3, ['hipL', 'kneeL'], r.thigh ?? 0.05), seg(4, ['hipR', 'kneeR'], r.thigh ?? 0.05),
    seg(5, ['kneeL', 'ankleL', 'toeL'], r.shin ?? 0.04), seg(6, ['kneeR', 'ankleR', 'toeR'], r.shin ?? 0.04),
    seg(7, ['shoulderL', 'elbowL'], r.upper ?? 0.035), seg(8, ['shoulderR', 'elbowR'], r.upper ?? 0.035),
    seg(9, ['elbowL', 'wristL', 'handL'], r.fore ?? 0.032), seg(10, ['elbowR', 'wristR', 'handR'], r.fore ?? 0.032)
  ];
}
const _ab = new THREE.Vector3(), _ap = new THREE.Vector3();
function distToPath(p, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]; _ab.subVectors(b, a); _ap.subVectors(p, a);
    const t = Math.max(0, Math.min(1, _ap.dot(_ab) / Math.max(1e-9, _ab.lengthSq())));
    d = Math.min(d, _ap.addScaledVector(_ab, -t).length());
  }
  return d;
}

/**
 * Trọng số da: mỗi đỉnh lấy tối đa 4 xương gần nhất (khoảng cách tới đoạn xương trừ độ dày phần cơ thể),
 * hoà trộn theo hàm mũ (mềm ở khớp). Tay chỉ nhận đỉnh nằm ngoài mép thân (|x| > armMinX) và không ở sau lưng
 * (z > armMinZ: ba lô, tóc dài phía sau thuộc thân/đầu).
 */
export function computeSkin(positions, H, rig) {
  const n = positions.count, idx = new Uint16Array(n * 4), wgt = new Float32Array(n * 4);
  const segs = segments(rig, H), soft = (rig.soft ?? 0.012) * H;
  const armMinX = (rig.armMinX ?? 0.085) * H, armMinZ = (rig.armMinZ ?? -0.07) * H;
  const foreMinX = (rig.foreMinX ?? 0) * H; // cẳng tay/bàn tay sát vạt áo: chỉ nhận đỉnh nằm hẳn ngoài mép áo
  const neckCut = rig.neckCut != null ? rig.neckCut * H : null; // đường cắt ngang ở cổ (đầu chibi to): dưới — không thuộc đầu, trên — không thuộc thân
  const p = new THREE.Vector3(), d = new Float32Array(11);
  for (let i = 0; i < n; i++) {
    p.set(positions.getX(i), positions.getY(i), positions.getZ(i));
    let best = Infinity;
    for (const s of segs) {
      let v = distToPath(p, s.pts) - s.r;
      if (s.b >= 7 && (Math.abs(p.x) < armMinX || p.z < armMinZ)) v += 10 * H; // không lấy thân/ba lô vào tay
      if (s.b >= 9 && Math.abs(p.x) < foreMinX) v += 10 * H;
      if (neckCut !== null && ((s.b === 2 && p.y < neckCut - soft) || (s.b <= 1 && p.y > neckCut + soft))) v += 10 * H;
      d[s.b] = v; if (v < best) best = v;
    }
    const w = [];
    for (let b = 0; b < 11; b++) { const v = Math.exp(-(d[b] - best) / soft); if (v > 0.02) w.push([b, v]); }
    w.sort((a, b) => b[1] - a[1]);
    const top = w.slice(0, 4), sum = top.reduce((s, e) => s + e[1], 0) || 1;
    top.forEach(([b, v], k) => { idx[i * 4 + k] = b; wgt[i * 4 + k] = v / sum; });
  }
  return { idx, wgt };
}

/** Xương đặt đúng vị trí khớp lúc nghỉ; kèm phép quay đưa từng đoạn về tư thế chuẩn (qA: chuẩn → thực tế). */
function buildBones(H, rig) {
  const j = k => J(rig, k, H);
  const mk = (name, pos, parent, parentPos) => { const b = new THREE.Bone(); b.name = name; b.position.copy(parentPos ? pos.clone().sub(parentPos) : pos); if (parent) parent.add(b); return b; };
  const hipP = j('hip'), spP = j('spine'), nkP = j('neck');
  const hips = mk('hips', hipP), spine = mk('spine', spP, hips, hipP), head = mk('head', nkP, spine, spP);
  const leg = s => { const h = j('hip' + s), k = j('knee' + s); const th = mk('thigh' + s, h, hips, hipP); return [th, mk('shin' + s, k, th, h)]; };
  const arm = s => { const sh = j('shoulder' + s), el = j('elbow' + s); const up = mk('upper' + s, sh, spine, spP); return [up, mk('fore' + s, el, up, sh)]; };
  const [thighL, shinL] = leg('L'), [thighR, shinR] = leg('R'), [upperL, foreL] = arm('L'), [upperR, foreR] = arm('R');
  const bones = [hips, spine, head, thighL, thighR, shinL, shinR, upperL, upperR, foreL, foreR];
  const dir = (a, b) => j(b).sub(j(a)).normalize();
  const qa = (canon, v) => new THREE.Quaternion().setFromUnitVectors(canon, v);
  const align = {
    hips: new THREE.Quaternion(), spine: qa(UP, dir('spine', 'neck')), head: qa(UP, dir('neck', 'headTop')),
    thighL: qa(DOWN, dir('hipL', 'kneeL')), thighR: qa(DOWN, dir('hipR', 'kneeR')), shinL: qa(DOWN, dir('kneeL', 'ankleL')), shinR: qa(DOWN, dir('kneeR', 'ankleR')),
    upperL: qa(DOWN, dir('shoulderL', 'elbowL')), upperR: qa(DOWN, dir('shoulderR', 'elbowR')), foreL: qa(DOWN, dir('elbowL', 'wristL')), foreR: qa(DOWN, dir('elbowR', 'wristR'))
  };
  return { root: hips, bones, align };
}

/** Kích thước chân ở tư thế chuẩn (đứng thẳng), theo đơn vị model — cho dáng đi bằng IK. */
export function legOf(rig, H) {
  const j = k => J(rig, k, H);
  const L1 = (j('hipL').distanceTo(j('kneeL')) + j('hipR').distanceTo(j('kneeR'))) / 2;
  const L2 = (j('kneeL').distanceTo(j('ankleL')) + j('kneeR').distanceTo(j('ankleR'))) / 2;
  const ankle = (rig.ankleH ?? (rig.joints.ankleL[1] + rig.joints.ankleR[1]) / 2) * H;
  return { hip: ankle + L1 + L2, L1, L2, ankle, hipX: (Math.abs(rig.joints.hipL[0]) + Math.abs(rig.joints.hipR[0])) / 2 * H };
}

/**
 * Áo sọc ngang (def.stripes = { material, from, to, colors, band, sleeveFrom }): tô lại texture của vật liệu áo theo vị trí
 * thật trên người lúc nghỉ — duyệt từng tam giác của vật liệu trong không gian UV, mỗi điểm ảnh lấy toạ độ trên người
 * (nội suy) để chọn màu sọc: thân áo sọc theo chiều cao, tay áo sọc vòng quanh tay (theo khoảng cách ra ngoài). Giữ độ
 * sáng tối gốc (nếp vải). Chỉ tô phần áo (from..to theo chiều cao model) — quần dùng chung texture không bị ảnh hưởng.
 */
function paintStripes(geo, matIndex, tex, H, def) {
  const st = def.stripes, img = tex.image; if (!img) return tex;
  const W = img.width, Hh = img.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
  const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0);
  const id = c.getImageData(0, 0, W, Hh), d = id.data;
  const cols = st.colors.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const y0 = st.from * H, y1 = st.to * H, band = st.band * H, sx0 = (st.sleeveFrom ?? 0.1) * H;
  const pos = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index;
  const gr = geo.groups.find(g => g.materialIndex === matIndex) || { start: 0, count: idx.count };
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], U = [[0, 0], [0, 0], [0, 0]];
  const done = new Uint8Array(W * Hh);
  for (let t = gr.start; t < gr.start + gr.count; t += 3) {
    for (let k = 0; k < 3; k++) { const v = idx.getX(t + k); P[k].fromBufferAttribute(pos, v); U[k][0] = uv.getX(v) * W; U[k][1] = uv.getY(v) * Hh; }
    if (Math.max(P[0].y, P[1].y, P[2].y) < y0 || Math.min(P[0].y, P[1].y, P[2].y) > y1) continue;
    const minX = Math.max(0, Math.floor(Math.min(U[0][0], U[1][0], U[2][0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(U[0][0], U[1][0], U[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(U[0][1], U[1][1], U[2][1]))), maxY = Math.min(Hh - 1, Math.ceil(Math.max(U[0][1], U[1][1], U[2][1])));
    const den = (U[1][1] - U[2][1]) * (U[0][0] - U[2][0]) + (U[2][0] - U[1][0]) * (U[0][1] - U[2][1]);
    if (Math.abs(den) < 1e-9 || (maxX - minX) * (maxY - minY) > 250000) continue;
    for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
      const x = px + 0.5, y = py + 0.5;
      const a = ((U[1][1] - U[2][1]) * (x - U[2][0]) + (U[2][0] - U[1][0]) * (y - U[2][1])) / den;
      const b = ((U[2][1] - U[0][1]) * (x - U[2][0]) + (U[0][0] - U[2][0]) * (y - U[2][1])) / den, g = 1 - a - b;
      if (a < -0.02 || b < -0.02 || g < -0.02) continue;
      const wy = a * P[0].y + b * P[1].y + g * P[2].y, wx = Math.abs(a * P[0].x + b * P[1].x + g * P[2].x);
      if (wy < y0 || wy > y1) continue;
      const o = py * W + px; if (done[o]) continue; done[o] = 1;
      const coord = wx > sx0 ? (wx - sx0) * 1.15 : (y1 - wy); // tay áo: sọc vòng quanh tay; thân: sọc ngang
      const col = cols[Math.floor(coord / band) % cols.length];
      const i = o * 4, L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255, f = Math.min(1.08, 0.55 + 0.6 * L);
      d[i] = col[0] * f; d[i + 1] = col[1] * f; d[i + 2] = col[2] * f;
    }
  }
  c.putImageData(id, 0, 0);
  const t2 = tex.clone(); t2.image = cv; t2.needsUpdate = true;
  return t2;
}

/** Nạp và dựng khung cho một model (một lần cho mỗi id). */
export function loadTemplate(id, base = './') {
  const def = DEFS.get(id);
  if (!def || ['vrm', 'rigged', 'chibi', 'mo'].includes(def.format)) return null; // VRM / có xương sẵn: vrmCharacters.js, riggedCharacters.js
  let t = templates.get(id);
  if (t) return t;
  t = { ready: false };
  t.promise = new GLTFLoader().loadAsync(new URL(def.file, new URL(base, document.baseURI)).href).then(g => {
    // gộp mọi mesh của model thành một hình, mỗi chất liệu một nhóm
    g.scene.updateMatrixWorld(true);
    const geos = [], mats = [];
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      const srcMats = Array.isArray(o.material) ? o.material : [o.material];
      const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      for (const k of Object.keys(geo.morphAttributes)) delete geo.morphAttributes[k];
      // đổi về số thực 32-bit (uv/pháp tuyến nén bằng số nguyên chuẩn hoá thì không gộp chung được)
      for (const k of ['position', 'normal', 'uv']) {
        const at = geo.attributes[k], cnt = at.count, sz = at.itemSize, arr = new Float32Array(cnt * sz);
        for (let i = 0; i < cnt; i++) { arr[i * sz] = at.getX(i); if (sz > 1) arr[i * sz + 1] = at.getY(i); if (sz > 2) arr[i * sz + 2] = at.getZ(i); }
        geo.setAttribute(k, new THREE.BufferAttribute(arr, sz));
      }
      const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.index.count, materialIndex: 0 }];
      for (const gr of groups) {
        const part = geo.clone(); part.setIndex(Array.from(geo.index.array.slice(gr.start, gr.start + gr.count))); part.clearGroups();
        geos.push(part); mats.push(srcMats[gr.materialIndex ?? 0] || srcMats[0]);
      }
    });
    const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, true);
    geo.computeBoundingBox();
    const H = geo.boundingBox.max.y - geo.boundingBox.min.y;
    geo.translate(0, -geo.boundingBox.min.y, 0);
    const { idx, wgt } = computeSkin(geo.attributes.position, H, def.rig);
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wgt, 4));
    // vật liệu PBR: bỏ kim loại (cảnh không có env map); ánh sáng tự phát chỉ khi khai báo (model quét/AI hay để sẵn bản sao màu)
    const glow = def.emissive ?? 0;
    const mat = mats.map(src => new THREE.MeshStandardMaterial({
      color: src.color ? src.color.clone() : new THREE.Color(0xffffff), map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap, roughness: def.roughness ?? 0.85, metalness: 0,
      emissiveMap: glow ? src.emissiveMap : null, emissive: glow && src.emissiveMap ? new THREE.Color(0xffffff) : new THREE.Color(0), emissiveIntensity: glow,
      transparent: !!src.transparent, opacity: src.opacity ?? 1, alphaTest: src.alphaTest || (src.transparent ? 0.35 : 0), side: src.side ?? THREE.FrontSide, depthWrite: !src.transparent || src.alphaTest > 0
    }));
    if (def.stripes) mats.forEach((src, k) => { if (new RegExp(def.stripes.material, 'i').test(src.name || '') && mat[k].map) mat[k].map = paintStripes(geo, k, mat[k].map, H, def); });
    const { root, bones, align } = buildBones(H, def.rig);
    const sm = new THREE.SkinnedMesh(geo, mat.length === 1 ? mat[0] : mat);
    sm.add(root); sm.updateMatrixWorld(true); sm.bind(new THREE.Skeleton(bones));
    sm.castShadow = true; sm.frustumCulled = false;
    const holder = new THREE.Group(); holder.add(sm);
    Object.assign(t, { ready: true, root: holder, H, def, align, leg: legOf(def.rig, H) });
    return t;
  }).catch(e => { console.error('Không nạp được model', id, e); t.failed = true; });
  templates.set(id, t);
  return t;
}

// logo SYSONE (ảnh gốc) in trên ngực áo
let _logoMat = null;
function logoMaterial() {
  if (!_logoMat) {
    const t = new THREE.TextureLoader().load(new URL('logo/sysone-logo.png', document.baseURI).href);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    _logoMat = new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  }
  return _logoMat;
}

// ---------- đạo cụ cầm tay (đặt ở cổ tay phải) ----------
export function makeProps() {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf6f6f2 });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.09, 12), white); cup.name = 'cup';
  const cig = new THREE.Group(); cig.name = 'cig';
  const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.075, 6), white); c1.rotation.x = Math.PI / 2; cig.add(c1);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 5), new THREE.MeshBasicMaterial({ color: 0xff7a1a })); tip.position.z = 0.04; cig.add(tip);
  const phone = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.11, 0.012), new THREE.MeshLambertMaterial({ color: 0x16181c })); phone.name = 'phone';
  g.add(cup, cig, phone);
  return g;
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
/** Một người dùng model GLB. */
export class GlbInstance {
  constructor(t, parent) {
    this.t = t;
    this.obj = cloneSkinned(t.root);
    this.mesh = null; this.obj.traverse(o => { if (o.isSkinnedMesh) this.mesh = o; });
    this.bones = Object.fromEntries(this.mesh.skeleton.bones.map(b => [b.name, b]));
    this.A = t.align; this.Ainv = Object.fromEntries(Object.entries(t.align).map(([k, q]) => [k, q.clone().invert()]));
    const def = t.def, rig = def.rig, H = t.H, jt = k => new THREE.Vector3(...rig.joints[k]).multiplyScalar(H);
    // viền mực (tuỳ model: model ảnh thật thường để tắt)
    if (def.outline !== false) {
      t.olMat ??= outlineMaterial((def.outline ?? 0.0042) * t.H, 0x2a2c3a, true);
      const ol = new THREE.SkinnedMesh(this.mesh.geometry, t.olMat); ol.frustumCulled = false;
      ol.bind(this.mesh.skeleton, this.mesh.bindMatrix); this.mesh.parent.add(ol);
    }
    this.rest = Object.fromEntries(this.mesh.skeleton.bones.map(b => [b.name, b.position.clone()]));
    // đạo cụ ở cổ tay phải, đặt theo khung chuẩn của cẳng tay (tay buông thẳng: trục -y dọc cánh tay)
    this.props = makeProps(); this.props.scale.setScalar(H / 1.5);
    this.bones.foreR.add(this.props);
    this.props.position.copy(jt('wristR').sub(jt('elbowR'))).add(new THREE.Vector3(0, 0, 0.03 * H).applyQuaternion(this.A.foreR));
    this.props.quaternion.copy(this.A.foreR);
    // logo trên ngực (vị trí lúc nghỉ, gắn xương thân nên đi theo người)
    if (rig.logo) {
      const lw = (rig.logo.w ?? 0.1) * H, logo = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw * 171 / 1296), logoMaterial());
      logo.position.copy(new THREE.Vector3(...rig.logo.at).multiplyScalar(H).sub(jt('spine'))); logo.rotation.x = -(rig.logo.tilt ?? 0.1);
      this.bones.spine.add(logo);
    }
    this.mouth = rig.joints.mouth ? jt('mouth').sub(jt('neck')) : new THREE.Vector3(0, 0.06 * H, 0.08 * H);
    this.inner = new THREE.Group(); this.inner.rotation.y = Math.PI; this.inner.add(this.obj); // model nhìn +z, nhân vật nhìn -z
    this.group = new THREE.Group(); this.group.add(this.inner);
    parent.add(this.group);
  }
  dispose() { this.group.parent?.remove(this.group); }
  /** Mét thế giới trên một đơn vị model, với tỉ lệ nhân vật s. */
  unit(s) { return (this.t.def.height || 1.5) * s / this.t.H; }
  /** Kích thước chân ở tư thế chuẩn theo đơn vị model (dáng đi bằng IK đúng tỉ lệ chân của model). */
  get leg() { return this.t.leg; }

  /** Đặt xương: q = qA(cha) · qTưThế · qA(xương)⁻¹ — đưa đoạn về tư thế chuẩn rồi áp tư thế. */
  set(name, parent, euler) {
    const q = this.bones[name].quaternion;
    q.copy(parent ? this.A[parent] : _q2.identity()).multiply(_q.setFromEuler(euler)).multiply(this.Ainv[name]);
  }

  /** P: tư thế từ AvatarSystem.pose() tính theo đơn vị model; s: tỉ lệ nhân vật. */
  apply(a, P, s) {
    const t = this.t, H = t.H, B = this.bones, rest = this.rest;
    const k = this.unit(s);
    this.group.position.set(a.x, a.y + (a.jumpH || 0), a.z); this.group.rotation.y = a.yaw; this.group.scale.setScalar(k);
    // hông: độ cao do dáng đi/ngồi quyết định; xoay theo bước chân, nghiêng khi rẽ
    B.hips.position.set(rest.hips.x, P.hipY + 0.02 / k * (a.sit || 0), rest.hips.z - (P.pz * s) / k * 0.6);
    this.set('hips', null, _e.set(0, P.pelvisYaw || 0, -(P.bank || 0), 'YXZ'));
    this.set('spine', 'hips', _e.set(P.lean, P.spineYaw, 0, 'YXZ'));
    this.set('head', 'spine', _e.set(P.headPitch, P.headYaw, -P.headRoll, 'YXZ'));
    for (let i = 0; i < 2; i++) {
      const L = i === 0 ? 'L' : 'R', out = i === 0 ? 1 : -1;
      this.set('thigh' + L, 'hips', _e.set(-P.hip[i], -(P.pelvisYaw || 0), -((P.legRoll && P.legRoll[i]) || 0), 'YXZ'));
      this.set('shin' + L, 'thigh' + L, _e.set(P.knee[i], 0, 0, 'XYZ'));
      if (t.def.arms !== false) {
        // model làm sẵn (thường là một khối liền, tay sát thân): không giơ tay sang ngang quá ~15° (vai/nách sẽ bị kéo
        // thành mảng); vẫy tay = đưa tay ra trước, gập khuỷu, bàn tay vẫy ngang vai
        const maxAbd = t.def.rig.maxAbduction ?? 0.25;
        if (t.def.rig.armsFree) {
          // tay tách khỏi thân (model tư thế chữ T/chữ A): dùng đủ biên độ như nhân vật chibi — giơ tay qua đầu, gập khuỷu,
          // đưa điện thoại lên tai, nhảy múa…; cùng thứ tự xoay với khung chibi để động tác giống hệt
          this.set('upper' + L, 'spine', _e.set(-P.shP[i], 0, out * Math.abs(P.shR[i]), 'YXZ'));
          this.set('fore' + L, 'upper' + L, _e.set(-P.el[i], 0, 0, 'YXZ'));
        } else if (i === 1 && a.act === 'wave') {
          const wv = Math.sin((a.actT || 0) * 10);
          this.set('upper' + L, 'spine', _e.set(-1.15, 0, out * 0.18, 'XYZ'));
          this.set('fore' + L, 'upper' + L, _e.set(-(1.35 + 0.35 * wv), 0.25 * wv, 0, 'XYZ'));
        } else {
          this.set('upper' + L, 'spine', _e.set(-(P.shP[i]) * 0.9, 0, out * Math.min(maxAbd, Math.max(0, Math.abs(P.shR[i]) - 0.12) * 0.9), 'XYZ'));
          this.set('fore' + L, 'upper' + L, _e.set(-Math.max(0, P.el[i] - 0.15) * 0.8, 0, 0, 'XYZ'));
        }
      }
    }
    // đạo cụ
    const showCup = a.cup || a.act === 'drink' || a.anim === 'eat';
    for (const c of this.props.children) c.visible = (c.name === 'cup' && showCup) || (c.name === 'cig' && a.act === 'smoke') || (c.name === 'phone' && a.act === 'phone');
    if (a.act === 'smoke') {
      this.group.updateMatrixWorld(true);
      a._tip = (a._tip || new THREE.Vector3()); this.props.children.find(c => c.name === 'cig').getWorldPosition(a._tip);
      a._mouth = (a._mouth || new THREE.Vector3()).copy(this.mouth).applyMatrix4(B.head.matrixWorld);
    }
  }
}


// ---------- chuyển động người thật (mocap) cho model GLB ----------
// Mocap cho hướng "chuẩn" của từng đoạn trong khung chibi (nhìn -z); model nhìn +z (đặt trong inner xoay π) nên
// đổi khung bằng phép liên hợp với Ry(π): C = Ry·M·Ry⁻¹. Hướng thế giới của xương = C·A⁻¹, local = (cha)⁻¹·(con).
const RY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), RYi = RY.clone().invert();
const MOCAP_OF = { hips: 0, spine: 1, head: 2, upperL: 3, upperR: 4, foreL: 5, foreR: 6, thighL: 7, thighR: 8, shinL: 9, shinR: 10 };
const PARENT = { hips: null, spine: 'hips', head: 'spine', upperL: 'spine', upperR: 'spine', foreL: 'upperL', foreR: 'upperR', thighL: 'hips', thighR: 'hips', shinL: 'thighL', shinR: 'thighR' };
const _C = Object.fromEntries(Object.keys(MOCAP_OF).map(k => [k, new THREE.Quaternion()]));
const _W = Object.fromEntries(Object.keys(MOCAP_OF).map(k => [k, new THREE.Quaternion()]));
const _keep = { upperL: new THREE.Quaternion(), upperR: new THREE.Quaternion(), foreL: new THREE.Quaternion(), foreR: new THREE.Quaternion() };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _k = new THREE.Vector3();

GlbInstance.prototype.applyMocap = function (a, P, s, mc) {
  this.apply(a, P, s); // tư thế tự dựng: đặt vị trí, đạo cụ, và phần tay cho động tác mocap không có
  const t = this.t, H = t.H, B = this.bones, rig = t.def.rig, jt = k => _a.set(...rig.joints[k]).multiplyScalar(H);
  for (const k of Object.keys(_keep)) _keep[k].copy(B[k].quaternion);
  for (const [name, i] of Object.entries(MOCAP_OF)) {
    const j = i * 4;
    _C[name].set(mc.q[j], mc.q[j + 1], mc.q[j + 2], mc.q[j + 3]).premultiply(RY).multiply(RYi);
    _W[name].copy(_C[name]).multiply(this.Ainv[name]);
  }
  for (const name of Object.keys(MOCAP_OF)) {
    const par = PARENT[name], q = B[name].quaternion;
    if (par) q.copy(_W[par]).invert().multiply(_W[name]); else q.copy(_W[name]);
  }
  // tay tự dựng (gõ phím, vẫy, hút thuốc, uống) trộn đè theo trọng số
  for (let i = 0; i < 2; i++) {
    const L = i ? 'R' : 'L', w = mc.armW[i];
    if (w > 0.001) { B['upper' + L].quaternion.slerp(_keep['upper' + L], w); B['fore' + L].quaternion.slerp(_keep['fore' + L], w); }
  }
  // model liền khối (tay dính thân, như model AI tạo từ ảnh): giới hạn góc nâng cánh tay trên so với tư thế buông,
  // khuỷu gập bù — nếu không, lớp da nối nách bị kéo rách
  const lim = rig.maxArmLift;
  if (lim) for (const L of ['L', 'R']) {
    const q = B['upper' + L].quaternion;
    _q.copy(this.A.spine).invert().multiply(q).multiply(this.A['upper' + L]); // tư thế so với khung chuẩn của ngực
    const ang = 2 * Math.acos(Math.min(1, Math.abs(_q.w)));
    if (ang > lim) {
      _q2.identity().slerp(_q, lim / ang);
      const gap = ang - lim; // phần bị cắt bớt: dồn sang khuỷu
      q.copy(this.A.spine).multiply(_q2).multiply(this.Ainv['upper' + L]);
      const f = B['fore' + L].quaternion;
      _q.copy(this.A['upper' + L]).multiply(_q2.setFromAxisAngle(_k.set(1, 0, 0), -Math.min(1.2, gap * 0.8))).multiply(this.Ainv['fore' + L]);
      f.premultiply(_q.multiply(_q2.copy(this.A['upper' + L]).multiply(this.Ainv['fore' + L]).invert()));
    }
  }
  // hông: mocap theo chiều cao hông của model (khung model: x, z đảo dấu); ngồi giữ độ cao ghế của tư thế tự dựng
  const sit = Math.min(1, a.sit || 0), hipY = jt('hip').y, rest = this.rest.hips;
  const hp = B.hips.position, sitY = hp.y, sitZ = hp.z;
  hp.set(rest.x - mc.hip[0] * hipY, mc.hip[1] * hipY, rest.z - mc.hip[2] * hipY);
  if (sit > 0) { hp.y += (sitY - hp.y) * sit; hp.z += (sitZ - hp.z) * sit; hp.x += (rest.x - hp.x) * sit; }
  // chân trụ chạm sàn: tính mắt cá bằng FK đơn giản (khung model), đẩy cả người lên/xuống
  if ((a.jumpH || 0) < 0.015 && sit < 1) {
    let minY = Infinity;
    for (const L of ['L', 'R']) {
      _k.copy(jt('hip' + L)).sub(_b.copy(jt('hip'))).applyQuaternion(_W.hips).add(hp); // khớp háng
      _k.add(_b.copy(jt('knee' + L)).sub(jt('hip' + L)).applyQuaternion(_W['thigh' + L]));
      _b.copy(jt('ankle' + L)); _b.sub(jt('knee' + L)); _k.add(_b.applyQuaternion(_W['shin' + L]));
      minY = Math.min(minY, _k.y);
    }
    hp.y += (jt('ankleL').y - minY) * (1 - sit);
  }
  if (a.act === 'smoke') {
    this.group.updateMatrixWorld(true);
    this.props.children.find(c => c.name === 'cig').getWorldPosition(a._tip);
    a._mouth.copy(this.mouth).applyMatrix4(B.head.matrixWorld);
  }
};

/** Quản lý các nhân vật GLB của một AvatarSystem. */
export class GlbPool {
  constructor(group, base = './') { this.group = group; this.base = base; this.inst = new Map(); this.used = new Set(); }
  begin() { this.used.clear(); }
  /** Trả về instance đã sẵn sàng cho agent (hoặc null khi model đang tải / không có). */
  get(a, modelId) {
    const t = loadTemplate(modelId, this.base);
    if (!t || !t.ready) return null;
    let it = this.inst.get(a);
    if (it && it.t !== t) { it.dispose(); it = null; }
    if (!it) { it = new GlbInstance(t, this.group); it.mesh.userData.agent = a; this.inst.set(a, it); }
    this.used.add(a); it.group.visible = true;
    return it;
  }
  end() { for (const [a, it] of this.inst) if (!this.used.has(a)) { it.dispose(); this.inst.delete(a); } }
  meshes() { return [...this.inst.values()].map(i => i.mesh); }
}
