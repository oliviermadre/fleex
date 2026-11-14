/* Fleex Factory — canvas renderer. World units are floor tiles; text is drawn in screen space so it stays crisp. */
(function (root) {
'use strict';
var F = root.FleexFactory, LAY = F.LAY, TYPES = F.TYPES, MODELS = F.MODELS, clamp = F.clamp;
var SANS = '"Chakra Petch", ui-sans-serif, system-ui, sans-serif';
var MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
var C = {
  void: '#060807', floor: '#0d100f', grid: 'rgba(255,255,255,0.026)', grid4: 'rgba(255,255,255,0.05)',
  belt: '#1a1e21', beltEdge: '#363d43', chev: '#515a62', rework: '#2a2216', reworkEdge: '#6b5521', reworkChev: '#a8842c',
  body: '#252a2e', body2: '#171a1c', edge: '#454d55', plate: 'rgba(9,9,11,0.82)',
  text: '#f4f4f5', text2: '#a1a1aa', text3: '#71717a',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', blue: '#60a5fa', hazard: '#eab308', steel: '#9aa3ab', idle: '#52525b'
};
var HEAT = { cost: ['#3a2410', '#fb923c'], time: ['#14263f', '#60a5fa'], human: ['#3a3208', '#facc15'], flow: ['#12301f', '#4ade80'] };

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
    if (c.state === 'question') q = true; else if (c.state === 'queued') wq = true; else run = true;
  }
  if (q || st.rack.length) return 'human';
  if (st.starved || wq) return 'starved';
  if (run) return sim.now < sim.outageUntil && sim.needsSlot(st) ? 'starved' : 'running';
  return 'idle';
}
var LAMP = { failed: C.red, human: C.amber, starved: C.blue, running: C.green, idle: C.idle };

function View(canvas, sim) {
  this.cv = canvas; this.ctx = canvas.getContext('2d'); this.sim = sim;
  this.cam = { x: LAY.W / 2, y: LAY.H / 2, z: 14 }; this.goal = null;
  this.inset = { l: 0, t: 0, r: 0, b: 0 };
  this.overlay = 'none'; this.heat = null; this.beacons = []; this.shown = null;
  this.sel = null; this.hover = null; this.follow = null;
  this.w = 0; this.h = 0; this.dpr = 1; this.clock = 0; this.labels = []; this.reduced = false;
  this.tmp = { x: 0, y: 0 };
}

View.prototype.resize = function () {
  var d = Math.min(root.devicePixelRatio || 1, 2), w = this.cv.clientWidth, h = this.cv.clientHeight;
  if (w === this.w && h === this.h && d === this.dpr) return;
  this.w = w; this.h = h; this.dpr = d;
  this.cv.width = Math.max(1, Math.round(w * d)); this.cv.height = Math.max(1, Math.round(h * d));
};
View.prototype.toWorld = function (sx, sy) {
  return { x: (sx - this.w / 2) / this.cam.z + this.cam.x, y: (sy - this.h / 2) / this.cam.z + this.cam.y };
};
View.prototype.toScreen = function (wx, wy) {
  return { x: (wx - this.cam.x) * this.cam.z + this.w / 2, y: (wy - this.cam.y) * this.cam.z + this.h / 2 };
};
/* frame a world rectangle inside the area not covered by the HUD and panels */
View.prototype.frame = function (x, y, w, h, instant, maxZ) {
  var I = this.inset, aw = Math.max(80, this.w - I.l - I.r), ah = Math.max(80, this.h - I.t - I.b);
  var z = Math.min(aw / w, ah / h); if (maxZ) z = Math.min(z, maxZ);
  z = clamp(z, 5, 72);
  var g = { z: z, x: x + w / 2 + ((I.r - I.l) / 2) / z, y: y + h / 2 + ((I.b - I.t) / 2) / z };
  if (instant) { this.cam.x = g.x; this.cam.y = g.y; this.cam.z = g.z; this.goal = null; } else this.goal = g;
};
View.prototype.fit = function (instant) { this.follow = null; this.frame(-0.5, -0.5, LAY.W + 1, LAY.H + 1, instant); };
View.prototype.lookAt = function (x, y, z) {
  var I = this.inset; z = z || Math.max(this.cam.z, 26);
  this.goal = { z: z, x: x + ((I.r - I.l) / 2) / z, y: y + ((I.b - I.t) / 2) / z };
};
View.prototype.zoomAt = function (sx, sy, factor) {
  var before = this.toWorld(sx, sy);
  this.cam.z = clamp(this.cam.z * factor, 5, 72);
  var after = this.toWorld(sx, sy);
  this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
  this.goal = null;
};

View.prototype.label = function (str, wx, wy, size, color, o) {
  this.labels.push([str, wx, wy, size, color, o || null]);
};
View.prototype.flushLabels = function () {
  var ctx = this.ctx, d = this.dpr, z = this.cam.z, L = this.labels;
  ctx.save(); ctx.setTransform(d, 0, 0, d, 0, 0);
  for (var i = 0; i < L.length; i++) {
    var l = L[i], o = l[5] || {}, px = l[3] * z;
    if (px < (o.hide || 0)) continue;
    if (o.min) px = Math.max(px, o.min);
    if (o.max) px = Math.min(px, o.max);
    var sx = (l[1] - this.cam.x) * z + this.w / 2 + (o.dx || 0), sy = (l[2] - this.cam.y) * z + this.h / 2 + (o.dy || 0);
    if (sx < -200 || sx > this.w + 200 || sy < -40 || sy > this.h + 40) continue;
    ctx.font = (o.weight || 500) + ' ' + px.toFixed(1) + 'px ' + (o.mono ? MONO : SANS);
    ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'middle';
    if (o.plate) {
      var tw = ctx.measureText(l[0]).width, padX = px * 0.45, ph = px * 1.5;
      var x0 = o.align === 'center' ? sx - tw / 2 - padX : o.align === 'right' ? sx - tw - padX : sx - padX;
      ctx.fillStyle = o.plate === true ? C.plate : o.plate;
      rr(ctx, x0, sy - ph / 2, tw + padX * 2, ph, Math.min(4, ph / 3)); ctx.fill();
      if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = 1; ctx.stroke(); }
    }
    ctx.fillStyle = l[4]; ctx.fillText(l[0], sx, sy);
  }
  ctx.restore(); L.length = 0;
};

