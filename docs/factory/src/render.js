/* Fleex Factory — canvas renderer. World units are floor tiles; text is drawn in screen space so it stays crisp. */
(function (root) {
'use strict';
var F = root.FleexFactory, TYPES = F.TYPES, GEST = F.GEST, clamp = F.clamp, DX = F.DX, DY = F.DY;
var SANS = '"Chakra Petch", ui-sans-serif, system-ui, sans-serif';
var MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
var C = {
  void: '#060807', floor: '#0d100f', grid: 'rgba(255,255,255,0.03)', gridEdit: 'rgba(255,255,255,0.085)',
  belt: '#1b2023', beltEdge: '#3d454c', chev: '#59636c',
  body: '#252a2e', body2: '#171a1c', edge: '#454d55', plate: 'rgba(9,9,11,0.84)',
  text: '#f4f4f5', text2: '#a1a1aa', text3: '#71717a',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', blue: '#60a5fa', orange: '#fb923c', hazard: '#eab308', steel: '#9aa3ab', idle: '#52525b'
};
var HEAT = { cost: ['#3a2410', '#fb923c'], time: ['#14263f', '#60a5fa'], human: ['#3a3208', '#facc15'], flow: ['#12301f', '#4ade80'] };
var STATUS_COL = { backlog: '#71717a', todo: '#fb923c', doing: '#60a5fa', reviewing: '#c084fc', done: '#22c55e' };

function mix(a, b, f) {
  var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  var r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * f),
      g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * f),
      bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * f);
  return 'rgb(' + r + ',' + g + ',' + bl + ')';
}
function alpha(hex, a) {
  var p = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((p >> 16) & 255) + ',' + ((p >> 8) & 255) + ',' + (p & 255) + ',' + a + ')';
}
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}

function stationState(sim, st) {
  var i, c, q = false, run = false, wq = false;
  for (i = 0; i < st.cells.length; i++) {
    c = st.cells[i];
    if (c.state === 'failed') return 'failed';
    if (c.state === 'question') q = true; else if (c.state === 'queued') wq = true; else if (c.run !== 'stamp') run = true;
  }
  if (st.outbox.length && sim.now - st.outbox[0].since > 4) return 'blocked';
  if (q || st.rack.length) return 'human';
  if (run) return sim.now < sim.outageUntil ? 'starved' : 'running';
  if (wq) return 'starved';
  return 'idle';
}
var LAMP = { failed: C.red, blocked: C.orange, human: C.amber, starved: C.blue, running: C.green, idle: C.idle };

/* what an arm lets through, in a few words: its filter, or what its filtered neighbours leave */
function armTag(a) {
  var f = a.filter;
  if (f && f.values.length) return f.values.join(' · ');
  var tk = a.src ? a.src.takers : [], taken = [], any = false, i;
  for (i = 0; i < tk.length; i++) if (tk[i] !== a && tk[i].filter && tk[i].filter.values.length) { any = true; if (tk[i].filter.field === 'outcome') taken = taken.concat(tk[i].filter.values); }
  if (!any) return '';
  if (a.src.kind === 'station' && a.src.outcomes.length > 1) {
    var rest = a.src.outcomes.map(function (o) { return o.name; }).filter(function (n) { return taken.indexOf(n) < 0; });
    if (rest.length && rest.length <= 2) return rest.join(' · ');
  }
  return 'sinon';
}
F.armTag = armTag;

function View(canvas, sim) {
  this.cv = canvas; this.ctx = canvas.getContext('2d'); this.sim = sim;
  this.cam = { x: sim.W / 2, y: sim.H / 2, z: 14 }; this.goal = null;
  this.inset = { l: 0, t: 0, r: 0, b: 0 };
  this.overlay = 'none'; this.heat = null; this.beacons = []; this.showBeacons = true; this.shown = null;
  this.sel = null; this.hover = null; this.follow = null; this.edit = false; this.ghost = null; this.dragT = null;
  this.w = 0; this.h = 0; this.dpr = 1; this.clock = 0; this.labels = []; this.reduced = false;
  this.tmp = { x: 0, y: 0 };
}

View.prototype.resize = function () {
  var d = Math.min(root.devicePixelRatio || 1, 2), w = this.cv.clientWidth, h = this.cv.clientHeight;
  if (w === this.w && h === this.h && d === this.dpr) return;
  this.w = w; this.h = h; this.dpr = d;
  this.cv.width = Math.max(1, Math.round(w * d)); this.cv.height = Math.max(1, Math.round(h * d));
};
View.prototype.toWorld = function (sx, sy) { return { x: (sx - this.w / 2) / this.cam.z + this.cam.x, y: (sy - this.h / 2) / this.cam.z + this.cam.y }; };
View.prototype.toScreen = function (wx, wy) { return { x: (wx - this.cam.x) * this.cam.z + this.w / 2, y: (wy - this.cam.y) * this.cam.z + this.h / 2 }; };
/* frame a world rectangle inside the area not covered by the HUD and panels */
View.prototype.frame = function (x, y, w, h, instant, maxZ) {
  var I = this.inset, aw = Math.max(80, this.w - I.l - I.r), ah = Math.max(80, this.h - I.t - I.b);
  var z = Math.min(aw / w, ah / h); if (maxZ) z = Math.min(z, maxZ);
  z = clamp(z, 5, 72);
  var g = { z: z, x: x + w / 2 + ((I.r - I.l) / 2) / z, y: y + h / 2 + ((I.b - I.t) / 2) / z };
  if (instant) { this.cam.x = g.x; this.cam.y = g.y; this.cam.z = g.z; this.goal = null; } else this.goal = g;
};
/* pilot: what is built; edit: the whole floor, free space included */
View.prototype.fit = function (instant) {
  var sim = this.sim, x0 = sim.W, y0 = sim.H, x1 = 0, y1 = 0, i, e;
  this.follow = null;
  if (!this.edit) for (i = 0; i < sim.ents.length; i++) { e = sim.ents[i]; x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h); }
  if (this.edit || x1 <= x0) { x0 = 0; y0 = 0; x1 = sim.W; y1 = sim.H; }
  this.frame(x0 - 1.2, y0 - 1.2, x1 - x0 + 2.4, y1 - y0 + 2.4, instant);
};
View.prototype.lookAt = function (x, y, z) {
  var I = this.inset; z = z || Math.max(this.cam.z, 26);
  this.goal = { z: z, x: x + ((I.r - I.l) / 2) / z, y: y + ((I.b - I.t) / 2) / z };
};
View.prototype.zoomAt = function (sx, sy, factor) {
  var before = this.toWorld(sx, sy);
  this.cam.z = clamp(this.cam.z * factor, 5, 72);
  var after = this.toWorld(sx, sy);
  this.cam.x += before.x - after.x; this.cam.y += before.y - after.y; this.goal = null;
};

