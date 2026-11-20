// Nội dung file tải lên (tài liệu cuộc họp): không nằm trong bảng bộ nhớ (server/memdb.js) để RAM không phình theo số file.
//  • MongoDB: collection "blobs" — mỗi file một tài liệu { _id, data: Binary, type, size, at } (file ≤ 5 MB, dưới giới hạn 16 MB).
//  • File: thư mục data/files (máy dev).  • Bộ nhớ: kiểm thử.
// API chung: put(id, buffer, type), get(id) → { data: Buffer, type } | null, del(id).
import fs from 'node:fs';
import path from 'node:path';

const safe = id => String(id).replace(/[^\w.-]/g, '_');

export class MemBlobs {
  constructor() { this.m = new Map(); }
  async put(id, data, type) { this.m.set(String(id), { data: Buffer.from(data), type }); }
  async get(id) { return this.m.get(String(id)) || null; }
  async del(id) { this.m.delete(String(id)); }
  async sizes() { return [...this.m].map(([k, v]) => [k, v.data.length]); }
}

export class FileBlobs {
  constructor(dir) { this.dir = dir; }
  async put(id, data, type) {
    await fs.promises.mkdir(this.dir, { recursive: true });
    const f = path.join(this.dir, safe(id));
    await fs.promises.writeFile(`${f}.tmp`, data, { mode: 0o600 }); await fs.promises.rename(`${f}.tmp`, f);
    await fs.promises.writeFile(`${f}.type`, String(type || ''), { mode: 0o600 });
  }
  async get(id) {
    const f = path.join(this.dir, safe(id));
    try { return { data: await fs.promises.readFile(f), type: await fs.promises.readFile(`${f}.type`, 'utf8').catch(() => '') }; } catch { return null; }
  }
  async del(id) { const f = path.join(this.dir, safe(id)); await Promise.all([f, `${f}.type`].map(x => fs.promises.rm(x, { force: true }))); }
  async sizes() {
    const names = await fs.promises.readdir(this.dir).catch(() => []), out = [];
    for (const n of names) if (!n.endsWith('.type') && !n.endsWith('.tmp')) out.push([n, (await fs.promises.stat(path.join(this.dir, n))).size]);
    return out;
  }
}

export class MongoBlobs {
  constructor(col) { this.col = col; }
  async put(id, data, type) { await this.col.replaceOne({ _id: String(id) }, { _id: String(id), data: Buffer.from(data), type, size: data.length, at: Date.now() }, { upsert: true }); }
  async get(id) {
    const d = await this.col.findOne({ _id: String(id) }); if (!d) return null;
    const b = d.data; return { data: Buffer.isBuffer(b) ? b : Buffer.from(b.buffer ?? b), type: d.type || '' };
  }
  async del(id) { await this.col.deleteOne({ _id: String(id) }); }
  async sizes() { return (await this.col.find({}, { projection: { size: 1 } }).toArray()).map(d => [String(d._id), d.size || 0]); }
}

/**
 * Hạn mức dung lượng tổng cho mọi file tải lên (tài liệu họp / dự án, ảnh bảng tin, ảnh bảng vẽ): Atlas M0 chỉ có 512 MB cho
 * cả database — đầy là mọi lệnh ghi đều lỗi. Đếm theo từng id (ghi đè thì tính phần chênh); bảng vẽ ('board:') luôn được ghi
 * (trạng thái đang vẽ) nhưng vẫn tính vào tổng. Quá hạn mức: lỗi { code: 'quota' } — các API báo 507 kèm lời nhắn rõ ràng.
 */
export class QuotaBlobs {
  constructor(inner, maxBytes) { this.inner = inner; this.max = maxBytes; this.sizes = new Map(); this.ids = new Map(); this.used = 0; }
  /** Nạp kích thước các file đang có (lúc khởi động). */
  async init() {
    try { for (const [id, n] of await this.inner.sizes?.() ?? []) this.track(id, n); }
    catch (e) { console.warn('[file] Không đọc được dung lượng đang dùng:', e.message); }
    return this;
  }
  // khoá đếm chuẩn hoá theo tên file trên đĩa (FileBlobs đổi ':' → '_') — cùng một file không bị đếm hai lần; ids: khoá → mã để xoá
  track(id, n) { id = String(id); const k = safe(id); this.used += n - (this.sizes.get(k) || 0); if (n) { this.sizes.set(k, n); this.ids.set(k, id); } else { this.sizes.delete(k); this.ids.delete(k); } }
  usage() { return { used: this.used, max: this.max, files: this.sizes.size }; }
  /** Danh sách file: [{ id (mã để xoá), key (chuẩn hoá), size }]. */
  list() { return [...this.sizes].map(([key, size]) => ({ id: this.ids.get(key) || key, key, size })); }
  /** Còn chỗ cho `n` byte mới không (để API báo lỗi trước khi nhận file). */
  room(n) { return this.used + n <= this.max; }
  async put(id, data, type) {
    id = String(id); const n = data.length, after = this.used - (this.sizes.get(safe(id)) || 0) + n;
    if (after > this.max && !id.startsWith('board:')) {
      const mb = x => Math.round(x / 1048576);
      throw Object.assign(new Error(`Bộ nhớ lưu file của công ty đã đầy (${mb(this.used)}/${mb(this.max)} MB). Nhờ Admin hoặc trưởng dự án xoá bớt tài liệu cũ rồi thử lại.`), { code: 'quota' });
    }
    await this.inner.put(id, data, type); this.track(id, n);
  }
  get(id) { return this.inner.get(id); }
  async del(id) { await this.inner.del(id); this.track(String(id), 0); }
}
