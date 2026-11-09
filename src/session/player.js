// Nhân vật của người chơi, góc nhìn thứ ba: WASD/mũi tên đi theo hướng camera, Shift chạy, Space nhảy,
// E ngồi/đứng tại ghế gần nhất (server kiểm tra quyền chủ chỗ), phím số cho động tác.
// Chuyển động có quán tính (tăng/giảm tốc), quay người có giới hạn, nhảy có nhún lấy đà và tiếp đất,
// ngồi thì đi tới trước ghế, quay người rồi mới ngồi. Mọi kích thước theo tỉ lệ nhân vật (layout.json → scale).
import { CEO_LOOK } from '../shared/departments.js';
import { smokeAllowed, NO_SMOKING } from '../shared/rules.js';
import { angDiff, facingVec, deg2yaw } from '../core/util.js';
import { characterDef } from '../agents/glbCharacters.js';

export const ACTIONS = [
  { key: '1', act: 'wave', label: 'Vẫy tay', icon: 'wave' },
  { key: '2', act: 'smoke', label: 'Hút thuốc (ngoài trời)', icon: 'smoke' },
  { key: '3', act: 'drink', label: 'Uống cà phê', icon: 'coffee' },
  { key: '4', act: 'phone', label: 'Gọi điện', icon: 'phone' },
  { key: '5', act: 'dance', label: 'Nhảy múa', icon: 'music' }
];
const MOVE = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r' };
const G = 9.8;

export class Player {
  constructor(app, session) {
    this.app = app; this.session = session;
    const cs = app.model.cs || 1; this.cs = cs;
    // điều khiển kiểu agent-office, theo chiều cao nhân vật H: đi 2.3·H/s, chạy 3.75·H/s, không có quán tính;
    // nhảy cao ~0.57·H, lên đỉnh trong 0.36 s (rơi nhanh, dứt khoát)
    const H = 1.5 * cs; this.H = H;
    this.CR = 1.5 * Math.max(cs, 0.9); // thước camera/tốc độ: nhân vật nhỏ nhưng camera vẫn xa, đi không chậm
    this.WALK = 2.3 * this.CR; this.RUN = 3.75 * this.CR; this.STRIDE = 0.42 * cs;
    const apex = 0.36, jh = 0.57 * H; this.JUMP_V = 2 * jh / apex; this.GJ = this.JUMP_V / apex;
    this.R = Math.min(0.26 * cs, 0.15); // (thân tròn ≤ 0,15 m: đi lọt mọi lối mà lưới đi lại cho phép — lưới tính thân 0,2 m từ tâm ô) this.BODY0 = 0.2; this.BODY1 = 1.7 * cs; // thân va chạm: từ 0.2 m trên chân (bước lên bậc 17 cm được)
    const e = session.me.employee || { look: CEO_LOOK, display: `CEO (${session.me.admin?.username || ''})` }; // CEO: nhân vật cố định mặc vest
    const sp = app.model.waypoints.lobby || { x: 1.3, z: 1.35 }; // điểm xuất hiện: sảnh (theo layout)
    this.agent = { key: session.key, local: true, idx: 0, visible: true, x: sp.x, y: app.model.floorY(0), z: sp.z, f: 0, yaw: 0, sit: 0, walkAmt: 0, walkPhase: 0, anim: 'idle', animT: 0, act: null, actT: 0, jumpH: 0, cup: false, onStair: null, camH: 0.75 * cs, camR: this.CR, emp: { look: e.look || {} }, display: e.display };
    this.vx = 0; this.vz = 0; this.vy = 0; this.onGround = true; this.keys = {}; this.run = false;
    this.seq = null; this.seated = null; this.jumpWind = 0; this.landT = 1; this.path = null; this.stuckFor = 0;
    this.active = true; this.lastSent = '';
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', () => { this.keys = {}; this.run = false; });
  }

