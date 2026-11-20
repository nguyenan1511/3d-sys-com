// API lướt TikTok (server/tiktok.js): xem danh sách, dán link, xoá (người dán / Admin / HC-NS).
import { TikTokList, TikTokChannels } from '../tiktok.js';
import { canManage } from '../board.js';
import { audit } from '../db.js';
import { check, v, rateLimit } from '../http.js';

export function tiktokRoutes(api, { db, store, hub, guards: { needAuth } }) {
  const tt = hub.tiktok ||= new TikTokList(store), ch = hub.tiktokChannels ||= new TikTokChannels(store);
  const limit = rateLimit('tiktok', { max: 12, windowMs: 60e3, methods: ['POST', 'DELETE'] });
  const keyOf = a => a.kind === 'admin' ? `admin:${a.username}` : `employee:${a.code}`;
  /** Video để lướt: video mới của các kênh cố định (xen kẽ) + video đồng nghiệp chia sẻ (không trùng). */
  api.get('/tiktok', needAuth, async (req, res) => {
    const manage = canManage(store, req.actor), me = keyOf(req.actor);
    const [chans, shared] = await Promise.all([ch.videos(), tt.load()]), seen = new Set(chans.map(x => x.id));
    res.json({ items: [...chans, ...shared.filter(x => !seen.has(x.id)).map(it => tt.view(it, me, manage))], channels: ch.list(), canManage: manage });
  });
  /** Admin / HC-NS: đổi danh sách kênh cố định. */
  api.put('/tiktok/channels', needAuth, limit, async (req, res) => {
    if (!canManage(store, req.actor)) return res.status(403).json({ error: 'Chỉ Admin hoặc Hành chính - Nhân sự đổi được kênh.', code: 'forbidden' });
    const list = ch.set(keyOf(req.actor), req.body?.channels);
    audit(db, keyOf(req.actor), 'tiktok.channels', '', { channels: list });
    const items = await ch.videos();
    res.json({ ok: true, channels: list, found: Object.fromEntries(list.map(h => [h, items.filter(x => x.channel === h).length])) });
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
