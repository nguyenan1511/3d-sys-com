// Nhân vật 2D = chính nhân vật chibi của my-office (cùng bộ với 3D): dựng chibi 3D trong một canvas ẩn, chụp phía trước /
// phía sau / nghiêng phải, đứng yên và hai nhịp bước, rồi thu nhỏ thành sprite pixel (có logo SYSONE trên áo như bản 3D).
// Mỗi tổ hợp (nhân vật + màu + hướng + khung) chụp một lần rồi lưu đệm.
import * as THREE from 'three';
import { makeChibi, chibiPose, applyChibiPose, disposeChibi } from '../vendor/my-office/chibi-rig.js';
import { moConfig, addChestLogo } from '../agents/moCharacters.js';

const W = 18, H = 26, SS = 5;        // kích thước sprite (điểm ảnh mỹ thuật), độ phân giải chụp gấp SS lần
let R = null;
function rig() {
  if (R) return R;
  // 9 ô (3 hướng × 3 khung) trên một canvas: vẽ cả 9 rồi đọc ảnh MỘT lần (đọc ảnh từ GPU là bước chậm nhất)
  const canvas = document.createElement('canvas'); canvas.width = W * SS * 3; canvas.height = H * SS * 3;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b1a4, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(1.5, 3, 4); scene.add(sun);
  const cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 20);
  R = { canvas, renderer, scene, cam };
  return R;
}

/** Spec 2D cho nhân vật my-office: def (characters.json), màu (khoá như 3D: topColor, bottomColor, …). */
/** Nhân vật my-office làm "nhân vật 2D" gốc (màu gốc theo characters.json — để trình chỉnh hiện ô "Màu gốc"). */
export function moBase(def) {
  const L = def?.look || {};
  return { mo: true, id: def?.id, def, name: def?.name, hair: L.hairColor, skin: L.skin || '#E8B98F', shirt: L.shirt, pants: L.pants, shoes: L.shoes };
}
export function moSpec(def, colors = {}, name = '') {
  const cfg = moConfig(def, colors, name);
  return { mo: true, def, cfg, key: def.id + JSON.stringify(cfg) };
}

