// Cây cảnh văn phòng: model chậu cây làm sẵn (Isa Lousberg, Public Domain — public/model/plants/CREDITS.txt).
// Trả về ngay một Group giữ chỗ; model nạp xong thì gắn vào (chuẩn hoá: đế chậu ở y = 0, tâm ở giữa, cao đúng `height`).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const FILES = { monstera: 'model/plants/monstera.glb', sansevieria: 'model/plants/sansevieria.glb' };
const loading = new Map();
function load(kind) {
  if (!loading.has(kind)) loading.set(kind, new GLTFLoader().loadAsync(new URL(FILES[kind], document.baseURI).href).then(g => {
    const root = g.scene;
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) { o.material.metalness = 0; o.material.roughness = Math.max(0.6, o.material.roughness ?? 1); } } });
    const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3());
    root.position.set(-c.x, -box.min.y, -c.z);
    const wrap = new THREE.Group(); wrap.add(root); wrap.userData.h = box.max.y - box.min.y;
    return wrap;
  }).catch(e => { console.warn('cây cảnh: không nạp được', kind, e); return null; }));
  return loading.get(kind);
}

/** Chậu cây loại `kind` ('monstera' | 'sansevieria') cao `height` mét, xoay `rotY`. */
export function plant(kind, height, rotY = 0) {
  const g = new THREE.Group(); g.name = 'plant:' + kind; g.rotation.y = rotY; g.userData.noMerge = true; // nạp sau: không gộp vào khối tĩnh
  load(kind).then(tpl => { if (!tpl) return; const m = tpl.clone(true); m.scale.setScalar(height / tpl.userData.h); g.add(m); });
  return g;
}
