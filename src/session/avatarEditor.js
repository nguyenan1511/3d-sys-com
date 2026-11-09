// "Nhân vật của tôi": chỉnh nhân vật của CHẾ ĐỘ ĐANG XEM (2D hoặc 3D) — mỗi chế độ 2 nhân vật Nữ/Nam, cài đặt tách riêng:
//  - 2D: nhân vật pixel (public/data/pixel-characters.json) + màu tóc/da/áo/quần/giày, kiểu áo (khoá px*).
//    Sân khấu là góc văn phòng pixel, nhân vật đi vòng quanh để xem đủ bốn hướng.
//  - 3D: nhân vật chibi của my-office (public/data/characters.json, format 'mo') + màu tóc/da/áo/quần/giày.
//    Sân khấu là cảnh 3D: nhân vật thở, chớp mắt, xoay nhẹ.
// Lưu bằng API (appearance.json), server kiểm tra lại.
import { moBase, moSpec, moPortrait, onSpritesBaked } from '../pixel/moSprite.js';
import * as THREE from 'three';
import { drawCharacter } from '../pixel/sprites.js';
import { AvatarSystem } from '../agents/avatars.js';
import { characterDef } from '../agents/glbCharacters.js';
import { custom, VIEW, ENABLE_2D } from '../pixel/billboard.js';
import { defaultEquipment, normalizeBySchema } from '../shared/equipment.js';
import { esc } from './ui.js';
import { icon } from '../ui/icons.js';

let charsPromise = null;
const loadChars = () => (charsPromise ??= fetch(new URL('data/pixel-characters.json', document.baseURI)).then(r => r.json()).then(d => d.characters));

// ---------- góc văn phòng pixel (vẽ bằng ô 1 điểm ảnh, phóng to) ----------
function drawRoom(ctx, W, H, P, t) {
  ctx.imageSmoothingEnabled = false;
  const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x * P), Math.round(y * P), Math.round(w * P), Math.round(h * P)); };
  const cols = Math.ceil(W / P), rows = Math.ceil(H / P);
  // tường + cửa sổ đêm
  px(0, 0, cols, 22, '#6f6763'); px(0, 20, cols, 2, '#5c5450');
  for (const wx of [6, cols - 26]) {
    px(wx - 1, 3, 22, 14, '#2b2d42'); px(wx, 4, 20, 12, '#1d2347');
    for (const [sx, sy] of [[3, 3], [12, 7], [16, 3], [7, 9]]) px(wx + sx, 4 + sy, 1, 1, '#c9d6ff');
    px(wx + 15, 5, 3, 3, '#f4e7a1'); px(wx + 16, 5, 2, 2, '#1d2347');
    px(wx + 9, 4, 1, 12, '#2b2d42'); px(wx, 9, 20, 1, '#2b2d42');
  }
  // sàn gạch
  px(0, 22, cols, rows - 22, '#b8aa9d');
  ctx.fillStyle = 'rgba(43,45,66,.07)';
  for (let x = 0; x < cols; x += 8) ctx.fillRect(x * P, 22 * P, Math.max(1, P / 2), H);
  for (let y = 22; y < rows; y += 8) ctx.fillRect(0, y * P, W, Math.max(1, P / 2));
  // cây
  const plant = (x, y) => { px(x + 1, y + 7, 6, 5, '#a85c3c'); px(x + 1, y + 7, 6, 1, '#8a4a30'); px(x, y + 1, 8, 6, '#4f9a4a'); px(x + 2, y, 4, 2, '#5fb35a'); px(x + 1, y + 2, 2, 2, '#6cc466'); };
  plant(3, 23); plant(cols - 11, 23);
  // bàn làm việc có màn hình + đèn
  const dx = Math.round(cols / 2) - 12, dy = rows - 22;
  px(dx, dy, 24, 9, '#8a5a3c'); px(dx, dy, 24, 2, '#a8714c'); px(dx + 2, dy + 9, 2, 3, '#5c3d2a'); px(dx + 20, dy + 9, 2, 3, '#5c3d2a');
  px(dx + 7, dy - 6, 10, 7, '#2b2d42'); px(dx + 8, dy - 5, 8, 5, '#3d7fd6'); px(dx + 9, dy - 4, 4, 1, '#bfe3ff');
  px(dx + 19, dy - 3, 2, 3, '#f2c230'); ctx.fillStyle = `rgba(242,194,48,${0.18 + 0.06 * Math.sin(t * 3)})`; ctx.fillRect((dx + 15) * P, (dy - 1) * P, 10 * P, 4 * P);
  px(dx + 9, dy + 12, 6, 4, '#4a4d5c'); px(dx + 9, dy + 12, 6, 1, '#5c6070'); // ghế
}

