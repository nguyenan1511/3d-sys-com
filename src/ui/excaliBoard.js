// Bảng vẽ chung của phòng họp: Excalidraw (https://excalidraw.com, MIT) — đủ công cụ: chọn, kéo tay, hình chữ nhật, thoi, elip,
// mũi tên, đường, bút, chữ, ảnh, tẩy, thư viện hình, hoàn tác / làm lại, phóng to…. Công cụ hiện tiếng Anh như agent-office:
// Excalidraw chỉ bật ngôn ngữ dịch ≥ 85% (tiếng Việt mới ~49%) — chữ của mình (lời chào, mục menu) vẫn tiếng Việt.
// Cộng tác trực tiếp theo cách của agent-office (https://github.com/AgentSystemLabs/agent-office, MIT):
//  • mỗi lần bản vẽ đổi, gửi các hình mới hơn bản máy chủ đang biết (gom 50 ms, mỗi gói < 900 KB) — meet:wb;
//  • nhận hình của người khác: ghép bằng reconcileElements của Excalidraw (hình đang sửa dở của mình không bị đè),
//    không đưa vào lịch sử hoàn tác của mình;
//  • ảnh dán lên bảng: tải lên máy chủ trước (REST), rồi mới gửi hình ảnh; máy khác tự tải ảnh còn thiếu;
//  • con trỏ + vùng chọn của từng người (meet:ptr) hiện như cộng tác của Excalidraw.
// Thư viện (React + Excalidraw, ~1 MB) chỉ tải khi vào phòng họp / mở bảng vẽ xem lại (loadExcalidraw).
import { api } from '../net/api.js';
import { newer, WB_MAX_ELEMENT_BYTES } from '../shared/whiteboard.js';

const FLUSH_MS = 50, PTR_MS = 40, BATCH = 900_000;
let lib = null;
/** Tải React + Excalidraw (một lần). */
export function loadExcalidraw() {
  lib ||= Promise.all([import('react'), import('react-dom/client'), import('@excalidraw/excalidraw'), import('@excalidraw/excalidraw/index.css')])
    .then(([R, D, X]) => ({ R: R.default || R, D: D.default || D, X }))
    .catch(e => { lib = null; throw e; });
  return lib;
}
const hueOf = key => { let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 360; };
const colorOf = key => `hsl(${hueOf(key)} 65% 48%)`;

export class ExcaliBoard {
  /**
   * @param host phần tử chứa bảng
   * @param o { meetingId, me, names(key), send(msg) (bỏ trống = chỉ xem), elements, files: [mã ảnh], isHost, name,
   *            onChange() (bản vẽ đổi — vẽ lại bảng trên tường 3D), onSaveDocs() (mục "Lưu bảng vào tài liệu"), toast(t, bad) }
   */
  constructor(host, o) {
    this.host = host; this.o = o; this.id = o.meetingId; this.readOnly = !o.send;
    this.known = new Map();      // hình máy chủ đang giữ (đã gửi / đã nhận) — chỉ gửi hình mới hơn
    this.pending = new Map(); this.flushT = 0; this.ptrAt = 0; this.peers = new Map(); this.raf = 0;
    this.files = new Map();      // ảnh đã có trên máy (mã → { id, mimeType, dataURL, created })
    this.uploaded = new Set(o.files || []); this.uploading = new Map(); this.failed = new Map(); this.tooBig = new Set();
    this.initial = (o.elements || []).filter(e => e && e.id); this.lang = document.documentElement.lang || 'vi';
    for (const e of this.initial) this.known.set(e.id, e);
    this.ready = loadExcalidraw().then(L => { this.L = L; });
    if (o.open) this.open();
  }
  /** Dựng Excalidraw (lần đầu bảng hiện ra — dựng trong khung đang ẩn thì Excalidraw đo sai cỡ). Trước đó hình nhận được
   *  vẫn được ghép vào initial (bảng trắng 3D vẫn vẽ đúng). */
  open() { this.mounted ||= this.ready.then(() => this.mount()); return this.mounted; }
  get api() { return this.xapi; }
  /** Các hình đang hiện. */
  elements() { return this.xapi ? this.xapi.getSceneElements() : this.initial.filter(e => !e.isDeleted); }
  get count() { return this.elements().length; }

