# SYSONE Digital Twin — API (v1)

Gốc: `/api/v1` (bản chính thức). `/api` trỏ cùng một API để giữ tương thích; code mới nên dùng `/api/v1`.
Thời gian thực (vị trí, chat, loa, chỗ ngồi, chấm công) đi qua WebSocket `/ws`.

## Quy ước chung

| Mục | Quy ước |
|---|---|
| Xác thực | Cookie phiên `sysone_sid` (httpOnly, SameSite=Lax, Secure khi production). Phiên lưu ở server (băm HMAC), hết hạn: nhân viên 7 ngày, CEO 12 giờ. |
| Ghi dữ liệu | `POST/PUT/PATCH/DELETE` phải gửi `Content-Type: application/json` và cùng nguồn (header `Origin`), nếu không → `415` / `403` (chống CSRF). |
| Lỗi | Luôn là JSON: `{ "error": "thông báo tiếng Việt", "code": "mã_máy_đọc", "field"?: "...", "requestId": "..." }`. Lỗi `500` không lộ chi tiết; chi tiết chỉ ghi ở log server theo `requestId`. |
| Mã lỗi (`code`) | `invalid` (sai dữ liệu, kèm `field`), `bad_json`, `too_large`, `not_found`, `forbidden`, `rate_limited`, `not_checked_in`, `server_error`. |
| Mã yêu cầu | Mọi phản hồi có header `X-Request-Id` (gửi kèm `X-Request-Id` của mình nếu muốn theo dõi xuyên hệ thống). |
| Giới hạn tần suất | Ghi dữ liệu: 240 lần/phút/người. Chấm công: 12 lần/phút. Đăng nhập: khoá 15 phút sau 5 lần sai (CEO) / 30 lần (nhân viên, theo IP). Quá giới hạn → `429` + `Retry-After`. Header `X-RateLimit-Limit/Remaining`. |
| Header bảo mật | `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `COOP`, `Permissions-Policy`; production thêm `Content-Security-Policy`, `HSTS` (khi Secure). |
| Kích thước | Thân yêu cầu tối đa 1 MB; tin WebSocket tối đa 16 KB. |
| Nhật ký | Mọi thao tác quản trị, chấm công, cấp quyền nhạc ghi vào bảng `audit` (xem `GET /admin/audit`). |

Quyền: **công khai** · **đăng nhập** (nhân viên hoặc CEO) · **nhân viên** · **CEO**.

## Hệ thống
| Phương thức | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/health` | công khai | `{ ok, version, time, uptimeSec }` — cho giám sát. |

## Phiên đăng nhập
| Phương thức | Đường dẫn | Quyền | Thân / Kết quả |
|---|---|---|---|
| GET | `/me` | công khai | `{ authenticated, kind, employee \| admin, config }` |
| POST | `/login/employee` | công khai | `{ input: "1151-Nguyễn An" }` → `{ ok, created, employee }` |
| POST | `/login/admin` | công khai | `{ username, password }` → `{ ok, mustChangePassword }` |
| POST | `/logout` | đăng nhập | |
| POST | `/admin/password` | CEO | `{ current, next }` (≥ 8 ký tự) — đăng xuất các phiên CEO khác |

## Chỗ ngồi
| Phương thức | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/seats` | đăng nhập | Danh sách chỗ: chủ chỗ (kèm phòng ban), khoá, dụng cụ |
| POST | `/seats/:id/claim` | nhân viên | Nhận chỗ (giao diện không cho nhân viên tự chọn; người hướng dẫn gọi khi xếp chỗ theo phòng ban) |
| PUT | `/seats/:id/equipment` | đăng nhập | Thiết lập bàn (chủ chỗ) |
| POST | `/seats/:id/sit`, `/seats/stand` | đăng nhập | Ngồi / đứng (server kiểm tra quyền) |
| GET | `/equipment`, `/appearance` | đăng nhập | Lược đồ dụng cụ / ngoại hình |
| PUT | `/me/look` | nhân viên | Lưu nhân vật |

## Chấm công
| Phương thức | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/attendance/today` | đăng nhập | `{ day, list: [{ code, display, department, checkIn, checkOut, lateMin, shift }] }` |
| GET | `/attendance/me` | nhân viên | `{ today, history }` (14 ngày) |
| POST | `/attendance/checkin` | nhân viên | Vào ca, một lần/ngày (giờ VN) → `{ record, already }` |
| POST | `/attendance/checkout` | nhân viên | Ra về → `{ record }`; chưa vào → `409 not_checked_in` |
| GET | `/admin/attendance?day=YYYY-MM-DD` | CEO | `{ day, shift, list, absent }` |
| GET | `/admin/attendance/:code` | CEO | Lịch sử 60 ngày của một người |

Ca: `SHIFT_START` (mặc định `08:00`), cho trễ `LATE_GRACE_MIN` phút (mặc định 5).

## Chat nội bộ
| Phương thức | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/chat/channels` | đăng nhập | `{ me, channels, dms }` — kênh Toàn công ty, phòng ban của mình (CEO: mọi phòng), nhắn riêng |
| GET | `/chat/:channel?before=<id>` | đăng nhập | 80 tin gần nhất; `channel` = `all` \| `dept:<id>` \| `dm:<khoá>\|<khoá>` |
| WS | `{ t: "chat", channel, body }` / `{ t: "chat", to: "<khoá>", body }` | đăng nhập | Gửi tin (≤ 500 ký tự, ≥ 0,4 s/tin) → mọi người được đọc kênh nhận `{ t: "chat", msg }` |

## Loa công ty
| Phương thức | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/music` | đăng nhập | `{ state: { on, station, by, since }, stations }` |
| GET | `/admin/music` | CEO | Ai được bật nhạc |
| POST | `/admin/music/:code` | CEO | `{ allow: true \| false }` |
| WS | `{ t: "music", on, station }` | CEO / người được cấp quyền | Bật/đổi/tắt cho cả công ty (≥ 1 s/lần) |

## Quản trị (CEO)
`GET /admin/employees` · `POST /admin/employees` · `PATCH|DELETE /admin/employees/:code` · `POST /admin/employees/:code/logout` · `PUT /admin/employees/:code/look` · `POST /admin/seats/:id/assign|release|lock` · `GET /admin/export.csv` · `POST /admin/import` · `GET /admin/audit?limit=200`

## Thêm API mới
1. Tạo `server/routes/<tên>.js` xuất `function xxxRoutes(api, { db, store, hub, config, guards })`.
2. Mỗi route: gắn quyền (`guards.needAuth / needEmployee / needAdmin`), kiểm tra dữ liệu bằng `check(req.body, { field: v.str({ max }) … })` (`server/http.js`), thêm `rateLimit(...)` nếu là thao tác ghi dễ lạm dụng, ghi `audit(...)` cho thao tác quan trọng, lỗi nghiệp vụ ném `HttpError(status, message, { code })`.
3. Đăng ký trong `server/app.js` (cạnh `attendanceRoutes(api, ctx)`), viết test trong `tests/api.test.js`, cập nhật tài liệu này.

## Sao lưu (chỉ CEO)
| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET | `/api/v1/admin/backups` | `{ backups: [{ name, size, ts }], keep, enabled }`, mới nhất trước |
| POST | `/api/v1/admin/backups` | sao lưu ngay (gửi body `{}`), trả `{ ok, backup }`; tối đa 6 lần/phút |
| GET | `/api/v1/admin/backups/:name` | tải file `.db` về máy |
