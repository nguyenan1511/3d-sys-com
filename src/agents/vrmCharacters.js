// Nhân vật VRM (định dạng nhân vật chuẩn: xương người chuẩn, biểu cảm, tóc/váy có vật lý) — chạy bằng chuyển động
// người thật (src/agents/mocap.js). Xương "chuẩn hoá" của VRM lúc nghỉ đều không xoay, tư thế chữ T, model nhìn +z,
// nên hướng từng khớp lấy thẳng từ mocap: W = C·U⁻¹ (C: hướng khớp mocap đổi sang khung model, U: hướng chuẩn → hướng
// xương lúc nghỉ), local = W(cha)⁻¹·W.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { makeProps } from './glbCharacters.js';

const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0), FWD = new THREE.Vector3(0, 0, 1);
const RY = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI), RYi = RY.clone().invert();
// xương VRM ← [khớp mocap, hướng chuẩn, xương con để lấy hướng lúc nghỉ]; null = thân/đầu (thẳng đứng lúc nghỉ)
const MAP = {
  hips: [0, null], chest: [1, null], head: [2, null],
  leftUpperArm: [3, DOWN, 'leftLowerArm'], rightUpperArm: [4, DOWN, 'rightLowerArm'],
  leftLowerArm: [5, DOWN, 'leftHand'], rightLowerArm: [6, DOWN, 'rightHand'],
  leftUpperLeg: [7, DOWN, 'leftLowerLeg'], rightUpperLeg: [8, DOWN, 'rightLowerLeg'],
  leftLowerLeg: [9, DOWN, 'leftFoot'], rightLowerLeg: [10, DOWN, 'rightFoot'],
  leftFoot: [11, null], rightFoot: [12, null] // bàn chân: tư thế nghỉ của model là chuẩn (đặt phẳng)
};
// thứ tự đặt (cha trước con) và nguồn hướng thế giới cho các xương trung gian
const ORDER = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'].flatMap(f => ['Proximal', 'Intermediate', 'Distal'].map(p => f + p));

// ---------- đổi màu theo tuỳ chỉnh của người dùng ----------
// Vật liệu VRoid đặt tên theo phần: *_HAIR, *_SKIN, Tops_*, Bottoms_*, Shoes_* → tô lại texture.
const ROLES = [[/_HAIR/i, 'hairColor'], [/_SKIN/i, 'skinColor'], [/Tops_/i, 'topColor'], [/Bottoms_/i, 'bottomColor'], [/Shoes_/i, 'shoeColor']];
const LOOK_KEYS = ROLES.map(r => r[1]);
const tintCache = new Map();
/**
 * Texture tô màu mới. Quần áo/tóc: giữ độ sáng tương đối (nếp vải, sợi tóc, bóng) và thay sắc màu; da: nhân theo tỉ lệ
 * từng kênh (giữ má hồng, môi).
 */
function tinted(tex, hex, perChannel) {
  if (!tex?.image) return tex;
  const key = tex.uuid + hex + (perChannel ? 'c' : 'l');
  let t = tintCache.get(key); if (t) return t;
  const img = tex.image, w = img.width, h = img.height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  const T = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  let n = 0, mr = 0, mg = 0, mb = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 8) { mr += d[i]; mg += d[i + 1]; mb += d[i + 2]; n++; }
  mr = Math.max(1, mr / (n || 1)); mg = Math.max(1, mg / (n || 1)); mb = Math.max(1, mb / (n || 1));
  const mL = Math.max(1, 0.2126 * mr + 0.7152 * mg + 0.0722 * mb);
  for (let i = 0; i < d.length; i += 4) {
    if (perChannel) { d[i] = Math.min(255, d[i] * T[0] / mr); d[i + 1] = Math.min(255, d[i + 1] * T[1] / mg); d[i + 2] = Math.min(255, d[i + 2] * T[2] / mb); continue; }
    const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / mL, f = Math.max(0, 1 + (L - 1) * 0.65);
    d[i] = Math.min(255, T[0] * f); d[i + 1] = Math.min(255, T[1] * f); d[i + 2] = Math.min(255, T[2] * f);
  }
  ctx.putImageData(id, 0, 0);
  t = tex.clone(); t.image = cv; t.needsUpdate = true;
  tintCache.set(key, t);
  return t;
}

import { logoPatch } from './logoPatch.js';

