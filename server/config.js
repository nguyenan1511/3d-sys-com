// Cấu hình từ .env (process.loadEnvFile có sẵn trong Node ≥ 20.12).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
const envFile = process.env.ENV_FILE || path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const bool = (v, d) => v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v);
const env = process.env;

export const config = {
  port: +(env.PORT || 5310),
  host: env.HOST || '0.0.0.0',
  production: env.NODE_ENV === 'production',
  dbPath: env.DB_PATH === ':memory:' ? ':memory:' : path.resolve(ROOT, env.DB_PATH || 'data/sysone.db'),
  sessionSecret: env.SESSION_SECRET || '',
  duplicatePolicy: env.DUPLICATE_POLICY === 'strict' ? 'strict' : 'online-or-name-mismatch',
  adminCanSitAnywhere: bool(env.ADMIN_CAN_SIT_ANYWHERE, false),
  adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || '',
  cookieSecure: bool(env.COOKIE_SECURE, env.NODE_ENV === 'production'),
  layoutPath: path.resolve(ROOT, env.LAYOUT_PATH || 'public/data/layout.json'),
  equipmentPath: path.resolve(ROOT, env.EQUIPMENT_PATH || 'public/data/equipment.json'),
  appearancePath: path.resolve(ROOT, env.APPEARANCE_PATH || 'public/data/appearance.json'),
  // nhân viên mô phỏng (mặc định public/data/employees.json, hiện để trống); script kiểm thử trỏ sang dữ liệu demo
  simEmployeesPath: env.SIM_EMPLOYEES_PATH ? path.resolve(ROOT, env.SIM_EMPLOYEES_PATH) : null,
  employeeSessionHours: +(env.EMPLOYEE_SESSION_HOURS || 24 * 7),
  adminSessionHours: +(env.ADMIN_SESSION_HOURS || 12),
  onlineGraceMs: +(env.ONLINE_GRACE_MS || 30000),
  loginWindowMin: 15,
  loginMaxFailures: 5
};

if (!config.sessionSecret) {
  if (config.production) { console.error('Thiếu SESSION_SECRET trong .env'); process.exit(1); }
  // dev: lưu khoá tạm ra file (data/.dev-session-secret, quyền 600) để server tự khởi động lại khi sửa code không làm mất phiên
  const f = config.dbPath === ':memory:' || env.ENV_FILE === '/nonexistent' ? null : path.join(path.dirname(config.dbPath), '.dev-session-secret');
  try { if (f && fs.existsSync(f)) config.sessionSecret = fs.readFileSync(f, 'utf8').trim(); } catch { /* đọc lỗi: tạo khoá mới */ }
  if (!config.sessionSecret) {
    config.sessionSecret = crypto.randomBytes(32).toString('hex');
    try { if (f) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, config.sessionSecret, { mode: 0o600 }); } } catch { /* không ghi được: chỉ dùng khoá tạm */ }
  }
  console.warn('[cảnh báo] Chưa đặt SESSION_SECRET (dev): dùng khoá trong data/.dev-session-secret. Production bắt buộc đặt SESSION_SECRET trong .env.');
}
