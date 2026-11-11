// Vỏ toà nhà chế độ "Real SYS" (đúng mặt bằng thật — src/data/realPlan.js, layout.real.json): nền + sàn gỗ từng tầng
// (chừa lỗ lõi cầu thang), trần, cửa sổ ở tường ngoài, cửa chính 2 cánh, bậc thềm / ban công trước cửa, thang bộ chữ U
// (không có thang máy), sân thượng có lan can tường và tum thang. Tường ngoài + vách trong do buildInterior dựng từ
// layout.walls (cùng dữ liệu với va chạm và lưới đi lại).
import * as THREE from 'three';
import * as P from '../data/realPlan.js';
import { CEIL_DROP } from '../interior/ceiling.js';

/** Hình chữ nhật trên bản vẽ (pixel) → hộp thế giới. */
export function planRect(x0, y0, x1, y1) {
  const a = P.planToWorld(x0, y0), b = P.planToWorld(x1, y1);
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
}
/** Mặt bằng toà nhà = 3 khối chữ nhật (khối trái trên lùi vào, khối trái dưới nhô ra mặt tiền, khối lõi + phải). */
export const FOOTPRINT = [planRect(592, 118, 1778, 432), planRect(512, 432, 980, 665), planRect(980, 432, 1778, 745)];
/** Trong nhà (để camera / quy định biết người chơi đang ở trong). */
export const INNER = FOOTPRINT.map(r => ({ x0: r.x0 + 0.1, x1: r.x1 - 0.1, z0: r.z0 + 0.1, z1: r.z1 - 0.1 }));
export const inBuilding = (x, z, m = 0) => INNER.some(r => x > r.x0 + m && x < r.x1 - m && z > r.z0 + m && z < r.z1 - m);