// ---------- bảng UV mặt trước áo (dò gấu áo để thu gọn dây/đai thõng dưới gấu) ----------
// Lúc nạp (tư thế nghỉ) bắn tia vào mặt trước áo để biết mỗi điểm (x, y) trên áo nằm ở đâu trong texture (UV) — bảng
// này tính một lần cho mỗi model. Sau đó vẽ cổ áo, nẹp, cúc, ve áo, khoá kéo… lên bản sao texture.
const guides = new Map();
function buildGuide(id, tops, scene, H, front, halfW, neckY, hipY) {
  if (guides.has(id)) return guides.get(id);
  const rc = tops.map(o => { const m = new THREE.Mesh(o.geometry, o.material); m.matrixAutoUpdate = false; m.matrixWorld.copy(o.matrixWorld); return m; });
  const ray = new THREE.Raycaster(), dir = new THREE.Vector3(0, 0, -front).transformDirection(scene.matrixWorld), nrm = new THREE.Vector3();
  const hit = (x, y) => {
    ray.set(scene.localToWorld(new THREE.Vector3(x, y, front * H)), dir);
    for (const h of ray.intersectObjects(rc, false)) {
      if (!h.uv || !h.face) continue;
      nrm.copy(h.face.normal).transformDirection(h.object.matrixWorld);
      if (nrm.dot(dir) < -0.15) return h.uv.clone(); // mặt trước, quay về phía người nhìn
    }
    return null;
  };
  const st = 0.004 * H;
  // cổ áo (điểm cao nhất có vải ở giữa ngực) và gấu áo (điểm thấp nhất)
  let neck = null, hem = null;
  for (let y = neckY + 0.02 * H; y > neckY - 0.2 * H; y -= st) if (hit(0, y)) { neck = y; break; }
  if (neck === null) { guides.set(id, null); return null; }
  // gấu áo: dò ở hai bên sườn (giữa ngực có thể có dây/đai thõng xuống, không phải thân áo)
  for (const sx of [-0.8 * halfW, 0.8 * halfW]) { // mép ngoài thân (dây/đai thõng thường nằm gần giữa)
    let low = null; for (let y = neck - 0.1 * H; y > hipY - 0.3 * H; y -= st) { if (hit(sx, y)) low = y; else if (low !== null) break; }
    if (low !== null) hem = hem === null ? low : Math.max(hem, low);
  }
  if (hem === null) { guides.set(id, null); return null; }
  hem = Math.max(hem, hipY - 0.08 * H); // áo không dài quá hông nhiều
  const pts = (x0, y0, x1, y1) => { const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (st * 0.5))), out = []; for (let i = 0; i <= n; i++) { const u = hit(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); if (u) out.push(u); } return out; };
  const area = (fn, x0, x1, y0, y1) => { const out = []; for (let y = y0; y <= y1; y += st * 0.8) for (let x = x0; x <= x1; x += st * 0.8) if (fn(x, y)) { const u = hit(x, y); if (u) out.push(u); } return out; };
  // mật độ texel trên mét (để đổi độ dày nét từ mét sang điểm ảnh)
  const a = hit(0, neck - 0.08 * H), b = hit(0, neck - 0.18 * H);
  const uvPerM = a && b ? a.distanceTo(b) / (0.1 * H) : 1;
  const tri = (ax, ay, bx, by, cx, cy) => (x, y) => { const d = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3); const d1 = d(x, y, ax, ay, bx, by), d2 = d(x, y, bx, by, cx, cy), d3 = d(x, y, cx, cy, ax, ay); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
  const cw = 0.055 * H, cd = 0.06 * H, sw = 0.028 * H, top = neck - 0.006 * H;
  const g = {
    uvPerM, H, hemY: hem, halfW,
    center: pts(0, top, 0, hem + st),
    placketL: pts(-0.008 * H, top - 0.02 * H, -0.008 * H, hem + st), placketR: pts(0.008 * H, top - 0.02 * H, 0.008 * H, hem + st),
    buttons: (() => { const out = []; for (let y = top - 0.035 * H; y > hem + 0.03 * H; y -= 0.055 * H) { const u = hit(0, y); if (u) out.push(u); } return out; })(),
    collar: [...area(tri(-cw, top, 0, top - cd, -0.012 * H, top), -cw, 0, top - cd, top), ...area(tri(cw, top, 0, top - cd, 0.012 * H, top), 0, cw, top - cd, top)],
    collarEdge: [...pts(-cw, top, 0, top - cd), ...pts(cw, top, 0, top - cd), ...pts(-cw, top, -0.012 * H, top), ...pts(cw, top, 0.012 * H, top)],
    poloCollar: [...area(tri(-cw * 0.8, top, -0.004 * H, top - cd * 0.7, -0.01 * H, top), -cw, 0, top - cd, top), ...area(tri(cw * 0.8, top, 0.004 * H, top - cd * 0.7, 0.01 * H, top), 0, cw, top - cd, top)],
    poloEdge: [...pts(-cw * 0.8, top, -0.004 * H, top - cd * 0.7), ...pts(cw * 0.8, top, 0.004 * H, top - cd * 0.7)],
    poloPlacket: [...pts(-0.008 * H, top - 0.01 * H, -0.008 * H, top - 0.1 * H), ...pts(0.008 * H, top - 0.01 * H, 0.008 * H, top - 0.1 * H), ...pts(-0.008 * H, top - 0.1 * H, 0.008 * H, top - 0.1 * H)],
    poloButtons: [hit(0, top - 0.04 * H), hit(0, top - 0.075 * H)].filter(Boolean),
    inner: area(() => true, -sw, sw, hem + st, top),
    edgeL: pts(-sw, top, -sw, hem + st), edgeR: pts(sw, top, sw, hem + st),
    zip: pts(sw - 0.004 * H, top - 0.01 * H, sw - 0.004 * H, hem + st),
    lapels: [...area(tri(-sw, top, -sw - 0.04 * H, top, -sw, top - 0.12 * H), -sw - 0.05 * H, -sw, top - 0.13 * H, top), ...area(tri(sw, top, sw + 0.04 * H, top, sw, top - 0.12 * H), sw, sw + 0.05 * H, top - 0.13 * H, top)],
    lapelEdge: [...pts(-sw - 0.04 * H, top, -sw, top - 0.12 * H), ...pts(sw + 0.04 * H, top, sw, top - 0.12 * H)],
    pockets: [...pts(-0.7 * halfW, hem + 0.09 * H, -0.45 * halfW, hem + 0.05 * H), ...pts(0.7 * halfW, hem + 0.09 * H, 0.45 * halfW, hem + 0.05 * H)]
  };
  guides.set(id, g);
  return g;
}
const buffers = new Map();
function fetchVrm(url) { if (!buffers.has(url)) buffers.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.arrayBuffer(); })); return buffers.get(url); }

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();

