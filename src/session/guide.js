// Người hướng dẫn của SYSONE: đứng ở sảnh. Khi có người mới vào (chưa có chỗ ngồi), chị ấy tới tận chỗ người đó đang đứng,
// chào, giới thiệu công ty, hỏi phòng ban (nếu hồ sơ chưa có), chọn bàn trống của phòng đó, dẫn đường tới bàn (khác tầng thì
// cùng đi thang máy), mời ngồi rồi giao danh sách việc tuần đầu theo phòng. Đứng gần chị ấy bấm E để xem lại.
// Nhân vật hướng dẫn chỉ có trên máy mỗi người (không đồng bộ qua server).
import { DEPARTMENTS, FLOOR_NAMES, findDepartment, departmentOfDesk, onboardingTasks } from '../shared/departments.js';
import { seatApproach } from '../model/layoutModel.js';
import { api } from '../net/api.js';
import { defaultEquipment } from '../shared/equipment.js';
import { esc } from './ui.js';
import * as THREE from 'three';

const KEY = 'guide', NAME = 'Chị Mai', ROLE = 'Hướng dẫn viên SYSONE';
const SPEED = 1.35, LEAD_SPEED = 2.7;   // m/s: đi thường; khi dẫn người mới về bàn đi nhanh gấp đôi (người mới đi bộ 3,1 m/s nên vẫn theo kịp)

export class Guide {
  constructor(session) {
    this.s = session; this.app = session.app; this.model = this.app.model;
    const lb = this.model.waypoints.lobby;
    // chỗ đứng: trong sảnh, cạnh cửa chính (người mới vào là gặp)
    this.home = this.walkable({ x: lb.x - 1.3, z: lb.z - 0.9 }) || { x: lb.x, z: lb.z };
    this.pos = { ...this.home, f: 0 }; this.yaw = 0;
    this.queue = []; this.busy = false; this.card = null; this.wait = null;
    this.s.remote.upsert({ key: KEY, display: `${NAME} · Hướng dẫn`, kind: 'guide', tagColor: '#e07a5f', x: this.pos.x, y: this.model.floorY(0), z: this.pos.z, f: 0, yaw: 0, look: { model: 'mo-guide', pixel: 'mo-guide' } }); // đồng phục riêng của hướng dẫn viên
    this.agent = this.s.remote.byKey.get(KEY);
  }
  walkable(p, f = 0) { const r = this.app.nav.path({ ...this.model.waypoints.lobby, f: 0 }, { x: p.x, z: p.z, f }); return r ? p : null; }
  get me() { return this.s.player?.agent; }

