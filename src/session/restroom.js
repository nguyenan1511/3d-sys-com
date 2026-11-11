// Nhà vệ sinh (tầng trệt, cạnh sảnh — dựng sẵn trong nội thất my-office: 2 buồng có cửa, bồn rửa tay, gương):
//  - đứng trước cửa buồng bấm E → vào buồng (server giữ chỗ: mỗi buồng một người). Có người thì cửa đóng, đèn báo đỏ;
//    người khác bấm E sẽ bị người bên trong quát ra (câu tức giận hiện trên cửa cho mọi người gần đó thấy, cửa rung).
//    Trong buồng: bấm E hoặc nút "Ra khỏi buồng" để ra.
//  - bồn rửa tay: gương phản chiếu thật (three.js Reflector — chỉ vẽ khi mình đứng gần, đỡ tốn máy). Bấm E "Soi gương":
//    nhân vật quay vào gương, camera đứng sau vai nhìn vào gương; bước đi / E / Esc là thôi soi.
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { PRO_FX } from '../vendor/my-office/src/office/world/pro/pieces.js';
import { moToBuilding } from '../myoffice/building.js';

// toạ độ trong khung của my-office (world/pro/floor.js: "restrooms")
// (gương kéo dài xuống so với khung gốc: nhân vật chibi thấp vẫn thấy mặt mình)
const STALL_Z = [6.1, 7.4], DOOR_X = -6.75, MIRROR = { x: -7.958, y: 1.4, z: 8.5, w: 0.72, h: 1.04 }, SINK_STAND = { x: -7.28, z: 8.5 };
const ease = (k, dt) => 1 - Math.exp(-k * dt);
const MIRROR_LAYER = 5;

