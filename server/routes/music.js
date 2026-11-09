// API loa công ty (YouTube): phát link cho cả công ty, điều khiển (tạm dừng / tiếp / tua / tắt), danh sách bài gần đây;
// CEO cấp/thu quyền. Chỉ CEO và người được cấp quyền mới phát/điều khiển; ai đăng nhập cũng xem được trạng thái.
import { setMusicPermission, musicPermissions, musicState, canMusic, youtubeId, youtubeTitle, playMusic, controlMusic, recentMusic } from '../social.js';
import { audit } from '../db.js';
import { check, v, rateLimit } from '../http.js';
import { HttpError } from '../store.js';

export function musicRoutes(api, { db, store, hub, guards: { needAuth, needAdmin } }) {
  const needMusic = (req, _res, next) => canMusic(store, req.actor) ? next() : next(new HttpError(403, 'Bạn chưa được CEO cấp quyền mở nhạc.', { code: 'forbidden' }));
  const limit = rateLimit('music', { max: 30, windowMs: 60e3, methods: ['POST'] });
  const byOf = req => hub.displayOf(req.actor);
  api.get('/music', needAuth, (req, res) => res.json({ state: musicState(store), recent: recentMusic(store), canControl: canMusic(store, req.actor) }));
  /** Phát một link YouTube cho cả công ty. */
  api.post('/music/play', needAuth, needMusic, limit, async (req, res) => {
    const { url } = check(req.body, { url: v.str({ max: 500 }) });
    const id = youtubeId(url); if (!id) throw new HttpError(400, 'Link YouTube không hợp lệ.', { code: 'invalid', field: 'url' });
    const title = await youtubeTitle(id);
    const state = playMusic(store, req.actor.key, byOf(req), id, title);
    audit(db, req.actor.key, 'music.play', id, { title });
    hub.broadcast({ t: 'music', state });
    res.json({ ok: true, state });
  });
  /** Điều khiển: { action: pause | resume | seek | stop, position? (giây) }. */
  api.post('/music/control', needAuth, needMusic, limit, (req, res) => {
    const { action, position } = check(req.body, { action: v.oneOf(['pause', 'resume', 'seek', 'stop']), position: v.int({ min: 0, max: 24 * 3600, optional: true }) });
    const state = controlMusic(store, req.actor.key, byOf(req), action, position);
    if (!state) throw new HttpError(409, 'Loa đang tắt.', { code: 'music_off' });
    if (action === 'stop') audit(db, req.actor.key, 'music.stop');
    hub.broadcast({ t: 'music', state });
    res.json({ ok: true, state });
  });
  api.get('/admin/music', needAdmin, (_req, res) => res.json({ allowed: musicPermissions(store) }));
  api.post('/admin/music/:code', needAdmin, (req, res) => {
    const { code } = check(req.params, { code: v.str({ pattern: /^\d{4}$/ }) }, 'đường dẫn');
    const { allow } = check(req.body, { allow: v.bool() });
    if (!setMusicPermission(store, code, allow)) throw new HttpError(404, `Không có nhân viên ${code}.`, { code: 'not_found' });
    audit(db, req.actor.key, allow ? 'music.permission.grant' : 'music.permission.revoke', code);
    hub.musicPermission(code, allow); store.emit({ type: 'employees' });
    res.json({ ok: true });
  });
}
