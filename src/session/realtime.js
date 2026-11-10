// Kết nối WebSocket tới server (xác thực bằng cookie phiên, hoặc vé dùng một lần khi giao diện ở tên miền khác), tự nối lại khi rớt mạng.
export class Realtime {
  constructor() { this.handlers = new Map(); this.ws = null; this.retry = 0; this.closed = false; this.lastPos = 0; }
  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(fn); return this; }
  emit(type, msg) { for (const fn of this.handlers.get(type) || []) fn(msg); }
  async connect() {
    // Mặc định: WS cùng tên miền, xác thực bằng cookie. Giao diện đặt ở Vercel (VITE_WS_URL = wss://server-render): Vercel không
    // chuyển tiếp WebSocket nên nối thẳng tới server, xác thực bằng vé dùng một lần lấy qua API (API đi qua proxy, có cookie).
    const remote = String(import.meta.env.VITE_WS_URL || '').replace(/\/+$/, '');
    let url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    if (remote) {
      let ticket = null;
      try { const r = await fetch('/api/v1/ws-ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' }); if (r.ok) ticket = (await r.json()).ticket; } catch { /* mạng lỗi: thử lại sau */ }
      if (this.closed) return;
      if (!ticket) { setTimeout(() => this.connect(), Math.min(10000, 500 * 2 ** this.retry++)); return; }
      url = `${remote}/ws?ticket=${encodeURIComponent(ticket)}`;
    }
    const ws = this.ws = new WebSocket(url);
    ws.onopen = () => { this.retry = 0; this.emit('open'); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } this.emit(m.t, m); };
    ws.onclose = e => {
      this.emit('close', e);
      if (this.closed || e.code === 4001) return;
      const wait = Math.min(10000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
  }
  get connected() { return this.ws && this.ws.readyState === 1; }
  /** Gửi một tin bất kỳ (karaoke, bắt tay WebRTC…). */
  send(obj) { if (this.connected) this.ws.send(JSON.stringify(obj)); }
  /** Gửi vị trí (tối đa 6 lần/giây). */
  sendPos(p) {
    const now = performance.now();
    if (!this.connected || now - this.lastPos < 160) return;
    this.lastPos = now;
    this.ws.send(JSON.stringify({ t: 'pos', ...p }));
  }
  close() { this.closed = true; this.ws?.close(); }
}
