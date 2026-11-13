// Sân khấu cho các phòng 3D riêng (bi-a, karaoke). Vào phòng: màn hình mờ đi, rồi thay cảnh văn phòng bằng cảnh của
// phòng — vẽ bằng chính renderer/canvas của văn phòng (không thêm ngữ cảnh WebGL). Trong lúc ở phòng, văn phòng KHÔNG
// được vẽ (máy nhẹ hơn); mạng, người khác, ván bi-a… vẫn chạy bình thường. Rời phòng: mờ đi rồi về đúng chỗ cũ.
//
// Một phòng (room) có: kind, scene, camera, ui (lớp phủ DOM: thao tác + giao diện của phòng), update(dt), resize(w, h),
// tuỳ chọn: enter(), leave(), afterRender(), draw3d(renderer) (tự vẽ cảnh), layer (lớp CSS3D đặt dưới canvas, ví dụ màn hình video).
// Phòng dựng một lần rồi giữ lại (vào lại tức thì).
const wait = ms => new Promise(r => setTimeout(r, ms));

export class RoomStage {
  constructor(app, { renderer, canvas, host }) {
    this.app = app; this.renderer = renderer; this.canvas = canvas; this.host = host;
    this.room = null; this.want = null; this.cache = new Map(); this.w = 0; this.h = 0;
    this.fade = document.createElement('div'); this.fade.className = 'room-fade'; this.fade.setAttribute('aria-hidden', 'true');
    this.fade.innerHTML = '<span class="room-spin"></span>';
    document.getElementById('appRoot').appendChild(this.fade);
  }
  get active() { return !!this.room; }
  is(kind) { return this.room?.kind === kind || this.want === kind; }
  /** Vào phòng kind; make(): Promise<room> (chỉ gọi lần đầu). Trả về phòng (hoặc null nếu đã huỷ giữa chừng). */
  async enter(kind, make) {
    if (this.room?.kind === kind) return this.room;
    this.want = kind;
    this.fade.classList.add('on');
    let room = this.cache.get(kind);
    try {
      if (!room) { const [r] = await Promise.all([make(this), wait(240)]); room = r; this.cache.set(kind, room); }
      else await wait(240);
    } catch (e) { console.error(e); this.want = null; this.fade.classList.remove('on'); this.app.session?.toast('Không mở được phòng — thử lại sau.', true); return null; }
    if (this.want !== kind) return null;                              // (đã rời trong lúc đang mở)
    if (this.room) this.close();
    this.room = room;
    document.body.classList.add('in-room', `in-room-${kind}`);
    this.canvas.style.visibility = ''; this.app.onRoomChange?.(true);
    room.ui.hidden = false; if (room.layer) room.layer.style.display = '';
    this.canvas.blur(); room.ui.focus?.({ preventScroll: true });
    this.w = 0; room.enter?.();
    this.frame(0);
    setTimeout(() => this.fade.classList.remove('on'), 60);
    return room;
  }
  /** Rời phòng (mờ chuyển về văn phòng). */
  async exit(kind) {
    if (kind && !this.is(kind)) return;
    this.want = null;
    if (!this.room) { this.fade.classList.remove('on'); return; }
    this.fade.classList.add('on'); await wait(220);
    if (this.want) return;                                              // (đã vào phòng khác trong lúc chờ)
    this.close();
    setTimeout(() => this.fade.classList.remove('on'), 60);
  }
  close() {
    const r = this.room; if (!r) return;
    r.leave?.(); r.ui.hidden = true; if (r.layer) r.layer.style.display = 'none';
    document.body.classList.remove('in-room', `in-room-${r.kind}`);
    this.room = null; this.app.onRoomChange?.(false);
  }
  /** (mỗi khung hình, thay cho vẽ văn phòng) */
  frame(dt) {
    const r = this.room; if (!r) return;
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    if (w !== this.w || h !== this.h) { this.w = w; this.h = h; r.camera.aspect = w / h; r.camera.updateProjectionMatrix(); r.resize?.(w, h); }
    r.update(dt);
    // phòng tự vẽ (draw3d — tên riêng: phòng karaoke có render() là vẽ lại giao diện, KHÔNG phải vẽ cảnh): khung 3D thu nhỏ của phòng họp
    if (r.draw3d) r.draw3d(this.renderer); else this.renderer.render(r.scene, r.camera);
    r.afterRender?.();
  }
}
