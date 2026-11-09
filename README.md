# SYSONE – Digital twin văn phòng 33 Dương Quang Đông

Mô hình 3D căn nhà 3 tầng của công ty và hai nhà mỗi bên, kèm mô phỏng nhân viên đi làm theo lịch trong ngày: vào cổng, qua hiên, cửa trệt, sảnh lễ tân, lên cầu thang, ngồi đúng bàn, đi họp, giải lao pantry, đi WC, ăn trưa, về.

`demo.html` là bản gốc (three r128 qua CDN), giữ lại để đối chiếu. Bản đang phát triển là `index.html` + `src/`.

## Chạy

```bash
npm install
npx playwright install chromium   # một lần, cho kiểm thử/chụp ảnh
cp .env.example .env              # rồi điền SESSION_SECRET và ADMIN_INITIAL_PASSWORD
npm run dev                       # server + giao diện: http://localhost:5310
npm run build && npm start        # bản production (phục vụ dist/)
```

Cần Node ≥ 22.13 (dùng `node:sqlite` có sẵn, không phải biên dịch module native). Dữ liệu nằm ở `data/sysone.db` (không commit).

Tham số URL sau khi đăng nhập: `?t=08:30` giờ bắt đầu, `?speed=60`, `?paused`, `?q=low` chất lượng thấp (tự bật trên điện thoại), `?n=40` thêm nhân viên mô phỏng giả để thử tải, `?view=L|F|A|W|G|K|T`.

## Đăng nhập, phân quyền, chỗ ngồi riêng

Mọi kiểm tra quyền làm ở server (Express + SQLite + WebSocket trong `server/`); giao diện chỉ hiển thị kết quả. Cảnh 3D và `layout.json`/`employees.json`/`equipment.json` chỉ được tải sau khi đăng nhập.

**.env**

| Biến | Ý nghĩa |
|---|---|
| `SESSION_SECRET` | khóa ký phiên (bắt buộc khi production) |
| `DUPLICATE_POLICY` | `online-or-name-mismatch` (mặc định) hoặc `strict` |
| `ADMIN_CAN_SIT_ANYWHERE` | `false` (mặc định): CEO không ngồi chỗ đã có chủ |
| `ADMIN_INITIAL_PASSWORD` | chỉ dùng để tạo tài khoản `admin` ở lần chạy đầu (DB chưa có CEO); sau đó đổi mật khẩu trong giao diện |
| `PORT`, `DB_PATH`, `COOKIE_SECURE` | cổng (5310), file DB, bật `true` khi chạy sau HTTPS |

**Nhân viên** nhập một ô dạng `1151-An` (4 chữ số, gạch ngang, tên có dấu; tự chuẩn hóa Unicode NFC và khoảng trắng). Server quyết định khi trùng mã:

| Trường hợp | Kết quả |
|---|---|
| mã đang online ở nơi khác | từ chối, nhập lại |
| mã đã đăng ký, tên khác | từ chối |
| mã đã đăng ký, đang offline, cùng tên (không phân biệt hoa thường) | vào lại, giữ chỗ; phiên cũ ở máy khác bị hủy |
| mã mới | tạo nhân viên |
| `DUPLICATE_POLICY=strict` | mọi mã đã đăng ký đều bị từ chối |

"Online" = đang có kết nối WebSocket (hoặc vừa đăng nhập trong 30 giây và đang tải cảnh).

**CEO**: tên đăng nhập + mật khẩu (băm scrypt có muối). Sai 5 lần trong 15 phút thì khóa (theo tên đăng nhập và theo IP), thông báo lỗi chung chung. Phiên bằng cookie httpOnly, SameSite=Lax; thao tác ghi bắt buộc gửi JSON cùng nguồn (chống CSRF). Đổi mật khẩu ở thanh trên cùng.

**Điều khiển nhân vật (nhân viên)**: vào là thấy nhân vật của mình, camera bám phía sau (kéo chuột xoay, cuộn để zoom; trong nhà camera không xuyên trần/tường).

