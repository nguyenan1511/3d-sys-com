// RoundedBoxGeometry nhanh, cho ra ĐÚNG TỪNG SỐ như three/examples/jsm/geometries/RoundedBoxGeometry.js (vite.config.js trỏ
// đường dẫn đó về file này, nên mọi chỗ dùng — kể cả mã my-office — tự dùng bản nhanh).
//
// Bản gốc dựng hộp đơn vị chia ô, rồi với từng đỉnh tính pháp tuyến và UV bằng normalize + angleTo. Đây là phần tốn nhất
// lúc tải văn phòng (hàng nghìn hộp, ~0,8 s trên máy tính, ~3 s trên điện thoại yếu). Nhưng pháp tuyến, góc và dấu chỉ
// phụ thuộc số ô chia, không phụ thuộc kích thước hộp. Nên tính chúng một lần cho mỗi số ô chia, mỗi hộp chỉ còn vài
// phép nhân/cộng, cùng thứ tự phép tính như bản gốc.
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

const TEMPLATES = new Map();
const AX = { x: 0, y: 1, z: 2 };
// [trục UV, trục chiếu, hướng mặt, đảo (1 - …)] cho u và v của 6 mặt — như switch (side) của bản gốc
const SIDES = [
  [['z', 'y', [1, 0, 0], false], ['y', 'z', [1, 0, 0], true]],    // phải
  [['z', 'y', [-1, 0, 0], true], ['y', 'z', [-1, 0, 0], true]],   // trái
  [['x', 'z', [0, 1, 0], true], ['z', 'x', [0, 1, 0], false]],    // trên
  [['x', 'z', [0, -1, 0], true], ['z', 'x', [0, -1, 0], true]],   // dưới
  [['x', 'y', [0, 0, 1], true], ['y', 'x', [0, 0, 1], true]],     // trước
  [['x', 'y', [0, 0, -1], false], ['y', 'x', [0, 0, -1], true]]   // sau
];

function template(segments) {
  if (TEMPLATES.has(segments)) return TEMPLATES.get(segments);
  const total = segments * 2 + 1, half = 0.5 / total;
  const unit = new BoxGeometry(1, 1, 1, total, total, total), flat = unit.toNonIndexed();
  const P = flat.attributes.position.array, n = P.length / 3, faceTris = P.length / 6;
  const sign = new Float32Array(n * 3), nrm = new Float64Array(n * 3); // (pháp tuyến giữ độ chính xác double như bản gốc)
  // mỗi đỉnh, mỗi trục UV: tỉ lệ góc trên cung (arcAngleRatio) và dấu (thuộc cung đầu hay cung cuối)
  const ang = new Float64Array(n * 2), pos = new Uint8Array(n * 2), side = new Uint8Array(n);
  const p = new Vector3(), nv = new Vector3(), t = new Vector3(), face = new Vector3();
  for (let i = 0, v = 0; i < P.length; i += 3, v++) {
    p.fromArray(P, i);
    nv.copy(p); nv.x -= Math.sign(nv.x) * half; nv.y -= Math.sign(nv.y) * half; nv.z -= Math.sign(nv.z) * half; nv.normalize();
    sign[i] = Math.sign(p.x); sign[i + 1] = Math.sign(p.y); sign[i + 2] = Math.sign(p.z);
    nrm[i] = nv.x; nrm[i + 1] = nv.y; nrm[i + 2] = nv.z;
    const s = Math.floor(i / faceTris); side[v] = s;
    SIDES[s].forEach(([uvAxis, projAxis, dir], k) => {
      face.fromArray(dir); t.copy(nv); t[projAxis] = 0; t.normalize();
      ang[v * 2 + k] = 1.0 - (t.angleTo(face) / (Math.PI / 4));
      pos[v * 2 + k] = Math.sign(t[uvAxis]) === 1 ? 1 : 0;
    });
  }
  const tpl = { n, sign, nrm, ang, pos, side, groups: unit.groups.map(g => ({ ...g })) };
  unit.dispose(); flat.dispose();
  TEMPLATES.set(segments, tpl);
  return tpl;
}

export class RoundedBoxGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, depth = 1, segments = 2, radius = 0.1) {
    super();
    this.type = 'RoundedBoxGeometry';
    radius = Math.min(width / 2, height / 2, depth / 2, radius);
    this.parameters = { width, height, depth, segments, radius };
    if (segments * 2 + 1 === 1) { // (như bản gốc: không bo — hộp thường)
      const b = new BoxGeometry(1, 1, 1, 1, 1, 1); this.copy(b); this.type = 'RoundedBoxGeometry'; this.parameters = { width, height, depth, segments, radius }; b.dispose(); return;
    }
    const T = template(segments), { n, sign, nrm, ang, pos, side } = T;
    const bx = width / 2 - radius, by = height / 2 - radius, bz = depth / 2 - radius;
    const P = new Float32Array(n * 3), N = new Float32Array(nrm), U = new Float32Array(n * 2);
    const sideLen = { x: width, y: height, z: depth };
    // hằng số của từng (trục UV) — phụ thuộc kích thước hộp
    const totArc = 2 * Math.PI * radius / 4, consts = {};
    for (const a of ['x', 'y', 'z']) { const center = Math.max(sideLen[a] - 2 * radius, 0); consts[a] = { arc: 0.5 * totArc / (totArc + center), len: center / (totArc + center) }; }
    for (let v = 0, i = 0; v < n; v++, i += 3) {
      P[i] = bx * sign[i] + nrm[i] * radius; P[i + 1] = by * sign[i + 1] + nrm[i + 1] * radius; P[i + 2] = bz * sign[i + 2] + nrm[i + 2] * radius;
      const sd = SIDES[side[v]];
      for (let k = 0; k < 2; k++) {
        const c = consts[sd[k][0]], a = ang[v * 2 + k];
        const uv = pos[v * 2 + k] ? a * c.arc : c.len + c.arc + c.arc * (1.0 - a);
        U[v * 2 + k] = sd[k][3] ? 1.0 - uv : uv;
      }
    }
    this.setAttribute('position', new Float32BufferAttribute(P, 3));
    this.setAttribute('normal', new Float32BufferAttribute(N, 3));
    this.setAttribute('uv', new Float32BufferAttribute(U, 2));
    for (const g of T.groups) this.addGroup(g.start, g.count, g.materialIndex);
  }
  copy(source) { super.copy(source); this.parameters = Object.assign({}, source.parameters); return this; }
  static fromJSON(data) { return new RoundedBoxGeometry(data.width, data.height, data.depth, data.segments, data.radius); }
}
