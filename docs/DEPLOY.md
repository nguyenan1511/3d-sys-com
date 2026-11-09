# Deploy SYSONE digital twin

Giao diện (FE) và backend (BE) chạy **chung một tiến trình Node** trên một cổng:
- `dist/`: giao diện đã build (Vite), do Express phục vụ.
- `/api/v1`: REST API.
- WebSocket: online, chat, nhạc, rèm.
- SQLite (`node:sqlite`): file `DB_PATH`, **cần ổ đĩa lưu lâu dài**.

Có hai cách deploy:
- **A. Giao diện trên Vercel + backend trên Render** (khuyên dùng nếu muốn tách FE/BE): xem ngay bên dưới.
- **B. Tất cả trên một server** (Render, Fly.io hoặc VPS): xem từ mục "Cách 1".

Backend **không chạy được trên Vercel**, vì Vercel không giữ kết nối WebSocket lâu và không có ổ đĩa ghi được cho SQLite.

## A. Vercel (giao diện) + Render (backend)

```
Trình duyệt ──https──▶ Vercel (dist/)  ──rewrite /api, /data──▶ Render (Express + SQLite)
     └────────────────wss (vé dùng một lần)────────────────────────▶ Render /ws
```
- `/api` và `/data` đi qua Vercel, nên cookie đăng nhập vẫn cùng tên miền với trang (trình duyệt không chặn).
- Vercel không chuyển tiếp WebSocket, nên trình duyệt nối thẳng tới Render. Nó lấy trước một **vé dùng một lần** (hết hạn sau 30 giây) qua `POST /api/v1/ws-ticket`.

### Bước 1: Render (backend)
1. https://dashboard.render.com, chọn **New → Blueprint**, rồi chọn repo này. Render đọc `render.yaml` và tạo service `sysone-api`: Docker, gói Starter, disk 1 GB ở `/data`, health check `/api/v1/health`.
   - Không dùng Blueprint thì tạo tay: **New → Web Service → Docker**, thêm disk `/data` và các biến môi trường như bên dưới.
2. Nhập các biến môi trường:
   - `ADMIN_INITIAL_PASSWORD`: mật khẩu tạm cho tài khoản `admin`.
   - `ALLOWED_ORIGINS`: tên miền giao diện trên Vercel, ví dụ `https://sysone-office.vercel.app`. Nhiều tên miền thì cách nhau bằng dấu phẩy, không có `/` ở cuối.
   - `SESSION_SECRET` (tự sinh) và `TRUST_PROXY=true` đã có sẵn trong `render.yaml`.
3. Deploy xong, mở `https://sysone-api.onrender.com/api/v1/health` để kiểm tra; kết quả phải là `{"ok":true,...}`.
   Nếu Render đặt tên khác, ghi lại địa chỉ đó để dùng ở bước 2.

### Bước 2: Vercel (giao diện)
1. Mở `vercel.json` trong repo, thay `https://sysone-api.onrender.com` (2 chỗ) bằng địa chỉ Render của bạn, rồi commit và push.
2. https://vercel.com/new, chọn **Import** repo này. Vercel tự đọc `vercel.json` (build `npm run build`, thư mục `dist`).
3. **Environment Variables**: `VITE_WS_URL` = `wss://sysone-api.onrender.com` (địa chỉ Render, dùng `wss://`, không có `/ws`). Biến này được nhúng vào lúc build.
4. Bấm Deploy. Sau đó quay lại Render và kiểm tra `ALLOWED_ORIGINS` có đúng tên miền Vercel vừa nhận (kể cả tên miền riêng nếu thêm sau).

### Kiểm tra
Mở trang Vercel, đăng nhập bằng mã-tên nhân viên, vào văn phòng. Nếu thấy được người khác online và chat được, nghĩa là WebSocket đã chạy.
- **Lỗi 403 "Nguồn yêu cầu không hợp lệ"**: `ALLOWED_ORIGINS` sai (có thừa dấu `/`, hoặc sai `http`/`https`).
- **Vào được nhưng không thấy người online**: `VITE_WS_URL` sai hoặc chưa build lại sau khi đặt biến. Vào Vercel → Deployments → Redeploy.
- **Render gói Free**: server ngủ sau 15 phút không có ai, lần mở đầu chờ khoảng 1 phút, và không có disk nên mất dữ liệu. Dùng gói Starter.

### Tên miền riêng
- Vercel → Settings → Domains → thêm `office.sysone.vn`, rồi thêm tên miền này vào `ALLOWED_ORIGINS` trên Render.
- Có thể đặt `api.sysone.vn` cho Render (Settings → Custom Domains) rồi dùng nó trong `vercel.json` và `VITE_WS_URL`.

