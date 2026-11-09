// Texture vẽ bằng canvas và bảng vật liệu dùng chung.
import * as THREE from 'three';

export function makeMaterials(ctx) {
  const { tcv, L, LD, rng } = ctx;
  const roofTex = (base, line) => tcv(128, 128, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); g.strokeStyle = line; g.lineWidth = 3; for (let x = 0; x <= w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } g.lineWidth = 2; for (let i = 0; i < 4; i++) for (let y = 0; y < h; y += 32) { const yy = y + (i % 2) * 16; g.beginPath(); g.moveTo(i * 32, yy); g.lineTo(i * 32 + 32, yy); g.stroke(); } });
  const T = {};
  T.roof = roofTex('#4a3025', '#2a1710');
  T.roofRed = roofTex('#a2523a', '#6b3022');
  T.stone = tcv(256, 256, (g, w, h) => { const r = rng(7); g.fillStyle = '#c9b484'; g.fillRect(0, 0, w, h); const cols = ['#e8d7ad', '#dfcc9f', '#ecdcb7', '#e2d0a6']; for (let y = 0, row = 0; y < h; y += 32, row++) { let x = -(row % 2) * 40; while (x < w) { const bw = 50 + r() * 50; g.fillStyle = cols[Math.floor(r() * 4)]; g.fillRect(x + 2, y + 2, bw - 4, 28); x += bw; } } });
  T.brick = tcv(128, 128, (g, w, h) => { const r = rng(11); g.fillStyle = '#9d5e3a'; g.fillRect(0, 0, w, h); const cols = ['#c98a5e', '#c27d52', '#d09468', '#bf7a4e']; for (let y = 0, row = 0; y < h; y += 16, row++) { let x = -(row % 2) * 20; while (x < w) { g.fillStyle = cols[Math.floor(r() * 4)]; g.fillRect(x + 1, y + 1, 38, 14); x += 40; } } });
  T.stripe = tcv(128, 16, g => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f2f1ec' : '#1d1d1d'; g.fillRect(i * 16, 0, 16, 16); } });
  T.awnG = tcv(128, 16, g => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#d6d9df' : '#7c8494'; g.fillRect(i * 16, 0, 16, 16); } });
  T.bamboo = tcv(64, 64, (g, w, h) => { for (let x = 0; x < w; x += 4) { g.fillStyle = (x / 4) % 2 ? '#b08555' : '#9a6f41'; g.fillRect(x, 0, 4, h); } g.strokeStyle = '#5d4328'; g.lineWidth = 2; [14, 46].forEach(y => { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }); });
  T.paver = tcv(128, 128, (g, w, h) => { g.fillStyle = '#b8a193'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8f7769'; g.lineWidth = 2; for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } });
  T.plate = tcv(128, 64, (g, w, h) => { g.fillStyle = '#f3f3ef'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2c2c2c'; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6); g.fillStyle = '#2c2c2c'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('31-33', w / 2, h / 2 + 2); });
  T.shutter = tcv(64, 64, (g, w, h) => { g.fillStyle = '#c6c9cd'; g.fillRect(0, 0, w, h); g.strokeStyle = '#9da1a6'; g.lineWidth = 2; for (let x = 0; x <= w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } });
  T.zig = tcv(64, 64, (g, w, h) => { g.fillStyle = '#f1efe8'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d1d1d'; for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) if (((x + y) / 16) % 2 === 0) g.fillRect(x, y, 16, 16); });
  T.lattice = tcv(64, 64, (g, w, h) => { g.fillStyle = '#ebdfb6'; g.fillRect(0, 0, w, h); g.strokeStyle = '#cdbd8a'; g.lineWidth = 2; for (let i = -w; i <= w * 2; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke(); } });
  T.screen = tcv(128, 80, (g, w, h) => {
    g.fillStyle = '#1f3552'; g.fillRect(0, 0, w, h); g.fillStyle = '#2d4b73'; g.fillRect(0, 0, 26, h); g.fillStyle = '#3d6aa6'; g.fillRect(0, 0, w, 9);
    const r = rng(3), cols = ['#9fd0ff', '#ffd27f', '#a5e8a0', '#e8eef5'];
    for (let y = 15; y < h - 4; y += 7) { let x = 32 + Math.floor(r() * 3) * 6; const n = 1 + Math.floor(r() * 3); for (let k = 0; k < n; k++) { const ww = 8 + r() * 30; g.fillStyle = cols[Math.floor(r() * 4)]; g.fillRect(x, y, ww, 3); x += ww + 4; } }
  });
  T.screen.wrapS = T.screen.wrapT = THREE.ClampToEdgeWrapping;

  const M = {
    plaster: L(0xf0ebe1), white: L(0xf8f6f1), dark: L(0x2e2019), iron: L(0x232527), trim: L(0xd9d3c7), conc: L(0xb9b5ac), gate: L(0x24413d), wall: L(0xf4f2ed), cap: L(0x45494a), base: L(0x5b5a57),
    glass: new THREE.MeshLambertMaterial({ color: 0x2d3a49, emissive: 0x0b121a }), glassD: new THREE.MeshLambertMaterial({ color: 0x2d3a49, emissive: 0x0b121a, side: THREE.DoubleSide }),
    glassT: new THREE.MeshLambertMaterial({ color: 0xa9c3d3, transparent: true, opacity: 0.28, depthWrite: false }),
    awhite: LD(0xf3efe8), gcream: LD(0xece1cf), trunk: L(0x5b4330), void_: L(0x34363a), asphalt: L(0x6a6c70), tire: L(0x1a1a1a), seat: L(0x222222), lampHead: L(0xdcdcd4), yellow: L(0xe6b800), wcream: L(0xe9d9a6), wpanel: L(0xf1e6c0),
    screenOn: new THREE.MeshBasicMaterial({ map: T.screen }), screenOff: new THREE.MeshLambertMaterial({ color: 0x0c0e12 }),
    lampPanel: new THREE.MeshBasicMaterial({ color: 0xfffbee })
  };
  M.glassT.userData.noShadow = true; M.glass.userData.noShadow = true; M.glassD.userData.noShadow = true;
  ctx.T = T; ctx.M = M;
  return { T, M };
}