View.prototype.label = function (str, wx, wy, size, color, o) { this.labels.push([str, wx, wy, size, color, o || null]); };
View.prototype.flushLabels = function () {
  var ctx = this.ctx, d = this.dpr, z = this.cam.z, L = this.labels;
  ctx.save(); ctx.setTransform(d, 0, 0, d, 0, 0);
  for (var i = 0; i < L.length; i++) {
    var l = L[i], o = l[5] || {}, px = l[3] * z;
    if (px < (o.hide || 0)) continue;
    if (o.min) px = Math.max(px, o.min);
    if (o.max) px = Math.min(px, o.max);
    var sx = (l[1] - this.cam.x) * z + this.w / 2, sy = (l[2] - this.cam.y) * z + this.h / 2;
    if (sx < -260 || sx > this.w + 260 || sy < -40 || sy > this.h + 40) continue;
    ctx.font = (o.weight || 500) + ' ' + px.toFixed(1) + 'px ' + (o.mono ? MONO : SANS);
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'middle';
    var str = l[0];
    if (o.fit) { var room = o.fit * z; if (ctx.measureText(str).width > room) { while (str.length > 3 && ctx.measureText(str + '…').width > room) str = str.slice(0, -1); str += '…'; } }
    if (o.plate) {
      var tw = ctx.measureText(str).width, padX = px * 0.45, ph = px * 1.5;
      var x0 = o.align === 'center' ? sx - tw / 2 - padX : o.align === 'right' ? sx - tw - padX : sx - padX;
      ctx.fillStyle = o.plate === true ? C.plate : o.plate;
      rr(ctx, x0, sy - ph / 2, tw + padX * 2, ph, Math.min(4, ph / 3)); ctx.fill();
      if (o.rim) { ctx.strokeStyle = o.rim; ctx.lineWidth = 1; ctx.stroke(); }
    }
    ctx.fillStyle = l[4]; ctx.fillText(str, sx, sy);
  }
  ctx.restore(); L.length = 0;
};

/* ---------- drawing primitives ---------- */
View.prototype.isSel = function (t) { var s = this.sel; return !!s && ((s.type === 'ticket' && s.t === t) || (s.type === 'tickets' && s.list.indexOf(t) >= 0)); };
View.prototype.ticket = function (t, x, y, s, dim) {
  var ctx = this.ctx, col = t.triaged ? TYPES[t.type].color : '#8b949e';
  t.x = x; t.y = y;
  if (this.dragT && this.dragT.t === t) dim = true;
  if (this.shown && !this.shown.has(t.id)) dim = true;
  ctx.globalAlpha = dim ? 0.22 : 1;
  if (!t.triaged) {
    ctx.fillStyle = '#6e7781'; ctx.strokeStyle = '#c9d1d9';
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 3 * i + (t.id % 5) * 0.3, r = s * (0.5 + ((t.id * (i + 3)) % 7) / 40);
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill(); ctx.lineWidth = 0.035; ctx.stroke();
  } else {
    rr(ctx, x - s / 2, y - s / 2, s, s, s * 0.22);
    ctx.fillStyle = col; ctx.fill();
    ctx.lineWidth = 0.045; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(x - s / 2 + s * 0.16, y - s / 2 + s * 0.14, s * 0.68, s * 0.14);
    if (t.reworks) { ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x + s * 0.2, y + s * 0.2, s * 0.13, 0, 6.3); ctx.fill(); }
    if (t.priority === 'urgent') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x - s * 0.36, y - s * 0.36, s * 0.16, 0, 6.3); ctx.fill();
      ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(x - s * 0.36, y - s * 0.36, s * 0.1, 0, 6.3); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  if (this.isSel(t)) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.arc(x, y, Math.max(s * 0.95, 0.3), 0, 6.3); ctx.stroke(); }
};
/* a ticket held by a machine, with what is happening to it: no gauge, a run has no known progress */
View.prototype.held = function (t, x, y, s, state) {
  var ctx = this.ctx, blink = this.reduced || Math.floor(this.clock * 2.4) % 2 === 0;
  if (state === 'queued') { ctx.globalAlpha = 0.45; this.ticket(t, x, y, s); ctx.globalAlpha = 1; ctx.strokeStyle = C.blue; ctx.lineWidth = 0.05; ctx.setLineDash([0.1, 0.08]); rr(ctx, x - s / 2 - 0.05, y - s / 2 - 0.05, s + 0.1, s + 0.1, 0.12); ctx.stroke(); ctx.setLineDash([]); return; }
  this.ticket(t, x, y, s);
  if (state === 'running') {
    if (s * this.cam.z > 6) {
      var a0 = this.reduced ? 0.6 : this.clock * 4 + t.id;
      ctx.strokeStyle = 'rgba(0,0,0,0.62)'; ctx.lineWidth = s * 0.15; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x, y, s * 0.24, a0, a0 + 4.2); ctx.stroke(); ctx.lineCap = 'butt';
    }
  } else if (state === 'human' || state === 'failed') {
    ctx.strokeStyle = state === 'failed' ? C.red : C.amber; ctx.lineWidth = blink ? 0.1 : 0.05;
    rr(ctx, x - s / 2 - 0.06, y - s / 2 - 0.06, s + 0.12, s + 0.12, 0.13); ctx.stroke();
  } else if (state === 'out') { ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 0.04; rr(ctx, x - s / 2 - 0.04, y - s / 2 - 0.04, s + 0.08, s + 0.08, 0.1); ctx.stroke(); }
};

View.prototype.hazard = function (x, y, w, h, t, c1, c2, rad) {
  var ctx = this.ctx; rad = rad || 0.28;
  ctx.save();
  rr(ctx, x, y, w, h, rad); ctx.clip();
  ctx.fillStyle = c2; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = c1; ctx.lineWidth = 0.2; ctx.beginPath();
  for (var k = -h; k < w + h; k += 0.56) { ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); }
  ctx.stroke();
  ctx.restore();
  rr(ctx, x + t, y + t, w - 2 * t, h - 2 * t, Math.max(0.1, rad - t * 0.4));
};

