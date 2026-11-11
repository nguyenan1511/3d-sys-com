// Đèn công ty (công tắc cạnh máy chấm công ở sảnh): bật đèn = văn phòng chuyển sang buổi tối, đèn các phòng sáng lên;
// tắt = ban ngày. Giống loa công ty: CEO luôn bật/tắt được và cấp/thu quyền cho từng nhân viên (employees.can_lights);
// trạng thái lưu ở world_state('lights') nên khởi động lại server vẫn giữ.
export function migrateLights(db) {
  const cols = db.prepare('PRAGMA table_info(employees)').all().map(c => c.name);
  if (!cols.includes('can_lights')) db.exec('ALTER TABLE employees ADD COLUMN can_lights INTEGER NOT NULL DEFAULT 0');
}
export function canLights(store, actor) {
  if (!actor) return false;
  if (actor.kind === 'admin') return true;
  return !!store.db.prepare('SELECT can_lights FROM employees WHERE code = ?').get(actor.code)?.can_lights;
}
export function lightsState(store) {
  const r = store.db.prepare("SELECT value FROM world_state WHERE key = 'lights'").get();
  try { const v = r ? JSON.parse(r.value) : null; return { on: !!v?.on, by: v?.by || '', at: v?.at || 0 }; } catch { return { on: false, by: '', at: 0 }; }
}
export function setLights(store, key, by, on) {
  const st = { on: !!on, by, at: Date.now() };
  store.db.prepare('INSERT INTO world_state (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
    .run('lights', JSON.stringify(st), st.at, key);
  return st;
}
export function setLightsPermission(store, code, allow) {
  return store.db.prepare('UPDATE employees SET can_lights = ? WHERE code = ?').run(allow ? 1 : 0, code).changes === 1;
}
export function lightsPermissions(store) {
  return store.db.prepare('SELECT code FROM employees WHERE can_lights = 1').all().map(r => r.code);
}
