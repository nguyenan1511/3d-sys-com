// Mặt bằng THẬT của văn phòng SYSONE ("MẶT BẰNG TẦNG 1", tỉ lệ 1/100 — ảnh bản vẽ người dùng gửi ngày 2026-11-11).
// Toạ độ viết theo PIXEL trên ảnh bản vẽ (1920 × 1333) để đối chiếu dễ; thước: 80,8 px = 1 m (đo theo kích thước ghi
// trên bản vẽ: 1400 mm = 113 px, 2400 mm = 194 px). Ba tầng làm việc dùng chung mặt bằng này.
//
// Đặt vào thế giới 3D: cạnh TRÁI của bản vẽ (cửa vào + ban công) quay ra đường (mặt tiền, z = FRONT_Z), cạnh trên của
// bản vẽ thành phía tây (x âm). planToWorld(px, py) → { x, z }.
export const PX_PER_M = 80.8;
export const ORIGIN = { px: 507, py: 118 };          // góc trái-trên của khối nhà (tường ngoài khối trái dưới / tường trên)
export const DEPTH_M = (748 - 118) / PX_PER_M;      // bề ngang thật của nhà (cạnh trên → cạnh dưới bản vẽ) ≈ 7,8 m
export const FRONT_Z = 4.5;                          // mặt tiền (cạnh trái bản vẽ) trên trục z của thế giới

export function planToWorld(px, py) {
  const u = (px - ORIGIN.px) / PX_PER_M, v = (py - ORIGIN.py) / PX_PER_M;
  return { x: +(v - DEPTH_M / 2).toFixed(3), z: +(FRONT_Z - u).toFixed(3) };
}
/** Hướng nhìn trên bản vẽ (dx, dy pixel) → góc "facing" của layout (0 = −z, 90 = −x, 180 = +z, 270 = +x). */
export function planFacing(dx, dy) {
  const wx = dy, wz = -dx;                           // (cùng phép quay với planToWorld)
  let f = Math.round(Math.atan2(-wx, -wz) * 180 / Math.PI);
  return ((f % 360) + 360) % 360;
}

/**
 * Tường (đoạn thẳng nằm ngang / dọc, pixel): t = độ dày (m); openings = khoảng hở (cửa) theo trục của tường (pixel).
 * Tường ngoài dày 0,2 m; vách trong 0,12 m.
 */
export const WALLS = [
  // ---- tường ngoài ----
  { a: [585, 118], b: [1778, 118], t: 0.2, ext: true },                                   // cạnh trên (tây)
  { a: [1773, 118], b: [1773, 748], t: 0.2, ext: true, windows: [[205, 360], [500, 665]] }, // cạnh phải (sau nhà)
  { a: [978, 745], b: [1778, 745], t: 0.2, ext: true },                                   // cạnh dưới (đông), lõi + khối phải
  { a: [512, 665], b: [980, 665], t: 0.2, ext: true, windows: [[575, 900]] },             // cạnh dưới khối trái
  { a: [512, 432], b: [512, 668], t: 0.2, ext: true, windows: [[470, 640]] },             // mặt tiền khối trái dưới
  { a: [507, 432], b: [592, 432], t: 0.2, ext: true },                                    // bậc tường mặt tiền
  { a: [592, 118], b: [592, 432], t: 0.2, ext: true, openings: [[225, 312]], windows: [[135, 205], [330, 400]] }, // mặt tiền khối trái trên — CỬA VÀO 2 cánh
  // ---- lõi giữa ----
  { a: [980, 335], b: [980, 745], t: 0.12, openings: [[340, 415]] },                     // vách phòng trái ↔ sảnh/WC (cửa 1100)
  { a: [980, 333], b: [1060, 333], t: 0.12 },                                             // đáy hốc 2 chỗ đơn
  { a: [1060, 125], b: [1060, 335], t: 0.12 },                                            // vách cầu thang trái
  { a: [1297, 118], b: [1297, 748], t: 0.2, openings: [[340, 415]] },                    // vách khối phải (cửa sang khối phải)
  { a: [1103, 435], b: [1297, 435], t: 0.12, openings: [[1215, 1285]] },                 // vách trên phòng họp (cửa)
  { a: [1103, 435], b: [1103, 745], t: 0.12 },                                            // vách trái phòng họp
  { a: [990, 640], b: [1100, 640], t: 0.1, openings: [[1045, 1100]] },                   // vách WC (cửa)
  { a: [990, 525], b: [1020, 525], t: 0.1 }                                               // vách ngăn góc nước
];

