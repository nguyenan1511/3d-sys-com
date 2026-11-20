import { getMode } from '../core/mode.js';
const MODE = getMode();
// Mã tab: giữ qua lần tải lại trang (sessionStorage) để server nhận ra "chính tab này nối lại"; tab nhân bản (Duplicate tab —
// sessionStorage bị chép theo) tự đổi mã nhờ hỏi qua BroadcastChannel xem đã có tab nào đang giữ mã này chưa.
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
let TAB = (() => { try { return sessionStorage.getItem('sysone.tab') || ''; } catch { return ''; } })() || rid();
const saveTab = () => { try { sessionStorage.setItem('sysone.tab', TAB); } catch { /* */ } };
saveTab();
const tabReady = (() => {
  if (typeof BroadcastChannel !== 'function') return Promise.resolve();
  const ch = new BroadcastChannel('sysone-tab');
  ch.onmessage = e => { if (e.data?.q === TAB) ch.postMessage({ a: TAB }); };
  return new Promise(res => {
    const onA = e => { if (e.data?.a === TAB) { TAB = rid(); saveTab(); } };
    ch.addEventListener('message', onA); ch.postMessage({ q: TAB });
    setTimeout(() => { ch.removeEventListener('message', onA); res(); }, 120);
  });
})();
// Kết nối WebSocket tới server (xác thực bằng cookie phiên, hoặc vé dùng một lần khi giao diện ở tên miền khác), tự nối lại khi rớt mạng.
export class Realtime {
  constructor() { this.handlers = new Map(); this.ws = null; this.retry = 0; this.closed = false; this.lastPos = 0; }
  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(fn); return this; }
  // mỗi handler chạy riêng: một handler lỗi (vd. trình phát nhạc) không được chặn các handler sau (đèn, rèm, chỗ ngồi…)
  emit(type, msg) { for (const fn of this.handlers.get(type) || []) { try { fn(msg); } catch (e) { console.error(`[realtime] lỗi xử lý "${type}"`, e); } } }
  async connect(takeover = false) {
    await tabReady;
    const qs = `tab=${encodeURIComponent(TAB)}${takeover ? '&takeover=1' : ''}`;
    // Mặc định: WS cùng tên miền, xác thực bằng cookie. Giao diện đặt ở Vercel (VITE_WS_URL = wss://server-render): Vercel không
    // chuyển tiếp WebSocket nên nối thẳng tới server, xác thực bằng vé dùng một lần lấy qua API (API đi qua proxy, có cookie).
    const remote = String(import.meta.env.VITE_WS_URL || '').replace(/\/+$/, '');
    let url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${qs}`;
    if (remote) {
      let ticket = null;
      try { const r = await fetch('/api/v1/ws-ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' }); if (r.ok) ticket = (await r.json()).ticket; } catch { /* mạng lỗi: thử lại sau */ }
      if (this.closed) return;
      if (!ticket) { setTimeout(() => this.connect(takeover), Math.min(10000, 500 * 2 ** this.retry++)); return; }
      url = `${remote}/ws?ticket=${encodeURIComponent(ticket)}&${qs}`;
    }
    const ws = this.ws = new WebSocket(url);
    ws.onopen = () => { this.retry = 0; this.emit('open'); };
    ws.onmessage = e => { if (ws !== this.ws) return; let m; try { m = JSON.parse(e.data); } catch { return; } if (m.t === 'full') this.full = m; else if (m.t === 'hello') { this.full = null; this.parked = null; } else if (m.t === 'dup' || m.t === 'replaced') this.parked = m.t; this.emit(m.t, m); };
    ws.onclose = e => {
      if (ws !== this.ws) return;   // (kết nối cũ đã được thay)
      this.emit('close', e);
      if (this.closed || e.code === 4001) return;
      // tài khoản đang dùng ở tab khác (4009) / đã chuyển sang tab khác (4010): không tự nối lại — chờ người dùng bấm "Dùng ở tab này"
      if (e.code === 4009 || e.code === 4010 || this.parked) return;
      // văn phòng đủ người (server/realtime.js Gate): thử lại sau ~10 giây để giữ chỗ trong hàng chờ (không tăng dần thời gian chờ)
      if (e.code === 4013 && this.full) { const w = (this.full.retryMs || 10000) * (0.8 + Math.random() * 0.4); this.nextTry = Date.now() + w; this._t = setTimeout(() => this.connect(), w); return; }
      const wait = Math.min(10000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }
  /** "Dùng ở tab này": nối lại và giành quyền từ tab / máy đang mở (tab kia chuyển sang trạng thái tạm dừng). */
  takeover() { this.parked = null; this.retry = 0; this.connect(true); }
  /** Thử vào lại ngay (nút "Thử lại" trên màn chờ). */
  retryNow() { if (this.connected || !this.full) return; clearTimeout(this._t); this.connect(); }
  get connected() { return this.ws && this.ws.readyState === 1; }
  /** Gửi một tin bất kỳ (karaoke, bắt tay WebRTC…). */
  send(obj) { if (this.connected) this.ws.send(JSON.stringify(obj)); }
  /** Gửi vị trí (tối đa 6 lần/giây). */
  sendPos(p) {
    const now = performance.now();
    if (!this.connected || now - this.lastPos < 160) return;
    this.lastPos = now;
    this.ws.send(JSON.stringify({ t: 'pos', mode: MODE, ...p }));
  }
  close() { this.closed = true; this.ws?.close(); }
}
