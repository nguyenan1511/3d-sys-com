// Hai chế độ văn phòng: Real SYS (mặt bằng thật, layout.real.json, bàn mã R…) và Office SYS (layout.json).
// Chỗ ngồi tách theo chế độ (mỗi người tối đa một chỗ ở mỗi chế độ), DB cũ được nâng cấp giữ nguyên dữ liệu,
// mặt bằng thật đi lại được: mọi bàn tới được từ sảnh, thang bộ chữ U nối đủ các tầng.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDb } from '../server/db.js';
import { Store, HttpError } from '../server/store.js';
import { buildModel } from '../src/model/layoutModel.js';
import { Navigator } from '../src/nav/grid.js';
import { modeOfDesk } from '../src/core/mode.js';
import { readJson } from './helpers.js';

const root = path.resolve(import.meta.dirname, '..');
const cfg = {
  layoutPath: path.join(root, 'public/data/layout.json'), realLayoutPath: path.join(root, 'src/data/layout.real.json'),
  equipmentPath: path.join(root, 'public/data/equipment.json'), appearancePath: path.join(root, 'public/data/appearance.json'),
  duplicatePolicy: 'online-or-name-mismatch', adminCanSitAnywhere: false
};
const admin = { kind: 'admin', key: 'admin:admin' };
const err = fn => { try { fn(); } catch (e) { if (e instanceof HttpError) return e; throw e; } return null; };

let store;
beforeEach(() => { store = new Store(openDb(':memory:'), { ...cfg }); store.loginEmployee('1151-An', () => false); });

describe('chỗ ngồi theo chế độ', () => {
  it('mã bàn: R… là Real SYS, còn lại là Office SYS', () => {
    expect(modeOfDesk('R1-01')).toBe('real'); expect(modeOfDesk('RM2-3')).toBe('real');
    expect(modeOfDesk('T1-01')).toBe('office'); expect(modeOfDesk('LT-01')).toBe('office');
  });
  it('server có bàn của cả hai chế độ', () => {
    const ids = new Set(store.listSeats().map(s => s.deskId));
    expect(ids.has('T1-01')).toBe(true); expect(ids.has('R1-01')).toBe(true); expect(ids.has('R3-46')).toBe(true);
  });
  it('mỗi người giữ một chỗ ở mỗi chế độ, nhận chỗ chế độ này không mất chỗ chế độ kia', () => {
    store.claim('1151', 'T1-01');
    store.claim('1151', 'R1-12');
    expect(store.seatOf('1151').desk_id).toBe('T1-01');
    expect(store.seatOf('1151', 'real').desk_id).toBe('R1-12');
    const v = store.employeeView(store.employee('1151'));
    expect(v.seat.deskId).toBe('T1-01'); expect(v.seatReal).toMatchObject({ deskId: 'R1-12', floor: 0 });
    // đổi chỗ trong cùng chế độ vẫn cần quyền
    expect(err(() => store.claim('1151', 'R1-13')).status).toBe(403);
    // ngồi chỗ Real SYS: vị trí theo mặt bằng thật
    const sit = store.checkSit({ kind: 'employee', code: '1151' }, 'R1-12');
    expect(sit.floor).toBe(0); expect(Number.isFinite(sit.x) && Number.isFinite(sit.z)).toBe(true);
  });
  it('khoá tài khoản / xoá nhân viên trả chỗ ở cả hai chế độ', () => {
    store.claim('1151', 'T1-01'); store.claim('1151', 'R2-05');
    store.adminUpdateEmployee(admin, '1151', { status: 'disabled' });
    expect(store.seatsOf('1151')).toHaveLength(0);
  });
  it('gán bàn bằng quản trị chỉ đổi chỗ trong cùng chế độ', () => {
    store.claim('1151', 'T1-01');
    store.adminAssign(admin, 'R3-01', '1151');
    expect(store.seatOf('1151').desk_id).toBe('T1-01'); expect(store.seatOf('1151', 'real').desk_id).toBe('R3-01');
  });
});

describe('Real SYS tắt (mặc định khi chạy server)', () => {
  it('server không nạp mặt bằng thật, không đụng chỗ R… đã có người (bật lại vẫn còn)', () => {
    const db = openDb(':memory:');
    const on = new Store(db, { ...cfg }); on.loginEmployee('1151-An', () => false); on.claim('1151', 'R1-12');
    const off = new Store(db, { ...cfg, realLayoutPath: null });
    expect(off.modelReal).toBeNull();
    expect(off.listSeats().some(s => s.deskId.startsWith('R'))).toBe(false);          // không gửi chỗ Real SYS cho client
    expect(off.employeeView(off.employee('1151')).seatReal).toBeNull();
    const back = new Store(db, { ...cfg });                                           // bật lại
    expect(back.seatOf('1151', 'real').desk_id).toBe('R1-12');
  });
});

describe('chỗ ngồi theo chế độ', () => {
  it('mỗi người tối đa một chỗ trong cùng một chế độ, được thêm một chỗ ở chế độ kia', () => {
    const db = openDb();
    db.employees.insert({ code: '2000', name: 'Bình', name_key: 'binh', created_at: 1 });
    for (const id of ['T1-02', 'T1-09', 'R1-01']) db.seats.insert({ desk_id: id, owner_code: null, locked: 0, equipment: null, in_layout: 1 });
    db.seats.update('T1-02', { owner_code: '2000' });
    expect(() => db.seats.update('T1-09', { owner_code: '2000' })).toThrow();
    db.seats.update('R1-01', { owner_code: '2000' });
    expect(db.seats.get('R1-01').owner_code).toBe('2000');
  });
});

describe('mặt bằng thật đi lại được', () => {
  const layout = readJson('src/data/layout.real.json'), model = buildModel(layout), nav = new Navigator(model);
  const lobby = { ...model.waypoints.lobby, f: 0 };
  it('46 chỗ mỗi tầng × 3 tầng, chỗ "1042" là R1-12', () => {
    for (const f of [0, 1, 2]) expect(model.desks.filter(d => d.floor === f)).toHaveLength(46);
    expect(layout.marked['1042']).toBe('R1-12');
  });
  it('mọi bàn tới được từ sảnh (qua thang bộ khi khác tầng)', () => {
    const bad = [];
    for (const d of model.desks) {
      const r = nav.path(lobby, { x: d.seat.x, z: d.seat.z, f: d.floor }), end = r?.points.at(-1);
      if (!r || Math.hypot(end.x - d.seat.x, end.z - d.seat.z) > 0.6) bad.push(d.id);
    }
    expect(bad).toEqual([]);
  });
  it('thang bộ chữ U: lên sân thượng đi qua chiếu nghỉ, độ cao liền mạch', () => {
    const r = nav.path(lobby, { x: 1.5, z: -6, f: 3 });
    expect(r).toBeTruthy();
    expect(model.stairs.map(s => [s.from, s.to])).toEqual([[0, 1], [1, 2], [2, 3]]);
    const st = model.stairs[0], ys = [];
    for (const fl of st.flights) for (let k = 0; k <= 10; k++) {
      const x = fl.x0 + (fl.x1 - fl.x0) * (fl.rise === '+x' ? k / 10 : 1 - k / 10), z = (fl.z0 + fl.z1) / 2;
      ys.push(model.stairHeight(st, x, z));
    }
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThan(-0.12); // (chỉ lên, không tụt bậc)
    expect(ys[0]).toBeLessThan(st.yFrom + 0.3); expect(ys.at(-1)).toBeGreaterThan(st.yTo - 0.05);
  });
});
