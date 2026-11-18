# Workspace dự án (Dự án)

Thiết kế đã chốt qua /brainstorming ngày 2026-11-18. Hướng A: tách lớp "không gian chung" dùng cho cả phòng họp và dự án.

## Tóm tắt

- Mỗi **dự án** là một không gian làm việc lâu dài của một nhóm, gồm:
  - thành viên, kênh chat riêng, tài liệu, ghi chú;
  - Kanban 3 cột;
  - phòng dự án 3D riêng: bảng vẽ chung, mic, camera, chia sẻ màn hình.
- **Ai cũng tạo được dự án.** Người tạo thành Trưởng dự án. CEO xem và quản lý được mọi dự án.
- **Hai vai trò:**
  - **Trưởng dự án** (`lead`, có thể có nhiều người): sửa thông tin, mời / xoá người, đổi vai trò, lưu trữ / xoá dự án.
  - **Thành viên** (`member`): dùng đầy đủ chat, tài liệu, task, bảng vẽ, ghi chú.
- **Riêng tư:** người ngoài không thấy cả tên dự án. API trả 404 cho người không phải thành viên.
- **Lối vào:**
  - nút "Dự án" trên thanh (cạnh Bảng tin / Họp / Chat);
  - bảng "Dự án" đứng cạnh cửa phòng họp trong cảnh 3D, bấm E để mở.
- **Liên kết họp ↔ dự án:**
  - Cuộc họp có `project_id`.
  - Đặt họp từ dự án thì mọi thành viên tự được mời.
  - Tài liệu và bảng vẽ đã lưu của cuộc họp hiện trong tab Tài liệu của dự án, nhóm "Từ cuộc họp".
- **Thông báo:**
  - được mời vào dự án / bị xoá khỏi dự án;
  - được giao task;
  - task sắp tới hạn (còn 24 giờ) và quá hạn;
  - tin nhắn mới (chấm đỏ + số tin chưa đọc);
  - bị @nhắc tên;
  - đồng đội vào phòng dự án.

## Giả định

- **Quy mô:**
  - khoảng 100 nhân viên, mỗi người tối đa 20 dự án đang hoạt động;
  - mỗi dự án tối đa 50 thành viên và 500 task;
  - mỗi file tối đa 5 MB, mỗi dự án tối đa 200 MB tài liệu.
- **Hạ tầng giữ nguyên:**
  - Render, MongoDB Atlas, `db.blobs`;
  - WebSocket sẵn có để cập nhật tức thì.
- **Bảng mở thì cảnh 3D tạm ngừng vẽ** (`overlayOn` / `overlayOff`).
- **Nhân viên bị vô hiệu hoá** tự rời mọi dự án. Nếu dự án mất Trưởng dự án cuối cùng thì người vào sớm nhất lên làm Trưởng. Dự án không còn ai thì chỉ CEO thấy.
- **Xoá dự án:**
  - "Lưu trữ" là ẩn khỏi danh sách đang làm, đọc được nhưng không sửa.
  - "Xoá hẳn" xoá luôn task, bình luận, chat, file, bảng vẽ. Phải xác nhận, ghi vào nhật ký quản trị.
- **Ngoài phạm vi:**
  - khách ngoài công ty;
  - cột Kanban tuỳ chỉnh, việc con, nhãn;
  - Gantt, giờ công;
  - gắn dự án vào bàn thật;
  - email, thông báo đẩy.

## Nhật ký quyết định

| # | Quyết định | Phương án khác đã xét | Lý do |
|---|---|---|---|
| 1 | Làm cả 3 phần theo giai đoạn: không gian chung → Kanban → phòng 3D | Chỉ chọn một phần | Đủ tính năng nhưng mỗi đợt release vẫn dùng được ngay |
| 2 | Ai cũng tạo được dự án | Cần CEO cấp quyền / chỉ quản lý được tạo | Ít cản trở; CEO vẫn quản lý mọi dự án |
| 3 | 2 vai trò: Trưởng dự án + Thành viên | Thêm vai "chỉ xem" / không phân vai | Đủ dùng, đơn giản |
| 4 | Dự án riêng tư | Công khai tên / Trưởng dự án tự chọn | An toàn cho dự án nhạy cảm |
| 5 | Kanban gọn 3 cột | Checklist / kiểu Jira đầy đủ | Vừa đủ, tránh làm thừa |
| 6 | Vào bằng nút trên thanh + đồ vật 3D | Chỉ một trong hai | Mở nhanh, vẫn giữ trải nghiệm 3D |
| 7 | Phòng dự án ảo, mỗi dự án một phòng | Gắn khu bàn thật / chỉ hiện trạng thái | Không phải sửa toà nhà, không giới hạn số phòng |
| 8 | Báo đủ 4 loại | Báo ít hơn | Người dùng chọn |
| 9 | Liên kết họp ↔ dự án | Không liên kết | Biên bản và tài liệu họp nằm luôn trong dự án |
| 10 | Hướng A: lớp "không gian chung" (`server/meetHub.js` nhận cả mã phòng `p<id>`) | B: dự án là cuộc họp không giờ · C: viết riêng toàn bộ | Một bộ code cho bảng vẽ / WebRTC / tài liệu, đã có test e2e bảo vệ |
| 11 | Tài liệu họp không chép sang dự án; tab Tài liệu của dự án đọc thêm `meeting_files` của các cuộc họp có `project_id` | Chép file khi lưu | Không tốn dung lượng gấp đôi, xoá ở một chỗ |
| 12 | Thứ tự task trong cột: số thực `order`, kéo thả thì lấy giữa hai task kề nhau | Lưu cả mảng thứ tự | Mỗi lần kéo chỉ ghi một dòng, ít xung đột khi hai người cùng kéo |

