// Lưới điều hướng theo từng tầng, dựng từ layout (vùng đi được trừ vật cản), A* 8 hướng.

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export class FloorGrid {
  constructor(model, floorId) {
    const nav = model.nav;
    this.floor = floorId;
    this.c = nav.cell || 0.1;
    this.radius = nav.radius || 0.22;
    const areas = (nav.areas || []).filter(a => a.floor === floorId);
    if (!areas.length) throw new Error(`Tầng ${floorId} chưa có nav.areas trong layout.json`);
    const pad = 0.3;
    this.x0 = Math.min(...areas.map(a => a.x0)) - pad; this.z0 = Math.min(...areas.map(a => a.z0)) - pad;
    const x1 = Math.max(...areas.map(a => a.x1)) + pad, z1 = Math.max(...areas.map(a => a.z1)) + pad;
    this.nx = Math.ceil((x1 - this.x0) / this.c); this.nz = Math.ceil((z1 - this.z0) / this.c);
    const N = this.nx * this.nz;
    const walk = new Uint8Array(N);
    const obs = model.obstacles.get(floorId) || [];
    // ô đi được = tâm ô nằm trong một vùng đi được và không nằm trong vật cản nào. Tô từng hình chữ nhật lên lưới
    // (vùng: 1, rồi vật cản: 0) thay vì xét mọi vật cản cho mọi ô — kết quả y hệt (cùng phép so sánh tâm ô, có tính mép),
    // nhanh hơn hàng chục lần với vài nghìn vật cản (lúc tải trang trên điện thoại yếu).
    const xs = new Float64Array(this.nx), zs = new Float64Array(this.nz);
    for (let i = 0; i < this.nx; i++) xs[i] = this.x0 + (i + 0.5) * this.c;
    for (let j = 0; j < this.nz; j++) zs[j] = this.z0 + (j + 0.5) * this.c;
    const lo = (arr, v) => { let a = 0, b = arr.length; while (a < b) { const m = (a + b) >> 1; if (arr[m] < v) a = m + 1; else b = m; } return a; }; // ô đầu tiên có tâm ≥ v
    const hi = (arr, v) => { let a = 0, b = arr.length; while (a < b) { const m = (a + b) >> 1; if (arr[m] <= v) a = m + 1; else b = m; } return a; }; // sau ô cuối có tâm ≤ v
    const fill = (r, val) => {
      const i0 = lo(xs, r.x0), i1 = hi(xs, r.x1), j0 = lo(zs, r.z0), j1 = hi(zs, r.z1);
      for (let j = j0; j < j1; j++) walk.fill(val, j * this.nx + i0, j * this.nx + Math.max(i0, i1));
    };
    for (const a of areas) fill(a, 1);
    for (const o of obs) fill(o, 0);
    this.walk = walk;
    this.dist = this._distance(walk);
    this.g = new Float32Array(N); this.par = new Int32Array(N); this.stamp = new Uint32Array(N); this.closed = new Uint32Array(N); this.gen = 0;
  }

  // Khoảng cách (m) từ tâm ô tới ô không đi được gần nhất (chamfer 2 lượt).
  _distance(walk) {
    const { nx, nz, c } = this, INF = 1e9, d = new Float32Array(nx * nz), D1 = c, D2 = c * Math.SQRT2;
    for (let i = 0; i < d.length; i++) d[i] = walk[i] ? INF : 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (!d[k]) continue;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + D1); else v = Math.min(v, D1 / 2);
      if (j > 0) { v = Math.min(v, d[k - nx] + D1); if (i > 0) v = Math.min(v, d[k - nx - 1] + D2); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + D2); } else v = Math.min(v, D1 / 2);
      d[k] = v;
    }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i; if (!d[k]) continue;
      let v = d[k];
      if (i < nx - 1) v = Math.min(v, d[k + 1] + D1); else v = Math.min(v, D1 / 2);
      if (j < nz - 1) { v = Math.min(v, d[k + nx] + D1); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + D2); if (i > 0) v = Math.min(v, d[k + nx - 1] + D2); } else v = Math.min(v, D1 / 2);
      d[k] = v;
    }
    // ô sát biên vật cản: tâm ô cách mép ô cản nửa ô
    for (let i = 0; i < d.length; i++) if (d[i]) d[i] -= c / 2;
    return d;
  }

  idx(x, z) {
    const i = Math.floor((x - this.x0) / this.c), j = Math.floor((z - this.z0) / this.c);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }
  cx(k) { return this.x0 + ((k % this.nx) + 0.5) * this.c; }
  cz(k) { return this.z0 + (Math.floor(k / this.nx) + 0.5) * this.c; }
  clearance(x, z) { const k = this.idx(x, z); return k < 0 ? 0 : this.dist[k]; }
  isFree(x, z, r = this.radius) { const k = this.idx(x, z); return k >= 0 && this.dist[k] >= r; }
  isFreeK(k, r = this.radius) { return this.dist[k] >= r; }

  /** Ô trống gần nhất (BFS theo vòng) trong bán kính maxR. */
  nearestFree(x, z, maxR = 1.5) {
    const k0 = this.idx(x, z);
    if (k0 >= 0 && this.isFreeK(k0)) return k0;
    const R = Math.ceil(maxR / this.c), i0 = Math.floor((x - this.x0) / this.c), j0 = Math.floor((z - this.z0) / this.c);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= R && best < 0; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        const k = j * this.nx + i; if (!this.isFreeK(k)) continue;
        const dd = (this.cx(k) - x) ** 2 + (this.cz(k) - z) ** 2;
        if (dd < bd) { bd = dd; best = k; }
      }
    }
    return best;
  }

  lineFree(ax, az, bx, bz, r = this.radius) {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / (this.c * 0.5)));
    for (let s = 0; s <= n; s++) { const t = s / n; if (!this.isFree(ax + (bx - ax) * t, az + (bz - az) * t, r * 0.98)) return false; }
    return true;
  }

  /** A* từ a tới b; trả về danh sách điểm {x,z} (đã làm mượt) hoặc null. */
  findPath(a, b) {
    const s = this.nearestFree(a.x, a.z), t = this.nearestFree(b.x, b.z);
    if (s < 0 || t < 0) return null;
    const gen = ++this.gen, { nx, c, g, par, stamp, closed, dist, radius } = this;
    const tx = this.cx(t), tz = this.cz(t);
    const h = k => { const dx = Math.abs(this.cx(k) - tx), dz = Math.abs(this.cz(k) - tz); return (Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz)); };
    const heap = new Heap();
    g[s] = 0; par[s] = -1; stamp[s] = gen; heap.push(h(s), s);
    const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    const soft = radius + 0.3;
    let found = false;
    while (heap.size) {
      const k = heap.pop();
      if (closed[k] === gen) continue;
      closed[k] = gen;
      if (k === t) { found = true; break; }
      const i = k % nx, j = (k - i) / nx;
      for (const [di, dj, w] of NB) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= this.nz) continue;
        const kk = jj * nx + ii;
        if (closed[kk] === gen || dist[kk] < radius) continue;
        if (di && dj && (dist[j * nx + ii] < radius || dist[jj * nx + i] < radius)) continue;
        const pen = dist[kk] < soft ? (soft - dist[kk]) * 4 : 0; // ưu tiên đi giữa lối
        const ng = g[k] + w * c * (1 + pen);
        if (stamp[kk] !== gen || ng < g[kk]) { stamp[kk] = gen; g[kk] = ng; par[kk] = k; heap.push(ng + h(kk), kk); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = t; k !== -1; k = par[k]) cells.push(k);
    cells.reverse();
    // làm mượt kiểu "kéo dây"
    const pts = cells.map(k => ({ x: this.cx(k), z: this.cz(k) }));
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineFree(pts[i].x, pts[i].z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]); i = j;
    }
    const res = [];
    const push = p => { const q = res[res.length - 1]; if (!q || Math.hypot(q.x - p.x, q.z - p.z) > 0.02) res.push({ x: p.x, z: p.z }); };
    push(a); for (const p of out) push(p); push(b);
    // bỏ điểm lưới thừa ở hai đầu nếu nhìn thẳng được
    if (res.length > 2 && this.lineFree(res[0].x, res[0].z, res[2].x, res[2].z, radius * 0.8)) res.splice(1, 1);
    if (res.length > 2) { const n = res.length; if (this.lineFree(res[n - 3].x, res[n - 3].z, res[n - 1].x, res[n - 1].z, radius * 0.8)) res.splice(n - 2, 1); }
    return res;
  }
}

