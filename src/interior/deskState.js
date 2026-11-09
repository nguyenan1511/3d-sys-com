// Trạng thái bàn ghế nhìn thấy được, theo my-office (world/desks.js, people/workers.js, interact/props.js):
// - ghế trống màu xám xanh CHAIR_IDLE; có người ngồi làm việc thì ghế mang màu áo của người đó;
// - bàn đang trỏ chuột / đang chỉnh: viền cam mảnh phát sáng quanh mép mặt bàn, quầng cam dưới sàn, ghế hơi ửng sáng
//   (không phủ lên mặt bàn để thấy đúng màu bàn đang chọn).
import * as THREE from 'three';
import { CHAIR_IDLE } from '../scene/moBlocks.js';
import { shirtColorOf } from '../agents/avatars.js';
import { deg2yaw } from '../core/util.js';

const HL_GLOW = new THREE.Color('#FF9A3C');
export function createDeskState({ scene, model, inter }) {
  const idle = new THREE.Color(CHAIR_IDLE), tmp = new THREE.Color();
  const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 0.62, 0.08), toneMapped: true });
  const hl = new THREE.Group(); hl.name = 'deskHighlight'; hl.visible = false; hl.renderOrder = 3; scene.add(hl);
  // các mesh đệm ghế (sau khi gộp: mỗi ghế làm việc là một mesh mang vật liệu riêng)
  const chairMesh = new Map();
  scene.traverse(o => { if (o.isMesh && o.material?.userData?.chair) chairMesh.set(o.material.userData.chair, o); });
  let shown = null, lit = null, acc = 0;

  /** occupants: Map deskId -> người đang ngồi làm việc ở đó. */
  function paintChairs(occupants) {
    for (const [id, m] of inter.chairMats) {
      const a = occupants.get(id);
      tmp.copy(a ? tmp.set(shirtColorOf(a)) : idle);
      if (!m.color.equals(tmp)) m.color.copy(tmp);
    }
  }
  function highlight(deskId) {
    if (deskId === shown) return;
    shown = deskId;
    for (const c of [...hl.children]) { hl.remove(c); if (c.userData.own) c.geometry.dispose(); }
    if (lit) { lit.emissive.setRGB(0, 0, 0); lit.emissiveIntensity = 1; lit = null; }
    const d = deskId && model.deskById.get(deskId);
    hl.visible = !!d;
    if (!d) return;
    const fs = model.fs || 1, y = model.floorY(d.floor), w = (d.w || 1) * fs, dd = (d.d || 0.6) * fs;
    // viền cam mảnh ôm mép mặt bàn (không phủ lên mặt bàn: bàn giữ đúng màu đã chọn)
    const ty = y + (d.kind === 'reception' ? 1.08 : 0.765) * fs, T = 0.03, ry = deg2yaw(d.facing || 0);
    const frame = new THREE.Group(); frame.position.set(d.x, ty, d.z); frame.rotation.y = ry; hl.add(frame);
    for (const [bw, bd, bx, bz] of [[w + 2 * T, T, 0, dd / 2 + T / 2], [w + 2 * T, T, 0, -dd / 2 - T / 2], [T, dd, w / 2 + T / 2, 0], [T, dd, -w / 2 - T / 2, 0]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.022, bd), edgeMat); b.userData.own = true; b.position.set(bx, 0, bz); frame.add(b);
    }
    // ghế: ửng sáng cam nhẹ (không phủ vỏ)
    const cm = chairMesh.get(deskId);
    if (cm) { lit = cm.material; lit.emissive.copy(HL_GLOW); lit.emissiveIntensity = 0.22; }
    // quầng sáng dưới chân bàn
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.5, dd + 1.3), new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.28, depthWrite: false }));
    ring.userData.own = true; ring.rotation.x = -Math.PI / 2;
    ring.geometry.rotateZ(-deg2yaw(d.facing || 0));
    ring.position.set((d.x + d.seat.x) / 2, y + 0.012, (d.z + d.seat.z) / 2); hl.add(ring);
  }

  return {
    /** Mỗi khung hình: ai đang ngồi ở bàn nào, bàn nào được trỏ/chọn. */
    update(dt, { sim, session, hoverDesk }) {
      acc += dt;
      if (acc > 0.2) {
        acc = 0;
        const occ = new Map();
        for (const a of sim.agents) if (a.visible && a.atDesk && a.sit > 0.5 && a.desk) occ.set(a.desk.id, a);
        const pl = session.player;
        if (pl?.seated) occ.set(pl.seated, pl.agent);
        for (const r of session.remote.list) if (r.seated) occ.set(r.seated, r);
        paintChairs(occ);
      }
      const sel = session.selecting ? (hoverDesk || session.draft?.deskId || session.selected) : (session.draft?.deskId || null);
      highlight(sel || null);
      if (hl.visible) edgeMat.color.setRGB(1.7, 0.62, 0.08).multiplyScalar(0.85 + 0.15 * Math.sin(performance.now() / 260));
    },
    /** Màu ghế hiện tại (kiểm thử). */
    chairColor: id => '#' + inter.chairMats.get(id)?.color.getHexString(),
    get highlighted() { return shown; }
  };
}
