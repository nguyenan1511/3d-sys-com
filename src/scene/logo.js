// Biển công ty trên tường rào bên trái cổng: logo chữ nổi (từ SVG đã dò viền) + dòng tên + dòng địa chỉ.
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

// Vùng biển: phần tường lộ ra giữa trụ trái (x<-3.1) và trụ cổng (x>-0.35); mặt tường ở z=9.25.
export const SIGN = { x0: -3.0, x1: -0.51, z: 9.25, logoCy: 1.2, logoW: 2.3, topCy: 1.68, topH: 0.13, addrCy: 0.8, addrH: 0.075 };

async function fetchText(url) {
  try { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) return null; const t = await r.text(); return t.includes('<svg') ? t : null; } catch { return null; }
}

/**
 * Đùn các path của SVG thành chữ nổi. Mặt trước đúng màu fill, cạnh bên màu sideColor.
 * Trả về Group có gốc ở tâm khung, đơn vị mét, mặt sau ở z=0.
 */
export function extrudeSvg(svgText, { width, height, depth = 0.05, sideColor = 0xf5f5f2, curveSegments = 4, faceTexture = null }) {
  const data = new SVGLoader().parse(svgText);
  const g = new THREE.Group();
  const box = new THREE.Box2();
  const items = [];
  for (const p of data.paths) {
    const fill = p.userData.style.fill;
    if (!fill || fill === 'none') continue;
    // toShapes: lỗ được nhận theo chiều vẽ ngược (đường dò viền và font đều theo quy ước này)
    const shapes = p.toShapes(true);
    for (const s of shapes) for (const v of s.getPoints(2)) box.expandByPoint(v);
    items.push({ color: p.color, shapes });
  }
  if (!items.length) return null;
  const sz = box.getSize(new THREE.Vector2());
  const k = width ? width / sz.x : height / sz.y;
  const side = new THREE.MeshLambertMaterial({ color: sideColor });
  // mặt trước dán ảnh gốc: UV của mặt chữ là toạ độ SVG (px) -> chuẩn hóa theo kích thước ảnh, lật trục y
  let faceMat = null;
  if (faceTexture) {
    const vb = (svgText.match(/viewBox="([^"]+)"/) || [])[1]?.split(/\s+/).map(Number) || [0, 0, faceTexture.image.width, faceTexture.image.height];
    const t = faceTexture.clone(); t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(1 / vb[2], -1 / vb[3]); t.offset.set(-vb[0] / vb[2], 1 + vb[1] / vb[3]);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    faceMat = new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35, alphaTest: 0.5, transparent: false });
  }
  for (const it of items) {
    const geo = new THREE.ExtrudeGeometry(it.shapes, { depth: depth / k, bevelEnabled: false, curveSegments });
    const front = faceMat || new THREE.MeshLambertMaterial({ color: it.color.clone() });
    const m = new THREE.Mesh(geo, [front, side]);
    g.add(m);
  }
  // SVG: y hướng xuống -> lật y, đưa tâm về gốc
  g.scale.set(k, -k, k);
  g.position.set(-(box.min.x + sz.x / 2) * k, (box.min.y + sz.y / 2) * k, 0);
  const wrap = new THREE.Group(); wrap.add(g);
  wrap.userData.size = { w: sz.x * k, h: sz.y * k };
  return wrap;
}

/** Logo tạm (khối hộp như bản demo) khi chưa có logo-traced.svg. */
function fallbackLogo(ctx) {
  const { B } = ctx;
  const logo = new THREE.Group();
  const NAVY = new THREE.MeshLambertMaterial({ color: 0x1b2a8c }), ORG = new THREE.MeshLambertMaterial({ color: 0xf3a21f }), WH = new THREE.MeshLambertMaterial({ color: 0xf3f3f1 });
  const NM = NAVY, OM = ORG; void WH; // một vật liệu mỗi hộp để gộp được mesh
  const U = 0.4, D = 0.05, tk = 0.27;
  const lr = (ox, x0, x1, y0, y1, mats) => { const m = new THREE.Mesh(new THREE.BoxGeometry((x1 - x0) * U, (y1 - y0) * U, D), mats); m.position.set((ox + (x0 + x1) / 2) * U, ((y0 + y1) / 2) * U, D / 2); logo.add(m); };
  const ld = (ox, x0, y0, x1, y1, th, mats) => { const dx = (x1 - x0) * U, dy = (y1 - y0) * U, len = Math.hypot(dx, dy); const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.02, th * U, D), mats); m.position.set((ox + (x0 + x1) / 2) * U, ((y0 + y1) / 2) * U, D / 2); m.rotation.z = Math.atan2(dy, dx); logo.add(m); };
  const letS = ox => { const w = 0.66; lr(ox, 0, w, 1 - tk, 1, NM); lr(ox, 0, tk, 0.5 - tk / 2, 1, NM); lr(ox, 0, w, 0.5 - tk / 2, 0.5 + tk / 2, NM); lr(ox, w - tk, w, 0, 0.5 + tk / 2, NM); lr(ox, 0, w, 0, tk, NM); };
  const letY = ox => { const w = 0.86; lr(ox, w / 2 - tk / 2, w / 2 + tk / 2, 0, 0.55, NM); ld(ox, 0.12, 0.92, w / 2, 0.5, 0.28, NM); ld(ox, w - 0.12, 0.92, w / 2, 0.5, 0.28, NM); };
  const letO = ox => { const w = 0.78; lr(ox, 0, tk, tk + 0.05, 1, NM); lr(ox, 0, w, 1 - tk, 1, NM); lr(ox, w - tk, w, 0, 1 - tk - 0.05, OM); lr(ox, tk + 0.05, w, 0, tk, OM); };
  const letN = ox => { const w = 0.86; lr(ox, 0, tk, 0, 1, NM); lr(ox, w - tk, w, 0, 1, NM); ld(ox, tk / 2, 0.9, w - tk / 2, 0.1, 0.3, NM); };
  const letE = ox => { const w = 0.78; lr(ox, 0, tk, 0, 1, NM); lr(ox, 0, w, 1 - tk, 1, NM); lr(ox, 0, w * 0.88, 0.5 - tk / 2, 0.5 + tk / 2, NM); lr(ox, 0, w, 0, tk, NM); };
  letS(0); letY(0.86); letS(1.92); letO(2.78); letN(3.76); letE(4.82);
  const totalW = 5.6 * U, h = U;
  logo.children.forEach(m => { m.position.x -= totalW / 2; m.position.y -= h / 2; });
  void B;
  const wrap = new THREE.Group(); wrap.add(logo); wrap.userData.size = { w: totalW, h }; wrap.userData.fallback = true;
  return wrap;
}

