import { setOfficeFromLayout } from './shared/rules.js';
import { MODES, getMode, REAL_ENABLED } from './core/mode.js';
const MODE = getMode(), REAL_MODE = __REAL_SYS__ && REAL_ENABLED && MODE === 'real'; // (__REAL_SYS__: cờ build — tắt thì mã Real SYS bị loại khỏi gói)
import { buildMyOffice, buildMyCity, updateMyOffice } from './myoffice/boot.js';
import { setWorldView } from './ui/camera.js';
import { loadCarKit } from './scene/carKit.js';
import { buildLotGarden } from './scene/lotGarden.js';
import { buildSysoneShell } from './scene/sysoneShell.js';
import { buildMyBuilding, buildingDesks } from './myoffice/building.js';
import * as SHELL from './myoffice/shellSpec.js';
import { createDeskState } from './interior/deskState.js';
import { characterDef } from './agents/glbCharacters.js';
import * as THREE from 'three';
import { buildModel } from './model/layoutModel.js';
import { Navigator } from './nav/grid.js';
import { validateStaff, parseSeatingCsv, applySeating, seatingCsv } from './model/staff.js';
import { Simulation } from './sim/sim.js';
import { parseTime } from './core/util.js';
import { createBuilder, mergeStatic } from './scene/builder.js';
import { makeMaterials } from './scene/materials.js';
import { buildHouse, buildFence } from './scene/house.js';
import { buildNeighbors, buildStreet, XL, XR, setStreetSpan, spreadNeighbors } from './scene/street.js';
import { buildSign } from './scene/logo.js';
import { buildInterior } from './interior/interior.js';
import { MatrixFreezer } from './scene/freeze.js';
import { FloorCuller } from './scene/floorCull.js';
import { disposeObject } from './scene/dispose.js';
import { releaseGeometryRam } from './scene/releaseRam.js';
import { DetailCuller, HIDE_LAYER } from './scene/detailCull.js';
import { buildDesk, NameplateAtlas } from './interior/deskKit.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildCeilings } from './interior/ceiling.js';
import { AvatarSystem } from './agents/avatars.js';
import { CameraRig, PRESETS } from './ui/camera.js';
import { DebugLayers } from './ui/debug.js';
import { Panel } from './ui/panel.js';
import { Session } from './session/session.js';
import { applySeatRules } from './model/seatRules.js';
import { api } from './net/api.js';
import { ACTIONS } from './session/player.js';
import { setCharacterDefs, loadTemplate } from './agents/glbCharacters.js';
import { OUTLINE } from './agents/toon.js';
import { icon } from './ui/icons.js';
import { Minimap } from './ui/minimap.js';
import { QuickTravel } from './ui/quickTravel.js';
import { loading } from './ui/loading.js';
import { TouchControls, isTouchUI } from './ui/touchControls.js';
import { NameTags } from './ui/nameTags.js';
import { departmentOfDesk } from './shared/departments.js';
import { buildDeptSigns } from './scene/deptSigns.js';
import { MusicCorner } from './scene/musicCorner.js';
import { TvVideo } from './scene/tvVideo.js';
import { RoomStage } from './rooms/stage.js';
import { DeskInfoBoards } from './scene/deskInfo.js';
import { OfficeMap2D } from './pixel/map2d.js';
import { setPixelSpecs, setBillboardCamera, VIEW, ENABLE_2D } from './pixel/billboard.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BASE = import.meta.env.BASE_URL;
const isMobile = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
// Chất lượng (học từ hangmu.online): mặc định CAO — kể cả điện thoại (màn Retina vẽ ở 2–2,5×, có khử răng cưa); chỉ hạ
// khi máy yếu thật (tiết kiệm dữ liệu, RAM ≤ 4 GB, ≤ 2 nhân, GPU đời cũ / phần mềm) hoặc phiên này đã tự hạ vì khung hình tụt.
const WEAK_GPU = /swiftshader|llvmpipe|software|mali-[2-4]\d\d|mali-t[0-9]{3}|mali-g(31|51|52|57)\b|adreno \(tm\) [2-5]\d\d|powervr|intel\(r\) (hd|uhd) graphics( [0-9]{3})?$|intel\(r\) hd graphics [2-5]\d{3}/i;
function gpuName() { try { const g = document.createElement('canvas').getContext('webgl'); if (!g) return 'none'; const e = g.getExtension('WEBGL_debug_renderer_info'); const n = e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); g.getExtension('WEBGL_lose_context')?.loseContext(); return String(n); } catch { return ''; } }
function detectQuality() {
  const q = params.get('q'); if (q === 'low' || q === 'high') return q;
  try { if (sessionStorage.getItem('sysone.quality') === 'low') return 'low'; } catch { /* */ }
  const n = navigator;
  return n.connection?.saveData || (n.deviceMemory !== undefined && n.deviceMemory <= 4) || (n.hardwareConcurrency !== undefined && n.hardwareConcurrency <= 2) || WEAK_GPU.test(gpuName()) ? 'low' : 'high';
}
const QUALITY = detectQuality();
const DPR = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2.5);
/** Độ phân giải tối đa: cao → 2,5× (điện thoại) / 2× (máy tính); thấp → 1,5×. */
const PR_MAX = QUALITY === 'low' ? Math.min(DPR, 1.5) : Math.min(DPR, 2);
/** Độ phân giải lúc mở: điện thoại bắt đầu 1,5× (đủ nét, nhẹ cho GPU di động) rồi tự nâng tới PR_MAX nếu máy chạy mượt. */
const PR_START = isMobile ? Math.min(PR_MAX, 1.5) : PR_MAX;

/** Thử lại khi mạng chập chờn: lỗi kết nối, quá thời gian, máy chủ quá tải (5xx/429) — tối đa 3 lần, chờ tăng dần. */
async function retry(fn, bad, tries = 3) {
  for (let i = 1; ; i++) {
    let r, err = null;
    try { r = await fn(); } catch (e) { err = e; }
    if (!err && !bad(r)) return r;
    if (i >= tries) { if (err) throw err; return r; }
    await new Promise(ok => setTimeout(ok, 600 * i * i));
  }
}
const transient = st => st === 0 || st === 408 || st === 429 || st >= 500;
async function getJson(path) {
  const r = await retry(async () => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000); // (mạng treo: bỏ sau 25 s rồi thử lại)
    try { return await fetch(`${BASE}${path}`, { cache: 'no-cache', signal: ctl.signal }); } finally { clearTimeout(t); }
  }, r => transient(r.status));
  if (!r.ok) throw new Error(`Không tải được ${path} (${r.status})`);
  try { return await r.json(); } catch (e) { throw new Error(`${path} không phải JSON hợp lệ: ${e.message}`); }
}
const apiGet = path => retry(() => api('GET', path), r => transient(r.status));

/** ?n=40: thêm nhân viên giả để thử tải (không có dữ liệu cá nhân thật). */
function padEmployees(data, n) {
  const list = [...data.employees];
  if (!list.length) return data;
  for (let i = list.length; i < n; i++) {
    const src = data.employees[i % data.employees.length];
    list.push({ ...src, id: `NV${String(i + 1).padStart(2, '0')}`, name: `Nhân viên ${String(i + 1).padStart(2, '0')}`, deskId: undefined, meetings: [] });
  }
  return { ...data, employees: list };
}

