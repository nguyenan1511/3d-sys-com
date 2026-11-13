import fs from 'fs';
// Nghiệp vụ server (DB trong bộ nhớ): chính sách trùng mã, nhận chỗ nguyên tử, quyền ngồi, CSV, quy tắc chủ chỗ cho người mô phỏng.
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { openDb } from '../server/db.js';
import { Store, HttpError } from '../server/store.js';
import { hashPassword, verifyPassword } from '../server/security.js';
import { parseLogin } from '../src/shared/identity.js';
import { applySeatRules } from '../src/model/seatRules.js';
import { validateStaff } from '../src/model/staff.js';
import { readJson } from './helpers.js';

const root = path.resolve(import.meta.dirname, '..');
const baseCfg = { layoutPath: path.join(root, 'public/data/layout.json'), equipmentPath: path.join(root, 'public/data/equipment.json'), appearancePath: path.join(root, 'public/data/appearance.json'), duplicatePolicy: 'online-or-name-mismatch', adminCanSitAnywhere: false };
const admin = { kind: 'admin', key: 'admin:admin' };
const offline = () => false;
const err = fn => { try { fn(); } catch (e) { if (e instanceof HttpError) return e; throw e; } return null; };

let store;
beforeEach(() => { store = new Store(openDb(':memory:'), { ...baseCfg }); });

describe('mã đăng nhập', () => {
  it('chuẩn hóa NFC, khoảng trắng, gạch ngang', () => {
    expect(parseLogin('  1151 -  Nguyễn  An ')).toMatchObject({ ok: true, code: '1151', name: 'Nguyễn An', display: '1151-Nguyễn An' });
    for (const bad of ['', '1151', '115-An', '1151-', '1151-An1', 'ab12-An', '1151-An-B']) expect(parseLogin(bad).ok, bad).toBe(false);
  });
});

describe('chính sách trùng mã', () => {
  it('online-or-name-mismatch: online thì từ chối, khác tên từ chối, cùng tên vào lại', () => {
    store.loginEmployee('1151-An', offline);
    expect(err(() => store.loginEmployee('1151-An', () => true)).message).toMatch('đang được dùng ở nơi khác');
    expect(err(() => store.loginEmployee('1151-Bình', offline)).message).toMatch('tên khác');
    expect(store.loginEmployee('1151-AN', offline).created).toBe(false);
  });
  it('strict: mọi mã đã đăng ký đều bị từ chối', () => {
    const s = new Store(openDb(':memory:'), { ...baseCfg, duplicatePolicy: 'strict' });
    s.loginEmployee('2000-An', offline);
    expect(err(() => s.loginEmployee('2000-An', offline)).status).toBe(409);
  });
  it('bị vô hiệu hóa thì không vào được và chỗ trống lại', () => {
    store.loginEmployee('3000-An', offline); store.claim('3000', 'T2-01');
    store.adminUpdateEmployee(admin, '3000', { status: 'disabled' });
    expect(store.seatRow('T2-01').owner_code).toBe(null);
    expect(err(() => store.loginEmployee('3000-An', offline)).status).toBe(403);
  });
});

