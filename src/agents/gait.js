// Dáng đi / chạy theo quỹ đạo bàn chân (không phụ thuộc three.js, kiểm thử được).
// Nguyên tắc: khi chân chạm đất, bàn chân lùi về sau đúng bằng tốc độ thân → không trượt chân.
// Nhịp bước tính từ quãng đường thật đã đi (cả người chơi, người khác và NPC), độ dài sải theo tốc độ
// (công thức Alexander: sải/chân ≈ 2.3·Fr^0.3, Fr = v²/(g·L)), tỉ lệ chạm đất giảm dần khi chuyển sang chạy.
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = x => x * x * (3 - 2 * x);

/** Độ dài một chu kỳ bước (hai bước, mét) theo tốc độ v và chiều dài chân Lw (mét). */
/** Mức chạy 0..1 theo số Froude (đi bộ < 0.6, chạy > 1.6). */
export const runAmount = (v, Lw) => clamp(((v * v) / (9.8 * Math.max(1e-3, Lw)) - 0.6) / 1.0, 0, 1);
/** Tỉ lệ thời gian một chân chạm đất trong chu kỳ: đi ~0.62, chạy ~0.35. */
export const stanceFrac = run => 0.62 - 0.27 * run;
/** Độ dài một chu kỳ bước (hai bước, mét) theo tốc độ v và chiều dài chân Lw (mét).
 *  Giới hạn để bàn chân trụ không quá ±0.5 chiều dài chân (~30° ở hông): chân ngắn thì bước nhanh hơn chứ không dạng quá rộng. */
export function cycleLength(v, Lw) {
  const fr = (v * v) / (9.8 * Math.max(1e-3, Lw));
  const alexander = Lw * clamp(2.3 * Math.pow(Math.max(fr, 0.05), 0.3), 1.1, 3.6);
  return Math.min(alexander, Lw * 1.0 / stanceFrac(runAmount(v, Lw)));
}

/**
 * Cập nhật trạng thái chuyển động của một nhân vật (gọi mỗi khung hình, nhiều lần trong cùng khung hình cũng an toàn).
 * Trả về a._g = { ph, v, acc, turn } — pha bước, tốc độ (m/s), gia tốc dọc hướng nhìn, tốc độ quay (rad/s).
 */
export function gaitMotion(a, unit, leg, now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000) {
  let g = a._g;
  if (!g) g = a._g = { t: now, x: a.x, z: a.z, yaw: a.yaw || 0, ph: (a.idx || 0) * 1.3, v: 0, acc: 0, turn: 0, dirF: 1, dirL: 0 };
  const dt = Math.min(0.1, now - g.t);
  if (dt < 1e-4) return g;
  let dx = a.x - g.x, dz = a.z - g.z;
  if (Math.hypot(dx, dz) > 1.0) dx = dz = 0; // dịch chuyển tức thời (ngồi vào ghế, đổi tầng): không tính là bước
  const yaw = a.yaw || 0, fwd = -(Math.sin(yaw) * dx + Math.cos(yaw) * dz); // nhân vật nhìn về (-sin yaw, -cos yaw)
  const v = Math.hypot(dx, dz) / dt, vPrev = g.v;
  g.v += (v - g.v) * Math.min(1, dt * 12);
  g.acc += ((g.v - vPrev) / dt - g.acc) * Math.min(1, dt * 6);
  g.turn += (wrap(yaw - g.yaw) / dt - g.turn) * Math.min(1, dt * 8);
  const Lw = (leg.L1 + leg.L2) * unit;
  // hướng di chuyển trong hệ toạ độ thân (tiến, ngang phải): bước chân đặt theo hướng thật sự đang đi,
  // nên trôi ngang theo quán tính hay đi lùi đều là bước đúng hướng, chân trụ không bị kéo lê
  const disp = Math.hypot(dx, dz), lat = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
  let d = disp;
  if (disp > 1e-6) {
    const k = Math.min(1, dt * 14);
    g.dirF += (fwd / disp - g.dirF) * k; g.dirL += (lat / disp - g.dirL) * k;
    const n = Math.hypot(g.dirF, g.dirL) || 1; g.dirF /= n; g.dirL /= n;
  }
  // không có dịch chuyển (xem trước trong trình tạo nhân vật) nhưng đang ở trạng thái đi: tự tạo nhịp
  if (disp < 1e-6 && (a.walkAmt || 0) > 0.1) { d = dt * a.walkAmt * Lw * 4; g.dirF = 1; g.dirL = 0; g.v += (a.walkAmt * Lw * 4 - g.v) * Math.min(1, dt * 12); }
  g.ph = (g.ph + TAU * d / cycleLength(Math.max(g.v, 0.05), Lw)) % TAU;
  g.dt = dt;
  // vừa dừng mà chân còn dang: bước thêm một nhịp để đưa chân về (thay vì kéo lê chân trên sàn)
  if (g.settle && Math.abs(d) < 0.3 * dt * Lw) g.ph = (g.ph + TAU * 2.2 * dt) % TAU;
  g.t = now; g.x = a.x; g.z = a.z; g.yaw = yaw;
  return g;
}