const cache = new Map(), queue = new Map(), listeners = new Set();
const DIRS = ['front', 'back', 'side'], FRAMES = [0, 1, 2];
/** Gọi lại khi có sprite mới nướng xong (vd. trình chỉnh nhân vật vẽ lại các ô chọn). */
export function onSpritesBaked(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Dựng chibi một lần, chụp đủ 3 hướng × 3 khung. */
function bake(spec) {
  const { renderer, scene, cam, canvas } = rig();
  const { root, P } = makeChibi(spec.cfg, 1);
  addChestLogo(P, spec.cfg);
  scene.add(root);
  root.updateMatrixWorld(true);
  const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y;
  const half = h * 0.56, aspect = W / H;
  Object.assign(cam, { left: -half * aspect, right: half * aspect, top: half, bottom: -half }); cam.updateProjectionMatrix();
  cam.position.set(0, h * 0.5 + 2 * Math.sin(0.3), 2 * Math.cos(0.3)); cam.lookAt(0, h * 0.5 - half * 0.08, 0);
  const TW = W * SS, TH = H * SS;
  renderer.setScissorTest(true); renderer.setClearColor(0x000000, 0); renderer.clear();
  FRAMES.forEach((frame, fi) => {
    const anim = frame ? 'walk' : 'idle', ph = frame === 1 ? 0.35 : frame === 2 ? 0.35 + Math.PI / 9 : 0;
    for (let i = 0; i < 4; i++) root.position.y = applyChibiPose(P, chibiPose(P, anim, ph, { sit: false, scale: 1 }), 1);
    DIRS.forEach((dir, di) => {
      root.rotation.y = dir === 'back' ? Math.PI : dir === 'side' ? Math.PI / 2 : 0;
      root.updateMatrixWorld(true);
      const x = di * TW, y = (2 - fi) * TH;  // (gốc toạ độ viewport ở góc dưới)
      renderer.setViewport(x, y, TW, TH); renderer.setScissor(x, y, TW, TH);
      renderer.render(scene, cam);
    });
  });
  renderer.setScissorTest(false);
  // thu nhỏ cả lưới 3×3 một lần rồi cắt từng ô
  const all = document.createElement('canvas'); all.width = W * 3; all.height = H * 3;
  const ca = all.getContext('2d', { willReadFrequently: true }); ca.imageSmoothingEnabled = true; ca.imageSmoothingQuality = 'high';
  ca.drawImage(canvas, 0, 0, W * 3, H * 3);
  const img = ca.getImageData(0, 0, W * 3, H * 3), d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0;   // làm rõ viền (giống tranh pixel)
  ca.putImageData(img, 0, 0);
  FRAMES.forEach((frame, fi) => DIRS.forEach((dir, di) => {
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    out.getContext('2d').drawImage(all, di * W, fi * H, W, H, 0, 0, W, H);
    cache.set(spec.key + dir + frame, out);
  }));
  scene.remove(root); disposeChibi(P);
}
// nướng dần: mỗi lượt một nhân vật rồi nhường luồng chính (tin nhắn mạng, thao tác người dùng chen vào được)
let pumping = false;
const later = fn => setTimeout(fn, 16);
function pump() {
  pumping = false;
  const it = queue.entries().next();
  if (!it.done) { const [k, spec] = it.value; queue.delete(k); bake(spec); }
  for (const fn of listeners) fn();
  if (queue.size && !pumping) { pumping = true; later(pump); }
}

/** Sprite (canvas W × H) theo hướng 'front' | 'back' | 'side' (nghiêng phải) và khung 0 (đứng), 1, 2 (bước); null khi đang chờ nướng. */
export function moSprite(spec, dir = 'front', frame = 0) {
  const got = cache.get(spec.key + dir + frame);
  if (got) return got;
  if (!queue.has(spec.key)) queue.set(spec.key, spec);
  if (!pumping) { pumping = true; later(pump); }
  return null;
}

// ---------- chân dung 3D (thẻ chọn nhân vật): dựng chibi thật, nhìn chéo 3/4, khử răng cưa — không thu nhỏ thành pixel ----------
const PW = 144, PH = 200;
let PRig = null;
function portraitRig() {
  if (PRig) return PRig;
  const canvas = document.createElement('canvas'); canvas.width = PW; canvas.height = PH;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9b9a4, 2.3));
  const key = new THREE.DirectionalLight(0xfff3dc, 1.8); key.position.set(-1.5, 3, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(2, 2, -3); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(22, PW / PH, 0.05, 20);
  PRig = { canvas, renderer, scene, cam };
  return PRig;
}
const pcache = new Map(), pqueue = new Map();
function bakePortrait(spec) {
  const { renderer, scene, cam, canvas } = portraitRig();
  const { root, P } = makeChibi(spec.cfg, 1);
  addChestLogo(P, spec.cfg);
  for (let i = 0; i < 4; i++) root.position.y = applyChibiPose(P, chibiPose(P, 'idle', 0, { sit: false, scale: 1 }), 1);
  root.rotation.y = -0.38; scene.add(root); root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), h = box.getSize(new THREE.Vector3()).y, cy = box.min.y + h * 0.5;
  const dist = (h * 0.62) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  cam.position.set(0, cy + h * 0.08, dist); cam.lookAt(0, cy, 0);
  renderer.render(scene, cam);
  const out = document.createElement('canvas'); out.width = PW; out.height = PH; out.getContext('2d').drawImage(canvas, 0, 0);
  pcache.set(spec.key, out);
  scene.remove(root); disposeChibi(P);
}
let ppumping = false;
function ppump() {
  ppumping = false;
  const it = pqueue.entries().next();
  if (!it.done) { const [k, spec] = it.value; pqueue.delete(k); bakePortrait(spec); }
  for (const fn of listeners) fn();
  if (pqueue.size && !ppumping) { ppumping = true; setTimeout(ppump, 16); }
}
/** Chân dung 3D của nhân vật (canvas 144 × 200, nền trong), hoặc null khi đang dựng (gọi lại khi onSpritesBaked báo). */
export function moPortrait(spec) {
  const got = pcache.get(spec.key); if (got) return got;
  if (!pqueue.has(spec.key)) pqueue.set(spec.key, spec);
  if (!ppumping) { ppumping = true; setTimeout(ppump, 16); }
  return null;
}
