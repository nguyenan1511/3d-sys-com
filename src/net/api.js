// Gọi API JSON. Trả về { ok, status, ...body } thay vì ném lỗi để giao diện hiển thị thông báo của server.
export async function api(method, path, body) {
  // thao tác ghi luôn gửi JSON (server chặn yêu cầu ghi không phải JSON để chống CSRF) — DELETE không có nội dung thì gửi {}
  if (body === undefined && method !== 'GET' && method !== 'HEAD') body = {};
  try {
    const r = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await r.json(); } catch { /* không có body */ }
    return { ok: r.ok, status: r.status, ...data, error: r.ok ? undefined : (data.error || `Lỗi ${r.status}`) };
  } catch {
    return { ok: false, status: 0, error: 'Không kết nối được máy chủ.' };
  }
}
