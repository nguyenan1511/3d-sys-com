// Đồ dùng chung cho các phòng 3D riêng (bi-a, karaoke): camera quỹ đạo êm, nhân vật thật của người trong phòng,
// bảng tên, vân vật liệu vẽ bằng canvas, âm thanh nhỏ. Phòng là một cảnh three.js riêng, vẽ bằng chính renderer của
// văn phòng (src/rooms/stage.js) — không tạo thêm ngữ cảnh WebGL.
import * as THREE from 'three';
import { AvatarSystem } from '../agents/avatars.js';
import { NameTags } from '../ui/nameTags.js';

export const TAU = Math.PI * 2;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Góc hướng mặt nhân vật để nhìn theo vector (fx, fz) (quy ước của bộ nhân vật). */
export const yawFacing = (fx, fz) => Math.atan2(-fx, -fz);
const wrap = a => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

// ---------- vân vật liệu (canvas) ----------
export function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
/** Sàn gỗ ván dài. */
export function woodFloorTex(base = '#6b4a33', repeat = [3, 3]) {
  return canvasTex(512, 512, (g, w, h) => {
    const rows = 8, rh = h / rows, c = new THREE.Color(base);
    for (let r = 0; r < rows; r++) {
      let x = -((r * 137) % 200);
      while (x < w) {
        const len = 180 + ((r * 31 + x) % 120 + 120) % 120, k = 0.86 + (((r * 7 + x * 3) % 17) / 17) * 0.26;
        g.fillStyle = `#${c.clone().multiplyScalar(k).getHexString()}`; g.fillRect(x, r * rh, len, rh);
        g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 1;
        for (let i = 0; i < 5; i++) { const y = r * rh + 4 + i * (rh - 8) / 4; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + len * 0.3, y + 2, x + len * 0.6, y - 2, x + len, y); g.stroke(); }
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, r * rh, 2, rh); x += len;
      }
      g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, r * rh, w, 2);
    }
  }, { repeat });
}
/** Chữ đèn neon (nền trong suốt). */
export function neonSign(text, color = '#ff4fa3', { font = '700 120px "Segoe UI", system-ui, sans-serif', h = 0.32 } = {}) {
  const pad = 40, m = document.createElement('canvas').getContext('2d'); m.font = font;
  const w = Math.ceil(m.measureText(text).width) + pad * 2, H = 200;
  const tex = canvasTex(w, H, g => {
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 36; g.fillStyle = color; g.fillText(text, w / 2, H / 2 + 6);
    g.shadowBlur = 12; g.fillText(text, w / 2, H / 2 + 6);
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,.85)'; g.font = font.replace(/\d+px/, s => `${Math.round(parseInt(s) * 0.98)}px`); g.fillText(text, w / 2, H / 2 + 6);
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h * w / H, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  return mesh;
}
/** Tranh / poster đơn giản (khối màu), có khung. */
export function poster(w, h, draw, frame = '#1c1c22') {
  const g = new THREE.Group();
  const tex = canvasTex(256, Math.round(256 * h / w), draw);
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.03), new THREE.MeshStandardMaterial({ color: frame, roughness: 0.6 }));
  pic.position.z = 0.017; g.add(fr, pic); return g;
}
/**
 * Biển logo SYSONE (đúng file logo gốc public/logo/sysone-logo.png, không vẽ lại): bảng đèn nền trắng có viền, logo giữ
 * nguyên màu. w: bề rộng (m). Ảnh tải không đồng bộ; trong lúc chờ bảng chỉ có nền trắng.
 */
export function logoSign(w = 1.2, { frame = '#1c1d24', glow = null } = {}) {
  const g = new THREE.Group(), pad = 0.18, h = w * (171 / 1296) + pad * w * 0.5;
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * h / w);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const draw = img => {
    const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
    if (img) { const iw = c.width * (1 - pad), ih = iw * img.height / img.width; x.drawImage(img, (c.width - iw) / 2, (c.height - ih) / 2, iw, ih); }
    tex.needsUpdate = true;
  };
  draw(null);
  const img = new Image(); img.onload = () => draw(img); img.src = `${import.meta.env?.BASE_URL || '/'}logo/sysone-logo.png`;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.position.z = 0.026;
  const box = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.05), new THREE.MeshStandardMaterial({ color: frame, roughness: 0.4, metalness: 0.3 }));
  g.add(box, face);
  if (glow) { const l = new THREE.PointLight(glow, 1.2, 2.2, 2); l.position.z = 0.4; g.add(l); }
  return g;
}
export const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o });