/* ---------- drawing primitives ---------- */
View.prototype.ticket = function (t, x, y, s, dim) {
  var ctx = this.ctx, col = t.triaged ? TYPES[t.type].color : '#8b949e';
  t.x = x; t.y = y;
  if (this.shown && !this.shown.has(t.id)) dim = true;
  ctx.globalAlpha = dim ? 0.25 : 1;
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
  if (this.sel && this.sel.type === 'ticket' && this.sel.t === t) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.arc(x, y, s * 0.95, 0, 6.3); ctx.stroke();
  }
};

View.prototype.belt = function (sg) {
  var ctx = this.ctx, p = sg.pts, rework = sg.kind === 'rework', i;
  var wOut = rework ? 0.5 : 0.84, wIn = rework ? 0.4 : 0.7, inner = rework ? C.rework : C.belt;
  if (this.overlay === 'flow' && this.heat) {
    var h = this.heat.get('s' + sg.id);
    if (h) inner = mix(HEAT.flow[0], HEAT.flow[1], h.v);
  }
  ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
  for (i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  ctx.strokeStyle = rework ? C.reworkEdge : C.beltEdge; ctx.lineWidth = wOut; ctx.stroke();
  ctx.strokeStyle = inner; ctx.lineWidth = wIn; ctx.stroke();
  if (this.cam.z < 9) return;
  /* moving chevrons */
  var step = 0.6, off = this.reduced ? 0.3 : (this.sim.now * F.BELT_V) % step, s = rework ? 0.09 : 0.14, o = this.tmp;
  ctx.beginPath();
  for (var d = off; d < sg.len; d += step) {
    sg.at(d, o);
    var x = o.x, y = o.y; sg.at(Math.min(sg.len, d + 0.05), o);
    var dx = o.x - x, dy = o.y - y, n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
    ctx.moveTo(x - dx * s - dy * s, y - dy * s + dx * s); ctx.lineTo(x, y); ctx.lineTo(x - dx * s + dy * s, y - dy * s - dx * s);
  }
  ctx.strokeStyle = rework ? C.reworkChev : C.chev; ctx.lineWidth = 0.05; ctx.lineCap = 'round'; ctx.stroke();
};

View.prototype.gear = function (x, y, r, ang, col) {
  var ctx = this.ctx, n = 8;
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath();
  for (var i = 0; i < n; i++) {
    var a = i / n * Math.PI * 2, b = a + Math.PI / n;
    ctx.lineTo(Math.cos(a - 0.12) * r, Math.sin(a - 0.12) * r); ctx.lineTo(Math.cos(a + 0.12) * r, Math.sin(a + 0.12) * r);
    ctx.lineTo(Math.cos(b - 0.14) * r * 0.76, Math.sin(b - 0.14) * r * 0.76); ctx.lineTo(Math.cos(b + 0.14) * r * 0.76, Math.sin(b + 0.14) * r * 0.76);
  }
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, 6.3); ctx.fillStyle = C.body2; ctx.fill();
  ctx.restore();
};

View.prototype.hazard = function (x, y, w, h, t, c1, c2) {
  var ctx = this.ctx;
  ctx.save();
  rr(ctx, x, y, w, h, 0.28); ctx.clip();
  ctx.fillStyle = c2; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = c1; ctx.lineWidth = 0.2; ctx.beginPath();
  for (var k = -h; k < w + h; k += 0.56) { ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); }
  ctx.stroke();
  ctx.restore();
  rr(ctx, x + t, y + t, w - 2 * t, h - 2 * t, 0.2);
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
    case 'fleex': ctx.arc(0, 0, 0.9, 0, 6.3); ctx.moveTo(-0.35, -0.45); ctx.lineTo(-0.35, 0.45); ctx.moveTo(0.35, -0.45); ctx.lineTo(0.35, 0.45);
      ctx.moveTo(-0.35, 0); ctx.lineTo(0.35, 0); ctx.stroke(); break;
    case 'native': ctx.moveTo(0.2, -0.9); ctx.lineTo(-0.5, 0.1); ctx.lineTo(0, 0.1); ctx.lineTo(-0.2, 0.9); ctx.lineTo(0.5, -0.1); ctx.lineTo(0, -0.1); ctx.closePath(); ctx.fill(); break;
    case 'person': ctx.arc(0, -0.45, 0.33, 0, 6.3); ctx.fill(); ctx.beginPath(); ctx.moveTo(-0.65, 0.85); ctx.quadraticCurveTo(-0.6, 0.05, 0, 0.05);
      ctx.quadraticCurveTo(0.6, 0.05, 0.65, 0.85); ctx.closePath(); ctx.fill(); break;
    case 'skill': ctx.rect(-0.75, 0.35, 1.5, 0.4); ctx.fill(); ctx.beginPath(); ctx.rect(-0.22, -0.9, 0.44, 1.0); ctx.fill();
      ctx.beginPath(); ctx.rect(-0.55, 0.0, 1.1, 0.24); ctx.fill(); break;
  }
  ctx.restore();
};

