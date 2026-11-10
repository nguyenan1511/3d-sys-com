// Bi-a lỗ 8 bi cho 2 người — phần dùng chung giữa trình duyệt và server: kích thước bàn, xếp bi, vật lý (theo
// people/billiards.js của my-office, MIT: bước 1/240 s, ma sát lăn, va bi đàn hồi, băng nảy, 6 lỗ) và luật chơi.
// Toạ độ trong khung của bàn (gốc ở tâm bàn): x ngang (±PX), z dọc (±PZ), mét. Chỉ dùng phép tính cơ bản (sqrt, không
// hypot) để mọi máy chạy ra cùng kết quả.
export const PX = 0.47, PZ = 0.93, BALL_R = 0.025, N = 16;
export const POCKETS = [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]].map(([sx, sz]) => ({ x: sx * (PX + (sz ? 0.012 : 0.03)), z: sz * (PZ + 0.012), r: sz ? 0.056 : 0.05 }));
const H = 1 / 240, DECEL = 0.55, CUSHION_E = 0.74, BALL_E = 0.94, VMAX = 3.3, D2 = (2 * BALL_R) ** 2;

export const groupOf = n => n >= 1 && n <= 7 ? 'solid' : n >= 9 && n <= 15 ? 'stripe' : null;
export const GROUP_NAME = { solid: 'bi trơn (1–7)', stripe: 'bi sọc (9–15)' };

/** Xếp bi đầu trận: bi chủ ở 1/4 bàn, 15 bi thành tam giác ở 3/4 bàn (bi 8 giữa hàng 3). rnd: hàm ngẫu nhiên (0..1). */
export function rack(rnd = Math.random) {
  const rest = [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  const order = [1, ...rest.slice(0, 3), 8, ...rest.slice(3)], d = BALL_R * 2 + 0.0008, balls = [];
  balls[0] = { x: 0, z: -PZ / 2, on: 1 };
  let k = 0;
  for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) { const n = order[k++]; balls[n] = { x: (i - row / 2) * d, z: PZ / 2 + row * d * 0.866, on: 1 }; }
  return balls;
}

/**
 * Mô phỏng một cú đánh. balls: [{x,z,on}] (on 1 = trên bàn, 0 = đã vào lỗ). shot: { ax, az (hướng), power (0..1) }.
 * Trả về một "bộ chạy" — step(dt) tiến thời gian thật, trả về true khi bi đã dừng hết; kèm kết quả: potted (bi vào lỗ
 * theo thứ tự), first (bi đầu tiên bi chủ chạm, -1 nếu không chạm), cushions (số lần chạm băng sau khi chạm bi).
 */
export function simulate(balls, shot) {
  const bx = new Float64Array(N), bz = new Float64Array(N), vx = new Float64Array(N), vz = new Float64Array(N), on = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const b = balls[i]; bx[i] = b.x; bz[i] = b.z; on[i] = b.on ? 1 : 0; }
  const L = Math.sqrt(shot.ax * shot.ax + shot.az * shot.az) || 1, sp = Math.max(0.05, Math.min(1, shot.power)) * VMAX;
  vx[0] = shot.ax / L * sp; vz[0] = shot.az / L * sp;
  const res = { potted: [], first: -1, cushions: 0, bumps: 0 };
  let acc = 0, t = 0, done = false;
  const tick = () => {
    for (let i = 0; i < N; i++) {
      if (!on[i] || !(vx[i] || vz[i])) continue;
      bx[i] += vx[i] * H; bz[i] += vz[i] * H;
      const s = Math.sqrt(vx[i] * vx[i] + vz[i] * vz[i]), s2 = s - DECEL * H;
      if (s2 <= 0.006) vx[i] = vz[i] = 0; else { vx[i] *= s2 / s; vz[i] *= s2 / s; }
    }
    for (let i = 0; i < N; i++) {
      if (!on[i]) continue;
      for (let j = i + 1; j < N; j++) {
        if (!on[j]) continue;
        const dx = bx[j] - bx[i], dz = bz[j] - bz[i], d2 = dx * dx + dz * dz;
        if (d2 >= D2 || d2 < 1e-12) continue;
        const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, over = (2 * BALL_R - d) / 2;
        bx[i] -= nx * over; bz[i] -= nz * over; bx[j] += nx * over; bz[j] += nz * over;
        const rel = (vx[i] - vx[j]) * nx + (vz[i] - vz[j]) * nz;
        if (rel <= 0) continue;
        const imp = (rel * (1 + BALL_E)) / 2;
        vx[i] -= imp * nx; vz[i] -= imp * nz; vx[j] += imp * nx; vz[j] += imp * nz;
        if (res.first < 0 && (i === 0 || j === 0)) res.first = i || j;
        if (rel > 0.05) res.bumps++;
      }
    }
    for (let i = 0; i < N; i++) {
      if (!on[i]) continue;
      let pot = false;
      for (const P of POCKETS) { const dx = bx[i] - P.x, dz = bz[i] - P.z; if (dx * dx + dz * dz < P.r * P.r) { pot = true; break; } }
      if (pot) { on[i] = 0; vx[i] = vz[i] = 0; res.potted.push(i); continue; }
      const ax = Math.abs(bx[i]), az = Math.abs(bz[i]);
      const limX = az > PZ - 0.075 || az < 0.052 ? PX + 0.02 : PX - BALL_R, limZ = ax > PX - 0.075 ? PZ + 0.02 : PZ - BALL_R;
      if (ax > limX) { const s = Math.sign(bx[i]); bx[i] = s * limX; if (vx[i] * s > 0) { vx[i] = -vx[i] * CUSHION_E; vz[i] *= 0.92; if (res.first >= 0) res.cushions++; } }
      if (az > limZ) { const s = Math.sign(bz[i]); bz[i] = s * limZ; if (vz[i] * s > 0) { vz[i] = -vz[i] * CUSHION_E; vx[i] *= 0.92; if (res.first >= 0) res.cushions++; } }
    }
    t += H;
    for (let i = 0; i < N; i++) if (on[i] && (vx[i] || vz[i])) return false;
    return true;
  };
  return {
    res,
    /** Tiến dt giây (thời gian thật). true khi đã dừng (hoặc quá 20 s). */
    step(dt) { if (done) return true; acc += dt; while (acc >= H && !done) { acc -= H; done = tick() || t > 20; } return done; },
    /** Chạy tới khi dừng (server / máy chậm). */
    finish() { while (!done) done = tick() || t > 20; res.time = t; return res; },
    balls() { const out = []; for (let i = 0; i < N; i++) out.push({ x: bx[i], z: bz[i], on: on[i] }); return out; }
  };
}