  get typing() {
    const t = document.activeElement, dash = document.getElementById('dash');
    return !!(t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) || !!document.querySelector('.modal-back') || !!(dash && !dash.hidden);
  }

  onKey(e) {
    if (!this.active || this.app.rig.walkMode || this.typing) { if (e.type === 'keyup') { this.keys = {}; this.run = false; } return; }
    const k = e.key.toLowerCase(), down = e.type === 'keydown';
    if (k === 'shift') { this.run = down; return; }
    if (MOVE[k]) { this.keys[MOVE[k]] = down; e.preventDefault(); if (down) { this.follow(); this.stopPath(); } return; }
    if (!down || e.repeat) return;
    if (k === ' ') { e.preventDefault(); this.jump(); return; }
    if (k === 'e') { e.preventDefault(); const at = this.session.att; if (!this.seated && !this.sofa && !this.seq && at?.code && at.near(this.agent.x, this.agent.z, this.agent.f)) { at.open(); return; } if (!this.seated && !this.sofa && !this.seq && this.app.musicCorner?.near(this.agent.x, this.agent.z, this.agent.f)) { this.session.social?.openMusic(); return; } const g = this.session.guide; if (!this.seated && !this.sofa && !this.seq && g?.near(this.agent.x, this.agent.z, this.agent.f)) { g.talk(); return; } if (!this.seated && this.session.openLift()) return; this.toggleSit(); return; }
    if (k === 'escape') { this.setAct(null); return; }
    if (k === 'c') { this.follow(); this.app.rig.recenter = true; return; }
    if ((k === 'v' || k === 'c') && this.app.mode2d) return; // 2D: không có góc nhìn thứ nhất / camera sau lưng
    if (k === 'v') { this.follow(); this.app.rig.setFirstPerson(!this.app.rig.fp); this.app.onViewChange?.(this.app.rig.fp); return; }
    if (k === 'f') { e.preventDefault(); this.session.toggleBlindNear(); return; }
    if (k === 'b') { e.preventDefault(); this.session.goToDesk(); return; } // về bàn làm việc: tự đi tới (khác tầng thì đi thang máy) và ngồi
    const a = ACTIONS.find(x => x.key === k);
    if (a) { e.preventDefault(); this.setAct(this.agent.act === a.act ? null : a.act); }
  }

  /** Camera về bám nhân vật (góc rộng để thấy thoáng không gian). */
  follow() {
    const rig = this.app.rig;
    if (rig.follow === this.agent) return;
    if (rig.walkMode) rig.setWalk(false);
    this.app.showFloor(null, false);
    // camera kiểu agent-office: sau lưng, cách ~3.75 lần chiều cao, nhìn chếch xuống 0.42 rad
    // góc nhìn thứ ba ngang vai, luôn có trần nhà (không cắt trần/tầng trên khi đi trong nhà)
    rig.follow = this.agent; rig.G.r = rig.S.r = 7.6 * this.CR; rig.G.ph = rig.S.ph = Math.PI / 2 - 0.3; // (xa và cao hơn: thấy rõ xung quanh)
    rig.S.th = rig.G.th = this.agent.yaw; rig.camDist = null; this.app.autoCut = false;
    if (this.app.cutFloor() !== null) this.app.showFloor(null, false); // bỏ cắt tầng còn sót (từ lúc chọn chỗ/xem tầng)
    this.app.onFollowChange?.(true);
  }

  setAct(act) {
    const a = this.agent;
    if (this.sofa) return; // đang ngồi sofa xem TV (bấm E hoặc đi để đứng dậy)
    if (act === 'jump') return;
    if (act === 'smoke' && (!smokeAllowed(a.x, a.z) || a.sit > 0.5)) { this.session.toast(NO_SMOKING, true); return; } // quy định văn phòng
    a.act = act; a.actT = 0; this.send(true);
    this.app.onActChange?.(act);
  }

