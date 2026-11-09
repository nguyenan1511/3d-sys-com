// Kiểm thử đăng nhập / chỗ ngồi chạy thật trên server + trình duyệt (nhiều context).
// Mỗi lần chạy: DB tạm mới, mật khẩu CEO ngẫu nhiên (không ghi mật khẩu vào repo), không đọc .env.
import { defineConfig } from '@playwright/test';
import crypto from 'crypto';
import os from 'os';
import path from 'path';

const PORT = 5320;
process.env.E2E_ADMIN_PW ||= crypto.randomBytes(12).toString('base64url');
process.env.E2E_DB ||= path.join(os.tmpdir(), `sysone-e2e-${Date.now()}.db`);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,               // các file chạy lần lượt theo tên; file khóa đăng nhập CEO chạy cuối
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
  },
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning server/index.js',
    url: `http://localhost:${PORT}/api/me`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT), ENV_FILE: '/nonexistent', DB_PATH: process.env.E2E_DB,
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      ADMIN_INITIAL_PASSWORD: process.env.E2E_ADMIN_PW,
      DUPLICATE_POLICY: 'online-or-name-mismatch', ADMIN_CAN_SIT_ANYWHERE: 'false', ONLINE_GRACE_MS: '4000'
    }
  }
});