  // ---------- di chuyển ----------
  /** Đi theo lưới điều hướng tới (x, z) cùng tầng. lead: người mới đi theo sau (chờ nếu họ tụt lại). */
  goTo(x, z, lead = false) {
    const r = this.app.nav.path({ x: this.pos.x, z: this.pos.z, f: this.pos.f }, { x, z, f: this.pos.f });
    this.queue = r ? r.points.slice(1).map(p => ({ x: p.x, z: p.z })) : [{ x, z }];
    this.lead = lead; this.trail = []; this.lastTrail = { x: this.pos.x, z: this.pos.z };
    return new Promise(res => { this.arrive = res; });
  }
  teleport(x, z, f) { Object.assign(this.pos, { x, z, f }); this.queue = []; this.trail = []; this.s.player?.stopPath(); const a = this.agent; if (a) { Object.assign(a, { x, z, y: this.model.floorY(f), f }); } this.push(false); }
  push(walk) {
    const y = this.model.floorY(this.pos.f);
    this.s.remote.upsert({ key: KEY, display: `${NAME} · Hướng dẫn`, kind: 'guide', tagColor: '#e07a5f', x: this.pos.x, y, z: this.pos.z, f: this.pos.f, yaw: this.yaw, walk, run: walk && this.lead, look: this.agent?.emp?.look });
  }
  update(dt) {
    if (!this.agent) return;
    this.gateTick(dt);
    const me = this.me;
    // dẫn đường: người mới đi theo đúng vệt chân của chị ấy, giữ cách ~1 m (đi liền mạch, không dừng-đi giật cục);
    // tụt lại quá xa thì chị ấy đứng chờ
    if (this.lead && me) {
      const d = Math.hypot(me.x - this.pos.x, me.z - this.pos.z), pl = this.s.player;
      if (d > 4.5 && this.queue.length) { this.face(me); this.push(false); return; }   // chờ người mới
      if (me.f === this.pos.f && !pl.seated && !pl.seq && !pl.sofa) {
        // điểm vệt đã cách chị ấy hơn 1 m thì nối vào đường đi của người mới
        while (this.trail.length && Math.hypot(this.trail[0].x - this.pos.x, this.trail[0].z - this.pos.z) > 1.0) {
          const q = this.trail.shift();
          if (pl.path) pl.path.push(q); else if (Math.hypot(q.x - me.x, q.z - me.z) > 0.15) { pl.path = [q]; pl.stuckFor = 0; pl.follow(); }
        }
      }
    }
    let next = this.queue[0];
    if (next) {
      let step = (this.lead ? LEAD_SPEED : SPEED) * dt;
      while (next && step > 0) {
        const dx = next.x - this.pos.x, dz = next.z - this.pos.z, L = Math.hypot(dx, dz);
        if (L <= step) { this.pos.x = next.x; this.pos.z = next.z; step -= L; this.queue.shift(); next = this.queue[0]; }
        else { this.pos.x += dx / L * step; this.pos.z += dz / L * step; this.yaw = Math.atan2(-dx, -dz); step = 0; }
      }
      if (this.lead && Math.hypot(this.pos.x - this.lastTrail.x, this.pos.z - this.lastTrail.z) > 0.25) { this.lastTrail = { x: this.pos.x, z: this.pos.z }; this.trail.push({ ...this.lastTrail }); }
      this.push(true);
      if (!this.queue.length) { this.push(false); const f = this.arrive; this.arrive = null; this.lead = false; f?.(); }
    } else if (me && me.f === this.pos.f && Math.hypot(me.x - this.pos.x, me.z - this.pos.z) < 6) { this.face(me); this.push(false); }
  }
  face(p) { const dx = p.x - this.pos.x, dz = p.z - this.pos.z; if (Math.hypot(dx, dz) > 0.05) this.yaw = Math.atan2(-dx, -dz); }
  /** Đứng gần chị ấy (cùng tầng, < 1,6 m). */
  near(x, z, f) { return f === this.pos.f && Math.hypot(x - this.pos.x, z - this.pos.z) < 1.6 && !this.busy; }

