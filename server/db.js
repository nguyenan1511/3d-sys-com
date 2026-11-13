// Dữ liệu server: bảng trong bộ nhớ + lưu lên MongoDB / file JSON (server/memdb.js). Bảng: employees, seats, admins, sessions,
// login_failures, world_state, audit, attendance, chat_messages.
import { MemDB } from './memdb.js';
export { openData } from './memdb.js';

/** Dữ liệu chỉ trong bộ nhớ (kiểm thử). Server chạy thật dùng openData(config). */
export function openDb() { return new MemDB(); }

export function audit(db, actor, action, target = null, detail = null) {
  db.audit.insert({ ts: Date.now(), actor, action, target, detail: detail == null ? null : JSON.stringify(detail) });
}

/** Trạng thái chung của văn phòng (world_state): rèm, loa, đèn… — đọc giá trị (chuỗi) hoặc undefined. */
export function worldGet(db, key) { return db.world_state.get(key)?.value; }
export function worldSet(db, key, value, by = null) { db.world_state.upsert({ key, value: String(value), updated_at: Date.now(), updated_by: by }); }