| Phím | Tác dụng |
|---|---|
| W A S D / mũi tên | đi theo hướng camera |
| Shift | chạy |
| Space | nhảy |
| E | ngồi vào ghế gần nhất / đứng dậy (server chỉ cho ngồi chỗ của mình) |
| F | kéo rèm lên / hạ rèm khi đứng gần cửa sổ (hoặc bấm chuột vào rèm); mọi người cùng thấy, server lưu trạng thái |
| C | đưa camera về sau lưng nhân vật |
| 1 · 2 · 3 · 4 · 5 | vẫy tay · hút thuốc · uống cà phê · gọi điện · nhảy múa (bấm lại hoặc Esc để thôi) |

Camera kiểu game: tự xoay về sau lưng khi đi tới (nếu bạn không kéo chuột), tránh xuyên tường bằng tia va chạm; khi bị ép vào góc chết sẽ tự tìm hướng thoáng gần sau lưng nhất hoặc nâng lên nhìn từ trên.

Thanh động tác ở cuối khung 3D bấm được bằng chuột/cảm ứng; nút "Về nhân vật" đưa camera về sau khi xem góc khác. Mọi người thấy vị trí và động tác của nhau theo thời gian thực. CEO không có nhân vật, chỉ quan sát (vẫn có chế độ đi bộ góc nhìn thứ nhất).

**Trần nhà**: trần thạch cao ô 60 cm (chừa lỗ cầu thang), đèn panel, máy lạnh treo tường có ống đồng, ống luồn dây điện, công tắc, ổ cắm, máng cáp, đầu báo khói, cửa gió, tủ điện, biển EXIT (`src/interior/ceiling.js`). Trần chỉ nhìn thấy từ dưới lên nên chế độ "Bỏ mái"/xem theo tầng vẫn nhìn được vào trong.

**Nhân vật**: kiểu chibi đầu to, mắt hoạt hình to tròn; có 10 mẫu sẵn (thư viện ở đầu trình tạo hình, sửa trong `appearance.json` → `presets`); trang phục: áo thun + quần dài/short, váy liền, chân váy, yếm, đồ thể thao, hoodie; tóc: ngắn, rẽ ngôi, dựng, đinh, xoăn, xù, bob, dài, đuôi ngựa, bím hai bên, búi, búi hai bên; mũ lưỡi trai, mũ len, mũ rộng vành. Mặt như Memoji (mắt, màu mắt, lông mày, miệng, má hồng, râu, kính, kiểu tóc, mũ, áo, quần, giày, chiều cao). Lần đầu đăng nhập, nhân viên bắt buộc tạo hình nhân vật với xem trước 3D xoay được và nút xem cận khuôn mặt; sửa lại bằng nút "Nhân vật của tôi". Lựa chọn nằm trong `public/data/appearance.json` (thêm/bớt màu, kiểu tóc; giá trị mặc định phải nằm trong danh sách, server kiểm tra khi khởi động). Mọi người thấy đúng nhân vật này, cả khi đang ngồi và đi bộ; nhân vật của chính mình ẩn khi đi bộ góc nhìn thứ nhất.

**Nhân viên**: CEO thêm từng người ở Bảng quản trị → "+ Thêm nhân viên" (mã-tên dạng `1151-An`, phòng ban); người đó đăng nhập đúng mã-tên là vào. Nhân viên cũng có thể tự đăng ký bằng mã mới. `public/data/employees.json` (nhân viên mô phỏng tự đi lại) hiện để trống; dữ liệu demo 36 người nằm ở `tests/fixtures/employees-demo.json`, chỉ dùng cho kiểm thử.

**Chỗ ngồi**
- Danh sách chỗ lấy từ `layout.json` → `desks`; server tự thêm/bỏ khi file đổi (bàn bị bỏ khỏi layout thì chủ chỗ mất chỗ, có ghi nhật ký).
- Lần đầu vào, nhân viên chọn chỗ trống (sơ đồ theo tầng hoặc bấm vào bàn trong 3D; chỗ có chủ hiện mã-tên chủ), chỉnh dụng cụ với xem trước 3D rồi xác nhận. Nhận chỗ là một câu `UPDATE ... WHERE owner_code IS NULL` trong transaction, cột `owner_code` UNIQUE: hai người bấm cùng lúc chỉ một người được.
- Chỉ chủ chỗ được ngồi; người khác nhận "Chỗ này thuộc về 1151-An", kể cả khi gọi API trực tiếp. Đổi chỗ chỉ khi CEO bật "cho phép đổi chỗ" (dùng một lần) hoặc CEO gán.
- Dụng cụ từng chỗ theo `public/data/equipment.json` (số màn hình 1–3, PC/laptop, bàn phím, chuột, tai nghe, đèn bàn, điện thoại, bảng tên, chậu cây, màu bàn). Thêm/bớt lựa chọn, đổi mặc định trong file này; một dụng cụ hoàn toàn mới cần thêm hình trong `src/interior/deskKit.js`.
- Đồng bộ qua WebSocket: danh sách online, chủ chỗ, vị trí avatar của người khác (khi đi bộ hoặc đang ngồi). Khi đi bộ, bấm `E` cạnh bàn để ngồi.
- Nhân viên mô phỏng trong `employees.json` cũng theo quy tắc chủ chỗ: bàn của họ bị người thật nhận thì họ chuyển sang bàn trống, hết bàn thì rời mô hình (ghi ở khung "Lưu ý").

