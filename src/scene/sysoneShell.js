// Vỏ ngôi nhà SYSONE (phong cách nhà cũ: tường kem, cửa sổ khung tối, gờ tầng, mái ngói nâu dốc, mái hiên ngói đỏ, lan
// can sắt) bao quanh nội thất my-office 3 tầng. Số liệu: src/myoffice/shellSpec.js (toạ độ thế giới).
import * as THREE from 'three';
import { shellWalls, shellStairs, shellFloors, floorY, FH, CEIL, ENV, COZY, ANNEX, FRONT_DOORS, toWorld, OFFSET } from '../myoffice/shellSpec.js';

export function buildSysoneShell(ctx) {
  const { B, S, walk, mc, tmat, T, M, house, roofG, COL } = ctx;
  // các hàm dùng chung mà phần nhà hàng xóm/rèm cần (buildHouse vốn tạo ra)
  ctx.railX = function (x0, x1, y, z, g) { B(x0, x1, y + 0.95, y + 1.0, z - 0.025, z + 0.025, M.iron, g); B(x0, x1, y + 0.08, y + 0.12, z - 0.02, z + 0.02, M.iron, g); for (let x = x0; x <= x1 + 0.001; x += 0.2) B(x - 0.012, x + 0.012, y + 0.1, y + 0.97, z - 0.012, z + 0.012, M.iron, g); };
  ctx.railZ = function (x, y, z0, z1, g) { B(x - 0.025, x + 0.025, y + 0.95, y + 1.0, z0, z1, M.iron, g); B(x - 0.02, x + 0.02, y + 0.08, y + 0.12, z0, z1, M.iron, g); for (let z = z0; z <= z1 + 0.001; z += 0.2) B(x - 0.012, x + 0.012, y + 0.1, y + 0.97, z - 0.012, z + 0.012, M.iron, g); };
  ctx.outerBlinds = [];
  const wallM = mc(0xeee8de), frame = M.dark, sill = M.trim, glass = M.glassT, band = mc(0xe2d9c8);
  const fakeGlass = M.glass;

  // ---- tường bao có cửa sổ, cửa ----
  for (const w of shellWalls()) {
    const y0 = floorY(w.floor), y1 = y0 + w.h, along = w.axis === 'x';
    const A0 = along ? w.x0 : w.z0, A1 = along ? w.x1 : w.z1;
    const box = (a0, a1, ya, yb, m = wallM, solid = true) => {
      const args = along ? [a0, a1, ya, yb, w.z0, w.z1] : [w.x0, w.x1, ya, yb, a0, a1];
      return solid ? S(...args, m) : B(...args, m);
    };
    const ops = [...w.open].sort((p, q) => p.a0 - q.a0);
    let cur = A0;
    for (const o of ops) {
      if (o.a0 > cur) box(cur, o.a0, y0, y1);
      if (o.y0 > 0) box(o.a0, o.a1, y0, y0 + o.y0);           // dưới cửa sổ
      if (o.y1 < w.h) box(o.a0, o.a1, y0 + o.y1, y1);          // trên cửa
      cur = Math.max(cur, o.a1);
      // khung + kính (cửa sổ) / khung cửa (cửa đi)
      const fy0 = y0 + o.y0, fy1 = y0 + o.y1, c = along ? (w.z0 + w.z1) / 2 : (w.x0 + w.x1) / 2, th = 0.05;
      const fb = (a0, a1, ya, yb, m, d = (along ? w.z1 - w.z0 : w.x1 - w.x0) + 0.04) => along ? B(a0, a1, ya, yb, c - d / 2, c + d / 2, m) : B(c - d / 2, c + d / 2, ya, yb, a0, a1, m);
      fb(o.a0, o.a0 + th, fy0, fy1, frame); fb(o.a1 - th, o.a1, fy0, fy1, frame); fb(o.a0, o.a1, fy1 - th, fy1, frame);
      if (o.kind === 'window') {
        fb(o.a0, o.a1, fy0, fy0 + th, frame);
        fb(o.a0 - 0.06, o.a1 + 0.06, fy0 - 0.06, fy0, sill, (along ? w.z1 - w.z0 : w.x1 - w.x0) + 0.16);
        fb((o.a0 + o.a1) / 2 - 0.025, (o.a0 + o.a1) / 2 + 0.025, fy0, fy1, frame, 0.06);
        const g = fb(o.a0, o.a1, fy0, fy1, glass, 0.02); g.castShadow = false; g.userData.noMerge = false;
        COL.push(along ? { x0: o.a0, x1: o.a1, y0: fy0, y1: fy1, z0: w.z0, z1: w.z1 } : { x0: w.x0, x1: w.x1, y0: fy0, y1: fy1, z0: o.a0, z1: o.a1 });
      }
    }
    if (A1 > cur) box(cur, A1, y0, y1);
    // cửa sổ giả mặt ngoài (bên trong là tường có cửa sổ vẽ cảnh của my-office)
    for (const o of w.fake || []) {
      const out = along ? (w.z0 < 0 + OFFSET[1] ? w.z0 - 0.02 : w.z1 + 0.02) : (w.x0 < OFFSET[0] ? w.x0 - 0.02 : w.x1 + 0.02);
      const fy0 = y0 + o.y0, fy1 = y0 + o.y1, d = 0.06;
      const fb = (a0, a1, ya, yb, m) => along ? B(a0, a1, ya, yb, out - d / 2, out + d / 2, m) : B(out - d / 2, out + d / 2, ya, yb, a0, a1, m);
      fb(o.a0, o.a1, fy0, fy1, fakeGlass); fb(o.a0 - 0.05, o.a1 + 0.05, fy1, fy1 + 0.06, frame); fb(o.a0 - 0.08, o.a1 + 0.08, fy0 - 0.06, fy0, sill);
      fb((o.a0 + o.a1) / 2 - 0.025, (o.a0 + o.a1) / 2 + 0.025, fy0, fy1, frame);
    }
  }

  // ---- gờ tầng (ngoài nhà) ----
  const [ex0, ez0] = toWorld(ENV.x0, ENV.z0), [ex1, ez1] = toWorld(ENV.x1, ENV.z1);
  for (const f of [1, 2]) {
    const y = floorY(f);
    B(ex0 - 0.08, ex1 + 0.08, y - 0.22, y + 0.02, ez1 - 0.05, ez1 + 0.1, band); B(ex0 - 0.08, ex1 + 0.08, y - 0.22, y + 0.02, ez0 - 0.1, ez0 + 0.05, band);
    B(ex1 - 0.05, ex1 + 0.1, y - 0.22, y + 0.02, ez0 - 0.1, ez1 + 0.1, band); B(ex0 - 0.1, ex0 + 0.05, y - 0.22, y + 0.02, ez0 - 0.1, ez1 + 0.1, band);
  }
  B(ex0 - 0.05, ex1 + 0.05, floorY(0) - 0.05, floorY(0) + 0.35, ez1 - 0.02, ez1 + 0.06, M.base);      // chân tường mặt trước

  // ---- sân thượng (mái tầng 2) + lan can sắt ----
  const F = shellFloors(), y2 = floorY(2);
  const deck = tmat(T.paver, 1, 1);
  for (const r of F.terrace) { B(r.x0, r.x1, y2 - 0.3, y2, r.z0, r.z1, deck); walk(r.x0, r.x1, r.z0, r.z1, y2); }
  const rail = (x0, x1, z0, z1) => {
    B(x0, x1, y2 + 0.98, y2 + 1.05, z0, z1, M.iron); B(x0, x1, y2 + 0.05, y2 + 0.1, z0, z1, M.iron);
    COL.push({ x0, x1, y0: y2, y1: y2 + 1.05, z0, z1 });
    const alongX = x1 - x0 > z1 - z0, L = alongX ? x1 - x0 : z1 - z0;
    for (let a = 0.12; a < L; a += 0.14) alongX ? B(x0 + a - 0.012, x0 + a + 0.012, y2, y2 + 1.0, z0, z1, M.iron) : B(x0, x1, y2, y2 + 1.0, z0 + a - 0.012, z0 + a + 0.012, M.iron);
  };
  const [ax1, az1] = toWorld(ANNEX.x1, ANNEX.z1);
  // (thanh tay vịn trên cùng — khối va chạm; nan dọc chỉ để nhìn)
  rail(ex0, ex1, ez1 - 0.06, ez1); rail(ex1 - 0.06, ex1, ez0, ez1); rail(ex0, ex1, ez0, ez0 + 0.06); rail(ex0, ex0 + 0.06, az1, ez1);
  // chậu cây trên sân thượng
  const leafM = new THREE.MeshLambertMaterial({ color: 0x5b8c43, flatShading: true });
  for (const [x, z] of [[-7.6, 8.6], [-2, 8.6], [4, 8.6], [10, 8.6], [13.6, 8.6], [13.6, 0], [13.6, -7.6], [-7.6, -7.6]]) {
    const [wx, wz] = toWorld(x, z);
    B(wx - 0.35, wx + 0.35, y2, y2 + 0.5, wz - 0.35, wz + 0.35, mc(0x4a4f57));
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), leafM); leaf.position.set(wx, y2 + 0.95, wz); leaf.scale.set(1, 0.9, 1); house.add(leaf);
    COL.push({ x0: wx - 0.35, x1: wx + 0.35, y0: y2, y1: y2 + 1.3, z0: wz - 0.35, z1: wz + 0.35 });
  }

  // ---- mái ngói nâu dốc trên phòng cozy (hai mái như nhà cũ) + đầu hồi ----
  const [cx0, cz0] = toWorld(COZY.x0 - 0.3, COZY.z0 - 0.3), [cx1, cz1] = toWorld(COZY.x1 + 0.3, COZY.z1 + 0.3);
  const yr = y2 + CEIL, half = (cx1 - cx0) / 2;
  const gable = (xa, xb) => {
    const w = xb - xa, xc = (xa + xb) / 2, rise = w * 0.32, ov = 0.45, hw = w / 2 + ov, ext = rise * hw / (w / 2), Ln = Math.hypot(hw, ext), ang = Math.atan2(ext, hw), depth = cz1 - cz0 + 2 * ov, zc = (cz0 + cz1) / 2;
    [-1, 1].forEach(s => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(Ln, 0.16, depth), tmat(T.roof, Ln / 1.2, depth / 1.2));
      m.position.set(xc + s * hw / 2, yr + rise - ext / 2 + 0.08, zc); m.rotation.z = -s * ang; roofG.add(m);
      [cz1 + ov, cz0 - ov].forEach(zz => { const fb = new THREE.Mesh(new THREE.BoxGeometry(Ln, 0.3, 0.1), M.dark); fb.position.set(xc + s * hw / 2, yr + rise - ext / 2 - 0.06, zz); fb.rotation.z = -s * ang; roofG.add(fb); });
    });
    B(xc - 0.18, xc + 0.18, yr + rise + 0.02, yr + rise + 0.2, cz0 - ov, cz1 + ov, M.dark, roofG);
    for (const [z, back] of [[cz1, false], [cz0, true]]) {
      const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(0, rise); sh.closePath();
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), M.plaster); m.position.set(xc, yr, z + (back ? -0.01 : 0.01)); if (back) m.rotation.y = Math.PI; roofG.add(m);
    }
    // cửa sổ áp mái ở đầu hồi trước
    B(xc - 0.55, xc + 0.55, yr + 0.3, yr + 1.25, cz1 + 0.01, cz1 + 0.06, fakeGlass, roofG); B(xc - 0.62, xc + 0.62, yr + 1.25, yr + 1.32, cz1, cz1 + 0.08, M.dark, roofG);
  };
  gable(cx0, cx0 + half); gable(cx0 + half, cx1);
  B(cx0, cx1, yr - 0.05, yr + 0.08, cz0, cz1, M.white, roofG);   // trần mái (đậy phòng cozy)

  // ---- mái hiên ngói đỏ trên hai cửa chính, mái che sọc trên cửa sổ lounge ----
  const yh = floorY(0) + 3.0;
  for (const [a, b] of FRONT_DOORS) {
    const [x0w] = toWorld(a - 0.6, 0), [x1w] = toWorld(b + 0.6, 0);
    const p = new THREE.Mesh(new THREE.BoxGeometry(x1w - x0w, 0.1, 1.5), tmat(T.roofRed, (x1w - x0w) / 1.2, 1.5 / 1.2)); p.position.set((x0w + x1w) / 2, yh, ez1 + 0.7); p.rotation.x = 0.2; house.add(p);
    for (const x of [x0w + 0.1, x1w - 0.1]) B(x - 0.04, x + 0.04, yh - 0.7, yh - 0.05, ez1 + 0.02, ez1 + 1.2, M.dark);
    COL.push({ x0: x0w, x1: x1w, y0: yh - 0.2, y1: yh + 0.3, z0: ez1, z1: ez1 + 1.45 });
  }
  for (const [a, b] of [[9.2, 11.4], [11.9, 14.0]]) {
    const [x0w] = toWorld(a - 0.1, 0), [x1w] = toWorld(b + 0.1, 0);
    const aw = new THREE.Mesh(new THREE.BoxGeometry(x1w - x0w, 0.05, 1.0), tmat(T.stripe, (x1w - x0w) / 1.6, 1)); aw.position.set((x0w + x1w) / 2, floorY(0) + 3.55, ez1 + 0.45); aw.rotation.x = 0.35; house.add(aw);
  }

  // ---- khối thang: sàn chiếu nghỉ, mái, bậc thang ----
  for (const r of F.annex) { const y = floorY(r.floor); B(r.x0, r.x1, y - 0.3, y, r.z0, r.z1, mc(0xcfc9bd)); walk(r.x0, r.x1, r.z0, r.z1, y); }
  const [nx0, nz0] = toWorld(ANNEX.x0, ANNEX.z0), [nx1, nz1] = toWorld(ANNEX.x1, ANNEX.z1), ytop = floorY(0) + 3 * FH - 1.1;
  B(nx0 - 0.1, nx1 + 0.05, ytop, ytop + 0.25, nz0 - 0.1, nz1 + 0.1, band); B(nx0, nx1, ytop - 0.2, ytop, nz0, nz1, M.white);
  const stM = mc(0xcfc9bd), nose = mc(0x9c968a);
  for (const s of shellStairs()) {
    const yF = floorY(s.from), yT = floorY(s.to), N = s.steps, rs = (yT - yF) / N, run = (s.z1 - s.z0) / N;
    for (let i = 0; i < N; i++) {
      const top = yF + (i + 1) * rs, z0 = s.rise === '+z' ? s.z0 + i * run : s.z1 - (i + 1) * run, z1 = z0 + run;
      S(s.x0, s.x1, yF, top, z0, z1, stM); walk(s.x0, s.x1, z0, z1, top);
      B(s.x0, s.x1, top - 0.02, top + 0.005, s.rise === '+z' ? z1 - 0.04 : z0, s.rise === '+z' ? z1 : z0 + 0.04, nose);
    }
  }
  // vách lửng giữa hai làn thang (tay vịn trên đỉnh)
  { const xr = (ANNEX.laneA[0] + ANNEX.laneB[1]) / 2 + OFFSET[0];
    for (const s of shellStairs()) {
      const yF = floorY(s.from), yT = floorY(s.to), len = s.z1 - s.z0, ang = Math.atan2(yT - yF, len) * (s.rise === '+z' ? -1 : 1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, Math.hypot(len, yT - yF)), M.iron);
      m.position.set(xr, (yF + yT) / 2 + 0.95, (s.z0 + s.z1) / 2); m.rotation.x = ang; house.add(m);
    } }

  // ---- trần nhà tầng trệt và tầng 2 (tầng 3: trần mái): trần thạch cao trắng, đèn panel âm trần, khối chặn camera ----
  const ceilM = mc(0xf6f4ef), panelM = M.lampPanel;
  for (const f of [0, 1]) {
    const r = F.inner.find(q => q.floor === f), yc = floorY(f) + 3.98;
    const c = B(r.x0, r.x1, yc, yc + 0.02, r.z0, r.z1, ceilM); c.castShadow = false;
    for (let x = r.x0 + 1.6; x < r.x1 - 0.8; x += 3.2) for (let z = r.z0 + 1.6; z < r.z1 - 0.8; z += 3.0) B(x - 0.3, x + 0.3, yc - 0.012, yc, z - 0.3, z + 0.3, panelM);
    COL.push({ x0: r.x0, x1: r.x1, y0: yc - 0.05, y1: yc + 0.5, z0: r.z0, z1: r.z1, ceiling: true });
  }

  // ---- sàn đi bộ trong nhà (chế độ đi bộ tự do) ----
  for (const r of F.inner) walk(r.x0, r.x1, r.z0, r.z1, floorY(r.floor));
  for (const r of F.doors) walk(r.x0, r.x1, r.z0, r.z1, floorY(r.floor));

  // ---- sân trước: lát gạch từ mặt tiền tới hàng rào, cỏ hai bên lối đi ----
  const yard = { x0: ex0 - 2.6, x1: ex1 + 0.4, z0: ez1, z1: 9.0 };
  B(yard.x0, yard.x1, 0, Y_YARD, yard.z0, yard.z1, tmat(T.paver, (yard.x1 - yard.x0) / 1.2, (yard.z1 - yard.z0) / 1.2)); walk(yard.x0, yard.x1, yard.z0, yard.z1, Y_YARD);
  for (const [a, b] of [[yard.x0 + 0.4, -6.2], [3.9, 5.0 - 1.2], [9.3, yard.x1 - 0.4]]) if (b - a > 1) B(a, b, Y_YARD, Y_YARD + 0.03, yard.z0 + 0.6, yard.z1 - 0.5, mc(0x7fa06a));
  // sân bên và sau nhà (đất trống quanh khối thang)
  B(yard.x0, yard.x1, 0, Y_YARD, -14.4, yard.z0, tmat(T.paver, (yard.x1 - yard.x0) / 1.2, 14 / 1.2));
  return { yard };
}
const Y_YARD = 0.05;
