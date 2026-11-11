// Bỏ bản dữ liệu hình trong RAM sau khi lên GPU (src/scene/releaseRam.js): chỉ hình gộp riêng; nhóm bấm được vẫn bấm trúng
// đúng chỗ; hộp bao tính sẵn; hình không bấm được thì tia trượt (không lỗi).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { releaseGeometryRam } from '../src/scene/releaseRam.js';

const upload = g => { for (const a of [...Object.values(g.attributes), g.index]) a?.onUploadCallback(); }; // (giả lập WebGL gửi bộ đệm lên GPU)
function scene() {
  const s = new THREE.Scene(), house = new THREE.Group(), street = new THREE.Group();
  const merged = () => { const g = new THREE.BoxGeometry(2, 2, 2); g.userData.ownedMerge = true; return g; };
  const wall = new THREE.Mesh(merged()), road = new THREE.Mesh(merged()), shared = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  road.position.x = 10; shared.position.x = -10; house.add(wall, shared); street.add(road); s.add(house, street); s.updateMatrixWorld(true);
  return { s, house, wall, road, shared };
}
describe('releaseGeometryRam', () => {
  it('nhóm bấm được: giữ vị trí đỉnh, bỏ pháp tuyến/UV; tia bấm cho kết quả như trước', () => {
    const { s, house, wall } = scene();
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
    const before = ray.intersectObject(wall)[0];
    const r = releaseGeometryRam(s, { pickable: o => o === house }); upload(wall.geometry);
    expect(r.meshes).toBe(2);
    expect(wall.geometry.attributes.position.array).not.toBeNull(); expect(wall.geometry.attributes.normal.array).toBeNull(); expect(wall.geometry.attributes.uv.array).toBeNull();
    const after = ray.intersectObject(wall)[0];
    expect(after.distance).toBe(before.distance); expect(after.point.equals(before.point)).toBe(true); expect(after.face.normal.equals(before.face.normal)).toBe(true);
    expect(wall.geometry.attributes.normal).toBeTruthy(); // (thuộc tính vẫn còn cho GPU)
  });
  it('nhóm không bấm được: bỏ hết, hộp bao còn, tia trượt không lỗi', () => {
    const { s, house, road } = scene();
    releaseGeometryRam(s, { pickable: o => o === house }); upload(road.geometry);
    expect(road.geometry.attributes.position.array).toBeNull(); expect(road.geometry.index.array).toBeNull();
    expect(road.geometry.boundingSphere.radius).toBeGreaterThan(0);
    expect(new THREE.Box3().setFromObject(road).getSize(new THREE.Vector3()).x).toBeCloseTo(2);
    expect(new THREE.Raycaster(new THREE.Vector3(10, 0, 10), new THREE.Vector3(0, 0, -1)).intersectObject(road)).toEqual([]);
  });
  it('hình không phải hình gộp riêng: không đụng tới; chưa lên GPU thì vẫn giữ mảng', () => {
    const { s, house, shared, road } = scene();
    releaseGeometryRam(s, { pickable: o => o === house });
    expect(shared.geometry.attributes.normal.onUploadCallback.name).not.toBe('drop');
    expect(road.geometry.attributes.position.array).not.toBeNull(); // (chưa vẽ lần nào)
  });
});