export class VrmInstance {
  constructor(def, parent, base = './') {
    this.def = def; this.ready = false; this.W = {}; this.blinkT = 2 + Math.random() * 3; this.blink = 0; this.talk = 0;
    this.group = new THREE.Group(); parent.add(this.group);
    const url = new URL(def.file, new URL(base, document.baseURI)).href;
    const loader = new GLTFLoader(); loader.register(p => new VRMLoaderPlugin(p));
    this.promise = fetchVrm(url).then(buf => loader.parseAsync(buf.slice(0), url)).then(g => {
      if (this.disposed) return;
      const vrm = g.userData.vrm; this.vrm = vrm;
      // VRM 0.x: model nhìn -z (cùng khung với mocap/chibi) → xoay cả cảnh π cho nhìn +z, còn xương thì đặt trong khung
      // gốc nhìn -z: không đổi khung mocap. VRM 1.0 nhìn +z: đổi khung bằng Ry(π).
      this.v0 = vrm.meta?.metaVersion === '0';
      if (this.v0) VRMUtils.rotateVRM0(vrm);
      VRMUtils.removeUnnecessaryVertices(g.scene); VRMUtils.combineSkeletons?.(g.scene);
      vrm.scene.traverse(o => {
        if (!o.isMesh) return; o.frustumCulled = false; o.castShadow = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          m.userData.keepSide = true; m.clipping = true;
          // vật liệu anime (MToon) cộng thẳng mọi đèn (cảnh này ~4× mức chuẩn: bầu trời 2.4 + nắng 1.9 + đèn trần) → hạ về ~1×
          if (!m.userData.lit0) { m.userData.lit0 = true; const f = def.light ?? 0.3; m.color?.multiplyScalar(f); m.shadeColorFactor?.multiplyScalar(f); m.emissive?.multiplyScalar(f * 0.5); m.matcapFactor?.multiplyScalar(0.3); }
        }
      });
      const H = this.H = new THREE.Box3().setFromObject(vrm.scene).max.y;
      const N = n => vrm.humanoid.getNormalizedBoneNode(n);
      this.N = N; vrm.scene.updateMatrixWorld(true);
      const wp = n => vrm.scene.worldToLocal(N(n).getWorldPosition(new THREE.Vector3())); // khung của cảnh VRM (trước khi xoay)
      // U cho tay chân: hướng chuẩn → hướng xương lúc nghỉ (khung model)
      this.Ui = {};
      for (const [b, [, canon, child]] of Object.entries(MAP)) {
        if (!canon) { this.Ui[b] = new THREE.Quaternion(); continue; }
        const cn = canon === FWD && this.v0 ? new THREE.Vector3(0, 0, -1) : canon; // VRM 0.x: phía trước là -z
        const c = child && N(child) ? wp(child).sub(wp(b)).normalize() : cn;
        this.Ui[b] = new THREE.Quaternion().setFromUnitVectors(cn, c).invert();
      }
      // kích thước chân (đơn vị model) cho tư thế ngồi/dáng đi tự dựng
      const hip = wp('hips'), lk = wp('leftLowerLeg'), lf = wp('leftFoot'), lu = wp('leftUpperLeg');
      this.footY = (wp('leftFoot').y + wp('rightFoot').y) / 2;
      this.hipRest = N('hips').position.clone();
      this.leg = { hip: hip.y, L1: lu.distanceTo(lk), L2: lk.distanceTo(lf), ankle: this.footY, hipX: Math.abs(lu.x) };
      // đạo cụ (cốc, thuốc, điện thoại) ở bàn tay phải, theo khung chuẩn của cẳng tay
      this.props = makeProps(); this.props.scale.setScalar(H / 1.5 * 0.9);
      N('rightHand').add(this.props);
      this.props.quaternion.copy(this.Ui.rightLowerArm).invert();
      this.fz = this.v0 ? -1 : 1; // hướng phía trước trong khung xương
      const along = wp('rightHand').sub(wp('rightLowerArm')).normalize();
      this.props.position.copy(along.multiplyScalar(0.03 * H)).add(_v.set(0, 0, this.fz * 0.015 * H));
      this.addLogo(def, H, wp);
      { // bảng UV để vẽ kiểu áo (tính một lần cho mỗi model)
        const tops = []; vrm.scene.traverse(o => { if (o.isMesh && [].concat(o.material).some(m => /Tops_/i.test(m.name || ''))) tops.push(o); });
        vrm.scene.updateMatrixWorld(true);
        const halfW = Math.abs(wp('leftUpperArm').x - wp('rightUpperArm').x) / 2;
        try { this.guide = tops.length ? buildGuide(def.id, tops, vrm.scene, H, this.v0 ? -1 : 1, halfW, wp('neck').y, wp('hips').y) : null; } catch (e) { console.warn('VRM: không dựng được bảng kiểu áo', e); this.guide = null; }
        // dây/đai thõng trước bụng dưới gấu áo (dùng chung texture với thân áo → bị vẽ theo kiểu áo, trông lạ với dáng
        // công sở): thu gọn về ngang gấu áo
        if (this.guide) {
          const hy = this.guide.hemY, cx = 0.7 * halfW, v = new THREE.Vector3();
          for (const o of tops) {
            const pos = o.geometry.attributes.position, toS = new THREE.Matrix4().copy(vrm.scene.matrixWorld).invert().multiply(o.matrixWorld), back = toS.clone().invert();
            let n = 0;
            for (let i = 0; i < pos.count; i++) {
              v.fromBufferAttribute(pos, i).applyMatrix4(toS);
              if (v.y < hy - 0.01 * H && Math.abs(v.x) < cx) { v.y = hy; v.applyMatrix4(back); pos.setXYZ(i, v.x, v.y, v.z); n++; }
            }
            if (n) { pos.needsUpdate = true; o.geometry.computeBoundingSphere(); }
          }
        }
      }
      this.inner = new THREE.Group(); this.inner.rotation.y = Math.PI; this.inner.add(vrm.scene); // model nhìn +z, nhân vật nhìn -z
      this.group.add(this.inner);
      this.ready = true;
    }).catch(e => { console.warn('VRM: không nạp được', def.file, e); this.failed = true; });
  }
  /** Bán kính va chạm của vật lý tóc tính bằng mét thế giới, không co theo tỉ lệ cha → nhân theo tỉ lệ nhân vật. */
  scaleSprings(k) {
    const sb = this.vrm.springBoneManager; if (!sb) return;
    for (const j of sb.joints) { j.settings._r0 ??= j.settings.hitRadius; j.settings.hitRadius = j.settings._r0 * k; }
    for (const g of sb.colliderGroups) for (const c of g.colliders) { const sh = c.shape; if (sh && 'radius' in sh) { sh._r0 ??= sh.radius; sh.radius = sh._r0 * k; } }
  }
  /**
   * Logo trên ngực áo: bắn tia từ phía trước vào phần áo (vật liệu Tops_) ở tư thế nghỉ, đặt miếng logo sát mặt vải
   * rồi gắn vào xương ngực (đi theo người khi cử động). def.logo: { y: độ cao theo chiều cao model, x: lệch sang ngực
   * trái theo nửa bề rộng vai (0 = giữa), w: bề rộng theo chiều cao model }.
   */
  addLogo(def, H, wp) {
    const L = def.logo; if (!L) return;
    const vrm = this.vrm, front = this.v0 ? -1 : 1, left = this.v0 ? -1 : 1; // VRM 0.x nhìn -z (bên trái nhân vật là -x)
    const halfW = Math.abs(wp('leftUpperArm').x - wp('rightUpperArm').x) / 2;
    const x = left * (L.x || 0) * halfW, y = (L.y ?? 0.7) * H;
    const tops = []; vrm.scene.traverse(o => { if (o.isMesh && [].concat(o.material).some(m => /Tops_/i.test(m.name || ''))) tops.push(o); });
    if (!tops.length) return;
    vrm.scene.updateMatrixWorld(true);
    const toW = v => vrm.scene.localToWorld(v.clone());
    const ray = new THREE.Raycaster(toW(new THREE.Vector3(x, y, front * H)), new THREE.Vector3(0, 0, -front).transformDirection(vrm.scene.matrixWorld));
    const hit = ray.intersectObjects(tops, false)[0]; if (!hit) return;
    const pt = vrm.scene.worldToLocal(hit.point.clone());
    const { tex, aspect } = logoPatch(), w = (L.w ?? 0.07) * H;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * aspect), new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: 0xeeeeee, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.material.userData.keepSide = true; m.renderOrder = 2;
    m.position.copy(pt).add(new THREE.Vector3(0, 0, front * 0.006 * H));
    if (front < 0) m.rotation.y = Math.PI;
    m.rotation.x = -front * 0.12; // ngực hơi ngửa lên
    vrm.scene.add(m); vrm.scene.updateMatrixWorld(true);
    const bone = vrm.humanoid.getRawBoneNode('upperChest') || vrm.humanoid.getRawBoneNode('chest');
    bone.attach(m); // giữ nguyên vị trí lúc nghỉ, từ nay đi theo xương ngực
    this.logo = m;
    // để dời logo ra mặt áo khác (áo dựng của tủ đồ): khung cảnh VRM → khung xương ngực lúc nghỉ
    this.logoInfo = { x, y, front, orig: m.position.clone(), L: new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(vrm.scene.matrixWorld) };
  }
  /** Áp màu tuỳ chỉnh (look.hairColor, skinColor, topColor, bottomColor, shoeColor; '' = màu gốc). */
  recolor(look) {
    const key = LOOK_KEYS.map(k => (look && look[k]) || '').join(',');
    if (key === this.colorKey) return; this.colorKey = key;
    this.vrm.scene.traverse(o => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const r = ROLES.find(([re]) => re.test(m.name || '')); if (!r) continue;
        if (!('map0' in m.userData)) { m.userData.map0 = m.map; m.userData.shade0 = m.shadeMultiplyTexture; }
        const col = look && look[r[1]], skin = r[1] === 'skinColor';
        m.map = col ? tinted(m.userData.map0, col, skin) : m.userData.map0;
        if (m.userData.shade0) m.shadeMultiplyTexture = col ? tinted(m.userData.shade0, col, skin) : m.userData.shade0;
      }
    });
  }
  dispose() { this.disposed = true; this.group.parent?.remove(this.group); if (this.vrm) VRMUtils.deepDispose(this.vrm.scene); }
  unit(s) { return (this.def.height || 1.5) * s / this.H; }

  /** a: agent; P: tư thế tự dựng (đơn vị model); mc: kết quả mocapPose; dt: giây. */
  apply(a, P, s, mc, dt) {
    const vrm = this.vrm, N = this.N, W = this.W, k = this.unit(s);
    this.recolor(a.emp?.look);
    this.group.position.set(a.x, a.y + (a.jumpH || 0), a.z); this.group.rotation.y = a.yaw; this.group.scale.setScalar(k);
    // hướng thế giới (khung model) của các khớp chính
    for (const [b, [i]] of Object.entries(MAP)) {
      const j = i * 4; let qx = mc.q[j], qy = mc.q[j + 1], qz = mc.q[j + 2], qw = mc.q[j + 3];
      (W[b] ??= new THREE.Quaternion()).set(qx, qy, qz, qw);
    }
    // tay tự dựng (gõ phím, vẫy, hút thuốc, uống) — tính trong khung chibi theo ngực mocap, trộn theo trọng số
    for (let i = 0; i < 2; i++) {
      const w = mc.armW[i]; if (w < 0.001) continue;
      const sx = i ? 1 : -1, up = i ? 'rightUpperArm' : 'leftUpperArm', lo = i ? 'rightLowerArm' : 'leftLowerArm';
      _q.copy(W.chest).multiply(_q2.setFromEuler(new THREE.Euler(P.shP[i], 0, sx * Math.abs(P.shR[i]), 'YXZ')));
      W[up].slerp(_q, w);
      _q.multiply(_q2.setFromEuler(new THREE.Euler(P.el[i], 0, 0, 'YXZ')));
      W[lo].slerp(_q, w);
    }
    for (const b of Object.keys(MAP)) { if (!this.v0) W[b].premultiply(RY).multiply(RYi); W[b].multiply(this.Ui[b]); } // khung chibi → khung model
    W.spine = (W.spine ?? new THREE.Quaternion()).copy(W.hips).slerp(W.chest, 0.5);
    W.upperChest = W.chest; W.neck = (W.neck ?? new THREE.Quaternion()).copy(W.chest).slerp(W.head, 0.5);
    W.leftShoulder = W.rightShoulder = W.chest; W.leftHand = W.leftLowerArm; W.rightHand = W.rightLowerArm;
    const par = { hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: N('upperChest') ? 'upperChest' : 'chest', head: 'neck',
      leftShoulder: N('upperChest') ? 'upperChest' : 'chest', rightShoulder: N('upperChest') ? 'upperChest' : 'chest',
      leftUpperArm: 'leftShoulder', rightUpperArm: 'rightShoulder', leftLowerArm: 'leftUpperArm', rightLowerArm: 'rightUpperArm',
      leftHand: 'leftLowerArm', rightHand: 'rightLowerArm', leftUpperLeg: 'hips', rightUpperLeg: 'hips',
      leftLowerLeg: 'leftUpperLeg', rightLowerLeg: 'rightUpperLeg', leftFoot: 'leftLowerLeg', rightFoot: 'rightLowerLeg' };
    for (const b of ORDER) {
      const n = N(b); if (!n) continue;
      let p = par[b]; while (p && !N(p)) p = par[p];
      n.quaternion.copy(p ? _q.copy(W[p]).invert().multiply(W[b]) : W[b]);
    }
    // ngón tay cong thả lỏng
    for (const side of ['left', 'right']) for (const f of FINGERS) { const n = N(side + f); if (n) n.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (side === 'left' ? -1 : 1) * (this.v0 ? -1 : 1) * (f.endsWith('Proximal') ? 0.25 : 0.45)); }
    // hông: mocap theo chiều cao hông model (khung model: x, z đảo dấu); ngồi: độ cao ghế của tư thế tự dựng
    const sit = Math.min(1, a.sit || 0), hp = N('hips').position, hy = this.leg.hip;
    const sg = this.v0 ? 1 : -1;
    hp.set(this.hipRest.x + sg * mc.hip[0] * hy, mc.hip[1] * hy, this.hipRest.z + sg * mc.hip[2] * hy);
    if (sit > 0) hp.lerp(_v.set(this.hipRest.x, P.hipY, this.hipRest.z - sg * (P.pz || 0) / k * 0.6), sit);
    // chân trụ chạm sàn
    if ((a.jumpH || 0) < 0.015 && sit < 1) {
      vrm.scene.updateMatrixWorld(true);
      const inv = _m.copy(vrm.scene.matrixWorld).invert(); // khung cảnh VRM
      const y = Math.min(N('leftFoot').getWorldPosition(_v).applyMatrix4(inv).y, N('rightFoot').getWorldPosition(_v2).applyMatrix4(inv).y);
      hp.y += (this.footY - y) * (1 - sit);
    }
    // biểu cảm: chớp mắt, cười khi vẫy/nhảy múa, mấp máy miệng khi nói chuyện/gọi điện
    const em = vrm.expressionManager;
    if (em) {
      this.blinkT -= dt; if (this.blinkT < 0) { this.blink = 0.16; this.blinkT = 2 + Math.random() * 4; }
      this.blink = Math.max(0, this.blink - dt);
      const happy = a.act === 'wave' || a.act === 'dance' ? 1 : (a.anim === 'talk' ? 0.4 : 0.15);
      const talking = a.act === 'phone' || (a.anim === 'talk' && !a.act);
      this.talk = talking ? 0.5 + 0.5 * Math.sin(performance.now() / 90) * Math.sin(performance.now() / 230) : 0;
      em.setValue('blink', this.blink > 0 ? Math.sin(this.blink / 0.16 * Math.PI) : 0);
      em.setValue('happy', happy * (this.blink > 0 ? 0 : 1));
      em.setValue('aa', Math.max(0, this.talk) * 0.6);
    }
    // đạo cụ
    const showCup = a.cup || a.act === 'drink' || a.anim === 'eat';
    for (const c of this.props.children) c.visible = (c.name === 'cup' && showCup) || (c.name === 'cig' && a.act === 'smoke') || (c.name === 'phone' && a.act === 'phone');
    vrm.update(Math.min(0.05, dt));
    // vật lý tóc: khởi động lại khi vừa xuất hiện hoặc bị dịch chuyển tức thời (ngồi vào ghế, đổi tầng…)
    const moved = this.lastPos ? Math.hypot(a.x - this.lastPos.x, a.z - this.lastPos.z) > 0.6 || Math.abs(a.y - this.lastPos.y) > 0.6 : true;
    (this.lastPos ??= new THREE.Vector3()).set(a.x, a.y, a.z);
    if (this.scaleK !== k) this.scaleSprings(k);
    if (moved || this.scaleK !== k) { this.group.updateMatrixWorld(true); vrm.springBoneManager?.reset(); }
    this.scaleK = k;
    if (a.act === 'smoke') {
      this.group.updateMatrixWorld(true);
      a._tip = (a._tip || new THREE.Vector3()); this.props.children.find(c => c.name === 'cig')?.getWorldPosition(a._tip);
      a._mouth = (a._mouth || new THREE.Vector3()).set(0, 0.05 * this.H, this.fz * 0.08 * this.H).applyMatrix4(N('head').matrixWorld);
    }
  }
}

