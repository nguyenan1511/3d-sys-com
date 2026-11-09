// Điểm vào: kiểm tra phiên ở server; chưa đăng nhập thì chỉ hiện màn hình đăng nhập,
// cảnh 3D và dữ liệu bố cục chỉ được tải sau khi đăng nhập thành công.
import { api } from './net/api.js';
import { showLogin } from './auth/login.js';

const loginRoot = document.getElementById('login');
const appRoot = document.getElementById('appRoot');

async function boot(notice) {
  const me = await api('GET', '/api/me');
  if (!me.ok || !me.authenticated) {
    appRoot.hidden = true;
    showLogin(loginRoot, { notice, onSuccess: () => boot() });
    return;
  }
  loginRoot.hidden = true; loginRoot.innerHTML = '';
  appRoot.hidden = false;
  const { startApp } = await import('./main.js');
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
  loginRoot.hidden = false;
  loginRoot.textContent = `Không khởi động được: ${err.message}`;
});