describe('chỗ ngồi', () => {
  it('chỉ chủ chỗ ngồi được; CEO cũng không, trừ khi ADMIN_CAN_SIT_ANYWHERE', () => {
    store.loginEmployee('1151-An', offline); store.loginEmployee('2222-Bình', offline);
    store.claim('1151', 'T2-01', { monitors: 2 });
    expect(err(() => store.checkSit({ kind: 'employee', code: '2222' }, 'T2-01')).message).toBe('Chỗ này thuộc về 1151-An');
    expect(err(() => store.checkSit(admin, 'T2-01')).message).toBe('Chỗ này thuộc về 1151-An');
    expect(store.checkSit({ kind: 'employee', code: '1151' }, 'T2-01').deskId).toBe('T2-01');
    const any = new Store(store.db, { ...baseCfg, adminCanSitAnywhere: true });
    expect(any.checkSit(admin, 'T2-01').deskId).toBe('T2-01');
  });
  it('nhận chỗ nguyên tử: người thứ hai bị từ chối, ràng buộc một người một chỗ', () => {
    store.loginEmployee('1111-A', offline); store.loginEmployee('2222-B', offline);
    store.claim('1111', 'T3-01');
    expect(err(() => store.claim('2222', 'T3-01')).status).toBe(409);
    expect(err(() => store.claim('1111', 'T3-02')).status).toBe(403); // đã có chỗ, chưa được phép đổi
    store.adminUpdateEmployee(admin, '1111', { canMove: true });
    store.claim('1111', 'T3-02');
    expect(store.seatRow('T3-01').owner_code).toBe(null);
    expect(store.employee('1111').can_move).toBe(0); // quyền đổi chỗ dùng một lần
  });
  it('dụng cụ sai bị từ chối; khóa chỗ chặn nhận và ngồi', () => {
    store.loginEmployee('1111-A', offline);
    expect(err(() => store.claim('1111', 'T2-02', { monitors: 4 })).status).toBe(400);
    store.adminLock(admin, 'T2-02', true);
    expect(err(() => store.claim('1111', 'T2-02')).message).toBe('Chỗ này đang bị khóa.');
  });
  it('bàn lấy từ layout.json: bàn bị bỏ khỏi layout thì trả chỗ', () => {
    store.loginEmployee('1111-A', offline); store.claim('1111', 'T2-03');
    store.model = { ...store.model, desks: store.model.desks.filter(d => d.id !== 'T2-03') };
    store.syncSeats();
    expect(store.seatOf('1111')).toBeUndefined();
    expect(store.listSeats().some(s => s.deskId === 'T2-03')).toBe(false);
  });
});

describe('tạo hình nhân vật', () => {
  it('lưu theo appearance.json (chọn nhân vật pixel), chặn giá trị lạ, chỉ sửa được nhân vật của mình', () => {
    store.loginEmployee('1151-An', offline); store.loginEmployee('2222-Bình', offline);
    const look = store.setLook({ kind: 'employee', code: '1151', key: 'emp:1151' }, '1151', { pixel: 'mo-dev', khac: 'x' });
    expect(look).toMatchObject({ pixel: 'mo-dev' });
    expect(look.khac).toBeUndefined();
    expect(store.employeeView(store.employee('1151')).look.pixel).toBe('mo-dev');
    expect(err(() => store.setLook({ kind: 'employee', code: '1151', key: 'emp:1151' }, '1151', { pixel: 'khong-co' })).status).toBe(400);
    expect(err(() => store.setLook({ kind: 'employee', code: '2222', key: 'emp:2222' }, '1151', {})).status).toBe(403);
  });
  it('CEO tạo trước nhân viên; người đó đăng nhập đúng mã-tên thì vào được', () => {
    store.adminCreateEmployee(admin, '4321-Mai Anh', 'Kế toán');
    expect(err(() => store.adminCreateEmployee(admin, '4321-Khác')).status).toBe(409);
    expect(store.loginEmployee('4321-mai anh', offline).created).toBe(false);
    expect(err(() => store.loginEmployee('4321-Mai', offline)).status).toBe(409);
  });
});

describe('danh mục nhân vật', () => {
  it('nhân vật 2D là nhân vật my-office có trong characters.json; một mặc định', () => {
    const chars = JSON.parse(fs.readFileSync(path.join(root, 'public/data/characters.json'), 'utf8')).characters;
    const item = store.appearance.items.find(i => i.key === 'pixel');
    for (const o of item.options) expect(chars.some(c => c.id === o.value && c.format === 'mo'), o.value).toBe(true);
    expect(item.options.some(o => o.value === item.default)).toBe(true);
  });
});

