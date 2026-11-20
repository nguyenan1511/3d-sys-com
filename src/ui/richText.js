// Soạn thảo văn bản có định dạng (bảng tin công ty) — không thêm thư viện.
//  • Lưu dạng Markdown gọn (chỉ chữ, KHÔNG lưu HTML → không có XSS): **đậm** *nghiêng* __gạch chân__ ~~gạch ngang~~,
//    "## " tiêu đề, "- " danh sách chấm, "1. " danh sách số, [chữ](https://…) liên kết; xuống dòng giữ nguyên.
//  • mdToHtml(): hiện có định dạng (mọi chữ được escape trước, liên kết chỉ http/https). mdToText(): chữ thuần (3D, đoạn trích).
//  • richEditor(textarea): ô soạn thảo trực quan (contenteditable + thanh công cụ) thay cho textarea; textarea gốc vẫn giữ
//    (ẩn) và luôn có giá trị Markdown mới nhất → code form cũ đọc .value như trước.
import { esc, modal } from '../session/ui.js';

const SAFE_URL = /^https?:\/\/[^\s<>"']+$/i;
// ảnh chèn trong nội dung: CHỈ ảnh đã tải lên server của app (không nhúng ảnh từ trang ngoài)
const IMG_PATH = '\\/api\\/board\\/img\\/[a-z0-9]{6,10}-[a-f0-9]{12}';
const IMG_MD = new RegExp(`!\\[([^\\]]*)\\]\\((${IMG_PATH})\\)`, 'g'), IMG_SRC = new RegExp(`^${IMG_PATH}$`);
function inline(s) {   // s đã escape
  return s
    .replace(IMG_MD, (_, alt, u) => `<img class="rt-img" src="${u}" alt="${alt || 'Ảnh'}" loading="lazy" decoding="async">`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
    .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+?)__/g, '<u>$1</u>')
    .replace(/~~([^~\n]+?)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>');
}
/** Markdown gọn → HTML an toàn. */
export function mdToHtml(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n'), out = [];
  let list = null;   // 'ul' | 'ol'
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const l = esc(raw);
    let m;
    if ((m = /^#{1,3}\s+(.*)$/.exec(l))) { close(); out.push(`<h4>${inline(m[1])}</h4>`); }
    else if ((m = /^[-*•]\s+(.*)$/.exec(l))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = /^\d+[.)]\s+(.*)$/.exec(l))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (!l.trim()) { close(); out.push('<p class="rt-gap"></p>'); }
    else if (/^!\[[^\]]*\]\([^)]+\)$/.test(l.trim())) { close(); out.push(`<p class="rt-imgp">${inline(l.trim())}</p>`); }
    else { close(); out.push(`<p>${inline(l)}</p>`); }
  }
  close();
  return out.join('');
}
/** Markdown gọn → chữ thuần (bảng 3D, đoạn trích danh sách). */
export function mdToText(md) {
  return String(md || '').replace(/\r\n?/g, '\n').replace(IMG_MD, '').split('\n').map(l => l.replace(/^#{1,3}\s+/, '').replace(/^[-*•]\s+/, '• ').replace(/^(\d+)[.)]\s+/, '$1. '))
    .join('\n').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1').replace(/\*\*([^*\n]+?)\*\*/g, '$1').replace(/__([^_\n]+?)__/g, '$1').replace(/~~([^~\n]+?)~~/g, '$1').replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1$2');
}

// ---------- DOM (ô soạn thảo) → Markdown ----------
function nodeMd(n) {
  if (n.nodeType === 3) return n.nodeValue.replace(/ /g, ' ').replace(/\n/g, ' ');
  if (n.nodeType !== 1) return '';
  const tag = n.tagName, kids = () => [...n.childNodes].map(nodeMd).join('');
  const wrap = (mk, t) => { const s = t ?? kids(); if (!s.trim()) return s; const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0]; return `${lead}${mk}${s.trim()}${mk}${tail}`; };
  if (tag === 'BR') return '\n';
  if (tag === 'IMG') { const src = n.getAttribute('src') || ''; return IMG_SRC.test(src) ? `\n![](${src})\n` : ''; }
  if (tag === 'B' || tag === 'STRONG') return wrap('**');
  if (tag === 'I' || tag === 'EM') return wrap('*');
  if (tag === 'U') return wrap('__');
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') return wrap('~~');
  if (tag === 'SPAN') { const st = n.style; let s = kids(); if (st.fontWeight === 'bold' || +st.fontWeight >= 600) s = wrap('**', s); if (st.fontStyle === 'italic') s = wrap('*', s); if (/underline/.test(st.textDecoration || st.textDecorationLine || '')) s = wrap('__', s); if (/line-through/.test(st.textDecoration || st.textDecorationLine || '')) s = wrap('~~', s); return s; }
  if (tag === 'A') { const h = n.getAttribute('href') || '', t = kids().trim(); return SAFE_URL.test(h) ? (t && t !== h ? `[${t}](${h})` : h) : t; }
  if (/^H[1-6]$/.test(tag)) return `\n## ${kids().trim()}\n`;
  if (tag === 'UL' || tag === 'OL') return '\n' + [...n.children].filter(c => c.tagName === 'LI').map((li, i) => `${tag === 'UL' ? '-' : `${i + 1}.`} ${[...li.childNodes].map(nodeMd).join('').replace(/\n+/g, ' ').trim()}`).join('\n') + '\n';
  if (tag === 'DIV' || tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE') { const s = kids(); return `\n${s === '\n' ? '' : s}\n`; }
  return kids();
}
export function domToMd(root) {
  return [...root.childNodes].map(nodeMd).join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

const TOOLS = [
  ['bold', '<b>B</b>', 'Đậm (Ctrl+B)'], ['italic', '<i>I</i>', 'Nghiêng (Ctrl+I)'], ['underline', '<u>U</u>', 'Gạch chân (Ctrl+U)'], ['strikeThrough', '<s>S</s>', 'Gạch ngang'],
  ['|'], ['h', '<b>H</b>', 'Tiêu đề'], ['insertUnorderedList', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/></svg>', 'Danh sách chấm'],
  ['insertOrderedList', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 5h1.5v4M3.5 9h3M3.5 14.5a1.5 1.5 0 0 1 3 .3c0 .9-3 2.2-3 3.2h3" stroke-width="1.5"/></svg>', 'Danh sách số'],
  ['|'], ['image', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 15.5l-5-5-9 9"/></svg>', 'Chèn ảnh (hoặc dán / kéo thả ảnh)'], ['link', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>', 'Chèn liên kết'],
  ['removeFormat', '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 5h12M12 5l-3 14M15 15l5 5M20 15l-5 5"/></svg>', 'Xoá định dạng']
];

/** Thay textarea bằng ô soạn thảo trực quan. Trả về { el, focus() }. */
/** Ảnh → { type: 'image/jpeg', data: base64 } — thu nhỏ cạnh dài ≤ 1600 px, JPEG (≤ ~1,2 MB). */
async function shrinkImage(file) {
  if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Chỉ chèn được ảnh PNG, JPG, WebP hoặc GIF.');
  const bmp = await createImageBitmap(file).catch(() => null); if (!bmp) throw new Error('Không đọc được ảnh này.');
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  let url = c.toDataURL('image/jpeg', 0.84); if (url.length > 1.55e6) url = c.toDataURL('image/jpeg', 0.66);
  return { type: 'image/jpeg', data: url.split(',')[1] };
}

export function richEditor(ta, { max = 5000, placeholder = '', upload = null } = {}) {
  const box = document.createElement('div'); box.className = 'rt';
  box.innerHTML = `<div class="rt-bar" role="toolbar" aria-label="Định dạng">${TOOLS.map(([c, h, t]) => c === '|' ? '<i class="rt-sep"></i>' : `<button type="button" data-c="${c}" title="${t}" aria-label="${t}">${h}</button>`).join('')}<span class="rt-n"></span></div>
    <div class="rt-ed" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${esc(placeholder || 'Nội dung')}" data-ph="${esc(placeholder)}"></div>`;
  ta.hidden = true; ta.removeAttribute('maxlength'); ta.after(box);
  const ed = box.querySelector('.rt-ed'), n = box.querySelector('.rt-n');
  ed.innerHTML = mdToHtml(ta.value).replace(/<p class="rt-gap"><\/p>/g, '<div><br></div>').replace(/<p>/g, '<div>').replace(/<\/p>/g, '</div>').replace(/<h4>/g, '<h3>').replace(/<\/h4>/g, '</h3>');
  try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch { /* */ }
  const sync = () => {
    const md = domToMd(ed); ta.value = md; ed.classList.toggle('empty', !ed.textContent.trim() && !ed.querySelector('li, img'));
    if (!busy) n.textContent = md.length > max * 0.8 ? `${md.length}/${max}` : ''; n.classList.toggle('over', md.length > max);
    ta.setCustomValidity(md.length > max ? `Nội dung tối đa ${max} ký tự.` : '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const state = () => box.querySelectorAll('[data-c]').forEach(b => { const c = b.dataset.c; let on = false; try { on = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].includes(c) && document.queryCommandState(c); } catch { /* */ } if (c === 'h') on = !!getSelection().anchorNode?.parentElement?.closest?.('h1,h2,h3,h4'); b.classList.toggle('on', on); });
  box.querySelector('.rt-bar').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });   // (giữ vùng chọn trong ô soạn)
  box.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
    ed.focus(); const c = b.dataset.c;
    if (c === 'h') { const inH = getSelection().anchorNode?.parentElement?.closest?.('h1,h2,h3,h4'); document.execCommand('formatBlock', false, inH ? 'div' : 'h3'); }
    else if (c === 'link') { addLink(); return; }
    else if (c === 'image') { pick.click(); return; }
    else document.execCommand(c, false, null);
    sync(); state();
  });
  // chèn liên kết: hộp nhập của app (giữ vùng chọn để gắn link vào đúng chữ đang bôi)
  async function addLink() {
    const sel = getSelection(), range = sel.rangeCount && ed.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null, txt = range ? range.toString().trim() : '';
    const url = await modal({ title: 'Chèn liên kết', okText: 'Chèn', body: `<label for="rtUrl">Đường dẫn</label><input id="rtUrl" type="url" placeholder="https://…" value="${/^https?:\/\//i.test(txt) ? esc(txt) : ''}">${txt ? '' : '<label for="rtTxt">Chữ hiển thị (tuỳ chọn)</label><input id="rtTxt" maxlength="120">'}`,
      onOk: b => { const u = b.querySelector('#rtUrl').value.trim(); if (!SAFE_URL.test(u)) return { error: 'Đường dẫn phải bắt đầu bằng http:// hoặc https://' }; return { u, t: b.querySelector('#rtTxt')?.value.trim() || '' }; } });
    ed.focus(); if (!url) return;
    const s2 = getSelection(); s2.removeAllRanges(); if (range) s2.addRange(range); else { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); s2.addRange(r); }
    if (txt) document.execCommand('createLink', false, url.u);
    else document.execCommand('insertHTML', false, `<a href="${esc(url.u)}">${esc(url.t || url.u)}</a>&nbsp;`);
    sync(); state();
  }
  // chèn ảnh: chọn file / dán / kéo thả → thu nhỏ → tải lên server → chèn vào chỗ con trỏ
  const pick = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, hidden: true }); box.appendChild(pick);
  pick.onchange = () => { addImages([...pick.files]); pick.value = ''; };
  if (!upload) box.querySelector('[data-c=image]')?.remove();
  let busy = 0;
  async function addImages(files) {
    files = files.filter(f => f.type.startsWith('image/')).slice(0, 6); if (!files.length || !upload) return;
    const sel = getSelection(); let range = sel.rangeCount && ed.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    busy += files.length; n.textContent = 'Đang tải ảnh…'; box.classList.add('busy');
    for (const f of files) {
      try {
        const url = await upload(await shrinkImage(f));
        ed.focus(); const s2 = getSelection(); s2.removeAllRanges();
        if (range) s2.addRange(range); else { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); s2.addRange(r); }
        document.execCommand('insertHTML', false, `<img class="rt-img" src="${esc(url)}" alt="Ảnh"><div><br></div>`);
        range = s2.rangeCount ? s2.getRangeAt(0).cloneRange() : null;
      } catch (e) { (await import('../session/ui.js')).toast(e.message || 'Không tải được ảnh.', true); }
      busy--;
    }
    if (!busy) box.classList.remove('busy'); sync();
  }
  // dán: chỉ lấy chữ (giữ xuống dòng) — không mang định dạng / mã lạ từ web, Word…; dán ảnh: chèn ảnh
  ed.addEventListener('paste', e => {
    e.preventDefault();
    const imgs = [...(e.clipboardData?.items || [])].filter(x => x.kind === 'file' && x.type.startsWith('image/')).map(x => x.getAsFile()).filter(Boolean);
    if (imgs.length) { addImages(imgs); return; }
    const t = e.clipboardData?.getData('text/plain') || ''; document.execCommand('insertText', false, t);
  });
  ed.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); box.classList.add('drop'); } });
  ed.addEventListener('dragleave', () => box.classList.remove('drop'));
  ed.addEventListener('drop', e => {
    box.classList.remove('drop'); const fs = [...(e.dataTransfer?.files || [])]; if (!fs.length) return; e.preventDefault();
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY); if (r) { const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(r); }
    addImages(fs);
  });
  ed.addEventListener('input', sync);
  ed.addEventListener('keydown', e => { e.stopPropagation(); if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); box.querySelector('[data-c=link]').click(); } });
  ed.addEventListener('keyup', state); ed.addEventListener('mouseup', state); ed.addEventListener('focus', state);
  ed.addEventListener('click', e => { const a = e.target.closest('a'); if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank', 'noopener'); });
  sync();
  return { el: box, focus: () => ed.focus() };
}