export async function startApp(me, hooks = {}) {
  loading.step('Đang tải dữ liệu văn phòng…', 6, 30);
  const [, layout, empRaw, seatsRes, equipRes, lookRes, chars] = await Promise.all([loadCarKit(), __REAL_SYS__ && REAL_MODE ? import('./data/layout.real.json').then(m => m.default) : getJson(MODES[MODE].layout), getJson('data/employees.json'), apiGet(`/api/seats?mode=${MODE}`), apiGet('/api/equipment'), apiGet('/api/appearance'), getJson('data/characters.json').catch(() => ({ characters: [] }))]);
  setCharacterDefs(chars.characters);
  loading.step('Đang dựng toà nhà 3 tầng…', 30, 62);
  setPixelSpecs((await getJson('data/pixel-characters.json').catch(() => ({ characters: [] }))).characters);
  if (me.employee?.look?.model) loadTemplate(me.employee.look.model); // tải sớm model của chính mình
  if (!seatsRes.ok || !equipRes.ok || !lookRes.ok) throw new Error(seatsRes.error || equipRes.error || lookRes.error);
  let empData = params.get('n') ? padEmployees(empRaw, +params.get('n')) : empRaw;
  const model = buildModel(layout);
  // nhân viên mô phỏng gán sẵn bàn của chế độ kia (mã bàn khác nhau): bỏ bàn, để mô phỏng tự xếp
  if (REAL_MODE && empData.employees?.length) { // (phòng họp cũng khác mã: dời cuộc họp sang phòng họp tầng 1 của mặt bằng thật)
    const room0 = [...model.meetingRooms.keys()][0];
    empData = { ...empData, employees: empData.employees.map(e => ({ ...e, deskId: e.deskId && !model.deskById.has(e.deskId) ? undefined : e.deskId, meetings: (e.meetings || []).map(m => model.meetingRooms.has(m.room) || !room0 ? m : { ...m, room: room0 }) })) };
  }
  seatsRes.seats = (seatsRes.seats || []).filter(s => model.deskById.has(s.deskId)); // (server giữ chỗ của cả hai chế độ)
  setOfficeFromLayout(layout);
  const nav = new Navigator(model);
  // nhân viên mô phỏng nhường bàn cho chủ chỗ thật
  let seatNotes = [];
  const simData = seats => { const r = applySeatRules(model, empData, seats); seatNotes = r.notes; return r.data; };
  let staff = validateStaff(model, simData(seatsRes.seats));

  // ---------- renderer ----------
  const canvas = $('c3');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: QUALITY !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') }); // (alpha: màn hình TV khoét lỗ cho video YouTube bên dưới — scene/tvVideo.js)
  // ?pr=0.6: vẽ ở độ phân giải thấp hơn (máy yếu; kiểm thử trên GPU giả lập)
  const PR = +(params.get('pr') || window.__PIXEL_RATIO || 0);
  renderer.setPixelRatio(PR > 0 ? Math.min(2, PR) : PR_START); // (tự hạ nếu khung hình tụt — xem "độ phân giải tự điều chỉnh" trong vòng vẽ)
  // không có GPU (máy ảo, CI, trình duyệt rơi về SwiftShader): mọi khung hình do CPU vẽ — chạy nhẹ như my-office (scene/renderer.js):
  // độ phân giải thấp, không bóng đổ, tắt đèn phòng (chỉ còn nắng + bầu trời + ánh sáng môi trường)
  const SOFT_GL = (() => { try { const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''); } catch { return false; } })();
  if (SOFT_GL && !PR) renderer.setPixelRatio(0.5);
  renderer.shadowMap.enabled = QUALITY !== 'low' && !SOFT_GL && !isMobile; renderer.shadowMap.type = THREE.PCFShadowMap; // (điện thoại: không bóng đổ — dành sức cho độ phân giải cao)
  renderer.localClippingEnabled = true;
  // GPU bị thu hồi (máy hết bộ nhớ đồ hoạ, driver khởi động lại, điện thoại chuyển app lâu): three.js tự dựng lại khi trình
  // duyệt trả ngữ cảnh; trong lúc chờ báo cho người dùng, quá 10 s không về thì mời tải lại trang
  let glLostT = 0, ramReleased = 0; // (ramReleased: số mesh đã bỏ bản trong RAM — xem releaseRam bên dưới)
  // (điện thoại: thoát ra màn hình chính / app khác một lúc, trình duyệt hay thu hồi GPU của trang. Đang ở nền thì không báo
  // lỗi; quay lại mà sau 2,5 s GPU vẫn chưa trả → tải lại ngay — thay vì treo màn hình "đang khôi phục" 10 s rồi báo lỗi)
  const glLost = () => renderer.getContext().isContextLost?.();
  const reloadForGpu = () => { loading.flash('Đang tải lại văn phòng…'); setTimeout(() => location.reload(), 300); };
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); clearTimeout(glLostT);
    if (document.hidden) return;
    loading.flash('Đang khôi phục đồ hoạ…'); glLostT = setTimeout(reloadForGpu, 4000);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && glLost()) { loading.flash('Đang khôi phục đồ hoạ…'); clearTimeout(glLostT); glLostT = setTimeout(() => { if (glLost()) reloadForGpu(); }, 2500); } });
  // (trang được trình duyệt "đóng băng" rồi trả lại từ bộ nhớ đệm — bfcache: mạng / GPU có thể đã mất → kiểm tra lại)
  window.addEventListener('pageshow', e => { if (e.persisted && glLost()) reloadForGpu(); });
  canvas.addEventListener('webglcontextrestored', () => {
    clearTimeout(glLostT);
    // hình tĩnh đã bỏ bản trong RAM (scene/releaseRam.js) không nạp lại lên GPU được: tải lại trang (giữ phiên đăng nhập)
    if (ramReleased) { reloadForGpu(); return; }
    loading.hideFlash();
  });
  // thế giới văn phòng của my-office (layout.world = 'my-office'): dùng cảnh của nó làm cảnh chính
  const MYOFFICE = layout.world === 'my-office';
  // ngôi nhà SYSONE 3 tầng với nội thất my-office (layout.world = 'sysone-mo', scripts/import-sysone-layout.mjs)
  const BIG = layout.world === 'sysone-mo';
  // chế độ Real SYS: đúng mặt bằng thật (layout.real.json, scripts/build-real-layout.mjs) — nội thất dựng từ layout
  const REAL = __REAL_SYS__ && REAL_ENABLED && layout.world === 'sysone-real';
  // (Real SYS tắt: không import — mã vỏ nhà thật không nằm trong gói build)
  const realShell = __REAL_SYS__ && REAL ? await import('./scene/realShell.js') : null, inRealBuilding = (...a) => realShell.inBuilding(...a);
  if (BIG) setStreetSpan(-24.6, 25.1); // toà nhà rộng: con đường dài thêm, nhà hàng xóm dời ra hai bên
  const scene = MYOFFICE ? buildMyOffice(renderer, { plan: layout.plan || 'hq' }) : new THREE.Scene();
  if (!MYOFFICE) scene.background = new THREE.Color(0xe7edf3);
  if (!MYOFFICE && layout.outdoor === 'my-office-city') { scene.background = new THREE.Color(0xccd8e4); scene.fog = new THREE.Fog(0xccd8e4, 90, 230); } // sương xa như my-office: các dãy phố xa nhạt dần
  const camera = new THREE.PerspectiveCamera(35, 1, 0.3, 600);
  function resize() { const w = canvas.clientWidth || 680, h = canvas.clientHeight || 480; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(canvas); resize();

  // ---------- dựng cảnh ----------
  const ctx = createBuilder();
  makeMaterials(ctx);
  // bên ngoài: giữ đường phố SYSONE; layout.outdoor = 'my-office-city' thì thay bằng cả thành phố my-office (thử nghiệm)
  const CITY = !MYOFFICE && layout.outdoor === 'my-office-city'; // (mặc định: giữ đường phố SYSONE, chỉ mặt đường theo chất liệu my-office)
  const city = CITY ? buildMyCity(renderer, { plan: 'pro', offset: [-3, -1.5] }) : null;
  if (CITY) scene.add(city.group);
  if (!MYOFFICE) scene.add(ctx.house, ctx.roofG, ctx.interior);
  if (!MYOFFICE && !CITY) scene.add(ctx.nb, ctx.st); // (dựng nhưng không hiện khi có thành phố — giữ cho các phần khác dùng)
  const clipPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -XL), new THREE.Plane(new THREE.Vector3(-1, 0, 0), XR)];
  if (BIG) buildSysoneShell(ctx); else if (REAL) realShell.buildRealShell(ctx, model); else buildHouse(ctx, model);
  const gate = buildFence(ctx, BIG ? { lot: { x0: -13.3, x1: 13.2, z0: -14.6 } } : REAL ? { lot: { x0: -6.4, x1: 6.4, z0: -13.4 } } : {});
  const nbCol = ctx.COL.length;
  buildNeighbors(ctx);
  if (BIG) spreadNeighbors(ctx, nbCol, -10, 10); else if (REAL) spreadNeighbors(ctx, nbCol, -3.1, 3.1);
  const street = buildStreet(ctx, clipPlanes);
  const bld = BIG ? buildMyBuilding(renderer, { offset: SHELL.OFFSET, stripDesks: true }) : null;
  const inter = BIG ? moInterior(ctx, model) : buildInterior(ctx, model);
  if (BIG) ctx.interior.add(inter.deskLayer); // bàn dựng theo dụng cụ (bấm chọn được như nhà cũ)
  if (!BIG && !REAL) buildCeilings(ctx, model); // (Real SYS: trần dựng trong realShell)
  const signInfo = await buildSign(ctx, BASE);
  const baseSide = new THREE.MeshLambertMaterial({ color: 0x7d8186 }), baseTop = new THREE.MeshLambertMaterial({ color: 0xcfd1cc });
  // bệ đế (như sân thượng của my-office: cao hơn mặt đường 0.58 m); có thành phố thì phủ hết khu đất trống giữa phố
  const BP = CITY ? city.SB : { x0: XL, x1: XR, z0: BIG ? -16 : REAL ? -13.6 : -10.5, z1: 30.5 };
  const basePlate = new THREE.Mesh(new THREE.BoxGeometry(BP.x1 - BP.x0, 0.57, BP.z1 - BP.z0), [baseSide, baseSide, baseTop, baseSide, baseSide, baseSide]);
  basePlate.position.set((BP.x0 + BP.x1) / 2, -0.315, (BP.z0 + BP.z1) / 2); basePlate.receiveShadow = true; if (!MYOFFICE) scene.add(basePlate);
  if (CITY) scene.add(buildLotGarden(city.SB, { x0: -3.6, x1: 3.55, z0: -7.5, z1: 9.35 }, [0.15, 2.95], ctx.COL)); // sân vườn quanh nhà

  // ánh sáng (đơn vị vật lý của three r155+: nhân ~π so với bản r128)
  const sun = new THREE.DirectionalLight(0xfff3dc, 1.9); // (my-office: dùng đèn của nó — nắng, bầu trời, đèn phòng)
  if (!MYOFFICE && !BIG) {
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b1a4, 2.4));
    sun.position.set(20, 40, 32); sun.castShadow = QUALITY !== 'low';
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 120 });
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03; scene.add(sun);
    if (REAL) { for (const f of model.floors) if (!f.open) for (const z of [1.2, -3.8, -8.6]) { const pl = new THREE.PointLight(0xfff0d8, 7, 0, 1.6); pl.position.set(0, f.ceiling - 0.4, z); scene.add(pl); } }
    else for (const f of model.floors) { const pl = new THREE.PointLight(0xfff0d8, 9, 0, 1.6); pl.position.set(0, f.ceiling - 0.4, -1.5); scene.add(pl); }
  }

  // bóng đổ rồi gộp mesh tĩnh
  if (!MYOFFICE) scene.traverse(o => { if (o.isMesh) { const m = o.material; const noS = Array.isArray(m) ? false : (m.userData.noShadow || m.transparent || m.isMeshBasicMaterial); o.castShadow = QUALITY !== 'low' && !noS; o.receiveShadow = QUALITY !== 'low'; } });
  ctx.interior.traverse(o => { if (o.isMesh) o.castShadow = false; }); // nội thất nằm dưới mái: không cần đổ bóng nắng
  for (const g of ctx.mergeLater || []) mergeStatic(g, { force: true });
  const mergeInfo = [ctx.house, ctx.nb, ctx.st, ctx.roofG, ctx.interior].map(g => mergeStatic(g));
  if (BIG) { // nội thất my-office (đã gộp hình, bóng đổ theo bản gốc) + nắng, bầu trời, đèn phòng của my-office
    bld.root.position.y = SHELL.Y0; scene.add(bld.root);
    buildDeptSigns(scene, layout, model); // biển tên 13 phòng ban treo trần (src/shared/departments.js)
    ctx.music = new MusicCorner(scene, model, ctx.COL); // góc âm nhạc ở phòng giải trí (đi tới, bấm E để mở nhạc)
    for (const l of bld.lights) { l.position.x += SHELL.OFFSET[0]; l.position.z += SHELL.OFFSET[1]; if (l.target) { l.target.position.x += SHELL.OFFSET[0]; l.target.position.z += SHELL.OFFSET[1]; scene.add(l.target); } scene.add(l); }
    scene.environment = bld.scene.environment;
    // đèn phòng của my-office chỉ bật ban đêm (ban ngày cường độ 0) — ở đây chu kỳ ngày đêm của my-office không chạy, nên ẩn
    // hẳn: mỗi đèn điểm còn trong cảnh (kể cả cường độ 0) bắt mọi điểm ảnh của mọi bề mặt tính thêm một nguồn sáng (23 đèn)
    bld.root.traverse(o => { if (o.isPointLight || o.isSpotLight) o.visible = false; });
    // nội thất nằm dưới mái và trong tường: nắng không chiếu tới — không cần đổ bóng (bớt cả nghìn lệnh vẽ ở lượt bóng)
    bld.root.traverse(o => { if (o.isMesh) { o.castShadow = false; for (const m of [].concat(o.material)) if (m) m.userData.keepSide = true; } });
    for (const l of bld.lights) { if (l.shadow?.mapSize) { l.shadow.mapSize.set(1024, 1024); Object.assign(l.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 }); l.shadow.camera.updateProjectionMatrix(); } if (SOFT_GL || QUALITY === 'low') l.castShadow = false; }
  }
  const deskState = createDeskState({ scene, model, inter }); // màu ghế theo người ngồi, viền sáng bàn đang trỏ/chọn (như my-office)
  let hoverDesk = null;

  // ---------- mô phỏng ----------
  loading.step('Đang đưa mọi người vào văn phòng…', 62, 80);
  let sim = new Simulation(model, nav, staff, { start: params.get('t') || '07:30' });
  let avatars = new AvatarSystem(scene, Math.max(1, sim.agents.length), QUALITY, { scale: model.cs, seatH: layout.scale?.seatHip ?? 0.53 * model.fs, moStaff: characterDef('mo-nam') });
  avatars.setColors(sim.agents);
  const debug = new DebugLayers(scene, model, nav, sim);

  let gateT = 0, gateTarget = 0;
  // va chạm camera: my-office lấy tường trong layout (cao tới trần) và mặt sàn văn phòng
  const moCOL = MYOFFICE ? (layout.walls || []).map(w => ({ x0: w.x0, x1: w.x1, y0: 0, y1: 4.2, z0: w.z0, z1: w.z1 })) : null;
  const moFL = MYOFFICE ? (layout.nav.areas || []).map(a => ({ x0: a.x0 - 0.2, x1: a.x1 + 0.2, z0: a.z0 - 0.2, z1: a.z1 + 0.2, top: 0 })) : null;
  if (BIG) { // va chạm với đồ đạc và vách của my-office (cùng dữ liệu với lưới đi bộ): người không đi xuyên, camera không xuyên vách
    for (const b of layout.nav.blocked || []) { const y = model.floorY(b.floor); ctx.COL.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, y0: y, y1: y + 1.4, low: true }); }
    for (const w of layout.walls || []) { if (w.openings?.length) continue; const y = model.floorY(w.floor); ctx.COL.push({ x0: w.x0, x1: w.x1, z0: w.z0, z1: w.z1, y0: y, y1: y + 4.0, glass: w.material === 'glass' }); } // (tường vỏ nhà có cửa: đã có từng đoạn)
  }
  const rig = new CameraRig(camera, canvas, { COL: moCOL || ctx.COL, FL: moFL || ctx.FL, gateOpen: () => gateT > 0.5, bounds: BIG ? { z0: -16, z1: 30.2 } : REAL ? { z0: -13.2, z1: 30.2 } : null, fixedFollow: BIG || REAL, sameSpace: REAL ? (a, C) => { if (!inRealBuilding(a.x, a.z) || (a.f || 0) >= 3) return true; return inRealBuilding(C.x, C.z, 0.1); } : BIG ? (a, C) => { const r = SHELL.shellFloors().inner.find(q => q.floor === (a.f || 0)); if (!r || a.x < r.x0 || a.x > r.x1 || a.z < r.z0 || a.z > r.z1) return true; return C.x > r.x0 + 0.2 && C.x < r.x1 - 0.2 && C.z > r.z0 + 0.2 && C.z < r.z1 - 0.2; } : null });
  if (MYOFFICE) { const a0 = layout.nav.areas[0]; setWorldView(a0); rig.go('A'); rig.snap?.(); }
  let clampIndoorBig = null;
  if (REAL) clampIndoorBig = (p, a) => { // trong nhà: camera dưới trần tầng đang đứng
    if (!a) return; const fl = model.floorById.get(a.f || 0);
    if (!fl || fl.open || !inRealBuilding(a.x, a.z)) { p.y = Math.max(p.y, a.y + 0.25); return; }
    p.y = Math.min(fl.ceiling - 0.15, p.y);
  };
  if (BIG) { // người chơi đang trong nhà: camera bám sau lưng luôn ở trong nhà, dưới trần (không lọt ra ngoài qua ô cửa chính)
    const inner = SHELL.shellFloors().inner;
    clampIndoorBig = (p, a) => {
      if (!a) return;
      const r = inner.find(q => q.floor === (a.f || 0)); if (!r) return;
      if (a.x < r.x0 || a.x > r.x1 || a.z < r.z0 || a.z > r.z1) { p.y = Math.max(p.y, a.y + 0.25); return; } // (ngoài sân, sân thượng, cầu thang: chỉ giữ trên mặt đất)
      const m = 0.25, y = model.floorY(a.f || 0);
      void m; p.y = Math.min(y + 3.85, p.y); // (chỉ giữ dưới trần; không kéo camera lại, không cắt cảnh)
    };
  }
  rig.onWalkChange = on => { $('pad').hidden = !on; if (on) { $('cR').checked = false; setCut(null); if (app.session?.seated) app.session.stand(false); } };
  canvas.addEventListener('keydown', e => { if (rig.walkMode && (e.key === 'e' || e.key === 'E')) app.session?.sitNearest(); });

  // ---------- cắt tầng ----------
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
  let cutFloor = null;
  function setCut(f) {
    cutFloor = f;
    const on = f !== null && f !== undefined;
    if (on) { cutPlane.constant = model.floorY(f) + 2.2; renderer.clippingPlanes = [cutPlane]; }
    else renderer.clippingPlanes = [];
    rig.cutY = on ? cutPlane.constant : Infinity; // camera bỏ qua phần tường đã bị cắt
    const allMats = new Set(); scene.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => allMats.add(m)); });
    // (giữ nguyên mặt vẽ của viền mực: nếu đổi sang hai mặt, lớp vỏ viền phủ đen cả nhân vật)
    for (const m of allMats) { if (m.userData.keepSide) continue; if (m.userData.side0 === undefined) m.userData.side0 = m.side; m.side = on ? THREE.DoubleSide : m.userData.side0; m.needsUpdate = true; }
    sun.castShadow = !on && QUALITY !== 'low';
    document.querySelectorAll('[data-floor]').forEach(b => b.classList.toggle('on', on ? b.dataset.floor === String(f) : b.dataset.floor === 'all'));
  }
  const floorSeg = $('floors');
  for (const f of model.floors) { const b = document.createElement('button'); b.dataset.floor = f.id; b.textContent = f.name; floorSeg.appendChild(b); }
  floorSeg.querySelectorAll('button').forEach(b => b.onclick = () => { app.autoCut = false; rig.follow = null; app.onFollowChange?.(false); const f = b.dataset.floor === 'all' ? null : +b.dataset.floor; setCut(f); if (f !== null && !rig.follow) floorView(f); });
  function floorView(f) { if (rig.follow) { rig.follow = null; app?.onFollowChange?.(false); } if (BIG) rig.view(0.35, 0.72, 31, [1.15, model.floorY(f) + 0.5, -4.3]); else if (REAL) rig.view(0.35, 0.7, 24, [0, model.floorY(f) + 0.5, -3.4]); else rig.view(0.35, 0.62, 19, [0, model.floorY(f) + 0.5, -1.4]); }

  // ---------- app ----------
  let deskSig = null; // (chữ ký cấu hình bàn đã dựng — app.rebuildDesks)
  const app = {
    model, nav, rig, debug, renderer, scene, camera, sim, staff, empData, signInfo, mergeInfo, quality: QUALITY, street,
    speed: +(params.get('speed') || 10), paused: params.has('paused'), autoCut: false,
    resize,
    select(a, follow) {
      panel.selected = a;
      rig.follow = follow && a ? a : null;
      if (follow && a) { if (rig.walkMode) rig.setWalk(false); rig.G.r = 8; rig.G.ph = 0.95; app.autoCut = true; }
      if (!a) { rig.follow = null; }
      panel.renderCard(); panel.renderList(false);
    },
    jump(t) {
      loading.flash('Đang tua…');
      setTimeout(() => { sim.advanceTo(t); loading.hideFlash(); }, 20);
    },
    importCsv(text, name) {
      const parsed = parseSeatingCsv(text);
      const applied = applySeating(app.empData, parsed.rows);
      const next = validateStaff(model, applied.data);
      const msgs = [...parsed.errors, ...applied.errors];
      const sameSet = next.active.length === sim.agents.length && next.active.every(e => sim.byId.has(e.id));
      app.empData = applied.data; app.staff = staff = next;
      if (sameSet) {
        sim.staff = next;
        for (const e of next.active) {
          const a = sim.byId.get(e.id);
          if (a.emp.deskId === e.deskId) continue;
          a.emp.deskId = e.deskId;
          if (a.atDesk) a.moveDesk = true; else { a.desk = model.deskById.get(e.deskId); a.deskSeat = a.desk.seat; }
        }
      } else rebuildSim();
      panel.showErrors(next.errors, [...msgs, ...next.warnings, `Đã nhập ${name}: cập nhật ${applied.updated} người.`]);
      panel.renderList(true);
    },
    meConfig: me.config, outerBlinds: ctx.outerBlinds, big: BIG, real: REAL,
    rebuildDesks(force = false) {
      // dựng lại cả lớp bàn (vài trăm ms, máy yếu 1–2 s — khựng hình) chỉ khi cấu hình bàn thật sự đổi: tin "seats" đến mỗi khi
      // bất kỳ ai nhận/trả chỗ, và lúc vào trang server gửi lại đúng dữ liệu vừa tải (trước đây dựng lại hai lần)
      const sig = model.desks.map(d => { const e = session.equipFor(d) || {}; return JSON.stringify(BIG ? e.equipment ?? null : [e.equipment ?? null, e.nameplate ?? null]); }).join('|');
      if (!force && sig === deskSig) return; deskSig = sig;
      inter.rebuildDesks(d => session.equipFor(d), { receiveShadow: QUALITY !== 'low' }); if (cutFloor !== null) setCut(cutFloor); app.freezer?.add(scene, o => o.name === 'avatars' || o.name === 'nameTags'); app.detail?.add(scene, o => o.name === 'avatars' || o.name === 'nameTags' || o.isLight); app.releaseRam?.();
    },
    showFloor(f, moveCam = true) { app.autoCut = false; setCut(f); if (moveCam && f !== null) floorView(f); },
    cutFloor: () => cutFloor,
    followTarget(a) { if (rig.walkMode) rig.setWalk(false); rig.follow = a; rig.G.r = 8; rig.G.ph = 0.95; app.autoCut = true; },
    applyStaff,
    exportCsv() {
      const blob = new Blob(['﻿' + seatingCsv(staff.employees)], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'so-do-cho-ngoi.csv'; a.click(); URL.revokeObjectURL(a.href);
    }
  };
  app.clampIndoor = clampIndoorBig; // (toà nhà lớn: camera bám sau lưng không lọt ra ngoài nhà, dưới trần)

  /** Cập nhật nhân viên mô phỏng khi chủ chỗ thay đổi: đổi bàn tại chỗ, người hết bàn rời mô hình. */
  function applyStaff(next, notes = []) {
    const ids = new Set(next.active.map(e => e.id));
    const added = next.active.some(e => !sim.byId.has(e.id) || sim.byId.get(e.id).evicted);
    app.staff = staff = next;
    if (added) rebuildSim();
    else {
      sim.staff = next;
      for (const a of sim.agents) {
        if (!ids.has(a.id)) { if (!a.evicted) a.evict(); continue; }
        const e = next.active.find(x => x.id === a.id);
        if (a.emp.deskId === e.deskId) continue;
        a.emp.deskId = e.deskId;
        if (a.atDesk) a.moveDesk = true; else { a.desk = model.deskById.get(e.deskId); a.deskSeat = a.desk.seat; }
      }
    }
    panel.showErrors(next.errors, [...notes, ...next.warnings]);
    panel.renderList(true);
  }
  function rebuildSim() {
    const t = sim.t;
    sim = new Simulation(model, nav, staff, { start: '06:00' });
    sim.advanceTo(t);
    app.sim = sim; debug.sim = sim;
    scene.remove(avatars.group); disposeObject(avatars.group); // (giải phóng GPU của bộ nhân vật cũ)
    avatars = new AvatarSystem(scene, Math.max(1, sim.agents.length), QUALITY, { scale: model.cs, seatH: layout.scale?.seatHip ?? 0.53 * model.fs, moStaff: characterDef('mo-nam') }); avatars.setColors(sim.agents);
    app.select(null);
  }
  const panel = new Panel(app);
  app.panel = panel;
  panel.setDepartments((empData.departments && empData.departments.length) ? empData.departments : [...new Set(staff.employees.map(e => e.department))]);
  const warn = [...staff.warnings];
  if (signInfo.logo !== 'svg') warn.push('Chưa có public/logo/logo-traced.svg: biển đang dùng logo khối tạm. Đặt logo.svg vào assets/ rồi chạy "npm run logo".');
  panel.showErrors(staff.errors, warn);
  panel.renderList(true);

  // phòng 3D riêng cho bi-a / karaoke (src/rooms): vào phòng thì thay cảnh văn phòng bằng cảnh của phòng
  app.envMap = scene.environment;
  app.rooms = new RoomStage(app, { renderer, canvas, host: canvas.parentElement });
  app.bldRoot = bld ? bld.root : null;   // (đồ vật my-office → toạ độ thế giới; nhà vệ sinh, karaoke… cần ngay khi tạo phiên)
  // ---------- phiên người dùng + đồng bộ ----------
  const session = new Session(app, me, hooks, { seats: seatsRes.seats, equipment: equipRes, appearance: lookRes });
  app.session = session;
  // video YouTube của loa công ty chiếu trên TV phòng giải trí (khung trình phát nằm dưới canvas, màn hình TV khoét lỗ)
  const tv = BIG ? new TvVideo(canvas.parentElement, canvas) : null;
  if (tv) { const fitTv = () => tv.setSize(canvas.clientWidth || 680, canvas.clientHeight || 480); new ResizeObserver(fitTv).observe(canvas); fitTv(); tv.place(); }
  app.onMusic = st => { ctx.music?.set(st.on && !st.paused); tv?.setActive(!!st.on); if (session.tv) session.tv.yt = !!st.on; };
  app.musicCorner = ctx.music || null;
  // ---- đèn công ty (công tắc ở sảnh — src/session/lightSwitch.js): bật đèn = buổi tối, đèn các phòng sáng; tắt = ban ngày.
  // Chuyển êm ~1,5 s. Đèn phòng là một bộ đèn điểm cố định (không đổi số đèn → không phải dịch lại shader khi đi giữa các
  // tầng), đặt theo các phòng của tầng đang xem; ban ngày tắt hẳn (không tốn gì).
  const night = { k: 0, want: 0, base: null, lamps: [], floor: -1, check: 0 };
  {
    // số đèn KHÔNG đổi theo ngày/đêm (ban ngày cường độ 0): đổi số đèn bắt GPU dịch lại shader của mọi vật liệu — khựng vài
    // giây trên điện thoại mỗi lần có người bật/tắt đèn. Điện thoại / máy yếu: không dùng đèn điểm (mỗi đèn tốn thêm cho mọi
    // điểm ảnh) — buổi tối giả bằng ánh sáng trời dịu, ấm
    night.lite = isMobile || QUALITY === 'low' || SOFT_GL;
    const N = night.lite ? 0 : 6;
    for (let i = 0; i < N; i++) { const l = new THREE.PointLight(0xffc27a, 0, 10, 1.6); l.castShadow = false; l.name = 'nightLamp'; scene.add(l); night.lamps.push(l); }
    night.dayBg = scene.background?.isColor ? scene.background.clone() : new THREE.Color(0xe7edf3);
  }
  const NIGHT_WARM = new THREE.Color(0xffc98f), NIGHT_BG = new THREE.Color(0x0c1426), NIGHT_SKY = new THREE.Color(0x4a5a8a), NIGHT_SUN = new THREE.Color(0x9fb4ff), _c = new THREE.Color();
  /** Đặt bộ đèn phòng theo các phòng của tầng f (nhiều đèn hơn cho phòng rộng). */
  function placeNightLamps(f) {
    night.floor = f;
    const rooms = (layout.rooms || []).filter(r => r.floor === f), N = night.lamps.length, fl = model.floors.find(x => x.id === f);
    const area = r => (r.x1 - r.x0) * (r.z1 - r.z0), tot = rooms.reduce((s, r) => s + area(r), 0) || 1;
    const spots = [];
    for (const r of rooms) {
      const n = Math.max(1, Math.round(area(r) / tot * N)), alongX = r.x1 - r.x0 >= r.z1 - r.z0;
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; spots.push(alongX ? [r.x0 + (r.x1 - r.x0) * t, (r.z0 + r.z1) / 2] : [(r.x0 + r.x1) / 2, r.z0 + (r.z1 - r.z0) * t]); }
    }
    night.lamps.forEach((l, i) => { const p = spots[i]; l.userData.on = !!p && !!fl; if (p && fl) l.position.set(p[0], (fl.ceiling ?? fl.y + 4) - 0.5, p[1]); });
  }
  /** Lưu cường độ/màu gốc của nắng và bầu trời (lần đầu). */
  function nightBase() {
    if (night.base) return night.base;
    const ls = []; scene.traverse(o => { if ((o.isHemisphereLight || o.isDirectionalLight || o.isAmbientLight) && o.parent === scene) ls.push({ o, i: o.intensity, c: o.color.clone(), g: o.groundColor?.clone() }); });
    return (night.base = { ls, env: scene.environmentIntensity ?? 1 });
  }
  app.__night = night;
  app.setLights = (on, instant = false) => { night.want = on ? 1 : 0; if (instant) night.k = night.want - (night.want ? 0.0001 : -0.0001); };
  function updateNight(dt) {
    if (night.k === night.want && !(night.k > 0 && performance.now() - night.check > 700)) return;
    const b = nightBase();
    if (night.k !== night.want) { const d = night.want - night.k, st = dt / 1.5; night.k = Math.abs(d) <= st ? night.want : night.k + Math.sign(d) * st; }
    const k = night.k * night.k * (3 - 2 * night.k);   // (smoothstep)
    for (const x of b.ls) {
      x.o.intensity = x.i * (1 - k * (x.o.isDirectionalLight ? 0.94 : night.lite ? 0.5 : 0.85));
      x.o.color.copy(x.c).lerp(x.o.isDirectionalLight ? NIGHT_SUN : night.lite ? NIGHT_WARM : NIGHT_SKY, k * 0.7);
    }
    scene.environmentIntensity = b.env * (1 - k * (night.lite ? 0.8 : 0.86));
    if (scene.background?.isColor) scene.background.copy(_c.copy(night.dayBg).lerp(NIGHT_BG, k));
    // đèn phòng: theo tầng mình đang đứng / đang xem
    const me = session.player?.agent, f = me && !me.onStair ? me.f : (cutFloor ?? 0);
    if (night.k > 0) { night.check = performance.now(); if (f !== night.floor) placeNightLamps(f); }
    for (const l of night.lamps) l.intensity = l.userData.on ? 5 * k : 0;
  }
  // ---- camera tạm (soi gương ở nhà vệ sinh — src/session/restroom.js): trộn êm giữa camera bám theo và góc đặt sẵn
  const camOv = { k: 0, want: 0, eye: new THREE.Vector3(), look: new THREE.Vector3() }, _e = new THREE.Vector3(), _l = new THREE.Vector3(), _f = new THREE.Vector3();
  app.setCamOverride = o => { if (o) { camOv.eye.copy(o.eye); camOv.look.copy(o.look); camOv.want = 1; } else camOv.want = 0; };
  function applyCamOverride(dt) {
    if (!camOv.want && camOv.k < 0.001) { camOv.k = 0; return; }
    camOv.k += (camOv.want - camOv.k) * (1 - Math.exp(-dt * 5));
    camera.getWorldDirection(_f); _l.copy(camera.position).add(_f);   // (điểm nhìn của camera bám theo)
    const k = camOv.k * camOv.k * (3 - 2 * camOv.k);
    _e.copy(camera.position).lerp(camOv.eye, k); _l.lerp(camOv.look, k);
    camera.position.copy(_e); camera.lookAt(_l); camera.updateMatrixWorld();
  }
  app.onRoomChange = on => {   // vào phòng: luôn vẽ 3D (kể cả khi đang ở bản 2D), ẩn khung video TV văn phòng
    $('map2d').hidden = on || !app.mode2d; canvas.style.visibility = on || !app.mode2d ? '' : 'hidden';
    if (tv) tv.r.domElement.style.display = on ? 'none' : '';
    if (!on) { last = performance.now(); canvas.focus({ preventScroll: true }); }
  };
  app.bldRoot = bld ? bld.root : null;   // (đồ vật my-office → toạ độ thế giới: src/scene/props.js)
  const deskInfo = BIG ? new DeskInfoBoards(scene, model) : null; // bảng thông tin làm việc trong ngày trên mỗi bàn có chủ
  app.deskInfoSig = id => deskInfo?.items.get(id)?.sig || ''; // (kiểm thử) nội dung bảng trên bàn
  if (session.isAdmin && !localStorage.getItem('sysone.view')) VIEW.mode = '3d'; // CEO mặc định xem 3D (bản 2D đang ẩn: luôn 3D — pixel/billboard.js ENABLE_2D)
  app.rebuildDesks();
  // HUD điều khiển nhân vật
  let followCheck = 0;
  if (session.player) {
    for (const id of ['wO', 'wL', 'wF', 'wS', 'wX']) $(id).hidden = true; // thay đi bộ góc nhìn thứ nhất bằng nhân vật
    const hud = $('hud'); hud.hidden = false;
    hud.innerHTML = `<div id="hudPrompt" class="hud-prompt" hidden></div><div class="hud-keys"><span class="key">WASD</span>đi · <span class="key">Shift</span>chạy · <span class="key">Space</span>nhảy · <span class="key">E</span>ngồi · <span class="key">F</span>rèm · <span class="key">V</span>góc nhìn · <span class="key">C</span>sau lưng · bấm sàn để đi tới · kéo chuột xoay · cuộn zoom</div>
      <div class="hud-acts" role="toolbar" aria-label="Động tác">${ACTIONS.map(a => `<button data-act="${a.act}" title="${a.label} (phím ${a.key})">${icon(a.icon, 18)} ${a.label} <kbd>${a.key}</kbd></button>`).join('')}
      <button id="hudFollow" hidden>${icon('target')} Về nhân vật</button></div>`;
    hud.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { const p = session.player; p.setAct(p.agent.act === b.dataset.act ? null : b.dataset.act); canvas.focus(); });
    $('hudFollow').onclick = () => session.player.follow();
    app.setPrompt = html => { const el = $('hudPrompt'); el.hidden = !html; el.innerHTML = html; };
    app.onActChange = act => hud.querySelectorAll('[data-act]').forEach(b => b.classList.toggle('on', b.dataset.act === act));
    app.onFollowChange = on => { if (on) $('hudFollow').hidden = true; else followCheck = 0; };
    const _go = rig.go.bind(rig); rig.go = k => { _go(k); app.onFollowChange(false); };
  }
  // ---------- thanh điều hướng chung: mọi nút điều khiển một chỗ (3D: ngang dưới đáy; 2D: cột bên trái) ----------
  const ctrlNav = $('ctrlNav');
  function mountNav() {
    // 2D/3D: trong khung logo SYSONE (góc trên trái)
    const seg = document.querySelector('.dock-seg'), proj = $('sessionBar').querySelector('.project');
    if (seg && proj && seg.parentElement !== proj) proj.appendChild(seg);
    // góc nhìn, tầng: trong ngăn kéo bên phải (mở bằng nút mũi tên)
    const menu = $('viewMenu'), slot = $('viewBox');
    if (session.player && slot && !slot.querySelector('.qt-host')) {
      // "Đi nhanh tới" thay cho "Góc nhìn" (khối góc nhìn cũ vẫn giữ trong index.html, ẩn đi)
      slot.querySelector('summary h2').textContent = 'Đi nhanh tới';
      const host = document.createElement('div'); host.className = 'qt-host'; slot.appendChild(host);
      const qt = app.quickTravel = new QuickTravel(app, session, host);
      session.onSeats(() => qt.render());
    } else if (!session.player && menu && slot && menu.parentElement !== slot) { menu.hidden = false; slot.appendChild(menu); }
    // "Của tôi" trong ngăn kéo: Nhân vật của tôi, Hiện chủ chỗ, Âm báo tin nhắn, Đăng xuất
    const meRow = document.querySelector('#meBox .me-row'), look = $('btnLook'), owners = $('cOwners')?.closest('label'), snd = $('cSound')?.closest('label'), out = $('btnLogout');
    if (meRow) { meRow.replaceChildren(...[look, $('btnDash'), $('btnPw'), owners, snd, out].filter(Boolean)); $('meBox').hidden = !meRow.children.length; }
    $('sessionBar').querySelector('.dock')?.remove();
    // thanh dưới một dòng: Đang online + phím chính + nút Phím tắt
    const online = $('onlineBox'), slotO = ctrlNav.querySelector('.nav-online'); if (online && online.parentElement !== slotO) slotO.replaceChildren(online);
    const hud = $('hud'), acts = hud.querySelector('.hud-acts'), keys = hud.querySelector('.hud-keys');
    if (acts) $('keysModal').querySelector('.km-acts').replaceChildren(acts);
    if (keys) ctrlNav.querySelector('.nav-keys').replaceChildren(keys);
    const hf = $('hudFollow'); if (hf && hf.parentElement !== ctrlNav.querySelector('.nav-line')) { hf.className = 'follow-btn'; ctrlNav.querySelector('.nav-line').appendChild(hf); }
  }
  // cửa sổ Phím tắt (mở/đóng có hiệu ứng)
  const km = $('keysModal');
  // (nút Phím tắt: gắn bằng JS — CSP bản production chặn onclick viết trong HTML)
  document.addEventListener('click', e => { if (e.target.closest?.('.keys-btn')) app.openKeys(); });
  app.openKeys = () => { km.querySelector('.km-keys').innerHTML = keyFull(app.mode2d ? KEYROWS2D : KEYROWS3D); km.hidden = false; requestAnimationFrame(() => km.classList.add('show')); $('keysClose').focus(); };
  app.closeKeys = () => { km.classList.remove('show'); setTimeout(() => { km.hidden = true; }, 220); };
  $('keysClose').onclick = app.closeKeys;
  km.addEventListener('click', e => { if (e.target === km || e.target.closest('[data-act]')) app.closeKeys(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !km.hidden) { e.stopPropagation(); app.closeKeys(); } }, true);
  const _renderBar = session.renderBar.bind(session), _renderOnline = session.renderOnline.bind(session);
  session.renderBar = () => { _renderBar(); mountNav(); };
  session.renderOnline = () => { _renderOnline(); mountNav(); };
  mountNav();
  session.onSeats(() => applyStaff(validateStaff(model, simData([...session.seats.values()])), seatNotes));
  if (seatNotes.length) panel.showErrors(staff.errors, [...seatNotes, ...warn]);
  // không có nhân viên mô phỏng: ẩn các khung chỉ dành cho mô phỏng
  if (!empData.employees.length) {
    for (const el of [$('simBox'), $('floorStats').closest('.box'), $('empList').closest('.box'), $('clockOverlay'), $('csv').closest('.row'), $('dPaths').closest('label')]) el.hidden = true;
    document.querySelector('#panel .small code')?.closest('p')?.setAttribute('hidden', '');
  }
  if (me.kind !== 'admin') { $('csv').closest('.row').hidden = true; document.querySelector('#panel .small code')?.closest('p')?.setAttribute('hidden', ''); }
  if (me.kind === 'admin') { const { Dashboard } = await import('./admin/dashboard.js'); app.dashboard = new Dashboard(app, session); }

  // ---------- điều khiển ----------
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { app.autoCut = false; rig.go(b.dataset.view); $('cR').checked = false; });
  $('zi').onclick = () => rig.zoom(0.8); $('zo').onclick = () => rig.zoom(1.25);
  $('wO').onclick = () => { setCut(null); rig.tele(1.55, 12, 0, 0.15); };
  $('wL').onclick = () => { setCut(null); rig.tele(1.5, 1.7, 0, model.floorY(0)); };
  $('wF').onclick = () => { setCut(null); rig.tele(-0.5, 2.6, 0, model.floorY(1)); };
  $('wS').onclick = () => { setCut(null); rig.tele(1.6, -0.9, Math.PI / 2, model.floorY(2)); };
  $('wX').onclick = () => rig.setWalk(false);
  $('cN').onchange = e => { ctx.nb.visible = e.target.checked; };
  $('cS').onchange = e => { ctx.st.visible = e.target.checked; };
  $('cV').onchange = e => { street.vm.visible = e.target.checked; };
  $('cM').onchange = e => { ctx.roofG.visible = !e.target.checked; };
  $('cR').onchange = e => { rig.auto = e.target.checked; };
  document.querySelectorAll('[data-hold]').forEach(el => {
    el.addEventListener('pointerdown', e => { rig.holds[el.dataset.hold] = true; e.preventDefault(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(n => el.addEventListener(n, () => { rig.holds[el.dataset.hold] = false; }));
  });
  // bấm vào avatar
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); ray.layers.enable(HIDE_LAYER);   // (bấm trúng cả vật nhỏ ở xa đang tạm không vẽ — scene/detailCull.js)
  // đang chọn chỗ: rê chuột lên bàn thì bàn sáng viền (như my-office khi trỏ vào đồ vật)
  let hoverAt = 0;
  canvas.addEventListener('pointermove', e => {
    if (!app.session?.selecting || rig.drag || performance.now() - hoverAt < 60) { if (!app.session?.selecting) hoverDesk = null; return; }
    hoverAt = performance.now();
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const maxY = cutFloor === null ? Infinity : cutPlane.constant;
    const h = ray.intersectObjects([ctx.interior, ctx.house].filter(g => g.visible), true).find(x => x.point.y <= maxY && !(x.object.material && x.object.material.transparent));
    const d = h && app.session.deskAt(h.point);
    hoverDesk = d ? d.id : null; canvas.style.cursor = d ? 'pointer' : '';
  });
  canvas.addEventListener('pointerup', e => {
    if (rig.walkMode || (rig.lastMoved || 0) > 6) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const a = avatars.pick(ray, sim.agents, [ctx.house, ...ctx.interior.children.filter(c => c !== inter.deskLayer), ctx.roofG].filter(g => g.visible), cutFloor === null ? Infinity : cutPlane.constant); // (màn hình/đồ trên bàn không che việc bấm vào người đang ngồi)
    if (a) { app.select(a, false); return; }
    // bấm vào rèm: kéo lên/hạ xuống
    const bh = ray.intersectObjects(app.session.blinds.meshes(), false)[0];
    if (bh && bh.point.y <= (cutFloor === null ? Infinity : cutPlane.constant)) { app.session.toggleBlind(bh.object.userData.blind); return; }
    // bấm vào cửa thang máy: chọn tầng
    if (app.session.lift) { const lh = ray.intersectObjects(app.session.lift.meshes(), false)[0]; if (lh && lh.point.y <= (cutFloor === null ? Infinity : cutPlane.constant)) { app.session.openLift(true); return; } }
    // bấm vào bàn: xem chủ chỗ / chọn chỗ / thử ngồi (server quyết định)
    const hits = ray.intersectObjects([ctx.interior, ctx.house].filter(g => g.visible), true);
    const maxY = cutFloor === null ? Infinity : cutPlane.constant;
    const h = hits.find(x => x.point.y <= maxY && !(x.object.material && x.object.material.transparent));
    const d = h && app.session.deskAt(h.point);
    if (d) { app.session.onDeskClick(d); return; }
    // bấm lên sàn khi đang điều khiển nhân vật: tự đi tới đó (kiểu agent-office), xa thì chạy
    const pl = app.session.player;
    if (pl && !rig.fp) {
      // điểm sàn bấm trúng: tính cả sàn nội thất my-office (trước đây tia xuyên qua sàn tầng trên, trúng trần tầng dưới → tưởng
      // là tầng dưới, nhân vật chạy xuống tầng trệt tới điểm chết). Chỉ đi trong tầng đang đứng, tới ô đi được (hoặc ô gần nhất).
      const groundHits = ray.intersectObjects([ctx.interior, ctx.house, ...(bld ? [bld.root] : [])].filter(g => g.visible), true)
        .filter(x => x.point.y <= maxY && x.face && !(x.object.material && x.object.material.transparent));
      const fy = model.floorY(pl.agent.f);
      // thứ đầu tiên trúng ở tầm người (bỏ qua đèn, biển, mép trên vách…): sàn tầng mình → tới đó; đồ vật tầng mình → tới ô
      // trống gần nó nhất; thuộc tầng khác → bỏ qua
      const hit = groundHits.find(x => x.point.y < fy + 2.6);
      const onFloor = hit && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > 0.7 && Math.abs(hit.point.y - fy) < 0.6;
      if (hit && (onFloor || hit.point.y > fy - 0.2)) {
        const g = nav.grid(pl.agent.f), R = onFloor ? 1.0 : 1.4;
        let to = null;
        if (g?.isFree(hit.point.x, hit.point.z, 0.12)) to = { x: hit.point.x, z: hit.point.z };
        else if (g) { const k = g.nearestFree(hit.point.x, hit.point.z, R); if (k >= 0) to = { x: g.cx(k), z: g.cz(k) }; }
        if (to && Math.hypot(to.x - hit.point.x, to.z - hit.point.z) > R) to = null;
        if (to && pl.walkTo(to.x, to.z, pl.agent.f)) showMarker({ x: to.x, y: fy, z: to.z });
      }
    }
  });
  // ---------- văn phòng 2D: bên trong toà nhà vẽ 2D (pixel), ngoài trời vẫn 3D ----------
  setBillboardCamera(camera);
  const map2d = new OfficeMap2D(app, $('map2d'));
  app.mode2d = false;
  // gợi ý phím: mỗi thao tác một dòng
  // gợi ý phím: một dòng 3 phím chính + nút "Phím tắt" (mở cửa sổ đầy đủ)
  const keyCaps = k => k.split(' ').map(x => `<span class="key">${x}</span>`).join('');
  const keyFull = rows => '<ul class="keylist">' + rows.map(([k, t]) => `<li><span class="keys">${keyCaps(k)}</span><span class="what">${t}</span></li>`).join('') + '</ul>';
  const keyLine = (rows, n = 3) => `<span class="keys-short">${rows.slice(0, n).map(([k, t]) => `<span class="ks">${keyCaps(k)}<span class="what">${t}</span></span>`).join('')}</span><button type="button" class="keys-btn" title="Xem tất cả phím tắt và động tác">${icon('keyboard')} Phím tắt</button>`;
  const KEYROWS3D = [['W A S D', 'Đi'], ['Shift', 'Chạy'], ['E', 'Ngồi / đứng dậy'], ['B', 'Về bàn làm việc (tự đi tới và ngồi)'], ['T', 'Chat nội bộ'], ['Space', 'Nhảy'], ['F', 'Kéo / hạ rèm khi đứng gần cửa sổ'], ['V', 'Góc nhìn thứ nhất / thứ ba'], ['C', 'Đưa camera về sau lưng'], ['Chuột', 'Bấm sàn để tự đi tới'], ['Kéo', 'Xoay camera — khi đang xem xung quanh (Esc)'], ['Cuộn + −', 'Phóng to / thu nhỏ'], ['2 ngón', 'Điện thoại: chụm để zoom, kéo ngang để xoay'], ['Esc', 'Xem xung quanh bằng chuột (bật / tắt) · đi tiếp: camera theo lại sau lưng']];
  const KEYROWS2D = [['W A S D', 'Đi'], ['Shift', 'Chạy'], ['E', 'Ngồi / đứng dậy'], ['F', 'Kéo / hạ rèm khi đứng gần cửa sổ'], ['Chuột', 'Bấm sàn để tự đi tới'], ['Chuột', 'Bấm bàn để xem chủ chỗ'], ['Cầu thang', 'Đi vào cầu thang để lên / xuống tầng'], ['Esc', 'Xem xung quanh bằng chuột (bật / tắt) · đi tiếp: camera theo lại sau lưng']];
  const KEYS3D = keyLine([...KEYROWS3D.slice(0, 3), ['Esc', 'Xem xung quanh']], 4), KEYS2D = keyLine(KEYROWS2D); // (3D: thêm Esc — xoay camera bằng chuột)
  { const k = document.querySelector('.hud-keys'); if (k) k.innerHTML = KEYS3D; }
  // chuyển 2D/3D có mờ chuyển cảnh ~0.2 s; luôn theo chế độ đích MỚI NHẤT (đổi nhanh liên tiếp không bị kẹt sai chế độ)
  let modeTarget = false, modeTimer = 0;
  function setMode2D(on) {
    if (on === modeTarget) return;
    modeTarget = on;
    if (modeTimer) return; // đang mờ chuyển: khi xong sẽ áp dụng modeTarget
    const fade = $('modeFade'); fade.classList.add('on');
    modeTimer = setTimeout(() => {
      modeTimer = 0; on = modeTarget;
      if (on === app.mode2d) { setTimeout(() => fade.classList.remove('on'), 60); return; }
      app.mode2d = on;
      $('map2d').hidden = !on; $('c3').style.visibility = on ? 'hidden' : '';
      document.body.classList.toggle('mode2d', on);
      const keys = document.querySelector('.hud-keys'); if (keys) keys.innerHTML = on ? KEYS2D : KEYS3D;
      const pl = app.session?.player;
      if (on) { if (rig.fp) rig.setFirstPerson(false); map2d.cam.ready = false; }
      else if (pl) { rig.S.th = rig.G.th = pl.agent.yaw; rig.camDist = null; pl.follow(); }
      setTimeout(() => fade.classList.remove('on'), 60);
    }, 220);
  }
  app.onWalkTarget2D = w => { map2d.target = w; };
  /** Đổi chế độ hiển thị 2D/3D (lưu trên máy). Vị trí, chỗ ngồi, người khác dùng chung nên hai chế độ luôn đồng bộ. */
  app.setView = mode => {
    if (!ENABLE_2D) mode = '3d'; // (bản 2D tạm ẩn)
    VIEW.mode = mode === '3d' ? '3d' : '2d'; localStorage.setItem('sysone.view', VIEW.mode);
    app.session?.remote.refreshColors(); app.session?.renderBar?.();
  };
  // vòng đánh dấu nơi sẽ đi tới
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.11, 28), new THREE.MeshBasicMaterial({ color: 0xff8a5b, transparent: true, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2; marker.visible = false; marker.renderOrder = 5; scene.add(marker);
  let markerT = 0;
  function showMarker(p) { marker.position.set(p.x, p.y + 0.01, p.z); marker.visible = true; markerT = 0; }
  app.onPathEnd = () => { marker.visible = false; map2d.target = null; };
  rig.onUserOrbit = () => {};

  // ---------- vòng lặp ----------
  let lastDraw = 0;
  // ---- độ phân giải tự điều chỉnh (kiểu PerformanceMonitor): khung hình tụt (< 40 /s trong ~2 s) thì hạ từng bậc 0,25×
  // (thấp nhất 1×); ổn định lâu (> 57 /s trong ~5 s) thì nâng lại tới mức tối đa. Đổi qua lại quá 3 lần thì đứng yên.
  // Đã ở 1× mà vẫn chậm: ghi nhớ "chất lượng thấp" cho phiên này (lần tải sau tắt khử răng cưa).
  const adapt = { low: 0, high: 0, flips: 0, last: 0 };
  function adaptPR(f) {
    if (PR > 0 || SOFT_GL || window.__RENDER_EVERY_MS || (+(params.get('maxfps') || window.__MAXFPS || 0)) || document.hidden) return;
    const cur = renderer.getPixelRatio();
    adapt.low = f < 40 ? adapt.low + 1 : 0; adapt.high = f > 57 ? adapt.high + 1 : 0;
    if (adapt.low >= 4) {
      adapt.low = 0;
      if (cur > 1.01) { renderer.setPixelRatio(Math.max(1, cur - 0.25)); resize(); if (adapt.last > 0) adapt.flips++; adapt.last = -1; }
      else if (renderer.shadowMap.enabled) { // đã ở 1× mà vẫn chậm: tắt bóng đổ ngay (lượt vẽ bóng tốn gần gấp đôi draw call)
        renderer.shadowMap.enabled = false; scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
      }
      else if (f < 30) { try { sessionStorage.setItem('sysone.quality', 'low'); } catch { /* */ } }
    } else if (adapt.high >= 10 && cur < PR_MAX - 0.01 && adapt.flips < 3) {
      adapt.high = 0; renderer.setPixelRatio(Math.min(PR_MAX, cur + 0.25)); resize(); if (adapt.last < 0) adapt.flips++; adapt.last = 1;
    }
  }
  let last = performance.now(), fps = 60, frames = 0, perfT = 0, cutCheck = 0;
  // tab ẩn: trình duyệt tự dừng requestAnimationFrame (không vẽ, không tốn pin). Quay lại: tính giờ từ lúc đó, bỏ qua bộ đếm
  // khung hình cũ (không để khoảng nghỉ làm thuật toán tự hạ độ phân giải tưởng máy chậm)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = performance.now(); frames = 0; perfT = 0; adapt.low = adapt.high = 0; } });
  // bản đồ nhỏ góc dưới bên phải (cảnh 3D)
  const minimap = session.player ? new Minimap($('appRoot'), app) : null;
  // nhãn nhỏ cho biết chế độ camera (bám theo / xem xung quanh) — hiện vài giây khi đổi chế độ, mờ dần
  if (session.player) {
    const hint = document.createElement('div'); hint.className = 'cam-hint'; hint.setAttribute('role', 'status'); canvas.parentElement.appendChild(hint);
    const touch = isTouchUI(); let hideT = 0;
    const show = (on, nudge = false) => {
      if (nudge) { // kéo chuột khi camera đang bám theo: nhắc cách xoay
        hint.innerHTML = '<kbd>Esc</kbd> <b>để xoay camera bằng chuột</b> · đi tiếp: camera tự theo lại';
        hint.classList.remove('look'); hint.classList.add('show', 'nudge'); clearTimeout(hideT);
        hideT = setTimeout(() => hint.classList.remove('show', 'nudge'), 3500); return;
      }
      hint.classList.remove('nudge');
      hint.innerHTML = on ? (touch ? '<b>Xem xung quanh</b> · đi để camera theo lại' : '<b>Đang xem xung quanh</b> · kéo chuột để xoay · đi tiếp hoặc <kbd>Esc</kbd> để camera theo lại')
        : (touch ? '<b>Camera theo bạn</b> · vuốt để xem xung quanh' : '<b>Camera theo nhân vật</b> · <kbd>Esc</kbd> để xem xung quanh bằng chuột');
      hint.classList.toggle('look', on); hint.classList.add('show'); clearTimeout(hideT);
      hideT = setTimeout(() => hint.classList.remove('show'), on ? 4000 : 2600);
    };
    rig.onLookModeChange = on => show(on);
    if (!touch) rig.onDragInFollow = () => show(false, true);
    // lần đầu vào: cho biết cách xem xung quanh (lâu hơn bình thường)
    setTimeout(() => { if (rig.follow === session.player.agent && !rig.lookMode) { show(false); clearTimeout(hideT); hideT = setTimeout(() => hint.classList.remove('show'), 6000); } }, 1500);
  }
  if (session.player && isTouchUI()) app.touch = new TouchControls(app, session); // điện thoại: cần điều khiển + nút Tương tác / Nhảy / Về bàn
  // nhãn tên + phòng ban trên đầu mọi người (thay nhãn cũ của người online)
  const tags = new NameTags(scene, canvas.parentElement); session.remote.tags.visible = false;
  { // nhãn tên không nhìn xuyên tường: đoạn camera → điểm có vướng tường/vách (bỏ qua đồ đạc thấp) không
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    tags.blocked = (x, y, z) => { if (!rig.rayCOL) return false; o.copy(camera.position); d.set(x - o.x, y - o.y, z - o.z); const L = d.length(); if (L < 0.3) return false; d.multiplyScalar(1 / L); return rig.rayCOL(o, d, L, true) < L - 0.2; };
  }
  { const fit = () => tags.setSize(canvas.clientWidth || 680, canvas.clientHeight || 480); new ResizeObserver(fit).observe(canvas); fit(); }
  const deptOfCode = code => { if (!code) return ''; for (const st of session.seats.values()) if (st.owner?.code === code) return departmentOfDesk(st.deskId)?.name || ''; return ''; };
  const myDept = () => session.isAdmin ? 'Ban giám đốc' : (session.me.employee?.department || deptOfCode(session.me.employee?.code));
  /** Tên + phòng ban của một người (bảng tên trong phòng bi-a / karaoke dùng chung kiểu với văn phòng). */
  app.tagInfo = key => {
    if (key === session.key) return { me: true, name: session.isAdmin ? `CEO (${session.me.admin.username})` : session.me.employee.display, dept: myDept() };
    const a = session.remote.byKey.get(key);
    return { name: a?.display || key, dept: a?.department || deptOfCode(key.startsWith('employee:') ? key.slice(9) : null) };
  };
  function updateTags() {
    const list = [];
    for (const a of session.remote.list) {
      if (!a.visible && a !== session.player?.agent) continue;
      if (a.local && a._mirror) continue;   // (đang soi gương: góc nhìn ngang mắt, không hiện nhãn của mình)
      if (a.local) list.push({ key: 'me', me: true, name: session.isAdmin ? `CEO (${session.me.admin.username})` : session.me.employee.display, dept: myDept(), x: a.x, y: a.y + (a.jumpH || 0), z: a.z, f: a.f, sit: a.sit, bubble: session.social?.bubbleOf('me') });
      else if (a.key === 'guide') list.push({ key: 'guide', guide: true, name: 'Chị Mai', dept: '', x: a.x, y: a.y, z: a.z, f: a.f, sit: a.sit });
      else list.push({ key: a.key, name: a.display, dept: a.department || deptOfCode(a.key.startsWith('employee:') ? a.key.slice(9) : null), x: a.x, y: a.y + (a.jumpH || 0), z: a.z, f: a.f, sit: a.sit, bubble: session.social?.bubbleOf(a.key) });
    }
    for (const a of sim.agents) if (a.visible) list.push({ key: 'sim:' + a.id, name: a.emp.name, dept: a.emp.department, x: a.x, y: a.y, z: a.z, f: a.onStair ? null : a.f, sit: a.sit });
    const fl = rig.follow ? (rig.follow.onStair ? null : rig.follow.f) : cutFloor;
    tags.update(list, fl, camera.position, model.cs || 1); tags.place(camera);
  }
  // nút "Về nhân vật": chỉ hiện khi nhân vật của mình không còn ở giữa màn hình (camera đang xem chỗ khác)
  const _pc = new THREE.Vector3();
  function updateFollowBtn() {
    const btn = $('hudFollow'), a = session.player?.agent; if (!btn || !a) return;
    let off = false;
    if (rig.follow !== a && !rig.walkMode) { _pc.set(a.x, a.y + 0.6, a.z); const far = camera.position.distanceTo(_pc) > 16; _pc.project(camera); off = far || _pc.z > 1 || Math.abs(_pc.x) > 0.15 || Math.abs(_pc.y) > 0.2; } // (xem toàn cảnh từ xa cũng tính là không còn ở giữa)
    if (btn.hidden === off) btn.hidden = !off;
  }
  const screenState = new Map(); let screenVer = -1;
  // còi xe (WebAudio, sau khi người dùng đã bấm phím/chuột) và lời tài xế
  let audio = null, roadShown = false, roadMsg = '', roadMsgT = 0;
  function honk() {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audio.currentTime;
      for (const [start, f] of [[0, 410], [0.2, 410], [0, 520], [0.2, 520]]) {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0 + start);
        g.gain.exponentialRampToValueAtTime(0.06, t0 + start + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.17);
        o.connect(g).connect(audio.destination); o.start(t0 + start); o.stop(t0 + start + 0.18);
      }
    } catch { /* trình duyệt chặn âm thanh */ }
  }
  const streetHooks = {
    honk(m, person) { const me1 = session.player?.agent; if (me1 && (person === me1 || Math.hypot(me1.x - m.o.position.x, me1.z - m.o.position.z) < 15)) honk(); },
    insult(text, m, person) { if (person === session.player?.agent) { roadMsg = text; roadMsgT = performance.now(); roadShown = null; } }
  };
  // ?maxfps=N: giới hạn số khung hình mỗi giây (máy yếu, hoặc nhiều trang 3D chạy cùng lúc khi kiểm thử)
  const maxFps = +(params.get('maxfps') || window.__MAXFPS || 0);
  // vòng vẽ: luôn hẹn khung hình kế tiếp TRƯỚC khi chạy — một lỗi bất ngờ trong một khung hình (dữ liệu lạ từ mạng, đồ vật
  // chưa dựng xong…) chỉ làm hỏng khung đó, không làm đứng cả ứng dụng. Lỗi lặp lại liên tục thì báo một lần.
  let frameErrs = 0, frameErrAt = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    try { frameBody(now); }
    catch (e) {
      frameErrs++; last = now;
      if (performance.now() - frameErrAt > 5000) { frameErrAt = performance.now(); console.error('[khung hình] lỗi, bỏ qua khung này:', e); }
      if (frameErrs === 60) session.toast?.('Có lỗi hiển thị — nếu màn hình đứng, hãy tải lại trang.', true);
    }
  }
  function frameBody(now) {
    if (window.__PAUSE_RENDER) { last = now; return; } // (kiểm thử nhiều trang trên GPU giả lập: trang khác đang tải cảnh thì tạm dừng vẽ)
    if (maxFps && now - last < 1000 / maxFps - 2) { return; }
    // (khung giật tới 1 s: nhân vật vẫn đi đủ quãng, không bị "quay chậm")
    const rawDt = Math.min((now - last) / 1000, 1.0), rdt = Math.min(rawDt, 0.1); last = now;
    if (!app.paused) sim.step(rdt * app.speed);
    updateNight(rdt);
    // đang ở phòng bi-a / karaoke: chỉ vẽ phòng (văn phòng không vẽ); phiên làm việc (mạng, người khác, ván bi-a) vẫn chạy
    if (app.rooms.active) {
      session.update(rdt, null, rawDt);
      app.rooms.frame(rdt);
      frames++; perfT += rdt; if (perfT > 0.5) { fps = frames / perfT; frames = 0; perfT = 0; }
      panel.tick(now);
      return;
    }
    if (MYOFFICE || CITY) updateMyOffice(rdt); // đường phố, xe cộ, người đi đường (và đồ vật chuyển động khi dùng cả văn phòng my-office)
    // cổng tự mở khi có người tới gần
    const g = model.waypoints.gate;
    const near = sim.agents.some(a => a.visible && Math.abs(a.x - g.x) < 2.2 && Math.abs(a.z - g.z) < 2.6) || session.remote.list.some(a => Math.abs(a.x - g.x) < 2.2 && Math.abs(a.z - g.z) < 2.6);
    gateTarget = ($('cG').checked || rig.walkMode || near) ? 1 : 0;
    gateT += (gateTarget - gateT) * Math.min(1, rdt * 3 * Math.max(1, Math.min(app.paused ? 1 : app.speed, 6)));
    gate.leafL.rotation.y = gateT * (Math.PI / 2); gate.leafR.rotation.y = Math.PI - gateT * (Math.PI / 2);
    if (!CITY) street.update(rdt, session.remote.list, streetHooks);
    deskState.update(rdt, { sim, session, hoverDesk: session.selecting ? hoverDesk : null });
    // cảnh báo khi nhân vật của mình xuống lòng đường
    const me0 = session.player?.agent;
    const onRoad = !!me0 && me0.z > street.ROAD[0] - 0.1 && me0.z < street.ROAD[1] + 0.1;
    if (onRoad !== roadShown || (onRoad && now - roadMsgT > 3000 && roadMsg)) {
      roadShown = onRoad; if (now - roadMsgT > 3000) roadMsg = '';
      $('roadWarn').hidden = !onRoad;
      $('roadWarn').innerHTML = `<b>⚠ Bạn đang đứng dưới lòng đường</b> — xe cộ qua lại, coi chừng!${roadMsg ? `<div class="insult">🚗 Tài xế: «${roadMsg}»</div>` : ''}`;
    }
    // màn hình bàn: sáng khi có người ngồi làm việc
    if (screenVer !== inter.version) { screenVer = inter.version; screenState.clear(); }
    for (const [id, m] of inter.screens) { const on = sim.deskActive(id) || session.seatedAt(id); if (screenState.get(id) !== on) { m.material = m.onOff ? (on ? 'on' : 'off') : inter.code ? (on ? inter.code.on : inter.code.off) : on ? ctx.M.screenOn : ctx.M.screenOff; screenState.set(id, on); } }
    if (app.autoCut && rig.follow && now - cutCheck > 300) {
      cutCheck = now; const a = rig.follow;
      const f = !a.visible || a.z > 8.9 ? null : (a.onStair ? model.stairById.get(a.onStair).to : a.f);
      if (f !== cutFloor) setCut(f);
    }
    // trong nhà → 2D (bỏ qua vẽ 3D cho nhẹ); ra khỏi nhà → 3D
    const pl2 = app.session?.player;
    // (đang chọn chỗ: giữ 3D — màn hình chọn chỗ là cảnh tổng quan 3D có nhãn từng bàn)
    // chế độ 2D: toàn bộ (trong nhà lẫn đường phố) là bản đồ 2D; chế độ 3D: toàn bộ 3D
    setMode2D(VIEW.mode === '2d' && !!pl2 && !rig.walkMode); // kể cả lúc "Chọn chỗ"
    if (app.mode2d) {
      if ($('hudFollow') && !$('hudFollow').hidden) $('hudFollow').hidden = true; // bản 2D luôn bám nhân vật
      tags.hideAll();
      rig.S.th = rig.G.th = 0; // phím đi theo hướng bản đồ: W lên (cuối nhà), S xuống (cửa ra đường)
      session.update(rdt, null, rawDt);
      if (!(frames % 20)) { // vùng bị che: mép phải thanh điều hướng, mép trái cột bảng
        const nr = ctrlNav.getBoundingClientRect(), pr = $('panel').getBoundingClientRect(), cr = $('map2d').getBoundingClientRect();
        // ngăn kéo bên phải trượt đè lên bản đồ: không tính vào vùng nhìn thấy → mở/đóng không làm bản đồ dịch chuyển
        void pr; void nr; map2d.insetCss = { l: 0, r: 0 }; // thanh dưới một dòng không che bản đồ
      }
      // đang chọn chỗ: xem tầng đang chọn, bám bàn đang chọn (hoặc giữa tầng); bình thường: bám nhân vật
      // tâm màn hình luôn theo nhân vật; chỉ khi vừa bấm chọn bàn / đổi tab tầng (lúc "Chọn chỗ") mới tạm nhìn bàn đó —
      // nhân vật bước đi là quay lại bám nhân vật
      let focus = pl2.agent;
      const pf = session.pickFocus;
      if (session.selecting && pf) {
        if (Math.hypot(pl2.agent.x - pf.ax, pl2.agent.z - pf.az) > 0.05 || pl2.agent.f !== pf.af) session.pickFocus = null;
        else { const d = session.selected && model.deskById.get(session.selected); focus = d ? { x: d.x, z: d.z, f: d.floor } : { x: 0, z: -2, f: session.pickFloor ?? 1 }; }
      }
      map2d.render(rdt, focus);
      frames++; perfT += rdt; if (perfT > 0.5) { fps = frames / perfT; frames = 0; perfT = 0; }
      panel.tick(now);
      return;
    }
    avatars.update(sim.agents);
    inter.code?.update(rdt); // màn hình đang gõ code
    ctx.music?.update(rdt);
    deskInfo?.update(rdt, { session, sim });
    if (marker.visible) { markerT += rdt; const s = 1 + 0.25 * Math.sin(markerT * 6); marker.scale.set(s, s, s); marker.material.opacity = 0.65 + 0.35 * Math.sin(markerT * 6); }
    session.update(rdt, cutFloor === null ? null : cutPlane.constant, rawDt);
    debug.update(cutFloor);
    rig.update(rdt);
    applyCamOverride(rdt);
    minimap?.update(rdt, sim, session);
    updateTags();
    if (++followCheck % 6 === 1) updateFollowBtn();
    // (kiểm thử trên GPU giả lập: window.__RENDER_EVERY_MS — chỉ vẽ thưa; logic vẫn chạy đủ, ma trận vẫn cập nhật cho việc bấm chuột)
    floorCull.update(camera.position, cutFloor, session.player?.agent);
    detail.update(camera.position);
    freezer.sync(); // (vật đứng yên: không tính lại ma trận; vật vừa đổi chỗ thì tính — scene/freeze.js)
    const every = window.__RENDER_EVERY_MS || 0, drawNow = !every || now - lastDraw >= every;
    if (!drawNow) scene.updateMatrixWorld();
    else if (!(app.dashboard && !app.dashboard.el.hidden)) { lastDraw = now; renderer.render(scene, camera); tags.render(scene, camera); tv?.render(camera); } // bảng quản trị phủ gần kín màn hình: không vẽ cảnh 3D bên dưới
    frames++; perfT += rdt;
    if (perfT > 0.5) { fps = frames / perfT; frames = 0; perfT = 0; adaptPR(fps); const i = renderer.info.render; $('perf').textContent = `${fps.toFixed(0)} khung hình/giây · ${i.calls} draw call · ${(i.triangles / 1000).toFixed(0)}k tam giác · ${sim.agents.length} nhân viên · chất lượng ${QUALITY === 'low' ? 'thấp' : 'cao'} (đổi bằng ?q=${QUALITY === 'low' ? 'high' : 'low'})`; }
    panel.tick(now);
  }
  rig.go(params.get('view') || 'A'); rig.snap();
  // ma trận của vật đứng yên: đóng băng (bỏ ~18% CPU mỗi khung hình), vật nào đổi chỗ thì tự cập nhật. Nhân vật (xương
  // đổi mỗi khung hình) không đóng băng. Lượt thứ hai sau vài giây: đồ dựng muộn (khi phiên làm việc đã chạy).
  const freezer = new MatrixFreezer(), noFreeze = o => o.name === 'avatars' || o.name === 'nameTags';
  // tầng bị sàn che (camera trong nhà ở tầng khác, hoặc trên mặt cắt): không vẽ — bớt ~1/3 draw call (scene/floorCull.js)
  const innerRects = BIG ? SHELL.shellFloors().inner : null;
  const floorCull = new FloorCuller(model, { cameraFloor: C => {
    for (const f of model.floors) {
      if (f.open || C.y < model.floorY(f.id) - 0.2 || C.y > f.ceiling + 0.2) continue;
      if (BIG) { const r = innerRects.find(q => q.floor === f.id); return r && C.x > r.x0 && C.x < r.x1 && C.z > r.z0 && C.z < r.z1 ? f.id : null; }
      if (REAL) return inRealBuilding(C.x, C.z) ? f.id : null;
      return null;
    }
    return null;
  } });
  const registerFloorParts = () => {
    if (BIG) bld.floors.forEach((g, i) => floorCull.add(g, i)); // nội thất my-office: mỗi tầng một nhóm
    for (const n of ['blinds', 'deptSigns']) floorCull.addChildrenByBox(scene.getObjectByName(n));
    if (deskInfo) for (const [f, g] of deskInfo.floors) floorCull.add(g, f);
  };
  // vật nhỏ ở xa camera: không vẽ (điện thoại giữ gần hơn) — scene/detailCull.js; ?cull=off để tắt
  const detail = new DetailCuller(isMobile || QUALITY === 'low' ? { base: 11, k: 12 } : { base: 22, k: 16 });
  const noDetail = o => noFreeze(o) || o.name === 'remoteTags' || o.name === 'nightLamp' || o.name === 'wcMirror' || o.isLight;
  const registerDetail = () => { if (params.get('cull') !== 'off') detail.add(scene, noDetail); };
  // RAM: bỏ bản sao hình tĩnh trong RAM sau khi đã lên GPU (scene/releaseRam.js; ?ram=keep để giữ). Điện thoại giữ lại: khi
  // quay lại app sau lúc ở nền, trình duyệt có thể đã thu hồi GPU — còn bản trong RAM thì khôi phục tại chỗ, khỏi tải lại trang
  app.releaseRam = () => {
    if (isMobile || params.get('ram') === 'keep') return;
    const r = releaseGeometryRam(scene, { skip: noDetail }); ramReleased += r.meshes;
  };
  registerFloorParts(); freezer.add(scene, noFreeze); registerDetail();
  setTimeout(() => { registerFloorParts(); freezer.add(scene, noFreeze); registerDetail(); app.releaseRam(); }, 4000);
  app.detail = detail;
  app.freezer = freezer; app.floorCull = floorCull;
  // biên dịch sẵn shader của mọi vật liệu trong cảnh (song song nếu GPU hỗ trợ) trước khi bỏ màn hình chờ: tránh khựng
  // nhiều giây ở khung hình đầu (máy yếu / GPU giả lập phải biên dịch hàng chục chương trình shader một lúc)
  try { loading.step('Đang chuẩn bị đồ hoạ…', 82, 97); if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera); } catch (e) { console.warn('compileAsync', e); }
  session.start();
  loading.done();
  requestAnimationFrame(frame);

  // ---------- API cho script chụp ảnh / kiểm thử ----------
  window.__app = {
    app, ready: true, session, deskState,
    get avatars() { return avatars; },   // (kiểm thử: rig từng nhân vật)
    get pixelRatio() { return renderer.getPixelRatio(); }, quality: QUALITY,   // (kiểm thử: độ phân giải đang vẽ)
    /** (kiểm thử) các vật tia từ điểm màn hình (x, y) chạm vào: tên, nhóm cha, độ cao. */
    rayHits(x, y, n = 6, maxY = Infinity) {
      const r = canvas.getBoundingClientRect(); ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
      return ray.intersectObjects(scene.children, true).filter(h => (h.object.isMesh || h.object.isInstancedMesh) && h.point.y <= maxY).slice(0, n).map(h => { let g = h.object, path = []; while (g && path.length < 4) { path.push(g.name || g.type); g = g.parent; } return { path: path.join('<'), y: +h.point.y.toFixed(2), d: +h.distance.toFixed(2), tr: !!h.object.material?.transparent }; });
    },
    /** (kiểm thử) chênh lệch giữa tâm camera 2D và nhân vật, theo mét. */
    mapCenter() { const a = session.player?.agent; return a ? { dx: +(map2d.cam.x - a.x).toFixed(2), dz: +(map2d.cam.z - a.z).toFixed(2) } : null; },
    view(k) { app.autoCut = false; setCut(null); rig.go(k); rig.snap(); },
    floor(f) { app.autoCut = false; setCut(f); if (f !== null) { floorView(f); rig.snap(); } },
    setTime(s) { sim.advanceTo(parseTime(s)); },
    pause(p = true) { app.paused = p; panel.syncSpeed(); },
    debug(kind, on) { debug.setVisible(kind, on); },
    follow(id) { const a = sim.byId.get(id); app.select(a, true); },
    render() { avatars.update(sim.agents); debug.update(cutFloor); freezer.sync(); rig.update(0.016); rig.snap(); rig.update(0.016); renderer.render(scene, camera); },
    stats() { const s = sim.summary(); return { t: sim.t, byFloor: Object.fromEntries(s.byFloor), byState: s.byState, problems: sim.problems.slice(0, 20), errors: staff.errors, sign: signInfo, merge: mergeInfo, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; },
    fps: () => fps,
    presets: Object.keys(PRESETS)
  };
}

