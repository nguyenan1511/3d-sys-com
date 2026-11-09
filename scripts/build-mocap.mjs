// Chuyển chuyển động quay từ người thật (Quaternius Universal Animation Library 1 + 2, CC0 — assets-src/mocap/)
// thành góc quay cho 13 khớp của nhân vật chibi, lưu public/data/mocap.json + mocap.bin.
//
// Mỗi khớp chibi có một hướng chuẩn (tay/chân chỉ xuống -Y, thân/đầu chỉ lên +Y, bàn chân chỉ về trước -Z).
// Với xương mocap b: Q(t) là hướng (trong khung nhân vật) lúc t, Qr là hướng lúc nghỉ, U xoay hướng chuẩn của chibi
// thành hướng xương lúc nghỉ ⇒ hướng khớp chibi = Q(t)·Qr⁻¹·U (đúng hướng xương, giữ nguyên độ xoắn của chuyển động).
// Vị trí hông lưu theo đơn vị "chiều cao hông lúc nghỉ" để chibi chân ngắn vẫn chạm đất đúng.
//
// Dùng: node scripts/build-mocap.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './_server.mjs';

const FPS = 30;
const SEGS = ['pelvis', 'spine', 'head', 'upperL', 'upperR', 'foreL', 'foreR', 'thighL', 'thighR', 'shinL', 'shinR', 'ankleL', 'ankleR'];
// [xương, xương con (để lấy hướng), hướng chuẩn của khớp chibi]
const UP = [0, 1, 0], DOWN = [0, -1, 0], FWD = [0, 0, -1];
const RIGS = {
  ual1: {
    file: 'ual1.glb',
    map: {
      pelvis: ['DEF-hips', 'DEF-spine.001', UP], spine: ['DEF-spine.003', 'DEF-neck', UP], head: ['DEF-head', null, UP, 'DEF-neck'],
      upperL: ['DEF-upper_arm.L', 'DEF-forearm.L', DOWN], upperR: ['DEF-upper_arm.R', 'DEF-forearm.R', DOWN],
      foreL: ['DEF-forearm.L', 'DEF-hand.L', DOWN], foreR: ['DEF-forearm.R', 'DEF-hand.R', DOWN],
      thighL: ['DEF-thigh.L', 'DEF-shin.L', DOWN], thighR: ['DEF-thigh.R', 'DEF-shin.R', DOWN],
      shinL: ['DEF-shin.L', 'DEF-foot.L', DOWN], shinR: ['DEF-shin.R', 'DEF-foot.R', DOWN],
      ankleL: ['DEF-foot.L', 'DEF-toe.L', FWD], ankleR: ['DEF-foot.R', 'DEF-toe.R', FWD]
    },
    clips: {
      idle: 'Idle_Loop', walk: 'Walk_Formal_Loop', walkCasual: 'Walk_Loop', jog: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop',
      jumpStart: 'Jump_Start', jumpLoop: 'Jump_Loop', jumpLand: 'Jump_Land',
      sitIdle: 'Sitting_Idle_Loop', sitTalk: 'Sitting_Talking_Loop', sitEnter: 'Sitting_Enter', sitExit: 'Sitting_Exit',
      talk: 'Idle_Talking_Loop', dance: 'Dance_Loop', interact: 'Interact', pickup: 'PickUp_Table'
    }
  },
  ual2: {
    file: 'ual2.glb',
    map: {
      pelvis: ['pelvis', 'spine_01', UP], spine: ['spine_03', 'neck_01', UP], head: ['Head', null, UP, 'neck_01'],
      upperL: ['upperarm_l', 'lowerarm_l', DOWN], upperR: ['upperarm_r', 'lowerarm_r', DOWN],
      foreL: ['lowerarm_l', 'hand_l', DOWN], foreR: ['lowerarm_r', 'hand_r', DOWN],
      thighL: ['thigh_l', 'calf_l', DOWN], thighR: ['thigh_r', 'calf_r', DOWN],
      shinL: ['calf_l', 'foot_l', DOWN], shinR: ['calf_r', 'foot_r', DOWN],
      ankleL: ['foot_l', 'ball_l', FWD], ankleR: ['foot_r', 'ball_r', FWD]
    },
    clips: { phone: 'Idle_TalkingPhone_Loop', consume: 'Consume', yes: 'Yes', foldArms: 'Idle_FoldArms_Loop', no: 'Idle_No_Loop' }
  }
};
const LOCO = ['walk', 'jog', 'sprint']; // đo tốc độ tự nhiên để khớp nhịp chân với tốc độ di chuyển

