// Góc âm nhạc (tầng trệt, phòng giải trí, sát tường trái): máy hát jukebox giữa hai loa đứng, thảm tròn, biển "GÓC ÂM NHẠC".
// Đi tới đứng trước máy bấm E để mở bảng chọn nhạc; bật một lần là cả công ty cùng nghe (server/social.js, WebSocket).
// Đang phát: vòm đèn máy hát đổi màu, màng loa rung, nốt nhạc bay lên.
import * as THREE from 'three';

export class MusicCorner {
  constructor(scene, model, COL) {
    const y = model.floorY(0);
    this.c = { x: 7.15, z: -2.6 };                  // tâm máy hát (sát tường, mặt quay về +x)
    this.stand = { x: 8.25, z: -2.6 };              // chỗ đứng chọn nhạc
    const g = this.g = new THREE.Group(); g.name = 'musicCorner'; g.position.set(this.c.x, y, this.c.z); g.rotation.y = Math.PI / 2; scene.add(g);
    const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...o });
    const wood = M('#6b4226'), dark = M('#1c1e23', { roughness: 0.7 }), chrome = M('#d9dde3', { metalness: 0.8, roughness: 0.25 });
    const box = (w, h, d, m, x, yy, z, p = g) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, yy, z); p.add(o); return o; };
    // thảm tròn
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40), M('#7d3c98', { roughness: 0.95 })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.012, 0.75); g.add(rug);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 0.9, 40), M('#f2b33d', { roughness: 0.9 })); ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.014, 0.75); g.add(ring);
    // máy hát: thân gỗ, vòm đèn bán nguyệt, ô kính đĩa than, hàng nút
    box(0.78, 1.0, 0.45, wood, 0, 0.5, 0);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.45, 32, 1, false, -Math.PI / 2, Math.PI), wood); arch.rotation.z = Math.PI / 2; arch.rotation.y = Math.PI / 2; arch.position.set(0, 1.0, 0); g.add(arch);
    this.glowM = new THREE.MeshBasicMaterial({ color: '#ff8a5b', toneMapped: false });
    const glow = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 10, 40, Math.PI), this.glowM); glow.position.set(0, 1.0, 0.235); g.add(glow);
    box(0.5, 0.32, 0.02, M('#0d1018', { roughness: 0.2, metalness: 0.3 }), 0, 0.78, 0.226);
    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.01, 32), dark); this.disc.rotation.x = Math.PI / 2; this.disc.position.set(0, 0.78, 0.24); g.add(this.disc);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 20), M('#f2b33d')); label.rotation.x = Math.PI / 2; label.position.set(0, 0.78, 0.246); g.add(label); this.label = label;
    for (let i = 0; i < 5; i++) box(0.06, 0.03, 0.02, chrome, -0.24 + i * 0.12, 0.52, 0.232);
    box(0.62, 0.1, 0.02, chrome, 0, 0.32, 0.232);
    // hai loa đứng hai bên
    this.cones = [];
    for (const sx of [-1, 1]) {
      const s = new THREE.Group(); s.position.set(sx * 0.78, 0, 0.05); g.add(s);
      box(0.36, 0.95, 0.34, dark, 0, 0.475, 0, s);
      for (const [yy, r] of [[0.66, 0.11], [0.32, 0.07]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.8, 0.04, 24), M('#3a3d45', { metalness: 0.2, roughness: 0.4 })); c.rotation.x = Math.PI / 2; c.position.set(0, yy, 0.18); s.add(c); this.cones.push(c); }
    }
    // biển "GÓC ÂM NHẠC"
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; const x = cv.getContext('2d');
    x.fillStyle = '#16191f'; x.beginPath(); x.roundRect(0, 0, 512, 96, 24); x.fill(); x.fillStyle = '#f2b33d'; x.font = 'bold 50px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('♪ GÓC ÂM NHẠC ♪', 256, 52);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.244), new THREE.MeshBasicMaterial({ map: t, toneMapped: false })); sign.position.set(0, 1.85, -0.05); g.add(sign);
    // nốt nhạc bay lên
    const nc = document.createElement('canvas'); nc.width = nc.height = 64; const n = nc.getContext('2d'); n.fillStyle = '#ff8a5b'; n.font = 'bold 52px sans-serif'; n.textAlign = 'center'; n.textBaseline = 'middle'; n.fillText('♪', 32, 34);
    const nt = new THREE.CanvasTexture(nc); nt.colorSpace = THREE.SRGBColorSpace;
    this.notes = Array.from({ length: 5 }, (_, i) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: nt, transparent: true, depthWrite: false })); s.scale.setScalar(0.22); s.visible = false; s.userData.ph = i / 5; g.add(s); return s; });
    // va chạm: không đi xuyên máy hát và hai loa
    COL?.push({ x0: this.c.x - 0.3, x1: this.c.x + 0.3, z0: this.c.z - 1.0, z1: this.c.z + 1.0, y0: y, y1: y + 1.5 });
    this.on = false; this.t = 0;
  }
  near(x, z, f) { return f === 0 && Math.hypot(x - this.stand.x, z - this.stand.z) < 1.2; }
  set(on) { this.on = !!on; for (const n of this.notes) n.visible = this.on; if (!on) { this.glowM.color.set('#ff8a5b'); for (const c of this.cones) c.scale.set(1, 1, 1); } }
  update(dt) {
    if (!this.on) return;
    this.t += dt;
    this.glowM.color.setHSL((this.t * 0.08) % 1, 0.85, 0.6);
    this.disc.rotation.y += dt * 3.5; this.label.rotation.y += dt * 3.5;
    const pulse = 1 + 0.07 * Math.max(0, Math.sin(this.t * 13));
    for (const c of this.cones) c.scale.set(pulse, 1, pulse);
    for (const n of this.notes) { const k = (this.t * 0.4 + n.userData.ph) % 1; n.position.set(Math.sin((k + n.userData.ph) * 6) * 0.6, 1.3 + k * 1.1, 0.3); n.material.opacity = Math.sin(k * Math.PI); }
  }
}
