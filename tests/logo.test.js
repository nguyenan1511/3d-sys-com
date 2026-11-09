// Logo gốc phải được giữ nguyên từng byte ở mọi nơi dùng ảnh (trang đăng nhập, áo, mặt biển 3D).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const root = path.resolve(import.meta.dirname, '..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

describe('logo gốc SYSONE', () => {
  it('file SVG dùng trên web trùng từng byte với file gốc; PNG trùng ảnh nhúng trong SVG gốc', () => {
    const svg = fs.readFileSync(path.join(root, 'assets/logo.svg'));
    expect(sha(fs.readFileSync(path.join(root, 'public/logo/sysone-logo.svg')))).toBe(sha(svg));
    const embedded = Buffer.from(svg.toString('utf8').match(/base64,([^"]+)/)[1], 'base64');
    expect(sha(fs.readFileSync(path.join(root, 'public/logo/sysone-logo.png')))).toBe(sha(embedded));
    expect(embedded.subarray(1, 4).toString()).toBe('PNG');
  });
});
