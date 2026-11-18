// Modal "Có gì ở văn phòng?": giới thiệu nhanh tính năng làm việc + giải trí, theo nhóm (Bắt đầu, Làm việc, Giải trí, Khám
// phá thêm). Mỗi mục: ô hình (emoji trên nền màu), tên, 1–2 câu, cách dùng theo thiết bị (máy tính: phím; điện thoại: nút)
// và nút "Đi tới" (dịch chuyển tới nơi đó). Nội dung nằm trong public/data/intro.json — thêm tính năng: tăng "version" và
// thêm mục có "new_in"; lần vào sau modal tự mở lại, mục mới hiện đầu tiên với nhãn MỚI.
// GHIM NỔI (mặc định, 2026-11-17 — người dùng lười đọc hộp chữ): lần đầu vào / có nội dung mới, mỗi nơi có "go" hiện một
// ghim nổi trong cảnh 3D (biểu tượng + tên ngắn, nhấp nhô) ở tầng đang đứng; bấm ghim là tới nơi đó. Thanh nhỏ phía trên:
// "Danh sách đầy đủ" (hộp cũ, cho các mục không có chỗ như phím tắt) · "Ẩn ghim". Nút "Có gì ở đây?" bật / tắt ghim.
import { esc } from '../session/ui.js';
import { icon, ICONS } from './icons.js';

const KEY = 'sysone.intro.seen';
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const seenVersion = () => { try { return +localStorage.getItem(KEY) || 0; } catch { return 0; } };
const markSeen = v => { try { localStorage.setItem(KEY, String(v)); } catch { /* chế độ riêng tư */ } };

export class Intro {
  constructor(app, session) { this.app = app; this.s = session; this.data = null; this.el = null; }

  async load() {
    if (this.data) return this.data;
    try { const r = await fetch('data/intro.json', { cache: 'no-cache' }); if (r.ok) this.data = await r.json(); } catch { /* mạng lỗi: bỏ qua */ }
    return this.data;
  }
  /** Mở nếu người này chưa xem phiên bản nội dung hiện tại. Trả về khi modal đóng. */
  async maybeShow() {
    if (window.__NO_INTRO) return;
    const d = await this.load(); if (!d) return;
    const seen = seenVersion();
    if (seen >= d.version) return;
    this.since = seen; markSeen(d.version);
    this.showPins();   // (không chặn: ghim nổi trong cảnh, không phải hộp chữ)
  }

