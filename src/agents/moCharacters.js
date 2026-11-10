// Nhân vật kiểu "my-office" (khanh020905/my-office, MIT — src/vendor/my-office/chibi-rig.js): chibi đồ chơi / hoạt hình
// dựng bằng code, động tác tự dựng có IK tay (gõ phím, cầm cốc, gọi điện…). Lớp này nối trạng thái nhân vật của dự
// án (đi/chạy/ngồi/gõ phím/động tác người chơi) sang tên động tác của rig, và đổi tỉ lệ cho khớp ghế/bàn của văn phòng.
import * as THREE from 'three';
import { logoStitch } from './logoPatch.js';
if (typeof document !== 'undefined') logoStitch(); // tải sẵn logo gốc (sprite 2D nướng từ nhân vật 3D cũng có logo)
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeChibi, applyChibiPose, disposeChibi } from '../vendor/my-office/chibi-rig.js';
import { Motion } from './actions.js';

const HEIGHT = { toy: 1.74, pixar: 1.86 }; // chiều cao rig (đơn vị của rig)
const LEG_R = { toy: 0.105, pixar: 0.1 }, HIP = { toy: 0.44, pixar: 0.58 };

/** Cấu hình rig từ ngoại hình: def.look (mặc định của nhân vật) + màu tuỳ chỉnh 3D của người dùng. */
export function moConfig(def, el = {}, name = '') {
  const L = { ...(def.look || {}) };
  return {
    look: L.style === 'toy' ? 'toy' : 'pixar', name: name || def.id, style: L.hair || 'plain', outfit: L.outfit || 'shirt', acc: L.acc || null, tie: L.tie,
    shirt: el.topColor || L.shirt, pants: el.bottomColor || L.pants, shoes: el.shoeColor || L.shoes, hair: el.hairColor || L.hairColor, skin: el.skinColor || L.skin, iris: L.iris
  };
}

/** Logo SYSONE ở ngực trái áo (bên trái nhân vật = +x của rig; rig nhìn +z). Tính trong toạ độ của thân áo: thân là khối
 *  tiện tròn (LatheGeometry) — bán kính theo độ cao lấy từ chính đường biên của nó, mặt trước dẹt theo tỉ lệ z của thân. */
export function addChestLogo(P, cfg = {}) {
  const torso = P.torso, pts = torso?.geometry?.parameters?.points; if (!pts) return;
  const top = pts[pts.length - 1].y, bot = pts[0].y;
  // bán kính áo ở độ cao y theo đường viền thân (LatheGeometry)
  const radius = y => { for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k]; if ((y - a.y) * (y - b.y) <= 0 && b.y !== a.y) return a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y); } return 0; };
  const suit = cfg.outfit === 'suit'; // (vest + cà vạt ở giữa ngực: logo cài nhỏ ở ngực trái)
  const yc = bot + (top - bot) * (suit ? 0.68 : 0.6), r = radius(yc); if (!r) return;
  const { tex, aspect } = logoStitch();
  // logo thêu lớn giữa ngực (to gấp 3 bản cũ để nhìn rõ từ xa): một mảnh lưới nằm đúng trên mặt áo, uốn theo cả độ cong
  // ngang lẫn đường viền dọc của thân
  const span = suit ? 0.8 : 2.5, phc = suit ? 0.45 : 0, h = r * span * aspect * 1.05, NU = 32, NV = 8, off = suit ? 0.02 : 0.0025;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const u = i / NU, v = j / NV, ph = phc + (u - 0.5) * span, y = yc + (v - 0.5) * h, rr = radius(y) + off;
    pos.push(rr * Math.sin(ph), y, rr * Math.cos(ph)); uv.push(u, v);
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; idx.push(a, b, d, a, d, c); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, alphaTest: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.material.userData.keepSide = true; m.name = 'sysoneLogo';
  torso.add(m); P.logo = m;
}

/**
 * Gộp các khối tĩnh của một chibi: trong mỗi nhóm (khớp xương), các khối con cùng vật liệu, không có con, không được
 * mã chuyển động nhắc tới (P.*: mắt chớp, miệng, đồ cầm tay…) gộp thành một — ~66 lệnh vẽ mỗi người còn khoảng 20.
 */
