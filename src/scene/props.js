// Danh mục đồ vật dùng được trong văn phòng (đợt 2 của kế hoạch "hành động cho mọi đồ vật").
// Mỗi đồ vật: vị trí thật lấy từ chính nhóm 3D của my-office (MIT) lúc chạy — tầng trệt / tầng 2 (bản hq) và tầng 3
// (bản cozy) — điểm đứng là ô đi được gần nhất trên lưới, câu gợi ý, động tác (src/shared/propActs.js, chạy ở
// src/agents/actions.js) và hiệu ứng nhỏ trên đồ vật. Cách dùng: đi tới gần → gợi ý "E …" → bấm E (hoặc nút Tương tác,
// hoặc chạm thẳng vào gợi ý trên điện thoại): nhân vật tự bước vào chỗ đứng, quay mặt về đồ vật, làm động tác; đi đi là
// dừng. Người khác online thấy cùng động tác (gửi qua gói vị trí).
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { moToBuilding, cozyToBuilding } from '../myoffice/building.js';
import * as HQ_ROOM from '../vendor/my-office/src/office/world/furniture/room-pieces.js';
import * as HQ_COFFEE from '../vendor/my-office/src/office/world/furniture/coffee.js';
import * as HQ_LAMPS from '../vendor/my-office/src/office/world/furniture/plants-lamps.js';
import * as HQ_AQ from '../vendor/my-office/src/office/world/props/aquarium.js';
import * as HQ_ARC from '../vendor/my-office/src/office/world/props/arcade.js';
import * as HQ_PRN from '../vendor/my-office/src/office/world/props/printer.js';
import * as HQ_CAT from '../vendor/my-office/src/office/world/props/cat.js';
import * as CZ_ROOM from '../vendor/my-office-cozy/src/office/world/furniture/room-pieces.js';
import * as CZ_COFFEE from '../vendor/my-office-cozy/src/office/world/furniture/coffee.js';
import * as CZ_LAMPS from '../vendor/my-office-cozy/src/office/world/furniture/plants-lamps.js';
import * as CZ_AQ from '../vendor/my-office-cozy/src/office/world/props/aquarium.js';
import * as CZ_ARC from '../vendor/my-office-cozy/src/office/world/props/arcade.js';
import * as CZ_PRN from '../vendor/my-office-cozy/src/office/world/props/printer.js';

/** Loại đồ vật: chữ trên gợi ý, động tác, thời gian (giây; 0 = tới khi đi đi), hiệu ứng nổi trên đồ vật. */
export const KINDS = {
  coffee: { verb: 'Pha cà phê', act: 'brew', dur: 5, fx: '☕', done: 'Cà phê nóng đây!', after: 'drink' },
  printer: { verb: 'In tài liệu', act: 'print', dur: 4, fx: '📄', done: 'Đã in xong.' },
  shelf: { verb: 'Lấy sách đọc', act: 'read', dur: 0, fx: '📖' },
  globe: { verb: 'Xoay quả địa cầu', act: 'globe', dur: 3, fx: '🌏' },
  aquarium: { verb: 'Cho cá ăn', act: 'feed', dur: 4, fx: '🐟', done: 'Đàn cá ăn ngon lành.' },
  cat: { verb: 'Vuốt ve mèo', act: 'pet', dur: 4, fx: '😺', done: 'Meo~' },
  lamp: { verb: 'Bật / tắt đèn', act: 'lamp', dur: 1.2, fx: '💡' },
  arcade: { verb: 'Chơi game', act: 'game', dur: 0, fx: '🕹️' }
};

const _v = new THREE.Vector3();
/** Nhóm còn nằm trong cảnh (không bị bỏ khi dựng toà nhà)? */
const inScene = (o, scene) => { for (let p = o; p; p = p.parent) if (p === scene) return true; return false; };

export class Props {
  constructor(app, session) {
    this.app = app; this.s = session; this.items = []; this.busy = null; this.pending = null;
    this.build();
  }

