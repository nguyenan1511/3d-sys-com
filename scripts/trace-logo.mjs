// Trích ảnh PNG base64 trong logo.svg, dò viền thành vector theo từng màu (marching squares có nội suy),
// xuất public/logo/logo-traced.svg để SVGLoader + ExtrudeGeometry dựng chữ nổi.
//
// Dùng: npm run logo -- [đường dẫn logo.svg] [--colors=#1b2a8c,#f3a21f] [--eps=0.35]
// Mặc định đọc assets/logo.svg. Ảnh PNG trích ra được lưu ở assets/logo.png.
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = k => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const src = args.find(a => !a.startsWith('--')) || path.join(root, 'assets/logo.svg');
const EPS = +(opt('eps') || 0.35);       // sai số đơn giản hóa đường viền (px)
const MIN_AREA = +(opt('minArea') || 6); // bỏ đốm nhỏ hơn (px²)
const outSvg = opt('out') ? path.resolve(opt('out')) : path.join(root, 'public/logo/logo-traced.svg');
const pngOut = opt('png') ? path.resolve(opt('png')) : path.join(root, 'assets/logo.png');

// ---------- 1. đọc PNG ----------
let png;
if (src.endsWith('.png')) png = PNG.sync.read(fs.readFileSync(src));
else {
  const svg = fs.readFileSync(src, 'utf8');
  const m = svg.match(/(?:xlink:)?href\s*=\s*["']data:image\/png;base64,([^"']+)["']/);
  if (!m) { console.error(`Không thấy ảnh PNG base64 trong ${src}`); process.exit(1); }
  const buf = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  fs.mkdirSync(path.dirname(pngOut), { recursive: true });
  fs.writeFileSync(pngOut, buf);
  png = PNG.sync.read(buf);
}
const { width: W, height: H, data } = png;
console.log(`Ảnh ${W}x${H}`);

// ---------- 2. tìm màu ----------
const px = i => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3] / 255];
const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const parseHex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// nền: trong suốt hoặc màu ở 4 góc
const corners = [0, W - 1, (H - 1) * W, H * W - 1].map(px);
// nền trong suốt: nhiều điểm ảnh alpha ~0 (không chỉ dựa vào 4 góc, vì chữ có thể chạm mép ảnh)
let nTransparent = 0; for (let i = 0; i < W * H; i++) if (data[i * 4 + 3] < 26) nTransparent++;
const transparentBg = nTransparent > W * H * 0.2 || corners.every(c => c[3] < 0.1);
const bg = transparentBg ? [255, 255, 255] : corners.reduce((s, c) => s.map((v, k) => v + c[k] / 4), [0, 0, 0]);

let colors;
if (opt('colors')) colors = opt('colors').split(',').map(parseHex);
else {
  // k-means trên các điểm ảnh "đặc" (khác nền rõ rệt), k=2: navy và cam
  const pts = [];
  for (let i = 0; i < W * H; i += 3) { const p = px(i); if (p[3] > 0.9 && dist2(p, bg) > 120 * 120) pts.push(p); }
  const byLum = pts.slice().sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  let C = [byLum[Math.floor(byLum.length * 0.1)], pts.reduce((best, p) => (p[0] - p[2]) > (best[0] - best[2]) ? p : best, pts[0])].map(c => c.slice(0, 3));
  for (let it = 0; it < 12; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    for (const p of pts) { const k = dist2(p, C[0]) < dist2(p, C[1]) ? 0 : 1; acc[k][0] += p[0]; acc[k][1] += p[1]; acc[k][2] += p[2]; acc[k][3]++; }
    C = acc.map((a, k) => a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : C[k]);
  }
  // màu chính xác = màu xuất hiện nhiều nhất trong cụm (logo thường tô phẳng)
  colors = C.map(c => {
    const cnt = new Map();
    for (const p of pts) { if (dist2(p, c) > 60 * 60) continue; const k = (p[0] << 16) | (p[1] << 8) | p[2]; cnt.set(k, (cnt.get(k) || 0) + 1); }
    let best = null, bn = 0; for (const [k, n] of cnt) if (n > bn) { bn = n; best = k; }
    return best === null ? c : [best >> 16 & 255, best >> 8 & 255, best & 255];
  });
}
console.log('Nền', transparentBg ? 'trong suốt' : hex(bg), '· màu:', colors.map(hex).join(', '));

// ---------- 3. trường "độ thuộc" mềm cho từng màu ----------
// điểm biên khử răng cưa là pha trộn giữa nền và màu chữ: chiếu lên đoạn nền→màu để lấy tỉ lệ
function field(ci) {
  const f = new Float32Array((W + 2) * (H + 2)); // viền 1px = 0
  const c = colors[ci];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = px(y * W + x);
    let v;
    if (transparentBg) {
      const best = colors.reduce((b, cc, k) => dist2(p, cc) < dist2(p, colors[b]) ? k : b, 0);
      v = best === ci ? p[3] : 0;
    } else {
      // tỉ lệ t trên đoạn bg→c và độ lệch khỏi đoạn
      const d = c.map((v, k) => v - bg[k]), q = p.map((v, k) => v - bg[k]);
      const L2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
      const t = Math.max(0, Math.min(1, (q[0] * d[0] + q[1] * d[1] + q[2] * d[2]) / L2));
      const off = Math.sqrt((q[0] - t * d[0]) ** 2 + (q[1] - t * d[1]) ** 2 + (q[2] - t * d[2]) ** 2);
      // thuộc màu khác thì bỏ
      const other = colors.some((cc, k) => k !== ci && dist2(p, cc) < dist2(p, c));
      v = other && t > 0.3 ? 0 : (off < 70 ? t : 0);
    }
    f[(y + 1) * (W + 2) + (x + 1)] = v;
  }
  return f;
}

