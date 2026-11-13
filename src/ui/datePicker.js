// Lịch tháng chọn ngày (giờ Việt Nam) — thay cho ô ngày / giờ mặc định của trình duyệt. Tuần bắt đầu từ Thứ 2; hôm nay có
// vòng viền; ngày ngoài [min, max] mờ, không bấm được; ngày có lịch (marks) hiện chấm nhỏ (nhiều lịch: 2–3 chấm).
// Bàn phím: ← → ↑ ↓ đổi ngày, PageUp / PageDown đổi tháng, Home / End đầu / cuối tuần, Enter chọn.
import { icon } from './icons.js';

const VN = 7 * 3600e3, DAY = 86400e3;
export const vnDay = t => Math.floor((t + VN) / DAY) * DAY - VN;            // 00:00 giờ VN của ngày chứa t
const parts = t => { const d = new Date(t + VN); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: (d.getUTCDay() + 6) % 7 }; };
const dayOf = (y, m, d) => Date.UTC(y, m, d) - VN;
const WD = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
export const fmtLong = t => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' }).format(t);

export class DatePicker {
  /** opts: { value, min, max, marks: Map<ngày, số lịch>, onPick(ngày), label } */
  constructor(host, opts = {}) {
    this.host = host; this.o = opts; this.value = vnDay(opts.value ?? Date.now()); this.focus = this.value;
    const p = parts(this.value); this.view = { y: p.y, m: p.m };
    host.classList.add('dp');
    host.addEventListener('click', e => {
      const nav = e.target.closest('[data-nav]'); if (nav) { this.shift(+nav.dataset.nav); return; }
      const b = e.target.closest('[data-d]'); if (b && !b.disabled) this.pick(+b.dataset.d);
    });
    host.addEventListener('keydown', e => this.key(e));
    this.render();
  }
  ok(t) { return (this.o.min == null || t >= vnDay(this.o.min)) && (this.o.max == null || t <= vnDay(this.o.max)); }
  setMarks(m) { this.o.marks = m; this.render(); }
  set(t) { this.value = this.focus = vnDay(t); const p = parts(this.value); this.view = { y: p.y, m: p.m }; this.render(); }
  pick(t) { if (!this.ok(t)) return; this.value = this.focus = t; this.render(true); this.o.onPick?.(t); }
  shift(n) { let { y, m } = this.view; m += n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; this.view = { y, m }; this.render(); }
  render(keepFocus = false) {
    const { y, m } = this.view, first = dayOf(y, m, 1), start = first - parts(first).wd * DAY, today = vnDay(Date.now());
    const title = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', month: 'long', year: 'numeric' }).format(first);
    const canPrev = this.o.min == null || dayOf(y, m, 1) > vnDay(this.o.min), canNext = this.o.max == null || dayOf(y, m + 1, 1) <= vnDay(this.o.max);
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const t = start + i * DAY, p = parts(t), inMonth = p.m === m, ok = this.ok(t), n = this.o.marks?.get(t) || 0;
      if (i === 35 && !inMonth) break;   // (tháng chỉ cần 5 hàng)
      cells += `<button type="button" role="gridcell" data-d="${t}" class="${inMonth ? '' : 'out '}${t === today ? 'today ' : ''}${t === this.value ? 'sel ' : ''}${p.wd >= 5 ? 'we' : ''}" ${ok ? '' : 'disabled'} tabindex="${t === this.focus ? 0 : -1}" aria-selected="${t === this.value}" aria-label="${fmtLong(t)}${n ? ` · ${n} lịch họp` : ''}${t === today ? ' (hôm nay)' : ''}">${p.d}${n ? `<i class="dp-dots" aria-hidden="true">${'<b></b>'.repeat(Math.min(3, n))}</i>` : ''}</button>`;
    }
    this.host.innerHTML = `<div class="dp-h"><button type="button" class="dp-nav" data-nav="-1" aria-label="Tháng trước" ${canPrev ? '' : 'disabled'}>${icon('chevLeft', 16)}</button><b aria-live="polite">${title[0].toUpperCase() + title.slice(1)}</b><button type="button" class="dp-nav" data-nav="1" aria-label="Tháng sau" ${canNext ? '' : 'disabled'}>${icon('chevLeft', 16, 'flip')}</button></div>
      <div class="dp-wd" aria-hidden="true">${WD.map(w => `<span>${w}</span>`).join('')}</div>
      <div class="dp-grid" role="grid" aria-label="${this.o.label || 'Chọn ngày'}">${cells}</div>`;
    if (keepFocus) this.host.querySelector(`[data-d="${this.focus}"]`)?.focus();
  }
  key(e) {
    const b = e.target.closest('[data-d]'); if (!b) return;
    const t = +b.dataset.d, wd = parts(t).wd;
    const to = { ArrowLeft: t - DAY, ArrowRight: t + DAY, ArrowUp: t - 7 * DAY, ArrowDown: t + 7 * DAY, Home: t - wd * DAY, End: t + (6 - wd) * DAY }[e.key];
    if (e.key === 'PageUp' || e.key === 'PageDown') { const p = parts(t), n = e.key === 'PageUp' ? -1 : 1; this.focus = dayOf(p.y, p.m + n, Math.min(p.d, 28)); }
    else if (to != null) this.focus = to;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); this.pick(t); return; }
    else return;
    e.preventDefault(); e.stopPropagation();
    const p = parts(this.focus); this.view = { y: p.y, m: p.m }; this.render(true);
  }
}
