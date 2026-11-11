// Phòng bi-a 3D riêng: một phòng câu lạc bộ nhỏ (đèn treo trên bàn, giá cơ, đèn neon), bàn lỗ 8 bi, 16 viên bi có số,
// cây cơ, hai người chơi là nhân vật thật của họ. Luật / vật lý dùng chung với server (src/shared/billiards.js): server
// tính cú đánh, mọi máy diễn lại cùng đường lăn.
//
// Tới lượt mình: camera đứng sau bi chủ nhìn theo hướng ngắm (kiểu game bi-a), có đường ngắm dự đoán (bi ma, hướng bi
// mục tiêu). Kéo ngang để xoay hướng ngắm (giữ Shift: xoay chậm), chạm vào một viên bi để ngắm thẳng vào nó, kéo thanh
// Lực rồi thả để đánh (máy tính: giữ Space rồi thả). Lúc bi lăn / lượt đối thủ: camera nhìn toàn bàn, kéo để xoay quanh.
// Nút "Nhìn từ trên" xem cả bàn từ trên xuống.
import * as THREE from 'three';
import { PX, PZ, BALL_R, POCKETS, groupOf } from '../shared/billiards.js';
import { esc } from '../session/ui.js';
import { icon } from '../ui/icons.js';
import { OrbitCam, Cast, bindGestures, roomBox, woodFloorTex, neonSign, poster, canvasTex, std, sfx, yawFacing, logoSign } from './kit.js';

const CY = 0.79, BY = CY + BALL_R;                // mặt nỉ, tâm bi
const CW = 0.035, RW = 0.075, OX = PX + CW + RW, OZ = PZ + CW + RW;   // băng, thành gỗ, nửa kích thước ngoài
const W = 3.4, D = 3.9, H = 2.75;                // nửa chiều rộng / sâu phòng, chiều cao
const BALL_COL = ['#f7f4ea', '#f2c230', '#2350a8', '#d2302a', '#5b2d8e', '#e9762b', '#1f7a45', '#7a1f2b', '#15161a'];
const colOf = n => BALL_COL[n <= 8 ? n : n - 8];
const GROUP_LABEL = { solid: 'Bi trơn', stripe: 'Bi sọc' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isTouch = () => matchMedia('(pointer: coarse)').matches;
const _ax = new THREE.Vector3(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();

function ballTex(n) {
  return canvasTex(256, 128, (g, w, h) => {
    const col = colOf(n);
    g.fillStyle = n >= 9 || n === 0 ? '#f4f1e6' : col; g.fillRect(0, 0, w, h);
    if (n >= 9) { g.fillStyle = col; g.fillRect(0, h * 0.28, w, h * 0.44); }
    for (const cx of [w * 0.25, w * 0.75]) {
      if (!n) { g.fillStyle = '#c8322a'; g.beginPath(); g.arc(cx, h / 2, 4, 0, Math.PI * 2); g.fill(); continue; }
      g.fillStyle = '#f7f4ea'; g.beginPath(); g.ellipse(cx, h / 2, 15, 16, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#16161a'; g.font = `700 ${n >= 10 ? 17 : 20}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), cx, h / 2 + 1);
    }
  });
}

/** Cây cơ: gốc toạ độ ở đầu cơ, thân kéo dài về phía -Z. */
function cueStick() {
  const g = new THREE.Group(), L = 1.2;
  const part = (len, r0, r1, z0, color, o = {}) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, 14), std(color, { roughness: 0.45, ...o }));
    m.rotation.x = Math.PI / 2; m.position.z = -(z0 + len / 2); m.castShadow = true; g.add(m); return m;
  };
  part(0.008, 0.0052, 0.0054, 0, '#3f6fb8', { roughness: 0.9 });          // đầu cơ (phấn xanh)
  part(0.02, 0.0055, 0.0058, 0.008, '#f3efe6');                             // khâu trắng
  part(L * 0.6, 0.0058, 0.0095, 0.028, '#e3c896');                          // thân gỗ thích
  part(L * 0.06, 0.0095, 0.0102, 0.028 + L * 0.6, '#1d1f24', { metalness: 0.3, roughness: 0.3 });
  part(L * 0.25, 0.0102, 0.0125, 0.028 + L * 0.66, '#7a2a24');              // tay cầm quấn
  part(L * 0.08, 0.0125, 0.013, 0.028 + L * 0.91, '#1d1f24');
  return g;
}

/** Dải phẳng nằm trên mặt bàn (đường ngắm). */
function strip(color, opacity) {
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, 0.5);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false }));
  m.renderOrder = 3; m.visible = false;
  m.set = (x1, z1, x2, z2, w = 0.006) => { const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz); m.visible = l > 0.002; m.position.set(x1, CY + 0.0015, z1); m.rotation.y = Math.atan2(dx, dz); m.scale.set(w, 1, l); };
  return m;
}

export class BilliardsRoom {
  constructor(app, bil) {
    this.kind = 'billiards'; this.app = app; this.bil = bil;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#17201e');
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.03, 40);
    this.high = (app.quality || 'high') !== 'low';
    const sh = this.high && app.renderer?.shadowMap.enabled;
    if (app.envMap) { scene.environment = app.envMap; scene.environmentIntensity = 0.35; }