  mount() {
    const { R, D, X } = this.L;
    if (this.gone) return;
    const h = R.createElement, M = X.MainMenu, W = X.WelcomeScreen;
    const box = document.createElement('div'); box.className = 'xb'; this.host.appendChild(box);
    const elements = X.restoreElements(this.initial, null);   // (đã gồm hình nhận được trước khi dựng)
    const menu = h(M, null,
      this.o.onSaveDocs && h(M.Item, { onSelect: () => this.o.onSaveDocs() }, 'Lưu bảng vào tài liệu cuộc họp'),
      h(M.DefaultItems.SaveAsImage), h(M.DefaultItems.Export), h(M.DefaultItems.SearchMenu), h(M.DefaultItems.Help),
      !this.readOnly && this.o.isHost && h(M.DefaultItems.ClearCanvas));
    const welcome = this.readOnly ? null : h(W, null, h(W.Hints.MenuHint), h(W.Hints.ToolbarHint), h(W.Hints.HelpHint),
      h(W.Center, null, h(W.Center.Heading, null, 'Vẽ cùng nhau: mọi người trong cuộc họp thấy ngay, bảng được lưu lại trong "Folder của tôi"')));
    this.root = D.createRoot(box);
    this.root.render(h(X.Excalidraw, {
      excalidrawAPI: a => { this.xapi = a; this.loadFiles(this.initial);   /* (lúc này hình ban đầu chưa vào bảng — tải ảnh theo initial, không theo getSceneElements) */ this.paintPeers(); this.fixLang(); setTimeout(() => this.fixLang(), 600); },
      initialData: { elements, appState: { viewBackgroundColor: '#ffffff', currentItemFontFamily: X.FONT_FAMILY?.Nunito ?? 6, name: this.o.name || 'bang-ve' }, scrollToContent: true },
      onChange: els => this.changed(els),
      onPointerUpdate: this.readOnly ? undefined : p => this.pointer(p),
      isCollaborating: !this.readOnly, viewModeEnabled: this.readOnly, langCode: 'en', theme: 'light', name: this.o.name || 'bang-ve',
      aiEnabled: false, autoFocus: !this.readOnly, handleKeyboardGlobally: false,
      UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, changeViewBackgroundColor: false, toggleTheme: false }, tools: { image: !this.readOnly } }
    }, menu, welcome));
  }
  /** Excalidraw đặt lang/dir của cả trang theo ngôn ngữ của nó — trả lại tiếng Việt cho ứng dụng. */
  fixLang() { const d = document.documentElement; d.lang = this.lang; d.dir = 'ltr'; }
  destroy() { this.gone = true; setTimeout(() => this.fixLang(), 0); this.flush(); clearTimeout(this.flushT); cancelAnimationFrame(this.raf); try { this.root?.unmount(); } catch { /* bỏ qua */ } this.root = null; this.xapi = null; this.host.querySelector('.xb')?.remove(); }

  // ---------- gửi thay đổi của mình ----------
  changed(els) {
    if (!this.readOnly) for (const e of els) if (newer(e, this.known.get(e.id))) this.pending.set(e.id, e);
    if (this.pending.size && !this.flushT) this.flushT = setTimeout(() => this.flush(), FLUSH_MS);
    // (bảng trên tường 3D: chỉ vẽ lại khi bản vẽ thật sự đổi)
    const v = this.L?.X.getSceneVersion(els); if (v !== this.ver) { this.ver = v; this.o.onChange?.(); }
  }
  flush() {
    clearTimeout(this.flushT); this.flushT = 0;
    if (this.readOnly || !this.pending.size) return;
    const out = [];
    for (const [id, e] of this.pending) {
      if (e.type === 'image' && e.fileId && !e.isDeleted && !this.uploaded.has(e.fileId)) {   // (ảnh: tải lên trước, gửi hình sau)
        const f = this.xapi?.getFiles()[e.fileId]; if (f) this.upload(f).then(ok => { if (ok && !this.gone) this.changed([]); });
        continue;
      }
      this.pending.delete(id); out.push({ ...e });   // (bản sao: Excalidraw sửa thẳng lên hình trong lúc kéo — giữ tham chiếu thì lần sau tưởng đã gửi rồi)
    }
    let batch = [], bytes = 0;
    const send = () => { if (batch.length) this.o.send({ t: 'meet:wb', elements: batch }); batch = []; bytes = 0; };
    for (const e of out) {
      const n = JSON.stringify(e).length;
      if (n > WB_MAX_ELEMENT_BYTES) { if (!this.tooBig.has(e.id)) this.o.toast?.('Hình này quá lớn nên chỉ mình bạn thấy — thử vẽ thành nhiều phần nhỏ.', true); this.tooBig.add(e.id); continue; }
      if (batch.length && bytes + n > BATCH) send();
      batch.push(e); bytes += n; this.known.set(e.id, e);
    }
    send();
    if (this.pending.size && !this.flushT) this.flushT = setTimeout(() => this.flush(), 400);
  }
  upload(f) {
    let p = this.uploading.get(f.id); if (p) return p;
    p = api('POST', `/api/meetings/${this.id}/wbfile`, { id: f.id, mimeType: f.mimeType, dataURL: f.dataURL, created: f.created }).then(r => {
      if (r.ok) { this.uploaded.add(f.id); this.files.set(f.id, f); return true; }
      this.o.toast?.(r.error || 'Chưa đưa được ảnh lên bảng.', true); return false;
    });
    this.uploading.set(f.id, p); return p;
  }
  pointer({ pointer, button }) {
    const now = performance.now(); if (now - this.ptrAt < PTR_MS) return; this.ptrAt = now;
    const sel = this.xapi ? Object.keys(this.xapi.getAppState().selectedElementIds || {}).slice(0, 200) : undefined;
    this.o.send({ t: 'meet:ptr', x: pointer.x, y: pointer.y, tool: pointer.tool, button, selected: sel });
  }

  // ---------- nhận của người khác ----------
  /** Hình người khác vừa vẽ / sửa / xoá. */
  receive(els) {
    if (!els?.length) return;
    for (const e of els) if (newer(e, this.known.get(e.id))) this.known.set(e.id, e);
    const a = this.xapi;
    if (!a) { const m = new Map(this.initial.map(e => [e.id, e])); for (const e of els) if (newer(e, m.get(e.id))) m.set(e.id, e); this.initial = [...m.values()]; this.o.onChange?.(); return; }
    const { X } = this.L, remote = X.restoreElements(els, null);
    const merged = X.reconcileElements(a.getSceneElementsIncludingDeleted(), remote, a.getAppState());
    a.updateScene({ elements: merged, captureUpdate: X.CaptureUpdateAction.NEVER });
    this.loadFiles(remote);
  }
  /** Tải các ảnh còn thiếu của hình ảnh trên bảng. */
  async loadFiles(els) {
    const now = Date.now(), want = new Set();
    for (const e of els) if (e.type === 'image' && !e.isDeleted && e.fileId && !this.files.has(e.fileId) && now - (this.failed.get(e.fileId) || 0) > 10e3) want.add(e.fileId);
    const got = [];
    await Promise.all([...want].map(async fid => {
      this.files.set(fid, null);
      try { const r = await fetch(`/api/meetings/${this.id}/wbfile/${encodeURIComponent(fid)}`, { credentials: 'same-origin' }); if (!r.ok) throw new Error(r.status); const f = await r.json(); this.files.set(fid, f); this.uploaded.add(fid); got.push(f); }
      catch { this.files.delete(fid); this.failed.set(fid, Date.now()); }
    }));
    if (got.length && this.xapi) { this.xapi.addFiles(got); this.o.onChange?.(); }
  }
  /** Con trỏ / vùng chọn của một người khác. */
  peer(m) { this.peers.set(m.key, m); this.schedPeers(); }
  dropPeer(key) { if (this.peers.delete(key)) this.schedPeers(); }
  schedPeers() { if (!this.raf) this.raf = requestAnimationFrame(() => this.paintPeers()); }
  paintPeers() {
    this.raf = 0; if (!this.xapi) return;
    const c = new Map();
    for (const [key, p] of this.peers) {
      const col = colorOf(key);
      c.set(key, { id: key, socketId: key, username: this.o.names?.(key) || key, color: { background: col, stroke: col }, pointer: { x: p.x, y: p.y, tool: p.tool }, button: p.button,
        selectedElementIds: p.selected ? Object.fromEntries(p.selected.map(i => [i, true])) : undefined });
    }
    this.xapi.updateScene({ collaborators: c });
  }

  // ---------- ảnh của bảng ----------
  allFiles() { const out = {}; for (const [k, f] of this.files) if (f) out[k] = f; return { ...out, ...(this.xapi?.getFiles() || {}) }; }
  /** Vẽ cả bản vẽ vừa khung w×h (bảng trắng trong phòng 3D) — canvas, hoặc null nếu bảng trống. */
  async preview(w, h) {
    await this.ready; let els = this.elements(); if (!els.length || !this.L) return null;
    if (!this.xapi) { els = this.L.X.restoreElements(els, null); await this.loadFiles(els); }
    return this.L.X.exportToCanvas({ elements: els, files: this.allFiles(), appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false }, exportPadding: 24,
      getDimensions: (ew, eh) => { const s = Math.min(w / ew, h / eh, 3); return { width: Math.max(1, Math.round(ew * s)), height: Math.max(1, Math.round(eh * s)), scale: s }; } });
  }
  /** Ảnh PNG của cả bảng (nền trắng). */
  async png() {
    await this.ready; let els = this.elements(); if (!els.length) return null;
    if (!this.xapi) els = this.L.X.restoreElements(els, null);
    return this.L.X.exportToBlob({ elements: els, files: this.allFiles(), mimeType: 'image/png', appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false }, exportPadding: 32 });
  }
}
