// Tối ưu model nhân vật cho web: gộp đỉnh, giảm số tam giác (meshoptimizer), thu nhỏ + nén texture (WebP),
// bỏ khung xương/hoạt ảnh có sẵn (hệ thống tự dựng khung), nướng mọi phép biến đổi vào đỉnh, đặt gốc toạ độ
// ở giữa hai bàn chân (y = 0 tại đế). Không sửa file gốc.
// Nhận: .glb, .gltf, thư mục chứa scene.gltf, hoặc file .zip tải từ Sketchfab.
// Dùng: node scripts/optimize-model.mjs <nguồn> [--out=public/model/ten.opt.glb] [--tris=30000] [--tex=1024] [--rot=-90]
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, simplify, textureCompress, prune, flatten, join, clearNodeTransform, metalRough } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
let src = args.find(a => !a.startsWith('--'));
if (!src) { console.error('Cần đường dẫn model (.glb, .gltf, thư mục hoặc .zip)'); process.exit(1); }
const TRIS = +opt('tris', 30000), TEX = +opt('tex', 1024);

// .zip (Sketchfab) → giải nén vào thư mục tạm; thư mục → tìm file .gltf/.glb bên trong
const base = path.basename(src).replace(/\.(zip|glb|gltf)$/i, '').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
if (/\.zip$/i.test(src)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-'));
  execFileSync('unzip', ['-q', '-o', src, '-d', dir]);
  src = dir;
}
if (fs.statSync(src).isDirectory()) {
  const find = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { const r = find(p); if (r) return r; } else if (/\.(gltf|glb)$/i.test(f)) return p; } return null; };
  const f = find(src); if (!f) { console.error('Không thấy file .gltf/.glb trong', src); process.exit(1); }
  src = f;
}
const out = opt('out', path.join('public/model', `${base}.opt.glb`));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
const triCount = () => root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0), 0);
const before = triCount();

// mesh có khung xương sẵn: đỉnh đang ở "không gian bind"; tính lại vị trí đang hiển thị (tư thế nghỉ của khung)
// = Σ trọng số · (ma trận thế giới của khớp · ma trận bind nghịch đảo) · đỉnh, rồi mới bỏ khung xương
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const xf = (m, v, w) => [0, 1, 2].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w);
const baked = new Set();
for (const node of root.listNodes()) {
  const skin = node.getSkin(), mesh = node.getMesh(); if (!skin || !mesh) continue;
  const joints = skin.listJoints(), ibm = skin.getInverseBindMatrices(), JM = joints.map((j, i) => { const b = []; if (ibm) ibm.getElement(i, b); else b.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); return mul(j.getWorldMatrix(), b); });
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
    if (!J || !W || baked.has(pos)) continue; baked.add(pos);
    const v = [], n = [], j = [], w = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v); J.getElement(i, j); W.getElement(i, w); if (nor) nor.getElement(i, n);
      const P = [0, 0, 0], N = [0, 0, 0];
      for (let k = 0; k < 4; k++) { if (!w[k]) continue; const m = JM[j[k]], p = xf(m, v, 1); for (let c = 0; c < 3; c++) P[c] += w[k] * p[c]; if (nor) { const q = xf(m, n, 0); for (let c = 0; c < 3; c++) N[c] += w[k] * q[c]; } }
      pos.setElement(i, P);
      if (nor) { const l = Math.hypot(...N) || 1; nor.setElement(i, N.map(x => x / l)); }
    }
  }
  // đỉnh đã ở toạ độ thế giới: nút giữ mesh không còn phép biến đổi nào
  node.setSkin(null); node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const keep = node.getParentNode(); if (keep) { keep.removeChild(node); (root.getDefaultScene() || root.listScenes()[0]).addChild(node); }
}
// bỏ hoạt ảnh có sẵn
for (const a of root.listAnimations()) a.dispose();
for (const n of root.listNodes()) if (n.getSkin()) n.setSkin(null);
for (const s of root.listSkins()) s.dispose();
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
  for (const k of ['JOINTS_0', 'WEIGHTS_0', 'JOINTS_1', 'WEIGHTS_1']) if (p.getAttribute(k)) p.setAttribute(k, null);
  for (const t of p.listTargets()) p.removeTarget(t);
}
// nướng phép biến đổi của các nút vào đỉnh (model Sketchfab hay có nút xoay trục Z-up → Y-up, thu phóng 100 lần…)
// vật liệu chuẩn cũ KHR_materials_pbrSpecularGlossiness (three.js không còn đọc) → metal/rough, không thì mất màu
if (doc.getRoot().listExtensionsUsed().some(e => e.extensionName === 'KHR_materials_pbrSpecularGlossiness')) await doc.transform(metalRough());
await doc.transform(flatten());
for (const n of root.listNodes()) if (n.getMesh()) clearNodeTransform(n);
await doc.transform(dedup(), weld(), join({ keepNamed: false }), prune());
await MeshoptSimplifier.ready;
const ratio = Math.min(1, TRIS / triCount());
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0008, lockBorder: false }));
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX, TEX], quality: 86 }), prune());

