// Phòng họp (tầng trệt) — phía client: cửa phòng, vào / rời phòng, chặn người ngoài, nhắc giờ họp.
//  • Đứng ở cửa phòng họp: "E vào phòng họp" (đang có cuộc họp mình được mời) — hoặc "E đặt phòng họp" (phòng trống).
//    Người không có trong danh sách: không vào được (bị đưa ra cửa; server cũng bỏ qua vị trí trong phòng).
//  • Server nhắn: được mời (meet:invited), 10 phút trước + đúng giờ (meet:remind) — thông báo có nút đi tới phòng;
//    tới cửa là tự vào phòng. Đổi giờ / huỷ / bị gỡ khỏi danh sách: báo ngay.
//  • Trong phòng: lớp phủ phòng họp (src/ui/meetRoom.js) — bảng vẽ chung, kênh chat riêng, tài liệu, người trong phòng.
//  • Lịch phòng, đặt phòng, "Cuộc họp của tôi", "Folder của tôi": src/ui/meetPanel.js.
import { api } from '../net/api.js';
import { notice } from '../ui/notices.js';
import { sound } from '../audio/notify.js';
import { MeetPanel } from '../ui/meetPanel.js';
import { MeetRoom } from '../ui/meetRoom.js';

const VN = { timeZone: 'Asia/Ho_Chi_Minh' };
export const hm = t => new Intl.DateTimeFormat('vi-VN', { ...VN, hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
export const dayLabel = t => new Intl.DateTimeFormat('vi-VN', { ...VN, weekday: 'short', day: '2-digit', month: '2-digit' }).format(t);
export const EARLY = 10 * 60e3;   // (phòng mở từ 10 phút trước giờ họp — giống server/meetings.js)

export class Meetings {
  constructor(session) {
    this.s = session; this.app = session.app; this.rt = session.rt;
    this.sched = []; this.busy = {}; this.room = null; this.inRoom = null; this.pendingJoin = null;
    this.panel = new MeetPanel(this);
    const rt = this.rt;
    rt.on('hello', m => { this.busy = m.meetBusy || {}; this.loadSched(); this.loadMine(true); });
    rt.on('meet:sched', () => this.loadSched());
    rt.on('meet:busy', m => { this.busy = m.rooms || {}; });
    rt.on('meet:state', m => this.onState(m));
    rt.on('meet:members', m => this.room?.members(m.members));
    rt.on('meet:wb', m => { if (m.id === this.inRoom) this.room?.wb?.receive(m.elements); });
    rt.on('meet:ptr', m => { if (m.id === this.inRoom) this.room?.wb?.peer(m); });
    rt.on('meet:files', () => this.room?.loadFiles());
    rt.on('meet:left', m => { if (this.inRoom === m.id) this.closeRoom(); });
    rt.on('meet:ended', m => { if (this.inRoom === m.id) { this.s.toast(m.purged ? 'Host đã kết thúc và xoá cuộc họp.' : m.early ? 'Host đã kết thúc cuộc họp. Tài liệu, bảng vẽ, chat vẫn còn trong "Folder của tôi".' : 'Cuộc họp đã hết giờ. Tài liệu, bảng vẽ, chat vẫn còn trong "Folder của tôi".', false, 6000); this.closeRoom(); } this.loadSched(); this.loadMine(); });
    rt.on('meetErr', m => this.s.toast(m.msg, true, 5000));
    rt.on('meet:blocked', () => this.pushOut());
    rt.on('meet:invited', m => { this.loadSched(); this.loadMine(); sound.play('message'); notice({ title: `${m.meeting.hostName} mời bạn họp`, text: `${m.meeting.title} · ${dayLabel(m.meeting.start)} ${hm(m.meeting.start)}–${hm(m.meeting.end)}`, icon: 'calendar', tone: 'msg', ms: 9000, onClick: () => this.panel.open('mine') }); });
    rt.on('meet:changed', m => { this.loadSched(); this.loadMine(); if (!m.meeting.isHost) notice({ title: 'Lịch họp vừa thay đổi', text: `${m.meeting.title} · ${dayLabel(m.meeting.start)} ${hm(m.meeting.start)}–${hm(m.meeting.end)}`, icon: 'calendar', tone: 'info', onClick: () => this.panel.open('mine') }); this.room?.meetingChanged?.(m.meeting); });
    rt.on('meet:cancelled', m => { this.loadSched(); this.loadMine(); notice({ title: m.removed ? 'Bạn không còn trong cuộc họp' : 'Cuộc họp đã bị huỷ', text: m.title, icon: 'calendar', tone: 'info', ms: 7000 }); if (this.inRoom === m.id) this.closeRoom(); });
    rt.on('meet:remind', m => this.remind(m.kind, m.meeting));
    rt.on('chat', m => { if (m.msg?.channel?.startsWith('meet:')) this.room?.onChat(m.msg); });
    rt.on('close', () => { if (this.inRoom) this.closeRoom(); });
    this.schedT = setInterval(() => this.loadSched(), 5 * 60e3);
  }

  // ---------- dữ liệu ----------
  async loadSched() {
    const now = Date.now(), r = await api('GET', `/api/meetings?from=${now - 6 * 3600e3}&to=${now + 24 * 3600e3}`);
    if (r.ok) { this.sched = r.meetings; this.busy = r.busy || this.busy; }
    this.panel.refresh?.();
  }
  async loadMine(first = false) {
    const r = await api('GET', '/api/meetings/mine'); if (!r.ok) return;
    this.mine = r.meetings;
    this.s.social?.setMeetDot?.(this.mine.some(m => m.open && !m.past));
    // vừa vào văn phòng: nhắc cuộc họp hôm nay của mình
    if (first && !this._greeted) {
      this._greeted = true;   // (kết nối lại: không nhắc lại)
      const now = Date.now(), today = this.mine.filter(m => m.end > now && m.start - now < 12 * 3600e3).sort((a, b) => a.start - b.start)[0];
      if (today) notice({ title: today.open ? 'Bạn có cuộc họp đang diễn ra' : 'Hôm nay bạn có cuộc họp', text: `${today.title} · ${hm(today.start)}–${hm(today.end)} · ${today.roomName}`, icon: 'calendar', tone: 'info', ms: 9000, onClick: () => today.open ? this.goJoin(today) : this.panel.open('mine') });
    }
  }
  /** Cuộc họp đang dùng phòng (đã bắt đầu, chưa hết giờ) — hoặc null. */
  active(now = Date.now()) { return this.sched.find(m => m.start <= now && now < m.end) || null; }
  /** Cuộc họp mình được vào lúc này (mở từ 10 phút trước). */
  joinable(now = Date.now()) { return (this.mine || []).concat(this.sched).find(m => m.invited && now >= m.start - EARLY && now < m.end) || null; }

  // ---------- cửa phòng ----------
  /** Cửa phòng họp: chỗ hở trên vách phòng (theo lưới đi lại) — đứng ngoài, đứng trong. */
  findDoor() {
    const m = this.app.model, r = (m.layout.rooms || []).find(x => x.type === 'meeting' && x.id === 'meeting'), g = this.app.nav?.grid(r?.floor ?? 0);
    if (!r || !g) return null;
    const edges = [['z1', 0, 1], ['z0', 0, -1], ['x0', -1, 0], ['x1', 1, 0]];
    for (const [e, nx, nz] of edges) {
      const pts = [];
      if (nz) for (let x = r.x0 + 0.1; x < r.x1; x += 0.1) { if (g.isFree(x, r[e], 0.2)) pts.push(x); }
      else for (let z = r.z0 + 0.1; z < r.z1; z += 0.1) { if (g.isFree(r[e], z, 0.2)) pts.push(z); }
      if (!pts.length) continue;
      const mid = pts[Math.floor(pts.length / 2)], ex = nz ? mid : r[e], ez = nz ? r[e] : mid;
      return { rect: r, f: r.floor, x: ex + nx * 0.7, z: ez + nz * 0.7, inX: ex - nx * 1.0, inZ: ez - nz * 1.0, yawOut: Math.atan2(nx, nz) };
    }
    return null;
  }
  get door() { if (this._door === undefined && this.app.nav?.grid(0)) this._door = this.findDoor(); return this._door || null; }
  inside(x, z, f) { const r = this.door?.rect; return !!r && f === r.floor && x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1; }
  near(x, z, f) { const d = this.door; return !!d && f === d.f && Math.hypot(x - d.x, z - d.z) < 1.3; }
  prompt() {
    const j = this.joinable(), a = this.active(), b = this.busy.MR1;
    if (j) return `<b>E</b> vào phòng họp · ${j.title}${b?.n ? ` (${b.n} người trong phòng)` : ''}`;
    if (a) return `Phòng đang họp: ${a.title} · tới ${hm(a.end)} — <b>E</b> xem lịch`;
    return '<b>E</b> đặt phòng họp';
  }
  interact() { const j = this.joinable(); if (j) this.join(j.id); else this.panel.open('book'); }

  /** Mỗi khung hình: chặn người ngoài đi vào phòng đang họp; tới cửa thì tự vào cuộc họp đang chờ. */
  update() {
    const a = this.s.player?.agent; if (!a || !this.door) return;
    if (this.pendingJoin && this.near(a.x, a.z, a.f)) { const id = this.pendingJoin; this.pendingJoin = null; this.join(id); }
    if (this.inRoom || !this.inside(a.x, a.z, a.f)) return;
    const act = this.active(); if (act && !act.invited) this.pushOut(act);
  }
  async pushOut(act = this.active()) {
    if (this._pushing || !this.door) return; this._pushing = true;
    try {
      this.s.player?.stopPath?.();
      await this.app.quickTravel?.jump(this.door.f, this.door.x, this.door.z, this.door.yawOut);
      this.s.toast(`Phòng họp đang họp${act ? ` "${act.title}" tới ${hm(act.end)}` : ''} — chỉ người được mời mới vào được.`, true, 5000);
    } finally { setTimeout(() => { this._pushing = false; }, 1500); }
  }

  // ---------- vào / rời phòng ----------
  join(id) { this.rt.send({ t: 'meet:join', id }); }
  /** Từ thông báo / danh sách: đi tới cửa phòng rồi tự vào. */
  async goJoin(m) {
    const a = this.s.player?.agent;
    if (!a || !this.door) { this.join(m.id); return; }
    if (this.near(a.x, a.z, a.f) || this.inside(a.x, a.z, a.f)) { this.join(m.id); return; }
    this.pendingJoin = m.id;
    await this.app.quickTravel?.jump(this.door.f, this.door.x, this.door.z, this.door.yawOut + Math.PI);
  }
  onState(m) {
    this.inRoom = m.id;
    this.panel.close();
    // nhân vật vào trong phòng (ngồi quanh bàn họp)
    const d = this.door, a = this.s.player?.agent;
    if (d && a && !this.inside(a.x, a.z, a.f)) this.app.quickTravel?.jump(d.f, d.inX, d.inZ, d.yawOut + Math.PI);
    if (this.room) this.room.update(m); else this.room = new MeetRoom(this, m);
  }
  leave() { if (this.inRoom) this.rt.send({ t: 'meet:leave', id: this.inRoom }); this.closeRoom(true); this.loadMine(); this.loadSched(); }
  closeRoom(walkOut = true) {
    const was = this.inRoom; this.inRoom = null;
    this.room?.destroy(); this.room = null;
    const a = this.s.player?.agent, d = this.door;
    if (was && walkOut && a && d && this.inside(a.x, a.z, a.f)) this.app.quickTravel?.jump(d.f, d.x, d.z, d.yawOut);
  }

  remind(kind, m) {
    this.loadMine();
    sound.play('message');
    const go = () => this.goJoin(m);
    if (kind === 'soon') notice({ title: `10 phút nữa họp: ${m.title}`, text: `${hm(m.start)}–${hm(m.end)} · ${m.roomName} · bấm để tới phòng`, icon: 'clock', tone: 'msg', ms: 15000, onClick: go });
    else notice({ title: `Tới giờ họp: ${m.title}`, text: `${m.roomName} · ${m.hostName} · bấm để tới phòng ngay`, icon: 'calendar', tone: 'msg', ms: 30000, onClick: go });
  }
}