**Bảng quản trị (CEO)**: danh sách nhân viên (tìm, lọc theo tầng, online/offline/vô hiệu), sửa tên/phòng ban/trạng thái, cho phép đổi chỗ, gán/đổi/giải phóng/khóa chỗ, sửa dụng cụ mọi chỗ, vô hiệu hóa hoặc xóa (chỗ trống lại), buộc đăng xuất, nhập/xuất CSV (`ma,ten,phong_ban,trang_thai,ma_ban`, tất cả-hoặc-không), sơ đồ chỗ ngồi từng tầng có chấm vị trí người online (bấm để camera bám theo), nhật ký thao tác. Thao tác nguy hiểm có hộp xác nhận; mọi thao tác ghi bảng `audit`.

## Sửa bố cục và nhân sự (không cần sửa code)

Hai file trong `public/data/` được đọc lúc chạy, sửa xong chỉ cần tải lại trang.

**`layout.json`** (đơn vị mét; x sang phải khi đứng ngoài đường nhìn vào, z hướng ra đường; tầng 0 = trệt, 1 = tầng 2, 2 = tầng 3)

| Mục | Ý nghĩa |
|---|---|
| `floors` | cao độ sàn `y`, trần `ceiling`; `zones` ghi đè cao độ (vỉa hè, bậc cổng) |
| `stairs` | khung cầu thang, số bậc, hướng lên `rise`, các điểm `entry`/`bottom`/`top`/`exit`, sức chứa một chiều |
| `desks` | `id`, `floor`, tâm bàn `x,z`, `facing` (hướng người ngồi nhìn: 0 vào trong nhà, 90 sang trái, 180 ra đường, 270 sang phải), `w`, `d`; ghế tự đặt sau bàn 0,35 m hoặc ghi `seat:[x,z]` |
| `tables` | bàn họp / pantry, mỗi bàn có danh sách ghế `seats` |
| `pantry.standSpots`, `wc` | chỗ đứng pha nước, điểm xếp hàng và chỗ trong WC |
| `walls` | tường trong, `material` plaster/glass, `openings` là lỗ cửa đo dọc cạnh dài |
| `doors` | cửa hẹp có `capacity` (số người qua cùng lúc) |
| `items` | sofa, cây, quầy, tủ lạnh, toilet, kệ, máy in, TV… |
| `waypoints`, `routes` | điểm mốc và lộ trình vào làm / ra về |
| `nav.areas` | vùng đi được bên trong vỏ nhà; vật cản tự lấy từ tường, bàn, đồ đạc, cầu thang |

**`employees.json`**: `id`, `name`, `role`, `department`, `deskId`, `shift {arrive, leave}`, `lunch {start, duration, place: outside|pantry|desk}`, `meetings [{room, start, duration}]`, `look {shirt, hair, skin, pants, height}`, `speed`. Tên hiện là tên giả.

Kiểm tra khi tải: bàn không tồn tại, hai người một bàn, nhiều người hơn số bàn đều báo lỗi ở bảng bên phải; người bị lỗi không được đưa vào mô hình (không xếp chồng).

**Sơ đồ chỗ ngồi CSV**: bảng bên phải → "Nhập sơ đồ chỗ ngồi (CSV)". Hai cột: nhân viên (mã hoặc tên), mã bàn; dấu `,` hoặc `;`, có hoặc không dòng tiêu đề. Người đang ngồi sẽ đứng dậy đi sang bàn mới ngay.

