// Nhân vật đã chọn được lưu theo tài khoản (server), vào lại không phải chọn lại; nhân vật không còn trong bộ thì mời chọn lại.
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { openDb } from '../server/db.js';
import { Store } from '../server/store.js';

const root = path.resolve(import.meta.dirname, '..');
const cfg = { layoutPath: path.join(root, 'public/data/layout.json'), realLayoutPath: path.join(root, 'src/data/layout.real.json'), equipmentPath: path.join(root, 'public/data/equipment.json'), appearancePath: path.join(root, 'public/data/appearance.json'), duplicatePolicy: 'online-or-name-mismatch', adminCanSitAnywhere: false };
const me = { kind: 'employee', code: '1151', key: 'employee:1151' };
let store;
beforeEach(() => { store = new Store(openDb(':memory:'), { ...cfg }); store.loginEmployee('1151-An', () => false); store.loginEmployee('1152-Bình', () => false); });

describe('lưu nhân vật theo tài khoản', () => {
  it('chưa chọn: look = null (giao diện mời chọn); chọn rồi: đăng nhập lại vẫn còn', () => {
    expect(store.employeeView(store.employee('1151')).look).toBeNull();
    store.setLook(me, '1151', { model: 'mo-nu' });
    const again = store.loginEmployee('1151-An', () => false);
    expect(again.code).toBe('1151');
    expect(store.employeeView(store.employee('1151')).look).toMatchObject({ model: 'mo-nu' });
  });
  it('mã nhân vật không hợp lệ khi lưu: báo lỗi, giữ lựa chọn cũ', () => {
    store.setLook(me, '1151', { model: 'mo-nam' });
    expect(() => store.setLook(me, '1151', { model: 'khong-co' })).toThrow();
    expect(store.lookOf('1151').model).toBe('mo-nam');
  });
  it('nhân vật đã lưu bị gỡ khỏi bộ nhân vật: đánh dấu mời chọn lại; người khác giữ nguyên', () => {
    store.setLook(me, '1151', { model: 'mo-nam' });
    store.setLook({ kind: 'employee', code: '1152', key: 'employee:1152' }, '1152', { model: 'mo-nu' });
    store.db.prepare('UPDATE employees SET look = ? WHERE code = ?').run(JSON.stringify({ model: 'vrm-cu', topColor: '#112233' }), '1151');
    store.migrateLooks();
    expect(store.lookOf('1151')).toMatchObject({ model: 'mo-nam', _repick: true }); // (vẫn hiển thị được trong lúc chờ chọn lại)
    expect(store.lookOf('1152').model).toBe('mo-nu'); expect(store.lookOf('1152')._repick).toBeUndefined();
  });
});
