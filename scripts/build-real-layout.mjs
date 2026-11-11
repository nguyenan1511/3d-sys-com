// Sinh src/data/layout.real.json (chế độ "Real SYS") từ mặt bằng thật src/data/realPlan.js:
// 3 tầng làm việc giống nhau (46 chỗ + phòng họp 6 ghế mỗi tầng) + sân thượng; thang bộ chữ U trong lõi giữa (không có
// thang máy); sân, cổng, vỉa hè phía mặt tiền (cạnh trái bản vẽ). Chạy: node scripts/build-real-layout.mjs
import fs from 'node:fs';
import * as P from '../src/data/realPlan.js';

const W = (px, py) => P.planToWorld(px, py);
const r3 = v => +v.toFixed(3);
const FH = 3.6, Y0 = 0.05, CEIL = 3.4, FLOORS = 3;            // cao mỗi tầng 3,6 m (sàn trên dày 0,2 m → tường cao 3,4 m tới đáy sàn), tầng thượng = id 3
const fy = f => r3(Y0 + f * FH);
/** Hình chữ nhật trên bản vẽ (pixel) → hộp thế giới. */
const rect = (x0, y0, x1, y1) => { const a = W(x0, y0), b = W(x1, y1); return { x0: r3(Math.min(a.x, b.x)), x1: r3(Math.max(a.x, b.x)), z0: r3(Math.min(a.z, b.z)), z1: r3(Math.max(a.z, b.z)) }; };

// ---------- tường ----------
function walls(floor, roof = false) {
  const out = [];
  for (const w of P.WALLS) {
    if (roof && !w.ext) continue;
    const vert = w.a[0] === w.b[0], t = w.t * P.PX_PER_M / 2;
    const r = vert ? rect(w.a[0] - t, Math.min(w.a[1], w.b[1]), w.a[0] + t, Math.max(w.a[1], w.b[1])) : rect(Math.min(w.a[0], w.b[0]), w.a[1] - t, Math.max(w.a[0], w.b[0]), w.a[1] + t);
    // khoảng hở theo trục dài của tường (thế giới): tường dọc bản vẽ → chạy theo x thế giới; tường ngang → theo z
    const along = ([o0, o1]) => { if (vert) { const a = W(w.a[0], o0).x, b = W(w.a[0], o1).x; return [Math.min(a, b), Math.max(a, b)]; } const a = W(o0, w.a[1]).z, b = W(o1, w.a[1]).z; return [Math.min(a, b), Math.max(a, b)]; };
    const wall = { floor, ...r, material: 'plaster' };
    if (w.ext) wall.ext = true;
    const ops = (w.openings || []).map(along).map(([from, to]) => ({ from: r3(from), to: r3(to), height: 2.3 }));
    if (ops.length) wall.openings = ops;
    if (w.windows) wall.windows = w.windows.map(along).map(([from, to]) => ({ from: r3(from), to: r3(to) }));
    if (roof) { wall.parapet = true; delete wall.openings; delete wall.windows; }
    out.push(wall);
  }
  return out;
}

// ---------- bàn ----------
const desks = [], tables = [];
for (let f = 0; f < FLOORS; f++) {
  P.SEATS.forEach((s, i) => {
    const [dx, dy] = s.dir, c = W(s.x + dx * s.off, s.y + dy * s.off), seat = W(s.x, s.y);
    desks.push({ id: `R${f + 1}-${String(i + 1).padStart(2, '0')}`, floor: f, x: c.x, z: c.z, facing: P.planFacing(dx, dy), w: r3(s.w / P.PX_PER_M), d: r3(s.depth / P.PX_PER_M), seat: [seat.x, seat.z] });
  });
  const t = rect(P.MEETING.table.x0, P.MEETING.table.y0, P.MEETING.table.x1, P.MEETING.table.y1);
  tables.push({ id: `RM${f + 1}`, name: `Phòng họp tầng ${f + 1}`, type: 'meeting', floor: f, x: r3((t.x0 + t.x1) / 2), z: r3((t.z0 + t.z1) / 2), w: r3(t.x1 - t.x0), d: r3(t.z1 - t.z0), h: 0.76, color: '#F2EFEA',
    seats: P.MEETING.seats.map((s, k) => { const p = W(s.x, s.y); return { id: `RM${f + 1}-${k + 1}`, x: p.x, z: p.z, facing: P.planFacing(...s.dir) }; }) });
}

