// Biển tên phòng ban treo trần giữa khu làm việc của từng phòng (layout.deptZones, src/shared/departments.js): bảng trắng
// có vạch màu của phòng, đọc được từ cả hai mặt, treo bằng hai thanh mảnh xuống từ trần.
import * as THREE from 'three';

function board(name, color) {
  const W = 640, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#fffaf3'; g.beginPath(); g.roundRect(0, 0, W, H, 22); g.fill();
  g.fillStyle = color; g.beginPath(); g.roundRect(0, 0, 34, H, [22, 0, 0, 22]); g.fill();
  g.fillStyle = '#2b2d42'; g.textBaseline = 'middle'; g.textAlign = 'center';
  let fs = 52; g.font = `800 ${fs}px system-ui, sans-serif`;
  while (g.measureText(name).width > W - 90 && fs > 26) { fs -= 2; g.font = `800 ${fs}px system-ui, sans-serif`; }
  g.fillText(name, 34 + (W - 34) / 2, H / 2 + 2);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { t, aspect: H / W };
}

export function buildDeptSigns(scene, layout, model) {
  const group = new THREE.Group(); group.name = 'deptSigns'; scene.add(group);
  const rodM = new THREE.MeshStandardMaterial({ color: '#2b2d42', roughness: 0.5, metalness: 0.4 });
  const rodG = new THREE.CylinderGeometry(0.008, 0.008, 1, 6);
  for (const z of layout.deptZones || []) {
    const { t, aspect } = board(z.name, z.color), w = 1.7, h = w * aspect;
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.5 });
    const y0 = model.floorY(z.floor), y = y0 + 2.75, top = y0 + 3.98;
    const g = new THREE.Group(); g.position.set((z.x0 + z.x1) / 2, y, (z.z0 + z.z1) / 2); group.add(g);
    for (const ry of [0, Math.PI]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); p.rotation.y = ry; p.position.z = ry ? -0.006 : 0.006; g.add(p); }
    for (const sx of [-1, 1]) { const r = new THREE.Mesh(rodG, rodM); r.scale.y = top - (y + h / 2); r.position.set(sx * w * 0.38, h / 2 + r.scale.y / 2, 0); g.add(r); }
    g.userData.dept = z.id;
  }
  return group;
}
