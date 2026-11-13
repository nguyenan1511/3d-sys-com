// Đèn công ty (công tắc cạnh máy chấm công ở sảnh): bật đèn = văn phòng chuyển sang buổi tối, đèn các phòng sáng lên;
// tắt = ban ngày. Giống loa công ty: CEO luôn bật/tắt được và cấp/thu quyền cho từng nhân viên (employees.can_lights);
// trạng thái lưu ở world_state('lights') nên khởi động lại server vẫn giữ.
import { worldGet, worldSet } from './db.js';
export function canLights(store, actor) {
  if (!actor) return false;
  if (actor.kind === 'admin') return true;
  return !!store.db.employees.get(actor.code)?.can_lights;
}
export function lightsState(store) {
  const raw = worldGet(store.db, 'lights');
  try { const v = raw ? JSON.parse(raw) : null; return { on: !!v?.on, by: v?.by || '', at: v?.at || 0 }; } catch { return { on: false, by: '', at: 0 }; }
}
export function setLights(store, key, by, on) {
  const st = { on: !!on, by, at: Date.now() };
  worldSet(store.db, 'lights', JSON.stringify(st), key);
  return st;
}
export function setLightsPermission(store, code, allow) {
  return store.db.employees.update(code, { can_lights: allow ? 1 : 0 }) === 1;
}
export function lightsPermissions(store) {
  return store.db.employees.where(r => r.can_lights).map(r => r.code);
}