function mergeChibiParts(root, P) {
  const keep = new Set();
  const ref = (v, d = 0) => { if (!v || d > 2) return; if (v.isObject3D) { keep.add(v); return; } if (v.isMaterial || v.isTexture || v.isBufferGeometry) return; if (Array.isArray(v) || typeof v === 'object') for (const x of Object.values(v)) ref(x, d + 1); };
  for (const [k, v] of Object.entries(P)) if (!['own', 'standIns', 'meshes', 'mats'].includes(k)) ref(v); // (danh sách tổng của rig — không phải khối được điều khiển)
  const groups = []; root.traverse(o => { if (o.children.length) groups.push(o); });
  for (const g of groups) {
    const buckets = new Map();
    for (const c of g.children) {
      if (!c.isMesh || c.isSkinnedMesh || c.isInstancedMesh || c.children.length || keep.has(c) || !c.visible || Array.isArray(c.material)) continue;
      const k = c.material.uuid + '|' + c.castShadow + '|' + c.renderOrder;
      if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(c);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const geos = list.map(c => {
        c.updateMatrix();
        let geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        for (const n of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(n)) geo.deleteAttribute(n);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
        geo.morphAttributes = {}; return geo.applyMatrix4(c.matrix);
      });
      const merged = mergeGeometries(geos, false); if (!merged) continue;
      const m = new THREE.Mesh(merged, list[0].material); m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow; m.renderOrder = list[0].renderOrder;
      g.add(m); for (const c of list) g.remove(c);
    }
  }
}

export class MoInstance {
  constructor(def, cfg, parent) {
    this.def = def; this.cfg = cfg; this.key = JSON.stringify(cfg);
    const { root, P } = makeChibi(cfg, 1);
    this.root = root; this.P = P; this.look = cfg.look; this.ready = true;
    addChestLogo(P, cfg);
    mergeChibiParts(root, P);
    root.traverse(o => { if (o.isMesh) { o.castShadow = false; for (const m of [].concat(o.material)) m.userData.keepSide = true; } }); // (bóng tròn dưới chân thay bóng đổ: bớt một lượt vẽ cho mỗi khối)
    this.inner = new THREE.Group(); this.inner.rotation.y = Math.PI; this.inner.add(root); // rig nhìn +z, nhân vật nhìn -z
    this.group = new THREE.Group(); this.group.add(this.inner); parent.add(this.group);
    this.t = Math.random() * 10; this.blinkAt = 1 + Math.random() * 3; this.blink = 0;
  }
  dispose() { this.group.parent?.remove(this.group); disposeChibi(this.P); }

  /** a: agent; s: tỉ lệ nhân vật; seatHip: độ cao hông khi ngồi (mét thế giới); dt: giây. */
  apply(a, s, seatHip, dt) {
    const look = this.look, k = (this.def.height || 1.5) * s / HEIGHT[look];
    this.group.position.set(a.x, a.y + (a.jumpH || 0), a.z); this.group.rotation.y = a.yaw; this.group.scale.setScalar(k);
    this.t += dt;
    // ghế/bàn: rig coi mặt ghế ở 0.49 (đơn vị rig, nhân với 1/scale) → chọn scale để hông ngồi đúng độ cao ghế thật
    const W = Math.max(0.3, (seatHip / k - LEG_R[look]) / 0.49);
    this.blinkAt -= dt; if (this.blinkAt < 0) { this.blink = 0.14; this.blinkAt = 2 + Math.random() * 4; } this.blink = Math.max(0, this.blink - dt);
    // chuyển động tự nhiên (src/agents/actions.js): trộn đứng/đi/ngồi + động tác + cử chỉ vặt, lọc lò xo; rig chỉ việc đặt
    this.motion ||= new Motion();
    const p = this.motion.pose(this.P, a, Math.min(dt, 0.1), { scale: 1 / W, blink: this.blink > 0 });
    const y = applyChibiPose(this.P, p, 1);   // (dt = 1: đặt thẳng — đã lọc lò xo ở trên)
    this.root.position.y = y;
    // điểm khói thuốc (hiệu ứng khói chạy theo miệng và đầu điếu thuốc)
    if (a.act === 'smoke') {
      this.group.updateMatrixWorld(true);
      a._mouth = (a._mouth || new THREE.Vector3()); this.P.head.getWorldPosition(a._mouth);
      a._tip = (a._tip || new THREE.Vector3()); (this.P.cigTip || this.P.armR.hand).getWorldPosition(a._tip);
    }
  }
}

/** Mỗi agent một rig; đổi màu/kiểu thì dựng lại rig (rig gộp hình theo vật liệu nên không đổi màu tại chỗ được). */
export class MoPool {
  constructor(group) { this.group = group; this.inst = new Map(); this.used = new Set(); }
  begin() { this.used.clear(); }
  get(a, def, cfg) {
    let it = this.inst.get(a);
    if (it && (it.def !== def || it.key !== JSON.stringify(cfg))) { it.dispose(); it = null; this.inst.delete(a); }
    if (!it) { it = new MoInstance(def, cfg, this.group); this.inst.set(a, it); it.group.traverse(o => { if (o.isMesh) o.userData.agent = a; }); }
    this.used.add(a); it.group.visible = true;
    return it;
  }
  loading() { return false; }
  /** Các nhóm nhân vật đang hiện (để bấm chọn người). */
  groups() { const out = []; for (const it of this.inst.values()) if (it.group.visible) out.push(it.group); return out; }
  end() { for (const [a, it] of this.inst) if (!this.used.has(a)) { it.dispose(); this.inst.delete(a); } }
}