/** Quản lý các nhân vật VRM của một AvatarSystem (mỗi người một bản: xương/vật lý riêng). */
export class VrmPool {
  constructor(group, base = './') { this.group = group; this.base = base; this.inst = new Map(); this.used = new Set(); }
  begin() { this.used.clear(); }
  /** Bản đang dùng của agent a (null khi chưa tải xong). Đổi nhân vật: giữ bản cũ cho tới khi bản mới sẵn sàng. */
  get(a, def) {
    let it = this.inst.get(a);
    if (it && it.def !== def) {
      if (!it.next || it.next.def !== def) { it.next?.dispose(); it.next = new VrmInstance(def, this.group, this.base); it.next.group.visible = false; }
      if (it.next.ready || it.failed || !it.ready) { const n = it.next; it.next = null; it.dispose(); this.inst.set(a, n); it = n; }
    }
    if (!it) { it = new VrmInstance(def, this.group, this.base); this.inst.set(a, it); }
    this.used.add(a); it.group.visible = it.ready;
    return it.ready ? it : null;
  }
  /** Đang chờ tải một nhân vật (lần đầu hoặc khi đổi). */
  loading(a) { const it = this.inst.get(a); return !!it && (!it.ready || !!it.next); }
  end() { for (const [a, it] of this.inst) if (!this.used.has(a)) { it.next?.dispose(); it.dispose(); this.inst.delete(a); } }
}
