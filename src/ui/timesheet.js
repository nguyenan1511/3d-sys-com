// Bảng công theo tháng / năm.
//  - Nhân viên: lịch tháng của mình (mỗi ngày: giờ vào – ra, đúng giờ / muộn / vắng / cuối tuần), tổng hợp; bảng năm 12 tháng.
//  - CEO: tab Hôm nay / Tháng (ma trận nhân viên × ngày, bấm tên xem lịch tháng của người đó) / Năm (nhân viên × 12 tháng).
import { api } from '../net/api.js';
import { esc } from '../session/ui.js';
import { icon } from './icons.js';

const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const hm = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const ymNow = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const ymShift = (ym, k) => { const [y, m] = ym.split('-').map(Number), d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const ymLabel = ym => { const [y, m] = ym.split('-'); return `Tháng ${+m}/${y}`; };
/** Trạng thái một ngày: ok | late | absent | off (nghỉ cuối tuần) | future | today (chưa chấm) */
function dayState(d, r, today, since = '') {
  if (r) return r.lateMin ? 'late' : 'ok';
  if (since && d.day < since) return 'pre';                     // trước ngày vào công ty
  if (!d.past) return 'future';
  if (d.day === today) return 'today';
  return d.work ? 'absent' : 'off';
}
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const summaryHtml = s => `<div class="ts-sum"><div><b>${s.present}</b><span>Ngày đi làm</span></div><div><b>${s.late}</b><span>Đi muộn${s.lateMin ? ` · ${s.lateMin}p` : ''}</span></div><div><b>${s.absent}</b><span>Vắng</span></div><div><b>${s.hours}</b><span>Giờ làm</span></div></div>`;

/** Lịch tháng của một người (dữ liệu từ /attendance/me/month hoặc /admin/attendance/:code/month). */
function calendarHtml(data) {
  const byDay = new Map(data.records.map(r => [r.day, r])), today = todayStr();
  const lead = (data.days[0].dow + 6) % 7; // tuần bắt đầu thứ 2
  const cells = [...Array(lead).fill('<div class="ts-cell blank"></div>'), ...data.days.map(d => {
    const r = byDay.get(d.day), st = dayState(d, r, today, data.since), n = +d.day.slice(8);
    const body = r ? `<span>${hm(r.checkIn)}${r.checkOut ? `–${hm(r.checkOut)}` : ''}</span>${r.lateMin ? `<em>muộn ${r.lateMin}p</em>` : ''}` : st === 'absent' ? '<span>Vắng</span>' : st === 'off' ? '<span>Nghỉ</span>' : st === 'today' ? '<span>Chưa chấm</span>' : '';
    return `<div class="ts-cell ${st}${d.day === today ? ' is-today' : ''}" title="${esc(d.day)}"><b>${n}</b>${body}</div>`;
  })];
  return `<div class="ts-cal"><div class="ts-dow">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(x => `<span>${x}</span>`).join('')}</div><div class="ts-grid">${cells.join('')}</div></div>
    <div class="ts-legend"><i class="ok"></i>Đúng giờ <i class="late"></i>Đi muộn <i class="absent"></i>Vắng <i class="off"></i>Nghỉ</div>`;
}
function yearHtml(data) {
  return `<table class="ts-table"><thead><tr><th>Tháng</th><th>Đi làm</th><th>Muộn</th><th>Vắng</th><th>Giờ làm</th></tr></thead><tbody>
    ${data.months.map(m => `<tr><td>${ymLabel(m.ym)}</td><td>${m.present}/${m.workDays}</td><td>${m.late}</td><td>${m.absent}</td><td>${m.hours}</td></tr>`).join('')}
    <tr class="tot"><td>Cả năm</td><td>${data.summary.present}</td><td>${data.summary.late}</td><td>${data.summary.absent}</td><td>${data.summary.hours}</td></tr></tbody></table>`;
}

// ---------- khung hộp thoại: hiện/ẩn mờ dần; chỉ phần nội dung đổi (giữ chiều cao, chuyển mờ) → không giật khi đổi tháng/năm ----------
function shell(title, cls = '') {
  document.querySelector('.ts-pop')?.remove();
  const pop = document.createElement('div'); pop.className = `ts-pop ${cls}`; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', title);
  pop.innerHTML = `<header><b>${icon('clipboard', 16)} ${esc(title)}</b><button type="button" class="ts-x" aria-label="Đóng">✕</button></header><div class="ts-body"><div class="ts-tabs" role="tablist"></div><div class="ts-nav"><button type="button" data-step="-1" aria-label="Trước">‹</button><b class="ts-label"></b><button type="button" data-step="1" aria-label="Sau">›</button></div><button type="button" class="ts-back" hidden>‹ Tất cả nhân viên</button><div class="ts-content"></div></div>`;
  document.getElementById('appRoot').appendChild(pop);
  requestAnimationFrame(() => pop.classList.add('show'));
  const close = () => { window.removeEventListener('keydown', onEsc, true); pop.classList.remove('show'); setTimeout(() => pop.remove(), 220); };
  const onEsc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onEsc, true);
  pop.querySelector('.ts-x').onclick = close;
  const q = sel => pop.querySelector(sel);
  return { pop, tabs: q('.ts-tabs'), nav: q('.ts-nav'), label: q('.ts-label'), back: q('.ts-back'), content: q('.ts-content') };
}
const cache = new Map();
const fetchCached = async url => { if (cache.has(url)) return cache.get(url); const r = await api('GET', url); if (r.ok) { cache.set(url, r); setTimeout(() => cache.delete(url), 60e3); } return r; };
/** Đổi nội dung: giữ chiều cao cũ, mờ đi, nạp dữ liệu (đã nhớ thì tức thì), hiện lại mượt. Lần gọi cũ bị bỏ nếu có lần mới. */
async function swap(ui, load) {
  const c = ui.content, my = (ui.seq = (ui.seq || 0) + 1);
  c.style.minHeight = c.offsetHeight ? `${c.offsetHeight}px` : ''; c.classList.add('fading');
  const t0 = performance.now(), out = await load();
  if (my !== ui.seq || !c.isConnected) return;
  const wait = Math.max(0, 120 - (performance.now() - t0)); // (cho hiệu ứng mờ đi kịp chạy, tránh chớp)
  setTimeout(() => {
    if (my !== ui.seq) return;
    c.innerHTML = out.html; out.bind?.(c);
    requestAnimationFrame(() => { c.classList.remove('fading'); c.style.minHeight = ''; });
  }, wait);
}
function setTabs(ui, list, cur, onTab) {
  if (!ui.tabs.children.length) {
    ui.tabs.innerHTML = list.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}">${l}</button>`).join('');
    ui.tabs.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => onTab(b.dataset.tab));
  }
  ui.tabs.querySelectorAll('[data-tab]').forEach(b => { const on = b.dataset.tab === cur; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
}

/** Nhân viên: bảng công của tôi (tháng / năm). */
export function openMyTimesheet() {
  cache.clear(); const ui = shell('Bảng công của tôi', 'ts-me');
  let tab = 'month', ym = ymNow(), year = ymNow().slice(0, 4);
  const url = (t, k) => t === 'month' ? `/api/v1/attendance/me/month?ym=${k}` : `/api/v1/attendance/me/year?year=${k}`;
  const render = () => {
    setTabs(ui, [['month', 'Tháng'], ['year', 'Năm']], tab, t => { tab = t; render(); });
    ui.label.textContent = tab === 'month' ? ymLabel(ym) : `Năm ${year}`;
    const k = tab === 'month' ? ym : year;
    swap(ui, async () => { const r = await fetchCached(url(tab, k)); return { html: !r.ok ? `<p class="err">${esc(r.error || 'Không tải được.')}</p>` : summaryHtml(r.summary) + (tab === 'month' ? calendarHtml(r) : yearHtml(r)) }; });
    // tải sẵn kỳ trước/sau để chuyển gần như tức thì
    if (tab === 'month') { fetchCached(url('month', ymShift(ym, -1))); fetchCached(url('month', ymShift(ym, 1))); }
  };
  ui.nav.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { if (tab === 'month') ym = ymShift(ym, +b.dataset.step); else year = String(+year + +b.dataset.step); render(); });
  render();
}