// ---------- thang bộ chữ U (lõi giữa) ----------
// vế 1: làn phải của lõi (bản vẽ x 1220–1297) đi từ sảnh (y 330) lên chiếu nghỉ (y 195); chiếu nghỉ: y 125–195 cả bề
// ngang lõi; vế 2: làn trái (x 1063–1135) đi từ chiếu nghỉ xuống phía sảnh (y 330) — tới đây là sàn tầng trên.
const C = P.CORE.stair;
const lane1 = rect(1222, 195, 1295, C.y1), landing = rect(C.x0, C.y0, C.x1, 195), lane2 = rect(C.x0, 195, 1135, C.y1);
const core = rect(C.x0, C.y0, C.x1, C.y1);
const stairs = [];
for (let f = 0; f < FLOORS; f++) {
  const e1 = W(1258, 375), b1 = W(1258, 318), via1 = W(1258, 165), via2 = W(1099, 165), t2 = W(1099, 318), ex = W(1099, 375); // (vào / ra: cách mép lõi ~0,55 m — ngoài vùng cấm của lưới đi lại)
  stairs.push({ id: `RS${f + 1}`, name: f + 1 < FLOORS ? `Cầu thang tầng ${f + 1} → tầng ${f + 2}` : 'Cầu thang lên sân thượng', from: f, to: f + 1, kind: 'u',
    ...core, steps: 22, rise: '-x', capacity: 3,
    flights: [{ ...lane1, rise: '-x', a: 0, b: 0.5 }, { ...landing, flat: 0.5 }, { ...lane2, rise: '+x', a: 0.5, b: 1 }],
    entry: [e1.x, e1.z], bottom: [b1.x, b1.z], via: [[via1.x, via1.z], [via2.x, via2.z]], top: [t2.x, t2.z], exit: [ex.x, ex.z] });
}

// ---------- phòng, khu ----------
const rooms = [];
for (let f = 0; f < FLOORS; f++) {
  for (const z of P.ZONES) rooms.push({ id: `${z.id}-${f}`, name: z.name, type: 'office', floor: f, ...rect(z.x0, z.y0, z.x1, z.y1) });
  rooms.push({ id: `meet-${f}`, name: `Phòng họp tầng ${f + 1}`, type: 'meeting', floor: f, ...rect(1108, 440, 1292, 740) });
  rooms.push({ id: `wc-${f}`, name: 'WC', type: 'wc', floor: f, ...rect(P.CORE.wc.x0, P.CORE.wc.y0, P.CORE.wc.x1, P.CORE.wc.y1) });
  rooms.push({ id: `hall-${f}`, name: f === 0 ? 'Sảnh' : 'Sảnh cầu thang', type: f === 0 ? 'lobby' : 'office', floor: f, ...rect(P.CORE.hall.x0, P.CORE.hall.y0, P.CORE.hall.x1, P.CORE.hall.y1) });
}
const roofFloor = FLOORS;
rooms.push({ id: 'rooftop', name: 'Sân thượng', type: 'lounge', floor: roofFloor, ...rect(600, 125, 1765, 740) });

// ---------- đồ đạc (WC, cây nước, sân thượng) ----------
const items = [];
const at = (px, py) => W(px, py);
for (let f = 0; f < FLOORS; f++) {
  const t = at(P.CORE.wc.toilet.x, P.CORE.wc.toilet.y), b = at(P.CORE.wc.basin.x, P.CORE.wc.basin.y), wa = at((P.CORE.water.x0 + P.CORE.water.x1) / 2, (P.CORE.water.y0 + P.CORE.water.y1) / 2), sk = at(P.CORE.sink.x, P.CORE.sink.y);
  items.push({ type: 'toilet', floor: f, x: t.x, z: t.z, w: 0.4, d: 0.6, facing: 0 });
  items.push({ type: 'sink', floor: f, x: b.x, z: b.z, w: 0.5, d: 0.4, facing: 0 });
  items.push({ type: 'fridge', floor: f, x: wa.x, z: wa.z, w: 0.35, d: 0.35, h: 1.15, color: '#e8eaee', facing: 90, label: 'Nước nóng / lạnh' });
  items.push({ type: 'sink', floor: f, x: sk.x, z: sk.z, w: 0.4, d: 0.4, facing: 90 });
  const pl = [[1290, 160], [1290, 720], [610, 640]].map(([px, py]) => at(px, py));
  for (const p of pl) items.push({ type: 'plant', floor: f, x: p.x, z: p.z, w: 0.4, d: 0.4, h: 1.1 });
}
// sân thượng: góc thư giãn tạm (khu giải trí đầy đủ — bi-a, karaoke, TV — chuyển lên ở bước sau)
for (const [type, px, py, extra] of [['sofa', 1500, 300, { w: 2.2, d: 0.9, facing: 0, color: '#4a5a72' }], ['lowtable', 1500, 400, { w: 1.1, d: 0.55, h: 0.42, color: '#cdb89a' }], ['rug', 1500, 400, { w: 2.4, d: 1.8, color: '#9aa7b8' }],
  ['tv', 1500, 560, { w: 1.6, d: 0.35, h: 1.1, facing: 180 }], ['plant', 640, 160, { w: 0.5, d: 0.5, h: 1.3 }], ['plant', 1740, 700, { w: 0.5, d: 0.5, h: 1.3 }], ['plant', 1740, 160, { w: 0.5, d: 0.5, h: 1.3 }]]) {
  const p = at(px, py); items.push({ type, floor: roofFloor, x: p.x, z: p.z, ...extra });
}

