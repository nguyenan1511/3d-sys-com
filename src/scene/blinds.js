// Rèm cuốn ở cửa sổ / cửa ban công: kéo lên/xuống (phím F khi đứng gần hoặc bấm vào rèm), đồng bộ cho mọi người.
// Toà nhà lớn (nội thất my-office): rèm tre màu vàng đậm (như rèm tre của ngôi nhà cũ) ở mọi cửa sổ thật của vỏ nhà.
import * as THREE from 'three';
import { shellWalls, floorY as shellFloorY, OFFSET } from '../myoffice/shellSpec.js';

/** Vị trí rèm theo vỏ nhà (house.js): cửa sổ trước tầng trệt, cửa sổ lồi và cửa ban công tầng 2, 3. */
export function blindSpecs(model) {
  const F1 = model.floorY(1), F2 = model.floorY(2);
  const list = [
    { id: 'f0-front', name: 'Rèm cửa sổ trước', floor: 0, x0: -2.75, x1: -0.45, y0: 0.9, y1: 2.42, z: 3.55, nz: -1 },
    { id: 'f1-bay', name: 'Rèm cửa sổ tầng 2', floor: 1, x0: 0.55, x1: 2.65, y0: F1 + 0.8, y1: F1 + 2.42, z: 4.25, nz: -1 },
    { id: 'f2-bay', name: 'Rèm cửa sổ tầng 3', floor: 2, x0: 0.55, x1: 2.65, y0: F2 + 0.8, y1: F2 + 2.42, z: 4.25, nz: -1 },
    { id: 'f1-balcony', name: 'Rèm cửa ban công tầng 2', floor: 1, x0: -2.8, x1: -0.5, y0: F1 + 0.04, y1: F1 + 2.25, z: 3.55, nz: -1 },
    { id: 'f2-balcony', name: 'Rèm cửa ban công tầng 3', floor: 2, x0: -2.8, x1: -0.5, y0: F2 + 0.04, y1: F2 + 2.25, z: 3.55, nz: -1 }
  ];
  return list.map(s => ({ ...s, axis: 'x', a0: s.x0, a1: s.x1, c: s.z, n: s.nz }));
}

/** Toà nhà lớn: một rèm cho mỗi cửa sổ thật (không tính cửa sổ vẽ) của vỏ nhà SYSONE, treo ở mặt trong tường. */
export function bigBlindSpecs() {
  const cx = 3 + OFFSET[0], cz = 0.5 + OFFSET[1]; // tâm toà nhà: phía trong tường
  const FLOOR = ['tầng trệt', 'tầng 2', 'tầng 3'], out = [], count = new Map();
  for (const w of shellWalls()) {
    const wins = w.open.filter(o => o.kind === 'window'); if (!wins.length) continue;
    const ax = w.axis, mid = ax === 'x' ? (w.z0 + w.z1) / 2 : (w.x0 + w.x1) / 2, n = ax === 'x' ? Math.sign(cz - mid) : Math.sign(cx - mid);
    const face = ax === 'x' ? (n < 0 ? w.z0 : w.z1) : (n < 0 ? w.x0 : w.x1);
    const side = ax === 'x' ? (n < 0 ? 'truoc' : 'sau') : (n < 0 ? 'phai' : 'trai'), sideVi = { truoc: 'mặt trước', sau: 'mặt sau', phai: 'bên phải', trai: 'bên trái' }[side];
    const y = shellFloorY(w.floor);
    for (const o of wins) {
      const k = `${w.floor}-${side}`, i = (count.get(k) || 0) + 1; count.set(k, i);
      out.push({ id: `b${w.floor}-${side}-${i}`, name: `Rèm cửa sổ ${sideVi} ${FLOOR[w.floor]}`, floor: w.floor, axis: ax, a0: o.a0 + 0.02, a1: o.a1 - 0.02, c: face + n * 0.07, n, y0: y + o.y0, y1: y + o.y1 + 0.08, open: false, lite: true }); // (mặc định rèm kéo xuống)
    }
  }
  return out;
}

let bambooTex = null;
function bamboo() {
  if (bambooTex) return bambooTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  for (let x = 0; x < 64; x += 4) { g.fillStyle = (x / 4) % 2 ? '#c99a3f' : '#b0812c'; g.fillRect(x, 0, 4, 64); } // nan tre vàng đậm
  g.strokeStyle = '#6b4a1e'; g.lineWidth = 2; [14, 46].forEach(y => { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y); g.stroke(); });
  bambooTex = new THREE.CanvasTexture(cv); bambooTex.wrapS = bambooTex.wrapT = THREE.RepeatWrapping; bambooTex.colorSpace = THREE.SRGBColorSpace; bambooTex.anisotropy = 4;
  return bambooTex;
}

