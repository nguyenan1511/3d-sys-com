// Nhãn trên đầu mỗi người (cảnh 3D), làm giống my-office (people/workers.js + styles/labels.css của khanh020905/my-office,
// MIT): nhãn HTML gắn vào cảnh (CSS2DRenderer) — viên thuốc tối, chấm màu, tên, chip phòng ban; bong bóng chat tối viền xanh
// phía trên. Dùng chung cho mình, người online khác, chị hướng dẫn và nhân viên mô phỏng. Chỉ hiện người cùng tầng đang
// xem và trong tầm ~22 m (đỡ rối). Người bị tường/vách che (tia từ camera tới đầu và thân đều vướng) thì nhãn mờ đi và ẩn:
// không nhìn xuyên tường.
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { findDepartment } from '../shared/departments.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export class NameTags {
  constructor(scene, host) {
    this.group = new THREE.Group(); this.group.name = 'nameTags'; scene.add(this.group);
    this.items = new Map(); this.seen = new Set();
    this.blocked = null; // (x, y, z) => true khi đoạn camera → điểm bị tường che (main.js gắn vào)
    this.r = new CSS2DRenderer(); this.r.domElement.className = 'tag-layer';
    host.appendChild(this.r.domElement);
  }
  setSize(w, h) { this.r.setSize(w, h); }
  render(scene, camera) { this.r.render(scene, camera); }
  make(e) {
    const tag = el('div', 'tag'), dot = el('i'), name = document.createTextNode(e.name), chip = el('span', 'tag-dept');
    tag.append(dot, name, chip);
    const obj = new CSS2DObject(tag); obj.center.set(0.5, 1); this.group.add(obj);
    const bw = el('div', 'bubble-wrap'), bub = el('div', 'bubble'), ico = el('span', 'b-ico', '💬'), txt = el('span', 'b-txt'); bub.append(ico, txt); bw.append(bub);
    const bobj = new CSS2DObject(bw); bobj.visible = false; this.group.add(bobj);
    return { obj, tag, dot, name, chip, bobj, txt, sig: '', hid: false, t: 0 };
  }
  /** entries: [{ key, name, dept, x, y, z, f, sit, bubble, guide }]; floor: tầng đang xem (null = mọi tầng); cam: vị trí camera. */
  update(entries, floor, cam, cs = 1) {
    this.seen.clear();
    for (const e of entries) {
      if (!e || !e.name) continue;
      let it = this.items.get(e.key);
      const near = (floor === null || floor === undefined || e.f === floor) && Math.hypot(e.x - cam.x, e.z - cam.z) < 22;
      if (!near) { if (it) { it.obj.visible = false; it.bobj.visible = false; } this.seen.add(e.key); continue; }
      if (!it) { it = this.make(e); this.items.set(e.key, it); }
      const sig = e.name + '|' + (e.dept || '') + '|' + (e.guide ? 1 : 0) + (e.me ? 1 : 0);
      if (sig !== it.sig) {
        it.sig = sig; it.name.data = e.name;
        const d = findDepartment(e.dept), col = e.guide ? '#ff8a5b' : (d?.color || '#8b93a1');
        it.dot.style.background = col;
        it.chip.textContent = e.guide ? 'Hướng dẫn viên' : d ? d.name.replace(/^(Phòng|Team) /, '') : (e.dept || '');
        it.chip.hidden = !it.chip.textContent; it.chip.style.setProperty('--c', col);
        it.tag.classList.toggle('tag--me', !!e.me); it.tag.classList.toggle('tag--guide', !!e.guide);
      }
      const y = e.y + (2.02 - 0.5 * (e.sit || 0)) * cs;
      // bị tường che? (mỗi nhãn kiểm tra ~7 lần/giây, so le nhau; mờ dần thay vì chớp tắt)
      const now = performance.now();
      if (this.blocked && now - it.t > 140) { it.t = now + Math.random() * 30; it.hid = this.blocked(e.x, y - 0.1 * cs, e.z) && this.blocked(e.x, e.y + 0.9 * cs, e.z); }
      it.tag.classList.toggle('tag--hidden', it.hid);
      it.obj.visible = true; it.obj.position.set(e.x, y, e.z);
      if (e.bubble && !it.hid) { if (it.txt.textContent !== e.bubble) it.txt.textContent = e.bubble; it.bobj.visible = true; it.bobj.position.set(e.x, y, e.z); }
      else it.bobj.visible = false;
      this.seen.add(e.key);
    }
    for (const [k, it] of this.items) if (!this.seen.has(k)) { this.group.remove(it.obj, it.bobj); it.obj.element.remove(); it.bobj.element.remove(); this.items.delete(k); }
  }
  hideAll() { for (const it of this.items.values()) { it.obj.visible = false; it.bobj.visible = false; } }
  place() {}
}
