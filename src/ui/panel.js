// Bảng điều khiển: đồng hồ, tốc độ, danh sách nhân viên (lọc/tìm), thẻ thông tin, thống kê, lỗi, CSV.
import { fmtTime, parseTime } from '../core/util.js';
import { ST_LABEL } from '../sim/sim.js';

export const STATE_COLOR = {
  outside: '#9aa0a6', arriving: '#4f8f4a', walking: '#2a9d8f', working: '#2f6db5', pantry: '#d9822b', meeting: '#6b4aa5',
  lunch: '#e0b030', wc: '#b5838d', leaving: '#c2402f', gone: '#c8ccd2'
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Panel {
  constructor(app) {
    this.app = app;
    this.selected = null;
    this._lastList = 0;
    // ngăn kéo bên phải: trượt ra/vào bằng hiệu ứng (transform), đè lên cảnh — không đổi kích thước canvas nên cảnh không giật
    const setDrawer = open => { const p = $('panel'), t = $('panelToggle'); p.classList.toggle('collapsed', !open); t.setAttribute('aria-expanded', String(open)); t.title = open ? 'Đóng bảng điều khiển' : 'Mở bảng điều khiển (góc nhìn, tầng, chỗ ngồi…)'; localStorage.setItem('sysone.drawer', open ? '1' : '0'); };
    // nút mũi tên đặt ngoài ngăn kéo (ngăn kéo có transform nên position: fixed bên trong sẽ bị tính theo ngăn kéo)
    document.getElementById('main').appendChild($('panelToggle'));
    $('panelToggle').onclick = () => setDrawer($('panel').classList.contains('collapsed'));
    // điện thoại: luôn bắt đầu thu gọn (ngăn kéo che gần hết màn hình)
    setDrawer(matchMedia('(max-width: 760px), (max-height: 500px) and (max-width: 1100px)').matches ? false : localStorage.getItem('sysone.drawer') !== '0');
    $('play').onclick = () => { app.paused = !app.paused; this.syncSpeed(); };
    document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { app.speed = +b.dataset.speed; app.paused = false; this.syncSpeed(); });
    $('jump').onchange = e => { const v = e.target.value; if (v) { app.jump(parseTime(v)); e.target.value = ''; } };
    $('search').oninput = () => this.renderList(true);
    $('dept').onchange = () => this.renderList(true);
    ['dPaths', 'dDesks', 'dGrid'].forEach((id, i) => $(id).onchange = e => app.debug.setVisible(['paths', 'desks', 'grid'][i], e.target.checked));
    $('csv').onchange = async e => { const f = e.target.files[0]; if (f) { app.importCsv(await f.text(), f.name); e.target.value = ''; } };
    $('csvOut').onclick = () => app.exportCsv();
    this.syncSpeed();
  }

  syncSpeed() {
    const app = this.app;
    $('play').textContent = app.paused ? '▶' : '⏸';
    $('play').setAttribute('aria-label', app.paused ? 'Chạy tiếp' : 'Tạm dừng');
    document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', !app.paused && +b.dataset.speed === app.speed));
  }

  setDepartments(list) {
    const sel = $('dept');
    sel.innerHTML = '<option value="">Mọi phòng ban</option>' + list.map(d => `<option>${esc(d)}</option>`).join('');
  }

  showErrors(errors, warnings) {
    const el = $('errors');
    if (!errors.length && !warnings.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = (errors.length ? `<h2>Lỗi dữ liệu (${errors.length})</h2><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '')
      + (warnings.length ? `<h2 class="warn">Lưu ý (${warnings.length})</h2><ul class="warn">${warnings.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '');
  }

  renderList(force) {
    const app = this.app, sim = app.sim;
    const q = $('search').value.trim().toLowerCase().normalize('NFC'), dept = $('dept').value;
    const all = app.staff.employees;
    const rows = all.filter(e => (!dept || e.department === dept) && (!q || `${e.name} ${e.id} ${e.deskId || ''} ${e.role}`.toLowerCase().normalize('NFC').includes(q)));
    const key = rows.map(e => e.id).join(',');
    const ul = $('empList');
    if (force || key !== this._key) {
      this._key = key;
      ul.innerHTML = rows.map(e => `<li role="option" data-id="${esc(e.id)}" class="${e.status === 'ok' ? '' : 'bad'}"><span class="dot"></span><span><span class="nm">${esc(e.name)}</span><br><span class="sub">${esc(e.role)} · ${esc(e.deskId || 'chưa có bàn')}</span></span><span class="st"></span></li>`).join('');
      ul.querySelectorAll('li').forEach(li => li.onclick = () => { const a = sim.byId.get(li.dataset.id); if (a) app.select(a, true); });
    }
    $('empCount').textContent = `(${rows.length}/${all.length})`;
    ul.querySelectorAll('li').forEach(li => {
      const a = sim.byId.get(li.dataset.id);
      const st = a ? a.state : 'outside';
      li.querySelector('.dot').style.background = a ? STATE_COLOR[st] : '#e0553f';
      li.querySelector('.st').textContent = a ? a.label : 'không vào mô hình';
      li.setAttribute('aria-selected', String(this.selected === a && !!a));
    });
  }

  renderStats() {
    const app = this.app, s = app.sim.summary();
    const cells = [['Ngoài', s.outside], ...app.model.floors.map(f => [f.name.replace('Tầng ', 'T.').replace('T.trệt', 'Trệt'), s.byFloor.get(f.id) || 0]), ['Cầu thang', s.byFloor.get(-1) || 0]];
    $('floorStats').innerHTML = cells.map(([k, v]) => `<div><b>${v}</b><span>${esc(k)}</span></div>`).join('');
    $('stateStats').innerHTML = Object.keys(ST_LABEL).filter(k => s.byState[k]).map(k => `<span class="chip"><span class="dot" style="background:${STATE_COLOR[k]}"></span>${ST_LABEL[k]} <b>${s.byState[k]}</b></span>`).join('');
  }

  renderClock() {
    const app = this.app;
    const t = fmtTime(app.sim.t, true);
    $('clock').textContent = t.slice(0, 5);
    $('day').textContent = `Ngày ${app.sim.day + 1}${app.paused ? ' · tạm dừng' : ` · x${app.speed}`}`;
    $('clockOverlay').textContent = `${t} · x${app.paused ? 0 : app.speed}`;
  }

  renderCard() {
    const a = this.selected, el = $('card');
    if (!a) { el.hidden = true; return; }
    el.hidden = false;
    const e = a.emp, next = a.plan.acts[a.ai];
    const nextTxt = next ? `${{ meeting: 'Họp', pantry: 'Giải lao', wc: 'WC', lunch: 'Ăn trưa' }[next.type]} lúc ${fmtTime(next.t)}` : `Về lúc ${fmtTime(a.plan.leave)}`;
    const floorName = a.onStair ? 'Cầu thang' : (a.visible && a.z < 9 ? this.app.model.floorById.get(a.f).name : 'Ngoài');
    const html = `<h3>${esc(e.name)}</h3><div class="muted">${esc(e.role)} · ${esc(e.department)}</div>
      <dl><dt>Mã</dt><dd>${esc(e.id)}</dd><dt>Bàn</dt><dd>${esc(e.deskId)} (${esc(this.app.model.floorById.get(a.desk.floor).name)})</dd>
      <dt>Trạng thái</dt><dd><span class="dot" style="background:${STATE_COLOR[a.state]}"></span> ${esc(a.label)}</dd><dt>Vị trí</dt><dd>${esc(floorName)}</dd>
      <dt>Ca</dt><dd>${esc(e.shift.arrive)}–${esc(e.shift.leave)} (hôm nay đến ${fmtTime(a.plan.arrive)})</dd><dt>Tiếp theo</dt><dd>${esc(nextTxt)}</dd></dl>
      <div class="actions"><button id="cardFollow">${this.app.rig.follow === a ? 'Bỏ bám theo' : 'Bám theo'}</button><button id="cardClose">Đóng</button></div>`;
    if (html !== this._card) {
      this._card = html; el.innerHTML = html;
      $('cardFollow').onclick = () => this.app.select(a, this.app.rig.follow !== a);
      $('cardClose').onclick = () => this.app.select(null);
    }
  }

  tick(now) {
    this.renderClock();
    if (now - this._lastList > 400) { this._lastList = now; this.renderList(false); this.renderStats(); this.renderCard(); }
  }
}