/** Chỗ đặt lại bi chủ (sau khi bi chủ vào lỗ): điểm đầu bàn, dịch dần tới khi không đè bi khác. */
export function respotCue(balls) {
  for (let k = 0; k < 40; k++) {
    const x = (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.06, z = -PZ / 2;
    if (balls.every((b, i) => i === 0 || !b.on || (b.x - x) ** 2 + (b.z - z) ** 2 > D2 * 1.2)) return { x, z, on: 1 };
  }
  return { x: 0, z: -PZ * 0.75, on: 1 };
}

/**
 * Luật lỗ 8 bi (giản lược) sau một cú đánh. g: { players: [a, b], turn: 0|1, groups: { key: 'solid'|'stripe' }, balls,
 * winner }; before: bi trước cú đánh; r: kết quả mô phỏng. Trả về { turn, groups, balls, winner, foul, msg }.
 */
export function applyRules(g, before, after, r) {
  const me = g.players[g.turn], other = g.players[1 - g.turn], groups = { ...g.groups };
  const left = (bs, grp) => bs.filter((b, n) => b.on && groupOf(n) === grp).length;
  const mine = groups[me];
  const pots = r.potted.filter(n => n !== 0), cueIn = r.potted.includes(0);
  const cleared = mine && left(before, mine) === 0;
  let foul = cueIn || r.first < 0 || (mine && r.first !== -1 && !(cleared ? r.first === 8 : groupOf(r.first) === mine)) || (!mine && r.first === 8);
  // không bi nào vào lỗ và không bi nào chạm băng sau cú chạm đầu: phạm lỗi (đánh nhẹ cho có)
  if (!foul && !pots.length && r.cushions === 0) foul = true;
  const balls = after.map(b => ({ ...b }));
  if (cueIn) balls[0] = respotCue(balls);
  let winner = null, msg = '';
  if (pots.includes(8)) {
    winner = !foul && cleared ? me : other;
    msg = winner === me ? 'đưa bi 8 vào lỗ — thắng!' : 'bi 8 vào lỗ sai lúc — thua.';
    return { turn: g.turn, groups, balls, winner, foul, msg };
  }
  // chia nhóm: bi hợp lệ đầu tiên vào lỗ quyết định nhóm của người đánh
  if (!mine && !foul) { const f = pots.find(n => groupOf(n)); if (f) { groups[me] = groupOf(f); groups[other] = groupOf(f) === 'solid' ? 'stripe' : 'solid'; } }
  const myGroup = groups[me];
  const scored = pots.some(n => !myGroup || groupOf(n) === myGroup);
  const keep = !foul && scored;
  msg = foul ? (cueIn ? 'bi chủ vào lỗ — phạm lỗi.' : r.first < 0 ? 'không chạm bi nào — phạm lỗi.' : 'chạm sai bi — phạm lỗi.') : keep ? 'vào bi, đánh tiếp.' : 'không vào, đổi lượt.';
  return { turn: keep ? g.turn : 1 - g.turn, groups, balls, winner, foul, msg };
}
