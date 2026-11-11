// Phòng karaoke 3D riêng: phòng hát nhỏ (tường bọc nệm, đèn LED đổi màu, quả cầu disco, loa), màn hình lớn chiếu video
// YouTube ngay trong cảnh (khung trình phát đặt đúng màn hình bằng CSS3D, nằm dưới canvas; màn hình "khoét lỗ" — cách
// của src/scene/tvVideo.js), ghế sofa chữ U. Người trong phòng là nhân vật thật của họ: ai bật mic thì đứng hát trước màn
// hình (cầm mic), còn lại ngồi sofa. Giao diện: bài đang hát, thêm bài, hàng chờ, mic, tạm dừng / bài tiếp, âm lượng.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { esc } from '../session/ui.js';
import { icon } from '../ui/icons.js';
import { OrbitCam, Cast, bindGestures, roomBox, neonSign, canvasTex, std, yawFacing, logoSign } from './kit.js';

const W = 3.0, D = 3.5, H = 2.6;                 // nửa rộng, nửa sâu, cao
const RAINBOW = ['#ff2b2b', '#ff8a00', '#ffe600', '#22e05a', '#00b4ff', '#3d3bff', '#c83cff'];   // (đèn chóp bảy màu)
const SW = 2.3, SH = SW * 9 / 16, SY = 1.42;     // màn hình
const PXM = 1000;                                 // điểm ảnh CSS / mét (khung video)
const narrow = () => matchMedia('(max-width: 760px), (max-height: 500px) and (max-width: 1100px)').matches;

function quilt() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2e2141'; g.fillRect(0, 0, w, h);
    const n = 4, s = w / n;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const x = i * s, y = j * s, gr = g.createRadialGradient(x, y, 2, x, y, s * 0.75);
      gr.addColorStop(0, 'rgba(255,255,255,.10)'); gr.addColorStop(1, 'rgba(0,0,0,.25)'); g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2);
    }
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2;
    for (let i = -n; i <= n * 2; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s + h, h); g.stroke(); g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s - h, h); g.stroke(); }
    g.fillStyle = '#c9a85a'; for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) { g.beginPath(); g.arc(i * s, j * s, 2.5, 0, Math.PI * 2); g.fill(); }
  }, { repeat: [5, 2.5] });
}
function carpet() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#231b30'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
    g.strokeStyle = 'rgba(160,110,255,.07)'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(64 + (i % 2) * 128, 64 + Math.floor(i / 2) * 128, 40, 0, Math.PI * 2); g.stroke(); }
  }, { repeat: [4, 4] });
}