  build() {
    const app = this.app, scene = app.scene, root = app.bldRoot, m = app.model;
    if (!root) return;
    root.updateMatrixWorld(true);
    const floorOf = y => { let f = 0; for (const fl of m.floors) if (y >= fl.y - 0.6) f = fl.id; return f; };
    const add = (kind, x, z, y, extra = {}) => {
      const f = floorOf(y);
      // điểm đứng: ô đi được gần nhất (không bao giờ là góc chết)
      const g = app.nav?.grid?.(f); let stand = null;
      if (g) { const k = g.nearestFree(x, z, 1.6); if (k >= 0) stand = { x: g.cx(k), z: g.cz(k) }; }
      if (!stand) return;
      this.items.push({ id: `${kind}-${this.items.length}`, kind, ...KINDS[kind], f, x, z, y, stand, r: 1.5, ...extra });
    };
    const fromGroup = (kind, g, extra) => { if (!g || !inScene(g, scene)) return; g.getWorldPosition(_v); add(kind, _v.x, _v.z, _v.y, { obj: g, ...extra }); };
    const fromMo = (kind, pt, toB) => { if (!pt) return; const b = toB(pt.x, pt.z); add(kind, b.x + root.position.x, b.z + root.position.z, b.y + root.position.y); };
    for (const [ROOM, COFFEE, LAMPS, AQ, ARC, PRN, toB] of [[HQ_ROOM, HQ_COFFEE, HQ_LAMPS, HQ_AQ, HQ_ARC, HQ_PRN, moToBuilding], [CZ_ROOM, CZ_COFFEE, CZ_LAMPS, CZ_AQ, CZ_ARC, CZ_PRN, cozyToBuilding]]) {
      fromGroup('coffee', COFFEE.coffeeG);
      fromGroup('shelf', ROOM.shelf);
      fromGroup('globe', ROOM.globeStand);
      for (const lg of LAMPS.floorLampGroups || []) fromGroup('lamp', lg, { on: true });
      fromMo('aquarium', AQ.AQ, toB);
      fromMo('arcade', ARC.ARC, toB);
      fromMo('printer', PRN.PRN, toB);
    }
    if (HQ_CAT.cat?.g) fromGroup('cat', HQ_CAT.cat.g, { r: 1.2 });
  }

  /** Đồ vật gần nhất trong tầm (ưu tiên phía trước mặt) — hoặc null. */
  near(x, z, f, yaw = null) {
    let best = null, bs = Infinity;
    for (const it of this.items) {
      if (it.f !== f) continue;
      const d = Math.hypot(it.x - x, it.z - z); if (d > it.r) continue;
      let sc = d;
      if (yaw !== null) { const rel = Math.atan2(-(it.x - x), -(it.z - z)) - yaw; sc += (1 - Math.cos(rel)) * 0.4; }
      if (sc < bs) { bs = sc; best = it; }
    }
    return best;
  }
  prompt(it) { return `<b>E</b> ${it.verb}`; }

  /** Dùng đồ vật: bước vào chỗ đứng (nếu xa), quay mặt, làm động tác, hiệu ứng; dur > 0 thì tự xong. */
  use(it) {
    const pl = this.s.player, a = pl?.agent; if (!a || pl.seated || pl.sofa || pl.seq) return false;
    if (Math.hypot(a.x - it.stand.x, a.z - it.stand.z) > 0.45) {
      if (pl.walkTo(it.stand.x, it.stand.z, it.f)) { this.pending = it; return true; }
    }
    this.start(it); return true;
  }
  start(it) {
    const pl = this.s.player, a = pl.agent;
    this.pending = null;
    a.yaw = Math.atan2(-(it.x - a.x), -(it.z - a.z));
    pl.setAct(it.act);
    this.busy = { it, t: 0 };
    this.effect(it);
    pl.send(true);
  }
  /** (mỗi khung hình) tới chỗ đứng thì bắt đầu; hết giờ thì xong; đi đi thì huỷ. */
  update(dt) {
    const pl = this.s.player, a = pl?.agent; if (!a) return;
    if (this.pending && !pl.path) { const it = this.pending; if (Math.hypot(a.x - it.stand.x, a.z - it.stand.z) < 0.7) this.start(it); else this.pending = null; }
    const b = this.busy; if (!b) return;
    if (a.act !== b.it.act) { this.busy = null; return; }        // (đi đi / đổi động tác: player đã huỷ)
    b.t += dt;
    if (b.it.dur && b.t >= b.it.dur) {
      this.busy = null;
      pl.setAct(b.it.after || null);
      if (b.it.done) this.s.toast(b.it.done);
    }
  }

  /** Hiệu ứng trên đồ vật: biểu tượng nổi lên rồi tan; đèn thì bật/tắt thật. */
  effect(it) {
    if (it.kind === 'lamp' && it.obj) {
      it.on = !it.on;
      it.obj.traverse(o => { for (const mt of [].concat(o.material || [])) if (mt?.emissive) { mt.userData.emi0 ??= mt.emissiveIntensity; mt.emissiveIntensity = it.on ? mt.userData.emi0 : 0; } });
      this.s.toast(it.on ? 'Đã bật đèn.' : 'Đã tắt đèn.');
    }
    const el = document.createElement('div'); el.className = 'prop-fx'; el.textContent = it.fx;
    const o = new CSS2DObject(el); o.position.set(it.x, it.y + 1.4, it.z); this.app.scene.add(o);
    setTimeout(() => { this.app.scene.remove(o); el.remove(); }, 2200);
  }
}