/** Bộ điều hướng nhiều tầng: A* trên từng tầng + nối qua cầu thang. */
export class Navigator {
  constructor(model) {
    this.model = model;
    this.grids = new Map(model.floors.map(f => [f.id, new FloorGrid(model, f.id)]));
  }
  grid(f) { return this.grids.get(f); }

  stairChain(fa, fb) {
    if (fa === fb) return [];
    const prev = new Map([[fa, null]]), q = [fa];
    while (q.length) {
      const f = q.shift();
      for (const s of this.model.stairs) {
        for (const [a, b, dir] of [[s.from, s.to, 'up'], [s.to, s.from, 'down']]) {
          if (a !== f || prev.has(b)) continue;
          prev.set(b, { f, s, dir }); q.push(b);
        }
      }
    }
    if (!prev.has(fb)) return null;
    const chain = [];
    for (let f = fb; prev.get(f); f = prev.get(f).f) chain.unshift(prev.get(f));
    return chain;
  }

  /** Đường đi giữa hai điểm {x,z,f}; via là danh sách id waypoint đi qua. */
  path(from, to, via = []) {
    const stops = [from, ...via.map(v => typeof v === 'string' ? this.model.waypoints[v] : v), to];
    const out = [{ x: from.x, z: from.z, f: from.f }];
    for (let i = 0; i < stops.length - 1; i++) {
      const seg = this._leg(out[out.length - 1], stops[i + 1]);
      if (!seg) return null;
      for (const p of seg.slice(1)) out.push(p);
    }
    let len = 0;
    for (let i = 1; i < out.length; i++) len += Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z);
    return { points: out, length: len };
  }

  _leg(a, b) {
    const chain = this.stairChain(a.f, b.f);
    if (chain === null) return null;
    const pts = [{ ...a }];
    let cur = a;
    const flat = (p, q) => {
      const g = this.grid(p.f), r = g && g.findPath(p, q);
      if (!r) return false;
      for (const x of r.slice(1)) pts.push({ x: x.x, z: x.z, f: p.f });
      return true;
    };
    for (const { s, dir } of chain) {
      const st = s;
      if (dir === 'up') {
        if (!flat(cur, st.pEntry)) return null;
        pts[pts.length - 1].ev = { stair: st.id, enter: true, dir };
        pts.push({ ...st.pBottom, f: st.from, s: st.id });
        for (const v of st.pVia || []) pts.push({ ...v, f: st.from, s: st.id }); // (thang chữ U: qua chiếu nghỉ)
        pts.push({ ...st.pTop, f: st.to, s: st.id });
        pts.push({ ...st.pExit, f: st.to, ev: { stair: st.id, leave: true } });
        cur = st.pExit;
      } else {
        if (!flat(cur, st.pExit)) return null;
        pts[pts.length - 1].ev = { stair: st.id, enter: true, dir };
        pts.push({ ...st.pTop, f: st.to, s: st.id });
        for (const v of [...(st.pVia || [])].reverse()) pts.push({ ...v, f: st.from, s: st.id });
        pts.push({ ...st.pBottom, f: st.from, s: st.id });
        pts.push({ ...st.pEntry, f: st.from, ev: { stair: st.id, leave: true } });
        cur = st.pEntry;
      }
    }
    if (!flat(cur, b)) return null;
    return pts;
  }
}
