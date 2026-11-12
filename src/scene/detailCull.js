// Bỏ vẽ đồ vật nhỏ ở xa camera (kiểu "detail culling" của game): văn phòng có hàng trăm vật nhỏ không gộp được (ghế, cửa,
// đồ trang trí, bảng trên bàn, biển phòng ban…) — mỗi vật một lệnh vẽ. Ở xa chúng chỉ còn vài điểm ảnh nhưng vẫn tốn
// lệnh vẽ như ở gần; điện thoại nghẽn nhất ở chỗ này (~1.000 lệnh vẽ / khung hình).
// Cách làm: vật nhỏ ở xa được chuyển sang lớp HIDE_LAYER (camera chính chỉ vẽ lớp 0) — KHÔNG đụng cờ visible, nên không
// xung đột với code khác đang bật/tắt vật (rèm, bảng trên bàn, màn hình…). Kiểm tra lại ~4 lần/giây, so le theo lô.
// Vật càng to thì càng được giữ xa (ngưỡng = base + radius × k).
import * as THREE from 'three';

export const HIDE_LAYER = 7;
const _c = new THREE.Vector3();

export class DetailCuller {
  /** base: khoảng cách giữ mọi vật (m); k: mỗi mét bán kính thêm bao nhiêu mét; small: bán kính tối đa của "vật nhỏ". */
  constructor({ base = 16, k = 14, small = 0.9 } = {}) {
    this.base = base; this.k = k; this.small = small;
    this.items = []; this.seen = new WeakSet(); this.i = 0; this.hidden = 0;
  }
  /** Đăng ký các mesh nhỏ trong root (bỏ qua nhánh skip(o) true: nhân vật, nhãn…). */
  add(root, skip = () => false) {
    const visit = o => {
      if (skip(o)) return;
      if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.frustumCulled !== false && !this.seen.has(o) && o.geometry) {
        const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
        const r = g.boundingSphere.radius * o.getWorldScale(_c).x;
        if (r > 0 && r < this.small) { this.seen.add(o); this.items.push({ o, r, far: false }); }
      }
      for (const c of o.children) visit(c);
    };
    root.updateMatrixWorld(true); visit(root);
  }
  /** (mỗi khung hình) xét một lô ~1/15 danh sách. */
  update(cam) {
    const n = this.items.length; if (!n) return;
    const batch = Math.max(40, Math.ceil(n / 15));
    for (let j = 0; j < batch; j++) {
      if (this.i >= this.items.length) this.i = 0;
      const it = this.items[this.i++], o = it.o;
      if (!o.parent) { this.items.splice(--this.i, 1); continue; }   // (vật đã bị gỡ khỏi cảnh)
      const g = o.geometry.boundingSphere; _c.copy(g.center).applyMatrix4(o.matrixWorld);
      const lim = this.base + it.r * this.k, far = _c.distanceToSquared(cam) > lim * lim;
      if (far !== it.far) { it.far = far; if (far) { o.layers.set(HIDE_LAYER); this.hidden++; } else { o.layers.set(0); this.hidden--; } }
    }
  }
  /** Hiện lại tất cả (vd. chụp ảnh tổng quan). */
  reset() { for (const it of this.items) if (it.far) { it.far = false; it.o.layers.set(0); } this.hidden = 0; }
}
