// Sao lưu database tự động: mỗi đêm (sau 2 giờ sáng giờ Việt Nam) chép toàn bộ SQLite ra một file riêng bằng
// VACUUM INTO (bản chép nhất quán, chạy được khi server đang hoạt động), giữ BACKUP_KEEP bản gần nhất (mặc định 14).
// Thư mục: BACKUP_DIR hoặc <thư mục chứa database>/backups. CEO xem danh sách, sao lưu ngay, tải về trong Bảng quản trị.
import fs from 'node:fs';
import path from 'node:path';

const NAME = /^sysone-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.db$/;
const VN = 7 * 3600e3;

export function backupDir(config) {
  if (config.dbPath === ':memory:') return null;
  return process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(path.dirname(config.dbPath), 'backups');
}
export const isBackupName = n => NAME.test(String(n || ''));

/** Danh sách bản sao lưu, mới nhất trước. */
export function listBackups(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(isBackupName).map(name => {
    const st = fs.statSync(path.join(dir, name)); return { name, size: st.size, ts: st.mtimeMs };
  }).sort((a, b) => b.ts - a.ts);
}

/** Sao lưu ngay. Trả về { name, size, ts }. */
export function backupNow(db, dir, keep = +(process.env.BACKUP_KEEP || 14)) {
  if (!dir) throw new Error('Database đang chạy trong bộ nhớ, không sao lưu được.');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date(Date.now() + VN).toISOString().replace(/T(\d\d):(\d\d).*/, '-$1$2');
  let name = `sysone-${stamp}.db`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `sysone-${stamp}-${i}.db`;
  const file = path.join(dir, name);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  try { fs.chmodSync(file, 0o600); } catch { /* (Windows) */ }
  for (const old of listBackups(dir).slice(Math.max(1, keep))) fs.rmSync(path.join(dir, old.name), { force: true });
  const st = fs.statSync(file); return { name, size: st.size, ts: st.mtimeMs };
}

/** Lịch tự sao lưu: kiểm tra mỗi 30 phút; chưa có bản nào trong 20 giờ qua và đã qua 2 giờ sáng (hoặc chưa từng sao lưu) thì sao lưu. */
export function scheduleBackups(db, dir, log = console) {
  if (!dir || process.env.VITEST || process.env.BACKUP_DISABLED === '1') return () => {};
  const tick = () => {
    try {
      const last = listBackups(dir)[0], hour = new Date(Date.now() + VN).getUTCHours();
      if (last && Date.now() - last.ts < 20 * 3600e3) return;
      if (last && hour < 2) return;
      const b = backupNow(db, dir); log.log(`[sao lưu] đã tạo ${b.name} (${Math.round(b.size / 1024)} KB)`);
    } catch (e) { log.error('[sao lưu] lỗi:', e.message); }
  };
  const first = setTimeout(tick, 10e3), timer = setInterval(tick, 30 * 60e3);
  first.unref?.(); timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
