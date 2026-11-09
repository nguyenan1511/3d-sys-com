// Mô phỏng ngày làm việc: đồng hồ, state machine từng nhân viên, giữ chỗ, xếp hàng, né nhau.
// Thuần JS (không three.js) để test chạy được cả ngày trong Node.
import { dayPlan } from './schedule.js';
import { seatApproach } from '../model/layoutModel.js';
import { deg2yaw, yawOf, angDiff, inRect, hashStr, rng, smooth, parseTime, clamp } from '../core/util.js';

export const ST = {
  OUTSIDE: 'outside', ARRIVING: 'arriving', WALKING: 'walking', WORKING: 'working', PANTRY: 'pantry',
  MEETING: 'meeting', LUNCH: 'lunch', WC: 'wc', LEAVING: 'leaving', GONE: 'gone'
};
export const ST_LABEL = {
  outside: 'Ngoài đường', arriving: 'Đang đến', walking: 'Đang đi', working: 'Làm việc', pantry: 'Giải lao pantry',
  meeting: 'Họp', lunch: 'Ăn trưa', wc: 'Đi vệ sinh', leaving: 'Đang về', gone: 'Đã về'
};
const GOAL_LABEL = { desk: 'về bàn', meeting: 'phòng họp', pantry: 'pantry', wc: 'WC', lunch: 'ăn trưa', out: 'ra ngoài' };

const SIT_T = 0.9, STAND_T = 0.8;

export class Agent {
  constructor(sim, emp, idx) {
    this.sim = sim; this.emp = emp; this.idx = idx; this.id = emp.id;
    this.desk = sim.model.deskById.get(emp.deskId);
    this.deskSeat = this.desk.seat;
    this.speed = emp.speed;
    this.side = hashStr(emp.id) % 2 ? 'spawnR' : 'spawnL';
    this.r = rng(hashStr(emp.id + '#beh'));
    this.reset();
  }
  reset() {
    const sp = this.sim.model.waypoints[this.side];
    this.x = sp.x; this.z = sp.z; this.f = sp.f; this.y = this.sim.model.heightAt(sp.f, sp.x, sp.z);
    this.yaw = 0; this.visible = false; this.state = ST.OUTSIDE; this.goal = null; this.activity = null;
    this.sit = 0; this.walkAmt = 0; this.walkPhase = 0; this.anim = 'idle'; this.animT = this.r() * 10; this.cup = false;
    this.path = null; this.pi = 0; this.onStair = null; this.seat = null; this.waiting = null; this.blockT = 0;
    this.doors = new Set(); this.holds = 0; this.co = null; this.plan = dayPlan(this.emp, this.sim.day); this.ai = 0;
    this.atDesk = false;
  }
  get label() { return this.state === ST.WALKING && this.goal ? `${ST_LABEL.walking} → ${GOAL_LABEL[this.goal] || this.goal}` : ST_LABEL[this.state]; }

  update(dt) {
    if (!this.co) this.co = this.routine();
    const r = this.co.next(dt);
    if (r.done) this.co = null;
    this.animT += dt;
    // độ cao theo sàn hoặc theo bậc thang
    const st = this.onStair && this.sim.model.stairById.get(this.onStair);
    const ty = st && inRect(st.rect, this.x, this.z) ? this.sim.model.stairHeight(st, this.x, this.z) : this.sim.model.heightAt(this.f, this.x, this.z);
    this.y += (ty - this.y) * Math.min(1, dt * 12);
    if (Math.abs(ty - this.y) > 0.6) this.y = ty;
  }

