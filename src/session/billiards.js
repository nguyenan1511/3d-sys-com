// Bàn bi-a (phòng giải trí, tầng trệt) cho 2 người: đi tới bàn → "E chơi bi-a" (bàn đủ 2 người thì người khác đứng
// xem — bi vẫn lăn trên máy mọi người). Trong ván: khung bên phải có bảng tỉ số (nhóm bi, số bi còn lại, lượt), và
// tới lượt mình thì một mặt bàn nhìn từ trên: kéo NGƯỢC từ bi chủ như kéo ná để ngắm — kéo càng xa càng mạnh, thả tay
// là đánh. Server tính cú đánh (src/shared/billiards.js); mọi máy diễn lại cùng đường lăn trên bàn 3D rồi khớp kết quả.
import * as THREE from 'three';
import { esc } from './ui.js';
import { icon } from '../ui/icons.js';
import { simulate, rack, PX, PZ, BALL_R, POCKETS, groupOf, GROUP_NAME } from '../shared/billiards.js';
const IDLE = rack(() => 0.5);   // (chưa có ván: bi xếp sẵn trên bàn)
import * as VBIL from '../vendor/my-office/src/office/world/props/billiards.js';

const BALL_COL = ['#f7f4ea', '#f2c230', '#2350a8', '#d2302a', '#5b2d8e', '#e9762b', '#1f7a45', '#7a1f2b', '#15161a'];
const colOf = n => BALL_COL[n <= 8 ? n : n - 8];
const _v = new THREE.Vector3(), _ax = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Billiards {
  constructor(session) {
    this.s = session; this.state = null; this.anim = null; this.aim = null;
    const rt = session.rt;
    rt.on('hello', m => { if (m.bil) this.apply(m.bil); });
    rt.on('bil', m => this.apply(m.state, m.shot));
    rt.on('bilErr', m => session.toast(m.msg, true));
  }
  get table() {
    if (this._t !== undefined) return this._t;
    const B = VBIL.BIL; if (!B) return (this._t = null);
    B.g.getWorldPosition(_v);
    let f = 0; for (const fl of this.s.app.model.floors) if (_v.y >= fl.y - 0.6) f = fl.id;
    return (this._t = { B, x: _v.x, z: _v.z, f });
  }
  near(x, z, f) { const t = this.table; return t && f === t.f && Math.abs(x - t.x) < PX + 1.1 && Math.abs(z - t.z) < PZ + 1.1; }
  get mine() { return !!this.state?.players.some(p => p.key === this.s.key); }
  prompt() { const n = this.state?.players.length || 0; return n >= 2 ? '' : `<b>E</b> chơi bi-a${n === 1 ? ` với ${esc(this.state.players[0].display)}` : ' (chờ người thứ hai)'}`; }
  join() { this.s.rt.send({ t: 'bil:join' }); }
  leave() { this.s.rt.send({ t: 'bil:leave' }); }

  apply(st, shot) {
    const prev = this.state; this.state = st;
    if (shot && shot.before) this.anim = { sim: simulate(shot.before, shot), last: shot.before, by: shot.by };
    else if (!this.anim) this.place(st.balls || IDLE);
    this.off = st.serverNow - Date.now();
    const me = this.mine;
    if (me) this.open(); else if (this.pop) this.close();
    if (prev?.seq !== st.seq && st.msg && me) this.s.toast(`Bi-a — ${st.msg}`);
    this.render();
  }
  /** Đặt bi trên bàn 3D. */
  place(balls) {
    const t = this.table; if (!t) return;
    const y = (VBIL.CLOTH_Y ?? 0.79) + BALL_R;
    t.B.balls.forEach((m, i) => {
      const b = balls?.[i];
      if (!b || !b.on) { m.visible = false; return; }
      const dx = b.x - m.position.x, dz = b.z - m.position.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d > 1e-5 && d < 0.3) { _ax.set(dz, 0, -dx).normalize(); _q.setFromAxisAngle(_ax, d / BALL_R); m.quaternion.premultiply(_q); }
      m.visible = true; m.position.set(b.x, y, b.z);
    });
  }
  /** (mỗi khung hình) diễn cú đánh; đi xa khỏi bàn thì rời bàn. */
  update(dt) {
    if (this.anim) {
      const done = this.anim.sim.step(Math.min(dt, 0.05));
      this.place(this.anim.sim.balls());
      if (done) { this.anim = null; if (this.state?.balls) this.place(this.state.balls); this.render(); }
    }
    const a = this.s.player?.agent, t = this.table;
    if (this.mine && a && t && (a.f !== t.f || Math.hypot(a.x - t.x, a.z - t.z) > 6)) { this.s.toast('Bạn đã rời bàn bi-a.'); this.leave(); }
    // tư thế cơ: tới lượt mình và đang ngắm
    const pl = this.s.player;
    if (pl && this.mine) { const want = this.myTurn() ? 'cue' : null; if (pl.agent.act !== want && (want || pl.agent.act === 'cue')) { if (want && t) pl.agent.yaw = Math.atan2(-(t.x - pl.agent.x), -(t.z - pl.agent.z)); pl.setAct(want); } }
  }
  myTurn() { const st = this.state; return !!st && st.phase === 'aim' && st.players[st.turn]?.key === this.s.key && !this.anim && Date.now() + (this.off || 0) >= st.readyAt; }

  // ---------- giao diện ----------
  open() {
    if (!this.pop) {
      const el = this.pop = document.createElement('section'); el.className = 'bil-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Bi-a');
      el.innerHTML = `<header><b>🎱 Bi-a lỗ 8 bi</b><button type="button" class="bil-x" aria-label="Rời bàn">${icon('close', 14)}</button></header>
        <div class="bil-score"></div><p class="bil-msg"></p>
        <div class="bil-board"><canvas width="240" height="440" aria-label="Mặt bàn: kéo ngược từ bi chủ để ngắm, thả tay để đánh"></canvas><p class="bil-hint"></p></div>
        <div class="bil-act"><button type="button" class="bil-again" hidden>Ván mới</button><button type="button" class="bil-leave">Rời bàn</button></div>`;
      document.getElementById('appRoot').appendChild(el);
      el.querySelector('.bil-x').onclick = el.querySelector('.bil-leave').onclick = () => this.leave();
      el.querySelector('.bil-again').onclick = () => this.s.rt.send({ t: 'bil:again' });
      this.bindAim(el.querySelector('canvas'));
    }
    if (this.pop.hidden || !this.pop.classList.contains('show')) { this.pop.hidden = false; requestAnimationFrame(() => this.pop.classList.add('show')); }
  }
  close() { const el = this.pop; el.classList.remove('show'); setTimeout(() => { if (!this.mine) el.hidden = true; }, 220); if (this.s.player?.agent.act === 'cue') this.s.player.setAct(null); }
  render() {
    const el = this.pop, st = this.state; if (!el || !st) return;
    const q = c => el.querySelector(c), balls = st.balls || [];
    const left = grp => balls.filter((b, n) => b.on && groupOf(n) === grp).length;
    q('.bil-score').innerHTML = st.players.map((p, i) => {
      const g = st.groups[p.key], turn = st.phase === 'aim' && st.turn === i;
      return `<div class="bil-pl${turn ? ' turn' : ''}${st.winner === p.key ? ' win' : ''}"><b>${esc(p.display)}${p.key === this.s.key ? ' (bạn)' : ''}</b><small>${g ? `${GROUP_NAME[g]} · còn ${left(g)}` : 'chưa chia nhóm'}</small>${turn ? '<i>đang đánh</i>' : ''}${st.winner === p.key ? '<i>thắng 🏆</i>' : ''}</div>`;
    }).join('') + (st.players.length < 2 ? '<div class="bil-pl wait"><b>Đang chờ người thứ hai…</b><small>Rủ đồng nghiệp tới bàn bấm E</small></div>' : '');
    q('.bil-msg').textContent = st.msg ? st.msg.charAt(0).toUpperCase() + st.msg.slice(1) : '';
    q('.bil-again').hidden = st.phase !== 'over';
    q('.bil-board').hidden = st.phase === 'wait';   // (chờ người thứ hai: chưa cần mặt bàn)
    q('.bil-hint').textContent = st.phase === 'wait' ? '' : st.phase === 'over' ? 'Ván đã xong.' : this.anim ? 'Bi đang lăn…' : this.myTurn() ? 'Tới lượt bạn: kéo ngược từ bi trắng để ngắm, thả tay để đánh.' : 'Chờ đối thủ đánh…';
    this.draw();
  }
  /** Mặt bàn nhìn từ trên (canvas): bi, lỗ, đường ngắm. */
  draw() {
    const cv = this.pop?.querySelector('canvas'); if (!cv) return;
    const c = cv.getContext('2d'), W = cv.width, Hh = cv.height, m = 18, sx = (W - 2 * m) / (2 * PX), sz = (Hh - 2 * m) / (2 * PZ), s = Math.min(sx, sz);
    const X = x => W / 2 + x * s, Z = z => Hh / 2 + z * s;
    c.clearRect(0, 0, W, Hh);
    c.fillStyle = '#5a3a26'; c.beginPath(); c.roundRect(2, 2, W - 4, Hh - 4, 14); c.fill();
    c.fillStyle = '#1f7a45'; c.fillRect(X(-PX), Z(-PZ), 2 * PX * s, 2 * PZ * s);
    c.fillStyle = '#0b0b0d'; for (const P of POCKETS) { c.beginPath(); c.arc(X(P.x), Z(P.z), P.r * s * 0.9, 0, Math.PI * 2); c.fill(); }
    const balls = this.anim ? this.anim.sim.balls() : this.state?.balls; if (!balls) return;
    balls.forEach((b, n) => {
      if (!b.on) return;
      c.beginPath(); c.arc(X(b.x), Z(b.z), BALL_R * s, 0, Math.PI * 2); c.fillStyle = colOf(n); c.fill();
      if (n >= 9) { c.fillStyle = '#f7f4ea'; c.beginPath(); c.arc(X(b.x), Z(b.z), BALL_R * s * 0.55, 0, Math.PI * 2); c.fill(); }
      c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.stroke();
    });
    if (this.aim && balls[0]?.on) {
      const b = balls[0], k = this.aim.power;
      c.strokeStyle = 'rgba(255,255,255,.85)'; c.setLineDash([5, 5]); c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(X(b.x), Z(b.z)); c.lineTo(X(b.x + this.aim.ax * 1.2), Z(b.z + this.aim.az * 1.2)); c.stroke(); c.setLineDash([]);
      c.strokeStyle = `hsl(${30 - k * 30}, 95%, 55%)`; c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(X(b.x), Z(b.z)); c.lineTo(X(b.x - this.aim.ax * (0.08 + k * 0.4)), Z(b.z - this.aim.az * (0.08 + k * 0.4))); c.stroke();
    }
  }
  bindAim(cv) {
    const toTable = e => { const r = cv.getBoundingClientRect(), W = cv.width, Hh = cv.height, m = 18, s = Math.min((W - 2 * m) / (2 * PX), (Hh - 2 * m) / (2 * PZ));
      return { x: ((e.clientX - r.left) * W / r.width - W / 2) / s, z: ((e.clientY - r.top) * Hh / r.height - Hh / 2) / s }; };
    let id = null;
    cv.addEventListener('pointerdown', e => { if (!this.myTurn()) return; id = e.pointerId; cv.setPointerCapture(id); this.dragAim(toTable(e)); });
    cv.addEventListener('pointermove', e => { if (e.pointerId === id) this.dragAim(toTable(e)); });
    const up = e => { if (e.pointerId !== id) return; id = null; const a = this.aim; this.aim = null; if (a && a.power > 0.04 && this.myTurn()) this.s.rt.send({ t: 'bil:shot', ax: a.ax, az: a.az, power: a.power }); this.draw(); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', () => { id = null; this.aim = null; this.draw(); });
  }
  /** Kéo ngược: hướng đánh = từ điểm kéo về bi chủ; lực theo độ dài (tối đa ~0,45 m trên bàn). */
  dragAim(p) {
    const b = this.state?.balls?.[0]; if (!b?.on) return;
    const dx = b.x - p.x, dz = b.z - p.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.01) { this.aim = null; this.draw(); return; }
    this.aim = { ax: dx / d, az: dz / d, power: Math.min(1, d / 0.45) };
    this.draw();
  }
}
