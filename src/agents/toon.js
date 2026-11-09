// Kiểu vẽ hoạt hình dùng chung cho nhân vật: tô 3 mảng sáng/tối (toon) + viền mực bằng vỏ ngược
// (vẽ mặt sau của chính hình đó, đẩy ra ngoài theo pháp tuyến), chạy được với InstancedMesh và SkinnedMesh.
import * as THREE from 'three';

/**
 * Bật/tắt viền mực toàn cục. Khi đang cắt tầng (renderer.clippingPlanes — góc tổng quan, chọn chỗ) lớp viền mặt sau bị vẽ
 * đè lên thân làm nhân vật đen kịt, nên tắt viền lúc đó (nhìn xa, viền cũng gần như không thấy).
 */
export const OUTLINE = { on: true };

let _ramp = null;
export function toonRamp() {
  if (!_ramp) {
    _ramp = new THREE.DataTexture(new Uint8Array([105, 105, 105, 255, 190, 190, 190, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
    _ramp.minFilter = _ramp.magFilter = THREE.NearestFilter; _ramp.needsUpdate = true;
  }
  return _ramp;
}

/**
 * Chất liệu toon cho nhân vật: phần ánh sáng trực tiếp (mặt trời, đèn trần) bị giới hạn để màu không cháy trắng
 * dù đứng sát đèn — nhờ vậy màu ở màn hình tạo nhân vật và trong văn phòng giống nhau.
 */
export function characterToon(cap = 0.45, base = 0.8) {
  const m = new THREE.MeshToonMaterial({ color: new THREE.Color(base, base, base), gradientMap: toonRamp() });
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>',
      `#include <lights_fragment_end>\n  reflectedLight.directDiffuse = min(reflectedLight.directDiffuse, diffuseColor.rgb * ${cap.toFixed(3)});`);
  };
  m.customProgramCacheKey = () => 'charToon' + cap;
  return m;
}

/** width: độ dày viền theo đơn vị của hình (trước khi nhân tỉ lệ). */
export function outlineMaterial(width, color = 0x2a2c3a, skinned = false) {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.userData.keepSide = true; // viền phải luôn vẽ mặt sau (cắt tầng không được đổi sang hai mặt)
  m.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n  transformed += normalize(normal) * ${width.toFixed(4)};`); };
  m.customProgramCacheKey = () => 'outline' + width + (skinned ? 's' : '');
  return m;
}

/**
 * Chất liệu kiểu đồ chơi vinyl / thú bông (giống nhân vật Meshy trong bản demo): PBR nhám vừa, ánh "sheen" mềm ở mép
 * như vải nhung/lông, không viền mực. Màu từng bộ phận lấy từ màu instance.
 */
export function characterVinyl() {
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, specularIntensity: 0.3, sheen: 0.15, sheenRoughness: 0.85, sheenColor: new THREE.Color(0xffffff) });
}
