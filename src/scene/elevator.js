// Thang máy của toà nhà SYSONE (bản nội thất my-office): tầng trệt dùng thang máy sẵn có của my-office, tầng 2 và 3
// gắn cửa thang máy lên tường trái cùng trục. Đứng trước cửa bấm E (hoặc bấm vào cửa) để chọn tầng: cửa mở, màn hình
// tối dần, ra ở tầng đã chọn, cửa tầng đó mở rồi tự đóng.
import * as THREE from 'three';
import { LIFT, floorY, toWorld } from '../myoffice/shellSpec.js';
import * as entrance from '../vendor/my-office/src/office/world/entrance.js';

export const LIFT_FLOORS = ['Tầng trệt', 'Tầng 2', 'Tầng 3'];

export class Elevator {
  constructor(scene) {
    this.group = new THREE.Group(); this.group.name = 'elevator'; scene.add(this.group);
    const [, zc] = toWorld(0, LIFT.z), [x0d] = toWorld(LIFT.door0X, 0), [sx0, sz0] = toWorld(...LIFT.stand0);
    this.zc = zc;
    // điểm dừng (toạ độ thế giới): chỗ đứng chờ trước cửa, tâm cửa, hướng bước ra khỏi thang (yaw nhìn vào trong)
    this.stops = [{ f: 0, x: sx0, z: sz0, y: floorY(0), door: { x: x0d, z: zc }, yaw: -Math.PI / 2 }];
    for (const f of [1, 2]) {
      const u = LIFT.up[f], [dx, dz] = toWorld(u.x, u.wallZ);
      this.stops[f] = { f, x: dx, z: dz - 0.8, y: floorY(f), door: { x: dx, z: dz }, yaw: 0, half: u.half }; // (cửa ở tường trước, mở về -z)
    }
    this.open = [0, 0, 0]; this.hold = [0, 0, 0];
    // cửa tầng 2, 3: khung ốp tối, viền đồng, hai cánh thép trượt, màn hình số tầng, nút gọi — dựng trong hệ toạ độ của cửa
    // (x dọc tường, +z hướng vào phòng) rồi đặt lên mặt trong tường trước
    const clad = new THREE.MeshStandardMaterial({ color: '#3A3F47', roughness: 0.55 });
    const brass = new THREE.MeshStandardMaterial({ color: '#C9A227', metalness: 0.7, roughness: 0.32 });
    const steel = new THREE.MeshStandardMaterial({ color: '#BCC4CC', metalness: 0.78, roughness: 0.26 });
    const inside = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.88, 0.76) });
    const btnM = new THREE.MeshBasicMaterial({ color: '#FFB23F' });
    const dw = 0.5, dh = 2.15, H = 3.0;
    this.leaves = [null];
    for (const f of [1, 2]) {
      const st = this.stops[f], half = st.half, g = new THREE.Group(); g.position.set(st.door.x, floorY(f), st.door.z); g.rotation.y = Math.PI; this.group.add(g);
      const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
      box(2 * dw, dh, 0.03, inside, 0, dh / 2, 0.005);                                                  // trong buồng thang (thấy khi cửa mở)
      for (const s of [-1, 1]) box(half - dw, H, 0.08, clad, s * (dw + (half - dw) / 2), H / 2, 0.04);
      box(2 * dw, H - dh, 0.08, clad, 0, dh + (H - dh) / 2, 0.04);
      box(2 * half + 0.06, 0.06, 0.1, brass, 0, H, 0.05);
      for (const s of [-1, 1]) box(0.06, dh + 0.05, 0.05, brass, s * (dw + 0.03), dh / 2, 0.09);
      box(2 * dw + 0.12, 0.06, 0.05, brass, 0, dh + 0.03, 0.09);
      this.leaves[f] = [-1, 1].map(s => box(dw + 0.01, dh - 0.02, 0.03, steel, s * dw / 2, (dh - 0.02) / 2, 0.06));
      // màn hình số tầng trên cửa
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48;
      const c = cv.getContext('2d'); c.fillStyle = '#15181E'; c.fillRect(0, 0, 128, 48); c.fillStyle = '#FFB23F'; c.font = 'bold 30px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(f + 1), 64, 26);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.19), new THREE.MeshBasicMaterial({ map: tex })); disp.position.set(0, dh + 0.36, 0.09); g.add(disp);
      box(0.12, 0.26, 0.03, steel, dw + 0.26, 1.12, 0.09);
      const bt = new THREE.Mesh(new THREE.CircleGeometry(0.026, 16), btnM); bt.position.set(dw + 0.26, 1.14, 0.106); g.add(bt);
    }
    for (const m of this.meshes()) m.userData.lift = true;
  }
  /** Các mảnh có thể bấm vào (cửa thang tầng 2, 3; cửa thang my-office ở tầng trệt). */
  meshes() {
    const out = [];
    for (const l of this.leaves) if (l) out.push(...l);
    if (entrance.lift) out.push(...entrance.lift.doors);
    return out;
  }
  /** Điểm dừng thang gần (x, z) trên tầng f (trong bán kính r tính từ chỗ đứng chờ), hoặc null. */
  near(x, z, f, r = 1.4) {
    const s = this.stops[f]; if (!s) return null;
    return Math.min(Math.hypot(x - s.x, z - s.z), Math.hypot(x - s.door.x, z - s.door.z) + 0.3) < r ? s : null;
  }
  /** Mở cửa tầng f trong `secs` giây (rồi tự đóng). */
  openAt(f, secs = 2.5) { this.hold[f] = Math.max(this.hold[f], secs); }
  update(dt, nearFloor = null) {
    for (let f = 0; f < 3; f++) {
      this.hold[f] = Math.max(0, this.hold[f] - dt);
      const want = this.hold[f] > 0 || nearFloor === f ? 1 : 0;
      this.open[f] = THREE.MathUtils.clamp(this.open[f] + (want ? 1 : -1) * dt * 1.8, 0, 1);
      const k = this.open[f] * this.open[f] * (3 - 2 * this.open[f]);
      if (f === 0) {
        const L = entrance.lift; if (!L || L.service || L.drill) continue;
        const dz = entrance.DZ; L.doors[0].position.z = dz - 0.25 - k * 0.48; L.doors[1].position.z = dz + 0.25 + k * 0.48;
        L.btn?.[0]?.color.set(want ? '#FFB23F' : '#4A4F57');
      } else {
        const [a, b] = this.leaves[f]; a.position.x = -0.25 - k * 0.48; b.position.x = 0.25 + k * 0.48;
      }
    }
  }
}
