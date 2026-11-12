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
const ACTS = new Set(['', 'wave', 'smoke', 'drink', 'phone', 'dance', 'quay', 'jump', 'tv', ...PROP_ACTS]); // tv: ngồi sofa xem TV; còn lại: dùng đồ vật
const okNum = (v, [a, b]) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;

export class Hub {
  constructor(store, config) {
    this.store = store; this.config = config; this.ktv = new Karaoke(this); this.bil = new Billiards(this); this.wc = new Restroom(this);
    this.sockets = new Map();   // key -> Set<ws>
    this.presence = new Map();  // key -> { key, kind, code, display, x,y,z,f,yaw,walk, seated }
    this.pending = new Map();   // code -> hạn "đang vào" sau khi đăng nhập, trước khi mở WS
    this.pendingSeat = new Map(); // key -> chỗ đã được duyệt ngồi trước khi WS kịp kết nối
    this.dirty = new Set();
    this.timer = setInterval(() => this.flush(), 160);   // (≈ nhịp client gửi vị trí: 6 lần/giây)
    this.heartbeat = setInterval(() => this.sweep(), 15000);
    // số nhân viên online mỗi phút, giữ 6 giờ (biểu đồ "Đang online" ở bảng quản trị; mất khi server khởi động lại)
    this.hist = []; this.sampleOnline(); this.histTimer = setInterval(() => this.sampleOnline(), 60000); this.histTimer.unref?.();
    store.on(ev => this.onStore(ev));
  }
  close() { clearInterval(this.timer); clearInterval(this.heartbeat); clearInterval(this.histTimer); this.wss?.close(); }
  onlineEmployees() { let n = 0; for (const k of this.sockets.keys()) if (k.startsWith('employee:')) n++; return n; }
  sampleOnline() { const t = Date.now(); this.hist.push({ t, n: this.onlineEmployees() }); while (this.hist.length && this.hist[0].t < t - 6 * 3600e3) this.hist.shift(); }

  /** Mã đang online: có kết nối WS, hoặc vừa đăng nhập xong và đang tải cảnh. */
  isOnline = code => (this.sockets.get(`employee:${code}`)?.size || 0) > 0 || (this.pending.get(code) || 0) > Date.now();
  markPending(code) { this.pending.set(code, Date.now() + this.config.onlineGraceMs); }

  attach(server) {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    server.on('upgrade', (req, socket, head) => {
      if (!req.url.startsWith('/ws')) return;
      // chống mở WS từ trang khác (cookie tự gửi kèm); giao diện ở tên miền khác thì phải nằm trong ALLOWED_ORIGINS
      if (!originAllowed(req, this.config.allowedOrigins)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
      // xác thực: cookie phiên (cùng tên miền) hoặc vé dùng một lần ?ticket= (giao diện ở Vercel)
      const ticket = new URL(req.url, 'http://x').searchParams.get('ticket');
      const sess = sessionFromCookie(this.store.db, ticket ? redeemWsTicket(ticket) : req.headers.cookie);
      if (!sess) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, ws => this.onConnect(ws, sess));
    });
  }

  identity(sess) {
    if (sess.kind === 'admin') return { key: `admin:${sess.subject}`, kind: 'admin', code: null, display: `CEO (${sess.subject})`, department: 'Ban giám đốc' };
    const e = this.store.employee(sess.subject);
    return { key: `employee:${sess.subject}`, kind: 'employee', code: sess.subject, display: e ? displayOf(e.code, e.name) : sess.subject, look: e?.look ? JSON.parse(e.look) : null, department: e?.department || '' };
  }

  onConnect(ws, sess) {
    const id = this.identity(sess);
    ws.sess = sess; ws.key = id.key; ws.alive = true;
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
    this.send(ws, { t: 'hello', you: id, online: this.onlineList(), seats: this.store.listSeats(), presence: [...this.presence.values()].filter(p => p.x !== null), blinds: this.blinds(), music: musicState(this.store), ktv: this.ktv.state(), bil: this.bil.state(), wc: this.wc.state(), lights: lightsState(this.store), canLights: canLights(this.store, this.actorOf(ws)), canMusic: canMusic(this.store, this.actorOf(ws)) });
    if (first) { this.onlineDirty = true; if (id.code) this.store.emit({ type: 'employees', code: id.code }); }
  }