// lỗi dựng cảnh: hiện ngay trên khung 3D
window.addEventListener('unhandledrejection', e => {
  // chỉ khi đang dựng cảnh (chưa vào được văn phòng); lỗi lặt vặt lúc đang dùng không được phủ kín màn hình
  if (!$('loading') || window.__app?.ready) return;
  loading.error(`Không dựng được mô hình: ${e.reason?.message || e.reason}`);
});

/**
 * Nội thất my-office: giao diện giống buildInterior (màn hình bàn, vật liệu ghế). Ghế là của my-office; mặt bàn và dụng cụ
 * dựng lại theo cấu hình từng chỗ (màu bàn, số màn hình, PC/laptop, đèn, cây, bảng tên… — deskKit.buildDesk).
 * Màn hình bật (có người làm việc) chiếu cảnh gõ code chạy liên tục (codeScreen).
 */
function moInterior(ctx, model) {
  const chairMats = new Map(), screens = new Map(), deskGroups = new Map();
  for (const d of buildingDesks()) {
    if (!model.deskById.has(d.id)) continue;
    d.chairM.userData.chair = d.id; chairMats.set(d.id, d.chairM);
  }
  const deskLayer = new THREE.Group(); deskLayer.name = 'desks'; deskLayer.userData.noMerge = true; deskLayer.userData.keep = true;
  const atlas = new NameplateAtlas(), fs = model.fs || 1;
  const api = { chairMats, screens, deskGroups, deskLayer, version: 0, code: codeScreen() };
  api.rebuildDesks = (equipFor, { receiveShadow = true } = {}) => {
    for (const c of [...deskLayer.children]) { deskLayer.remove(c); c.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
    atlas.reset();
    const staticG = new THREE.Group();
    for (const d of model.desks) {
      const { equipment, nameplate } = equipFor(d) || {};
      const scr = [], recep = d.kind === 'reception'; // quầy lễ tân (của my-office): chỉ đặt dụng cụ lên mặt quầy
      void nameplate; staticG.add(buildDesk(ctx, d, model.floorY(d.floor), { ...(equipment || {}), nameplate: false }, { nameplate: null, atlas, screensOut: scr, fs, surfaceOnly: recep, depth: recep ? (d.d || 0.6) - 0.25 : undefined, zOffset: recep ? 0.125 : 0 }));
      staticG.updateMatrixWorld(true);
      if (scr.length) {
        const geos = scr.map(m => { const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); return g; });
        for (const m of scr) m.parent.remove(m);
        const m = new THREE.Mesh(mergeGeometries(geos, false), api.code.off);
        m.userData.deskId = d.id; m.matrixAutoUpdate = false;
        deskLayer.add(m); screens.set(d.id, m);
      } else screens.delete(d.id);
    }
    atlas.commit();
    mergeStatic(staticG);
    staticG.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = receiveShadow; } });
    deskLayer.add(staticG);
    api.version++;
  };
  return api;
}

