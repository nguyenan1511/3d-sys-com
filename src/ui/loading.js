// Màn hình chờ khi vào văn phòng (máy tính và điện thoại): logo SYSONE gốc, thanh tiến trình theo các bước thật
// (tải dữ liệu → dựng toà nhà → nhân vật → chuẩn bị đồ hoạ), giữa hai bước thanh vẫn nhích dần (không đứng hình),
// mẹo sử dụng đổi lần lượt; xong thì mờ dần. Dùng lại cho "Đang tua…" và báo lỗi dựng cảnh.
const TIPS = [
  'Bấm vào sàn để nhân vật tự đi tới — điện thoại thì kéo cần điều khiển ở góc trái.',
  'Phím B (hoặc nút "Về bàn") đưa bạn thẳng về bàn làm việc, khác tầng thì tự đi thang máy.',
  'Ghé máy chấm công cạnh cửa chính để vào ca mỗi sáng.',
  'Chị Mai ở sảnh sẽ dẫn người mới tới bàn và giao việc tuần đầu.',
  'Góc âm nhạc ở phòng giải trí: dán link YouTube, cả công ty cùng nghe.',
  'Kéo trên cảnh để xoay camera, cuộn chuột hoặc chụm hai ngón để phóng to / thu nhỏ.'
];
const $ = id => { const e = document.getElementById(id); if (e && id === 'loading' && e.parentElement !== document.body) document.body.appendChild(e); return e; };   // (đưa ra ngoài #stage: phủ đúng cả màn hình)
let target = 0, shown = 0, cap = 0, raf = 0, tipT = 0, tipI = Math.floor(Math.random() * TIPS.length);

function tick() {
  // tiến gần tới mốc của bước hiện tại; giữa hai bước nhích dần tới trần (cap) để thanh không đứng yên
  if (shown < target) shown += Math.max(0.4, (target - shown) * 0.12);
  else if (shown < cap) shown += (cap - shown) * 0.012;
  shown = Math.min(shown, 100);
  const el = $('loading'); if (!el) return;
  const bar = el.querySelector('.ld-bar i'), pct = el.querySelector('.ld-pct');
  if (bar) bar.style.transform = `scaleX(${shown / 100})`;
  if (pct) pct.textContent = `${Math.round(shown)}%`;
  tipT++; if (tipT % 240 === 0) setTip(tipI + 1);
  if (!el.hidden) raf = requestAnimationFrame(tick);
}
function setTip(i) {
  const t = $('loading')?.querySelector('.ld-tip'); if (!t) return;
  tipI = i % TIPS.length; t.classList.add('swap');
  setTimeout(() => { t.textContent = TIPS[tipI]; t.classList.remove('swap'); }, 220);
}

export const loading = {
  /** Bước mới: text, phần trăm đạt được khi bước này bắt đầu, phần trăm tối đa trước khi sang bước sau. */
  step(text, pct, next = pct + 15) {
    try { performance.mark(`ld:${text}`); } catch { /* */ } // (đo thời gian từng bước: scripts/perf-load.mjs)
    const el = $('loading'); if (!el) return;
    el.hidden = false; el.classList.remove('ld-out', 'ld-error');
    const s = el.querySelector('.ld-step'); if (s) s.textContent = text;
    target = Math.max(target, pct); cap = Math.max(cap, Math.min(98, next));
    const t = el.querySelector('.ld-tip'); if (t && !t.textContent) t.textContent = TIPS[tipI];
    cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
  },
  /** Xong: chạy tới 100% rồi mờ dần. */
  done() {
    try { performance.mark('ld:done'); } catch { /* */ }
    const el = $('loading'); if (!el) return;
    target = cap = 100;
    setTimeout(() => { el.classList.add('ld-out'); setTimeout(() => { el.hidden = true; el.classList.remove('ld-out'); cancelAnimationFrame(raf); }, 420); }, 260);
  },
  /** Báo nhanh trên nền mờ (vd. "Đang tua…"), không thanh tiến trình. */
  flash(text) { const el = $('loading'); if (!el) return; el.hidden = false; el.classList.add('ld-quick'); const s = el.querySelector('.ld-step'); if (s) s.textContent = text; },
  hideFlash() { const el = $('loading'); if (!el) return; el.hidden = true; el.classList.remove('ld-quick'); },
  /** Báo lỗi trên màn hình chờ. retry: hiện nút "Thử lại" (tải lại trang); hint: dòng gợi ý thay cho mẹo. */
  error(text, { retry = true, hint = '' } = {}) {
    const el = $('loading'); if (!el) return;
    el.hidden = false; el.classList.remove('ld-out', 'ld-quick'); el.classList.add('ld-error'); cancelAnimationFrame(raf);
    const s = el.querySelector('.ld-step'); if (s) s.textContent = text;
    const t = el.querySelector('.ld-tip'); if (t) t.textContent = hint || 'Kiểm tra kết nối mạng rồi thử lại. Nếu vẫn lỗi, thử trình duyệt khác (Chrome, Safari, Edge bản mới).';
    let b = el.querySelector('.ld-retry');
    if (retry && !b) { b = document.createElement('button'); b.type = 'button'; b.className = 'ld-retry'; b.textContent = 'Thử lại'; b.onclick = () => location.reload(); el.querySelector('.ld-card')?.appendChild(b); }
    if (b) { b.hidden = !retry; if (retry) b.focus({ preventScroll: true }); }
  }
};
