// TỰ SINH bởi scripts/vendor-cozy.mjs từ src/myoffice/boot.js — không sửa trực tiếp.
// Dựng thế giới văn phòng của dự án my-office (khanh020905/my-office, MIT — mã nguồn trong src/vendor/my-office/src):
// vỏ toà nhà tầng "pro", nội thất, đồ vật, thành phố quanh toà nhà (xe, xe máy, người đi đường). Chỉ chạy các module
// dựng thế giới; người, giao diện, âm thanh, phiên làm việc của dự án gốc không dùng (người trong văn phòng là nhân viên
// của SYSONE, vẽ bằng nhân vật chibi của my-office: src/agents/moCharacters.js).
import * as THREE from 'three';
import { state } from '../vendor/my-office-cozy/src/office/core/state.js';
import * as coreEnv from '../vendor/my-office-cozy/src/office/core/env.js';
import * as sceneRenderer from '../vendor/my-office-cozy/src/office/scene/renderer.js';
import * as sceneLights from '../vendor/my-office-cozy/src/office/scene/lights.js';
import * as sceneQuality from '../vendor/my-office-cozy/src/office/scene/quality.js';
import * as worldTerrace from '../vendor/my-office-cozy/src/office/world/terrace.js';
import * as worldBackdropsCity from '../vendor/my-office-cozy/src/office/world/backdrops/city.js';
import * as worldLayout from '../vendor/my-office-cozy/src/office/world/layout.js';
import * as worldCozyRoom from '../vendor/my-office-cozy/src/office/world/cozy-room.js';
import * as worldWindows from '../vendor/my-office-cozy/src/office/world/windows.js';
import * as worldFurnitureRoomPieces from '../vendor/my-office-cozy/src/office/world/furniture/room-pieces.js';
import * as worldFurnitureServerRacks from '../vendor/my-office-cozy/src/office/world/furniture/server-racks.js';
import * as worldFurnitureRocket from '../vendor/my-office-cozy/src/office/world/furniture/rocket.js';
import * as worldFurnitureBoard from '../vendor/my-office-cozy/src/office/world/furniture/board.js';
import * as worldEntrance from '../vendor/my-office-cozy/src/office/world/entrance.js';
import * as peopleBedding from '../vendor/my-office-cozy/src/office/people/bedding.js';
import * as worldDesks from '../vendor/my-office-cozy/src/office/world/desks.js';
import * as worldFurnitureMeeting from '../vendor/my-office-cozy/src/office/world/furniture/meeting.js';
import * as worldFurnitureCoffee from '../vendor/my-office-cozy/src/office/world/furniture/coffee.js';
import * as worldFurniturePlantsLamps from '../vendor/my-office-cozy/src/office/world/furniture/plants-lamps.js';
import * as worldPropsTrinkets from '../vendor/my-office-cozy/src/office/world/props/trinkets.js';
import * as worldProPieces from '../vendor/my-office-cozy/src/office/world/pro/pieces.js';
import * as worldProFloor from '../vendor/my-office-cozy/src/office/world/pro/floor.js';
import * as worldProWing from '../vendor/my-office-cozy/src/office/world/pro/wing.js';
import * as worldPropsAquarium from '../vendor/my-office-cozy/src/office/world/props/aquarium.js';
import * as worldPropsArcade from '../vendor/my-office-cozy/src/office/world/props/arcade.js';
import * as worldPropsPrinter from '../vendor/my-office-cozy/src/office/world/props/printer.js';
import * as worldPropsTv from '../vendor/my-office-cozy/src/office/world/props/tv.js';
import * as worldPropsGameTv from '../vendor/my-office-cozy/src/office/world/props/game-tv.js';
import * as worldPropsBilliards from '../vendor/my-office-cozy/src/office/world/props/billiards.js';
import * as worldPropsKaraoke from '../vendor/my-office-cozy/src/office/world/props/karaoke.js';
import * as worldPropsNeon from '../vendor/my-office-cozy/src/office/world/props/neon.js';
import * as worldPropsStringLights from '../vendor/my-office-cozy/src/office/world/props/string-lights.js';
import * as worldPropsCat from '../vendor/my-office-cozy/src/office/world/props/cat.js';
import * as worldPropsVacuum from '../vendor/my-office-cozy/src/office/world/props/vacuum.js';
import * as worldPropsBins from '../vendor/my-office-cozy/src/office/world/props/bins.js';
import * as worldPropsShredder from '../vendor/my-office-cozy/src/office/world/props/shredder.js';
import * as worldPropsCups from '../vendor/my-office-cozy/src/office/world/props/cups.js';
import * as worldPropsDevServers from '../vendor/my-office-cozy/src/office/world/props/dev-servers.js';
import * as worldPropsSwitches from '../vendor/my-office-cozy/src/office/world/props/switches.js';
import * as worldPropsMicrowave from '../vendor/my-office-cozy/src/office/world/props/microwave.js';
import * as worldPropsDutyBoard from '../vendor/my-office-cozy/src/office/world/props/duty-board.js';
import * as peopleNavigation from '../vendor/my-office-cozy/src/office/people/navigation.js';
import * as peopleBreaks from '../vendor/my-office-cozy/src/office/people/breaks.js';
import * as lifeWeather from '../vendor/my-office-cozy/src/office/life/weather.js';
import * as worldRoomUpdate from '../vendor/my-office-cozy/src/office/world/room-update.js';
import * as worldBackdropsIndex from '../vendor/my-office-cozy/src/office/world/backdrops/index.js';
import { THEME } from '../vendor/my-office-cozy/src/office/world/backdrops/index.js';
import { updateRoom } from '../vendor/my-office-cozy/src/office/world/room-update.js';
import { updateExtras } from '../vendor/my-office-cozy/src/office/world/props/update.js';
import { updateWeather } from '../vendor/my-office-cozy/src/office/life/weather.js';
import { optimizeStatic } from '../vendor/my-office-cozy/src/office/core/optimize.js';

