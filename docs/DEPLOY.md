# Deploy SYSONE digital twin

Giao diện (FE) và backend (BE) chạy **chung một tiến trình Node** trên một cổng:
- `dist/`: giao diện đã build (Vite), do Express phục vụ.
- `/api/v1`: REST API.
- WebSocket: online, chat, nhạc, rèm.
- SQLite (`node:sqlite`): file `DB_PATH`, **cần ổ đĩa lưu lâu dài**.

Vì vậy **không deploy được lên Vercel/Netlify dạng serverless**: ở đó không có WebSocket chạy lâu và không có ổ đĩa ghi được.
Chọn một trong các cách bên dưới.

## Biến môi trường (production)
| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `SESSION_SECRET` | có | chuỗi ngẫu nhiên dài: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_INITIAL_PASSWORD` | lần đầu | tạo tài khoản CEO `admin`; đăng nhập rồi đổi mật khẩu ngay |
| `DB_PATH` | nên đặt | đường dẫn trên ổ đĩa lưu lâu dài, ví dụ `/data/sysone.db` |
| `PORT` | tuỳ nền tảng | mặc định 5310 (Docker: 8080) |
| `COOKIE_SECURE` | không | mặc định `true` khi production (cần HTTPS) |
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

## Tách FE và BE ra hai nơi?
Hiện **không nên**. Đăng nhập dùng cookie `SameSite=Lax`, API gọi đường dẫn tương đối `/api`, WebSocket cùng tên miền.
Nếu cần đặt giao diện trên CDN, hãy để CDN (Cloudflare) đứng trước **chính server này** (proxy + cache `/assets/*`), không tách code.

## Sao lưu
Sao lưu file `DB_PATH` (dùng `sqlite3 sysone.db ".backup backup.db"` khi đang chạy). Mất file này là mất toàn bộ nhân viên, chỗ ngồi và chấm công.

## Cập nhật bản mới
Render/Fly: push lên `main`, nền tảng tự build lại. VPS: `git pull && docker build -t sysone . && docker rm -f sysone && docker run ...` (giữ volume `sysone-data`).
