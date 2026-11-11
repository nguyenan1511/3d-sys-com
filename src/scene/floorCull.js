// Ẩn các tầng chắc chắn không nhìn thấy (bớt draw call, hình không đổi):
// - đang cắt tầng (xem tổng quan một tầng): các tầng phía trên mặt cắt bị cắt hết → ẩn;
// - camera ở TRONG nhà, tại tầng f: sàn và trần che các tầng khác → chỉ vẽ tầng f. Khi người chơi ở cầu thang hoặc gần
//   ô cầu thang thì vẫn vẽ cả tầng ngay trên/dưới (nhìn qua lỗ cầu thang);
// - camera ngoài nhà (nhìn qua cửa kính thấy được mọi tầng): vẽ hết.
// Chỉ đụng tới cờ visible của các nhóm "cả tầng" đã đăng ký (không ai khác bật/tắt chúng), nên không xung đột với code khác.
import * as THREE from 'three';

export class FloorCuller {
  /**
   * model: layoutModel; cameraFloor(C) → id tầng nếu camera đang ở trong nhà tại tầng đó, ngược lại null.
   */
  constructor(model, { cameraFloor, nearStairR = 4 } = {}) {
    this.model = model; this.cameraFloor = cameraFloor || (() => null); this.nearStairR = nearStairR;
    this.parts = new Map(); this.seen = new WeakSet(); this.key = 'all'; this.hidden = 0;
  }
  /** Đăng ký một nhóm thuộc trọn một tầng. */
  add(obj, floor) {
    if (!obj || floor === null || floor === undefined || this.seen.has(obj)) return;
    this.seen.add(obj); if (!this.parts.has(floor)) this.parts.set(floor, []); this.parts.get(floor).push(obj); this.key = '';
  }
  /** Tầng chứa trọn hộp bao [y0, y1] (từ sàn tới gần sàn tầng trên), hoặc null nếu vắt qua nhiều tầng. */
  floorOfSpan(y0, y1) {
    for (const f of this.model.floors) if (y0 >= this.model.floorY(f.id) - 0.15 && y1 <= f.ceiling + 0.35) return f.id;
    return null;
  }
  /** Đăng ký từng nhóm con của `group` theo hộp bao (con nào vắt qua nhiều tầng thì bỏ qua — luôn vẽ). */
  addChildrenByBox(group) {
    if (!group) return;
    group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const c of group.children) { if (this.seen.has(c)) continue; box.setFromObject(c); if (!box.isEmpty()) this.add(c, this.floorOfSpan(box.min.y, box.max.y)); }
  }
  /** Tập tầng cần vẽ (null = tất cả). cut: tầng đang cắt (null nếu không); a: nhân vật người chơi (nếu có). */
  visibleFloors(camPos, cut, a) {
    if (cut !== null && cut !== undefined) return new Set(this.model.floors.map(f => f.id).filter(id => id <= cut));
    const f = this.cameraFloor(camPos);
    if (f === null || f === undefined) return null;
    const out = new Set([f]);
    const nearStair = a && (a.onStair || this.model.stairs.some(s => (s.from === f || s.to === f) && dist(s, a.x, a.z) < this.nearStairR));
    if (nearStair) { out.add(f - 1); out.add(f + 1); }
    return out;
  }
  /** Mỗi khung hình: áp dụng (chỉ đổi cờ visible khi tập tầng đổi). Trả về số nhóm đang bị ẩn. */
  update(camPos, cut, a) {
    const vis = this.visibleFloors(camPos, cut, a), key = vis ? [...vis].sort().join(',') : 'all';
    if (key === this.key) return this.hidden;
    this.key = key; this.hidden = 0;
    for (const [f, list] of this.parts) { const on = !vis || vis.has(f); for (const o of list) { o.visible = on; if (!on) this.hidden++; } }
    return this.hidden;
  }
}

/** Khoảng cách từ (x, z) tới hình chữ nhật của cầu thang (0 nếu ở trong). */
function dist(s, x, z) {
  const dx = Math.max(s.x0 - x, 0, x - s.x1), dz = Math.max(s.z0 - z, 0, z - s.z1);
  return Math.hypot(dx, dz);
}