  // ---------- kịch bản cả ngày ----------
  *routine() {
    const sim = this.sim;
    while (sim.t < this.plan.arrive) yield;
    if (sim.t > this.plan.leave) { this.state = ST.GONE; while (true) yield; }
    this.state = ST.ARRIVING; this.spawn();
    if (sim.t > this.plan.arrive + 1800 && sim.fastForward) this.teleportTo(seatApproach(this.deskSeat)); // nhảy giờ: đặt thẳng vào chỗ
    yield* this.goSitDesk(sim.model.routes.arrive, ST.ARRIVING, 'desk');
    this.state = ST.WORKING; this.atDesk = true;
    for (;;) {
      const next = this.plan.acts[this.ai];
      const until = Math.min(next ? next.t : Infinity, this.plan.leave);
      this.anim = 'type';
      while (sim.t < until && !this.moveDesk) yield;
      if (this.moveDesk) { yield* this.changeDesk(); continue; }
      if (sim.t >= this.plan.leave) break;
      this.ai++;
      const endOf = next.end ?? (next.t + (next.dur || 0));
      if (endOf < sim.t + 60) continue; // lỡ hoạt động
      yield* this.doActivity(next);
    }
    // về
    yield* this.standUp(); this.atDesk = false;
    this.state = ST.LEAVING;
    yield* this.walkTo(sim.model.waypoints[this.side], sim.model.routes.leave, ST.LEAVING, 'out');
    this.visible = false; this.state = ST.GONE;
    while (true) yield;
  }

  /** Đi về bàn của mình rồi ngồi; nếu bàn bị đổi giữa đường (chủ thật nhận bàn) thì đi tiếp tới bàn mới. */
  *goSitDesk(via, state, goal) {
    for (let i = 0; i < 4; i++) {
      const target = this.deskSeat;
      yield* this.walkTo(seatApproach(target), i ? [] : via, state, goal);
      if (target === this.deskSeat) break;
    }
    yield* this.sitDown(this.deskSeat);
  }

  *changeDesk() {
    this.moveDesk = false;
    const nd = this.sim.model.deskById.get(this.emp.deskId);
    if (!nd || nd === this.desk) return;
    yield* this.standUp(); this.atDesk = false;
    this.desk = nd; this.deskSeat = nd.seat;
    yield* this.goSitDesk([], ST.WALKING, 'desk');
    this.state = ST.WORKING; this.atDesk = true;
  }

  *backToDesk() {
    yield* this.goSitDesk([], ST.WALKING, 'desk');
    this.state = ST.WORKING; this.atDesk = true;
  }