/** Hộp phòng: sàn, trần, 4 tường (mặt trong). Trả về { group, floor, walls }. */
export function roomBox(W, D, H, { floor, wall, ceil = '#20222b', wainscot = null }) {
  const g = new THREE.Group();
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), floor); fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; g.add(fl);
  const ce = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, D * 2), std(ceil, { roughness: 0.95 })); ce.rotation.x = Math.PI / 2; ce.position.y = H; g.add(ce);
  const walls = [];
  for (const [x, z, ry, len] of [[0, -D, 0, W * 2], [0, D, Math.PI, W * 2], [-W, 0, Math.PI / 2, D * 2], [W, 0, -Math.PI / 2, D * 2]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), wall); m.position.set(x, H / 2, z); m.rotation.y = ry; m.receiveShadow = true; g.add(m); walls.push(m);
    if (wainscot) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 0.03), wainscot); p.position.set(x, 0.45, z); p.rotation.y = ry; p.translateZ(0.015); g.add(p);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.05), wainscot); cap.position.set(x, 0.92, z); cap.rotation.y = ry; cap.translateZ(0.025); g.add(cap);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.02), std('#15161b')); base.position.set(x, 0.04, z); base.rotation.y = ry; base.translateZ(0.01); g.add(base);
  }
  return { group: g, floor: fl, walls };
}

// ---------- camera quỹ đạo ----------
/**
 * Camera quay quanh một điểm: S (hiện tại) êm dần về G (đích) — th: góc phương vị, ph: góc từ phương thẳng đứng, r: khoảng
 * cách, t: điểm nhìn. lim: { ph: [a, b], r: [a, b], th?: [a, b] }; box: { x, z, y } giữ camera trong phòng.
 */
export class OrbitCam {
  constructor(camera, { t = new THREE.Vector3(), th = 0, ph = 1, r = 3, lim = {}, box = null, k = 6 } = {}) {
    this.camera = camera; this.k = k; this.box = box;
    this.S = { th, ph, r, t: t.clone() }; this.G = { th, ph, r, t: t.clone() };
    this.lim = { ph: [0.05, 1.5], r: [0.3, 10], ...lim };
    this.apply();
  }
  set(o, snap = false) {
    const G = this.G;
    if (o.th !== undefined) G.th = this.S.th + wrap(o.th - this.S.th);
    if (o.ph !== undefined) G.ph = o.ph; if (o.r !== undefined) G.r = o.r; if (o.t) G.t.copy(o.t);
    this.clampG(); if (snap) this.snap();
  }
  setLim(lim) { Object.assign(this.lim, lim); this.clampG(); }
  clampG() {
    const G = this.G, L = this.lim;
    G.ph = clamp(G.ph, L.ph[0], L.ph[1]); G.r = clamp(G.r, L.r[0], L.r[1]);
    if (L.th) { const c = (L.th[0] + L.th[1]) / 2, h = (L.th[1] - L.th[0]) / 2, d = wrap(G.th - c); G.th = G.th - d + clamp(d, -h, h); }
  }
  orbit(dth, dph) { this.G.th += dth; this.G.ph += dph; this.clampG(); }
  zoom(f) { this.G.r *= f; this.clampG(); }
  snap() { const S = this.S, G = this.G; S.th = G.th; S.ph = G.ph; S.r = G.r; S.t.copy(G.t); this.apply(); }
  update(dt) {
    const S = this.S, G = this.G, a = damp(this.k, dt);
    S.th += (G.th - S.th) * a; S.ph += (G.ph - S.ph) * a; S.r += (G.r - S.r) * a; S.t.lerp(G.t, a);
    this.apply();
  }
  apply() {
    const S = this.S, c = this.camera, sp = Math.sin(S.ph);
    c.position.set(S.t.x + S.r * sp * Math.sin(S.th), S.t.y + S.r * Math.cos(S.ph), S.t.z + S.r * sp * Math.cos(S.th));
    const b = this.box;
    if (b) { c.position.x = clamp(c.position.x, -b.x, b.x); c.position.z = clamp(c.position.z, -b.z, b.z); c.position.y = clamp(c.position.y, 0.25, b.y); }
    c.lookAt(S.t);
  }
}

/**
 * Bắt thao tác trên lớp phủ của phòng: kéo 1 ngón / chuột, chụm 2 ngón, lăn chuột, chạm (không kéo).
 * h: { drag(dx, dy, e), pinch(f), wheel(f), tap(e), down(e), up(e) }.
 */
