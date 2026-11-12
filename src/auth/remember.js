// Nhớ trên máy này: mã đăng nhập (dạng "1151-An") và nhân vật đã chọn. Phiên đăng nhập nằm trong cookie + database của
// server; nếu server mất dữ liệu (gói Render miễn phí không có ổ đĩa: khởi động lại là database trống) hoặc phiên hết hạn,
// máy tự đăng nhập lại và khôi phục nhân vật — người dùng không phải gõ mã, chọn nhân vật lại.
// Không nhớ nữa khi: bấm Đăng xuất, hoặc bị server buộc đăng xuất (đăng nhập ở máy khác, CEO cho đăng xuất, mã bị khoá).
// Mã đăng nhập không phải mật khẩu (ai biết mã đều gõ được), nên lưu ở localStorage không mở thêm quyền gì.
const K_LOGIN = 'sysone.login', K_LOOK = 'sysone.look.';
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* chế độ riêng tư */ } };

export const savedLogin = () => get(K_LOGIN);
export const rememberLogin = input => set(K_LOGIN, String(input || '').trim() || null);
export const forgetLogin = () => set(K_LOGIN, null);

export function savedLook(code) { try { return JSON.parse(get(K_LOOK + code)); } catch { return null; } }
export function rememberLook(code, look) { if (code && look && !look._repick) set(K_LOOK + code, JSON.stringify(look)); }
