// Vỏ ngôi nhà SYSONE quanh nội thất my-office (3 tầng) — số liệu dùng chung cho dựng hình 3D (src/scene/sysoneShell.js)
// và sinh bố cục (scripts/import-sysone-layout.mjs: vùng đi được, tường, cầu thang, điểm mốc).
//
// Toạ độ nội bộ = toạ độ của my-office (tầng công ty x -8 → 14, z -8 → 9; tường my-office cao 4,2 m). Cả toà nhà dời
// OFFSET để mặt tiền nằm sau hàng rào/cổng SYSONE (z ≈ 9) và giữa khu đất. Mọi hàm xuất ra toạ độ thế giới đã dời.
//   tầng trệt (0): tầng công ty "pro" của my-office      tầng 2 (1): cánh 4 phòng ban (bản HQ)
//   tầng 3 (2):    phòng "cozy" 16 × 12 m lùi vào giữa, xung quanh là sân thượng
// Cầu thang bộ nằm trong khối thang bên trái toà nhà (ngoài tường trái của my-office): cửa thang tầng trệt là cửa cầu
// thang sẵn có của my-office (cạnh thang máy, z 4,91), tầng 2 vào hành lang A, tầng 3 ra sân thượng.
export const OFFSET = [-1.85, -4.8];
export const Y0 = 0.05;                         // mặt sàn tầng trệt (ngang sân trước)
export const FH = 4.5;                          // chiều cao một tầng (tường 4,2 + sàn 0,3)
export const floorY = f => Y0 + f * FH;
export const CEIL = 4.2;                        // trần mỗi tầng (tính từ mặt sàn)
export const ENV = { x0: -8.6, x1: 14.6, z0: -8.6, z1: 9.6, t: 0.28 };      // mặt ngoài tường bao, độ dày
export const COZY = { x0: -5, x1: 11, z0: -7.5, z1: 4.5, door: [-5, 0] };   // phòng cozy (toạ độ nội bộ), cửa ở tường trái
export const ANNEX = { x0: -11, x1: ENV.x0, z0: ENV.z0, z1: 5.8, t: 0.25, laneA: [-9.66, -8.6], laneB: [-10.75, -9.7] };
export const STAIR_DOOR0 = { z0: 4.48, z1: 5.34, h: 2.1 };                 // cửa cầu thang my-office ở tường trái tầng trệt
export const DOOR1 = { z0: -7.6, z1: -6.6, h: 2.2 };                        // tầng 2: cửa từ khối thang vào hành lang A
export const DOOR2 = { z0: 1.2, z1: 2.2, h: 2.2 };                          // tầng 3: cửa từ khối thang ra sân thượng
/** Thang máy (toạ độ nội bộ): tầng trệt dùng thang máy sẵn có của my-office trong sảnh (cửa mở về +x tại x -6,95, chỗ đứng
 *  stand0); tầng 2 cửa thang ở tường trước, cuối hành lang giữa (mở ra là nhìn thẳng hành lang dẫn tới cả 4 phòng); tầng 3 cửa
 *  thang ở tường trước bên trong phòng làm việc. up: { x tâm cửa, wallZ mặt trong tường, half nửa bề ngang khung }. */
export const LIFT = { z: 3.3, half: 1.1, door0X: -6.95, stand0: [-6.35, 3.3],
  up: { 1: { x: 3.3, wallZ: 9.32, half: 0.95 }, 2: { x: 7.45, wallZ: 4.52, half: 1.0 } } };
const noLift = (f, list) => list.filter(o => o.a1 < LIFT.up[f].x - 1.1 || o.a0 > LIFT.up[f].x + 1.1); // (bỏ ô cửa sổ chỗ cửa thang)
export const FRONT_DOORS = [[-3.1, -1.7], [6.7, 8.1]];                      // hai cửa chính (lối đi hai bên khu dev của my-office)

const W = (x, z) => [+(x + OFFSET[0]).toFixed(3), +(z + OFFSET[1]).toFixed(3)];
const rect = r => { const [x0, z0] = W(r.x0, r.z0), [x1, z1] = W(r.x1, r.z1); return { ...r, x0, x1, z0, z1 }; };
const t = ENV.t;
const win = (a0, a1, y0 = 0.9, y1 = 3.3) => ({ a0, a1, y0, y1, kind: 'window' });
const door = (a0, a1, h = 2.6) => ({ a0, a1, y0: 0, y1: h, kind: 'door' });
const row = (from, to, w, step, y0, y1) => { const o = []; for (let a = from; a + w <= to + 1e-6; a += step) o.push(win(a, a + w, y0, y1)); return o; };

