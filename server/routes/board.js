// API bảng thông báo công ty (server/board.js). Đọc: mọi người đã đăng nhập. Đăng: CEO, Phòng HC-NS, người được CEO cấp quyền
// (/admin/board-perms); sửa / gỡ: CEO + HC-NS mọi tin, người được cấp quyền tin của mình.
// Có thay đổi: báo qua WebSocket ('board') để bảng 3D ở sảnh và panel đang mở cập nhật ngay.
import { page, create, update, remove, canPost, canManage, setImage, dropImage, setPostPermission, postPermissions } from '../board.js';
import { HttpError } from '../store.js';
import { audit } from '../db.js';
import { check, v } from '../http.js';
import { actorKey } from './chat.js';

export function boardRoutes(api, { store, hub, guards: { needAuth, needAdmin } }) {
  const who = req => { const key = actorKey(req.actor); return { key, name: hub.nameOf(key) }; };
  const changed = () => hub.broadcast({ t: 'board', at: Date.now() });
  api.get('/board', needAuth, (req, res) => {
    const q = check(req.query, { offset: v.int({ min: 0, max: 100000, optional: true }), kind: v.oneOf(['notice', 'event'], { optional: true }) }, 'yêu cầu');
    res.json({ ...page(store, { offset: q.offset || 0, kind: q.kind || null, actor: req.actor }), canPost: canPost(store, req.actor), canManage: canManage(store, req.actor), isAdmin: req.actor.kind === 'admin' });
  });
  api.post('/board', needAuth, (req, res) => { const item = create(store, req.actor, who(req), req.body); changed(); res.json({ ok: true, item }); });
  api.patch('/board/:id', needAuth, (req, res) => { const { id } = check(req.params, { id: v.int({ min: 1 }) }); const item = update(store, req.actor, who(req), id, req.body); changed(); res.json({ ok: true, item }); });
  /** Ảnh của tin: gắn / thay (JSON { data: base64, type }), gỡ, xem (ai đăng nhập cũng xem được). */
  api.put('/board/:id/image', needAuth, async (req, res) => { const { id } = check(req.params, { id: v.int({ min: 1 }) }); const item = await setImage(store, req.actor, who(req), id, req.body || {}); changed(); res.json({ ok: true, item }); });
  api.delete('/board/:id/image', needAuth, async (req, res) => { const { id } = check(req.params, { id: v.int({ min: 1 }) }); const item = await dropImage(store, req.actor, who(req), id); changed(); res.json({ ok: true, item }); });
  api.get('/board/:id/image', needAuth, async (req, res) => {
    const { id } = check(req.params, { id: v.int({ min: 1 }) }), r = store.db.announcements.get(id);
    const b = r?.image_v ? await store.db.blobs.get(`ann:${id}`) : null;
    if (!b) return res.status(404).json({ error: 'Không có ảnh.', code: 'not_found' });
    res.set('Content-Type', b.type || 'image/jpeg').set('X-Content-Type-Options', 'nosniff').set('Cache-Control', 'private, max-age=31536000, immutable').send(b.data);   // (?v= đổi khi thay ảnh)
  });
  api.delete('/board/:id', needAuth, (req, res) => { const { id } = check(req.params, { id: v.int({ min: 1 }) }); remove(store, req.actor, who(req), id); changed(); res.json({ ok: true }); });
  /** CEO cấp / thu quyền đăng tin: danh sách người được cấp; cấp cho một người, hoặc nhiều người một lần ({ codes, allow }). */
  api.get('/admin/board-perms', needAdmin, (_req, res) => res.json({ allowed: postPermissions(store) }));
  api.post('/admin/board-perms', needAdmin, (req, res) => {
    const { allow } = check(req.body, { allow: v.bool() }), codes = req.body?.codes;
    if (!Array.isArray(codes) || codes.length > 5000 || !codes.every(c => typeof c === 'string' && /^\d{4}$/.test(c))) throw new HttpError(400, 'Danh sách mã nhân viên không hợp lệ.', { code: 'invalid', field: 'codes' });
    let n = 0;
    for (const code of codes) if (setPostPermission(store, code, allow)) { n++; for (const ws of hub.sockets.get(`employee:${code}`) || []) hub.send(ws, { t: 'boardPerm', allow }); }
    if (!n && codes.length) throw new HttpError(404, 'Không có nhân viên nào trong danh sách.', { code: 'not_found' });
    audit(store.db, req.actor.key, allow ? 'board.permission.grant' : 'board.permission.revoke', codes.length === 1 ? codes[0] : `${n} người`);
    res.json({ ok: true, changed: n });
  });
}
