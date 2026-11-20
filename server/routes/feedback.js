// API Góp ý & báo lỗi (server/feedback.js). Có tin mới thì báo ngay qua WebSocket: { t: 'fb', thread, msg? } cho chủ phiếu + mọi Admin.
import { Feedback, keyOf } from '../feedback.js';
import { check, v, rateLimit } from '../http.js';

export function feedbackRoutes(api, { store, hub, guards: { needAuth } }) {
  const F = hub.feedback ||= new Feedback(store, k => hub.nameOf(k));
  const limit = rateLimit('feedback', { max: 20, windowMs: 60e3, methods: ['POST', 'PUT', 'DELETE'] });
  const id = req => check(req.params, { id: v.int({ min: 1 }) }).id;
  /** Báo cho chủ phiếu + mọi Admin (mỗi người nhận phiếu theo góc nhìn của mình: unread khác nhau). */
  const push = (t, msg, removed = false) => {
    const send = (ws, actor) => hub.send(ws, { t: 'fb', thread: removed ? { id: t.id, removed: true } : F.view(t, actor), msg: msg ? F.msgView(msg) : null });
    for (const [k, set] of hub.sockets) {
      const admin = k.startsWith('admin:');
      if (!admin && k !== t.owner) continue;
      const actor = admin ? { kind: 'admin', username: k.slice(6) } : { kind: 'employee', code: k.slice(9) };
      for (const ws of set) send(ws, actor);
    }
  };
  api.get('/feedback', needAuth, (req, res) => res.json({ threads: F.list(req.actor), admin: F.isAdmin(req.actor) }));
  api.post('/feedback', needAuth, limit, async (req, res) => {
    const { thread, msg } = await F.create(req.actor, req.body || {});
    push(thread, msg); res.json({ ok: true, thread: F.view(thread, req.actor), msg: F.msgView(msg) });
  });
  api.get('/feedback/:id', needAuth, (req, res) => res.json(F.messages(req.actor, id(req))));
  api.post('/feedback/:id/messages', needAuth, limit, async (req, res) => {
    const { thread, msg } = await F.add(req.actor, id(req), req.body || {});
    push(thread, msg); res.json({ ok: true, thread: F.view(thread, req.actor), msg: F.msgView(msg) });
  });
  api.put('/feedback/:id', needAuth, limit, (req, res) => {
    const { status } = check(req.body || {}, { status: v.oneOf(['open', 'done']) });
    const t = F.setStatus(req.actor, id(req), status); push(t, null); res.json({ ok: true, thread: F.view(t, req.actor) });
  });
  api.delete('/feedback/:id', needAuth, limit, async (req, res) => { const t = await F.remove(req.actor, id(req)); push(t, null, true); res.json({ ok: true }); });
  api.get('/feedback/:id/img/:mid', needAuth, async (req, res) => {
    const { mid } = check(req.params, { id: v.int({ min: 1 }), mid: v.int({ min: 1 }) });
    const b = await F.image(req.actor, id(req), mid);
    if (!b) return res.status(404).json({ error: 'Không còn ảnh này.' });
    res.set('Content-Type', b.type || 'image/jpeg').set('X-Content-Type-Options', 'nosniff').set('Cache-Control', 'private, max-age=31536000, immutable').set('Content-Security-Policy', "default-src 'none'; sandbox").send(b.data);
  });
}
export { keyOf };
