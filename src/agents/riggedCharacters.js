// Nhân vật GLB có SẴN bộ xương (vd. Quaternius: gấu trúc, thỏ — Public Domain) chạy bằng chuyển động người thật
// (src/agents/mocap.js), không dùng hoạt ảnh gốc của model: cùng bộ động tác văn phòng với nhân vật VRM.
// Xương đích b: hướng thế giới W = C·A⁻¹·Qr (C: hướng khớp mocap đổi sang khung model nhìn +z, A: hướng chuẩn → hướng
// xương lúc nghỉ, Qr: hướng xương lúc nghỉ); local = W(cha)⁻¹·W. Xương không ánh xạ giữ nguyên local lúc nghỉ.
// Bàn chân kiểu IK (gắn vào gốc, không nằm trong chuỗi xương chân) được đặt vào cuối cẳng chân mỗi khung hình.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { makeProps } from './glbCharacters.js';

const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const RY = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI), RYi = RY.clone().invert();
// khớp mocap → [tên xương (theo def.bones), hướng chuẩn, xương con để lấy hướng lúc nghỉ]
const SEGS = {
  hips: [0, null], chest: [1, null], head: [2, null],
  upperL: [3, DOWN, 'lowerL'], upperR: [4, DOWN, 'lowerR'], lowerL: [5, DOWN, 'handL'], lowerR: [6, DOWN, 'handR'],
  thighL: [7, DOWN, 'shinL'], thighR: [8, DOWN, 'shinR'], shinL: [9, DOWN, 'footL'], shinR: [10, DOWN, 'footR'],
  footL: [11, null], footR: [12, null]
};
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const templates = new Map();
function loadTpl(url) { if (!templates.has(url)) templates.set(url, new GLTFLoader().loadAsync(url)); return templates.get(url); }

