// Điểm vào: kiểm tra phiên ở server; chưa đăng nhập thì chỉ hiện màn hình đăng nhập,
// cảnh 3D và dữ liệu bố cục chỉ được tải sau khi đăng nhập thành công.
// Be Vietnam Pro (OFL, tự host qua @fontsource — CSP không cho tải font ngoài): chữ tiếng Việt rõ trên điện thoại
import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import '@fontsource/be-vietnam-pro/vietnamese-700.css';
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/be-vietnam-pro/latin-700.css';
import { api } from './net/api.js';
import { loading } from './ui/loading.js';
import { autoEnhanceSelects } from './ui/select.js';
autoEnhanceSelects();   // (mọi <select> trong app: ô chọn tự vẽ theo giao diện SYSONE)
import { showLogin } from './auth/login.js';
import { savedLogin, forgetLogin } from './auth/remember.js';

const loginRoot = document.getElementById('login');
const appRoot = document.getElementById('appRoot');

// Gói cảnh 3D (three.js + văn phòng, ~750 kB nén) chỉ cần sau khi đăng nhập — nhưng tải sẵn nó trong lúc người dùng gõ mã
// đăng nhập (lúc rảnh, sau khi màn hình đăng nhập đã hiện) thì bấm "Vào" là vào ngay, không phải chờ tải. Bỏ qua khi
// trình duyệt bật tiết kiệm dữ liệu hoặc mạng 2G.
let mainMod = null;
const loadMain = () => (mainMod ??= import('./main.js').catch(e => { mainMod = null; throw e; })); // (lỗi mạng: lần sau thử tải lại)
function prefetchMain() {
  const c = navigator.connection;
  if (c?.saveData || /(^|-)2g$/.test(c?.effectiveType || '')) return;
  const go = () => loadMain().catch(() => { /* tải lại khi đăng nhập */ });
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 2500 }); else setTimeout(go, 1200);
}

/** Thiết bị/trình duyệt có vẽ được 3D (WebGL) không — kiểm tra trước khi tải gói 3D. */
function webglSupport() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // (trả ngay ngữ cảnh thử: trình duyệt giới hạn số ngữ cảnh WebGL)
    return true;
  } catch { return false; }
}

let autoTried = false;
async function boot(notice) {
  const me = await api('GET', '/api/me');
  if (me.status === 0) { // không kết nối được máy chủ (mất mạng / máy chủ đang khởi động lại)
    appRoot.hidden = false; loginRoot.hidden = true;
    loading.error('Không kết nối được máy chủ.', { hint: 'Kiểm tra kết nối mạng. Máy chủ có thể đang khởi động lại — đợi vài giây rồi bấm Thử lại.' });
    return;
  }
  if (!me.ok || !me.authenticated) {
    // máy này đã đăng nhập trước đó nhưng server không còn phiên (server mất dữ liệu / phiên hết hạn): tự đăng nhập lại bằng
    // mã đã nhớ — không bị buộc đăng xuất (notice) và chỉ thử một lần; mã sai / bị khoá thì quên mã, hiện màn hình đăng nhập
    const saved = !notice && !autoTried && savedLogin();
    if (saved) {
      autoTried = true;
      const r = await api('POST', '/api/login/employee', { input: saved });
      if (r.ok) return boot();
      if (r.status === 400 || r.status === 403) forgetLogin();
    }
    appRoot.hidden = true;
    showLogin(loginRoot, { notice, prefill: savedLogin() || '', onSuccess: () => boot() });
    prefetchMain();
    return;
  }
  loginRoot.hidden = true; loginRoot.innerHTML = '';
  appRoot.hidden = false;
  if (!webglSupport()) {
    loading.error('Thiết bị này chưa hỗ trợ đồ hoạ 3D (WebGL).', { retry: false, hint: 'Hãy mở bằng Chrome, Edge, Safari hoặc Firefox bản mới, bật "tăng tốc phần cứng" trong cài đặt trình duyệt, hoặc dùng máy khác.' });
    return;
  }
  loading.step('Đang mở văn phòng…', 2, 6);
  let startApp;
  try { ({ startApp } = await loadMain()); }
  catch (e) { console.error(e); loading.error('Không tải được văn phòng 3D (mạng chập chờn?).'); return; }
  await startApp(me, {
    logout: async (reason) => {
      forgetLogin();   // (tự bấm đăng xuất, hoặc bị buộc đăng xuất: lần sau phải tự đăng nhập)
      await api('POST', '/api/logout', {});
      sessionStorage.setItem('sysone_notice', reason || 'Bạn đã đăng xuất.');
      location.reload();
    }
  });
}

const notice = sessionStorage.getItem('sysone_notice');
sessionStorage.removeItem('sysone_notice');
boot(notice).catch(async err => {
  console.error(err);
  // phiên đăng nhập hết hiệu lực giữa chừng (đăng xuất ở tab khác, phiên hết hạn…): về màn hình đăng nhập thay vì báo lỗi
  const me = await api('GET', '/api/me');
  if (me.ok && !me.authenticated) { sessionStorage.setItem('sysone_notice', 'Phiên đăng nhập đã hết hạn — vui lòng đăng nhập lại.'); location.reload(); return; }
  loginRoot.hidden = true; appRoot.hidden = false;
  loading.error(`Không mở được văn phòng: ${err.message}`);
});
