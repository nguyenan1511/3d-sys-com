// Bảng vẽ chung của phòng họp = một bản vẽ Excalidraw (https://excalidraw.com, MIT) mọi người cùng vẽ.
// Máy chủ giữ các hình (element) của từng cuộc họp và chuyển mỗi thay đổi cho người khác; mọi máy ghép hình theo số phiên
// bản giống cách cộng tác trực tiếp của Excalidraw (xem newer). Quy tắc ghép + kiểm tra theo agent-office
// (https://github.com/AgentSystemLabs/agent-office, MIT — src/shared/whiteboard.ts), giới hạn chỉnh cho máy chủ miễn phí.
// Dùng chung cho máy chủ (server/meetHub.js) và trình duyệt (src/ui/excaliBoard.js).

/** Tối đa số hình một bảng giữ (kể cả hình đã xoá). */
export const WB_MAX_ELEMENTS = 5000;
/** Một hình dạng JSON (nét vẽ tay dài là lớn nhất). */
export const WB_MAX_ELEMENT_BYTES = 256 * 1024;
/** Cả bản vẽ dạng JSON. */
export const WB_MAX_BYTES = 4 * 1024 * 1024;
/** Một ảnh dán lên bảng (data: URL). */
export const WB_MAX_FILE_BYTES = 3 * 1024 * 1024;
/** Mọi ảnh trên một bảng cộng lại. */
export const WB_MAX_FILES_BYTES = 20 * 1024 * 1024;
/** Loại ảnh được dán lên bảng (không nhận SVG: có thể chứa mã). */
export const WB_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const WB_ID = /^[\w-]{1,100}$/;

/** a có thay b không: phiên bản mới hơn, hoặc cùng phiên bản mà versionNonce nhỏ hơn (quy tắc của Excalidraw — mọi máy ra cùng một kết quả). */
export function newer(a, b) {
  return !b || a.version > b.version || (a.version === b.version && a.versionNonce < b.versionNonce);
}

/** Một hình người khác gửi lên, nếu đủ thông tin để ghép; sai thì bỏ (undefined). */
export function checkElement(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return undefined;
  if (typeof e.id !== 'string' || !WB_ID.test(e.id)) return undefined;
  if (typeof e.type !== 'string' || !e.type || e.type.length > 32 || e.type === 'selection' || e.type === 'embeddable' || e.type === 'iframe') return undefined;
  if (!Number.isSafeInteger(e.version) || e.version < 1) return undefined;
  if (typeof e.versionNonce !== 'number' || !Number.isFinite(e.versionNonce)) return undefined;
  if (e.isDeleted !== undefined && typeof e.isDeleted !== 'boolean') return undefined;
  if (e.index !== undefined && e.index !== null && (typeof e.index !== 'string' || e.index.length > 200)) return undefined;
  if (e.fileId !== undefined && e.fileId !== null && (typeof e.fileId !== 'string' || !WB_ID.test(e.fileId))) return undefined;
  return e;
}

/** Một ảnh người khác dán lên bảng, hoặc lý do không nhận (chuỗi). */
export function checkFile(f) {
  if (!f || typeof f !== 'object') return 'Ảnh không hợp lệ.';
  if (typeof f.id !== 'string' || !WB_ID.test(f.id)) return 'Mã ảnh không hợp lệ.';
  if (typeof f.mimeType !== 'string' || !WB_IMAGE_TYPES.includes(f.mimeType)) return 'Bảng vẽ chỉ nhận ảnh PNG, JPG, GIF, WebP.';
  if (typeof f.dataURL !== 'string' || !f.dataURL.startsWith(`data:${f.mimeType};base64,`)) return 'Dữ liệu ảnh không hợp lệ.';
  if (f.dataURL.length > WB_MAX_FILE_BYTES) return `Ảnh quá lớn cho bảng vẽ (tối đa ${WB_MAX_FILE_BYTES / 1024 / 1024} MB).`;
  const created = typeof f.created === 'number' && Number.isFinite(f.created) ? f.created : Date.now();
  return { id: f.id, mimeType: f.mimeType, dataURL: f.dataURL, created };
}

/** Thứ tự chồng hình, dưới cùng trước: theo chỉ số phân số (so như chuỗi); hình chưa có chỉ số nằm trên cùng. */
export function byIndex(a, b) {
  const x = a.index ?? '', y = b.index ?? '';
  if (x === y) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (!x) return 1;
  if (!y) return -1;
  return x < y ? -1 : 1;
}

/** Số hình đang hiện (không tính hình đã xoá). */
export const liveCount = els => els.reduce((n, e) => n + (e.isDeleted ? 0 : 1), 0);

/** Đọc bản vẽ đã lưu (db.blobs 'board:<id>': { v: 2, elements, files: {mã ảnh: cỡ} }). */
export function parseBoard(buf) {
  try { const j = JSON.parse(String(buf)); return { elements: Array.isArray(j.elements) ? j.elements : [], files: j.files && typeof j.files === 'object' && !Array.isArray(j.files) ? j.files : {} }; }
  catch { return { elements: [], files: {} }; }
}
