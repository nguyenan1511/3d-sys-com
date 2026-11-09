// API qua HTTP thật (server Express trong tiến trình, DB trong bộ nhớ): đường dẫn /api/v1, lỗi chuẩn, quyền, kiểm tra dữ liệu,
// chấm công, chat, quyền bật nhạc, giới hạn tần suất, chống CSRF.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import path from 'path';
import { createApp } from '../server/app.js';
import { resetRateLimits } from '../server/http.js';

const root = path.resolve(import.meta.dirname, '..');
let srv, base, close;
beforeAll(async () => {
  const cfg = {
    port: 0, production: false, dbPath: ':memory:', sessionSecret: 'test-secret-'.padEnd(64, 'x'), duplicatePolicy: 'online-or-name-mismatch', adminCanSitAnywhere: false,
    adminInitialPassword: 'ceo-pass-123', cookieSecure: false, layoutPath: path.join(root, 'public/data/layout.json'), equipmentPath: path.join(root, 'public/data/equipment.json'),
    appearancePath: path.join(root, 'public/data/appearance.json'), simEmployeesPath: null, employeeSessionHours: 24, adminSessionHours: 12, onlineGraceMs: 0, loginWindowMin: 15, loginMaxFailures: 5
  };
  const r = await createApp(cfg);
  r.app.use(r.finish);
  srv = http.createServer(r.app); await new Promise(res => srv.listen(0, '127.0.0.1', res));
  base = `http://127.0.0.1:${srv.address().port}`; close = r.close;
});
afterAll(() => { srv?.close(); close?.(); });

