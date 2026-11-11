// Hai chế độ văn phòng: "real" (Real SYS — đúng mặt bằng thật, src/data/layout.real.json) và "office" (Office SYS —
// bản văn phòng 3D hiện có, public/data/layout.json). Người dùng chọn ở màn đăng nhập; đổi bằng nút trong khối logo
// (tải lại cảnh, giữ phiên). ?mode=real|office trên URL ghi đè lựa chọn đã lưu.
export const MODES = {
  real: { id: 'real', name: 'Real SYS', hint: 'Đúng mặt bằng văn phòng thật', layout: 'data/layout.real.json' },
  office: { id: 'office', name: 'Office SYS', hint: 'Văn phòng 3D hiện tại', layout: 'data/layout.json' }
};
const KEY = 'sysone.mode';
/**
 * Real SYS đang TẮT HẲN (người dùng yêu cầu 2026-11-11, giữ code để bật lại sau): cờ build __REAL_SYS__ (vite.config.js,
 * mặc định false) — khi tắt, mã Real SYS (scene/realShell.js, data/realPlan.js, data/layout.real.json) không nằm trong gói
 * build và không chạy; ?mode=real cũng bị bỏ qua, mọi người vào Office SYS.
 * Bật lại: REAL_SYS=1 khi build/chạy (vd. REAL_SYS=1 npm run build, REAL_SYS=1 npm run dev — server cũng đọc biến này).
 */
// (typeof: server Node dùng chung file này mà không qua Vite)
// eslint-disable-next-line no-undef
export const REAL_ENABLED = typeof __REAL_SYS__ !== 'undefined' && __REAL_SYS__ === true;
export function getMode() {
  if (!REAL_ENABLED) return 'office';
  const q = new URLSearchParams(location.search).get('mode');
  if (q && MODES[q]) return q;
  try { const v = localStorage.getItem(KEY); if (v && MODES[v]) return v; } catch { /* */ }
  return 'real';
}
export function hasChosenMode() { try { return !!MODES[localStorage.getItem(KEY)]; } catch { return false; } }
export function saveMode(m) { if (!MODES[m]) return; try { localStorage.setItem(KEY, m); } catch { /* */ } }
/** Đổi chế độ: lưu rồi tải lại trang (bỏ ?mode= trên URL để lựa chọn mới có hiệu lực). */
export function switchMode(m) {
  saveMode(m);
  const u = new URL(location.href); u.searchParams.delete('mode');
  sessionStorage.setItem('sysone_notice', `Đã chuyển sang ${MODES[m].name}.`);
  location.replace(u.toString());
}
/** Chế độ của một mã bàn: bàn Real SYS có mã R… (R1-01, RM1-2), còn lại thuộc Office SYS. */
export const modeOfDesk = id => (/^R/.test(String(id)) ? 'real' : 'office');