## Logo SYSONE (ảnh gốc, giữ nguyên)

`assets/logo.svg` là file gốc do công ty cung cấp (bọc ảnh PNG 1296×171 nền trong suốt, màu `#003c9b` và `#ff9a18`). Mọi nơi dùng logo đều lấy từ ảnh gốc này, không vẽ lại:

| Nơi dùng | File |
|---|---|
| Trang đăng nhập, thanh trên cùng | `public/logo/sysone-logo.svg` (bản sao nguyên văn file gốc) |
| Áo nhân vật, mặt trước chữ nổi trên biển 3D | `public/logo/sysone-logo.png` (ảnh PNG trích nguyên vẹn từ SVG gốc) |
| Hình khối chữ nổi trên biển (độ dày 5 cm) | `public/logo/logo-traced.svg` (dò viền từ ảnh gốc, khớp 99,5% / 98,9%; mặt trước vẫn dán ảnh gốc) |

`npm test` kiểm tra hai file trên trùng từng byte với file gốc. Khi có logo mới: thay `assets/logo.svg`, chạy `npm run logo` rồi chép lại `public/logo/sysone-logo.svg` và `assets/logo.png` → `public/logo/sysone-logo.png`.

Hai dòng chữ trên biển ("CÔNG TY CỔ PHẦN CÔNG NGHỆ" và địa chỉ) sửa trong `assets/sign-text.json`, chạy `npm run sign` (font Be Vietnam Pro, giấy phép OFL, màu theo logo).

## Nhân vật 3D làm sẵn (GLB)

Ngoài nhân vật chibi tự tạo, nhân viên có thể chọn **nhân vật 3D làm sẵn** khai báo trong `public/data/characters.json` (tab ✨ Mẫu → Loại nhân vật).
Model không cần có sẵn khung xương: khi tải, hệ thống tự dựng khung (hông, thân, đầu, đùi, cẳng chân, cánh tay, cẳng tay),
tính trọng số da cho từng đỉnh rồi điều khiển bằng cùng hệ tư thế với chibi (đi, chạy, nhảy, ngồi gõ phím, vẫy tay, hút thuốc, gọi điện…).
Logo SYSONE gốc được gắn lên ngực áo, đạo cụ (cốc, thuốc, điện thoại) gắn vào tay phải.

Nhân vật hiện có: **Cậu bé đi học** (`walking-to-school`, model do SYSONE cung cấp, mặc định cho mọi người). Màn hình
"Nhân vật của tôi" là thư viện nhân vật 3D (không còn tự tạo chibi). Model đứng ở tư thế đang bước: khung xương dựng theo
vị trí 3D các khớp (`rig.joints`), từng đoạn được đưa về tư thế chuẩn rồi mới áp dáng đi/chạy/ngồi. Model quét liền khối,
tay dính sát thân nên tay giữ cố định theo thân (`arms: false`).

Thêm model mới:
1. Tự động từ Sketchfab (chỉ model miễn phí, giấy phép cho dùng thương mại): đặt `SKETCHFAB_TOKEN=...` trong `.env`
   (sketchfab.com → Settings → Password & API; không ghi token vào code), rồi `npm run model:fetch -- <id>=<link hoặc uid>`.
   Hoặc tải tay rồi `npm run model -- <file .zip/.glb/.gltf> --out=public/model/<id>.opt.glb [--rot=-90]`
   (`--rot` xoay cho mặt nhân vật nhìn về phía trước). Script bỏ khung xương/hoạt ảnh gốc (giữ đúng tư thế đang hiển thị),
   giảm còn ~30k tam giác, nén texture WebP, đặt gốc ở giữa hai bàn chân.
2. Thêm một mục trong `public/data/characters.json`: tên, file, chiều cao, `speed`, `credit` (nếu giấy phép yêu cầu) và
   `rig.joints` — vị trí 3D các khớp (hông, gối, cổ chân, mũi chân, vai, khuỷu, cổ tay, bàn tay, cổ, đỉnh đầu) theo tỉ lệ chiều cao.
3. Thêm lựa chọn trong `public/data/appearance.json` (khóa `model`).
4. Kiểm tra vùng khung xương: `npm run model:view -- "/model/<id>.opt.glb&rig=<id>" anh.png` (mỗi màu là một xương).

## Văn phòng 2D bên trong toà nhà