/** Tường bao (toạ độ nội bộ; y theo mặt sàn tầng đó). axis 'x': tường chạy dọc x (mặt trước/sau), 'z': tường trái/phải. */
const WALLS = [
  // ---- tầng trệt ----
  { floor: 0, axis: 'x', x0: ENV.x0, x1: ENV.x1, z0: ENV.z1 - t, z1: ENV.z1, h: FH, open: [door(...FRONT_DOORS[0]), door(...FRONT_DOORS[1]), win(-6.6, -5.0, 2.4, 3.2), win(-0.9, 1.5), win(2.2, 4.6), win(9.2, 11.4), win(11.9, 14.0)] },
  { floor: 0, axis: 'z', x0: ENV.x1 - t, x1: ENV.x1, z0: ENV.z0, z1: ENV.z1, h: FH, open: [win(-6.9, -4.7), win(-3.4, -1.2), win(1.4, 3.6), win(4.8, 7.0)] },
  { floor: 0, axis: 'x', x0: ENV.x0, x1: ENV.x1, z0: ENV.z0, z1: ENV.z0 + t, h: FH, open: [], fake: row(-7, 13, 2, 3.5, 0.9, 3.1) },  // (my-office có tường + cửa sổ vẽ cảnh bên trong)
  { floor: 0, axis: 'z', x0: ENV.x0, x1: ENV.x0 + t, z0: ENV.z0, z1: ENV.z1, h: FH, open: [door(STAIR_DOOR0.z0, STAIR_DOOR0.z1, STAIR_DOOR0.h)] },
  // ---- tầng 2 ----
  { floor: 1, axis: 'x', x0: ENV.x0, x1: ENV.x1, z0: ENV.z1 - t, z1: ENV.z1, h: FH, open: noLift(1, row(-7.4, 14, 2.2, 3.1, 0.9, 3.3)) },
  { floor: 1, axis: 'z', x0: ENV.x1 - t, x1: ENV.x1, z0: ENV.z0, z1: ENV.z1, h: FH, open: row(-7.2, 9, 2.2, 3.2, 0.9, 3.3) },
  { floor: 1, axis: 'x', x0: ENV.x0, x1: ENV.x1, z0: ENV.z0, z1: ENV.z0 + t, h: FH, open: row(-6.8, 14, 2.2, 3.4, 1.4, 3.4) },          // (trên vách thấp hành lang A)
  { floor: 1, axis: 'z', x0: ENV.x0, x1: ENV.x0 + t, z0: ENV.z0, z1: ENV.z1, h: FH, open: [door(DOOR1.z0, DOOR1.z1, DOOR1.h), win(6.4, 8.6)] },
  // ---- tầng 3: hai mặt phòng cozy mà my-office để trống (mặt trước, mặt phải) ----
  { floor: 2, axis: 'x', x0: COZY.x0 - 0.3, x1: COZY.x1 + 0.3, z0: COZY.z1 + 0.02, z1: COZY.z1 + 0.3, h: CEIL, open: [...noLift(2, [win(-3.8, -1.6), win(-0.6, 1.6), win(2.6, 4.8), win(5.8, 8.0)]), door(9.2, 10.4, 2.4)] },
  { floor: 2, axis: 'z', x0: COZY.x1 + 0.02, x1: COZY.x1 + 0.3, z0: COZY.z0 - 0.3, z1: COZY.z1 + 0.3, h: CEIL, open: row(-6.6, 4, 2.0, 2.8, 0.9, 3.3) },
  // ---- khối thang (bên trái) ----
  { floor: 0, axis: 'z', x0: ANNEX.x0, x1: ANNEX.x0 + ANNEX.t, z0: ANNEX.z0, z1: ANNEX.z1, h: 3 * FH - 1.1, open: [], fake: [win(-6, -5, 1.4, 2.6), win(-1, 0, 2.6, 3.8), win(3, 4, 1.4, 2.6)] },
  { floor: 0, axis: 'x', x0: ANNEX.x0, x1: ANNEX.x1, z0: ANNEX.z1 - ANNEX.t, z1: ANNEX.z1, h: 3 * FH - 1.1, open: [] },
  { floor: 0, axis: 'x', x0: ANNEX.x0, x1: ANNEX.x1, z0: ANNEX.z0, z1: ANNEX.z0 + ANNEX.t, h: 3 * FH - 1.1, open: [] },
  { floor: 2, axis: 'z', x0: ENV.x0, x1: ENV.x0 + t, z0: ANNEX.z0, z1: ANNEX.z1, h: 3.4, open: [door(DOOR2.z0, DOOR2.z1, DOOR2.h)] }
];
export const shellWalls = () => WALLS.map(w => ({ ...rect(w), open: w.open.map(o => ({ ...o, a0: +(o.a0 + (w.axis === 'x' ? OFFSET[0] : OFFSET[1])).toFixed(3), a1: +(o.a1 + (w.axis === 'x' ? OFFSET[0] : OFFSET[1])).toFixed(3) })),
  fake: (w.fake || []).map(o => ({ ...o, a0: +(o.a0 + (w.axis === 'x' ? OFFSET[0] : OFFSET[1])).toFixed(3), a1: +(o.a1 + (w.axis === 'x' ? OFFSET[0] : OFFSET[1])).toFixed(3) })) }));