export function buildRealShell(ctx, model) {
  const { B, S, walk, mc, M, T, house, roofG, COL } = ctx;
  const fy = f => model.floorY(f), F0 = fy(0);
  const work = model.floors.filter(f => !f.open), roof = model.floors.find(f => f.open);
  const core = model.stairs[0]?.rect;
  // lan can sắt (interior.js dùng cho lan can quanh lỗ cầu thang)
  ctx.railX = function (x0, x1, y, z, g) { B(x0, x1, y + 0.95, y + 1.0, z - 0.025, z + 0.025, M.iron, g); B(x0, x1, y + 0.08, y + 0.12, z - 0.02, z + 0.02, M.iron, g); for (let x = x0; x <= x1 + 0.001; x += 0.2) B(x - 0.012, x + 0.012, y + 0.1, y + 0.97, z - 0.012, z + 0.012, M.iron, g); };
  ctx.railZ = function (x, y, z0, z1, g) { B(x - 0.025, x + 0.025, y + 0.95, y + 1.0, z0, z1, M.iron, g); B(x - 0.02, x + 0.02, y + 0.08, y + 0.12, z0, z1, M.iron, g); for (let z = z0; z <= z1 + 0.001; z += 0.2) B(x - 0.012, x + 0.012, y + 0.1, y + 0.97, z - 0.012, z + 0.012, M.iron, g); };
  ctx.outerBlinds = [];

  // sàn gỗ sáng ghép ván (giống nhà cũ): toạ độ texture theo mét thế giới
  const woodTex = (() => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 768; const g = c.getContext('2d'); let seed = 11; const rand = (a, b) => { seed = (seed * 16807) % 2147483647; return a + (seed / 2147483647) * (b - a); };
    const rows = 12, rh = 768 / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rand(0, 200);
      while (x < 1024) { const pw = rand(260, 460), l = 76 + rand(-5, 4); const grd = g.createLinearGradient(x, 0, x + pw, 0); grd.addColorStop(0, `hsl(33, 36%, ${l}%)`); grd.addColorStop(1, `hsl(31, 34%, ${l - 4}%)`); g.fillStyle = grd; g.fillRect(x, r * rh, pw, rh); g.fillStyle = 'rgba(80,50,25,.26)'; g.fillRect(x, r * rh, 2, rh); x += pw; }
      g.fillStyle = 'rgba(80,50,25,.28)'; g.fillRect(0, r * rh, 1024, 1.5);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  })();
  const woodF = new THREE.MeshLambertMaterial({ map: woodTex });
  const worldUV = (mesh, su, sv) => { const uv = mesh.geometry.attributes.uv, p = mesh.geometry.attributes.position; for (let k = 8; k < 12; k++) uv.setXY(k, (p.getX(k) + mesh.position.x) / su, (p.getZ(k) + mesh.position.z) / sv); };
  const roofTile = new THREE.MeshLambertMaterial({ map: T.stone }); // (gạch sân thượng)
  const tileM = mc(0xd9d6cf), slabM = M.white, ceilM = new THREE.MeshLambertMaterial({ color: 0xf3f2ee });

  /** Chia các khối chữ nhật theo mép lỗ, bỏ ô nằm trong lỗ; fn(x0,x1,z0,z1). */
  function cells(rects, holes, fn) {
    for (const r of rects) {
      const xs = [...new Set([r.x0, r.x1, ...holes.flatMap(h => [h.x0, h.x1]).filter(v => v > r.x0 && v < r.x1)])].sort((a, b) => a - b);
      const zs = [...new Set([r.z0, r.z1, ...holes.flatMap(h => [h.z0, h.z1]).filter(v => v > r.z0 && v < r.z1)])].sort((a, b) => a - b);
      for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
        const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
        if (holes.some(h => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1)) continue;
        fn(xs[i], xs[i + 1], zs[j], zs[j + 1]);
      }
    }
  }

  /* ---------- nền + sàn ---------- */
  B(-6.4, 6.4, 0, F0, -13.4, 9, M.conc); walk(-6.4, 6.4, -13.4, 9, F0);
  const wc = planRect(P.CORE.wc.x0, P.CORE.wc.y0, P.CORE.wc.x1, P.CORE.wc.y1);
  for (const f of model.floors) {
    const y = fy(f.id), holes = f.id === 0 ? [] : [core];
    if (f.id > 0) cells(FOOTPRINT, holes, (x0, x1, z0, z1) => { B(x0, x1, y - 0.2, y - 0.012, z0, z1, slabM); walk(x0, x1, z0, z1, y); });
    // mặt sàn: gỗ (tầng làm việc), gạch WC; sân thượng lát gạch đỏ
    cells(FOOTPRINT, holes, (x0, x1, z0, z1) => { const t = B(x0, x1, y - 0.012, y + (f.id === 0 ? 0.004 : 0), z0, z1, f.open ? roofTile : woodF); worldUV(t, f.open ? 1.2 : 2.4, f.open ? 1.2 : 1.8); });
    if (!f.open) B(wc.x0, wc.x1, y + 0.004, y + 0.008, wc.z0, wc.z1, tileM);
  }
  // trần (mặt một phía nhìn từ dưới lên: xem theo tầng từ trên xuống không bị che)
  for (const f of work) {
    const yc = f.ceiling - CEIL_DROP; // (trần thả thấp hơn đáy sàn trên — đèn trần gắn vào đây)
    cells(FOOTPRINT, [core], (x0, x1, z0, z1) => { const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(Math.PI / 2); const m = new THREE.Mesh(g, ceilM); m.position.set((x0 + x1) / 2, yc, (z0 + z1) / 2); m.userData.noShadow = true; ctx.interior.add(m); });
  }

  /* ---------- cửa sổ (kính + khung, cả hai mặt tường ngoài) ---------- */
  const glassM = new THREE.MeshStandardMaterial({ color: 0x9fbad0, roughness: 0.08, metalness: 0.55, transparent: true, opacity: 0.85 });
  const frameM = mc(0x34383f);
  for (const w of model.layout.walls) {
    if (!w.ext || !w.windows || w.floor === roof?.id) continue;
    const y = fy(w.floor), alongX = (w.x1 - w.x0) >= (w.z1 - w.z0), c = alongX ? (w.z0 + w.z1) / 2 : (w.x0 + w.x1) / 2, half = (alongX ? w.z1 - w.z0 : w.x1 - w.x0) / 2;
    for (const o of w.windows) {
      for (const s of [-1, 1]) {
        const k = c + s * (half + 0.012), t = 0.012;
        const box = (a0, a1, y0, y1, m) => alongX ? B(a0, a1, y0, y1, k - t, k + t, m) : B(k - t, k + t, y0, y1, a0, a1, m);
        const g = box(o.from + 0.05, o.to - 0.05, y + 0.85, y + 2.45, glassM); g.castShadow = false;
        box(o.from, o.to, y + 0.8, y + 0.86, frameM); box(o.from, o.to, y + 2.44, y + 2.5, frameM);
        box(o.from, o.from + 0.06, y + 0.8, y + 2.5, frameM); box(o.to - 0.06, o.to, y + 0.8, y + 2.5, frameM);
        for (let a = o.from + 0.9; a < o.to - 0.3; a += 0.9) box(a - 0.025, a + 0.025, y + 0.8, y + 2.5, frameM);
      }
    }
  }

  /* ---------- cửa chính 2 cánh kính (mở sẵn vào trong) + bậc thềm / ban công ---------- */
  const door = planRect(P.ENTRY.door.x - 5, P.ENTRY.door.y0, P.ENTRY.door.x + 5, P.ENTRY.door.y1), porch = planRect(P.ENTRY.porch.x0, P.ENTRY.porch.y0, P.ENTRY.porch.x1, P.ENTRY.porch.y1);
  const pz1 = P.planToWorld(507, 0).z;
  for (const f of work) {
    const y = fy(f.id), zc = (door.z0 + door.z1) / 2;
    B(door.x0 - 0.06, door.x0, y, y + 2.3, zc - 0.11, zc + 0.11, frameM); B(door.x1, door.x1 + 0.06, y, y + 2.3, zc - 0.11, zc + 0.11, frameM);
    B(door.x0 - 0.06, door.x1 + 0.06, y + 2.24, y + 2.32, zc - 0.11, zc + 0.11, frameM);
    const leaf = (xa, xb) => { const g = new THREE.Group(); g.position.set(xa, y, zc); g.rotation.y = xa < xb ? -1.25 : 1.25; const w = Math.abs(xb - xa), sgn = Math.sign(xb - xa);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, 2.18, 0.03), glassM); m.position.set(sgn * w / 2, 1.1, 0); g.add(m);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.05), frameM); fr.position.set(sgn * w / 2, 2.18, 0); g.add(fr); const fb = fr.clone(); fb.position.y = 0.03; g.add(fb);
      house.add(g); };
    const xm = (door.x0 + door.x1) / 2; leaf(door.x0, xm); leaf(door.x1, xm);
    if (f.id === 0) { // bậc thềm trước cửa (lối vào từ sân)
      B(porch.x0, porch.x1, F0, F0 + 0.12, porch.z0, pz1, mc(0xb8b2a6)); walk(porch.x0, porch.x1, porch.z0, pz1, F0 + 0.12);
      B(porch.x0 - 0.3, porch.x1 + 0.3, F0, F0 + 0.06, pz1, pz1 + 0.35, mc(0xa9a397)); walk(porch.x0 - 0.3, porch.x1 + 0.3, pz1, pz1 + 0.35, F0 + 0.06);
    } else { // ban công tầng trên: sàn đua ra + lan can sắt (có va chạm)
      B(porch.x0, porch.x1, y - 0.18, y, porch.z0, pz1 + 0.15, M.white); walk(porch.x0, porch.x1, porch.z0, pz1 + 0.15, y);
      const zr = pz1 + 0.12;
      ctx.railX(porch.x0, porch.x1, y, zr);
      COL.push({ x0: porch.x0, x1: porch.x1, y0: y, y1: y + 1.05, z0: zr - 0.04, z1: zr + 0.04 });
      for (const x of [porch.x0, porch.x1]) { B(x - 0.025, x + 0.025, y + 0.08, y + 1.0, porch.z0, zr, M.iron); COL.push({ x0: x - 0.04, x1: x + 0.04, y0: y, y1: y + 1.05, z0: porch.z0, z1: zr }); }
      // mái hiên nhỏ trên ban công (chặn camera trên đầu)
    }
  }
  // lối đi lát đá từ cổng tới bậc thềm
  const gx = 1.55, px = (porch.x0 + porch.x1) / 2, stone = mc(0xc8c2b6);
  B(Math.min(gx, px) - 0.6, Math.max(gx, px) + 0.6, F0, F0 + 0.02, pz1 + 0.35, pz1 + 1.5, stone);
  B(gx - 0.6, gx + 0.6, F0, F0 + 0.02, pz1 + 1.5, 9.0, stone);

  /* ---------- thang bộ chữ U ---------- */
  const stM = mc(0xd2ccc0), noseM = mc(0x8f897d), wellM = M.plaster;
  for (const st of model.stairs) {
    const H = st.yTo - st.yFrom, f0 = st.yFrom;
    for (const fl of st.flights || []) {
      if (fl.flat !== undefined) { // chiếu nghỉ: tấm sàn mỏng
        const y = f0 + fl.flat * H;
        B(fl.x0, fl.x1, y - 0.2, y, fl.z0, fl.z1, stM); walk(fl.x0, fl.x1, fl.z0, fl.z1, y);
        continue;
      }
      const N = fl.steps || Math.round(st.steps * (fl.b - fl.a)), rs = (fl.b - fl.a) * H / N, alongX = fl.rise === '+x' || fl.rise === '-x';
      const len = alongX ? fl.x1 - fl.x0 : fl.z1 - fl.z0, run = len / N;
      for (let i = 0; i < N; i++) {
        const top = f0 + fl.a * H + (i + 1) * rs;
        let r;
        if (fl.rise === '-x') r = [fl.x1 - (i + 1) * run, fl.x1 - i * run, fl.z0, fl.z1];
        else if (fl.rise === '+x') r = [fl.x0 + i * run, fl.x0 + (i + 1) * run, fl.z0, fl.z1];
        else if (fl.rise === '-z') r = [fl.x0, fl.x1, fl.z1 - (i + 1) * run, fl.z1 - i * run];
        else r = [fl.x0, fl.x1, fl.z0 + i * run, fl.z0 + (i + 1) * run];
        // bậc mỏng (không đặc tới sàn): vế thang tầng trên chồng ngay trên vế tầng dưới
        B(r[0], r[1], top - 0.2, top, r[2], r[3], stM); walk(r[0], r[1], r[2], r[3], top);
        COL.push({ x0: r[0], x1: r[1], y0: top - 0.2, y1: top - 0.02, z0: r[2], z1: r[3], low: true });
        const nose = fl.rise === '-x' ? [r[1] - 0.04, r[1]] : fl.rise === '+x' ? [r[0], r[0] + 0.04] : null;
        if (nose) B(nose[0], nose[1], top - 0.015, top + 0.004, r[2], r[3], noseM);
      }
    }
    // giếng thang (khối tường giữa hai vế) + tay vịn hai bên giếng
    const lanes = (st.flights || []).filter(f => f.flat === undefined);
    if (lanes.length === 2) {
      const za = Math.min(lanes[0].z1, lanes[1].z1), zb = Math.max(lanes[0].z0, lanes[1].z0), wz0 = Math.min(za, zb), wz1 = Math.max(za, zb);
      const wx0 = Math.max(lanes[0].x0, lanes[1].x0), wx1 = Math.min(lanes[0].x1, lanes[1].x1);
      S(wx0, wx1, f0 - 0.2, f0 + H - 0.2, wz0, wz1, wellM);
      for (const ln of lanes) {
        const z = ln.z1 <= wz0 + 1e-3 ? ln.z1 - 0.06 : ln.z0 + 0.06, ya = f0 + ln.a * H, yb = f0 + ln.b * H;
        const xa = ln.rise === '-x' ? ln.x1 : ln.x0, xb = ln.rise === '-x' ? ln.x0 : ln.x1;
        const L = Math.hypot(xb - xa, yb - ya), ang = Math.atan2(yb - ya, xb - xa);
        const m = new THREE.Mesh(new THREE.BoxGeometry(L, 0.045, 0.045), M.iron); m.position.set((xa + xb) / 2, (ya + yb) / 2 + 0.9, z); m.rotation.z = ang; house.add(m);
      }
    }
    // tầng trệt: dưới vế 2 và chiếu nghỉ là gầm thang — chặn để không chui vào
    if (st.from === 0) for (const fl of st.flights || []) if (fl.flat !== undefined || fl.a >= 0.5) COL.push({ x0: fl.x0, x1: fl.x1, y0: f0, y1: f0 + H * 0.5 - 0.25, z0: fl.z0, z1: fl.z1 });
  }

  /* ---------- sân thượng: tường lan can 1,1 m + tum thang ---------- */
  if (roof) {
    const y = roof.y;
    for (const w of P.WALLS) {
      if (!w.ext) continue;
      const vert = w.a[0] === w.b[0], t = w.t * P.PX_PER_M / 2;
      const r = vert ? planRect(w.a[0] - t, Math.min(w.a[1], w.b[1]), w.a[0] + t, Math.max(w.a[1], w.b[1])) : planRect(Math.min(w.a[0], w.b[0]), w.a[1] - t, Math.max(w.a[0], w.b[0]), w.a[1] + t);
      S(r.x0, r.x1, y, y + 1.1, r.z0, r.z1, M.plaster); B(r.x0 - 0.03, r.x1 + 0.03, y + 1.1, y + 1.16, r.z0 - 0.03, r.z1 + 0.03, M.cap || M.trim);
    }
    // ban công tầng thượng (trên cửa chính) cũng là lan can
    if (core) { // tum thang: tường 3 phía, mái bằng, mở về phía sảnh
      const c = core, h = 2.6, t = 0.12;
      S(c.x0 - t, c.x0, y, y + h, c.z0 - t, c.z1 + t, M.plaster);
      S(c.x0 - t, c.x1, y, y + h, c.z0 - t, c.z0, M.plaster); S(c.x0 - t, c.x1, y, y + h, c.z1, c.z1 + t, M.plaster);
      B(c.x0 - t - 0.15, c.x1 + 0.4, y + h, y + h + 0.15, c.z0 - t - 0.15, c.z1 + t + 0.15, M.white, roofG);
      COL.push({ x0: c.x0 - t, x1: c.x1 + 0.4, y0: y + h, y1: y + h + 0.15, z0: c.z0 - t, z1: c.z1 + t });
      // lan can quanh lỗ thang trên sân thượng (phía sảnh chừa lối ra)
    }
  }
  return { footprint: FOOTPRINT };
}