export const MO = { scene: sceneRenderer.scene, ready: false, errors: [] };

const WORLD = [coreEnv, sceneRenderer, sceneLights, sceneQuality, worldTerrace, worldBackdropsCity, worldLayout, worldCozyRoom, worldWindows,
  worldFurnitureRoomPieces, worldFurnitureServerRacks, worldFurnitureRocket, worldFurnitureBoard, worldEntrance, peopleBedding, worldDesks,
  worldFurnitureMeeting, worldFurnitureCoffee, worldFurniturePlantsLamps, worldPropsTrinkets, worldProPieces, worldProFloor, worldProWing,
  worldPropsAquarium, worldPropsArcade, worldPropsPrinter, worldPropsTv, worldPropsGameTv, worldPropsBilliards, worldPropsKaraoke, worldPropsNeon,
  worldPropsStringLights, worldPropsCat, worldPropsVacuum, worldPropsBins, worldPropsShredder, worldPropsCups, worldPropsDevServers,
  worldPropsSwitches, worldPropsMicrowave, worldPropsDutyBoard, peopleNavigation, peopleBreaks, lifeWeather, worldRoomUpdate, worldBackdropsIndex];

/** Dựng thế giới my-office bằng renderer của dự án. Trả về scene của my-office (dự án thêm đồ của mình vào). */
export function buildMyOffice(renderer, { plan = 'hq', optimize = true } = {}) {
  if (MO.ready) return MO.scene;
  // bố cục của my-office: 'hq' (tầng công ty + cánh 4 phòng ban, 44 bàn), 'pro' (12 bàn), 'cozy' (9 bàn)
  try { localStorage.setItem('office-layout', plan); localStorage.setItem('office-scene', 'city'); } catch { /* storage blocked */ }
  // phần tử giao diện mà mã my-office tìm theo id (bảng chọn thời tiết, khung sân khấu…): bản ẩn, không dùng
  for (const id of ['stage', 'stage-wrap', 'wx-cities', 'wx-now', 'btn-night', 'clock']) if (!document.getElementById(id)) { const st = document.createElement('div'); st.id = id; st.hidden = true; document.body.appendChild(st); }
  sceneRenderer.EXTERNAL.renderer = renderer;
  state.sim = 0;
  state.stats = state.stats || { prompts: 0, cmd: 0, edits: 0, reads: 0 }; state.feed = state.feed || []; // (TV phòng giải trí đọc số liệu phiên làm việc: để 0)
  const NAMES = new Map([[worldTerrace, 'terrace'], [worldBackdropsCity, 'city'], [worldBackdropsIndex, 'backdrop'], [worldProFloor, 'pro-floor'], [worldProWing, 'wing'], [worldCozyRoom, 'cozy'], [worldWindows, 'windows'], [sceneLights, 'lights'], [worldEntrance, 'entrance'], [lifeWeather, 'weather']]);
  for (const m of WORLD) {
    const before = new Set(MO.scene.children);
    try { m.setup?.(); }
    catch (e) { MO.errors.push((m === undefined ? '?' : Object.keys(m).slice(0, 3).join(',')) + ': ' + e.message); console.warn('my-office setup', e); }
    // đánh dấu vật do module nào dựng (để bỏ sân thượng/thành phố khi chỉ lấy nội thất)
    for (const o of MO.scene.children) if (!before.has(o)) o.userData.moModule = NAMES.get(m) || 'other';
  }
  // gộp hình tĩnh theo vật liệu (như my-office: core/optimize.js) — giảm số lệnh vẽ
  if (optimize) try { MO.merged = optimizeStatic(); } catch (e) { MO.errors.push('optimize: ' + e.message); MO.stack = e.stack; console.warn('my-office optimize', e); }
  // sương mù của my-office (40–96 m) tính cho camera isometric gần; camera phối cảnh của dự án lùi xa hơn khi xem toàn cảnh
  if (MO.scene.fog) { MO.scene.fog.near = 90; MO.scene.fog.far = 230; }
  MO.ready = true;
  return MO.scene;
}

