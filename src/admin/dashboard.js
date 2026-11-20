// Bảng quản trị Admin — cùng khung dashboard với "Dự án" / "Phòng họp" (.sx.dash): thanh bên (mục quản trị + số liệu nhanh,
// tình trạng server) + vùng chính (đầu trang có nút theo mục, nội dung).
//  • Tổng quan: thẻ số (online, chấm công, chỗ trống, chưa có chỗ — bấm để mở mục), biểu đồ online 6 giờ, chấm công hôm nay,
//    chỗ ngồi theo tầng, hoạt động gần đây, ai đang ở văn phòng, tình trạng server / MongoDB.
//  • Nhân viên: tìm, lọc tầng / trạng thái (có số đếm), sửa, nhân vật, gán / đổi chỗ, theo dõi, buộc đăng xuất, xoá, CSV.
//  • Sơ đồ chỗ ngồi: từng tầng, vị trí người online thời gian thực; bấm bàn → gán / đổi / giải phóng / khoá / dụng cụ.
//  • Chấm công: hôm nay (giờ vào / ra, đi muộn, chưa chấm) và tổng hợp tháng; "Lịch chi tiết" mở bảng công (src/ui/timesheet.js).
//  • Nhật ký thao tác (tìm, lọc nhóm) · Sao lưu database.
// Mọi thao tác gọi API; server kiểm tra quyền và ghi audit log. Vẽ lại chỉ khi nội dung đổi (put) — không giật.
import { characterDef } from '../agents/glbCharacters.js';
import { api } from '../net/api.js';
import { toast, modal, confirmDanger, esc } from '../session/ui.js';
import { footprint } from '../model/layoutModel.js';
import { defaultEquipment } from '../shared/equipment.js';
import { parseLogin } from '../shared/identity.js';
import { openAvatarEditor } from '../session/avatarEditor.js';
import { openAdminTimesheet } from '../ui/timesheet.js';
import { icon } from '../ui/icons.js';
import { overlayOn, overlayOff } from '../ui/overlay.js';
import { avatar } from '../ui/meetPanel.js';

const charName = id => characterDef(id)?.name || id || 'mặc định';
const ACTION_LABEL = { 'login.new': 'Đăng ký mới', 'look.create': 'Tạo nhân vật', 'look.update': 'Đổi nhân vật', 'attendance.checkin': 'Chấm công vào', 'attendance.auto': 'Tự chấm công (online)', 'tiktok.add': 'Thêm video TikTok', 'tiktok.delete': 'Xoá video TikTok', 'attendance.checkout': 'Chấm công ra', 'login.return': 'Vào lại', 'seat.claim': 'Nhận chỗ', 'seat.move': 'Tự đổi chỗ', 'seat.equipment': 'Sửa dụng cụ', 'seat.sit': 'Ngồi', 'admin.login': 'Admin đăng nhập', 'admin.login.fail': 'Admin đăng nhập sai', 'admin.seat.assign': 'Gán chỗ', 'admin.seat.release': 'Giải phóng chỗ', 'admin.seat.lock': 'Khóa chỗ', 'admin.seat.unlock': 'Mở khóa chỗ', 'admin.employee.create': 'Thêm nhân viên', 'admin.employee.update': 'Sửa nhân viên', 'admin.employee.delete': 'Xóa nhân viên', 'admin.employee.logout': 'Buộc đăng xuất', 'admin.csv.import': 'Nhập CSV', 'admin.csv.export': 'Xuất CSV', 'admin.backup': 'Sao lưu database', 'admin.backup.download': 'Tải bản sao lưu', 'admin.password.change': 'Đổi mật khẩu', logout: 'Đăng xuất', 'admin.seed': 'Tạo tài khoản Admin', 'layout.desk_removed': 'Bàn bị bỏ khỏi layout', 'board.post': 'Đăng tin bảng thông báo', 'board.permission.grant': 'Cấp quyền đăng tin', 'board.permission.revoke': 'Thu quyền đăng tin', 'board.edit': 'Sửa tin bảng thông báo', 'board.delete': 'Gỡ tin bảng thông báo', 'board.image': 'Đổi ảnh tin', 'meeting.book': 'Đặt phòng họp', 'meeting.edit': 'Sửa lịch họp', 'meeting.cancel': 'Huỷ lịch họp', 'meeting.end': 'Kết thúc họp sớm', 'meeting.delete': 'Xoá cuộc họp & dữ liệu', 'meeting.file.add': 'Tải tài liệu họp', 'meeting.file.delete': 'Xoá tài liệu họp', 'project.create': 'Tạo dự án', 'project.edit': 'Sửa dự án', 'project.archive': 'Lưu trữ dự án', 'project.restore': 'Khôi phục dự án', 'project.delete': 'Xoá dự án', 'project.members.add': 'Thêm người vào dự án', 'project.members.remove': 'Xoá người khỏi dự án', 'project.leave': 'Rời dự án', 'project.role': 'Đổi vai trò trong dự án', 'project.file.add': 'Tải tài liệu dự án', 'project.file.delete': 'Xoá tài liệu dự án', 'project.note.add': 'Thêm ghi chú dự án', 'project.note.delete': 'Xoá ghi chú dự án', 'project.logo': 'Đổi logo dự án', 'project.logo.delete': 'Gỡ logo dự án', 'admin.files.prune': 'Dọn file thừa', 'admin.files.delete': 'Admin xoá file', 'tiktok.channels': 'Đổi kênh TikTok' };
/** Nhóm thao tác trong nhật ký (lọc nhanh). */
const AUDIT_GROUPS = [['all', 'Tất cả'], ['emp', 'Nhân viên'], ['seat', 'Chỗ ngồi'], ['login', 'Đăng nhập'], ['att', 'Chấm công'], ['work', 'Họp · Dự án'], ['other', 'Khác']];
const groupOf = a => /^(admin\.employee|admin\.csv|login\.new|look\.)/.test(a) ? 'emp' : /^(seat\.|admin\.seat|layout\.)/.test(a) ? 'seat'
  : /^(login|logout|admin\.login|admin\.password|admin\.seed)/.test(a) ? 'login' : /^attendance\./.test(a) ? 'att' : /^(meeting|project)\./.test(a) ? 'work' : 'other';
const TABS = [['home', 'grid', 'Tổng quan'], ['emp', 'users', 'Nhân viên'], ['map', 'map', 'Sơ đồ chỗ ngồi'], ['att', 'clock', 'Chấm công'], ['audit', 'history', 'Nhật ký'], ['backup', 'db', 'Sao lưu']];
const TITLE = { home: ['Tổng quan', 'Tình hình văn phòng hôm nay'], emp: ['Nhân viên', 'Tài khoản, phòng ban, chỗ ngồi và nhân vật'], map: ['Sơ đồ chỗ ngồi', 'Bấm vào bàn để gán, đổi, giải phóng hoặc khoá chỗ'], att: ['Chấm công', 'Giờ vào / ra hôm nay và tổng hợp theo tháng'], audit: ['Nhật ký thao tác', 'Mọi thao tác quan trọng đều được ghi lại'], backup: ['Sao lưu dữ liệu', 'Bản sao database tự động mỗi đêm'] };
// sơ đồ: bảng màu sáng cùng kiểu giấy của modal
const C = { free: '#06a77d', owned: '#8a8ca3', online: '#118ab2', locked: '#e0455f', pin: '#ff7a45' };