  // ---------- mở đầu: người mới đứng trước cổng công ty, đi vào cửa chính thì chị ấy ra đón ----------
  /** Đặt người mới trên vỉa hè trước cổng (nhìn vào biển SYSONE), hiện gợi ý + vòng sáng ở cửa chính; vào tới sảnh thì đón. */
  startAtGate() {
    const pl = this.s.player, a = pl.agent, wp = this.model.waypoints, sw = wp.sidewalk || wp.gate, door = wp.door0;
    Object.assign(a, { x: sw.x, z: sw.z + 0.3, y: 0.15, f: 0, yaw: 0, sit: 0 });       // quay mặt vào cổng (-z)
    const rig = this.app.rig; rig.S.th = rig.G.th = 0; rig.camDist = null; rig.S.t.set(a.x, a.y + 0.65 * pl.H, a.z); rig.G.t.copy(rig.S.t);
    pl.send(true);
    // vòng sáng nhấp nháy ở cửa chính
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 40), new THREE.MeshBasicMaterial({ color: '#ffb23f', transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(door.x, 0.08, door.z); ring.renderOrder = 3; this.app.scene.add(ring); this.ring = ring;
    const hint = document.createElement('div'); hint.className = 'gate-hint'; hint.setAttribute('role', 'status');
    const touch = matchMedia('(max-width: 760px), (pointer: coarse) and (max-width: 1100px)').matches;
    hint.innerHTML = `<b>Chào mừng bạn đến SYSONE!</b><span>${touch ? 'Kéo <b>cần điều khiển</b> ở góc trái (hoặc chạm vào sàn) để' : 'Dùng <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>'} đi qua cổng, vào <b>cửa chính</b> (vòng sáng màu cam) — chị Mai đang chờ ở sảnh.</span>`;
    document.getElementById('appRoot').appendChild(hint); this.hint = hint;
    this.waitingAtGate = true; this.ringT = 0;
  }
  /** (mỗi khung hình) chờ người mới vào tới trong nhà. */
  gateTick(dt) {
    if (!this.waitingAtGate) return;
    const a = this.me, door = this.model.waypoints.door0;
    this.ringT += dt; if (this.ring) { const k = 1 + 0.15 * Math.sin(this.ringT * 5); this.ring.scale.set(k, k, k); this.ring.material.opacity = 0.55 + 0.35 * Math.sin(this.ringT * 5); }
    if (a && a.f === 0 && a.z < door.z - 0.4) {                                          // đã qua cửa chính, vào trong nhà
      this.waitingAtGate = false; this.hint?.remove(); this.hint = null;
      if (this.ring) { this.app.scene.remove(this.ring); this.ring.geometry.dispose(); this.ring.material.dispose(); this.ring = null; }
      this.welcome();
    }
  }

  // ---------- hội thoại ----------
  /** Thẻ hội thoại (góc dưới giữa màn hình). Trả về lựa chọn (chỉ số nút). */
  say(html, buttons = ['Tiếp'], extra = '') {
    this.close();
    const el = document.createElement('div'); el.className = 'guide-card'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', NAME);
    el.innerHTML = `<div class="gc-who"><span class="gc-ava">M</span><div><b>${NAME}</b><small>${ROLE}</small></div></div><div class="gc-text">${html}</div>${extra}<div class="gc-btns">${buttons.map((b, i) => `<button type="button" data-i="${i}" class="${i === 0 ? 'primary' : ''}">${esc(b)}</button>`).join('')}</div>`;
    document.getElementById('appRoot').appendChild(el); this.card = el;
    return new Promise(res => {
      el.querySelectorAll('.gc-btns button').forEach(b => b.onclick = () => { this.close(); res(+b.dataset.i); });
      el.querySelector('.gc-btns button')?.focus();
    });
  }
  close() { this.card?.remove(); this.card = null; }
  /** Chọn phòng ban (13 phòng). */
  async chooseDept() {
    const extra = `<div class="gc-depts">${DEPARTMENTS.map((d, i) => `<button type="button" data-d="${i}"><i style="background:${d.color}"></i>${esc(d.name)}<small>${FLOOR_NAMES[d.floor]}</small></button>`).join('')}</div>`;
    this.say('Bạn thuộc phòng ban nào? Chọn giúp mình để mình đưa bạn tới đúng khu làm việc nhé.', [], extra);
    return new Promise(res => this.card.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { this.close(); res(DEPARTMENTS[+b.dataset.d]); }));
  }

