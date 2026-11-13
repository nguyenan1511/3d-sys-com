// Phòng họp 3D (giống phòng họp của agent-office): phòng sáng, bàn họp dài, ghế quanh bàn, bảng trắng trên tường hiện đúng
// nét vẽ của cuộc họp (vẽ lại từ bảng vẽ chung — src/ui/whiteboard.js), cây, đèn trần, logo. Người trong phòng là nhân vật
// thật của họ, ngồi quanh bàn (host ngồi đầu bàn), có bảng tên và bong bóng chat như ở văn phòng.
// Vẽ bằng renderer / canvas của văn phòng qua RoomStage (src/rooms/stage.js), giao diện phủ lên trên: src/ui/meetRoom.js.
// Bấm vào bảng trắng → onBoard() (mở bảng vẽ). Lúc mở bảng vẽ: setPip({ el, cv }) — cảnh thu vào khung nhỏ kéo được.
import * as THREE from 'three';
import { OrbitCam, Cast, bindGestures, roomBox, std, woodFloorTex, logoSign, canvasTex, yawFacing } from './kit.js';

const W = 3.4, D = 2.9, H = 2.75;                  // nửa rộng, nửa sâu, cao
const BW = 2.7, BH = BW * 9 / 16, BY = 1.55;       // bảng trắng
const TZ = 0.45;                                   // tâm bàn (z)
const SCENE_T = new THREE.Vector3(0, 0.75, TZ - 0.35), PIP_T = new THREE.Vector3(0, 0.75, TZ);   // (điểm camera nhìn: toàn màn / khung nhỏ)
// chỗ ngồi: 3 ghế mỗi bên, 1 ghế đầu bàn (host, quay về bảng), 1 ghế cuối bàn gần bảng
// (yaw của ghế = hướng mặt người ngồi: mặt trước ghế quay vào bàn)
const SEATS = [[0, TZ + 1.85, 0]];
for (const z of [TZ - 0.95, TZ, TZ + 0.95]) { SEATS.push([-1.05, z, -Math.PI / 2], [1.05, z, Math.PI / 2]); }
SEATS.push([0, TZ - 1.75, Math.PI]);

