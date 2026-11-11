// Nội thất dựng hoàn toàn từ layout.json: bàn làm việc (có màn hình bật/tắt), quầy lễ tân, bàn họp, pantry, WC, đồ đạc, tường, lan can, đèn trần.
import { officeChair, CHAIR_IDLE } from '../scene/moBlocks.js';
import { plant } from './plants.js';
import * as THREE from 'three';
import { deg2yaw } from '../core/util.js';
import { footprint } from '../model/layoutModel.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildDesk, NameplateAtlas } from './deskKit.js';
import { mergeStatic } from '../scene/builder.js';
import { CEIL_DROP } from './ceiling.js';

export function buildInterior(ctx, model) {
  const { B, S, mc, M, interior: root, COL, rng } = ctx;
  const screens = new Map();   // deskId -> mesh màn hình
  const deskGroups = new Map();
  const dk = mc(0x555a60), blk = mc(0x1e2025), mon = mc(0x15171c);
  const fy = f => model.floorY(f);

  // Nhóm đặt tại (x, y, z) xoay theo facing; trong hệ cục bộ người ngồi nhìn về -z.
  const fs = model.fs || 1; // tỉ lệ nội thất (layout.json → scale.furniture)
  const local = (x, y, z, facing) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = deg2yaw(facing || 0); g.scale.setScalar(fs); root.add(g); return g; };
  // nhóm thu nhỏ quanh điểm neo: toạ độ bên trong vẫn là toạ độ thế giới ở kích thước thật
  const piv = (x, y, z) => { const g = new THREE.Group(); g.position.set(x * (1 - fs), y * (1 - fs), z * (1 - fs)); g.scale.setScalar(fs); g.userData.anchor = [x, y, z]; root.add(g); return g; };
  const colScaled = (ax, ay, az, c) => COL.push({ x0: ax + (c.x0 - ax) * fs, x1: ax + (c.x1 - ax) * fs, y0: ay + (c.y0 - ay) * fs, y1: ay + (c.y1 - ay) * fs, z0: az + (c.z0 - az) * fs, z1: az + (c.z1 - az) * fs });
  /** Hộp có va chạm trong nhóm thu nhỏ g (neo tại g.userData.anchor). */
  const SB = (g, x0, x1, y0, y1, z0, z1, m) => { B(x0, x1, y0, y1, z0, z1, m, g); const a = g.userData.anchor; colScaled(a[0], a[1], a[2], { x0, x1, y0, y1, z0, z1 }); };
  const lb = (g, x0, x1, y0, y1, z0, z1, m) => B(x0, x1, y0, y1, z0, z1, m, g);
  const colFoot = (fp, y0, y1) => COL.push({ x0: fp.x0, x1: fp.x1, y0, y1, z0: fp.z0, z1: fp.z1 });

  // ghế xoay kiểu my-office (src/scene/moBlocks.js); màu ghế mặc định xám xanh như bản gốc
  const chairMats = new Map(); // deskId -> vật liệu đệm ghế (màu trống / màu áo người đang ngồi)
  function chair(x, z, facing, yb, color = null, deskId = null) {
    const g = local(x, yb, z, facing);
    if (deskId) { const m = new THREE.MeshStandardMaterial({ color: CHAIR_IDLE, roughness: 0.9 }); m.userData.chair = deskId; chairMats.set(deskId, m); officeChair(g, m); }
    else officeChair(g, color ? '#' + color.color.getHexString() : CHAIR_IDLE);
    return g;
  }

  // ---------- thảm pastel dưới mỗi cụm bàn (kiểu phòng ban của my-office) ----------
  {
    const RUGS = ['#9DBBD8', '#BBA5D2', '#A6CDB0', '#D8BE8C', '#E5AA80']; // (đậm hơn bản gốc: đèn văn phòng ở đây sáng hơn)
    const ds = model.desks.filter(d => d.kind !== 'reception'), seen = new Set(); let ci = 0;
    for (const d0 of ds) {
      if (seen.has(d0)) continue;
      const cl = [d0]; seen.add(d0);
      for (let k = 0; k < cl.length; k++) for (const d of ds) if (!seen.has(d) && d.floor === cl[k].floor && Math.hypot(d.x - cl[k].x, d.z - cl[k].z) < 1.25) { seen.add(d); cl.push(d); }
      const pad = 0.45;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const d of cl) for (const p of [[d.x, d.z], [d.seat?.x ?? d.x, d.seat?.z ?? d.z]]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
      if ((__REAL_SYS__ && model.layout.world === 'sysone-real')) { // (mặt bằng thật: thảm không lấn qua tường — cắt theo phòng chứa cụm bàn)
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, rm = (model.layout.rooms || []).find(q => q.floor === d0.floor && q.type === 'office' && cx > q.x0 && cx < q.x1 && cz > q.z0 && cz < q.z1);
        if (rm) { x0 = Math.max(x0, rm.x0 + 0.08); x1 = Math.min(x1, rm.x1 - 0.08); z0 = Math.max(z0, rm.z0 + 0.08); z1 = Math.min(z1, rm.z1 - 0.08); }
      }
      const w = x1 - x0, h = z1 - z0, r = Math.min(0.3, w / 4, h / 4), sh = new THREE.Shape(), hw = w / 2, hh = h / 2;
      sh.moveTo(-hw + r, -hh); sh.lineTo(hw - r, -hh); sh.quadraticCurveTo(hw, -hh, hw, -hh + r); sh.lineTo(hw, hh - r); sh.quadraticCurveTo(hw, hh, hw - r, hh);
      sh.lineTo(-hw + r, hh); sh.quadraticCurveTo(-hw, hh, -hw, hh - r); sh.lineTo(-hw, -hh + r); sh.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
      const rug = new THREE.Mesh(new THREE.ShapeGeometry(sh, 6), mc(new THREE.Color(RUGS[ci++ % RUGS.length]).getHex()));
      rug.rotation.x = -Math.PI / 2; rug.position.set((x0 + x1) / 2, fy(d0.floor) + 0.018, (z0 + z1) / 2); rug.receiveShadow = true; root.add(rug);
    }
  }

  // ---------- bàn làm việc ----------
  for (const d of model.desks) {
    const yb = fy(d.floor), w = d.w || 1.0, dd = d.d || 0.6;
    if (d.kind === 'reception') {
      const g = local(d.x, yb, d.z, d.facing);
      const front = mc(0x7b4f33), topc = mc(0xe9e4d8);
      lb(g, -w / 2, w / 2, 0, 1.05, -dd / 2, -dd / 2 + 0.25, front);           // mặt quầy cao phía khách
      lb(g, -w / 2 - 0.05, w / 2 + 0.05, 1.05, 1.1, -dd / 2 - 0.05, -dd / 2 + 0.3, topc);
      lb(g, -w / 2, w / 2, 0.72, 0.76, -dd / 2 + 0.25, dd / 2, topc);         // mặt làm việc
      lb(g, -w / 2, -w / 2 + 0.05, 0, 0.72, -dd / 2 + 0.25, dd / 2, front); lb(g, w / 2 - 0.05, w / 2, 0, 0.72, -dd / 2 + 0.25, dd / 2, front);
      // màn hình, bàn phím... của quầy dựng ở lớp bàn theo dụng cụ (rebuildDesks)
      colFoot(footprint(d.x, d.z, w * fs, dd * fs, d.facing), yb, yb + 1.1 * fs);
      chair(d.seat.x, d.seat.z, d.facing, yb, null, d.id);
      deskGroups.set(d.id, g);
      continue;
    }
    // mặt bàn và dụng cụ dựng ở lớp riêng (rebuildDesks) theo cấu hình từng chỗ; ở đây chỉ còn ghế và khối va chạm
    colFoot(footprint(d.x, d.z, w * fs, dd * fs, d.facing), yb + 0.0, yb + 0.76 * fs);
    chair(d.seat.x, d.seat.z, d.facing, yb, null, d.id);
  }

  // ---------- bàn họp / pantry ----------
  for (const t of model.tables) {
    const yb = fy(t.floor), h = t.h || 0.75, col = mc(new THREE.Color(t.color || '#d8c3a0').getHex());
    const g = piv(t.x, yb, t.z);
    SB(g, t.x - t.w / 2, t.x + t.w / 2, yb + h - 0.04, yb + h, t.z - t.d / 2, t.z + t.d / 2, col);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(q => { const lx = t.x + q[0] * (t.w / 2 - 0.1), lz = t.z + q[1] * (t.d / 2 - 0.1); B(lx - 0.03, lx + 0.03, yb, yb + h - 0.04, lz - 0.03, lz + 0.03, dk, g); });
    for (const s of t.seats) chair(s.x, s.z, s.facing, yb, t.type === 'meeting' ? mc(0x2b2f36) : mc(0x8a5a3a));
  }

  // ---------- đồ đạc ----------
  for (const it of model.layout.items || []) {
    const yb = fy(it.floor), fac = it.facing || 0;
    const color = c => mc(new THREE.Color(c).getHex());
    const g0 = piv(it.x, yb, it.z); // nhóm thu nhỏ quanh tâm món đồ (toạ độ bên trong là toạ độ thật)
    switch (it.type) {
      case 'sofa': {
        const g = local(it.x, yb, it.z, fac), w = it.w || 2, d = it.d || 0.9, c = color(it.color || '#4a5a72');
        lb(g, -w / 2, w / 2, 0, 0.45, -d / 2, d / 2, c); lb(g, -w / 2, w / 2, 0.45, 0.9, d / 2 - 0.2, d / 2, c);
        lb(g, -w / 2, -w / 2 + 0.15, 0.45, 0.68, -d / 2, d / 2 - 0.2, c); lb(g, w / 2 - 0.15, w / 2, 0.45, 0.68, -d / 2, d / 2 - 0.2, c);
        colFoot(footprint(it.x, it.z, w * fs, d * fs, fac), yb, yb + 0.9 * fs); break;
      }
      case 'lowtable': {
        const w = it.w || 1, d = it.d || 0.5, h = it.h || 0.42;
        SB(g0, it.x - w / 2, it.x + w / 2, yb + h - 0.04, yb + h, it.z - d / 2, it.z + d / 2, color(it.color || '#cdb89a'));
        B(it.x - w / 2 + 0.05, it.x + w / 2 - 0.05, yb, yb + h - 0.04, it.z - 0.03, it.z + 0.03, dk, g0); break;
      }
      case 'rug': B(it.x - it.w / 2, it.x + it.w / 2, yb, yb + 0.014, it.z - it.d / 2, it.z + it.d / 2, color(it.color || '#9aa7b8'), g0); break;
      case 'plant': {
        // chậu cây thật (model): xen kẽ Monstera và lưỡi hổ, xoay ngẫu nhiên theo vị trí cho đỡ giống nhau
        const kind = it.kind || (Math.abs(Math.round(it.x * 7 + it.z * 13)) % 2 ? 'sansevieria' : 'monstera');
        const p = plant(kind, it.h || (kind === 'monstera' ? 1.05 : 0.95), (it.x * 7.3 + it.z * 3.1) % (Math.PI * 2));
        p.position.set(it.x, yb, it.z); g0.add(p);
        colScaled(it.x, yb, it.z, { x0: it.x - 0.2, x1: it.x + 0.2, y0: yb, y1: yb + 1.0, z0: it.z - 0.2, z1: it.z + 0.2 }); break;
      }
      case 'counter': {
        const w = it.w || 0.6, d = it.d || 3, h = it.h || 0.9;
        SB(g0, it.x - w / 2, it.x + w / 2, yb, yb + h, it.z - d / 2, it.z + d / 2, color(it.color || '#8a6a48'));
        B(it.x - w / 2 - 0.05, it.x + w / 2, yb + h, yb + h + 0.05, it.z - d / 2 - 0.05, it.z + d / 2 + 0.05, color(it.top || '#30343a'), g0);
        // máy pha cà phê, ấm, cốc
        B(it.x - 0.12, it.x + 0.12, yb + h + 0.05, yb + h + 0.42, it.z - 0.9, it.z - 0.6, mc(0x2a2a2a), g0);
        B(it.x - 0.1, it.x + 0.1, yb + h + 0.05, yb + h + 0.3, it.z + 0.5, it.z + 0.7, mc(0xc8ccd0), g0);
        for (let k = 0; k < 4; k++) B(it.x - 0.04, it.x + 0.04, yb + h + 0.05, yb + h + 0.14, it.z + 0.95 + k * 0.12, it.z + 1.03 + k * 0.12, mc(0xf4f4f4), g0);
        B(it.x - w / 2, it.x + w / 2, yb + 1.5, yb + 2.2, it.z - d / 2, it.z + d / 2, color(it.color || '#8a6a48'), g0); // tủ treo
        break;
      }
      case 'fridge': SB(g0, it.x - (it.w || 0.6) / 2, it.x + (it.w || 0.6) / 2, yb, yb + (it.h || 1.8), it.z - (it.d || 0.7) / 2, it.z + (it.d || 0.7) / 2, color(it.color || '#dfe3e6')); break;
      case 'toilet': {
        const g = local(it.x, yb, it.z, fac), w = mc(0xf4f4f4);
        lb(g, -0.18, 0.18, 0, 0.4, -0.25, 0.2, w); lb(g, -0.2, 0.2, 0.4, 0.85, 0.15, 0.32, w);
        colFoot(footprint(it.x, it.z, 0.4 * fs, 0.65 * fs, fac), yb, yb + 0.85 * fs); break;
      }
      case 'sink': {
        const g = local(it.x, yb, it.z, fac), w = it.w || 0.5, d = it.d || 0.4;
        lb(g, -w / 2, w / 2, 0.75, 0.85, -d / 2, d / 2, mc(0xe8e8e8)); lb(g, -0.04, 0.04, 0, 0.75, 0, 0.08, mc(0xd0d0d0));
        lb(g, -w / 2, w / 2, 1.0, 1.6, d / 2 - 0.02, d / 2, mc(0xbfd3df)); // gương
        colFoot(footprint(it.x, it.z, w * fs, d * fs, fac), yb, yb + 0.85 * fs); break;
      }
      case 'shelf': {
        const w = it.w || 0.4, d = it.d || 1.6, h = it.h || 2.0, fp = footprint(it.x, it.z, w, d, fac);
        SB(g0, fp.x0, fp.x1, yb, yb + h, fp.z0, fp.z1, mc(0x8a6a48));
        const r = rng(Math.floor(Math.abs(it.x * 70 + it.z * 30)) + 11), cols = [0xc4452f, 0x3a6aa8, 0x4f8f4a, 0xd8a62e, 0xeeeeee, 0x6b4aa5];
        const g = local(it.x, yb, it.z, fac);
        for (let k = 0; k < 4; k++) { const y = 0.25 + k * (h - 0.4) / 4; for (let x = -w / 2 + 0.05; x < w / 2 - 0.1; x += 0.12) lb(g, x, x + 0.08, y, y + 0.25 + r() * 0.08, -d / 2 - 0.015, -d / 2, mc(cols[Math.floor(r() * 6)])); }
        break;
      }
      case 'printer': {
        const w = it.w || 0.6, d = it.d || 0.5, h = it.h || 0.9;
        SB(g0, it.x - w / 2, it.x + w / 2, yb, yb + h, it.z - d / 2, it.z + d / 2, color(it.color || '#d9dcdf'));
        B(it.x - w / 2 + 0.05, it.x + w / 2 - 0.05, yb + h, yb + h + 0.03, it.z - d / 2 + 0.05, it.z + d / 2 - 0.05, mc(0x3a3d42), g0); break;
      }
      case 'tv': {
        // TV treo tường: giữ cao độ treo thật, chỉ thu nhỏ khung
        const g = local(it.x, yb, it.z, fac), w = it.w || 2, h = it.h || 0.9, y = (it.y ?? 1.0) / fs;
        lb(g, -w / 2, w / 2, y, y + h, 0.0, 0.04, mon);
        const p = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.08, h - 0.08), new THREE.MeshBasicMaterial({ color: 0x2c4468 }));
        p.position.set(0, y + h / 2, -0.005); p.rotation.y = Math.PI; g.add(p); break;
      }
      case 'cabinet': SB(g0, it.x - (it.w || 0.5) / 2, it.x + (it.w || 0.5) / 2, yb, yb + (it.h || 1.2), it.z - (it.d || 0.5) / 2, it.z + (it.d || 0.5) / 2, color(it.color || '#c9c2b3')); break;
      default: console.warn('Không biết loại đồ đạc', it.type);
    }
  }

  // ---------- tường trong ----------
  const frameM = mc(0x2e2019);
  // vách kính kiểu my-office (world/pro/pieces.js glassWall): kính trong ánh xanh, dải kính mờ ngang tầm mắt (1,02–1,28 m),
  // khung kim loại đen ở chân, đỉnh và các thanh đứng cách nhau ~1,25 m
  const partitionGlass = new THREE.MeshStandardMaterial({ color: '#BFD8EE', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, depthWrite: false });
  const frostM = new THREE.MeshStandardMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.55, roughness: 0.6, depthWrite: false });
  const metalM = new THREE.MeshStandardMaterial({ color: '#2B2F36', roughness: 0.35, metalness: 0.65 });
  partitionGlass.userData.noShadow = frostM.userData.noShadow = true;
  for (const w of model.wallBoxes) {
    const yb = fy(w.floor), yt = model.floorById.get(w.floor).ceiling;
    const y0 = w.lintel ? yb + w.yb : yb;
    if (w.material === 'glass') {
      const alongX = (w.x1 - w.x0) >= (w.z1 - w.z0), a0 = alongX ? w.x0 : w.z0, a1 = alongX ? w.x1 : w.z1;
      const c = alongX ? (w.z0 + w.z1) / 2 : (w.x0 + w.x1) / 2;
      const span = (s0, s1, ya, yz, t, m) => alongX ? B(s0, s1, ya, yz, c - t, c + t, m) : B(c - t, c + t, ya, yz, s0, s1, m);
      span(a0, a1, y0, yt, 0.015, partitionGlass).castShadow = false;
      if (!w.lintel) { span(a0, a1, y0 + 1.02, y0 + 1.28, 0.018, frostM).castShadow = false; COL.push({ x0: w.x0, x1: w.x1, y0, y1: yt, z0: w.z0, z1: w.z1 }); }
      span(a0, a1, y0, y0 + 0.08, 0.04, metalM); span(a0, a1, yt - 0.06, yt, 0.04, metalM);
      const n = Math.max(1, Math.round((a1 - a0) / 1.25));
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; span(Math.max(a0, a - 0.025), Math.min(a1, a + 0.025), y0, yt, 0.035, metalM); }
    } else {
      w.lintel ? B(w.x0, w.x1, y0, yt, w.z0, w.z1, M.plaster) : S(w.x0, w.x1, y0, yt, w.z0, w.z1, M.plaster);
    }
  }
  // khung cửa trong nhà
  for (const d of model.doors) {
    if (d.id === 'gate' || d.id === 'door0') continue;
    const yb = fy(d.floor), thinZ = (d.z1 - d.z0) <= (d.x1 - d.x0), h = 2.1;
    if (thinZ) { const zc = (d.z0 + d.z1) / 2; B(d.x0 - 0.04, d.x0 + 0.02, yb, yb + h, zc - 0.08, zc + 0.08, frameM); B(d.x1 - 0.02, d.x1 + 0.04, yb, yb + h, zc - 0.08, zc + 0.08, frameM); B(d.x0 - 0.04, d.x1 + 0.04, yb + h - 0.06, yb + h, zc - 0.08, zc + 0.08, frameM); }
    else { const xc = (d.x0 + d.x1) / 2; B(xc - 0.08, xc + 0.08, yb, yb + h, d.z0 - 0.04, d.z0 + 0.02, frameM); B(xc - 0.08, xc + 0.08, yb, yb + h, d.z1 - 0.02, d.z1 + 0.04, frameM); }
  }

  // ---------- lan can quanh ô cầu thang ----------
  for (const r of model.rails) {
    const y = fy(r.floor), alongX = (r.x1 - r.x0) >= (r.z1 - r.z0);
    if (alongX) ctx.railX(r.x0, r.x1, y, (r.z0 + r.z1) / 2, root); else ctx.railZ((r.x0 + r.x1) / 2, y, r.z0, r.z1, root);
    COL.push({ x0: r.x0, x1: r.x1, y0: y, y1: y + 1.05, z0: r.z0, z1: r.z1 });
  }

  // ---------- đèn trần ----------
  for (const l of model.layout.lamps || []) {
    const yc = model.floorById.get(l.floor).ceiling - CEIL_DROP; // gắn vào trần thả
    B(l.x - 0.31, l.x + 0.31, yc - 0.03, yc, l.z - 0.31, l.z + 0.31, mc(0xd8dade));
    B(l.x - 0.29, l.x + 0.29, yc - 0.035, yc - 0.03, l.z - 0.29, l.z + 0.29, M.lampPanel);
  }

  // ---------- lớp bàn làm việc dựng theo dụng cụ ----------
  const deskLayer = new THREE.Group(); deskLayer.name = 'desks'; deskLayer.userData.noMerge = true; deskLayer.userData.keep = true; root.add(deskLayer);
  const atlas = new NameplateAtlas();
  const api = { screens, deskGroups, deskLayer, chairMats, version: 0 };
  /**
   * Dựng lại toàn bộ bàn thường. equipFor(desk) -> { equipment, nameplate }.
   * Gộp theo vật liệu để số draw call không tăng theo số bàn; màn hình mỗi bàn gộp thành 1 mesh để bật/tắt.
   */
  api.rebuildDesks = (equipFor, { receiveShadow = true } = {}) => {
    for (const c of [...deskLayer.children]) { deskLayer.remove(c); c.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
    atlas.reset();
    const staticG = new THREE.Group();
    for (const d of model.desks) {
      const { equipment, nameplate } = equipFor(d) || {};
      const scr = [];
      const recep = d.kind === 'reception'; // quầy lễ tân: dụng cụ đặt trên mặt làm việc phía sau tấm quầy cao
      staticG.add(buildDesk(ctx, d, fy(d.floor), equipment, { nameplate, atlas, screensOut: scr, fs, surfaceOnly: recep, depth: recep ? (d.d || 0.6) - 0.25 : undefined, zOffset: recep ? 0.125 : 0 }));
      staticG.updateMatrixWorld(true);
      if (scr.length) {
        const geos = scr.map(s => { const g = s.geometry.clone(); g.applyMatrix4(s.matrixWorld); return g; });
        for (const s of scr) s.parent.remove(s);
        const m = new THREE.Mesh(mergeGeometries(geos, false), M.screenOff);
        m.userData.deskId = d.id; m.matrixAutoUpdate = false;
        deskLayer.add(m); screens.set(d.id, m);
      } else screens.delete(d.id);
    }
    atlas.commit();
    mergeStatic(staticG);
    staticG.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = receiveShadow; } });
    deskLayer.add(staticG);
    api.version++;
  };
  return api;
}