export class Restroom {
  constructor(session) {
    this.s = session; this.app = session.app; this.state = { stalls: [null, null] }; this.inside = -1; this.mirror = null; this.angry = [];
    const root = this.app.bldRoot; root.updateMatrixWorld(true);
    const W = (x, z, h = 0) => { const b = moToBuilding(x, z); return root.localToWorld(new THREE.Vector3(b.x, b.y + h, b.z)); };
    this.y0 = this.app.model.floorY(0);
    this.stalls = STALL_Z.map((z, i) => ({ i, out: W(DOOR_X + 0.45, z), in: W(-7.32, z), door: W(DOOR_X, z, 2.05), fx: PRO_FX.stalls[i] || null, open: 1, rattle: 0 }));
    this.sink = W(SINK_STAND.x, SINK_STAND.z); this.mirrorPos = W(MIRROR.x, MIRROR.z, MIRROR.y);
    const rt = session.rt;
    rt.on('hello', m => { if (m.wc) this.apply(m.wc); });
    rt.on('wc', m => this.apply(m.state));
    rt.on('wcAngry', m => this.onAngry(m));
    rt.on('wcKnock', m => session.toast(`🚪 ${m.by} đang gõ cửa buồng của bạn…`));
    this.onKey = e => {   // (trong buồng: bàn phím di chuyển đã khoá — E / Esc để ra)
      if (this.inside < 0 || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
      if (e.key === 'e' || e.key === 'E' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.leave(); }
    };
    window.addEventListener('keydown', this.onKey, true);
  }
  get locked() { return this.inside >= 0; }

  // ---------- buồng ----------
  /** Buồng có cửa trước mặt (đứng ngoài, < 0,7 m) — hoặc null. */
  nearStall(x, z, f) { if (f !== 0 || this.inside >= 0) return null; for (const st of this.stalls) if (Math.hypot(x - st.out.x, z - st.out.z) < 0.7) return st; return null; }
  nearSink(x, z, f) { return f === 0 && this.inside < 0 && Math.hypot(x - this.sink.x, z - this.sink.z) < 0.75; }
  prompt(st) { const o = this.state.stalls[st.i]; return o ? `<b>E</b> gõ cửa (${o.display} đang ở trong)` : '<b>E</b> vào buồng vệ sinh'; }
  enter(st) { this.s.rt.send({ t: 'wc:enter', stall: st.i }); }
  leave() { this.s.rt.send({ t: 'wc:leave' }); this.exitStall(); }
  apply(state) {
    this.state = state;
    const me = this.s.key, i = state.stalls.findIndex(x => x?.key === me);
    if (i >= 0 && this.inside !== i) this.enterStall(i);
    else if (i < 0 && this.inside >= 0) this.exitStall();
  }
  enterStall(i) {
    const pl = this.s.player, a = pl?.agent, st = this.stalls[i]; if (!a) return;
    this.endMirror();
    this.inside = i; pl.stopPath?.(); pl.vx = pl.vz = 0; pl.keys = {};
    Object.assign(a, { x: st.in.x, z: st.in.z, y: this.y0, f: 0, yaw: Math.atan2(-(st.out.x - st.in.x), -(st.out.z - st.in.z)) + Math.PI });
    pl.setAct?.(null); pl.send?.(true);
    this.showCard(true);
  }
  exitStall() {
    const i = this.inside; if (i < 0) return;
    this.inside = -1; const pl = this.s.player, a = pl?.agent, st = this.stalls[i];
    if (a) { Object.assign(a, { x: st.out.x, z: st.out.z, y: this.y0, f: 0, yaw: Math.atan2(-(st.out.x - st.in.x), -(st.out.z - st.in.z)) }); pl.send?.(true); pl.follow?.(); }
    this.showCard(false);
  }
  showCard(on) {
    if (!this.card) {
      const c = this.card = document.createElement('div'); c.className = 'wc-card'; c.setAttribute('role', 'status');
      c.innerHTML = '<b>🚽 Bạn đang ở trong buồng vệ sinh</b><span>Cửa đã khoá — người khác không vào được.</span><button type="button">Ra khỏi buồng (E)</button>';
      c.querySelector('button').onclick = () => this.leave();
      document.getElementById('appRoot').appendChild(c);
    }
    this.card.hidden = !on; if (on) requestAnimationFrame(() => this.card.classList.add('show')); else this.card.classList.remove('show');
  }
  /** Người trong buồng quát ra: bong bóng trên cửa buồng (mọi người gần thấy), cửa rung; người gõ cửa nhận thông báo. */
  onAngry(m) {
    const st = this.stalls[m.stall]; if (!st) return;
    st.rattle = 0.7;
    const a = this.s.player?.agent;
    if (m.knocker === (this.s.isAdmin ? `CEO (${this.s.me.admin.username})` : this.s.me.employee?.display)) this.s.toast(`😡 ${m.by} (trong buồng): «${m.text}»`, true);
    if (!a || a.f !== 0 || Math.hypot(a.x - st.out.x, a.z - st.out.z) > 12) return;
    const sp = angrySprite(m.text); sp.position.copy(st.door); sp.position.y += 0.25; this.app.scene.add(sp);
    this.angry.push({ sp, t: 3.5 });
  }

  // ---------- gương ----------
  ensureMirror() {
    if (this.mirror) return this.mirror;
    const dpr = Math.min(1.5, this.app.renderer.getPixelRatio());
    const m = this.mirror = new Reflector(new THREE.PlaneGeometry(MIRROR.w, MIRROR.h), { textureWidth: Math.round(360 * dpr), textureHeight: Math.round(425 * dpr), color: 0xc8d0d6, clipBias: 0.003 });
    m.position.copy(this.mirrorPos); m.position.x += 0.004; m.rotation.y = Math.PI / 2;   // (mặt gương nhìn vào phòng, +x)
    m.name = 'wcMirror'; m.visible = false; this.app.scene.add(m);
    return m;
  }
  startMirror() {
    const pl = this.s.player, a = pl?.agent; if (!a) return;
    this.ensureMirror(); pl.stopPath?.(); pl.setAct?.(null);
    Object.assign(a, { x: this.sink.x, z: this.sink.z, yaw: Math.atan2(-(this.mirrorPos.x - this.sink.x), -(this.mirrorPos.z - this.sink.z)) }); pl.send?.(true);
    this.looking = { x: a.x, z: a.z };
    // góc nhìn ngang tầm mắt (hơi cao hơn đầu, nhìn xuống gương): nhân vật của mình ẩn khỏi camera chính nhưng vẫn hiện
    // trong gương (lớp 5: camera phản chiếu thấy, camera chính không) — như đứng soi gương thật, không bị cái đầu che
    const dir = new THREE.Vector3(this.mirrorPos.x - a.x, 0, this.mirrorPos.z - a.z).normalize(), cs = this.app.model.cs || 1;
    const eye = new THREE.Vector3(a.x, this.y0 + 1.62 * cs, a.z).addScaledVector(dir, -0.42);
    const look = this.mirrorPos.clone(); look.y = this.y0 + 1.3 * cs;
    this.mirror.getReflectionCamera(this.app.camera).layers.enable(MIRROR_LAYER);
    this.hideSelf(true);
    this.app.setCamOverride?.({ eye, look });
    this.s.toast('🪞 Đang soi gương — bước đi, bấm E hoặc Esc để thôi.');
  }
  endMirror() { if (!this.looking) return; this.looking = null; this.app.setCamOverride?.(null); this.hideSelf(false); }
  /** Nhân vật của mình: chỉ hiện trong gương (lớp riêng) hoặc trở lại bình thường. */
  hideSelf(on) {
    const a = this.s.player?.agent, it = a && this.s.remote?.sys?.mo?.inst?.get(a);
    a && (a._mirror = on);
    it?.group.traverse(o => { if (on) o.layers.set(MIRROR_LAYER); else o.layers.set(0); });
  }

  /** (mỗi khung hình) cửa buồng, đèn báo, bong bóng quát, gương. */
  update(dt) {
    for (const st of this.stalls) {
      const busy = !!this.state.stalls[st.i];
      st.open += ((busy ? 0 : 1) - st.open) * ease(5, dt);
      if (st.fx) {
        st.rattle = Math.max(0, st.rattle - dt);
        st.fx.pivot.rotation.y = st.open * 1.25 + (st.rattle > 0 ? Math.sin(st.rattle * 60) * 0.03 * st.rattle : 0);
        st.fx.sign.color.set(busy ? '#ff4d4d' : '#3ddc84');
      }
    }
    for (let i = this.angry.length - 1; i >= 0; i--) {
      const q = this.angry[i]; q.t -= dt; q.sp.material.opacity = Math.min(1, q.t / 0.4); q.sp.position.y += dt * 0.04;
      if (q.t <= 0) { this.app.scene.remove(q.sp); q.sp.material.map.dispose(); q.sp.material.dispose(); this.angry.splice(i, 1); }
    }
    const a = this.s.player?.agent; if (!a) return;
    if (this.inside >= 0) { const st = this.stalls[this.inside]; a.x = st.in.x; a.z = st.in.z; a.y = this.y0; }   // (trong buồng: đứng yên)
    if (this.looking && (Math.hypot(a.x - this.looking.x, a.z - this.looking.z) > 0.05 || a.f !== 0)) this.endMirror();
    else if (this.looking) this.hideSelf(true);   // (nhân vật có thể vừa được dựng lại)
    // gương chỉ vẽ khi mình ở gần (cùng tầng, < 4,5 m) — Reflector vẽ lại cả cảnh mỗi khung hình
    const near = a.f === 0 && Math.hypot(a.x - this.mirrorPos.x, a.z - this.mirrorPos.z) < 4.5;
    if (near) this.ensureMirror();
    if (this.mirror) this.mirror.visible = near;
  }
  /** Esc khi đang soi gương. */
  escape() { if (this.looking) { this.endMirror(); return true; } return false; }
}

function angrySprite(text) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), F = '700 30px system-ui, sans-serif';
  g.font = F; const W = Math.ceil(g.measureText(text).width) + 40, H = 58; c.width = W; c.height = H + 14; g.font = F;
  g.fillStyle = '#ff3b3b'; g.beginPath(); g.roundRect(0, 0, W, H, 16); g.fill();
  g.beginPath(); g.moveTo(W / 2 - 12, H); g.lineTo(W / 2, H + 14); g.lineTo(W / 2 + 12, H); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, 20, H / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.center.set(0.5, 0); s.scale.set(0.034 * c.width / 56, 0.034 * c.height / 56, 1); s.renderOrder = 20;
  return s;
}
