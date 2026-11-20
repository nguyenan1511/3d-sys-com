import { canUseChannel, postMessage, musicState, canMusic, dmChannel } from './social.js';
// WebSocket: danh sách online, trạng thái chỗ ngồi, vị trí avatar người dùng khác, buộc đăng xuất.
// Xác thực bằng cookie phiên lúc nâng cấp kết nối; server là nguồn sự thật về "đang ngồi ở đâu".
import { WebSocketServer } from 'ws';
import { sessionFromCookie, originAllowed, redeemWsTicket } from './security.js';
import { displayOf } from '../src/shared/identity.js';

const LIMIT = { x: [-16, 16], y: [-1, 16], z: [-14, 31] }; // (Real SYS: nhà sâu tới z ≈ -11,3, sân thượng cao ≈ 10,9 m)
import { smokeAllowed } from '../src/shared/rules.js';
import { PROP_ACTS } from '../src/shared/propActs.js';
import { Karaoke } from './karaoke.js';
import { Billiards } from './billiards.js';
import { Restroom } from './wc.js';
import { lightsState, canLights } from './lights.js';
import { modeOfDesk } from '../src/core/mode.js';
import { Meetings } from './meetings.js';
import { MeetHub } from './meetHub.js';
import { Projects } from './projects.js';
import { ProjectHub } from './projectHub.js';
import * as att from './attendance.js';
import { audit } from './db.js';
const ACTS = new Set(['', 'wave', 'smoke', 'drink', 'phone', 'dance', 'quay', 'jump', 'tv', 'meet', ...PROP_ACTS]); // tv: ngồi sofa xem TV; meet: đang ngồi trong phòng họp; còn lại: dùng đồ vật
// giới hạn cho mỗi kết nối (gói Render free 0,1 CPU: một tab lỗi / cố ý gửi dồn không được làm chậm cả văn phòng)
const RATE = { perSec: 40, burst: 80, kickAfter: 400 };      // tin/giây; gửi dồn tối đa; bị bỏ quá số này thì ngắt
const BIG_MSG = 64 * 1024;                                   // tin lớn hơn: chỉ nhận tin bảng vẽ phòng họp (meet:…)
const MAX_TABS = 4;                                          // số kết nối tối đa của một tài khoản
const BUF_SKIP = 1 << 20, BUF_KILL = 4 << 20;                // client mạng chậm: bỏ gói vị trí khi tồn > 1 MB, ngắt khi > 4 MB
const okNum = (v, [a, b]) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;

/**
 * Cổng giới hạn số người online (MAX_ONLINE, mặc định 80) + hàng chờ công bằng: ai chờ trước vào trước. Người chờ giữ chỗ trong
 * hàng bằng cách thử lại (~10 giây/lần); quá 45 giây không thử lại thì rời hàng. Admin không bị giới hạn.
 */
export class Gate {
  constructor(hub) { this.hub = hub; this.waiting = new Map(); }   // key -> { since: số thứ tự đến, seen }
  sweep(now = Date.now()) { for (const [k, w] of this.waiting) if (now - w.seen > 45e3) this.waiting.delete(k); }
  waitingCount() { this.sweep(); return this.waiting.size; }
  check(key) {
    const max = this.hub.config.maxOnline || 80;
    if (!key.startsWith('employee:') || this.hub.sockets.has(key)) { this.waiting.delete(key); return { ok: true }; }
    const now = Date.now(); this.sweep(now);
    let w = this.waiting.get(key); if (!w) this.waiting.set(key, w = { since: this.seq = (this.seq || 0) + 1, seen: now }); w.seen = now;   // (số thứ tự: hai người tới cùng mili-giây vẫn phân biệt trước sau)
    let ahead = 0; for (const x of this.waiting.values()) if (x.since < w.since) ahead++;
    const online = this.hub.onlineEmployees();
    if (online + ahead < max) { this.waiting.delete(key); return { ok: true }; }
    return { ok: false, pos: ahead + 1, online, max };
  }
}

