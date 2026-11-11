// Nội thất ngôi nhà SYSONE = văn phòng my-office (khanh020905/my-office, MIT), đúng không gian và tỉ lệ gốc:
//   tầng trệt = tầng công ty "pro" của bản HQ (z -8 → 9: sảnh, lễ tân, WC, server, giám đốc, họp, thư viện, pantry,
//               lounge, khu dev 12 bàn), tầng 2 = cánh 4 phòng ban của bản HQ (z 9 → 26, 32 bàn) nâng lên một tầng và kéo
//               về cùng mặt bằng (z -8 → 9).
// Thế giới my-office được dựng một lần (src/myoffice/boot.js), rồi từng vật được xếp vào tầng theo vị trí, sau đó mới gộp
// hình (core/optimize.js) để giữ số lệnh vẽ thấp. Thành phố quanh văn phòng gốc không dùng (bên ngoài là phố SYSONE).
import * as THREE from 'three';
import { MO, buildMyOffice } from './boot.js';
import { THEME } from '../vendor/my-office/src/office/world/backdrops/index.js';
import { optimizeStatic } from '../vendor/my-office/src/office/core/optimize.js';
import { MO as MOC, buildMyOffice as buildCozyOffice } from './boot-cozy.js';
import { THEME as THEME_C } from '../vendor/my-office-cozy/src/office/world/backdrops/index.js';
import { optimizeStatic as optimizeCozy } from '../vendor/my-office-cozy/src/office/core/optimize.js';
import { DESKS as DESKS_HQ, chairs as CHAIRS_HQ, screens as SCREENS_HQ } from '../vendor/my-office/src/office/world/desks.js';
import { DESKS as DESKS_C, chairs as CHAIRS_C, screens as SCREENS_C } from '../vendor/my-office-cozy/src/office/world/desks.js';

export const FLOOR_H = 4.5;           // tường my-office cao 4,2 m + sàn 0,3 m
export const WING_SHIFT = 17;         // cánh phòng ban (z 9 → 26) kéo về z -8 → 9
export const SPLIT_Z = 9;
// tầng 3: phòng cozy 16 × 12 m (x -8 → 8, z -6 → 6) đặt lùi vào giữa mái tầng 2 (xung quanh là sân thượng)
export const COZY_AT = [3, -1.5];

/** Toạ độ my-office (x, z) của một điểm → { floor, x, y, z } trong toà nhà SYSONE (trước khi dời toà nhà). */
export function moToBuilding(x, z) {
  return z < SPLIT_Z ? { floor: 0, x, y: 0, z } : { floor: 1, x, y: FLOOR_H, z: z - WING_SHIFT };
}
/** Toạ độ phòng cozy (x, z) → toà nhà (tầng 3). */
export const cozyToBuilding = (x, z) => ({ floor: 2, x: x + COZY_AT[0], y: 2 * FLOOR_H, z: z + COZY_AT[1] });
const DROP = ['terrace', 'city', 'backdrop', 'weather'];

/**
 * Dựng nội thất. Trả về { root (nhóm chứa cả hai tầng, đặt tại offset), lights, floors: [g0, g1] }.
 * offset: dời cả toà nhà [dx, dz] để mặt tiền nằm đúng chỗ trên phố SYSONE.
 */
