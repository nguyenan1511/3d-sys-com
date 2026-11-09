import { moSprite, moSpec } from './moSprite.js';
// Nhân vật pixel 2D (kiểu văn phòng pixel: đầu to, mắt chấm, viền mực) vẽ hoàn toàn bằng code từ một mô tả nhỏ
// { hair, hairStyle, skin, shirt, pants, shoes, dress, hat }. 3 hướng (front/back/side; side quay phải, lật để quay trái)
// × 3 khung (0 đứng, 1–2 bước chân). Mỗi sprite là một canvas nhỏ (16×20 + viền) được lưu đệm; vẽ ra thì phóng to
// bằng số nguyên với imageSmoothingEnabled = false để giữ nét pixel.

// Ký hiệu: H tóc, h tóc tối, S da, s da tối, E mắt, C áo, c áo tối, P quần/váy, F giày, K mũ, k vành mũ, . trống
const FRONT = [
  '....HHHHHHHH....',
  '...HHHHHHHHHH...',
  '..HHHHHHHHHHHH..',
  '..HHSSSSSSSSHH..',
  '..HSSSSSSSSSSH..',
  '..SSSESSSSESSS..',
  '..SSSESSSSESSS..',
  '..SSSSSSSSSSSS..',
  '...SSSSSSSSSS...',
  '....ssSSSSss....',
  '....CCCCCCCC....',
  '...CCCCCCCCCC...',
  '...SCCCCCCCCS...',
  '...ScCCCCCCcS...',
  '....PPPPPPPP....',
  '....PPP..PPP....',
  '....PPP..PPP....',
  '....FFF..FFF....'
];
const BACK = [
  '....HHHHHHHH....',
  '...HHHHHHHHHH...',
  '..HHHHHHHHHHHH..',
  '..HHHHHHHHHHHH..',
  '..HHHHHHHHHHHH..',
  '..HHHHHHHHHHHH..',
  '..HhHHHHHHHHhH..',
  '..hHHHHHHHHHHh..',
  '...hHHHHHHHHh...',
  '....ssSSSSss....',
  '....CCCCCCCC....',
  '...CCCCCCCCCC...',
  '...SCCCCCCCCS...',
  '...ScCCCCCCcS...',
  '....PPPPPPPP....',
  '....PPP..PPP....',
  '....PPP..PPP....',
  '....FFF..FFF....'
];
const SIDE = [
  '....HHHHHHH.....',
  '...HHHHHHHHH....',
  '..HHHHHHHHHHH...',
  '..HHHHHSSSSSH...',
  '..HHHHSSSSSSS...',
  '..HHHSSSSSSES...',
  '..HHHSSSSSSES...',
  '..HHSSSSSSSSS...',
  '...HSSSSSSSSS...',
  '....sSSSSSs.....',
  '.....CCCCCC.....',
  '.....CCCCCC.....',
  '.....CCSSCC.....',
  '.....cCSScC.....',
  '.....PPPPPP.....',
  '.....PP..PP.....',
  '.....PP..PP.....',
  '....FFF..FFF....'
];
const TEMPLATES = { front: FRONT, back: BACK, side: SIDE };

const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v * k))));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
};
const INK = '#2b2d42';