export class Hub {
  constructor(store, config) {
    this.store = store; this.config = config; this.ktv = new Karaoke(this); this.bil = new Billiards(this); this.wc = new Restroom(this);
    this.meetings = new Meetings(store, k => this.nameOf(k)); this.meet = new MeetHub(this, this.meetings);   // phòng họp: lịch + phòng (server/meetings.js, meetHub.js)
    this.projects = new Projects(store, k => this.nameOf(k)); this.proj = new ProjectHub(this, this.projects);   // dự án (server/projects.js, projectHub.js)
    this.meetings.projects = this.projects; this.meet.projects = this.projects;   // (họp của dự án; phòng dự án p<id>)
    this.sockets = new Map();   // key -> Set<ws>
    this.presence = new Map();  // key -> { key, kind, code, display, x,y,z,f,yaw,walk, seated }
    this.pending = new Map();   // code -> hạn "đang vào" sau khi đăng nhập, trước khi mở WS
    this.pendingSeat = new Map(); // key -> chỗ đã được duyệt ngồi trước khi WS kịp kết nối
    this.dirty = new Set();
    this.gate = new Gate(this);
    this.timer = setInterval(() => this.flush(), 160);   // (≈ nhịp client gửi vị trí: 6 lần/giây)
    this.heartbeat = setInterval(() => this.sweep(), 15000);
    // số nhân viên online mỗi phút, giữ 6 giờ (biểu đồ "Đang online" ở bảng quản trị; mất khi server khởi động lại)
    this.hist = []; this.sampleOnline(); this.histTimer = setInterval(() => this.sampleOnline(), 60000); this.histTimer.unref?.();
    store.on(ev => this.onStore(ev));
  }
  close() { clearInterval(this.timer); clearInterval(this.heartbeat); clearInterval(this.histTimer); this.wss?.close(); this.proj.close(); return this.meet.close(); }
  /** Tên hiển thị theo khoá phiên (đang online: theo presence; không thì theo hồ sơ). */
  nameOf(key) {
    const p = this.presence.get(key); if (p) return p.display;
    if (key.startsWith('admin:')) return `Admin (${key.slice(6)})`;
    const e = this.store.employee(key.replace(/^employee:/, '')); return e ? displayOf(e.code, e.name) : key.replace(/^employee:/, '');
  }
  onlineEmployees() { let n = 0; for (const k of this.sockets.keys()) if (k.startsWith('employee:')) n++; return n; }
  sampleOnline() { for (const k of this.sockets.keys()) if (k.startsWith('employee:')) this.autoAttend(k.slice(9), true);   // (đang online qua nửa đêm: mở bản ghi ngày mới)
    const t = Date.now(); this.hist.push({ t, n: this.onlineEmployees() }); while (this.hist.length && this.hist[0].t < t - 6 * 3600e3) this.hist.shift(); }

  /** Mã đang online: có kết nối WS, hoặc vừa đăng nhập xong và đang tải cảnh. */
  isOnline = code => (this.sockets.get(`employee:${code}`)?.size || 0) > 0 || (this.pending.get(code) || 0) > Date.now();
  markPending(code) { this.pending.set(code, Date.now() + this.config.onlineGraceMs); }

