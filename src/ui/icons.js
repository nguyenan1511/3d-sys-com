// Bộ biểu tượng nét mảnh (line icon) tự vẽ, lưới 24×24, nét tròn đầu. Mỗi biểu tượng là danh sách đường path (SVG),
// dùng cho nút HTML (icon()) và vẽ trên canvas 2D (drawIcon(), qua Path2D) — cùng một nét ở mọi nơi.
const C = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const R = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

export const ICONS = {
  user: [C(12, 8, 4), 'M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7'],
  tag: ['M3 12.5V4a1 1 0 0 1 1-1h8.5l8.8 8.8a1 1 0 0 1 0 1.4l-7.6 7.6a1 1 0 0 1-1.4 0z', C(8, 8, 1.6)],
  logout: ['M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4', 'M9 8l-4 4 4 4', 'M5 12h11'],
  map: ['M3 6.5l6-3 6 3 6-3v14l-6 3-6-3-6 3z', 'M9 3.5v14', 'M15 6.5v14'],
  cube: ['M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z', 'M3.5 7.3L12 12l8.5-4.7', 'M12 12v9.5'],
  keyboard: [R(2, 6, 20, 12, 2.5), 'M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10'],
  wave: ['M7.5 12.5V6.8a1.4 1.4 0 0 1 2.8 0V11', 'M10.3 10.5V5a1.4 1.4 0 0 1 2.8 0v5.5', 'M13.1 10.5V6.3a1.4 1.4 0 0 1 2.8 0V14a7 7 0 0 1-7 7h-.4a6 6 0 0 1-5.2-3l-1.6-2.9a1.4 1.4 0 0 1 2.3-1.6l1.8 2', 'M18.5 3.5c1.2.7 2 1.8 2.3 3.2'],
  smoke: [R(2.5, 14, 15, 4, 1), 'M17.5 14v4', 'M20.5 14v4', 'M16 10c0-1.5 2-1.5 2-3s-2-1.5-2-3', 'M19.5 10c0-1.5 2-1.5 2-3s-2-1.5-2-3'],
  coffee: ['M4 9h12v5.5A5.5 5.5 0 0 1 10.5 20h-1A5.5 5.5 0 0 1 4 14.5z', 'M16 11h1.5a2.5 2.5 0 0 1 0 5H16', 'M8 2.5v3M12 2.5v3'],
  phone: [R(7, 2.5, 10, 19, 2.2), 'M11 18h2'],
  music: ['M9 18V5.5l11-2V16', C(6, 18, 3), C(17, 16, 3)],
  target: [C(12, 12, 8), C(12, 12, 3), 'M12 2v3M12 19v3M2 12h3M19 12h3'],
  clipboard: [R(5, 4, 14, 17, 2), 'M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1', 'M9 10h6M9 14h6M9 18h3'],
  key: [C(8, 15.5, 4), 'M11 12.5L20 3.5', 'M17 6.5l2.5 2.5', 'M14.5 9l2 2'],
  arrowUp: ['M12 19V5', 'M6 11l6-6 6 6'],
  close: ['M6 6l12 12M18 6L6 18'],
  nosmoke: [C(12, 12, 9.5), 'M5.3 5.3l13.4 13.4', 'M6 13.5h8.5v2.5H6z', 'M16.5 13.5V16', 'M14 9c0-1 1.3-1 1.3-2'],
  shuffle: ['M3 7h4l10 10h4', 'M3 17h4l10-10h4', 'M18 4l3 3-3 3', 'M18 14l3 3-3 3'],
  reset: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4v4h4'],
  chat: ['M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z', 'M8 8.5h8M8 11.5h5'],
  send: ['M4 12l16-8-6 16-2.5-6.5z', 'M11.5 13.5L20 4'],
  play: ['M7 4.5v15l12.5-7.5z'],
  chevLeft: ['M15 6l-6 6 6 6'],
  chevUp: ['M6 15l6-6 6 6'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  chevDown: ['M6 9l6 6 6-6'],
  pause: ['M8 5v14', 'M16 5v14'],
  stop: [R(6, 6, 12, 12, 1.5)],
  volume: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9a4.5 4.5 0 0 1 0 6', 'M18 6.5a8 8 0 0 1 0 11'],
  mute: ['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M16 9.5l5 5M21 9.5l-5 5']
};

/** Biểu tượng nét dạng SVG (kế thừa màu chữ). */
export function icon(name, size = 16, cls = '') {
  const d = ICONS[name] || [];
  return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d.map(p => `<path d="${p}"/>`).join('')}</svg>`;
}

const p2d = new Map();
/** Vẽ biểu tượng lên canvas: (x, y) là tâm, size là cạnh (px). */
export function drawIcon(ctx, name, x, y, size, color = '#2b2d42', width = 2) {
  let paths = p2d.get(name);
  if (!paths) { paths = (ICONS[name] || []).map(d => new Path2D(d)); p2d.set(name, paths); }
  ctx.save(); ctx.translate(x - size / 2, y - size / 2); ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.lineWidth = width * 24 / size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const p of paths) ctx.stroke(p);
  ctx.restore();
}
