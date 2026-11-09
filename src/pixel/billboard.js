// Nhân vật pixel trong cảnh 3D (ngoài trời): một tấm sprite luôn quay về camera (kiểu 2.5D), chọn hình trước/sau/nghiêng
// theo hướng đi so với camera, có bước chân và bóng dưới chân. Dùng cùng hình với văn phòng 2D (src/pixel/sprites.js).
import { moBase, moSpec } from './moSprite.js';
import { characterDef } from '../agents/glbCharacters.js';
import * as THREE from 'three';
import { sprite } from './sprites.js';

let SPECS = new Map(), LIST = [], CAMERA = null;
export function setPixelSpecs(list) { LIST = list || []; SPECS = new Map(LIST.map(c => [c.id, c])); }
export const pixelSpecs = () => LIST;
export function setBillboardCamera(cam) { CAMERA = cam; }
/** Chế độ hiển thị: '2d' (mặc định: trong khuôn viên vẽ 2D, ngoài trời sprite pixel) hoặc '3d' (toàn 3D, nhân vật chibi 3D). */
/** Bản 2D tạm ẩn (giữ nguyên code để bật lại sau: đặt ENABLE_2D = true). Khi ẩn: luôn 3D, không có nút đổi 2D/3D. */
export const ENABLE_2D = false;
export const VIEW = { mode: !ENABLE_2D ? '3d' : (typeof localStorage !== 'undefined' && localStorage.getItem('sysone.view')) === '3d' ? '3d' : '2d' };
const chibiCache = new Map();
/** Ngoại hình chibi 3D khớp với nhân vật pixel (cùng màu tóc/da/áo/quần/giày, kiểu tóc, mũ, váy). */
export function chibiLookOf(a) {
  const spec = specOf(a); if (!spec) return null;
  let L = chibiCache.get(spec.id);
  if (!L) {
    const hs = { short: 'short', spiky: 'spiky', bun: 'bun', buns: 'spacebuns', long: 'long' }[spec.hairStyle] || 'short';
    L = { skin: spec.skin, hair: spec.hair, hairStyle: spec.hat ? 'short' : hs, shirt: spec.shirt, pants: spec.pants, shoes: spec.shoes, outfit: spec.dress ? 'dress' : spec.style === 'jacket' ? 'hoodie' : 'tee',
      eyes: 'round', eyeColor: '#20160f', brows: 'normal', mouth: 'smile', blush: true, hat: spec.hat ? 'cap' : '', hatColor: spec.hat || '#c2402f', height: 1 };
    chibiCache.set(spec.id, L);
  }
  return L;
}
/** Hình pixel của một người: theo lựa chọn của họ, mặc định nhân vật đầu tiên; nhân viên mô phỏng chọn theo id. */
export function specOf(a) {
  const look = a?.emp?.look, id = look?.pixel;
  if (id && id.startsWith('mo-') && characterDef(id)) return custom(moBase(characterDef(id)), look); // nhân vật my-office
  if (id && SPECS.has(id)) return custom(SPECS.get(id), look);
  if (!LIST.length) return null;
  if (a?.key) return custom(LIST[0], look);
  const h = [...String(a?.id ?? a?.idx ?? 0)].reduce((n, c) => n * 31 + c.charCodeAt(0), 7);
  return LIST[Math.abs(h) % LIST.length];
}

// tuỳ chỉnh của người dùng (màu tóc/da/áo/quần/giày, kiểu áo) ghi đè lên nhân vật pixel gốc; '' = giữ nguyên
const customCache = new Map();
export function custom(base, look) {
  if (base?.mo) return look ? moSpec(base.def, { topColor: look.pxTopColor || '', bottomColor: look.pxBottomColor || '', shoeColor: look.pxShoeColor || '', hairColor: look.pxHairColor || '', skinColor: look.pxSkinColor || '' }, base.id) : base;
  if (!look || !base) return base;
  const k = [look.pxHairColor, look.pxSkinColor, look.pxTopStyle, look.pxTopColor, look.pxBottomColor, look.pxShoeColor]; // tuỳ chỉnh riêng của bản 2D
  if (k.every(v => !v)) return base;
  const id = base.id + '~' + k.map(v => v || '').join(',');
  let s = customCache.get(id);
  if (!s) {
    s = { ...base, id };
    if (look.pxHairColor) s.hair = look.pxHairColor;
    if (look.pxSkinColor) s.skin = look.pxSkinColor;
    if (look.pxTopColor) s.shirt = look.pxTopColor;
    if (look.pxBottomColor) s.pants = look.pxBottomColor;
    if (look.pxShoeColor) s.shoes = look.pxShoeColor;
    if (look.pxTopStyle) { s.style = look.pxTopStyle; s.dress = look.pxTopStyle === 'dress'; }
    customCache.set(id, s);
  }
  return s;
}

