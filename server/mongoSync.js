// Giữ dữ liệu khi server mất ổ đĩa (Render gói miễn phí: mỗi lần khởi động lại / ngủ dậy / deploy là database trống).
// Server vẫn chạy SQLite như cũ; module này chỉ sao lưu nguyên file database lên MongoDB (Atlas M0 miễn phí):
//   • khởi động: tải bản mới nhất từ Mongo về TRƯỚC khi mở SQLite (không tải được thì dừng hẳn — để Render thử lại — thay
//     vì chạy với database trống rồi đè mất dữ liệu thật);
//   • đang chạy: có thay đổi thì ~15 giây sau đẩy bản chép (VACUUM INTO, nén gzip) lên; dồn nhiều thay đổi thành một lần;
//   • tắt server (Render gửi SIGTERM khi cho ngủ / deploy): đẩy lần cuối rồi mới thoát.
// Lưu dạng: tài liệu đầu { _id: id, ver, parts, size, sha, at } + các mảnh { _id: `${id}:${ver}:${i}`, data } (≤ 8 MB/mảnh,
// dưới giới hạn 16 MB của Mongo). Ghi mảnh trước, đổi tài liệu đầu sau, xoá mảnh cũ cuối cùng: đang ghi dở mà server tắt
// thì bản cũ vẫn nguyên vẹn.
// Bật: MONGODB_URI (chỉ khi chạy production; máy dev muốn thử thì đặt thêm MONGO_SYNC=1 — tránh dữ liệu máy dev đè lên
// dữ liệu thật). MONGODB_SNAPSHOT_ID đổi tên bản lưu (mặc định "sysone"), MONGODB_DB tên database (mặc định "sysone").
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const PART = 8 * 1024 * 1024;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Kho trên MongoDB (tách riêng để kiểm thử bằng kho giả cùng giao diện get / put / del). */
export async function mongoStore(uri, dbName = 'sysone') {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, appName: 'sysone-office' });
  await client.connect();
  const col = client.db(dbName).collection('snapshots');
  return {
    get: id => col.findOne({ _id: id }),
    put: doc => col.replaceOne({ _id: doc._id }, doc, { upsert: true }),
    del: ids => ids.length ? col.deleteMany({ _id: { $in: ids } }) : null,
    close: () => client.close()
  };
}