View.prototype.glyph = function (kind, x, y, r, col) {
  var ctx = this.ctx; ctx.save(); ctx.translate(x, y); ctx.scale(r, r);
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 0.16; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
  switch (kind) {
    case 'gmail': ctx.rect(-0.9, -0.6, 1.8, 1.2); ctx.moveTo(-0.9, -0.6); ctx.lineTo(0, 0.15); ctx.lineTo(0.9, -0.6); ctx.stroke(); break;
    case 'slack': ctx.moveTo(-0.35, -0.9); ctx.lineTo(-0.35, 0.9); ctx.moveTo(0.35, -0.9); ctx.lineTo(0.35, 0.9);
      ctx.moveTo(-0.9, -0.35); ctx.lineTo(0.9, -0.35); ctx.moveTo(-0.9, 0.35); ctx.lineTo(0.9, 0.35); ctx.stroke(); break;
    case 'meet': ctx.rect(-0.7, -0.9, 1.4, 1.8); ctx.moveTo(-0.35, -0.4); ctx.lineTo(0.35, -0.4); ctx.moveTo(-0.35, 0); ctx.lineTo(0.35, 0);
      ctx.moveTo(-0.35, 0.4); ctx.lineTo(0.1, 0.4); ctx.stroke(); break;
    case 'github': ctx.moveTo(-0.45, -0.55); ctx.lineTo(-0.45, 0.55); ctx.moveTo(0.45, -0.55); ctx.quadraticCurveTo(0.45, 0.1, -0.45, 0.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(-0.45, -0.72, 0.2, 0, 6.3); ctx.arc(-0.45, 0.72, 0.2, 0, 6.3); ctx.arc(0.45, -0.72, 0.2, 0, 6.3); ctx.fill(); break;
    case 'linear': ctx.moveTo(-0.8, 0.1); ctx.lineTo(-0.1, 0.8); ctx.moveTo(-0.8, -0.5); ctx.lineTo(0.5, 0.8); ctx.moveTo(-0.5, -0.8); ctx.lineTo(0.8, 0.5);
      ctx.moveTo(0.1, -0.8); ctx.lineTo(0.8, -0.1); ctx.stroke(); break;
    case 'routine': ctx.arc(0, 0, 0.85, 0, 6.3); ctx.moveTo(0, -0.45); ctx.lineTo(0, 0); ctx.lineTo(0.35, 0.25); ctx.stroke(); break;
    case 'cli': ctx.moveTo(-0.8, -0.5); ctx.lineTo(-0.2, 0); ctx.lineTo(-0.8, 0.5); ctx.moveTo(0.05, 0.55); ctx.lineTo(0.8, 0.55); ctx.stroke(); break;
    case 'arrow': ctx.moveTo(-0.7, 0); ctx.lineTo(0.5, 0); ctx.moveTo(0.05, -0.5); ctx.lineTo(0.6, 0); ctx.lineTo(0.05, 0.5); ctx.stroke(); break;
  }
  ctx.restore();
};

/* ---------- machines ---------- */
View.prototype.feeds = function (n, x, y) {
  if (!n) return false;
  return n.kind === 'belt' && n.x + DX[n.dir] === x && n.y + DY[n.dir] === y;
};
/* a belt fed from one side only, and not from behind, is a bend: returns the direction its feeder travels in, or -1 */
View.prototype.bendOf = function (b) {
  var s, f = -1, cnt = 0;
  for (s = 0; s < 4; s++) { if (s !== b.dir && this.feeds(this.sim.at(b.x + DX[s], b.y + DY[s]), b.x, b.y)) { cnt++; f = (s + 2) % 4; } }
  b._in = cnt > 0;
  return cnt === 1 && f !== b.dir ? f : -1;
};
View.prototype.beltTile = function (b) {
  var ctx = this.ctx, sim = this.sim, x = b.x, y = b.y, d = b.dir, dx = DX[d], dy = DY[d], s, n, f = this.bendOf(b), hot = null, k, cx, cy;
  b._f = f;
  if (this.overlay === 'flow' && this.heat) { var h = this.heat.get(b.id); if (h && h.v > 0) hot = mix(HEAT.flow[0], HEAT.flow[1], h.v); }
  var fx = f >= 0 ? DX[f] : 0, fy = f >= 0 ? DY[f] : 0, px = x + 0.5 - fx * 0.5 + dx * 0.5, py = y + 0.5 - fy * 0.5 + dy * 0.5;
  if (f >= 0) {
    /* a bend turns around the tile corner between the side it is fed from and the side it feeds */
    var a0 = Math.atan2(-dy, -dx), cw = -dx * fy + dy * fx > 0, a1 = a0 + (cw ? 1 : -1) * Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, 1.01, a0, a1, !cw); ctx.closePath(); ctx.fillStyle = C.belt; ctx.fill();
    if (hot) { ctx.globalAlpha = 0.6; ctx.fillStyle = hot; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.strokeStyle = C.beltEdge; ctx.lineWidth = 0.09;
    ctx.beginPath(); ctx.arc(px, py, 0.955, a0, a1, !cw); ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, 0.045, a0, a1, !cw); ctx.stroke();
  } else {
    ctx.fillStyle = C.belt; ctx.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
    if (hot) { ctx.globalAlpha = 0.6; ctx.fillStyle = hot; ctx.fillRect(x, y, 1, 1); ctx.globalAlpha = 1; }
    ctx.strokeStyle = C.beltEdge; ctx.lineWidth = 0.09; ctx.beginPath();
    for (s = 0; s < 4; s++) {
      n = sim.at(x + DX[s], y + DY[s]);
      var open = s === d ? !!n && (n.kind === 'belt' || F.isBox(n)) : this.feeds(n, x, y);
      if (open) continue;
      if (s === 0) { ctx.moveTo(x + 0.955, y); ctx.lineTo(x + 0.955, y + 1); } else if (s === 2) { ctx.moveTo(x + 0.045, y); ctx.lineTo(x + 0.045, y + 1); }
      else if (s === 1) { ctx.moveTo(x, y + 0.955); ctx.lineTo(x + 1, y + 0.955); } else { ctx.moveTo(x, y + 0.045); ctx.lineTo(x + 1, y + 0.045); }
    }
    ctx.stroke();
  }
  /* a belt that leads nowhere says so */
  n = sim.at(x + dx, y + dy);
  if (!(n && (n.kind === 'belt' || F.isBox(n))) && !b.takers.length) { ctx.strokeStyle = C.red; ctx.lineWidth = 0.12; ctx.beginPath(); ctx.moveTo(x + 0.5 + dx * 0.42 - dy * 0.4, y + 0.5 + dy * 0.42 - dx * 0.4); ctx.lineTo(x + 0.5 + dx * 0.42 + dy * 0.4, y + 0.5 + dy * 0.42 + dx * 0.4); ctx.stroke(); }
  b._out = !!n && n.kind === 'belt';
};
/* The moving chevrons, drawn once every belt base is down: one that straddles two tiles is then never painted over by the next tile.
   Where a belt starts or ends, they fade in and out instead of poking out of it. */
