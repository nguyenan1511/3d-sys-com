// Công tắc đèn công ty (cạnh máy chấm công) và nhà vệ sinh (buồng có khoá, gương soi được).
import { test, expect } from '@playwright/test';
import { uniqueCode, loginEmployeeUI, waitScene, newPage, closeAll, finishAvatar, call, loginAdminAPI } from './helpers.js';

test.afterEach(closeAll);
test.setTimeout(240_000);

const pressE = p => p.evaluate(() => window.__app.session.player.onKey({ key: 'e', type: 'keydown', repeat: false, preventDefault() {}, stopPropagation() {} }));
const goTo = (p, where) => p.evaluate(w => {
  const s = window.__app.session, a = s.player.agent, pt = w === 'switch' ? s.lights.spot.stand : w === 'sink' ? s.wc.sink : s.wc.stalls[0].out;
  Object.assign(a, { x: pt.x, z: pt.z, y: window.__app.app.model.floorY(0), f: 0 }); s.player.follow();
}, where);
const prompt = p => p.evaluate(() => document.getElementById('hudPrompt')?.textContent || '');

test('đèn công ty: chỉ người được CEO cấp quyền mới bật được; bật đèn thì cả công ty chuyển sang buổi tối', async ({ browser }) => {
  const ca = uniqueCode();
  const a = await newPage(browser); await loginEmployeeUI(a, `${ca}-Lan`); await waitScene(a); await finishAvatar(a);
  const b = await newPage(browser); await loginEmployeeUI(b, `${uniqueCode()}-Hoa`); await waitScene(b); await finishAvatar(b);
  await goTo(a, 'switch');
  await expect.poll(() => prompt(a)).toContain('công tắc đèn');
  await pressE(a);
  await expect(a.locator('.light-pop .lp-toggle')).toBeDisabled();
  await expect(a.locator('.light-pop .lp-deny')).toBeVisible();
  // CEO cấp quyền → nút bật được ngay (không cần tải lại)
  const ceo = await newPage(browser); await loginAdminAPI(ceo);
  expect((await call(ceo, 'POST', `/api/admin/lights/${ca}`, { allow: true })).status).toBe(200);
  await expect(a.locator('.light-pop .lp-toggle')).toBeEnabled({ timeout: 15_000 });
  await a.click('.light-pop .lp-toggle');
  await expect.poll(() => b.evaluate(() => window.__app.session.lights.state.on), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => b.evaluate(() => window.__app.app.__night.want)).toBe(1);
  await a.click('.light-pop .lp-toggle');
  await expect.poll(() => b.evaluate(() => window.__app.session.lights.state.on), { timeout: 15_000 }).toBe(false);
});

test('nhà vệ sinh: buồng có người thì người khác bị quát, không vào được; soi gương ở bồn rửa tay', async ({ browser }) => {
  const a = await newPage(browser); await loginEmployeeUI(a, `${uniqueCode()}-Minh`); await waitScene(a); await finishAvatar(a);
  const b = await newPage(browser); await loginEmployeeUI(b, `${uniqueCode()}-Tú`); await waitScene(b); await finishAvatar(b);
  await goTo(a, 'stall');
  await expect.poll(() => prompt(a)).toContain('vào buồng');
  await pressE(a);
  await expect.poll(() => a.evaluate(() => window.__app.session.wc.inside)).toBe(0);
  await expect(a.locator('.wc-card')).toBeVisible();
  await goTo(b, 'stall');
  await expect.poll(() => prompt(b), { timeout: 15_000 }).toContain('gõ cửa');
  await pressE(b);
  await expect(b.locator('#toast')).toContainText('😡', { timeout: 10_000 });
  expect(await b.evaluate(() => window.__app.session.wc.inside)).toBe(-1);
  await a.click('.wc-card button');
  await expect.poll(() => b.evaluate(() => window.__app.session.wc.state.stalls[0]), { timeout: 20_000 }).toBe(null);
  // soi gương: góc nhìn vào gương, gương phản chiếu bật; Esc là thôi
  await goTo(b, 'sink');
  await expect.poll(() => prompt(b)).toContain('soi gương');
  await pressE(b);
  await expect.poll(() => b.evaluate(() => !!window.__app.session.wc.looking && window.__app.app.scene.getObjectByName('wcMirror')?.visible)).toBe(true);
  await b.evaluate(() => window.__app.session.player.onKey({ key: 'Escape', type: 'keydown', repeat: false, preventDefault() {} }));
  await expect.poll(() => b.evaluate(() => window.__app.session.wc.looking)).toBe(null);
});
