// Thử tải server: N người dùng giả (bot) đăng nhập, gọi các API lúc vào cảnh, mở WebSocket rồi hoạt động như người thật
// (một phần đi lại gửi vị trí 6 lần/giây, số còn lại đứng/ngồi thỉnh thoảng đổi động tác, chat lác đác).
// Đo: thời gian đăng nhập + vào cảnh, độ trễ chat (gửi → nhận lại), độ trễ API /health, băng thông mỗi người nhận,
// số lần rớt kết nối; có --container thì lấy thêm CPU / RAM của container Docker (giả lập Render free: --cpus=0.1 --memory=512m).
// Dùng: node scripts/load-ws.mjs --url=http://localhost:8090 --n=100 --walk=0.3 --dur=90 --ramp=20 [--container=tên] [--code0=8000]
// KHÔNG chạy vào server thật đang dùng: bot tạo nhân viên mới (mã code0…code0+n-1) trong database.
import WebSocket from 'ws';
import { execFile } from 'child_process';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const URL0 = arg('url', 'http://localhost:8090').replace(/\/+$/, ''), N = +arg('n', 100), WALK = +arg('walk', 0.3);
const DUR = +arg('dur', 90) * 1000, RAMP = +arg('ramp', 20) * 1000, CODE0 = +arg('code0', 8000), CONTAINER = arg('container', '');
const WS_URL = URL0.replace(/^http/, 'ws') + '/ws';
const LOOK = { pixel: 'mo-nu', model: 'mo-toy', hairColor: '#1d1a17', skinColor: '#ecc9a8', topColor: '#d9d9d9', bottomColor: '#2b2d42' };
const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
const nameOf = i => 'Bot ' + ALPHA[Math.floor(i / 26) % 26].toUpperCase() + ALPHA[i % 26];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const fmt = a => a.length ? `p50 ${pct(a, 50).toFixed(0)} · p95 ${pct(a, 95).toFixed(0)} · max ${Math.max(...a).toFixed(0)} ms (${a.length} mẫu)` : '—';

const st = { login: [], boot: [], hello: [], chatRtt: [], health: [], httpErr: 0, wsClose: 0, wsErr: 0, bytes: 0, msgs: 0, connected: 0, docker: [] };
const bots = [];
let stopping = false;