View.prototype.beltChevrons = function (b) {
  var ctx = this.ctx, d = b.dir, dx = DX[d], dy = DY[d], f = b._f, fx = f >= 0 ? DX[f] : 0, fy = f >= 0 ? DY[f] : 0, k, cx, cy, tx = dx, ty = dy;
  var px = b.x + 0.5 - fx * 0.5 + dx * 0.5, py = b.y + 0.5 - fy * 0.5 + dy * 0.5, off = this.reduced ? 0.25 : (this.clock * 0.9) % 0.5;
  for (k = 0; k < 2; k++) {
    var u = off + k * 0.5, al = 1;
    if (!b._in) al = Math.min(al, (u - 0.1) / 0.2);
    if (!b._out) al = Math.min(al, (0.9 - u) / 0.2);
    if (al <= 0.02) continue;
    if (f >= 0) { var ca = Math.cos(u * Math.PI / 2), sa = Math.sin(u * Math.PI / 2); cx = px + 0.5 * (fx * sa - dx * ca); cy = py + 0.5 * (fy * sa - dy * ca); tx = dx * sa + fx * ca; ty = dy * sa + fy * ca; }
    else { cx = b.x + 0.5 + dx * (u - 0.5); cy = b.y + 0.5 + dy * (u - 0.5); }
    ctx.globalAlpha = al < 1 ? al : 1;
    ctx.beginPath(); ctx.moveTo(cx - tx * 0.09 + ty * 0.19, cy - ty * 0.09 - tx * 0.19); ctx.lineTo(cx + tx * 0.09, cy + ty * 0.09); ctx.lineTo(cx - tx * 0.09 - ty * 0.19, cy - ty * 0.09 + tx * 0.19); ctx.stroke();
  }
  ctx.globalAlpha = 1;
};
/* where a ticket sits on its tile; in a bend it follows the curve */
View.prototype.itemXY = function (b, it, o) {
  var cx = b.x + 0.5, cy = b.y + 0.5, d = b.dir, f = b._f, k;
  if (f >= 0 && it.fx === DX[f] && it.fy === DY[f]) {
    var ca = Math.cos(it.p * Math.PI / 2), sa = Math.sin(it.p * Math.PI / 2);
    o.x = cx - DX[f] * 0.5 + DX[d] * 0.5 + 0.5 * (DX[f] * sa - DX[d] * ca); o.y = cy - DY[f] * 0.5 + DY[d] * 0.5 + 0.5 * (DY[f] * sa - DY[d] * ca);
  } else if (it.p < 0.5) { k = 0.5 - it.p; o.x = cx - it.fx * k; o.y = cy - it.fy * k; } else { k = it.p - 0.5; o.x = cx + DX[d] * k; o.y = cy + DY[d] * k; }
  return o;
};
/* how many tiles next to (x, y) a label may cover: empty floor and belts, nothing else */
View.prototype.freeRun = function (x, y, dx, max) {
  var n = 0, e;
  while (n < max) { var nx = x + dx * (n + 1); if (nx < 0 || nx >= this.sim.W) break; e = this.sim.at(nx, y); if (e && e.kind !== 'belt') break; n++; }
  return n;
};
View.prototype.arm = function (a) {
  var ctx = this.ctx, bx = a.x + 0.5, by = a.y + 0.5, dx = DX[a.dir], dy = DY[a.dir], e = a.p * a.p * (3 - 2 * a.p);
  var th = Math.atan2(dy, dx) + Math.PI * (1 - e), reach = 0.92, hx = bx + Math.cos(th) * reach, hy = by + Math.sin(th) * reach;
  var filt = a.filter && a.filter.values.length, col = filt ? C.hazard : C.steel, selArm = this.sel && this.sel.e === a;
  /* which way it works: a notch on the side it drops on */
  ctx.fillStyle = alpha(filt ? C.hazard : '#9aa3ab', 0.55); ctx.beginPath();
  ctx.moveTo(bx + dx * 0.48, by + dy * 0.48); ctx.lineTo(bx + dx * 0.3 - dy * 0.16, by + dy * 0.3 - dx * 0.16); ctx.lineTo(bx + dx * 0.3 + dy * 0.16, by + dy * 0.3 + dx * 0.16); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#101314'; ctx.beginPath(); ctx.arc(bx, by, 0.3, 0, 6.3); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 0.07; ctx.stroke();
  ctx.strokeStyle = '#0b0d0e'; ctx.lineWidth = 0.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 0.11; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke(); ctx.lineCap = 'butt';
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(bx, by, 0.13, 0, 6.3); ctx.fill();
  if (a.t) this.ticket(a.t, hx, hy, 0.44);
  ctx.strokeStyle = a.t ? '#fff' : col; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.arc(hx, hy, 0.17, th - 1.9, th + 1.9); ctx.stroke();
  var tag = armTag(a);
  if (!tag) return;
  var z = this.cam.z, px = clamp(0.3 * z, 9, 12), o = { min: 9, max: 12, plate: filt ? 'rgba(40,32,4,0.92)' : true, mono: true, rim: selArm ? '#fff' : filt ? 'rgba(234,179,8,0.5)' : null }, tc = filt ? '#fde68a' : C.text2;
  if (z < 11 && !selArm && !(this.hover && this.hover.e === a)) return;
  if (dy === 0) {
    /* next to a machine the label leans away from it, so it never covers its name */
    var up = !this.sim.at(a.x, a.y - 1) || !!this.sim.at(a.x, a.y + 1), ly = up ? a.y - 0.28 : a.y + 1.28, away = a.src && a.src.kind !== 'belt' ? dx : -dx;
    o.align = away > 0 ? 'left' : 'right'; this.label(tag, away > 0 ? a.x + 0.1 : a.x + 0.9, ly, 0.3, tc, o);
  } else {
    var need = tag.length * px * 0.62 / z + 0.5, r = this.freeRun(a.x, a.y, 1, 9), l = this.freeRun(a.x, a.y, -1, 9);
    if (r >= need || r >= l) { o.fit = Math.max(1.6, r - 0.3); this.label(tag, a.x + 1.14, by, 0.3, tc, o); }
    else { o.align = 'right'; o.fit = Math.max(1.6, l - 0.3); this.label(tag, a.x - 0.14, by, 0.3, tc, o); }
  }
};

