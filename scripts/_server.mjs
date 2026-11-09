// Chạy server thật (DB tạm, mật khẩu CEO ngẫu nhiên, không đọc .env) cho các script chụp ảnh/kiểm thử/đo hiệu năng.
import { spawn } from 'child_process';
import crypto from 'crypto';
import os from 'os';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');

export async function startServer(port, { demo = true } = {}) {
  const adminPw = crypto.randomBytes(12).toString('base64url');
  const env = { ...process.env, PORT: String(port), ENV_FILE: '/nonexistent', DB_PATH: path.join(os.tmpdir(), `sysone-script-${port}-${Date.now()}.db`), SESSION_SECRET: crypto.randomBytes(32).toString('hex'), ADMIN_INITIAL_PASSWORD: adminPw, ...(demo ? { SIM_EMPLOYEES_PATH: 'tests/fixtures/employees-demo.json' } : {}) };
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${url}/api/me`); if (r.ok) break; } catch { /* chưa sẵn sàng */ }
    if (child.exitCode !== null) throw new Error('Server dừng: ' + log);
    await new Promise(r => setTimeout(r, 200));
  }
  return {
    url, adminPw,
    /** Đăng nhập CEO cho context của page (cookie dùng chung với trang). */
    async loginAdmin(page) {
      const r = await page.request.post(`${url}/api/login/admin`, { data: { username: 'admin', password: adminPw } });
      if (!r.ok()) throw new Error('Không đăng nhập được CEO: ' + await r.text());
    },
    stop() { child.kill('SIGTERM'); }
  };
}