View.prototype.cells = function (st, x0, y0, cols, rows, size, gap) {
  var ctx = this.ctx, list = st.cells, n = cols * rows, i;
  for (i = 0; i < n; i++) {
    var cx = x0 + (i % cols) * (size + gap), cy = y0 + Math.floor(i / cols) * (size + gap), c = list[i];
    rr(ctx, cx, cy, size, size, 0.08);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill();
    if (!c) continue;
    var col = TYPES[c.t.type].color;
    c.t.x = st.cx; c.t.y = st.cy;
    var dim = this.shown && !this.shown.has(c.t.id);
    ctx.save(); rr(ctx, cx, cy, size, size, 0.08); ctx.clip();
    ctx.globalAlpha = dim ? 0.2 : 0.3; ctx.fillStyle = col; ctx.fillRect(cx, cy, size, size);
    ctx.globalAlpha = dim ? 0.3 : 1; ctx.fillRect(cx, cy + size * (1 - c.p), size, size * c.p);
    ctx.restore();
    if (c.state === 'question' || c.state === 'failed') {
      var blink = this.reduced || Math.floor(this.clock * 2.5) % 2 === 0;
      ctx.strokeStyle = c.state === 'failed' ? C.red : C.amber; ctx.lineWidth = blink ? 0.09 : 0.04;
      rr(ctx, cx, cy, size, size, 0.08); ctx.stroke();
    }
    if (this.sel && this.sel.type === 'ticket' && this.sel.t === c.t) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.07; rr(ctx, cx - 0.05, cy - 0.05, size + 0.1, size + 0.1, 0.1); ctx.stroke(); }
  }
  if (list.length > n) this.label('+' + (list.length - n), x0 + cols * (size + gap), y0 + rows * (size + gap) - size / 2, 0.34, C.text2, { hide: 7, mono: true });
};

View.prototype.station = function (st) {
  var ctx = this.ctx, sim = this.sim, x = st.x, y = st.y, w = st.w, h = st.h, state = stationState(sim, st), lamp = LAMP[state];
  var gate = st.exec === 'human_gate', nat = st.exec === 'native', color = st.lane ? st.lane.wf.color : '#94a3b8';
  var dimAll = this.overlay !== 'none' && this.overlay !== 'flow', i;
  var blink = this.reduced || Math.floor(this.clock * 2.2) % 2 === 0;

  ctx.fillStyle = 'rgba(0,0,0,0.4)'; rr(ctx, x + 0.12, y + 0.18, w, h, 0.28); ctx.fill();
  if (gate) {
    var manual = st.policy === 'human', samp = st.policy === 'sampled';
    this.hazard(x, y, w, h, 0.2, manual ? '#15130a' : samp ? '#14171a' : '#131615', manual ? C.hazard : samp ? '#a3a3a3' : '#3f3f46');
    ctx.fillStyle = '#1b1c18'; ctx.fill();
  } else {
    var g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, nat ? '#1e2225' : C.body); g.addColorStop(1, C.body2);
    rr(ctx, x, y, w, h, 0.28); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 0.06; ctx.strokeStyle = C.edge; ctx.stroke();
    ctx.fillStyle = alpha(color, 0.55); ctx.fillRect(x + 0.28, y + h - 0.1, w - 0.56, 0.1);
  }
  /* lamp */
  var lx = x + 0.48, ly = y + 0.52, on = state !== 'idle' && (state === 'running' || blink);
  if (on && this.cam.z > 9) { ctx.fillStyle = alpha(lamp, 0.25); ctx.beginPath(); ctx.arc(lx, ly, 0.3, 0, 6.3); ctx.fill(); }
  ctx.fillStyle = on ? lamp : '#3f3f46'; ctx.beginPath(); ctx.arc(lx, ly, 0.15, 0, 6.3); ctx.fill();
  this.label(st.name, x + 0.8, ly, 0.42, C.text, { weight: 600, min: 9.5, max: 17, plate: this.cam.z < 22 ? C.plate : null });

  if (gate) {
    /* rack of tickets waiting for a human, then the barrier */
    var rack = st.rack, cols = 5, s = 0.5, gp = 0.12;
    for (i = 0; i < 10; i++) {
      var rx = x + 0.42 + (i % cols) * (s + gp), ry = y + 1.0 + Math.floor(i / cols) * (s + gp);
      rr(ctx, rx, ry, s, s, 0.08); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
      if (rack[i]) this.ticket(rack[i].t, rx + s / 2, ry + s / 2, s * 0.86);
    }
    for (i = 10; i < rack.length; i++) { rack[i].t.x = st.cx; rack[i].t.y = st.cy; }
    if (rack.length > 10) this.label('+' + (rack.length - 10), x + w - 0.3, y + h - 0.45, 0.36, C.amber, { align: 'right', weight: 700, hide: 6, mono: true });
    for (i = 0; i < st.cells.length; i++) { st.cells[i].t.x = st.cx; st.cells[i].t.y = st.cy; }
    if (st.cells.length) { ctx.fillStyle = alpha(C.blue, 0.8); ctx.beginPath(); ctx.arc(x + w - 0.5, y + 0.52, 0.14 + 0.04 * Math.sin(this.clock * 8), 0, 6.3); ctx.fill(); }
    this.label(st.policy === 'human' ? 'human_gate · humain' : st.policy === 'sampled' ? 'human_gate · échantillonné' : 'human_gate · auto',
      x + 0.3, y + h - 0.36, 0.28, st.policy === 'human' ? C.hazard : C.text2, { hide: 8, mono: true });
  } else {
    var act = 0; for (i = 0; i < st.cells.length; i++) if (st.cells[i].state === 'running') act++;
    var spin = this.reduced ? 0.4 : sim.now * 1.3, gx = x + 0.95, gy = y + 1.85, gc = act ? alpha(color, 0.95) : '#4b5563';
    if (st.def.router) {
      ctx.strokeStyle = gc; ctx.lineWidth = 0.1; ctx.beginPath(); ctx.moveTo(gx - 0.55, gy - 0.5); ctx.lineTo(gx + 0.55, gy - 0.5); ctx.lineTo(gx + 0.12, gy);
      ctx.lineTo(gx + 0.12, gy + 0.55); ctx.lineTo(gx - 0.12, gy + 0.4); ctx.lineTo(gx - 0.12, gy); ctx.closePath(); ctx.stroke();
      if (act) { var sw = (this.clock * 1.4) % 1; ctx.strokeStyle = alpha(C.green, 0.7); ctx.beginPath(); ctx.moveTo(x + 1.75, y + 1 + sw * 1.6); ctx.lineTo(x + w - 0.25, y + 1 + sw * 1.6); ctx.stroke(); }
    } else if (nat) this.glyph('native', gx, gy, 0.55, gc);
    else if (st.exec === 'skill') { var pz = act ? Math.abs(Math.sin(sim.now * 2.2)) * 0.18 : 0; this.glyph('skill', gx, gy - 0.15 + pz, 0.55, gc); ctx.fillStyle = gc; ctx.fillRect(gx - 0.5, gy + 0.5, 1, 0.1); }
    else if (st.exec === 'panel') {
      this.gear(gx - 0.28, gy - 0.3, 0.36, act ? spin : 0, gc); this.gear(gx + 0.34, gy - 0.02, 0.36, act ? -spin + 0.4 : 0.4, gc); this.gear(gx - 0.2, gy + 0.42, 0.36, act ? spin + 0.2 : 0.2, gc);
    } else this.gear(gx, gy, 0.62, act ? spin : 0, gc);
    this.cells(st, x + 1.86, y + 1.0, 3, 2, 0.56, 0.1);
    if (act && !nat && this.cam.z >= 13 && !this.reduced && sim.now >= sim.outageUntil) {
      /* tokens burning: a few sparks rise from the running machine */
      for (i = 0; i < 3; i++) {
        var ph = (sim.now * 0.55 + i / 3 + st.id * 0.37) % 1;
        ctx.fillStyle = alpha(color, (1 - ph) * 0.9);
        ctx.fillRect(x + w - 0.62 + Math.sin(ph * 7 + i * 2) * 0.14, y - 0.12 - ph * 0.95, 0.1, 0.1);
      }
    }
    var m = st.model ? MODELS[st.model].short : '';
    this.label(st.exec + (m ? ' · ' + m : ''), x + 0.3, y + h - 0.36, 0.28, C.text3, { hide: 8, mono: true });
    if (st.starved) this.label('file ' + st.starved, x + w - 0.25, y + 0.52, 0.3, C.blue, { align: 'right', hide: 7.5, mono: true, weight: 700 });
    for (i = 0; i < st.outMain.length; i++) { st.outMain[i].x = st.cx; st.outMain[i].y = st.cy; }
  }
  /* rework ports */
  for (i = 0; i < st.links.length; i++) {
    var p0 = st.links[i].seg.pts[0];
    ctx.fillStyle = C.reworkEdge; ctx.fillRect(p0[0] - 0.3, p0[1] - 0.09, 0.6, 0.18);
    for (var q = 0; q < st.links[i].q.length; q++) { st.links[i].q[q].x = st.cx; st.links[i].q[q].y = st.cy; }
  }
  if (dimAll) { ctx.fillStyle = 'rgba(6,8,7,0.55)'; rr(ctx, x - 0.05, y - 0.05, w + 0.1, h + 0.1, 0.28); ctx.fill(); }
  st._state = state;
};