View.prototype.station = function (st) {
  var ctx = this.ctx, sim = this.sim, x = st.x, y = st.y, w = st.w, h = st.h, state = stationState(sim, st), lamp = LAMP[state], i;
  var gate = st.exec === 'human_gate', nat = st.exec === 'native', big = w >= 3, dim = st.exec !== 'native' && st.exec !== 'human_gate' && sim.now < sim.outageUntil;
  st._state = state;
  if (gate) { this.hazard(x + 0.07, y + 0.07, w - 0.14, h - 0.14, 0.15, C.hazard, '#15130a', 0.3); ctx.fillStyle = C.body2; ctx.fill(); }
  else {
    rr(ctx, x + 0.07, y + 0.07, w - 0.14, h - 0.14, 0.28);
    var g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, nat ? '#1d2a22' : C.body); g.addColorStop(1, nat ? '#131a16' : C.body2);
    ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 0.06; ctx.strokeStyle = nat ? '#2f6b45' : st.router ? '#5b6b9a' : C.edge; ctx.stroke();
  }
  var on = state !== 'idle' && (state === 'running' || this.reduced || Math.floor(this.clock * 2.2) % 2 === 0);
  ctx.fillStyle = on ? lamp : C.idle; rr(ctx, x + 0.42, y + (gate ? 0.3 : 0.2), w - 0.84, 0.08, 0.04); ctx.fill();
  this.label(st.name, x + w / 2, y + (big ? 0.62 : 0.54), big ? 0.32 : 0.26, dim ? C.text3 : C.text, { align: 'center', weight: 600, min: 8, max: 14, hide: 3.6, fit: w - 0.25 });
  /* what is inside: waiting for a human, running, or queued for a slot */
  var cols = big ? 4 : 3, rows = big ? 2 : 1, size = big ? 0.5 : 0.4, gap = big ? 0.1 : 0.09, n = cols * rows;
  var x0 = x + (w - cols * size - (cols - 1) * gap) / 2, y0 = y + (big ? 0.92 : 0.8), k = 0, cx, cy;
  function place() { cx = x0 + (k % cols) * (size + gap) + size / 2; cy = y0 + Math.floor(k / cols) * (size + gap) + size / 2; }
  for (i = 0; i < n; i++) { k = i; place(); rr(ctx, cx - size / 2, cy - size / 2, size, size, 0.08); ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fill(); }
  k = 0;
  for (i = 0; i < st.rack.length; i++, k++) { if (k < n) { place(); this.held(st.rack[i].t, cx, cy, size * 0.86, 'human'); } else { st.rack[i].t.x = x + w / 2; st.rack[i].t.y = y + h / 2; } }
  for (i = 0; i < st.cells.length; i++, k++) {
    var c = st.cells[i], cs = c.state === 'question' ? 'human' : c.state === 'failed' ? 'failed' : c.state === 'queued' ? 'queued' : 'running';
    if (k < n) { place(); this.held(c.t, cx, cy, size * 0.86, cs); } else { c.t.x = x + w / 2; c.t.y = y + h / 2; }
  }
  if (k > n) this.label('+' + (k - n), x + w - 0.3, y0 - 0.12, 0.24, C.text2, { hide: 8, mono: true, align: 'right' });
  if (k >= st.cap) this.label('plein', x + w / 2, y + h + 0.26, 0.26, '#fdba74', { align: 'center', plate: true, min: 9, max: 12 });
  /* out-tray: what is done and waits for an arm */
  var ty = y + h - (big ? 0.86 : 0.64), th = big ? 0.56 : 0.44, ts = big ? 0.38 : 0.3, m = Math.floor((w - 0.7) / (ts + 0.08));
  rr(ctx, x + 0.28, ty, w - 0.56, th, 0.1); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
  if (state === 'blocked') { ctx.strokeStyle = C.orange; ctx.lineWidth = 0.05; ctx.stroke(); }
  for (i = 0; i < st.outbox.length; i++) {
    var ot = st.outbox[i].t;
    if (i < m) this.held(ot, x + 0.4 + ts / 2 + i * (ts + 0.08), ty + th / 2, ts, 'out'); else { ot.x = x + w - 0.5; ot.y = ty + th / 2; }
  }
  if (!st.outbox.length && this.cam.z > 16) this.label('sortie', x + w / 2, ty + th / 2, 0.2, 'rgba(255,255,255,0.22)', { align: 'center', hide: 8 });
};

/* a zone: tickets in stock, tickets being worked on by hand, tickets let out and waiting for an arm */
View.prototype.depot = function (d) {
  var ctx = this.ctx, x = d.x, y = d.y, w = d.w, h = d.h, col = STATUS_COL[d.status] || '#71717a', i, idle = 0, waiting = 0, it;
  rr(ctx, x + 0.07, y + 0.07, w - 0.14, h - 0.14, 0.22); ctx.fillStyle = '#12161a'; ctx.fill(); ctx.strokeStyle = this.sim.works(d) ? '#8a6d0a' : '#3b434a'; ctx.lineWidth = 0.08; ctx.stroke();
  ctx.fillStyle = col; rr(ctx, x + 0.3, y + 0.24, 0.14, 0.4, 0.05); ctx.fill();
  for (i = 0; i < d.items.length; i++) { it = d.items[i]; if (!it.released) waiting++; if (it.state === 'idle') idle++; }
  this.label(d.name + ' · ' + waiting + (idle ? ' · ' + idle + ' à relancer' : ''), x + 0.58, y + 0.45, 0.34, idle ? '#fcd34d' : C.text, { weight: 600, min: 9, max: 15, hide: 3.6, fit: w - 0.8 });
  if (d.release === 'auto' && w >= 4) this.label('auto', x + w - 0.3, y + 0.45, 0.24, C.green, { align: 'right', hide: 9, mono: true });
  var pitch = 0.5, cols = Math.max(1, Math.floor((w - 0.5) / pitch)), rows = Math.max(1, Math.floor((h - 1.05) / pitch)), n = cols * rows, ox = x + (w - cols * pitch) / 2 + pitch / 2, oy = y + 0.85 + pitch / 2;
  for (i = 0; i < d.items.length; i++) {
    it = d.items[i];
    if (i < n) this.held(it.t, ox + (i % cols) * pitch, oy + Math.floor(i / cols) * pitch, 0.38, it.released ? 'out' : it.state === 'idle' ? 'human' : it.state === 'run' ? 'running' : it.state === 'queued' ? 'queued' : '');
    else { it.t.x = x + w - 0.5; it.t.y = y + h - 0.4; }
  }
  if (d.items.length > n) this.label('+' + (d.items.length - n), x + w - 0.28, y + h - 0.32, 0.26, C.text2, { align: 'right', mono: true, hide: 6, plate: true });
};

/* a source works like a station with nothing to run: tickets wait in its out-tray until an arm takes them */
View.prototype.intake = function (s) {
  var ctx = this.ctx, x = s.x, y = s.y, w = s.w, h = s.h, live = s.on && s.transfer, i;
  rr(ctx, x + 0.07, y + 0.07, w - 0.14, h - 0.14, 0.28);
  var g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#263038'); g.addColorStop(1, '#161b1f');
  ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = live ? '#4b5a66' : '#33393e'; ctx.lineWidth = 0.06; ctx.stroke();
  if (!s.transfer) { ctx.save(); rr(ctx, x + 0.07, y + 0.07, w - 0.14, h - 0.14, 0.28); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 0.14; ctx.beginPath(); for (var k = -h; k < w + h; k += 0.45) { ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); } ctx.stroke(); ctx.restore(); }
  this.glyph(s.sid, x + w / 2, y + 0.72, 0.4, live ? '#cbd5e1' : '#5b6670');
  var ty = y + h - 0.64, th = 0.44, ts = 0.3, m = Math.floor((w - 0.7) / (ts + 0.08)), stuck = s.buffer.length >= 3;
  rr(ctx, x + 0.28, ty, w - 0.56, th, 0.1); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
  if (stuck) { ctx.strokeStyle = C.orange; ctx.lineWidth = 0.05; ctx.stroke(); }
  for (i = 0; i < s.buffer.length; i++) {
    if (i < m) this.held(s.buffer[i], x + 0.4 + ts / 2 + i * (ts + 0.08), ty + th / 2, ts, 'out'); else { s.buffer[i].x = x + w - 0.5; s.buffer[i].y = ty + th / 2; }
  }
  if (s.buffer.length > m) this.label('+' + (s.buffer.length - m), x + w - 0.24, y + 0.36, 0.24, stuck ? '#fdba74' : C.text2, { align: 'right', mono: true, plate: true, hide: 6 });
  this.label(s.name + (!s.transfer ? ' · hors factory' : !s.on ? ' · coupé' : ''), x + 0.1, y + h + 0.3, 0.27, live ? C.text2 : C.text3, { min: 8, max: 12, hide: 3.6 });
};

