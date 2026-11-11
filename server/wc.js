// Nhà vệ sinh (sảnh tầng trệt): 2 buồng, mỗi buồng một người. Vào buồng trống → cửa đóng, đèn báo đỏ; buồng đang có người
// thì người khác không vào được — người ở trong "quát" ra ngoài (câu tức giận hiện trên cửa buồng cho người gần đó thấy,
// người gõ cửa nhận thông báo). Ra khỏi buồng / rời mạng → trả buồng. Trạng thái chỉ nằm trong bộ nhớ.
export const STALLS = 2;
export const ANGRY = [
  'Có người rồi!! Gõ gì mà gõ 😡',
  'Ai đó?! Đang bận mà! 😤',
  'Đợi chút đi, đừng có giục! 💢',
  'Có người!!! Ra ngoài chờ đi! 😠',
  'Gõ nữa là không ra luôn đó! 🤬',
  'Bên này kín rồi, qua buồng kia đi! 😾'
];

export class Restroom {
  constructor(hub) { this.hub = hub; this.stalls = Array(STALLS).fill(null); this.knockAt = new Map(); }
  state() { return { stalls: this.stalls.map(s => s ? { key: s.key, display: s.display, since: s.since } : null) }; }
  push() { this.hub.broadcast({ t: 'wc', state: this.state() }); }
  display(key) { return this.hub.presence.get(key)?.display || key; }
  onMessage(ws, m) {
    if (m.t === 'wc:enter') return this.enter(ws, m.stall);
    if (m.t === 'wc:leave') return this.leave(ws.key);
  }
  enter(ws, i) {
    i = Number(i); if (!Number.isInteger(i) || i < 0 || i >= STALLS) return;
    const s = this.stalls[i];
    if (s?.key === ws.key) return;
    if (s) {   // đang có người: bị quát (mỗi người tối đa 1 lần / 1,5 s)
      const now = Date.now(); if (now - (this.knockAt.get(ws.key) || 0) < 1500) return; this.knockAt.set(ws.key, now);
      const text = ANGRY[Math.floor(Math.random() * ANGRY.length)];
      this.hub.broadcast({ t: 'wcAngry', stall: i, text, by: s.display, knocker: this.display(ws.key) });
      for (const k of this.hub.sockets.get(s.key) || []) this.hub.send(k, { t: 'wcKnock', by: this.display(ws.key) });
      return;
    }
    this.leave(ws.key, false);   // (đang ở buồng khác: chuyển buồng)
    this.stalls[i] = { key: ws.key, display: this.display(ws.key), since: Date.now() };
    this.push();
  }
  leave(key, push = true) {
    let changed = false;
    this.stalls = this.stalls.map(s => { if (s?.key === key) { changed = true; return null; } return s; });
    if (changed && push) this.push();
    return changed;
  }
}