/** Quỹ đạo bàn chân i (0 trái, 1 phải): tiến/lùi so với hông và độ nhấc, theo mét. */
export function footPath(ph, i, S, lift, beta) {
  const u = (((ph + i * Math.PI) % TAU) + TAU) % TAU / TAU;
  if (u < beta) { const s = u / beta; return { f: S / 2 - S * s, h: 0, stance: true, s }; }
  const s = (u - beta) / (1 - beta), e = smooth(s);
  return { f: -S / 2 + S * e, h: lift * Math.pow(Math.sin(Math.PI * s), 1.4), stance: false, s };
}

/** IK hai khớp: góc đùi (dương = ra trước) và gối (dương = gập) để cổ chân tới điểm (f tiến, dy xuống dưới hông). */
export function legIK(f, dy, L1, L2) {
  const dist = clamp(Math.hypot(f, dy), Math.abs(L1 - L2) + 1e-4, (L1 + L2) * 0.9995);
  const knee = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1));
  const hip = Math.atan2(f, dy) + Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
  return { hip, knee };
}

/** Góc chân + độ cao hông (đơn vị khung xương) cho trạng thái g. amt: 0..1 (ngồi thì 0). */
export function gaitLegs(g, unit, leg, amt = 1) {
  const L1 = leg.L1, L2 = leg.L2, Lw = (L1 + L2) * unit;
  const w = clamp(g.v / (Lw * 1.2), 0, 1) * amt, run = runAmount(g.v, Lw) * w;
  const C = cycleLength(Math.max(g.v, 0.05), Lw) / unit;          // đơn vị khung xương
  const beta = stanceFrac(runAmount(g.v, Lw));                    // tỉ lệ thời gian chân chạm đất (khớp với cycleLength)
  const S = beta * C * w, lift = (L1 + L2) * (0.12 + 0.14 * run) * w;
  // bàn chân trụ được ghim tại một điểm trên sàn (toạ độ thế giới) từ lúc tiếp đất tới lúc nhấc lên: thân đi tới, rẽ hay
  // trượt ngang thì chân vẫn đứng yên, hông tự dạng/khép chân. Chân đang bước vung từ điểm nhấc tới điểm đặt kế tiếp.
  const reach = 0.85 * (L1 + L2);
  // hông xoay theo bước chân (tính theo pha lý tưởng); khớp háng vì thế tiến/lùi một chút, bù vào đích IK để chân trụ đứng yên
  const ideal0 = footPath(g.ph, 0, 1, 0, beta).f, ideal1 = footPath(g.ph, 1, 1, 0, beta).f;
  const pelvisYaw = -(0.11 + 0.05 * run) * w * (ideal0 - ideal1);
  const hipShift = [-(leg.hipX || 0) * Math.sin(pelvisYaw), (leg.hipX || 0) * Math.sin(pelvisYaw)];
  const legs = g.legs || (g.legs = [0, 1].map(() => ({ st: true, wx: null, wz: null, cur: 0, lat: 0 })));
  const sideX = [-(leg.hipX || 0), leg.hipX || 0];
  const yaw = g.yaw || 0, Fx = -Math.sin(yaw), Fz = -Math.cos(yaw), Rx = Math.cos(yaw), Rz = -Math.sin(yaw);
  const toWorld = (f, l) => [g.x + (Fx * f + Rx * l) * unit, g.z + (Fz * f + Rz * l) * unit];
  const toBody = (wx, wz) => { const dx = (wx - g.x) / unit, dz = (wz - g.z) / unit; return [Fx * dx + Fz * dz, Rx * dx + Rz * dz]; };
  const feet = [0, 1].map(i => {
    const ft = footPath(g.ph, i, S, lift, beta), L = legs[i];
    if (ft.stance) {
      if (!L.st || L.wx === null) { L.st = true; [L.wx, L.wz] = toWorld(L.cur, sideX[i] + L.lat); }
      const [f0, l0] = toBody(L.wx, L.wz);
      const f = clamp(f0, -reach, reach), l = clamp(l0 - sideX[i], -0.5 * reach, 0.5 * reach);
      if (f !== f0 || l !== l0 - sideX[i]) [L.wx, L.wz] = toWorld(f, sideX[i] + l); // quá tầm với: đành trượt theo
      ft.f = f; ft.l = l;
    } else {
      if (L.st) { L.st = false; L.flo = L.cur; L.llo = L.lat; }
      const e = smooth(ft.s), tF = S / 2 * (g.dirF ?? 1), tL = S / 2 * (g.dirL ?? 0);
      ft.f = clamp(L.flo + (tF - L.flo) * e, -reach, reach); ft.l = clamp(L.llo + (tL - L.llo) * e, -0.5 * reach, 0.5 * reach);
    }
    L.cur = ft.f; L.lat = ft.l;
    return ft;
  });
  // còn chân dang xa khi gần như đứng yên (vừa dừng, vừa xoay tại chỗ): cho phép bước nốt (xem gaitMotion)
  const off = Math.max(...legs.map(L => Math.max(Math.abs(L.cur), Math.abs(L.lat))));
  g.settle = w < 0.35 && amt > 0.5 && off > 0.03 * (L1 + L2);
  if (w < 0.02 && !g.settle) for (const L of legs) { L.cur *= 0.8; L.lat *= 0.8; L.wx = null; } // sai số nhỏ còn lại
  // hông: hạ nhẹ khi đi (gối mềm), không cao hơn tầm với của chân trụ (tự sinh nhịp nhún lên xuống)
  let hipY = leg.hip * (1 - 0.012 * w - 0.05 * run);
  for (const ft of feet) {
    if (!ft.stance) continue;
    hipY = Math.min(hipY, leg.ankle + Math.sqrt(Math.max(0, (0.985 * (L1 + L2)) ** 2 - ft.f * ft.f)));
    hipY -= run * 0.06 * (L1 + L2) * Math.sin(Math.PI * ft.s);  // chạy: nhún khi tiếp đất
  }
  const hip = [0, 0], knee = [0, 0], ff = [0, 0], roll = [0, 0];
  feet.forEach((ft, i) => {
    const dy = hipY - (leg.ankle + ft.h);
    roll[i] = Math.atan2(ft.l, dy);                              // dạng/khép chân để tới điểm lệch ngang
    const r = legIK(ft.f - hipShift[i], Math.hypot(dy, ft.l), L1, L2);
    hip[i] = r.hip; knee[i] = r.knee + 0.04; ff[i] = S > 1e-6 ? clamp(ft.f / (S / 2), -1, 1) : 0;
  });
  return { hip, knee, hipY, ff, w, run, feet, S, C, pelvisYaw, roll };
}
