// API lướt TikTok (server/tiktok.js): xem danh sách, dán link, xoá (người dán / CEO / HC-NS).
import { TikTokList } from '../tiktok.js';
import { canManage } from '../board.js';
import { audit } from '../db.js';
import { check, v, rateLimit } from '../http.js';

export function tiktokRoutes(api, { db, store, hub, guards: { needAuth } }) {
  const tt = hub.tiktok ||= new TikTokList(store);
  const limit = rateLimit('tiktok', { max: 12, windowMs: 60e3, methods: ['POST', 'DELETE'] });
  const keyOf = a => a.kind === 'admin' ? `admin:${a.username}` : `employee:${a.code}`;
  api.get('/tiktok', needAuth, async (req, res) => {
    const manage = canManage(store, req.actor), me = keyOf(req.actor);
    res.json({ items: (await tt.load()).map(it => tt.view(it, me, manage)), canManage: manage });
  });
  api.post('/tiktok', needAuth, limit, async (req, res) => {
    const { url } = check(req.body, { url: v.str({ max: 500 }) });
    const it = await tt.add(keyOf(req.actor), hub.displayOf(req.actor), url);
    audit(db, keyOf(req.actor), 'tiktok.add', it.id, { title: it.title });
    res.json({ ok: true, item: tt.view(it, keyOf(req.actor), canManage(store, req.actor)) });
  });
  api.delete('/tiktok/:id', needAuth, limit, async (req, res) => {
    const { id } = check(req.params, { id: v.str({ pattern: /^\d{8,25}$/ }) }, 'đường dẫn');
    const it = await tt.remove(keyOf(req.actor), id, canManage(store, req.actor));
    audit(db, keyOf(req.actor), 'tiktok.delete', id, { title: it.title });
    res.json({ ok: true });
  });
}
