// Kết nối WebSocket tới server (xác thực bằng cookie phiên), tự nối lại khi rớt mạng.
export class Realtime {
  constructor() { this.handlers = new Map(); this.ws = null; this.retry = 0; this.closed = false; this.lastPos = 0; }
  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(fn); return this; }
  emit(type, msg) { for (const fn of this.handlers.get(type) || []) fn(msg); }
  connect() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
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
  /** Gửi vị trí (tối đa 6 lần/giây). */
  sendPos(p) {
    const now = performance.now();
    if (!this.connected || now - this.lastPos < 160) return;
    this.lastPos = now;
    this.ws.send(JSON.stringify({ t: 'pos', ...p }));
  }
  close() { this.closed = true; this.ws?.close(); }
}
