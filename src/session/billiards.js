// Bàn bi-a (phòng giải trí, tầng trệt) cho 2 người: đi tới bàn → "E chơi bi-a" (bàn đủ 2 người thì "E vào xem"). Vào bàn
// là vào một phòng bi-a 3D riêng (src/rooms/billiardsRoom.js): camera sau bi chủ, ngắm, kéo lực, bi lăn trên bàn 3D. Server
// tính cú đánh (src/shared/billiards.js); mọi máy diễn lại cùng đường lăn — cả bàn bi-a trong văn phòng (người đứng xem
// trong văn phòng cũng thấy bi lăn).
import * as THREE from 'three';
import { esc as escHtml } from './ui.js';
import { simulate, rack, PX, PZ, BALL_R } from '../shared/billiards.js';
const IDLE = rack(() => 0.5);   // (chưa có ván: bi xếp sẵn trên bàn)
import * as VBIL from '../vendor/my-office/src/office/world/props/billiards.js';

const _v = new THREE.Vector3(), _ax = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Billiards {
  constructor(session) {
    this.s = session; this.state = null; this.anim = null; this.spectate = false;
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
  prompt() { const n = this.state?.players.length || 0; return n >= 2 ? '<b>E</b> vào xem ván bi-a' : `<b>E</b> chơi bi-a${n === 1 ? ` với ${escHtml(this.state.players[0].display)}` : ' (chờ người thứ hai)'}`; }
  /** Bấm E ở bàn: còn chỗ thì vào chơi, đủ người thì vào xem. */
  interact() { if ((this.state?.players.length || 0) >= 2) { this.spectate = true; this.enterRoom(); } else this.join(); }
  join() { this.s.rt.send({ t: 'bil:join' }); }
  leave() { this.s.rt.send({ t: 'bil:leave' }); }
  again() { this.s.rt.send({ t: 'bil:again' }); }
  shoot(ax, az, power) { if (this.myTurn()) this.s.rt.send({ t: 'bil:shot', ax, az, power }); }
  /** Bi hiện tại (đang lăn: theo mô phỏng). */
  balls() { return this.anim ? this.anim.sim.balls() : this.state?.balls || IDLE; }

  // ---------- phòng bi-a 3D ----------
  async enterRoom() {
    const stage = this.s.app.rooms; if (!stage) return;
    this.room = await stage.enter('billiards', async () => { const { BilliardsRoom } = await import('../rooms/billiardsRoom.js'); return new BilliardsRoom(this.s.app, this); });
    this.room?.sync(true);
  }
  /** Rời phòng; leaveTable: người chơi thì trả chỗ ở bàn. */
  exitRoom(leaveTable = false) {
    if (leaveTable && this.mine) this.leave();
    this.spectate = false; this.s.app.rooms?.exit('billiards');
    if (this.s.player?.agent.act === 'cue') this.s.player.setAct(null);
  }

  apply(st, shot) {
    const prev = this.state; this.state = st;
    if (shot && shot.before) this.anim = { sim: simulate(shot.before, shot), last: shot.before, by: shot.by, power: shot.power };
    else if (!this.anim) this.place(st.balls || IDLE);
    this.off = st.serverNow - Date.now();
    const me = this.mine;
    if (me) { if (this.spectate) this.spectate = false; if (!this.s.app.rooms?.is('billiards')) this.enterRoom(); }
    else if (!this.spectate && this.s.app.rooms?.is('billiards') && prev?.players.some(p => p.key === this.s.key)) this.exitRoom();
    this.room?.sync();
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
      if (done) { this.anim = null; if (this.state?.balls) this.place(this.state.balls); this.room?.sync(); }
    }
    const a = this.s.player?.agent, t = this.table;
    if (this.mine && a && t && !this.s.app.rooms?.is('billiards') && (a.f !== t.f || Math.hypot(a.x - t.x, a.z - t.z) > 6)) { this.s.toast('Bạn đã rời bàn bi-a.'); this.leave(); }
    // tư thế cơ: tới lượt mình và đang ngắm
    const pl = this.s.player;
    if (pl && this.mine) { const want = this.myTurn() ? 'cue' : null; if (pl.agent.act !== want && (want || pl.agent.act === 'cue')) { if (want && t) pl.agent.yaw = Math.atan2(-(t.x - pl.agent.x), -(t.z - pl.agent.z)); pl.setAct(want); } }
  }
  myTurn() { const st = this.state; return !!st && st.phase === 'aim' && st.players[st.turn]?.key === this.s.key && !this.anim && Date.now() + (this.off || 0) >= st.readyAt; }

}
