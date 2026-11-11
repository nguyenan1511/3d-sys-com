// Ẩn tầng bị che (src/scene/floorCull.js): chỉ ẩn khi chắc chắn không nhìn thấy.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FloorCuller } from '../src/scene/floorCull.js';
import { buildModel } from '../src/model/layoutModel.js';
import { readJson } from './helpers.js';

const model = buildModel(readJson('public/data/layout.json'));
const groups = () => model.floors.map(f => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); m.position.y = model.floorY(f.id) + 0.6; g.add(m); return g; });
const inside = C => { for (const f of model.floors) if (C.y > model.floorY(f.id) && C.y < f.ceiling) return C.inside ? f.id : null; return null; };
function setup() { const gs = groups(), fc = new FloorCuller(model, { cameraFloor: inside }); gs.forEach((g, i) => fc.add(g, i)); return { gs, fc }; }
const vis = gs => gs.map(g => g.visible);

describe('FloorCuller', () => {
  it('camera ngoài nhà: vẽ mọi tầng', () => {
    const { gs, fc } = setup(); fc.update({ x: 0, y: 30, z: 40 }, null, null);
    expect(vis(gs)).toEqual([true, true, true]);
  });
  it('camera trong nhà tầng 2, xa cầu thang: chỉ vẽ tầng 2', () => {
    const { gs, fc } = setup(); fc.update({ x: 0, y: model.floorY(1) + 1.6, z: 0, inside: true }, null, { x: 6, z: 3, f: 1 });
    expect(vis(gs)).toEqual([false, true, false]);
  });
  it('gần / trên cầu thang: vẽ cả tầng trên và dưới', () => {
    const { gs, fc } = setup(); const s = model.stairs[0];
    fc.update({ x: 0, y: model.floorY(1) + 1.6, z: 0, inside: true }, null, { x: s.x1 + 1, z: (s.z0 + s.z1) / 2, f: 1 });
    expect(vis(gs)).toEqual([true, true, true]);
    fc.update({ x: 0, y: model.floorY(0) + 1.6, z: 0, inside: true }, null, { x: 6, z: 3, onStair: 'S1' });
    expect(vis(gs)).toEqual([true, true, false]);
  });
  it('cắt tầng: ẩn các tầng phía trên mặt cắt; bỏ cắt thì hiện lại', () => {
    const { gs, fc } = setup(); fc.update({ x: 0, y: 30, z: 40 }, 0, null);
    expect(vis(gs)).toEqual([true, false, false]);
    fc.update({ x: 0, y: 30, z: 40 }, null, null);
    expect(vis(gs)).toEqual([true, true, true]);
  });
  it('xếp nhóm theo hộp bao: nhóm vắt qua hai tầng luôn vẽ', () => {
    const fc = new FloorCuller(model, { cameraFloor: inside }), root = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); a.position.y = model.floorY(1) + 1;
    const tall = new THREE.Mesh(new THREE.BoxGeometry(1, 8, 1)); tall.position.y = 4;
    root.add(a, tall); fc.addChildrenByBox(root);
    fc.update({ x: 0, y: 1.6, z: 0, inside: true }, null, { x: 6, z: 3, f: 0 });
    expect(a.visible).toBe(false); expect(tall.visible).toBe(true);
  });
});
