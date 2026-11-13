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
}

export class MongoBlobs {
  constructor(col) { this.col = col; }
  async put(id, data, type) { await this.col.replaceOne({ _id: String(id) }, { _id: String(id), data: Buffer.from(data), type, size: data.length, at: Date.now() }, { upsert: true }); }
  async get(id) {
    const d = await this.col.findOne({ _id: String(id) }); if (!d) return null;
    const b = d.data; return { data: Buffer.isBuffer(b) ? b : Buffer.from(b.buffer ?? b), type: d.type || '' };
  }
  async del(id) { await this.col.deleteOne({ _id: String(id) }); }
}