const srv = await startServer(5373, { demo: false });
const b = await chromium.launch({ args: ['--use-angle=metal'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('pageerror', e.message));
await p.route('**/__mocap/*', r => r.fulfill({ path: resolve('assets-src/mocap', r.request().url().split('/').pop()) }));
await p.goto(srv.url);
const res = await p.evaluate(async ({ RIGS, SEGS, FPS, LOCO }) => {
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  const out = { clips: {}, rigs: {} }, chunks = [];
  let offset = 0;
  const V = a => new THREE.Vector3(...a);
  for (const [rigName, rig] of Object.entries(RIGS)) {
    const gl = await new GLTFLoader().loadAsync('/__mocap/' + rig.file);
    const root = gl.scene; root.updateMatrixWorld(true);
    const bone = n => { const o = root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n)); if (!o) throw new Error(rigName + ': thiếu xương ' + n); return o; };
    const wq = o => o.getWorldQuaternion(new THREE.Quaternion()), wp = o => o.getWorldPosition(new THREE.Vector3());
    // nghỉ: hướng nhân vật (từ gót tới mũi chân) → C xoay về khung chibi (nhìn về -Z)
    const restP = {}, restQ = {};
    const all = new Set(); for (const m of Object.values(rig.map)) { all.add(m[0]); if (m[1]) all.add(m[1]); if (m[3]) all.add(m[3]); }
    for (const n of all) { restP[n] = wp(bone(n)); restQ[n] = wq(bone(n)); }
    const fwd = new THREE.Vector3();
    for (const s of ['ankleL', 'ankleR']) { const [a, c] = rig.map[s]; fwd.add(restP[c].clone().sub(restP[a])); }
    fwd.y = 0; fwd.normalize();
    const C = new THREE.Quaternion().setFromUnitVectors(fwd, new THREE.Vector3(0, 0, -1));
    const hips = rig.map.pelvis[0], hip0 = restP[hips].clone().applyQuaternion(C);
    // chiều cao hông lúc nghỉ so với mặt đất (đáy bàn chân)
    const groundY = Math.min(restP[rig.map.ankleL[1]].y, restP[rig.map.ankleR[1]].y);
    const hipH = restP[hips].y - groundY;
    const U = {}, QrInv = {};
    for (const s of SEGS) {
      const [n, c, canon, from] = rig.map[s];
      const d = c ? restP[c].clone().sub(restP[n]) : restP[n].clone().sub(restP[from]);
      d.applyQuaternion(C).normalize();
      // thân/đầu chibi thẳng đứng lúc nghỉ (không chép độ cong cột sống người thật); tay chân theo hướng xương lúc nghỉ
      // chân, bàn chân cũng lấy tư thế nghỉ làm chuẩn: đứng tự nhiên, không dạng chân/chụm gối; bàn chân đặt phẳng như lúc nghỉ
      // của model (không ép 'nằm ngang tuyệt đối' — bàn chân nghỉ vốn hơi chúc mũi, ép ngang sẽ ngửa mũi chân lên)
      U[s] = ['pelvis', 'spine', 'head', 'thighL', 'thighR', 'shinL', 'shinR', 'ankleL', 'ankleR'].includes(s) ? new THREE.Quaternion() : new THREE.Quaternion().setFromUnitVectors(V(canon).normalize(), d);
      QrInv[s] = C.clone().multiply(restQ[n]).invert();
    }
    out.rigs[rigName] = { hipH };
    const mixer = new THREE.AnimationMixer(root);
    for (const [key, clipName] of Object.entries(rig.clips)) {
      const clip = gl.animations.find(a => a.name === clipName);
      if (!clip) throw new Error(rigName + ': thiếu clip ' + clipName);
      mixer.stopAllAction(); const act = mixer.clipAction(clip); act.reset().play();
      const frames = Math.max(2, Math.round(clip.duration * FPS) + 1);
      const data = new Float32Array(frames * (SEGS.length * 4 + 3));
      const feet = [];
      for (let f = 0; f < frames; f++) {
        mixer.setTime(Math.min(clip.duration, f / FPS)); root.updateMatrixWorld(true);
        let o = f * (SEGS.length * 4 + 3);
        SEGS.forEach(s => {
          const q = C.clone().multiply(wq(bone(rig.map[s][0]))).multiply(QrInv[s]).multiply(U[s]);
          data[o++] = q.x; data[o++] = q.y; data[o++] = q.z; data[o++] = q.w;
        });
        const h = wp(bone(hips)).applyQuaternion(C);
        data[o++] = (h.x - hip0.x) / hipH; data[o++] = (h.y - groundY) / hipH; data[o++] = (h.z - hip0.z) / hipH;
        if (LOCO.includes(key)) feet.push(['ankleL', 'ankleR'].map(s => wp(bone(rig.map[s][0])).applyQuaternion(C).sub(h)));
      }
      let speed = 0;
      if (feet.length) {
        // chân trụ (chân thấp hơn) lùi về sau với đúng tốc độ đi ⇒ trung vị vận tốc lùi của chân trụ
        const v = [];
        for (let f = 1; f < feet.length; f++) {
          const k = feet[f][0].y < feet[f][1].y ? 0 : 1;
          v.push((feet[f][k].z - feet[f - 1][k].z) * FPS);
        }
        v.sort((x, y) => x - y); speed = Math.abs(v[Math.floor(v.length / 2)]) / hipH;
      }
      out.clips[key] = { rig: rigName, offset, frames, dur: clip.duration, loop: /_Loop$/.test(clipName), speed: +speed.toFixed(4), src: clipName };
      offset += data.length; chunks.push(Array.from(data, x => +x.toFixed(5)));
    }
  }
  return { out, data: chunks.flat() };
}, { RIGS, SEGS, FPS, LOCO });
await b.close(); srv.stop();
// ---- dáng công sở cho các tư thế đứng: chân thẳng, rộng bằng hông; tay buông sát người; hông bớt lắc ----
// (Idle_Loop gốc đứng dạng chân, gối chùng như thế thủ). Giữ phần thân trên của mocap: thở, dồn trọng tâm nhẹ, nghiêng đầu.
const OFFICE = ['idle', 'talk', 'phone', 'foldArms', 'no', 'yes'];
const D = res.data, ST = SEGS.length * 4 + 3;
const toward = (o, k) => { // nlerp quaternion tại o về đơn vị (tư thế chuẩn) với hệ số k
  const sg = D[o + 3] < 0 ? -1 : 1;
  let x = D[o] * (1 - k), y = D[o + 1] * (1 - k), z = D[o + 2] * (1 - k), w = D[o + 3] * (1 - k) + sg * k;
  const n = Math.hypot(x, y, z, w) || 1; D[o] = x / n; D[o + 1] = y / n; D[o + 2] = z / n; D[o + 3] = w / n;
};
for (const key of OFFICE) {
  const c = res.out.clips[key]; if (!c) continue;
  let my = 0; for (let f = 0; f < c.frames; f++) my += D[c.offset + f * ST + 13 * 4 + 1]; my /= c.frames;
  for (let f = 0; f < c.frames; f++) {
    const o = c.offset + f * ST;
    for (const sIdx of [7, 8, 9, 10, 11, 12]) toward(o + sIdx * 4, 0.85); // đùi, cẳng chân, bàn chân
    toward(o + 0 * 4, 0.85);                                              // hông
    toward(o + 1 * 4, 0.8); toward(o + 2 * 4, 0.7);                       // lưng, đầu: đứng thẳng (mocap gốc ngả người ra sau bù cho hông đổ)
    for (const sIdx of [3, 4]) toward(o + sIdx * 4, 0.3);                 // cánh tay trên: bớt dang
    const h = o + 13 * 4;
    D[h] *= 0.3; D[h + 2] *= 0.3; D[h + 1] = 1 + (D[h + 1] - my) * 0.3;    // hông: đứng thẳng, chỉ nhấp nhô theo nhịp thở
  }
}
const bin = Buffer.from(new Float32Array(res.data).buffer);
writeFileSync('public/data/mocap.bin', bin);
writeFileSync('public/data/mocap.json', JSON.stringify({
  _nguon: 'Quaternius — Universal Animation Library 1 & 2 (CC0 1.0, quaternius.com). Tạo bằng scripts/build-mocap.mjs; đừng sửa tay.',
  fps: FPS, segs: SEGS, stride: SEGS.length * 4 + 3, ...res.out
}, null, 1) + '\n');
console.log(`mocap: ${Object.keys(res.out.clips).length} clip, ${(bin.length / 1024).toFixed(0)} KB`);
for (const [k, c] of Object.entries(res.out.clips)) console.log(`  ${k.padEnd(10)} ${c.src.padEnd(24)} ${c.dur.toFixed(2)}s ${c.loop ? 'loop' : '    '} ${c.speed ? 'tốc độ ' + c.speed + ' hông/s' : ''}`);
