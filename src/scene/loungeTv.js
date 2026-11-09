// Khu giải trí (tầng trệt, nội thất my-office): ngồi sofa xem TV. Đứng trước sofa bấm E để ngồi (hai chỗ), TV tự bật khi có
// người ngồi xem (mình hoặc người online khác) và tắt khi không còn ai. Màn hình vẽ kênh "SYSONE TV" (vẽ bằng canvas).
import { GTV, SCREEN_W, SCREEN_H } from '../vendor/my-office/src/office/world/props/game-tv.js';
import { LAY } from '../vendor/my-office/src/office/world/layout.js';
import { toWorld } from '../myoffice/shellSpec.js';

export class LoungeTv {
  constructor(model) {
    this.model = model; this.on = false; this.t = 0; this.drawT = 0;
    const [sx, sz, , r] = LAY.sofa || [11.0, 3.95, 2.2, Math.PI];
    const c = Math.cos(r), s = Math.sin(r), at = (lx, lz) => toWorld(sx + lx * c + lz * s, sz - lx * s + lz * c);
    // hai chỗ ngồi trên sofa (toạ độ sofa: x dọc sofa, z ra phía trước), quay mặt về phía trước (về TV):
    // yaw sao cho hướng nhìn (-sin, -cos) trỏ từ chỗ ngồi ra điểm trước sofa
    this.seats = [-0.5, 0.5].map((lx, i) => {
      const [x, z] = at(lx, 0.02), [fx, fz] = at(lx, 0.62);
      return { id: 'sofa-' + (i + 1), x, z, front: { x: fx, z: fz }, yaw: Math.atan2(-(fx - x), -(fz - z)), f: 0 };
    });
    this.center = (() => { const [x, z] = at(0, 0.3); return { x, z }; })();
  }
  /** Chỗ ngồi gần (x, z) trên tầng f (trong bán kính r). */
  near(x, z, f, r = 1.1) {
    if (f !== 0) return null;
    let best = null, bd = r;
    for (const s of this.seats) { const d = Math.min(Math.hypot(x - s.front.x, z - s.front.z), Math.hypot(x - s.x, z - s.z)); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  /** Ghế còn trống (không có ai trong danh sách người đang ngồi xem). */
  free(seat, others) { return !others.some(a => a.act === 'tv' && Math.hypot(a.x - seat.x, a.z - seat.z) < 0.35); }
  update(dt, watching) {
    if (!GTV || this.yt) return; // (đang chiếu video YouTube của loa công ty: không vẽ kênh SYSONE TV)
    this.t += dt;
    if (watching !== this.on) { this.on = watching; this.drawT = 0; if (!watching) this.off(); }
    if (!watching) return;
    this.drawT -= dt; if (this.drawT > 0) return; this.drawT = 1 / 12;
    this.draw();
  }
  off() {
    const c = GTV.ctx; c.fillStyle = '#05070a'; c.fillRect(0, 0, SCREEN_W, SCREEN_H); GTV.tex.needsUpdate = true;
    GTV.glowM.opacity = 0; GTV.led.material.color?.set('#D63A3A');
  }
  /** Kênh SYSONE TV: nền chuyển màu, sóng nhạc, tên kênh, giờ, dòng chữ chạy. */
  draw() {
    const c = GTV.ctx, W = SCREEN_W, H = SCREEN_H, t = this.t;
    const hue = (t * 12) % 360, g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `hsl(${hue},70%,38%)`); g.addColorStop(1, `hsl(${(hue + 60) % 360},70%,22%)`);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // sóng nhạc
    c.fillStyle = 'rgba(255,255,255,.18)';
    for (let i = 0; i < 32; i++) { const h = (Math.sin(t * 3 + i * 0.7) * 0.5 + 0.5) * (Math.sin(t * 1.3 + i * 0.31) * 0.5 + 0.6) * 70; c.fillRect(16 + i * 11, H - 52 - h, 7, h); }
    // tên kênh, giờ
    c.fillStyle = '#ffffff'; c.font = 'bold 28px sans-serif'; c.textBaseline = 'top'; c.fillText('SYSONE TV', 18, 16);
    c.fillStyle = '#ffb23f'; c.beginPath(); c.arc(W - 30, 30, 8 + Math.sin(t * 4) * 1.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff'; c.font = 'bold 14px sans-serif'; c.fillText('LIVE', W - 76, 23);
    // dòng chữ chạy
    c.fillStyle = 'rgba(0,0,0,.45)'; c.fillRect(0, H - 34, W, 34);
    c.fillStyle = '#ffffff'; c.font = 'bold 16px sans-serif'; c.textBaseline = 'middle';
    const msg = 'Chào mừng tới khu giải trí SYSONE  •  Nghỉ ngơi một chút rồi quay lại làm việc nhé  •  ', w = c.measureText(msg).width, x = -((t * 40) % w);
    c.fillText(msg + msg + msg, x, H - 17);
    GTV.tex.needsUpdate = true;
    GTV.glowM.color.setHSL(hue / 360, 0.7, 0.5); GTV.glowM.opacity = 0.35;
  }
}
