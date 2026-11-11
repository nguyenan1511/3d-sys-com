// Phục vụ tệp tĩnh có nén (brotli / gzip) mà không cần thêm thư viện: tệp văn bản (js, css, html, json, svg, bin dữ liệu)
// được nén một lần rồi giữ trong bộ nhớ (theo đường dẫn + thời điểm sửa), các lần sau gửi thẳng bản nén.
// Tệp có mã băm trong tên (dist/assets/*-<hash>.js) được trình duyệt giữ 1 năm (immutable); tệp khác kiểm tra lại bằng ETag.
// Không nén được / trình duyệt không nhận nén → chuyển cho express.static như cũ.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import express from 'express';

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff' };
const MIN = 1024, CACHE_MAX = 64 * 1024 * 1024;
const HASHED = /[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8}\.(js|css|woff2?)$/; // (tên do Vite đặt: main-rSLOUEta.js)

/** Chọn kiểu nén theo Accept-Encoding: 'br' | 'gzip' | null. */
export function pickEncoding(header = '') {
  const h = String(header).toLowerCase();
  const q = name => { const m = h.match(new RegExp(`(?:^|,)\\s*${name}\\s*(?:;\\s*q=([0-9.]+))?\\s*(?:,|$)`)); return m ? (m[1] === undefined ? 1 : +m[1]) : 0; };
  if (q('br') > 0) return 'br';
  if (q('gzip') > 0) return 'gzip';
  return null;
}

export function compressedStatic(dir, { maxAge = 0, index = 'index.html' } = {}) {
  const root = path.resolve(dir);
  const cache = new Map(), pending = new Map(); let cacheBytes = 0;
  const plain = express.static(root, { index, maxAge, setHeaders: (res, f) => { if (HASHED.test(f)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } });
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel; try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (rel.endsWith('/')) rel += index;
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) return next();
    const type = TYPES[path.extname(file).toLowerCase()];
    const enc = type && pickEncoding(req.headers['accept-encoding']);
    let st; try { st = fs.statSync(file); } catch { return next(); }
    if (!st.isFile()) return plain(req, res, next);
    if (!enc || st.size < MIN) return plain(req, res, next);
    const key = `${file}|${st.mtimeMs}|${enc}`;
    const send = hit => {
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', HASHED.test(file) ? 'public, max-age=31536000, immutable' : `public, max-age=${Math.round(maxAge / 1000)}, must-revalidate`);
      res.setHeader('ETag', hit.etag);
      if (req.headers['if-none-match'] === hit.etag) return res.status(304).end();
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Encoding', enc);
      res.setHeader('Content-Length', hit.body.length);
      if (req.method === 'HEAD') return res.end();
      res.end(hit.body);
    };
    if (cache.has(key)) return send(cache.get(key));
    // nén không chặn luồng chính (tệp JS vài MB mất cỡ một giây): các yêu cầu cùng lúc chờ chung một lần nén
    let job = pending.get(key);
    if (!job) {
      job = fs.promises.readFile(file).then(raw => new Promise((ok, fail) => {
        const done = (err, body) => (err ? fail(err) : ok({ body, etag: `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}-${enc}"` }));
        if (enc === 'br') zlib.brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }, done);
        else zlib.gzip(raw, { level: 9 }, done);
      })).then(hit => { if (cacheBytes + hit.body.length < CACHE_MAX) { cache.set(key, hit); cacheBytes += hit.body.length; } return hit; }).finally(() => pending.delete(key));
      pending.set(key, job);
    }
    job.then(send, () => plain(req, res, next));
  };
}