  *doActivity(a) {
    const sim = this.sim;
    this.activity = a;
    if (a.type === 'meeting') {
      const tbl = sim.model.meetingRooms.get(a.room);
      const seat = tbl && sim.reserveSeat(tbl.seats, this);
      if (!seat) { this.activity = null; return; }
      yield* this.standUp(); this.atDesk = false;
      yield* this.walkTo(seatApproach(seat), [], ST.WALKING, 'meeting');
      yield* this.sitDown(seat);
      this.state = ST.MEETING; this.anim = 'talk';
      while (sim.t < a.end) yield;
      yield* this.standUp(); sim.releaseSeat(seat, this);
      yield* this.backToDesk();
    } else if (a.type === 'pantry') {
      const spot = sim.reserveSeat(sim.model.standSpots, this);
      if (!spot) return;
      yield* this.standUp(); this.atDesk = false;
      yield* this.walkTo({ x: spot.x, z: spot.z, f: spot.floor }, [], ST.WALKING, 'pantry');
      yield* this.turnTo(deg2yaw(spot.facing));
      this.state = ST.PANTRY; this.anim = 'pour';
      const t1 = sim.t + this.r.range(50, 110);
      while (sim.t < t1) yield;
      this.cup = true; this.anim = 'cup';
      const end = a.t + a.dur;
      const seat = sim.model.pantryTable && this.r() < 0.6 ? sim.reserveSeat(sim.model.pantryTable.seats, this) : null;
      sim.releaseSeat(spot, this);
      if (seat) {
        yield* this.walkTo(seatApproach(seat), [], ST.PANTRY, null);
        this.state = ST.PANTRY;
        yield* this.sitDown(seat); this.anim = 'cup';
        while (sim.t < end) yield;
        yield* this.standUp(); sim.releaseSeat(seat, this);
      } else {
        // đứng uống cạnh quầy, lùi ra một chút nhường chỗ
        while (sim.t < end) yield;
      }
      this.cup = false;
      yield* this.backToDesk();
    } else if (a.type === 'wc') {
      const wc = sim.model.wcs[0];
      if (!wc) return;
      yield* this.standUp(); this.atDesk = false;
      const q = sim.wcQueue(wc.id); q.push(this);
      yield* this.walkTo(wc.pQueue, [], ST.WALKING, 'wc', () => sim.wcHolder(wc.id) === this);
      this.waiting = 'wc';
      while (sim.wcHolder(wc.id) !== this) yield;
      this.waiting = null; this.holds++;
      yield* this.walkTo(wc.pInside, [], ST.WC, null);
      yield* this.turnTo(deg2yaw(wc.facing ?? 0));
      this.state = ST.WC; this.anim = 'idle';
      const end = sim.t + a.dur;
      while (sim.t < end) yield;
      yield* this.walkTo(wc.pQueue, [], ST.WC, null);
      sim.wcRelease(wc.id, this); this.holds--;
      yield* this.backToDesk();
    } else if (a.type === 'lunch') {
      const end = a.t + a.dur;
      if (a.place === 'desk') {
        this.state = ST.LUNCH; this.anim = 'eat';
        while (sim.t < end) yield;
        this.state = ST.WORKING; return;
      }
      if (a.place === 'pantry') {
        const seat = sim.model.pantryTable && sim.reserveSeat(sim.model.pantryTable.seats, this);
        if (seat) {
          yield* this.standUp(); this.atDesk = false;
          yield* this.walkTo(seatApproach(seat), [], ST.WALKING, 'lunch');
          yield* this.sitDown(seat);
          this.state = ST.LUNCH; this.anim = 'eat';
          while (sim.t < end) yield;
          yield* this.standUp(); sim.releaseSeat(seat, this);
          yield* this.backToDesk(); return;
        }
        // hết chỗ pantry: ăn tại bàn
        this.state = ST.LUNCH; this.anim = 'eat';
        while (sim.t < end) yield;
        this.state = ST.WORKING; return;
      }
      // ra ngoài ăn
      yield* this.standUp(); this.atDesk = false;
      yield* this.walkTo(sim.model.waypoints[this.side], sim.model.routes.leave, ST.WALKING, 'lunch');
      this.visible = false; this.state = ST.LUNCH;
      while (sim.t < end - 120) yield;
      this.spawn(); this.state = ST.ARRIVING;
      yield* this.goSitDesk(sim.model.routes.arrive, ST.ARRIVING, 'desk');
      this.state = ST.WORKING; this.atDesk = true;
    }
    this.activity = null;
  }

  // ---------- hành động cơ bản ----------
  spawn() {
    const sp = this.sim.model.waypoints[this.side];
    this.x = sp.x; this.z = sp.z; this.f = sp.f; this.y = this.sim.model.heightAt(sp.f, sp.x, sp.z);
    this.yaw = yawOf(sp.x < 0 ? 1 : -1, 0); this.visible = true; this.sit = 0; this.onStair = null;
  }

  teleportTo(p) { this.x = p.x; this.z = p.z; this.f = p.f; this.onStair = null; this.y = this.sim.model.heightAt(p.f, p.x, p.z); }

  *turnTo(yaw) {
    for (let i = 0; i < 60 && Math.abs(angDiff(this.yaw, yaw)) > 0.05; i++) { const dt = yield; this.yaw += angDiff(this.yaw, yaw) * Math.min(1, (dt || 0.1) * 8); }
    this.yaw = yaw;
  }