  /** Nhảy: nhún lấy đà 0.12 s rồi bật lên. */
  jump() {
    if (this.seated || this.seq || !this.onGround || this.jumpWind > 0) return;
    this.jumpWind = 0.04; this.lastJumpPeak = null;
    this._afterJump = this.agent.act && this.agent.act !== 'jump' ? this.agent.act : null;
    this.agent.act = 'jump'; this.agent.actT = 0; this.send(true);
  }

  async toggleSit() {
    if (this.seq) return;
    if (this.sofa) { this.standSofa(); return; }
    if (this.seated) { await this.session.stand(); return; }
    // sofa khu giải trí: ngồi xem TV (không cần server duyệt, chỉ báo động tác 'tv' cho người khác)
    const tv = this.session.tv, sofa = tv?.near(this.agent.x, this.agent.z, this.agent.f);
    if (sofa) {
      if (!tv.free(sofa, this.session.remote.list.filter(x => x !== this.agent))) { this.session.toast('Chỗ này có người ngồi rồi.', true); return; }
      this.sitSofa(sofa); return;
    }
    const m = this.app.model, a = this.agent;
    let best = null, bd = 0.9;
    for (const d of m.desks) {
      if (Math.abs(m.floorY(d.floor) - a.y) > 0.4) continue;
      const dd = Math.hypot(d.seat.x - a.x, d.seat.z - a.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    if (!best) { this.session.toast('Lại gần một chiếc ghế rồi bấm E để ngồi.'); return; }
    await this.session.sit(best.id); // server quyết định; thành công thì gọi sitAt()
  }

  /** Đi tới trước ghế, quay người, ngồi xuống (sau khi server đã duyệt). */
  sitAt(desk) {
    const a = this.agent, f = facingVec(desk.facing || 0), y = this.app.model.floorY(desk.floor), fs = this.app.model.fs || 1;
    const front = { x: desk.seat.x + f.x * 0.16 * fs, z: desk.seat.z + f.z * 0.16 * fs };
    this.seated = desk.id; this.vx = this.vz = 0;
    if (a.act === 'dance' || a.act === 'wave') a.act = null;
    const dist = Math.hypot(front.x - a.x, front.z - a.z);
    this.seq = [
      { kind: 'walk', from: { x: a.x, z: a.z }, to: front, dur: Math.max(0.05, dist / this.WALK) },
      { kind: 'turn', yaw: deg2yaw(desk.facing || 0), dur: 0.3 },
      { kind: 'sit', from: front, to: { x: desk.seat.x, z: desk.seat.z }, y, f: desk.floor, dur: 0.7 }
    ];
    this.seqT = 0;
  }
  /** Ngồi sofa xem TV: đi tới trước sofa, quay lưng về sofa, ngồi xuống. */
  sitSofa(seat) {
    const a = this.agent, y = this.app.model.floorY(0);
    this.stopPath(); this.sofa = seat; this.vx = this.vz = 0;
    a.act = 'tv'; a.actT = 0;
    const dist = Math.hypot(seat.front.x - a.x, seat.front.z - a.z);
    this.seq = [
      { kind: 'walk', from: { x: a.x, z: a.z }, to: seat.front, dur: Math.max(0.05, dist / this.WALK) },
      { kind: 'turn', yaw: seat.yaw, dur: 0.3 },
      { kind: 'sit', from: seat.front, to: { x: seat.x, z: seat.z }, y, f: 0, dur: 0.7, anim: 'tv' }
    ];
    this.seqT = 0; this.send(true);
    // camera chéo sau vai (thấy cả người lẫn TV): chọn bên thoáng hơn
    const rig = this.app.rig;
    if (rig.follow === a && rig.viewScore) {
      const H = this.H, cand = [seat.yaw - 1.2, seat.yaw + 1.2], sc = th => rig.viewScore({ ...a, x: seat.x, z: seat.z, y }, th, rig.S.ph, rig.S.r, H);
      rig.escapeTh = sc(cand[0]) >= sc(cand[1]) ? cand[0] : cand[1]; rig.lastUserOrbit = 0;
    }
  }
  standSofa() {
    const seat = this.sofa; if (!seat) return;
    const a = this.agent; this.sofa = null; a.anim = 'idle'; a.act = null;
    this.seq = [{ kind: 'stand', from: { x: a.x, z: a.z }, to: seat.front, dur: 0.6 }];
    this.seqT = 0; this.send(true);
  }
  /** Đứng dậy, lùi ra khỏi ghế. */
  standUp() {
    if (!this.seated) return;
    const a = this.agent, d = this.app.model.deskById.get(this.seated), f = facingVec(d.facing || 0), fs = this.app.model.fs || 1;
    this.seated = null; a.anim = 'idle';
    this.seq = [
      { kind: 'stand', from: { x: a.x, z: a.z }, to: { x: d.seat.x + f.x * 0.16 * fs, z: d.seat.z + f.z * 0.16 * fs }, dur: 0.6 },
      { kind: 'walk', back: true, from: null, to: { x: d.seat.x - f.x * 0.45 * fs, z: d.seat.z - f.z * 0.45 * fs }, dur: 0.45 }
    ];
    this.seqT = 0;
  }
  /** Đặt thẳng vào ghế (vào phiên khi đã có chỗ, hoặc đang ở quá xa). */
  placeSeated(desk) {
    const a = this.agent;
    this.seated = desk.id; this.seq = null;
    Object.assign(a, { x: desk.seat.x, z: desk.seat.z, y: this.app.model.floorY(desk.floor), f: desk.floor, yaw: deg2yaw(desk.facing || 0), sit: 1, walkAmt: 0, anim: 'type' });
    this.send(true);
  }

  runSeq(dt) {
    const a = this.agent, st = this.seq[0];
    if (st.from === null) st.from = { x: a.x, z: a.z };
    if (st.yaw0 === undefined) st.yaw0 = a.yaw;
    this.seqT += dt;
    const t = Math.min(1, this.seqT / st.dur), k = t * t * (3 - 2 * t);
    if (st.kind === 'walk') {
      a.x = st.from.x + (st.to.x - st.from.x) * t; a.z = st.from.z + (st.to.z - st.from.z) * t;
      const dx = st.to.x - st.from.x, dz = st.to.z - st.from.z;
      if (!st.back && Math.hypot(dx, dz) > 0.02) a.yaw += angDiff(a.yaw, Math.atan2(-dx, -dz)) * Math.min(1, dt * 10);
      a.walkAmt = st.back ? 0.5 : 1; a.walkPhase += Math.hypot(dx, dz) / st.dur * dt / this.STRIDE * Math.PI * (st.back ? -1 : 1);
    } else if (st.kind === 'turn') {
      a.yaw = st.yaw0 + angDiff(st.yaw0, st.yaw) * k; a.walkAmt *= 0.8;
    } else if (st.kind === 'sit') {
      a.x = st.from.x + (st.to.x - st.from.x) * k; a.z = st.from.z + (st.to.z - st.from.z) * k;
      a.sit = k; a.walkAmt = 0; if (t >= 1) { a.anim = st.anim || 'type'; a.f = st.f; a.y = st.y; }
    } else if (st.kind === 'stand') {
      a.x = st.from.x + (st.to.x - st.from.x) * k; a.z = st.from.z + (st.to.z - st.from.z) * k;
      a.sit = 1 - k; a.walkAmt = 0;
    }
    if (t >= 1) { this.seq.shift(); this.seqT = 0; if (!this.seq.length) { this.seq = null; a.walkAmt = 0; this.send(true); } }
  }

  /** Mỗi khung hình. Khung chậm (máy yếu) thì chia thành các bước ≤ 1/30 giây: đi/chạy/nhảy luôn đúng tốc độ thật. */
  update(dt) {
    const n = Math.min(30, Math.ceil(dt / (1 / 30)));      // (mỗi bước ≤ 1/30 s: không đi xuyên vách mỏng)
    for (let i = 0; i < n; i++) this.step(dt / n);
  }
  step(dt) {
    const a = this.agent, rig = this.app.rig;
    a.animT += dt; a.actT += dt;
    if (a.act === 'wave' && a.actT > 2.6) this.setAct(null);
    if (this.seq) { this.runSeq(dt); this.send(); return; }
    const K = this.keys, f = (K.f ? 1 : 0) - (K.b ? 1 : 0), r = (K.r ? 1 : 0) - (K.l ? 1 : 0);
    a.moveFwd = f > 0; // camera chỉ tự xoay theo khi đi tới, tránh đi vòng tròn khi đi ngang
    if (this.sofa) { if (f || r) this.standSofa(); a.walkAmt = 0; this.send(); return; } // đang xem TV: muốn đi thì đứng dậy
    if (this.seated) {
      // muốn đi thì đứng dậy — chỉ gửi một lần (đang chờ server trả lời thì không gửi tiếp)
      if ((f || r) && !this._standing) { this._standing = true; Promise.resolve(this.session.stand()).finally(() => { this._standing = false; }); }
      a.walkAmt = 0; this.send(); return;
    }
    // đi theo hướng camera, tốc độ đều, không quán tính (kiểu agent-office); nhân vật quay mặt theo hướng đi
    const th = rig.S.th, fx = -Math.sin(th), fz = -Math.cos(th), rx = Math.cos(th), rz = -Math.sin(th);
    let mx = fx * f + rx * r, mz = fz * f + rz * r;
    let moving = Math.hypot(mx, mz) > 0.01;
    // nhìn bằng mắt nhân vật: luôn quay mặt theo hướng camera
    if (rig.fp) a.yaw = th;
    const sk = characterDef(a.emp?.look?.model)?.speed ?? 1;
    let run = this.run;
    if (!moving && this.path) {
      const st = this.followPath(dt);
      if (st) { mx = st.x; mz = st.z; moving = true; run = st.run; }
    }
    const top = (run ? this.RUN : this.WALK) * sk;
    if (moving) { const len = Math.hypot(mx, mz); mx /= len; mz /= len; }
    const ctrl = this.onGround ? 1 : 0.6; // trên không vẫn lái được, nhẹ hơn
    this.vx = moving ? mx * top * ctrl + this.vx * (1 - ctrl) : (this.onGround ? 0 : this.vx * 0.98);
    this.vz = moving ? mz * top * ctrl + this.vz * (1 - ctrl) : (this.onGround ? 0 : this.vz * 0.98);
    const R = this.R, b0 = this.BODY0, b1 = this.BODY1;
    const dx = this.vx * dt, dz = this.vz * dt, before = { x: a.x, z: a.z };
    // đang lọt sẵn trong vật cản (vừa được đặt/đứng dậy sát bàn): cho đi ra, không kẹt cứng
    // va chạm hình khối + lưới đi lại (không lọt vào góc chết: sau tủ, khe giữa tường và đồ đạc, hông nhà ngoài hàng rào…)
    const ok = (x, z) => !rig.blocked(x, z, a.y, R, b0, b1) && this.walkable(x, z);
    const inside = (dx || dz) && (rig.blocked(a.x, a.z, a.y, R, b0, b1) || !this.walkable(a.x, a.z));
    if (dx && (inside || ok(a.x + dx, a.z))) a.x += dx; else if (dx) this.vx = 0;
    if (dz && (inside || ok(a.x, a.z + dz))) a.z += dz; else if (dz) this.vz = 0;
    const moved = Math.hypot(a.x - before.x, a.z - before.z), speed = moved / Math.max(dt, 1e-4);
    if (this.path) this.stuckFor = moved < top * dt * 0.2 ? this.stuckFor + dt : 0;
    if (this.path && this.stuckFor > 1) this.stopPath('stuck');
    a.walkPhase += moved / this.STRIDE * Math.PI;
    if (!rig.fp && speed > 0.05 * this.cs && moving) a.yaw += angDiff(a.yaw, Math.atan2(-mx, -mz)) * Math.min(1, dt * 14);
    if (moving && (a.act === 'dance' || a.act === 'wave')) this.setAct(null);
    if (a.act === 'smoke' && !smokeAllowed(a.x, a.z)) { this.setAct(null); this.session.toast(NO_SMOKING, true); } // đi vào toà nhà thì dập thuốc
    a.walkAmt = Math.min(2, speed / (this.WALK * sk)) * (this.onGround ? 1 : 0.3);
    // nhảy: nhún lấy đà -> bật -> rơi -> nhún khi tiếp đất
    if (this.jumpWind > 0) { this.jumpWind -= dt; if (this.jumpWind <= 0) { this.vy = this.JUMP_V; this.onGround = false; } }
    const ground = rig.groundAt(a.x, a.z, a.y);
    if (!this.onGround) this.airPeak = Math.max(this.airPeak ?? a.y, a.y); else if (!this.jumpWind) this.airPeak = null; // (độ cao cao nhất của cú nhảy gần nhất — kiểm thử)
    if (!this.onGround || this.vy > 0) {
      this.vy -= this.GJ * dt; a.y += this.vy * dt;
      if (a.y <= ground) { a.y = ground; this.vy = 0; this.onGround = true; this.landT = 0; this.lastJumpPeak = this.airPeak; }
    } else if (ground < a.y - 0.35) { this.onGround = false; this.vy = 0; } // rơi khỏi mép
    else a.y += (ground - a.y) * Math.min(1, dt * 14);
    this.landT += dt; a.landT = this.landT; a.airborne = !this.onGround;
    if (a.act === 'jump' && this.onGround && this.jumpWind <= 0 && this.landT > 0.15) { a.act = this._afterJump || null; a.actT = 0; this.send(true); }
    let fl = 0; for (const x of this.app.model.floors) if (a.y >= x.y - 0.3) fl = x.id;
    a.f = fl;
    this.send();
  }

  /**
   * Chỗ (x, z) ở tầng hiện tại có được đứng không theo lưới đi lại (cùng lưới nhân viên mô phỏng dùng): trong nhà, sân,
   * vỉa hè, sân thượng phải là ô thoáng (cách vật cản ≥ 0,1 m); đang trên cầu thang thì bỏ qua (do bậc thang quyết định);
   * tầng trệt phía trước vỉa hè (lòng đường) đi tự do như cũ.
   */
  walkable(x, z) {
    const a = this.agent, m = this.app.model, nav = this.app.nav; if (!nav?.grid) return true;
    for (const st of m.stairs) if (x >= st.x0 - 0.3 && x <= st.x1 + 0.3 && z >= st.z0 - 0.3 && z <= st.z1 + 0.3 && (a.f === st.from || a.f === st.to)) return true;
    if (a.f === 0 && z > 9.3) return true;                                     // lòng đường (cảnh báo xuống lòng đường vẫn chạy)
    const g = nav.grid(a.f); if (!g) return true;
    return g.isFree(x, z, 0.1) && this.camOk(x, z);
  }
  /**
   * Ngách / điểm chết: chỗ mà xoay camera hướng nào (kể cả nâng cao) cũng không đủ khoảng trống để thấy trọn nhân vật thì
   * không cho bước vào. Kết quả lưu theo ô 0,2 m, mỗi ô chỉ tính một lần.
   */
  camOk(x, z) {
    const rig = this.app.rig, a = this.agent; if (!rig?.bestArm) return true;
    const key = `${a.f}:${Math.round(x / 0.2)}:${Math.round(z / 0.2)}`, c = this._camOk || (this._camOk = new Map());
    if (c.has(key)) return c.get(key);
    const t = this._camT || (this._camT = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }), probe = { ...a, x, z }, need = rig.armNeed(a);
    t.set(x, a.y + 0.65 * this.H, z);
    let ok = false;
    for (let q = 0; q < 12 && !ok; q++) ok = rig.bestArm(t, q * Math.PI / 6, Math.PI / 2 - 0.5, 10, probe, need).f >= need;
    c.set(key, ok); return ok;
  }
  /** Tự đi tới điểm (x, z) trên tầng f theo lưới điều hướng (bấm chuột lên sàn). Đường xa thì chạy. */
  walkTo(x, z, f) {
    const a = this.agent, nav = this.app.nav;
    if (this.seated || this.seq) return false;
    const res = nav.path({ x: a.x, z: a.z, f: a.f }, { x, z, f });
    if (!res || res.points.length < 2) return false;
    // đích cùng tầng mà đường đi vòng qua tầng khác (cầu thang): không đi — tránh tự chạy xuống tầng khác tới chỗ lạ
    if (f === a.f && res.points.some(p => p.f !== undefined && p.f !== f)) return false;
    this.path = res.points.slice(1).map(p => ({ x: p.x, z: p.z })); this.stuckFor = 0;
    this.follow();
    return true;
  }
  stopPath(why = 'cancelled') { if (!this.path) return; this.path = null; this.lastStop = why; this.app.onPathEnd?.(why); }
  /** Hướng đi tiếp theo trên đường đã tìm (hoặc null khi tới nơi). */
  followPath() {
    const a = this.agent, path = this.path;
    let next = path[0];
    while (next && Math.hypot(next.x - a.x, next.z - a.z) < 0.12 * this.cs / 0.5) { path.shift(); next = path[0]; }
    if (!next) { this.stopPath('arrived'); return null; }
    let left = Math.hypot(next.x - a.x, next.z - a.z);
    for (let i = 1; i < path.length; i++) left += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    return { x: next.x - a.x, z: next.z - a.z, run: left > 3 * this.CR };
  }

  /** Gửi trạng thái cho người khác (giới hạn tần suất; đổi động tác thì gửi ngay). */
  send(force = false) {
    const a = this.agent, rt = this.session.rt;
    const msg = { x: +a.x.toFixed(3), y: +a.y.toFixed(3), z: +a.z.toFixed(3), f: a.f, yaw: +a.yaw.toFixed(3), walk: a.walkAmt > 0.3, run: a.walkAmt > 1.3, act: a.act || '' };
    const sig = JSON.stringify(msg);
    if (sig === this.lastSent) return;
    if (force) rt.lastPos = 0;
    const before = rt.lastPos;
    rt.sendPos(msg);
    if (rt.lastPos !== before) this.lastSent = sig;
  }

  /** Camera không ra khỏi phòng / xuyên trần khi nhân vật ở trong nhà. */
  clampCamera(pos) {
    const a = this.agent;
    if (this.app.rig.follow !== a) return;
    if (this.app.clampIndoor) { this.app.clampIndoor(pos, a); return; } // (toà nhà lớn: giới hạn theo vỏ nhà — main.js)
    // tường/vật cản đã do tia va chạm của camera xử lý; ở đây chỉ giữ camera dưới trần và trên sàn tầng hiện tại
    const inside = a.x > -3.2 && a.x < 3.2 && a.z < 4.3 && a.z > -7;
    if (!inside) { pos.y = Math.max(pos.y, a.y + 0.25); return; }
    const fl = this.app.model.floorById.get(a.f);
    const top = fl.ceiling - 0.2; // camera luôn dưới trần nhà
    pos.y = Math.min(top, Math.max(fl.y + 0.25, pos.y));
  }

  dispose() { window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKey); }
}
