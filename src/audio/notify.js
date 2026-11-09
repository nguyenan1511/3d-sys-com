// Âm báo của văn phòng, tự tổng hợp bằng Web Audio (không cần file âm thanh):
//  - 'message': tin nhắn mới (hai nốt ngắn, nhẹ);
//  - 'join': có người vừa vào công ty (ba nốt đi lên, ấm).
// Trình duyệt chỉ cho phát âm thanh sau khi người dùng đã bấm/gõ trên trang: unlock() gắn vào cử chỉ đầu tiên.
// Bật/tắt lưu ở localStorage 'sysone.sound' (mặc định bật). Cùng loại âm không kêu dồn dập (tối thiểu 0,6 giây).
const KEY = 'sysone.sound';
const TONES = {
  message: { notes: [880, 1318.5], gap: 0.085, len: 0.32, vol: 0.11 },
  join: { notes: [523.25, 659.25, 783.99], gap: 0.11, len: 0.5, vol: 0.09 }
};
let ctx = null, master = null;
const last = {};

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  ctx = new AC(); master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
  return ctx;
}

export const sound = {
  get on() { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } },
  set on(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* chế độ riêng tư */ } },
  /** Gắn một lần: cử chỉ đầu tiên của người dùng mở khoá âm thanh. */
  unlockOnGesture() {
    const go = () => { const c = ensure(); if (c && c.state === 'suspended') c.resume(); if (c?.state === 'running') off(); };
    const off = () => ['pointerdown', 'keydown', 'touchend'].forEach(e => window.removeEventListener(e, go, true));
    ['pointerdown', 'keydown', 'touchend'].forEach(e => window.addEventListener(e, go, true));
  },
  play(kind) {
    const t = TONES[kind]; if (!t || !this.on || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime; if (now - (last[kind] ?? -9) < 0.6) return; last[kind] = now;
    t.notes.forEach((f, i) => {
      const at = now + i * t.gap, g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(t.vol, at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, at + t.len);
      g.connect(master);
      // tiếng chuông mềm: sóng sin + một chút bồi âm bậc 2
      for (const [type, mul, amp] of [['sine', 1, 1], ['triangle', 2, 0.18]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = f * mul; og.gain.value = amp;
        o.connect(og); og.connect(g); o.start(at); o.stop(at + t.len + 0.05);
      }
    });
  }
};
