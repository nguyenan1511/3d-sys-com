// API sao lưu database (chỉ CEO): xem danh sách, sao lưu ngay, tải một bản về máy.
import path from 'node:path';
import { audit } from '../db.js';
import { rateLimit } from '../http.js';
import { HttpError } from '../store.js';
import { backupDir, listBackups, backupNow, isBackupName } from '../backup.js';

export function backupRoutes(api, { db, config, guards: { needAdmin } }) {
  const dir = backupDir(config);
  const limit = rateLimit('backup', { max: 6, windowMs: 60e3, methods: ['POST'] });
  api.get('/admin/backups', needAdmin, (_req, res) => res.json({ backups: listBackups(dir), keep: +(process.env.BACKUP_KEEP || 14), enabled: !!dir }));
  api.post('/admin/backups', needAdmin, limit, (req, res) => {
    if (!dir) throw new HttpError(400, 'Database đang chạy trong bộ nhớ, không sao lưu được.', { code: 'unavailable' });
    const b = backupNow(db, dir);
    audit(db, req.actor.key, 'admin.backup', b.name);
    res.json({ ok: true, backup: b });
  });
  api.get('/admin/backups/:name', needAdmin, (req, res, next) => {
    const name = req.params.name;
    if (!dir || !isBackupName(name) || !listBackups(dir).some(b => b.name === name)) throw new HttpError(404, 'Không có bản sao lưu này.', { code: 'not_found' });
    audit(db, req.actor.key, 'admin.backup.download', name);
    res.download(path.join(dir, name), name, err => err && !res.headersSent && next(err));
  });
}
