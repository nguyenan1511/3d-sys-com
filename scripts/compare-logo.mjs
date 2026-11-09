// So ảnh logo gốc (PNG) với bản vector đã dò (SVG): tỉ lệ trùng khớp (IoU) theo từng màu + ảnh khác biệt.
// Dùng: node scripts/compare-logo.mjs [assets/logo.png] [public/logo/logo-traced.svg] [--out=shots/logo-compare.png]
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const pos = process.argv.slice(2).filter(a => !a.startsWith('--'));
const pngPath = path.resolve(pos[0] || path.join(root, 'assets/logo.png'));
const svgPath = path.resolve(pos[1] || path.join(root, 'public/logo/logo-traced.svg'));
const out = path.resolve(process.argv.find(a => a.startsWith('--out='))?.slice(6) || path.join(root, 'shots/logo-compare.png'));
const png64 = fs.readFileSync(pngPath).toString('base64');
const svg = fs.readFileSync(svgPath, 'utf8');
const colors = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map(m => m[1]);

const browser = await chromium.launch();
const page = await browser.newPage();
const res = await page.evaluate(async ({ png64, svg, colors }) => {
  const load = src => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = src; });
  const a = await load('data:image/png;base64,' + png64);
  const b = await load('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))));
  const W = a.naturalWidth, H = a.naturalHeight;
  const grab = img => { const c = new OffscreenCanvas(W, H), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(img, 0, 0, W, H); return g.getImageData(0, 0, W, H).data; };
  const A = grab(a), B = grab(b);
  const C = colors.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
  const cls = (d, i) => { let best = -1, bd = 90 * 90 * 3; for (let k = 0; k < C.length; k++) { const e = (d[i] - C[k][0]) ** 2 + (d[i + 1] - C[k][1]) ** 2 + (d[i + 2] - C[k][2]) ** 2; if (e < bd) { bd = e; best = k; } } return best; };
  const inter = C.map(() => 0), uni = C.map(() => 0);
  const diff = new OffscreenCanvas(W, H * 3), dg = diff.getContext('2d');
  dg.drawImage(a, 0, 0, W, H); dg.fillStyle = '#fff'; dg.fillRect(0, H, W, H); dg.drawImage(b, 0, H, W, H);
  const D = dg.createImageData(W, H);
  for (let i = 0; i < W * H * 4; i += 4) {
    const ka = cls(A, i), kb = cls(B, i);
    for (let k = 0; k < C.length; k++) { const ia = ka === k, ib = kb === k; if (ia && ib) inter[k]++; if (ia || ib) uni[k]++; }
    const bad = ka !== kb;
    D.data[i] = bad ? 230 : 245; D.data[i + 1] = bad ? 40 : 245; D.data[i + 2] = bad ? 40 : 245; D.data[i + 3] = 255;
  }
  dg.putImageData(D, 0, H * 2);
  const blob = await diff.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { W, H, iou: C.map((_, k) => inter[k] / Math.max(1, uni[k])), png: btoa(s) };
}, { png64, svg, colors });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(res.png, 'base64'));
console.log(`Ảnh ${res.W}x${res.H}. Trùng khớp theo màu:`, colors.map((c, k) => `${c} ${(res.iou[k] * 100).toFixed(2)}%`).join(', '));
console.log('Ảnh so sánh (gốc / vector / chỗ lệch màu đỏ):', path.relative(root, out));
await browser.close();
