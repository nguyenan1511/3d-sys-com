// Bộ dựng hình dùng chung: hộp B/S, mặt đứng FL, khối chặn COL, vật liệu và texture vẽ bằng canvas.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function rngLegacy(s) { return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

export function createBuilder() {
  const ctx = {};
  const COL = [], FL = [];
  const house = new THREE.Group(); house.name = 'house';
  const nb = new THREE.Group(); nb.name = 'neighbors';
  const st = new THREE.Group(); st.name = 'street';
  const roofG = new THREE.Group(); roofG.name = 'roof';
  const interior = new THREE.Group(); interior.name = 'interior';

  function tcv(w, h, fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t; }
  function sgn(w, h, fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; return t; }
  const L = c => new THREE.MeshLambertMaterial({ color: c });
  const LD = c => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide });
  const mcache = {};
  const mc = c => mcache[c] || (mcache[c] = L(c));
  function tmat(tex, rx, ry, dbl) { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshLambertMaterial({ map: t, side: dbl ? THREE.DoubleSide : THREE.FrontSide }); }

  function B(x0, x1, y0, y1, z0, z1, m, g) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    (g || house).add(mesh); return mesh;
  }
  function S(x0, x1, y0, y1, z0, z1, m, g) { const mesh = B(x0, x1, y0, y1, z0, z1, m, g); COL.push({ x0, x1, y0, y1, z0, z1 }); return mesh; }
  function walk(x0, x1, z0, z1, top) { FL.push({ x0, x1, z0, z1, top }); }

  Object.assign(ctx, { THREE, COL, FL, house, nb, st, roofG, interior, tcv, sgn, L, LD, mc, tmat, B, S, walk, rng: rngLegacy });
  return ctx;
}

/**
 * Gộp các mesh tĩnh theo vật liệu để giảm draw call. Bỏ qua nhánh có userData.noMerge,
 * mesh nhiều vật liệu và InstancedMesh.
 */
export function mergeStatic(root, { force = false } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map(), victims = [];
  const visit = (o, skip) => {
    if (o.userData.noMerge && !(force && o === root)) skip = true;
    if (!skip && o.isMesh && !o.isInstancedMesh && !Array.isArray(o.material) && o.visible) {
      const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`;
      let b = buckets.get(key); if (!b) { b = { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, geos: [] }; buckets.set(key, b); }
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.clearGroups();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      b.geos.push(g); victims.push(o);
    }
    for (const c of o.children) visit(c, skip);
  };
  visit(root, false);
  let before = victims.length, after = 0;
  for (const o of victims) { o.parent.remove(o); o.geometry.dispose(); }
  // dọn group rỗng
  const prune = o => { for (const c of [...o.children]) { prune(c); if (c.isGroup && !c.children.length && !c.userData.keep) o.remove(c); } };
  prune(root);
  for (const b of buckets.values()) {
    const g = mergeGeometries(b.geos, false);
    for (const x of b.geos) x.dispose();
    if (!g) continue;
    const m = new THREE.Mesh(g, b.mat); m.castShadow = b.cast; m.receiveShadow = b.recv; m.matrixAutoUpdate = false;
    root.add(m); after++;
  }
  return { before, after };
}