/** Tải bản lưu về file (ghi đè database trên máy). Trả về thông tin bản lưu, hoặc null nếu Mongo chưa có bản nào. */
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
  const raw = zlib.gunzipSync(gz);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.before-restore`);   // (phòng khi cần xem lại bản trên máy)
  for (const ext of ['-wal', '-shm']) fs.rmSync(file + ext, { force: true });
  const tmp = `${file}.restore-tmp`;
  fs.writeFileSync(tmp, raw, { mode: 0o600 }); fs.renameSync(tmp, file);
  return { ver: head.ver, size: raw.length, at: head.at };
}

/** Chép database đang chạy (nhất quán) rồi đẩy lên. Bỏ qua nếu nội dung không đổi so với lần đẩy trước. */
export async function push(store, id, db, file, last = {}) {
  const tmp = `${file}.sync-tmp`;
  fs.rmSync(tmp, { force: true });
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const raw = fs.readFileSync(tmp); fs.rmSync(tmp, { force: true });
  const gz = zlib.gzipSync(raw, { level: 6 }), h = sha(gz);
  if (h === last.sha) return { ...last, skipped: true };
  const ver = Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), n = Math.max(1, Math.ceil(gz.length / PART));
  for (let i = 0; i < n; i++) await store.put({ _id: `${id}:${ver}:${i}`, data: Buffer.from(gz.subarray(i * PART, (i + 1) * PART)) });
  const prev = await store.get(id);
  await store.put({ _id: id, ver, parts: n, size: raw.length, gz: gz.length, sha: h, at: Date.now() });
  if (prev && prev.ver !== ver) await store.del(Array.from({ length: prev.parts }, (_, i) => `${id}:${prev.ver}:${i}`));
  return { ver, sha: h, size: raw.length, gz: gz.length, at: Date.now() };
}

export const syncEnabled = config => !!config.mongodbUri && config.dbPath !== ':memory:' && (config.production || process.env.MONGO_SYNC === '1');

/**
 * Khởi động đồng bộ (gọi TRƯỚC khi mở SQLite): tải bản lưu về. Trả về đối tượng { start(db), flush(), stop(), status }.
 * Không bật (thiếu MONGODB_URI…) thì trả về đối tượng rỗng: mọi hàm không làm gì.
 */
export async function initSync(config, { log = console, store: given = null, delay = 15000, tick = 5000 } = {}) {
  const status = { enabled: false, restoredAt: null, lastPushAt: null, lastError: null };
  if (!given && !syncEnabled(config)) {
    if (config.mongodbUri && !config.production) log.log('[mongo] Có MONGODB_URI nhưng đang chạy dev: không đồng bộ (đặt MONGO_SYNC=1 nếu muốn thử).');
    return { status, start() {}, async flush() {}, stop() {} };
  }
  status.enabled = true;
  const id = config.mongoSnapshotId || 'sysone', file = config.dbPath;
  let store = given;
  // tải bản lưu: thử lại vài lần (Atlas đang khởi động / mạng chập chờn); vẫn lỗi thì dừng server
  for (let k = 1; ; k++) {
    try {
      store ||= await mongoStore(config.mongodbUri, config.mongoDbName || 'sysone');
      const r = await restore(store, id, file);
      if (r) { status.restoredAt = r.at; log.log(`[mongo] Đã tải dữ liệu từ MongoDB (${Math.round(r.size / 1024)} KB, lưu lúc ${new Date(r.at).toISOString()}).`); }
      else log.log('[mongo] MongoDB chưa có bản lưu: dùng database trên máy, sẽ đẩy lên sau khi khởi động.');
      break;
    } catch (e) {
      status.lastError = e.message;
      if (k >= 5) { log.error(`[mongo] Không tải được dữ liệu từ MongoDB: ${e.message}. Dừng server để không chạy với database trống.`); throw e; }
      log.warn(`[mongo] Lỗi tải dữ liệu (lần ${k}): ${e.message} — thử lại…`); await sleep(1500 * k);
    }
  }
  let db = null, timer = null, last = {}, seen = -1, dirtyAt = 0, busy = null;
  const changes = () => db.prepare('SELECT total_changes() AS n').get().n;
  const doPush = async () => {
    if (!db) return;
    if (busy) return busy;
    busy = (async () => {
      try {
        const n = changes(); last = await push(store, id, db, file, last); seen = n; dirtyAt = 0;
        status.lastPushAt = last.at; status.lastError = null;
        if (!last.skipped) log.log(`[mongo] Đã lưu lên MongoDB (${Math.round(last.size / 1024)} KB, nén ${Math.round(last.gz / 1024)} KB).`);
      } catch (e) { status.lastError = e.message; log.warn(`[mongo] Lưu lên MongoDB lỗi: ${e.message} (sẽ thử lại)`); }
      finally { busy = null; }
    })();
    return busy;
  };
  return {
    status,
    /** Bắt đầu theo dõi thay đổi của database đã mở. */
    start(d) {
      db = d; seen = -1;
      timer = setInterval(() => {
        if (busy) return;
        const n = changes(); if (n === seen) return;
        const now = Date.now(); if (!dirtyAt) dirtyAt = now;
        if (now - dirtyAt >= delay) doPush();
      }, tick);
      timer.unref?.();
    },
    /** Đẩy ngay (khi tắt server). */
    async flush() { if (db && changes() !== seen) await doPush(); else if (busy) await busy; },
    stop() { clearInterval(timer); db = null; store?.close?.().catch?.(() => {}); }
  };
}
