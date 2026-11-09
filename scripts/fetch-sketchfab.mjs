// Tải model nhân vật từ Sketchfab (cần tài khoản: API token đặt trong .env là SKETCHFAB_TOKEN, không ghi vào code),
// lưu bản .zip glTF vào public/model/src/, tối ưu thành public/model/<id>.opt.glb và in thông tin ghi công (CC BY).
// Dùng: node scripts/fetch-sketchfab.mjs <id>=<uid-hoặc-link> [<id>=<uid> ...]
//   vd: node scripts/fetch-sketchfab.mjs boy-cartoon=1a6f93e9076b49cea4bb777a913b4bdd
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

function token() {
  if (process.env.SKETCHFAB_TOKEN) return process.env.SKETCHFAB_TOKEN.trim();
  if (fs.existsSync('.env')) for (const line of fs.readFileSync('.env', 'utf8').split('\n')) { const m = line.match(/^\s*SKETCHFAB_TOKEN\s*=\s*(.+?)\s*$/); if (m) return m[1].replace(/^["']|["']$/g, ''); }
  return null;
}
const TOKEN = token();
if (!TOKEN) { console.error('Thiếu SKETCHFAB_TOKEN: thêm dòng SKETCHFAB_TOKEN=... vào file .env (lấy ở sketchfab.com → Settings → Password & API).'); process.exit(1); }

const jobs = process.argv.slice(2).map(a => { const [id, ref] = a.split('='); return { id, uid: (ref || '').match(/([0-9a-f]{32})/)?.[1] }; });
if (!jobs.length || jobs.some(j => !j.id || !j.uid)) { console.error('Dùng: node scripts/fetch-sketchfab.mjs <id>=<uid-hoặc-link> ...'); process.exit(1); }
fs.mkdirSync('public/model/src', { recursive: true });

for (const { id, uid } of jobs) {
  const info = await (await fetch(`https://api.sketchfab.com/v3/models/${uid}`)).json();
  const lic = info.license?.label || '?';
  // chỉ dùng model miễn phí: bỏ qua model bán trong cửa hàng hoặc không cho tải
  if (info.price || info.isDownloadable !== true) { console.error(`${id}: không phải model miễn phí cho tải — bỏ qua.`); continue; }
  if (/NonCommercial|NoDerivs/i.test(lic)) { console.error(`${id}: giấy phép "${lic}" không cho dùng thương mại/chỉnh sửa — bỏ qua.`); continue; }
  const r = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${TOKEN}` } });
  if (!r.ok) { console.error(`${id}: không tải được (HTTP ${r.status}) — kiểm tra token hoặc model có cho tải không.`); continue; }
  const dl = await r.json();
  const url = dl.gltf?.url || dl.glb?.url;
  if (!url) { console.error(`${id}: không có bản glTF/GLB.`); continue; }
  const ext = dl.gltf?.url ? 'zip' : 'glb', file = path.join('public/model/src', `${id}.${ext}`);
  fs.writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  console.log(`${id}: đã tải ${(fs.statSync(file).size / 1e6).toFixed(1)} MB → ${file}`);
  execFileSync('node', ['scripts/optimize-model.mjs', file, `--out=public/model/${id}.opt.glb`], { stdio: 'inherit' });
  // thông tin ghi công theo giấy phép (dán vào characters.json → "credit")
  console.log(JSON.stringify({ id, credit: { title: info.name, author: info.user?.displayName || info.user?.username, authorUrl: info.user?.profileUrl, source: info.viewerUrl, license: lic, licenseUrl: info.license?.url } }));
}