View.prototype.arm = function (a) {
  var ctx = this.ctx, e = a.p * a.p * (3 - 2 * a.p), tx = a.ax + (a.zx - a.ax) * e, ty = a.ay + (a.zy - a.ay) * e;
  var dx = tx - a.bx, dy = ty - a.by, d = Math.min(Math.hypot(dx, dy), 1.3), l = 0.68;
  var base = Math.atan2(dy, dx), bend = Math.acos(clamp(d / (2 * l), -1, 1)) * (a.kind === 'in' ? -1 : 1);
  var ex = a.bx + Math.cos(base + bend) * l, ey = a.by + Math.sin(base + bend) * l;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#5b646c'; ctx.lineWidth = 0.17; ctx.beginPath(); ctx.moveTo(a.bx, a.by); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = C.steel; ctx.lineWidth = 0.11; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.fillStyle = '#2b3136'; ctx.beginPath(); ctx.arc(a.bx, a.by, 0.24, 0, 6.3); ctx.fill();
  ctx.strokeStyle = C.hazard; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.arc(a.bx, a.by, 0.24, 0, 6.3); ctx.stroke();
  ctx.fillStyle = C.steel; ctx.beginPath(); ctx.arc(ex, ey, 0.09, 0, 6.3); ctx.fill();
  if (a.t) this.ticket(a.t, tx, ty, 0.44);
  var ga = Math.atan2(ty - ey, tx - ex), op = a.t ? 0.5 : 0.95;
  ctx.strokeStyle = '#d4d4d8'; ctx.lineWidth = 0.06; ctx.beginPath();
  ctx.moveTo(tx + Math.cos(ga + op) * 0.2, ty + Math.sin(ga + op) * 0.2); ctx.lineTo(tx, ty); ctx.lineTo(tx + Math.cos(ga - op) * 0.2, ty + Math.sin(ga - op) * 0.2); ctx.stroke();
};

View.prototype.source = function (src) {
  var ctx = this.ctx, x = src.x, y = src.y, w = src.w, h = src.h, on = src.on;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; rr(ctx, x + 0.12, y + 0.16, w, h, 0.3); ctx.fill();
  var g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#263038'); g.addColorStop(1, '#161b1f');
  rr(ctx, x, y, w, h, 0.3); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = src.internal ? '#5b6b3a' : '#44525c'; ctx.lineWidth = 0.06; ctx.stroke();
  /* chute */
  ctx.fillStyle = '#0c0f11'; ctx.fillRect(x + w - 0.5, src.cy - 0.38, 0.5, 0.76);
  this.glyph(src.id, x + 0.95, src.cy, 0.5, on ? '#d4d4d8' : '#52525b');
  this.label(src.name, x + 0.05, y - 0.42, 0.44, on ? C.text : C.text3, { weight: 600, min: 9.5, max: 16 });
  this.label(src.internal ? 'ticket.create' : on ? Math.round(src.perDay) + ' / jour' : 'à l’arrêt', x + 1.75, src.cy - 0.3, 0.3, C.text2, { hide: 7.5, mono: true });
  if (src.buffer.length) this.label(src.buffer.length + ' en stock', x + 1.75, src.cy + 0.32, 0.28, C.amber, { hide: 7.5, mono: true });
  for (var i = 0; i < src.buffer.length; i++) { src.buffer[i].x = x + w / 2; src.buffer[i].y = src.cy; }
};

