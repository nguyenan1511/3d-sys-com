// Đóng băng ma trận vật đứng yên (src/scene/freeze.js): hình ảnh phải y hệt — vật đổi chỗ / đổi cha vẫn đúng chỗ,
// vật gỡ khỏi cảnh được thả ra (không giữ tham chiếu).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MatrixFreezer } from '../src/scene/freeze.js';

const world = o => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
function setup() {
  const scene = new THREE.Scene(), a = new THREE.Group(), b = new THREE.Mesh(), c = new THREE.Group(), av = new THREE.Group(); av.name = 'avatars';
  a.position.set(1, 0, 0); b.position.set(0, 2, 0); c.position.set(5, 0, 0); a.add(b); scene.add(a, c, av); av.add(new THREE.Mesh());
  const fz = new MatrixFreezer(); fz.add(scene, o => o.name === 'avatars');
  return { scene, a, b, c, av, fz };
}
describe('MatrixFreezer', () => {
  it('vật đứng yên không tự tính lại ma trận; nhánh bị loại trừ giữ nguyên', () => {
    const { a, av, fz } = setup();
    expect(a.matrixAutoUpdate).toBe(false); expect(av.matrixAutoUpdate).toBe(true); expect(av.children[0].matrixAutoUpdate).toBe(true);
    expect(fz.sync()).toBe(0);
  });
  it('vật đổi vị trí / hướng / tỉ lệ: ma trận thế giới (cả con) đúng như không đóng băng', () => {
    const { scene, a, b, fz } = setup();
    a.position.x = 3; a.rotation.y = Math.PI / 2; b.scale.set(2, 2, 2);
    expect(fz.sync()).toBe(2); scene.updateMatrixWorld();
    const ref = new THREE.Group(); ref.position.set(3, 0, 0); ref.rotation.y = Math.PI / 2; const rb = new THREE.Object3D(); rb.position.set(0, 2, 0); rb.scale.set(2, 2, 2); ref.add(rb); ref.updateMatrixWorld(true);
    expect(b.matrixWorld.equals(rb.matrixWorld)).toBe(true);
    expect(world(b).toArray().map(v => +v.toFixed(5))).toEqual([3, 2, 0]);
  });
  it('đổi nhóm cha (không đổi vị trí): ma trận thế giới theo cha mới', () => {
    const { scene, b, c, fz } = setup();
    c.add(b); fz.sync(); scene.updateMatrixWorld();
    expect(world(b).toArray()).toEqual([5, 2, 0]);
  });
  it('vật gỡ khỏi cảnh được thả ra và tự cập nhật lại như thường', () => {
    const { a, b, fz } = setup();
    const n = fz.list.length; a.remove(b); fz.sync();
    expect(fz.list.length).toBe(n - 1); expect(b.matrixAutoUpdate).toBe(true); expect(fz.list.includes(b)).toBe(false);
  });
});
