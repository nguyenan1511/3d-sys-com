// Chiếu video YouTube lên TV phòng giải trí (props/game-tv.js của my-office) trong cảnh 3D.
// Khung trình phát YouTube (iframe) đặt đúng vị trí màn hình TV bằng CSS3DRenderer, nằm DƯỚI canvas WebGL; màn hình TV đổi sang
// vật liệu "khoét lỗ" (ghi alpha 0, vẫn ghi chiều sâu) nên chỉ chỗ màn hình nhìn thấy được mới lộ video — người/đồ vật đứng
// trước TV vẫn che video như thật. Cần renderer tạo với alpha: true.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { GTV } from '../vendor/my-office/src/office/world/props/game-tv.js';

const PX = 1000; // điểm ảnh CSS trên 1 m

export class TvVideo {
  constructor(host, canvas) {
    this.r = new CSS3DRenderer(); this.r.domElement.className = 'tv-layer';
    host.insertBefore(this.r.domElement, canvas);                       // (dưới canvas)
    this.scene = new THREE.Scene();
    this.box = document.createElement('div'); this.box.className = 'tv-video';
    const slot = document.createElement('div'); slot.id = 'ytSlot'; this.box.appendChild(slot);
    this.obj = new CSS3DObject(this.box); this.scene.add(this.obj);
    this.hole = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: false, blending: THREE.NoBlending, toneMapped: false });
    this.hole.opacity = 0;
    this.active = false; this.placed = false;
    this.setActive(false);
  }
  /** Đặt khung video trùng màn hình TV (gọi khi TV đã dựng xong). */
  place() {
    const scr = GTV?.screen; if (!scr) return false;
    scr.updateWorldMatrix(true, false);                                   // (gồm cả các khối cha: toà nhà đã dời về chỗ)
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); scr.matrixWorld.decompose(p, q, s);
    const g = scr.geometry.parameters, w = g.width * s.x, h = g.height * s.y;
    this.box.style.width = `${Math.round(w * PX)}px`; this.box.style.height = `${Math.round(h * PX)}px`;
    this.obj.position.copy(p); this.obj.quaternion.copy(q); this.obj.scale.setScalar(1 / PX);
    this.obj.updateMatrixWorld(true); this.placed = true;
    return true;
  }
  setActive(on) {
    this.active = !!on; if (on) this.place();
    this.r.domElement.style.visibility = on ? 'visible' : 'hidden';
    const scr = GTV?.screen;
    if (scr) { if (on) { if (!this.orig) this.orig = scr.material; scr.material = this.hole; } else if (this.orig) scr.material = this.orig; }
  }
  setSize(w, h) { this.r.setSize(w, h); }
  render(camera) { if (this.active && this.placed) this.r.render(this.scene, camera); }
}
