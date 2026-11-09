// Khối dựng hình theo phong cách dự án my-office (khanh020905/my-office, MIT — src/office/scene/blocks.js): vật liệu
// nhám (MeshStandard roughness 0.78), hộp bo góc, trụ. Vật liệu được lưu đệm theo màu để khối tĩnh gộp được draw call.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const mats = new Map();
/** Vật liệu nhám kiểu my-office (lưu đệm theo màu + tuỳ chọn). */
export function moMat(color, o = {}) {
  const k = color + JSON.stringify(o);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, ...o }));
  return mats.get(k);
}
export const METAL = () => moMat('#A9AEB6', { roughness: 0.45, metalness: 0.35 });
const geos = new Map();
/** Hộp bo góc rộng w, cao h, sâu d (tâm ở giữa). */
export function rbox(w, h, d, m, r = 0.03) {
  const rr = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  const k = [w, h, d, rr].map(v => v.toFixed(4)).join();
  if (!geos.has(k)) geos.set(k, new RoundedBoxGeometry(w, h, d, 2, rr));
  const mesh = new THREE.Mesh(geos.get(k), m.isMaterial ? m : moMat(m)); mesh.castShadow = mesh.receiveShadow = true; return mesh;
}
export function cyl(rt, rb, h, m, seg = 16) { const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m.isMaterial ? m : moMat(m)); mesh.castShadow = mesh.receiveShadow = true; return mesh; }
export function put(parent, mesh, x, y, z) { mesh.position.set(x, y, z); parent.add(mesh); return mesh; }

export const CHAIR_IDLE = '#596170'; // màu ghế trống (my-office world/desks.js CHAIR_IDLE)
/** Ghế xoay văn phòng (my-office officeChair): chân sao 5 cánh có bánh, trụ hơi, đệm và tựa lưng bo tròn. Tựa lưng ở +z. */
export function officeChair(parent, color = '#596170') {
  const c = new THREE.Group(); parent.add(c);
  const seat = color?.isMaterial ? color : moMat(color, { roughness: 0.9 }), metal = METAL(); // (vật liệu riêng: ghế đổi màu theo người ngồi)
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const leg = rbox(0.045, 0.035, 0.27, metal, 0.01); leg.position.set(Math.sin(a) * 0.13, 0.07, Math.cos(a) * 0.13); leg.rotation.y = a; c.add(leg);
    put(c, new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), metal), Math.sin(a) * 0.26, 0.035, Math.cos(a) * 0.26);
  }
  put(c, cyl(0.032, 0.032, 0.32, metal, 8), 0, 0.25, 0);
  put(c, rbox(0.5, 0.08, 0.48, seat, 0.04), 0, 0.445, 0);
  const back = put(c, rbox(0.46, 0.5, 0.08, seat, 0.04), 0, 0.76, 0.24); back.rotation.x = 0.1;
  put(c, rbox(0.06, 0.28, 0.05, metal, 0.01), 0, 0.56, 0.22);
  return c;
}