**Thanh điều hướng chung**: mọi nút điều khiển (nhân vật, chủ chỗ, 2D/3D, đăng xuất, động tác, gợi ý phím); góc nhìn, tầng, đi bộ & hiển thị nằm trong ngăn kéo bên phải (nút mũi tên), trượt đè lên cảnh nên mở/đóng không làm cảnh giật nằm ở một chỗ —
chế độ 3D: thanh ngang giữa đáy màn hình; chế độ 2D: cột dọc bên trái (bản đồ 2D tự căn giữa vùng trống còn lại).

**Giới hạn camera** (`LIM` trong `src/ui/camera.js`): bám nhân vật chếch 12°–72°, cách 1.5–9 lần chiều cao, tường ép sát quá 0.35 s thì
tự xoay ra hướng thoáng; tổng quan cách 4–75 m, tâm nhìn luôn trong khu phố.

**Hai chế độ hiển thị** (nút 🗺️ 2D / 🧊 3D trên thanh điều khiển, lưu trên máy): **2D là mặc định** (mô tả bên dưới); **3D** là toàn
bộ cảnh 3D, người dùng là nhân vật chibi 3D tô đúng màu tóc/áo/quần/kiểu tóc/mũ/váy của nhân vật pixel đã chọn. Hai chế độ dùng
chung bản đồ, vị trí, chỗ ngồi và server nên luôn đồng bộ: người ở 2D và người ở 3D thấy nhau đúng chỗ.

- **Ngoài cổng là 3D** (vỉa hè, đường phố, xe). **Đi qua cổng ngoài vào khuôn viên thì chuyển sang 2D** kiểu pixel nhìn từ trên
  xuống (`src/pixel/map2d.js`): sân trước, lối đi, hiên, cửa chính, các tầng; ra khỏi cổng thì về lại 3D (mờ chuyển cảnh). Khi đang "Chọn chỗ" vẫn dùng cảnh 3D tổng quan.
- Bản đồ 2D vẽ từ `layout.json`: sàn từng phòng (màu theo loại phòng, tên phòng), tường ngoài + cửa sổ, vách kính, cửa chính,
  cầu thang (↑/↓ tầng), bàn (màn hình, đèn, ghế, tên chủ chỗ; chỗ của mình viền xanh), bàn họp, sofa, cây, pantry, WC, máy in, TV, thảm.
  Toạ độ dùng chung với 3D nên va chạm, lưới tìm đường, chỗ ngồi và đồng bộ với người khác giữ nguyên.
- Điều khiển trong 2D: W A S D (W lên = cuối nhà, S xuống = cửa ra đường), Shift chạy, E ngồi, F kéo rèm, bấm sàn để đi tới,
  bấm bàn để xem chủ chỗ; đi vào cầu thang để lên/xuống tầng (bản đồ tự đổi tầng).
- **Nhân vật pixel** (`src/pixel/sprites.js`, danh sách `public/data/pixel-characters.json`): đầu to, mắt chấm, viền mực; 4 hướng,
  bước chân; tên và biểu tượng động tác trên đầu. Người dùng chọn 1 trong 5 nhân vật ở "Nhân vật của tôi" (mặc định: Áo xanh).
  Ngoài trời (3D) người dùng cũng là nhân vật pixel: sprite luôn quay về camera, đổi hình trước/sau/nghiêng theo hướng đi
  (`src/pixel/billboard.js`). Nhân viên mô phỏng vẫn là nhân vật chibi 3D.

## Điều khiển và giao diện trong văn phòng (kiểu agent-office)