View.prototype.exit = function (e) {
  var ctx = this.ctx, x = e.x, y = e.y, w = e.w, h = e.h, i;
  rr(ctx, x + 0.07, y + 0.07, w - 0.14, h - 0.14, 0.3);
  var g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#1b2620'); g.addColorStop(1, '#101713');
  ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#2f6b45'; ctx.lineWidth = 0.08; ctx.stroke();
  ctx.strokeStyle = 'rgba(74,222,128,0.28)'; ctx.lineWidth = 0.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
  var horiz = w >= h, len = horiz ? w : h, off = this.reduced ? 0 : (this.clock * 0.5) % 1;
  for (i = 2.2; i < len - 0.8; i += 2.2) {
    var px = horiz ? x + i + off * 0.4 : x + w / 2 + off * 0.3, py = horiz ? y + h / 2 : y + i;
    ctx.moveTo(px - 0.25, py - 0.3); ctx.lineTo(px + 0.1, py); ctx.lineTo(px - 0.25, py + 0.3);
  }
  ctx.stroke(); ctx.lineCap = 'butt';
  this.label(e.name, x + w / 2, y + 0.55, 0.32, '#86efac', { align: 'center', weight: 600, min: 9, max: 14, hide: 3.6, fit: Math.max(w, 3) });
  this.label('done · ' + this.sim.sum(e.count, 24) + ' / 24 h', x + w / 2, y + 1.05, 0.24, C.text2, { align: 'center', hide: 7, fit: Math.max(w, 3) });
};

View.prototype.poolBox = function (e) {
  var ctx = this.ctx, pool = this.sim.pool, x = e.x, y = e.y, w = e.w, h = e.h, i, out = this.sim.now < this.sim.outageUntil;
  rr(ctx, x + 0.07, y + 0.07, w - 0.14, h - 0.14, 0.24); ctx.fillStyle = '#14181d'; ctx.fill(); ctx.strokeStyle = pool.used >= pool.max ? C.amber : '#34465c'; ctx.lineWidth = 0.06; ctx.stroke();
  var cols = pool.max <= 12 ? 6 : pool.max <= 24 ? 8 : 12, rows = Math.ceil(pool.max / cols), cw = (w - 0.5) / cols, ch = (h - 0.95) / rows, r = Math.min(cw, ch) * 0.36;
  for (i = 0; i < pool.max; i++) {
    ctx.fillStyle = out ? '#7f1d1d' : i < pool.used ? C.blue : '#27313d';
    ctx.beginPath(); ctx.arc(x + 0.25 + (i % cols + 0.5) * cw, y + 0.72 + (Math.floor(i / cols) + 0.5) * ch, r, 0, 6.3); ctx.fill();
  }
  this.label(out ? 'Panne API' : 'Slots ' + pool.used + '/' + pool.max, x + w / 2, y + 0.42, 0.27, out ? '#fca5a5' : C.text2, { align: 'center', min: 8, max: 12, hide: 3.6 });
};

/* ---------- frame ---------- */
View.prototype.floor = function () {
  var ctx = this.ctx, sim = this.sim, z = this.cam.z, i;
  rr(ctx, -0.6, -0.6, sim.W + 1.2, sim.H + 1.2, 0.8); ctx.fillStyle = C.floor; ctx.fill();
  ctx.strokeStyle = this.edit ? 'rgba(96,165,250,0.5)' : 'rgba(255,255,255,0.07)'; ctx.lineWidth = this.edit ? 0.08 : 0.05; ctx.stroke();
  if (z >= (this.edit ? 6 : 11)) {
    ctx.strokeStyle = this.edit ? C.gridEdit : C.grid; ctx.lineWidth = 1 / z; ctx.beginPath();
    for (i = 0; i <= sim.W; i++) { ctx.moveTo(i, 0); ctx.lineTo(i, sim.H); }
    for (i = 0; i <= sim.H; i++) { ctx.moveTo(0, i); ctx.lineTo(sim.W, i); }
    ctx.stroke();
  }
};