function canvasLine(text, w, h, color) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = Math.round(2048 * h / w);
  const g = c.getContext('2d'); let sz = c.height * 0.8;
  do { g.font = `bold ${sz}px Arial, sans-serif`; sz -= 2; } while (g.measureText(text).width > c.width * 0.98 && sz > 10);
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
}

export async function buildSign(ctx, base = './') {
  const g = new THREE.Group(); g.name = 'sign';
  ctx.house.add(g);
  const cx = (SIGN.x0 + SIGN.x1) / 2;
  const info = { logo: 'fallback', text: 'canvas' };
  const logoSvg = await fetchText(`${base}logo/logo-traced.svg`);
  // ảnh gốc của logo (giữ nguyên từng điểm ảnh) dán lên mặt chữ nổi; hình khối lấy từ bản dò viền
  const faceTexture = await new Promise(res => new THREE.TextureLoader().load(`${base}logo/sysone-logo.png`, res, undefined, () => res(null)));
  let logo = logoSvg && extrudeSvg(logoSvg, { width: SIGN.logoW, depth: 0.05, faceTexture });
  if (logo) info.face = faceTexture ? 'png-gốc' : 'màu-vector';
  if (logo) info.logo = 'svg'; else logo = fallbackLogo(ctx);
  logo.position.set(cx, SIGN.logoCy, SIGN.z + 0.002);
  g.add(logo);
  const textSvg = await fetchText(`${base}logo/sign-text.svg`);
  if (textSvg) {
    // sign-text.svg có hai nhóm id="top" và id="addr"
    const parts = splitGroups(textSvg);
    const top = parts.top && extrudeSvg(parts.top, { height: SIGN.topH, depth: 0.02 });
    const addr = parts.addr && extrudeSvg(parts.addr, { height: SIGN.addrH, depth: 0.015 });
    const maxW = SIGN.x1 - SIGN.x0 - 0.12;
    for (const [m, cy] of [[top, SIGN.topCy], [addr, SIGN.addrCy]]) {
      if (!m) continue;
      if (m.userData.size.w > maxW) { const s = maxW / m.userData.size.w; m.scale.set(s, s, 1); }
      m.position.set(cx, cy, SIGN.z + 0.002); g.add(m);
    }
    if (top && addr) info.text = 'svg';
  }
  if (info.text !== 'svg') {
    const tp = canvasLine('CÔNG TY CỔ PHẦN CÔNG NGHỆ', 2.3, 0.2, '#1b2a8c'); tp.position.set(cx, SIGN.topCy, SIGN.z + 0.006); g.add(tp);
    const ap = canvasLine('ĐC: 33 DƯƠNG QUANG ĐÔNG, P. CHÁNH HƯNG, TP.HCM', 2.3, 0.11, '#1b2a8c'); ap.position.set(cx, SIGN.addrCy, SIGN.z + 0.006); g.add(ap);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return info;
}

function splitGroups(svg) {
  const head = (svg.match(/<svg[^>]*>/) || ['<svg xmlns="http://www.w3.org/2000/svg">'])[0];
  const out = {};
  for (const id of ['top', 'addr']) {
    const m = svg.match(new RegExp(`<g[^>]*id="${id}"[^>]*>([\\s\\S]*?)</g>`));
    if (m) out[id] = `${head}${m[1]}</svg>`;
  }
  return out;
}
