import fs from 'fs';
import path from 'path';
import { buildModel } from '../src/model/layoutModel.js';
import { Navigator } from '../src/nav/grid.js';
import { validateStaff } from '../src/model/staff.js';

const root = path.resolve(import.meta.dirname, '..');
export const readJson = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

export function setup(empData) {
  const layout = readJson('public/data/layout.json');
  const model = buildModel(layout);
  const nav = new Navigator(model);
  const staff = validateStaff(model, empData || readJson('tests/fixtures/employees-demo.json'));
  return { layout, model, nav, staff };
}

/** Danh sách nhân viên giả n người, lấp lần lượt các bàn. */
export function fakeStaff(model, n) {
  const base = readJson('tests/fixtures/employees-demo.json');
  const employees = [];
  for (let i = 0; i < n; i++) {
    const src = base.employees[i % base.employees.length];
    employees.push({ ...src, id: `X${String(i + 1).padStart(2, '0')}`, name: `Thử ${i + 1}`, deskId: model.desks[i] ? model.desks[i].id : undefined });
  }
  return { ...base, employees };
}