View.prototype.draw = function (dtReal) {
  var ctx = this.ctx, sim = this.sim, cam = this.cam, d = this.dpr, i, e, ents = sim.ents, o = this.tmp;
  this.resize();
  this.clock += dtReal;
  if (this.follow) {
    var ft = this.follow;
    if (ft.status === 'done' || !sim.tickets.has(ft.id)) this.follow = null;
    else this.goal = { x: ft.x + ((this.inset.r - this.inset.l) / 2) / cam.z, y: ft.y + ((this.inset.b - this.inset.t) / 2) / cam.z, z: cam.z };
  }
  if (this.goal) {
    var k = 1 - Math.pow(0.002, dtReal), g = this.goal;
    cam.x += (g.x - cam.x) * k; cam.y += (g.y - cam.y) * k; cam.z += (g.z - cam.z) * k;
    if (!this.follow && Math.abs(g.x - cam.x) < 0.01 && Math.abs(g.y - cam.y) < 0.01 && Math.abs(g.z - cam.z) < 0.02) this.goal = null;
  }
  var z = cam.z;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.fillStyle = C.void; ctx.fillRect(0, 0, this.w, this.h);
  ctx.setTransform(z * d, 0, 0, z * d, (this.w / 2 - cam.x * z) * d, (this.h / 2 - cam.y * z) * d);

  this.floor();
  var dimItems = this.overlay === 'cost' || this.overlay === 'time';
  for (i = 0; i < ents.length; i++) if (ents[i].kind === 'belt') this.beltTile(ents[i]);
  if (z >= 8) {
    ctx.strokeStyle = this.edit ? '#8f9aa4' : C.chev; ctx.lineWidth = 0.07; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (i = 0; i < ents.length; i++) if (ents[i].kind === 'belt') this.beltChevrons(ents[i]);
    ctx.lineCap = 'butt';
  }
  for (i = 0; i < ents.length; i++) {
    e = ents[i];
    if (e.kind === 'label') { if (this.edit) { ctx.strokeStyle = alpha(e.color, 0.5); ctx.lineWidth = 0.04; ctx.setLineDash([0.12, 0.1]); ctx.strokeRect(e.x + 0.1, e.y + 0.1, 0.8, 0.8); ctx.setLineDash([]); }
      this.label(e.text, e.x + 0.12, e.y + 0.5, 0.62, e.color, { weight: 700, min: 10, max: 24 }); }
    else if (e.kind === 'belt' && e.item) { this.itemXY(e, e.item, o); this.ticket(e.item.t, o.x, o.y, 0.46, dimItems); }
  }
  for (i = 0; i < sim.loose.length; i++) {
    var lo = sim.loose[i];
    ctx.strokeStyle = C.amber; ctx.lineWidth = 0.05; ctx.setLineDash([0.12, 0.1]); ctx.beginPath(); ctx.arc(lo.x + 0.5, lo.y + 0.5, 0.42, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
    this.ticket(lo.t, lo.x + 0.5, lo.y + 0.5, 0.5);
  }
  for (i = 0; i < ents.length; i++) {
    e = ents[i];
    if (e.kind === 'intake') this.intake(e); else if (e.kind === 'depot') this.depot(e);
    else if (e.kind === 'exit') this.exit(e); else if (e.kind === 'pool') this.poolBox(e); else if (e.kind === 'station') this.station(e);
  }
  for (i = 0; i < ents.length; i++) if (ents[i].kind === 'arm') this.arm(ents[i]);
  this.overlays();
  this.ports();
  this.drawPath();
  this.operator();
  this.selection();
  this.tools();

  /* night shift: the floor dims, working stations keep their glow */
  var hod = sim.hourOfDay(), dark = this.edit ? 0 : hod < 5.5 ? 1 : hod < 7.5 ? (7.5 - hod) / 2 : hod < 18.5 ? 0 : hod < 21 ? (hod - 18.5) / 2.5 : 1;
  if (dark > 0.01) {
    ctx.fillStyle = 'rgba(3,6,20,' + (dark * 0.42) + ')'; ctx.fillRect(-1, -1, sim.W + 2, sim.H + 2);
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < ents.length; i++) {
      e = ents[i];
      if (e.kind !== 'station' || e._state === 'idle') continue;
      var col = LAMP[e._state], cx = e.x + e.w / 2, cy = e.y + e.h / 2, gr = ctx.createRadialGradient(cx, cy, 0.2, cx, cy, 3.2);
      gr.addColorStop(0, alpha(col, 0.15 * dark)); gr.addColorStop(1, alpha(col, 0));
      ctx.fillStyle = gr; ctx.fillRect(cx - 3.2, cy - 3.2, 6.4, 6.4);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  this.flushLabels();
  this.drawBeacons();
  this.flushLabels();
};

View.prototype.overlays = function () {
  var ctx = this.ctx, ov = this.overlay, heat = this.heat, ents = this.sim.ents, i;
  if (ov === 'none' || ov === 'flow' || !heat) return;
  var ramp = HEAT[ov];
  for (i = 0; i < ents.length; i++) {
    var e = ents[i], h = heat.get(e.id);
    if (!h || !h.v) continue;
    rr(ctx, e.x + 0.07, e.y + 0.07, e.w - 0.14, e.h - 0.14, 0.26);
    ctx.fillStyle = mix(ramp[0], ramp[1], h.v); ctx.globalAlpha = 0.34 + 0.4 * h.v; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = ramp[1]; ctx.lineWidth = 0.05; ctx.stroke();
    if (h.label) this.label(h.label, e.x + e.w / 2, e.y + e.h / 2 + 0.3, 0.34, '#fff', { align: 'center', mono: true, weight: 600, plate: true, min: 9, max: 14 });
  }
};

/* the selected container shows what feeds it and what empties it */
View.prototype.ports = function () {
  var s = this.sel, hv = this.hover, e = s && s.type === 'ent' ? s.e : hv && hv.type === 'ent' && this.edit ? hv.e : null, ctx = this.ctx, sim = this.sim, i, x, y, n;
  if (!e || !F.isBox(e) && e.kind !== 'intake') return;
  function mark(cx, cy, col) { ctx.strokeStyle = col; ctx.lineWidth = 0.07; rr(ctx, cx + 0.04, cy + 0.04, 0.92, 0.92, 0.16); ctx.stroke(); }
  for (x = e.x - 1; x <= e.x + e.w; x++) for (y = e.y - 1; y <= e.y + e.h; y++) {
    if (x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h) continue;
    n = sim.at(x, y);
    if (!n) continue;
    if (n.kind === 'belt' && sim.at(n.x + DX[n.dir], n.y + DY[n.dir]) === e) mark(x, y, C.green);
    else if (n.kind === 'arm' && n.dst === e) mark(x, y, C.green);
  }
  for (i = 0; i < e.takers.length; i++) mark(e.takers[i].x, e.takers[i].y, C.orange);
};

View.prototype.pathLine = function (p, dest) {
  var ctx = this.ctx, i, n = p.length;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 0.2; ctx.beginPath(); for (i = 0; i < n; i++) ctx[i ? 'lineTo' : 'moveTo'](p[i][0], p[i][1]); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.08; ctx.setLineDash([0.22, 0.2]); ctx.lineDashOffset = this.reduced ? 0 : -this.clock * 1.4;
  ctx.beginPath(); for (i = 0; i < n; i++) ctx[i ? 'lineTo' : 'moveTo'](p[i][0], p[i][1]); ctx.stroke(); ctx.setLineDash([]); ctx.lineCap = 'butt';
  var a = p[n - 1], b = p[n - 2], ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(a[0] + Math.cos(ang) * 0.3, a[1] + Math.sin(ang) * 0.3);
  ctx.lineTo(a[0] + Math.cos(ang + 2.5) * 0.3, a[1] + Math.sin(ang + 2.5) * 0.3); ctx.lineTo(a[0] + Math.cos(ang - 2.5) * 0.3, a[1] + Math.sin(ang - 2.5) * 0.3); ctx.closePath(); ctx.fill();
  if (dest) this.label('→ ' + dest, a[0], a[1] - 0.7, 0.3, '#fff', { align: 'center', plate: true, min: 10, max: 13 });
};
View.prototype.drawPath = function () {
  var list = [], s = this.sel, hv = this.hover, sim = this.sim;
  if (this.dragT) { if (this.dragT.path) this.pathLine(this.dragT.path.pts, this.dragT.path.dest); return; }
  if (s && s.type === 'ticket' && sim.tickets.has(s.t.id)) list.push(s.t);
  if (hv && hv.type === 'ticket' && list.indexOf(hv.t) < 0 && sim.tickets.has(hv.t.id)) list.push(hv.t);
  for (var k = 0; k < list.length; k++) { var tr = sim.trace(list[k]); if (tr) this.pathLine(tr.pts, tr.dest); }
};

View.prototype.operator = function () {
  var ctx = this.ctx, op = this.sim.op;
  if (op.state !== 'work' || this.edit) return;
  var x = op.x + 0.18, y = op.y + 0.18, k = 0.62, pulse = this.reduced ? 0.5 : (this.clock * 1.4) % 1;
  ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 * (1 - pulse)) + ')'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.arc(op.x, op.y, 0.3 + pulse * 0.45, 0, 6.3); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#0b0d0e'; ctx.lineWidth = 0.07; ctx.lineJoin = 'round'; ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x, y + 0.95 * k); ctx.lineTo(x + 0.26 * k, y + 0.7 * k); ctx.lineTo(x + 0.46 * k, y + 1.12 * k); ctx.lineTo(x + 0.62 * k, y + 1.04 * k);
  ctx.lineTo(x + 0.43 * k, y + 0.63 * k); ctx.lineTo(x + 0.76 * k, y + 0.63 * k); ctx.closePath(); ctx.fill(); ctx.stroke();
};

View.prototype.drawBeacons = function () {
  if (!this.showBeacons || this.overlay !== 'none' || this.edit) return;
  var cols = { human: C.amber, question: C.amber, bench: C.amber, todo: C.orange, cost: C.orange, pool: C.blue, automate: C.blue, stuck: C.red };
  for (var i = 0; i < this.beacons.length; i++) {
    var c = this.beacons[i], r = c.ref || (c.loose ? { x: c.loose.x, y: c.loose.y, w: 1, h: 1 } : null);
    if (!r) continue;
    this.label('Goulot ' + (i + 1), r.x + r.w / 2, r.y - 0.62, 0.3, '#0b0d0e', { align: 'center', weight: 700, plate: cols[c.kind] || C.amber, min: 10, max: 13 });
  }
};

View.prototype.outline = function (e, strong) {
  var ctx = this.ctx;
  ctx.strokeStyle = strong ? '#fff' : 'rgba(255,255,255,0.5)'; ctx.lineWidth = strong ? 0.08 : 0.05;
  rr(ctx, e.x - 0.04, e.y - 0.04, e.w + 0.08, e.h + 0.08, e.w > 1 ? 0.32 : 0.2); ctx.stroke();
};
View.prototype.selection = function () {
  var s = this.sel, hv = this.hover;
  if (hv && hv.type === 'ent' && !(s && s.e === hv.e)) this.outline(hv.e, false);
  if (s && s.type === 'ent' && this.sim.ents.indexOf(s.e) >= 0) {
    this.outline(s.e, true);
    if (s.e.kind === 'arm') { var a = s.e, ctx = this.ctx;
      ctx.strokeStyle = C.green; ctx.lineWidth = 0.07; rr(ctx, a.x - DX[a.dir] + 0.06, a.y - DY[a.dir] + 0.06, 0.88, 0.88, 0.16); ctx.stroke();
      ctx.strokeStyle = C.orange; rr(ctx, a.x + DX[a.dir] + 0.06, a.y + DY[a.dir] + 0.06, 0.88, 0.88, 0.16); ctx.stroke(); }
  }
};

/* what the editor is about to do, and the ticket being carried by hand */
View.prototype.tools = function () {
  var ctx = this.ctx, g = this.ghost, d = this.dragT, i;
  if (g) {
    var list = g.list || [g];
    for (i = 0; i < list.length; i++) {
      var q = list[i];
      ctx.fillStyle = g.erase ? 'rgba(239,68,68,0.28)' : g.ok ? 'rgba(96,165,250,0.26)' : 'rgba(239,68,68,0.3)';
      ctx.strokeStyle = g.erase || !g.ok ? C.red : C.blue; ctx.lineWidth = 0.06;
      rr(ctx, q.x + 0.05, q.y + 0.05, q.w - 0.1, q.h - 0.1, 0.18); ctx.fill(); ctx.stroke();
      if (q.dir != null && (q.kind === 'belt' || q.kind === 'arm')) { ctx.save(); ctx.translate(q.x + q.w / 2, q.y + q.h / 2); ctx.rotate(q.dir * Math.PI / 2); this.glyph('arrow', 0, 0, 0.38, '#fff'); ctx.restore(); }
    }
    if (g.text) this.label(g.text, list[0].x + list[0].w / 2, list[0].y - 0.4, 0.3, '#fff', { align: 'center', plate: g.ok ? 'rgba(30,64,120,0.95)' : 'rgba(127,29,29,0.95)', min: 10, max: 13 });
  }
  if (d) {
    var tx = Math.floor(d.x), ty = Math.floor(d.y), e = this.sim.at(tx, ty), box = e && e.kind !== 'belt' ? e : { x: tx, y: ty, w: 1, h: 1 };
    ctx.strokeStyle = d.ok ? C.green : C.amber; ctx.lineWidth = 0.09; ctx.setLineDash(d.ok ? [] : [0.16, 0.12]);
    rr(ctx, box.x + 0.03, box.y + 0.03, box.w - 0.06, box.h - 0.06, 0.2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = d.ok ? 'rgba(34,197,94,0.14)' : 'rgba(245,158,11,0.1)'; ctx.fill();
    ctx.globalAlpha = 0.95; var keep = this.dragT; this.dragT = null; var ox = d.t.x, oy = d.t.y; this.ticket(d.t, d.x, d.y, 0.6); d.t.x = ox; d.t.y = oy; this.dragT = keep; ctx.globalAlpha = 1;
    this.label(d.text, d.x, d.y - 0.75, 0.3, '#fff', { align: 'center', plate: d.ok ? 'rgba(20,83,45,0.95)' : 'rgba(120,53,15,0.95)', min: 10, max: 13 });
  }
};

/* ---------- picking ---------- */
View.prototype.pick = function (sx, sy, noTickets) {
  var p = this.toWorld(sx, sy), sim = this.sim, tol = Math.max(0.3, 9 / this.cam.z), best = null, bd = tol;
  if (!noTickets) sim.tickets.forEach(function (t) { var d = Math.hypot(t.x - p.x, t.y - p.y); if (d < bd) { bd = d; best = t; } });
  if (best) return { type: 'ticket', t: best };
  var e = sim.at(Math.floor(p.x), Math.floor(p.y));
  return e ? { type: 'ent', e: e } : null;
};

/* ---------- minimap ---------- */
View.prototype.minimap = function (cv) {
  var d = Math.min(root.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight, sim = this.sim;
  if (cv.width !== Math.round(w * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
  var c = cv.getContext('2d'), s = Math.min(w / (sim.W + 2), h / (sim.H + 2)), ox = (w - sim.W * s) / 2, oy = (h - sim.H * s) / 2, i;
  this._mini = { s: s, ox: ox, oy: oy };
  c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, w, h);
  c.fillStyle = '#0d100f'; c.fillRect(ox, oy, sim.W * s, sim.H * s);
  var col = { belt: '#3d454c', arm: '#9aa3ab', depot: '#52525b', exit: '#2f6b45', intake: '#4b5a66', pool: '#34465c' };
  for (i = 0; i < sim.ents.length; i++) {
    var e = sim.ents[i]; if (e.kind === 'label') continue;
    c.fillStyle = e.kind === 'station' ? LAMP[e._state || 'idle'] : e.kind === 'depot' && this.sim.works(e) ? '#8a6d0a' : col[e.kind];
    c.fillRect(ox + e.x * s, oy + e.y * s, Math.max(1, e.w * s), Math.max(1, e.h * s));
  }
  var hw = this.w / 2 / this.cam.z, hh = this.h / 2 / this.cam.z;
  c.strokeStyle = '#fff'; c.lineWidth = 1; c.strokeRect(ox + (this.cam.x - hw) * s, oy + (this.cam.y - hh) * s, hw * 2 * s, hh * 2 * s);
};
View.prototype.miniToWorld = function (mx, my) { var m = this._mini; return m ? { x: (mx - m.ox) / m.s, y: (my - m.oy) / m.s } : null; };

F.View = View;
})(window);