/** Màn hình đang gõ code: một trình soạn thảo tối, dòng code tô màu, con trỏ nhấp nháy, cuộn dần (vẽ ~6 lần/giây). */
function codeScreen() {
  const W = 256, H = 160, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const on = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), off = new THREE.MeshLambertMaterial({ color: 0x0c0e12 });
  const KW = ['const', 'function', 'return', 'if', 'await', 'import', 'export', 'for', 'let', 'class'], ID = ['user', 'seat', 'floor', 'desk', 'api', 'data', 'res', 'item', 'list', 'config', 'state', 'sysone'];
  const C = { kw: '#c678dd', id: '#e5c07b', fn: '#61afef', str: '#98c379', num: '#d19a66', op: '#abb2bf', cm: '#5c6370' };
  let seed = 7; const rnd = n => { seed = (seed * 9301 + 49297) % 233280; return Math.floor(seed / 233280 * n); };
  const line = () => { const ind = rnd(3) * 2, t = rnd(6); if (t === 0) return [ind, [['cm', '// ' + ID[rnd(12)] + ' ' + ID[rnd(12)]]]];
    if (t === 1) return [ind, [['kw', KW[rnd(10)] + ' '], ['id', ID[rnd(12)]], ['op', ' = '], ['fn', ID[rnd(12)] + '('], ['str', "'" + ID[rnd(12)] + "'"], ['op', ');']]];
    if (t === 2) return [ind, [['kw', 'if '], ['op', '('], ['id', ID[rnd(12)]], ['op', ' > '], ['num', String(rnd(99))], ['op', ') {']]];
    if (t === 3) return [ind, [['kw', 'return '], ['id', ID[rnd(12)]], ['op', '.'], ['fn', ID[rnd(12)] + '()'], ['op', ';']]];
    if (t === 4) return [ind, [['op', '}']]];
    return [ind, [['id', ID[rnd(12)]], ['op', '.'], ['fn', ID[rnd(12)]], ['op', '('], ['num', String(rnd(9))], ['op', ');']]]; };
  const lines = Array.from({ length: 12 }, line); let typed = 0, t = 0, blink = 0;
  const draw = () => {
    g.fillStyle = '#21252b'; g.fillRect(0, 0, W, H); g.fillStyle = '#282c34'; g.fillRect(18, 0, W, H);
    g.fillStyle = '#2f3440'; g.fillRect(0, 0, W, 12); g.fillStyle = '#e06c75'; g.fillRect(4, 4, 4, 4); g.fillStyle = '#e5c07b'; g.fillRect(10, 4, 4, 4); g.fillStyle = '#98c379'; g.fillRect(16, 4, 4, 4);
    g.font = 'bold 10px monospace'; g.textBaseline = 'top';
    const last = lines.length - 1;
    lines.forEach(([ind, toks], i) => {
      const y = 16 + i * 12; g.fillStyle = '#4b5263'; g.fillText(String(i + 1), 2, y);
      let x = 22 + ind * 6, left = i === last ? typed : Infinity;
      for (const [k, s] of toks) { if (left <= 0) break; const part = s.slice(0, left); left -= s.length; g.fillStyle = C[k]; g.fillText(part, x, y); x += g.measureText(part).width; }
      if (i === last && blink < 0.5) { g.fillStyle = '#528bff'; g.fillRect(x + 1, y, 2, 10); }
    });
    tex.needsUpdate = true;
  };
  draw();
  return { on, off, update(dt) {
    t += dt; blink = (blink + dt) % 1; if (t < 1 / 6) return; t = 0;
    const lastLen = lines[lines.length - 1][1].reduce((n, [, s]) => n + s.length, 0);
    typed += 2 + rnd(3); if (typed > lastLen + 3) { lines.shift(); lines.push(line()); typed = 0; }
    draw();
  } };
}
