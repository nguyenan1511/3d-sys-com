// Thử tải server: N người dùng giả (bot) đăng nhập, gọi các API lúc vào cảnh, mở WebSocket rồi hoạt động như người thật
// (một phần đi lại gửi vị trí 6 lần/giây, số còn lại đứng/ngồi thỉnh thoảng đổi động tác, chat lác đác).
// Đo: thời gian đăng nhập + vào cảnh, độ trễ chat (gửi → nhận lại), độ trễ API /health, băng thông mỗi người nhận,
// số lần rớt kết nối; có --container thì lấy thêm CPU / RAM của container Docker (giả lập Render free: --cpus=0.1 --memory=512m).
// Dùng: node scripts/load-ws.mjs --url=http://localhost:8090 --n=100 --walk=0.3 --dur=90 --ramp=20 [--floors=3] [--container=tên] [--code0=8000]
// Server giới hạn MAX_ONLINE: bot vượt mức nhận 'full', chờ rồi thử lại như client thật (đếm ở dòng "chờ").
// KHÔNG chạy vào server thật đang dùng: bot tạo nhân viên mới (mã code0…code0+n-1) trong database.
import WebSocket from 'ws';
import { execFile } from 'child_process';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const URL0 = arg('url', 'http://localhost:8090').replace(/\/+$/, ''), N = +arg('n', 100), WALK = +arg('walk', 0.3);
const FLOORS = Math.max(1, +arg('floors', 1));
const MEET = Math.max(0, +arg('meet', 0));   // (--meet=10: 10 bot đầu vào chung một phòng họp, vẽ bảng ~5 nét/giây/người, di chuột 20 lần/giây)   // (--floors=3: bot chia đều các tầng và báo tầng đang xem — server chỉ gửi vị trí cùng tầng)
const DUR = +arg('dur', 90) * 1000, RAMP = +arg('ramp', 20) * 1000, CODE0 = +arg('code0', 8000), CONTAINER = arg('container', '');
const WS_URL = URL0.replace(/^http/, 'ws') + '/ws';
const LOOK = { pixel: 'mo-nu', model: 'mo-toy', hairColor: '#1d1a17', skinColor: '#ecc9a8', topColor: '#d9d9d9', bottomColor: '#2b2d42' };
const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
const nameOf = i => 'Bot ' + ALPHA[Math.floor(i / 26) % 26].toUpperCase() + ALPHA[i % 26];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const fmt = a => a.length ? `p50 ${pct(a, 50).toFixed(0)} · p95 ${pct(a, 95).toFixed(0)} · max ${Math.max(...a).toFixed(0)} ms (${a.length} mẫu)` : '—';

const st = { wbRtt: [], meetIn: 0, full: 0, login: [], boot: [], hello: [], chatRtt: [], health: [], httpErr: 0, wsClose: 0, wsErr: 0, bytes: 0, msgs: 0, connected: 0, docker: [] };
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
  const bot = { f: i % FLOORS, i, code: String(CODE0 + i), walk: i % Math.round(1 / Math.max(WALK, 0.01)) === 0, x: -8 + Math.random() * 16, z: -4 + Math.random() * 12, yaw: 0 };
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
    if (m.t === 'hello') { st.hello.push(performance.now() - t0); st.connected++; bot.open = true; bot.waiting = false; if (FLOORS > 1) ws.send(JSON.stringify({ t: 'view', f: bot.f })); }
    else if (m.t === 'meet:wb' || m.t === 'meet:batch') { for (const e of m.elements || []) if (e.customData?.ts) st.wbRtt.push(Date.now() - e.customData.ts); }
    else if (m.t === 'meet:state' || m.t === 'meet:joined') { if (!bot.inMeet) { bot.inMeet = true; st.meetIn++; } }
    else if (m.t === 'full') { if (!bot.waiting) st.full++; bot.waiting = true; }
    else if (m.t === 'chat' && m.msg?.body?.startsWith(`ping ${bot.code} `)) st.chatRtt.push(Date.now() - +m.msg.body.split(' ')[2]);
  });
  ws.on('error', () => { st.wsErr++; });
  ws.on('close', () => { if (bot.open) st.connected--; bot.open = false; if (!stopping) { if (bot.waiting) { setTimeout(() => connect(bot), 10000); return; } st.wsClose++; setTimeout(() => connect(bot), 1000); } });
}

