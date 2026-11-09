// Hiệu ứng khói thuốc: sprite mềm bay lên, nở ra và mờ dần.
import * as THREE from 'three';

function softTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(235,235,235,0.9)'); grd.addColorStop(1, 'rgba(235,235,235,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class SmokeFX {
  constructor(scene, max = 160) {
    this.group = new THREE.Group(); this.group.name = 'smoke'; scene.add(this.group);
    this.tex = softTexture();
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; this.group.add(s); this.pool.push({ s, life: 0, max: 1, vx: 0, vz: 0, size: 0.05 });
    }
    this.next = 0;
  }
  emit(pos, size = 0.05, life = 2.2) {
    const p = this.pool[this.next++ % this.pool.length];
    p.s.position.copy(pos); p.s.visible = true; p.life = 0; p.max = life; p.size = size;
    p.vx = (Math.random() - 0.5) * 0.06; p.vz = (Math.random() - 0.5) * 0.06;
  }
  /** agents: danh sách có act/_tip/_mouth (đã được AvatarSystem tính). */
  update(dt, agents) {
    for (const a of agents) {
      if (!a || !a.visible || a.act !== 'smoke' || !a._tip) continue;
      a._smokeT = (a._smokeT || 0) + dt;
      if (a._smokeT > 0.28) { a._smokeT = 0; this.emit(a._tip, 0.03, 1.6); }
      // thở khói ra sau mỗi hơi rít
      const ph = Math.sin((a.actT || 0) * 0.9);
      if (a._lastPh > 0.95 && ph <= 0.95 && a._mouth) for (let k = 0; k < 4; k++) this.emit(a._mouth, 0.06 + k * 0.02, 2.4);
      a._lastPh = ph;
    }
    for (const p of this.pool) {
      if (!p.s.visible) continue;
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) { p.s.visible = false; continue; }
      p.s.position.x += p.vx * dt; p.s.position.z += p.vz * dt; p.s.position.y += (0.22 - 0.1 * k) * dt;
      const sz = p.size * (1 + 5 * k); p.s.scale.set(sz, sz, 1);
      p.s.material.opacity = 0.55 * (1 - k) * Math.min(1, p.life * 6);
    }
  }
}