const texCache = new Map();
function texture(spec, dir, frame, flip) {
  const key = (spec.key || spec.id) + dir + frame + (flip ? 'f' : '');
  let t = texCache.get(key);
  if (!t) {
    const src = sprite(spec, dir, frame);
    if (!src) return null; // (nhân vật my-office đang được nướng sprite)
    let cv = src;
    if (flip) { cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height; const c = cv.getContext('2d'); c.translate(cv.width, 0); c.scale(-1, 1); c.drawImage(src, 0, 0); }
    t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false;
    t.userData.w = cv.width; t.userData.h = cv.height;
    texCache.set(key, t);
  }
  return t;
}

const _c = new THREE.Vector3();
/** Các sprite pixel của một AvatarSystem. */
export class PixelBillboards {
  constructor(group) {
    this.group = group; this.items = new Map(); this.used = new Set();
    this.shadowGeo = new THREE.CircleGeometry(0.16, 16).rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x2b2d42, transparent: true, opacity: 0.25, depthWrite: false });
  }
  begin() { this.used.clear(); }
  /**
   * Vẽ người a bằng sprite pixel; s: tỉ lệ nhân vật (cao 1.5·s m). Trả về false nếu chưa có danh sách nhân vật pixel.
   */
  draw(a, s) {
    const spec = specOf(a); if (!spec) return false;
    let it = this.items.get(a);
    if (!it) {
      const mat = new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.5, depthWrite: true });
      const sp = new THREE.Sprite(mat); sp.center.set(0.5, 0.02);
      const sh = new THREE.Mesh(this.shadowGeo, this.shadowMat); sh.renderOrder = 1;
      this.group.add(sp, sh); it = { sp, sh }; this.items.set(a, it);
    }
    this.used.add(a); it.sp.visible = it.sh.visible = true;
    // hướng so với camera: đi về phía camera = mặt trước, đi ra xa = sau lưng, còn lại nghiêng trái/phải
    const fx = -Math.sin(a.yaw || 0), fz = -Math.cos(a.yaw || 0);
    let dir = 'front', flip = false;
    if (CAMERA) {
      _c.set(CAMERA.position.x - a.x, 0, CAMERA.position.z - a.z).normalize();
      const toCam = fx * _c.x + fz * _c.z, right = fx * -_c.z + fz * _c.x; // right: thành phần sang phải màn hình
      if (toCam > 0.5) dir = 'front'; else if (toCam < -0.5) dir = 'back'; else { dir = 'side'; flip = right > 0; }
    }
    const sitting = (a.sit || 0) > 0.5, walking = (a.walkAmt || 0) > 0.25 && !sitting;
    const frame = walking ? 1 + (Math.floor((a.walkPhase || 0) / Math.PI) % 2) : 0;
    const tex = texture(spec, dir, frame, flip);
    if (!tex) return false;
    if (it.sp.material.map !== tex) { it.sp.material.map = tex; it.sp.material.needsUpdate = true; }
    const h = 1.5 * s * (tex.userData.h / 20), w = h * tex.userData.w / tex.userData.h; // 20 điểm ảnh = cao 1.5·s m
    it.sp.scale.set(w, h, 1);
    const y = a.y + (a.jumpH || 0) - (sitting ? h * 0.18 : 0);
    it.sp.position.set(a.x, y, a.z);
    it.sh.position.set(a.x, a.y + 0.012, a.z); it.sh.scale.setScalar(s / 0.5);
    // điểm khói thuốc: miệng và đầu điếu thuốc (để hiệu ứng khói vẫn chạy)
    a._mouth = (a._mouth || new THREE.Vector3()).set(a.x, y + h * 0.62, a.z);
    a._tip = (a._tip || new THREE.Vector3()).set(a.x + fx * 0.08, y + h * 0.45, a.z + fz * 0.08);
    return true;
  }
  end() { for (const [a, it] of this.items) if (!this.used.has(a)) { this.group.remove(it.sp, it.sh); it.sp.material.dispose(); this.items.delete(a); } }
}