Không gian (nhà, văn phòng, đường phố) giữ nguyên; cách điều khiển, camera, nhân vật và giao diện theo
[agent-office](https://github.com/AgentSystemLabs/agent-office) (giấy phép MIT):

- **Di chuyển**: W A S D / mũi tên đi theo hướng camera, tốc độ đều không quán tính (đi 2.3 lần chiều cao nhân vật mỗi giây,
  Shift chạy 3.75 lần), nhân vật quay mặt nhanh theo hướng đi; Space nhảy dứt khoát; **bấm chuột lên sàn** để tự đi tới đó
  theo lưới điều hướng (đường xa thì chạy, có vòng đánh dấu nơi đến; bấm phím đi bất kỳ để huỷ).
- **Camera**: quay quanh nhân vật theo chuột (kéo để xoay, cuộn để gần/xa 1.25–8 lần chiều cao), **không tự xoay** về sau lưng;
  nhắm vào ngang vai, trượt mượt; vật cản thì camera rút lại gần (không xuyên tường). **V** đổi góc nhìn thứ nhất / thứ ba,
  **C** đưa camera về sau lưng.
- **Nhân vật**: đầu to (~40% chiều cao), thân tròn, mắt chấm, má hồng, tô hoạt hình + viền mực.
- **Giao diện**: cảnh 3D tràn màn hình; bảng tên văn phòng góc trên trái; dock nút + menu **☰** (góc nhìn, tầng, đi bộ, hiển thị)
  góc trên phải; các bảng nổi bên phải; gợi ý phím và thanh động tác ở giữa dưới; thông báo kiểu giấy + viền mực.
- `?maxfps=N` giới hạn số khung hình mỗi giây (máy yếu).

## Tạo nhân vật (kiểu agent-office)

- Màn hình tạo nhân vật: sân khấu xoay tròn bên trái (kéo để xoay, tự lắc qua lại cho thấy mọi phía, nút "Xem mặt"),
  mỗi lần đổi gì nhân vật nhảy lên vẫy tay. Bên phải là các tab: **✨ Mẫu** (loại nhân vật: tự tạo chibi hoặc nhân vật 3D
  làm sẵn, và các mẫu có sẵn), rồi các nhóm trong `appearance.json` (Khuôn mặt, Tóc & mũ, Trang phục & dáng). Mọi lựa chọn
  là nút bấm và ô màu tròn, không có danh sách thả xuống. "🎲 Ngẫu nhiên" chọn kiểu hài hoà (tóc màu tự nhiên, quần tối hơn áo…).
- Kiểu vẽ nhân vật: tô hoạt hình 3 mảng sáng/tối + viền mực (`src/agents/toon.js`), đầu to, tay chân tròn đầy. Ánh sáng trực tiếp
  lên nhân vật được giới hạn nên màu không cháy trắng dưới đèn trần; sân khấu xem trước dùng đúng ánh sáng văn phòng,
  nên màu lúc tạo và lúc vào văn phòng giống nhau. Nhân vật 3D làm sẵn cũng có viền cùng kiểu. Chất lượng thấp (`?q=low`) bỏ viền.

## Chuyển động nhân vật và camera bám theo

- Dáng đi/chạy (`src/agents/gait.js`, dùng chung cho chibi và model 3D): mỗi bàn chân có quỹ đạo riêng. Chân trụ được ghim
  tại điểm tiếp đất trên sàn, thân đi tới/rẽ/trượt ngang thì chân vẫn đứng yên; khớp hông và gối giải bằng IK hai khớp
  theo đúng chiều dài chân của từng model. Sải chân và nhịp bước theo tốc độ (công thức Alexander, có giới hạn ~30° ở hông),
  chạy có pha bay, nhún khi tiếp đất. Thân ngả theo gia tốc, nghiêng vào trong khi rẽ, hông xoay theo bước, vai xoay ngược,
  đầu giữ nhìn thẳng; đứng yên thì thở và dồn trọng tâm; vừa dừng thì bước nốt một nhịp cho chân về chỗ.
- `speed` trong `characters.json`: model chân ngắn đi chậm hơn một chút để bước chân tự nhiên.
- Camera người thứ ba: nhìn trước theo hướng đi (không xuyên tường), nhân vật ở 1/3 dưới khung hình, không nhấp nhô khi nhảy,
  chạy thì lùi ra và mở góc nhìn; cách nhân vật ~3 lần chiều cao, bấm C để về sau lưng (giữ mức zoom đã chọn).
- Đo kiểm: `npm run motion -- glb` (hoặc `chibi`) in độ trượt chân theo từng đoạn, độ giật camera, số khung hình nhân vật
  bị che và vị trí nhân vật trên màn hình. Kiểm thử đơn vị: `tests/gait.test.js` (đi thẳng, tăng tốc, đi vòng).

## Xe cộ và rèm ban công

- Xe chạy trên đường là mẫu xe phổ biến ở Việt Nam, dựng thủ tục (`src/scene/vehicles.js`): Honda Vision, Air Blade, Wave, Yamaha Exciter,
  VinFast Klara (xe điện), GrabBike (áo + mũ xanh Grab), ô tô BMW (ca-lăng hình quả thận), Mercedes (ngôi sao ba cánh), VinFast VF8, GrabCar; có biển số, đèn, mâm, gương.
  Danh sách xe/làn/tốc độ ở mảng `TRAFFIC`. Xe vẫn tuân theo `traffic.js`: không đâm nhau, dừng khi có người, bấm còi.
  Huy hiệu hãng được vẽ đơn giản bằng canvas (không nhúng file logo của hãng).
- Rèm tre ngoài ban công/cửa sổ lồi cuộn lên/xuống cùng rèm trong nhà (phím F), đồng bộ cho mọi người.

## Tỉ lệ và đường phố

- `layout.json` → `scale`: `furniture` (bàn, ghế, đồ đạc) và `character` (nhân vật), mặc định 0,5 cho không gian thoáng; kiến trúc giữ kích thước thật. Đặt 1 để về kích thước thật.
- Xe giữ khoảng cách với xe trước theo tốc độ, không bao giờ chồng nhau, chỉ vòng lại đầu đường khi chỗ xuất hiện còn trống (`src/scene/traffic.js`, có test mô phỏng 10 phút).
- Ra lòng đường: hiện cảnh báo; xe gặp người trong làn thì phanh, bấm còi, tài xế buông câu chửi (danh sách `INSULTS` trong `src/scene/street.js`); xe sau dừng nối đuôi; người lên lề thì xe chạy tiếp.

## Kiểm thử và ảnh so sánh

```bash
npm test                 # unit: server (trùng mã, nhận chỗ nguyên tử, quyền ngồi, CSV, mật khẩu), A*: mọi bàn/ghế họp/pantry/WC tới được từ cả hai đầu vỉa hè; chạy trọn ngày 36 và 40 người không ai kẹt, không ngồi chồng; sức chứa; CSV
npm run test:auth        # Playwright nhiều context: định dạng mã, trùng mã, khác tên, vào lại giữ chỗ, khóa chỗ (kể cả gọi API), admin đổi chỗ, tranh chấp nhận chỗ, đồng bộ, khóa CEO sau 5 lần sai
npm run e2e              # trình duyệt: không lỗi console, leo cầu thang khi đi bộ, không chui gầm thang, lan can, bấm chọn người, lọc/tìm, nhập CSV
npm run shots            # chụp các góc chuẩn vào shots/latest và in % khác so với shots/baseline
npm run shots:baseline   # lưu bộ ảnh hiện tại làm mốc
npm run perf             # fps/draw call với 40 người (thêm -- --low cho chất lượng thấp)
```

## Cấu trúc

```
src/core/util.js            giờ, RNG có seed, hướng
src/model/layoutModel.js    suy ra chỗ ngồi, vật cản, cầu thang, vùng cửa từ layout.json
src/model/staff.js          kiểm tra nhân sự / sức chứa, đọc CSV
src/nav/grid.js             lưới điều hướng từng tầng + A* + nối cầu thang
src/sim/schedule.js         lịch từng người mỗi ngày (có sai lệch ngẫu nhiên)
src/sim/sim.js              đồng hồ, state machine, giữ chỗ, hàng chờ cửa/cầu thang/WC, né nhau
src/scene/*                 vỏ nhà, rào cổng, logo, nhà bên, đường phố, xe
src/interior/interior.js    nội thất từ layout.json, màn hình bật/tắt theo người ngồi
src/agents/avatars.js       avatar có khung xương, vẽ bằng InstancedMesh (~11 draw call cho mọi số người)
src/ui/*                    camera, bảng điều khiển, lớp kiểm tra bố cục
src/shared/*                kiểm tra mã nhân viên và dụng cụ (dùng chung client/server)
src/auth, src/session       màn hình đăng nhập, phiên, chọn chỗ, WebSocket, avatar người khác
src/admin/dashboard.js      bảng quản trị CEO
src/interior/deskKit.js     dựng bàn theo dụng cụ
server/                     Express + SQLite + WebSocket (store.js: nghiệp vụ và mọi kiểm tra quyền)
```

Các script kiểm thử/chụp ảnh tự chạy server với DB tạm và mật khẩu CEO ngẫu nhiên, không đọc `.env`.
