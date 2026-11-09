// Sân vườn trên khu đất của SYSONE (bệ đế giữa các dãy phố my-office): bãi cỏ có bó vỉa, hàng cây tròn và chậu cây
// cùng kiểu với thành phố my-office (src/vendor/my-office: roundTree, potPlant), chừa lối đi quanh nhà và lối vào cổng.
import * as THREE from 'three';
import { roundTree, geoAt } from '../vendor/my-office/src/office/world/backdrops/shared.js';
import { GY, mergeAll, vmat, potPlant } from '../vendor/my-office/src/office/world/terrace.js';

/**
 * lot: khu đất (x0..x1, z0..z1), house: vùng nhà + sân trước tới hàng rào (không trồng gì), gate: [x0, x1] lối vào cổng.
 * Trả về nhóm đã dựng; khối va chạm cho người đi (gốc cây, chậu) đẩy vào COL nếu có.
 */
export function buildLotGarden(lot, house, gate, COL = null) {
  const G = new THREE.Group(); G.name = 'lot garden';
  const parts = [], trees = [];
  const lift = -GY;                                                     // cây của my-office đặt ở mặt đường: nhấc lên mặt bệ
  const box = (x0, x1, y0, y1, z0, z1, c) => parts.push(geoAt(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, c));
  const lawn = (x0, x1, z0, z1) => {
    if (x1 - x0 < 1.2 || z1 - z0 < 1.2) return;
    box(x0, x1, 0, 0.06, z0, z1, '#C9C2B4');                             // bó vỉa
    box(x0 + 0.12, x1 - 0.12, 0.06, 0.08, z0 + 0.12, z1 - 0.12, '#7FA864'); // cỏ
    // cây dọc giữa bãi cỏ, mỗi ~4 m
    const n = Math.max(1, Math.floor((z1 - z0) / 4)), cx = (x0 + x1) / 2;
    for (let i = 0; i < n; i++) {
      const z = z0 + (z1 - z0) * (i + 0.5) / n, s = 0.8 + ((i * 37) % 5) * 0.06;
      roundTree(trees, cx + ((i % 2) - 0.5) * Math.min(1.2, (x1 - x0) / 4), z, s);
      COL?.push({ x0: cx - 0.6, x1: cx + 0.6, y0: 0, y1: 3, z0: z - 0.6, z1: z + 0.6 });
    }
  };
  const m = 1.2;                                                       // lối đi quanh nhà và mép khu đất
  lawn(lot.x0 + m, house.x0 - m, lot.z0 + m, lot.z1 - m - 1.4);         // trái
  lawn(house.x1 + m, lot.x1 - m, lot.z0 + m, lot.z1 - m - 1.4);         // phải
  lawn(house.x0, house.x1, lot.z0 + m, house.z0 - m);                   // sau nhà
  // dải cỏ trước hàng rào, chừa lối vào cổng
  lawn(house.x0 - 3, gate[0] - 0.6, house.z1 + 0.5, lot.z1 - 0.9);
  lawn(gate[1] + 0.6, house.x1 + 3, house.z1 + 0.5, lot.z1 - 0.9);
  const ground = new THREE.Mesh(mergeAll(parts), vmat({ roughness: 0.9 })); ground.receiveShadow = true; G.add(ground);
  const t = new THREE.Mesh(mergeAll(trees).translate(0, lift, 0), vmat({ roughness: 0.85, flatShading: true })); t.castShadow = true; G.add(t);
  // chậu cây lớn hai bên lối vào và dọc mép trước khu đất
  const pots = [[gate[0] - 0.9, lot.z1 - 0.6], [gate[1] + 0.9, lot.z1 - 0.6]];
  for (let x = lot.x0 + 2; x < lot.x1 - 1; x += 4.5) if (x < house.x0 - 3.5 || x > house.x1 + 3.5) pots.push([x, lot.z1 - 0.6]);
  pots.forEach(([x, z], i) => { potPlant(x, z, 1.1, i % 3 === 0 ? 'tree' : 'bush', 0, G); COL?.push({ x0: x - 0.3, x1: x + 0.3, y0: 0, y1: 1.2, z0: z - 0.3, z1: z + 0.3 }); });
  return G;
}