async function http(bot, method, path, body) {
  const r = await fetch(URL0 + path, { method, headers: { 'content-type': 'application/json', ...(bot.cookie ? { cookie: bot.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.getSetCookie?.() || [];
  if (sc.length) bot.cookie = sc.map(c => c.split(';')[0]).join('; ');
  if (!r.ok) { st.httpErr++; throw new Error(`${method} ${path} → ${r.status} ${(await r.text()).slice(0, 120)}`); }
  return r.json().catch(() => null);
}

async function startBot(i) {
  const bot = { i, code: String(CODE0 + i), walk: i % Math.round(1 / Math.max(WALK, 0.01)) === 0, x: -8 + Math.random() * 16, z: -4 + Math.random() * 12, yaw: 0 };
  bots.push(bot);
  const t0 = performance.now();
  await http(bot, 'POST', '/api/login/employee', { input: `${bot.code}-${nameOf(i)}` });
  st.login.push(performance.now() - t0);
  await http(bot, 'PUT', '/api/me/look', { look: LOOK });
  // (các API giao diện gọi khi vào cảnh)
  await Promise.all(['/api/me', '/api/seats', '/api/equipment', '/api/appearance', '/api/chat/channels', '/api/v1/lights', '/api/v1/music', '/api/attendance/today'].map(p => http(bot, 'GET', p).catch(() => null)));
  st.boot.push(performance.now() - t0);
  connect(bot);
}

function connect(bot) {
  const t0 = performance.now();
  const ws = bot.ws = new WebSocket(WS_URL, { headers: { cookie: bot.cookie } });
  ws.on('message', buf => {
    st.bytes += buf.length; st.msgs++;
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m.t === 'hello') { st.hello.push(performance.now() - t0); st.connected++; bot.open = true; }
    else if (m.t === 'chat' && m.msg?.body?.startsWith(`ping ${bot.code} `)) st.chatRtt.push(Date.now() - +m.msg.body.split(' ')[2]);
  });
  ws.on('error', () => { st.wsErr++; });
  ws.on('close', () => { if (bot.open) st.connected--; bot.open = false; if (!stopping) { st.wsClose++; setTimeout(() => connect(bot), 1000); } });
}

function tick(bot, now) {
  if (!bot.open) return;
  if (bot.walk) {
    if (now - (bot.lastPos || 0) < 166) return;
    bot.lastPos = now;
    bot.yaw += (Math.random() - 0.5) * 0.6;
    bot.x = Math.max(-12, Math.min(12, bot.x + Math.sin(bot.yaw) * 0.25)); bot.z = Math.max(-6, Math.min(12, bot.z + Math.cos(bot.yaw) * 0.25));
    bot.ws.send(JSON.stringify({ t: 'pos', mode: 'office', x: +bot.x.toFixed(3), y: 0, z: +bot.z.toFixed(3), f: 0, yaw: +bot.yaw.toFixed(3), walk: true, run: false, act: '' }));
  } else if (!bot.placed || Math.random() < 1 / (20 * 60)) {    // (đứng yên; ~20 s đổi động tác một lần)
    bot.placed = true;
    bot.ws.send(JSON.stringify({ t: 'pos', mode: 'office', x: +bot.x.toFixed(3), y: 0, z: +bot.z.toFixed(3), f: 0, yaw: 0, walk: false, run: false, act: ['', 'wave', 'phone', 'drink'][Math.floor(Math.random() * 4)] }));
  }
  if (Math.random() < 1 / (45 * 60)) bot.ws.send(JSON.stringify({ t: 'chat', channel: 'all', body: `ping ${bot.code} ${Date.now()}` }));   // (mỗi người ~45 s chat một câu)
}

function dockerStats() {
  if (!CONTAINER) return;
  execFile('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}', CONTAINER], (e, out) => {
    if (e) return; const [cpu, mem, net] = out.trim().split('|'); st.docker.push({ t: Date.now(), cpu: parseFloat(cpu), mem: mem.split('/')[0].trim(), net });
  });
}

const T0 = Date.now();
console.log(`Thử tải ${URL0}: ${N} bot (${Math.round(WALK * 100)}% đi lại), vào dần trong ${RAMP / 1000} s, chạy ${DUR / 1000} s`);
const loop = setInterval(() => { const now = performance.now(); for (const b of bots) tick(b, now); }, 1000 / 60);
const healthT = setInterval(async () => { const t = performance.now(); try { await fetch(URL0 + '/api/v1/health'); st.health.push(performance.now() - t); } catch { st.httpErr++; } }, 2000);
const dockT = setInterval(dockerStats, 3000);
const probe = setInterval(() => { const b = bots.find(x => x.open); if (b) b.ws.send(JSON.stringify({ t: 'chat', channel: 'all', body: `ping ${b.code} ${Date.now()}` })); }, 2500);
let lastBytes = 0, lastT = Date.now();
const report = setInterval(() => {
  const now = Date.now(), kbps = (st.bytes - lastBytes) / 1024 / ((now - lastT) / 1000); lastBytes = st.bytes; lastT = now;
  const d = st.docker.at(-1);
  console.log(`[${Math.round((now - T0) / 1000)}s] online ${st.connected}/${N} · nhận ${(kbps / Math.max(1, st.connected)).toFixed(1)} KB/s/người (tổng ${(kbps / 1024).toFixed(2)} MB/s) · chat p95 ${pct(st.chatRtt.slice(-40), 95)?.toFixed?.(0)} ms · health p95 ${pct(st.health.slice(-5), 95)?.toFixed?.(0)} ms${d ? ` · CPU ${d.cpu}% · RAM ${d.mem}` : ''} · rớt ${st.wsClose} · lỗi HTTP ${st.httpErr}`);
}, 5000);

const fails = [];
for (let i = 0; i < N; i++) {
  startBot(i).catch(e => fails.push(e.message));
  await sleep(RAMP / N);
}
await sleep(DUR - RAMP);
stopping = true;
for (const t of [loop, healthT, dockT, probe, report]) clearInterval(t);
for (const b of bots) b.ws?.close();
await sleep(500);
const cpus = st.docker.map(d => d.cpu).filter(Number.isFinite);
console.log('\n===== KẾT QUẢ =====');
console.log(`Đăng nhập:            ${fmt(st.login)}`);
console.log(`Đăng nhập + API vào cảnh: ${fmt(st.boot)}`);
console.log(`Mở WS → nhận hello:   ${fmt(st.hello)}`);
console.log(`Chat gửi → nhận lại:  ${fmt(st.chatRtt)}`);
console.log(`API /health:          ${fmt(st.health)}`);
console.log(`Nhận trung bình:      ${(st.bytes / 1024 / 1024).toFixed(1)} MB, ${st.msgs} tin`);
if (cpus.length) console.log(`CPU container:        tb ${(cpus.reduce((a, b) => a + b, 0) / cpus.length).toFixed(1)}% · max ${Math.max(...cpus).toFixed(1)}% (100% = 1 lõi) · RAM cuối ${st.docker.at(-1).mem} · mạng ${st.docker.at(-1).net}`);
console.log(`Rớt WS: ${st.wsClose} · lỗi WS: ${st.wsErr} · lỗi HTTP: ${st.httpErr} · bot không vào được: ${fails.length}${fails.length ? ' — ' + [...new Set(fails)].slice(0, 3).join(' | ') : ''}`);
process.exit(0);
