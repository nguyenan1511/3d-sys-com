// Dự án — phần thời gian thực (WebSocket): báo cho thành viên (và CEO đang online) khi dự án / thành viên / công việc đổi,
// được mời / bị xoá khỏi dự án, được giao việc, việc sắp tới hạn / quá hạn, bị @nhắc tên trong chat, có người vào phòng dự án.
// Tin gửi đi (client: src/session/projects.js):
//  proj:changed {id}                       — thông tin / thành viên / ghi chú / tài liệu đổi: tải lại khi đang xem
//  proj:invited {project, by}              — mình vừa được thêm vào dự án
//  proj:removed {id, name, purged}         — mình bị xoá khỏi dự án / dự án bị xoá
//  proj:task {id, kind, task|taskId, by}   — công việc thêm / sửa / xoá (Kanban của mọi người cập nhật ngay)
//  proj:assigned {project, task, by}       — mình vừa được giao việc
//  proj:due {project, task, kind}          — việc của mình còn ≤ 24 giờ ('soon') / đã quá hạn ('over')
//  proj:mention {project, msg}             — bị @nhắc tên trong chat dự án
//  proj:room {id, name, who, n}            — đồng đội vừa vào phòng dự án
import { memberKeys, getProject, roomOf, mentioned } from './projects.js';

const ROOM_PING_MS = 2 * 60e3;   // (một người ra vào liên tục: báo tối đa 2 phút một lần)

export class ProjectHub {
  constructor(hub, projects) {
    this.hub = hub; this.projects = projects; this.roomPing = new Map();
    this.timer = setInterval(() => this.dueTick(), 60e3); this.timer.unref?.();
  }
  close() { clearInterval(this.timer); }
  get store() { return this.hub.store; }
  sendKey(key, msg) { for (const s of this.hub.sockets.get(key) || []) this.hub.send(s, msg); }
  /** Người nhận tin của dự án: thành viên + CEO đang online (CEO xem được mọi dự án). */
  audience(id) { const keys = new Set(memberKeys(this.store, id)); for (const k of this.hub.sockets.keys()) if (k.startsWith('admin:')) keys.add(k); return [...keys]; }
  toProject(id, msg, except = null) { for (const k of this.audience(id)) if (k !== except) this.sendKey(k, msg); }

  changed(id) { this.toProject(id, { t: 'proj:changed', id }); }
  invited(p, keys, by) { for (const k of keys) this.sendKey(k, { t: 'proj:invited', project: this.projects.view(p, k), by: this.hub.nameOf(by) }); this.changed(p.id); }
  removed(p, keys, { purged = false } = {}) {
    for (const k of keys) { this.sendKey(k, { t: 'proj:removed', id: p.id, name: p.name, purged }); this.hub.meet.leave(k, roomOf(p.id)); }
    if (purged) { const r = this.hub.meet.rooms.get(roomOf(p.id)); if (r) for (const k of [...r.members.keys()]) this.hub.meet.leave(k, roomOf(p.id)); this.hub.meet.forget(roomOf(p.id)); }
    else this.changed(p.id);
  }
  /** Công việc đổi: cập nhật Kanban của mọi người; người vừa được giao việc nhận thông báo riêng. */
  task(p, kind, t, by, before = null) {
    const view = kind === 'del' ? null : this.projects.taskView(t);
    this.toProject(p.id, { t: 'proj:task', id: p.id, kind, task: view, taskId: t.id, by });
    if (kind !== 'del' && t.assignee && t.assignee !== by && (!before || before.assignee !== t.assignee)) {
      this.sendKey(t.assignee, { t: 'proj:assigned', project: { id: p.id, name: p.name, color: p.color }, task: view, by: this.hub.nameOf(by) });
    }
  }
  /** Tin nhắn trong kênh proj:<id>: ai bị @nhắc tên thì báo riêng. */
  onChat(msg) {
    const id = Number(msg.channel.slice(5)), p = getProject(this.store, id); if (!p || msg.from === 'system') return;
    for (const k of mentioned(msg.body, this.projects.members(id), msg.from)) this.sendKey(k, { t: 'proj:mention', project: { id: p.id, name: p.name, color: p.color }, msg });
  }
  /** Có người vào phòng dự án: báo cho thành viên đang online mà chưa ở trong phòng. */
  joinedRoom(id, key, inRoom) {
    const p = getProject(this.store, id); if (!p) return;
    const k = `${id}|${key}`, now = Date.now(); if (now - (this.roomPing.get(k) || 0) < ROOM_PING_MS) return;
    this.roomPing.set(k, now); if (this.roomPing.size > 2000) this.roomPing.clear();
    for (const m of memberKeys(this.store, id)) if (m !== key && !inRoom.has(m)) this.sendKey(m, { t: 'proj:room', id, name: p.name, color: p.color, who: this.hub.nameOf(key), n: inRoom.size });
  }
  dueTick(now = Date.now()) {
    for (const { p, t, kind } of this.projects.dueScan(now)) this.sendKey(t.assignee, { t: 'proj:due', project: { id: p.id, name: p.name, color: p.color }, task: this.projects.taskView(t), kind });
  }
  /** Nhân viên bị vô hiệu hoá: rời mọi dự án (người khác cập nhật danh sách). */
  disabled(code) { for (const { p } of this.projects.disable(code)) this.changed(p.id); }
}