/**
 * Dãy chỗ ngồi: mỗi chỗ là một ghế (pixel) và hướng nhìn (dx, dy về phía bàn). desk = { depth (px), off (px: tâm bàn
 * cách tâm ghế theo hướng nhìn), w (px: bề ngang bàn mỗi chỗ) }.
 */
const row = (y, xs, dir, desk) => xs.map(x => ({ x, y, dir, ...desk }));
const col = (x, ys, dir, desk) => ys.map(y => ({ x, y, dir, ...desk }));
const D = { off: 38, depth: 46, w: 92 };       // bàn đôi / bàn dãy thường: sâu ~0,57 m, ngang ~1,14 m mỗi chỗ
export const SEATS = [
  // ---- khối trái trên ----
  ...row(165, [645, 748, 828], [0, 1], D),     // cụm bàn đôi 3600: dãy trên, nhìn xuống
  ...row(275, [645, 748, 828], [0, -1], D),    //                    dãy dưới, nhìn lên
  ...col(998, [172, 280], [1, 0], { off: 36, depth: 40, w: 100 }),  // hốc 2 chỗ đơn sát vách cầu thang (bàn 600)
  ...row(382, [645, 738, 828], [0, 1], { ...D, off: 35, depth: 44 }),     // dãy 3600 giữa, nhìn xuống (bàn y 395–440)
  // ---- khối trái dưới ----
  ...row(492, [567, 658, 748, 838], [0, -1], { ...D, off: 29, depth: 44 }), // dãy 2300+2300 (có chỗ "1042"), nhìn lên — bàn tựa lưng bàn dãy trên (y 441–486)
  ...row(603, [567, 658, 748, 838, 930], [0, 1], D), // dãy 5700 sát tường dưới, nhìn xuống
  // ---- khối phải ----
  ...row(172, [1347, 1435, 1525, 1620, 1718], [0, -1], D), // dãy sát tường trên, nhìn lên
  ...row(255, [1430, 1520, 1615, 1715], [0, 1], D),        // cụm 2340+2340 thứ nhất
  ...row(365, [1430, 1520, 1615, 1715], [0, -1], D),
  ...row(495, [1430, 1520, 1615, 1715], [0, 1], D),        // cụm thứ hai
  ...row(605, [1430, 1520, 1615, 1715], [0, -1], D),
  ...row(685, [1347, 1435, 1525, 1620, 1718], [0, 1], D)   // dãy sát tường dưới, nhìn xuống
];
/** Chỗ có số đỏ "1042" trên bản vẽ (xếp sẵn cho nhân viên mã 1042). */
export const MARKED = { code: '1042', seat: { x: 567, y: 492 } };

/** Phòng họp: bàn + 6 ghế (3 mỗi bên). */
export const MEETING = { table: { x0: 1172, y0: 532, x1: 1238, y1: 690 },
  seats: [...[555, 605, 655].map(y => ({ x: 1150, y, dir: [1, 0] })), ...[555, 605, 655].map(y => ({ x: 1258, y, dir: [-1, 0] }))] };

/** Lõi giữa: cầu thang (vẽ, không đi), lỗ thang máy, góc nước nóng/lạnh, WC. */
export const CORE = {
  stair: { x0: 1063, y0: 125, x1: 1297, y1: 330 },
  lift: { x0: 1135, y0: 195, x1: 1220, y1: 335 },     // ô chữ nhật giữa giếng cầu thang
  liftStand: { x: 1178, y: 372 },                     // đứng chờ thang trong sảnh
  water: { x0: 995, y0: 428, x1: 1022, y1: 452 },     // cây nước nóng / lạnh
  sink: { x: 1018, y: 577, r: 14 },
  wc: { x0: 990, y0: 645, x1: 1100, y1: 745, toilet: { x: 1020, y: 712 }, basin: { x: 1072, y: 728 } },
  hall: { x0: 985, y0: 338, x1: 1295, y1: 430 }
};
/** Lối vào: ban công / bậc thềm trước cửa 2 cánh (ngoài mặt tiền). */
export const ENTRY = { door: { x: 592, y0: 225, y1: 312 }, porch: { x0: 515, y0: 175, x1: 588, y1: 362 } };
/** Các khu (để đặt tên phòng / chia phòng ban). */
export const ZONES = [
  { id: 'L1', name: 'Khu trái trên', x0: 597, y0: 123, x1: 976, y1: 432 },
  { id: 'L2', name: 'Khu trái dưới', x0: 517, y0: 432, x1: 976, y1: 661 },
  { id: 'R', name: 'Khu phải', x0: 1302, y0: 123, x1: 1768, y1: 741 }
];
