// Hiệu ứng khói thuốc: sprite mềm bay lên, nở ra và mờ dần (đầu điếu thuốc). Mỗi hơi rít: vừa KÉO THUỐC RA KHỎI MIỆNG là phà
// một làn khói trắng mỏng từ miệng (ít, như thật); trong làn khói có chữ nhỏ "ghê chưa…" trôi theo khói rồi tan.
// Điếu thuốc hết (session/player.js ~9 giây) hoặc dập sớm: phun hơi cuối. Ai đứng xem cũng thấy (mỗi máy tự vẽ).
import * as THREE from 'three';

function softTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.5, 'rgba(250,250,250,0.55)'); grd.addColorStop(1, 'rgba(245,245,245,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Chữ nhỏ trong làn khói trắng: xám đậm, quầng trắng mềm (đọc được cả trên khói lẫn trên nền). Trả về { tex, aspect }. */
const textCache = new Map();
function smokeText(text) {
  if (textCache.has(text)) return textCache.get(text);
  const c = document.createElement('canvas'), g = c.getContext('2d'), font = 'italic 800 52px "Be Vietnam Pro", Nunito, "Segoe UI", system-ui, sans-serif';
  g.font = font; const w = Math.ceil(g.measureText(text).width) + 36, h = 84;
  c.width = w; c.height = h;
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.shadowColor = 'rgba(255,255,255,.95)'; g.shadowBlur = 12;
  g.lineWidth = 8; g.strokeStyle = 'rgba(255,255,255,.85)'; g.strokeText(text, w / 2, h / 2);
  g.shadowBlur = 0; g.fillStyle = '#4a4f5e'; g.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const out = { tex, aspect: w / h }; textCache.set(text, out); return out;
}
const PHRASES = ['ghê chưa…', 'ghê chưa!'];

export class SmokeFX {
  constructor(scene, max = 220) {
    this.group = new THREE.Group(); this.group.name = 'smoke'; scene.add(this.group);
    this.tex = softTexture();
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0, toneMapped: false }));
      s.visible = false; this.group.add(s); this.pool.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 0.05, puff: false });
    }
    this.next = 0;
    this.texts = [];   // chữ trong làn khói đang bay
  }
  emit(pos, size = 0.05, life = 2.2, vel = null) {
    const p = this.pool[this.next++ % this.pool.length];
    p.s.position.copy(pos); p.s.visible = true; p.life = 0; p.max = life; p.size = size; p.puff = !!vel;
    p.vx = vel ? vel.x : (Math.random() - 0.5) * 0.06; p.vy = vel ? vel.y : 0; p.vz = vel ? vel.z : (Math.random() - 0.5) * 0.06;
  }
  /** Phun khói từ miệng ra trước mặt (ngay sau khi thả tay xuống) + chữ nhỏ "ghê chưa" nằm trong làn khói. */
  exhale(a) {
    const m = a._mouth;
    let dx = -Math.sin(a.yaw || 0), dz = -Math.cos(a.yaw || 0);   // (hướng mặt: nhân vật nhìn -z, quay theo yaw)
    // camera đang ở sau lưng (góc mặc định): phả khói chếch sang trái (tay phải cầm thuốc) — như người thật hay làm — để làn khói
    // và chữ hiện ra cạnh đầu thay vì bị đầu che; camera ở trước / ngang: phả thẳng ra trước
    const cam = this.camera?.position;
    if (cam) {
      let cx = a.x - cam.x, cz = a.z - cam.z; const cl = Math.hypot(cx, cz) || 1; cx /= cl; cz /= cl;
      const behind = dx * cx + dz * cz;   // (>0: mặt quay cùng hướng nhìn của camera)
      if (behind > 0.2) { const k = Math.min(1, (behind - 0.2) / 0.5), lx = dz, lz = -dx; dx = dx * (1 - 0.65 * k) + lx * 0.95 * k; dz = dz * (1 - 0.65 * k) + lz * 0.95 * k; const l = Math.hypot(dx, dz); dx /= l; dz /= l; }
    }
    const head = Math.max(0.3, m.y - a.y), v = new THREE.Vector3(), p = new THREE.Vector3();
    for (let k = 0; k < 14; k++) {   // (một làn khói mỏng từ miệng — ít, như thật: ra chậm, toả nhẹ, bốc lên rồi tan)
      const sp = 0.16 + Math.random() * 0.22, side = (Math.random() - 0.5) * 0.16;
      v.set(dx * sp - dz * side, 0.05 + Math.random() * 0.08, dz * sp + dx * side);
      p.copy(m).addScaledVector(v, 0.12 * k / 14);   // (nối thành một dòng liền từ miệng)
      this.emit(p, head * (0.05 + Math.random() * 0.05), 2.2 + Math.random() * 1, v);
    }
    // chữ: giữa làn khói, trôi cùng tốc độ với khói (chậm dần, bốc nhẹ), tan cùng khói
    a._say = ((a._say || 0) + 1) % PHRASES.length;
    this.say({ at: m.clone().addScaledVector(new THREE.Vector3(dx, 0, dz), head * 0.3).add(new THREE.Vector3(0, head * 0.04, 0)), v: new THREE.Vector3(dx * 0.3, 0.08, dz * 0.3), text: PHRASES[a._say], h: head * 0.19 });   // (bắt đầu trước miệng một chút: không bị má che)
    a._exhaleAt = performance.now();
  }
  say(q) {
    if (this.texts.length >= 10) { const old = this.texts.shift(); this.group.remove(old.s); old.s.material.dispose(); }
    const { tex, aspect } = smokeText(q.text);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, toneMapped: false }));
    s.renderOrder = 10; s.position.copy(q.at); s.scale.set(q.h * aspect * 0.5, q.h * 0.5, 1); this.group.add(s);
    this.texts.push({ s, life: 0, max: 2.6, h: q.h, aspect, v: q.v.clone(), seed: Math.random() * 6 });
  }
  /** agents: danh sách có act/_tip/_mouth (đã được AvatarSystem tính). */
  update(dt, agents) {
    for (const a of agents) {
      if (!a) continue;
      const smoking = a.visible && a.act === 'smoke' && !!a._tip;
      // hết điếu / dập sớm: phun hơi cuối (trừ khi vừa phun xong)
      if (a._wasSmoke && !smoking && a.visible && a._mouth && performance.now() - (a._exhaleAt || 0) > 1500) this.exhale(a);
      a._wasSmoke = smoking;
      if (!smoking) { a._lastPh = undefined; continue; }
      a._smokeT = (a._smokeT || 0) + dt;
      if (a._smokeT > 0.28) { a._smokeT = 0; this.emit(a._tip, 0.03, 1.6); }
      // mỗi hơi rít: thuốc chạm miệng khi sin ≈ 1 (avatars.js 'smoke': tay = sin⁶); vừa kéo thuốc ra khỏi miệng (sin qua 0,9 đi xuống) thì phà khói
      const ph = Math.sin((a.actT || 0) * 0.9);
      if (a._lastPh > 0.9 && ph <= 0.9 && a._mouth) this.exhale(a);
      a._lastPh = ph;
    }
    for (const p of this.pool) {
      if (!p.s.visible) continue;
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) { p.s.visible = false; continue; }
      if (p.puff) { const d = Math.exp(-dt * 1.5); p.vx *= d; p.vz *= d; p.vy = p.vy * Math.exp(-dt * 0.5) + 0.05 * dt; }   // (phụt ra rồi chậm lại, bốc lên)
      p.s.position.x += p.vx * dt; p.s.position.z += p.vz * dt; p.s.position.y += (p.puff ? p.vy : 0.22 - 0.1 * k) * dt;
      const sz = p.size * (1 + (p.puff ? 5.5 : 5) * k); p.s.scale.set(sz, sz, 1);
      p.s.material.opacity = (p.puff ? 0.8 : 0.55) * (1 - k) * Math.min(1, p.life * 5);
    }
    // chữ trong khói: hiện dần, nở ra như khói, trôi theo luồng (chậm dần), tan dần
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i]; t.life += dt;
      const k = t.life / t.max;
      if (k >= 1) { this.group.remove(t.s); t.s.material.dispose(); this.texts.splice(i, 1); continue; }
      const d = Math.exp(-dt * 1.5); t.v.x *= d; t.v.z *= d; t.v.y = t.v.y * Math.exp(-dt * 0.5) + 0.05 * dt;
      t.s.position.x += t.v.x * dt; t.s.position.y += t.v.y * dt; t.s.position.z += t.v.z * dt;
      const h = t.h * (0.55 + 0.6 * Math.min(1, k * 2.4));
      t.s.scale.set(h * t.aspect, h, 1);
      t.s.material.rotation = Math.sin(t.life * 3 + t.seed) * 0.05;
      t.s.material.opacity = Math.min(1, t.life * 4) * (k > 0.55 ? 1 - (k - 0.55) / 0.45 : 1);
    }
  }
}
