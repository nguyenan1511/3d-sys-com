// Bản lưu nén kiểu cũ (trước khi dữ liệu nằm thẳng trong các collection): cả file SQLite nén gzip, cắt mảnh trong collection
// "snapshots" — tài liệu đầu { _id, ver, parts, sha } + các mảnh { _id: `${id}:${ver}:${i}`, data }. Chỉ còn dùng để đọc
// lại MỘT LẦN khi chuyển sang các collection (server/memdb.js migrateIntoMongo).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const sha = b => crypto.createHash('sha256').update(b).digest('hex');

/** Tải bản lưu về file SQLite. store: { get(id) }. Trả về thông tin bản lưu, hoặc null nếu chưa có bản nào. */
export async function restore(store, id, file) {
  const head = await store.get(id);
  if (!head) return null;
  const parts = [];
  for (let i = 0; i < head.parts; i++) {
    const p = await store.get(`${id}:${head.ver}:${i}`);
    if (!p) throw new Error(`thiếu mảnh ${i}/${head.parts} của bản lưu ${head.ver}`);
    parts.push(Buffer.from(p.data?._bsontype === 'Binary' ? p.data.buffer : p.data));   // (Mongo trả về kiểu Binary)
  }
  const gz = Buffer.concat(parts);
  if (sha(gz) !== head.sha) throw new Error('bản lưu bị hỏng (sai mã kiểm tra)');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gunzipSync(gz), { mode: 0o600 });
  return { ver: head.ver, at: head.at };
}