## Biến môi trường (production)
| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `SESSION_SECRET` | có | chuỗi ngẫu nhiên dài: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_INITIAL_PASSWORD` | lần đầu | tạo tài khoản CEO `admin`; đăng nhập rồi đổi mật khẩu ngay |
| `DB_PATH` | nên đặt | đường dẫn trên ổ đĩa lưu lâu dài, ví dụ `/data/sysone.db` |
| `PORT` | tuỳ nền tảng | mặc định 5310 (Docker: 8080) |
| `COOKIE_SECURE` | không | mặc định `true` khi production (cần HTTPS) |
| `ALLOWED_ORIGINS` | khi tách FE | tên miền giao diện (Vercel), cách nhau bằng dấu phẩy |
| `TRUST_PROXY` | sau proxy | `true` trên Render để lấy đúng IP người dùng (giới hạn đăng nhập sai) |
| `VITE_WS_URL` | FE trên Vercel | đặt ở **Vercel** lúc build: `wss://<backend>` |
| `DUPLICATE_POLICY`, `ADMIN_CAN_SIT_ANYWHERE` | không | xem `.env.example` |

Yêu cầu Node **22.5+** (khuyên dùng 24).

## Cách 1: Render.com (dễ nhất)
1. New → **Web Service** → chọn repo này → Runtime **Docker**.
2. **Disks**: thêm disk, mount path `/data`, 1 GB. Cần gói trả phí; gói free không có disk, dữ liệu mất mỗi lần deploy.
3. Environment: đặt `SESSION_SECRET`, `ADMIN_INITIAL_PASSWORD` (`DB_PATH=/data/sysone.db` đã có sẵn trong Dockerfile).
4. Deploy, rồi mở `https://<tên>.onrender.com/api/v1/health` để kiểm tra.

## Cách 2: Fly.io
```bash
fly launch --no-deploy            # nhận Dockerfile, internal_port = 8080
fly volumes create data --size 1  # cùng region với app
# fly.toml: thêm
#   [mounts]
#   source = "data"
#   destination = "/data"
fly secrets set SESSION_SECRET=... ADMIN_INITIAL_PASSWORD=...
fly deploy
```
Chỉ chạy **1 máy**: SQLite + trạng thái online nằm trong một tiến trình, không chia nhiều máy được.

## Cách 3: VPS (Ubuntu) + Docker + Caddy (HTTPS tự động)
```bash
git clone https://github.com/nguyenan1511/3d-sys-com.git && cd 3d-sys-com
docker build -t sysone .
docker run -d --name sysone --restart unless-stopped -p 127.0.0.1:8080:8080 \
  -v sysone-data:/data -e SESSION_SECRET=... -e ADMIN_INITIAL_PASSWORD=... sysone
```
`/etc/caddy/Caddyfile` (Caddy tự chuyển tiếp WebSocket):
```
office.sysone.vn {
  reverse_proxy 127.0.0.1:8080
}
```
Không dùng Docker:
```bash
npm ci && npm run build
cp .env.example .env   # điền giá trị
npm start              # nên chạy bằng pm2/systemd
```
Nếu dùng Nginx thay Caddy, cần thêm `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` cho WebSocket.

## Ghi chú: tách FE và BE
Muốn tách thì dùng cách A ở trên. Đừng cho giao diện gọi thẳng API sang tên miền khác: cookie bên thứ ba bị trình duyệt chặn, nên sẽ không đăng nhập được.

## Sao lưu (tự động)
- Server **tự sao lưu mỗi đêm** (sau 2 giờ sáng giờ Việt Nam) ra `<thư mục database>/backups/` (trên Docker: `/data/backups`), giữ 14 bản gần nhất.
- CEO vào **Bảng quản trị → Sao lưu** để xem danh sách, bấm **Sao lưu ngay**, hoặc **Tải về** một bản.
- Thỉnh thoảng tải một bản về máy hoặc Google Drive: bản sao lưu nằm cùng ổ đĩa với database, nên nếu mất cả server thì chỉ còn bản đã tải về.
- Biến tuỳ chọn: `BACKUP_KEEP` (số bản giữ lại), `BACKUP_DIR` (thư mục khác), `BACKUP_DISABLED=1` (tắt tự sao lưu).
- Khôi phục: dừng server, chép file sao lưu đè lên `DB_PATH` (ví dụ `/data/sysone.db`), khởi động lại.
- Render cũng tự chụp ổ đĩa mỗi ngày (khôi phục ở mục Disks).

## Cập nhật bản mới
Render/Fly: push lên `main`, nền tảng tự build lại. VPS: `git pull && docker build -t sysone . && docker rm -f sysone && docker run ...` (giữ volume `sysone-data`).
