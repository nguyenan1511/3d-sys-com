// Giải phóng bản dữ liệu hình trong RAM (CPU) sau khi đã gửi lên GPU.
//
// Mặc định three.js giữ cả hai bản: mảng đỉnh trong RAM của trình duyệt và bộ đệm trên GPU. Bản trên GPU là bản dùng để vẽ;
// bản trong RAM chỉ cần khi code còn đọc lại hình: bấm chọn (raycast), gộp hình, tính hộp bao, cập nhật đỉnh, hoặc nạp
// lại khi GPU bị thu hồi. Văn phòng giữ ~126 MB mảng đỉnh trong RAM. Phần lớn là hình đã gộp (tĩnh, không ai đọc lại),
// nên với các hình đó bản trong RAM là thừa.
//
// Quy tắc an toàn:
// - chỉ đụng tới hình gộp riêng (geometry.userData.ownedMerge, do mergeStatic / optimizeStatic tạo ra): không dùng chung,
//   không bị gộp lại, không cập nhật đỉnh;
// - hộp bao / mặt cầu bao tính sẵn trước (cắt khung nhìn, ẩn tầng, Box3.setFromObject vẫn chạy);
// - mảng chỉ bị bỏ SAU KHI đã lên GPU (onUpload). Vật đang ẩn (chưa từng vẽ) vẫn giữ tới lần vẽ đầu;
// - hình có thể bị bấm trúng (toà nhà, nội thất): giữ vị trí đỉnh + chỉ số, bỏ pháp tuyến / UV / màu; tia bấm của mesh đó
//   dùng hàm chỉ đọc vị trí (kết quả point / face / distance y hệt, chỉ không có uv / normal nội suy — code không dùng);
// - hình không bao giờ bị bấm (đường phố, nhà hàng xóm…): bỏ hết.
// GPU bị thu hồi rồi trả lại thì không nạp lại được từ RAM: main.js tải lại trang (hiếm, có báo).
import * as THREE from 'three';

const drop = function () { this.array = null; }; // (three gọi sau khi gửi bộ đệm lên GPU; this = thuộc tính)
const PICK_ONLY = ['normal', 'uv', 'uv1', 'uv2', 'color', 'tangent'];

/** Tia bấm chỉ đọc vị trí đỉnh: tạm cất các thuộc tính đã bỏ mảng để three.js không đọc tới chúng. */
function raycastPositionsOnly(raycaster, hits) {
  const a = this.geometry.attributes, kept = {};
  for (const k of PICK_ONLY) if (a[k] && !a[k].array) { kept[k] = a[k]; delete a[k]; }
  try { THREE.Mesh.prototype.raycast.call(this, raycaster, hits); } finally { Object.assign(a, kept); }
}

/**
 * Đánh dấu giải phóng RAM cho các hình gộp trong `root`. pickable(o): mesh có thể bị tia bấm trúng (giữ vị trí đỉnh).
 * skip(o): bỏ qua cả nhánh. Trả về { meshes, bytes } — số mesh và dung lượng sẽ được giải phóng (sau lần vẽ đầu).
 */
export function releaseGeometryRam(root, { pickable = () => true, skip = () => false } = {}) {
  let meshes = 0, bytes = 0;
  const seen = new Set();
  const visit = (o, pick) => {
    if (skip(o)) return;
    pick = pick || pickable(o);
    const g = o.geometry;
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && g?.userData.ownedMerge && !g.userData.ramReleased && !seen.has(g) && !g.morphAttributes?.position) {
      seen.add(g);
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingSphere) g.computeBoundingSphere();
      for (const [k, attr] of Object.entries(g.attributes)) {
        if (pick && !PICK_ONLY.includes(k)) continue; // (vị trí đỉnh giữ lại cho tia bấm)
        if (!attr.array || attr.isInterleavedBufferAttribute) continue;
        attr.onUpload(drop); bytes += attr.array.byteLength;
      }
      if (!pick && g.index) { g.index.onUpload(drop); bytes += g.index.array.byteLength; }
      o.raycast = pick ? raycastPositionsOnly : () => {}; // (không bị bấm: tia luôn trượt, không đọc mảng đã bỏ)
      g.userData.ramReleased = pick ? 'keep-positions' : 'all';
      meshes++;
    }
    for (const c of o.children) visit(c, pick);
  };
  visit(root, false);
  return { meshes, bytes };
}
