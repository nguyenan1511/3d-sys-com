// Bàn bi-a (phòng giải trí, tầng trệt): 2 người chơi lỗ 8 bi, người khác đứng xem. Server giữ trạng thái và tự tính
// mọi cú đánh (vật lý dùng chung src/shared/billiards.js — mọi máy chạy ra cùng kết quả): máy người chơi chỉ gửi hướng
// + lực; server mô phỏng, áp luật, rồi gửi cho mọi người cú đánh (để diễn hoạt) và trạng thái sau cú đánh.
import { rack, simulate, applyRules } from '../src/shared/billiards.js';

export class Billiards {
  constructor(hub) { this.hub = hub; this.players = []; this.g = null; this.seq = 0; }
  display(key) { return this.hub.presence.get(key)?.display || key; }
  state() {
    const g = this.g;
    return { players: this.players.map(k => ({ key: k, display: this.display(k) })), turn: g?.turn ?? 0, groups: g?.groups || {}, balls: g?.balls || null,
      winner: g?.winner || null, phase: g ? (g.winner ? 'over' : 'aim') : 'wait', msg: g?.msg || '', seq: this.seq, readyAt: g?.readyAt || 0, serverNow: Date.now() };
  }
  push(extra = {}) { this.hub.broadcast({ t: 'bil', state: this.state(), ...extra }); }
  err(ws, msg) { this.hub.send(ws, { t: 'bilErr', msg }); }

  onMessage(ws, m) {
    if (m.t === 'bil:join') {
      if (this.players.includes(ws.key)) return;
      if (this.players.length >= 2) return this.err(ws, 'Bàn đang có 2 người chơi — đứng xem nhé.');
      this.players.push(ws.key);
      if (this.players.length === 2) this.newGame(0);
      return this.push();
    }
    if (m.t === 'bil:leave') return this.leave(ws.key);
    if (m.t === 'bil:again') { if (this.g?.winner && this.players.includes(ws.key) && this.players.length === 2) { this.newGame(this.players.indexOf(this.g.winner) === 0 ? 1 : 0); this.push(); } return; }
    if (m.t === 'bil:shot') return this.shot(ws, m);
  }
  newGame(breaker) { this.g = { players: [...this.players], turn: breaker, groups: {}, balls: rack(), winner: null, msg: 'bắt đầu — mời phá bi!', readyAt: 0 }; this.seq++; }
  leave(key) {
    const i = this.players.indexOf(key); if (i < 0) return;
    this.players.splice(i, 1);
    if (this.g && !this.g.winner && this.players.length === 1) { this.g.winner = this.players[0]; this.g.msg = `${this.display(key)} đã rời bàn.`; }
    if (!this.players.length) this.g = null;
    this.push();
  }
  shot(ws, m) {
    const g = this.g; if (!g || g.winner) return;
    if (g.players[g.turn] !== ws.key) return this.err(ws, 'Chưa tới lượt bạn.');
    if (Date.now() < g.readyAt) return;                     // (bi còn đang lăn trên máy mọi người)
    const ax = Number(m.ax), az = Number(m.az), power = Number(m.power);
    if (![ax, az, power].every(Number.isFinite) || Math.abs(ax) + Math.abs(az) < 1e-6 || power <= 0 || power > 1) return;
    const shot = { ax, az, power }, before = g.balls.map(b => ({ ...b }));
    const sim = simulate(before, shot), res = sim.finish(), after = sim.balls();
    const out = applyRules(g, before, after, res);
    const by = this.display(ws.key);
    Object.assign(g, { turn: out.turn, groups: out.groups, balls: out.balls, winner: out.winner, msg: `${by}: ${out.msg}`, readyAt: Date.now() + res.time * 1000 + 300 });
    this.seq++;
    this.push({ shot: { ...shot, by: ws.key, before, potted: res.potted } });
  }
}
