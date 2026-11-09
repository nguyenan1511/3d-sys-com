// Mô hình suy ra từ layout.json: chỗ ngồi, vật cản, cầu thang, vùng chờ.
// Thuần JS, dùng chung cho dựng cảnh 3D, điều hướng và test.
import { facingVec, inRect } from '../core/util.js';

const ITEM_SIZE = {
  plant: [0.4, 0.4], toilet: [0.4, 0.65], sink: [0.5, 0.4], sofa: [2.0, 0.9], lowtable: [1.0, 0.5],
  counter: [0.6, 3.0], fridge: [0.6, 0.7], shelf: [0.4, 1.6], printer: [0.6, 0.5], cabinet: [0.5, 0.5], tv: [2, 0.06], rug: [1.5, 1.5]
};
const NON_BLOCKING = new Set(['rug', 'tv', 'lamp']);
const SEAT_GAP = 0.35; // khoảng từ mép bàn đến tâm ghế

/** AABB của hình chữ nhật w (ngang) x d (sâu) xoay theo facing. */
export function footprint(x, z, w, d, facing = 0) {
  const r = (facing || 0) * Math.PI / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const hx = (w * c + d * s) / 2, hz = (w * s + d * c) / 2;
  return { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
}

/** Ghế của bàn. fs: tỉ lệ nội thất (bàn thu nhỏ quanh tâm, ghế dịch theo). */
export function deskSeat(desk, fs = 1) {
  if (Array.isArray(desk.seat)) return { x: desk.x + (desk.seat[0] - desk.x) * fs, z: desk.z + (desk.seat[1] - desk.z) * fs };
  const f = facingVec(desk.facing || 0), k = ((desk.d || 0.6) / 2 + SEAT_GAP) * fs;
  return { x: desk.x - f.x * k, z: desk.z - f.z * k };
}

/** Tách tường có lỗ cửa thành các khối đặc + lanh tô. */
export function splitWall(w, ceilingH) {
  const alongX = (w.x1 - w.x0) >= (w.z1 - w.z0);
  const a0 = alongX ? w.x0 : w.z0, a1 = alongX ? w.x1 : w.z1;
  const ops = (w.openings || []).map(o => ({ from: Math.max(a0, o.from), to: Math.min(a1, o.to), height: o.height ?? 2.1 })).sort((p, q) => p.from - q.from);
  const solids = [], lintels = [];
  let cur = a0;
  const mk = (s0, s1) => alongX ? { x0: s0, x1: s1, z0: w.z0, z1: w.z1 } : { x0: w.x0, x1: w.x1, z0: s0, z1: s1 };
  for (const o of ops) {
    if (o.from > cur + 1e-3) solids.push(mk(cur, o.from));
    if (o.height < ceilingH - 1e-3) lintels.push({ ...mk(o.from, o.to), yb: o.height });
    cur = Math.max(cur, o.to);
  }
  if (a1 > cur + 1e-3) solids.push(mk(cur, a1));
  return { solids, lintels, alongX };
}

export function buildModel(layout) {
  const fs = (layout.scale && layout.scale.furniture) || 1, cs = (layout.scale && layout.scale.character) || 1;
  const floors = layout.floors.map(f => ({ ...f }));
  const floorById = new Map(floors.map(f => [f.id, f]));
  const floorY = f => floorById.get(f)?.y ?? 0;
  const ceilH = f => { const fl = floorById.get(f); return fl ? (fl.ceiling - fl.y) : 2.75; };

  function heightAt(f, x, z) {
    const fl = floorById.get(f);
    if (!fl) return 0;
    if (fl.zones) for (const zn of fl.zones) if (inRect(zn, x, z)) return zn.y;
    return fl.y;
  }

  // Cầu thang
  const stairs = (layout.stairs || []).map(s => {
    const yFrom = floorY(s.from), yTo = floorY(s.to);
    const P = (p, f) => ({ x: p[0], z: p[1], f });
    return { ...s, yFrom, yTo, rect: { x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1 },
      pEntry: P(s.entry, s.from), pBottom: P(s.bottom, s.from), pTop: P(s.top, s.to), pExit: P(s.exit, s.to) };
  });
  const stairById = new Map(stairs.map(s => [s.id, s]));

  /** Cao độ bậc thang tại (x,z): có bậc rõ ràng, bo nhẹ ở mép bậc. */
  function stairHeight(st, x, z) {
    let u;
    switch (st.rise) {
      case '-z': u = (st.z1 - z) / (st.z1 - st.z0); break;
      case '+x': u = (x - st.x0) / (st.x1 - st.x0); break;
      case '-x': u = (st.x1 - x) / (st.x1 - st.x0); break;
      default: u = (z - st.z0) / (st.z1 - st.z0);
    }
    u = Math.max(0, Math.min(1, u));
    const N = st.steps, rs = (st.yTo - st.yFrom) / N, k = u * N;
    const i = Math.min(N - 1, Math.floor(k)), fr = k - i;
    let y = st.yFrom + (i + 1) * rs;
    if (fr < 0.25 && i > 0) y -= rs * (1 - fr / 0.25) * 0.5; // chân đặt mép bậc
    return y;
  }

  // Chỗ ngồi
  const seats = new Map();
  const addSeat = s => { s.fs = fs; if (seats.has(s.id)) throw new Error(`Trùng id chỗ ngồi "${s.id}"`); seats.set(s.id, s); return s; };
  const desks = (layout.desks || []).map(d => {
    const sp = deskSeat(d, fs);
    const seat = addSeat({ id: d.id, kind: d.kind === 'reception' ? 'reception' : 'desk', deskId: d.id, floor: d.floor, x: sp.x, z: sp.z, facing: d.facing || 0 });
    return { ...d, seat };
  });
  const tables = (layout.tables || []).map(t => ({
    ...t, seats: (t.seats || []).map(s => addSeat({ ...s, x: t.x + (s.x - t.x) * fs, z: t.z + (s.z - t.z) * fs, kind: t.type === 'pantry' ? 'pantry' : 'meeting', tableId: t.id, floor: t.floor }))
  }));
  const standSpots = ((layout.pantry && layout.pantry.standSpots) || []).map(s => addSeat({ ...s, kind: 'stand', floor: layout.pantry.floor }));
  const wcs = (layout.wc || []).map(w => ({ ...w, pQueue: { x: w.queue[0], z: w.queue[1], f: w.floor }, pInside: { x: w.inside[0], z: w.inside[1], f: w.floor } }));

  // Vật cản theo tầng (dùng cho lưới điều hướng và va chạm khi đi bộ)
  const obstacles = new Map(floors.map(f => [f.id, []]));
  const addObs = (f, r, type) => obstacles.get(f)?.push({ ...r, type });
  for (const d of desks) {
    if (d.kind === 'reception') continue; // quầy lễ tân khai báo trong items? -> dùng footprint quầy
    addObs(d.floor, footprint(d.x, d.z, (d.w || 1.0) * fs, (d.d || 0.6) * fs, d.facing), 'desk');
  }
  for (const d of desks.filter(d => d.kind === 'reception')) addObs(d.floor, footprint(d.x, d.z, (d.w || 2) * fs, (d.d || 0.6) * fs, d.facing), 'reception');
  for (const t of tables) addObs(t.floor, footprint(t.x, t.z, t.w * fs, t.d * fs, 0), 'table');
  for (const it of layout.items || []) {
    if (NON_BLOCKING.has(it.type)) continue;
    const sz = ITEM_SIZE[it.type] || [0.5, 0.5];
    addObs(it.floor, footprint(it.x, it.z, (it.w ?? sz[0]) * fs, (it.d ?? sz[1]) * fs, it.facing || 0), it.type);
  }
  const wallBoxes = [];
  for (const w of layout.walls || []) {
    const sp = splitWall(w, ceilH(w.floor));
    for (const s of sp.solids) { addObs(w.floor, s, 'wall'); wallBoxes.push({ ...s, floor: w.floor, material: w.material || 'plaster', yb: 0 }); }
    for (const l of sp.lintels) wallBoxes.push({ ...l, floor: w.floor, material: w.material || 'plaster', lintel: true });
  }
  for (const st of stairs) {
    addObs(st.from, st.rect, 'stair');
    addObs(st.to, st.rect, 'stairwell');
  }
  for (const b of (layout.nav && layout.nav.blocked) || []) addObs(b.floor, b, 'blocked');

  // Lan can quanh ô cầu thang ở tầng trên (chừa đầu thang để bước ra)
  const rails = [];
  for (const st of stairs) {
    const r = st.rect, T = 0.04, f = st.to;
    const nearWall = x => Math.abs(x) > 2.95;
    if (st.rise === '+z' || st.rise === '-z') {
      if (!nearWall(r.x0)) rails.push({ floor: f, x0: r.x0 - T, x1: r.x0 + T, z0: r.z0, z1: r.z1 });
      if (!nearWall(r.x1)) rails.push({ floor: f, x0: r.x1 - T, x1: r.x1 + T, z0: r.z0, z1: r.z1 });
      const zb = st.rise === '+z' ? r.z0 : r.z1;
      rails.push({ floor: f, x0: r.x0, x1: r.x1, z0: zb - T, z1: zb + T });
    } else {
      rails.push({ floor: f, x0: r.x0, x1: r.x1, z0: r.z0 - T, z1: r.z0 + T });
      rails.push({ floor: f, x0: r.x0, x1: r.x1, z0: r.z1 - T, z1: r.z1 + T });
      const xb = st.rise === '+x' ? r.x0 : r.x1;
      rails.push({ floor: f, x0: xb - T, x1: xb + T, z0: r.z0, z1: r.z1 });
    }
  }

  // Vùng nghẽn (cửa): mở rộng theo hướng đi qua
  const doors = (layout.doors || []).map(d => {
    const thinZ = (d.z1 - d.z0) <= (d.x1 - d.x0), m = 0.3;
    const zone = thinZ ? { x0: d.x0, x1: d.x1, z0: d.z0 - m, z1: d.z1 + m } : { x0: d.x0 - m, x1: d.x1 + m, z0: d.z0, z1: d.z1 };
    return { ...d, zone, capacity: d.capacity || 1 };
  });

  const waypoints = {};
  for (const [k, w] of Object.entries(layout.waypoints || {})) waypoints[k] = { x: w.x, z: w.z, f: w.floor ?? 0, id: k };

  const meetingRooms = new Map(tables.filter(t => t.type === 'meeting').map(t => [t.id, t]));
  const pantryTable = tables.find(t => t.type === 'pantry');

  return {
    fs, cs, layout, floors, floorById, floorY, ceilH, heightAt, stairs, stairById, stairHeight, desks,
    deskById: new Map(desks.map(d => [d.id, d])), tables, meetingRooms, pantryTable, standSpots, wcs,
    seats, obstacles, wallBoxes, rails, doors, waypoints, nav: layout.nav || {}, routes: layout.routes || {}
  };
}

/** Điểm đứng trước ghế (để đi tới rồi ngồi xuống). */
export function seatApproach(seat, dist = 0.16 * (seat.fs || 1)) {
  const f = facingVec(seat.facing || 0);
  return { x: seat.x + f.x * dist, z: seat.z + f.z * dist, f: seat.floor };
}
