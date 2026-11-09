// Miếng logo SYSONE in trên áo nhân vật: logo gốc (public/logo/sysone-logo.png, không vẽ lại) trên nền trắng bo góc.
import * as THREE from 'three';

// ---------- logo SYSONE trên áo: logo gốc in trên miếng patch trắng bo góc (đọc được trên cả áo tối màu) ----------
let _patch = null;
export function logoPatch() {
  if (_patch) return _patch;
  const cv = document.createElement('canvas'); cv.width = 640; cv.height = 170;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const c = cv.getContext('2d');
  const draw = img => {
    c.clearRect(0, 0, 640, 170);
    c.fillStyle = '#ffffff'; c.beginPath(); c.roundRect(4, 4, 632, 162, 34); c.fill();
    c.strokeStyle = 'rgba(43,45,66,.18)'; c.lineWidth = 4; c.stroke();
    if (img) { const w = 560, h = w * img.height / img.width; c.drawImage(img, 40, (170 - h) / 2, w, h); }
    tex.needsUpdate = true;
  };
  draw(null);
  const img = new Image(); img.onload = () => draw(img); img.src = new URL('logo/sysone-logo.png', document.baseURI).href; // logo gốc, không vẽ lại
  _patch = { tex, aspect: 170 / 640 };
  return _patch;
}


// ---------- logo thêu trực tiếp lên vải áo (không có miếng nền): logo gốc + đường chỉ thêu, gờ nổi nhẹ ----------
let _stitch = null;
export function logoStitch() {
  if (_stitch) return _stitch;
  const W = 768, H = 192, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const c = cv.getContext('2d');
  const draw = img => {
    c.clearRect(0, 0, W, H); if (!img) { tex.needsUpdate = true; return; }
    const w = W - 40, h = Math.min(H - 24, w * img.height / img.width), ww = h * img.width / img.height, x = (W - ww) / 2, y = (H - h) / 2;
    // gờ chỉ: bóng tối lệch xuống dưới, viền sáng lệch lên trên (logo nổi trên mặt vải)
    const sil = document.createElement('canvas'); sil.width = W; sil.height = H; const s = sil.getContext('2d');
    s.drawImage(img, x, y, ww, h); s.globalCompositeOperation = 'source-in';
    s.fillStyle = 'rgba(20,22,30,.55)'; s.fillRect(0, 0, W, H); c.drawImage(sil, 0, 3);
    s.globalCompositeOperation = 'source-over'; s.clearRect(0, 0, W, H); s.drawImage(img, x, y, ww, h); s.globalCompositeOperation = 'source-in'; s.fillStyle = 'rgba(255,255,255,.55)'; s.fillRect(0, 0, W, H); c.drawImage(sil, 0, -2);
    c.drawImage(img, x, y, ww, h);
    // sợi chỉ thêu: vạch chéo mảnh chỉ trên phần logo
    c.save(); c.globalCompositeOperation = 'source-atop';
    for (let k = -H; k < W; k += 5) { c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(k, H); c.lineTo(k + H * 0.6, 0); c.stroke(); c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 1; c.beginPath(); c.moveTo(k + 2.5, H); c.lineTo(k + 2.5 + H * 0.6, 0); c.stroke(); }
    c.restore();
    tex.needsUpdate = true;
  };
  draw(null);
  const img = new Image(); img.onload = () => draw(img); img.src = new URL('logo/sysone-logo.png', document.baseURI).href; // logo gốc, không vẽ lại
  _stitch = { tex, aspect: H / W };
  return _stitch;
}
