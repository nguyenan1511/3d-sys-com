// "Đóng băng" ma trận của các vật đứng yên. three.js mặc định tính lại ma trận (vị trí × hướng × tỉ lệ) và ma trận thế giới
// của MỌI vật mỗi khung hình. Văn phòng có ~3.500 vật, phần lớn không bao giờ di chuyển. Phần này tốn ~18% thời gian CPU
// mỗi khung hình (đo bằng profiler).
//
// Cách làm an toàn (không cần biết trước vật nào động):
// - tắt matrixAutoUpdate của từng vật và ghi lại vị trí / hướng / tỉ lệ / cha của nó;
// - mỗi khung hình chỉ SO SÁNH 10 số với bản ghi (rẻ hơn nhiều lần so với dựng lại hai ma trận 4×4);
// - vật nào vừa đổi (bi-a lăn, cửa mở, đồ vật nảy, đổi nhóm cha…) thì tính lại ma trận đúng khung hình đó.
// Nhờ vậy hình ảnh y hệt, chỉ phần tính toán thừa bị bỏ.
// Không đóng băng: xương nhân vật (đổi mỗi khung hình), camera, chính cảnh gốc, vật đã tự quản ma trận (matrixAutoUpdate = false sẵn).
const N = 10;

export class MatrixFreezer {
  constructor() { this.list = []; this.parents = []; this.snap = new Float64Array(0); this.seen = new WeakSet(); }

  /** Đóng băng mọi vật trong `root` (trừ nhánh mà skip(o) trả về true). Gọi lại được: vật đã đóng băng thì bỏ qua. */
  add(root, skip = () => false) {
    const fresh = [];
    const visit = o => {
      if (skip(o)) return;
      if (!this.seen.has(o) && o.matrixAutoUpdate && !o.isScene && !o.isBone && !o.isCamera && !o.isCSS2DObject) { this.seen.add(o); fresh.push(o); }
      for (const c of o.children) visit(c);
    };
    visit(root);
    if (!fresh.length) return 0;
    root.updateMatrixWorld(true);
    const base = this.list.length, snap = new Float64Array((base + fresh.length) * N);
    snap.set(this.snap);
    for (let i = 0; i < fresh.length; i++) {
      const o = fresh[i]; o.updateMatrix(); o.matrixAutoUpdate = false;
      this.list.push(o); this.parents.push(o.parent); write(snap, (base + i) * N, o);
    }
    this.snap = snap;
    return fresh.length;
  }

  /** Mỗi khung hình, trước khi vẽ: vật nào đổi vị trí / hướng / tỉ lệ / cha thì cập nhật ma trận. Trả về số vật vừa đổi. */
  sync() {
    const { list, parents, snap } = this; let moved = 0, dead = 0;
    for (let i = 0, k = 0; i < list.length; i++, k += N) {
      const o = list[i], p = o.position, q = o.quaternion, s = o.scale;
      if (!o.parent) { dead++; continue; } // (đã gỡ khỏi cảnh: thả ra ở dưới)
      if (p.x !== snap[k] || p.y !== snap[k + 1] || p.z !== snap[k + 2] || q.x !== snap[k + 3] || q.y !== snap[k + 4] || q.z !== snap[k + 5] || q.w !== snap[k + 6] || s.x !== snap[k + 7] || s.y !== snap[k + 8] || s.z !== snap[k + 9] || o.parent !== parents[i]) {
        if (o.matrixAutoUpdate) continue; // (có code tự bật lại: để three tự lo như bình thường)
        o.updateMatrix(); // (đặt matrixWorldNeedsUpdate: ma trận thế giới của nó và các con được tính lại trong lượt vẽ này)
        write(snap, k, o); parents[i] = o.parent; moved++;
      }
    }
    if (dead) this._prune();
    return moved;
  }

  /** Bỏ các vật đã gỡ khỏi cảnh (không giữ tham chiếu — tránh rò bộ nhớ khi dựng lại bàn). Trả lại matrixAutoUpdate: lỡ
   * vật được gắn lại vào cảnh thì three.js tự lo ma trận như bình thường. */
  _prune() {
    const gone = new Set(); // vật bị gỡ cùng cả nhánh con của nó
    for (const o of this.list) if (!o.parent) o.traverse(x => gone.add(x));
    const keep = [], par = [], snap = new Float64Array(this.snap.length);
    for (let i = 0; i < this.list.length; i++) {
      const o = this.list[i];
      if (gone.has(o)) { o.matrixAutoUpdate = true; this.seen.delete(o); continue; }
      snap.set(this.snap.subarray(i * N, i * N + N), keep.length * N); keep.push(o); par.push(this.parents[i]);
    }
    this.list = keep; this.parents = par; this.snap = snap.slice(0, keep.length * N);
  }
}

function write(a, k, o) {
  const p = o.position, q = o.quaternion, s = o.scale;
  a[k] = p.x; a[k + 1] = p.y; a[k + 2] = p.z; a[k + 3] = q.x; a[k + 4] = q.y; a[k + 5] = q.z; a[k + 6] = q.w; a[k + 7] = s.x; a[k + 8] = s.y; a[k + 9] = s.z;
}
