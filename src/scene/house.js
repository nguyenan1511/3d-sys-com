// Căn nhà số 33: vỏ nhà rỗng, sàn (chừa lỗ cầu thang theo layout), cầu thang, ban công, mái, tường rào, cổng.
/*
 HỆ TỌA ĐỘ (mét): x sang phải khi nhìn từ đường vào nhà, y hướng lên, z hướng ra đường.
 Mặt tiền tường rào ở z=9, vỉa hè z 9.25-12.5, lòng đường z 12.7-26.7. Nhà nằm ở x -3.2..3.2, z -7..3.8 (khối trái) và 4.5 (khối phải).
 Cao độ sàn lấy từ layout.json (mặc định F0=0.05, F1=3.0, F2=5.9). Cầu thang lấy từ layout.json.
*/
import * as THREE from 'three';

export function buildHouse(ctx, model) {
  const { B, S, walk, mc, L, LD, tmat, house, roofG, COL, T, M } = ctx;
  const fy = id => model.floorY(id);
  const F0 = fy(0), F1 = fy(1), F2 = fy(2), TS = 0.2, rise = 2.4, ye = 8.7;
  // sàn gỗ sáng ghép ván kiểu my-office (khanh020905/my-office, MIT — cozy-room.js): ván dài so le, mạch tối, vân mờ.
  // Toạ độ texture theo mét thế giới (mỗi ô texture 2.4 × 1.8 m) nên ván đều nhau trên mọi tấm sàn.
  const woodTex = (() => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 768; const g = c.getContext('2d'); let seed = 7; const rand = (a, b) => { seed = (seed * 16807) % 2147483647; return a + (seed / 2147483647) * (b - a); };
    const rows = 12, rh = 768 / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rand(0, 200);
      while (x < 1024) { const pw = rand(260, 460), l = 74 + rand(-5, 4); const grd = g.createLinearGradient(x, 0, x + pw, 0); grd.addColorStop(0, `hsl(32, 40%, ${l}%)`); grd.addColorStop(1, `hsl(30, 38%, ${l - 4}%)`); g.fillStyle = grd; g.fillRect(x, r * rh, pw, rh); g.fillStyle = 'rgba(80,50,25,.28)'; g.fillRect(x, r * rh, 2, rh); x += pw; }
      g.fillStyle = 'rgba(80,50,25,.3)'; g.fillRect(0, r * rh, 1024, 1.5);
    }
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(110,70,35,${rand(0.02, 0.07)})`; g.fillRect(rand(0, 1024), rand(0, 768), rand(20, 90), 1); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  })();
  const woodF = new THREE.MeshLambertMaterial({ map: woodTex }); woodF.userData.worldUV = [2.4, 1.8];
  const SLAB = [M.white, M.white, woodF, M.white, M.white, M.white];
  const STONE = tmat(T.stone, 3.2 / 1.2, 3 / 1.2);

  function holeWall(x0, x1, y0, y1, z0, z1, ox0, ox1, oy0, oy1, m, nocol) { const f = nocol ? B : S; f(x0, ox0, y0, y1, z0, z1, m); f(ox1, x1, y0, y1, z0, z1, m); if (oy0 > y0) f(ox0, ox1, y0, oy0, z0, z1, m); if (oy1 < y1) f(ox0, ox1, oy1, y1, z0, z1, m); }
  /** Sàn có nhiều lỗ chữ nhật: chia lưới theo mép lỗ, bỏ ô nằm trong lỗ. */
  function slab(x0, x1, z0, z1, y0, y1, m, holes = []) {
    const xs = [...new Set([x0, x1, ...holes.flatMap(h => [h.x0, h.x1]).filter(v => v > x0 && v < x1)])].sort((a, b) => a - b);
    const zs = [...new Set([z0, z1, ...holes.flatMap(h => [h.z0, h.z1]).filter(v => v > z0 && v < z1)])].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      if (holes.some(h => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1)) continue;
      // thân sàn trắng + lớp gỗ mỏng phía trên (một vật liệu mỗi hộp để gộp mesh được)
      if (Array.isArray(m)) {
        B(xs[i], xs[i + 1], y0, y1 - 0.012, zs[j], zs[j + 1], m[0]);
        const top = B(xs[i], xs[i + 1], y1 - 0.012, y1, zs[j], zs[j + 1], m[2]), wu = m[2].userData.worldUV;
        if (wu) { // mặt trên (+y: đỉnh 8..11 của BoxGeometry): toạ độ texture theo vị trí thế giới
          const uv = top.geometry.attributes.uv, p = top.geometry.attributes.position;
          for (let k = 8; k < 12; k++) uv.setXY(k, (p.getX(k) + top.position.x) / wu[0], (p.getZ(k) + top.position.z) / wu[1]);
        }
      }
      else B(xs[i], xs[i + 1], y0, y1, zs[j], zs[j + 1], m);
      walk(xs[i], xs[i + 1], zs[j], zs[j + 1], y1);
    }
  }
  function glazed(xc, yc, w, h, zc, cols) {
    S(xc - w / 2, xc + w / 2, yc - h / 2, yc + h / 2, zc - 0.015, zc + 0.015, M.glassT);
    const d = mc(0x2e2019);
    B(xc - w / 2 - 0.05, xc + w / 2 + 0.05, yc + h / 2 - 0.02, yc + h / 2 + 0.06, zc - 0.08, zc + 0.08, d); B(xc - w / 2 - 0.05, xc + w / 2 + 0.05, yc - h / 2 - 0.06, yc - h / 2 + 0.02, zc - 0.08, zc + 0.08, d);
    B(xc - w / 2 - 0.05, xc - w / 2 + 0.02, yc - h / 2, yc + h / 2, zc - 0.08, zc + 0.08, d); B(xc + w / 2 - 0.02, xc + w / 2 + 0.05, yc - h / 2, yc + h / 2, zc - 0.08, zc + 0.08, d);
    for (let i = 1; i < cols; i++) { const x = xc - w / 2 + w * i / cols; B(x - 0.025, x + 0.025, yc - h / 2, yc + h / 2, zc - 0.05, zc + 0.05, d); }
  }
  function doorFrame(xa, xb, y0, y1, zc) { const d = mc(0x2e2019); B(xa - 0.04, xa + 0.04, y0, y1, zc - 0.1, zc + 0.1, d); B(xb - 0.04, xb + 0.04, y0, y1, zc - 0.1, zc + 0.1, d); B(xa - 0.04, xb + 0.04, y1 - 0.07, y1, zc - 0.1, zc + 0.1, d); }
  ctx.railX = function (x0, x1, y, z, g) { B(x0, x1, y + 0.95, y + 1.0, z - 0.025, z + 0.025, M.iron, g); B(x0, x1, y + 0.08, y + 0.12, z - 0.02, z + 0.02, M.iron, g); for (let x = x0; x <= x1 + 0.001; x += 0.2) B(x - 0.012, x + 0.012, y + 0.1, y + 0.97, z - 0.012, z + 0.012, M.iron, g); };
  ctx.railZ = function (x, y, z0, z1, g) { B(x - 0.025, x + 0.025, y + 0.95, y + 1.0, z0, z1, M.iron, g); B(x - 0.02, x + 0.02, y + 0.08, y + 0.12, z0, z1, M.iron, g); for (let z = z0; z <= z1 + 0.001; z += 0.2) B(x - 0.012, x + 0.012, y + 0.1, y + 0.97, z - 0.012, z + 0.012, M.iron, g); };
  const { railX, railZ } = ctx;
  // rèm tre ngoài ban công: neo ở mép trên để cuộn lên được (đồng bộ với rèm trong nhà cùng id)
  ctx.outerBlinds = [];
  function vblind(xc, ya, yb, z, w, id) {
    const m = tmat(T.bamboo, w / 0.8, (yb - ya) / 0.8); m.color.set(0xd2c6b6);
    const g = new THREE.BoxGeometry(w, yb - ya, 0.04); g.translate(0, -(yb - ya) / 2, 0);
    const p = new THREE.Mesh(g, m); p.position.set(xc, yb, z); p.userData.noMerge = true; house.add(p);
    B(xc - w / 2, xc + w / 2, yb - 0.03, yb, z - 0.03, z + 0.03, mc(0x5d4328));
    ctx.outerBlinds.push({ id, mesh: p, mat: m, repeatY: (yb - ya) / 0.8 });
  }
  function gableRoof(xc, z0, z1, w, y0, rise, ovx, ovz, g, tex) {
    g = g || house; tex = tex || T.roof;
    const half = w / 2 + ovx, ext = rise * half / (w / 2), Ln = Math.hypot(half, ext), ang = Math.atan2(ext, half), depth = (z1 - z0) + 2 * ovz, zc = (z0 + z1) / 2;
    [-1, 1].forEach(s => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(Ln, 0.16, depth), tmat(tex, Ln / 1.2, depth / 1.2));
      m.position.set(xc + s * half / 2, y0 + rise - ext / 2 + 0.08, zc); m.rotation.z = -s * ang; g.add(m);
      [z1 + ovz, z0 - ovz].forEach(zz => { const fb = new THREE.Mesh(new THREE.BoxGeometry(Ln, 0.3, 0.1), M.dark); fb.position.set(xc + s * half / 2, y0 + rise - ext / 2 - 0.06, zz); fb.rotation.z = -s * ang; g.add(fb); });
    });
    B(xc - 0.18, xc + 0.18, y0 + rise + 0.02, y0 + rise + 0.2, z0 - ovz, z1 + ovz, M.dark, g);
  }
  function gable(xc, z, w, y0, rise, mat, back) {
    const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(0, rise); sh.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), mat); m.position.set(xc, y0, z); if (back) m.rotation.y = Math.PI; house.add(m);
    const len = Math.hypot(w / 2, rise), ang = Math.atan2(rise, w / 2);
    [-1, 1].forEach(s => { const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.06), M.dark); b.position.set(xc + s * w / 4, y0 + rise / 2, z + (back ? -0.03 : 0.03)); b.rotation.z = -s * ang; house.add(b); });
  }
  function arch(xc, y, w, h, z) {
    const shp = (w, h) => { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(-w / 2, h - w / 2); s.absarc(0, h - w / 2, w / 2, Math.PI, 0, true); s.lineTo(w / 2, 0); s.closePath(); return s; };
    const a = new THREE.Mesh(new THREE.ShapeGeometry(shp(w + 0.16, h + 0.08)), M.awhite); a.position.set(xc, y - 0.04, z + 0.02); house.add(a);
    const b = new THREE.Mesh(new THREE.ShapeGeometry(shp(w, h - 0.04)), M.glassD); b.position.set(xc, y, z + 0.04); house.add(b);
  }

  /* ---------- vỏ nhà ---------- */
  B(-3.5, 3.45, 0, F0, -10, 9, M.conc); walk(-3.5, 3.45, -10, 9, F0);
  const tileM = mc(0xd9d3c7);
  // tầng trệt cũng lát sàn gỗ như các tầng trên (kiểu my-office); WC giữ gạch
  const woodTop = (x0, x1, z0, z1) => { const t = B(x0, x1, F0, F0 + 0.012, z0, z1, woodF), uv = t.geometry.attributes.uv, p = t.geometry.attributes.position; for (let k = 8; k < 12; k++) uv.setXY(k, (p.getX(k) + t.position.x) / 2.4, (p.getZ(k) + t.position.z) / 1.8); };
  woodTop(-3.0, 3.0, -6.8, 2.0); woodTop(-3.0, 0, 2.0, 3.6); B(-0.88, 0.18, F0 + 0.012, F0 + 0.016, -6.8, -4.52, tileM); B(0, 3.0, F0, F0 + 0.012, 2.2, 4.3, mc(0xbdb7ab));
  S(-3.2, 3.2, F0, F1 - TS, -7, -6.8, M.plaster);
  S(-3.2, -3.0, F0, F1 - TS, -6.8, 3.8, M.plaster);
  S(3.0, 3.2, F0, F1 - TS, -6.8, 2.2, M.plaster);
  holeWall(-3.2, 0, F0, F1 - TS, 3.6, 3.8, -2.7, -0.5, 0.95, 2.35, M.plaster);
  glazed(-1.6, 1.65, 2.2, 1.4, 3.7, 3);
  holeWall(0, 3.2, F0, F1 - TS, 2.0, 2.2, 0.45, 2.75, F0, 2.3, M.plaster);
  doorFrame(0.45, 2.75, F0, 2.3, 2.1);
  S(0, 0.35, F0, F1 - TS, 2.2, 4.5, M.plaster); S(2.85, 3.2, F0, F1 - TS, 2.2, 4.5, M.plaster);
  S(-0.2, 0, F0, F1 - TS, 2.2, 3.8, M.plaster);

  const holesOn = f => model.stairs.filter(s => s.to === f).map(s => s.rect);
  slab(-3.2, 3.2, -7, 3.8, F1 - TS, F1, SLAB, holesOn(1)); slab(0, 3.2, 3.8, 4.5, F1 - TS, F1, SLAB);
  slab(-3.2, 3.2, -7, 3.8, F2 - TS, F2, SLAB, holesOn(2)); slab(0, 3.2, 3.8, 4.5, F2 - TS, F2, SLAB);
  B(-3.2, 3.2, 8.5, ye, -7, 3.8, M.white, roofG); B(0, 3.2, 8.5, ye, 3.8, 4.5, M.white, roofG);

  function upperShell(yb, yt) {
    S(-3.2, 3.2, yb, yt, -7, -6.8, M.plaster); S(-3.2, -3.0, yb, yt, -6.8, 3.8, M.plaster); S(3.0, 3.2, yb, yt, -6.8, 4.5, M.plaster);
    holeWall(-3.2, 0, yb, yt, 3.6, 3.8, -2.75, -0.55, yb, yb + 2.2, M.plaster); doorFrame(-2.75, -0.55, yb, yb + 2.2, 3.7);
    holeWall(0, 3.2, yb, yt, 4.3, 4.5, 0.6, 2.6, yb + 0.85, yb + 2.35, M.plaster);
    holeWall(0, 3.2, yb, yt, 4.5, 4.62, 0.6, 2.6, yb + 0.85, yb + 2.35, STONE, true);
    glazed(1.6, yb + 1.6, 2.0, 1.5, 4.4, 4);
    S(-0.2, 0, yb, yt, 3.8, 4.5, M.plaster);
    B(-3.2, 0, yb - 0.12, yb + 0.04, 3.8, 3.86, M.trim);
  }
  upperShell(F1, F2 - TS); upperShell(F2, 8.5);

  [F1, F2].forEach(y => {
    B(-3.0, -0.3, y - 0.18, y, 3.8, 4.85, M.white); walk(-3.0, -0.3, 3.8, 4.85, y);
    railX(-3.0, -0.3, y, 4.82); railZ(-3.0, y, 3.8, 4.85); railZ(-0.3, y, 3.8, 4.85);
    COL.push({ x0: -3.02, x1: -2.98, y0: y, y1: y + 1.0, z0: 3.8, z1: 4.88 }, { x0: -0.32, x1: -0.28, y0: y, y1: y + 1.0, z0: 3.8, z1: 4.88 }, { x0: -3.0, x1: -0.3, y0: y, y1: y + 1.0, z0: 4.8, z1: 4.86 });
  });
  vblind(-1.65, F1 + 0.15, F2 - 0.25, 4.9, 2.6, 'f1-balcony');
  vblind(-1.65, F2 + 0.15, ye - 0.5, 4.9, 2.6, 'f2-balcony');
  vblind(1.6, F1 + 0.35, F1 + 2.6, 4.74, 2.3, 'f1-bay');
  vblind(1.6, F2 + 0.35, ye - 0.3, 4.74, 2.3, 'f2-bay');
  gable(-1.6, 3.81, 3.2, ye, rise, tmat(T.brick, 1, 1, true), false);
  gable(1.6, 4.63, 3.2, ye, rise, M.gcream, false);
  gable(-1.6, -7.01, 3.2, ye, rise, M.gcream, true); gable(1.6, -7.01, 3.2, ye, rise, M.gcream, true);
  B(1.6 - 1.2, 1.6 + 1.2, ye + 0.45, ye + 0.55, 4.62, 4.7, M.dark);
  arch(-1.6, ye + 0.7, 0.7, 1.0, 3.81);
  arch(1.6, ye + 0.9, 0.55, 0.85, 4.63);
  gableRoof(-1.6, -7, 3.8, 3.2, ye, rise, 0.35, 0.5, roofG);
  gableRoof(1.6, -7, 4.6, 3.2, ye, rise, 0.35, 0.55, roofG);
  const porch = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 2.8), tmat(T.roofRed, 3.4 / 1.2, 2.8 / 1.2)); porch.position.set(1.8, F1 - 0.2, 6.0); porch.rotation.x = 0.18; house.add(porch);
  const lroof = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 1.7), tmat(T.roofRed, 3.2 / 1.2, 1.7 / 1.2)); lroof.position.set(-1.6, F1 - 0.6, 4.6); lroof.rotation.x = 0.15; house.add(lroof);
  const awn = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 2.3), tmat(T.stripe, 2.6 / 1.6, 1)); awn.position.set(1.75, F1 - 0.7, 5.85); awn.rotation.x = 0.21; house.add(awn);
  const awnL = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.05, 1.5), tmat(T.stripe, 2.8 / 1.6, 1)); awnL.position.set(-1.6, F1 - 1.0, 4.7); awnL.rotation.x = 0.2; house.add(awnL);
  // mái hiên/mái che trước nhà: khối chặn camera (cao trên đầu người, không cản lối đi)
  COL.push({ x0: 0.1, x1: 3.5, y0: F1 - 1.25, y1: F1 + 0.1, z0: 4.5, z1: 7.4 }, { x0: -3.2, x1: 0, y0: F1 - 1.4, y1: F1 - 0.3, z0: 3.8, z1: 5.5 });

  /* ---------- cầu thang theo layout ---------- */
  const stM = mc(0xcfc9bd);
  for (const s of model.stairs) {
    const N = s.steps, rs = (s.yTo - s.yFrom) / N;
    const alongZ = s.rise === '+z' || s.rise === '-z';
    const len = alongZ ? (s.z1 - s.z0) : (s.x1 - s.x0), run = len / N;
    for (let i = 0; i < N; i++) {
      const top = s.yFrom + (i + 1) * rs;
      let r;
      if (s.rise === '+z') r = [s.x0, s.x1, s.z0 + i * run, s.z0 + (i + 1) * run];
      else if (s.rise === '-z') r = [s.x0, s.x1, s.z1 - (i + 1) * run, s.z1 - i * run];
      else if (s.rise === '+x') r = [s.x0 + i * run, s.x0 + (i + 1) * run, s.z0, s.z1];
      else r = [s.x1 - (i + 1) * run, s.x1 - i * run, s.z0, s.z1];
      // khối bậc là vật cản khi đi bộ (không chui gầm thang), vẫn bước lên được từng bậc
      S(r[0], r[1], s.yFrom, top, r[2], r[3], stM); walk(r[0], r[1], r[2], r[3], top);
      B(r[0], r[1], top - 0.02, top + 0.005, alongZ ? r[3] - 0.04 : r[2], alongZ ? r[3] : r[3], mc(0x9c968a));
    }
    // tay vịn phía trong (không sát tường)
    if (alongZ) {
      const x = Math.abs(s.x0) > 2.95 ? s.x1 - 0.03 : s.x0 + 0.03;
      const za = s.rise === '+z' ? s.z0 : s.z1, zb = s.rise === '+z' ? s.z1 : s.z0;
      const Lr = Math.hypot(zb - za, s.yTo - s.yFrom), ang = Math.atan2(s.yTo - s.yFrom, zb - za);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, Lr), M.iron); m.position.set(x, (s.yFrom + s.yTo) / 2 + 0.9, (za + zb) / 2); m.rotation.x = -ang; house.add(m);
      for (let i = 2; i < N; i += 3) { const z = za + (zb - za) * (i + 0.5) / N, y = s.yFrom + (i + 1) * rs; B(x - 0.015, x + 0.015, y, y + 0.9, z - 0.015, z + 0.015, M.iron); }
      // chặn trèo qua tay vịn khi đi bộ (chừa đoạn đầu thang để bước vào ngang)
      const zEntry = s.pEntry.z, z0c = Math.min(za, zb), z1c = Math.max(za, zb);
      const open0 = Math.min(z1c, Math.max(z0c, zEntry + 0.6));
      if (s.rise === '+z') COL.push({ x0: x - 0.03, x1: x + 0.03, y0: s.yFrom, y1: s.yTo + 1.1, z0: open0, z1: z1c });
      else COL.push({ x0: x - 0.03, x1: x + 0.03, y0: s.yFrom, y1: s.yTo + 1.1, z0: z0c, z1: Math.max(z0c, zEntry - 0.6) });
    }
  }
  return { F0, F1, F2, TS, ye };
}

/** Tường rào, trụ cổng, đèn cầu, hai cánh cổng. Logo đặt riêng ở logo.js. */
export function buildFence(ctx, { lot = null } = {}) {
  const { B, S, mc, M, house, COL, T } = ctx;
  S(-3.5, -0.35, 0, 2.4, 9.0, 9.25, M.wall); B(-3.5, -0.35, 0, 0.35, 9.0, 9.28, mc(0x6a645c)); B(-3.55, -0.3, 2.4, 2.48, 8.95, 9.3, M.trim);
  S(-3.55, -3.1, 0, 2.9, 8.9, 9.35, M.wall); B(-3.62, -3.03, 2.9, 3.0, 8.85, 9.4, M.cap);
  // viền khung biển (nằm trọn trong phần tường lộ ra giữa hai trụ)
  const rim = mc(0xe2e2de);
  B(-3.06, -0.43, 2.12, 2.2, 9.25, 9.31, rim); B(-3.06, -0.43, 0.38, 0.46, 9.25, 9.31, rim); B(-3.08, -3.0, 0.38, 2.2, 9.25, 9.31, rim); B(-0.51, -0.43, 0.38, 2.2, 9.25, 9.31, rim);
  const globe = x => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), new THREE.MeshBasicMaterial({ color: 0xfafaf4 })); s.position.set(x, 3.55, 9.12); house.add(s); };
  S(-0.35, 0.15, 0, 3.2, 8.9, 9.35, M.wall); B(-0.42, 0.22, 3.2, 3.32, 8.85, 9.4, M.cap); B(-0.35, 0.15, 0, 0.4, 8.9, 9.38, M.base); globe(-0.1);
  S(2.95, 3.45, 0, 3.2, 8.9, 9.35, M.wcream); B(2.88, 3.52, 3.2, 3.32, 8.85, 9.4, M.cap); B(2.95, 3.45, 0, 0.4, 8.9, 9.38, M.base); globe(3.2);
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshLambertMaterial({ map: T.plate })); pl.position.set(3.2, 1.45, 9.37); house.add(pl);
  function leaf(hx, rotY) {
    const lg = new THREE.Group(); lg.position.set(hx, 0.05, 9.12); lg.rotation.y = rotY; lg.userData.noMerge = true; house.add(lg);
    const len = 1.4, H0 = 2.35, H1 = 2.85, yt = x => H0 + (H1 - H0) * (x / len);
    const b = (x0, x1, y0, y1, z0, z1, m) => B(x0, x1, y0, y1, z0, z1, m, lg);
    b(0, 0.06, 0, H0, -0.04, 0.04, M.gate); b(len - 0.06, len, 0, H1, -0.04, 0.04, M.gate); b(0, len, 0, 0.12, -0.04, 0.04, M.gate); b(0, len, 0.9, 0.96, -0.03, 0.03, M.gate); b(0.06, len - 0.06, 0.12, 0.9, -0.02, 0.02, M.gate);
    const ang = Math.atan2(H1 - H0, len), Lr = Math.hypot(len, H1 - H0);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(Lr, 0.09, 0.08), M.gate); rail.position.set(len / 2, (H0 + H1) / 2 - 0.045, 0); rail.rotation.z = ang; lg.add(rail);
    for (let x = 0.1; x < len - 0.06; x += 0.1) b(x - 0.012, x + 0.012, 0.96, yt(x) - 0.09, -0.012, 0.012, M.gate);
    for (let s = 0.1; s < len - 0.04; s += 0.2) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 6), M.gate); c.position.set(s, yt(s) + 0.02, 0); lg.add(c); }
    return lg;
  }
  const leafL = leaf(0.15, 0), leafR = leaf(2.95, Math.PI);
  ctx.mergeLater = [...(ctx.mergeLater || []), leafL, leafR]; // gộp mesh sau khi gán bóng đổ
  COL.push({ x0: 0.15, x1: 2.95, y0: 0, y1: 2.9, z0: 9.0, z1: 9.3, gate: true });
  if (!lot) { S(3.45, 3.65, 0, 2.4, -10, 9, mc(0xd9cfa5)); S(-3.5, 3.65, 0, 2.4, -10.2, -10, mc(0xd9cfa5)); }
  else {
    // khu đất rộng (toà nhà lớn): tường rào trước kéo dài hai bên cổng, tường biên quanh khu đất
    const fw = mc(0xd9cfa5);
    S(lot.x0, -3.55, 0, 2.4, 9.0, 9.25, M.wall); B(lot.x0, -3.55, 2.4, 2.48, 8.95, 9.3, M.trim); B(lot.x0, -3.55, 0, 0.35, 9.0, 9.28, mc(0x6a645c));
    S(3.45, lot.x1, 0, 2.4, 9.0, 9.25, M.wall); B(3.45, lot.x1, 2.4, 2.48, 8.95, 9.3, M.trim); B(3.45, lot.x1, 0, 0.35, 9.0, 9.28, mc(0x6a645c));
    for (let x = lot.x0; x < -3.6; x += 3.2) { S(x, x + 0.45, 0, 2.9, 8.9, 9.35, M.wall); B(x - 0.07, x + 0.52, 2.9, 3.0, 8.85, 9.4, M.cap); }
    for (let x = lot.x1 - 0.45; x > 3.5; x -= 3.2) { S(x, x + 0.45, 0, 2.9, 8.9, 9.35, M.wall); B(x - 0.07, x + 0.52, 2.9, 3.0, 8.85, 9.4, M.cap); }
    S(lot.x0 - 0.2, lot.x0, 0, 2.4, lot.z0, 9.0, fw); S(lot.x1, lot.x1 + 0.2, 0, 2.4, lot.z0, 9.0, fw); S(lot.x0 - 0.2, lot.x1 + 0.2, 0, 2.4, lot.z0 - 0.2, lot.z0, fw);
  }
  return { leafL, leafR };
}
