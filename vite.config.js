import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // mã nguồn my-office (src/vendor/my-office, viết cho Next.js) đọc vài biến process.env lúc build
  define: { 'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify(''), 'process.env.NEXT_PUBLIC_OFFICE_STATIC': JSON.stringify('1'), 'process.env.NEXT_PUBLIC_SITE_ROOT': JSON.stringify('') },
  server: { port: 5179 },
  build: { chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.js'] }
});