export function bindGestures(el, h) {
  const pts = new Map(); let moved = 0, pinch0 = 0, start = null;
  el.addEventListener('pointerdown', e => {
    if (e.target !== el) return;
    el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { moved = 0; start = { x: e.clientX, y: e.clientY }; h.down?.(e); }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  el.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0 > 0 && d > 0) h.pinch?.(pinch0 / d); pinch0 = d; moved = 99; return; }
    moved = Math.max(moved, Math.hypot(e.clientX - start.x, e.clientY - start.y));
    if (moved > 4) h.drag?.(dx, dy, e);
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!pts.size) { if (moved <= 6 && e.type === 'pointerup') h.tap?.(e); h.up?.(e, moved); }
    if (pts.size < 2) pinch0 = 0;
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', e => {
    e.preventDefault();
    let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1); if (e.ctrlKey) dy *= 4;
    h.wheel?.(Math.exp(clamp(dy, -120, 120) * 0.0015));
  }, { passive: false });
}

// ---------- người trong phòng ----------
/**
 * Nhân vật của những người trong phòng — đúng nhân vật họ đã chọn (lấy từ nhân vật trong văn phòng). Mỗi người có chỗ
 * đứng / ngồi đích; nhân vật bước tới đó (có dáng đi), quay mặt êm.
 */