View.prototype.buildings = function () {
  var ctx = this.ctx, sim = this.sim, op = sim.op, hut = op.hut, pool = sim.pool, dock = sim.dock, i;
  /* operator post */
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; rr(ctx, hut.x + 0.12, hut.y + 0.16, hut.w, hut.h, 0.3); ctx.fill();
  this.hazard(hut.x, hut.y, hut.w, hut.h, 0.14, '#15130a', C.hazard); ctx.fillStyle = '#1d2022'; ctx.fill();
  var avail = sim.opAvailable();
  this.glyph('person', hut.x + 0.75, hut.y + hut.h / 2, 0.45, avail ? C.hazard : '#52525b');
  this.label('Poste opérateur', hut.x + 0.05, hut.y - 0.42, 0.44, C.text, { weight: 600, min: 9.5, max: 16 });
  this.label(!op.enabled ? 'manuel' : avail ? 'en poste' : sim.now < op.awayUntil ? 'en réunion' : 'hors horaires', hut.x + 1.35, hut.y + hut.h / 2, 0.3,
    avail ? C.green : C.text2, { hide: 7.5, mono: true });
  /* agent slots: one cell per SDK concurrency slot */
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; rr(ctx, pool.x + 0.12, pool.y + 0.16, pool.w, pool.h, 0.3); ctx.fill();
  rr(ctx, pool.x, pool.y, pool.w, pool.h, 0.3); ctx.fillStyle = '#16191c'; ctx.fill(); ctx.strokeStyle = '#3b4d63'; ctx.lineWidth = 0.06; ctx.stroke();
  var cols = pool.max <= 12 ? 4 : pool.max <= 20 ? 5 : 8, rows = Math.ceil(pool.max / cols), cw = (pool.w - 0.5) / cols, ch = (pool.h - 0.5) / rows;
  var outage = sim.now < sim.outageUntil;
  for (i = 0; i < pool.max; i++) {
    var cx = pool.x + 0.25 + (i % cols) * cw, cy = pool.y + 0.25 + Math.floor(i / cols) * ch;
    rr(ctx, cx + 0.05, cy + 0.05, cw - 0.1, ch - 0.1, 0.08);
    ctx.fillStyle = outage ? alpha(C.red, 0.5) : i < pool.used ? (pool.used >= pool.max ? C.amber : C.blue) : '#23282d'; ctx.fill();
  }
  this.label('Slots agents', pool.x + 0.05, pool.y - 0.42, 0.44, C.text, { weight: 600, min: 9.5, max: 16 });
  this.label(outage ? 'panne API' : pool.used + ' / ' + pool.max, pool.x + pool.w + 0.25, pool.y + pool.h / 2, 0.34, outage ? C.red : pool.used >= pool.max ? C.amber : C.text2, { hide: 7, mono: true, weight: 700 });
  /* shipping dock */
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; rr(ctx, dock.x + 0.14, dock.y + 0.2, dock.w, dock.h, 0.35); ctx.fill();
  var g = ctx.createLinearGradient(dock.x, 0, dock.x + dock.w, 0); g.addColorStop(0, '#20262b'); g.addColorStop(1, '#14181b');
  rr(ctx, dock.x, dock.y, dock.w, dock.h, 0.35); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = C.edge; ctx.lineWidth = 0.06; ctx.stroke();
  for (i = 0; i < sim.lanes.length; i++) {
    var ln = sim.lanes[i];
    ctx.fillStyle = '#090b0c'; rr(ctx, dock.x - 0.02, ln.y - 0.55, 1.1, 1.1, 0.12); ctx.fill();
    ctx.fillStyle = alpha(ln.wf.color, 0.85); ctx.fillRect(dock.x + 1.3, ln.y - 0.5, 0.12, 1);
    this.label(String(sim.sum(ln.shipped, 24)), dock.x + 1.65, ln.y - 0.18, 0.62, C.text, { weight: 700, min: 10, max: 22, mono: true });
    this.label(ln.wf.output === 'code' ? 'PR / 24 h' : ln.wf.output + ' / 24 h', dock.x + 1.65, ln.y + 0.45, 0.28, C.text2, { hide: 7.5, mono: true });
  }
  this.label('Expédition', dock.x + 0.05, dock.y - 0.5, 0.5, C.text, { weight: 700, min: 9.5, max: 18 });
};

View.prototype.operator = function () {
  var ctx = this.ctx, op = this.sim.op;
  if (op.state === 'away' || op.state === 'home') return;
  var x = op.x, y = op.y, bob = op.state === 'walk' && !this.reduced ? Math.sin(this.clock * 14) * 0.04 : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(x + 0.06, y + 0.3, 0.3, 0.13, 0, 0, 6.3); ctx.fill();
  ctx.fillStyle = '#1d4ed8'; ctx.beginPath(); ctx.arc(x, y + 0.08 + bob, 0.27, 0, 6.3); ctx.fill();
  ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(x, y - 0.14 + bob, 0.17, 0, 6.3); ctx.fill();
  ctx.fillStyle = C.hazard; ctx.beginPath(); ctx.arc(x, y - 0.18 + bob, 0.2, Math.PI, 0); ctx.fill(); ctx.fillRect(x - 0.26, y - 0.2 + bob, 0.52, 0.06);
  if (op.state === 'work') {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.08; ctx.beginPath(); ctx.arc(x, y, 0.5, 0, 6.3); ctx.stroke();
    ctx.strokeStyle = C.hazard; ctx.beginPath(); ctx.arc(x, y, 0.5, -Math.PI / 2, -Math.PI / 2 + (1 - op.left / op.total) * 6.283); ctx.stroke();
  }
};

