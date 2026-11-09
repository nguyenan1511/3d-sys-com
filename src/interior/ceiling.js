// Trần nhà kín như văn phòng thật: trần thạch cao ô 60 cm (chừa lỗ cầu thang), máy lạnh treo tường,
// ống luồn dây điện, công tắc, ổ cắm, đầu báo khói, cửa gió, tủ điện, biển EXIT.
// Trần là mặt một phía nhìn từ dưới lên: nhìn từ trên (bỏ mái, xem theo tầng) không bị che.
import * as THREE from 'three';

export const CEIL_DROP = 0.12; // trần thả thấp hơn đáy sàn trên 12 cm

export function buildCeilings(ctx, model) {
  const { B, mc, interior: root, tcv } = ctx;
  const tileTex = tcv(128, 128, (g, w, h) => {
    g.fillStyle = '#eceae4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e3e0d8'; for (let i = 0; i < 260; i++) g.fillRect((i * 37) % w, (i * 61) % h, 2, 2); // vân thạch cao
    g.strokeStyle = '#c9c6bd'; g.lineWidth = 4; g.strokeRect(0, 0, w, h);
  });
  const ceilMat = (rx, rz) => { const t = tileTex.clone(); t.needsUpdate = true; t.repeat.set(rx, rz); t.wrapS = t.wrapT = THREE.RepeatWrapping; return new THREE.MeshLambertMaterial({ map: t }); };
  const white = mc(0xf4f4f1), grey = mc(0x9aa0a6), dark = mc(0x3a3d42), conduit = mc(0xe9e9e4);

  function plane(x0, x1, z0, z1, y) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(Math.PI / 2); // pháp tuyến hướng xuống
    const m = new THREE.Mesh(g, ceilMat((x1 - x0) / 0.6, (z1 - z0) / 0.6));
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); root.add(m);
  }
  function withHoles(x0, x1, z0, z1, holes, fn) {
    const xs = [...new Set([x0, x1, ...holes.flatMap(h => [h.x0, h.x1]).filter(v => v > x0 && v < x1)])].sort((a, b) => a - b);
    const zs = [...new Set([z0, z1, ...holes.flatMap(h => [h.z0, h.z1]).filter(v => v > z0 && v < z1)])].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      if (holes.some(h => cx > h.x0 && cx < h.x1 && cz > h.z0 && cz < h.z1)) continue;
      fn(xs[i], xs[i + 1], zs[j], zs[j + 1]);
    }
  }

  for (const fl of model.floors) {
    const yc = fl.ceiling - CEIL_DROP, yb = fl.y;
    const holes = model.stairs.filter(s => s.from === fl.id).map(s => s.rect);
    // trần: khối trái tới z=3.6, khối phải tới z=4.3 (theo vỏ nhà)
    withHoles(-3.0, 3.0, -6.8, 3.6, holes, (a, b, c, d) => plane(a, b, c, d, yc));
    plane(0, 3.0, 3.6, 4.3, yc);
    // gờ trần quanh lỗ cầu thang
    for (const h of holes) {
      B(h.x0, h.x1, yc, fl.ceiling, h.z0 - 0.02, h.z0, white); B(h.x0, h.x1, yc, fl.ceiling, h.z1, h.z1 + 0.02, white);
      B(h.x0 - 0.02, h.x0, yc, fl.ceiling, h.z0, h.z1, white); B(h.x1, h.x1 + 0.02, yc, fl.ceiling, h.z0, h.z1, white);
    }
    // phào chân trần
    B(-3.0, 3.0, yc - 0.05, yc, -6.8, -6.76, white);
    B(-3.0, -2.96, yc - 0.05, yc, -6.8, 3.6, white); B(2.96, 3.0, yc - 0.05, yc, -6.8, 4.3, white);

    // máy lạnh treo tường (dàn lạnh) + ống đồng bọc trắng chạy lên trần
    const acs = fl.id === 0 ? [[-2.96, 0.6, 1], [2.96, -1.2, -1]] : fl.id === 1 ? [[-2.96, 1.2, 1], [2.96, 1.0, -1], [-2.96, -5.0, 1]] : [[-2.96, 1.9, 1], [2.96, -0.6, -1], [-2.96, -4.4, 1]];
    for (const [x, z, s] of acs) {
      const y0 = yc - 0.5, y1 = yc - 0.2, xd = x + s * 0.23;
      B(Math.min(x, xd), Math.max(x, xd), y0, y1, z - 0.43, z + 0.43, white);
      B(Math.min(x, xd) + (s > 0 ? 0.2 : 0), Math.max(x, xd) - (s < 0 ? 0.2 : 0), y0 + 0.02, y0 + 0.07, z - 0.4, z + 0.4, grey); // cửa gió
      B(x + s * 0.229, x + s * 0.233, y1 - 0.08, y1 - 0.06, z + 0.3, z + 0.36, mc(0x2bb673)); // đèn báo
      B(x + s * 0.02, x + s * 0.08, y1, yc, z - 0.38, z - 0.32, conduit); // ống đồng lên trần
      B(x + s * 0.02, x + s * 0.08, y0 - 0.9, y0, z + 0.36, z + 0.42, conduit); // ống thoát nước xuống
    }

    // ống luồn dây điện chạy dọc hai tường sát trần + hộp nối
    for (const x of [-2.94, 2.94]) {
      B(x - 0.02, x + 0.02, yc - 0.1, yc - 0.06, -6.6, 3.3, conduit);
      for (let z = -6.0; z < 3.3; z += 2.4) B(x - 0.04, x + 0.04, yc - 0.14, yc - 0.02, z - 0.06, z + 0.06, conduit);
    }
    // ống xuống công tắc (cạnh lối vào tầng) và ổ cắm dọc tường
    const sw = fl.id === 0 ? [2.94, 1.6] : [-2.94, -1.2];
    B(sw[0] - 0.02, sw[0] + 0.02, yb + 1.35, yc - 0.1, sw[1] - 0.02, sw[1] + 0.02, conduit);
    B(sw[0] - 0.03, sw[0] + 0.03, yb + 1.2, yb + 1.38, sw[1] - 0.07, sw[1] + 0.07, white);
    B(sw[0] - (sw[0] > 0 ? 0.035 : -0.03), sw[0] - (sw[0] > 0 ? 0.03 : -0.035), yb + 1.25, yb + 1.33, sw[1] - 0.03, sw[1] + 0.03, grey);
    for (const x of [-2.97, 2.97]) for (let z = -5.5; z < 3; z += 2.2) {
      if (model.stairs.some(s => (s.from === fl.id || s.to === fl.id) && x > s.x0 - 0.1 && x < s.x1 + 0.1 && z > s.z0 && z < s.z1)) continue;
      B(x - 0.02, x + 0.02, yb + 0.25, yb + 0.36, z - 0.05, z + 0.05, white);
    }
    // máng cáp / đèn và đầu báo khói, cửa gió trên trần
    for (const [x, z] of [[-1.5, -3.5], [1.2, -0.5], [-0.8, 2.2]]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.04, 16), white); c.position.set(x, yc - 0.02, z); root.add(c);
      const led = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8), mc(0xd9302c)); led.position.set(x + 0.03, yc - 0.045, z); root.add(led);
    }
    for (const [x, z] of [[0.6, -5.2], [-0.6, 0.8]]) {
      B(x - 0.3, x + 0.3, yc - 0.012, yc - 0.002, z - 0.3, z + 0.3, grey);
      for (let k = -0.24; k <= 0.24; k += 0.08) B(x - 0.28, x + 0.28, yc - 0.016, yc - 0.012, z + k - 0.01, z + k + 0.01, dark);
    }
    // máng cáp treo ở hành lang giữa (đi dây mạng)
    B(-0.08, 0.08, yc - 0.06, yc - 0.02, -6.4, 3.2, mc(0xb9bcc0));
  }

  // tủ điện tổng ở tầng trệt (tường phải, cạnh cửa) và biển EXIT trên cửa chính
  const f0 = model.floors[0];
  B(2.84, 3.0, f0.y + 1.25, f0.y + 1.95, 0.7, 1.2, mc(0xd4d6d9));
  B(2.835, 2.84, f0.y + 1.3, f0.y + 1.9, 0.75, 1.15, grey);
  B(2.92, 2.96, f0.y + 1.95, f0.ceiling - CEIL_DROP, 0.93, 0.97, conduit);
  const exitTex = tcv(128, 48, (g, w, h) => { g.fillStyle = '#1f8f4a'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('EXIT', w / 2, h / 2 + 2); });
  exitTex.wrapS = exitTex.wrapT = THREE.ClampToEdgeWrapping;
  const exit = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.14), new THREE.MeshBasicMaterial({ map: exitTex }));
  exit.position.set(1.6, 2.45, 1.97); exit.rotation.y = Math.PI; root.add(exit);
  B(1.4, 1.8, 2.37, 2.53, 1.98, 2.0, white);
}
