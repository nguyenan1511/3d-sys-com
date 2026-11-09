// Giao diện chat nội bộ + loa công ty.
// Chat: nút "Chat" mở ngăn bên phải: kênh Toàn công ty, kênh phòng ban của mình (CEO thấy mọi phòng), nhắn riêng (bấm tên
//   người trong danh sách online hoặc nút ✉ trên thẻ). Tin mới ở kênh khác hiện chấm đỏ; tin hiện thêm bong bóng trên đầu
//   người gửi trong cảnh 3D vài giây. Enter để gửi, Esc để đóng.
// Loa: nút loa hiện kênh đang phát; ai cũng tắt tiếng/chỉnh âm lượng trên máy mình; chỉ CEO và người được cấp quyền mới
//   bật/đổi kênh/tắt loa cho cả công ty. CEO cấp quyền trong cửa sổ loa.
import { api } from '../net/api.js';
import { esc } from '../session/ui.js';
import { icon } from './icons.js';
import { YoutubeMusic } from '../audio/youtube.js';
import { sound } from '../audio/notify.js';
import { notice } from './notices.js';

const fmtDur = sec => { sec = Math.max(0, Math.floor(sec || 0)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, x = sec % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`; };
const fmtTime = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export class Social {
  constructor(session) {
    this.s = session; this.rt = session.rt;
    this.channels = [{ id: 'all', name: 'Toàn công ty' }]; this.dms = []; this.cur = 'all'; this.msgs = new Map(); this.unread = new Map();
    this.musicState = { on: false }; this.canMusic = false; this.recent = [];
    this.music = new YoutubeMusic('ytSlot', { onChange: () => this.renderBar() }); // video hiện trên TV phòng giải trí (scene/tvVideo.js)
    this.bubbles = new Map(); // key -> { text, until }
    this.build();
    // âm thanh chỉ được phát sau thao tác đầu tiên của người dùng
    this.rt.on('hello', m => { this.canMusic = !!m.canMusic; if (m.music) this.applyMusic(m.music); this.loadChannels(); });
    this.rt.on('chat', m => this.onChat(m.msg));
    this.rt.on('music', m => this.applyMusic(m.state));
    this.rt.on('musicPerm', m => { this.canMusic = !!m.allow; this.renderBar(); this.refreshMusicPop(); this.s.toast(m.allow ? 'CEO đã cấp cho bạn quyền mở nhạc cho công ty 🎵' : 'CEO đã tắt quyền mở nhạc của bạn.'); });
  }

  // ---------- giao diện ----------
  build() {
    const root = document.getElementById('appRoot');
    const bar = document.createElement('div'); bar.className = 'social-bar';
    bar.innerHTML = `<button type="button" class="soc-btn" id="btnChat" title="Chat nội bộ (phím T)">${icon('chat', 17)}<span>Chat</span><i class="soc-dot" hidden></i></button>
      ${this.s.isAdmin ? `<button type="button" class="soc-btn" id="btnAttendance" title="Bảng chấm công: hôm nay / tháng / năm">${icon('clipboard', 17)}<span>Chấm công</span></button>` : ''}`;
    root.appendChild(bar); this.bar = bar;
    const panel = document.createElement('aside'); panel.className = 'chat-panel'; panel.id = 'chatPanel'; panel.hidden = true; panel.setAttribute('aria-label', 'Chat nội bộ');
    panel.innerHTML = `<header class="cp-head"><b>Chat nội bộ</b><button type="button" class="cp-x" aria-label="Đóng chat">✕</button></header>
      <div class="cp-body"><nav class="cp-chans" aria-label="Kênh chat"></nav>
        <section class="cp-main"><div class="cp-title"></div><ol class="cp-msgs" aria-live="polite"></ol>
          <form class="cp-form"><input class="cp-input" maxlength="500" autocomplete="off" placeholder="Nhập tin nhắn…" aria-label="Tin nhắn"><button type="submit" class="cp-send" aria-label="Gửi">${icon('send', 16)}</button></form></section></div>`;
    root.appendChild(panel); this.panel = panel;
    bar.querySelector('#btnChat').onclick = () => this.toggle();
    this.buildMusicBar(root);
    bar.querySelector('#btnAttendance')?.addEventListener('click', () => this.s.att?.openAdmin());
    panel.querySelector('.cp-x').onclick = () => this.toggle(false);
    const input = panel.querySelector('.cp-input');
    panel.querySelector('.cp-form').onsubmit = e => { e.preventDefault(); this.send(input.value); input.value = ''; };
    input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { this.toggle(false); } });
    window.addEventListener('keydown', e => {
      const t = document.activeElement; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey && !document.querySelector('.modal-back')) { e.preventDefault(); this.toggle(true); }
    });
  }
  toggle(open = this.panel.hidden) {
    this.panel.hidden = !open;
    this.bar.querySelector('#btnChat').classList.toggle('on', open);
    if (open) { this.open(this.cur); setTimeout(() => this.panel.querySelector('.cp-input').focus(), 30); }
    else document.querySelector('#c3')?.focus?.();
  }
  async loadChannels() {
    const r = await api('GET', '/api/chat/channels'); if (!r.ok) return;
    this.me = r.me; this.channels = r.channels; this.dms = r.dms || [];
    this.renderChannels();
    if (!this.panel.hidden) this.open(this.cur);
  }
  dmName(ch) {
    const [a, b] = ch.slice(3).split('|'), other = a === this.me ? b : a;
    const on = this.s.online.find(o => o.key === other); if (on) return on.display;
    for (const m of this.msgs.get(ch) || []) if (m.from === other) return m.name;
    return other.replace(/^employee:/, '').replace(/^admin:/, 'CEO ');
  }
  renderChannels() {
    const nav = this.panel.querySelector('.cp-chans');
    const item = (id, name, color) => `<button type="button" class="cp-ch${id === this.cur ? ' on' : ''}" data-ch="${esc(id)}">${id.startsWith('dm:') ? icon('user', 13) : `<i style="background:${color || '#2b2d42'}"></i>`}<span>${esc(name)}</span>${this.unread.get(id) ? `<b class="cp-un">${this.unread.get(id)}</b>` : ''}</button>`;
    nav.innerHTML = `<div class="cp-sec">Kênh</div>${this.channels.map(c => item(c.id, c.id === 'all' ? '# Toàn công ty' : c.name.replace(/^(Phòng|Team) /, '# '), c.color)).join('')}
      <div class="cp-sec">Nhắn riêng</div>${this.dms.map(d => item(d, this.dmName(d))).join('') || '<p class="cp-hint">Bấm tên một người trong danh sách online để nhắn riêng.</p>'}`;
    nav.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => this.open(b.dataset.ch));
    const any = [...this.unread.values()].some(n => n > 0); this.bar.querySelector('.soc-dot').hidden = !any;
  }
  async open(ch) {
    this.cur = ch; this.unread.delete(ch); this.renderChannels();
    const title = ch === 'all' ? 'Toàn công ty' : ch.startsWith('dm:') ? 'Nhắn riêng với ' + this.dmName(ch) : (this.channels.find(c => c.id === ch)?.name || ch);
    this.panel.querySelector('.cp-title').textContent = title;
    if (!this.msgs.has(ch)) {
      const r = await api('GET', `/api/chat/${encodeURIComponent(ch)}`);
      this.msgs.set(ch, r.ok ? r.messages : []);
    }
    this.renderMsgs();
  }
  /** Mở nhắn riêng với một người (khoá phiên). */
  dm(key) {
    if (!this.me || key === this.me) return;
    const ch = 'dm:' + [this.me, key].sort().join('|');
    if (!this.dms.includes(ch)) this.dms.unshift(ch);
    this.toggle(true); this.open(ch);
  }
  renderMsgs() {
    const ol = this.panel.querySelector('.cp-msgs'), list = this.msgs.get(this.cur) || [];
    ol.innerHTML = list.length ? list.map(m => `<li class="${m.from === this.me ? 'me' : ''}"><div class="cp-meta"><b>${esc(m.name)}</b><time>${fmtTime(m.ts)}</time></div><p>${esc(m.body)}</p></li>`).join('')
      : '<li class="cp-empty">Chưa có tin nhắn nào. Gửi lời chào đầu tiên nhé 👋</li>';
    ol.scrollTop = ol.scrollHeight;
  }
  send(text) {
    text = String(text || '').trim(); if (!text) return;
    if (this.rt.ws?.readyState !== 1) { this.s.toast('Mất kết nối, chưa gửi được tin nhắn.', true); return; }
    const msg = { t: 'chat', body: text };
    if (this.cur.startsWith('dm:')) { const [a, b] = this.cur.slice(3).split('|'); msg.to = a === this.me ? b : a; } else msg.channel = this.cur;
    this.rt.ws.send(JSON.stringify(msg));
  }
  onChat(m) {
    if (!m) return;
    if (!this.msgs.has(m.channel)) { if (m.channel !== this.cur) this.msgs.set(m.channel, []); }
    const list = this.msgs.get(m.channel); if (list && !list.some(x => x.id === m.id)) list.push(m);
    if (m.channel.startsWith('dm:') && !this.dms.includes(m.channel)) this.dms.unshift(m.channel);
    const visible = !this.panel.hidden && m.channel === this.cur;
    if (visible) this.renderMsgs(); else if (m.from !== this.me) this.unread.set(m.channel, (this.unread.get(m.channel) || 0) + 1);
    this.renderChannels();
    // bong bóng trên đầu người gửi (kênh chung + kênh phòng ban; tin nhắn riêng không hiện công khai)
    if (!m.channel.startsWith('dm:')) this.bubbles.set(m.from === this.me ? 'me' : m.from, { text: m.body.length > 60 ? m.body.slice(0, 58) + '…' : m.body, until: performance.now() + 6000 });
    // tin nhắn mới của người khác: âm báo + thông báo góc phải (bấm để mở đúng kênh); đang mở đúng kênh thì chỉ kêu khi tab bị ẩn
    if (m.from !== this.me && (!visible || document.hidden)) {
      sound.play('message');
      if (!visible) {
        const where = m.channel.startsWith('dm:') ? 'nhắn riêng cho bạn' : m.channel === 'all' ? 'trong # Toàn công ty' : `trong # ${(this.channels.find(c => c.id === m.channel)?.name || '').replace(/^(Phòng|Team) /, '')}`;
        notice({ title: `${m.name} ${where}`, text: m.body.slice(0, 120), icon: 'chat', tone: 'msg', onClick: () => { if (this.panel.hidden) this.toggle(true); this.open(m.channel); } });
      }
    }
  }

  // ---------- loa: nhạc YouTube cho cả công ty ----------
  get canControl() { return this.canMusic || this.s.isAdmin; }
  async call(path, body) {
    const r = await api('POST', path, body);
    if (!r.ok) this.s.toast(r.error || 'Không thực hiện được.', true);
    else if (r.state) this.applyMusic(r.state);
    return r;
  }
  applyMusic(st) {
    if (!st) return;
    const changed = st.videoId !== this.musicState.videoId || st.on !== this.musicState.on;
    this.musicState = st; this.music.set(st);
    this.s.app.onMusic?.(st);
    this.renderBar(); this.refreshMusicPop();
    if (changed && st.on) this.loadRecent();
  }
  async loadRecent() { const r = await api('GET', '/api/v1/music'); if (r.ok) { this.recent = r.recent || []; this.refreshMusicPop(); } }

  /** Thanh điều khiển (giữa phía trên) khi đang phát: ảnh bìa, tên bài, phát/tạm dừng, tua, tắt (người có quyền); âm lượng riêng. */
  buildMusicBar(root) {
    const el = this.mbar = document.createElement('div'); el.className = 'music-bar'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Nhạc công ty');
    el.innerHTML = `<img class="mb-thumb" alt="" width="64" height="36"><span class="mb-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><div class="mb-main"><div class="mb-title"><b></b><small></small></div>
      <div class="mb-row"><button type="button" class="mb-btn mb-play" aria-label="Phát / tạm dừng"></button><span class="mb-time">0:00</span>
      <input type="range" class="mb-seek" min="0" max="100" step="1" value="0" aria-label="Tua"><span class="mb-dur">0:00</span>
      <button type="button" class="mb-btn mb-stop" aria-label="Tắt nhạc cho cả công ty" title="Tắt nhạc cho cả công ty">${icon('stop', 13)}</button>
      <button type="button" class="mb-btn mb-mute" aria-label="Tắt tiếng trên máy bạn"></button><input type="range" class="mb-vol" min="0" max="100" step="1" aria-label="Âm lượng trên máy bạn"></div>
      <button type="button" class="mb-unblock" hidden>${icon('volume', 14)} Bấm để nghe nhạc cùng mọi người</button><p class="mb-err" hidden></p></div>
      <button type="button" class="mb-btn mb-toggle" aria-expanded="true"></button>`;
    root.appendChild(el);
    const q = c => el.querySelector(c);
    q('.mb-play').onclick = () => this.call('/api/v1/music/control', { action: this.musicState.paused ? 'resume' : 'pause' });
    q('.mb-stop').onclick = () => this.call('/api/v1/music/control', { action: 'stop' });
    const seek = q('.mb-seek');
    seek.oninput = () => { this.seeking = true; q('.mb-time').textContent = fmtDur(+seek.value); };
    seek.onchange = () => { this.seeking = false; this.call('/api/v1/music/control', { action: 'seek', position: Math.round(+seek.value) }); };
    q('.mb-mute').onclick = () => this.music.setMuted(!this.music.muted);
    const vol = q('.mb-vol'); vol.value = this.music.vol; vol.oninput = () => { this.music.setVolume(+vol.value); if (this.music.muted && +vol.value > 0) this.music.setMuted(false); };
    q('.mb-unblock').onclick = () => this.music.unblock();
    // thu gọn / mở thanh nhạc (nhớ lựa chọn): thu gọn chỉ còn ảnh bìa + sóng nhạc; bấm vào viên thu gọn để mở lại
    const setCollapsed = c => {
      el.classList.toggle('collapsed', c); localStorage.setItem('sysone.musicbar', c ? '0' : '1');
      const t = q('.mb-toggle'); t.innerHTML = icon(c ? 'chevDown' : 'chevUp', 15); t.title = c ? 'Mở thanh nhạc' : 'Thu gọn thanh nhạc'; t.setAttribute('aria-label', t.title); t.setAttribute('aria-expanded', String(!c));
    };
    { const v = localStorage.getItem('sysone.musicbar'); setCollapsed(v === '0' || (v === null && matchMedia('(max-width: 760px)').matches)); } // (điện thoại: mặc định thu gọn)
    q('.mb-toggle').onclick = e => { e.stopPropagation(); setCollapsed(!el.classList.contains('collapsed')); };
    el.addEventListener('click', e => { if (el.classList.contains('collapsed') && !e.target.closest('.mb-toggle')) setCollapsed(false); });
    setInterval(() => this.tickBar(), 500);
  }
  renderBar() {
    const el = this.mbar; if (!el) return;
    const st = this.musicState, on = !!st.on, can = this.canControl;
    el.classList.toggle('show', on);
    if (!on) return;
    const q = c => el.querySelector(c);
    const thumb = `https://i.ytimg.com/vi/${st.videoId}/mqdefault.jpg`; if (q('.mb-thumb').getAttribute('src') !== thumb) q('.mb-thumb').src = thumb;
    q('.mb-title b').textContent = st.title || 'Video YouTube'; q('.mb-title small').textContent = st.by ? `mở bởi ${st.by}` : '';
    q('.mb-play').innerHTML = icon(st.paused ? 'play' : 'pause', 14); q('.mb-play').title = st.paused ? 'Phát tiếp' : 'Tạm dừng';
    for (const c of ['.mb-play', '.mb-stop', '.mb-seek']) { q(c).disabled = !can; q(c).title = can ? q(c).title : 'Chỉ người được CEO cấp quyền mới điều khiển'; }
    q('.mb-mute').innerHTML = icon(this.music.muted || this.music.vol === 0 ? 'mute' : 'volume', 15); q('.mb-mute').title = this.music.muted ? 'Bật tiếng trên máy bạn' : 'Tắt tiếng trên máy bạn';
    q('.mb-unblock').hidden = !this.music.blocked;
    el.classList.toggle('playing', !st.paused && !this.music.blocked);
    q('.mb-err').hidden = !this.music.error; q('.mb-err').textContent = this.music.error || '';
    this.tickBar();
  }
  tickBar() {
    if (!this.musicState.on || !this.mbar) return;
    const q = c => this.mbar.querySelector(c), dur = this.music.duration(), cur = Math.min(this.music.current(), dur || Infinity);
    const seek = q('.mb-seek'); if (dur) seek.max = String(Math.floor(dur));
    if (!this.seeking) { seek.value = String(Math.floor(cur)); q('.mb-time').textContent = fmtDur(cur); }
    q('.mb-dur').textContent = dur ? fmtDur(dur) : '–:––';
    seek.style.setProperty('--p', dur ? `${(cur / dur) * 100}%` : '0%');
  }

  /** Bảng của góc âm nhạc (đứng trước máy hát bấm E): dán link YouTube, đang phát, bài gần đây; CEO cấp quyền. */
  async openMusic() {
    if (document.querySelector('.music-pop')) return;
    const isAdmin = this.s.isAdmin;
    const pop = this.mpop = document.createElement('div'); pop.className = 'speaker-pop music-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Góc âm nhạc');
    pop.innerHTML = `<header><b>${icon('music', 16)} Góc âm nhạc</b><button type="button" class="sp-x" aria-label="Đóng">✕</button></header>
      <p class="sp-hint">Dán link YouTube: cả công ty cùng nghe, video chiếu trên TV phòng giải trí.</p>
      <form class="mp-form"><input class="mp-url" type="url" inputmode="url" autocomplete="off" placeholder="https://www.youtube.com/watch?v=…" aria-label="Link YouTube"><button type="submit" class="mp-go">Phát</button></form>
      <p class="sp-note mp-deny">Chỉ CEO và người được CEO cấp quyền mới mở nhạc. Bạn vẫn chỉnh âm lượng trên máy mình ở thanh nhạc phía trên.</p>
      <div class="mp-now"></div>
      <div class="mp-recent"><div class="sp-sec">Phát gần đây</div><ul></ul></div>
      ${isAdmin ? '<div class="sp-perm"><div class="sp-sec">Cấp quyền mở nhạc</div><ul class="sp-list"><li class="sp-load">Đang tải…</li></ul></div>' : ''}`;
    document.getElementById('appRoot').appendChild(pop);
    const close = () => { window.removeEventListener('keydown', esc1, true); pop.classList.add('closing'); setTimeout(() => pop.remove(), 180); this.mpop = null; };
    const esc1 = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', esc1, true);
    pop.querySelector('.sp-x').onclick = close;
    const input = pop.querySelector('.mp-url');
    input.addEventListener('keydown', e => e.stopPropagation());
    pop.querySelector('.mp-form').onsubmit = async e => {
      e.preventDefault(); const url = input.value.trim(); if (!url) { input.focus(); return; }
      const btn = pop.querySelector('.mp-go'); btn.disabled = true; btn.textContent = 'Đang mở…';
      const r = await this.call('/api/v1/music/play', { url });
      btn.disabled = false; btn.textContent = 'Phát'; if (r.ok) input.value = '';
    };
    this.refreshMusicPop();
    this.loadRecent();
    if (this.canControl) setTimeout(() => input.focus(), 60);
    if (isAdmin) {
      const [emps, perm] = await Promise.all([api('GET', '/api/v1/admin/employees'), api('GET', '/api/v1/admin/music')]);
      const ul = pop.querySelector('.sp-list'); if (!ul) return;
      const allowed = new Set(perm.ok ? perm.allowed : []);
      const list = (emps.ok ? emps.employees : []).filter(e => e.status === 'active');
      ul.innerHTML = list.length ? list.map(e => `<li><label><input type="checkbox" data-code="${esc(e.code)}" ${allowed.has(e.code) ? 'checked' : ''}> ${esc(e.display)}${e.department ? `<small>${esc(e.department)}</small>` : ''}</label></li>`).join('') : '<li class="sp-load">Chưa có nhân viên nào.</li>';
      ul.querySelectorAll('input[data-code]').forEach(c => c.onchange = async () => {
        const r = await api('POST', `/api/v1/admin/music/${encodeURIComponent(c.dataset.code)}`, { allow: c.checked });
        if (!r.ok) { c.checked = !c.checked; this.s.toast(r.error || 'Không cập nhật được quyền.', true); }
      });
    }
  }
  /** Cập nhật tại chỗ phần động của bảng góc âm nhạc (không dựng lại cả bảng → không giật). */
  refreshMusicPop() {
    const pop = this.mpop; if (!pop || !pop.isConnected) return;
    const st = this.musicState, can = this.canControl;
    pop.querySelector('.mp-form').hidden = !can; pop.querySelector('.mp-deny').hidden = can;
    pop.querySelector('.mp-now').innerHTML = st.on
      ? `<div class="mp-card"><img src="https://i.ytimg.com/vi/${esc(st.videoId)}/mqdefault.jpg" alt="" width="96" height="54"><div><b>${esc(st.title || 'Video YouTube')}</b><small>${st.paused ? 'Đang tạm dừng' : 'Đang phát'}${st.by ? ` · mở bởi ${esc(st.by)}` : ''}</small></div></div>`
      : '<p class="sp-now">Loa đang tắt.</p>';
    const ul = pop.querySelector('.mp-recent ul'), list = this.recent.filter(x => !(st.on && x.videoId === st.videoId)).slice(0, 5);
    pop.querySelector('.mp-recent').hidden = !list.length;
    ul.innerHTML = list.map(x => `<li><button type="button" data-v="${esc(x.videoId)}" ${can ? '' : 'disabled'}><img src="https://i.ytimg.com/vi/${esc(x.videoId)}/default.jpg" alt="" width="48" height="36"><span>${esc(x.title || x.videoId)}</span></button></li>`).join('');
    ul.querySelectorAll('[data-v]').forEach(b => b.onclick = () => this.call('/api/v1/music/play', { url: b.dataset.v }));
  }
  /** Bong bóng chat đang hiện: key ('me' hoặc khoá người khác) -> nội dung. */
  bubbleOf(key) { const b = this.bubbles.get(key); if (!b) return null; if (performance.now() > b.until) { this.bubbles.delete(key); return null; } return b.text; }
}
