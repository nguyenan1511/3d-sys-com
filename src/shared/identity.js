// Chuẩn hóa và kiểm tra mã nhân viên dạng "1151-An". Dùng chung cho client (kiểm tra khi gõ) và server (quyết định).

const MAX_NAME = 40;

/** NFC, đổi mọi khoảng trắng Unicode thành dấu cách, bỏ khoảng trắng thừa. */
export function normalizeText(s) {
  return String(s ?? '').normalize('NFC').replace(/[\s  -​　]+/gu, ' ').trim();
}

/** Khóa so sánh tên: không phân biệt hoa thường (theo tiếng Việt). */
export const nameKey = name => normalizeText(name).toLocaleLowerCase('vi').normalize('NFC');

/**
 * Phân tích ô nhập. Trả về { ok, code, name, display } hoặc { ok:false, error }.
 * Chấp nhận khoảng trắng quanh dấu gạch ngang ("1151 - An").
 */
export function parseLogin(raw) {
  const s = normalizeText(raw);
  if (!s) return { ok: false, error: 'Nhập mã nhân viên dạng 1151-An.' };
  const m = /^(\S+?)\s*-\s*(.*)$/u.exec(s);
  if (!m) {
    if (/^\d+$/.test(s)) return { ok: false, error: 'Thiếu dấu gạch ngang và tên, ví dụ 1151-An.' };
    return { ok: false, error: 'Sai định dạng. Nhập 4 chữ số, dấu gạch ngang rồi tên, ví dụ 1151-An.' };
  }
  const [, code, name] = m;
  if (!/^\d{4}$/.test(code)) return { ok: false, error: 'Mã phải gồm đúng 4 chữ số, ví dụ 1151-An.' };
  if (!name) return { ok: false, error: 'Thiếu tên sau dấu gạch ngang, ví dụ 1151-An.' };
  if (name.length > MAX_NAME) return { ok: false, error: `Tên dài tối đa ${MAX_NAME} ký tự.` };
  if (!/^\p{L}[\p{L}\p{M} ]*$/u.test(name)) return { ok: false, error: 'Tên chỉ gồm chữ cái (có dấu tiếng Việt) và khoảng trắng.' };
  return { ok: true, code, name, display: `${code}-${name}` };
}

export const displayOf = (code, name) => `${code}-${name}`;