/** CEO: bảng chấm công (hôm nay / tháng / năm). */
export function openAdminTimesheet() {
  cache.clear(); const ui = shell('Bảng chấm công', 'ts-admin');
  let tab = 'month', ym = ymNow(), year = ymNow().slice(0, 4), person = null;
  const render = () => {
    setTabs(ui, [['today', 'Hôm nay'], ['month', 'Tháng'], ['year', 'Năm']], tab, t => { tab = t; person = null; render(); });
    const label = tab === 'month' ? ymLabel(ym) : `Năm ${year}`;
    ui.nav.hidden = tab === 'today'; ui.label.textContent = person ? `${label} · ${person.display}` : label; ui.back.hidden = !person;
    swap(ui, () => load());
    if (tab === 'month' && !person) { fetchCached(`/api/v1/admin/attendance/month?ym=${ymShift(ym, -1)}`); fetchCached(`/api/v1/admin/attendance/month?ym=${ymShift(ym, 1)}`); }
  };
  ui.nav.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { if (tab === 'month') ym = ymShift(ym, +b.dataset.step); else year = String(+year + +b.dataset.step); render(); });
  ui.back.onclick = () => { person = null; render(); };
  const err = r => ({ html: `<p class="err">${esc(r.error || 'Không tải được.')}</p>` });
  async function load() {
    if (tab === 'today') {
      const r = await api('GET', '/api/v1/admin/attendance'); if (!r.ok) return err(r);
      const late = r.list.filter(x => x.lateMin).length;
      return { html: `<div class="ts-sum"><div><b>${r.list.length}</b><span>Đã đến</span></div><div><b>${late}</b><span>Đi muộn</span></div><div><b>${r.absent.length}</b><span>Chưa đến</span></div><div><b>${esc(r.shift)}</b><span>Giờ vào ca</span></div></div>
        <table class="ts-table"><thead><tr><th>Nhân viên</th><th>Vào</th><th>Ra</th><th>Trạng thái</th></tr></thead><tbody>
        ${r.list.map(x => `<tr><td>${esc(x.display)}<small>${esc(x.department || '')}</small></td><td>${hm(x.checkIn)}</td><td>${x.checkOut ? hm(x.checkOut) : '—'}</td><td>${x.lateMin ? `<em class="late">Muộn ${x.lateMin}p</em>` : '<em class="ok">Đúng giờ</em>'}</td></tr>`).join('')}
        ${r.absent.map(x => `<tr class="abs"><td>${esc(x.display)}<small>${esc(x.department || '')}</small></td><td>—</td><td>—</td><td><em>Chưa đến</em></td></tr>`).join('')}
        ${!r.list.length && !r.absent.length ? '<tr><td colspan="4" class="ts-load">Chưa có nhân viên nào.</td></tr>' : ''}</tbody></table>` };
    }
    if (person && tab === 'month') {
      const r = await fetchCached(`/api/v1/admin/attendance/${encodeURIComponent(person.code)}/month?ym=${ym}`);
      return r.ok ? { html: summaryHtml(r.summary) + calendarHtml(r) } : err(r);
    }
    if (tab === 'month') {
      const r = await fetchCached(`/api/v1/admin/attendance/month?ym=${ym}`); if (!r.ok) return err(r);
      const today = todayStr();
      if (!r.employees.length) return { html: '<p class="ts-load">Chưa có nhân viên nào.</p>' };
      return {
        html: `<div class="ts-scroll"><table class="ts-matrix"><thead><tr><th class="nm">Nhân viên</th>${r.days.map(d => `<th class="${d.work ? '' : 'we'}">${+d.day.slice(8)}<small>${DOW[d.dow]}</small></th>`).join('')}<th>Công</th><th>Muộn</th><th>Vắng</th><th>Giờ</th></tr></thead><tbody>
        ${r.employees.map(e => { const by = new Map(e.records.map(x => [x.day, x])); return `<tr><td class="nm"><button type="button" class="ts-person" data-code="${esc(e.code)}" data-display="${esc(e.display)}">${esc(e.display)}</button><small>${esc(e.department || '')}</small></td>${r.days.map(d => { const x = by.get(d.day), st = dayState(d, x, today, e.since); return `<td class="c ${st}" title="${esc(d.day)}${x ? ` · ${hm(x.checkIn)}${x.checkOut ? '–' + hm(x.checkOut) : ''}${x.lateMin ? ` · muộn ${x.lateMin}p` : ''}` : ''}">${st === 'ok' ? '✓' : st === 'late' ? 'M' : st === 'absent' ? '✗' : ''}</td>`; }).join('')}<td><b>${e.summary.present}</b></td><td>${e.summary.late}</td><td>${e.summary.absent}</td><td>${e.summary.hours}</td></tr>`; }).join('')}
        </tbody></table></div><div class="ts-legend"><i class="ok"></i>✓ Đúng giờ <i class="late"></i>M Đi muộn <i class="absent"></i>✗ Vắng <i class="off"></i>Nghỉ · bấm tên để xem lịch tháng</div>`,
        bind: c => c.querySelectorAll('.ts-person').forEach(b => b.onclick = () => { person = { code: b.dataset.code, display: b.dataset.display }; render(); })
      };
    }
    const r = await fetchCached(`/api/v1/admin/attendance/year?year=${year}`); if (!r.ok) return err(r);
    if (!r.employees.length) return { html: '<p class="ts-load">Chưa có nhân viên nào.</p>' };
    return { html: `<div class="ts-scroll"><table class="ts-matrix ts-year"><thead><tr><th class="nm">Nhân viên</th>${Array.from({ length: 12 }, (_, i) => `<th>T${i + 1}</th>`).join('')}<th>Đi làm</th><th>Muộn</th><th>Vắng</th><th>Giờ</th></tr></thead><tbody>
      ${r.employees.map(e => `<tr><td class="nm">${esc(e.display)}<small>${esc(e.department || '')}</small></td>${e.months.map(m => `<td class="c${m.present ? ' has' : ''}" title="${ymLabel(m.ym)}: ${m.present} ngày, muộn ${m.late}, vắng ${m.absent}">${m.present || ''}</td>`).join('')}<td><b>${e.summary.present}</b></td><td>${e.summary.late}</td><td>${e.summary.absent}</td><td>${e.summary.hours}</td></tr>`).join('')}
      </tbody></table></div><p class="ts-note">Số trong ô = số ngày đi làm trong tháng.</p>` };
  }
  render();
}
