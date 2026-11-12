// Bảng quản trị CEO: nhân viên (tìm, lọc tầng/online, sửa, gán/đổi/giải phóng/khóa chỗ, dụng cụ, vô hiệu hóa, xóa,
// buộc đăng xuất, CSV), sơ đồ chỗ ngồi từng tầng có vị trí người online thời gian thực, nhật ký thao tác.
// Mọi thao tác gọi API; server kiểm tra quyền và ghi audit log.
import { characterDef } from '../agents/glbCharacters.js';
const charName = id => characterDef(id)?.name || id || 'mặc định';
import { api } from '../net/api.js';
import { toast, modal, confirmDanger, esc } from '../session/ui.js';
import { footprint } from '../model/layoutModel.js';
import { defaultEquipment } from '../shared/equipment.js';
import { parseLogin } from '../shared/identity.js';
import { openAvatarEditor } from '../session/avatarEditor.js';
import { icon } from '../ui/icons.js';

const $ = id => document.getElementById(id);
const ACTION_LABEL = { 'login.new': 'Đăng ký mới', 'look.create': 'Tạo nhân vật', 'look.update': 'Đổi nhân vật', 'attendance.checkin': 'Chấm công vào', 'attendance.checkout': 'Chấm công ra', 'login.return': 'Vào lại', 'seat.claim': 'Nhận chỗ', 'seat.move': 'Tự đổi chỗ', 'seat.equipment': 'Sửa dụng cụ', 'seat.sit': 'Ngồi', 'admin.login': 'CEO đăng nhập', 'admin.login.fail': 'CEO đăng nhập sai', 'admin.seat.assign': 'Gán chỗ', 'admin.seat.release': 'Giải phóng chỗ', 'admin.seat.lock': 'Khóa chỗ', 'admin.seat.unlock': 'Mở khóa chỗ', 'admin.employee.update': 'Sửa nhân viên', 'admin.employee.delete': 'Xóa nhân viên', 'admin.employee.logout': 'Buộc đăng xuất', 'admin.csv.import': 'Nhập CSV', 'admin.csv.export': 'Xuất CSV', 'admin.backup': 'Sao lưu database', 'admin.backup.download': 'Tải bản sao lưu', 'admin.password.change': 'Đổi mật khẩu', logout: 'Đăng xuất', 'admin.seed': 'Tạo tài khoản CEO', 'layout.desk_removed': 'Bàn bị bỏ khỏi layout' };
const fmt = ts => ts ? new Date(ts).toLocaleString('vi-VN') : '—';

export class Dashboard {
  constructor(app, session) {
    this.app = app; this.session = session;
    this.tab = 'home'; this.floor = 1; this.employees = []; this.q = ''; this.ff = 'all'; this.sf = 'all';
    const el = this.el = document.createElement('section');
    el.id = 'dash'; el.hidden = true; el.setAttribute('aria-label', 'Bảng quản trị');
    $('stage').appendChild(el);
    session.onSeats(() => { if (!el.hidden) this.render(); });
    this._t = setInterval(() => { if (!el.hidden && this.tab === 'map') this.drawMap(); if (!el.hidden && this.tab === 'emp') this.renderRows(); }, 1000);
    this._th = setInterval(() => { if (!el.hidden && this.tab === 'home') this.renderHome(true); }, 15000);
  }
  async toggle(force) {
    const show = force ?? this.el.hidden;
    this.el.hidden = !show;
    if (show) { await this.refresh(); }
  }
  async refresh() {
    if (this.el.hidden) return;
    // nhiều lần làm mới chồng nhau (online, đổi nhân vật…): chỉ lấy kết quả của lần gọi sau cùng — kết quả cũ về muộn không đè lên
    const seq = this._seq = (this._seq || 0) + 1;
    const r = await api('GET', '/api/admin/employees');
    if (seq !== this._seq) return;
    if (!r.ok) { toast(r.error, true); return; }
    this.employees = this.app.real ? r.employees.map(e => ({ ...e, seat: e.seatReal })) : r.employees; // (Real SYS: chỗ theo mặt bằng thật)
    this.render();
  }