  *sitDown(seat) {
    this.seat = seat;
    const a = seatApproach(seat), yaw = deg2yaw(seat.facing || 0);
    yield* this.turnTo(yaw);
    const sx = this.x, sz = this.z;
    let t = 0;
    while (t < SIT_T) {
      const dt = yield; t += dt || 0.1;
      const k = smooth(clamp(t / SIT_T, 0, 1));
      this.x = sx + (seat.x - sx) * k; this.z = sz + (seat.z - sz) * k; this.sit = k;
    }
    this.x = seat.x; this.z = seat.z; this.sit = 1; this.yaw = yaw;
    void a;
  }

  *standUp() {
    if (this.sit <= 0) return;
    const seat = this.seat, a = seat ? seatApproach(seat) : { x: this.x, z: this.z };
    const sx = this.x, sz = this.z;
    let t = 0;
    while (t < STAND_T) {
      const dt = yield; t += dt || 0.1;
      const k = smooth(clamp(t / STAND_T, 0, 1));
      this.x = sx + (a.x - sx) * k; this.z = sz + (a.z - sz) * k; this.sit = 1 - k;
    }
    this.sit = 0; this.seat = null; this.anim = 'idle';
  }

  /** Đi tới p (qua các waypoint via). stopIf(): dừng sớm khi điều kiện đúng. */
  *walkTo(p, via, state, goal, stopIf) {
    const sim = this.sim;
    if (state) this.state = state;
    this.goal = goal;
    const res = sim.nav.path({ x: this.x, z: this.z, f: this.f }, p, via || []);
    if (!res) {
      sim.problems.push(`${this.id}: không tìm được đường từ (${this.x.toFixed(2)},${this.z.toFixed(2)}) tầng ${this.f} tới (${p.x.toFixed(2)},${p.z.toFixed(2)}) tầng ${p.f}`);
      this.teleportTo(p); this.goal = null; return;
    }
    this.path = res.points; this.pi = 1; this.blockT = 0;
    while (this.pi < this.path.length) {
      if (stopIf && stopIf()) break;
      const dt = yield;
      this.step(dt || 0.1);
    }
    this.path = null; this.walkAmt = 0; this.goal = null; this.waiting = null;
  }

  step(dt) {
    const sim = this.sim, tgt = this.path[this.pi];
    const dx = tgt.x - this.x, dz = tgt.z - this.z, d = Math.hypot(dx, dz);
    const prev = this.path[this.pi - 1];
    // sự kiện cầu thang: phải xin lượt trước khi lên/xuống
    if (prev && prev.ev && prev.ev.enter && this.onStair !== prev.ev.stair) {
      if (!sim.stairAcquire(prev.ev.stair, prev.ev.dir, this)) { this.waiting = 'stair'; this.blockT += dt; this.walkAmt = Math.max(0, this.walkAmt - dt * 4); return; }
      this.waiting = null; this.onStair = prev.ev.stair; this.holds++; this.blockT = 0;
    }
    if (d < 1e-4) { this.arrive(tgt); return; }
    const ux = dx / d, uz = dz / d;
    const sp = this.speed * (this.onStair ? 0.7 : 1);
    const mv = Math.min(d, sp * dt);
    const nx = this.x + ux * mv, nz = this.z + uz * mv;
    // né người phía trước
    const blk = sim.blocker(this, nx, nz, ux, uz);
    if (blk) {
      this.blockT += dt;
      const pass = this.holds > 0 && blk.waiting ? true
        : blk.waiting ? this.blockT > 8
          : blk.path ? (blk.dirDot(ux, uz) > 0.3 ? this.blockT > 4 : this.blockT > 0.7)
            : this.blockT > 0.6;
      if (!pass) { this.walkAmt = Math.max(0, this.walkAmt - dt * 4); this.yaw += angDiff(this.yaw, yawOf(ux, uz)) * Math.min(1, dt * 6); return; }
      sim.stats.passThrough++;
    } else this.blockT = Math.max(0, this.blockT - dt * 2);
    // cửa hẹp: giới hạn số người cùng lúc
    if (!this.onStair && !sim.doorsAllow(this, nx, nz)) { this.waiting = 'door'; this.walkAmt = Math.max(0, this.walkAmt - dt * 4); return; }
    if (this.waiting === 'door') this.waiting = null;
    this.x = nx; this.z = nz;
    sim.doorsUpdate(this);
    this.walkAmt = Math.min(1, this.walkAmt + dt * 4);
    this.walkPhase += mv / 0.62 * Math.PI;
    this.yaw += angDiff(this.yaw, yawOf(ux, uz)) * Math.min(1, dt * 9);
    this.lastMove = sim.t;
    if (mv >= d - 1e-6) this.arrive(tgt);
  }

