// Giải phóng bộ nhớ GPU của cả một nhánh cảnh (hình, vật liệu, ảnh) sau khi gỡ nó khỏi cảnh — tránh rò bộ nhớ khi dựng lại
// (vd. dựng lại toàn bộ nhân viên mô phỏng). An toàn cả với tài nguyên dùng chung: three.js tự nạp lại lên GPU nếu thứ đã
// giải phóng còn được vật khác dùng.
export function disposeObject(root) {
  const seen = new Set();
  const free = x => { if (x && !seen.has(x)) { seen.add(x); x.dispose?.(); } };
  root.traverse(o => {
    free(o.geometry);
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) if (v && v.isTexture) free(v);
      free(m);
    }
    if (o.isSkinnedMesh) free(o.skeleton);
    if (o.isInstancedMesh) free(o);
  });
}