const fmt = ts => ts ? new Date(ts).toLocaleString('vi-VN') : '—';
const hm = ts => ts ? new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
const ago = t => { if (!t) return '—'; const d = (Date.now() - t) / 1000; return d < 60 ? 'vừa xong' : d < 3600 ? `${Math.floor(d / 60)} phút trước` : d < 86400 ? `${Math.floor(d / 3600)} giờ trước` : d < 30 * 86400 ? `${Math.floor(d / 86400)} ngày trước` : new Date(t).toLocaleDateString('vi-VN'); };
const uptime = s => s < 3600 ? `${Math.floor(s / 60)} phút` : s < 86400 ? `${Math.floor(s / 3600)} giờ ${Math.floor(s % 3600 / 60)} phút` : `${Math.floor(s / 86400)} ngày ${Math.floor(s % 86400 / 3600)} giờ`;
const kb = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const ymNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(Date.now()).slice(0, 7);
const ymShift = (ym, k) => { const [y, m] = ym.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const dayLabel = day => { const [y, m, d] = day.split('-'); return `${+d}/${+m}/${y}`; };
const bar = parts => `<div class="adm-bar">${parts.map(([n, c]) => n > 0 ? `<i style="flex:${n};background:${c}"></i>` : '').join('')}</div>`;
const legend = rows => `<ul class="adm-leg">${rows.map(([c, l, v]) => `<li><i style="background:${c}"></i>${l}<b>${v}</b></li>`).join('')}</ul>`;
const empty = (ic, text) => `<p class="ov-empty">${icon(ic, 15)} ${text}</p>`;

export class Dashboard {
  constructor(app, session) {
    this.app = app; this.session = session;
    this.tab = 'home'; this.floor = app.model.floors[0]?.id ?? 0; this.employees = []; this.q = ''; this.ff = 'all'; this.sf = 'all';
    this.aq = ''; this.ag = 'all'; this.attView = 'today'; this.ym = ymNow(); this.stats = null;
    const el = this.el = document.createElement('div');
    el.id = 'dash'; el.className = 'sx-back'; el.hidden = true;
    el.innerHTML = `<div class="sx adm dash" role="dialog" aria-modal="true" aria-labelledby="admTitle">
      <aside class="ds-side" aria-label="Mục quản trị">
        <div class="ds-head"><span class="ds-logo">${icon('clipboard', 16)}</span><b>Quản trị</b><small class="adm-org">SYSONE</small></div>
        <nav class="ds-nav" role="tablist" aria-orientation="vertical">${TABS.map(([k, ic, n]) => `<button type="button" role="tab" class="ds-item" data-tab="${k}">${icon(ic, 15)}<span>${n}</span><em class="ds-n" hidden></em></button>`).join('')}</nav>
        <div class="adm-sys"></div>
      </aside>
      <section class="ds-main"><header class="sx-h adm-h"></header>
        <nav class="sx-tabs adm-ptabs" role="tablist" aria-label="Mục quản trị">${TABS.map(([k, ic, n]) => `<button type="button" role="tab" data-tab="${k}">${icon(ic, 14)} <span>${n}</span></button>`).join('')}</nav>
        <div class="sx-body adm-body" tabindex="-1"></div></section></div>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      if (e.target === el) return this.toggle(false);
      const t = e.target.closest('[data-tab]'); if (t && !t.closest('.adm-body')) return this.show(t.dataset.tab);
      const g = e.target.closest('[data-go]'); if (g) { if (g.dataset.fl) this.floor = +g.dataset.fl; if (g.dataset.ff) this.ff = g.dataset.ff; if (g.dataset.sf) this.sf = g.dataset.sf; return this.show(g.dataset.go); }
      const h = e.target.closest('[data-h]'); if (h) this.headAct(h.dataset.h, h);
    });
    this._key = e => {
      if (el.hidden || document.querySelector('.modal-back, .ts-pop')) return;
      if (e.key === 'Escape') { e.preventDefault(); this.toggle(false); }
      if (!el.contains(e.target)) e.stopPropagation();   // (phím không lọt xuống điều khiển nhân vật 3D; ô nhập trong bảng vẫn nhận)
    };
    window.addEventListener('keydown', this._key, true);
    window.addEventListener('resize', () => { if (!el.hidden && this.tab === 'map') { this._svg = null; this.drawMap(); } });
    session.onSeats(() => { if (!el.hidden) this.live(); });
    this._t = setInterval(() => { if (el.hidden) return; if (this.tab === 'map') this.drawMap(); else if (this.tab === 'emp') this.renderRows(); else if (this.tab === 'home') this.paintHome(); }, 1000);
    this._th = setInterval(() => { if (!el.hidden && this.tab === 'home') this.loadHome(); }, 15000);
  }
  get body() { return this.el.querySelector('.adm-body'); }
  /** Ghi HTML chỉ khi khác lần trước (không thay DOM vô ích → không giật, không mất chỗ cuộn / ô đang gõ). */
  put(el, html) { if (!el || el._h === html) return false; el._h = html; el.innerHTML = html; return true; }
  enter() { const b = this.body; b.classList.remove('enter'); void b.offsetWidth; b.classList.add('enter'); }

  async toggle(force) {
    const show = force ?? !this.open;
    if (show === !!this.open) { if (show) await this.refresh(); return; }
    this.open = show; clearTimeout(this._hide);
    if (show) {
      this.el.hidden = false; overlayOn();
      requestAnimationFrame(() => { if (this.open) this.el.classList.add('show'); });
      this.show(this.tab);
      await this.refresh();
      if (this.tab !== 'home') this.loadHome();   // (số liệu thanh bên: server, đi muộn)
    } else {
      this.el.classList.remove('show'); overlayOff();
      this._hide = setTimeout(() => { this.el.hidden = true; }, 200);   // (mờ dần rồi mới ẩn)
    }
  }
  async refresh() {
    if (this.el.hidden) return;
    // nhiều lần làm mới chồng nhau (online, đổi nhân vật…): chỉ lấy kết quả của lần gọi sau cùng
    const seq = this._seq = (this._seq || 0) + 1;
    const r = await api('GET', '/api/admin/employees');
    if (seq !== this._seq) return;
    if (!r.ok) { toast(r.error, true); return; }
    this.employees = this.app.real ? r.employees.map(e => ({ ...e, seat: e.seatReal })) : r.employees; // (Real SYS: chỗ theo mặt bằng thật)
    this.live();
  }
  /** Dữ liệu đổi (nhân viên, chỗ ngồi, online): cập nhật phần đang xem, không vẽ lại cả màn. */
  live() {
    this.renderSide();
    if (this.tab === 'emp') this.renderRows();
    else if (this.tab === 'map') { this.paintMapHead(); this.drawMap(); }
    else if (this.tab === 'home') this.paintHome();
  }
  show(tab) {
    this.tab = tab;
    this.el.querySelectorAll('[data-tab]').forEach(b => { if (b.closest('.adm-body')) return; const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    this.body._h = null; this.body.scrollTop = 0; this.enter();
    this.renderHead(); this.renderSide();
    ({ home: () => this.renderHome(), emp: () => this.renderEmployees(), map: () => this.renderMap(), att: () => this.renderAtt(), audit: () => this.renderAudit(), backup: () => this.renderBackups() })[tab]();
  }

  // ---------- khung ----------
  renderHead() {
    const [t, sub] = TITLE[this.tab], x = `<button type="button" id="dashClose" class="sx-x" data-h="close" aria-label="Đóng bảng quản trị">${icon('close', 16)}</button>`;
    const acts = {
      home: `<button type="button" class="sx-ghost" data-h="reload">${icon('reset', 15)} <span>Làm mới</span></button>`,
      emp: `<a class="sx-ghost" href="/api/admin/export.csv" download title="Tải danh sách nhân viên + chỗ ngồi">${icon('download', 15)} <span>Xuất CSV</span></a>
        <label class="sx-ghost adm-file" title="Cập nhật hàng loạt từ file CSV">${icon('upload', 15)} <span>Nhập CSV</span><input type="file" id="dCsv" accept=".csv,text/csv,text/plain"></label>
        <button type="button" id="dAdd" class="sx-primary" data-h="add">${icon('plus', 15)} <span>Thêm nhân viên</span></button>`,
      map: '',
      att: `<button type="button" class="sx-ghost" data-h="sheet" title="Lịch từng ngày của mỗi người, bảng năm">${icon('calendar', 15)} <span>Lịch chi tiết</span></button>`,
      audit: `<button type="button" class="sx-ghost" data-h="reload">${icon('reset', 15)} <span>Làm mới</span></button>`,
      backup: `<button type="button" id="bkNow" class="sx-primary" data-h="backup" ${this.bk && !this.bk.enabled ? 'disabled' : ''}>${icon('db', 15)} <span>Sao lưu ngay</span></button>`
    }[this.tab];
    const h = this.el.querySelector('.adm-h');
    this.put(h, `<div><h2 id="admTitle">${t}</h2><p>${sub}</p></div><div class="adm-hacts">${acts}</div>${x}`);
    const csv = h.querySelector('#dCsv'); if (csv) csv.onchange = e => this.importCsv(e);
  }
  headAct(k, btn) {
    if (k === 'close') this.toggle(false);
    else if (k === 'add') this.addEmployee();
    else if (k === 'reload') this.tab === 'home' ? this.loadHome() : this.renderAudit(true);
    else if (k === 'sheet') { this.toggle(false); openAdminTimesheet(); }
    else if (k === 'backup') this.backupNow(btn);
  }
  /** Thanh bên: số nhanh cạnh mỗi mục + tình trạng server. */
  renderSide() {
    const active = this.employees.filter(e => e.status !== 'disabled'), s = this.seatStats();
    const nums = { emp: [active.length, ''], map: [s.free, 'chỗ trống'], att: this.att ? [this.att.late, 'đi muộn hôm nay', this.att.late ? 'warn' : ''] : null };
    for (const b of this.el.querySelectorAll('.ds-nav [data-tab]')) {
      const n = b.querySelector('.ds-n'), v = nums[b.dataset.tab];
      n.hidden = !v || !v[0]; n.textContent = v?.[0] || ''; n.title = v?.[1] || ''; n.className = `ds-n${v?.[2] ? ' ' + v[2] : ''}`;
    }
    const st = this.stats, m = st?.mongo || {};
    const db = !st ? '' : m.enabled && m.error ? '<i class="bad"></i>MongoDB lỗi — dữ liệu mới chưa được lưu' : m.enabled && m.pending > 50 ? `<i class="warn"></i>MongoDB chậm · ${m.pending} thay đổi chờ lưu` : m.enabled ? `<i class="ok"></i>MongoDB · lưu ${ago(m.lastSaveAt || m.restoredAt)}` : '<i class="warn"></i>Chưa bật MongoDB';
    const fu = st?.files, full = fu && fu.used / fu.max;
    this.put(this.el.querySelector('.adm-sys'), st ? `<p>${db}</p>
      <p><i class="${st.waiting ? 'warn' : 'ok'}"></i>Online ${st.now}/${st.maxOnline}${st.waiting ? ` · ${st.waiting} người đang chờ` : ''}</p>
      ${fu ? `<p><i class="${full > 0.9 ? 'bad' : full > 0.75 ? 'warn' : 'ok'}"></i>Dung lượng file ${Math.round(fu.used / 1048576)}/${Math.round(fu.max / 1048576)} MB</p>` : ''}
      <p><i class="ok"></i>Server chạy ${uptime(st.uptimeSec + Math.round((Date.now() - st._at) / 1000))}</p><p class="adm-ver">Phiên bản ${esc(st.version)}</p>` : '');
  }
  isOnline(code) { return this.session.online.some(o => o.code === code); }
  /** "emp:1151" → "1151-An"; "admin:x" → "Admin". */
  actorName(k) { const s = String(k || ''), m = /^(?:emp|employee):(.+)$/.exec(s); if (m) { const e = this.employees.find(x => x.code === m[1]); return e ? e.display : m[1]; } return s.startsWith('admin') ? 'Admin' : s; }
  /** Đếm chỗ (một tầng hoặc cả toà): khoá tính riêng (chỗ có chủ mà bị khoá vẫn là "khoá"), còn lại có chủ / trống. */
  seatStats(floor = null) {
    const out = { owned: 0, free: 0, locked: 0, online: 0, total: 0 };
    for (const d of this.app.model.desks) {
      if (floor !== null && d.floor !== floor) continue;
      const s = this.session.seats.get(d.id); out.total++;
      if (s?.locked) out.locked++; else if (s?.owner) { out.owned++; if (this.isOnline(s.owner.code)) out.online++; } else out.free++;
    }
    return out;
  }
  floorName(id) { return this.app.model.floorById.get(id)?.name || ''; }

  // ---------- tổng quan ----------
  renderHome() {
    this.put(this.body, `<div class="adm-home"><div class="ov-stats adm-stats"></div><div class="adm-grid">
      <section class="ov-card adm-wide"><header><h4>${icon('users', 15)} Online 6 giờ qua</h4><small class="adm-now"></small></header><div class="adm-chart"></div></section>
      <section class="ov-card"><header><h4>${icon('clock', 15)} Chấm công hôm nay</h4><button type="button" class="adm-link" data-go="att">Xem ${icon('arrowRight', 13)}</button></header><div class="adm-att"></div></section>
      <section class="ov-card"><header><h4>${icon('map', 15)} Chỗ ngồi theo tầng</h4><button type="button" class="adm-link" data-go="map">Sơ đồ ${icon('arrowRight', 13)}</button></header><div class="adm-floors"></div></section>
      <section class="ov-card"><header><h4>${icon('target', 15)} Đang ở văn phòng</h4><small class="adm-oncount"></small></header><div class="adm-online"></div></section>
      <section class="ov-card adm-wide"><header><h4>${icon('history', 15)} Hoạt động gần đây</h4><button type="button" class="adm-link" data-go="audit">Tất cả ${icon('arrowRight', 13)}</button></header><div class="adm-feed"></div></section>
      <section class="ov-card"><header><h4>${icon('db', 15)} Hệ thống</h4><button type="button" class="adm-link" data-go="backup">Sao lưu ${icon('arrowRight', 13)}</button></header><div class="adm-srv"></div></section>
    </div></div>`);
    this.paintHome(); this.loadHome();
  }
  async loadHome() {
    const [st, att, au] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/admin/attendance'), api('GET', '/api/admin/audit?limit=8')]);
    if (st.ok) this.stats = { ...st, _at: Date.now() }; else if (this.tab === 'home') toast(st.error, true);
    if (att.ok) this.att = this.attSummary(att);
    if (au.ok) this.recent = au.audit;
    this.renderSide();
    if (this.tab === 'home' && !this.el.hidden) this.paintHome();
  }
  /** Chấm công hôm nay: đúng giờ / đi muộn / chưa chấm (chỉ nhân viên đang làm việc mới tính "chưa chấm"). */
  attSummary(r) { const late = r.list.filter(x => x.lateMin > 0); return { ...r, late: late.length, onTime: r.list.length - late.length, came: r.list.length, lateList: late, absentN: r.absent.length }; }
  paintHome() {
    const b = this.body; if (!b.querySelector('.adm-home')) return;
    const active = this.employees.filter(e => e.status !== 'disabled'), on = active.filter(e => this.isOnline(e.code)), noSeat = active.filter(e => !e.seat);
    const s = this.seatStats(), a = this.att, st = this.stats;
    const stat = (ic, v, label, cls = '', go = '', extra = '') => `<button type="button" class="ov-stat adm-stat ${cls}" ${go}><span class="ov-ic">${icon(ic, 18)}</span><b>${v}</b><small>${label}</small>${extra}</button>`;
    this.put(b.querySelector('.adm-stats'), [
      stat('target', `${on.length}<em> / ${st?.maxOnline ?? active.length}</em>`, st ? (st.waiting ? `đang online · <span class="adm-warnt">${st.waiting} người chờ vào</span>` : `đang online · tối đa ${st.maxOnline} cùng lúc`) : 'nhân viên đang online', st?.waiting ? 'warn' : on.length ? 'ok' : '', 'data-go="emp" data-sf="online"'),
      stat('clock', a ? `${a.came}<em> / ${a.came + a.absentN}</em>` : '…', a ? (a.late ? `đã chấm công · <span class="adm-warnt">${a.late} đi muộn</span>` : 'đã chấm công hôm nay') : 'đang tải chấm công', a?.late ? 'warn' : '', 'data-go="att"'),
      stat('map', `${s.free}<em> / ${s.total}</em>`, `chỗ trống · ${s.owned} có chủ${s.locked ? ` · ${s.locked} khoá` : ''}`, '', 'data-go="map"'),
      stat('user', noSeat.length, noSeat.length ? 'nhân viên chưa có chỗ — bấm để gán' : 'ai cũng đã có chỗ', noSeat.length ? 'warn' : 'ok', 'data-go="emp" data-ff="none" data-sf="all"')
    ].join(''));
    this.put(b.querySelector('.adm-now'), st ? `Bây giờ: <b>${st.now}</b> người` : '');
    const now = Math.floor(Date.now() / 30e3) * 30e3;   // (trục thời gian nhích theo 30 giây: không thay SVG mỗi giây)
    this.put(b.querySelector('.adm-chart'), st ? this.chart([...st.online, { t: now, n: st.now }], now) : '<div class="adm-skel"></div>');
    this.put(b.querySelector('.adm-att'), !a ? '<div class="adm-skel"></div>' : `${bar([[a.onTime, C.free], [a.late, '#f2a93b'], [a.absentN, '#d9d4cc']])}
      ${legend([[C.free, 'Đúng giờ', a.onTime], ['#f2a93b', 'Đi muộn', a.late], ['#d9d4cc', 'Chưa chấm công', a.absentN]])}
      ${a.lateList.length ? `<ul class="adm-mini">${a.lateList.slice(0, 4).map(r => `<li>${avatar(`employee:${r.code}`, r.name)}<span>${esc(r.display)}</span><em class="warn">${hm(r.checkIn)} · muộn ${r.lateMin}p</em></li>`).join('')}${a.lateList.length > 4 ? `<li class="adm-more">+${a.lateList.length - 4} người nữa</li>` : ''}</ul>` : ''}
      <p class="adm-foot">Giờ vào ca ${esc(a.shift)}</p>`);
    this.put(b.querySelector('.adm-floors'), this.app.model.floors.map(f => { const x = this.seatStats(f.id); return x.total ? `<button type="button" class="adm-floor" data-go="map" data-fl="${f.id}"><b>${esc(f.name)}</b>${bar([[x.online, C.online], [x.owned - x.online, C.owned], [x.free, C.free], [x.locked, C.locked]])}<span>${x.owned}/${x.total}</span></button>` : ''; }).join('')
      + legend([[C.online, 'Chủ đang online', s.online], [C.owned, 'Có chủ', s.owned - s.online], [C.free, 'Trống', s.free], ...(s.locked ? [[C.locked, 'Khoá', s.locked]] : [])]));
    this.put(b.querySelector('.adm-oncount'), on.length ? `${on.length} người` : '');
    this.put(b.querySelector('.adm-online'), on.length ? `<ul class="adm-mini">${on.slice(0, 8).map(e => `<li>${avatar(`employee:${e.code}`, e.name)}<span>${esc(e.display)}<small>${esc(e.department || '')}</small></span><em>${e.seat ? esc(e.seat.deskId) : 'chưa có chỗ'}</em><button type="button" class="adm-ib" data-follow="${esc(e.code)}" title="Camera bám theo ${esc(e.display)}" aria-label="Theo dõi ${esc(e.display)}">${icon('target', 14)}</button></li>`).join('')}${on.length > 8 ? `<li class="adm-more"><button type="button" class="adm-link" data-go="emp" data-sf="online">Xem cả ${on.length} người ${icon('arrowRight', 13)}</button></li>` : ''}</ul>` : empty('users', 'Chưa có ai online.'));
    b.querySelectorAll('[data-follow]').forEach(x => x.onclick = () => this.act('follow', x.dataset.follow));
    this.put(b.querySelector('.adm-feed'), !this.recent ? '<div class="adm-skel"></div>' : this.recent.length ? `<ul class="adm-log">${this.recent.map(a => `<li><time title="${esc(fmt(a.ts))}">${ago(a.ts)}</time><b>${esc(ACTION_LABEL[a.action] || a.action)}</b><span>${esc(this.actorName(a.actor))}${a.target ? ` · <em>${esc(a.target)}</em>` : ''}</span></li>`).join('')}</ul>` : empty('history', 'Chưa có hoạt động.'));
    const m = st?.mongo || {}, badge = (ok, a1, b1) => `<span class="adm-chip ${ok ? 'ok' : 'warn'}">${ok ? a1 : b1}</span>`;
    this.put(b.querySelector('.adm-srv'), !st ? '<div class="adm-skel"></div>' : `<dl class="adm-dl">
      <div><dt>Phiên bản</dt><dd>${esc(st.version)}</dd></div>
      <div><dt>Đã chạy</dt><dd>${uptime(st.uptimeSec)}</dd></div>
      <div><dt>Lưu MongoDB</dt><dd>${badge(m.enabled && !m.error, 'Đang bật', m.enabled ? 'Lỗi' : 'Tắt')}</dd></div>
      <div><dt>Lần lưu gần nhất</dt><dd>${m.enabled ? ago(m.lastSaveAt || m.restoredAt) : '—'}${m.pending ? ` · ${m.pending} chờ lưu` : ''}</dd></div>
      <div><dt>Giới hạn online</dt><dd>${st.now}/${st.maxOnline} người${st.waiting ? ` · ${st.waiting} chờ` : ''}</dd></div>
      ${st.files ? `<div class="adm-dlbar"><dt>Dung lượng file</dt><dd>${Math.round(st.files.used / 1048576)}/${Math.round(st.files.max / 1048576)} MB</dd>${bar([[st.files.used, st.files.used / st.files.max > 0.9 ? C.locked : st.files.used / st.files.max > 0.75 ? '#f2a93b' : C.online], [Math.max(0, st.files.max - st.files.used), 'transparent']])}</div>` : ''}</dl>
      ${m.enabled ? (m.error ? `<p class="adm-note">${icon('info', 14)} ${esc(m.error)}</p>` : '') : `<p class="adm-note">${icon('info', 14)} Chưa đặt MONGODB_URI: server khởi động lại (Render miễn phí) sẽ mất dữ liệu.</p>`}`);
  }
  /** Biểu đồ đường số người online (6 giờ gần nhất), trục -6h … Bây giờ. */
  chart(pts = [], now = Date.now()) {
    const W = 560, H = 150, L = 26, B = 20, t0 = now - 6 * 3600e3;
    const max = Math.max(4, ...pts.map(p => p.n)), top = Math.ceil(max / 4) * 4;   // (bội của 4: vạch chia là số nguyên)
    const X = t => L + (t - t0) / (now - t0) * (W - L - 8), Y = n => 8 + (1 - n / top) * (H - B - 8);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = top * i / 4, y = Y(v); g += `<line x1="${L}" x2="${W - 8}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 3.5}" text-anchor="end">${Math.round(v)}</text>`; }
    for (const [h, lbl] of [[6, '-6 giờ'], [4, '-4 giờ'], [2, '-2 giờ'], [0, 'Bây giờ']]) g += `<text x="${X(now - h * 3600e3)}" y="${H - 4}" text-anchor="${h === 0 ? 'end' : h === 6 ? 'start' : 'middle'}">${lbl}</text>`;
    const pp = pts.filter(p => p.t >= t0).map(p => [X(p.t).toFixed(1), Y(p.n).toFixed(1)]);
    const line = pp.length > 1 ? `<path class="ln-a" d="M${pp[0][0]},${Y(0)} L${pp.map(p => p.join(',')).join(' L')} L${pp.at(-1)[0]},${Y(0)}Z"/><polyline class="ln" points="${pp.map(p => p.join(',')).join(' ')}"/><circle class="ln-p" cx="${pp.at(-1)[0]}" cy="${pp.at(-1)[1]}" r="3.5"/>` : pp.length ? `<circle class="ln-p" cx="${pp[0][0]}" cy="${pp[0][1]}" r="3.5"/>` : '';
    return `<svg class="adm-svgchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Số người online 6 giờ gần nhất">${g}${line}</svg>`;
  }

  // ---------- nhân viên ----------
  renderEmployees() {
    this._rowsKey = null;
    const floors = this.app.model.floors;
    this.put(this.body, `<div class="adm-tools">
        <label class="ds-search adm-q">${icon('target', 14)}<input id="dQ" type="search" placeholder="Tìm mã, tên, phòng ban, bàn…" value="${esc(this.q)}" aria-label="Tìm nhân viên" autocomplete="off"></label>
        <select id="dF" class="adm-sel" aria-label="Lọc theo tầng"><option value="all">Mọi tầng</option><option value="none">Chưa có chỗ</option>${floors.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select>
        <div class="mp-sub adm-sf" role="group" aria-label="Lọc trạng thái"></div>
      </div>
      <div class="adm-table"><table class="adm-t adm-emp"><thead><tr><th>Nhân viên</th><th>Phòng ban</th><th>Trạng thái</th><th>Chỗ ngồi</th><th>Nhân vật</th><th>Lần cuối</th><th><span class="sr-only">Thao tác</span></th></tr></thead><tbody id="dRows"></tbody></table></div>
      <p class="adm-hint">${icon('info', 13)} <span class="adm-cnt"></span> · CSV: <code>ma,ten,phong_ban,trang_thai,ma_ban</code> — nhập là tất cả-hoặc-không: có dòng lỗi thì không đổi gì.</p>`);
    const b = this.body;
    b.querySelector('#dF').value = this.ff;
    b.querySelector('#dQ').oninput = e => { this.q = e.target.value; this.renderRows(); };
    b.querySelector('#dQ').onkeydown = e => { if (e.key === 'Escape' && e.target.value) { e.stopPropagation(); e.target.value = ''; this.q = ''; this.renderRows(); } };
    b.querySelector('#dF').onchange = e => { this.ff = e.target.value; this.renderRows(); };
    b.querySelector('.adm-sf').onclick = e => { const x = e.target.closest('[data-sf]'); if (x) { this.sf = x.dataset.sf; this.renderRows(); } };
    b.querySelector('#dRows').onclick = e => { const x = e.target.closest('[data-act]'); if (x) this.act(x.dataset.act, x.closest('tr').dataset.code); };
    this.renderRows();
  }
  /** Lọc theo ô tìm + tầng (chưa lọc trạng thái — để đếm số trên các nút trạng thái). */
  base() {
    const q = this.q.trim().toLowerCase().normalize('NFC');
    return this.employees.filter(e => {
      if (q && !`${e.code} ${e.name} ${e.department} ${e.seat?.deskId || ''}`.toLowerCase().normalize('NFC').includes(q)) return false;
      if (this.ff === 'none' && e.seat) return false;
      if (this.ff !== 'all' && this.ff !== 'none' && (!e.seat || String(e.seat.floor) !== this.ff)) return false;
      return true;
    });
  }
  stateOf(e) { return e.status === 'disabled' ? 'disabled' : this.isOnline(e.code) ? 'online' : 'offline'; }
  filtered() { const b = this.base(); return this.sf === 'all' ? b : b.filter(e => this.stateOf(e) === this.sf); }
  renderRows() {
    const body = this.body.querySelector('#dRows'); if (!body) return;
    const base = this.base(), n = k => base.filter(e => this.stateOf(e) === k).length;
    this.put(this.body.querySelector('.adm-sf'), [['all', 'Tất cả', base.length], ['online', 'Online', n('online')], ['offline', 'Offline', n('offline')], ['disabled', 'Vô hiệu', n('disabled')]]
      .map(([k, l, c]) => `<button type="button" data-sf="${k}" class="${this.sf === k ? 'on' : ''}" aria-pressed="${this.sf === k}">${l} <em>${c}</em></button>`).join(''));
    const rows = this.filtered();
    this.put(this.body.querySelector('.adm-cnt'), `Hiển thị ${rows.length} / ${this.employees.length} nhân viên`);
    const key = JSON.stringify(rows.map(e => [e.code, e.name, e.department, e.status, e.canMove, e.seat?.deskId, this.isOnline(e.code), e.look?.model, ago(e.lastSeen)]));
    if (key === this._rowsKey) return; this._rowsKey = key;
    const st = { online: ['ok', 'Online'], offline: ['', 'Offline'], disabled: ['bad', 'Vô hiệu'] };
    body.innerHTML = rows.map(e => {
      const s = this.stateOf(e), on = s === 'online', ib = (act, ic, t, cls = '') => `<button type="button" class="adm-ib ${cls}" data-act="${act}" title="${t}" aria-label="${t}">${icon(ic, 14)}</button>`;
      return `<tr data-code="${esc(e.code)}" class="${s === 'disabled' ? 'off' : ''}">
        <td><div class="adm-who">${avatar(`employee:${e.code}`, e.name)}<span><b>${esc(e.name)}</b><small>${esc(e.code)}</small></span></div></td>
        <td>${e.department ? esc(e.department) : '<span class="adm-mu">—</span>'}</td>
        <td><span class="adm-chip ${st[s][0]}"><i></i>${st[s][1]}</span>${e.canMove ? ' <span class="adm-chip info" title="Được tự đổi sang chỗ khác một lần">đổi chỗ</span>' : ''}</td>
        <td>${e.seat ? `<b>${esc(e.seat.deskId)}</b> <span class="adm-mu">${esc(this.floorName(e.seat.floor))}</span>` : s === 'disabled' ? '<span class="adm-mu">—</span>' : '<button type="button" class="adm-link" data-act="seat">Gán chỗ</button>'}</td>
        <td>${e.look ? `<span class="look-dot" title="Nhân vật: ${esc(charName(e.look.model))}"></span> ${esc(charName(e.look.model))}` : '<span class="adm-mu">chưa chọn</span>'}</td>
        <td class="adm-mu" title="${esc(fmt(e.lastSeen))}">${on ? 'đang online' : ago(e.lastSeen)}</td>
        <td class="adm-acts">${ib('edit', 'edit', 'Sửa thông tin')}${ib('look', 'user', 'Đổi nhân vật')}${s !== 'disabled' ? ib('seat', 'pin', e.seat ? 'Đổi chỗ ngồi' : 'Gán chỗ ngồi') : ''}${on ? ib('follow', 'target', 'Camera bám theo') + ib('kick', 'logout', 'Buộc đăng xuất') : ''}${ib('del', 'trash', 'Xoá nhân viên', 'danger')}</td></tr>`;
    }).join('') || `<tr><td colspan="7">${empty('users', this.employees.length ? 'Không có nhân viên phù hợp bộ lọc.' : 'Chưa có nhân viên nào — bấm "Thêm nhân viên".')}</td></tr>`;
  }
  async importCsv(e) {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const ok = await confirmDanger('Nhập CSV', `Nhập ${f.name} sẽ cập nhật tên, phòng ban, trạng thái và gán lại chỗ ngồi theo file. Tiếp tục?`, 'Nhập');
    if (!ok) return;
    const r = await api('POST', '/api/admin/import', { csv: await f.text() });
    if (!r.ok) { await modal({ title: 'CSV chưa được nhập', body: `<p>${esc(r.error)}</p><ul>${(r.errors || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`, okText: 'Đóng', cancelText: 'Đóng' }); return; }
    toast(`Đã nhập ${r.updated} dòng, cập nhật ${r.seats} chỗ.`); this.refresh();
  }

  async act(kind, code) {
    const e = this.employees.find(x => x.code === code); if (!e) return;
    if (kind === 'edit') return this.editEmployee(e);
    if (kind === 'look') {
      const look = await openAvatarEditor({
        schema: this.session.appearance, look: e.look, display: e.display, title: `Nhân vật của ${e.display}`,
        save: async l => { const r = await api('PUT', `/api/admin/employees/${code}/look`, { look: l }); return r.ok ? { ok: true, look: r.look } : { ok: false, error: r.error }; }
      });
      if (look) { toast('Đã lưu nhân vật.'); this.refresh(); }
      return;
    }
    if (kind === 'seat') return this.seatFor(e);
    if (kind === 'follow') { const o = this.session.online.find(x => x.code === code); if (!o) return toast(`${e.display} vừa offline.`, true); this.toggle(false); this.session.follow(o.key); return; }
    if (kind === 'kick') {
      if (!await confirmDanger('Buộc đăng xuất', `Đăng xuất ${e.display} khỏi mọi thiết bị?`, 'Đăng xuất')) return;
      return this.done(await api('POST', `/api/admin/employees/${code}/logout`, {}), 'Đã đăng xuất nhân viên.');
    }
    if (kind === 'del') {
      if (!await confirmDanger('Xóa nhân viên', `Xóa vĩnh viễn ${e.display}? ${e.seat ? `Chỗ ${e.seat.deskId} sẽ trống lại, ` : ''}phiên đăng nhập bị hủy. Không hoàn tác được.`, 'Xóa')) return;
      return this.done(await api('DELETE', `/api/admin/employees/${code}`, {}), 'Đã xóa nhân viên.');
    }
  }
  async done(r, msg) { if (!r.ok) { toast(r.error, true); return false; } toast(msg); await this.refresh(); return true; }
  depts() { return [...new Set(this.employees.map(x => x.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')); }

  async addEmployee() {
    const r = await modal({
      title: 'Thêm nhân viên',
      body: `<label for="nCode">Mã và tên (dạng 1151-An)</label><input id="nCode" type="text" placeholder="1151-An" autocomplete="off">
        <label for="nDept">Phòng ban</label><input id="nDept" type="text" list="nDeptList" autocomplete="off"><datalist id="nDeptList">${this.depts().map(d => `<option value="${esc(d)}">`).join('')}</datalist>
        <p class="muted small">Người này đăng nhập bằng đúng mã-tên trên, tự tạo nhân vật rồi chọn chỗ (hoặc bạn gán chỗ ở nút "Gán chỗ").</p>`,
      okText: 'Thêm',
      onOk: async b => {
        const input = b.querySelector('#nCode').value, p = parseLogin(input);
        if (!p.ok) return { error: p.error };
        const res = await api('POST', '/api/admin/employees', { input, department: b.querySelector('#nDept').value });
        return res.ok ? res.display : { error: res.error };
      }
    });
    if (r) { toast(`Đã thêm ${r}.`); this.q = ''; this.ff = 'all'; this.sf = 'all'; if (this.tab === 'emp') this.renderEmployees(); this.refresh(); }
  }

  async editEmployee(e) {
    await modal({
      title: `Sửa ${e.code}`,
      body: `<label for="eName">Tên</label><input id="eName" type="text" value="${esc(e.name)}">
        <label for="eDept">Phòng ban</label><input id="eDept" type="text" value="${esc(e.department || '')}" list="deptList" autocomplete="off"><datalist id="deptList">${this.depts().map(d => `<option value="${esc(d)}">`).join('')}</datalist>
        <label for="eStatus">Trạng thái</label><select id="eStatus"><option value="active" ${e.status === 'active' ? 'selected' : ''}>Đang làm việc</option><option value="disabled" ${e.status === 'disabled' ? 'selected' : ''}>Vô hiệu hóa (trả chỗ, đăng xuất)</option></select>
        <label class="chk"><input type="checkbox" id="eMove" ${e.canMove ? 'checked' : ''}> Cho phép tự đổi sang chỗ khác (một lần)</label>`,
      okText: 'Lưu',
      onOk: async b => {
        const patch = { name: b.querySelector('#eName').value, department: b.querySelector('#eDept').value, status: b.querySelector('#eStatus').value, canMove: b.querySelector('#eMove').checked };
        if (patch.status === 'disabled' && e.status !== 'disabled' && !await confirmDanger('Vô hiệu hóa', `Vô hiệu hóa ${e.display}? Người này bị đăng xuất và chỗ ngồi trống lại.`, 'Vô hiệu hóa')) return { error: 'Đã hủy.' };
        const r = await api('PATCH', `/api/admin/employees/${e.code}`, patch);
        if (!r.ok) return { error: r.error };
        toast('Đã lưu.'); this.refresh(); return true;
      }
    });
  }

  freeDesks() { return this.app.model.desks.filter(d => { const s = this.session.seats.get(d.id); return !s?.owner && !s?.locked; }); }

  async seatFor(e) {
    const free = this.freeDesks();
    if (!free.length) return toast('Không còn chỗ trống. Giải phóng hoặc mở khoá một chỗ ở Sơ đồ chỗ ngồi.', true);
    // nhóm theo tầng; mặc định chọn tầng của chỗ hiện tại (đổi chỗ gần)
    const byFloor = this.app.model.floors.map(f => [f, free.filter(d => d.floor === f.id)]).filter(([, l]) => l.length);
    const opts = byFloor.map(([f, l]) => `<optgroup label="${esc(f.name)} · ${l.length} chỗ trống">${l.map(d => `<option value="${esc(d.id)}">${esc(d.id)}</option>`).join('')}</optgroup>`).join('');
    const r = await modal({
      title: `Chỗ ngồi của ${e.display}`,
      body: `<p>Hiện tại: <b>${e.seat ? `${esc(e.seat.deskId)} · ${esc(this.floorName(e.seat.floor))}` : 'chưa có chỗ'}</b></p>
        <label for="sDesk">${e.seat ? 'Đổi sang chỗ trống' : 'Gán chỗ trống'}</label><select id="sDesk">${opts}</select>
        ${e.seat ? '<p class="muted small">Dụng cụ của chỗ cũ chuyển theo sang chỗ mới.</p>' : ''}`,
      okText: e.seat ? 'Đổi chỗ' : 'Gán chỗ',
      onOk: async b => {
        const desk = b.querySelector('#sDesk').value;
        if (!desk) return { error: 'Không còn chỗ trống.' };
        const r = await api('POST', `/api/admin/seats/${encodeURIComponent(desk)}/assign`, { code: e.code });
        return r.ok ? desk : { error: r.error };
      }
    });
    if (r) { toast(`Đã gán ${r} cho ${e.display}.`); this.refresh(); }
  }

  // ---------- chỗ ngồi (thao tác trên một bàn — cũng mở khi Admin bấm bàn trong cảnh 3D) ----------
  async deskActions(deskId) {
    const s = this.session.seats.get(deskId), d = this.app.model.deskById.get(deskId); if (!d) return;
    const cands = this.employees.filter(e => e.status === 'active').sort((a, b) => (!!a.seat - !!b.seat) || (a.code < b.code ? -1 : 1));
    const empOpts = cands.map(e => `<option value="${esc(e.code)}">${esc(e.display)}${e.seat ? ` (đang ở ${esc(e.seat.deskId)})` : ' — chưa có chỗ'}</option>`).join('');
    const canAssign = !s?.owner && !s?.locked;
    const back = await new Promise(resolve => {
      modal({
        title: `Chỗ ${deskId} · ${this.floorName(d.floor)}`,
        body: `<p>${s?.owner ? `Chủ chỗ: <b>${esc(s.owner.display)}</b>${this.isOnline(s.owner.code) ? ' · đang online' : ''}` : 'Chỗ trống'}${s?.locked ? ' · <b class="err">đang khóa</b>' : ''}</p>
          <div class="row tight wrap">
            ${s?.owner ? '<button type="button" data-d="release" class="danger">Giải phóng chỗ</button>' : ''}
            <button type="button" data-d="lock" class="${s?.locked ? '' : 'danger'}">${s?.locked ? 'Mở khóa chỗ' : 'Khóa chỗ'}</button>
            ${s?.owner ? '<button type="button" data-d="equip">Sửa dụng cụ</button>' : ''}
            <button type="button" data-d="view">Xem trong 3D</button>
            <button type="button" data-d="sit">Ngồi vào chỗ này</button>
          </div>
          ${canAssign ? (cands.length ? `<label for="aCode">Gán cho nhân viên</label><select id="aCode"><option value="">— chọn —</option>${empOpts}</select>` : '<p class="muted small">Chưa có nhân viên nào để gán.</p>') : ''}`,
        okText: canAssign && cands.length ? 'Gán chỗ' : 'Đóng', cancelText: 'Đóng',
        onOk: async b => {
          const sel = b.querySelector('#aCode');
          if (!sel) return true;
          if (!sel.value) return { error: 'Chọn nhân viên.' };
          const r = await api('POST', `/api/admin/seats/${encodeURIComponent(deskId)}/assign`, { code: sel.value });
          if (!r.ok) return { error: r.error };
          toast(`Đã gán ${deskId}.`); this.refresh(); return true;
        }
      }).then(() => resolve(null));
      setTimeout(() => document.querySelectorAll('#modalRoot [data-d]').forEach(btn => btn.onclick = () => { btn.closest('.modal-back')?.remove(); resolve(btn.dataset.d); }), 0);
    });
    if (back === 'release') {
      if (!await confirmDanger('Giải phóng chỗ', `Trả chỗ ${deskId} của ${s.owner.display}? Người này sẽ phải chọn chỗ mới.`, 'Giải phóng')) return;
      this.done(await api('POST', `/api/admin/seats/${encodeURIComponent(deskId)}/release`, {}), `Đã giải phóng ${deskId}.`);
    } else if (back === 'lock') {
      const locking = !s?.locked;
      if (locking && !await confirmDanger('Khóa chỗ', `Khóa chỗ ${deskId}? Không ai nhận hay ngồi được chỗ này cho tới khi mở khóa${s?.owner ? ' (kể cả chủ chỗ)' : ''}.`, 'Khóa')) return;
      this.done(await api('POST', `/api/admin/seats/${encodeURIComponent(deskId)}/lock`, { locked: locking }), locking ? `Đã khóa ${deskId}.` : `Đã mở khóa ${deskId}.`);
    } else if (back === 'equip') {
      const eq = { ...defaultEquipment(this.session.schema), ...(s.equipment || {}) };
      await modal({
        title: `Dụng cụ chỗ ${deskId}`, body: this.session.equipHtml(eq), okText: 'Lưu dụng cụ',
        onOk: async b => {
          const v = { ...eq };
          b.querySelectorAll('[data-eq]').forEach(el => { const t = el.dataset.type; if (t === 'color') { if (el.checked) v[el.dataset.eq] = el.value; } else v[el.dataset.eq] = t === 'int' ? +el.value : t === 'bool' ? el.checked : el.value; });
          const r = await api('PUT', `/api/seats/${encodeURIComponent(deskId)}/equipment`, { equipment: v });
          if (!r.ok) return { error: r.error };
          toast('Đã lưu dụng cụ.'); return true;
        }
      });
    } else if (back === 'view') { this.toggle(false); this.session.focusDesk(deskId); }
    else if (back === 'sit') { this.toggle(false); this.session.sit(deskId); }
  }

  // ---------- sơ đồ ----------
  renderMap() {
    this._svg = null;
    if (!this.app.model.floors.some(f => f.id === this.floor)) this.floor = this.app.model.floors[0]?.id ?? 0;
    this.put(this.body, `<div class="adm-tools"><div class="mp-sub adm-fl" role="group" aria-label="Tầng"></div>
        <ul class="adm-leg row"><li><i style="background:${C.free}"></i>Trống</li><li><i style="background:${C.owned}"></i>Có chủ</li><li><i style="background:${C.online}"></i>Chủ đang online</li><li><i style="background:${C.locked}"></i>Khoá</li><li><i class="pin" style="background:${C.pin}"></i>Người online</li></ul></div>
      <div class="adm-mapsum"></div>
      <div id="mapWrap" class="adm-map"></div>
      <p class="adm-hint">${icon('info', 13)} Bấm vào bàn để gán, đổi, giải phóng, khoá chỗ hoặc sửa dụng cụ. Bấm chấm cam để camera bám theo người đó.</p>`);
    this.body.querySelector('.adm-fl').onclick = e => { const x = e.target.closest('[data-mf]'); if (x) { this.floor = +x.dataset.mf; this._svg = null; this.paintMapHead(); this.drawMap(); } };
    this.paintMapHead(); this.drawMap();
  }
  paintMapHead() {
    const b = this.body, fl = b.querySelector('.adm-fl'); if (!fl) return;
    this.put(fl, this.app.model.floors.map(f => { const x = this.seatStats(f.id); return `<button type="button" data-mf="${f.id}" class="${f.id === this.floor ? 'on' : ''}" aria-pressed="${f.id === this.floor}">${esc(f.name)}${x.total ? ` <em title="chỗ trống">${x.free}</em>` : ''}</button>`; }).join(''));
    const x = this.seatStats(this.floor), people = this.session.remote.list.filter(a => a.f === this.floor && a.key !== 'guide').length;
    this.put(b.querySelector('.adm-mapsum'), `<span><b>${x.total}</b> chỗ</span><span><b style="color:${C.free}">${x.free}</b> trống</span><span><b>${x.owned}</b> có chủ</span>${x.locked ? `<span><b style="color:${C.locked}">${x.locked}</b> khoá</span>` : ''}<span><b style="color:${C.pin}">${people}</b> người đang ở tầng này</span>`);
  }
  drawMap() {
    const wrap = this.body.querySelector('#mapWrap'); if (!wrap) return;
    this.paintMapHead();
    const m = this.app.model, f = this.floor;
    // khung: bao trọn tường + bàn của tầng (không lấy vùng sân / đường phố rộng — sơ đồ phóng vào toà nhà); tầng không có tường: vùng đi lại
    const areas = (m.nav.areas || []).filter(a => a.floor === f), fd = m.desks.filter(d => d.floor === f), walls = (m.obstacles.get(f) || []).filter(o => o.type === 'wall');
    const box = walls.length ? walls : areas;
    const xs = [...box.flatMap(a => [a.x0, a.x1]), ...fd.map(d => d.x)], zs = [...box.flatMap(a => [a.z0, a.z1]), ...fd.map(d => d.z)];
    if (!xs.length) { if (this._svg !== 'empty') { this._svg = 'empty'; wrap.innerHTML = empty('map', 'Tầng này chưa có dữ liệu.'); } return; }
    const x0 = Math.min(...xs) - 0.3, x1 = Math.max(...xs) + 0.3, z0 = Math.min(...zs) - 0.3, z1 = Math.max(...zs) + 0.3;
    // nhìn từ trên, đường phố ở dưới: trục ngang = x, trục dọc = z; co theo bề ngang khung (điện thoại vẫn thấy cả tầng)
    const availH = Math.max(300, this.body.clientHeight - 170), S = Math.max(9, Math.min(80, ((wrap.clientWidth || 900) - 26) / (x1 - x0), (availH - 26) / (z1 - z0)))   // (vừa cả bề ngang lẫn chiều cao khung: thấy trọn tầng, không cuộn)
    , W = (x1 - x0) * S, H = (z1 - z0) * S, X = x => (x - x0) * S, Z = z => (z - z0) * S;
    let svg = `<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}" role="img" aria-label="Sơ đồ chỗ ngồi ${esc(this.floorName(f))}">`;
    for (const a of areas) svg += `<rect x="${X(a.x0)}" y="${Z(a.z0)}" width="${(a.x1 - a.x0) * S}" height="${(a.z1 - a.z0) * S}" fill="#fffdf9" stroke="#e6dfd4"/>`;
    for (const o of m.obstacles.get(f) || []) if (['wall', 'stair', 'stairwell'].includes(o.type)) svg += `<rect x="${X(o.x0)}" y="${Z(o.z0)}" width="${(o.x1 - o.x0) * S}" height="${(o.z1 - o.z0) * S}" fill="${o.type === 'wall' ? '#4a4c63' : '#e2dccf'}"/>`;
    for (const t of m.tables.filter(t => t.floor === f)) svg += `<rect x="${X(t.x - t.w / 2)}" y="${Z(t.z - t.d / 2)}" width="${t.w * S}" height="${t.d * S}" rx="4" fill="#efe7da" stroke="#d9cfbf"/><text x="${X(t.x)}" y="${Z(t.z) + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#8a8ca3">${esc(t.id)}</text>`;
    for (const d of fd) {
      const s = this.session.seats.get(d.id), fp = footprint(d.x, d.z, d.w || 1, d.d || 0.6, d.facing);
      const on = s?.owner && this.isOnline(s.owner.code);
      const col = s?.locked ? C.locked : on ? C.online : s?.owner ? C.owned : C.free;
      const who = s?.owner ? s.owner.display.replace(/^\d+-/, '') : '';
      svg += `<g class="mdesk" data-desk="${esc(d.id)}" tabindex="0" role="button" aria-label="${esc(d.id)}: ${esc(s?.owner ? s.owner.display : s?.locked ? 'khóa' : 'trống')}${s?.owner && s?.locked ? ' (khoá)' : ''}">
        <title>${esc(d.id)} · ${esc(s?.owner ? s.owner.display : s?.locked ? 'khoá' : 'trống')}${s?.owner && s?.locked ? ' · khoá' : ''}</title>
        <rect x="${X(fp.x0)}" y="${Z(fp.z0)}" width="${(fp.x1 - fp.x0) * S}" height="${(fp.z1 - fp.z0) * S}" rx="4" fill="${col}"/>
        <circle cx="${X(d.seat.x)}" cy="${Z(d.seat.z)}" r="6" fill="${col}" opacity=".35"/>
        <text x="${X(d.x)}" y="${Z(d.z) - 2}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#fff">${esc(d.id)}</text>
        <text x="${X(d.x)}" y="${Z(d.z) + 9}" text-anchor="middle" font-size="8.5" font-weight="600" fill="#fff">${esc(s?.owner ? who.slice(0, 12) : (s?.locked ? 'khoá' : 'trống'))}</text></g>`;
    }
    for (const a of this.session.remote.list) {
      if (a.f !== f || a.key === 'guide') continue;
      svg += `<g class="mpin" data-key="${esc(a.key)}" tabindex="0" role="button" aria-label="Bám theo ${esc(a.display)}"><circle cx="${X(a.x).toFixed(1)}" cy="${Z(a.z).toFixed(1)}" r="7" fill="${C.pin}" stroke="#fff" stroke-width="2"/><text x="${(X(a.x) + 10).toFixed(1)}" y="${(Z(a.z) - 8).toFixed(1)}" font-size="10" font-weight="800" fill="#2b2d42" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(a.display)}</text></g>`;
    }
    svg += '</svg>';
    if (svg === this._svg) return;
    this._svg = svg; wrap.innerHTML = svg;
    wrap.querySelectorAll('.mdesk').forEach(g => { const go = () => this.deskActions(g.dataset.desk); g.onclick = go; g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }; });
    wrap.querySelectorAll('.mpin').forEach(g => g.onclick = () => { this.toggle(false); this.session.follow(g.dataset.key); });
  }

  // ---------- chấm công ----------
  renderAtt() {
    this.put(this.body, `<div class="adm-tools"><div class="mp-sub adm-av" role="group" aria-label="Xem chấm công">
        <button type="button" data-av="today">Hôm nay</button><button type="button" data-av="month">Theo tháng</button></div>
        <div class="adm-mnav" hidden><button type="button" class="adm-ib" data-step="-1" aria-label="Tháng trước">${icon('chevLeft', 15)}</button><b></b><button type="button" class="adm-ib" data-step="1" aria-label="Tháng sau">${icon('chevLeft', 15, 'flip')}</button></div></div>
      <div class="adm-attbody"><div class="adm-skel tall"></div></div>`);
    const b = this.body;
    b.querySelector('.adm-av').onclick = e => { const x = e.target.closest('[data-av]'); if (x && x.dataset.av !== this.attView) { this.attView = x.dataset.av; this.loadAtt(); } };
    b.querySelector('.adm-mnav').onclick = e => { const x = e.target.closest('[data-step]'); if (!x) return; const n = ymShift(this.ym, +x.dataset.step); if (n > ymNow()) return; this.ym = n; this.loadAtt(); };
    this.loadAtt();
  }
  async loadAtt() {
    const b = this.body, box = b.querySelector('.adm-attbody'); if (!box) return;
    b.querySelectorAll('[data-av]').forEach(x => { x.classList.toggle('on', x.dataset.av === this.attView); x.setAttribute('aria-pressed', x.dataset.av === this.attView); });
    const nav = b.querySelector('.adm-mnav'); nav.hidden = this.attView !== 'month';
    const [y, mo] = this.ym.split('-'); nav.querySelector('b').textContent = `Tháng ${+mo}/${y}`; nav.querySelector('[data-step="1"]').disabled = this.ym >= ymNow();
    const view = this.attView, ym = this.ym;
    const r = await api('GET', view === 'today' ? '/api/admin/attendance' : `/api/admin/attendance/month?ym=${ym}`);
    if (this.tab !== 'att' || this.attView !== view || this.ym !== ym) return;
    if (!r.ok) { this.put(box, empty('info', esc(r.error || 'Không tải được chấm công.'))); return; }
    if (view === 'today') {
      const a = this.att = this.attSummary(r); this.renderSide();
      const row = x => `<tr><td><div class="adm-who">${avatar(`employee:${x.code}`, x.name)}<span><b>${esc(x.name)}</b><small>${esc(x.code)}</small></span></div></td><td>${esc(x.department || '—')}</td>
        <td><b>${hm(x.checkIn)}</b></td><td>${x.checkOut ? hm(x.checkOut) : this.isOnline(x.code) ? '<span class="adm-mu">đang làm</span>' : '<span class="adm-mu">—</span>'}</td>
        <td>${x.lateMin ? `<span class="adm-chip warn"><i></i>Muộn ${x.lateMin} phút</span>` : '<span class="adm-chip ok"><i></i>Đúng giờ</span>'}</td></tr>`;
      this.put(box, `<div class="ov-stats adm-stats sm">
          <div class="ov-stat ok"><span class="ov-ic">${icon('check', 18)}</span><b>${a.onTime}</b><small>đúng giờ</small></div>
          <div class="ov-stat ${a.late ? 'warn' : ''}"><span class="ov-ic">${icon('clock', 18)}</span><b>${a.late}</b><small>đi muộn</small></div>
          <div class="ov-stat"><span class="ov-ic">${icon('user', 18)}</span><b>${a.absentN}</b><small>chưa chấm công</small></div>
          <div class="ov-stat"><span class="ov-ic">${icon('calendar', 18)}</span><b>${esc(a.shift)}</b><small>giờ vào ca · ${dayLabel(a.day)}</small></div></div>
        <section class="ov-card"><header><h4>Đã chấm công <em>${a.came}</em></h4></header>
          ${a.list.length ? `<div class="adm-table flat"><table class="adm-t"><thead><tr><th>Nhân viên</th><th>Phòng ban</th><th>Giờ vào</th><th>Giờ ra</th><th>Trạng thái</th></tr></thead><tbody>${a.list.map(row).join('')}</tbody></table></div>` : empty('clock', 'Hôm nay chưa ai chấm công.')}</section>
        <section class="ov-card"><header><h4>Chưa chấm công <em>${a.absentN}</em></h4><small>Tự chấm công khi vào văn phòng 3D</small></header>
          ${a.absent.length ? `<div class="adm-pills">${a.absent.map(x => `<span class="adm-pill">${avatar(`employee:${x.code}`, x.display.replace(/^\d+-/, ''))}${esc(x.display)}${x.department ? `<small>${esc(x.department)}</small>` : ''}</span>`).join('')}</div>` : empty('check', 'Mọi người đã chấm công.')}</section>`);
    } else {
      const emps = r.employees.slice().sort((p, q) => (q.summary.late - p.summary.late) || (p.code < q.code ? -1 : 1));
      const tot = emps.reduce((s, e) => ({ present: s.present + e.summary.present, late: s.late + e.summary.late, absent: s.absent + e.summary.absent, hours: s.hours + e.summary.hours }), { present: 0, late: 0, absent: 0, hours: 0 });
      const wd = r.days.filter(d => d.work).length, past = r.days.filter(d => d.work && d.past).length;
      this.put(box, `<div class="ov-stats adm-stats sm">
          <div class="ov-stat"><span class="ov-ic">${icon('calendar', 18)}</span><b>${past}<em> / ${wd}</em></b><small>ngày làm việc đã qua</small></div>
          <div class="ov-stat ok"><span class="ov-ic">${icon('check', 18)}</span><b>${tot.present}</b><small>lượt đi làm</small></div>
          <div class="ov-stat ${tot.late ? 'warn' : ''}"><span class="ov-ic">${icon('clock', 18)}</span><b>${tot.late}</b><small>lượt đi muộn</small></div>
          <div class="ov-stat ${tot.absent ? 'bad' : ''}"><span class="ov-ic">${icon('user', 18)}</span><b>${tot.absent}</b><small>ngày vắng</small></div></div>
        <section class="ov-card"><header><h4>Tổng hợp từng người <em>${emps.length}</em></h4><small>Ngày vắng: ngày làm việc đã qua không chấm công (tính từ ngày vào công ty)</small></header>
          ${emps.length ? `<div class="adm-table flat"><table class="adm-t"><thead><tr><th>Nhân viên</th><th>Phòng ban</th><th class="n">Đi làm</th><th class="n">Đi muộn</th><th class="n">Vắng</th><th class="n">Giờ làm</th><th title="Ngày đúng giờ / (ngày đi làm + ngày vắng)">Đúng giờ</th></tr></thead><tbody>
            ${emps.map(e => { const s = e.summary, base = Math.max(1, s.present + s.absent), pct = Math.round(100 * (s.present - s.late) / base); return `<tr><td><div class="adm-who">${avatar(`employee:${e.code}`, e.display.replace(/^\d+-/, ''))}<span><b>${esc(e.display.replace(/^\d+-/, ''))}</b><small>${esc(e.code)}</small></span></div></td><td>${esc(e.department || '—')}</td>
              <td class="n"><b>${s.present}</b></td><td class="n">${s.late ? `<span class="adm-warnt">${s.late}</span> <small class="adm-mu">${s.lateMin}p</small>` : '0'}</td><td class="n">${s.absent ? `<span class="adm-badt">${s.absent}</span>` : '0'}</td><td class="n">${s.hours}</td>
              <td>${s.present + s.absent ? `<div class="adm-pct">${bar([[s.present - s.late, C.free], [s.late, '#f2a93b'], [s.absent, C.locked]])}<span>${pct}%</span></div>` : '<span class="adm-mu">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>` : empty('users', 'Chưa có dữ liệu tháng này.')}</section>`);
    }
  }

  // ---------- nhật ký ----------
  async renderAudit(reload = false) {
    if (!reload) this.put(this.body, `<div class="adm-tools"><label class="ds-search adm-q">${icon('target', 14)}<input id="aQ" type="search" placeholder="Tìm người làm, thao tác, đối tượng…" value="${esc(this.aq)}" aria-label="Tìm trong nhật ký" autocomplete="off"></label>
        <div class="mp-sub adm-ag" role="group" aria-label="Nhóm thao tác"></div></div>
      <div class="adm-auditbody"><div class="adm-skel tall"></div></div>`);
    const b = this.body;
    b.querySelector('#aQ').oninput = e => { this.aq = e.target.value; this.paintAudit(); };
    b.querySelector('.adm-ag').onclick = e => { const x = e.target.closest('[data-ag]'); if (x) { this.ag = x.dataset.ag; this.paintAudit(); } };
    const r = await api('GET', '/api/admin/audit?limit=500');
    if (this.tab !== 'audit') return;
    if (!r.ok) { this.put(b.querySelector('.adm-auditbody'), empty('info', esc(r.error))); return; }
    this.audit = r.audit; this.paintAudit();
    if (reload) toast('Đã tải lại nhật ký.');
  }
  paintAudit() {
    const b = this.body, box = b.querySelector('.adm-auditbody'); if (!box || !this.audit) return;
    const q = this.aq.trim().toLowerCase().normalize('NFC'), lbl = a => ACTION_LABEL[a.action] || a.action;
    const inQ = this.audit.filter(a => !q || `${this.actorName(a.actor)} ${a.actor} ${lbl(a)} ${a.target || ''}`.toLowerCase().normalize('NFC').includes(q));
    this.put(b.querySelector('.adm-ag'), AUDIT_GROUPS.map(([k, l]) => { const n = k === 'all' ? inQ.length : inQ.filter(a => groupOf(a.action) === k).length; return `<button type="button" data-ag="${k}" class="${this.ag === k ? 'on' : ''}" aria-pressed="${this.ag === k}">${l} <em>${n}</em></button>`; }).join(''));
    const rows = this.ag === 'all' ? inQ : inQ.filter(a => groupOf(a.action) === this.ag);
    // chi tiết: bỏ giá trị rỗng / đối tượng lồng nhau; mốc thời gian (ms) hiện thành ngày giờ
    const val = v => typeof v === 'number' && v > 1e12 ? fmt(v) : typeof v === 'boolean' ? (v ? 'có' : 'không') : String(v).slice(0, 48);
    const detail = d => !d ? '' : typeof d !== 'object' ? esc(String(d)) : Object.entries(d).filter(([, v]) => v !== null && v !== '' && typeof v !== 'object').slice(0, 4).map(([k, v]) => `<span class="adm-kv">${esc(k)}: <b>${esc(val(v))}</b></span>`).join('');
    const day = t => new Date(t).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
    let last = '', html = '';
    for (const a of rows) {
      const d = day(a.ts); if (d !== last) { last = d; html += `<tr class="adm-day"><td colspan="5">${esc(d)}</td></tr>`; }
      const g = groupOf(a.action);
      html += `<tr><td class="adm-mu" title="${esc(fmt(a.ts))}">${hm(a.ts)}</td><td><b>${esc(this.actorName(a.actor))}</b></td><td><span class="adm-tag g-${g}">${esc(lbl(a))}</span></td><td>${esc(a.target || '')}</td><td class="adm-det">${detail(a.detail)}</td></tr>`;
    }
    this.put(box, rows.length ? `<div class="adm-table"><table class="adm-t adm-audit"><thead><tr><th>Giờ</th><th>Người làm</th><th>Thao tác</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead><tbody>${html}</tbody></table></div>
      <p class="adm-hint">${icon('info', 13)} ${rows.length} thao tác${this.audit.length >= 500 ? ' (500 thao tác gần nhất)' : ''}.</p>` : empty('history', 'Không có thao tác phù hợp.'));
  }

  // ---------- sao lưu ----------
  async renderBackups() {
    this.put(this.body, '<div class="adm-bk"><div class="adm-skel tall"></div></div>');
    const [r, fr] = await Promise.all([api('GET', '/api/admin/backups'), api('GET', '/api/admin/files')]);
    if (this.tab !== 'backup') return;
    if (!r.ok) { this.put(this.body, empty('info', esc(r.error))); return; }
    this.bk = r; this.renderHead();
    const lastTs = r.backups[0]?.ts;
    this.put(this.body, `<div class="adm-bk">
      <div class="ov-stats adm-stats sm">
        <div class="ov-stat ${r.enabled ? 'ok' : 'warn'}"><span class="ov-ic">${icon('db', 18)}</span><b class="txt">${r.enabled ? 'Đang bật' : 'Tắt'}</b><small>${r.enabled ? 'tự sao lưu mỗi đêm sau 2 giờ' : 'database chạy trong bộ nhớ (chế độ thử)'}</small></div>
        <div class="ov-stat"><span class="ov-ic">${icon('history', 18)}</span><b class="txt">${lastTs ? ago(lastTs) : '—'}</b><small>bản gần nhất</small></div>
        <div class="ov-stat"><span class="ov-ic">${icon('folder', 18)}</span><b>${r.backups.length}<em> / ${r.keep}</em></b><small>bản đang giữ</small></div></div>
      ${fr.ok ? this.filesCard(fr) : ''}
      <p class="adm-note soft">${icon('info', 14)} Thỉnh thoảng hãy tải một bản về máy hoặc Google Drive: bản đó vẫn còn kể cả khi mất server.</p>
      <section class="ov-card"><header><h4>Các bản sao lưu <em>${r.backups.length}</em></h4></header>
      ${r.backups.length ? `<div class="adm-table flat"><table class="adm-t"><thead><tr><th>Thời gian</th><th>Tên file</th><th class="n">Dung lượng</th><th><span class="sr-only">Tải về</span></th></tr></thead><tbody>
        ${r.backups.map(b => `<tr><td><b>${fmt(b.ts)}</b> <span class="adm-mu">· ${ago(b.ts)}</span></td><td><code>${esc(b.name)}</code></td><td class="n">${kb(b.size)}</td><td class="adm-acts"><a class="adm-ib" href="/api/admin/backups/${encodeURIComponent(b.name)}" download title="Tải về" aria-label="Tải ${esc(b.name)}">${icon('download', 14)}</a></td></tr>`).join('')}
      </tbody></table></div>` : empty('db', r.enabled ? 'Chưa có bản sao lưu nào — bấm "Sao lưu ngay".' : 'Database đang chạy trong bộ nhớ (chế độ thử), không sao lưu.')}</section></div>`);
  }
  /** Dung lượng file (tài liệu, ảnh, bảng vẽ… lưu trong MongoDB): theo loại, hạn mức, dọn file thừa (không còn chủ). */
  filesCard(fr) {
    const mb = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`, pct = fr.max ? fr.used / fr.max : 0;
    setTimeout(() => { this.body.querySelector('[data-prune]')?.addEventListener('click', e => this.pruneFiles(e.currentTarget)); this.loadFileList(); }, 0);
    return `<section class="ov-card adm-files"><header><h4>${icon('folder', 15)} Dung lượng file <em>${mb(fr.used)} / ${Math.round(fr.max / 1048576)} MB</em></h4>
        ${fr.orphans.count ? `<button type="button" class="sx-ghost" data-prune>${icon('trash', 14)} <span>Dọn ${fr.orphans.count} file thừa (${mb(fr.orphans.bytes)})</span></button>` : '<small>Không có file thừa</small>'}</header>
      ${bar([[fr.used, pct > 0.9 ? C.locked : pct > 0.75 ? '#f2a93b' : C.online], [Math.max(0, fr.max - fr.used), 'transparent']])}
      <p class="adm-foot">Tính cả tài liệu dự án / cuộc họp, ảnh và nội dung bảng vẽ, ảnh bảng tin, logo dự án. Hết chỗ thì không tải file mới được — xoá tài liệu cũ trong dự án / cuộc họp, hoặc "Dọn file thừa" (file của dự án, cuộc họp, tin đã xoá).</p>
      ${fr.groups.length ? `<ul class="adm-mini">${fr.groups.map(g => `<li><span>${esc(g.label)}<small>${g.count} file</small></span><em>${mb(g.bytes)}</em></li>`).join('')}</ul>` : ''}
      <div class="adm-flist" data-flist><div class="adm-skel"></div></div></section>`;
  }
  // ---------- danh sách từng file: nằm ở dự án / cuộc họp / tin nào, ai tải lên — lọc, tìm, mở nơi chứa, xoá ----------
  async loadFileList() {
    const host = this.body.querySelector('[data-flist]'); if (!host) return;
    const r = await api('GET', '/api/admin/files/list'); if (!host.isConnected) return;
    if (!r.ok) { host.innerHTML = `<p class="adm-foot">${esc(r.error)}</p>`; return; }
    this.fl = { files: r.files, f: this.fl?.f || 'all', q: this.fl?.q || '', n: 40 };
    this.paintFileList();
  }
  paintFileList() {
    const host = this.body.querySelector('[data-flist]'); if (!host || !this.fl) return;
    const { files, f, q } = this.fl, KL = { pfile: 'Tài liệu dự án', file: 'Tài liệu cuộc họp', wbf: 'Ảnh bảng vẽ', board: 'Bảng vẽ', plogo: 'Logo dự án', ann: 'Ảnh bìa tin', annimg: 'Ảnh trong tin', fb: 'Ảnh góp ý', tiktok: 'TikTok', other: 'Khác' };
    const WT = { project: ['grid', 'Dự án'], meeting: ['calendar', 'Cuộc họp'], board: ['megaphone', 'Bảng tin'], feedback: ['chat', 'Góp ý'], system: ['db', 'Hệ thống'] };
    const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
    const counts = {}; for (const x of files) counts[x.kind] = (counts[x.kind] || 0) + 1;
    const orph = files.filter(x => x.orphan).length, nq = norm(q);
    const shown = files.filter(x => (f === 'all' || (f === 'orphan' ? x.orphan : x.kind === f)) && (!nq || norm(`${x.name} ${x.where?.title} ${x.by} ${KL[x.kind]}`).includes(nq)));
    const chips = [['all', `Tất cả ${files.length}`], ...Object.keys(KL).filter(k => counts[k]).map(k => [k, `${KL[k]} ${counts[k]}`]), ...(orph ? [['orphan', `File thừa ${orph}`]] : [])];
    host.innerHTML = `<div class="afl-bar"><div class="afl-chips" role="tablist">${chips.map(([k, l]) => `<button type="button" data-ff="${k}" class="${f === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
        <label class="afl-q">${icon('target', 14)}<input type="search" placeholder="Tìm tên file, dự án, cuộc họp, người tải…" value="${esc(q)}" aria-label="Tìm file"></label></div>
      ${shown.length ? `<div class="adm-table flat"><table class="adm-t afl-t"><thead><tr><th>File</th><th>Nằm ở</th><th>Người tải lên</th><th>Ngày</th><th class="n">Dung lượng</th><th><span class="sr-only">Thao tác</span></th></tr></thead><tbody>
        ${shown.slice(0, this.fl.n).map((x, i) => { const w = x.where || {}, [wi, wl] = WT[w.type] || WT.system; return `<tr${x.orphan ? ' class="orph"' : ''}>
          <td><b class="afl-n" title="${esc(x.name)}">${esc(x.name)}</b><small>${esc(KL[x.kind] || x.kind)}${x.orphan ? ' · <em class="afl-orph">thừa</em>' : ''}</small></td>
          <td><span class="afl-w">${icon(wi, 14)}<span><small>${wl}${w.part ? ` · ${esc(w.part)}` : ''}</small><b title="${esc(w.title || '')}">${esc(w.title || '—')}</b></span></span></td>
          <td>${esc(x.by || '—')}</td><td title="${esc(fmt(x.ts))}">${x.ts ? esc(ago(x.ts)) : '—'}</td><td class="n">${kb(x.size)}</td>
          <td class="adm-acts">${w.id != null && ['project', 'meeting', 'board', 'feedback'].includes(w.type) && !/đã xoá|đã gỡ|Chưa gắn/.test(w.title || '') ? `<button type="button" class="adm-ib" data-open="${i}" title="Mở ${wl.toLowerCase()} này">${icon('arrowRight', 14)}</button>` : ''}${x.deletable ? `<button type="button" class="adm-ib danger" data-del="${i}" title="Xoá file">${icon('trash', 14)}</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>${shown.length > this.fl.n ? `<button type="button" class="sx-ghost afl-more">Xem thêm ${Math.min(40, shown.length - this.fl.n)} / còn ${shown.length - this.fl.n} file</button>` : ''}` : `<p class="adm-foot">Không có file nào khớp.</p>`}`;
    host.querySelectorAll('[data-ff]').forEach(b => b.onclick = () => { this.fl.f = b.dataset.ff; this.fl.n = 40; this.paintFileList(); });
    const inp = host.querySelector('.afl-q input'); inp.oninput = () => { this.fl.q = inp.value; this.fl.n = 40; clearTimeout(this.flT); this.flT = setTimeout(() => { this.paintFileList(); const i2 = this.body.querySelector('.afl-q input'); i2?.focus(); i2?.setSelectionRange(i2.value.length, i2.value.length); }, 200); };
    host.querySelector('.afl-more')?.addEventListener('click', () => { this.fl.n += 40; this.paintFileList(); });
    host.querySelectorAll('[data-open]').forEach(b => b.onclick = () => this.openFileWhere(shown[+b.dataset.open]));
    host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => this.deleteFile(shown[+b.dataset.del], b));
  }
  /** Mở nơi chứa file (đóng bảng quản trị trước). */
  openFileWhere(x) {
    const w = x?.where, s = this.session; if (!w) return;
    this.toggle(false);
    setTimeout(() => {
      if (w.type === 'project') s.projects?.panel.open(w.id);
      else if (w.type === 'meeting') s.meet?.panel.open('folder', w.id);
      else if (w.type === 'board') { s.board?.open(); setTimeout(() => s.board?.read(w.id), 600); }
      else if (w.type === 'feedback') s.feedback?.open(w.id);
    }, 250);
  }
  async deleteFile(x, btn) {
    if (!x) return;
    const where = x.where?.title ? ` (${x.where.title})` : '';
    if (!(await confirmDanger('Xoá file?', `Xoá vĩnh viễn "${x.name}"${where} — ${kb(x.size)}. Mọi người sẽ không mở được file này nữa. Không hoàn tác được.`, 'Xoá'))) return;
    btn.disabled = true;
    const r = await api('DELETE', `/api/admin/files/item?key=${encodeURIComponent(x.key)}`);
    if (!r.ok) { btn.disabled = false; toast(r.error, true); return; }
    toast(`Đã xoá "${x.name}".`); this.fl.files = this.fl.files.filter(y => y.key !== x.key); this.paintFileList(); this.loadHome?.();
    const em = this.body.querySelector('.adm-files header h4 em'); if (em && r.report) em.textContent = `${kb(r.report.used)} / ${Math.round(r.report.max / 1048576)} MB`;
  }
  async pruneFiles(btn) {
    if (!(await confirmDanger('Dọn file thừa?', 'Xoá vĩnh viễn nội dung các file không còn chủ (dự án, cuộc họp, tin đã xoá; tài liệu đã gỡ). File đang dùng không bị ảnh hưởng.', 'Dọn'))) return;
    btn.disabled = true;
    const r = await api('POST', '/api/admin/files/prune', {});
    if (!r.ok) { btn.disabled = false; toast(r.error, true); return; }
    toast(`Đã dọn ${r.count} file, giải phóng ${(r.bytes / 1048576).toFixed(1)} MB.`); this.loadHome(); this.renderBackups();
  }
  async backupNow(btn) {
    if (btn.disabled) return;
    btn.disabled = true; const span = btn.querySelector('span'), t = span.textContent; span.textContent = 'Đang sao lưu…';
    const x = await api('POST', '/api/admin/backups', {});
    btn.disabled = false; span.textContent = t;
    if (!x.ok) { toast(x.error, true); return; }
    toast(`Đã sao lưu: ${x.backup.name}`);
    if (this.tab === 'backup') this.renderBackups();
  }
}