  // ---------- kịch bản đón người mới ----------
  freeDeskOf(dept) {
    const seats = this.s.seats, ok = id => { const d = this.model.deskById.get(id), st = seats.get(id); return d && d.kind !== 'reception' && !st?.owner && !st?.locked; };
    return dept.desks.find(ok) || null;
  }
  async welcome() {
    if (this.busy || !this.me) return;
    this.busy = true;
    try {
      const me = this.me, emp = this.s.me.employee, first = String(emp.name || emp.display || '').trim().split(/\s+/).pop() || 'bạn';
      // 1. tới chỗ người mới đang đứng
      if (me.f === this.pos.f) { const d = Math.hypot(me.x - this.pos.x, me.z - this.pos.z), k = Math.max(0, (d - 1.1) / Math.max(d, 0.01)); if (d > 1.3) await this.goTo(this.pos.x + (me.x - this.pos.x) * k, this.pos.z + (me.z - this.pos.z) * k); }
      this.face(me); this.push(false);
      // 2. chào và giới thiệu
      await this.say(`Chào <b>${esc(first)}</b>! Mình là Mai, hướng dẫn viên của <b>SYSONE</b>. Chào mừng bạn đến công ty 👋`, ['Chào chị!']);
      await this.say('Toà nhà mình có 3 tầng:<br>• <b>Tầng trệt</b>: sảnh - lễ tân, Hành chính - Nhân sự, Tài chính - Kế toán, Team Fresher, phòng họp, pantry, khu giải trí.<br>• <b>Tầng 2</b>: Phát triển ứng dụng, Mobile App, Data Backbone, Phân tích nghiệp vụ, Triển khai, Hệ thống, Security.<br>• <b>Tầng 3</b>: Ban giám đốc, Team Đối tác, Team Cộng tác viên.<br>Lên tầng thì đi <b>thang máy</b> ở sảnh hoặc cầu thang bộ bên trái nhé.', ['Dạ, em hiểu rồi']);
      // 3. chấm công (mỗi sáng tới công ty)
      const at = this.s.att;
      if (at?.code && !at.checkedIn) {
        await this.say('Mỗi sáng tới công ty, việc đầu tiên là <b>chấm công</b> ở máy cạnh cửa chính (đứng trước máy bấm <b>E</b>). Hôm nay mình chấm giúp bạn nhé!', ['Chấm công']);
        const rec = await at.checkIn();
        if (rec) await this.say(`Đã chấm công vào ca lúc <b>${new Date(rec.checkIn).toTimeString().slice(0, 5)}</b>${rec.lateMin ? ` (muộn ${rec.lateMin} phút — ca bắt đầu ${esc(rec.shift)})` : ' — đúng giờ 👍'}. Cuối ngày nhớ chấm công ra về nhé.`, ['Dạ']);
      }
      // 4. phòng ban
      const mine = this.s.mySeat;
      let dept = findDepartment(emp.department) || (mine && departmentOfDesk(mine.deskId));
      if (!dept) dept = await this.chooseDept();
      // 4. bàn
      let deskId = mine?.deskId || this.freeDeskOf(dept);
      if (!deskId) {
        await this.say(`${esc(dept.name)} hiện chưa còn bàn trống. Mình đã báo Phòng Hành chính - Nhân sự xếp thêm chỗ cho bạn; trong lúc chờ, bạn cứ tham quan văn phòng nhé.`, ['Dạ, em cảm ơn']);
        return;
      }
      const desk = this.model.deskById.get(deskId);
      if (!mine) {
        await this.say(`Bạn thuộc <b>${esc(dept.name)}</b> (${FLOOR_NAMES[dept.floor]}). Mình đã chuẩn bị cho bạn bàn <b>${deskId}</b>. Đi theo mình nhé!`, ['Đi theo chị']);
        const r = await api('POST', `/api/seats/${encodeURIComponent(deskId)}/claim`, { equipment: defaultEquipment(this.s.schema) });
        if (!r.ok) { await this.say(`Bàn ${deskId} vừa có người nhận mất rồi (${esc(r.error || '')}). Bạn gặp lại mình sau ít phút để mình xếp chỗ khác nhé.`, ['Dạ']); return; }
        this.s.seats.set(r.seat.deskId, r.seat); this.s.me.employee.canMove = false;
        if (this.s.selecting) this.s.endPick(); else { this.app.rebuildDesks(); this.s.renderSeatBox(); }
      } else await this.say(`Chỗ của bạn là bàn <b>${deskId}</b> — ${esc(dept.name)}, ${FLOOR_NAMES[desk.floor]}. Đi theo mình nhé!`, ['Đi theo chị']);
      // 5. dẫn đường (khác tầng: cùng đi thang máy)
      await this.leadTo(desk);
      // 6. mời ngồi, giao việc
      await this.s.sit(deskId, { quiet: true });
      this.face(this.me); this.push(false);
      const tasks = onboardingTasks(dept); this.saveTasks(tasks, dept);
      const done = this.say(`Đây là chỗ của bạn. Tuần đầu bạn làm giúp mình mấy việc này nhé (xem lại bất cứ lúc nào: lại gần mình bấm <b>E</b>):`, ['Cảm ơn chị!'], this.tasksHtml());
      this.bindTasks(); await done;
    } finally {
      this.close(); this.busy = false; this.lead = false;
      this.goHome(); // về lại sảnh
    }
  }
  async leadTo(desk) {
    const pl = this.s.player, ap = seatApproach(this.model.deskById.get(desk.id).seat);
    if (desk.floor !== this.pos.f || desk.floor !== this.me.f) {
      const L = this.s.lift?.stops;
      if (L) {
        const side = st => ({ x: st.x + Math.cos(st.yaw) * 0.9, z: st.z - Math.sin(st.yaw) * 0.9 }); // cạnh chỗ đứng chờ, không chắn cửa
        { const p = side(L[this.pos.f]); await this.goTo(p.x, p.z, true); }
        // chờ người mới tới thang máy
        await this.until(() => this.me.f === this.pos.f && Math.hypot(this.me.x - this.pos.x, this.me.z - this.pos.z) < 2.2, 25);
        this.s.toast('Cùng đi thang máy lên ' + FLOOR_NAMES[desk.floor] + '…');
        this.s.rideLift(desk.floor);
        await this.sleep(750);
        { const p = side(L[desk.floor]); this.teleport(p.x, p.z, desk.floor); }
        await this.sleep(500);
      }
    }
    // tới cạnh bàn (đứng chéo trước bàn, chừa chỗ cho người mới đi vào ghế)
    await this.goTo(ap.x + 0.7, ap.z + 0.5, true);
    await this.until(() => Math.hypot(this.me.x - ap.x, this.me.z - ap.z) < 1.8 || Math.hypot(this.me.x - this.pos.x, this.me.z - this.pos.z) < 2.2 || this.me.f !== desk.floor, 20);
    if (Math.hypot(this.me.x - ap.x, this.me.z - ap.z) >= 1.8) { pl.walkTo(ap.x, ap.z, desk.floor); await this.until(() => !pl.path, 10); }
  }
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  async until(fn, secs) { const t0 = performance.now(); while (!fn() && performance.now() - t0 < secs * 1000) await this.sleep(150); }