/**
 * Mở màn hình chọn nhân vật. opts: { schema, look, display, title, required, save(look) -> {ok,error} }.
 * Trả về Promise<look|null>.
 */
// khoá cài đặt theo chế độ: nhân vật, các phần màu (kiểu áo theo nhân vật, không chọn riêng)
const MODES = {
  '2d': { sel: 'pixel', parts: [['pxHairColor', 'Tóc', 'hair'], ['pxSkinColor', 'Da', 'skin'], ['pxTopColor', 'Áo', 'shirt'], ['pxBottomColor', 'Quần', 'pants'], ['pxShoeColor', 'Giày', 'shoes']] },
  '3d': { sel: 'model', parts: [['hairColor', 'Tóc'], ['skinColor', 'Da'], ['topColor', 'Áo'], ['bottomColor', 'Quần'], ['shoeColor', 'Giày']] }
};

export function openAvatarEditor({ schema, look, display, title, required = false, save }) {
  return new Promise(resolve => {
    const value = normalizeBySchema(schema, { ...defaultEquipment(schema), ...(look || {}) }).value;
    const item = (k) => schema.items.find(i => i.key === k);
    const mode = VIEW.mode === '3d' && item('model') ? '3d' : '2d', M = MODES[mode];
    const selItem = item(M.sel), styleItem = M.style && item(M.style);
    const parts = M.parts.filter(([k]) => item(k));
    let part = parts[2]?.[0] || parts[0]?.[0]; // mở sẵn phần "Áo"
    const head = title || (required ? 'Chọn nhân vật của bạn' : 'Nhân vật của bạn');
    const back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<div class="modal charsel pxsel av2" role="dialog" aria-modal="true" aria-labelledby="avTitle">
      <header class="cs-head"><div><h2 id="avTitle">${esc(head)}</h2>
        <p class="av-mode">${icon(mode === '3d' ? 'cube' : 'map', 14)}<span>${ENABLE_2D ? `Đang chỉnh nhân vật <b>${mode.toUpperCase()}</b> · đổi chế độ ở góc trên trái để chỉnh bản ${mode === '3d' ? '2D' : '3D'}` : 'Chọn nhân vật 3D và màu trang phục — logo SYSONE luôn có trên áo'}</span></p></div>
        ${required ? '' : '<button type="button" class="cs-x" id="avCancel" aria-label="Đóng" title="Đóng (Esc)">✕</button>'}</header>
      <div class="cs-body">
        <div class="cs-stage px-stage"><canvas id="avCanvas" aria-label="Nhân vật của bạn"></canvas>
          <div class="av-loading" hidden><span class="spin" aria-hidden="true"></span>Đang tải nhân vật…</div>
          <div class="cs-name px-name"><span>${esc(display || '')}</span></div></div>
        <div class="cs-side">
          <div class="av-step"><span class="av-n">1</span>Chọn nhân vật</div>
          <div class="av-who ${mode === '2d' ? 'px-cards' : 'm3-cards'}" role="radiogroup" aria-label="Chọn nhân vật">${selItem.options.map((o, k) => mode === '2d'
            ? `<label class="px-card" data-kind="${esc(o.value)}"><input type="radio" name="av_sel" value="${k}" ${o.value === value[M.sel] ? 'checked' : ''}><span><canvas width="72" height="96" aria-hidden="true"></canvas><b>${esc(o.label)}</b></span></label>`
            : `<label class="m3-card" data-m3="${esc(o.value)}"><input type="radio" name="av_sel" value="${k}" ${o.value === value[M.sel] ? 'checked' : ''}><span><canvas width="144" height="200" aria-hidden="true"></canvas><b>${esc(characterDef(o.value)?.name || o.label)}</b></span></label>`).join('')}</div>
          ${styleItem ? `<div class="av-step"><span class="av-n">2</span>Kiểu áo</div>
          <div class="av-chips" data-k="${M.style}" role="radiogroup" aria-label="Kiểu áo">${styleItem.options.map(o =>
            `<button type="button" class="cz-chip${(value[M.style] || '') === o.value ? ' on' : ''}" data-v="${esc(o.value)}" role="radio" aria-checked="${(value[M.style] || '') === o.value}">${esc(o.value ? o.label : 'Theo nhân vật')}</button>`).join('')}</div>` : ''}
          <div class="av-step av-colors"><span class="av-n">${styleItem ? 3 : 2}</span>Màu sắc</div>
          <p class="muted small av-nocolor" hidden>Nhân vật này giữ màu và trang phục gốc.</p>
          <div class="av-parts" role="tablist" aria-label="Phần cần đổi màu">${parts.map(([k, label]) =>
            `<button type="button" role="tab" class="av-part" data-part="${k}"><i class="av-swatch" aria-hidden="true"></i>${esc(label)}</button>`).join('')}</div>
          <div class="av-palette" role="radiogroup"></div>
        </div>
      </div>
      <p class="err" id="avErr" role="alert"></p>
      <footer class="cs-foot">
        <button type="button" class="ghost av-act" id="avReset">${icon('reset', 15)}Đặt lại</button>
        <button type="button" class="ghost av-act" id="avRandom">${icon('shuffle', 15)}Ngẫu nhiên</button>
        <span class="grow"></span><button type="button" id="avSave" class="primary">${required ? 'Vào văn phòng' : 'Lưu nhân vật'}<span aria-hidden="true">→</span></button></footer></div>`;
    document.getElementById('modalRoot').appendChild(back);

    const canvas = back.querySelector('#avCanvas'), loadingEl = back.querySelector('.av-loading');
    let chars = [], spec = null, raf = 0, closed = false, r3 = null, ctx = null;
    const baseSpec = () => chars.find(c => c.id === value.pixel);

    // ---- màu sắc: chọn phần → một bảng màu ----
    const partSwatch = k => {
      if (value[k]) return value[k];
      if (mode === '2d') { const p = M.parts.find(x => x[0] === k); const b = baseSpec(); return b && p ? b[p[2]] : null; }
      return null; // 3D: màu gốc của model
    };
    const renderParts = () => back.querySelectorAll('.av-part').forEach(b => {
      const k = b.dataset.part, c = partSwatch(k), on = k === part;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', on);
      const sw = b.querySelector('.av-swatch'); sw.style.background = c || ''; sw.classList.toggle('orig', !c); sw.title = c ? c : 'Màu gốc';
    });
    const renderPalette = () => {
      const it = item(part), pal = back.querySelector('.av-palette');
      pal.setAttribute('aria-label', it.label);
      pal.innerHTML = `<button type="button" class="cz-chip cz-def${!value[part] ? ' on' : ''}" data-v="" role="radio" aria-checked="${!value[part]}">Màu gốc</button>` +
        it.options.map(c => `<button type="button" class="cz-dot${value[part] === c ? ' on' : ''}" data-v="${c}" style="--c:${c}" role="radio" aria-checked="${value[part] === c}" aria-label="${esc(it.label)} ${c}" title="${c}"></button>`).join('');
      pal.querySelectorAll('button').forEach(btn => btn.onclick = () => { value[part] = btn.dataset.v; changed(); renderPalette(); });
    };
    back.querySelectorAll('.av-part').forEach(b => b.onclick = () => { part = b.dataset.part; renderParts(); renderPalette(); });
    back.querySelectorAll('.av-chips button').forEach(btn => btn.onclick = () => { value[M.style] = btn.dataset.v; changed(); });
    const renderChips = () => back.querySelectorAll('.av-chips button').forEach(b => { const on = (value[M.style] || '') === b.dataset.v; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    let drawCards = () => {};
    function changed() {
      const b = baseSpec(); if (b) spec = custom(b, value);
      // mọi nhân vật (pixel 2D, chibi my-office 3D) đều đổi màu được
      const canColor = mode === '2d' || characterDef(value.model)?.format === 'mo';
      back.querySelector('.av-nocolor').hidden = canColor;
      for (const el of back.querySelectorAll('.av-parts, .av-palette')) el.hidden = !canColor;
      renderParts(); renderChips(); drawCards(); sync3d();
    }
    back.querySelectorAll('[name=av_sel]').forEach(r => r.onchange = () => { if (r.checked) { value[M.sel] = selItem.options[+r.value].value; hop = 0; changed(); } });
    back.querySelector('#avReset').onclick = () => { if (M.style) value[M.style] = ''; for (const [k] of parts) value[k] = ''; changed(); renderPalette(); };
    back.querySelector('#avRandom').onclick = () => {
      const pick = a => a[Math.floor(Math.random() * a.length)];
      if (styleItem) value[M.style] = pick(styleItem.options.filter(o => o.value && o.value !== 'dress')).value;
      for (const [k] of parts) value[k] = Math.random() < 0.25 ? '' : pick(item(k).options);
      changed(); renderPalette();
    };

    // ---- sân khấu ----
    const fit = () => {
      const r = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
      if (r3) { r3.renderer.setPixelRatio(r); r3.renderer.setSize(w, h, false); r3.cam.aspect = w / h; r3.cam.updateProjectionMatrix(); }
      else { canvas.width = w * r; canvas.height = h * r; }
    };
    const ro = new ResizeObserver(fit); ro.observe(canvas);
    const path = [['down', 0.3, 0.5, 0.3, 0.68], ['right', 0.3, 0.68, 0.72, 0.68], ['up', 0.72, 0.68, 0.72, 0.5], ['left', 0.72, 0.5, 0.3, 0.5]]; // vòng trên sàn trống, không đi xuyên bàn
    let hop = -1;
    const ag = { key: 'preview', visible: true, x: 0, y: 0, z: 0, yaw: Math.PI, sit: 0, walkAmt: 0, walkPhase: 0, anim: 'idle', animT: 1, idx: 0, emp: { look: {} } };
    function sync3d() { if (mode === '3d') ag.emp.look = { model: value.model, ...Object.fromEntries(MODES['3d'].parts.map(([k]) => [k, value[k] || ''])) }; }
    if (mode === '3d') {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b1a4, 2.4)); const sun = new THREE.DirectionalLight(0xfff3dc, 1.9); sun.position.set(-2, 5, 4); scene.add(sun);
      const amb = new THREE.AmbientLight(0xffffff, 0.3); scene.add(amb); // bù nhẹ đèn trần văn phòng
      scene.add(new THREE.Mesh(new THREE.CircleGeometry(0.5, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2b2d42, transparent: true, opacity: 0.1 })));
      r3 = { renderer, scene, amb, cam: new THREE.PerspectiveCamera(24, 1, 0.05, 20), sys: new AvatarSystem(scene, 1, 'high', { scale: 1 }) };
      canvas.classList.add('av3d'); sync3d();
    } else ctx = canvas.getContext('2d');
    fit();
    const loop = now => {
      if (closed) return;
      raf = requestAnimationFrame(loop);
      const t = now / 1000;
      if (r3) {
        ag.yaw = Math.PI + 0.4 * Math.sin(t * 0.45); // xoay nhẹ để xem hai bên
        const lk = JSON.stringify(ag.emp.look); if (lk !== r3.lk) { r3.lk = lk; r3.sys.setColors([ag]); } // tô màu theo ngoại hình
        r3.sys.update([ag]);
        loadingEl.hidden = true; // nhân vật chibi my-office dựng bằng code: hiện ngay, không phải tải
        // khung hình theo chiều cao nhân vật, chuyển mượt khi đổi
        const Ht = (characterDef(value.model)?.height || 1.86) * 1.15;
        r3.Hm = r3.Hm == null ? Ht : r3.Hm + (Ht - r3.Hm) * 0.15;
        const Hm = r3.Hm;
        r3.cam.position.set(0, Hm * 0.6, Hm * 2.55); r3.cam.lookAt(0, Hm * 0.5, 0);
        const every = window.__RENDER_EVERY_MS || 0; // (kiểm thử trên GPU giả lập: vẽ thưa)
        if (!every || now - (r3.lastDraw || 0) >= every) { r3.lastDraw = now; r3.renderer.render(r3.scene, r3.cam); }
        return;
      }
      const W = canvas.width, H = canvas.height, P = Math.max(2, Math.floor(H / 70));
      drawRoom(ctx, W, H, P, t);
      if (!spec) return;
      const leg = 2.2, pause = 0.6, cyc = (leg + pause) * 4, u = t % cyc, i = Math.floor(u / (leg + pause)), k = Math.min(1, (u - i * (leg + pause)) / leg);
      const [face, x0, y0, x1, y1] = path[i], moving = k < 1;
      const frame = moving ? 1 + (Math.floor(t * 6) % 2) : 0;
      let y = (y0 + (y1 - y0) * k) * H;
      if (hop >= 0) { hop += 1 / 60; y -= Math.sin(Math.min(1, hop / 0.35) * Math.PI) * P * 6; if (hop > 0.35) hop = -1; }
      drawCharacter(ctx, spec, (x0 + (x1 - x0) * k) * W, y, P, moving ? face : 'down', frame); // cùng cỡ điểm ảnh với căn phòng
    };
    loadChars().then(list => {
      if (closed) return;
      chars = (item('pixel')?.options || []).map(o => o.value.startsWith('mo-') ? (characterDef(o.value) && moBase(characterDef(o.value))) : list.find(c => c.id === o.value)).filter(Boolean);
      if (!chars.some(c => c.id === value.pixel)) value.pixel = item('pixel')?.default || chars[0]?.id;
      if (mode === '3d') drawCards = () => back.querySelectorAll('.m3-card').forEach(card => {
        const def = characterDef(card.dataset.m3); if (!def) return;
        const on = card.dataset.m3 === value.model, cols = on ? { topColor: value.topColor || '', bottomColor: value.bottomColor || '', shoeColor: value.shoeColor || '', hairColor: value.hairColor || '', skinColor: value.skinColor || '' } : {};
        const src = moPortrait(moSpec(def, cols, '')), cv = card.querySelector('canvas'), cx = cv.getContext('2d');
        if (!src) { card.classList.add('loading'); return; }      // (đang dựng chân dung: hiện khung mờ)
        card.classList.remove('loading'); cx.clearRect(0, 0, cv.width, cv.height); cx.drawImage(src, 0, 0, cv.width, cv.height);
      });
      if (mode === '2d') drawCards = () => back.querySelectorAll('.px-card').forEach((card, k) => {
        const cv = card.querySelector('canvas'), cx = cv.getContext('2d');
        cx.fillStyle = '#b8aa9d'; cx.fillRect(0, 0, 72, 96); cx.fillStyle = 'rgba(43,45,66,.07)'; for (let x = 0; x < 72; x += 12) cx.fillRect(x, 0, 1, 96);
        drawCharacter(cx, custom(chars[k], value), 36, 88, 3, 'down', 0);
      });
      changed();
    });
    renderParts(); renderPalette(); renderChips();
    const offBaked = onSpritesBaked(() => { if (!closed) drawCards(); }); // ô chọn nhân vật 2D: vẽ lại khi sprite nướng xong
    raf = requestAnimationFrame(loop);

    const close = v => { closed = true; offBaked(); cancelAnimationFrame(raf); ro.disconnect(); if (r3) { r3.renderer.dispose(); r3.renderer.forceContextLoss(); } back.remove(); resolve(v); };
    back.querySelector('#avCancel')?.addEventListener('click', () => close(null));
    if (!required) back.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
    back.querySelector('#avSave').onclick = async () => {
      const btn = back.querySelector('#avSave'); btn.disabled = true;
      const r = await save({ ...value });
      btn.disabled = false;
      if (!r.ok) { back.querySelector('#avErr').textContent = r.error; return; }
      close(r.look || { ...value });
    };
    back.querySelector('#avSave').focus();
  });
}
