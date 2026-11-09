// Quy định văn phòng — dùng chung client/server.

// Ranh giới toà nhà: theo layout.json (vùng đi được trong nhà, layout.world = 'my-office') khi đã đặt; mặc định là toà
// nhà 33 Dương Quang Đông cũ (khung tường x ∈ [-3.3, 3.3], z ∈ [-7.3, 8.9]; từ z 9 trở ra là vỉa hè/đường).
let BOX = null;
/** Đặt ranh giới toà nhà từ layout (gọi ở server khi nạp layout, ở client khi dựng mô hình). */
export function setOfficeFromLayout(layout) {
  const a = layout?.world === 'my-office' ? layout.nav?.areas : layout?.world === 'sysone-mo' ? (layout.nav?.areas || []).filter(r => /^tầng|^chân|^chiếu/.test(r.name || '')) : null; // (toà nhà 3 tầng: trong nhà + khối thang; sân thượng/sân trước là ngoài trời)
  BOX = a && a.length ? { x0: Math.min(...a.map(r => r.x0)) - 0.3, x1: Math.max(...a.map(r => r.x1)) + 0.3, z0: Math.min(...a.map(r => r.z0)) - 0.3, z1: Math.max(...a.map(r => r.z1)) + 0.3 } : null;
}
/** Ở trong toà nhà (mọi tầng). */
export const insideOffice = (x, z) => BOX ? x > BOX.x0 && x < BOX.x1 && z > BOX.z0 && z < BOX.z1 : Math.abs(x) <= 3.4 && z > -7.4 && z < 8.95;

/** Không hút thuốc trong văn phòng làm việc: chỉ được hút ngoài trời. */
export const NO_SMOKING = 'Không hút thuốc trong văn phòng — ra ngoài toà nhà để hút nhé.';
export const smokeAllowed = (x, z) => !insideOffice(x, z);
