// Giao thông trên đường: giữ khoảng cách với xe trước, dừng trước người, không bao giờ chồng nhau,
// vòng lại đầu đường chỉ khi chỗ xuất hiện còn trống. Thuần JS để kiểm thử được.
export const ROAD = [12.7, 26.7];
export const MIN_GAP = 1.2; // khoảng cách tối thiểu giữa hai xe (m)

/**
 * movers: [{ o: { position: {x, z} }, dir, v0, speed, len }]; chars: [{x, z, visible}].
 * Gán m.person = người đang chặn đầu xe (hoặc null).
 */
export function stepTraffic(movers, dt, chars, XL, XR) {
  for (const m of movers) {
    const p = m.o.position, half = m.len / 2;
    // người trong làn phía trước
    let pGap = Infinity, person = null;
    for (const c of chars) {
      if (!c || !c.visible || c.z < ROAD[0] - 0.2 || c.z > ROAD[1] + 0.2 || Math.abs(c.z - p.z) > 1.1) continue;
      const d = (c.x - p.x) * m.dir - half;
      if (d > -0.4 && d < 8 && d < pGap) { pGap = d; person = c; }
    }
    // xe phía trước cùng làn (tính cả khi vòng qua mép mô hình)
    let vGap = Infinity, lead = null;
    for (const o of movers) {
      if (o === m || o.dir !== m.dir || Math.abs(o.o.position.z - p.z) > 0.5) continue;
      let d = (o.o.position.x - p.x) * m.dir - half - o.len / 2;
      if (d < -0.5) d += (XR - XL) + 8;
      if (d < vGap) { vGap = d; lead = o; }
    }
    // tốc độ mong muốn: giữ khoảng cách theo tốc độ xe trước, dừng trước người 1 m
    let target = m.v0;
    if (vGap < 18) target = Math.min(target, Math.max(0, (lead ? lead.speed : 0) + (vGap - MIN_GAP - m.speed * 0.6) * 1.2));
    if (pGap < 8) target = Math.min(target, Math.max(0, (pGap - 1.0) * 2.0));
    m.speed += Math.max(-14 * dt, Math.min(2.5 * dt, target - m.speed));
    let step = m.dir * m.speed * dt;
    // ràng buộc cứng: không bao giờ chạm xe trước hay người
    const room = Math.min(vGap - MIN_GAP * 0.6, pGap - 0.5);
    if (Math.abs(step) > Math.max(0, room)) { step = m.dir * Math.max(0, room); m.speed = Math.min(m.speed, lead && vGap < pGap ? lead.speed : 0); }
    p.x += step;
    // ra khỏi mép thì vòng lại đầu kia, chỉ khi chỗ xuất hiện còn trống
    if ((m.dir > 0 && p.x > XR + 4) || (m.dir < 0 && p.x < XL - 4)) {
      let nx = m.dir > 0 ? XL - 4 : XR + 4;
      for (const o of movers) {
        if (o === m || o.dir !== m.dir || Math.abs(o.o.position.z - p.z) > 0.5) continue;
        const d = (o.o.position.x - nx) * m.dir;
        if (d > -(half + o.len / 2 + MIN_GAP) && d < half + o.len / 2 + MIN_GAP + 3) nx = o.o.position.x - m.dir * (half + o.len / 2 + MIN_GAP + 3);
      }
      p.x = nx;
    }
    m.person = person;
  }
}
