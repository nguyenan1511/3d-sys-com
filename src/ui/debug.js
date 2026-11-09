// Lớp kiểm tra layout: đường đi của nhân viên, vị trí bàn/ghế có nhãn, lưới điều hướng từng tầng.
import * as THREE from 'three';
import { facingVec } from '../core/util.js';

function labelSprite(text, bg = '#1b2a8c', fg = '#fff') {
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  g.font = 'bold 44px system-ui, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 28; c.width = w; c.height = 64;
  g.font = 'bold 44px system-ui, sans-serif'; g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, 64, 14); g.fill();
  g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, 14, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(0.32 * w / 64, 0.32, 1); s.renderOrder = 10;
  return s;
}

export class DebugLayers {
  constructor(scene, model, nav, sim) {
    this.model = model; this.nav = nav; this.sim = sim;
    this.root = new THREE.Group(); this.root.name = 'debug'; scene.add(this.root);
    // đường đi
    const MAXV = 4000;
    this.pathGeo = new THREE.BufferGeometry();
    this.pathGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXV * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.pathGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXV * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.paths = new THREE.LineSegments(this.pathGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.paths.renderOrder = 9; this.paths.frustumCulled = false; this.paths.visible = false; this.MAXV = MAXV;
    this.root.add(this.paths);
    // bàn
    this.desks = new THREE.Group(); this.desks.visible = false; this.root.add(this.desks);
    this.discs = new Map();
    const discGeo = new THREE.CircleGeometry(0.2, 20); discGeo.rotateX(-Math.PI / 2);
    for (const s of model.seats.values()) {
      const y = model.floorY(s.floor) + 0.03;
      const m = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.85, depthTest: false }));
      m.position.set(s.x, y, s.z); m.renderOrder = 8; m.userData.floor = s.floor; this.desks.add(m); this.discs.set(s.id, m);
      const f = facingVec(s.facing || 0);
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(f.x, 0, f.z), new THREE.Vector3(s.x, y + 0.02, s.z), 0.45, 0xffffff, 0.15, 0.1);
      arrow.traverse(o => { if (o.material) { o.material.depthTest = false; o.renderOrder = 9; } });
      arrow.userData.floor = s.floor;
      this.desks.add(arrow);
      if (s.kind === 'desk' || s.kind === 'reception') { const l = labelSprite(s.id); l.position.set(s.x, y + 1.45, s.z); l.userData.floor = s.floor; this.desks.add(l); }
    }
    for (const t of model.tables) { const l = labelSprite(t.id, '#7a4b12'); l.position.set(t.x, model.floorY(t.floor) + 1.3, t.z); l.userData.floor = t.floor; this.desks.add(l); }
    for (const [k, w] of Object.entries(model.waypoints)) { const l = labelSprite(k, '#2d6a3e'); l.position.set(w.x, model.heightAt(w.f, w.x, w.z) + 0.5, w.z); l.scale.multiplyScalar(0.8); l.userData.floor = w.f; this.desks.add(l); }
    for (const s of model.stairs) for (const [k, p] of [['entry', s.pEntry], ['exit', s.pExit]]) { const l = labelSprite(`${s.id} ${k}`, '#6b2d6a'); l.position.set(p.x, model.floorY(p.f) + 0.6, p.z); l.scale.multiplyScalar(0.7); l.userData.floor = p.f; this.desks.add(l); }
    // lưới điều hướng
    this.grid = new THREE.Group(); this.grid.visible = false; this.root.add(this.grid);
    for (const [f, g] of nav.grids) {
      const pts = [], cols = [], c = new THREE.Color();
      for (let k = 0; k < g.walk.length; k += 1) {
        const d = g.dist[k]; if (d <= 0) continue;
        const free = d >= g.radius;
        const x = g.cx(k), z = g.cz(k);
        pts.push(x, model.heightAt(f, x, z) + 0.025, z);
        c.set(free ? 0x2bb673 : 0xe0a030); cols.push(c.r, c.g, c.b);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const p = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.05, vertexColors: true, depthTest: false }));
      p.renderOrder = 7; p.userData.floor = f; this.grid.add(p);
    }
    this.colors = new Map();
  }

  setVisible(kind, on) { this[kind].visible = on; }

  update(cutFloor = null) {
    const sim = this.sim;
    if (cutFloor !== this._cut) {
      this._cut = cutFloor;
      for (const g of [this.desks, this.grid]) for (const o of g.children) o.visible = cutFloor === null || o.userData.floor === cutFloor;
    }
    if (this.paths.visible) {
      const pos = this.pathGeo.attributes.position.array, col = this.pathGeo.attributes.color.array;
      let n = 0; const c = new THREE.Color();
      for (const a of sim.agents) {
        if (!a.visible || !a.path) continue;
        if (cutFloor !== null && a.f !== cutFloor && !(a.onStair && this.model.stairById.get(a.onStair).to === cutFloor)) continue;
        c.set(a.emp.look?.shirt || '#ff00ff');
        const pts = [{ x: a.x, z: a.z, y: a.y }];
        for (let i = a.pi; i < a.path.length; i++) { const p = a.path[i]; const st = p.s && this.model.stairById.get(p.s); pts.push({ x: p.x, z: p.z, y: st ? this.model.stairHeight(st, p.x, p.z) : this.model.heightAt(p.f, p.x, p.z) }); }
        for (let i = 1; i < pts.length && n + 2 <= this.MAXV; i++) {
          for (const p of [pts[i - 1], pts[i]]) { pos[n * 3] = p.x; pos[n * 3 + 1] = p.y + 0.08; pos[n * 3 + 2] = p.z; col[n * 3] = c.r; col[n * 3 + 1] = c.g; col[n * 3 + 2] = c.b; n++; }
        }
      }
      this.pathGeo.setDrawRange(0, n);
      this.pathGeo.attributes.position.needsUpdate = true; this.pathGeo.attributes.color.needsUpdate = true;
    }
    if (this.desks.visible) {
      const owner = new Map([...sim.seatOwner]);
      for (const a of sim.agents) if (a.seat && a.sit > 0.5) owner.set(a.seat.id, a.id);
      for (const [id, m] of this.discs) {
        const s = this.model.seats.get(id);
        let col = 0x9a9a9a; // trống
        if (owner.has(id)) col = 0x2bb673; // đang có người
        else if ((s.kind === 'desk' || s.kind === 'reception') && sim.staff.deskOwner.has(id)) col = 0xf0a020; // có chủ nhưng vắng
        if (this.colors.get(id) !== col) { m.material.color.setHex(col); this.colors.set(id, col); }
      }
    }
  }
}
