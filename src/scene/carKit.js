// Ô tô từ Kenney Car Kit (CC0) — dữ liệu đóng gói sẵn trong public/assets/vehicles/cars.json (lấy từ dự án my-office,
// MIT). Mỗi mẫu: phần sơn (tô theo màu xe) + phần còn lại (kính, đèn, cản, có màu theo đỉnh) + bánh xe. Đầu xe hướng +x.
// loadCarKit() nạp một lần lúc khởi động; kitCar() dựng đồng bộ (null nếu chưa nạp — khi đó dùng xe tự dựng cũ).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let KIT = null, loading = null;
// (một lần tải dùng chung với street-life.js của hai bản my-office: globalThis.__carKitJson)
export const loadCarKit = (base = './') => (loading ??= (globalThis.__carKitJson ??= fetch(new URL('assets/vehicles/cars.json', new URL(base, document.baseURI))).then(r => (r.ok ? r.json() : null)).catch(() => null)).then(k => (KIT = k)).catch(() => null));
export const carKitReady = () => !!KIT;

const unb64 = (s, T) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new T(u.buffer); };
const linear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function geo(part) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(unb64(part.pos, Int16Array), v => v / 2000), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Float32Array.from(unb64(part.nrm, Int8Array), v => v / 127), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Float32Array.from(unb64(part.col, Uint8Array), v => linear(v / 255)), 3));
  g.setIndex(new THREE.BufferAttribute(unb64(part.idx, Uint16Array), 1));
  return g;
}
const cache = new Map(), mats = new Map();
const paintMat = c => { if (!mats.has(c)) mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.38, metalness: 0.15 })); return mats.get(c); };
const trimMat = () => { if (!mats.has('trim')) mats.set('trim', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 })); return mats.get('trim'); };

/** Hình học dùng chung của một mẫu xe (theo khung của bộ kit: đầu xe +x, ×kit.scale). */
function shapes(name) {
  if (cache.has(name)) return cache.get(name);
  const m = KIT.models[name]; if (!m) return null;
  const turn = new THREE.Matrix4().makeScale(KIT.scale, KIT.scale, KIT.scale).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  // thân xe và phần còn lại đã quay đầu +x sẵn trong dữ liệu; chỉ bánh xe còn ở khung gốc của bộ kit (như my-office: street-life.js kitCar)
  const body = geo(m.paint);
  const rest = [geo(m.rest)];
  for (const w of m.wheels) rest.push(geo(KIT.wheel).applyMatrix4(new THREE.Matrix4().multiplyMatrices(turn, new THREE.Matrix4().compose(new THREE.Vector3(...w.t), new THREE.Quaternion(...w.r), new THREE.Vector3(...w.s)))));
  const trim = mergeGeometries(rest.map(g => g.index ? g : g), false);
  body.computeBoundingBox(); trim.computeBoundingBox();
  const box = body.boundingBox.clone().union(trim.boundingBox);
  const out = { body, trim, box };
  cache.set(name, out); return out;
}

/**
 * Ô tô mẫu `model` (sedan, sedan-sports, hatchback-sports, suv, suv-luxury, truck, van, delivery, taxi, ambulance,
 * firetruck), sơn `color`, cao `height` mét (thu phóng đều — xe dáng đồ chơi nên ngắn hơn xe thật). Trả về Group (đầu
 * xe +x, bánh chạm y = 0) hoặc null.
 */
export function kitCar(model, color, height) {
  if (!KIT) return null;
  const S = shapes(model); if (!S) return null;
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const b = new THREE.Mesh(S.body, paintMat(color)), t = new THREE.Mesh(S.trim, trimMat());
  b.castShadow = t.castShadow = true; inner.add(b, t);
  const L = S.box.max.x - S.box.min.x, Hb = S.box.max.y - S.box.min.y, k = height ? height / Hb : 1;
  inner.scale.setScalar(k); inner.position.set(-(S.box.min.x + S.box.max.x) / 2 * k, -S.box.min.y * k, -(S.box.min.z + S.box.max.z) / 2 * k);
  g.userData.kit = { model, size: [L * k, (S.box.max.y - S.box.min.y) * k, (S.box.max.z - S.box.min.z) * k] };
  return g;
}