  arrive(p) {
    this.x = p.x; this.z = p.z;
    if (p.f !== undefined) this.f = p.f;
    if (p.ev && p.ev.leave) { this.sim.stairRelease(p.ev.stair, this); this.onStair = null; this.holds--; }
    this.pi++;
  }

  /** Rời mô hình ngay (bàn đã thuộc người dùng thật và không còn bàn trống). Trả lại mọi chỗ/lượt đang giữ. */
  evict() {
    const sim = this.sim;
    this.evicted = true; this.visible = false; this.state = ST.GONE; this.atDesk = false; this.path = null; this.sit = 0; this.seat = null;
    this.co = (function* () { for (;;) yield; })();
    for (const [k, v] of sim.seatOwner) if (v === this.id) sim.seatOwner.delete(k);
    for (const q of sim.wcQ.values()) { const i = q.indexOf(this); if (i >= 0) q.splice(i, 1); }
    for (const o of sim.stairOcc.values()) o.set.delete(this.id);
    for (const s of sim.doorOcc.values()) s.delete(this.id);
    this.doors.clear(); this.onStair = null; this.holds = 0;
  }

  dirDot(ux, uz) {
    if (!this.path || this.pi >= this.path.length) return 0;
    const t = this.path[this.pi], dx = t.x - this.x, dz = t.z - this.z, d = Math.hypot(dx, dz) || 1;
    return (dx * ux + dz * uz) / d;
  }
}

export class Simulation {
  constructor(model, nav, staff, opts = {}) {
    this.model = model; this.nav = nav; this.opts = opts;
    this.staff = staff;
    this.t = opts.start != null ? parseTime(opts.start) : parseTime('07:30');
    this.day = 0;
    this.problems = [];
    this.stats = { passThrough: 0, forcedStair: 0 };
    this.build();
  }
  build() {
    this.seatOwner = new Map(); this.stairOcc = new Map(); this.doorOcc = new Map(); this.wcQ = new Map();
    this.agents = this.staff.active.map((e, i) => new Agent(this, e, i));
    this.byId = new Map(this.agents.map(a => [a.id, a]));
  }

  // ---------- tài nguyên ----------
  reserveSeat(list, agent) {
    const free = list.filter(s => !this.seatOwner.has(s.id));
    if (!free.length) return null;
    const s = free[Math.floor(agent.r() * free.length)];
    this.seatOwner.set(s.id, agent.id); return s;
  }
  releaseSeat(s, agent) { if (s && this.seatOwner.get(s.id) === agent.id) this.seatOwner.delete(s.id); }

  stairAcquire(id, dir, agent) {
    let o = this.stairOcc.get(id);
    if (!o) { o = { dir, set: new Set(), since: this.t }; this.stairOcc.set(id, o); }
    const cap = this.model.stairById.get(id).capacity || 4;
    if (o.set.has(agent.id)) return true;
    if (o.set.size === 0) o.dir = dir;
    if (o.dir === dir && o.set.size < cap) { o.set.add(agent.id); return true; }
    if (agent.blockT > 40) { this.stats.forcedStair++; o.set.add(agent.id); return true; } // chống kẹt cứng
    return false;
  }
  stairRelease(id, agent) { const o = this.stairOcc.get(id); if (o) o.set.delete(agent.id); }