export class Blinds {
  /** outer: rèm tre ngoài ban công (house.js) cuộn cùng rèm trong nhà có cùng id. opts.big: rèm tre của toà nhà lớn. */
  constructor(scene, model, outer = [], opts = {}) {
    this.outer = outer;
    this.group = new THREE.Group(); this.group.name = 'blinds'; scene.add(this.group);
    const big = !!opts.big;
    const fabric = big ? new THREE.MeshLambertMaterial({ map: bamboo(), side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ color: 0xe9e2d2 });
    const dark = new THREE.MeshLambertMaterial({ color: big ? 0x6b4a1e : 0x8a8578 });
    const tube = new THREE.MeshLambertMaterial({ color: big ? 0x7a5524 : 0xf2f2ee });
    const specs = big ? bigBlindSpecs() : blindSpecs(model);
    const rolls = [];
    this.items = specs.map(s => {
      const w = s.a1 - s.a0, h = s.y1 - s.y0, am = (s.a0 + s.a1) / 2, rotY = s.axis === 'x' ? 0 : Math.PI / 2;
      const P = (a, y, off = 0) => s.axis === 'x' ? new THREE.Vector3(a, y, s.c + s.n * off) : new THREE.Vector3(s.c + s.n * off, y, a);
      const g = new THREE.Group(); this.group.add(g);
      // ống cuốn (đứng yên): gộp chung một hình cho toà nhà lớn
      const rg = new THREE.CylinderGeometry(0.045, 0.045, w + 0.06, 10); rg.rotateZ(Math.PI / 2); rg.rotateY(rotY); const rp = P(am, s.y1 + 0.03); rg.translate(rp.x, rp.y, rp.z);
      if (big) rolls.push(rg); else g.add(new THREE.Mesh(rg, tube));
      const cg = new THREE.BoxGeometry(w, 1, 0.012); cg.translate(0, -0.5, 0);
      if (big) { const uv = cg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 0.8, uv.getY(i) * h / 0.8); }
      const cloth = new THREE.Mesh(cg, fabric); cloth.rotation.y = rotY; cloth.position.copy(P(am, s.y1)); g.add(cloth);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.03, 0.025), dark); bar.rotation.y = rotY; g.add(bar);
      const it = { ...s, g, cloth, bar, P, am, open: !!s.open, k: s.open ? 1 : 0, h };
      // dây kéo bên phải (nhìn từ trong phòng), có hạt nắm (nhà cũ)
      if (!s.lite) {
        const cp = P(s.a1 - 0.06, s.y1, 0.03);
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 6), dark); cord.geometry.translate(0, -0.5, 0); cord.position.copy(cp); g.add(cord);
        const bead = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), dark); g.add(bead);
        Object.assign(it, { cord, bead, cordP: cp });
      }
      for (const m of [cloth, bar, it.cord, it.bead]) if (m) m.userData.blind = it;
      return it;
    });
    if (rolls.length) { const geo = mergeGeos(rolls); if (geo) this.group.add(new THREE.Mesh(geo, tube)); }
    this.byId = new Map(this.items.map(i => [i.id, i]));
    this.update(1);
  }
  set(id, open, instant = false) { const it = this.byId.get(id); if (!it) return; it.open = open; if (instant) it.k = open ? 1 : 0; }
  meshes() { const out = []; for (const it of this.items) { out.push(it.cloth, it.bar); if (it.cord) out.push(it.cord, it.bead); } return out; }
  /** Rèm gần (x,z) trên cùng tầng trong bán kính r (đo tới mép rèm). */
  near(x, z, f, r = 1.0) {
    let best = null, bd = r;
    for (const it of this.items) {
      if (it.floor !== f) continue;
      const u = it.axis === 'x' ? x : z, p = it.axis === 'x' ? z : x;
      const d = Math.hypot(Math.max(it.a0 - u, 0, u - it.a1), p - it.c);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }
  update(dt) {
    for (const it of this.items) {
      const target = it.open ? 1 : 0;
      if (it.k === target && it._shown !== undefined) continue;
      it.k += Math.max(-dt * 1.4, Math.min(dt * 1.4, target - it.k)); // kéo mất ~0.7 s
      const shown = Math.max(0.04, it.h * (1 - 0.94 * it.k)); it._shown = shown;
      it.cloth.scale.y = shown;
      it.bar.position.copy(it.P(it.am, it.y1 - shown));
      if (it.cord) {
        const cordLen = 0.35 + 0.9 * (1 - it.k * 0.5);
        it.cord.scale.y = Math.min(cordLen, it.h - 0.05);
        it.bead.position.set(it.cordP.x, it.y1 - it.cord.scale.y, it.cordP.z);
      }
    }
    // rèm tre bên ngoài: cuộn lên cùng lúc, vân tre giữ đúng tỉ lệ
    for (const o of this.outer) {
      const it = this.byId.get(o.id); if (!it) continue;
      const k = Math.max(0.05, 1 - 0.95 * it.k);
      o.mesh.scale.y = k; o.mat.map.repeat.y = o.repeatY * k;
    }
  }
}

/** Gộp các hình (cùng thuộc tính) thành một. */
function mergeGeos(list) {
  let n = 0, idx = 0; for (const g of list) { n += g.attributes.position.count; idx += g.index.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), index = new Uint32Array(idx);
  let o = 0, io = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); const ix = g.index.array; for (let i = 0; i < ix.length; i++) index[io + i] = ix[i] + o; o += g.attributes.position.count; io += ix.length; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setIndex(new THREE.BufferAttribute(index, 1));
  return geo;
}