// --rot=độ: xoay quanh trục đứng cho mặt nhân vật nhìn về +z (model tải về hay nhìn sang +x/-x)
const ROT = +opt('rot', 0) * Math.PI / 180;
if (ROT) {
  const c = Math.cos(ROT), s = Math.sin(ROT), done = new Set(), v3 = [];
  for (const p of root.listMeshes().flatMap(m => m.listPrimitives())) for (const k of ['POSITION', 'NORMAL']) {
    const a = p.getAttribute(k); if (!a || done.has(a)) continue; done.add(a);
    for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v3); a.setElement(i, [v3[0] * c + v3[2] * s, v3[1], -v3[0] * s + v3[2] * c]); }
  }
}
// đặt gốc: giữa hai bàn chân (không theo toàn khối vì tóc/mũ/tay dang có thể lệch), đế ở y = 0
const prims = root.listMeshes().flatMap(m => m.listPrimitives());
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], v = [];
for (const p of prims) { const pos = p.getAttribute('POSITION'); for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); } } }
const H = max[1] - min[1], footH = H * 0.06;
let fx = 0, fz = 0, fn = 0;
for (const p of prims) { const pos = p.getAttribute('POSITION'); for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); if (v[1] < min[1] + footH) { fx += v[0]; fz += v[2]; fn++; } } }
const cx = fn ? fx / fn : (min[0] + max[0]) / 2, cz = fn ? fz / fn : (min[2] + max[2]) / 2;
const shifted = new Set();
for (const p of prims) {
  const pos = p.getAttribute('POSITION'); if (shifted.has(pos)) continue; shifted.add(pos);
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); pos.setElement(i, [v[0] - cx, v[1] - min[1], v[2] - cz]); }
}
fs.mkdirSync(path.dirname(out), { recursive: true });
await io.write(out, doc);
const sz = fs.statSync(out).size;
console.log(`${path.basename(src)}: ${Math.round(before)} -> ${Math.round(triCount())} tam giác, ${(sz / 1e6).toFixed(2)} MB -> ${out}`);
console.log('kích thước (rộng, cao, sâu):', [max[0] - min[0], H, max[2] - min[2]].map(x => +x.toFixed(3)), '· tâm bàn chân (x, z):', cx.toFixed(3), cz.toFixed(3));
console.log('số mesh:', root.listMeshes().length, '· số phần:', prims.length);
for (const m of root.listMaterials()) {
  const slots = { base: m.getBaseColorTexture(), normal: m.getNormalTexture(), mr: m.getMetallicRoughnessTexture(), emissive: m.getEmissiveTexture() };
  console.log('vật liệu', m.getName(), Object.entries(slots).filter(([, t]) => t).map(([k, t]) => `${k}:${t.getSize()}`).join(' ') || '(chỉ màu)', 'alpha', m.getAlphaMode());
}