export class RiggedInstance {
  constructor(def, parent, base = './') {
    this.def = def; this.ready = false; this.W = {}; this.Mq = {};
    this.group = new THREE.Group(); parent.add(this.group);
    const url = new URL(def.file, new URL(base, document.baseURI)).href;
    this.promise = loadTpl(url).then(g => {
      if (this.disposed) return;
      const root = cloneSkinned(g.scene); this.root = root;
      root.traverse(o => {
        if (!o.isMesh) return;
        if (def.hide && new RegExp(def.hide, 'i').test(o.name)) { o.visible = false; return; } // vd. củ cà rốt (vũ khí trong game gốc)
        o.castShadow = true; o.frustumCulled = false;
        for (const m of [].concat(o.material)) { m.userData.keepSide = true; if ('metalness' in m) m.metalness = 0; }
      });
      root.updateMatrixWorld(true);
      const box = new THREE.Box3(); root.traverse(o => { if (o.isMesh && o.visible) box.expandByObject(o); });
      this.H = box.max.y - box.min.y; this.ground = box.min.y;
      const byName = n => { const sn = THREE.PropertyBinding.sanitizeNodeName(n); let f = null; root.traverse(o => { if (!f && o.isBone && (o.name === n || o.name === sn)) f = o; }); return f; }; // trình nạp glTF bỏ dấu '.' khỏi tên
      const B = {}; for (const [k, n] of Object.entries(def.bones)) B[k] = byName(n);
      // .L/.R theo bên trái của nhân vật: nhân vật nhìn +z thì bên trái là +x — đảo nếu model đặt ngược
      const wpos = o => o.getWorldPosition(new THREE.Vector3());
      if (B.upperL && B.upperR && wpos(B.upperL).x < wpos(B.upperR).x) for (const [a, b] of [['upperL', 'upperR'], ['lowerL', 'lowerR'], ['handL', 'handR'], ['thighL', 'thighR'], ['shinL', 'shinR'], ['footL', 'footR']]) [B[a], B[b]] = [B[b], B[a]];
      this.B = B;
      // lúc nghỉ: hướng thế giới (khung model), local, vị trí; A = hướng chuẩn → hướng xương lúc nghỉ
      this.rest = new Map(); root.traverse(o => { if (o.isBone) this.rest.set(o, { q: o.quaternion.clone(), p: o.position.clone(), wq: o.getWorldQuaternion(new THREE.Quaternion()) }); });
      this.Ainv = {};
      for (const [k, [, canon, child]] of Object.entries(SEGS)) {
        if (!B[k]) continue;
        if (!canon || !B[child]) { this.Ainv[k] = new THREE.Quaternion(); continue; }
        const d = wpos(B[child]).sub(wpos(B[k])).normalize();
        this.Ainv[k] = new THREE.Quaternion().setFromUnitVectors(canon, d).invert();
      }
      this.mapped = new Map(Object.entries(B).filter(([k, b]) => b && SEGS[k] && !/^foot/.test(k)).map(([k, b]) => [b, k]));
      this.order = []; root.traverse(o => { if (o.isBone) this.order.push(o); }); // cha trước con
      // bàn chân IK: vị trí bàn chân trong khung cẳng chân lúc nghỉ
      this.footOff = {};
      for (const s of ['L', 'R']) if (B['foot' + s] && B['shin' + s]) this.footOff[s] = B['shin' + s].worldToLocal(wpos(B['foot' + s]));
      const hip = wpos(B.hips), fl = B.footL ? wpos(B.footL) : new THREE.Vector3(0, this.ground, 0);
      this.hipH = hip.y - this.ground; this.footY = fl.y - this.ground;
      const kneeL = wpos(B.shinL), hipL = wpos(B.thighL);
      this.leg = { hip: this.hipH, L1: hipL.distanceTo(kneeL), L2: kneeL.distanceTo(fl), ankle: this.footY, hipX: Math.abs(hipL.x) };
      this.restHip = hip.clone();
      // đạo cụ ở tay phải (khung chuẩn của cẳng tay: trục -y dọc cánh tay)
      this.props = makeProps(); this.props.scale.setScalar(this.H / 1.5 * 0.9);
      const fr = B.lowerR; fr.add(this.props);
      // xương có tỉ lệ riêng (model Quaternius: armature ×0.01, mesh ×100–150) → bù để đạo cụ đúng cỡ trong khung model
      this.props.scale.divideScalar(fr.getWorldScale(new THREE.Vector3()).x / root.getWorldScale(new THREE.Vector3()).x);
      const Wr = this.rest.get(fr).wq, Ar = this.Ainv.lowerR.clone().invert();
      this.props.quaternion.copy(Wr).invert().multiply(Ar); // local = Qr⁻¹·A
      if (B.handR) this.props.position.copy(fr.worldToLocal(wpos(B.handR)));
      this.addLogo(def);
      root.position.y = -this.ground; // đế chân ở y = 0
      this.inner = new THREE.Group(); this.inner.rotation.y = Math.PI; this.inner.add(root); // model nhìn +z, nhân vật nhìn -z
      this.group.add(this.inner);
      this.ready = true;
    }).catch(e => { console.warn('nhân vật: không nạp được', def.file, e); this.failed = true; });
  }
  /** Logo SYSONE (miếng patch trắng) trên ngực trái: bắn tia vào thân lúc nghỉ, gắn vào xương ngực. */
  addLogo(def) {
    const L = def.logo; if (!L) return;
    const H = this.H, root = this.root, meshes = []; root.traverse(o => { if (o.isSkinnedMesh && o.visible) meshes.push(o); });
    const rc = meshes; // bắn tia thẳng vào mesh có xương (three.js tính biến đổi xương; model Quaternius phóng mesh ×100–150 rồi để xương thu lại)
    const halfW = Math.abs(this.B.upperL.getWorldPosition(_v).x);
    const x = (L.x || 0) * halfW, y = this.ground + (L.y ?? 0.6) * H;
    for (const o of rc) { o.skeleton?.update(); o.geometry.boundingSphere = null; o.boundingSphere = null; o.boundingBox = null; }
    const hit = new THREE.Raycaster(new THREE.Vector3(x, y, H * 2), new THREE.Vector3(0, 0, -1)).intersectObjects(rc, false)[0];
    if (!hit) return;
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 170;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const c = cv.getContext('2d');
    const draw = img => { c.clearRect(0, 0, 640, 170); c.fillStyle = '#fff'; c.beginPath(); c.roundRect(4, 4, 632, 162, 34); c.fill(); if (img) { const w = 560, h = w * img.height / img.width; c.drawImage(img, 40, (170 - h) / 2, w, h); } tex.needsUpdate = true; };
    draw(null); const img = new Image(); img.onload = () => draw(img); img.src = new URL('logo/sysone-logo.png', document.baseURI).href; // logo gốc
    const w = (L.w ?? 0.08) * H;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 170 / 640), new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: 0xdddddd, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.material.userData.keepSide = true; m.position.copy(hit.point).add(new THREE.Vector3(0, 0, 0.012 * H)); m.rotation.x = -(L.tilt ?? 0.08);
    root.add(m); root.updateMatrixWorld(true); this.B.chest.attach(m);
  }
  dispose() { this.disposed = true; this.group.parent?.remove(this.group); }
  unit(s) { return (this.def.height || 1.4) * s / this.H; }

  apply(a, P, s, mc, dt) {
    const B = this.B, W = this.W, k = this.unit(s), root = this.root;
    this.group.position.set(a.x, a.y + (a.jumpH || 0), a.z); this.group.rotation.y = a.yaw; this.group.scale.setScalar(k);
    // hướng khớp mocap (khung chibi), tay tự dựng trộn theo trọng số (gõ phím, vẫy, hút thuốc, uống)
    const M = this.Mq;
    for (const [seg, [i]] of Object.entries(SEGS)) { const j = i * 4; (M[seg] ??= new THREE.Quaternion()).set(mc.q[j], mc.q[j + 1], mc.q[j + 2], mc.q[j + 3]); }
    for (let i = 0; i < 2; i++) {
      const w = mc.armW[i]; if (w < 0.001) continue;
      const sx = i ? 1 : -1, up = i ? 'upperR' : 'upperL', lo = i ? 'lowerR' : 'lowerL';
      _q.copy(M.chest).multiply(_q2.setFromEuler(_e.set(P.shP[i], 0, sx * Math.abs(P.shR[i]), 'YXZ'))); M[up].slerp(_q, w);
      _q.multiply(_q2.setFromEuler(_e.set(P.el[i], 0, 0, 'YXZ'))); M[lo].slerp(_q, w);
    }
    // hướng thế giới mong muốn của xương ánh xạ: W = C·A⁻¹·Qr (C = Ry·M·Ry⁻¹)
    for (const [seg] of Object.entries(SEGS)) {
      const b = B[seg]; if (!b) continue;
      (W[seg] ??= new THREE.Quaternion()).copy(M[seg]).premultiply(RY).multiply(RYi).multiply(this.Ainv[seg]).multiply(this.rest.get(b).wq);
    }
    // đặt local từ cha xuống con
    const wq = new Map();
    for (const b of this.order) {
      const pq = b.parent && wq.get(b.parent) || (b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(_q.copy(root.getWorldQuaternion(new THREE.Quaternion())).invert()) : new THREE.Quaternion());
      const seg = this.mapped.get(b), r = this.rest.get(b);
      if (seg) { b.quaternion.copy(pq).invert().multiply(W[seg]); wq.set(b, W[seg]); }
      else if (!/^foot/.test([...Object.entries(B)].find(([, x]) => x === b)?.[0] || '')) { b.quaternion.copy(r.q); wq.set(b, _q2.copy(pq).multiply(r.q).clone()); }
      else wq.set(b, pq.clone());
    }
    // hông: theo mocap (đơn vị chiều cao hông); ngồi: độ cao ghế của tư thế tự dựng
    const sit = Math.min(1, a.sit || 0), hb = B.hips, hh = this.hipH;
    const want = _v.set(this.restHip.x - mc.hip[0] * hh, this.ground + mc.hip[1] * hh, this.restHip.z - mc.hip[2] * hh);
    if (sit > 0) want.lerp(new THREE.Vector3(this.restHip.x, this.ground + P.hipY, this.restHip.z + (P.pz || 0) / k * 0.6), sit);
    const setHip = p => { root.updateMatrixWorld(true); hb.position.copy(hb.parent.worldToLocal(root.localToWorld(p.clone()))); };
    setHip(want);
    // bàn chân IK: đặt vào cuối cẳng chân; xoay theo mocap; chân trụ chạm sàn
    const placeFeet = () => {
      root.updateMatrixWorld(true);
      let minY = Infinity;
      for (const sd of ['L', 'R']) {
        const f = B['foot' + sd], sh = B['shin' + sd]; if (!f || !sh || !this.footOff[sd]) continue;
        const pW = sh.localToWorld(this.footOff[sd].clone());
        f.position.copy(f.parent.worldToLocal(pW.clone()));
        const pq = f.parent.getWorldQuaternion(new THREE.Quaternion());
        const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
        const Wf = _q.copy(M['foot' + sd]).premultiply(RY).multiply(RYi).multiply(this.rest.get(f).wq);
        f.quaternion.copy(pq).invert().multiply(rootQ).multiply(Wf);
        minY = Math.min(minY, root.worldToLocal(pW).y);
      }
      return minY;
    };
    const minY = placeFeet();
    if ((a.jumpH || 0) < 0.015 && sit < 1 && minY < Infinity) { want.y += (this.ground + this.footY - minY) * (1 - sit); setHip(want); placeFeet(); }
    // đạo cụ
    const showCup = a.cup || a.act === 'drink' || a.anim === 'eat';
    for (const c of this.props.children) c.visible = (c.name === 'cup' && showCup) || (c.name === 'cig' && a.act === 'smoke') || (c.name === 'phone' && a.act === 'phone');
    if (a.act === 'smoke') {
      this.group.updateMatrixWorld(true);
      a._tip = (a._tip || new THREE.Vector3()); this.props.children.find(c => c.name === 'cig')?.getWorldPosition(a._tip);
      a._mouth = (a._mouth || new THREE.Vector3()).copy(B.head.getWorldPosition(new THREE.Vector3()));
    }
  }
}

/** Quản lý nhân vật có xương sẵn (mỗi người một bản; khi đổi giữ bản cũ tới lúc bản mới sẵn sàng). */
export class RiggedPool {
  constructor(group, base = './') { this.group = group; this.base = base; this.inst = new Map(); this.used = new Set(); }
  begin() { this.used.clear(); }
  get(a, def) {
    let it = this.inst.get(a);
    if (it && it.def !== def) {
      if (!it.next || it.next.def !== def) { it.next?.dispose(); it.next = new RiggedInstance(def, this.group, this.base); it.next.group.visible = false; }
      if (it.next.ready || it.failed || !it.ready) { const n = it.next; it.next = null; it.dispose(); this.inst.set(a, n); it = n; }
    }
    if (!it) { it = new RiggedInstance(def, this.group, this.base); this.inst.set(a, it); }
    this.used.add(a); it.group.visible = it.ready;
    return it.ready ? it : null;
  }
  loading(a) { const it = this.inst.get(a); return !!it && (!it.ready || !!it.next); }
  end() { for (const [a, it] of this.inst) if (!this.used.has(a)) { it.next?.dispose(); it.dispose(); this.inst.delete(a); } }
}