// ---------- 4. marching squares + nối thành đường kín ----------
function contours(f, iso = 0.5) {
  const w = W + 2, h = H + 2;
  const segs = new Map(); // khóa cạnh bắt đầu -> {a, b, kb}
  const key = (x, y, e) => `${x},${y},${e}`; // e: 0 cạnh trên (x..x+1, y), 1 cạnh trái (x, y..y+1)
  const pt = (x0, y0, x1, y1) => { const a = f[y0 * w + x0], b = f[y1 * w + x1], t = (iso - a) / (b - a); return [x0 + (x1 - x0) * t - 1 + 0.5, y0 + (y1 - y0) * t - 1 + 0.5]; };
  const E = (x, y, side) => {
    // side: 0 top,1 right,2 bottom,3 left -> khóa cạnh duy nhất + điểm
    if (side === 0) return [key(x, y, 0), pt(x, y, x + 1, y)];
    if (side === 2) return [key(x, y + 1, 0), pt(x, y + 1, x + 1, y + 1)];
    if (side === 3) return [key(x, y, 1), pt(x, y, x, y + 1)];
    return [key(x + 1, y, 1), pt(x + 1, y, x + 1, y + 1)];
  };
  // bảng: các cặp cạnh (từ -> tới), hướng sao cho vùng "trong" ở bên trái
  const T = { 1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[1, 0]], 5: [[3, 2], [1, 0]], 6: [[2, 0]], 7: [[3, 0]], 8: [[0, 3]], 9: [[0, 2]], 10: [[2, 1], [0, 3]], 11: [[0, 1]], 12: [[1, 3]], 13: [[1, 2]], 14: [[2, 3]] };
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const tl = f[y * w + x] >= iso, tr = f[y * w + x + 1] >= iso, br = f[(y + 1) * w + x + 1] >= iso, bl = f[(y + 1) * w + x] >= iso;
    let c = (bl ? 1 : 0) | (br ? 2 : 0) | (tr ? 4 : 0) | (tl ? 8 : 0);
    if (!T[c]) continue;
    let pairs = T[c];
    if (c === 5 || c === 10) { // điểm yên ngựa: dùng giá trị tâm
      const mid = (f[y * w + x] + f[y * w + x + 1] + f[(y + 1) * w + x] + f[(y + 1) * w + x + 1]) / 4 >= iso;
      if (c === 5 && mid) pairs = [[3, 0], [1, 2]]; else if (c === 10 && mid) pairs = [[0, 1], [2, 3]];
    }
    for (const [s0, s1] of pairs) { const [ka, a] = E(x, y, s0), [kb, b] = E(x, y, s1); segs.set(ka, { a, b, kb }); }
  }
  const loops = [];
  for (const [k0] of segs) {
    if (!segs.has(k0)) continue;
    const loop = []; let k = k0;
    while (segs.has(k)) { const s = segs.get(k); segs.delete(k); loop.push(s.a); k = s.kb; }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

const area = l => { let s = 0; for (let i = 0; i < l.length; i++) { const [x0, y0] = l[i], [x1, y1] = l[(i + 1) % l.length]; s += x0 * y1 - x1 * y0; } return s / 2; };
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const L = Math.hypot(bx - ax, by - ay) || 1e-9;
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L; if (d > dmax) { dmax = d; idx = i; } }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
function simplifyClosed(loop) {
  // tách tại điểm xa nhau nhất để RDP ổn định
  let far = 0, fd = 0; for (let i = 1; i < loop.length; i++) { const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = rdp(loop.slice(0, far + 1), EPS), b = rdp([...loop.slice(far), loop[0]], EPS);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

const layers = [];
let totalPts = 0;
colors.forEach((c, ci) => {
  const loops = contours(field(ci)).filter(l => Math.abs(area(l)) >= MIN_AREA).map(simplifyClosed).filter(l => l.length >= 3);
  totalPts += loops.reduce((s, l) => s + l.length, 0);
  const d = loops.map(l => 'M ' + l.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' L ') + ' Z').join(' ');
  layers.push({ color: hex(c), d, loops: loops.length });
});
fs.mkdirSync(path.dirname(outSvg), { recursive: true });
const svgOut = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n` +
  layers.map(l => `  <path fill="${l.color}" fill-rule="evenodd" d="${l.d}"/>`).join('\n') + '\n</svg>\n';
fs.writeFileSync(outSvg, svgOut);
console.log(`Đã ghi ${path.relative(root, outSvg)}: ${layers.map(l => `${l.color} ${l.loops} đường`).join(', ')}, ${totalPts} điểm.`);
console.log(`Kiểm tra độ khớp: node scripts/compare-logo.mjs ${src.endsWith('.png') ? src : pngOut} ${outSvg}`);