  // ---------- ghim nổi trong cảnh 3D ----------
  async togglePins() { if (this.pins) this.hidePins(); else await this.showPins(); }
  async showPins() {
    const d = await this.load(); if (!d || this.pins || !this.s.player) { if (!d) this.s.toast?.('Chưa tải được phần giới thiệu, thử lại sau.', true); return; }
    const since = this.since ?? seenVersion();
    const list = [];
    for (const it of d.items.filter(x => x.go)) {   // (các mục cùng một chỗ gộp vào một ghim: "Nhà vệ sinh · Lướt TikTok")
      const t = this.target(it.go); if (!t || t.desk || !Number.isFinite(t.x)) continue;
      const same = list.find(x => x.t.f === t.f && Math.hypot(x.t.x - t.x, x.t.z - t.z) < 1.2);
      if (same) { same.title += ` · ${it.title}`; same.fresh ||= (it.new_in || 0) > since && since > 0; } else list.push({ it, t, title: it.title, fresh: (it.new_in || 0) > since && since > 0 });
    }
    if (!list.length) { this.open(); return; }
    const layer = document.createElement('div'); layer.className = 'ipin-layer'; layer.setAttribute('aria-label', 'Các nơi trong văn phòng');
    const bar = document.createElement('div'); bar.className = 'ipin-bar'; bar.setAttribute('role', 'status');   // (thanh riêng, nằm trên các bảng; ghim nằm dưới bảng điều khiển / bản đồ nhỏ)
    bar.innerHTML = `${icon('target', 15)}<span>Bấm <b>ghim</b> để tới nơi đó</span><button type="button" class="sx-ghost" data-all>Danh sách đầy đủ</button><button type="button" class="sx-primary" data-hide>Ẩn ghim</button>`;
    layer.innerHTML = list.map(({ it, title, fresh }, i) => `<button type="button" class="ipin${fresh ? ' new' : ''}" data-i="${i}" title="${esc(title)}" style="--bg:${esc(it.color || '#fff')};--d:${(i % 7) * 0.35}s"><i aria-hidden="true">${esc(it.icon || '📍')}</i><span>${esc(title)}</span></button>`).join('');
    document.getElementById('appRoot').append(layer, bar);
    bar.querySelector('[data-hide]').onclick = () => this.hidePins();
    bar.querySelector('[data-all]').onclick = () => { this.hidePins(); this.open(); };
    layer.querySelectorAll('.ipin').forEach(b => b.onclick = () => { const x = list[+b.dataset.i]; this.go(x.it); });
    this.pins = { layer, bar, list, els: [...layer.querySelectorAll('.ipin')] };
    const v = this.app.camera.position.clone(); const loop = () => { if (!this.pins) return; this.placePins(v); this.pinRaf = requestAnimationFrame(loop); };
    loop();
  }
  hidePins() { if (!this.pins) return; cancelAnimationFrame(this.pinRaf); const { layer, bar } = this.pins; this.pins = null; for (const e of [layer, bar]) { e.classList.add('out'); setTimeout(() => e.remove(), 200); } }
  /** Mỗi khung hình: chiếu vị trí từng nơi lên màn hình; chỉ hiện nơi ở tầng mình đang đứng, trước mặt camera. */
  placePins(v) {
    const { list, els, layer } = this.pins, app = this.app, cam = app.camera, cv = app.renderer.domElement, r = cv.getBoundingClientRect();
    const f = this.s.player?.agent?.f ?? 0, hidden = !!app.rooms?.active || app.mode2d || document.body.classList.contains('overlay-open');
    layer.classList.toggle('off', hidden); this.pins.bar.classList.toggle('off', hidden); if (hidden) return;
    list.forEach(({ t }, i) => {
      const el = els[i];
      if (t.f !== f) { if (!el.hidden) el.hidden = true; return; }
      v.set(t.x, app.model.floorY(t.f) + 2.1, t.z).project(cam);
      const on = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      if (el.hidden === on) el.hidden = !on; if (!on) return;
      const tf = `translate(${Math.round(r.left + (v.x + 1) / 2 * r.width)}px, ${Math.round(r.top + (1 - v.y) / 2 * r.height)}px) translate(-50%, -100%)`;
      if (el._tf !== tf) { el._tf = tf; el.style.transform = tf; }   // (chỉ ghi khi đổi — không ghi DOM mỗi khung hình)
    });
  }
  /** since: phiên bản đã xem trước đó (mục có new_in > since được gắn nhãn MỚI). */
  async open({ since = seenVersion() } = {}) {
    const d = await this.load();
    if (!d) { this.s.toast?.('Chưa tải được phần giới thiệu, thử lại sau.', true); return; }
    if (this.el) return this.closed;
    this.since = since;
    const fresh = d.items.filter(it => (it.new_in || 0) > since && since > 0);
    this.tabs = [...(fresh.length ? [{ id: 'new', label: 'Mới', icon: 'plus' }] : []), ...d.groups];
    this.tab = this.tabs[0].id;
    const back = this.el = document.createElement('div');
    back.className = 'intro-back';
    back.innerHTML = `<div class="intro" role="dialog" aria-modal="true" aria-labelledby="introTitle">
      <header class="intro-h">
        <div><h2 id="introTitle">${esc(d.title)}</h2><p>${esc(d.subtitle || '')}</p></div>
        <button type="button" class="intro-x" aria-label="Đóng">${icon('close', 16)}</button>
      </header>
      <nav class="intro-tabs" role="tablist"></nav>
      <div class="intro-body" tabindex="-1"></div>
      <footer class="intro-f">
        <span class="intro-dots" aria-hidden="true"></span>
        ${this.app.openKeys ? `<button type="button" class="intro-keys">${icon('keyboard', 15)} Phím tắt</button>` : ''}
        <button type="button" class="intro-next primary"></button>
      </footer></div>`;
    document.body.appendChild(back);
    document.body.classList.add('overlay-open');   // (main.js: thôi vẽ cảnh 3D bên dưới — cuộn mượt, không chớp)
    this.closed = new Promise(res => { this._done = res; });
    back.querySelector('.intro-x').onclick = () => this.close();
    back.addEventListener('click', e => { if (e.target === back) this.close(); });
    back.querySelector('.intro-keys')?.addEventListener('click', () => { this.close(); this.app.openKeys(); });
    back.querySelector('.intro-next').onclick = () => { const i = this.tabs.findIndex(t => t.id === this.tab); if (i < this.tabs.length - 1) this.show(this.tabs[i + 1].id); else this.close(); };
    // phím: Esc đóng, ← → đổi nhóm; không để phím lọt xuống điều khiển nhân vật (W A S D, E…)
    this._key = e => {
      if (!this.el) return;
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const i = this.tabs.findIndex(t => t.id === this.tab) + (e.key === 'ArrowRight' ? 1 : -1); if (this.tabs[i]) this.show(this.tabs[i].id); e.preventDefault(); }
      if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') e.stopPropagation();
    };
    window.addEventListener('keydown', this._key, true);
    this.show(this.tab);
    requestAnimationFrame(() => back.classList.add('show'));
    back.querySelector('.intro-next').focus({ preventScroll: true });
    return this.closed;
  }

  show(id) {
    const d = this.data, el = this.el; this.tab = id;
    el.querySelector('.intro-tabs').innerHTML = this.tabs.map(t => `<button type="button" role="tab" aria-selected="${t.id === id}" class="${t.id === id ? 'on' : ''}" data-t="${t.id}">${ICONS[t.icon] ? icon(t.icon, 15) : ''}${esc(t.label)}${t.id === 'new' ? ' <b class="intro-new">MỚI</b>' : ''}</button>`).join('');
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => this.show(b.dataset.t));
    const items = id === 'new' ? d.items.filter(it => (it.new_in || 0) > this.since) : d.items.filter(it => it.group === id);
    const body = el.querySelector('.intro-body');
    body.className = `intro-body${id === 'start' ? ' is-start' : ''}`;
    body.innerHTML = `<div class="intro-grid">${items.map((it, n) => this.card(it, n)).join('')}</div>`;
    body.scrollTop = 0;
    body.querySelectorAll('.intro-ic img').forEach(img => img.addEventListener('error', () => { img.parentNode.classList.add('noimg'); img.remove(); }, { once: true }));   // (chưa có ảnh: hiện emoji)
    body.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { const it = d.items.find(x => x.id === b.dataset.go); this.close(); this.go(it); });
    const i = this.tabs.findIndex(t => t.id === id), last = i === this.tabs.length - 1;
    el.querySelector('.intro-dots').innerHTML = this.tabs.map((t, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    const next = el.querySelector('.intro-next');
    next.innerHTML = last ? 'Bắt đầu khám phá' : `Tiếp: ${esc(this.tabs[i + 1].label)} ${icon('arrowRight', 15)}`;
  }

  card(it, n) {
    const how = COARSE ? (it.mobile || it.pc) : (it.pc || it.mobile);
    const canGo = it.go && this.target(it.go);
    const isNew = (it.new_in || 0) > this.since && this.since > 0;
    return `<article class="intro-card" style="--d:${n * 40}ms">
      <div class="intro-ic" style="--bg:${esc(it.color || '#eef2f7')}" data-emoji="${esc(it.icon || '')}" aria-hidden="true"><img src="${esc(it.image || `intro/${it.id}.webp`)}" alt="" loading="lazy" decoding="async"></div>
      <div class="intro-tx">
        <h3>${esc(it.title)}${isNew ? ' <b class="intro-new">MỚI</b>' : ''}</h3>
        <p>${esc(it.text)}</p>
        <div class="intro-how">${how ? `<span class="intro-kbd">${COARSE ? icon('target', 12) : icon('keyboard', 12)}${esc(how)}</span>` : ''}
          ${canGo ? `<button type="button" class="intro-go" data-go="${esc(it.id)}">Đi tới ${icon('arrowRight', 13)}</button>` : ''}</div>
      </div></article>`;
  }

  /** Nơi tới được cho "go" (null nếu không có — vd. CEO không có nhân vật, chưa có chỗ ngồi). */
  target(go) {
    const qt = this.app.quickTravel, s = this.s; if (!qt || !s.player) return null;
    if (go === 'desk') return s.mySeat ? { desk: true } : null;
    if (go === 'karaoke') { const b = s.ktv?.spot; return b ? { name: 'phòng karaoke', f: b.f, x: b.x, z: b.z, r: 1.6 } : null; }
    if (go === 'board') { const b = s.board; b?.ensure(); return b?.stand ? { name: 'bảng thông báo', f: 0, x: b.stand.x, z: b.stand.z, r: 1.0 } : null; }
    if (go === 'meeting') { const d = s.meet?.door; return d ? { name: 'cửa phòng họp', f: d.f, x: d.x, z: d.z, r: 1.0 } : null; }
    if (go === 'projects') { const pj = s.projects; pj?.ensure(); return pj?.stand ? { name: 'bảng Dự án', f: pj.stand.f, x: pj.stand.x, z: pj.stand.z, r: 0.8 } : null; }
    if (go === 'wc') { const st = s.wc?.stalls?.[0]; return st ? { name: 'nhà vệ sinh', f: 0, x: st.out.x, z: st.out.z, r: 0.6 } : null; }
    if (go === 'billiards') { const t = s.bil?.table; return t ? { name: 'bàn bi-a', f: t.f, x: t.x, z: t.z, r: 2.2 } : null; }
    const want = String(go).toLowerCase();
    return (qt.flat || []).find(p => p.name.toLowerCase() === want) || (qt.flat || []).find(p => p.name.toLowerCase().includes(want)) || null;
  }
  go(it) {
    const t = it && this.target(it.go); if (!t) return;
    if (t.desk) this.app.quickTravel.goDesk(); else this.app.quickTravel.go(t);
  }

  close() {
    const el = this.el; if (!el) return;
    this.el = null;
    markSeen(this.data.version);
    window.removeEventListener('keydown', this._key, true);
    document.body.classList.remove('overlay-open');
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
    this._done?.();
  }
}
