import { describe, it, expect } from 'vitest';
import { parseSeatingCsv, applySeating, validateStaff } from '../src/model/staff.js';
import { setup, readJson } from './helpers.js';

describe('nhập CSV chỗ ngồi', () => {
  it('đọc tiêu đề, dấu ; và tên có dấu', () => {
    const r = parseSeatingCsv('Nhân viên;Mã bàn\nNV01;T2-17\n"Nhân viên 02";T3-16\n');
    expect(r.rows.map(x => [x.employee, x.deskId])).toEqual([['NV01', 'T2-17'], ['Nhân viên 02', 'T3-16']]);
  });
  it('áp vào dữ liệu và kiểm tra lại', () => {
    const { model } = setup();
    const data = readJson('tests/fixtures/employees-demo.json');
    const r = applySeating(data, parseSeatingCsv('NV01,T2-17\nNV99,T2-18\n').rows);
    expect(r.errors.some(e => e.includes('NV99'))).toBe(true);
    const st = validateStaff(model, r.data);
    expect(st.errors).toEqual([]);
    expect(st.employees.find(e => e.id === 'NV01').deskId).toBe('T2-17');
  });
});
