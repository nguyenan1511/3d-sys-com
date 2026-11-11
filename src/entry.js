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
import { showLogin } from './auth/login.js';

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

async function boot(notice) {
  const me = await api('GET', '/api/me');
  if (me.status === 0) { // không kết nối được máy chủ (mất mạng / máy chủ đang khởi động lại)
    appRoot.hidden = false; loginRoot.hidden = true;
    loading.error('Không kết nối được máy chủ.', { hint: 'Kiểm tra kết nối mạng. Máy chủ có thể đang khởi động lại — đợi vài giây rồi bấm Thử lại.' });
    return;
  }
  if (!me.ok || !me.authenticated) {
    appRoot.hidden = true;
    showLogin(loginRoot, { notice, onSuccess: () => boot() });
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
      await api('POST', '/api/logout', {});
      sessionStorage.setItem('sysone_notice', reason || 'Bạn đã đăng xuất.');
      location.reload();
    }
  });
}

const notice = sessionStorage.getItem('sysone_notice');
sessionStorage.removeItem('sysone_notice');
boot(notice).catch(err => {
  console.error(err);
  loginRoot.hidden = true; appRoot.hidden = false;
  loading.error(`Không mở được văn phòng: ${err.message}`);
});
