import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';

export default defineConfig({
  base: './',
  // mã nguồn my-office (src/vendor/my-office, viết cho Next.js) đọc vài biến process.env lúc build
  // __REAL_SYS__: chế độ Real SYS (mặt bằng thật) — tắt mặc định, mã của nó không vào gói build. Bật: REAL_SYS=1 (src/core/mode.js)
  define: { __REAL_SYS__: JSON.stringify(process.env.REAL_SYS === '1'), 'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify(''), 'process.env.NEXT_PUBLIC_OFFICE_STATIC': JSON.stringify('1'), 'process.env.NEXT_PUBLIC_SITE_ROOT': JSON.stringify('') },
  // hộp bo góc của three tính UV từng đỉnh rất chậm (phần tốn nhất lúc dựng văn phòng): dùng bản tính sẵn, kết quả y hệt
  // (src/scene/fastRoundedBox.js, tests/fastRoundedBox.test.js)
  resolve: { alias: [{ find: /^three\/examples\/jsm\/geometries\/RoundedBoxGeometry\.js$/, replacement: fileURLToPath(new URL('./src/scene/fastRoundedBox.js', import.meta.url)) }] },
  server: { port: 5179 },
  // (dev) khai báo trước các module three/examples dùng ở phần tải sau (phòng bi-a / karaoke, gương nhà vệ sinh, nhân vật…):
  // không thì lần đầu dùng tới Vite mới phát hiện, tối ưu lại rồi TẢI LẠI CẢ TRANG cho mọi người đang mở — trông như app crash
  optimizeDeps: { include: ['three', ...['controls/OrbitControls', 'environments/RoomEnvironment', 'loaders/GLTFLoader', 'loaders/SVGLoader', 'objects/Reflector', 'postprocessing/EffectComposer', 'postprocessing/OutputPass', 'postprocessing/RenderPass', 'postprocessing/UnrealBloomPass', 'renderers/CSS2DRenderer', 'renderers/CSS3DRenderer', 'utils/BufferGeometryUtils', 'utils/SkeletonUtils'].map(m => `three/examples/jsm/${m}.js`)] },
  build: { chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.js'] }
});