/** Mỗi khung hình: đường phố (xe, xe máy, người đi), phòng (hạt, ánh đèn), đồ vật chuyển động, thời tiết. */
const UPDATES = [
  { name: 'street', f: dt => THEME?.live?.update(dt, state.sim) },
  { name: 'room', f: dt => updateRoom(dt, state.sim) },
  { name: 'extras', f: dt => updateExtras(dt, state.sim) }, // (bể cá, máy in, TV, mèo, máy hút bụi, thùng rác, cốc…)
  { name: 'weather', f: dt => updateWeather(dt) }
];
export function updateMyOffice(dt) {
  if (!MO.ready) return;
  state.sim = (state.sim || 0) + dt;
  for (const u of UPDATES) {
    if (u.off) continue;
    try { u.f(dt); } catch (e) { u.off = true; MO.errors.push(u.name + ': ' + e.message); console.warn('my-office update ' + u.name + ' (tắt)', e); }
  }
}

/**
 * Chỉ lấy THÀNH PHỐ của my-office (đường, vỉa hè, nhà phố, cây, đèn, xe cộ, xe máy, người đi đường) để đặt quanh ngôi nhà
 * SYSONE. Văn phòng của my-office vẫn được dựng (mã đường phố đọc vài thông số của nó) nhưng bỏ đi, không hiện.
 * Khu đất giữa (superblock của văn phòng gốc) để trống: dự án đặt ngôi nhà vào đó.
 * offset: dời cả thành phố để khu đất trống ôm lấy ngôi nhà. Trả về { group, SB (khu đất trống, toạ độ đã dời), GY (cao độ mặt đường) }.
 */
export function buildMyCity(renderer, { plan = 'pro', offset = [0, 0] } = {}) {
  buildMyOffice(renderer, { plan, optimize: false });
  const city = THEME.group; city.removeFromParent();
  const group = new THREE.Group(); group.name = 'my-office city'; group.position.set(offset[0], 0, offset[1]); group.add(city);
  const W = 4.4, HQ = plan === 'hq';
  const SB = { x0: -12 + W / 2 + offset[0], x1: 18 - W / 2 + offset[0], z0: -13.8 + W / 2 + offset[1], z1: (HQ ? 31.2 : 16.2) - W / 2 + offset[1] };
  UPDATES.splice(1); // chỉ còn đường phố (văn phòng gốc không hiện)
  MO.city = { group, SB };
  return { group, SB, GY: worldTerrace.GY };
}