  doorsAllow(agent, x, z) {
    for (const d of this.model.doors) {
      if (d.floor !== agent.f || agent.doors.has(d.id) || !inRect(d.zone, x, z)) continue;
      let s = this.doorOcc.get(d.id); if (!s) { s = new Set(); this.doorOcc.set(d.id, s); }
      if (s.size >= d.capacity) return false;
      s.add(agent.id); agent.doors.add(d.id);
    }
    return true;
  }
  doorsUpdate(agent) {
    for (const id of agent.doors) {
      const d = this.model.doors.find(q => q.id === id);
      if (!d || d.floor !== agent.f || !inRect(d.zone, agent.x, agent.z)) { agent.doors.delete(id); this.doorOcc.get(id)?.delete(agent.id); }
    }
  }

  wcQueue(id) { if (!this.wcQ.has(id)) this.wcQ.set(id, []); return this.wcQ.get(id); }
  wcHolder(id) { const q = this.wcQueue(id); return q[0] || null; }
  wcRelease(id, agent) { const q = this.wcQueue(id); const i = q.indexOf(agent); if (i >= 0) q.splice(i, 1); }

  /** Người đứng chắn phía trước điểm (nx,nz) theo hướng (ux,uz). */
  blocker(me, nx, nz, ux, uz) {
    let best = null, bd = Infinity;
    for (const o of this.agents) {
      if (o === me || !o.visible) continue;
      if (me.onStair || o.onStair) { if (me.onStair !== o.onStair) continue; }
      else if (o.f !== me.f) continue;
      const dx = o.x - nx, dz = o.z - nz;
      const along = dx * ux + dz * uz;
      if (along < -0.05 || along > 0.55) continue;
      const lat = Math.abs(dx * uz - dz * ux);
      if (lat > 0.36) continue;
      // chỉ tính nếu khoảng cách đang giảm (tránh kẹt khi đã chồng nhau)
      const cur = Math.hypot(o.x - me.x, o.z - me.z), nxt = Math.hypot(dx, dz);
      if (nxt >= cur) continue;
      if (nxt < bd) { bd = nxt; best = o; }
    }
    return best;
  }

  /** Tiến mô phỏng dt giây (tự chia bước nhỏ). */
  step(dt) {
    const H = 0.1;
    while (dt > 1e-6) {
      const h = Math.min(H, dt); dt -= h;
      this.t += h;
      if (this.t >= 86400) this.newDay();
      for (const a of this.agents) a.update(h);
    }
  }
  newDay() {
    this.t -= 86400; this.day++;
    for (const a of this.agents) if (!a.evicted) a.reset();
    this.seatOwner.clear(); this.stairOcc.clear(); this.doorOcc.clear(); this.wcQ.clear();
  }
  /** Tua nhanh tới giờ target (giây trong ngày). Lùi giờ thì dựng lại ngày. */
  advanceTo(target, h = 0.25) {
    if (target < this.t) { this.t = Math.min(target, parseTime('06:00')); this.build(); }
    this.fastForward = true;
    while (this.t < target) { const s = Math.min(h, target - this.t); this.t += s; for (const a of this.agents) a.update(s); }
    this.fastForward = false;
  }

  /** Bàn đang có người ngồi làm việc (để bật màn hình). */
  deskActive(deskId) {
    const id = this.staff.deskOwner.get(deskId);
    const a = id && this.byId.get(id);
    return !!(a && a.atDesk && a.sit > 0.5 && a.seat === a.deskSeat);
  }

  summary() {
    const byFloor = new Map(this.model.floors.map(f => [f.id, 0]));
    const byState = {};
    let outside = 0;
    for (const a of this.agents) {
      byState[a.state] = (byState[a.state] || 0) + 1;
      if (!a.visible) { outside++; continue; }
      const inHouse = a.z < 9.0;
      if (inHouse) byFloor.set(a.onStair ? -1 : a.f, (byFloor.get(a.onStair ? -1 : a.f) || 0) + 1); else outside++;
    }
    return { byFloor, byState, outside };
  }
}