// ---------- đèn trần (tấm LED 60 × 60) theo lưới ~2,2 m trong từng khu ----------
const lamps = [];
for (let f = 0; f < FLOORS; f++) for (const z of [...P.ZONES, { x0: 1108, y0: 440, x1: 1292, y1: 740 }, P.CORE.hall]) {
  const r = rect(z.x0, z.y0, z.x1, z.y1), nx = Math.max(1, Math.round((r.x1 - r.x0) / 2.2)), nz = Math.max(1, Math.round((r.z1 - r.z0) / 2.2));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) lamps.push({ floor: f, x: r3(r.x0 + (r.x1 - r.x0) * (i + 0.5) / nx), z: r3(r.z0 + (r.z1 - r.z0) * (j + 0.5) / nz) });
}

// ---------- vùng đi được, điểm mốc ----------
const inside = rect(512, 123, 1768, 743), porchFront = W(507, 0).z;
const areas = [];
for (let f = 0; f <= roofFloor; f++) areas.push({ floor: f, ...inside, name: f === roofFloor ? 'sân thượng' : `tầng ${f + 1}` });
areas.push({ floor: 0, x0: -4.9, x1: 4.9, z0: r3(porchFront - 0.05), z1: 9.0, name: 'sân trước' });
areas.push({ floor: 0, x0: 0.15, x1: 2.95, z0: 8.9, z1: 9.35, name: 'cổng' });
areas.push({ floor: 0, x0: -24, x1: 24, z0: 9.25, z1: 12.5, name: 'vỉa hè' });
const door = W(P.ENTRY.door.x, (P.ENTRY.door.y0 + P.ENTRY.door.y1) / 2), porch = W(550, (P.ENTRY.door.y0 + P.ENTRY.door.y1) / 2), lobby = W(628, 268);   // ngay trong cửa chính
const hall = W(1060, 385);
const waypoints = {
  spawnL: { floor: 0, x: -23.5, z: 9.65 }, spawnR: { floor: 0, x: 24, z: 9.65 }, sidewalk: { floor: 0, x: 1.55, z: 9.7 }, gate: { floor: 0, x: 1.55, z: 9.12 },
  porch: { floor: 0, x: porch.x, z: r3(porch.z + 0.8) }, door0: { floor: 0, x: door.x, z: r3(door.z + 0.35) }, lobby: { floor: 0, x: lobby.x, z: lobby.z },
  hall: { floor: 0, x: hall.x, z: hall.z }, wcQueue0: { floor: 0, ...(p => ({ x: p.x, z: p.z }))(W(1072, 610)) }
};
const wcIn = W(1045, 690), wcQ = W(1072, 610);

const layout = {
  version: 3, world: 'sysone-real', _nguon: 'Sinh từ src/data/realPlan.js (mặt bằng thật) bằng scripts/build-real-layout.mjs — đừng sửa tay.',
  scale: { furniture: 1, character: 0.72, seatHip: 0.59 },
  floors: [...Array(FLOORS).keys()].map(f => ({ id: f, name: `Tầng ${f + 1}`, y: fy(f), ceiling: r3(fy(f) + CEIL) })).concat([{ id: roofFloor, name: 'Sân thượng', y: fy(roofFloor), ceiling: r3(fy(roofFloor) + 6), open: true }]),
  stairs, rooms, deptZones: [],
  walls: [...Array(FLOORS).keys()].flatMap(f => walls(f)),   // (lan can sân thượng + tum thang: src/scene/realShell.js)
  doors: [{ id: 'gate', floor: 0, x0: 0.15, x1: 2.95, z0: 8.95, z1: 9.3, capacity: 3 }],
  desks, tables, pantry: { floor: 0, standSpots: [{ id: 'PS-1', ...(p => ({ x: p.x, z: p.z }))(W(1040, 445)), facing: 90 }] },
  wc: [{ id: 'wc0', name: 'WC', floor: 0, queue: [wcQ.x, wcQ.z], inside: [wcIn.x, wcIn.z], facing: 0 }],
  items, lamps, waypoints, routes: { arrive: ['sidewalk', 'gate', 'porch', 'door0', 'lobby'], leave: ['lobby', 'door0', 'porch', 'gate', 'sidewalk'] },
  // máy chấm công: ngay cạnh cửa chính, trên mảng tường nhô ra của khối trái dưới (mặt nhìn ra hiên trước cửa, hướng -x).
  // (Trong nhà sát cửa là dãy bàn nên không có chỗ đứng.)
  timeClock: (() => { const c = W(552, 424), s = W(552, 392); return { x: c.x, z: c.z, rot: -Math.PI / 2, stand: { x: s.x, z: s.z } }; })(),
  marked: { [P.MARKED.code]: 'R1-' + String(P.SEATS.findIndex(s => s.x === P.MARKED.seat.x && s.y === P.MARKED.seat.y) + 1).padStart(2, '0') },
  nav: { cell: 0.1, radius: 0.2, areas, blocked: [] }
};
fs.writeFileSync(new URL('../src/data/layout.real.json', import.meta.url), JSON.stringify(layout, null, 1) + '\n');
console.log(`layout.real.json: ${desks.length} bàn, ${tables.length} phòng họp, ${layout.walls.length} tường, ${stairs.length} cầu thang, ${items.length} đồ đạc; chỗ 1042 → ${layout.marked['1042']}`);