  onClose(ws) {
    const set = this.sockets.get(ws.key);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      this.sockets.delete(ws.key);
      this.presence.delete(ws.key);
      this.ktv.leave(ws.key); this.bil.leave(ws.key); this.wc.leave(ws.key);   // (rời mạng: ra khỏi phòng karaoke / bàn bi-a)
      const code = ws.key.startsWith('employee:') ? ws.key.slice(9) : null;
      if (code) this.store.db.prepare('UPDATE employees SET last_seen = ? WHERE code = ?').run(Date.now(), code);
      this.broadcast({ t: 'gone', key: ws.key });
      this.onlineDirty = true;
      if (code) this.store.emit({ type: 'employees', code });
    }
  }

  onMessage(ws, buf) {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m && m.t === 'blind') return this.onBlind(ws, m);
    if (m && m.t === 'chat') return this.onChat(ws, m);
    if (m && typeof m.t === 'string' && m.t.startsWith('bil:')) return this.bil.onMessage(ws, m);
    if (m && typeof m.t === 'string' && m.t.startsWith('wc:')) return this.wc.onMessage(ws, m);
    if (m && (m.t === 'rtc' || (typeof m.t === 'string' && m.t.startsWith('ktv:')))) return this.ktv.onMessage(ws, m);
    if (!m || m.t !== 'pos') return;
    const p = this.presence.get(ws.key);
    if (!p) return;
    let act = typeof m.act === 'string' && ACTS.has(m.act) ? m.act : '';
    // quy định: không hút thuốc trong văn phòng (đang ngồi = đang ở trong văn phòng)
    if (act === 'smoke' && (p.seated || !smokeAllowed(Number(m.x), Number(m.z)))) act = '';
    if (p.seated) { if (p.act !== act && act !== 'jump') { p.act = act; this.dirty.add(ws.key); } return; } // đang ngồi: vị trí do server quyết định, chỉ đổi động tác
    if (!okNum(m.x, LIMIT.x) || !okNum(m.y, LIMIT.y) || !okNum(m.z, LIMIT.z) || !Number.isInteger(m.f) || !Number.isFinite(m.yaw)) return;
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
    for (const [key, set] of this.sockets) for (const s of set) if (s.readyState === 1 && canUseChannel(this.store, this.actorOf(s), key, ch)) s.send(JSON.stringify({ t: 'chat', msg }));
  }
  // ---------- loa: phát/điều khiển qua REST (server/routes/music.js); ở đây chỉ phát trạng thái ----------
  /** Tên hiển thị của người thao tác (theo phiên đang online). */
  displayOf(actor) { const k = actor.kind === 'admin' ? `admin:${actor.username}` : `employee:${actor.code}`; return this.presence.get(k)?.display || (actor.kind === 'admin' ? `CEO (${actor.username})` : actor.code); }
  /** Chấm công vào/ra: báo cho mọi người (bảng thông tin trên bàn cập nhật). */
  attendance(rec) { this.broadcast({ t: 'attendance', rec }); }
  /** CEO đổi quyền bật nhạc của một người: báo cho người đó. */
  musicPermission(code, allow) { for (const ws of this.sockets.get(`employee:${code}`) || []) this.send(ws, { t: 'musicPerm', allow }); }

  /** Rèm cửa sổ: trạng thái chung của văn phòng, lưu trong DB, ai cũng kéo được. */
  blinds() {
    const out = {};
    for (const r of this.store.db.prepare("SELECT key, value FROM world_state WHERE key LIKE 'blind:%'").all()) out[r.key.slice(6)] = r.value === '1';
    return out;
  }
  onBlind(ws, m) {
    if (typeof m.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(m.id)) return;
    const now = Date.now();
    if (now - (ws.lastBlind || 0) < 250) return; // chống bấm liên tục
    ws.lastBlind = now;
    const open = !!m.open;
    this.store.db.prepare('INSERT INTO world_state (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .run(`blind:${m.id}`, open ? '1' : '0', now, ws.key);
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
  flush() {
    if (this.onlineDirty) { this.onlineDirty = false; this.broadcast({ t: 'online', list: this.onlineList() }); }
    if (!this.dirty.size) return;
    const list = [];
    for (const k of this.dirty) { const p = this.presence.get(k); if (p) list.push(this.wire(p)); }
    this.dirty.clear();
    if (list.length) this.broadcast({ t: 'positions', list });
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
      if (!this.store.db.prepare('SELECT 1 FROM sessions WHERE id_hash = ?').get(ws.sess.id)) this.kickSocket(ws, 'Phiên đăng nhập đã hết hiệu lực.');
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
      // cập nhật tên hiển thị / phòng ban trong presence (vào / ra chỉ cần xem một người; CEO sửa danh sách thì xem hết)
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
      for (const ws of this.sockets.get(`employee:${ev.code}`) || []) this.kickSocket(ws, ev.reason);
    }
  }
  kickSessions(key, reason) { for (const ws of this.sockets.get(key) || []) this.kickSocket(ws, reason); }
  kickSocket(ws, reason) { this.send(ws, { t: 'kick', reason }); setTimeout(() => ws.close(4001, 'kicked'), 50); }

  send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  broadcast(msg, filter) {
    const s = Buffer.from(JSON.stringify(msg));   // (mã hoá một lần cho mọi người nhận, gửi dạng khung văn bản)
    for (const set of this.sockets.values()) for (const ws of set) if (ws.readyState === 1 && (!filter || filter(ws))) ws.send(s, { binary: false });
  }
}
