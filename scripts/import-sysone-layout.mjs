// Sinh public/data/layout.json cho ngôi nhà SYSONE 3 tầng với nội thất my-office (khanh020905/my-office, MIT):
//   tầng trệt = tầng công ty "pro", tầng 2 = cánh 4 phòng ban (bản HQ), tầng 3 = phòng "cozy" (src/myoffice/building.js);
//   vỏ nhà, khối cầu thang, sân thượng: src/myoffice/shellSpec.js. Đường phố, hàng rào, cổng giữ như nhà SYSONE cũ.
// Dựng toà nhà trong trình duyệt (chưa gộp hình) rồi đọc: bàn + ghế, phòng họp, pantry, cà phê, WC, lễ tân; vật cản của
// từng tầng (hộp bao mọi khối cao 0,15–1,4 m trên mặt sàn tầng đó, quét lưới 0,1 m rồi nén thành hình chữ nhật); tường.
// Dùng: node scripts/import-sysone-layout.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { startServer } from './_server.mjs';
import { shellWalls, shellStairs, shellFloors, OFFSET, Y0, FH, CEIL, toWorld } from '../src/myoffice/shellSpec.js';
import { DEPARTMENTS, ROOM_NAMES, departmentOfDesk } from '../src/shared/departments.js';

const old = JSON.parse(readFileSync('public/data/layout.sysone.json', 'utf8'));   // nhà SYSONE cũ: vỉa hè, cổng, điểm mốc ngoài đường
const srv = await startServer(5422, { demo: false });
const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto(srv.url);
const out = await p.evaluate(async ({ OFFSET, Y0, FH }) => {
  document.body.innerHTML = '';
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const B = await import('/src/myoffice/building.js');
  const renderer = new THREE.WebGLRenderer();
  const bld = B.buildMyBuilding(renderer, { offset: OFFSET, optimize: false });
  bld.root.position.y = Y0;
  const V = '/src/vendor/my-office/src/office/', VC = '/src/vendor/my-office-cozy/src/office/';
  const { DEPTS } = await import(V + 'world/layout.js');
  const { MEET, MEET_SEATS } = await import(V + 'world/furniture/meeting.js');
  const { STATIONS } = await import(V + 'people/navigation.js');
  const cozyMeet = await import(VC + 'world/furniture/meeting.js');
  const { DOORWAYS } = await import(V + 'world/pro/pieces.js');
  const { DESKS } = await import(V + 'world/desks.js');
  const { DESKS: DESKS_C } = await import(VC + 'world/desks.js');
  const r3 = v => Math.round(v * 1000) / 1000;
  const deg = th => r3(((180 + th * 180 / Math.PI) % 360 + 360) % 360);   // hướng my-office (0 nhìn +z) → SYSONE (0 nhìn -z)
  const W = (x, z) => [r3(x + OFFSET[0]), r3(z + OFFSET[1])];
  const moB = (x, z) => { const q = B.moToBuilding(x, z); return { floor: q.floor, xz: W(q.x, q.z) }; };
  const czB = (x, z) => { const q = B.cozyToBuilding(x, z); return { floor: 2, xz: W(q.x, q.z) }; };
  // ---- bàn ----
  const DEPT_NAMES = ['Phát triển phần mềm', 'Phát triển phần mềm', 'Kinh doanh', 'Kiểm thử'];
  const deptOf = (x, z) => DEPTS.findIndex(d => x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1);
  const desks = B.buildingDesks().map(d => {
    const [x, z] = W(d.x, d.z), [sx, sz] = W(d.seat[0], d.seat[1]);
    void deptOf; void DEPT_NAMES;
    return { id: d.id, floor: d.floor, x, z, facing: deg(d.ry), w: 1.5, d: 0.74, seat: [sx, sz] };
  });
  { const [x, z] = W(-4.9, 1.62), [sx, sz] = W(-4.9, 1.12); desks.push({ id: 'LT-01', floor: 0, kind: 'reception', x, z, facing: 180, w: 2.0, d: 0.55, seat: [sx, sz], dept: 'Lễ tân' }); }
  // ---- chỗ ngồi khác ----
  const spot = (s, id, conv) => { const q = conv(s.x, s.z); return { id, x: q.xz[0], z: q.xz[1], facing: deg(s.face ?? 0) }; };
  const tables = [];
  { const c = moB(MEET.x, MEET.z); tables.push({ id: 'MR1', name: 'Phòng họp', type: 'meeting', floor: 0, x: c.xz[0], z: c.xz[1], w: 0.05, d: 0.05, h: 0.76, color: '#F2EFEA', seats: MEET_SEATS.map((s, i) => spot(s, `MR1-${i + 1}`, moB)) }); }
  if (cozyMeet.MEET && cozyMeet.MEET_SEATS?.length) { const c = czB(cozyMeet.MEET.x, cozyMeet.MEET.z); tables.push({ id: 'MR3', name: 'Bàn họp tầng 3', type: 'meeting', floor: 2, x: c.xz[0], z: c.xz[1], w: 0.05, d: 0.05, h: 0.76, color: '#B08A5B', seats: cozyMeet.MEET_SEATS.map((s, i) => spot(s, `MR3-${i + 1}`, czB)) }); }
  { const [x, z] = W(11.6, -2.9); tables.push({ id: 'PT', name: 'Pantry - ăn trưa', type: 'pantry', floor: 0, x, z, w: 0.05, d: 0.05, h: 0.76, color: '#EFE7D8', seats: STATIONS.dining.map((s, i) => spot(s, `PT-${i + 1}`, moB)) }); }
  const pantry = { floor: 0, standSpots: STATIONS.coffee.slice(-2).map((s, i) => spot(s, `PS-${i + 1}`, moB)) };
  const wc0 = STATIONS.wc[0], wq = moB(wc0.x + 1.1, wc0.z), wi = moB(wc0.x, wc0.z);
  const wc = [{ id: 'wc0', name: 'WC', floor: 0, queue: wq.xz, inside: wi.xz, facing: deg(wc0.face) }];
  // ---- vật cản theo tầng ----
  const C = 0.1, X0 = -14, Z0 = -15, NX = Math.ceil(28 / C), NZ = Math.ceil(21 / C);
  const grids = [0, 1, 2].map(() => new Uint8Array(NX * NZ)), walls = [], bb = new THREE.Box3();
  const skip = new Set([...DESKS, ...DESKS_C].map(d => d.chair));
  bld.root.updateMatrixWorld(true);
  const mark = (f, x0, x1, z0, z1, v = 1) => {
    const i0 = Math.max(0, Math.floor((x0 - X0) / C)), i1 = Math.min(NX - 1, Math.floor((x1 - X0) / C));
    const j0 = Math.max(0, Math.floor((z0 - Z0) / C)), j1 = Math.min(NZ - 1, Math.floor((z1 - Z0) / C));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grids[f][j * NX + i] = v;
  };
  bld.root.traverse(o => {
    if (!o.isMesh || !o.visible || o.isInstancedMesh) return;
    for (let q = o; q; q = q.parent) if (skip.has(q) || q.userData.worker || q.userData.dynamic || q.userData.noCollide || !q.visible) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    const dx = bb.max.x - bb.min.x, dz = bb.max.z - bb.min.z, h = bb.max.y - bb.min.y;
    if (dx > 25 || dz > 25) return;
    for (let f = 0; f < 3; f++) {
      const fy = Y0 + f * FH;
      if (bb.max.y < fy + 0.15 || bb.min.y > fy + 1.4) continue;
      if (h > 1.6 && Math.min(dx, dz) < 0.4 && Math.max(dx, dz) > 0.5) walls.push({ floor: f, x0: r3(bb.min.x), x1: r3(bb.max.x), z0: r3(bb.min.z), z1: r3(bb.max.z), material: o.material?.transparent ? 'glass' : 'plaster' });
      mark(f, bb.min.x, bb.max.x, bb.min.z, bb.max.z);
    }
  });
  // ô cửa trên vách kính / vách thấp của my-office
  for (const dw of DOORWAYS) {
    const [ax, az] = dw.a, [bx, bz] = dw.b, len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let t = 0.08; t <= len - 0.08; t += C / 2) for (let o = -0.6; o <= 0.6; o += C / 2) {
      const q = moB(ax + ux * t - uz * o, az + uz * t + ux * o);
      const i = Math.floor((q.xz[0] - X0) / C), j = Math.floor((q.xz[1] - Z0) / C);
      if (i >= 0 && j >= 0 && i < NX && j < NZ) grids[q.floor][j * NX + i] = 0;
    }
  }
  return { desks, tables, pantry, wc, walls, grids: grids.map(g => Array.from(g)), grid: { C, X0, Z0, NX, NZ },
    deptRooms: DEPTS.map((d, i) => ({ i, x0: d.x0, x1: d.x1, z0: d.z0, z1: d.z1 })) };
}, { OFFSET, Y0, FH });
await b.close(); srv.stop();