  // Giao diện kiểu bảng điều khiển đám mây: thanh bên tối chia nhóm, thanh trên có "đường dẫn", tiêu đề lớn, các thẻ số liệu.
  render() {
    const groups = [
      [null, [['home', 'Tổng quan', 'grid']]],
      ['Nhân sự', [['emp', 'Nhân viên', 'users'], ['map', 'Sơ đồ chỗ ngồi', 'map']]],
      ['Dữ liệu', [['audit', 'Nhật ký', 'history'], ['backup', 'Sao lưu', 'db']]]
    ];
    const titles = { home: 'Tổng quan văn phòng', emp: 'Nhân viên', map: 'Sơ đồ chỗ ngồi', audit: 'Nhật ký thao tác', backup: 'Sao lưu dữ liệu' };
    this.el.innerHTML = `<div class="atl">
      <aside class="atl-side" aria-label="Mục quản trị">
        <div class="atl-brand"><img src="logo/sysone-logo.svg" alt="SYSONE" width="104" height="12"><span>Quản trị</span></div>
        <nav role="tablist" aria-orientation="vertical">${groups.map(([g, items]) => `${g ? `<h4>${icon(g === 'Nhân sự' ? 'users' : 'db', 15)}${g}</h4>` : ''}
          ${items.map(([k, l, ic]) => `<button role="tab" aria-selected="${this.tab === k}" class="atl-nav${this.tab === k ? ' on' : ''}${g ? '' : ' top'}" data-tab="${k}">${g ? '' : icon(ic, 16)}<span>${l}</span></button>`).join('')}`).join('')}</nav>
      </aside>
      <div class="atl-main">
        <header class="atl-top">
          <div class="atl-crumb"><span><small>Tổ chức</small><b>SYSONE</b></span>${icon('chevDown', 14, 'atl-chev')}<span><small>Văn phòng</small><b>33 Dương Quang Đông</b></span></div>
          <button id="dashClose" class="atl-btn" aria-label="Đóng bảng quản trị">${icon('close', 14)} Đóng</button>
        </header>
        <div class="atl-content"><h1 class="atl-title">${titles[this.tab]}</h1><div id="dashBody"></div></div>
      </div></div>`;
    this.el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.tab; this.render(); });
    $('dashClose').onclick = () => this.toggle(false);
    if (this.tab === 'home') this.renderHome();
    else if (this.tab === 'emp') this.renderEmployees();
    else if (this.tab === 'map') this.renderMap();
    else if (this.tab === 'backup') this.renderBackups();
    else this.renderAudit();
  }

  // ---------- tổng quan ----------
  async renderHome(quiet = false) {
    const body = $('dashBody'); if (!body) return;
    if (!quiet) body.innerHTML = '<div class="atl-panel atl-skel"></div>';
    const [st, att, au] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/attendance/today'), api('GET', '/api/admin/audit?limit=8')]);
    if (this.tab !== 'home' || this.el.hidden) return;
    if (!st.ok) { body.textContent = st.error; return; }
    const emps = this.employees.filter(e => e.status !== 'disabled'), total = emps.length;
    const seats = [...this.session.seats.values()], owned = seats.filter(s => s.owner).length, locked = seats.filter(s => s.locked).length, free = seats.length - owned - locked;
    const list = att.ok ? att.list : [], late = list.filter(r => r.lateMin > 0).length, came = list.length;
    const up = s => s < 3600 ? `${Math.floor(s / 60)} phút` : s < 86400 ? `${Math.floor(s / 3600)} giờ ${Math.floor(s % 3600 / 60)} phút` : `${Math.floor(s / 86400)} ngày`;
    const ago = t => { if (!t) return '—'; const d = (Date.now() - t) / 1000; return d < 60 ? 'vừa xong' : d < 3600 ? `${Math.floor(d / 60)} phút trước` : `${Math.floor(d / 3600)} giờ trước`; };
    const badge = (on, a = 'BẬT', b = 'TẮT') => `<span class="atl-badge ${on ? 'ok' : 'warn'}">${on ? a : b}</span>`;
    const m = st.mongo || {};
    const card = (title, go, inner) => `<section class="atl-card"><header>${icon('info', 15)}<h3>${title}</h3>${go ? `<button class="atl-go" data-go="${go}" aria-label="Mở ${title}">${icon('arrowRight', 16)}</button>` : ''}</header><div class="atl-card-b">${inner}</div></section>`;
    const bar = (parts) => `<div class="atl-stack">${parts.map(([n, c]) => n ? `<i style="flex:${n};background:${c}"></i>` : '').join('')}</div>`;
    const legend = rows => `<ul class="atl-leg">${rows.map(([c, l, v]) => `<li><i style="background:${c}"></i>${l}<b>${v}</b></li>`).join('')}</ul>`;
    body.innerHTML = `
      <section class="atl-panel">
        <header class="atl-panel-h"><h2>Văn phòng 3D</h2><span class="atl-badge ok">HOẠT ĐỘNG</span>
          <div class="atl-acts"><button class="atl-btn green" data-go="emp">${icon('users', 14)} Nhân viên</button><button class="atl-btn" data-go="map">${icon('map', 14)} Sơ đồ</button><button class="atl-btn" data-go="audit">Nhật ký</button></div></header>
        <div class="atl-cards">
          ${card('Cấu hình', 'backup', `<dl class="atl-dl">
            <div><dt>Phiên bản</dt><dd>${esc(st.version)}</dd></div>
            <div><dt>Đã chạy</dt><dd>${up(st.uptimeSec)}</dd></div>
            <div><dt>Lưu MongoDB</dt><dd>${badge(m.enabled && !m.error, 'BẬT', m.enabled ? 'LỖI' : 'TẮT')}</dd></div>
            <div><dt>Lần lưu gần nhất</dt><dd>${m.enabled ? ago(m.lastSaveAt || m.restoredAt) : '—'}</dd></div></dl>
            ${m.enabled ? '' : '<p class="atl-note">Chưa đặt MONGODB_URI: server khởi động lại (Render miễn phí) sẽ mất dữ liệu.</p>'}`)}
          ${card('Đang online', 'emp', `<p class="atl-big"><b>${st.now}</b> / ${total} <small>nhân viên</small></p>${this.chart([...st.online, { t: Date.now(), n: st.now }])}`)}
          ${card('Chấm công hôm nay', null, `<p class="atl-big"><b>${came}</b> / ${total} <small>đã đến</small></p>
            ${bar([[came - late, '#00ED64'], [late, '#FFC010'], [Math.max(0, total - came), '#3D4F58']])}
            ${legend([['#00ED64', 'Đúng giờ', came - late], ['#FFC010', 'Đi muộn', late], ['#3D4F58', 'Chưa đến', Math.max(0, total - came)]])}`)}
          ${card('Chỗ ngồi', 'map', `<p class="atl-big"><b>${owned}</b> / ${seats.length} <small>đã có chủ</small></p>
            ${bar([[owned, '#0498EC'], [free, '#00A35C'], [locked, '#DB3030']])}
            ${legend([['#0498EC', 'Có chủ', owned], ['#00A35C', 'Trống', free], ['#DB3030', 'Khoá', locked]])}`)}
        </div>
      </section>
      <div class="atl-row">
        <section class="atl-panel"><header class="atl-panel-h"><h2>Hoạt động gần đây</h2><div class="atl-acts"><button class="atl-btn" data-go="audit">Xem tất cả</button></div></header>
          <ul class="atl-feed">${(au.ok ? au.audit : []).map(a => `<li><time>${ago(a.ts)}</time><span>${esc(this.actorName(a.actor))}</span><b>${esc(ACTION_LABEL[a.action] || a.action)}</b><em>${esc(a.target || '')}</em></li>`).join('') || '<li class="muted">Chưa có hoạt động.</li>'}</ul></section>
        <section class="atl-panel"><header class="atl-panel-h"><h2>Đang ở văn phòng</h2></header>
          <ul class="atl-feed">${this.employees.filter(e => this.isOnline(e.code)).slice(0, 12).map(e => `<li><span class="atl-dot"></span><b>${esc(e.code)}</b><span>${esc(e.name)}</span><em>${esc(e.seat?.deskId || '')}</em></li>`).join('') || '<li class="muted">Chưa có ai online.</li>'}</ul></section>
      </div>`;
    body.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { this.tab = b.dataset.go; this.render(); });
  }
  /** "emp:1151" → "1151-An"; "admin:x" → "CEO". */
  actorName(k) { const s = String(k || ''); if (s.startsWith('emp:')) { const e = this.employees.find(x => x.code === s.slice(4)); return e ? `${e.code}-${e.name}` : s.slice(4); } return s.startsWith('admin') ? 'CEO' : s; }
  /** Biểu đồ đường số người online (6 giờ gần nhất), trục giống thẻ số liệu: -6h … Bây giờ. */
  chart(pts = []) {
    const W = 230, H = 130, L = 24, B = 18, now = Date.now(), t0 = now - 6 * 3600e3;
    const max = Math.max(4, ...pts.map(p => p.n)), top = Math.ceil(max / 4) * 4;   // (bội của 4: vạch chia là số nguyên)
    const X = t => L + (t - t0) / (now - t0) * (W - L - 6), Y = n => 6 + (1 - n / top) * (H - B - 6);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = top * i / 4, y = Y(v); g += `<line x1="${L}" x2="${W - 6}" y1="${y}" y2="${y}"/><text x="${L - 5}" y="${y + 3}" text-anchor="end">${Math.round(v)}</text>`; }
    for (const [h, lbl] of [[6, '-6h'], [4, '-4h'], [2, '-2h'], [0, 'Bây giờ']]) g += `<text x="${X(now - h * 3600e3)}" y="${H - 3}" text-anchor="middle">${lbl}</text>`;
    const pp = pts.filter(p => p.t >= t0).map(p => `${X(p.t).toFixed(1)},${Y(p.n).toFixed(1)}`);
    const line = pp.length > 1 ? `<path class="ln-a" d="M${pp[0].split(',')[0]},${Y(0)} L${pp.join(' L')} L${pp.at(-1).split(',')[0]},${Y(0)}Z"/><polyline class="ln" points="${pp.join(' ')}"/>` : pp.length ? `<circle class="ln-p" cx="${pp[0].split(',')[0]}" cy="${pp[0].split(',')[1]}" r="3"/>` : '';
    return `<svg class="atl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Số người online 6 giờ gần nhất">${g}${line}</svg>`;
  }

  // ---------- nhân viên ----------
  renderEmployees() {
    this._rowsKey = null;
    const floors = this.app.model.floors;
    $('dashBody').innerHTML = `<div class="row tight wrap">
        <input id="dQ" type="search" placeholder="Tìm mã, tên, phòng ban, bàn…" value="${esc(this.q)}" aria-label="Tìm nhân viên">
        <select id="dF" aria-label="Lọc theo tầng"><option value="all">Mọi tầng</option><option value="none">Chưa có chỗ</option>${floors.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select>
        <select id="dS" aria-label="Lọc trạng thái"><option value="all">Mọi trạng thái</option><option value="online">Đang online</option><option value="offline">Offline</option><option value="disabled">Vô hiệu hóa</option></select>
        <span class="sep"></span>
        <button id="dAdd" class="primary">+ Thêm nhân viên</button>
        <a class="btn" href="/api/admin/export.csv" download>Xuất CSV</a>
        <label class="file">Nhập CSV<input type="file" id="dCsv" accept=".csv,text/csv,text/plain"></label>
      </div>
      <p class="muted small">CSV: <code>ma,ten,phong_ban,trang_thai,ma_ban</code>. Nhập là tất cả-hoặc-không: có lỗi thì không đổi gì.</p>
      <div class="table-wrap"><table class="dtable"><thead><tr><th>Mã</th><th>Tên</th><th>Nhân vật</th><th>Phòng ban</th><th>Trạng thái</th><th>Chỗ</th><th>Lần cuối</th><th><span class="sr-only">Thao tác</span></th></tr></thead><tbody id="dRows"></tbody></table></div>`;
    $('dF').value = this.ff; $('dS').value = this.sf;
    $('dAdd').onclick = () => this.addEmployee();
    $('dQ').oninput = e => { this.q = e.target.value; this.renderRows(); };
    $('dF').onchange = e => { this.ff = e.target.value; this.renderRows(); };
    $('dS').onchange = e => { this.sf = e.target.value; this.renderRows(); };
    $('dCsv').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const ok = await confirmDanger('Nhập CSV', `Nhập ${f.name} sẽ cập nhật tên, phòng ban, trạng thái và gán lại chỗ ngồi theo file. Tiếp tục?`, 'Nhập');
      if (!ok) return;
      const r = await api('POST', '/api/admin/import', { csv: await f.text() });
      if (!r.ok) { await modal({ title: 'CSV chưa được nhập', body: `<p>${esc(r.error)}</p><ul>${(r.errors || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`, okText: 'Đóng', cancelText: 'Đóng' }); return; }
      toast(`Đã nhập ${r.updated} dòng, cập nhật ${r.seats} chỗ.`); this.refresh();
    };
    this.renderRows();
  }
  filtered() {
    const q = this.q.trim().toLowerCase().normalize('NFC');
    return this.employees.filter(e => {
      if (q && !`${e.code} ${e.name} ${e.department} ${e.seat?.deskId || ''}`.toLowerCase().normalize('NFC').includes(q)) return false;
      if (this.ff === 'none' && e.seat) return false;
      if (this.ff !== 'all' && this.ff !== 'none' && (!e.seat || String(e.seat.floor) !== this.ff)) return false;
      const on = this.isOnline(e.code);
      if (this.sf === 'online' && !on) return false;
      if (this.sf === 'offline' && (on || e.status === 'disabled')) return false;
      if (this.sf === 'disabled' && e.status !== 'disabled') return false;
      return true;
    });
  }
  isOnline(code) { return this.session.online.some(o => o.code === code); }
  renderRows() {
    const body = $('dRows'); if (!body) return;
    const rows = this.filtered();
    const key = JSON.stringify([rows.map(e => [e.code, e.name, e.department, e.status, e.seat?.deskId, this.isOnline(e.code), e.look])]);
    if (key === this._rowsKey) return; this._rowsKey = key;
    body.innerHTML = rows.map(e => {
      const on = this.isOnline(e.code);
      return `<tr data-code="${esc(e.code)}"><td><b>${esc(e.code)}</b></td><td>${esc(e.name)}</td><td>${e.look ? `<span class="look-dot" title="Nhân vật: ${esc(charName(e.look.model))}"></span> <span class="small">${esc(charName(e.look.model))}</span>` : '<span class="muted small">chưa chọn</span>'}</td><td>${esc(e.department || '—')}</td>
        <td><span class="dot" style="background:${e.status === 'disabled' ? '#b3261e' : on ? '#2bb673' : '#9aa0a6'}"></span> ${e.status === 'disabled' ? 'Vô hiệu' : on ? 'Online' : 'Offline'}${e.canMove ? ' · được đổi chỗ' : ''}</td>
        <td>${e.seat ? `${esc(e.seat.deskId)} <span class="muted">(${esc(this.app.model.floorById.get(e.seat.floor)?.name || '')})</span>` : '<span class="muted">chưa có</span>'}</td>
        <td class="muted small">${fmt(e.lastSeen)}</td>
        <td class="acts"><button data-act="edit">Sửa</button><button data-act="look">Nhân vật</button><button data-act="seat">Chỗ</button>${on ? '<button data-act="follow">Theo dõi</button><button data-act="kick">Đăng xuất</button>' : ''}<button data-act="del" class="danger">Xóa</button></td></tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">Không có nhân viên phù hợp.</td></tr>';
    body.querySelectorAll('[data-act]').forEach(b => b.onclick = () => this.act(b.dataset.act, b.closest('tr').dataset.code));
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
    if (kind === 'follow') { const o = this.session.online.find(x => x.code === code); this.toggle(false); if (o) this.session.follow(o.key); return; }
    if (kind === 'kick') {
      if (!await confirmDanger('Buộc đăng xuất', `Đăng xuất ${e.code}-${e.name} khỏi mọi thiết bị?`, 'Đăng xuất')) return;
      return this.done(await api('POST', `/api/admin/employees/${code}/logout`, {}), 'Đã đăng xuất nhân viên.');
    }
    if (kind === 'del') {
      if (!await confirmDanger('Xóa nhân viên', `Xóa vĩnh viễn ${e.code}-${e.name}? Chỗ ${e.seat ? e.seat.deskId + ' ' : ''}sẽ trống lại, phiên đăng nhập bị hủy.`, 'Xóa')) return;
      return this.done(await api('DELETE', `/api/admin/employees/${code}`, {}), 'Đã xóa nhân viên.');
    }
  }
  async done(r, msg) { if (!r.ok) { toast(r.error, true); return false; } toast(msg); await this.refresh(); return true; }

  async addEmployee() {
    const depts = [...new Set(this.employees.map(x => x.department).filter(Boolean))];
    const r = await modal({
      title: 'Thêm nhân viên',
      body: `<label for="nCode">Mã và tên (dạng 1151-An)</label><input id="nCode" type="text" placeholder="1151-An" autocomplete="off">
        <p class="err small" id="nHint"></p>
        <label for="nDept">Phòng ban</label><input id="nDept" type="text" list="nDeptList"><datalist id="nDeptList">${depts.map(d => `<option value="${esc(d)}">`).join('')}</datalist>
        <p class="muted small">Người này đăng nhập bằng đúng mã-tên trên, tự tạo nhân vật rồi chọn chỗ (hoặc bạn gán chỗ ở nút "Chỗ").</p>`,
      okText: 'Thêm',
      onOk: async b => {
        const input = b.querySelector('#nCode').value, p = parseLogin(input);
        if (!p.ok) return { error: p.error };
        const res = await api('POST', '/api/admin/employees', { input, department: b.querySelector('#nDept').value });
        return res.ok ? res.display : { error: res.error };
      }
    });
    if (r) { toast(`Đã thêm ${r}.`); this.refresh(); }
  }

  async editEmployee(e) {
    await modal({
      title: `Sửa ${e.code}`,
      body: `<label for="eName">Tên</label><input id="eName" type="text" value="${esc(e.name)}">
        <label for="eDept">Phòng ban</label><input id="eDept" type="text" value="${esc(e.department)}" list="deptList"><datalist id="deptList">${[...new Set(this.employees.map(x => x.department).filter(Boolean))].map(d => `<option value="${esc(d)}">`).join('')}</datalist>
        <label for="eStatus">Trạng thái</label><select id="eStatus"><option value="active" ${e.status === 'active' ? 'selected' : ''}>Đang làm việc</option><option value="disabled" ${e.status === 'disabled' ? 'selected' : ''}>Vô hiệu hóa (trả chỗ, đăng xuất)</option></select>
        <label class="chk"><input type="checkbox" id="eMove" ${e.canMove ? 'checked' : ''}> Cho phép tự đổi sang chỗ khác (một lần)</label>`,
      okText: 'Lưu',
      onOk: async b => {
        const patch = { name: b.querySelector('#eName').value, department: b.querySelector('#eDept').value, status: b.querySelector('#eStatus').value, canMove: b.querySelector('#eMove').checked };
        if (patch.status === 'disabled' && e.status !== 'disabled' && !await confirmDanger('Vô hiệu hóa', `Vô hiệu hóa ${e.code}-${e.name}? Người này bị đăng xuất và chỗ ngồi trống lại.`, 'Vô hiệu hóa')) return { error: 'Đã hủy.' };
        const r = await api('PATCH', `/api/admin/employees/${e.code}`, patch);
        if (!r.ok) return { error: r.error };
        toast('Đã lưu.'); this.refresh(); return true;
      }
    });
  }

  freeDesks() { return this.app.model.desks.filter(d => { const s = this.session.seats.get(d.id); return !s?.owner && !s?.locked; }); }

  async seatFor(e) {
    const opts = this.freeDesks().map(d => `<option value="${esc(d.id)}">${esc(d.id)} · ${esc(this.app.model.floorById.get(d.floor).name)}</option>`).join('');
    const r = await modal({
      title: `Chỗ ngồi của ${e.code}-${e.name}`,
      body: `<p>Hiện tại: <b>${e.seat ? esc(e.seat.deskId) : 'chưa có chỗ'}</b></p>
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
    if (r) { toast(`Đã gán ${r} cho ${e.code}.`); this.refresh(); }
  }

  // ---------- chỗ ngồi (thao tác trên một bàn) ----------
  async deskActions(deskId) {
    const s = this.session.seats.get(deskId), d = this.app.model.deskById.get(deskId);
    const empOpts = this.employees.filter(e => e.status === 'active').map(e => `<option value="${esc(e.code)}">${esc(e.display)}${e.seat ? ` (đang ở ${esc(e.seat.deskId)})` : ''}</option>`).join('');
    const back = await new Promise(resolve => {
      modal({
        title: `Chỗ ${deskId} · ${this.app.model.floorById.get(d.floor).name}`,
        body: `<p>${s?.owner ? `Chủ chỗ: <b>${esc(s.owner.display)}</b>` : 'Chỗ trống'}${s?.locked ? ' · <b class="err">đang khóa</b>' : ''}</p>
          <div class="row tight wrap">
            ${s?.owner ? '<button type="button" data-d="release" class="danger">Giải phóng chỗ</button>' : ''}
            <button type="button" data-d="lock" class="${s?.locked ? '' : 'danger'}">${s?.locked ? 'Mở khóa chỗ' : 'Khóa chỗ'}</button>
            ${s?.owner ? '<button type="button" data-d="equip">Sửa dụng cụ</button>' : ''}
            <button type="button" data-d="view">Xem trong 3D</button>
            <button type="button" data-d="sit">Ngồi vào chỗ này</button>
          </div>
          ${!s?.owner && !s?.locked ? `<label for="aCode">Gán cho nhân viên</label><select id="aCode"><option value="">— chọn —</option>${empOpts}</select>` : ''}`,
        okText: !s?.owner && !s?.locked ? 'Gán chỗ' : 'Đóng', cancelText: 'Đóng',
        onOk: async b => {
          const sel = b.querySelector('#aCode');
          if (!sel) return true;
          if (!sel.value) return { error: 'Chọn nhân viên.' };
          const r = await api('POST', `/api/admin/seats/${encodeURIComponent(deskId)}/assign`, { code: sel.value });
          if (!r.ok) return { error: r.error };
          toast(`Đã gán ${deskId}.`); this.refresh(); return true;
        }
      }).then(() => resolve(null));
      setTimeout(() => document.querySelectorAll('[data-d]').forEach(btn => btn.onclick = () => { document.querySelector('.modal-back')?.remove(); resolve(btn.dataset.d); }), 0);
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
    const floors = this.app.model.floors;
    $('dashBody').innerHTML = `<div class="row tight wrap"><div class="seg" role="group" aria-label="Tầng">${floors.map(f => `<button data-mf="${f.id}" class="${f.id === this.floor ? 'on' : ''}">${esc(f.name)}</button>`).join('')}</div>
      <span class="legend"><i style="background:#00A35C"></i>Trống <i style="background:#3D4F58"></i>Có chủ <i style="background:#0498EC"></i>Chủ đang online <i style="background:#DB3030"></i>Khóa <i class="pin"></i>Người online</span></div>
      <div id="mapWrap"></div><p class="muted small">Bấm vào bàn để gán, đổi, giải phóng, khóa chỗ hoặc sửa dụng cụ. Bấm vào chấm tròn để camera bám theo người đó.</p>`;
    this.el.querySelectorAll('[data-mf]').forEach(b => b.onclick = () => { this.floor = +b.dataset.mf; this.renderMap(); });
    this.drawMap();
  }
  drawMap() {
    const wrap = $('mapWrap'); if (!wrap) return;
    const m = this.app.model, f = this.floor;
    // khung: bao trọn các vùng đi lại và bàn của tầng (trước đây bỏ vùng rộng > 12 m — toà nhà hiện tại rộng ~22 m nên sơ đồ trống)
    const areas = (m.nav.areas || []).filter(a => a.floor === f), fd = m.desks.filter(d => d.floor === f);
    const xs = [...areas.flatMap(a => [a.x0, a.x1]), ...fd.map(d => d.x)], zs = [...areas.flatMap(a => [a.z0, a.z1]), ...fd.map(d => d.z)];
    if (!xs.length) { wrap.innerHTML = '<p class="muted">Tầng này chưa có dữ liệu.</p>'; return; }
    const x0 = Math.min(...xs) - 0.3, x1 = Math.max(...xs) + 0.3, z0 = Math.min(...zs) - 0.3, z1 = Math.max(...zs) + 0.3;
    // nhìn từ trên, đường phố ở dưới: trục ngang = x, trục dọc = z; co theo bề ngang khung (điện thoại vẫn thấy cả tầng)
    const S = Math.max(16, Math.min(60, ((wrap.clientWidth || 900) - 4) / (x1 - x0))), W = (x1 - x0) * S, H = (z1 - z0) * S, X = x => (x - x0) * S, Z = z => (z - z0) * S;
    let svg = `<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}" role="img" aria-label="Sơ đồ chỗ ngồi ${esc(m.floorById.get(f).name)}">`;
    for (const a of areas) svg += `<rect x="${X(a.x0)}" y="${Z(a.z0)}" width="${(a.x1 - a.x0) * S}" height="${(a.z1 - a.z0) * S}" fill="#0C2A38" stroke="#1C4458"/>`;
    for (const o of m.obstacles.get(f) || []) if (['wall', 'stair', 'stairwell'].includes(o.type)) svg += `<rect x="${X(o.x0)}" y="${Z(o.z0)}" width="${(o.x1 - o.x0) * S}" height="${(o.z1 - o.z0) * S}" fill="${o.type === 'wall' ? '#5C6C75' : '#1C2D38'}"/>`;
    for (const t of m.tables.filter(t => t.floor === f)) svg += `<rect x="${X(t.x - t.w / 2)}" y="${Z(t.z - t.d / 2)}" width="${t.w * S}" height="${t.d * S}" rx="4" fill="#3D4F58"/><text x="${X(t.x)}" y="${Z(t.z) + 4}" text-anchor="middle" font-size="11" fill="#C1C7C6">${esc(t.id)}</text>`;
    for (const d of m.desks.filter(d => d.floor === f)) {
      const s = this.session.seats.get(d.id), fp = footprint(d.x, d.z, d.w || 1, d.d || 0.6, d.facing);
      const on = s?.owner && this.isOnline(s.owner.code);
      const col = s?.locked ? '#DB3030' : on ? '#0498EC' : s?.owner ? '#3D4F58' : '#00A35C';
      const label = s?.owner ? s.owner.display : d.id;
      svg += `<g class="mdesk" data-desk="${esc(d.id)}" tabindex="0" role="button" aria-label="${esc(d.id)}: ${esc(s?.owner ? s.owner.display : s?.locked ? 'khóa' : 'trống')}">
        <rect x="${X(fp.x0)}" y="${Z(fp.z0)}" width="${(fp.x1 - fp.x0) * S}" height="${(fp.z1 - fp.z0) * S}" rx="3" fill="${col}"/>
        <circle cx="${X(d.seat.x)}" cy="${Z(d.seat.z)}" r="6" fill="${col}" opacity=".45"/>
        <text x="${X(d.x)}" y="${Z(d.z) - 2}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fff">${esc(d.id)}</text>
        <text x="${X(d.x)}" y="${Z(d.z) + 9}" text-anchor="middle" font-size="8.5" fill="#fff">${esc(s?.owner ? label.slice(0, 14) : (s?.locked ? 'khóa' : 'trống'))}</text></g>`;
    }
    for (const a of this.session.remote.list) {
      if (a.f !== f) continue;
      svg += `<g class="mpin" data-key="${esc(a.key)}" tabindex="0" role="button" aria-label="Bám theo ${esc(a.display)}"><circle cx="${X(a.x)}" cy="${Z(a.z)}" r="7" fill="#f3a21f" stroke="#fff" stroke-width="2"/><text x="${X(a.x) + 9}" y="${Z(a.z) - 8}" font-size="10" font-weight="700" fill="#E8EDEB">${esc(a.display)}</text></g>`;
    }
    svg += '</svg>';
    if (svg === this._svg) return;
    this._svg = svg; wrap.innerHTML = svg;
    wrap.querySelectorAll('.mdesk').forEach(g => { const go = () => this.deskActions(g.dataset.desk); g.onclick = go; g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }; });
    wrap.querySelectorAll('.mpin').forEach(g => g.onclick = () => { this.toggle(false); this.session.follow(g.dataset.key); });
  }

  // ---------- nhật ký ----------
  async renderAudit() {
    $('dashBody').innerHTML = '<p class="muted">Đang tải…</p>';
    const r = await api('GET', '/api/admin/audit?limit=300');
    if (!r.ok) { $('dashBody').textContent = r.error; return; }
    $('dashBody').innerHTML = `<div class="table-wrap"><table class="dtable"><thead><tr><th>Thời gian</th><th>Người làm</th><th>Thao tác</th><th>Đối tượng</th><th>Chi tiết</th></tr></thead><tbody>${r.audit.map(a => `<tr><td class="small">${fmt(a.ts)}</td><td>${esc(a.actor)}</td><td>${esc(ACTION_LABEL[a.action] || a.action)}</td><td>${esc(a.target || '')}</td><td class="small muted">${esc(a.detail ? JSON.stringify(a.detail).slice(0, 160) : '')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---------- sao lưu ----------
  async renderBackups() {
    const body = $('dashBody');
    body.innerHTML = '<div class="bk"><p class="muted">Đang tải…</p></div>';
    const r = await api('GET', '/api/admin/backups');
    if (this.tab !== 'backup') return;
    if (!r.ok) { body.textContent = r.error; return; }
    const kb = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
    body.innerHTML = `<div class="bk">
      <div class="row tight wrap"><button id="bkNow" class="primary" ${r.enabled ? '' : 'disabled'}>Sao lưu ngay</button>
        <span class="muted small">Tự sao lưu mỗi đêm sau 2 giờ sáng, giữ ${r.keep} bản gần nhất. Thỉnh thoảng hãy tải một bản về máy hoặc Google Drive: bản đó vẫn còn kể cả khi mất server.</span></div>
      ${r.backups.length ? `<div class="table-wrap"><table class="dtable"><thead><tr><th>Thời gian</th><th>Tên file</th><th>Dung lượng</th><th><span class="sr-only">Tải về</span></th></tr></thead><tbody>
        ${r.backups.map(b => `<tr><td class="small">${fmt(b.ts)}</td><td><code>${esc(b.name)}</code></td><td class="small">${kb(b.size)}</td><td><a class="btn" href="/api/admin/backups/${encodeURIComponent(b.name)}" download>Tải về</a></td></tr>`).join('')}
      </tbody></table></div>` : `<p class="muted">${r.enabled ? 'Chưa có bản sao lưu nào.' : 'Database đang chạy trong bộ nhớ (chế độ thử), không sao lưu.'}</p>`}</div>`;
    const btn = $('bkNow');
    if (btn) btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Đang sao lưu…';
      const x = await api('POST', '/api/admin/backups', {});
      if (!x.ok) { toast(x.error, true); btn.disabled = false; btn.textContent = 'Sao lưu ngay'; return; }
      toast(`Đã sao lưu: ${x.backup.name}`);
      this.renderBackups();
    };
  }
}
