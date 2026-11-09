// Chuyển hai dòng chữ của biển (assets/sign-text.json) thành đường vector bằng font Be Vietnam Pro (OFL),
// ghi public/logo/sign-text.svg với hai nhóm id="top" và id="addr" để dựng chữ nổi bằng ExtrudeGeometry.
import fs from 'fs';
import path from 'path';
import opentype from 'opentype.js';

const root = path.resolve(import.meta.dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'assets/sign-text.json'), 'utf8'));
const w = cfg.weight || 700;
const dir = path.join(root, 'node_modules/@fontsource/be-vietnam-pro/files');
const load = sub => opentype.parse(fs.readFileSync(path.join(dir, `be-vietnam-pro-${sub}-${w}-normal.woff`)).buffer.slice(0));
const fonts = ['latin', 'vietnamese', 'latin-ext'].map(s => { try { return load(s); } catch { return null; } }).filter(Boolean);
const glyphFor = ch => { for (const f of fonts) { const g = f.charToGlyph(ch); if (g && g.index > 0) return { f, g }; } return null; };

// xuất path với dấu cách tường minh (SVGLoader đọc kiểu số dính nhau không ổn định)
const n = v => (Math.round(v * 100) / 100).toString();
function pathData(p) {
  return p.commands.map(c => {
    switch (c.type) {
      case 'M': return `M ${n(c.x)} ${n(c.y)} `;
      case 'L': return `L ${n(c.x)} ${n(c.y)} `;
      case 'Q': return `Q ${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)} `;
      case 'C': return `C ${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)} `;
      default: return 'Z ';
    }
  }).join('');
}

function line(text, size) {
  let x = 0, d = '';
  const missing = [];
  const chars = [...text.normalize('NFC')];
  chars.forEach((ch, i) => {
    const r = glyphFor(ch);
    if (!r) { missing.push(ch); x += size * 0.3; return; }
    d += pathData(r.g.getPath(x, 0, size));
    let adv = r.g.advanceWidth * size / r.f.unitsPerEm;
    const nx = chars[i + 1] && glyphFor(chars[i + 1]);
    if (nx && nx.f === r.f) adv += r.f.getKerningValue(r.g, nx.g) * size / r.f.unitsPerEm;
    x += adv + (cfg.letterSpacing || 0) * size;
  });
  if (missing.length) console.warn('Font thiếu ký tự:', missing.join(''));
  return { d, width: x };
}
const top = line(cfg.top, 100), addr = line(cfg.addr, 100);
const out = path.join(root, 'public/logo/sign-text.svg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -100 ${Math.ceil(Math.max(top.width, addr.width))} 260">
<g id="top"><path fill="${cfg.color}" d="${top.d}"/></g>
<g id="addr"><path fill="${cfg.color}" d="${addr.d}"/></g>
</svg>
`);
console.log(`Đã ghi ${path.relative(root, out)} (font Be Vietnam Pro ${w}).`);
