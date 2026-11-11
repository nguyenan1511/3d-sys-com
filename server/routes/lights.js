// API đèn công ty (công tắc ở sảnh): ai đăng nhập cũng xem được trạng thái; CEO và người được CEO cấp quyền mới bật/tắt.
// CEO cấp/thu quyền từng nhân viên (giống loa công ty: server/routes/music.js).
import { canLights, lightsState, setLights, setLightsPermission, lightsPermissions } from '../lights.js';
import { audit } from '../db.js';
import { check, v, rateLimit } from '../http.js';
import { HttpError } from '../store.js';

export function lightsRoutes(api, { db, store, hub, guards: { needAuth, needAdmin } }) {
  const limit = rateLimit('lights', { max: 30, windowMs: 60e3, methods: ['POST'] });
  api.get('/lights', needAuth, (req, res) => res.json({ state: lightsState(store), canControl: canLights(store, req.actor) }));
  api.post('/lights', needAuth, limit, (req, res) => {
    if (!canLights(store, req.actor)) throw new HttpError(403, 'Bạn chưa được CEO cấp quyền bật/tắt đèn công ty.', { code: 'forbidden' });
    const { on } = check(req.body, { on: v.bool() });
    const state = setLights(store, req.actor.key, hub.displayOf(req.actor), on);
    audit(db, req.actor.key, on ? 'lights.on' : 'lights.off');
    hub.broadcast({ t: 'lights', state });
    res.json({ ok: true, state });
  });
  api.get('/admin/lights', needAdmin, (_req, res) => res.json({ allowed: lightsPermissions(store) }));
  api.post('/admin/lights/:code', needAdmin, (req, res) => {
    const { code } = check(req.params, { code: v.str({ pattern: /^\d{4}$/ }) }, 'đường dẫn');
    const { allow } = check(req.body, { allow: v.bool() });
    if (!setLightsPermission(store, code, allow)) throw new HttpError(404, `Không có nhân viên ${code}.`, { code: 'not_found' });
    audit(db, req.actor.key, allow ? 'lights.permission.grant' : 'lights.permission.revoke', code);
    for (const ws of hub.sockets.get(`employee:${code}`) || []) hub.send(ws, { t: 'lightsPerm', allow });
    res.json({ ok: true });
  });
}
