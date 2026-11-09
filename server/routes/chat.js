// API chat nội bộ (đọc lịch sử, danh sách kênh). Gửi tin đi qua WebSocket (server/realtime.js onChat) — cùng quy tắc quyền.
import { history, canUseChannel, myDms, deptIdOf } from '../social.js';
import { DEPARTMENTS } from '../../src/shared/departments.js';
import { check, v } from '../http.js';
import { HttpError } from '../store.js';

export const actorKey = a => a.kind === 'admin' ? `admin:${a.username}` : `employee:${a.code}`;

export function chatRoutes(api, { store, guards: { needAuth } }) {
  /** Kênh của tôi: Toàn công ty, phòng ban của mình (CEO: mọi phòng), các cuộc nhắn riêng đã có. */
  api.get('/chat/channels', needAuth, (req, res) => {
    const key = actorKey(req.actor), mine = deptIdOf(store, req.actor);
    const depts = req.actor.kind === 'admin' ? DEPARTMENTS : DEPARTMENTS.filter(d => d.id === mine);
    res.json({ me: key, channels: [{ id: 'all', name: 'Toàn công ty' }, ...depts.map(d => ({ id: 'dept:' + d.id, name: d.name, color: d.color }))], dms: myDms(store, key) });
  });
  /** Lịch sử một kênh (80 tin gần nhất; ?before=<id> để tải tiếp). */
  api.get('/chat/:channel', needAuth, (req, res) => {
    const { channel, before } = check({ ...req.params, ...req.query }, { channel: v.str({ max: 200, pattern: /^(all|dept:[a-z]+|dm:[\w:|-]+)$/ }), before: v.int({ min: 1, optional: true }) }, 'yêu cầu');
    if (!canUseChannel(store, req.actor, actorKey(req.actor), channel)) throw new HttpError(403, 'Bạn không có quyền xem kênh này.', { code: 'forbidden' });
    res.json({ messages: history(store, channel, before || null) });
  });
}
