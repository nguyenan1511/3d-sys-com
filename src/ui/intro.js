// Modal "Có gì ở văn phòng?": giới thiệu nhanh tính năng làm việc + giải trí, theo nhóm (Bắt đầu, Làm việc, Giải trí, Khám
// phá thêm). Mỗi mục: ô hình (emoji trên nền màu), tên, 1–2 câu, cách dùng theo thiết bị (máy tính: phím; điện thoại: nút)
// và nút "Đi tới" (dịch chuyển tới nơi đó). Nội dung nằm trong public/data/intro.json — thêm tính năng: tăng "version" và
// thêm mục có "new_in"; lần vào sau modal tự mở lại, mục mới hiện đầu tiên với nhãn MỚI.
// Tự mở: lần đầu vào văn phòng (sau khi chọn nhân vật, trước khi chị Mai dẫn đường) và khi có phiên bản nội dung mới.
// Mở lại bất cứ lúc nào: nút "Có gì ở đây?" (thanh dưới / Của tôi).
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
    await this.open({ since: seen });
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