View.prototype.drone = function (d) {
  if (d.t < 0) return;
  var ctx = this.ctx, lift = Math.sin(Math.PI * d.f) * 1.4 + 0.3, x = d.x, y = d.y - lift * 0.5;
  ctx.fillStyle = 'rgba(0,0,0,' + (0.4 - lift * 0.12) + ')'; ctx.beginPath(); ctx.ellipse(d.x + lift * 0.3, d.y + lift * 0.35, 0.35, 0.18, 0, 0, 6.3); ctx.fill();
  ctx.strokeStyle = '#a1a1aa'; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.moveTo(x - 0.34, y - 0.34); ctx.lineTo(x + 0.34, y + 0.34); ctx.moveTo(x + 0.34, y - 0.34); ctx.lineTo(x - 0.34, y + 0.34); ctx.stroke();
  var sp = this.clock * 30;
  for (var i = 0; i < 4; i++) {
    var rx = x + (i % 2 ? 0.34 : -0.34), ry = y + (i < 2 ? -0.34 : 0.34);
    ctx.strokeStyle = 'rgba(228,228,231,0.55)'; ctx.lineWidth = 0.04; ctx.beginPath();
    ctx.moveTo(rx + Math.cos(sp + i) * 0.2, ry + Math.sin(sp + i) * 0.2); ctx.lineTo(rx - Math.cos(sp + i) * 0.2, ry - Math.sin(sp + i) * 0.2); ctx.stroke();
  }
  rr(ctx, x - 0.2, y - 0.2, 0.4, 0.4, 0.08); ctx.fillStyle = d.color; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.04; ctx.stroke();
};

View.prototype.floor = function (x0, y0, x1, y1) {
  var ctx = this.ctx, sim = this.sim, z = this.cam.z, i;
  ctx.fillStyle = C.floor; ctx.fillRect(0, 0, LAY.W, LAY.H);
  if (z >= 9) {
    ctx.lineWidth = 1 / z; ctx.beginPath();
    for (i = Math.max(0, Math.floor(x0)); i <= Math.min(LAY.W, x1); i++) { if (i % 4) { ctx.moveTo(i, Math.max(0, y0)); ctx.lineTo(i, Math.min(LAY.H, y1)); } }
    for (i = Math.max(0, Math.floor(y0)); i <= Math.min(LAY.H, y1); i++) { if (i % 4) { ctx.moveTo(Math.max(0, x0), i); ctx.lineTo(Math.min(LAY.W, x1), i); } }
    ctx.strokeStyle = C.grid; ctx.stroke();
  }
  ctx.lineWidth = 1 / z; ctx.beginPath();
  for (i = 0; i <= LAY.W; i += 4) { ctx.moveTo(i, 0); ctx.lineTo(i, LAY.H); }
  for (i = 0; i <= LAY.H; i += 4) { ctx.moveTo(0, i); ctx.lineTo(LAY.W, i); }
  ctx.strokeStyle = C.grid4; ctx.stroke();
  ctx.strokeStyle = '#2a3035'; ctx.lineWidth = 0.1; ctx.strokeRect(0, 0, LAY.W, LAY.H);
  /* painted zones */
  ctx.fillStyle = 'rgba(148,163,184,0.045)'; rr(ctx, 0.4, 0.5, LAY.collX + 0.9, LAY.H - 1, 0.4); ctx.fill();
  this.label('INTAKE', 0.9, LAY.H - 1.0, 0.52, 'rgba(203,213,225,0.6)', { weight: 700, min: 10, max: 20 });
  for (i = 0; i < sim.lanes.length; i++) {
    var ln = sim.lanes[i], yy = ln.top, hh = ln.h, xs = ln.x, ws = ln.w;
    ctx.fillStyle = alpha(ln.wf.color, 0.035); rr(ctx, xs, yy, ws, hh, 0.4); ctx.fill();
    ctx.fillStyle = alpha(ln.wf.color, 0.7); ctx.fillRect(xs, yy + 0.4, 0.14, hh - 0.8);
    this.label(ln.wf.name.toUpperCase(), xs + 0.5, yy + hh - 0.6, 0.52, alpha(ln.wf.color, 0.85), { weight: 700, min: 10, max: 20 });
    this.label(ln.wf.hitl ? '@workflow:' + ln.wf.slug + ' · HITL' : '@workflow:' + ln.wf.slug + ' · sans HITL', xs + 0.5, yy + 0.4, 0.3, alpha(ln.wf.color, 0.6), { hide: 7.5, mono: true });
  }
};