const req = async (method, p, { body, cookie, headers = {} } = {}) => {
  const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: r.status, body: json, headers: r.headers, cookie: (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ') };
};
const loginEmp = async input => (await req('POST', '/api/v1/login/employee', { body: { input } })).cookie;
const loginCeo = async () => (await req('POST', '/api/v1/login/admin', { body: { username: 'admin', password: 'ceo-pass-123' } })).cookie;

describe('nền API', () => {
  it('health, /api/v1 và /api cùng một API; 404 trả JSON có code và requestId', async () => {
    const h = await req('GET', '/api/v1/health');
    expect(h.status).toBe(200); expect(h.body).toMatchObject({ ok: true, version: expect.any(String) });
    expect(h.headers.get('x-request-id')).toMatch(/^[\w-]{8,}$/);
    expect((await req('GET', '/api/health')).status).toBe(200);
    const nf = await req('GET', '/api/v1/khong-co');
    expect(nf.status).toBe(404); expect(nf.body).toMatchObject({ code: 'not_found', requestId: expect.any(String) });
  });
  it('header bảo mật; chưa đăng nhập thì 401', async () => {
    const r = await req('GET', '/api/v1/attendance/today');
    expect(r.status).toBe(401);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(r.headers.get('permissions-policy')).toContain('camera=()');
  });
  it('chống CSRF: ghi không phải JSON → 415, khác nguồn → 403; JSON hỏng → 400 bad_json', async () => {
    const c = await loginEmp('4101-An');
    const r1 = await fetch(base + '/api/v1/attendance/checkin', { method: 'POST', headers: { cookie: c, 'content-type': 'text/plain' }, body: 'x' });
    expect(r1.status).toBe(415);
    expect((await req('POST', '/api/v1/attendance/checkin', { cookie: c, body: {}, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    const r3 = await fetch(base + '/api/v1/attendance/checkin', { method: 'POST', headers: { cookie: c, 'content-type': 'application/json' }, body: '{oops' });
    expect(r3.status).toBe(400); expect((await r3.json()).code).toBe('bad_json');
  });
});

describe('chấm công', () => {
  it('vào ca một lần mỗi ngày, ra về, bảng trong ngày; chưa vào thì không ra được; nhân viên không xem bảng quản trị', async () => {
    const c = await loginEmp('4201-Bình');
    expect((await req('POST', '/api/v1/attendance/checkout', { cookie: c, body: {} })).body.code).toBe('not_checked_in');
    const a = await req('POST', '/api/v1/attendance/checkin', { cookie: c, body: {} });
    expect(a.status).toBe(200); expect(a.body.already).toBe(false); expect(a.body.record).toMatchObject({ code: '4201', checkOut: null });
    const b = await req('POST', '/api/v1/attendance/checkin', { cookie: c, body: {} });
    expect(b.body.already).toBe(true); expect(b.body.record.checkIn).toBe(a.body.record.checkIn);
    expect((await req('POST', '/api/v1/attendance/checkout', { cookie: c, body: {} })).body.record.checkOut).toBeGreaterThan(0);
    expect((await req('GET', '/api/v1/attendance/today', { cookie: c })).body.list.some(x => x.code === '4201')).toBe(true);
    expect((await req('GET', '/api/v1/admin/attendance', { cookie: c })).status).toBe(403);
    const ceo = await loginCeo();
    expect((await req('POST', '/api/v1/attendance/checkin', { cookie: ceo, body: {} })).status).toBe(403);   // CEO không chấm công
    const adm = await req('GET', '/api/v1/admin/attendance', { cookie: ceo });
    expect(adm.body.list.find(x => x.code === '4201')).toMatchObject({ display: '4201-Bình' });
    expect((await req('GET', '/api/v1/admin/attendance?day=hom-nay', { cookie: ceo })).body).toMatchObject({ code: 'invalid', field: 'day' });
    expect((await req('GET', '/api/v1/admin/attendance/4201', { cookie: ceo })).body.history.length).toBe(1);
  });
});

describe('chat và loa', () => {
  it('kênh phòng ban chỉ thành viên phòng (và CEO) đọc được; tham số sai bị chặn', async () => {
    const a = await loginEmp('4301-An'), b = await loginEmp('4302-Bình'), ceo = await loginCeo();
    expect((await req('POST', '/api/v1/seats/T2-09/claim', { cookie: a, body: {} })).status).toBe(200);   // bàn Phòng Mobile App
    expect((await req('GET', '/api/v1/chat/channels', { cookie: a })).body.channels.map(x => x.id)).toEqual(['all', 'dept:mobile']);
    expect((await req('GET', '/api/v1/chat/channels', { cookie: ceo })).body.channels.length).toBe(14);
    expect((await req('GET', '/api/v1/chat/dept:mobile', { cookie: a })).status).toBe(200);
    expect((await req('GET', '/api/v1/chat/dept:mobile', { cookie: b })).status).toBe(403);
    expect((await req('GET', '/api/v1/chat/all?before=abc', { cookie: a })).body.code).toBe('invalid');
    expect((await req('GET', `/api/v1/chat/${encodeURIComponent('<script>')}`, { cookie: a })).status).toBe(400);
  });
  it('chỉ CEO cấp quyền bật nhạc; dữ liệu phải đúng kiểu; có ghi nhật ký', async () => {
    const a = await loginEmp('4401-An'), ceo = await loginCeo();
    expect((await req('POST', '/api/v1/admin/music/4401', { cookie: a, body: { allow: true } })).status).toBe(403);
    expect((await req('POST', '/api/v1/admin/music/4401', { cookie: ceo, body: { allow: 'yes' } })).body).toMatchObject({ code: 'invalid', field: 'allow' });
    expect((await req('POST', '/api/v1/admin/music/9999', { cookie: ceo, body: { allow: true } })).status).toBe(404);
    expect((await req('POST', '/api/v1/admin/music/4401', { cookie: ceo, body: { allow: true } })).status).toBe(200);
    expect((await req('GET', '/api/v1/admin/music', { cookie: ceo })).body.allowed).toContain('4401');
    const audit = (await req('GET', '/api/v1/admin/audit', { cookie: ceo })).body.audit;
    expect(audit.some(x => x.action === 'music.permission.grant' && x.target === '4401')).toBe(true);
  });
});

describe('giới hạn tần suất', () => {
  it('chấm công quá 12 lần/phút → 429 kèm Retry-After', async () => {
    resetRateLimits();
    const c = await loginEmp('4501-An');
    let last;
    for (let i = 0; i < 13; i++) last = await req('POST', '/api/v1/attendance/checkin', { cookie: c, body: {} });
    expect(last.status).toBe(429); expect(last.body.code).toBe('rate_limited');
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
    resetRateLimits();
  });
});

describe('bảng công tháng / năm', () => {
  it('nhân viên xem tháng/năm của mình; CEO xem ma trận tháng, năm và lịch từng người; tham số sai bị chặn', async () => {
    const c = await loginEmp('4601-Hà'), ceo = await loginCeo();
    await req('POST', '/api/v1/attendance/checkin', { cookie: c, body: {} });
    const ym = (await req('GET', '/api/v1/attendance/me', { cookie: c })).body.today.day.slice(0, 7);
    const m = await req('GET', `/api/v1/attendance/me/month?ym=${ym}`, { cookie: c });
    expect(m.status).toBe(200); expect(m.body.days.length).toBeGreaterThanOrEqual(28);
    expect(m.body.summary.present).toBe(1); expect(m.body.records[0].code).toBe('4601');
    expect(m.body.summary.absent).toBe(0); // (mới vào hôm nay: các ngày trước không tính vắng)
    const y = await req('GET', `/api/v1/attendance/me/year?year=${ym.slice(0, 4)}`, { cookie: c });
    expect(y.body.months).toHaveLength(12); expect(y.body.summary.present).toBe(1);
    expect((await req('GET', '/api/v1/attendance/me/month?ym=2026-13', { cookie: c })).body).toMatchObject({ code: 'invalid', field: 'ym' });
    expect((await req('GET', `/api/v1/admin/attendance/month?ym=${ym}`, { cookie: c })).status).toBe(403);
    const am = await req('GET', `/api/v1/admin/attendance/month?ym=${ym}`, { cookie: ceo });
    expect(am.body.employees.find(e => e.code === '4601').summary.present).toBe(1);
    const ay = await req('GET', `/api/v1/admin/attendance/year?year=${ym.slice(0, 4)}`, { cookie: ceo });
    expect(ay.body.employees.find(e => e.code === '4601').months).toHaveLength(12);
    const pm = await req('GET', `/api/v1/admin/attendance/4601/month?ym=${ym}`, { cookie: ceo });
    expect(pm.body).toMatchObject({ code: '4601', display: '4601-Hà' }); expect(pm.body.summary.present).toBe(1);
    expect((await req('GET', `/api/v1/admin/attendance/abc/month`, { cookie: ceo })).status).toBe(400);
  });
});

describe('loa công ty (YouTube)', () => {
  it('đọc mã video từ các dạng link YouTube; link lạ bị từ chối', async () => {
    const { youtubeId } = await import('../server/social.js');
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube.com/watch?v=dQw4w9WgXcQ&t=30s', 'https://youtu.be/dQw4w9WgXcQ?si=abc', 'https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'])
      expect(youtubeId(u), u).toBe('dQw4w9WgXcQ');
    for (const u of ['', 'https://vimeo.com/123', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?v=short', 'javascript:alert(1)']) expect(youtubeId(u), u).toBe(null);
  });
  it('chỉ người được cấp quyền mới phát/điều khiển; ai cũng xem được trạng thái; phát → tạm dừng → tua → tiếp → tắt', async () => {
    resetRateLimits();
    const a = await loginEmp('4701-An'), b = await loginEmp('4702-Bình'), ceo = await loginCeo();
    expect((await req('POST', '/api/v1/music/play', { cookie: a, body: { url: 'https://youtu.be/dQw4w9WgXcQ' } })).status).toBe(403);
    expect((await req('POST', '/api/v1/admin/music/4701', { cookie: ceo, body: { allow: true } })).status).toBe(200);
    expect((await req('POST', '/api/v1/music/play', { cookie: a, body: { url: 'https://vimeo.com/1' } })).body).toMatchObject({ code: 'invalid', field: 'url' });
    const p = await req('POST', '/api/v1/music/play', { cookie: a, body: { url: 'https://youtu.be/dQw4w9WgXcQ' } });
    expect(p.status).toBe(200); expect(p.body.state).toMatchObject({ on: true, videoId: 'dQw4w9WgXcQ', paused: false });
    const s = (await req('GET', '/api/v1/music', { cookie: b })).body;
    expect(s.state.videoId).toBe('dQw4w9WgXcQ'); expect(s.canControl).toBe(false); expect(s.recent[0].videoId).toBe('dQw4w9WgXcQ');
    expect((await req('POST', '/api/v1/music/control', { cookie: b, body: { action: 'pause' } })).status).toBe(403);
    const pa = await req('POST', '/api/v1/music/control', { cookie: a, body: { action: 'pause' } }); expect(pa.body.state.paused).toBe(true);
    const sk = await req('POST', '/api/v1/music/control', { cookie: a, body: { action: 'seek', position: 75 } }); expect(sk.body.state.position).toBe(75);
    const re = await req('POST', '/api/v1/music/control', { cookie: a, body: { action: 'resume' } });
    expect(re.body.state.paused).toBe(false); expect(Math.round((re.body.state.serverNow - re.body.state.startedAt) / 1000)).toBe(75);
    expect((await req('POST', '/api/v1/music/control', { cookie: a, body: { action: 'jump' } })).body.code).toBe('invalid');
    expect((await req('POST', '/api/v1/music/control', { cookie: ceo, body: { action: 'stop' } })).body.state.on).toBe(false);
    expect((await req('POST', '/api/v1/music/control', { cookie: a, body: { action: 'pause' } })).body.code).toBe('music_off');
  });
});