describe('CSV quản trị', () => {
  it('nhập tất cả-hoặc-không; xuất lại đúng', () => {
    store.loginEmployee('1111-A', offline); store.claim('1111', 'T2-01');
    const bad = err(() => store.importCsv(admin, 'ma,ten,phong_ban,trang_thai,ma_ban\n5000,Đào,Kế toán,,T2-05\n5001,Hà,,,T2-05\n'));
    expect(bad.status).toBe(400); expect(bad.extra.errors[0]).toMatch('T2-05');
    expect(store.employee('5000')).toBeUndefined(); // không đổi gì
    const ok = store.importCsv(admin, 'ma,ten,phong_ban,trang_thai,ma_ban\n5000,Đào,Kế toán,,T2-05\n1111,A,,,T2-06\n');
    expect(ok.updated).toBe(2);
    expect(store.seatOf('1111').desk_id).toBe('T2-06');
    expect(store.exportCsv()).toContain('5000,Đào,Kế toán,active,T2-05');
    expect(store.auditLog().some(a => a.action === 'admin.csv.import')).toBe(true);
  });
});

describe('mật khẩu', () => {
  it('scrypt có muối, không lưu chữ thường', async () => {
    const h = await hashPassword('mat-khau-thu');
    expect(h).toMatch(/^scrypt\$/); expect(h).not.toContain('mat-khau-thu');
    expect(await verifyPassword('mat-khau-thu', h)).toBe(true);
    expect(await verifyPassword('sai', h)).toBe(false);
    expect(await hashPassword('mat-khau-thu')).not.toBe(h);
  });
});

describe('người mô phỏng tuân theo chủ chỗ', () => {
  it('bàn có chủ thật thì người mô phỏng nhường bàn; hết bàn thì không vào mô hình', () => {
    const model = store.model, emp = readJson('tests/fixtures/employees-demo.json');
    const victim = emp.employees.find(e => e.deskId === 'T2-01');
    const seats = [{ deskId: 'T2-01', owner: { code: '1151', display: '1151-An' } }];
    const r = applySeatRules(model, emp, seats);
    const moved = r.data.employees.find(e => e.id === victim.id);
    expect(moved.deskId).not.toBe('T2-01');
    expect(validateStaff(model, r.data).errors).toEqual([]);
    // mọi bàn đều có chủ thật: không còn ai mô phỏng
    const all = model.desks.map(d => ({ deskId: d.id, owner: { code: 'x', display: 'x' } }));
    expect(applySeatRules(model, emp, all).data.employees.filter(e => e.deskId).length).toBe(0);
  });
});

describe('ngoại hình nhân vật', () => {
  it('ngoại hình lưu theo bộ nhân vật cũ (VRM, pixel cũ, kiểu áo) được đưa về lựa chọn hiện có', () => {
    const db = openDb(':memory:'), s0 = new Store(db, { ...baseCfg });
    const code = s0.loginEmployee('1152-Lan').code;
    db.employees.update(code, { look: JSON.stringify({ pixel: 'px-blue', model: 'vroid-boy', topStyle: 'jacket', topColor: '#ff7f50', hairColor: '#1d1a17' }) });
    const s = new Store(db, { ...baseCfg });
    const look = s.lookOf(code), models = s.appearance.items.find(i => i.key === 'model').options.map(o => o.value);
    expect(models).toContain(look.model);
    expect(look.model).toBe('mo-nam');
    expect(look.pixel).toBe('mo-nu');
    expect(look.topStyle).toBeUndefined();
    expect(look.hairColor).toBe('#1d1a17');           // màu còn hợp lệ thì giữ
    expect(look._repick).toBe(true);                   // nhân vật cũ không còn: lần vào sau mời chọn lại
    expect(new Store(db, { ...baseCfg }).lookOf(code)._repick).toBe(true); // (khởi động lại server vẫn giữ dấu)
    s.setLook({ kind: 'employee', code, key: `employee:${code}` }, code, { ...look, model: 'mo-nu' });
    expect(s.lookOf(code)._repick).toBeUndefined();   // chọn xong thì hết mời
  });
});