export function buildMyBuilding(renderer, { offset = [0, 0], optimize = true, stripDesks = false } = {}) {
  globalThis.__MO_SKIP_BACKDROP = true; // không dựng thành phố của my-office (dùng đường phố SYSONE) — xem backdrops/index.js
  const scene = buildMyOffice(renderer, { plan: 'hq', optimize: false });
  if (THEME?.group) THEME.group.removeFromParent();          // không dùng thành phố của my-office
  const g0 = new THREE.Group(), g1 = new THREE.Group(), lights = [];
  g0.name = 'mo-floor-0'; g1.name = 'mo-floor-1'; g1.position.set(0, FLOOR_H, -WING_SHIFT);
  const box = new THREE.Box3(), c = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  for (const o of [...scene.children]) {
    if (o.isCamera) continue;
    if (o.isLight && (o.isDirectionalLight || o.isHemisphereLight || o.isAmbientLight)) { lights.push(o); continue; }
    if (DROP.includes(o.userData.moModule)) { o.removeFromParent(); continue; } // sân thượng, thành phố, mưa của văn phòng gốc
    if (o === g0 || o === g1) continue;
    box.setFromObject(o);
    if (box.isEmpty()) { g0.add(o); continue; }
    box.getCenter(c);
    (c.z < SPLIT_Z ? g0 : g1).add(o);
  }
  scene.add(g0, g1);
  // tầng trệt: bỏ cầu thang thoát hiểm của văn phòng gốc dựng phía ngoài tường trái (chỗ đó là khối cầu thang SYSONE)
  { const gone = []; g0.updateMatrixWorld(true);
    g0.traverse(o => { if (!o.isMesh) return; box.setFromObject(o); if (!box.isEmpty() && (box.max.x < -8.32 || (box.min.x < -8.4 && box.max.x < -8.0))) gone.push(o); }); // (tường mỏng của cầu thang gốc chìa vào trong tường trái)
    for (const o of gone) o.removeFromParent(); }
  // tầng 2: bỏ tường trái của cánh phòng ban (và cửa sổ trên đó) — vỏ nhà SYSONE dựng tường này, có cửa ra khối cầu thang
  for (const o of [...g1.children]) { box.setFromObject(o); if (!box.isEmpty() && box.max.x < -7.75) o.removeFromParent(); }
  // tầng 2: cuối hành lang giữa (sát tường trước) là cửa thang máy — dời chậu cây/đồ nhỏ ở đó (vách kính hai bên giữ nguyên)
  { const gone = []; g1.updateMatrixWorld(true); const sz = new THREE.Vector3();
    g1.traverse(o => { if (!o.isMesh) return; box.setFromObject(o); if (box.isEmpty()) return; box.getSize(sz);
      if (box.min.x > 2.15 && box.max.x < 4.45 && box.min.z > 7.6 && box.max.z < 9.5 && sz.y < 2.6) gone.push(o); });
    for (const o of gone) o.removeFromParent(); }
  // stripDesks: bỏ mặt bàn và đồ trên bàn cố định của my-office (giữ ghế) — bàn dựng lại theo cấu hình dụng cụ từng chỗ
  // (main.js moInterior → deskKit.buildDesk). Bộ sinh bố cục không bỏ (lưới đi lại vẫn tính chỗ bàn).
  const strip = list => { for (const d of list) if (d.g) for (const c of [...d.g.children]) if (c !== d.chair) c.removeFromParent(); };
  if (stripDesks) strip(DESKS_HQ);
  // gộp hình sau khi xếp tầng (hình gộp lấy toạ độ thế giới nên đúng tầng)
  if (optimize) try { MO.merged = optimizeStatic(); } catch (e) { MO.errors.push('optimize: ' + e.message); console.warn('my-office optimize', e); }
  // tầng 3: phòng cozy (bộ module my-office thứ hai, src/vendor/my-office-cozy)
  const sc2 = buildCozyOffice(renderer, { plan: 'cozy', optimize: false });
  if (THEME_C?.group) THEME_C.group.removeFromParent();
  const g2 = new THREE.Group(); g2.name = 'mo-floor-2'; g2.position.set(COZY_AT[0], 2 * FLOOR_H, COZY_AT[1]);
  for (const o of [...sc2.children]) {
    if (o.isCamera || DROP.includes(o.userData.moModule) || (o.isLight && !o.isPointLight && !o.isSpotLight)) { o.removeFromParent(); continue; } // (nắng, bầu trời: dùng của bản HQ)
    { const bx = new THREE.Box3().setFromObject(o); if (!o.isLight && !bx.isEmpty() && (bx.max.x < -8.3 || bx.getCenter(new THREE.Vector3()).x < -8.05 || bx.min.z > 6.2 || bx.min.x > 8.2)) { o.removeFromParent(); continue; } } // (hành lang, thảm chùi chân… ngoài phòng cozy)
    g2.add(o);
  }
  sc2.add(g2);
  if (stripDesks) strip(DESKS_C);
  if (optimize) try { MOC.merged = optimizeCozy(); } catch (e) { MOC.errors.push('optimize: ' + e.message); console.warn('my-office cozy optimize', e); }
  const root = new THREE.Group(); root.name = 'my-office interior'; root.position.set(offset[0], 0, offset[1]);
  for (const sc of [scene, sc2]) for (const o of [...sc.children]) if (!o.isCamera && !(o.isLight && lights.includes(o))) root.add(o);
  return { root, lights, floors: [g0, g1, g2], scene, errors: [...MO.errors, ...MOC.errors] };
}

/**
 * Bàn làm việc của toà nhà (sau khi dựng): mã bàn, tầng, vị trí/hướng/ghế theo toạ độ toà nhà (chưa dời OFFSET),
 * vật liệu ghế và màn hình của my-office. Thứ tự và mã bàn cố định — scripts/import-sysone-layout.mjs dùng cùng hàm này.
 *   tầng trệt T1-01…, tầng 2 T2-01…, tầng 3 T3-01…
 */
export function buildingDesks() {
  const out = [], n = [0, 0, 0];
  const add = (d, i, f, chairs, screens, toB) => {
    const p = toB(d.x, d.z), s = Math.sin(d.ry), c = Math.cos(d.ry), seat = toB(d.x - 0.66 * s, d.z - 0.66 * c);
    n[f]++;
    out.push({ id: `T${f + 1}-${String(n[f]).padStart(2, '0')}`, floor: f, x: p.x, z: p.z, ry: d.ry, seat: [seat.x, seat.z], chairM: chairs[i], screenM: screens[i], vendor: d });
  };
  DESKS_HQ.forEach((d, i) => { if (d.z < SPLIT_Z) add(d, i, 0, CHAIRS_HQ, SCREENS_HQ, moToBuilding); });
  DESKS_HQ.forEach((d, i) => { if (d.z >= SPLIT_Z) add(d, i, 1, CHAIRS_HQ, SCREENS_HQ, moToBuilding); });
  DESKS_C.forEach((d, i) => add(d, i, 2, CHAIRS_C, SCREENS_C, cozyToBuilding));
  return out;
}
