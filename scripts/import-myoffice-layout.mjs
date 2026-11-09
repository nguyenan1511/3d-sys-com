// Sinh public/data/layout.json từ thế giới văn phòng của dự án my-office (khanh020905/my-office, MIT — bố cục "hq":
// tầng công ty + cánh 4 phòng ban, 44 bàn). Dựng thế giới đó trong trình duyệt (src/myoffice/boot.js) rồi đọc:
//   - bàn (vị trí, hướng, ghế), bàn họp và ghế, chỗ ăn trưa (pantry), quầy cà phê, WC;
//   - vật cản: hộp bao của mọi khối trong toà nhà cao 0.15–1.4 m (như lưới đi bộ của my-office), quét lên lưới 0.1 m
//     rồi nén thành hình chữ nhật (nav.blocked); chừa trống quanh mỗi chỗ ngồi;
//   - tường (khối cao, mỏng) cho bản đồ 2D.
// Dùng: node scripts/import-myoffice-layout.mjs   (ghi đè public/data/layout.json; bản cũ lưu public/data/layout.sysone.json)
import { chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { startServer } from './_server.mjs';

const srv = await startServer(5412, { demo: false });
const b = await chromium.launch();
const p = await b.newPage();
p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto(srv.url);
const out = await p.evaluate(async () => {
  document.body.innerHTML = '';
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const { buildMyOffice } = await import('/src/myoffice/boot.js');
  const renderer = new THREE.WebGLRenderer();
  const scene = buildMyOffice(renderer, { plan: 'hq', optimize: false }); // (chưa gộp hình: hộp bao từng món đồ)
  const V = '/src/vendor/my-office/src/office/';
  const { DESKS } = await import(V + 'world/desks.js');
  const { LAY, DEPTS, WING } = await import(V + 'world/layout.js');
  const { MEET, MEET_SEATS } = await import(V + 'world/furniture/meeting.js');
  const { STATIONS, DOOR_IN, DOOR_OUT } = await import(V + 'people/navigation.js');
  const r3 = v => Math.round(v * 1000) / 1000;
  const deg = th => r3(((180 + th * 180 / Math.PI) % 360 + 360) % 360); // hướng my-office (θ: 0 nhìn +z) → độ của SYSONE (0 nhìn -z)
  const box = LAY.box;
  // ---- bàn ----
  const deptOf = (x, z) => DEPTS.findIndex(d => x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1);
  const counters = {};
  const desks = DESKS.map((d, i) => {
    const k = deptOf(d.x, d.z), grp = k < 0 ? 'A' : 'B' + (k + 1);
    counters[grp] = (counters[grp] || 0) + 1;
    const s = Math.sin(d.ry), c = Math.cos(d.ry), sx = d.x + -0.66 * s, sz = d.z + -0.66 * c;
    return { id: `${grp}-${String(counters[grp]).padStart(2, '0')}`, floor: 0, x: r3(d.x), z: r3(d.z), facing: deg(d.ry), w: 1.5, d: 0.74, seat: [r3(sx), r3(sz)],
      dept: k < 0 ? 'Khu làm việc chung' : `Phòng ban ${k + 1}` };
  });
  // ---- chỗ ngồi khác ----
  const spot = (s, id) => ({ id, x: r3(s.x), z: r3(s.z), facing: deg(s.face ?? 0) });
  const tables = [
    { id: 'MR1', name: 'Phòng họp', type: 'meeting', floor: 0, x: r3(MEET.x), z: r3(MEET.z), w: 0.05, d: 0.05, h: 0.76, color: '#F2EFEA', seats: MEET_SEATS.map((s, i) => spot(s, `MR1-${i + 1}`)) },
    { id: 'PT', name: 'Pantry - ăn trưa', type: 'pantry', floor: 0, x: 11.6, z: -2.9, w: 0.05, d: 0.05, h: 0.76, color: '#EFE7D8', seats: STATIONS.dining.map((s, i) => spot(s, `PT-${i + 1}`)) }
  ];
  const coffee = STATIONS.coffee.slice(-2);
  const pantry = { floor: 0, standSpots: coffee.map((s, i) => spot(s, `PS-${i + 1}`)) };
  const wc0 = STATIONS.wc[0];
  const wc = [{ id: 'wc0', name: 'WC', floor: 0, queue: [r3(wc0.x + 1.1), r3(wc0.z)], inside: [r3(wc0.x), r3(wc0.z)], facing: deg(wc0.face) }];
  // điểm cần trống: ghế/chỗ đứng và điểm tiếp cận 0.16 m phía trước (src/model/layoutModel.js seatApproach), buồng WC
  const ahead = s => { const r = s.facing * Math.PI / 180; return [s.x - Math.sin(r) * 0.16, s.z - Math.cos(r) * 0.16]; };
  const others = [...tables.flatMap(t => t.seats), ...pantry.standSpots];
  const seatPts = [...desks.map(d => d.seat), ...desks.map(d => ahead({ x: d.seat[0], z: d.seat[1], facing: d.facing })), ...others.map(s => [s.x, s.z]), ...others.map(ahead), wc[0].inside, wc[0].queue];
  for (let t = 0; t <= 1; t += 0.05) seatPts.push([wc[0].queue[0] + (wc[0].inside[0] - wc[0].queue[0]) * t, wc[0].queue[1] + (wc[0].inside[1] - wc[0].queue[1]) * t]);
  // ---- vật cản: quét hộp bao lên lưới ----
  const C = 0.1, x0 = box.x0, z0 = box.z0, W = Math.ceil((box.x1 - box.x0) / C), H = Math.ceil((box.z1 - box.z0) / C);
  const grid = new Uint8Array(W * H), bb = new THREE.Box3(), walls = [];
  const skip = new Set(); for (const d of DESKS) skip.add(d.chair); // ghế bàn làm việc: chỗ ngồi
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (!o.isMesh || !o.visible || o.isInstancedMesh) return;
    for (let q = o; q; q = q.parent) if (skip.has(q) || q.userData.worker || q.userData.dynamic || q.userData.noCollide || !q.visible) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (bb.max.x < box.x0 || bb.min.x > box.x1 || bb.max.z < box.z0 || bb.min.z > box.z1) return;
    const dx = bb.max.x - bb.min.x, dz = bb.max.z - bb.min.z, h = bb.max.y - bb.min.y;
    if (bb.max.y < 0.15 || bb.min.y > 1.4 || dx > 25 || dz > 25) return;
    if (h > 1.6 && Math.min(dx, dz) < 0.4 && Math.max(dx, dz) > 0.5) walls.push({ floor: 0, x0: r3(bb.min.x), x1: r3(bb.max.x), z0: r3(bb.min.z), z1: r3(bb.max.z), material: o.material?.transparent ? 'glass' : 'plaster' });
    const i0 = Math.max(0, Math.floor((bb.min.x - x0) / C)), i1 = Math.min(W - 1, Math.floor((bb.max.x - x0) / C));
    const j0 = Math.max(0, Math.floor((bb.min.z - z0) / C)), j1 = Math.min(H - 1, Math.floor((bb.max.z - z0) / C));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * W + i] = 1;
  });
  // khoét các ô cửa trên vách (cánh cửa mở, khung cửa không được chặn lối đi)
  const { DOORWAYS } = await import(V + 'world/pro/pieces.js');
  for (const dw of DOORWAYS) {
    const [ax, az] = dw.a, [bx, bz] = dw.b, len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let t = 0.08; t <= len - 0.08; t += C / 2) for (let o = -0.6; o <= 0.6; o += C / 2) {
      const x = ax + ux * t - uz * o, z = az + uz * t + ux * o, i = Math.floor((x - x0) / C), j = Math.floor((z - z0) / C);
      if (i >= 0 && j >= 0 && i < W && j < H) grid[j * W + i] = 0;
    }
  }
  // chừa trống quanh chỗ ngồi/đứng (ghế phòng họp, ghế ăn… là vật thể nhưng là chỗ để ngồi)
  for (const [sx, sz] of seatPts) for (let j = Math.floor((sz - 0.3 - z0) / C); j <= Math.floor((sz + 0.3 - z0) / C); j++) for (let i = Math.floor((sx - 0.3 - x0) / C); i <= Math.floor((sx + 0.3 - x0) / C); i++)
    if (i >= 0 && j >= 0 && i < W && j < H && Math.hypot(x0 + (i + 0.5) * C - sx, z0 + (j + 0.5) * C - sz) < 0.3) grid[j * W + i] = 0;
  // nén: các đoạn liên tiếp theo hàng, gộp với hàng dưới nếu trùng khít
  const blocked = [], open = new Map();
  for (let j = 0; j <= H; j++) {
    const runs = [];
    if (j < H) for (let i = 0; i < W;) { if (!grid[j * W + i]) { i++; continue; } const s = i; while (i < W && grid[j * W + i]) i++; runs.push(s + ':' + i); }
    const next = new Map();
    for (const k of runs) { if (open.has(k)) { next.set(k, open.get(k)); open.delete(k); } else next.set(k, j); }
    for (const [k, js] of open) { const [a, e] = k.split(':').map(Number); blocked.push({ floor: 0, x0: r3(x0 + a * C), x1: r3(x0 + e * C), z0: r3(z0 + js * C), z1: r3(z0 + j * C) }); }
    open.clear(); for (const [k, v] of next) open.set(k, v);
  }
  // ---- phòng (cho bản đồ 2D) ----
  const rooms = [
    { id: 'dev', name: 'Khu làm việc chung', type: 'work', floor: 0, x0: -3.6, x1: 8.6, z0: -1.6, z1: 9 },
    { id: 'director', name: 'Phòng giám đốc', type: 'office', floor: 0, x0: -8, x1: -2.6, z0: -8, z1: -3 },
    { id: 'meeting', name: 'Phòng họp', type: 'meeting', floor: 0, x0: -2.6, x1: 3, z0: -8, z1: -3 },
    { id: 'library', name: 'Thư viện', type: 'library', floor: 0, x0: 3, x1: 8.6, z0: -8, z1: -3 },
    { id: 'pantry', name: 'Pantry', type: 'pantry', floor: 0, x0: 8.6, x1: 14, z0: -8, z1: 0.6 },
    { id: 'lounge', name: 'Phòng giải trí', type: 'lounge', floor: 0, x0: 8.6, x1: 14, z0: 0.6, z1: 9 },
    { id: 'server', name: 'Phòng máy chủ', type: 'server', floor: 0, x0: -8, x1: -3.6, z0: -3, z1: 0.55 },
    { id: 'lobby', name: 'Sảnh - Thang máy', type: 'lobby', floor: 0, x0: -8, x1: -3.6, z0: 0.55, z1: 5.4 },
    { id: 'wc', name: 'WC', type: 'wc', floor: 0, x0: -8, x1: -3.6, z0: 5.4, z1: 9 },
    ...DEPTS.map((d, i) => ({ id: 'dept' + (i + 1), name: `Phòng ban ${i + 1}`, type: 'work', floor: 0, x0: d.x0, x1: d.x1, z0: d.z0, z1: d.z1 }))
  ];
  // xuất hiện/biến mất ngay trước cửa thang máy (như vừa bước ra / bước vào thang)
  const lift = { floor: 0, x: r3(DOOR_IN.x - 0.15), z: r3(DOOR_IN.z) }, liftFront = { floor: 0, x: r3(DOOR_IN.x + 0.7), z: r3(DOOR_IN.z) };
  return {
    version: 2, world: 'my-office', plan: 'hq',
    _huong_dan: [
      'SINH TỰ ĐỘNG bởi scripts/import-myoffice-layout.mjs từ văn phòng của dự án my-office (bố cục hq). Đừng sửa tay — sửa script hoặc gửi bản đồ văn phòng thật để thay.',
      'Đơn vị mét, y hướng lên. facing (độ) là hướng người ngồi nhìn: 0 = -z, 90 = -x, 180 = +z, 270 = +x.',
      'nav.blocked: vật cản quét từ cảnh 3D (lưới 0.1 m). Nhân viên đến/về bằng thang máy ở sảnh.'
    ],
    scale: { _: 'Thế giới my-office theo kích thước thật (nhân vật chibi cao ~1.8 m).', furniture: 1, character: 1, seatHip: 0.59 },
    floors: [{ id: 0, name: 'Văn phòng', y: 0, ceiling: 4.2, zones: [] }],
    stairs: [], rooms, walls, doors: [], desks, tables, pantry, wc, items: [], lamps: [],
    waypoints: { spawnL: lift, spawnR: lift, sidewalk: lift, gate: liftFront, porch: liftFront, door0: liftFront, lobby: { floor: 0, x: -5.4, z: 3.0 } },
    routes: { arrive: ['sidewalk', 'gate', 'lobby'], leave: ['lobby', 'gate', 'sidewalk'] },
    nav: { cell: 0.1, radius: 0.2, areas: [{ floor: 0, x0: box.x0 + 0.15, x1: box.x1 - 0.15, z0: box.z0 + 0.15, z1: box.z1 - 0.15, name: 'văn phòng' }], blocked },
    _stats: { desks: desks.length, blocked: blocked.length, walls: walls.length, doorways: DOORWAYS.length, wing: WING }
  };
});
await b.close(); srv.stop();
if (!existsSync('public/data/layout.sysone.json')) copyFileSync('public/data/layout.json', 'public/data/layout.sysone.json');
const stats = out._stats; delete out._stats;
// bỏ ghế phụ (phòng họp, pantry) không có đường tới từ sảnh, để không ai bị kẹt khi được xếp vào đó
{
  const { buildModel, seatApproach } = await import('../src/model/layoutModel.js');
  const { Navigator } = await import('../src/nav/grid.js');
  const m = buildModel(out), nav = new Navigator(m), lobby = m.waypoints.lobby, dropped = [];
  for (const t of out.tables) t.seats = t.seats.filter(s => {
    const seat = m.seats.get(s.id); const ok = !seat || (nav.path(lobby, seatApproach(seat)) && nav.path(seatApproach(seat), lobby));
    if (!ok) dropped.push(s.id); return ok;
  });
  if (dropped.length) console.log('bỏ ghế không tới được:', dropped.join(', '));
}
writeFileSync('public/data/layout.json', JSON.stringify(out, null, 1) + '\n');
console.log(`layout.json: ${stats.desks} bàn, ${stats.doorways} cửa, ${stats.blocked} ô cản, ${stats.walls} tường · ${(readFileSync('public/data/layout.json').length / 1024).toFixed(0)} KB`);