export class Cast {
  constructor(scene, app) {
    this.app = app; const m = app.model;
    this.sys = new AvatarSystem(scene, 10, app.quality || 'high', { scale: m.cs, seatH: m.layout?.scale?.seatHip ?? 0.53 * m.fs });
    this.seatH = this.sys.seatH;
    this.tags = null;   // (bảng tên HTML giống văn phòng — attach(host) khi giao diện phòng đã dựng)
    this.list = []; this.byKey = new Map(); this.gone = new Map();
  }
  source(key) { const s = this.app.session; return key === s.key ? s.player?.agent : s.remote.byKey.get(key); }
  /** people: [{ key, display, me }] — người đang có trong phòng. */
  sync(people) {
    const keys = new Set(people.map(p => p.key)); let dirty = false;
    // người rời phòng: bỏ khỏi danh sách vẽ nhưng giữ lại (vào lại thì dùng lại đúng nhân vật đã dựng — trước đây mỗi lần vào
    // lại dựng nhân vật mới, bản cũ nằm lại trên GPU). Giữ tối đa 16 người; quá thì giải phóng người rời lâu nhất.
    for (const [k, a] of this.byKey) if (!keys.has(k)) { this.byKey.delete(k); this.list.splice(this.list.indexOf(a), 1); this.gone.delete(k); this.gone.set(k, a); a.placed = false; dirty = true; }
    while (this.gone.size > 16) { const [k, a] = this.gone.entries().next().value; this.gone.delete(k); this.release(a); }
    for (const p of people) {
      let a = this.byKey.get(p.key);
      if (!a && this.gone.has(p.key)) { a = this.gone.get(p.key); this.gone.delete(p.key); this.byKey.set(p.key, a); this.list.push(a); a.bubble = null; dirty = true; }
      const look = this.source(p.key)?.emp?.look || null;
      if (!a) {
        a = { key: p.key, display: p.display, visible: true, x: 0, y: 0, z: 0, f: 0, yaw: 0, face: 0, sit: 0, walkAmt: 0, walkPhase: 0, anim: 'idle', animT: Math.random() * 5, act: null, actT: 0, cup: false, onStair: null,
          emp: { look }, goal: { x: 0, z: 0, yaw: 0, sit: 0, act: null }, placed: false };
        this.byKey.set(p.key, a); this.list.push(a); dirty = true;
      } else if (look && JSON.stringify(look) !== JSON.stringify(a.emp.look)) { a.emp.look = look; dirty = true; }
    }
    if (dirty) this.sys.setColors(this.list);
  }
  get(key) { return this.byKey.get(key); }
  /** Giải phóng nhân vật đã dựng của một người (mọi bộ nhân vật của AvatarSystem đều giữ theo đối tượng người). */
  release(a) {
    for (const pool of [this.sys.mo, this.sys.glb, this.sys.vrm?.pool, this.sys.rigged?.pool]) {
      const it = pool?.inst?.get?.(a); if (it) { it.dispose?.(); pool.inst.delete(a); }
    }
  }
  attach(host) { this.tags = new NameTags(null, host); const L = this.tags.r.domElement, inp = host.querySelector('.rm-input'); if (inp) host.insertBefore(L, inp.nextSibling); }
  setSize(w, h) { this.tags?.setSize(w, h); }
  render(camera) { this.camPos = camera.position; this.tags?.render(null, camera); }
  /** Bong bóng lời nói trên đầu một người trong 6 giây. */
  say(key, text) {
    const a = this.byKey.get(key); if (!a) return;
    a.bubble = String(text).slice(0, 140); a.bubbleT = 6;
  }
  /** Đặt đích cho một người: x, z, yaw, sit (0/1), act; snap = đặt ngay (lần đầu vào phòng). */
  place(key, goal, snap = false) {
    const a = this.byKey.get(key); if (!a) return;
    Object.assign(a.goal, { sit: 0, act: null, y: 0 }, goal);
    if (snap || !a.placed) { a.x = goal.x; a.z = goal.z; a.yaw = a.face = goal.yaw ?? a.face; a.y = goal.y ?? 0; a.sit = goal.sit || 0; a.placed = true; }
  }
  update(dt) {
    const stride = 0.42 * (this.app.model.cs || 1);   // (bước chân như ngoài văn phòng — src/session/player.js STRIDE)
    for (const a of this.list) {
      const g = a.goal, dx = g.x - a.x, dz = g.z - a.z, d = Math.hypot(dx, dz);
      // nhân vật của mình đang tự đi (phòng tự lái: vị trí, hướng, bước chân đã tính sẵn) — chỉ còn động tác / nhãn
      const moving = a.driven ? a.walkAmt > 0.05 : d > 0.03 && a.sit < 0.05;
      if (a.driven) a.sit = Math.max(0, a.sit - dt * 3);
      else if (d > 0.03 && a.sit > 0.05) a.sit = Math.max(0, a.sit - dt * 3);             // (đang ngồi: đứng dậy trước rồi mới đi)
      else if (moving) {
        // xa thì đi nhanh hơn (theo kịp người đang đi / chạy như ngoài văn phòng), gần thì đi bộ; chân bước theo quãng đi
        const step = Math.min(d, Math.max(1.3, Math.min(d * 4, 5.5)) * dt); a.x += dx / d * step; a.z += dz / d * step;
        a.face += wrap(yawFacing(dx, dz) - a.face) * damp(12, dt);
        a.walkPhase += step / stride * Math.PI;
        a.walkAmt = Math.min(2, Math.max(a.walkAmt - dt * 5, step / dt / 3.8));
      } else {
        a.x = g.x; a.z = g.z; a.walkAmt = Math.max(0, a.walkAmt - dt * 5);
        if (g.yaw !== undefined) a.face += wrap(g.yaw - a.face) * damp(8, dt);
        a.sit += ((g.sit ? 1 : 0) - a.sit) * damp(5, dt);
      }
      if (!a.driven) a.y = g.y || 0;
      const act = a.forceAct || (moving ? null : g.act || null);   // (forceAct: đang nhảy)
      if (act !== a.act) { a.act = act; a.actT = 0; }
      a.actT += dt; a.animT += dt; a.anim = 'idle';
      // quẩy: cuối mỗi 4 động tác (32 nhịp) xoay một vòng
      const bt = a.act === 'quay' ? (a.actT * 128 / 60) % 32 : 0;
      a.yaw = a.face + (bt > 30 ? (bt - 30) / 2 * TAU : 0);
    }
    this.sys.update(this.list);
    for (const a of this.list) if (a.bubble && (a.bubbleT -= dt) <= 0) a.bubble = null;
    if (!this.tags) return;
    // bảng tên giống hệt văn phòng (src/ui/nameTags.js): viên tối, chấm màu phòng ban, chip phòng ban, bong bóng chat
    const entries = [];
    for (const a of this.list) {
      if (!a.visible) continue;
      const info = this.app.tagInfo?.(a.key) || { name: a.display };
      entries.push({ key: a.key, me: info.me, name: info.name || a.display, dept: info.dept, x: a.x, y: a.y, z: a.z, f: 0, sit: a.sit, bubble: a.bubble });
    }
    this.tags.update(entries, null, this.camPos || { x: 0, z: 0 }, this.app.model.cs || 1);
  }
}

// ---------- âm thanh nhỏ (tự tổng hợp, không tải file) ----------
let AC = null;
const ac = () => { try { AC ||= new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; } catch { return null; } };
/** Tiếng "cạch" ngắn: va bi, đánh cơ, rơi lỗ. kind: 'click' | 'cue' | 'pocket' | 'cushion'. vol 0..1. */
export function sfx(kind, vol = 0.5) {
  const c = ac(); if (!c || vol <= 0.01) return;
  const t = c.currentTime, g = c.createGain(); g.connect(c.destination);
  if (kind === 'pocket') {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g); o.start(t); o.stop(t + 0.26); return;
  }
  const len = kind === 'cushion' ? 0.05 : 0.03, buf = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, kind === 'cushion' ? 2 : 4);
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = kind === 'cushion' ? 'lowpass' : 'bandpass'; f.frequency.value = kind === 'cue' ? 1600 : kind === 'cushion' ? 700 : 3200; f.Q.value = 1.2;
  g.gain.value = (kind === 'cue' ? 0.9 : 0.6) * vol;
  s.connect(f); f.connect(g); s.start(t);
}