    // ---- phòng ----
    const room = roomBox(W, D, H, {
      floor: std('#ffffff', { map: woodFloorTex('#5b3d2a', [4, 4]), roughness: 0.6 }),
      wall: std('#24403a', { roughness: 0.92 }), wainscot: std('#4a2f1f', { roughness: 0.55 }), ceil: '#1b1d22'
    });
    scene.add(room.group);
    scene.add(new THREE.HemisphereLight('#ffe9d2', '#2a2018', 0.7));
    const spot = new THREE.SpotLight('#fff1dc', 11, 6, 1.0, 0.85, 1.2); spot.position.set(0, 1.92, 0); spot.target.position.set(0, CY, 0);
    if (sh) { spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.01; spot.shadow.radius = 3; }
    scene.add(spot, spot.target);
    const warm = new THREE.PointLight('#ffb36b', 4, 7, 1.8); warm.position.set(W - 0.6, 2.1, D - 0.8); scene.add(warm);
    this.decor(scene);

    // ---- bàn ----
    this.table(scene, sh);
    // bi
    const bg = new THREE.SphereGeometry(BALL_R, 28, 18);
    this.balls = [];
    for (let n = 0; n < 16; n++) {
      const m = new THREE.Mesh(bg, std('#ffffff', { map: ballTex(n), roughness: 0.16, metalness: 0, envMapIntensity: 1.4 }));
      m.castShadow = !!sh; m.quaternion.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      m.userData.n = n; m.userData.drop = 0; scene.add(m); this.balls.push(m);
    }
    this.cue = cueStick(); this.cue.visible = false; scene.add(this.cue);
    // đường ngắm dự đoán
    this.gLine = strip('#ffffff', 0.55); this.gObj = strip('#ffe08a', 0.75); this.gCue = strip('#ffffff', 0.25);
    this.ghost = new THREE.Mesh(new THREE.RingGeometry(BALL_R * 0.86, BALL_R, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    this.ghost.rotation.x = -Math.PI / 2; this.ghost.renderOrder = 3; this.ghost.visible = false;
    scene.add(this.gLine, this.gObj, this.gCue, this.ghost);

    this.cast = new Cast(scene, app);
    this.cam = new OrbitCam(this.camera, { t: new THREE.Vector3(0, CY, 0), th: Math.PI, ph: 0.85, r: 2.7, lim: { ph: [0.02, 1.32], r: [0.45, 3.6] }, box: { x: W - 0.15, z: D - 0.15, y: H - 0.12 }, k: 7 });

    this.mode = null; this.top = false; this.aimA = 0; this.power = 0; this.charging = false; this.strike = null;
    this.lastSeq = -1; this.res = null; this.prevOn = [];
    this.buildUi();
    this.cast.attach(this.ui);
  }
  resize(w, h) { this.cast.setSize(w, h); }
  afterRender() { this.cast.render(this.camera); }

  // ---------- dựng cảnh ----------
  table(scene, sh) {
    const cloth = std('#1a6a3d', { roughness: 0.95, map: canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    }, { repeat: [3, 6] }) });
    const cush = std('#155a33', { roughness: 0.9 }), wood = std('#4a2716', { roughness: 0.42, metalness: 0.05 }), dark = std('#2a1a10', { roughness: 0.5 });
    const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = !!sh; m.receiveShadow = true; scene.add(m); return m; };
    box((PX + CW) * 2, 0.04, (PZ + CW) * 2, cloth, 0, CY - 0.02, 0);
    // băng (có khe ở 6 lỗ)
    const zc = 0.075, zs = 0.052;
    for (const s of [-1, 1]) {
      const len = PZ - zc - zs; box(CW, 0.032, len, cush, s * (PX + CW / 2), CY + 0.016, zs + len / 2); box(CW, 0.032, len, cush, s * (PX + CW / 2), CY + 0.016, -(zs + len / 2));
      box((PX - zc) * 2, 0.032, CW, cush, 0, CY + 0.016, s * (PZ + CW / 2));
      box(RW, 0.06, OZ * 2, wood, s * (PX + CW + RW / 2), CY + 0.01, 0);
      box(OX * 2, 0.06, RW, wood, 0, CY + 0.01, s * (PZ + CW + RW / 2));
    }
    box(OX * 2 - 0.02, 0.16, OZ * 2 - 0.02, wood, 0, CY - 0.1, 0);
    box(OX * 2 - 0.12, 0.05, OZ * 2 - 0.12, dark, 0, CY - 0.2, 0);
    const legG = new THREE.CylinderGeometry(0.05, 0.038, CY - 0.2, 14);
    for (const x of [-1, 1]) for (const z of [-1, 0, 1]) { const l = new THREE.Mesh(legG, wood); l.position.set(x * (OX - 0.1), (CY - 0.2) / 2, z * (OZ - 0.14)); l.castShadow = !!sh; scene.add(l); }
    // lỗ + túi da
    const hole = new THREE.MeshBasicMaterial({ color: '#060606' }), cup = std('#141414', { roughness: 0.6 });
    for (const P of POCKETS) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(P.r * 0.92, P.r * 0.8, 0.05, 24), hole); h.position.set(P.x, CY - 0.024, P.z); scene.add(h);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(P.r * 0.9 + 0.01, P.r * 0.9 + 0.01, 0.012, 28, 1, true), cup); c.position.set(P.x, CY + 0.036, P.z); scene.add(c);
      const o = new THREE.Mesh(new THREE.CircleGeometry(P.r * 0.9, 28).rotateX(-Math.PI / 2), hole); o.position.set(P.x, CY + 0.0405, P.z);
      // (chỉ phần nằm trên thành gỗ — miệng lỗ trên mặt nỉ để trống cho bi rơi vào)
      o.renderOrder = -1; o.material = hole; scene.add(o);
    }
    // điểm ngắm (kim cương) trên thành gỗ, chấm đầu / cuối bàn
    const dia = new THREE.MeshBasicMaterial({ color: '#f1e6c8' }), dg = new THREE.CircleGeometry(0.007, 10); dg.rotateX(-Math.PI / 2);
    for (const s of [-1, 1]) {
      for (const k of [-3, -2, -1, 1, 2, 3]) { const m = new THREE.Mesh(dg, dia); m.position.set(s * (PX + CW + RW / 2), CY + 0.041, k * PZ / 4); scene.add(m); }
      for (const k of [-1, 1]) { const m = new THREE.Mesh(dg, dia); m.position.set(k * PX / 2, CY + 0.041, s * (PZ + CW + RW / 2)); scene.add(m); }
      const spotM = new THREE.Mesh(new THREE.CircleGeometry(0.006, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#d9e6dc' })); spotM.position.set(0, CY + 0.0008, s * PZ / 2); scene.add(spotM);
    }
    // đèn treo
    const lamp = this.lamp = new THREE.Group(); scene.add(lamp);
    const shade = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.09, 1.3), std('#14402c', { roughness: 0.4, metalness: 0.3 })); shade.position.set(0, 1.98, 0); lamp.add(shade);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 1.24), new THREE.MeshBasicMaterial({ color: '#fff3d6', toneMapped: false })); glow.rotation.x = Math.PI / 2; glow.position.set(0, 1.934, 0); lamp.add(glow);
    for (const z of [-0.5, 0.5]) { const rod = new THREE.Mesh(new THREE.BoxGeometry(0.01, H - 2.02, 0.01), std('#222')); rod.position.set(0, (H + 2.02) / 2, z); lamp.add(rod); }
  }
  decor(scene) {
    // chữ neon
    const n1 = neonSign('BI-A', '#ff4fa3', { h: 0.34 }); n1.position.set(-0.4, 1.95, -D + 0.02); scene.add(n1);
    const n2 = neonSign('8 BALL', '#42e8ff', { h: 0.2 }); n2.position.set(0.55, 1.62, -D + 0.02); scene.add(n2);
    // biển logo SYSONE: tường trái (thấy khi xem ngang bàn), tường sau ghế dài (thấy khi ngắm từ đầu bàn), tường neon
    const l1 = logoSign(1.3); l1.position.set(-W + 0.03, 2.05, -1.5); l1.rotation.y = Math.PI / 2; scene.add(l1);
    const l2 = logoSign(1.5); l2.position.set(-0.9, 1.75, D - 0.03); l2.rotation.y = Math.PI; scene.add(l2);
    const l3 = logoSign(1.1); l3.position.set(0.3, 2.3, -D + 0.03); scene.add(l3);
    // giá cơ trên tường trái
    const rack = new THREE.Group(); rack.position.set(-W + 0.04, 0, 0.6); rack.rotation.y = Math.PI / 2; scene.add(rack);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.04), std('#3b2416', { roughness: 0.5 })); board.position.set(0, 1.25, 0); rack.add(board);
    for (let i = 0; i < 6; i++) { const c = cueStick(); c.scale.setScalar(1.05); c.rotation.x = -Math.PI / 2; c.position.set(-0.36 + i * 0.145, 1.92, 0.05); rack.add(c); }
    // tranh trên tường phải
    const pal = [['#e9762b', '#f2c230', '#2350a8'], ['#d2302a', '#15161a', '#f7f4ea']];
    pal.forEach((p, i) => {
      const pic = poster(0.7, 0.95, (g, w, h) => {
        g.fillStyle = p[2]; g.fillRect(0, 0, w, h);
        g.fillStyle = p[0]; g.beginPath(); g.arc(w * 0.5, h * 0.42, w * 0.3, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(w * 0.5, h * 0.42, w * 0.12, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#111'; g.font = '700 40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i ? 8 : 9), w * 0.5, h * 0.43);
        g.fillStyle = p[1]; g.fillRect(w * 0.1, h * 0.8, w * 0.8, h * 0.05);
      });
      pic.position.set(W - 0.02, 1.6, -1.2 + i * 1.1); pic.rotation.y = -Math.PI / 2; scene.add(pic);
    });
    // ghế đôn + bàn cao
    const metal = std('#2a2c31', { metalness: 0.6, roughness: 0.35 }), seat = std('#8a2b26', { roughness: 0.6 });
    const stool = (x, z) => { const g = new THREE.Group(); g.position.set(x, 0, z);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.66, 8), metal); p.position.y = 0.33; g.add(p);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.015, 18), metal); b.position.y = 0.01; g.add(b);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.06, 18), seat); s.position.y = 0.69; g.add(s); scene.add(g); };
    stool(W - 0.55, D - 1.5); stool(W - 1.25, D - 0.55);
    const tb = new THREE.Group(); tb.position.set(W - 0.6, 0, D - 0.6); scene.add(tb);
    const tt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 22), std('#4a2f1f', { roughness: 0.45 })); tt.position.y = 1.0; tb.add(tt);
    const tp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 8), metal); tp.position.y = 0.5; tb.add(tp);
    for (const [x, z, c] of [[0.08, 0.05, '#e9a23b'], [-0.1, -0.04, '#d9e4ea']]) { const g = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.12, 12), std(c, { transparent: true, opacity: 0.85, roughness: 0.1 })); g.position.set(x, 1.08, z); tb.add(g); }
    // ghế dài sát tường sau
    const sofa = std('#5b2a26', { roughness: 0.8 });
    const sb = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.42, 0.5), sofa); sb.position.set(-0.9, 0.21, D - 0.3); scene.add(sb);
    const sk = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 0.14), sofa); sk.position.set(-0.9, 0.62, D - 0.08); scene.add(sk);
    // cây xanh ở góc
    const leaf = std('#2f7a3a', { roughness: 0.8 }), pot = std('#c9b9a3', { roughness: 0.7 });
    for (const [x, z] of [[-W + 0.4, -D + 0.4], [W - 0.4, -D + 0.4]]) {
      const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.4, 16), pot); p.position.y = 0.2; g.add(p);
      for (let i = 0; i < 6; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.17 + (i % 3) * 0.03, 10, 8), leaf); l.position.set(Math.cos(i) * 0.12, 0.55 + (i % 3) * 0.18, Math.sin(i * 2) * 0.12); g.add(l); }
    }
  }

  // ---------- giao diện ----------
  buildUi() {
    const ui = this.ui = document.createElement('section'); ui.className = 'room-ui bil3'; ui.hidden = true; ui.tabIndex = -1;
    ui.setAttribute('role', 'dialog'); ui.setAttribute('aria-label', 'Phòng bi-a');
    ui.innerHTML = `<div class="rm-input" aria-hidden="true"></div>
      <header class="rm-top"><button type="button" class="rm-back">${icon('chevLeft', 16)}<span>Rời bàn</span></button>
        <b class="rm-title">🎱 Bi-a lỗ 8 bi</b>
        <div class="rm-tools"><button type="button" class="rm-cam" aria-pressed="false">Nhìn từ trên</button></div></header>
      <div class="b3-score"></div>
      <p class="rm-msg" role="status" aria-live="polite"></p>
      <div class="b3-shoot" hidden>
        <div class="b3-fine"><button type="button" data-fine="1" aria-label="Xoay ngắm sang trái">‹</button><button type="button" data-fine="-1" aria-label="Xoay ngắm sang phải">›</button></div>
        <div class="b3-power" role="slider" aria-label="Lực đánh: kéo xuống rồi thả" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><span>Lực</span><div class="b3-track"><i></i></div><small>kéo ↓ thả</small></div>
      </div>
      <p class="rm-hint"></p>
      <div class="rm-card" hidden></div>`;
    document.getElementById('appRoot').appendChild(ui);
    const q = c => ui.querySelector(c);
    this.q = q;
    q('.rm-back').onclick = () => this.bil.exitRoom(true);
    q('.rm-cam').onclick = () => { this.top = !this.top; q('.rm-cam').setAttribute('aria-pressed', String(this.top)); q('.rm-cam').classList.toggle('on', this.top); this.mode = null; };
    ui.querySelectorAll('[data-fine]').forEach(b => {
      let t = 0; const go = () => { this.turnAim(+b.dataset.fine * 0.0022); t = setTimeout(go, t ? 45 : 320); };
      b.addEventListener('pointerdown', e => { e.preventDefault(); t = 0; go(); });
      const stop = () => { clearTimeout(t); t = 0; }; b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop); b.addEventListener('pointercancel', stop);
    });
    // thanh lực: kéo xuống (lực theo quãng kéo), thả tay là đánh
    const pw = q('.b3-power'); let pid = null, y0 = 0;
    pw.addEventListener('pointerdown', e => { if (!this.canShoot()) return; pid = e.pointerId; pw.setPointerCapture(pid); y0 = e.clientY; this.setPower(0); pw.classList.add('on'); });
    pw.addEventListener('pointermove', e => { if (e.pointerId !== pid) return; const h = q('.b3-track').getBoundingClientRect().height || 200; this.setPower((e.clientY - y0) / h); });
    const rel = e => { if (e.pointerId !== pid) return; pid = null; pw.classList.remove('on'); this.release(); };
    pw.addEventListener('pointerup', rel); pw.addEventListener('pointercancel', e => { if (e.pointerId === pid) { pid = null; pw.classList.remove('on'); this.setPower(0); } });
    pw.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); this.setPower(this.power + 0.05); } else if (e.key === 'ArrowUp') { e.preventDefault(); this.setPower(this.power - 0.05); } else if (e.key === 'Enter') this.release(); });
    // thao tác trên cảnh
    const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BY), ndc = new THREE.Vector2();
    bindGestures(q('.rm-input'), {
      drag: (dx, dy, e) => {
        if (this.mode === 'aim') { this.turnAim(-dx * 0.0042 * (e.shiftKey ? 0.18 : 1)); this.cam.orbit(0, -dy * 0.004); }
        else if (this.mode === 'top') { /* (nhìn từ trên: không xoay) */ }
        else this.cam.orbit(-dx * 0.006, -dy * 0.004);
      },
      pinch: f => this.cam.zoom(f), wheel: f => this.cam.zoom(f),
      tap: e => {   // chạm vào bàn: ngắm thẳng vào điểm đó (bi gần nhất nếu chạm gần một viên)
        if (!this.canShoot()) return;
        const r = q('.rm-input').getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
        ray.setFromCamera(ndc, this.camera); if (!ray.ray.intersectPlane(plane, _v)) return;
        if (Math.abs(_v.x) > PX + 0.05 || Math.abs(_v.z) > PZ + 0.05) return;
        const bs = this.bil.balls(), c = bs[0]; let best = 0.06 ** 2, tx = _v.x, tz = _v.z;
        bs.forEach((b, i) => { if (i && b.on) { const d2 = (b.x - _v.x) ** 2 + (b.z - _v.z) ** 2; if (d2 < best) { best = d2; tx = b.x; tz = b.z; } } });
        if (Math.hypot(tx - c.x, tz - c.z) > 0.02) this.aimA = Math.atan2(tx - c.x, tz - c.z);
      }
    });
    this.onKey = e => {
      if (!this.app.rooms?.is('billiards') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
      const k = e.key, down = e.type === 'keydown';
      if (k === ' ') { e.preventDefault(); if (down && !e.repeat && this.canShoot()) { this.charging = true; this.setPower(0); } else if (!down && this.charging) { this.charging = false; this.release(); } return; }
      if (!down) return;
      const f = e.shiftKey ? 0.15 : 1;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); this.turnAim(0.02 * f); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); this.turnAim(-0.02 * f); }
      else if (k === 'ArrowUp' || k === 'w' || k === 'W') { e.preventDefault(); this.cam.orbit(0, -0.05); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); this.cam.orbit(0, 0.05); }
      else if (k === 't' || k === 'T') q('.rm-cam').click();
    };
  }
  enter() {
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKey);
    this.mode = null; this.top = false; this.q('.rm-cam').classList.remove('on');
    this.sync(true);
  }
  leave() { window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKey); this.charging = false; this.setPower(0); }

  // ---------- ngắm / đánh ----------
  canShoot() { return !this.bil.spectate && this.bil.myTurn() && !this.strike; }
  turnAim(da) { if (this.canShoot()) this.aimA += da; }
  setPower(p) {
    this.power = clamp(p, 0, 1);
    this.q('.b3-track i').style.transform = `scaleY(${this.power})`;
    this.q('.b3-power').setAttribute('aria-valuenow', String(Math.round(this.power * 100)));
    this.q('.b3-track').style.setProperty('--hue', String(110 - this.power * 110));
  }
  release() {
    const p = this.power;
    if (p < 0.04 || !this.canShoot()) { this.setPower(0); return; }
    // cơ lao tới bi rồi mới gửi cú đánh (server trả lại đường lăn chung cho cả bàn)
    this.strike = { t: 0, from: 0.02 + p * 0.22, ax: Math.sin(this.aimA), az: Math.cos(this.aimA), power: p };
  }
  /** Hướng hợp lý ban đầu: viên gần nhất thuộc nhóm của người đánh (chưa chia nhóm: viên gần nhất trừ bi 8). */
  autoAim(key) {
    const st = this.bil.state, bs = this.bil.balls(), c = bs[0], grp = st?.groups?.[key];
    const cleared = grp && !bs.some((b, n) => b.on && groupOf(n) === grp);
    let best = Infinity, a = 0;
    bs.forEach((b, n) => {
      if (!n || !b.on) return;
      if (cleared ? n !== 8 : grp ? groupOf(n) !== grp : n === 8) return;
      const d = Math.hypot(b.x - c.x, b.z - c.z); if (d < best) { best = d; a = Math.atan2(b.x - c.x, b.z - c.z); }
    });
    return best < Infinity ? a : Math.atan2(-c.x, -c.z);
  }
  /** Dự đoán: tia từ bi chủ theo hướng ngắm → chạm bi nào / băng nào. */
  predict(bs, a) {
    const c = bs[0], dx = Math.sin(a), dz = Math.cos(a), R2 = 2 * BALL_R;
    let t = Infinity, hit = -1;
    bs.forEach((b, i) => {
      if (!i || !b.on) return;
      const ox = b.x - c.x, oz = b.z - c.z, along = ox * dx + oz * dz; if (along <= 0) return;
      const perp2 = ox * ox + oz * oz - along * along; if (perp2 > R2 * R2) return;
      const tt = along - Math.sqrt(R2 * R2 - perp2); if (tt < t) { t = tt; hit = i; }
    });
    const lx = PX - BALL_R, lz = PZ - BALL_R;
    const tw = Math.min(dx > 0 ? (lx - c.x) / dx : dx < 0 ? (-lx - c.x) / dx : Infinity, dz > 0 ? (lz - c.z) / dz : dz < 0 ? (-lz - c.z) / dz : Infinity);
    if (tw < t) { const wx = c.x + dx * tw, wz = c.z + dz * tw, sideX = Math.abs(Math.abs(wx) - lx) < 1e-6; return { gx: wx, gz: wz, wall: true, rx: sideX ? -dx : dx, rz: sideX ? dz : -dz }; }
    if (hit < 0) return null;
    const gx = c.x + dx * t, gz = c.z + dz * t, b = bs[hit], nx = (b.x - gx) / R2, nz = (b.z - gz) / R2, dot = dx * nx + dz * nz;
    return { gx, gz, hit, bx: b.x, bz: b.z, nx, nz, cx: dx - dot * nx, cz: dz - dot * nz, dot };
  }

  // ---------- trạng thái ván ----------
  /** Trạng thái ván đổi (server gửi) → giao diện, chỗ đứng. */
  sync(force = false) {
    const st = this.bil.state, me = this.app.session.key; if (!st) return;
    const people = st.players.map(p => ({ key: p.key, display: p.display, me: p.key === me }));
    this.cast.sync(people);
    if (st.seq !== this.lastSeq || force) {
      this.lastSeq = st.seq;
      if (this.bil.myTurn() || (st.phase === 'aim' && st.players[st.turn]?.key === me)) this.aimA = this.autoAim(me);
      const sh = st.players[st.turn]; this.otherA = sh ? this.autoAim(sh.key) : 0;
    }
    this.renderHud();
  }
  renderHud() {
    const st = this.bil.state, q = this.q, me = this.app.session.key; if (!st) return;
    const bs = this.bil.balls();
    q('.b3-score').innerHTML = st.players.map((p, i) => {
      const g = st.groups[p.key], turn = st.phase === 'aim' && st.turn === i, win = st.winner === p.key;
      const left = g ? [1, 2, 3, 4, 5, 6, 7].map(k => g === 'solid' ? k : k + 8).filter(n => bs[n]?.on) : [];
      const dots = left.map(n => `<i class="b3-ball${n >= 9 ? ' st' : ''}" style="--c:${colOf(n)}"></i>`).join('') + (g && !left.length ? '<i class="b3-ball" style="--c:#15161a" title="Bi 8"></i>' : '');
      return `<div class="b3-pl${turn ? ' turn' : ''}${win ? ' win' : ''}${i ? ' r' : ''}"><b>${esc(p.display)}${p.key === me ? ' (bạn)' : ''}</b><small>${win ? 'Thắng 🏆' : g ? GROUP_LABEL[g] : 'Chưa chia nhóm'}</small><span class="b3-dots">${dots}</span></div>`;
    }).join('<span class="b3-vs">VS</span>') + (st.players.length < 2 ? '<div class="b3-pl r wait"><b>Chờ người chơi…</b><small>Còn 1 chỗ</small></div>' : '');
    q('.rm-msg').textContent = st.msg ? st.msg.charAt(0).toUpperCase() + st.msg.slice(1) : '';
    q('.rm-msg').classList.toggle('show', !!st.msg);
    q('.rm-back span').textContent = this.bil.spectate ? 'Rời phòng' : 'Rời bàn';
    // thẻ giữa màn hình: chờ người / hết ván / đang xem
    const card = q('.rm-card'), mine = this.bil.mine;
    let html = '';
    if (st.phase === 'over') {
      const w = st.players.find(p => p.key === st.winner);
      html = `<b class="rm-big">${w ? `🏆 ${esc(w.display)} thắng!` : 'Ván đã xong'}</b><p>${esc(st.msg || '')}</p><div class="rm-btns">${mine ? '<button type="button" class="rm-pri" data-a="again">Ván mới</button>' : ''}<button type="button" data-a="exit">${mine ? 'Rời bàn' : 'Rời phòng'}</button></div>`;
    } else if (st.players.length < 2) {
      html = mine ? `<b class="rm-big">Đang chờ người chơi thứ hai…</b><p>Rủ đồng nghiệp tới bàn bi-a ở phòng giải trí và bấm <kbd>E</kbd> — ván bắt đầu ngay khi đủ 2 người.</p><div class="rm-btns"><button type="button" data-a="exit">Rời bàn</button></div>`
        : `<b class="rm-big">Bàn còn 1 chỗ</b><p>${esc(st.players[0]?.display || '')} đang chờ người chơi.</p><div class="rm-btns"><button type="button" class="rm-pri" data-a="join">Vào chơi</button><button type="button" data-a="exit">Rời phòng</button></div>`;
    }
    card.hidden = !html; card.innerHTML = html;
    card.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const a = b.dataset.a; if (a === 'again') this.bil.again(); else if (a === 'join') this.bil.join(); else this.bil.exitRoom(true); });
  }

  // ---------- mỗi khung hình ----------
  update(dt) {
    const bil = this.bil, st = bil.state, me = this.app.session.key; if (!st) return;
    const bs = bil.balls(), anim = bil.anim;
    // bi
    this.balls.forEach((m, i) => {
      const b = bs[i], ud = m.userData;
      if (!b || !b.on) {   // vào lỗ: rơi xuống rồi ẩn
        if (m.visible && this.prevOn[i] && anim) { ud.drop = Math.min(1, ud.drop + dt * 5); m.position.y = BY - ud.drop * 0.07; m.scale.setScalar(1 - ud.drop * 0.3); if (ud.drop >= 1) m.visible = false; }
        else m.visible = false;
        return;
      }
      if (!this.prevOn[i] || !m.visible) { ud.drop = 0; m.scale.setScalar(1); }
      const dx = b.x - m.position.x, dz = b.z - m.position.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d > 1e-5 && d < 0.3 && m.visible) { _ax.set(dz, 0, -dx).normalize(); _q.setFromAxisAngle(_ax, d / BALL_R); m.quaternion.premultiply(_q); }
      m.visible = true; m.position.set(b.x, BY, b.z);
    });
    for (let i = 0; i < 16; i++) this.prevOn[i] = bs[i]?.on ? 1 : (this.balls[i].visible ? 1 : 0);
    // âm thanh va chạm theo kết quả mô phỏng
    if (anim) {
      const r = anim.sim.res;
      if (this.res !== r) { this.res = r; this.cnt = { b: 0, p: 0, c: 0 }; sfx('cue', 0.3 + (anim.power || 0.5) * 0.6); }
      if (r.bumps > this.cnt.b) { sfx('click', 0.55); this.cnt.b = r.bumps; }
      if (r.potted.length > this.cnt.p) { sfx('pocket', 0.8); this.cnt.p = r.potted.length; }
      if (r.cushions > this.cnt.c) { sfx('cushion', 0.25); this.cnt.c = r.cushions; }
    }
    // cú đánh của mình: cơ lao tới rồi gửi
    if (this.strike) {
      const s = this.strike; s.t += dt;
      if (s.t >= 0.09 && !s.sent) { s.sent = true; bil.shoot(s.ax, s.az, s.power); this.setPower(0); }
      if (anim || s.t > 3) this.strike = null;
    }
    if (this.charging) this.setPower(this.power + dt / 1.3);
    // chế độ camera
    const turnKey = st.phase === 'aim' ? st.players[st.turn]?.key : null;
    const aiming = this.canShoot() || (this.strike && !anim);
    const want = this.top ? 'top' : aiming ? 'aim' : 'watch';
    const c = bs[0];
    if (want !== this.mode) {
      const prev = this.mode; this.mode = want;
      this.lamp.visible = want !== 'top';
      if (want !== 'top' && this.camera.fov !== 50) { this.camera.fov = 50; this.camera.updateProjectionMatrix(); }
      if (want === 'aim') { this.cam.setLim({ ph: [0.7, 1.45], r: [0.42, 2.0] }); this.cam.set({ ph: 1.24, r: 0.95 }); }
      else if (want === 'watch') { const land = this.camera.aspect > 1; this.cam.setLim({ ph: [0.2, 1.3], r: [1.3, 3.6] }); this.cam.set({ t: _v.set(0, CY, 0), ph: land ? 0.82 : 0.62, r: land ? 2.5 : 3.0, ...(prev ? {} : { th: land ? Math.PI / 2 : 0 }) }); }
      else { this.cam.setLim({ ph: [0.001, 0.02], r: [1.0, 6] }); }
      this.renderHint();
    }
    if (this.mode === 'aim' && c) {
      const fx = Math.sin(this.aimA), fz = Math.cos(this.aimA);
      this.cam.G.t.set(c.x + fx * 0.22, BY, c.z + fz * 0.22);
      this.cam.G.th = this.cam.S.th + ((Math.atan2(-fx, -fz) - this.cam.S.th + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    } else if (this.mode === 'top') {
      // camera sát trần, góc nhìn rộng vừa đủ thấy cả bàn (bàn nằm ngang trên màn hình ngang, dọc trên màn hình dọc)
      const asp = this.camera.aspect, land = asp > 1.05, r = H - 0.08 - CY;
      const vh = (land ? OX : OZ) + 0.1, hh = (land ? OZ : OX) + 0.1, fov = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.max(vh, hh / asp) / r));
      if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
      this.cam.set({ t: _v.set(0, CY, 0), th: land ? Math.PI / 2 : 0, ph: 0.001, r });
    }
    this.cam.update(dt);
    // cây cơ: lượt mình (ngắm / đang đánh) theo hướng ngắm; lượt đối thủ: theo hướng đoán
    const showCue = c?.on && !anim && st.phase === 'aim' && (aiming || turnKey);
    this.cue.visible = !!showCue;
    if (showCue) {
      const mineAim = aiming, a = mineAim ? this.aimA : this.otherA ?? 0, fx = Math.sin(a), fz = Math.cos(a);
      let pull;
      if (this.strike) { const k = Math.min(1, this.strike.t / 0.09); pull = this.strike.from * (1 - k * k) - 0.002 * k; }
      else if (mineAim) pull = 0.02 + this.power * 0.22;
      else pull = 0.05 + Math.sin(performance.now() / 380) * 0.035;   // (đối thủ đang ngắm: kéo cơ ra vào)
      this.cue.position.set(c.x - fx * (BALL_R + pull), BY + 0.004, c.z - fz * (BALL_R + pull));
      this.cue.rotation.set(0, 0, 0); this.cue.rotateY(Math.atan2(fx, fz)); this.cue.rotateX(-0.09);
    }
    // đường ngắm dự đoán
    const pr = this.mode !== 'watch' && aiming && !this.strike && c?.on ? this.predict(bs, this.aimA) : null;
    if (pr) {
      this.gLine.set(c.x, c.z, pr.gx, pr.gz, 0.0045);
      this.ghost.visible = true; this.ghost.position.set(pr.gx, CY + 0.002, pr.gz);
      if (pr.wall) { this.gObj.set(pr.gx, pr.gz, pr.gx + pr.rx * 0.18, pr.gz + pr.rz * 0.18, 0.004); this.gObj.material.color.set('#ffffff'); this.gCue.visible = false; }
      else {
        const L = 0.12 + pr.dot * 0.28;
        this.gObj.set(pr.bx, pr.bz, pr.bx + pr.nx * L, pr.bz + pr.nz * L, 0.005); this.gObj.material.color.set(colOf(pr.hit) === '#15161a' ? '#bbbbbb' : '#ffe08a');
        const cl = Math.hypot(pr.cx, pr.cz); if (cl > 0.05) this.gCue.set(pr.gx, pr.gz, pr.gx + pr.cx / cl * 0.12 * cl, pr.gz + pr.cz / cl * 0.12 * cl, 0.003); else this.gCue.visible = false;
      }
    } else { this.gLine.visible = this.gObj.visible = this.gCue.visible = this.ghost.visible = false; }
    // người chơi: người đánh đứng sau bi chủ, người kia đứng chờ bên bàn
    this.placeCast(st, bs, me, aiming);
    this.cast.update(dt);
    // thanh lực / gợi ý
    const sh = this.q('.b3-shoot'), showShoot = this.canShoot() || !!this.strike;
    if (sh.hidden === showShoot) { sh.hidden = !showShoot; this.renderHint(); }
    const nowAnim = !!anim; if (nowAnim !== this._anim) { this._anim = nowAnim; this.renderHint(); if (!nowAnim) this.renderHud(); }
    const nowTurn = this.bil.myTurn(); if (nowTurn !== this._turn) { this._turn = nowTurn; if (nowTurn) this.aimA = this.autoAim(me); this.renderHint(); }
  }
  placeCast(st, bs, me, aiming) {
    const c = bs[0], players = st.players;
    if (st.phase === 'wait' || players.length < 2) { players.forEach((p, i) => this.cast.place(p.key, { x: (i ? 1 : -1) * 0.5, z: -(OZ + 0.55), yaw: yawFacing(0, 1) })); return; }
    const shooter = st.phase === 'aim' ? st.turn : -1;
    let sx = 0, sz = -(OZ + 0.5);
    if (shooter >= 0 && c?.on) {
      const a = players[shooter].key === me ? this.aimA : (this.otherA ?? 0), fx = Math.sin(a), fz = Math.cos(a);
      // từ bi chủ đi ngược hướng ngắm tới mép ngoài bàn, lùi thêm một bước
      const ex = OX + 0.04, ez = OZ + 0.04, tx = fx ? (Math.sign(-fx) * ex - c.x) / -fx : Infinity, tz = fz ? (Math.sign(-fz) * ez - c.z) / -fz : Infinity, t = Math.min(tx, tz) + 0.3;
      sx = c.x - fx * t; sz = c.z - fz * t;
      this.cast.place(players[shooter].key, { x: sx, z: sz, yaw: yawFacing(fx, fz), act: 'cue' });
    }
    players.forEach((p, i) => {
      if (i === shooter) return;
      const spots = [[OX + 0.7, 0.55], [-(OX + 0.7), -0.55], [OX + 0.7, -0.6], [-(OX + 0.7), 0.6]];
      let best = spots[0], bd = -1; for (const s of spots) { const d = Math.hypot(s[0] - sx, s[1] - sz); if (d > bd) { bd = d; best = s; } }
      const win = st.phase === 'over' && st.winner === p.key;
      this.cast.place(p.key, { x: best[0], z: best[1], yaw: yawFacing(-best[0], -best[1] * 0.3), act: win ? 'dance' : null });
    });
    if (st.phase === 'over') { const w = players.findIndex(p => p.key === st.winner); if (w >= 0 && w === shooter) this.cast.place(players[w].key, { x: sx, z: sz, yaw: yawFacing(-sx, -sz), act: 'dance' }); }
    // nhân vật đứng sát camera (che bàn) thì ẩn — kiểu game góc nhìn thứ ba
    const cp = this.camera.position;
    for (const a of this.cast.list) a.visible = this.mode !== 'top' && Math.hypot(a.x - cp.x, a.z - cp.z) > (this.mode === 'aim' ? 1.25 : 0.75) && !(a.key === me && this.mode === 'aim');
  }
  renderHint() {
    const touch = isTouch(), st = this.bil.state;
    let t = '';
    if (this.bil.anim) t = 'Bi đang lăn…';
    else if (this.canShoot()) t = touch ? 'Kéo ngang: ngắm · Chạm vào bi: ngắm thẳng · Kéo thanh Lực xuống, thả ra: đánh' : 'Kéo chuột hoặc ← → để ngắm (Shift: chỉnh nhỏ) · Bấm vào bi: ngắm thẳng · Giữ Space hoặc kéo thanh Lực, thả ra: đánh';
    else if (st?.phase === 'aim') t = this.bil.spectate ? 'Đang xem ván · kéo để xoay quanh bàn' : `Chờ ${esc(st.players[st.turn]?.display || 'đối thủ')} đánh… · kéo để xoay quanh bàn`;
    if (this.top && t) t = 'Nhìn từ trên · ' + t;
    this.q('.rm-hint').textContent = t;
  }
}