  attach(server) {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });   // (1 MB: một nét vẽ tay dài trên bảng vẽ Excalidraw của phòng họp có thể vài trăm KB)
    server.on('upgrade', (req, socket, head) => {
      if (!req.url.startsWith('/ws')) return;
      // chống mở WS từ trang khác (cookie tự gửi kèm); giao diện ở tên miền khác thì phải nằm trong ALLOWED_ORIGINS
      if (!originAllowed(req, this.config.allowedOrigins)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
      // xác thực: cookie phiên (cùng tên miền) hoặc vé dùng một lần ?ticket= (giao diện ở Vercel)
      const ticket = new URL(req.url, 'http://x').searchParams.get('ticket');
      const sess = sessionFromCookie(this.store.db, ticket ? redeemWsTicket(ticket) : req.headers.cookie);
      if (!sess) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
      const key = sess.kind === 'admin' ? `admin:${sess.subject}` : `employee:${sess.subject}`;
      if ((this.sockets.get(key)?.size || 0) >= MAX_TABS) { socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); socket.destroy(); return; }
      // mã tab (mỗi tab trình duyệt một mã) + takeover=1 (người dùng bấm "Dùng ở tab này"): một tài khoản chỉ dùng ở MỘT tab
      const q = new URL(req.url, 'http://x').searchParams, tab = String(q.get('tab') || '').slice(0, 40), takeover = q.get('takeover') === '1';
      this.wss.handleUpgrade(req, socket, head, ws => this.onConnect(ws, sess, { tab, takeover }));
    });
  }

  identity(sess) {
    if (sess.kind === 'admin') return { key: `admin:${sess.subject}`, kind: 'admin', code: null, display: `Admin (${sess.subject})`, department: 'Ban giám đốc' };
    const e = this.store.employee(sess.subject);
    return { key: `employee:${sess.subject}`, kind: 'employee', code: sess.subject, display: e ? displayOf(e.code, e.name) : sess.subject, look: e?.look ? JSON.parse(e.look) : null, department: e?.department || '' };
  }

  onConnect(ws, sess, { tab = '', takeover = false } = {}) {
    const id = this.identity(sess);
    // một tài khoản = một tab: đang mở ở tab / máy khác → báo cho tab mới (không vào), trừ khi người dùng chọn chuyển sang tab
    // này (takeover) hoặc chính tab đó nối lại (cùng mã tab: tải lại trang / rớt mạng mà server chưa kịp thấy kết nối cũ đóng)
    const others = [...(this.sockets.get(id.key) || [])];
    const elsewhere = others.filter(o => !tab || o.tab !== tab);
    if (elsewhere.length && !takeover) { this.send(ws, { t: 'dup' }); setTimeout(() => ws.close(4009, 'dup'), 50); return; }
    // quá số người cho phép: báo vị trí trong hàng chờ rồi đóng (client tự thử lại — src/session/realtime.js)
    const g = this.gate.check(id.key);
    if (!g.ok) { ws.send(JSON.stringify({ t: 'full', pos: g.pos, online: g.online, max: g.max, retryMs: 10000 })); setTimeout(() => ws.close(4013, 'full'), 50); return; }
    ws.sess = sess; ws.key = id.key; ws.alive = true; ws.viewF = -1; ws.tab = tab;
    if (!this.sockets.has(id.key)) this.sockets.set(id.key, new Set());
    const first = this.sockets.get(id.key).size === 0;
    this.sockets.get(id.key).add(ws);
    if (id.code) this.pending.delete(id.code);
    if (!this.presence.has(id.key)) this.presence.set(id.key, { ...id, x: null, y: null, z: null, f: 0, yaw: 0, walk: false, seated: null });
    const ps = this.pendingSeat.get(id.key);
    if (ps) { this.pendingSeat.delete(id.key); try { this.store.checkSit({ kind: id.kind, code: id.code }, ps.deskId); this.setSeated(id.key, ps); } catch { /* chỗ đã đổi chủ */ } }
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', buf => this.onMessage(ws, buf));
    ws.on('close', () => this.onClose(ws));
    // tab cũ (đã chuyển sang tab này / kết nối cũ của chính tab này): báo rồi đóng — tab cũ hiện "Đang mở ở tab khác", không tự nối lại
    for (const o of others) { this.send(o, { t: 'replaced', same: !!tab && o.tab === tab }); setTimeout(() => o.close(4010, 'replaced'), 50); }
    this.send(ws, { t: 'hello', you: id, online: this.onlineList(), seats: this.store.listSeats(), presence: [...this.presence.values()].filter(p => p.x !== null), blinds: this.blinds(), music: musicState(this.store), ktv: this.ktv.state(), bil: this.bil.state(), wc: this.wc.state(), meetBusy: this.meet.busy(), lights: lightsState(this.store), canLights: canLights(this.store, this.actorOf(ws)), canMusic: canMusic(this.store, this.actorOf(ws)) });
    if (first) { this.onlineDirty = true; if (id.code) { this.store.emit({ type: 'employees', code: id.code }); this.autoAttend(id.code, true); } }
  }
  /** Tự chấm công: online lần đầu trong ngày = vào ca; offline hẳn = ra về; online lại = đang làm tiếp (server/attendance.js). */
  autoAttend(code, online) {
    try {
      const db = this.store.db, e = db.employees.get(code); if (!e) return;
      let rec;
      if (online) { const r = att.autoIn(db, code); if (!r.created && !r.reopened) return; rec = r.rec; if (r.created) audit(db, `employee:${code}`, 'attendance.auto', code, { day: rec.day }); }
      else { rec = att.autoOut(db, code); if (!rec) return; }
      this.attendance(att.view(rec, { code, name: e.name, department: e.department }));
    } catch (err) { console.warn('[chấm công tự động]', err.message); }
  }

  onClose(ws) {
    const set = this.sockets.get(ws.key);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      this.sockets.delete(ws.key);
      this.presence.delete(ws.key);
      this.ktv.leave(ws.key); this.bil.leave(ws.key); this.wc.leave(ws.key); this.meet.leaveAll(ws.key);   // (rời mạng: ra khỏi phòng karaoke / bàn bi-a)
      const code = ws.key.startsWith('employee:') ? ws.key.slice(9) : null;
      if (code) { this.store.db.employees.update(code, { last_seen: Date.now() }); this.autoAttend(code, false); }
      this.broadcast({ t: 'gone', key: ws.key });
      this.onlineDirty = true;
      if (code) this.store.emit({ type: 'employees', code });
    }
  }

  onMessage(ws, buf) {
    // giới hạn tần suất (thùng token) + kích thước; gửi dồn quá lâu thì ngắt kết nối
    const now = Date.now(), b = ws.rl || (ws.rl = { t: now, n: RATE.burst });
    b.n = Math.min(RATE.burst, b.n + (now - b.t) * RATE.perSec / 1000); b.t = now;
    if (b.n < 1) { if ((ws.drops = (ws.drops || 0) + 1) > RATE.kickAfter) ws.close(1008, 'flood'); return; }
    b.n--; ws.drops = 0;
    if (buf.length > BIG_MSG && !/^\s*\{\s*"t"\s*:\s*"meet:/.test(String(typeof buf === 'string' ? buf.slice(0, 32) : buf.subarray(0, 32)))) return;
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m && m.t === 'view') { const f = Number.isInteger(m.f) && m.f >= 0 && m.f < 16 ? m.f : -1; if (f !== ws.viewF) { ws.viewF = f; if (f >= 0) this.sendFloor(ws, f); } return; }
    if (m && m.t === 'blind') return this.onBlind(ws, m);
    if (m && m.t === 'chat') return this.onChat(ws, m);
    if (m && typeof m.t === 'string' && m.t.startsWith('bil:')) return this.bil.onMessage(ws, m);
    if (m && typeof m.t === 'string' && m.t.startsWith('wc:')) return this.wc.onMessage(ws, m);
    if (m && typeof m.t === 'string' && m.t.startsWith('meet:')) return this.meet.onMessage(ws, m);
    if (m && (m.t === 'rtc' || (typeof m.t === 'string' && m.t.startsWith('ktv:')))) return this.ktv.onMessage(ws, m);
    if (!m || m.t !== 'pos') return;
    const p = this.presence.get(ws.key);
    if (!p) return;
    let act = typeof m.act === 'string' && ACTS.has(m.act) ? m.act : '';
    // quy định: không hút thuốc trong văn phòng (đang ngồi = đang ở trong văn phòng)
    if (act === 'smoke' && (p.seated || !smokeAllowed(Number(m.x), Number(m.z)))) act = '';
    if (p.seated) { if (p.act !== act && act !== 'jump') { p.act = act; this.dirty.add(ws.key); } return; } // đang ngồi: vị trí do server quyết định, chỉ đổi động tác
    if (!okNum(m.x, LIMIT.x) || !okNum(m.y, LIMIT.y) || !okNum(m.z, LIMIT.z) || !Number.isInteger(m.f) || !Number.isFinite(m.yaw)) return;
    // phòng họp đang họp: người không có trong danh sách không được vào (bỏ qua vị trí, báo một lần)
    if (this.meet?.blocked(ws.key, m.x, m.z, m.f)) { const now = Date.now(); if (now - (ws.lastBlocked || 0) > 4000) { ws.lastBlocked = now; this.send(ws, { t: 'meet:blocked' }); } return; }
    Object.assign(p, { x: m.x, y: m.y, z: m.z, f: m.f, yaw: m.yaw, walk: !!m.walk, run: !!m.run, act, mode: m.mode === 'real' ? 'real' : 'office' });
    this.dirty.add(ws.key);
  }

  // ---------- chat ----------
  actorOf(ws) { return { kind: ws.sess.kind, code: ws.sess.kind === 'employee' ? ws.sess.subject : null }; }
  onChat(ws, m) {
    const now = Date.now();
    if (now - (ws.lastChat || 0) < 400) return;                     // chống spam
    ws.lastChat = now;
    let ch = typeof m.channel === 'string' ? m.channel : 'all';
    if (typeof m.to === 'string' && m.to && m.to !== ws.key) ch = dmChannel(ws.key, m.to); // nhắn riêng
    const p = this.presence.get(ws.key);
    const msg = postMessage(this.store, this.actorOf(ws), ws.key, p ? p.display : ws.key, ch, m.body);
    if (!msg) return;
    // chỉ gửi cho người được đọc kênh đó
    const out = Buffer.from(JSON.stringify({ t: 'chat', msg }));
    for (const [key, set] of this.sockets) for (const s of set) if (s.readyState === 1 && canUseChannel(this.store, this.actorOf(s), key, ch)) this.sendBuf(s, out);
    if (ch.startsWith('proj:')) this.proj.onChat(msg);   // (@nhắc tên trong chat dự án)
  }
  // ---------- loa: phát/điều khiển qua REST (server/routes/music.js); ở đây chỉ phát trạng thái ----------
  /** Tên hiển thị của người thao tác (theo phiên đang online). */
  displayOf(actor) { const k = actor.kind === 'admin' ? `admin:${actor.username}` : `employee:${actor.code}`; return this.presence.get(k)?.display || (actor.kind === 'admin' ? `Admin (${actor.username})` : actor.code); }
  /** Chấm công vào/ra: báo cho mọi người (bảng thông tin trên bàn cập nhật). */
  attendance(rec) { this.broadcast({ t: 'attendance', rec }); }
  /** Admin đổi quyền bật nhạc của một người: báo cho người đó. */
  musicPermission(code, allow) { for (const ws of this.sockets.get(`employee:${code}`) || []) this.send(ws, { t: 'musicPerm', allow }); }

  /** Rèm cửa sổ: trạng thái chung của văn phòng, lưu trong DB, ai cũng kéo được. */
  blinds() {
    const out = {};
    for (const r of this.store.db.world_state.where(r => r.key.startsWith('blind:'))) out[r.key.slice(6)] = r.value === '1';
    return out;
  }
  onBlind(ws, m) {
    if (typeof m.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(m.id)) return;
    const now = Date.now();
    if (now - (ws.lastBlind || 0) < 250) return; // chống bấm liên tục
    ws.lastBlind = now;
    const open = !!m.open;
    this.store.db.world_state.upsert({ key: `blind:${m.id}`, value: open ? '1' : '0', updated_at: now, updated_by: ws.key });
    const p = this.presence.get(ws.key);
    this.broadcast({ t: 'blind', id: m.id, open, by: p ? p.display : '' });
  }

  /** Đặt người dùng ngồi vào chỗ (đã được store.checkSit duyệt). */
  setSeated(key, seat) {
    const p = this.presence.get(key);
    if (!p) { this.pendingSeat.set(key, seat); return false; }
    const y = this.store.modelOf(seat.deskId).floorY(seat.floor);
    Object.assign(p, { mode: modeOfDesk(seat.deskId), seated: seat.deskId, x: seat.x, y, z: seat.z, f: seat.floor, yaw: seat.facing * Math.PI / 180, walk: false });
    this.dirty.add(key);
    return true;
  }
  stand(key) { this.pendingSeat.delete(key); const p = this.presence.get(key); if (p && p.seated) { p.seated = null; this.dirty.add(key); } }

  // Gói vị trí gửi ~8 lần/giây cho mọi người: chỉ gồm phần thay đổi liên tục (toạ độ làm tròn cm, bỏ trường rỗng). Hồ sơ
  // (tên, nhân vật, phòng ban) chỉ kèm lần đầu người đó có vị trí hoặc khi đổi (p.pv tăng) — người vào sau đã có trong hello.
  // (100 người, 1/3 đang đi lại: từ ~85 KB/s xuống ~15 KB/s mỗi người nhận)
  // Chỉ gửi vị trí người ở CÙNG TẦNG đang xem (client báo { t: 'view', f }; tầng khác không vẽ): người đổi tầng hoặc đổi hồ sơ
  // thì gửi cho tất cả; Admin và người xem toàn cảnh (f = -1) nhận hết. Mỗi tầng mã hoá JSON một lần. (băng thông ~1/3 khi chia đều 3 tầng)
  flush() {
    // danh sách online: gộp tối đa 1 lần/giây (giờ vào ca 80 người vào trong 10 giây: gửi cả danh sách cho mọi người mỗi nhịp
    // 160 ms là O(n²) — chiếm gần hết 0,1 CPU của gói free, người vào sau phải chờ 9 giây)
    const t = Date.now();
    if (this.onlineDirty && t - (this.onlineAt || 0) >= 1000) { this.onlineDirty = false; this.onlineAt = t; this.broadcast({ t: 'online', list: this.onlineList() }); }
    if (!this.dirty.size) return;
    const items = new Map();
    for (const k of this.dirty) {
      const p = this.presence.get(k); if (!p) continue;
      const all = p.wf !== p.f || p.sentPv !== (p.pv || 0); p.wf = p.f;
      items.set(k, { o: this.wire(p), f: p.f, all });
    }
    this.dirty.clear();
    if (!items.size) return;
    const cache = new Map(), payload = vf => {
      if (!cache.has(vf)) { const list = [...items.values()].filter(i => vf < 0 || i.all || i.f === vf).map(i => i.o); cache.set(vf, list.length ? Buffer.from(JSON.stringify({ t: 'positions', list })) : null); }
      return cache.get(vf);
    };
    for (const set of this.sockets.values()) for (const ws of set) {
      if (ws.readyState !== 1) continue;
      const vf = ws.sess.kind === 'admin' ? -1 : ws.viewF ?? -1, buf = payload(vf);
      if (buf) this.sendBuf(ws, buf, true);
      const own = vf >= 0 && items.get(ws.key);   // (vị trí của chính mình — ghế do server xếp — luôn gửi, kể cả đang xem tầng khác)
      if (own && !own.all && own.f !== vf) this.sendBuf(ws, Buffer.from(JSON.stringify({ t: 'positions', list: [own.o] })), true);
    }
  }
  /** Đổi tầng đang xem: gửi ngay vị trí mọi người ở tầng đó (trong lúc xem tầng khác không nhận cập nhật của họ). */
  sendFloor(ws, f) {
    const list = [...this.presence.values()].filter(p => p.x !== null && p.f === f && p.key !== ws.key);
    if (list.length) this.send(ws, { t: 'positions', list });
  }
  /** Gửi một gói đã mã hoá; client mạng chậm: bỏ gói có thể bỏ (vị trí) khi tồn đọng, ngắt khi tồn quá nhiều (tự nối lại → hello). */
  sendBuf(ws, buf, droppable = false) {
    const q = ws.bufferedAmount;
    if (q > BUF_KILL) { ws.terminate(); return; }
    if (droppable && q > BUF_SKIP) return;
    ws.send(buf, { binary: false });
  }
  wire(p) {
    if (p.sentPv !== (p.pv || 0)) { p.sentPv = p.pv || 0; return p; }
    const r2 = v => Math.round(v * 100) / 100, o = { key: p.key, x: r2(p.x), y: r2(p.y), z: r2(p.z), f: p.f, yaw: r2(p.yaw) };
    if (p.walk) o.walk = true; if (p.run) o.run = true; if (p.act) o.act = p.act; if (p.seated) o.seated = p.seated; if (p.mode && p.mode !== 'office') o.mode = p.mode;
    return o;
  }

  sweep() {
    for (const set of this.sockets.values()) for (const ws of set) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
      // phiên bị thu hồi (đăng xuất ở nơi khác, hết hạn) thì đóng kết nối
      if (!this.store.db.sessions.has(ws.sess.id)) this.kickSocket(ws, 'Phiên đăng nhập đã hết hiệu lực.');
    }
  }

  onlineList() {
    return [...this.sockets.keys()].map(k => { const p = this.presence.get(k); return p ? { key: k, kind: p.kind, code: p.code, display: p.display, seated: p.seated } : null; }).filter(Boolean);
  }

  onStore(ev) {
    if (ev.type === 'seat') {
      const seats = ev.deskIds.map(id => this.store.seatRow(id)).filter(Boolean).map(r => this.store.seatView(r));
      // ai đang ngồi ở chỗ không còn thuộc về mình thì phải đứng dậy
      for (const p of this.presence.values()) {
        if (!p.seated || !ev.deskIds.includes(p.seated)) continue;
        try { this.store.checkSit({ kind: p.kind, code: p.code }, p.seated); } catch { this.stand(p.key); }
      }
      this.broadcast({ t: 'seats', list: seats });
    } else if (ev.type === 'seats') {
      this.broadcast({ t: 'seats', list: this.store.listSeats(), full: true });
    } else if (ev.type === 'employees') {
      this.broadcast({ t: 'employees' }, ws => ws.sess.kind === 'admin');
      // cập nhật tên hiển thị / phòng ban trong presence (vào / ra chỉ cần xem một người; Admin sửa danh sách thì xem hết)
      const list = ev.code ? [this.presence.get(`employee:${ev.code}`)].filter(Boolean) : [...this.presence.values()];
      for (const p of list) if (p.code) {
        const e = this.store.employee(p.code); if (!e) continue;
        const display = displayOf(e.code, e.name), department = e.department || '';
        if (display !== p.display || department !== p.department) { Object.assign(p, { display, department }); p.pv = (p.pv || 0) + 1; if (p.x !== null) this.dirty.add(p.key); }
      }
    } else if (ev.type === 'look') {
      const p = this.presence.get(`employee:${ev.code}`);
      if (p) { p.look = ev.look; p.pv = (p.pv || 0) + 1; if (p.x !== null) this.dirty.add(p.key); }
    } else if (ev.type === 'kick') {
      this.pending.delete(ev.code);
      if (ev.disabled) this.proj.disabled(ev.code);   // (nhân viên bị vô hiệu hoá: rời mọi dự án)
      for (const ws of this.sockets.get(`employee:${ev.code}`) || []) this.kickSocket(ws, ev.reason);
    }
  }
  kickSessions(key, reason) { for (const ws of this.sockets.get(key) || []) this.kickSocket(ws, reason); }
  kickSocket(ws, reason) { this.send(ws, { t: 'kick', reason }); setTimeout(() => ws.close(4001, 'kicked'), 50); }

  send(ws, msg) { if (ws.readyState === 1) this.sendBuf(ws, Buffer.from(JSON.stringify(msg))); }
  broadcast(msg, filter) {
    const s = Buffer.from(JSON.stringify(msg));   // (mã hoá một lần cho mọi người nhận, gửi dạng khung văn bản)
    for (const set of this.sockets.values()) for (const ws of set) if (ws.readyState === 1 && (!filter || filter(ws))) this.sendBuf(ws, s);
  }
}