## Thiết kế

### Dữ liệu (`server/memdb.js`, `TABLES`)

- **`projects`** `{ id, name, description, notes, notes_by, notes_at, color, status: 'active'|'archived'|'deleted', created_by, created_at, updated_at }`
- **`project_members`** `{ id, project_id, key, role: 'lead'|'member', added_by, added_at }`, chỉ mục `project_id` và `key`.
- **`project_tasks`** `{ id, project_id, title, body, status: 'todo'|'doing'|'done', assignee, due, priority: 0|1|2, order, created_by, created_at, updated_at, done_at, reminded }`, chỉ mục `project_id`.
- **`task_comments`** `{ id, task_id, project_id, by, by_name, body, ts }`, chỉ mục `task_id`.
- **`project_files`** `{ id, project_id, name, type, size, by, by_name, ts, kind }`, chỉ mục `project_id`. Nội dung lưu ở `db.blobs` khoá `pfile:<id>`.
- **`meetings`** thêm cột `project_id` (có thể để trống).
- **Kênh chat** `proj:<id>`, lưu trong `chat_messages`.
- **Bảng vẽ** khoá `board:p<id>`, ảnh trên bảng khoá `wbf:p<id>:<ảnh>`, dùng chung với phòng họp.

### Server

- **`server/projects.js`**, class `Projects`: nghiệp vụ và kiểm tra quyền. Các hàm:
  - `role(p, key)`, `need(actor, id, { lead, write })`;
  - `create`, `edit`, `archive`, `purge`;
  - `addMembers`, `setRole`, `removeMember` (tự rời cũng dùng hàm này);
  - task (CRUD + chuyển cột);
  - bình luận, file, ghi chú.
- **`server/projectHub.js`**: báo tin realtime cho thành viên:
  - `proj:changed`, `proj:invited`, `proj:removed`, `proj:task`, `proj:mention`, `proj:room`;
  - nhắc hạn task theo nhịp 60 giây.
- **`server/routes/projects.js`**: REST `/api/projects/...`.
- **`server/meetHub.js`**: mã phòng dạng `p<id>` là phòng dự án.
  - Thành viên (hoặc CEO) vào lúc nào cũng được.
  - Không nhắc giờ, không chặn vị trí trong toà nhà.
- **`server/social.js` `canUseChannel`**: kênh `proj:<id>` dành cho thành viên dự án và CEO. Có @nhắc tên thì báo `proj:mention`.
- **`server/meetings.js`**: `book` nhận `projectId`.
  - Người đặt phải là thành viên dự án.
  - Thành viên dự án được thêm vào danh sách mời.
  - Giới hạn số người mời nâng lên 50 cho họp dự án.

### Giao diện

- **`src/session/projects.js`**, bộ điều khiển phía client:
  - nghe các tin `proj:*`, đếm tin chưa đọc, chấm đỏ trên nút;
  - bảng "Dự án" 3D cạnh cửa phòng họp;
  - vào / rời phòng dự án.
- **`src/ui/projectPanel.js`**: bảng lớn theo hệ `sx` / nút chung 38px.
  - Danh sách dự án dạng thẻ: màu, tên, số người, việc của tôi, số chưa đọc. Thẻ "Đang làm" / "Đã lưu trữ".
  - Tạo dự án: tên, mô tả, màu, chọn thành viên.
  - Trong một dự án có các thẻ:
    - **Công việc:** Kanban kéo thả; bấm một task để mở chi tiết + bình luận.
    - **Chat**, **Tài liệu**, **Ghi chú**, **Thành viên**;
    - **Cài đặt** (chỉ Trưởng dự án).
  - Nút "Vào phòng dự án" và "Đặt họp".
- **`src/ui/meetRoom.js`**: thêm chế độ phòng dự án.
  - Thanh trên: tên dự án, không có giờ.
  - Không có nút "Kết thúc họp".
  - Chat dùng kênh `proj:`, tài liệu dùng API dự án.

### Kiểm thử

- **Unit `tests/projects.test.js`:** quyền (người ngoài nhận 404), vai trò, Trưởng dự án cuối cùng, task, thứ tự, nhắc hạn, nhân viên bị vô hiệu hoá, liên kết họp.
- **E2E `tests/e2e/i-projects.spec.js`:** hai người cùng dự án — tạo, mời, kéo task, chat, @nhắc, vào phòng dự án, đặt họp từ dự án. Chạy thêm `h-buttons`, `h-meeting`, `h-meetcall`.
