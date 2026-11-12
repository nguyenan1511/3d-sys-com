// Avatar của người dùng thật khác (nhận vị trí qua WebSocket), nội suy mượt, có bảng tên trên đầu.
import * as THREE from 'three';
import { AvatarSystem } from '../agents/avatars.js';
import { CEO_LOOK } from '../shared/departments.js';
import { hashStr } from '../core/util.js';
import { angDiff } from '../core/util.js';

const SHIRTS = ['#1b2a8c', '#f3a21f', '#2a9d8f', '#c2402f', '#6b4aa5', '#3a3f4a', '#4f8f4a', '#d9822b'];

function tagSprite(text, color = '#1b2a8c') {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = 'bold 40px system-ui, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 28; c.width = w; c.height = 56;
  g.font = 'bold 40px system-ui, sans-serif'; g.fillStyle = color; g.beginPath(); g.roundRect(0, 0, w, 56, 12); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, 14, 30);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.032 * w / 56, 0.032, 1); s.renderOrder = 11;
  return s;
}

export class RemoteAvatars {
  constructor(scene, model, quality, capacity = 150) {
    this.model = model; this.capacity = capacity;
    this.sys = new AvatarSystem(scene, capacity, quality, { scale: model.cs, seatH: model.layout?.scale?.seatHip ?? 0.53 * model.fs });
    this.cs = model.cs;
    this.tags = new THREE.Group(); this.tags.name = 'remoteTags'; scene.add(this.tags);
    this.list = [];          // giả-agent theo thứ tự slot
    this.byKey = new Map();
    this.selfKey = null;
  }
  setSelf(key) { this.selfKey = key; }
  /** Nhân vật của chính người chơi (điều khiển tại chỗ, không nội suy). */
  setLocal(agent) { this.list.unshift(agent); this.list.forEach((x, i) => { x.idx = i; }); this.local = agent; this.sys.setColors(this.list); }
  refreshColors() { this.sys.setColors(this.list); }

  upsert(p) {
    if (p.x === null || p.x === undefined || (this.local && p.key === this.selfKey)) return;
    let a = this.byKey.get(p.key);
    if (!a) {
      if (this.list.length >= this.capacity) return;
      const h = hashStr(p.key);
      a = { key: p.key, idx: this.list.length, visible: true, x: p.x, y: p.y, z: p.z, f: p.f, yaw: p.yaw, sit: 0, walkAmt: 0, walkPhase: 0, anim: 'idle', animT: h % 10, cup: false, onStair: null,
        emp: { look: p.look || (p.kind === 'admin' ? { ...CEO_LOOK } : null) || { shirt: SHIRTS[h % SHIRTS.length], pants: '#2d3440', skin: ['#e8c3a0', '#dcae88', '#c99872', '#f0cfae'][h % 4], hair: '#1d1a17', height: 1 } },
        target: {}, display: p.display, kind: p.kind, camH: 0.75 * this.cs };
      this.byKey.set(p.key, a); this.list.push(a);
      this.sys.setColors(this.list);
      a.tag = tagSprite(p.display, p.tagColor || (p.kind === 'admin' ? '#202124' : '#1b2a8c')); this.tags.add(a.tag);
    }
    // nhân vật đổi tạo hình
    if (p.look && p.look !== a.emp.look && JSON.stringify(p.look) !== JSON.stringify(a.emp.look)) { a.emp.look = p.look; this.sys.setColors(this.list); }
    if (a.display !== p.display) { this.tags.remove(a.tag); a.tag = tagSprite(p.display, p.tagColor); this.tags.add(a.tag); a.display = p.display; }
    a.target = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, seated: p.seated, walk: p.walk, run: p.run, f: p.f, act: p.act || '' };
    a.f = p.f; a.seated = p.seated; if (p.department !== undefined) a.department = p.department;
    if (p.seated) { a.x = p.x; a.z = p.z; a.y = p.y; a.yaw = p.yaw; }
  }
  remove(key) {
    const a = this.byKey.get(key); if (!a || a.local) return;
    this.byKey.delete(key); this.tags.remove(a.tag);
    this.list.splice(this.list.indexOf(a), 1);
    this.list.forEach((x, i) => { x.idx = i; });
    this.sys.setColors(this.list);
  }
  seatedAt(deskId) { for (const a of this.list) if (a.seated === deskId) return true; return false; }

  update(dt, hideAbove) {
    for (const a of this.list) {
      if (a.local) { a.visible = !this.selfHidden; continue; }
      const t = a.target; if (t.x === undefined) continue;
      if ((t.act || '') !== (a.act || '')) { a.act = t.act || null; a.actT = 0; if (t.act === 'jump') a.jumpT = 0; }
      a.actT = (a.actT || 0) + dt;
      if (a.jumpT !== undefined) { a.jumpT += dt; a.jumpH = Math.max(0, 2.4 * a.jumpT - 4.9 * a.jumpT * a.jumpT); if (a.jumpT > 0.8) { a.jumpT = undefined; a.jumpH = 0; } }
      const dx = t.x - a.x, dz = t.z - a.z, d = Math.hypot(dx, dz);
      const k = Math.min(1, dt * 8);
      a.x += dx * k; a.z += dz * k; a.y += (t.y - a.y) * k;
      if (d > 3) { a.x = t.x; a.z = t.z; a.y = t.y; }
      a.yaw += angDiff(a.yaw, t.yaw) * k;
      const sofa = t.act === 'tv';                       // đang ngồi sofa xem TV (khu giải trí)
      const moving = d > 0.03 && !t.seated && !sofa;
      a.walkAmt += ((moving ? (t.run ? 2 : 1) : 0) - a.walkAmt) * Math.min(1, dt * 6);
      a.walkPhase += d * k / (0.42 * this.cs) * Math.PI;
      a.sit += ((t.seated || sofa ? 1 : 0) - a.sit) * Math.min(1, dt * 4);
      a.anim = t.seated ? 'type' : sofa ? 'tv' : 'idle';
      a.animT += dt;
      a.tag.position.set(a.x, a.y + (1.7 - 0.45 * a.sit) * this.cs + (a.jumpH || 0), a.z);
      a.tag.visible = a.visible && (hideAbove == null || a.y <= hideAbove) && (!this.local || this.local.f === a.f || this.local.onStair != null); // (nhãn người ở tầng khác không hiện xuyên sàn)
    }
    this.sys.update(this.list, { hideAbove, floor: this.local && this.local.onStair == null ? this.local.f : null });   // (người ở tầng khác bị sàn che: không vẽ)
  }
}
