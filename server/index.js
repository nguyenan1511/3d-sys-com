// Khởi động: API + WebSocket + giao diện (Vite middleware khi dev, dist/ khi production) trên một cổng.
import http from 'http';
import path from 'path';
import fs from 'fs';
import express from 'express';
import { config, ROOT } from './config.js';
import { createApp } from './app.js';

const { app, finish, hub, close } = await createApp(config);
const server = http.createServer(app);

if (config.production) {
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(dist)) { console.error('Chưa có dist/. Chạy "npm run build" trước.'); process.exit(1); }
  app.use(express.static(dist, { index: 'index.html' }));
} else {
  const { createServer } = await import('vite');
  // tên miền được phép khi chạy dev (Vite chặn tên miền lạ): đường hầm ngrok + DEV_ALLOWED_HOSTS (cách nhau bằng dấu phẩy)
  const allowedHosts = ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.dev', '.ngrok.io', ...String(process.env.DEV_ALLOWED_HOSTS || '').split(',').map(x => x.trim()).filter(Boolean)];
  const vite = await createServer({ root: ROOT, server: { middlewareMode: true, ws: { server }, allowedHosts }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use(finish);

hub.attach(server);
server.listen(config.port, config.host, () => {
  console.log(`SYSONE digital twin: http://localhost:${config.port}  (chính sách trùng mã: ${config.duplicatePolicy}, CEO ngồi mọi chỗ: ${config.adminCanSitAnywhere})`);
});
const stop = () => { server.close(); close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
