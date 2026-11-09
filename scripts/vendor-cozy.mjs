// Tạo bản sao thứ hai của mã my-office (src/vendor/my-office → src/vendor/my-office-cozy) để dựng phòng "cozy" (tầng 3)
// cùng lúc với bản HQ (tầng trệt + tầng 2): mã my-office giữ kiểu mặt bằng trong biến toàn cục của module, nên mỗi kiểu
// cần một bộ module riêng. Cũng sinh src/myoffice/boot-cozy.js từ src/myoffice/boot.js (đổi đường dẫn vendor).
// Chạy lại sau mỗi lần sửa src/vendor/my-office hoặc src/myoffice/boot.js:  node scripts/vendor-cozy.mjs
import { cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'src/vendor/my-office'), dst = path.join(root, 'src/vendor/my-office-cozy');
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
writeFileSync(path.join(dst, 'BAN_SAO.md'), 'Bản sao tự sinh của ../my-office (scripts/vendor-cozy.mjs) để dựng phòng cozy — không sửa trực tiếp ở đây.\n');
const boot = readFileSync(path.join(root, 'src/myoffice/boot.js'), 'utf8')
  .replaceAll("'../vendor/my-office/", "'../vendor/my-office-cozy/")
  .replace(/^/, '// TỰ SINH bởi scripts/vendor-cozy.mjs từ src/myoffice/boot.js — không sửa trực tiếp.\n');
writeFileSync(path.join(root, 'src/myoffice/boot-cozy.js'), boot);
console.log('Đã tạo src/vendor/my-office-cozy và src/myoffice/boot-cozy.js');