// ---- phần còn lại ở Node: vỏ nhà, chừa chỗ ngồi, nén lưới, điểm mốc ----
const r3 = v => Math.round(v * 1000) / 1000;
const { C, X0, Z0, NX, NZ } = out.grid, grids = out.grids.map(a => Uint8Array.from(a));
const mark = (f, x0, x1, z0, z1, v) => {
  const i0 = Math.max(0, Math.floor((x0 - X0) / C)), i1 = Math.min(NX - 1, Math.floor((x1 - X0 - 1e-6) / C));
  const j0 = Math.max(0, Math.floor((z0 - Z0) / C)), j1 = Math.min(NZ - 1, Math.floor((z1 - Z0 - 1e-6) / C));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grids[f][j * NX + i] = v;
};
// tường bao (phần đặc ở tầm đi bộ; cửa đi để trống) — cả cho bản đồ 2D
const walls = [...out.walls];
for (const w of shellWalls()) {
  const along = w.axis === 'x', A0 = along ? w.x0 : w.z0, A1 = along ? w.x1 : w.z1;
  const doors = w.open.filter(o => o.kind === 'door').sort((a, b) => a.a0 - b.a0);
  const floors = w.h > FH + 0.5 ? [0, 1, 2].filter(f => f * FH < w.h) : [w.floor];
  for (const f of floors) {
    let cur = A0;
    const seg = (a, b) => { if (b - a < 0.02) return; along ? mark(f, a, b, w.z0, w.z1, 1) : mark(f, w.x0, w.x1, a, b, 1); };
    for (const d of (f === w.floor ? doors : [])) { seg(cur, d.a0); cur = Math.max(cur, d.a1); }
    seg(cur, A1);
    walls.push({ floor: f, x0: w.x0, x1: w.x1, z0: w.z0, z1: w.z1, material: 'plaster', openings: (f === w.floor ? doors : []).map(d => ({ from: d.a0, to: d.a1, height: d.y1 })) });
  }
}
// lan can sân thượng, tay vịn giữa hai làn thang
const SF = shellFloors();
// ô cửa của vỏ nhà luôn thông
for (const d of SF.doors) mark(d.floor, d.x0, d.x1, d.z0, d.z1, 0);
// lối vào sau quầy lễ tân (đầu hở phía tây của quầy my-office hẹp hơn bán kính đi lại)
{ const [a0, c0] = toWorld(-6.5, 0.8), [a1, c1] = toWorld(-4.6, 1.3); mark(0, a0, a1, c0, c1, 0); }
// lối từ cửa cầu thang (cạnh thang máy) vào sảnh: đèn cây/ghế bành của sảnh my-office đứng sát cửa
{ const [a0, c0] = toWorld(-7.95, 4.0), [a1, c1] = toWorld(-6.3, 5.3); mark(0, a0, a1, c0, c1, 0); }
// chừa trống quanh chỗ ngồi/đứng và điểm tiếp cận phía trước (src/model/layoutModel.js seatApproach)
const ahead = s => { const r = s.facing * Math.PI / 180; return [s.x - Math.sin(r) * 0.16, s.z - Math.cos(r) * 0.16]; };
const clear = (f, x, z, R = 0.3) => { for (let j = Math.floor((z - R - Z0) / C); j <= Math.floor((z + R - Z0) / C); j++) for (let i = Math.floor((x - R - X0) / C); i <= Math.floor((x + R - X0) / C); i++) if (i >= 0 && j >= 0 && i < NX && j < NZ && Math.hypot(X0 + (i + 0.5) * C - x, Z0 + (j + 0.5) * C - z) < R) grids[f][j * NX + i] = 0; };
for (const d of out.desks) { clear(d.floor, d.seat[0], d.seat[1]); const [ax, az] = ahead({ x: d.seat[0], z: d.seat[1], facing: d.facing }); clear(d.floor, ax, az); }
for (const t of out.tables) for (const s of t.seats) { clear(t.floor, s.x, s.z); const [ax, az] = ahead(s); clear(t.floor, ax, az); }
for (const s of out.pantry.standSpots) { clear(0, s.x, s.z); const [ax, az] = ahead(s); clear(0, ax, az); }
for (const w of out.wc) for (let k = 0; k <= 1; k += 0.05) clear(w.floor, w.queue[0] + (w.inside[0] - w.queue[0]) * k, w.queue[1] + (w.inside[1] - w.queue[1]) * k);
// nén lưới thành hình chữ nhật
const blocked = [];
for (let f = 0; f < 3; f++) {
  const g = grids[f], open = new Map();
  for (let j = 0; j <= NZ; j++) {
    const runs = [];
    if (j < NZ) for (let i = 0; i < NX;) { if (!g[j * NX + i]) { i++; continue; } const s = i; while (i < NX && g[j * NX + i]) i++; runs.push(s + ':' + i); }
    const next = new Map();
    for (const k of runs) { if (open.has(k)) { next.set(k, open.get(k)); open.delete(k); } else next.set(k, j); }
    for (const [k, js] of open) { const [a, e] = k.split(':').map(Number); blocked.push({ floor: f, x0: r3(X0 + a * C), x1: r3(X0 + e * C), z0: r3(Z0 + js * C), z1: r3(Z0 + j * C) }); }
    open.clear(); for (const [k, v] of next) open.set(k, v);
  }
}
// ---- phòng ban (src/shared/departments.js): mỗi bàn thuộc một phòng; vùng của từng phòng ban (nhãn bản đồ, biển treo) ----
for (const d of out.desks) d.dept = departmentOfDesk(d.id)?.name || '';
const deptZones = DEPARTMENTS.map(dp => {
  const ds = out.desks.filter(d => dp.desks.includes(d.id) && d.kind !== 'reception'); if (!ds.length) return null;
  const xs = ds.flatMap(d => [d.x, d.seat[0]]), zs = ds.flatMap(d => [d.z, d.seat[1]]);
  return { id: dp.id, name: dp.name, floor: dp.floor, color: dp.color, x0: r3(Math.min(...xs) - 1.0), x1: r3(Math.max(...xs) + 1.0), z0: r3(Math.min(...zs) - 0.8), z1: r3(Math.max(...zs) + 0.8) };
}).filter(Boolean);
// ---- phòng (bản đồ 2D) ----
const R = (id, name, type, floor, x0, x1, z0, z1) => { const [a, c] = toWorld(x0, z0), [b2, d] = toWorld(x1, z1); return { id, name, type, floor, x0: a, x1: b2, z0: c, z1: d }; };
const rooms = [
  R('dev', ROOM_NAMES.dev, 'office', 0, -3.6, 8.6, -1.6, 9), R('director', 'Phòng giám đốc', 'office', 0, -8, -2.6, -8, -3),
  R('meeting', 'Phòng họp', 'meeting', 0, -2.6, 3, -8, -3), R('library', 'Thư viện', 'lounge', 0, 3, 8.6, -8, -3),
  R('pantry', 'Pantry', 'pantry', 0, 8.6, 14, -8, 0.6), R('lounge', 'Phòng giải trí', 'lounge', 0, 8.6, 14, 0.6, 9),
  R('server', 'Phòng máy chủ', 'office', 0, -8, -3.6, -3, 0.55), R('lobby', 'Sảnh - Lễ tân', 'lobby', 0, -8, -3.6, 0.55, 5.4),
  R('wc', 'WC', 'wc', 0, -8, -3.6, 5.4, 9),
  ...out.deptRooms.map(d => R('dept' + (d.i + 1), ROOM_NAMES['dept' + (d.i + 1)], 'office', 1, d.x0, d.x1, d.z0 - 17, d.z1 - 17)),
  R('cozy', ROOM_NAMES.cozy, 'office', 2, -5, 11, -7.5, 4.5)
];
// ---- điểm mốc: cổng/vỉa hè như nhà cũ; cửa chính bên phải (gần cổng hơn) ----
const [dx] = toWorld(7.4, 0), ez = 9.6 + OFFSET[1];
const wp = {
  spawnL: { floor: 0, x: -23.5, z: 9.65 }, spawnR: { floor: 0, x: 24.0, z: 9.65 }, sidewalk: old.waypoints.sidewalk, gate: old.waypoints.gate,
  porch: { floor: 0, x: r3(dx), z: r3(ez + 0.9) }, door0: { floor: 0, x: r3(dx), z: r3(ez - 0.15) }, lobby: { floor: 0, x: r3(dx), z: r3(ez - 1.3) },
  wcQueue0: { floor: 0, x: out.wc[0].queue[0], z: out.wc[0].queue[1] }
};
const yard = { floor: 0, x0: -13.1, x1: 13.0, z0: r3(ez), z1: 9.0, name: 'sân trước' };
const layout = {
  version: 3, world: 'sysone-mo',
  _huong_dan: [
    'SINH TỰ ĐỘNG bởi scripts/import-sysone-layout.mjs: ngôi nhà SYSONE 3 tầng, nội thất văn phòng my-office (MIT). Đừng sửa tay — sửa script/shellSpec rồi chạy lại.',
    'Đơn vị mét, y hướng lên. facing (độ) là hướng người ngồi nhìn: 0 = -z, 90 = -x, 180 = +z, 270 = +x.',
    'floor: 0 = tầng trệt (tầng công ty my-office), 1 = tầng 2 (4 phòng ban), 2 = tầng 3 (phòng cozy + sân thượng). Cầu thang trong khối thang bên trái.'
  ],
  scale: { _: 'Kích thước thật như my-office; nhân vật thu nhỏ 0,72 (nhỏ gọn, không theo tỉ lệ thật) để thấy rộng không gian.', furniture: 1, character: 0.72, seatHip: 0.59 },
  floors: [
    { id: 0, name: 'Tầng trệt', y: Y0, ceiling: r3(Y0 + CEIL), zones: old.floors[0].zones },
    { id: 1, name: 'Tầng 2', y: r3(Y0 + FH), ceiling: r3(Y0 + FH + CEIL) },
    { id: 2, name: 'Tầng 3', y: r3(Y0 + 2 * FH), ceiling: r3(Y0 + 2 * FH + CEIL) }
  ],
  stairs: shellStairs(), rooms, deptZones, walls, doors: [{ ...old.doors.find(d => d.id === 'gate') }],
  desks: out.desks, tables: out.tables, pantry: out.pantry, wc: out.wc, items: [], lamps: [],
  waypoints: wp,
  routes: { arrive: ['sidewalk', 'gate', 'porch', 'door0', 'lobby'], leave: ['lobby', 'door0', 'porch', 'gate', 'sidewalk'] },
  nav: {
    cell: 0.1, radius: 0.2,
    areas: [
      ...SF.inner, ...SF.annex, ...SF.terrace, ...SF.doors, yard,
      { floor: 0, x0: 0.15, x1: 2.95, z0: 8.9, z1: 9.35, name: 'cổng' },
      { floor: 0, x0: -24.6, x1: 25.1, z0: 9.25, z1: 10, name: 'vỉa hè' }
    ],
    blocked: [...blocked, ...old.nav.blocked.filter(b => /cổng/.test(b.name || ''))]
  }
};
// ghế phụ không tới được từ sảnh thì bỏ (để không ai bị kẹt)
{
  const { buildModel, seatApproach } = await import('../src/model/layoutModel.js');
  const { Navigator } = await import('../src/nav/grid.js');
  const m = buildModel(layout), nav = new Navigator(m), lobby = m.waypoints.lobby, dropped = [];
  for (const t of layout.tables) t.seats = t.seats.filter(s => { const seat = m.seats.get(s.id); const ok = !seat || (nav.path(lobby, seatApproach(seat)) && nav.path(seatApproach(seat), lobby)); if (!ok) dropped.push(s.id); return ok; });
  const deskBad = layout.desks.filter(d => !nav.path(lobby, seatApproach(m.deskById.get(d.id).seat), layout.routes.arrive.slice(-1))).map(d => d.id);
  if (dropped.length) console.log('bỏ ghế không tới được:', dropped.join(', '));
  if (deskBad.length) console.log('CẢNH BÁO bàn không tới được:', deskBad.join(', '));
}
writeFileSync('public/data/layout.json', JSON.stringify(layout, null, 1) + '\n');
console.log(`layout.json: ${layout.desks.length} bàn (${[0, 1, 2].map(f => layout.desks.filter(d => d.floor === f).length).join('/')}), ${blocked.length} ô cản, ${walls.length} tường · ${Math.round(JSON.stringify(layout).length / 1024)} KB`);