View.prototype.draw = function (dtReal) {
  var ctx = this.ctx, sim = this.sim, cam = this.cam, d = this.dpr, i, j;
  this.resize();
  this.clock += dtReal;
  if (this.follow) {
    var ft = this.follow;
    if (ft.state === 'done' || ft.state === 'cancelled') this.follow = null;
    else this.goal = { x: ft.x + ((this.inset.r - this.inset.l) / 2) / cam.z, y: ft.y + ((this.inset.b - this.inset.t) / 2) / cam.z, z: cam.z };
  }
  if (this.goal) {
    var k = 1 - Math.pow(0.002, dtReal), g = this.goal;
    cam.x += (g.x - cam.x) * k; cam.y += (g.y - cam.y) * k; cam.z += (g.z - cam.z) * k;
    if (!this.follow && Math.abs(g.x - cam.x) < 0.01 && Math.abs(g.y - cam.y) < 0.01 && Math.abs(g.z - cam.z) < 0.02) this.goal = null;
  }
  var z = cam.z, hw = this.w / 2 / z, hh = this.h / 2 / z, x0 = cam.x - hw, x1 = cam.x + hw, y0 = cam.y - hh, y1 = cam.y + hh;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.fillStyle = C.void; ctx.fillRect(0, 0, this.w, this.h);
  ctx.setTransform(z * d, 0, 0, z * d, (this.w / 2 - cam.x * z) * d, (this.h / 2 - cam.y * z) * d);

  this.floor(x0, y0, x1, y1);
  var segs = sim.segs;
  for (i = 0; i < segs.length; i++) this.belt(segs[i]);
  var o = this.tmp, dimItems = this.overlay === 'cost' || this.overlay === 'time';
  for (i = 0; i < segs.length; i++) {
    var its = segs[i].items;
    for (j = 0; j < its.length; j++) { segs[i].at(its[j].d, o); this.ticket(its[j].t, o.x, o.y, segs[i].kind === 'rework' ? 0.38 : 0.46, dimItems); }
  }
  for (i = 0; i < sim.sources.length; i++) this.source(sim.sources[i]);
  for (i = 0; i < sim.stations.length; i++) this.station(sim.stations[i]);
  this.buildings();
  for (i = 0; i < sim.inserters.length; i++) this.arm(sim.inserters[i]);
  this.overlays();
  this.operator();
  for (i = 0; i < sim.drones.length; i++) this.drone(sim.drones[i]);
  this.effects();
  this.selection();

  /* night shift: the floor dims, running stations keep their glow */
  var hod = sim.hourOfDay(), dark = hod < 5.5 ? 1 : hod < 7.5 ? (7.5 - hod) / 2 : hod < 18.5 ? 0 : hod < 21 ? (hod - 18.5) / 2.5 : 1;
  this.dark = dark;
  if (dark > 0.01) {
    ctx.fillStyle = 'rgba(3,6,20,' + (dark * 0.46) + ')'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < sim.stations.length; i++) {
      var st = sim.stations[i];
      if (st._state === 'idle' || st.cx < x0 - 4 || st.cx > x1 + 4 || st.cy < y0 - 4 || st.cy > y1 + 4) continue;
      var col = LAMP[st._state], gr = ctx.createRadialGradient(st.cx, st.cy, 0.2, st.cx, st.cy, 3.6);
      gr.addColorStop(0, alpha(col, 0.16 * dark)); gr.addColorStop(1, alpha(col, 0));
      ctx.fillStyle = gr; ctx.fillRect(st.cx - 3.6, st.cy - 3.6, 7.2, 7.2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  this.flushLabels();
  this.drawBeacons();
  this.flushLabels();
};

View.prototype.overlays = function () {
  var ctx = this.ctx, sim = this.sim, i, ov = this.overlay, heat = this.heat;
  if (heat && ov !== 'none') {
    if (ov === 'flow') {
      for (i = 0; i < sim.segs.length; i++) {
        var sg = sim.segs[i], hs = heat.get('s' + sg.id);
        if (!hs || !hs.label || sg.kind === 'rework' || sg.len < 2) continue;
        sg.at(sg.len / 2, this.tmp);
        this.label(hs.label, this.tmp.x, this.tmp.y - 0.75, 0.32, '#bbf7d0', { align: 'center', mono: true, min: 9, max: 13, plate: 'rgba(5,20,12,0.85)' });
      }
    } else {
      var ramp = HEAT[ov];
      for (i = 0; i < sim.stations.length; i++) {
        var st = sim.stations[i], h = heat.get(st.id);
        if (!h || h.v <= 0) continue;
        var col = mix(ramp[0], ramp[1], h.v);
        ctx.fillStyle = col; ctx.globalAlpha = 0.25 + 0.6 * h.v; rr(ctx, st.x, st.y, st.w, st.h, 0.28); ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = ramp[1]; ctx.lineWidth = 0.05 + 0.1 * h.v; rr(ctx, st.x, st.y, st.w, st.h, 0.28); ctx.stroke();
        this.label(h.label, st.cx, st.cy + 0.35, 0.44, '#fff', { align: 'center', weight: 700, mono: true, min: 9.5, max: 15, plate: 'rgba(9,9,11,0.8)' });
      }
    }
  }
};
View.prototype.drawBeacons = function () {
  var ctx = this.ctx, sim = this.sim, i;
  var pulse = this.reduced ? 0.5 : (this.clock * 0.9) % 1;
  for (i = 0; i < this.beacons.length; i++) {
    var b = this.beacons[i], bx = b.st ? b.st.x + b.st.w + 0.05 : sim.pool.x + sim.pool.w + 0.05, by = b.st ? b.st.y - 0.05 : sim.pool.y - 0.05;
    var bc = b.kind === 'human' || b.kind === 'question' ? C.amber : b.kind === 'cost' ? '#fb923c' : b.kind === 'pool' ? C.blue : C.red;
    ctx.strokeStyle = alpha(bc, 1 - pulse); ctx.lineWidth = 0.08; ctx.beginPath(); ctx.arc(bx, by, 0.4 + pulse * 0.9, 0, 6.3); ctx.stroke();
    ctx.fillStyle = bc; ctx.beginPath(); ctx.arc(bx, by, 0.4, 0, 6.3); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 0.06; ctx.stroke();
    this.label(String(i + 1), bx, by + 0.02, 0.5, '#111', { align: 'center', weight: 700, min: 8, max: 15 });
  }
};

View.prototype.effects = function () {
  var ctx = this.ctx, sim = this.sim;
  for (var i = 0; i < sim.fx.length; i++) {
    var f = sim.fx[i], a = (sim.now - f.t0) / 3;
    if (a < 0 || a > 1) continue;
    if (f.kind === 'ship') {
      ctx.strokeStyle = alpha(f.c, 1 - a); ctx.lineWidth = 0.09; ctx.beginPath(); ctx.arc(f.x, f.y, 0.3 + a * 1.1, 0, 6.3); ctx.stroke();
    } else {
      ctx.strokeStyle = alpha('#a1a1aa', 1 - a); ctx.lineWidth = 0.07; ctx.beginPath();
      ctx.moveTo(f.x - 0.25, f.y - 0.25 + a * 0.3); ctx.lineTo(f.x + 0.25, f.y + 0.25 + a * 0.3); ctx.moveTo(f.x + 0.25, f.y - 0.25 + a * 0.3); ctx.lineTo(f.x - 0.25, f.y + 0.25 + a * 0.3); ctx.stroke();
    }
  }
};

View.prototype.selection = function () {
  var ctx = this.ctx, s = this.sel, hv = this.hover, box = null;
  function rect(o) { return o ? { x: o.x, y: o.top != null ? o.top : o.y, w: o.w, h: o.h } : null; }
  if (hv && hv.type !== 'ticket' && hv.type !== 'lane' && !(s && s.type === hv.type && s.ref === hv.ref)) {
    var hb = rect(hv.ref);
    if (hb) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.05; rr(ctx, hb.x - 0.14, hb.y - 0.14, hb.w + 0.28, hb.h + 0.28, 0.36); ctx.stroke(); }
  }
  if (!s || s.type === 'ticket') return;
  box = rect(s.ref);
  if (!box) return;
  ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.08; ctx.setLineDash([0.4, 0.25]); ctx.lineDashOffset = this.reduced ? 0 : -this.clock * 0.8;
  rr(ctx, box.x - 0.2, box.y - 0.2, box.w + 0.4, box.h + 0.4, 0.4); ctx.stroke(); ctx.restore();
};

/* what is under a screen point: ticket first, then buildings */
View.prototype.pick = function (sx, sy) {
  var p = this.toWorld(sx, sy), sim = this.sim, i, j, o = this.tmp, tol = Math.max(0.42, 9 / this.cam.z);
  for (i = 0; i < sim.inserters.length; i++) {
    var a = sim.inserters[i];
    if (a.t && Math.hypot(a.t.x - p.x, a.t.y - p.y) < tol) return { type: 'ticket', t: a.t, ref: a.t };
  }
  for (i = 0; i < sim.segs.length; i++) {
    var its = sim.segs[i].items;
    for (j = 0; j < its.length; j++) { sim.segs[i].at(its[j].d, o); if (Math.hypot(o.x - p.x, o.y - p.y) < tol) return { type: 'ticket', t: its[j].t, ref: its[j].t }; }
  }
  function inside(b, m) { return p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m; }
  for (i = 0; i < sim.stations.length; i++) if (inside(sim.stations[i], 0.1)) return { type: 'station', ref: sim.stations[i] };
  for (i = 0; i < sim.sources.length; i++) if (inside(sim.sources[i], 0.1)) return { type: 'source', ref: sim.sources[i] };
  if (inside(sim.op.hut, 0.1) || Math.hypot(sim.op.x - p.x, sim.op.y - p.y) < 0.6) return { type: 'operator', ref: sim.op.hut };
  if (inside(sim.pool, 0.1)) return { type: 'pool', ref: sim.pool };
  if (inside(sim.dock, 0.1)) return { type: 'dock', ref: sim.dock };
  for (i = 0; i < sim.lanes.length; i++) { var ln = sim.lanes[i]; if (p.x >= ln.x && p.x <= ln.x + ln.w && p.y >= ln.top && p.y <= ln.top + ln.h) return { type: 'lane', ref: ln }; }
  return null;
};

View.prototype.minimap = function (cv) {
  var ctx = cv.getContext('2d'), d = this.dpr, w = cv.clientWidth, h = cv.clientHeight, sim = this.sim, i, j, o = this.tmp;
  if (cv.width !== Math.round(w * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
  var s = Math.min(w / LAY.W, h / LAY.H), ox = (w - LAY.W * s) / 2, oy = (h - LAY.H * s) / 2;
  ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
  ctx.setTransform(s * d, 0, 0, s * d, ox * d, oy * d);
  ctx.fillStyle = '#0d100f'; ctx.fillRect(0, 0, LAY.W, LAY.H);
  ctx.strokeStyle = '#3a4148'; ctx.lineWidth = 0.5;
  for (i = 0; i < sim.segs.length; i++) {
    var p = sim.segs[i].pts; ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
    for (j = 1; j < p.length; j++) ctx.lineTo(p[j][0], p[j][1]);
    ctx.stroke();
  }
  for (i = 0; i < sim.stations.length; i++) { var st = sim.stations[i]; ctx.fillStyle = LAMP[st._state || 'idle']; ctx.fillRect(st.x, st.y, st.w, st.h); }
  ctx.fillStyle = '#64748b';
  for (i = 0; i < sim.sources.length; i++) { var sc = sim.sources[i]; ctx.fillRect(sc.x, sc.y, sc.w, sc.h); }
  ctx.fillRect(sim.dock.x, sim.dock.y, sim.dock.w, sim.dock.h);
  for (i = 0; i < sim.segs.length; i++) {
    var its = sim.segs[i].items;
    for (j = 0; j < its.length; j++) { sim.segs[i].at(its[j].d, o); ctx.fillStyle = its[j].t.triaged ? TYPES[its[j].t.type].color : '#c9d1d9'; ctx.fillRect(o.x - 0.5, o.y - 0.5, 1, 1); }
  }
  var hw = this.w / 2 / this.cam.z, hh = this.h / 2 / this.cam.z;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / s; ctx.strokeRect(this.cam.x - hw, this.cam.y - hh, hw * 2, hh * 2);
  this._mini = { s: s, ox: ox, oy: oy };
};
View.prototype.miniToWorld = function (mx, my) { var m = this._mini; return m ? { x: (mx - m.ox) / m.s, y: (my - m.oy) / m.s } : null; };

F.View = View; F.stationState = stationState; F.LAMP = LAMP;
})(typeof window !== 'undefined' ? window : globalThis);