export class KaraokeRoom {
  constructor(app, ktv, host, canvas) {
    this.kind = 'karaoke'; this.app = app; this.ktv = ktv;
    const scene = this.scene = new THREE.Scene(); scene.background = new THREE.Color('#120e1a');
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 40);
    this.high = (app.quality || 'high') !== 'low';
    if (app.envMap) { scene.environment = app.envMap; scene.environmentIntensity = 0.25; }
    const room = roomBox(W, D, H, { floor: std('#ffffff', { map: carpet(), roughness: 1 }), wall: std('#ffffff', { map: quilt(), roughness: 0.9 }), ceil: '#16121e' });
    scene.add(room.group);
    this.hemi = new THREE.HemisphereLight('#b9a2ff', '#20142a', 0.75); scene.add(this.hemi);
    this.screenLight = new THREE.PointLight('#9fc4ff', 4, 6, 1.6); this.screenLight.position.set(0, SY, -D + 0.9); scene.add(this.screenLight);
    // đèn màu quét từ trần
    this.spots = [];
    const cols = this.high ? ['#ff4fa3', '#42e8ff', '#ffd23f'] : ['#ff4fa3'];
    cols.forEach((c, i) => {
      const s = new THREE.SpotLight(c, 18, 7, 0.32, 0.6, 1.4); s.userData.c0 = c; s.position.set(0, H - 0.08, 0.3); s.target.position.set(0, 0, 0);
      scene.add(s, s.target); this.spots.push({ s, ph: i * 2.1 });
    });
    // dải LED quanh trần
    this.leds = [];
    for (const [x, z, w, d] of [[0, -D + 0.03, W * 2, 0.03], [0, D - 0.03, W * 2, 0.03], [-W + 0.03, 0, 0.03, D * 2], [W - 0.03, 0, 0.03, D * 2]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), new THREE.MeshBasicMaterial({ color: '#ff4fa3', toneMapped: false })); m.position.set(x, H - 0.06, z); scene.add(m); this.leds.push(m);
    }
    // quả cầu disco
    this.disco = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 2), new THREE.MeshStandardMaterial({ color: '#d8dce6', metalness: 1, roughness: 0.12, flatShading: true }));
    this.disco.position.set(0, H - 0.3, -0.6); scene.add(this.disco);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.24, 4), std('#888')); wire.scale.y = 0.6; wire.position.set(0, H - 0.1, -0.6); scene.add(wire);
    this.furnish(scene);
    this.buildDisco(scene);

    // màn hình
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(SW + 0.08, SH + 0.08, 0.06), std('#0c0c10', { roughness: 0.3, metalness: 0.4 })); bezel.position.set(0, SY, -D + 0.04); scene.add(bezel);
    this.idleCanvas = document.createElement('canvas'); this.idleCanvas.width = 1024; this.idleCanvas.height = 576;
    this.idleTex = new THREE.CanvasTexture(this.idleCanvas); this.idleTex.colorSpace = THREE.SRGBColorSpace;
    this.idleMat = new THREE.MeshBasicMaterial({ map: this.idleTex, toneMapped: false });
    this.hole = new THREE.MeshBasicMaterial({ color: 0x000000, blending: THREE.NoBlending, toneMapped: false }); this.hole.opacity = 0;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), this.idleMat); this.screen.position.set(0, SY, -D + 0.075); scene.add(this.screen);
    // khung trình phát YouTube (CSS3D, dưới canvas)
    this.css = new CSS3DRenderer(); this.layer = this.css.domElement; this.layer.className = 'tv-layer ktv-layer'; this.layer.style.display = 'none';
    host.insertBefore(this.layer, canvas);
    this.cssScene = new THREE.Scene();
    const box = document.createElement('div'); box.className = 'tv-video'; box.style.width = `${Math.round(SW * PXM)}px`; box.style.height = `${Math.round(SH * PXM)}px`;
    const slot = document.createElement('div'); slot.id = 'ktvSlot'; box.appendChild(slot);
    const obj = new CSS3DObject(box); obj.position.copy(this.screen.position); obj.scale.setScalar(1 / PXM); this.cssScene.add(obj);
    this.video = false; this.lastScreen = '';
    this.css.render(this.cssScene, this.camera);                          // (đưa khung #ktvSlot vào trang ngay — trình phát YouTube cần tìm thấy nó)

    this.cast = new Cast(scene, app);
    this.cam = new OrbitCam(this.camera, { t: new THREE.Vector3(0, 0.95, -0.9), th: 0, ph: 1.28, r: 4.0, lim: { th: [-0.85, 0.85], ph: [0.9, 1.52], r: [1.4, 4.3] }, box: { x: W - 0.15, z: D - 0.12, y: H - 0.15 }, k: 6 });
    this.focus = false; this.t = 0;
    this.buildUi();
    this.cast.attach(this.ui);
  }

  furnish(scene) {
    const seatTop = Math.max(0.36, this.castSeat() - 0.06);
    const fab = std('#6c2a5e', { roughness: 0.85 }), fab2 = std('#561f4b', { roughness: 0.85 });
    const sofa = (x, z, len, ry) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
      const base = new THREE.Mesh(new THREE.BoxGeometry(len, seatTop - 0.1, 0.62), fab2); base.position.set(0, (seatTop - 0.1) / 2, 0); g.add(base);
      const cush = new THREE.Mesh(new THREE.BoxGeometry(len - 0.04, 0.12, 0.56), fab); cush.position.set(0, seatTop - 0.06, 0.02); g.add(cush);
      const back = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.16), fab2); back.position.set(0, seatTop + 0.18, -0.26); g.add(back);
    };
    // sofa chữ U quanh bàn giữa, quay về màn hình (lưng ghế sau hướng về camera)
    sofa(0, 1.25, 2.6, Math.PI);
    sofa(-1.85, -0.15, 1.7, Math.PI / 2); sofa(1.85, -0.15, 1.7, -Math.PI / 2);
    // bàn giữa: mặt kính đen, ly nước, sổ bài hát
    const tb = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.6), std('#0d0d12', { roughness: 0.08, metalness: 0.2 })); tb.position.set(0, 0.42, -0.15); scene.add(tb);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.38, 0.5), std('#1c1824')); tl.position.set(0, 0.2, -0.15); scene.add(tl);
    for (const [x, z, c] of [[-0.4, 0.45, '#ffb347'], [-0.18, 0.68, '#7fd1ff'], [0.28, 0.42, '#ff6f91'], [0.45, 0.66, '#c3f584']]) {
      const g = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.12, 12), std(c, { transparent: true, opacity: 0.85, roughness: 0.1, emissive: c, emissiveIntensity: 0.15 })); g.position.set(x, 0.505, z - 0.55); scene.add(g);
    }
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.3), std('#d23a6c')); book.position.set(0.05, 0.46, -0.15); book.rotation.y = 0.3; scene.add(book);
    // kệ dưới màn hình + loa
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.45, 0.45), std('#15121b', { roughness: 0.4 })); cab.position.set(0, 0.225, -D + 0.24); scene.add(cab);
    const spk = (x) => {
      const g = new THREE.Group(); g.position.set(x, 0, -D + 0.3); scene.add(g);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.15, 0.38), std('#111015', { roughness: 0.5 })); b.position.y = 0.575; g.add(b);
      for (const [y, r] of [[0.32, 0.14], [0.72, 0.1], [0.98, 0.045]]) { const c = new THREE.Mesh(new THREE.CircleGeometry(r, 24), std('#2a2830', { roughness: 0.35, metalness: 0.3 })); c.position.set(0, y, 0.191); g.add(c);
        const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.012, 24), new THREE.MeshBasicMaterial({ color: '#42e8ff', toneMapped: false })); ring.position.set(0, y, 0.192); g.add(ring); this.rings ||= []; this.rings.push(ring); }
    };
    spk(-1.55); spk(1.55);
    // chữ neon
    const n1 = neonSign('KARAOKE', '#ff4fa3', { h: 0.3 }); n1.position.set(-W + 0.02, 1.85, 0.4); n1.rotation.y = Math.PI / 2; scene.add(n1);
    const n2 = neonSign('♪ SING ♪', '#42e8ff', { h: 0.26 }); n2.position.set(W - 0.02, 1.85, 0.4); n2.rotation.y = -Math.PI / 2; scene.add(n2);
    // biển logo SYSONE: trên màn hình và hai tường bên
    const l1 = logoSign(0.95); l1.position.set(0, 2.3, -D + 0.03); scene.add(l1);
    const l2 = logoSign(1.0); l2.position.set(-W + 0.03, 1.35, -1.6); l2.rotation.y = Math.PI / 2; scene.add(l2);
    const l3 = logoSign(1.0); l3.position.set(W - 0.03, 1.35, -1.6); l3.rotation.y = -Math.PI / 2; scene.add(l3);
    // cây đứng góc + chân mic dự phòng
    const metal = std('#2a2c31', { metalness: 0.7, roughness: 0.3 });
    const st = new THREE.Group(); st.position.set(1.0, 0, -D + 1.0); scene.add(st);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 8), metal); pole.position.y = 0.65; st.add(pole);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.02, 16), metal); foot.position.y = 0.01; st.add(foot);
    const mic = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), std('#3a3a40', { metalness: 0.6, roughness: 0.4 })); mic.position.set(0, 1.33, 0.04); st.add(mic);
  }
  /** Đèn chóp xoay bảy màu (vũ trường): chóp đèn giữa trần, 7 chùm sáng màu cầu vồng xoay quét khắp phòng. */
  buildDisco(scene) {
    const g = this.discoG = new THREE.Group(); g.position.set(0, H - 0.04, -0.5); scene.add(g);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), std('#1a1a22', { metalness: 0.6, roughness: 0.3 }));
    dome.rotation.x = Math.PI; g.add(dome);
    this.beams = []; this.lenses = [];
    const L = 2.9, geo = new THREE.ConeGeometry(0.62, L, 24, 1, true); geo.translate(0, -L / 2, 0);
    RAINBOW.forEach((c, i) => {
      const pv = new THREE.Group(); pv.rotation.y = i / 7 * Math.PI * 2; g.add(pv);
      const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      beam.rotation.x = 0.55; beam.visible = false; beam.renderOrder = 5; pv.add(beam); this.beams.push({ pv, beam, ph: i * 0.9 });
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: '#333', toneMapped: false }));
      const a = i / 7 * Math.PI * 2; lens.position.set(Math.sin(a) * 0.11, -0.07, Math.cos(a) * 0.11); g.add(lens); this.lenses.push(lens);
    });
    this.discoK = 0;
  }
  castSeat() { const m = this.app.model; return m.layout?.scale?.seatHip ?? 0.53 * m.fs; }

  // ---------- giao diện ----------
  buildUi() {
    const ui = this.ui = document.createElement('section'); ui.className = 'room-ui ktv3'; ui.hidden = true; ui.tabIndex = -1;
    ui.setAttribute('role', 'dialog'); ui.setAttribute('aria-label', 'Phòng karaoke');
    ui.innerHTML = `<div class="rm-input" aria-hidden="true"></div>
      <header class="rm-top"><button type="button" class="rm-back">${icon('chevLeft', 16)}<span>Rời phòng</span></button>
        <b class="rm-title">🎤 Phòng karaoke</b>
        <div class="rm-tools"><button type="button" class="k3-disco" role="switch" aria-checked="false" title="Đèn chóp xoay bảy màu — ai trong phòng cũng bật/tắt được">🪩<span>Đèn vũ trường</span></button><button type="button" class="rm-cam" aria-pressed="false">Xem màn hình</button><button type="button" class="k3-list" aria-expanded="false">${icon('music', 15)}<span>Bài hát</span><i class="k3-badge" hidden></i></button></div></header>
      <div class="k3-now" aria-live="polite"></div>
      <button type="button" class="k3-unblock" hidden>${icon('volume', 15)} Bấm để nghe</button>
      <aside class="k3-side" aria-label="Bài hát, hàng chờ, chat">
        <nav class="k3-tabs" role="tablist">
          <button type="button" role="tab" data-tab="songs" aria-selected="true">Chọn bài</button>
          <button type="button" role="tab" data-tab="queue" aria-selected="false">Hàng chờ <b class="k3-n" data-n="queue"></b></button>
          <button type="button" role="tab" data-tab="chat" aria-selected="false">Chat <b class="k3-n k3-unread" data-n="chat" hidden></b></button>
          <button type="button" role="tab" data-tab="people" aria-selected="false">Người <b class="k3-n" data-n="people"></b></button>
        </nav>
        <section class="k3-pane" data-pane="songs">
          <form class="k3-search"><input type="search" placeholder="Tìm bài karaoke trên YouTube…" aria-label="Tìm bài karaoke" maxlength="80"><button type="submit">Tìm</button></form>
          <div class="k3-cats" role="group" aria-label="Nhóm bài hot"></div>
          <ul class="k3-sug" aria-live="polite"></ul>
          <details class="k3-link"><summary>Dán link YouTube</summary>
            <form class="ktv-add"><input type="url" inputmode="url" placeholder="https://youtube.com/watch?v=…" aria-label="Link YouTube" required><button type="submit">Thêm</button></form></details>
        </section>
        <section class="k3-pane" data-pane="queue" hidden><ol class="ktv-queue"></ol><p class="k3-empty">Chưa có bài nào chờ — chọn bài ở tab "Chọn bài".</p></section>
        <section class="k3-pane" data-pane="chat" hidden>
          <ol class="k3-chat" aria-live="polite"></ol>
          <form class="k3-say"><input type="text" placeholder="Nhắn cho cả phòng…" aria-label="Tin nhắn" maxlength="300" autocomplete="off"><button type="submit" aria-label="Gửi">${icon('send', 16)}</button></form>
          <p class="k3-hint">Kênh chat riêng của phòng — tự xoá khi mọi người rời phòng.</p>
        </section>
        <section class="k3-pane" data-pane="people" hidden>
          <ul class="ktv-members"></ul>
          <label class="k3-vol"><span>Âm lượng</span><input type="range" min="0" max="100" step="1" aria-label="Âm lượng"></label>
          <p class="ktv-note">Chỉ người trong phòng nghe được bài hát và giọng hát. Đeo tai nghe để giọng không bị vọng. Cần ít nhất 2 người mới mở bài được.</p>
        </section>
        <p class="k3-err" hidden></p>
      </aside>
      <div class="k3-ctrl">
        <button type="button" class="ktv-pp" aria-label="Tạm dừng">${icon('pause', 18)}</button>
        <button type="button" class="ktv-mic">${icon('volume', 18)}<span>Bật mic hát</span></button>
        <button type="button" class="k3-dance" aria-pressed="false">💃<span>Quẩy</span></button>
        <button type="button" class="ktv-next" aria-label="Bài tiếp">${icon('play', 18)}<span>Bài tiếp</span></button>
      </div>`;
    document.getElementById('appRoot').appendChild(ui);
    const q = this.q = c => ui.querySelector(c), k = this.ktv;
    q('.rm-back').onclick = () => k.leave();
    q('.rm-cam').onclick = () => { this.focus = !this.focus; q('.rm-cam').classList.toggle('on', this.focus); q('.rm-cam').setAttribute('aria-pressed', String(this.focus)); this.applyFocus(); };
    q('.k3-list').onclick = () => this.setSide(!ui.classList.contains('side-open'));
    ui.querySelectorAll('.k3-tabs [data-tab]').forEach(b => b.onclick = () => this.setTab(b.dataset.tab));
    q('.ktv-add').onsubmit = e => { e.preventDefault(); const i = q('.ktv-add input'); k.add(i.value.trim()); i.value = ''; i.blur(); };
    q('.k3-search').onsubmit = e => { e.preventDefault(); const v = q('.k3-search input').value.trim(); if (v) this.loadSug({ q: v }); };
    q('.k3-say').onsubmit = e => { e.preventDefault(); const i = q('.k3-say input'); k.say(i.value); i.value = ''; };
    // danh sách gợi ý / hàng chờ: một trình xử lý cho cả danh sách
    q('.k3-sug').onclick = e => {
      const b = e.target.closest('[data-add]'); if (!b) return;
      const it = this.sug?.[+b.dataset.add]; if (!it) return;
      k.add(it.videoId, it.title); b.disabled = true; b.textContent = 'Đã thêm';
    };
    q('.ktv-queue').onclick = e => { const b = e.target.closest('[data-qa]'); if (!b) return; const i = +b.dataset.i; if (b.dataset.qa === 'top') k.priority(i); else k.remove(i); };
    q('.ktv-mic').onclick = () => k.setMic(!k.mic);
    q('.k3-dance').onclick = () => k.setDance(!k.dancing);
    q('.k3-disco').onclick = () => k.s.rt.send({ t: 'ktv:disco', on: !k.state?.disco });
    q('.ktv-pp').onclick = () => k.s.rt.send({ t: 'ktv:control', action: k.state?.song?.paused ? 'resume' : 'pause' });
    q('.ktv-next').onclick = () => k.s.rt.send({ t: 'ktv:control', action: 'next' });
    q('.k3-unblock').onclick = () => { k.yt?.unblock(); this.render(); };
    const vol = q('.k3-vol input'); vol.oninput = () => k.yt?.setVolume(+vol.value);
    // phím: Enter mở ô chat; ô nhập không làm nhân vật di chuyển (bàn phím của văn phòng đã tắt khi ở trong phòng)
    this.onKey = e => {
      if (!this.app.rooms?.is('karaoke') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
      if (e.key === 'Enter') { e.preventDefault(); this.setSide(true); this.setTab('chat'); q('.k3-say input').focus(); }
    };
    this.tab = 'songs'; this.unread = 0;
    bindGestures(q('.rm-input'), { drag: (dx, dy) => this.cam.orbit(-dx * 0.005, -dy * 0.004), pinch: f => this.cam.zoom(f), wheel: f => this.cam.zoom(f) });
  }
  setTab(t) {
    this.tab = t;
    this.ui.querySelectorAll('.k3-tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    this.ui.querySelectorAll('.k3-pane').forEach(p => { p.hidden = p.dataset.pane !== t; });
    if (t === 'chat') { this.unread = 0; this.renderChat(); const l = this.q('.k3-chat'); l.scrollTop = l.scrollHeight; }
    if (t === 'songs' && !this.sug) this.loadSug({ cat: 'hot' });
    this.renderBadge();
  }
  /** Gợi ý bài (nhóm hot hoặc tìm theo tên). */
  async loadSug(o) {
    const list = this.q('.k3-sug'), seq = (this.sugSeq = (this.sugSeq || 0) + 1);
    this.sugCat = o.cat || null; this.renderCats();
    list.innerHTML = '<li class="k3-loading"><span class="room-spin"></span>Đang tìm bài trên YouTube…</li>';
    const r = await this.ktv.suggest(o); if (seq !== this.sugSeq) return;
    if (r.categories?.length) { this.cats = r.categories; this.renderCats(); }
    this.sug = r.items;
    this.renderSug(r.error);
  }
  renderCats() {
    const cats = this.cats || [{ id: 'hot', label: 'Hot nhất' }];
    this.q('.k3-cats').innerHTML = cats.map(c => `<button type="button" data-cat="${esc(c.id)}" class="${c.id === this.sugCat ? 'on' : ''}">${esc(c.label)}</button>`).join('');
    this.q('.k3-cats').querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { this.q('.k3-search input').value = ''; this.loadSug({ cat: b.dataset.cat }); });
  }
  renderSug(err) {
    const st = this.ktv.state, have = new Set([st?.song?.videoId, ...(st?.queue || []).map(x => x.videoId)]), enough = st && st.members.length >= st.min;
    const items = this.sug || [];
    this.q('.k3-sug').innerHTML = items.length ? items.map((it, i) => `<li>
        <img src="https://i.ytimg.com/vi/${esc(it.videoId)}/mqdefault.jpg" alt="" loading="lazy" width="96" height="54"><span class="k3-dur">${esc(it.duration)}</span>
        <div><b title="${esc(it.title)}">${esc(it.title)}</b><small>${esc(it.channel)}${it.views ? ` · ${esc(it.views)}` : ''}</small></div>
        <button type="button" data-add="${i}" ${have.has(it.videoId) || !enough ? 'disabled' : ''} title="${enough ? '' : `Cần ít nhất ${st?.min || 2} người trong phòng`}">${have.has(it.videoId) ? 'Đã có' : '+ Thêm'}</button></li>`).join('')
      : `<li class="k3-empty">${esc(err || 'Không tìm thấy bài nào — thử từ khoá khác, hoặc dán link YouTube bên dưới.')}</li>`;
  }
  renderChat() {
    const me = this.app.session.key, list = this.q('.k3-chat'), atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = this.ktv.chat.map(m => `<li class="${m.key === me ? 'me' : ''}"><b>${esc(m.by)}</b><span>${esc(m.text)}</span><time>${new Date(m.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time></li>`).join('')
      || '<li class="k3-empty">Chưa có tin nhắn. Nói gì đó với cả phòng nhé!</li>';
    if (atEnd) list.scrollTop = list.scrollHeight;
  }
  renderBadge() {
    const u = this.q('.k3-unread'); u.hidden = !this.unread; u.textContent = this.unread > 9 ? '9+' : String(this.unread);
    const sideClosed = !this.ui.classList.contains('side-open'), b = this.q('.k3-badge');
    b.hidden = !(this.unread && (sideClosed || this.tab !== 'chat'));
  }
  /** Tin chat mới (msg null: nạp lại lịch sử khi vừa vào phòng). */
  onChat(msg) {
    if (msg) { this.cast.say(msg.key, msg.text); if (msg.key !== this.app.session.key && (this.tab !== 'chat' || !this.ui.classList.contains('side-open'))) this.unread++; }
    this.renderChat(); this.renderBadge();
  }
  setSide(open) { this.ui.classList.toggle('side-open', open); this.q('.k3-list').setAttribute('aria-expanded', String(open)); this.q('.k3-list').classList.toggle('on', open); if (open && this.tab === 'chat') this.unread = 0; this.renderBadge(); }
  applyFocus() {
    if (this.focus) { this.cam.setLim({ r: [1.2, 3.3] }); this.cam.set({ t: new THREE.Vector3(0, SY, -D), th: 0, ph: Math.PI / 2 - 0.02, r: narrow() && this.camera.aspect < 1 ? 3.2 : 2.25 }); }
    else if (this.portrait) this.cam.set({ t: new THREE.Vector3(0, 0.75, -1.2), th: 0, ph: 1.2, r: 4.6 });   // (màn hình dọc: cao, nhìn chéo xuống qua hàng ghế sau)
    else this.cam.set({ t: new THREE.Vector3(0, 0.95, -0.9), th: 0, ph: 1.28, r: 4.0 });
  }
  enter() { window.addEventListener('keydown', this.onKey); this.unread = 0; this.setTab(this.tab || 'songs'); this.renderChat(); this.setSide(!narrow()); this.focus = false; this.q('.rm-cam').classList.remove('on'); this.applyFocus(); this.cam.snap(); const v = this.q('.k3-vol input'); v.value = String(this.ktv.yt?.vol ?? 70); this.render(); }
  leave() { window.removeEventListener('keydown', this.onKey); this.video = false; this.layer.style.display = 'none'; }
  resize(w, h) {
    this.css.setSize(w, h); this.cast.setSize(w, h);
    const portrait = w / h < 0.9; this.camera.fov = portrait ? 64 : 50; this.camera.updateProjectionMatrix();
    if (portrait !== this.portrait) { const first = this.portrait === undefined; this.portrait = portrait; this.applyFocus(); if (first) this.cam.snap(); }
  }

  /** Vẽ màn hình chờ (chưa có bài / đang chờ người / lỗi video). */
  drawIdle(title, sub) {
    const key = title + '|' + sub; if (key === this.lastScreen) return; this.lastScreen = key;
    const c = this.idleCanvas, g = c.getContext('2d'), w = c.width, h = c.height;
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#2b1055'); gr.addColorStop(1, '#0b4f7a'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.06)'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(w * (i / 8), h * (0.2 + (i % 3) * 0.3), 60 + i * 9, 0, Math.PI * 2); g.fill(); }
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = '700 64px system-ui, sans-serif'; g.fillText('🎤', w / 2, h * 0.36);
    g.font = '700 46px system-ui, sans-serif'; g.fillText(title, w / 2, h * 0.56, w - 80);
    g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '500 30px system-ui, sans-serif'; g.fillText(sub, w / 2, h * 0.68, w - 80);
    this.idleTex.needsUpdate = true;
  }
  /** Trạng thái phòng / trình phát đổi → giao diện + màn hình. */
  render() {
    const k = this.ktv, st = k.state, q = this.q; if (!st) return;
    const me = this.app.session.key, enough = st.members.length >= st.min, s = st.song, yt = k.yt;
    this.cast.sync(st.members.map(m => ({ key: m.key, display: m.display, me: m.key === me })));
    q('.ktv-members').innerHTML = st.members.map(m => `<li class="${m.mic ? 'on' : ''}"><i aria-hidden="true">${m.mic ? '🎤' : '🎧'}</i>${esc(m.display)}${m.key === me ? ' (bạn)' : ''}</li>`).join('');
    q('.ktv-queue').innerHTML = st.queue.map((x, i) => `<li><span class="k3-i">${i + 1}</span><div><b title="${esc(x.title)}">${esc(x.title)}</b><small>${esc(x.by)} chọn${x.prio ? ` · ⭐ ${esc(x.prio)} ưu tiên` : ''}</small></div>
      ${i ? `<button type="button" data-qa="top" data-i="${i}" title="Ưu tiên: đưa lên hát tiếp theo" aria-label="Ưu tiên bài ${esc(x.title)}">⭐ Ưu tiên</button>` : '<em>Tiếp theo</em>'}${x.byKey === me ? `<button type="button" class="k3-x" data-qa="rm" data-i="${i}" aria-label="Xoá bài ${esc(x.title)}">${icon('close', 12)}</button>` : ''}</li>`).join('');
    q('.k3-pane[data-pane="queue"] .k3-empty').hidden = !!st.queue.length;
    q('[data-n="queue"]').textContent = st.queue.length || ''; q('[data-n="people"]').textContent = `${st.members.length}/${st.max || 10}`;
    const db = q('.k3-dance'); db.classList.toggle('on', k.dancing); db.setAttribute('aria-pressed', String(k.dancing)); db.querySelector('span').textContent = k.dancing ? 'Đang quẩy' : 'Quẩy';
    if (this.sug) this.renderSug();
    const dc = q('.k3-disco'), on = !!st.disco; dc.classList.toggle('on', on); dc.setAttribute('aria-checked', String(on));
    q('.k3-now').innerHTML = s ? `<span class="k3-eq${s.paused ? ' off' : ''}" aria-hidden="true"><i></i><i></i><i></i></span><b>${esc(s.title)}</b><small>${esc(s.by)} chọn${s.paused ? ' · tạm dừng' : ''}${st.queue.length ? ` · ${st.queue.length} bài chờ` : ''}</small>` : '';
    q('.k3-now').classList.toggle('show', !!s);
    q('.ktv-add input').disabled = q('.ktv-add button').disabled = !enough;
    q('.ktv-pp').disabled = q('.ktv-next').disabled = !s;
    q('.ktv-pp').innerHTML = s?.paused ? icon('play', 18) : icon('pause', 18); q('.ktv-pp').setAttribute('aria-label', s?.paused ? 'Phát tiếp' : 'Tạm dừng');
    const mb = q('.ktv-mic'); mb.classList.toggle('on', k.mic); mb.querySelector('span').textContent = k.mic ? 'Đang hát · Tắt mic' : 'Bật mic hát';
    const err = yt?.error || ''; q('.k3-err').hidden = !err; q('.k3-err').textContent = err;
    q('.k3-unblock').hidden = !(s && !s.paused && yt?.blocked);
    // màn hình: có bài và trình phát sẵn sàng → video; không thì màn hình chờ
    const video = !!(s && yt?.player && !err);
    if (!video) this.drawIdle(err ? 'Không phát được bài này' : s ? s.title : enough ? 'Chọn bài để bắt đầu hát' : 'Đang chờ thêm người…',
      err ? err : s ? 'Đang tải video…' : enough ? 'Bấm "Bài hát" để chọn bài hot hoặc tìm bài' : `Cần ít nhất ${st.min} người trong phòng mới mở bài được`);
    if (video !== this.video) { this.video = video; this.screen.material = video ? this.hole : this.idleMat; this.layer.style.visibility = video ? 'visible' : 'hidden'; }
    if (this.app.rooms?.is('karaoke')) this.layer.style.display = '';
  }
  /** Chỗ của từng người: ai bật mic đứng hát trước màn hình, còn lại ngồi sofa (thứ tự vào phòng — mọi máy giống nhau). */
  placeCast() {
    const st = this.ktv.state; if (!st) return;
    const dancing = m => this.cast.source(m.key)?.act === 'quay';
    const dancers = st.members.filter(dancing), singers = st.members.filter(m => m.mic && !dancing(m)), sitters = st.members.filter(m => !m.mic && !dancing(m));
    // ghế hai bên trước (thấy mặt nghiêng từ camera), rồi tới ghế sau
    // (màn hình dọc: ghế sau trước — hai bên nằm ngoài khung hình)
    const side = [[-1.71, -0.5, -Math.PI / 2], [1.71, -0.5, Math.PI / 2], [-1.71, 0.22, -Math.PI / 2], [1.71, 0.22, Math.PI / 2]], back = [[-0.32, 1.11, 0], [0.32, 1.11, 0], [-0.92, 1.11, 0], [0.92, 1.11, 0]];
    const stand = [[-0.45, 1.85, 0, 0], [0.45, 1.85, 0, 0]];   // (hết ghế: đứng sau sofa)
    const seats = [...(this.portrait ? [...back, ...side] : [...side, ...back]), ...stand];
    // người hát đứng lệch hai bên màn hình (không che lời bài hát), quay về phía màn hình
    const lanes = this.portrait ? [-0.42, 0.42, 0, -0.85, 0.85, 1.3] : [-0.85, 0.85, -0.3, 0.3, -1.4, 1.4];
    singers.forEach((m, i) => { const x = lanes[i % lanes.length], z = -D + 1.45 + Math.floor(i / lanes.length) * 0.5; this.cast.place(m.key, { x, z, yaw: yawFacing(-x * 0.5, -(z + D)), act: 'sing' }); });
    sitters.forEach((m, i) => { const s = seats[i % seats.length]; this.cast.place(m.key, { x: s[0], z: s[1], yaw: s[2], sit: s[3] ?? 1 }); });
    // người quẩy: ra sàn trước bàn, quay mặt về phía camera (kiểu sân khấu Audition); đang cầm mic thì vẫn đứng hàng người hát
    // (sát mép bàn: từ camera nhìn xuống, đầu người quẩy nằm dưới mép màn hình — không che lời bài hát)
    const floor = this.portrait ? [[-0.4, -0.75], [0.4, -0.75], [-0.4, -1.3], [0.4, -1.3], [0, -1.05]] : [[-0.42, -0.75], [0.42, -0.75], [-1.2, -0.85], [1.2, -0.85], [-0.8, -1.3], [0.8, -1.3], [0, -1.3]];
    dancers.forEach((m, i) => { const f = floor[i % floor.length]; this.cast.place(m.key, { x: f[0], z: f[1], yaw: yawFacing(-f[0] * 0.15, 1), act: 'quay' }); });
  }

  update(dt) {
    this.t += dt; const t = this.t, playing = !!(this.ktv.state?.song && !this.ktv.state.song.paused), dOn = !!this.ktv.state?.disco;
    this.discoK += ((dOn ? 1 : 0) - this.discoK) * (1 - Math.exp(-dt * 4)); const dk = this.discoK;
    this.disco.rotation.y += dt * (0.6 + dk * 2.4);
    this.hemi.intensity = 0.75 * (1 - dk * 0.55);
    this.discoG.rotation.y += dt * (0.4 + dk * 1.1);
    this.beams.forEach((b, i) => { b.beam.visible = dk > 0.01; b.beam.material.opacity = 0.11 * dk; b.beam.rotation.x = 0.45 + 0.35 * Math.sin(t * 1.3 + b.ph); });
    this.lenses.forEach((l, i) => l.material.color.set(dk > 0.5 && Math.sin(t * 12 + i) > -0.3 ? RAINBOW[i] : '#333'));
    const hue = (t * 0.05) % 1;
    this.leds.forEach((m, i) => m.material.color.setHSL((hue + i * 0.08) % 1, 0.9, 0.55));
    this.rings?.forEach((r, i) => { r.material.color.setHSL((hue + 0.5) % 1, 0.9, 0.5 + (playing ? 0.15 * Math.max(0, Math.sin(t * 9 + i)) : 0)); });
    this.spots.forEach(({ s, ph }, i) => {
      const a = t * (playing ? 0.8 : 0.25) * (1 + dk * 2) + ph; s.target.position.set(Math.sin(a) * 1.6, 0, Math.cos(a * 0.7) * 1.4 + 0.5);
      s.intensity = (playing ? 18 : 6) * (1 + dk * 0.8);
      if (dk > 0.01) s.color.set(RAINBOW[(Math.floor(t * 2.2) + i * 2) % 7]); else s.color.set(s.userData.c0);
    });
    this.screenLight.intensity = this.video ? 5 + Math.sin(t * 3) * 0.6 : 3;
    this.placeCast();
    this.cam.update(dt);
    const cp = this.camera.position; for (const a of this.cast.list) a.visible = Math.hypot(a.x - cp.x, a.z - cp.z) > 0.8;   // (đứng sát camera: ẩn, không che màn hình)
    this.cast.update(dt);
  }
  afterRender() { if (this.video) this.css.render(this.cssScene, this.camera); this.cast.render(this.camera); }
}