/** Bản đồ điểm ảnh (mảng chuỗi) theo hướng, khung bước và kiểu tóc/trang phục. */
function grid(spec, dir, frame) {
  const g = TEMPLATES[dir].map(r => r.split(''));
  const put = (y, x, ch) => { if (g[y] && x >= 0 && x < 16) g[y][x] = ch; };
  // bước chân: khung 1 nhấc chân trái, khung 2 nhấc chân phải (chân nhấc lên một điểm, giày theo)
  if (frame) {
    const [lx, rx] = dir === 'side' ? [[5, 6], [9, 10]] : [[4, 5, 6], [9, 10, 11]];
    const up = frame === 1 ? lx : rx, dn = frame === 1 ? rx : lx;
    for (const x of up) { put(16, x, g[17][x] === 'F' || g[16][x] !== '.' ? 'F' : g[16][x]); put(17, x, '.'); }
    for (const x of dn) if (g[17][x] === '.' && g[16][x] !== '.') put(17, x, 'F');
    // tay đánh theo bước (mặt trước/sau): tay bên chân nhấc lên dịch xuống một điểm
    if (dir !== 'side') { const arm = frame === 1 ? 12 : 3; put(14, arm, 'S'); put(12, arm, 'C'); }
  }
  // kiểu áo: sơ mi (cổ trắng + hàng cúc), áo khoác (mở giữa, lộ áo trong)
  if (spec.style === 'shirt') {
    if (dir === 'front') { put(10, 6, 'W'); put(10, 9, 'W'); for (const y of [11, 12, 13]) put(y, 7, y % 2 ? 'c' : 'C'); }
    if (dir === 'side') put(10, 9, 'W');
    if (dir === 'back') { for (let x = 5; x <= 10; x++) put(10, x, 'W'); }
  }
  if (spec.style === 'polo') { // cổ bẻ + nẹp ngắn 1 cúc
    if (dir === 'front') { put(10, 6, 'W'); put(10, 9, 'W'); put(11, 7, 'c'); }
    if (dir === 'side') put(10, 9, 'W');
    if (dir === 'back') { for (let x = 6; x <= 9; x++) put(10, x, 'W'); }
  }
  if (spec.style === 'jacket') {
    if (dir === 'front') for (const y of [10, 11, 12, 13]) { put(y, 7, 'I'); put(y, 8, 'I'); }
    if (dir === 'side') for (const y of [10, 11]) put(y, 10, 'I');
  }
  // dấu logo SYSONE trên ngực trái (2 điểm ảnh xanh + cam — màu nhận diện của logo)
  if (dir === 'front') { put(11, 9, 'B'); put(11, 10, 'O'); }
  if (dir === 'side') put(11, 9, 'B');
  if (spec.dress === undefined && spec.style === 'dress') spec = { ...spec, dress: true };
  // váy: thân dưới thành váy xoè, chân để trần
  if (spec.dress) {
    const wide = dir === 'side' ? [5, 10] : [3, 12];
    for (let x = wide[0]; x <= wide[1]; x++) put(14, x, 'P');
    for (let x = wide[0] + 1; x < wide[1]; x++) if (g[15][x] === 'P') put(15, x, 'S');
    for (let x = 0; x < 16; x++) if (g[16][x] === 'P') put(16, x, 'S');
  }
  // kiểu tóc
  const st = spec.hairStyle || 'short';
  if (st === 'long' && dir !== 'side') for (let y = 5; y <= 12; y++) { put(y, 1, 'H'); put(y, 14, 'H'); if (y < 9) { put(y, 2, 'H'); put(y, 13, 'H'); } }
  if (st === 'long' && dir === 'side') for (let y = 5; y <= 12; y++) { put(y, 2, 'H'); put(y, 3, 'H'); }
  if (st === 'bun') { for (const x of [6, 7, 8, 9]) put(-1, x, 'H'); g.unshift('......hHHh......'.split('')); g.unshift('.......HH.......'.split('')); }
  if (st === 'spiky') { g.unshift('...H..H..H..H...'.split('')); }
  if (st === 'buns') { g.unshift('..HH........HH..'.split('')); g.unshift('..hH........Hh..'.split('')); }
  // mũ lưỡi trai / mũ bảo hộ: phủ 3 hàng trên cùng, vành chìa ra phía trước
  if (spec.hat) {
    const off = g.length - TEMPLATES[dir].length;
    for (let y = off; y < off + 3; y++) for (let x = 0; x < 16; x++) if (g[y][x] === 'H') g[y][x] = 'K';
    const brim = off + 3;
    if (dir === 'front') for (let x = 2; x < 14; x++) put(brim, x, 'k');
    if (dir === 'side') for (let x = 6; x < 15; x++) put(brim, x, 'k');
  }
  return g;
}

const cache = new Map();
/** Sprite đã tô màu và có viền (canvas 18 × (cao + 2)). dir: front | back | side; frame 0..2. */
export function sprite(spec, dir = 'front', frame = 0) {
  if (spec.mo) return moSprite(spec.cfg ? spec : moSpec(spec.def), dir, frame); // nhân vật my-office (cùng bộ với 3D)
  const key = JSON.stringify(spec) + dir + frame;
  if (cache.has(key)) return cache.get(key);
  const g = grid(spec, dir, frame), h = g.length, w = 16;
  const pal = {
    H: spec.hair, h: shade(spec.hair, 0.72), S: spec.skin, s: shade(spec.skin, 0.85), E: INK,
    C: spec.shirt, c: shade(spec.shirt, 0.78), W: '#f4f4f2', I: spec.inner || '#e6e2da', B: '#1d4fa3', O: '#f08a24', P: spec.pants, F: spec.shoes, K: spec.hat || spec.hair, k: shade(spec.hat || spec.hair, 0.75)
  };
  const cv = document.createElement('canvas'); cv.width = w + 2; cv.height = h + 2;
  const ctx = cv.getContext('2d');
  const filled = (y, x) => y >= 0 && y < h && x >= 0 && x < w && g[y][x] !== '.';
  // viền mực: mọi ô trống kề một ô có màu
  ctx.fillStyle = INK;
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    if (filled(y, x)) continue;
    if (filled(y - 1, x) || filled(y + 1, x) || filled(y, x - 1) || filled(y, x + 1)) ctx.fillRect(x + 1, y + 1, 1, 1);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const ch = g[y][x]; if (ch !== '.') { ctx.fillStyle = pal[ch] || '#f0f'; ctx.fillRect(x + 1, y + 1, 1, 1); } }
  cache.set(key, cv);
  return cv;
}

/**
 * Vẽ nhân vật lên ctx: (x, y) là điểm giữa hai bàn chân, scale là số lần phóng to (số nguyên).
 * facing: 'down' | 'up' | 'left' | 'right'. Có bóng elip dưới chân.
 */
export function drawCharacter(ctx, spec, x, y, scale, facing = 'down', frame = 0) {
  const dir = facing === 'down' ? 'front' : facing === 'up' ? 'back' : 'side';
  const sp = sprite(spec, dir, frame);
  if (!sp) return; // (nhân vật my-office đang được nướng sprite — vài khung hình nữa sẽ có)
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = 'rgba(43,45,66,.22)';
  ctx.beginPath(); ctx.ellipse(x, y, 6 * scale, 2 * scale, 0, 0, Math.PI * 2); ctx.fill();
  const w = sp.width * scale, h = sp.height * scale, bob = frame ? -scale : 0;
  if (facing === 'left') { ctx.translate(x, 0); ctx.scale(-1, 1); ctx.drawImage(sp, -w / 2, y - h + scale + bob, w, h); }
  else ctx.drawImage(sp, x - w / 2, y - h + scale + bob, w, h);
  ctx.restore();
}
