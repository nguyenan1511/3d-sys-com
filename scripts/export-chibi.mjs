// Xuất nhân vật chibi (dựng bằng code) thành một model OBJ tư thế chữ T để tải lên Mixamo gắn xương + lấy chuyển động.
// Vật liệu đặt tên theo vai trò màu (skin, hair, shirt, pants, shoe…) để lúc chạy tô lại theo nhân vật pixel.
// Dùng: node scripts/export-chibi.mjs [thư mục ra]   (mặc định public/model/sysone-kid/mixamo-upload)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { startServer } from './_server.mjs';
const OUT = resolve(process.argv[2] || 'public/model/sysone-kid/mixamo-upload');
mkdirSync(OUT, { recursive: true });
const srv = await startServer(5371, { demo: false });
const b = await chromium.launch({ args: ['--use-angle=metal'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto(srv.url);
const res = await p.evaluate(async (process_hair) => {
  const THREE = await import('/node_modules/.vite/deps/three.js').catch(() => import('three'));
  const { AvatarSystem } = await import('/src/agents/avatars.js');
  const { OBJExporter } = await import('/node_modules/three/examples/jsm/exporters/OBJExporter.js');
  const scene = new THREE.Scene();
  const sys = new AvatarSystem(scene, 1, 'low', { scale: 1 });
  const look = { skin: '#ecc9a8', hair: '#3b2a20', hairStyle: process_hair, shirt: '#3a6aa8', pants: '#2d3440', shoes: '#1b1b1d', outfit: 'tee', eyes: 'round', eyeColor: '#20160f', brows: 'normal', mouth: 'smile', blush: true, hat: '', height: 1 };
  const ag = { visible: true, x: 0, y: 0, z: 0, yaw: Math.PI, sit: 0, walkAmt: 0, walkPhase: 0, anim: 'idle', animT: 0, idx: 0, emp: { look } };
  const pose0 = sys.pose.bind(sys);
  sys.pose = (a, ...r) => { const P = pose0(a, ...r); P.shP = [0, 0]; P.shR = [1.45, 1.45]; P.el = [0, 0]; P.spineYaw = 0; P.headRoll = 0; P.hip = [0, 0]; P.knee = [0, 0]; if (P.ankle) P.ankle = [0, 0]; return P; };
  sys.setColors([ag]); sys.update([ag]);
  const out = new THREE.Group(), m = new THREE.Matrix4(), mats = new Map(), roles = {};
  const box = new THREE.Box3();
  for (const part of sys.parts) {
    const im = part.mesh; if (!im || part.mat === 'logo' || part.color === 'patch') continue; // miếng lót logo: bỏ (logo gắn lại lúc chạy)
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m); if (Math.abs(m.determinant()) < 1e-9) continue;
      const g = im.geometry.clone().applyMatrix4(m); g.deleteAttribute('color');
      const role = part.color || 'misc';
      if (!mats.has(role)) { const c = new THREE.Color(); im.getColorAt?.(i, c); mats.set(role, new THREE.MeshBasicMaterial({ name: role, color: c })); roles[role] = '#' + c.getHexString(); }
      const mesh = new THREE.Mesh(g, mats.get(role)); mesh.name = part.name + '_' + i; out.add(mesh); box.expandByObject(mesh);
    }
  }
  // chân chạm y = 0, giữa x/z
  const c = box.getCenter(new THREE.Vector3()); out.position.set(-c.x, -box.min.y, -c.z); out.updateMatrixWorld(true);
  const obj = new OBJExporter().parse(out);
  const sz = box.getSize(new THREE.Vector3());
  return { obj, roles, size: [sz.x, sz.y, sz.z], parts: out.children.length };
}, process.env.HAIR || 'bob');
await b.close(); srv.stop();
const mtl = Object.entries(res.roles).map(([k, hex]) => { const n = parseInt(hex.slice(1), 16), f = v => (v / 255).toFixed(4); return `newmtl ${k}\nKd ${f(n >> 16)} ${f((n >> 8) & 255)} ${f(n & 255)}\nKa 0 0 0\nKs 0 0 0\nd 1\nillum 1\n`; }).join('\n');
writeFileSync(join(OUT, 'sysone-kid.obj'), 'mtllib sysone-kid.mtl\n' + res.obj);
writeFileSync(join(OUT, 'sysone-kid.mtl'), mtl);
execFileSync('zip', ['-j', '-q', '-o', join(OUT, 'sysone-kid-mixamo.zip'), join(OUT, 'sysone-kid.obj'), join(OUT, 'sysone-kid.mtl')]);
console.log(`đã xuất ${res.parts} khối, cao ${res.size[1].toFixed(2)} rộng ${res.size[0].toFixed(2)} sâu ${res.size[2].toFixed(2)} → ${OUT}/sysone-kid-mixamo.zip`);
console.log('vai trò màu:', Object.keys(res.roles).join(', '));