export class MeetingRoom {
  constructor(app, host, canvas, { onBoard } = {}) {
    this.kind = 'meet'; this.app = app; this.canvasEl = canvas; this.onBoard = onBoard; this.pip = null;
    const scene = this.scene = new THREE.Scene(); scene.background = new THREE.Color('#e9edf3');
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.05, 40);
    if (app.envMap) { scene.environment = app.envMap; scene.environmentIntensity = 0.45; }
    const room = roomBox(W, D, H, { floor: std('#ffffff', { map: woodFloorTex('#b8865a', [4, 3]), roughness: 0.8 }), wall: std('#f3f1ec', { roughness: 0.95 }), ceil: '#fbfaf7', wainscot: '#e2ddd3' });
    scene.add(room.group);
    scene.add(new THREE.HemisphereLight('#ffffff', '#c9b9a3', 1.05));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.3); sun.position.set(-3, 5, 2); scene.add(sun);
    // đèn trần dạng tấm
    for (const z of [TZ - 0.9, TZ + 0.9]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.03, 0.5), new THREE.MeshBasicMaterial({ color: '#fffdf5', toneMapped: false })); p.position.set(0, H - 0.02, z); scene.add(p); }
    // cửa sổ kính (tường phải): dải sáng + khung
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.5), new THREE.MeshBasicMaterial({ map: canvasTex(512, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#bfe3ff'); gr.addColorStop(1, '#eaf6ff'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.55)'; for (let i = 0; i < 6; i++) g.fillRect(40 + i * 80, 150 - (i % 3) * 30, 50, 120); }), toneMapped: false }));
    win.position.set(W - 0.02, 1.5, TZ); win.rotation.y = -Math.PI / 2; scene.add(win);
    for (const z of [-1.8, -0.6, 0.6, 1.8].map(v => v + TZ)) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.56, 0.05), std('#2b2d42')); m.position.set(W - 0.03, 1.5, z); scene.add(m); }
    // bàn họp
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 3.3), std('#f7f5f0', { roughness: 0.35 })); top.position.set(0, 0.74, TZ); scene.add(top);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.71, 2.4), std('#3a3d55', { roughness: 0.5 })); base.position.set(0, 0.355, TZ); scene.add(base);
    // laptop / sổ trên bàn
    for (const [x, z] of [[-0.45, TZ - 0.95], [0.45, TZ], [-0.45, TZ + 0.95], [0.45, TZ + 0.95]]) { const lp = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.015, 0.22), std('#9aa1ad', { metalness: 0.4, roughness: 0.4 })); lp.position.set(x, 0.78, z); scene.add(lp); }
    // ghế
    const seatH = this.castSeat();
    const chairM = std('#2b2d42', { roughness: 0.7 }), legM = std('#8a8ca3', { metalness: 0.6, roughness: 0.3 });
    for (const [x, z, yaw] of SEATS) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw; scene.add(g);
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.07, 0.44), chairM); s.position.y = seatH - 0.08; g.add(s);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.06), chairM); b.position.set(0, seatH + 0.2, 0.22); g.add(b);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, seatH - 0.12, 8), legM); p.position.y = (seatH - 0.12) / 2; g.add(p);
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 12), legM); f.position.y = 0.015; g.add(f);
    }
    // bảng trắng trên tường sau
    const frame = new THREE.Mesh(new THREE.BoxGeometry(BW + 0.1, BH + 0.1, 0.05), std('#c8ccd6', { metalness: 0.5, roughness: 0.3 })); frame.position.set(0, BY, -D + 0.04); scene.add(frame);
    this.bc = document.createElement('canvas'); this.bc.width = 1600; this.bc.height = 900;
    this.btex = new THREE.CanvasTexture(this.bc); this.btex.colorSpace = THREE.SRGBColorSpace; this.btex.anisotropy = 8;
    this.board = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ map: this.btex, toneMapped: false }));
    this.board.position.set(0, BY, -D + 0.07); scene.add(this.board);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(BW * 0.6, 0.03, 0.1), std('#c8ccd6')); tray.position.set(0, BY - BH / 2 - 0.08, -D + 0.1); scene.add(tray);
    for (const [x, c] of [[-0.3, '#ef476f'], [-0.18, '#2b2d42'], [-0.06, '#118ab2']]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 8), std(c)); m.rotation.z = Math.PI / 2; m.position.set(x, BY - BH / 2 - 0.055, -D + 0.1); scene.add(m); }
    // trang trí: logo, cây, tủ thấp
    const lg = logoSign(1.1); lg.position.set(-W + 0.03, 1.75, TZ - 0.4); lg.rotation.y = Math.PI / 2; scene.add(lg);
    for (const [x, z] of [[-W + 0.4, D - 0.4], [W - 0.4, -D + 0.45]]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.36, 14), std('#f2efe8')); pot.position.set(x, 0.18, z); scene.add(pot);
      for (let i = 0; i < 7; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), std(i % 2 ? '#4f9d69' : '#3e8a5a')); l.scale.set(1, 1.6, 0.5); l.position.set(x + Math.cos(i) * 0.12, 0.62 + (i % 3) * 0.12, z + Math.sin(i) * 0.12); l.rotation.y = i; scene.add(l); }
    }
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.8, 1.6), std('#d9d2c5', { roughness: 0.6 })); cab.position.set(-W + 0.25, 0.4, -D + 1.3); scene.add(cab);

    this.cast = new Cast(scene, app);
    this.cam = new OrbitCam(this.camera, { t: SCENE_T, th: 0.62, ph: 0.9, r: 6.2, lim: { ph: [0.45, 1.4], r: [2.2, 8.5] }, box: { x: W - 0.12, z: D - 0.12, y: H - 0.12 }, k: 6 });
    this.t = 0; this.dirty = true; this.paintAt = 0;
    this.buildUi();
    this.cast.attach(this.ui);
  }
  castSeat() { const m = this.app.model; return m.layout?.scale?.seatHip ?? 0.53 * m.fs; }

  buildUi() {
    const ui = this.ui = document.createElement('section'); ui.className = 'room-ui meet3'; ui.hidden = true; ui.tabIndex = -1;
    ui.setAttribute('aria-label', 'Phòng họp 3D');
    ui.innerHTML = '<div class="rm-input" aria-hidden="true"></div>';
    document.getElementById('appRoot').appendChild(ui);
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    bindGestures(ui.querySelector('.rm-input'), {
      drag: (dx, dy) => this.cam.orbit(-dx * 0.005, -dy * 0.004), pinch: f => this.cam.zoom(f), wheel: f => this.cam.zoom(f),
      tap: e => {   // bấm vào bảng trắng → mở bảng vẽ + nội dung (2 cột)
        const r = this.canvasEl.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, this.camera);
        if (ray.intersectObject(this.board, false).length) this.onBoard?.();
      }
    });
    // con trỏ tay khi rê lên bảng
    ui.querySelector('.rm-input').addEventListener('pointermove', e => {
      if (e.buttons) return;
      const r = this.canvasEl.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera); ui.querySelector('.rm-input').style.cursor = ray.intersectObject(this.board, false).length ? 'pointer' : '';
    });
  }
  /** Nguồn nét vẽ: (g, w, h) => vẽ toàn bộ bảng lên canvas. Gọi markBoard() khi bảng đổi. */
  setPainter(fn) { this.painter = fn; this.dirty = true; }
  markBoard() { this.dirty = true; }
  paintBoard() {
    const g = this.bc.getContext('2d'), w = this.bc.width, h = this.bc.height;
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    if (this.painter) this.painter(g, w, h);
    if (this.empty) { g.fillStyle = '#b9bccd'; g.font = '800 54px "Nunito", system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('Bấm vào bảng để vẽ, ghi chú cùng nhau', w / 2, h / 2); g.textAlign = 'left'; }
    this.btex.needsUpdate = true;
  }
  /** Người trong phòng → ngồi quanh bàn (host ngồi đầu bàn); quá số ghế thì đứng dọc tường. */
  members(list, hostKey) {
    const me = this.app.session.key;
    this.cast.sync(list.map(m => ({ key: m.key, display: m.display, me: m.key === me })));
    const order = [...list].sort((a, b) => (a.key === hostKey ? -1 : b.key === hostKey ? 1 : 0));
    order.forEach((m, i) => {
      if (i < SEATS.length) { const [x, z, yaw] = SEATS[i]; this.cast.place(m.key, { x, z, yaw, sit: 1 }); }
      else { const k = i - SEATS.length, x = -W + 0.55 + (k % 6) * 0.9, z = D - 0.5; this.cast.place(m.key, { x, z, yaw: yawFacing(-x * 0.2, -1) }); }
    });
  }
  say(key, text) { this.cast.say(key, text); }
  /** Khung 3D thu nhỏ (chế độ bảng vẽ): box = { el, cv } — cảnh vẽ vào góc khung hình chung rồi chép sang canvas nhỏ cv
   *  (cùng renderer, không thêm ngữ cảnh WebGL); bảng tên / bong bóng chat chuyển vào khung nhỏ. null = toàn màn. */
  setPip(box) {
    const L = this.cast.tags?.r.domElement;
    this.pip = box || null; this.pw = 0;
    if (box) { if (L) box.el.insertBefore(L, box.el.firstChild.nextSibling); this.cam.set({ r: 6, th: 0.8, ph: 1, t: PIP_T }); }   // (góc chéo: thấy cả bàn, bảng trắng, mọi người)
    else {
      const inp = this.ui.querySelector('.rm-input'); if (L && inp) this.ui.insertBefore(L, inp.nextSibling);
      this.camera.aspect = (this.w || 1) / (this.h || 1); this.cast.setSize(this.w || 1, this.h || 1); this.resizeFov(); this.applyView();
      this.cam.set({ r: 6.2, th: 0.62, ph: 0.9, t: SCENE_T });
    }
  }
  /** (giữ cho mã cũ) */
  setSplit() {}
  applyView() { this.camera.clearViewOffset(); this.camera.updateProjectionMatrix(); }
  resizeFov() { this.camera.fov = (this.w || 1) / (this.h || 1) < 0.9 ? 66 : 48; }
  draw3d(renderer) {
    const p = this.pip;
    if (!p) { renderer.render(this.scene, this.camera); return; }
    const w = p.el.clientWidth, h = p.el.clientHeight; if (w < 2 || h < 2) return;
    const pr = renderer.getPixelRatio(), src = renderer.domElement;
    if (w !== this.pw || h !== this.ph) {
      this.pw = w; this.ph = h; this.camera.aspect = w / h; this.camera.fov = 62; this.camera.clearViewOffset(); this.camera.updateProjectionMatrix();
      this.cast.setSize(w, h); p.cv.width = Math.min(src.width, Math.floor(w * pr)); p.cv.height = Math.min(src.height, Math.floor(h * pr));
    }
    renderer.getViewport(this._vp || (this._vp = new THREE.Vector4()));
    renderer.setScissorTest(true); renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
    renderer.render(this.scene, this.camera);
    // (ảnh vừa vẽ còn trong bộ đệm cho tới hết khung hình — chép ngay, không cần preserveDrawingBuffer)
    p.cv.getContext('2d').drawImage(src, 0, src.height - p.cv.height, p.cv.width, p.cv.height, 0, 0, p.cv.width, p.cv.height);
    renderer.setScissorTest(false); renderer.setViewport(this._vp);
  }
  enter() { this.cam.snap(); this.dirty = true; }
  leave() {}
  resize(w, h) {
    this.w = w; this.h = h; this.pw = 0;
    if (this.pip) return;   // (khung thu nhỏ tự đặt cỡ trong render())
    this.cast.setSize(w, h); this.resizeFov(); this.applyView();
  }
  update(dt) {
    this.t += dt;
    if (this.dirty && this.t - this.paintAt > 0.1) { this.dirty = false; this.paintAt = this.t; this.paintBoard(); }   // (bảng đổi: vẽ lại tối đa 10 lần/giây)
    this.cam.update(dt);
    const cp = this.camera.position; for (const a of this.cast.list) a.visible = Math.hypot(a.x - cp.x, a.z - cp.z) > 0.9;   // (sát camera: ẩn, không che cảnh)
    this.cast.update(dt);
  }
  afterRender() { this.cast.render(this.camera); }
}