function tick(bot, now) {
  if (!bot.open) return;
  if (bot.walk) {
    if (now - (bot.lastPos || 0) < 166) return;
    bot.lastPos = now;
    bot.yaw += (Math.random() - 0.5) * 0.6;
    bot.x = Math.max(-12, Math.min(12, bot.x + Math.sin(bot.yaw) * 0.25)); bot.z = Math.max(-6, Math.min(12, bot.z + Math.cos(bot.yaw) * 0.25));
    bot.ws.send(JSON.stringify({ t: 'pos', mode: 'office', x: +bot.x.toFixed(3), y: 0, z: +bot.z.toFixed(3), f: bot.f, yaw: +bot.yaw.toFixed(3), walk: true, run: false, act: '' }));
  } else if (!bot.placed || Math.random() < 1 / (20 * 60)) {    // (đứng yên; ~20 s đổi động tác một lần)
    bot.placed = true;
    bot.ws.send(JSON.stringify({ t: 'pos', mode: 'office', x: +bot.x.toFixed(3), y: 0, z: +bot.z.toFixed(3), f: bot.f, yaw: 0, walk: false, run: false, act: ['', 'wave', 'phone', 'drink'][Math.floor(Math.random() * 4)] }));
  }
  if (bot.meetId && bot.open) {
    if (!bot.joinSent) { bot.joinSent = true; bot.ws.send(JSON.stringify({ t: 'meet:join', id: bot.meetId })); }
    if (now - (bot.lastPtr || 0) > 66) { bot.lastPtr = now; bot.ws.send(JSON.stringify({ t: 'meet:ptr', id: bot.meetId, x: Math.random() * 800, y: Math.random() * 600, tool: 'pointer', button: 'up' })); }
    if (now - (bot.lastWb || 0) > 100) {   // (như client thật đang vẽ liên tục: 10 lần/giây, nét ~40 điểm, mỗi lần tăng phiên bản)
      bot.lastWb = now; bot.stroke = (bot.stroke || 0) + (Math.random() < 0.1 ? 1 : 0); bot.ver = (bot.ver || 0) + 1;
      const pts = Array.from({ length: 40 }, (_, k) => [k * 3, Math.round(Math.sin(k / 3 + bot.ver) * 20)]);
      bot.ws.send(JSON.stringify({ t: 'meet:wb', id: bot.meetId, elements: [{ id: `b${bot.code}s${bot.stroke}`, type: 'freedraw', version: bot.ver, versionNonce: Math.random(), x: bot.i * 40, y: bot.stroke * 30, points: pts, strokeColor: '#1e1e1e', customData: { ts: Date.now() } }] }));
    }
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
  console.log(`[${Math.round((now - T0) / 1000)}s] online ${st.connected}/${N} · nhận ${(kbps / Math.max(1, st.connected)).toFixed(1)} KB/s/người (tổng ${(kbps / 1024).toFixed(2)} MB/s) · chat p95 ${pct(st.chatRtt.slice(-40), 95)?.toFixed?.(0)} ms · health p95 ${pct(st.health.slice(-5), 95)?.toFixed?.(0)} ms${d ? ` · CPU ${d.cpu}% · RAM ${d.mem}` : ''} · chờ ${bots.filter(b => b.waiting).length} · rớt ${st.wsClose} · lỗi HTTP ${st.httpErr}`);
}, 5000);

const fails = [];
const started = [];
for (let i = 0; i < N; i++) {
  started.push(startBot(i).catch(e => fails.push(e.message)));
  await sleep(RAMP / N);
}
if (MEET > 1) {   // bot đầu đặt phòng họp ngay bây giờ, mời các bot kế tiếp
  await Promise.all(started.slice(0, MEET));
  const host = bots[0], slot = Math.floor(Date.now() / 1800e3) * 1800e3;
  try {
    const r = await http(host, 'POST', '/api/meetings', { title: 'Họp thử tải', start: slot, end: slot + 3600e3, invitees: bots.slice(1, MEET).map(b => `employee:${b.code}`) });
    for (const b of bots.slice(0, MEET)) b.meetId = r.meeting.id;
    console.log(`Đặt phòng họp #${r.meeting.id} cho ${MEET} bot`);
  } catch (e) { console.log('Không đặt được phòng họp:', e.message); }
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
if (MEET) console.log(`Bảng vẽ (nét → người khác nhận): ${fmt(st.wbRtt)} · ${st.meetIn}/${MEET} bot vào phòng họp`);
console.log(`Nhận trung bình:      ${(st.bytes / 1024 / 1024).toFixed(1)} MB, ${st.msgs} tin`);
if (cpus.length) console.log(`CPU container:        tb ${(cpus.reduce((a, b) => a + b, 0) / cpus.length).toFixed(1)}% · max ${Math.max(...cpus).toFixed(1)}% (100% = 1 lõi) · RAM cuối ${st.docker.at(-1).mem} · mạng ${st.docker.at(-1).net}`);
console.log(`Rớt WS: ${st.wsClose} · lỗi WS: ${st.wsErr} · lỗi HTTP: ${st.httpErr} · bot không vào được: ${fails.length}${fails.length ? ' — ' + [...new Set(fails)].slice(0, 3).join(' | ') : ''}`);
process.exit(0);