  // ---------- việc tuần đầu (lưu trên máy) ----------
  get tasksKey() { return 'sysone.tasks.' + this.s.me.employee.code; }
  saveTasks(list, dept) { const old = this.loadTasks(); localStorage.setItem(this.tasksKey, JSON.stringify({ dept: dept.name, items: list.map(t => ({ t, done: !!old?.items?.find(o => o.t === t)?.done })) })); }
  loadTasks() { try { return JSON.parse(localStorage.getItem(this.tasksKey) || 'null'); } catch { return null; } }
  tasksHtml() {
    const d = this.loadTasks(); if (!d) return '';
    return `<ul class="gc-tasks" aria-label="Việc tuần đầu">${d.items.map((it, i) => `<li><label><input type="checkbox" data-t="${i}" ${it.done ? 'checked' : ''}> ${esc(it.t)}</label></li>`).join('')}</ul>`;
  }
  bindTasks(root = this.card) {
    root?.querySelectorAll('[data-t]').forEach(c => c.onchange = () => { const d = this.loadTasks(); if (!d) return; d.items[+c.dataset.t].done = c.checked; localStorage.setItem(this.tasksKey, JSON.stringify(d)); });
  }
  /** Bấm E cạnh chị ấy: xem lại việc tuần đầu, hoặc nhờ dẫn tới bàn. */
  async talk() {
    if (this.busy) return;
    const d = this.loadTasks();
    if (!d && !this.s.mySeat) { this.welcome(); return; }
    this.busy = true;
    try {
      this.face(this.me); this.push(false);
      const p = this.say(d ? `Việc tuần đầu của bạn (${esc(d.dept)}):` : 'Chào bạn! Cần mình giúp gì không?', ['Cảm ơn chị!', 'Dẫn em về bàn'], this.tasksHtml());
      this.bindTasks();
      const c = await p;
      if (c === 1 && this.s.mySeat) { const desk = this.model.deskById.get(this.s.mySeat.deskId); await this.leadTo(desk); await this.s.sit(desk.id, { quiet: true }); }
    } finally { this.close(); this.busy = false; this.lead = false; if (this.pos.f !== 0 || Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z) > 0.3) this.goHome(); }
  }
  async goHome() {
    if (this.pos.f !== 0) { const L = this.s.lift?.stops; if (L) { await this.goTo(L[this.pos.f].x, L[this.pos.f].z); this.teleport(L[0].x, L[0].z, 0); } else this.teleport(this.home.x, this.home.z, 0); }
    await this.goTo(this.home.x, this.home.z);
  }
}
