import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import fs from 'fs';
import { computeSkin, legOf, BONES } from '../src/agents/glbCharacters.js';

const defs = JSON.parse(fs.readFileSync('public/data/characters.json', 'utf8')).characters;

// bộ khớp mẫu: người đang bước (chân trái trước, tay trái đưa ra trước), cao 1.9 đơn vị
const RIG = {
  joints: {
    hip: [0, 0.465, 0], spine: [0, 0.58, -0.01], neck: [0.01, 0.845, 0], headTop: [0.02, 1, 0.02],
    hipL: [0.05, 0.46, 0.015], kneeL: [0.035, 0.27, 0.095], ankleL: [0.062, 0.075, 0.125], toeL: [0.08, 0.03, 0.22],
    hipR: [-0.05, 0.46, -0.01], kneeR: [-0.03, 0.26, -0.055], ankleR: [-0.068, 0.075, -0.135], toeR: [-0.06, 0.03, -0.075],
    shoulderL: [0.1, 0.78, 0], elbowL: [0.128, 0.6, 0.012], wristL: [0.155, 0.48, 0.12], handL: [0.16, 0.43, 0.16],
    shoulderR: [-0.1, 0.78, 0], elbowR: [-0.118, 0.6, 0.03], wristR: [-0.108, 0.47, 0.055], handR: [-0.105, 0.39, 0.055]
  },
  armMinX: 0.095, armMinZ: -0.06
};
const H = 1.9;

describe('khung xương theo vị trí khớp (model đứng tư thế bất kỳ)', () => {
  const pts = {
    footL: [0.07, 0.03, 0.18], footR: [-0.065, 0.03, -0.12], kneeL: [0.035, 0.29, 0.085], shinR: [-0.05, 0.16, -0.1],
    handL: [0.158, 0.45, 0.14], handR: [-0.106, 0.41, 0.055], head: [0.02, 0.93, 0.05], chest: [0, 0.72, 0.08],
    backpack: [-0.12, 0.62, -0.2], pelvis: [0, 0.47, 0.05], elbowL: [0.13, 0.62, 0.0]
  };
  const names = Object.keys(pts);
  const { idx, wgt } = computeSkin(new THREE.Float32BufferAttribute(names.flatMap(k => pts[k].map(v => v * H)), 3), H, RIG);
  const main = i => { let b = 0, w = -1; for (let k = 0; k < 4; k++) if (wgt[i * 4 + k] > w) { w = wgt[i * 4 + k]; b = idx[i * 4 + k]; } return BONES[b]; };
  const at = k => main(names.indexOf(k));
  it('trọng số mỗi đỉnh cộng lại bằng 1', () => { for (let i = 0; i < names.length; i++) expect(wgt.slice(i * 4, i * 4 + 4).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4); });
  it('chân, tay đúng bên và đúng đoạn', () => {
    expect(at('footL')).toBe('shinL'); expect(at('footR')).toBe('shinR'); expect(at('shinR')).toBe('shinR');
    expect(['thighL', 'shinL']).toContain(at('kneeL'));
    expect(at('handL')).toBe('foreL'); expect(at('handR')).toBe('foreR'); expect(['upperL', 'foreL']).toContain(at('elbowL'));
  });
  it('đầu thuộc đầu; ngực, ba lô sau lưng thuộc thân (không bị kéo theo tay)', () => {
    expect(at('head')).toBe('head'); expect(at('chest')).toBe('spine'); expect(at('backpack')).toBe('spine'); expect(['hips', 'spine', 'thighL', 'thighR']).toContain(at('pelvis'));
  });
  it('chân ở tư thế chuẩn: hông = cổ chân + đùi + cẳng chân (chân duỗi thẳng)', () => {
    const leg = legOf(RIG, H);
    expect(leg.L1).toBeGreaterThan(0.18 * H); expect(leg.L2).toBeGreaterThan(0.18 * H);
    expect(leg.hip).toBeCloseTo(leg.ankle + leg.L1 + leg.L2, 6);
    expect(leg.hip).toBeGreaterThan(RIG.joints.hip[1] * H); // đang bước (gối hơi gập) nên hông thấp hơn lúc đứng thẳng
  });
  it('mỗi nhân vật trong characters.json khai báo đủ khớp và có file model', () => {
    const need = ['hip', 'spine', 'neck', 'headTop', ...['L', 'R'].flatMap(s => ['hip', 'knee', 'ankle', 'toe', 'shoulder', 'elbow', 'wrist', 'hand'].map(k => k + s))];
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) {
      if (d.format === 'mo') { expect(['toy', 'pixar']).toContain(d.look?.style); continue; } // dựng bằng code (my-office)
      if (d.format === 'chibi') { expect(d.look?.species, d.id + ': species').toBeTruthy(); continue; } // dựng bằng code, không có file
      expect(fs.existsSync('public/' + d.file), d.file).toBe(true);
      if (d.format === 'vrm') continue; // VRM: xương chuẩn có sẵn trong file
      if (d.format === 'rigged') { for (const k of ['hips', 'chest', 'head', 'upperL', 'upperR', 'lowerL', 'lowerR', 'thighL', 'thighR', 'shinL', 'shinR']) expect(d.bones?.[k], `${d.id}: ${k}`).toBeTruthy(); continue; }
      for (const k of need) expect(d.rig.joints[k], `${d.id}: ${k}`).toHaveLength(3);
    }
  });
  it('nhân vật VRM có giấy phép cho phép doanh nghiệp dùng (đọc từ meta trong file)', () => {
    for (const d of defs.filter(d => d.format === 'vrm')) {
      const b = fs.readFileSync('public/' + d.file), j = JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString());
      const m = j.extensions?.VRMC_vrm?.meta, m0 = j.extensions?.VRM?.meta;
      expect(m || m0, d.id).toBeTruthy();
      if (m) { // VRM 1.0
        expect(m.avatarPermission, d.id).toBe('everyone');
        expect(m.commercialUsage, d.id).toBe('corporation');
        expect(j.extensions.VRMC_vrm.humanoid.humanBones.hips, d.id).toBeTruthy();
      } else { // VRM 0.x: điều khoản VRoid Hub nằm trong otherPermissionUrl
        expect(m0.allowedUserName, d.id).toBe('Everyone');
        expect(m0.commercialUssageName, d.id).toBe('Allow');
        expect(m0.otherPermissionUrl, d.id).toMatch(/corporate_commercial_use=allow/);
        expect(j.extensions.VRM.humanoid.humanBones.some(b => b.bone === 'hips'), d.id).toBe(true);
      }
    }
  });
});