/** Cầu thang theo định dạng layout.json (toạ độ thế giới). 26 bậc cao 0,173 m, sâu 0,285 m. */
export function shellStairs() {
  const A = ANNEX.laneA, B = ANNEX.laneB, cA = (A[0] + A[1]) / 2, cB = (B[0] + B[1]) / 2;
  const S = (o) => { const r = rect(o); const P = p => W(p[0], p[1]); return { ...r, entry: P(o.entry), bottom: P(o.bottom), top: P(o.top), exit: P(o.exit) }; };
  return [
    S({ id: 'S1', name: 'Cầu thang tầng trệt → tầng 2', from: 0, to: 1, x0: A[0], x1: A[1], z0: -3.0, z1: 4.4, steps: 26, rise: '-z', capacity: 4,
      entry: [-7.4, 4.91], bottom: [cA, 4.95], top: [cA, -3.25], exit: [cA, -5.2] }),
    S({ id: 'S2', name: 'Cầu thang tầng 2 → tầng 3', from: 1, to: 2, x0: B[0], x1: B[1], z0: -6.6, z1: 0.8, steps: 26, rise: '+z', capacity: 4,
      entry: [cA, -7.3], bottom: [cB, -7.0], top: [cB, 1.05], exit: [cB, 1.7] })
  ];
}

/** Sàn của khối thang và sân thượng (để dựng và để đi): { floor, x0..z1 } toạ độ thế giới. */
export function shellFloors() {
  const L = ANNEX.x0 + ANNEX.t, R = ANNEX.x1, F = ENV;
  return {
    annex: [
      { floor: 0, x0: L, x1: R, z0: 4.4, z1: ANNEX.z1 - ANNEX.t, name: 'chân cầu thang' },
      { floor: 1, x0: L, x1: R, z0: ANNEX.z0 + ANNEX.t, z1: -3.0, name: 'chiếu nghỉ tầng 2' },
      { floor: 2, x0: L, x1: R, z0: 0.8, z1: 2.6, name: 'chiếu nghỉ tầng 3' }
    ].map(rect),
    terrace: [   // mái tầng 2 quanh phòng cozy
      { floor: 2, x0: F.x0 + t, x1: F.x1 - 0.15, z0: COZY.z1 + 0.3, z1: F.z1 - 0.15 },
      { floor: 2, x0: F.x0 + t, x1: COZY.x0 - 0.3, z0: F.z0 + 0.15, z1: COZY.z1 + 0.3 },
      { floor: 2, x0: COZY.x1 + 0.3, x1: F.x1 - 0.15, z0: F.z0 + 0.15, z1: COZY.z1 + 0.3 },
      { floor: 2, x0: COZY.x0 - 0.3, x1: COZY.x1 + 0.3, z0: F.z0 + 0.15, z1: COZY.z0 - 0.3 }
    ].map(rect),
    inner: [   // trong nhà (vùng đi được trước khi trừ đồ đạc)
      { floor: 0, x0: F.x0 + t, x1: F.x1 - t, z0: F.z0 + t, z1: F.z1 - t, name: 'tầng trệt' },
      { floor: 1, x0: F.x0 + t, x1: F.x1 - t, z0: F.z0 + t, z1: F.z1 - t, name: 'tầng 2' },
      { floor: 2, x0: COZY.x0 + 0.15, x1: COZY.x1, z0: COZY.z0 + 0.15, z1: COZY.z1, name: 'tầng 3' }
    ].map(rect),
    doors: [   // ô cửa (đi qua được) giữa các vùng
      { floor: 0, x0: ANNEX.x1 - 0.05, x1: F.x0 + t + 0.4, z0: STAIR_DOOR0.z0, z1: STAIR_DOOR0.z1 },
      { floor: 1, x0: ANNEX.x1 - 0.05, x1: F.x0 + t + 0.4, z0: DOOR1.z0, z1: DOOR1.z1 },
      { floor: 2, x0: ANNEX.x1 - 0.05, x1: F.x0 + t + 0.3, z0: DOOR2.z0, z1: DOOR2.z1 },
      { floor: 2, x0: COZY.x0 - 0.35, x1: COZY.x0 + 0.6, z0: COZY.door[1] - 0.5, z1: COZY.door[1] + 0.5 },
      { floor: 2, x0: 9.2, x1: 10.4, z0: COZY.z1 - 0.5, z1: COZY.z1 + 0.6 },
      ...FRONT_DOORS.map(([a, b]) => ({ floor: 0, x0: a, x1: b, z0: F.z1 - t - 0.4, z1: F.z1 + 0.3 }))
    ].map(rect)
  };
}
export const toWorld = W;
