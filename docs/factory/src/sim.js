/* Fleex Factory — simulation engine (no DOM). Mock data, real Fleex vocabulary.
   The floor is a grid of tiles. Nothing is routed in advance: a ticket reacts to what it stands on.
   - a belt tile holds one ticket and pushes it to the tile it points at, if that tile can take it;
   - an arm moves one ticket from the tile behind it to the tile in front, optionally only those matching its filter;
   - a station runs its step and leaves the ticket in its out-tray, tagged with the outcome; arms pull it out;
   - zones hold tickets, let people work on them by hand, and keep them until they are released; the exit ships.
   Time unit: one simulated minute. Space unit: one tile. Directions: 0 east, 1 south, 2 west, 3 north. */
(function (root) {
'use strict';

var RING = 72, DAY = 1440, BELT_V = 3.2, SWING = 0.22;
var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
var OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-5-5';

var MODELS = {
  'claude-haiku-5-5':  { label: 'Haiku 5.5',  short: 'haiku',  speed: 0.55, cost: 0.05, defect: 0.42, tier: 1 },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', short: 'sonnet', speed: 0.80, cost: 0.45, defect: 0.26, tier: 2 },
  'claude-opus-5-5':   { label: 'Opus 5.5',   short: 'opus',   speed: 1.00, cost: 1.00, defect: 0.16, tier: 3 },
  'claude-fable-5-2':  { label: 'Fable 5.2',  short: 'fable',  speed: 1.10, cost: 1.60, defect: 0.08, tier: 4 }
};
var MODEL_ORDER = [HAIKU, SONNET, OPUS, 'claude-fable-5-2'];
var TYPES = {
  build: { color: '#60a5fa' }, fix: { color: '#f87171' }, think: { color: '#c084fc' }, lead: { color: '#facc15' }, ops: { color: '#2dd4bf' }
};
var PRIORITIES = ['urgent', 'high', 'medium', 'low'];
var TITLES = {
  fix: ['Export CSV tronqué au-delà de 10 000 lignes', 'Boucle de redirection SSO sur Safari', 'Crash du drag & drop dans le Kanban',
    'Webhook Slack reçu en double', 'Timeout sur /api/statistics', 'Fuite mémoire dans le terminal', 'Tri des tickets cassé après un filtre',
    'Notification push envoyée deux fois', 'Agenda : fuseau décalé d’une heure', 'CostBadge affiche NaN sans exécution',
    'Worktree non nettoyé après merge', 'Session CLI marquée interrompue à tort', 'Mention @agent ignorée dans un commentaire'],
  build: ['Filtres sauvegardés dans Tasks', 'Vue Agenda hebdomadaire', 'Import des issues Linear', 'Raccourcis clavier dans Focus',
    'Mode compact pour la timeline', 'Export PDF d’un deliverable', 'Recherche plein texte dans Documents', 'Webhook entrant générique',
    'Tags colorés sur le Kanban', 'Résumé quotidien par e-mail', 'Budget par workflow', 'Reprise d’un run depuis une étape'],
  think: ['Faut-il un mode multi-utilisateur ?', 'Pricing : par siège ou à l’usage ?', 'Explorer une app mobile native',
    'Une marketplace de workflows ?', 'Positionnement face aux IDE agentiques', 'Onboarding en moins de 5 minutes'],
  lead: ['Fleex Intake', 'Budgets et alertes de coût', 'Vue Factory', 'Permissions par board', 'Connecteur Gmail', 'Routines partagées'],
  ops: ['Mettre à jour les dépendances', 'Rotation des clés API', 'Nettoyer les worktrees orphelins', 'Rapport hebdo des coûts',
    'Audit des migrations', 'Purger les sessions expirées', 'Bump du Claude Agent SDK']
};
var SOURCES = [
  { id: 'gmail',   name: 'Gmail',         perDay: 6, mix: { fix: 0.3, build: 0.3, lead: 0.2, think: 0.2 } },
  { id: 'slack',   name: 'Slack',         perDay: 8, mix: { fix: 0.5, build: 0.2, ops: 0.2, think: 0.1 } },
  { id: 'meet',    name: 'Meeting notes', perDay: 4, mix: { think: 0.35, lead: 0.35, build: 0.3 } },
  { id: 'github',  name: 'GitHub',        perDay: 9, mix: { fix: 0.55, build: 0.35, ops: 0.1 } },
  { id: 'linear',  name: 'Linear',        perDay: 7, mix: { build: 0.6, fix: 0.25, lead: 0.15 } },
  { id: 'routine', name: 'Routines',      perDay: 3, mix: { ops: 0.8, fix: 0.2 }, flat: true },
  { id: 'cli',     name: 'CLI · MCP',     perDay: 3, mix: { build: 0.5, think: 0.3, ops: 0.2 } }
];
/* What gets done by hand in a zone: a mention to an agent or a skill, or plain human work. */
var GEST = {
  build:   { n: '@agent:builder',                k: 'agent', dur: 24, cost: 3.8, produces: true },
  retouch: { n: '@agent:builder (retouche)',     k: 'agent', dur: 9,  cost: 1.3 },
  fixbug:  { n: '@agent:builder corrige le bug', k: 'agent', dur: 14, cost: 2.0, produces: true },
  chore:   { n: '@skill:maintenance',            k: 'skill', dur: 8,  cost: 0.8 },
  deploy:  { n: '@skill:deploy',                 k: 'skill', dur: 4,  cost: 0.4, key: 'deploy' },
  qa:      { n: 'QA manuelle',                   k: 'human', dur: [4, 9], check: true },
  read:    { n: 'Lecture du livrable',           k: 'human', dur: [3, 6] }
};

/* station presets: what the editor offers, and what the imported workflows are made of */
function agent(name, ref, dur, cost, extra) { var o = { name: name, exec: 'agent', ref: ref, model: OPUS, dur: dur, cost: cost, outcomes: [{ name: 'ok' }] }; for (var k in extra) o[k] = extra[k]; return o; }
function setStatus(name, status) { return { name: name, exec: 'native', ref: 'ticket.set_status → ' + status, sets: status, dur: 0.5, cost: 0, outcomes: [{ name: 'ok' }] }; }
function review() { return { name: 'Review', exec: 'skill', ref: 'pr-review', model: OPUS, dur: 9, cost: 1.4,
  outcomes: [{ name: 'OK' }, { name: 'dangerous-fix-first', k: 1.7 }, { name: 'dangerous-need-respecification', k: 0.4 }] }; }
var PRESETS = {
  agent: agent('Agent', 'builder', 20, 2.5),
  skill: { name: 'Skill', exec: 'skill', ref: 'ma-skill', model: SONNET, dur: 6, cost: 0.8, outcomes: [{ name: 'ok' }] },
  panel: { name: 'Panel', exec: 'panel', ref: 'les-big-tech', model: OPUS, dur: 12, cost: 2.2, outcomes: [{ name: 'ok' }] },
  human_gate: { name: 'Gate', exec: 'human_gate', review: [4, 8], outcomes: [{ name: 'approve' }, { name: 'reject', p: 0.1 }] },
  native: setStatus('Set status', 'doing')
};

function rng32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dayCurve(h) {
  if (h < 7) return 0.25; if (h < 9) return 0.8; if (h < 12.5) return 1.9; if (h < 14) return 1.2;
  if (h < 19) return 1.8; if (h < 22) return 0.7; return 0.35;
}
function median(a) {
  if (!a.length) return 0;
  var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function between(r, range) { return range[0] + r() * (range[1] - range[0]); }
function nextModel(model, dir) { var i = MODEL_ORDER.indexOf(model) + dir; return i >= 0 && i < MODEL_ORDER.length ? MODEL_ORDER[i] : null; }
function fmtDur(min) {
  if (min < 1) return '< 1 min';
  if (min < 60) return Math.round(min) + ' min';
  if (min >= 2880) return Math.round(min / DAY) + ' j';
  var h = Math.floor(min / 60), m = Math.round(min % 60);
  if (m === 60) { h++; m = 0; }
  return h + ' h ' + (m < 10 ? '0' : '') + m;
}
function isBox(e) { return !!e && (e.kind === 'station' || e.kind === 'depot' || e.kind === 'exit'); }

/* ---------- simulation ---------- */
function Sim(seed, layout) {
  this.rnd = rng32(seed || 20261116);
  this.W = 62; this.H = 54;
  this.now = 0; this.hourIdx = 0; this.rings = []; this.logN = 0; this.nextId = 1;
  this.ents = []; this.grid = new Array(this.W * this.H); this.loose = [];
  this.tickets = new Map(); this.recent = []; this.ships = [];
  this.fx = []; this.events = []; this.log = [];
  this.seq = 1040;
  this.pool = { max: 10, used: 0, fullMin: this.ring(), usedMin: this.ring() };
  this.g = { inn: this.ring(), out: this.ring(), cost: this.ring(), escapes: this.ring(), human: this.ring(), launched: this.ring(), deploy: this.ring() };
  this.op = { x: 0, y: 0, state: 'away', item: null, left: 0, total: 1, enabled: true, awayUntil: 0, handled: this.ring(), wipLimit: 12 };
  this.outageUntil = 0; this.kept = 0; this.returned = 0; this.outside = [];
  this.session = { t0: 0, shipped: 0, zeroFocusSince: -1, streak: 0, noEscapeSince: 0, edits: 0, todoOkSince: 0 };
  this.build(layout);
  this.initObjectives();
}
Sim.prototype.ring = function () { var r = new Float64Array(RING); this.rings.push(r); return r; };
Sim.prototype.add = function (r, v) { r[this.hourIdx % RING] += v; };
Sim.prototype.sum = function (r, hours) {
  var s = 0, n = Math.min(hours, RING, this.hourIdx + 1);
  for (var i = 0; i < n; i++) s += r[(this.hourIdx - i + RING * 4) % RING];
  return s;
};
Sim.prototype.span = function (hours) { return Math.max(0.25, Math.min(hours - 1 + (this.now % 60) / 60, this.now / 60)); };
Sim.prototype.series = function (r, hours) {
  var out = [];
  for (var i = hours - 1; i >= 0; i--) { var k = this.hourIdx - i; out.push(k < 0 ? 0 : r[(k + RING * 4) % RING]); }
  return out;
};
Sim.prototype.hourOfDay = function () { return (this.now % DAY) / 60; };
Sim.prototype.clock = function () {
  var d = Math.floor(this.now / DAY), m = Math.floor(this.now % DAY), names = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  return { day: d + 1, dow: names[d % 7], hh: Math.floor(m / 60), mm: m % 60 };
};
Sim.prototype.say = function (kind, text) { this.logN++; this.log.push({ n: this.logN, at: this.now, kind: kind, text: text }); if (this.log.length > 60) this.log.shift(); };

/* ---------- the grid ---------- */
Sim.prototype.at = function (x, y) { return x < 0 || y < 0 || x >= this.W || y >= this.H ? null : this.grid[y * this.W + x] || null; };
Sim.prototype.sizeOf = function (spec) {
  var k = spec.kind;
  if (k === 'belt' || k === 'arm' || k === 'label') return [1, 1];
  if (k === 'station') return spec.exec === 'native' ? [2, 2] : [3, 3];
  if (k === 'depot') return [spec.w || 4, spec.h || 4];
  if (k === 'intake') return [2, 2];
  if (k === 'pool') return [3, 2];
  return [spec.w || 3, spec.h || 3];
};
Sim.prototype.free = function (x, y, w, h, ignore) {
  for (var j = y; j < y + h; j++) for (var i = x; i < x + w; i++) {
    if (i < 0 || j < 0 || i >= this.W || j >= this.H) return false;
    var e = this.grid[j * this.W + i]; if (e && e !== ignore) return false;
  }
  return true;
};
Sim.prototype.stRings = function () {
  return { done: this.ring(), cost: this.ring(), busy: this.ring(), slotWait: this.ring(), humanWait: this.ring(), ko: this.ring(), touches: this.ring(), auto: this.ring() };
};
/* put a new machine on the floor; returns it, or null when the tiles are taken */
Sim.prototype.put = function (spec) {
  var sz = this.sizeOf(spec), e = { id: this.nextId++, kind: spec.kind, x: spec.x, y: spec.y, w: sz[0], h: sz[1], dir: spec.dir || 0, takers: [] }, k;
  if (!this.free(e.x, e.y, e.w, e.h)) return null;
  if (e.kind === 'belt') { e.item = null; e.flow = this.ring(); }
  else if (e.kind === 'arm') { e.filter = spec.filter ? { field: spec.filter.field, values: spec.filter.values.slice() } : null; e.state = 'rest'; e.p = 0; e.t = null; e.moved = this.ring(); }
  else if (e.kind === 'station') {
    for (k in spec) if (k !== 'kind' && k !== 'x' && k !== 'y' && k !== 'dir') e[k] = spec[k];
    e.outcomes = (spec.outcomes || [{ name: 'ok' }]).map(function (o) { return { name: o.name, p: o.p || 0, k: o.k || 0 }; });
    e.policy = e.exec === 'human_gate' ? (spec.policy || 'human') : null;
    e.cap = spec.cap || (e.w >= 3 ? 8 : 3);
    e.cells = []; e.rack = []; e.outbox = []; e.h_ = this.stRings();
  } else if (e.kind === 'depot') { e.name = spec.name || 'Zone'; e.status = spec.status || ''; e.release = spec.release || 'manual'; e.limit = spec.limit || 12; e.items = []; e.wait = this.ring(); e.h_ = this.stRings(); }
  else if (e.kind === 'intake') { var src = SOURCES.filter(function (s) { return s.id === spec.sid; })[0] || SOURCES[0]; e.sid = src.id; e.def = src; e.name = spec.name || src.name; e.perDay = spec.perDay == null ? src.perDay : spec.perDay; e.on = spec.on !== false; e.transfer = spec.transfer !== false; e.buffer = []; e.acc = 0; e.emitted = this.ring(); e.kept = 0; }
  else if (e.kind === 'exit') { e.name = spec.name || 'Expédition'; e.count = this.ring(); }
  else if (e.kind === 'label') { e.text = spec.text || 'Zone'; e.color = spec.color || '#a1a1aa'; }
  for (var j = e.y; j < e.y + e.h; j++) for (var i = e.x; i < e.x + e.w; i++) this.grid[j * this.W + i] = e;
  this.ents.push(e); this.wire();
  return e;
};
Sim.prototype.spec = function (e) {
  var s = { kind: e.kind, x: e.x, y: e.y, dir: e.dir }, keys;
  if (e.kind === 'arm' && e.filter) s.filter = { field: e.filter.field, values: e.filter.values.slice() };
  if (e.kind === 'station') { keys = ['name', 'exec', 'ref', 'model', 'dur', 'cost', 'produces', 'sets', 'gesture', 'router', 'pQuestion', 'pFail', 'review', 'policy', 'cap']; keys.forEach(function (k) { if (e[k] != null) s[k] = e[k]; }); s.outcomes = e.outcomes.map(function (o) { return { name: o.name, p: o.p, k: o.k }; }); }
  if (e.kind === 'depot') { s.name = e.name; s.status = e.status; s.release = e.release; s.limit = e.limit; s.w = e.w; s.h = e.h; }
  if (e.kind === 'exit') { s.name = e.name; s.w = e.w; s.h = e.h; }
  if (e.kind === 'intake') { s.sid = e.sid; s.name = e.name; s.perDay = e.perDay; s.on = e.on; s.transfer = e.transfer; }
  if (e.kind === 'label') { s.text = e.text; s.color = e.color; }
  return s;
};
Sim.prototype.ticketsIn = function (e) {
  var out = [];
  if (e.kind === 'belt') { if (e.item) out.push(e.item.t); }
  else if (e.kind === 'arm') { if (e.t) out.push(e.t); }
  else if (e.kind === 'station') { e.cells.forEach(function (c) { out.push(c.t); }); e.rack.forEach(function (r) { out.push(r.t); }); e.outbox.forEach(function (o) { out.push(o.t); }); }
  else if (e.kind === 'depot') e.items.forEach(function (i) { out.push(i.t); });
  else if (e.kind === 'intake') e.buffer.forEach(function (t) { out.push(t); });
  return out;
};
/* take a machine away; whatever it held is left on the floor where it stood */
Sim.prototype.remove = function (e) {
  var self = this, i = this.ents.indexOf(e); if (i < 0) return;
  this.ticketsIn(e).forEach(function (t, k) { self.detach(t); self.loose.push({ t: t, x: e.x + (k % e.w), y: e.y + Math.floor(k / e.w) % e.h }); t.loc = null; });
  this.ents.splice(i, 1);
  for (var j = e.y; j < e.y + e.h; j++) for (var x = e.x; x < e.x + e.w; x++) this.grid[j * this.W + x] = null;
  this.wire();
};
Sim.prototype.move = function (e, x, y) {
  if (!this.free(x, y, e.w, e.h, e)) return false;
  var i, j;
  for (j = e.y; j < e.y + e.h; j++) for (i = e.x; i < e.x + e.w; i++) this.grid[j * this.W + i] = null;
  e.x = x; e.y = y;
  for (j = e.y; j < e.y + e.h; j++) for (i = e.x; i < e.x + e.w; i++) this.grid[j * this.W + i] = e;
  this.wire();
  return true;
};
/* which arms pull from which tile: recomputed whenever the floor changes */
Sim.prototype.wire = function () {
  var i, e;
  for (i = 0; i < this.ents.length; i++) this.ents[i].takers = [];
  for (i = 0; i < this.ents.length; i++) {
    e = this.ents[i];
    if (e.kind !== 'arm') continue;
    e.src = this.at(e.x - DX[e.dir], e.y - DY[e.dir]); e.dst = this.at(e.x + DX[e.dir], e.y + DY[e.dir]);
    if (e.src) e.src.takers.push(e);
  }
};
Sim.prototype.layout = function () { var self = this; return this.ents.map(function (e) { return self.spec(e); }); };
Sim.prototype.resize = function (e, w, h) {
  if (!this.free(e.x, e.y, w, h, e)) return false;
  var i, j;
  for (j = e.y; j < e.y + e.h; j++) for (i = e.x; i < e.x + e.w; i++) this.grid[j * this.W + i] = null;
  e.w = w; e.h = h;
  for (j = e.y; j < e.y + e.h; j++) for (i = e.x; i < e.x + e.w; i++) this.grid[j * this.W + i] = e;
  this.wire();
  return true;
};
/* the first machine a belt leads to, following the belts as they point */
Sim.prototype.leadsTo = function (e) { var g = 0; while (e && e.kind === 'belt' && g++ < 400) e = this.at(e.x + DX[e.dir], e.y + DY[e.dir]); return e && e.kind !== 'belt' ? e : null; };

/* ---------- blueprints ---------- */
function Plan(ox, oy) { this.ox = ox || 0; this.oy = oy || 0; this.list = []; }
Plan.prototype.add = function (spec) { spec.x += this.ox; spec.y += this.oy; this.list.push(spec); return this; };
Plan.prototype.st = function (x, y, def) { var s = { kind: 'station', x: x, y: y }; for (var k in def) s[k] = def[k]; return this.add(s); };
Plan.prototype.arm = function (x, y, dir, field, values) { return this.add({ kind: 'arm', x: x, y: y, dir: dir, filter: field ? { field: field, values: values } : null }); };
/* belts along a path of corner points; every tile points to the next one, the last one keeps going */
Plan.prototype.belt = function (pts, endDir) {
  var tiles = [], i, x, y, dir = 0;
  for (i = 0; i < pts.length - 1; i++) {
    var a = pts[i], b = pts[i + 1], sx = Math.sign(b[0] - a[0]), sy = Math.sign(b[1] - a[1]);
    x = a[0]; y = a[1];
    while (x !== b[0] || y !== b[1]) { tiles.push([x, y]); x += sx; y += sy; }
  }
  tiles.push(pts[pts.length - 1]);
  for (i = 0; i < tiles.length; i++) {
    if (i < tiles.length - 1) { var ddx = tiles[i + 1][0] - tiles[i][0], ddy = tiles[i + 1][1] - tiles[i][1]; dir = ddx > 0 ? 0 : ddx < 0 ? 2 : ddy > 0 ? 1 : 3; }
    else if (endDir != null) dir = endDir;
    this.add({ kind: 'belt', x: tiles[i][0], y: tiles[i][1], dir: dir });
  }
  return this;
};
Plan.prototype.label = function (x, y, text, color) { return this.add({ kind: 'label', x: x, y: y, text: text, color: color }); };
Plan.prototype.box = function () {
  var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, s = Sim.prototype.sizeOf;
  this.list.forEach(function (sp) { var z = s(sp); x0 = Math.min(x0, sp.x); y0 = Math.min(y0, sp.y); x1 = Math.max(x1, sp.x + z[0]); y1 = Math.max(y1, sp.y + z[1]); });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
var OUT = 'outcome';
/* three real workflows, as they would be imported: stations in a row, an arm between two steps, one filtered arm per way back */
var BLUEPRINTS = {
  'product-ideation': { name: 'Ideation', color: '#c084fc', make: function (p) {
    p.label(0, -4, 'IDEATION', '#c084fc');
    p.st(0, 0, agent('Specification', 'catalyst', 16, 1.8, { pQuestion: 0.08, produces: true })).arm(3, 1, 0)
      .st(4, 0, agent('Artifact', 'catalyst', 10, 1.5)).arm(7, 1, 0)
      .st(8, 0, { name: 'Human Gate', exec: 'human_gate', review: [4, 8], outcomes: [{ name: 'approve' }, { name: 'redo-spec-only', p: 0.12 }, { name: 'redo-artifact-only', p: 0.12 }, { name: 'redo-all', p: 0.07 }] })
      .arm(11, 1, 0).belt([[12, 1], [13, 1]]);
    p.arm(8, -1, 3, OUT, ['redo-artifact-only']).belt([[8, -2], [5, -2], [5, -1]]);
    p.arm(10, -1, 3, OUT, ['redo-all']).belt([[10, -2], [10, -3], [1, -3], [1, -1]]);
    p.arm(9, 3, 1, OUT, ['redo-spec-only']).belt([[9, 4], [8, 4]]).st(5, 3, agent('spec to gate', 'catalyst', 9, 1.1, { produces: true })).arm(4, 4, 2).belt([[3, 4], [3, 6], [10, 6], [10, 3]]);
  } },
  'spec-dev-qa': { name: 'Spec Dev PR (HITL)', color: '#60a5fa', make: function (p) {
    p.label(0, -4, 'SPEC DEV PR (HITL)', '#60a5fa');
    p.st(0, 0, setStatus('set doing', 'doing')).arm(2, 1, 0)
      .st(3, 0, agent('Spec', 'catalyst', 16, 1.8, { pQuestion: 0.08, produces: true })).arm(6, 1, 0)
      .st(7, 0, agent('Artifact', 'catalyst', 10, 1.5)).arm(10, 1, 0)
      .st(11, 0, { name: 'Check Spec', exec: 'human_gate', review: [4, 8], outcomes: [{ name: 'approve' }, { name: 'reject', p: 0.06, k: 0.9 }] }).arm(14, 1, 0)
      .st(15, 0, agent('Build', 'builder', 34, 5.0, { pQuestion: 0.05, pFail: 0.03, produces: true })).arm(18, 1, 0)
      .st(19, 0, setStatus('review', 'reviewing')).arm(21, 1, 0)
      .st(22, 0, review()).arm(25, 1, 0).belt([[26, 1], [27, 1]]);
    p.arm(12, -1, 3, OUT, ['reject']).belt([[12, -2], [4, -2], [4, -1]]);
    p.arm(23, -1, 3, OUT, ['dangerous-fix-first']).belt([[23, -2], [22, -2]]).st(20, -3, setStatus('set doing again', 'doing')).arm(19, -2, 2).belt([[18, -2], [16, -2], [16, -1]]);
    p.arm(23, 3, 1, OUT, ['dangerous-need-respecification']).belt([[23, 4], [1, 4], [1, 2]]);
  } },
  'spec-dev-pr-autonomous': { name: 'Spec Dev PR (no HITL)', color: '#4ade80', make: function (p) {
    p.label(0, -4, 'SPEC DEV PR (NO HITL)', '#4ade80');
    p.st(0, 0, agent('Spec', 'catalyst', 16, 1.8, { pQuestion: 0.08, produces: true })).arm(3, 1, 0)
      .st(4, 0, agent('Dev', 'builder', 34, 5.0, { pQuestion: 0.05, pFail: 0.03, produces: true })).arm(7, 1, 0)
      .st(8, 0, setStatus('Ticket Actions', 'reviewing')).arm(10, 1, 0)
      .st(11, 0, review()).arm(14, 1, 0).belt([[15, 1], [16, 1]]);
    p.arm(12, -1, 3, OUT, ['dangerous-fix-first']).belt([[12, -2], [11, -2]]).st(9, -3, setStatus('Status Doing Again', 'doing')).arm(8, -2, 2).belt([[7, -2], [5, -2], [5, -1]]);
    p.arm(12, 3, 1, OUT, ['dangerous-need-respecification']).belt([[12, 4], [9, 4]]).st(7, 3, setStatus('Status Doing', 'doing')).arm(6, 4, 2).belt([[5, 4], [1, 4], [1, 3]]);
  } }
};
Sim.prototype.blueprint = function (slug, ox, oy) { var p = new Plan(ox, oy); BLUEPRINTS[slug].make(p); return p; };
/* all or nothing: a blueprint only lands if every tile it needs is free */
Sim.prototype.stamp = function (plan) {
  var self = this, ok = true;
  plan.list.forEach(function (s) { var z = self.sizeOf(s); if (!self.free(s.x, s.y, z[0], z[1])) ok = false; });
  if (!ok) return null;
  return plan.list.map(function (s) { return self.put(s); });
};

Sim.prototype.defaultSpecs = function () {
  var p = new Plan(0, 0), list;
  /* intake: an arm empties each source onto one collector belt that ends in the triage */
  SOURCES.forEach(function (s, k) { p.add({ kind: 'intake', x: 1, y: 2 + k * 3, sid: s.id }); p.arm(3, 2 + k * 3, 0); });
  p.belt([[4, 2], [4, 24], [5, 24]]);
  p.st(6, 23, { name: 'Tri', exec: 'agent', ref: 'the-sentinel', model: HAIKU, dur: 2.2, cost: 0.9, router: true, outcomes: [{ name: 'ok' }] });
  p.arm(9, 24, 0).belt([[10, 24]]).add({ kind: 'depot', x: 11, y: 22, name: 'Backlog', status: 'backlog' });
  p.arm(7, 26, 1, 'priority', ['urgent', 'high']).belt([[7, 27], [7, 35], [10, 35]]);
  p.arm(12, 26, 1).belt([[12, 27], [12, 32]], 1);
  p.add({ kind: 'depot', x: 11, y: 33, name: 'Todo', status: 'todo' });
  /* launch bus: one belt going up; a filtered arm in front of each line takes what belongs there, the rest ends in the doing zone */
  p.arm(15, 34, 0).belt([[16, 34], [16, 3], [19, 3]]);
  p.arm(17, 32, 0, 'type', ['fix']).arm(17, 21, 0, 'type', ['build']).arm(17, 10, 0, 'type', ['think', 'lead']);
  p.add({ kind: 'depot', x: 20, y: 1, w: 22, h: 4, name: 'Établi', status: 'doing', release: 'auto' });
  p.add({ kind: 'depot', x: 50, y: 18, w: 6, h: 16, name: 'Finition', status: 'reviewing', release: 'auto' });
  p.add({ kind: 'exit', x: 58, y: 1, w: 3, h: 37, name: 'Expédition' });
  /* what leaves a line: Ideation feeds Spec Dev PR (HITL) for `lead` tickets, the rest goes back to a human */
  p.belt([[32, 10], [32, 5]], 3);
  p.arm(31, 11, 1, 'type', ['lead']).belt([[31, 12], [31, 16], [19, 16], [19, 19]], 1);
  p.belt([[46, 21], [49, 21]], 0).belt([[35, 32], [49, 32]], 0);
  p.arm(56, 25, 0).belt([[57, 25]], 0);
  p.arm(42, 2, 0).belt([[43, 2], [57, 2]], 0);
  p.arm(52, 3, 1, OUT, ['reviewing']).belt([[52, 4], [52, 17]], 1);
  p.add({ kind: 'pool', x: 1, y: 27 });
  list = p.list;
  return list.concat(this.blueprint('product-ideation', 18, 9).list, this.blueprint('spec-dev-qa', 18, 20).list, this.blueprint('spec-dev-pr-autonomous', 18, 31).list);
};
Sim.prototype.build = function (layout) {
  var self = this, i, specs = layout || this.defaultSpecs();
  specs.forEach(function (s) { if (!self.put(s) && !layout) throw new Error('default floor: tiles taken at ' + s.x + ',' + s.y); });
  /* a backlog that already has a past */
  var back = this.depots('backlog')[0], todo = this.depots('todo')[0] || back;
  if (!back) back = todo;
  if (!back) return;
  for (i = 0; i < 46; i++) {
    var t = this.makeTicket(SOURCES[Math.floor(this.rnd() * SOURCES.length)], null, null, true), d = i < 5 ? todo : back;
    t.triaged = true; t.born = -(i < 5 ? 60 + this.rnd() * 400 : DAY * (0.5 + this.rnd() * 9));
    this.accept(d, t); d.items[d.items.length - 1].since = t.born; t.log.forEach(function (l) { l.at = t.born; });
  }
};

/* ---------- tickets ---------- */
Sim.prototype.makeTicket = function (src, type, title, silent) {
  var r = this.rnd, mix = src.mix, acc = 0, rr = r(), k;
  if (!type) { for (k in mix) { acc += mix[k]; if (rr < acc) { type = k; break; } } type = type || Object.keys(mix)[0]; }
  var list = TITLES[type], cx = [1, 2, 3, 5, 8, 13];
  var t = { id: ++this.seq, displayId: 'FLX-' + this.seq, type: type, title: title || list[Math.floor(r() * list.length)], factory: true,
    source: src.id, sourceName: src.name, priority: r() < 0.08 ? 'urgent' : r() < 0.3 ? 'high' : r() < 0.75 ? 'medium' : 'low',
    complexity: cx[Math.floor(r() * r() * cx.length)], born: this.now, doneAt: 0, status: 'backlog', triaged: false, outcome: '',
    cost: 0, defect: 0.15, humanWait: 0, gateWait: 0, slotWait: 0, agentMin: 0, benchMin: 0, touches: 0, reworks: 0, runs: 0, did: {},
    firstDoingAt: 0, att: {}, history: [], log: [], loc: null, x: 0, y: 0 };
  this.tickets.set(t.id, t);
  this.note(t, 'system', 'created', 'Ticket créé depuis ' + src.name + ' · transféré à la Factory');
  if (!silent) this.add(this.g.inn, 1);
  return t;
};
/* The ticket's thread, as Tasks and Focus would show it: who did what, in plain words.
   who: system | agent | you | op (the simulated operator) | auto */
Sim.prototype.note = function (t, who, k, text, o) {
  var e = { at: this.now, who: who, k: k, text: text }, x;
  if (o) for (x in o) e[x] = o[x];
  t.log.push(e); if (t.log.length > 140) t.log.shift();
};
Sim.prototype.comment = function (t, text) { this.note(t, 'you', 'comment', text); t.touches++; };
var QUESTIONS = ['Deux lectures possibles de la demande : je garde la compatibilité avec l’existant, ou je repars de zéro ?', 'Il me manque un accès pour continuer : je peux utiliser les données de test ?',
  'Le périmètre déborde sur un autre ticket. Je traite les deux ici, ou seulement celui-ci ?', 'La spec ne dit rien du cas vide. Quel comportement voulez-vous ?'];
function author(st) { return (st.exec === 'agent' ? '@agent:' : st.exec === 'skill' ? '@skill:' : st.exec === 'panel' ? '@panel:' : '') + (st.ref || st.name); }
/* what an agent would write back at the end of a run; guessed from the name of the step */
function runText(st, t, outcome, r) {
  var n = st.name.toLowerCase(), k = 2 + Math.floor(r() * 5), back = st.outcomes.length > 1 && outcome !== st.outcomes[0].name;
  if (st.router) return 'Classé en ' + t.type + ', priorité ' + t.priority + '.';
  if (/review/.test(n) || st.ref === 'pr-review') return back ? (/respec/.test(outcome) ? 'Review : l’implémentation s’écarte de la spec, il faut la reprendre. Issue « ' + outcome + ' ».' : 'Review : ' + k + ' points à corriger avant de merger. Issue « ' + outcome + ' ».') : 'Review : rien de bloquant, la PR peut partir.';
  if (/spec/.test(n)) return 'Spécification rédigée : ' + k + ' user stories, ' + (k * 2 + 1) + ' critères d’acceptation.';
  if (/artifact/.test(n)) return 'Maquette publiée en artifact, prête à relire.';
  if (/build|dev/.test(n)) return 'Implémentation poussée sur la branche flx-' + t.id + ' : ' + (k + 2) + ' fichiers modifiés, PR ouverte.';
  if (/deploy/.test(n)) return 'Déployé en production.';
  return 'Étape terminée' + (st.outcomes.length > 1 ? ' : issue « ' + outcome + ' ».' : '.');
}
Sim.prototype.wip = function () { var n = 0; this.tickets.forEach(function (t) { if (t.status === 'doing' || t.status === 'reviewing') n++; }); return n; };
Sim.prototype.record = function (where, t, exec, result, o) {
  o = o || {};
  t.history.push({ step: where, exec: exec, sid: o.sid || 0, at: this.now, dur: o.dur || 0, cost: o.cost || 0, human: o.human || 0, result: result, back: !!o.back, attempt: o.attempt || 1 });
  if (t.history.length > 60) t.history.shift();
};
/* lift a ticket out of whatever holds it. A run in progress is interrupted. */
Sim.prototype.detach = function (t) {
  var e = t.loc, i;
  if (!e) { for (i = 0; i < this.loose.length; i++) if (this.loose[i].t === t) { this.loose.splice(i, 1); break; } return; }
  if (e.kind === 'belt') { if (e.item && e.item.t === t) e.item = null; }
  else if (e.kind === 'arm') { if (e.t === t) { e.t = null; e.state = 'back'; } }
  else if (e.kind === 'station') {
    for (i = 0; i < e.cells.length; i++) if (e.cells[i].t === t) { var c = e.cells[i]; this.pool.used -= c.w; if (c.state === 'running' && c.w) this.record(e.name, t, e.exec, 'interrupted', { dur: this.now - c.started, cost: c.spent, sid: e.id }); this.note(t, 'system', 'error', 'Run interrompu à ' + e.name + ' : le ticket a été retiré du poste'); e.cells.splice(i, 1); break; }
    e.rack = e.rack.filter(function (r) { return r.t !== t; }); e.outbox = e.outbox.filter(function (o) { return o.t !== t; });
  } else if (e.kind === 'depot') {
    for (i = 0; i < e.items.length; i++) if (e.items[i].t === t) { var en = e.items[i]; this.pool.used -= en.w; if (this.works(e)) t.benchMin += this.now - en.since; e.items.splice(i, 1); break; }
  } else if (e.kind === 'intake') e.buffer = e.buffer.filter(function (x) { return x !== t; });
  t.loc = null;
};
/* can this machine take a ticket right now? */
Sim.prototype.load = function (e) { return e.kind === 'station' ? e.cells.length + e.rack.length + e.outbox.length : 0; };
Sim.prototype.canTake = function (e) {
  if (!e) return false;
  if (e.kind === 'belt') return !e.item;
  if (e.kind === 'station') return this.load(e) < e.cap;      /* a full station takes nothing more: what feeds it backs up */
  return e.kind === 'depot' || e.kind === 'exit';
};
/* hand a ticket to a machine: this is the only way a ticket changes place */
Sim.prototype.accept = function (e, t, fx, fy, p) {
  if (e.kind === 'belt') { e.item = { t: t, p: p == null ? 0.5 : p, fx: fx == null ? DX[e.dir] : fx, fy: fy == null ? DY[e.dir] : fy }; t.loc = e; }
  else if (e.kind === 'station') this.receive(e, t);
  else if (e.kind === 'depot') this.zoneReceive(e, t);
  else if (e.kind === 'exit') this.ship(e, t);
};
/* drop a ticket on a tile, by hand: it takes whatever stands there, or lies on the floor */
Sim.prototype.drop = function (t, x, y) {
  this.detach(t);
  var e = this.at(x, y);
  if (e && this.canTake(e)) { this.note(t, 'you', 'moved', 'Déplacé à la main ' + (e.kind === 'belt' ? 'sur un convoyeur' : e.kind === 'exit' ? 'vers la sortie' : 'dans ' + e.name)); this.accept(e, t); return e; }
  this.loose.push({ t: t, x: clamp(x, 0, this.W - 1), y: clamp(y, 0, this.H - 1) }); t.loc = null;
  this.note(t, 'you', 'moved', 'Posé au sol à la main');
  return null;
};
/* take a ticket out of the factory: it goes back to plain Fleex and leaves the floor */
Sim.prototype.giveBack = function (t) { this.detach(t); t.factory = false; this.note(t, 'you', 'transfer', 'Rendu à Fleex classique : la Factory ne le gère plus'); this.tickets.delete(t.id); this.returned++; this.outside.push(t); if (this.outside.length > 40) this.outside.shift(); };
/* and the other way round: a plain Fleex ticket is handed over and enters by its intake */
Sim.prototype.transferIn = function (t) {
  var i = this.outside.indexOf(t); if (i < 0) return false;
  var src = this.ents.filter(function (e) { return e.kind === 'intake' && e.sid === t.source; })[0] || this.ents.filter(function (e) { return e.kind === 'intake'; })[0];
  this.outside.splice(i, 1); t.factory = true; this.tickets.set(t.id, t); this.note(t, 'you', 'transfer', 'Transféré à la Factory');
  if (src) { t.loc = src; t.x = src.x + 1; t.y = src.y + 1; src.buffer.push(t); } else { t.loc = null; this.loose.push({ t: t, x: 0, y: 0 }); }
  return true;
};

/* ---------- arms ---------- */
Sim.prototype.matches = function (arm, t) {
  var f = arm.filter;
  if (!f || !f.values.length) return true;
  if (f.field === 'outcome') return f.values.indexOf(t.outcome) >= 0;
  if (!t.triaged) return false;
  return f.values.indexOf(f.field === 'type' ? t.type : t.priority) >= 0;
};
/* an arm with no filter is the "otherwise" of its source: it leaves alone what a filtered neighbour is after */
Sim.prototype.wants = function (arm, t) {
  if (!this.matches(arm, t)) return false;
  if (arm.filter && arm.filter.values.length) return true;
  var tk = arm.src ? arm.src.takers : [];
  for (var i = 0; i < tk.length; i++) if (tk[i] !== arm && tk[i].filter && tk[i].filter.values.length && this.matches(tk[i], t)) return false;
  return true;
};
Sim.prototype.pickFor = function (arm) {
  var s = arm.src, i, t;
  if (!s) { var x = arm.x - DX[arm.dir], y = arm.y - DY[arm.dir]; for (i = 0; i < this.loose.length; i++) if (this.loose[i].x === x && this.loose[i].y === y && this.wants(arm, this.loose[i].t)) return this.loose[i].t; return null; }
  if (s.kind === 'belt') return s.item && this.wants(arm, s.item.t) ? s.item.t : null;
  if (s.kind === 'station') { for (i = 0; i < s.outbox.length; i++) if (this.wants(arm, s.outbox[i].t)) return s.outbox[i].t; return null; }
  if (s.kind === 'depot') { for (i = 0; i < s.items.length; i++) if (s.items[i].released && this.wants(arm, s.items[i].t)) return s.items[i].t; return null; }
  if (s.kind === 'intake') { for (i = 0; i < s.buffer.length; i++) if (this.wants(arm, s.buffer[i])) return s.buffer[i]; return null; }
  return null;
};
Sim.prototype.updateArm = function (a, dt) {
  var dp = dt / SWING;
  if (a.state === 'carry') {
    a.p += dp;
    if (a.p < 1) return;
    a.p = 1;
    var d = a.dst;
    if (d ? this.canTake(d) : true) {
      var t = a.t; a.t = null; a.state = 'back'; this.add(a.moved, 1);
      if (d) this.accept(d, t); else { this.loose.push({ t: t, x: a.x + DX[a.dir], y: a.y + DY[a.dir] }); t.loc = null; }
    }
  } else if (a.state === 'back') { a.p -= dp; if (a.p <= 0) { a.p = 0; a.state = 'rest'; } }
  else {
    if (a.dst && !this.canTake(a.dst)) return;
    if (!a.dst && a.dst !== null) return;
    var pick = this.pickFor(a);
    if (!pick) return;
    if (pick.loc && pick.loc.kind === 'depot') { var w = 0; pick.loc.items.forEach(function (it) { if (it.t === pick) w = it.since; }); this.add(pick.loc.wait, this.now - w); }
    if (pick.loc && pick.loc.kind === 'intake') this.add(pick.loc.emitted, 1);
    this.detach(pick); a.t = pick; pick.loc = a; a.state = 'carry'; a.p = 0;
  }
};

/* ---------- belts ---------- */
Sim.prototype.updateBelt = function (b, dt) {
  var it = b.item; if (!it) return;
  /* an arm that wants this ticket gets it: the belt holds it in the middle of the tile */
  var held = false, i;
  for (i = 0; i < b.takers.length; i++) if (this.wants(b.takers[i], it.t)) { held = true; break; }
  var max = held && it.p <= 0.5 ? 0.5 : 1;
  it.p = Math.min(it.p + BELT_V * dt, max);
  if (it.p < 1) return;
  var n = this.at(b.x + DX[b.dir], b.y + DY[b.dir]);
  if (n && n.kind === 'belt') { if (!n.item) { b.item = null; this.add(b.flow, 1); n.item = { t: it.t, p: 0, fx: DX[b.dir], fy: DY[b.dir] }; it.t.loc = n; } }
  else if (isBox(n) && this.canTake(n)) { b.item = null; this.add(b.flow, 1); this.accept(n, it.t); }
};

/* ---------- stations ---------- */
Sim.prototype.weight = function (st) { return st.exec === 'panel' ? 3 : 1; };
Sim.prototype.receive = function (st, t) {
  var r = this.rnd;
  t.loc = st; t.outcome = '';
  t.att[st.id] = (t.att[st.id] || 0) + 1;
  var cell = { t: t, p: 0, dur: 1, cost: 0, state: 'running', run: 'running', need: 0, w: 0, q: this.now, since: this.now, started: this.now, wait: 0, spent: 0, qAt: 0, fAt: 0, attempt: t.att[st.id] };
  if (st.exec === 'human_gate') {
    if (st.policy === 'human') { st.rack.push({ t: t, since: this.now }); return; }
    if (st.policy === 'sampled') { cell.run = 'judge'; cell.state = 'queued'; cell.need = 1; cell.dur = 1.6; cell.cost = 0.12; }
    else { cell.state = cell.run = 'stamp'; cell.dur = 0.3; }
    st.cells.push(cell); return;
  }
  if (st.exec === 'native') { cell.dur = st.dur || 0.5; st.cells.push(cell); return; }
  var m = MODELS[st.model] || MODELS[OPUS], again = cell.attempt > 1 ? 0.6 : 1, size = st.router ? 1 : 0.75 + Math.min(t.complexity, 13) / 16;
  var noise = Math.exp((r() + r() + r() - 1.5) * 0.45);
  cell.dur = (st.dur || 10) * m.speed * again * noise * size;
  cell.cost = (st.cost || 1) * m.cost * again * noise * size * (0.85 + 0.3 * r());
  if (st.pQuestion && r() < st.pQuestion) cell.qAt = 0.25 + r() * 0.5;
  if (st.pFail && r() < st.pFail) cell.fAt = 0.3 + r() * 0.6;
  cell.state = 'queued'; cell.need = this.weight(st);
  st.cells.push(cell);
};
/* the first outcome is the way forward; the others are drawn according to how risky the ticket is */
Sim.prototype.pickOutcome = function (st, t) {
  var o = st.outcomes;
  if (o.length < 2 || (t.att[st.id] || 1) > 3) return o[0].name;
  var r = this.rnd(), acc = 0;
  for (var i = 1; i < o.length; i++) { acc += Math.min(0.6, o[i].p + o[i].k * t.defect); if (r < acc) return o[i].name; }
  return o[0].name;
};
/* a run ended: the ticket waits in the out-tray, tagged with the outcome, until an arm takes it */
Sim.prototype.finish = function (st, t, outcome, cell, humanWait, by) {
  var back = st.outcomes.length > 1 && outcome !== st.outcomes[0].name;
  if (st.exec === 'native') this.note(t, 'system', 'status', st.name + (st.sets ? ' · statut ' + st.sets : ''));
  else if (st.exec === 'human_gate') this.note(t, by || 'auto', 'gate', st.name + ' : ' + outcome, { back: back, wait: humanWait || 0, auto: !by || by === 'auto' });
  else this.note(t, 'agent', 'run', runText(st, t, outcome, this.rnd), { author: author(st), model: st.model, dur: cell ? this.now - cell.started : 0, cost: cell ? cell.spent : 0, back: back, step: st.name });
  this.record(st.name, t, st.exec, outcome, { dur: cell ? this.now - cell.started : 0, cost: cell ? cell.spent : 0, human: humanWait, back: back, attempt: t.att[st.id], sid: st.id });
  this.add(st.h_.done, 1); t.runs++;
  if (back) { this.add(st.h_.ko, 1); t.reworks++; t.defect *= 0.6; }
  else {
    if (st.produces) t.defect = (MODELS[st.model] || MODELS[OPUS]).defect * (0.6 + 0.8 * this.rnd()) * Math.pow(0.5, (t.att[st.id] || 1) - 1);
    else if (st.outcomes.length > 1) t.defect *= st.exec === 'human_gate' ? 0.35 : 0.45;
  }
  if (st.sets) { t.status = st.sets; if (st.sets === 'doing' && !t.firstDoingAt) t.firstDoingAt = this.now; }
  if (st.gesture) t.did[st.gesture] = true;
  if (st.ref === 'deploy') t.did.deploy = true;
  if (st.router) t.triaged = true;
  t.outcome = outcome;
  st.outbox.push({ t: t, since: this.now });
};
Sim.prototype.updateStation = function (st, dt) {
  var cells = st.cells, out = this.now < this.outageUntil;
  for (var i = cells.length - 1; i >= 0; i--) {
    var c = cells[i];
    if (c.state === 'question' || c.state === 'failed' || c.state === 'queued') continue;
    if (out && c.w) continue;
    var dp = Math.min(dt / c.dur, 1 - c.p);
    c.p += dp;
    if (c.cost) { var $ = c.cost * dp; c.spent += $; c.t.cost += $; this.add(st.h_.cost, $); this.add(this.g.cost, $); }
    if (c.w) { this.add(st.h_.busy, dt * c.w); c.t.agentMin += dt; }
    if (c.qAt && c.p >= c.qAt) { c.qAt = 0; c.state = 'question'; c.since = this.now; this.pool.used -= c.w; c.w = 0; this.note(c.t, 'agent', 'question', QUESTIONS[Math.floor(this.rnd() * QUESTIONS.length)], { author: author(st), model: st.model, step: st.name }); continue; }
    if (c.fAt && c.p >= c.fAt) { c.fAt = 0; c.state = 'failed'; c.since = this.now; this.pool.used -= c.w; c.w = 0; this.note(c.t, 'system', 'error', st.name + ' : le run a échoué (failed)'); continue; }
    if (c.p < 1 - 1e-9) continue;
    cells.splice(i, 1); this.pool.used -= c.w;
    var t = c.t;
    if (c.run === 'judge') {
      if (this.rnd() < clamp(1 - t.defect * 2.2, 0.15, 0.92)) { this.add(st.h_.auto, 1); this.finish(st, t, st.outcomes[0].name, c, 0, 'auto'); }
      else st.rack.push({ t: t, since: this.now });
    } else if (c.run === 'stamp') { this.add(st.h_.auto, 1); this.finish(st, t, st.outcomes[0].name, c, 0, 'auto'); }
    else this.finish(st, t, this.pickOutcome(st, t), c);
  }
};
/* the SDK concurrency limiter: queued runs take the next free slot, first come first served */
Sim.prototype.grantSlots = function () {
  if (this.now < this.outageUntil) return;
  var q = [], i, j, e;
  for (i = 0; i < this.ents.length; i++) {
    e = this.ents[i];
    if (e.kind === 'station') { for (j = 0; j < e.cells.length; j++) if (e.cells[j].state === 'queued') q.push([e.cells[j], e]); }
    else if (e.kind === 'depot') { for (j = 0; j < e.items.length; j++) if (e.items[j].state === 'queued') q.push([e.items[j], e]); }
  }
  if (!q.length) return;
  q.sort(function (a, b) { return a[0].q - b[0].q; });
  for (i = 0; i < q.length; i++) {
    var c = q[i][0], where = q[i][1];
    if (this.pool.used + c.need > this.pool.max) continue;
    var w = this.now - c.q;
    if (w > 0.3) { this.add(where.h_.slotWait, w); c.t.slotWait += w; c.wait = (c.wait || 0) + w; }
    c.w = c.need; this.pool.used += c.w; c.state = c.run; c.started = this.now;
  }
};

/* ---------- zones: where tickets wait, and where people work on them by hand ----------
   One kind of machine for backlog, todo, doing and reviewing. In a zone a ticket can be commented, handed to an agent or a skill
   by a mention, and released; only a released ticket can be taken by an arm. What differs between zones is what the tickets
   arriving there still need (nothing in a stock, a few gestures where work is done) and who lets them out. */
Sim.prototype.planFor = function (z, t) {
  if (z.status === 'reviewing') return t.did.deploy ? ['qa'] : ['qa', 'deploy'];
  if (z.status !== 'doing') return [];
  if (t.runs > 1) return ['read'];
  if (t.type === 'fix') return ['fixbug'];
  if (t.type === 'build') return ['build', 'retouch'];
  if (t.type === 'ops') return ['chore'];
  return ['read'];
};
Sim.prototype.works = function (z) { return z.status === 'doing' || z.status === 'reviewing'; };
Sim.prototype.zoneReceive = function (z, t) {
  var plan = this.planFor(z, t);
  t.loc = z; t.outcome = '';
  if (z.status) { t.status = z.status; if (this.works(z) && !t.firstDoingAt) t.firstDoingAt = this.now; }
  z.items.push({ t: t, since: this.now, idleSince: this.now, released: false, relAt: 0, plan: plan, i: 0, state: plan.length ? 'idle' : 'ready', run: 'run', p: 0, dur: 1, cost: 0, spent: 0, need: 0, w: 0, q: 0, started: this.now, by: '', manual: t.runs <= 1 });
  this.note(t, 'system', 'enter', 'Entre dans ' + z.name + (z.status ? ' · statut ' + z.status : ''));
};
Sim.prototype.itemOf = function (z, t) { for (var i = 0; i < z.items.length; i++) if (z.items[i].t === t) return z.items[i]; return null; };
/* a human starts something on a ticket: its next planned gesture, or any mention when a key is given */
Sim.prototype.gesture = function (z, e, by, key) {
  if (e.released || e.state === 'run' || e.state === 'queued') return false;
  if (key) {   /* a mention that was already planned takes its place instead of being done twice */
    var at = e.plan.indexOf(key, e.i); if (at >= 0) e.plan.splice(at, 1);
    e.plan.splice(e.i, 0, key); if (e.state === 'ready') { e.state = 'idle'; e.idleSince = this.now; }
  }
  if (e.state !== 'idle') return false;
  var g = GEST[e.plan[e.i]], r = this.rnd, t = e.t, w = this.now - e.idleSince;
  e.by = by || 'you';
  if (g.k !== 'human') this.note(t, e.by, 'mention', g.n, { wait: w });
  this.add(z.h_.humanWait, w); this.add(z.h_.touches, 1); this.add(this.g.human, w); t.humanWait += w; t.touches++;
  e.started = this.now; e.spent = 0;
  if (g.k === 'human') { this.gestureDone(z, e); return true; }
  if (g.key === 'deploy') this.add(this.g.deploy, 1);
  var noise = Math.exp((r() + r() + r() - 1.5) * 0.4);
  e.dur = g.dur * noise; e.cost = g.cost * noise; e.p = 0; e.need = 1; e.state = 'queued'; e.q = this.now;
  return true;
};
Sim.prototype.mention = function (z, t, key, by) { var e = this.itemOf(z, t); return !!e && this.gesture(z, e, by, key); };
Sim.prototype.gestureDone = function (z, e) {
  var g = GEST[e.plan[e.i]], t = e.t, r = this.rnd, found = false;
  this.record(g.n, t, g.k === 'human' ? 'humain' : g.k, 'ok', { dur: this.now - e.started, cost: e.spent, sid: z.id });
  if (g.produces) t.defect = MODELS[OPUS].defect * (0.6 + 0.8 * r());
  if (g.check) {
    if (r() < t.defect * 1.3 && e.plan.length < 9) { e.plan.splice(e.i + 1, 0, 'retouch', 'qa'); t.defect *= 0.4; t.reworks++; found = true; }
    else t.defect *= 0.3;
  }
  if (g.key === 'deploy') t.did.deploy = true;
  if (g.k === 'human') this.note(t, e.by || 'you', 'human', g.check ? (found ? 'QA manuelle : un défaut trouvé, je demande une retouche.' : 'QA manuelle : rien à signaler.') : 'Livrable relu.');
  else this.note(t, 'agent', 'run', g.key === 'deploy' ? 'Déployé en production.' : g.k === 'skill' ? 'Skill terminée.' : 'C’est fait : modifications poussées sur la branche flx-' + t.id + '.', { author: g.n.split(' ')[0], dur: this.now - e.started, cost: e.spent, step: g.n });
  e.i++; e.idleSince = this.now; e.state = e.i >= e.plan.length ? 'ready' : 'idle';
};
Sim.prototype.updateZone = function (z, dt) {
  if (this.now < this.outageUntil) return;
  for (var i = z.items.length - 1; i >= 0; i--) {
    var e = z.items[i];
    if (e.state !== 'run') continue;
    var dp = Math.min(dt / e.dur, 1 - e.p); e.p += dp;
    var $ = e.cost * dp; e.spent += $; e.t.cost += $; this.add(z.h_.cost, $); this.add(this.g.cost, $);
    this.add(z.h_.busy, dt); e.t.agentMin += dt;
    if (e.p >= 1 - 1e-9) { this.pool.used -= e.w; e.w = 0; this.gestureDone(z, e); }
  }
};
/* the next ticket to let out: nothing left to do on it, most urgent first, then oldest */
Sim.prototype.bestOf = function (d) {
  var rank = { urgent: 0, high: 1, medium: 2, low: 3 }, best = null, bs = 0;
  d.items.forEach(function (e) { if (e.released || e.state !== 'ready') return; var s = rank[e.t.priority] * 300 + e.since; if (!best || s < bs) { best = e; bs = s; } });
  return best;
};
/* let a ticket leave a zone. Leaving a todo zone is what starts it; leaving a work zone closes the work done there. */
Sim.prototype.release = function (d, t, by) {
  var e = this.itemOf(d, t);
  if (!e || e.released || e.state === 'run' || e.state === 'queued') return false;
  e.released = true; e.relAt = this.now; e.state = 'ready';
  if (d.status === 'todo') { t.status = 'doing'; t.firstDoingAt = this.now; this.add(this.g.launched, 1); }
  if (this.works(d)) { t.outcome = d.status === 'doing' && e.manual && (t.type === 'fix' || t.type === 'build') ? 'reviewing' : 'done'; this.add(d.h_.done, 1); }
  this.note(t, by || 'you', 'release', d.status === 'todo' ? 'Lancé depuis ' + d.name : this.works(d) ? 'Travail clos sur ' + d.name : 'Libéré de ' + d.name, { auto: by === 'auto' });
  return true;
};
Sim.prototype.depots = function (status) { return this.ents.filter(function (e) { return e.kind === 'depot' && (!status || e.status === status); }); };
Sim.prototype.count = function (status) { var n = 0; this.depots(status).forEach(function (d) { d.items.forEach(function (i) { if (!i.released) n++; }); }); return n; };

/* ---------- human interventions (the Focus queue) ---------- */
Sim.prototype.focus = function () {
  var out = [], now = this.now, i, j, e;
  for (i = 0; i < this.ents.length; i++) {
    e = this.ents[i];
    if (e.kind === 'station') {
      for (j = 0; j < e.rack.length; j++) out.push({ key: e.rack[j].t.id + ':' + e.id, kind: 'gate', st: e, t: e.rack[j].t, since: e.rack[j].since, age: now - e.rack[j].since, entry: e.rack[j] });
      for (j = 0; j < e.cells.length; j++) { var c = e.cells[j]; if (c.state === 'question' || c.state === 'failed') out.push({ key: c.t.id + ':' + e.id, kind: c.state === 'failed' ? 'error' : 'question', st: e, t: c.t, since: c.since, age: now - c.since, cell: c }); }
    } else if (e.kind === 'depot') {
      for (j = 0; j < e.items.length; j++) {
        var en = e.items[j];
        if (en.released) continue;
        /* a gesture to launch, or work that is finished and waits for someone to close it */
        if (en.state === 'idle' || (en.state === 'ready' && e.release === 'manual' && this.works(e))) out.push({ key: en.t.id + ':' + e.id, kind: 'idle', zone: e, t: en.t, since: en.idleSince, age: now - en.idleSince, slot: en, g: en.state === 'idle' ? GEST[en.plan[en.i]] : null });
      }
    }
  }
  out.sort(function (a, b) { return a.since - b.since; });
  return out;
};
Sim.prototype.focusValid = function (it) {
  if (!it) return false;
  if (it.slot) return it.zone.items.indexOf(it.slot) >= 0 && !it.slot.released && (it.slot.state === 'idle' || it.slot.state === 'ready');
  if (it.entry) return it.st.rack.indexOf(it.entry) >= 0;
  return it.st.cells.indexOf(it.cell) >= 0 && (it.cell.state === 'question' || it.cell.state === 'failed');
};
/* action: a gate outcome, or answer | retry | next | done */
Sim.prototype.resolve = function (it, action, byOperator) {
  if (!this.focusValid(it)) return false;
  if (!byOperator && this.op.item && this.op.item.key === it.key) { this.op.item = null; this.op.state = 'idle'; }
  if (it.slot) {
    if (action === 'done' || !it.g) { var w0 = this.now - it.slot.idleSince; this.add(it.zone.h_.humanWait, w0); this.add(it.zone.h_.touches, 1); it.t.humanWait += w0; it.t.touches++; this.release(it.zone, it.t, byOperator ? 'op' : 'you'); }
    else this.gesture(it.zone, it.slot, byOperator ? 'op' : 'you');
    return true;
  }
  var st = it.st, t = it.t, wait = this.now - it.since;
  this.add(st.h_.humanWait, wait); this.add(st.h_.touches, 1); this.add(this.g.human, wait);
  t.humanWait += wait; t.gateWait += wait; t.touches++;
  if (it.entry) { st.rack.splice(st.rack.indexOf(it.entry), 1); this.finish(st, t, action, null, wait, byOperator ? 'op' : 'you'); return true; }
  var c = it.cell;
  this.note(t, byOperator ? 'op' : 'you', c.state === 'failed' ? 'retry' : 'answer', c.state === 'failed' ? 'Je relance l’étape ' + st.name + '.' : 'Réponse envoyée : continue avec l’option la plus simple.', { wait: wait });
  if (c.state === 'failed') { c.p = 0; c.attempt++; t.att[st.id]++; }
  c.state = 'queued'; c.q = this.now;
  return true;
};
Sim.prototype.opAvailable = function () {
  var h = this.hourOfDay();
  return this.op.enabled && this.now >= this.op.awayUntil && ((h >= 9 && h < 12.5) || (h >= 13.5 && h < 18.5));
};
/* The simulated operator acts from above, like the real one: one thing at a time, at a human pace. */
Sim.prototype.updateOperator = function (dt) {
  var op = this.op, r = this.rnd, self = this;
  if (!this.opAvailable()) { op.item = null; op.state = 'away'; return; }
  if (op.state !== 'work') op.state = 'idle';
  if (op.item && op.item.key && !this.focusValid(op.item)) { op.item = null; op.state = 'idle'; }
  if (op.state === 'idle') {
    var list = this.focus(), pick = null, i;
    for (i = 0; i < list.length; i++) if (list[i].kind === 'question' || list[i].kind === 'error') { pick = list[i]; break; }
    var room = this.wip() < op.wipLimit;
    if (!pick && room && this.count('todo') < 3) this.depots('backlog').forEach(function (d) { if (!pick && d.release === 'manual' && self.bestOf(d)) pick = { kind: 'groom', depot: d }; });
    if (!pick && room) this.depots('todo').forEach(function (d) { if (!pick && d.release === 'manual' && self.bestOf(d)) pick = { kind: 'launch', depot: d }; });
    if (!pick && list.length) pick = list[0];
    if (!pick) return;
    op.item = pick;
    if (pick.kind === 'launch') op.total = 1;
    else if (pick.kind === 'groom') op.total = 0.6;
    else if (pick.kind === 'gate') op.total = between(r, pick.st.review || [3, 6]);
    else if (pick.kind === 'question') op.total = 2 + r() * 3;
    else if (pick.kind === 'idle') op.total = pick.g && pick.g.k === 'human' ? between(r, pick.g.dur) : 1.5;
    else op.total = 1.5;
    op.total += 0.5; op.left = op.total; op.state = 'work';
  }
  var it = op.item;
  if (it.depot) { op.x = it.depot.x + 2; op.y = it.depot.y + 2; } else { op.x = it.t.x; op.y = it.t.y; }
  op.left -= dt;
  if (op.left > 0) return;
  if (it.depot) { var b = this.bestOf(it.depot); if (b) this.release(it.depot, b.t, 'op'); }
  else {
    var action = 'next';
    if (it.kind === 'gate') action = this.pickOutcome(it.st, it.t);
    else if (it.kind === 'question') action = 'answer';
    else if (it.kind === 'error') action = 'retry';
    var zone = it.zone, slot = it.slot;
    this.resolve(it, action, true);
    if (slot && zone.items.indexOf(slot) >= 0 && slot.state === 'idle' && GEST[slot.plan[slot.i]].k !== 'human') this.gesture(zone, slot, 'op');
    this.add(op.handled, 1);
  }
  op.item = null; op.state = 'idle';
};

/* ---------- shipping ---------- */
Sim.prototype.ship = function (ex, t) {
  t.status = 'done'; t.doneAt = this.now; t.loc = null; t.x = ex.x + 1;
  this.note(t, 'system', 'shipped', 'Expédié par ' + ex.name + ' · statut done');
  this.tickets.delete(t.id);
  this.add(this.g.out, 1); this.add(ex.count, 1);
  var s = { type: t.type, lead: this.now - (t.firstDoingAt || t.born), gate: t.gateWait, slot: t.slotWait, agent: t.agentMin, bench: t.benchMin, touches: t.touches, cost: t.cost, reworks: t.reworks, at: this.now };
  this.ships.push(s); if (this.ships.length > 160) this.ships.shift();
  this.recent.push(t); if (this.recent.length > 60) this.recent.shift();
  this.session.shipped++;
  this.session.streak = t.touches === 0 ? this.session.streak + 1 : 0;
  var self = this, r = this.rnd;
  /* a defect that slipped through comes back later as a bug */
  if ((t.type === 'build' || t.type === 'fix' || t.type === 'lead') && r() < t.defect * 0.55) {
    this.events.push({ at: this.now + 60 + r() * 240, fn: function () {
      var nt = self.inject(r() < 0.6 ? 'slack' : 'github', 'fix', 'Régression : ' + t.title.replace(/^Régression : /, ''));
      if (!nt) return;
      nt.parent = t.displayId; nt.priority = 'high';
      self.add(self.g.escapes, 1); self.session.noEscapeSince = self.now;
      self.say('escape', 'Défaut échappé sur ' + t.displayId + ' : ' + nt.displayId + ' arrive à l’intake');
    } });
  }
};
Sim.prototype.inject = function (sid, type, title) {
  var src = this.ents.filter(function (e) { return e.kind === 'intake' && e.sid === sid; })[0] || this.ents.filter(function (e) { return e.kind === 'intake'; })[0];
  if (!src) return null;
  var t = this.makeTicket(src.def, type, title); t.sourceName = src.name; t.loc = src; t.x = src.x + 1; t.y = src.y + 1;
  src.buffer.push(t);
  return t;
};
Sim.prototype.scenario = function (name) {
  var self = this, r = this.rnd, i;
  if (name === 'incident') {
    for (i = 0; i < 12; i++) (function (i) { self.events.push({ at: self.now + i * 1.4 + r(), fn: function () { var t = self.inject(i % 3 === 0 ? 'github' : 'slack', 'fix'); if (t) t.priority = 'urgent'; } }); })(i);
    this.say('alert', 'Incident prod : 12 bugs urgents arrivent de Slack et GitHub');
  } else if (name === 'meeting') { this.op.awayUntil = this.now + 120; this.say('alert', 'Opérateur simulé absent pendant 2 h'); }
  else if (name === 'prd') {
    for (i = 0; i < 6; i++) (function (i) { self.events.push({ at: self.now + i * 1.2, fn: function () { var t = self.inject('linear', 'build', 'Refonte de l’onboarding · lot ' + (i + 1) + '/6'); if (t) t.priority = 'high'; } }); })(i);
    this.say('info', 'Un gros PRD découpé en 6 tickets arrive de Linear');
  } else if (name === 'outage') { this.outageUntil = this.now + 30; this.say('alert', 'Panne API : les agents sont à l’arrêt pendant 30 min'); }
};

/* ---------- main step ---------- */
Sim.prototype.step = function (dt) {
  var i, e, ents = this.ents;
  this.now += dt;
  var hi = Math.floor(this.now / 60);
  while (hi > this.hourIdx) { this.hourIdx++; var b = this.hourIdx % RING; for (i = 0; i < this.rings.length; i++) this.rings[i][b] = 0; }
  for (i = this.events.length - 1; i >= 0; i--) if (this.events[i].at <= this.now) { var ev = this.events[i]; this.events.splice(i, 1); ev.fn(); }
  var curve = dayCurve(this.hourOfDay()), wip = -1;
  for (i = 0; i < ents.length; i++) {
    e = ents[i];
    if (e.kind === 'belt') this.updateBelt(e, dt);
    else if (e.kind === 'arm') this.updateArm(e, dt);
    else if (e.kind === 'station') this.updateStation(e, dt);
    else if (e.kind === 'intake') {
      if (e.on && e.perDay > 0) {
        e.acc += dt * e.perDay / DAY * (e.def.flat ? 1 : curve);
        if (e.acc > 0 && this.rnd() < e.acc) {
          e.acc -= 1; if (e.acc < -1) e.acc = -1;
          /* a ticket only lands on the floor if it has been handed over to the factory */
          var nt = this.makeTicket(e.def, null, null, !e.transfer); nt.sourceName = e.name;
          if (e.transfer) { nt.loc = e; nt.x = e.x + 1; nt.y = e.y + 1; e.buffer.push(nt); }
          else { nt.factory = false; this.tickets.delete(nt.id); e.kept++; this.kept++; this.outside.push(nt); if (this.outside.length > 40) this.outside.shift(); }
        }
      }
    } else if (e.kind === 'depot') {
      this.updateZone(e, dt);
      if (e.release !== 'auto') continue;
      if (wip < 0) wip = this.wip();
      var pending = false; e.items.forEach(function (it) { if (it.released) pending = true; });
      if (!pending && (e.status !== 'todo' || wip < e.limit)) { var best = this.bestOf(e); if (best) this.release(e, best.t, 'auto'); }
    }
  }
  this.grantSlots();
  this.updateOperator(dt);
  while (this.fx.length && this.now - this.fx[0].t0 > 3) this.fx.shift();
  this.add(this.pool.usedMin, dt * this.pool.used);
  if (this.pool.used >= this.pool.max) this.add(this.pool.fullMin, dt);
  this.tickObjectives();
};

/* ---------- read models ---------- */
/* where a ticket goes next if nothing changes: follow the belt it is on up to the next machine that will hold it */
Sim.prototype.trace = function (t, from) {
  var e = from || t.loc, pts = [from ? [from.x + 0.5, from.y + 0.5] : [t.x, t.y]], guard = 0, dest = '', self = this, i;
  function arm(src) { var tk = src.takers; for (var k = 0; k < tk.length; k++) if (self.wants(tk[k], t)) return tk[k]; return null; }
  if (!e || (!from && t.status === 'done')) return null;
  if (e.kind === 'arm') { pts.push([e.x + 0.5 + DX[e.dir], e.y + 0.5 + DY[e.dir]]); e = e.dst; }
  else if (e.kind !== 'belt') {
    var ready = e.kind === 'depot' ? e.items.some(function (it) { return it.t === t && it.released; }) : (e.outbox || []).some(function (o) { return o.t === t; });
    var a0 = ready || e.kind === 'depot' || e.kind === 'intake' ? arm(e) : null;
    if (!a0) return null;
    pts.push([a0.x + 0.5, a0.y + 0.5], [a0.x + 0.5 + DX[a0.dir], a0.y + 0.5 + DY[a0.dir]]); e = a0.dst;
  }
  while (e && guard++ < 200) {
    if (e.kind === 'belt') {
      var a = arm(e);
      if (a) { pts.push([e.x + 0.5, e.y + 0.5], [a.x + 0.5, a.y + 0.5], [a.x + 0.5 + DX[a.dir], a.y + 0.5 + DY[a.dir]]); e = a.dst; continue; }
      pts.push([e.x + 0.5 + DX[e.dir] * 0.5, e.y + 0.5 + DY[e.dir] * 0.5]);
      e = this.at(e.x + DX[e.dir], e.y + DY[e.dir]);
    } else { dest = e.name || ''; if (isBox(e)) pts.push([clamp(pts[pts.length - 1][0], e.x + 0.5, e.x + e.w - 0.5), clamp(pts[pts.length - 1][1], e.y + 0.5, e.y + e.h - 0.5)]); break; }
  }
  if (!dest && !e) dest = 'nulle part : le convoyeur s’arrête';
  for (i = pts.length - 2; i > 0; i--) if (pts[i][0] === pts[i - 1][0] && pts[i][1] === pts[i - 1][1]) pts.splice(i, 1);
  return pts.length > 1 ? { pts: pts, dest: dest } : null;
};
Sim.prototype.oldest = function (status) { var o = 0, now = this.now; this.depots(status).forEach(function (d) { d.items.forEach(function (e) { if (!e.released) o = Math.max(o, now - e.since); }); }); return o; };
Sim.prototype.kpis = function () {
  var W = 6, sp = this.span(W), f = this.focus(), ships = this.ships.slice(-60);
  var frac = (this.now % 60) / 60, cur = this.g.cost[this.hourIdx % RING], prev = this.hourIdx > 0 ? this.g.cost[(this.hourIdx - 1) % RING] : 0, lead = 0, bench = 0;
  ships.forEach(function (s) { lead += s.lead; bench += s.bench; });
  return { shipped24: this.sum(this.g.out, 24), perHour: this.sum(this.g.out, W) / sp, in24: this.sum(this.g.inn, 24),
    backlog: this.count('backlog'), todo: this.count('todo'), todoOldest: this.oldest('todo'), wip: this.wip(),
    lead: median(ships.map(function (s) { return s.lead; })),
    autonomy: ships.length ? ships.filter(function (s) { return s.touches === 0; }).length / ships.length : 0,
    benchShare: lead ? bench / lead : 0, costPerTicket: ships.length ? ships.reduce(function (a, s) { return a + s.cost; }, 0) / ships.length : 0,
    burn: cur + prev * (1 - frac), focus: f.length, oldest: f.length ? f[0].age : 0,
    poolUsed: this.pool.used, poolMax: this.pool.max, escapes24: this.sum(this.g.escapes, 24), outage: this.now < this.outageUntil, loose: this.loose.length };
};
Sim.prototype.stationStats = function (st, W) {
  W = W || 12;
  var done = this.sum(st.h_.done, W), cost = this.sum(st.h_.cost, W), now = this.now, hw = this.sum(st.h_.humanWait, W), waitingNow = 0, oldest = 0, queued = 0, running = 0, stuck = 0;
  st.rack.forEach(function (e) { waitingNow++; hw += now - e.since; oldest = Math.max(oldest, now - e.since); });
  st.cells.forEach(function (c) {
    if (c.state === 'question' || c.state === 'failed') { waitingNow++; hw += now - c.since; oldest = Math.max(oldest, now - c.since); }
    else if (c.state === 'queued') queued++; else if (c.run !== 'stamp') running++;
  });
  st.outbox.forEach(function (o) { stuck = Math.max(stuck, now - o.since); });
  var touches = this.sum(st.h_.touches, W), busy = this.sum(st.h_.busy, W);
  return { done: done, cost: cost, costPer: done ? cost / done : 0, busy: busy, avgRun: done ? busy / this.weight(st) / done : 0,
    slotWait: this.sum(st.h_.slotWait, W), humanWait: hw, waitingNow: waitingNow, oldest: oldest, avgHuman: touches + waitingNow ? hw / (touches + waitingNow) : 0,
    ko: this.sum(st.h_.ko, W), koRate: done ? this.sum(st.h_.ko, W) / done : 0, auto: this.sum(st.h_.auto, W), touches: touches, running: running, queued: queued, out: st.outbox.length, stuck: stuck };
};
Sim.prototype.zoneStats = function (z, W) {
  W = W || 12;
  var now = this.now, hw = this.sum(z.h_.humanWait, W), idle = 0, run = 0, queued = 0, ready = 0, out = 0, oldest = 0, old = 0, stuck = 0, touches = this.sum(z.h_.touches, W);
  z.items.forEach(function (e) {
    if (e.released) { out++; stuck = Math.max(stuck, now - e.relAt); }
    else if (e.state === 'idle') { idle++; hw += now - e.idleSince; oldest = Math.max(oldest, now - e.idleSince); }
    else if (e.state === 'run') run++; else if (e.state === 'queued') queued++;
    else { ready++; old = Math.max(old, now - e.since); }
  });
  return { n: z.items.length, idle: idle, running: run, queued: queued, ready: ready, oldest: oldest, old: old, humanWait: hw, avgHuman: touches + idle ? hw / (touches + idle) : 0, touches: touches,
    cost: this.sum(z.h_.cost, W), done: this.sum(z.h_.done, W), out: out, stuck: stuck };
};
/* ranked list of what slows the floor down or costs the most */
Sim.prototype.bottlenecks = function () {
  var self = this, W = 12, cards = [], total = 0, top = null;
  this.ents.forEach(function (e) {
    if (e.kind === 'station') {
      var s = self.stationStats(e, W); total += s.cost;
      if (!top || s.cost > top.s.cost) top = { e: e, s: s };
      if (s.out && s.stuck > 4) cards.push({ kind: 'stuck', ref: e, title: e.name, score: 900 + s.stuck, metric: s.out + ' pièce' + (s.out > 1 ? 's' : '') + ' sans sortie depuis ' + fmtDur(s.stuck),
        detail: 'Issue « ' + e.outbox[0].t.outcome + ' » : aucun bras ne la prend, ou sa destination est saturée. Posez un bras, ou un bras sans filtre qui prendra tout le reste.' });
      if (s.humanWait > 45) {
        var c = { kind: e.exec === 'human_gate' ? 'human' : 'question', ref: e, title: e.name, score: s.humanWait,
          metric: (s.waitingNow ? s.waitingNow + ' en attente · ' : '') + fmtDur(s.avgHuman) + ' d’attente en moyenne', detail: (s.waitingNow ? 'Le plus ancien attend depuis ' + fmtDur(s.oldest) + ' · ' : '') + fmtDur(s.humanWait) + ' d’attente cumulée sur 12 h' };
        if (e.exec === 'human_gate' && e.policy !== 'auto') c.fix = { label: e.policy === 'human' ? 'Passer en contrôle échantillonné' : 'Passer en automatique',
          hint: e.policy === 'human' ? 'Un agent juge valide les tickets à faible risque, le reste vous attend.' : 'Plus aucun contrôle humain ici : le débit monte, les défauts échappés aussi.',
          apply: function () { e.policy = e.policy === 'human' ? 'sampled' : 'auto'; } };
        cards.push(c);
      }
    } else if (e.kind === 'depot' && e.status !== 'todo') {
      var b = self.zoneStats(e, W); total += b.cost;
      if (b.out && b.stuck > 4) cards.push({ kind: 'stuck', ref: e, title: e.name, score: 900 + b.stuck, metric: b.out + ' pièce' + (b.out > 1 ? 's' : '') + ' sans sortie depuis ' + fmtDur(b.stuck), detail: 'Aucun bras ne prend ce qui sort de cette zone, ou sa destination est saturée.' });
      if (b.humanWait > 60) cards.push({ kind: 'bench', ref: e, title: e.name + (e.status ? ' · ' + e.status : ''), score: b.humanWait * 0.8, metric: (b.idle ? b.idle + ' à relancer · ' : '') + fmtDur(b.avgHuman) + ' d’attente avant chaque geste',
        detail: 'Travail fait à la main : chaque geste attend que vous le lanciez. ' + fmtDur(b.humanWait) + ' d’attente cumulée sur 12 h.' });
    } else if (e.kind === 'intake' && e.buffer.length >= 3) {
      cards.push({ kind: 'stuck', ref: e, title: 'Intake ' + e.name, score: 700 + e.buffer.length * 10, metric: e.buffer.length + ' tickets attendent d’être emmenés',
        detail: e.takers.length ? 'Le bras qui vide cet intake ne suit pas, ou sa destination est saturée.' : 'Aucun bras ne vide cet intake : posez-en un contre lui, pointé vers un convoyeur.' });
    } else if (e.kind === 'depot' && e.status === 'todo') {
      var n = 0, old = 0; e.items.forEach(function (it) { if (!it.released) { n++; old = Math.max(old, self.now - it.since); } });
      if (n >= 5 || old > 240) cards.push({ kind: 'todo', ref: e, title: e.name, score: old * 0.7 + n * 15, metric: n + ' tickets prêts · le plus ancien depuis ' + fmtDur(old), detail: self.wip() + ' en cours pour une limite de ' + (e.release === 'auto' ? e.limit : self.op.wipLimit),
        fix: e.release === 'auto' ? { label: 'Limite d’en-cours à ' + (e.limit + 4), hint: 'Plus de tickets en parallèle : attention à ce qui s’accumule ensuite sur les gates et en finition.', apply: function () { e.limit += 4; } } :
          { label: 'Activer la sortie automatique', hint: 'Le prochain ticket part dès qu’il y a de la place, sans attendre que vous le lanciez.', apply: function () { e.release = 'auto'; } } });
    }
  });
  var nd = this.sum(this.g.deploy, 24);
  if (nd >= 3 && !this.ents.some(function (e) { return e.kind === 'station' && (e.ref === 'deploy' || e.gesture === 'deploy'); }))
    cards.push({ kind: 'automate', ref: this.ents.filter(function (e) { return e.kind === 'depot' && e.status === 'reviewing'; })[0] || null, title: 'Geste répété : @skill:deploy', score: 500 + nd * 20,
      metric: nd + ' fois à la main en 24 h', detail: 'Toujours lancé depuis la finition, après une review. Chaque lancement attend que vous soyez disponible.', edit: 'deploy',
      fix: { label: 'Poser un poste Deploy', hint: 'Passe en édition avec un poste « Deploy » prêt à poser : placez-le sur le chemin, avant la finition. Les tickets qui l’ont traversé n’auront plus ce geste à faire.', apply: function () {} } });
  var slot = 0; this.ents.forEach(function (e) { if (e.h_) slot += self.sum(e.h_.slotWait, W); });
  var sat = this.sum(this.pool.fullMin, W) / (this.span(W) * 60);
  if (slot > 40 || sat > 0.12) cards.push({ kind: 'pool', ref: this.ents.filter(function (e) { return e.kind === 'pool'; })[0] || null, title: 'Slots agents saturés', score: slot * 1.5,
    metric: fmtDur(slot) + ' de file d’attente sur 12 h', detail: 'agentMaxConcurrency = ' + this.pool.max + ' · plein ' + Math.round(sat * 100) + ' % du temps',
    fix: { label: 'Passer à ' + (this.pool.max + 4) + ' slots', hint: 'Plus d’agents en parallèle : la file se vide, la dépense horaire monte.', apply: function () { self.pool.max += 4; } } });
  if (top && total > 5) {
    var down = nextModel(top.e.model, -1), c2 = { kind: 'cost', ref: top.e, title: top.e.name, score: top.s.cost / total * 300, metric: '$' + top.s.cost.toFixed(0) + ' sur 12 h · ' + Math.round(top.s.cost / total * 100) + ' % de la dépense',
      detail: '$' + top.s.costPer.toFixed(2) + ' par ticket · ' + (MODELS[top.e.model] || MODELS[OPUS]).label };
    if (down && MODELS[top.e.model].tier > 2) c2.fix = { label: 'Passer sur ' + MODELS[down].label, hint: 'Environ −' + Math.round((1 - MODELS[down].cost / MODELS[top.e.model].cost) * 100) + ' % de coût, mais plus de retours en aval.', apply: function () { top.e.model = down; } };
    cards.push(c2);
  }
  if (this.loose.length) cards.push({ kind: 'stuck', ref: null, loose: this.loose[0], title: 'Tickets posés au sol', score: 300, metric: this.loose.length + ' ticket' + (this.loose.length > 1 ? 's' : '') + ' hors de tout poste', detail: 'Ils ne bougeront pas seuls : déposez-les sur un convoyeur, un poste ou un dépôt.' });
  cards.sort(function (a, b) { return b.score - a.score; });
  return cards;
};

/* ---------- objectives ---------- */
Sim.prototype.initObjectives = function () {
  var self = this;
  this.objectives = [
    { id: 'start', name: 'Mise en route', desc: 'Expédier 20 tickets', eval: function () { return [self.session.shipped, 20]; }, fmt: function (v) { return Math.floor(v[0]) + ' / 20'; } },
    { id: 'edit', name: 'Premier aménagement', desc: 'Poser ou déplacer une machine en mode édition', eval: function () { return [self.session.edits, 1]; }, fmt: function (v) { return Math.min(v[0], 1) + ' / 1'; } },
    { id: 'todo', name: 'Quai fluide', desc: 'Aucun todo de plus de 3 h, pendant 6 h', eval: function () { return [(self.now - self.session.todoOkSince) / 60, 6]; }, fmt: function (v) { return v[0].toFixed(1) + ' / 6 h'; } },
    { id: 'focus0', name: 'File vide', desc: 'Garder Focus vide pendant 1 h', eval: function () { return [self.session.zeroFocusSince < 0 ? 0 : self.now - self.session.zeroFocusSince, 60]; }, fmt: function (v) { return Math.floor(v[0]) + ' / 60 min'; } },
    { id: 'bench', name: 'Établi allégé', desc: 'Moins de 35 % du temps d’un ticket passé à la main', lower: true,
      eval: function () { var n = self.ships.filter(function (x) { return x.at > self.session.t0; }).length; return n < 20 ? [n, 20, true] : [self.kpis().benchShare * 100, 35]; },
      fmt: function (v) { return v[2] ? v[0] + ' / 20 tickets mesurés' : Math.round(v[0]) + ' % / 35 %'; } },
    { id: 'lightsout', name: 'Lights-out', desc: '8 tickets d’affilée expédiés sans aucune intervention humaine', eval: function () { return [self.session.streak, 8]; }, fmt: function (v) { return v[0] + ' / 8'; } },
    { id: 'clean', name: 'Zéro défaut', desc: 'Aucun défaut échappé pendant 24 h', eval: function () { return [(self.now - self.session.noEscapeSince) / 60, 24]; }, fmt: function (v) { return v[0].toFixed(1) + ' / 24 h'; } }
  ];
  this.objectives.forEach(function (o) { o.done = false; });
};
Sim.prototype.tickObjectives = function () {
  if (Math.floor(this.now / 2) === Math.floor((this.now - 0.2) / 2)) return;
  var f = this.focus().length;
  if (f) this.session.zeroFocusSince = -1; else if (this.session.zeroFocusSince < 0) this.session.zeroFocusSince = this.now;
  if (this.oldest('todo') > 180) this.session.todoOkSince = this.now;
  for (var k = 0; k < this.objectives.length; k++) {
    var o = this.objectives[k];
    if (o.done) continue;
    var v = o.eval(); o.value = v;
    if (v[2]) continue;
    if (o.lower ? v[0] <= v[1] : v[0] >= v[1]) { o.done = true; if (this.now > this.session.t0) this.say('objective', 'Objectif atteint : ' + o.name); }
  }
};
/* fast-forward without rendering, so the floor opens mid-shift with history behind it */
Sim.prototype.prewarm = function (minutes) {
  var n = Math.round(minutes / 0.1);
  for (var i = 0; i < n; i++) this.step(0.1);
  var s = this.session;
  s.t0 = this.now; s.shipped = 0; s.streak = 0; s.noEscapeSince = this.now; s.zeroFocusSince = -1; s.todoOkSince = this.now; s.edits = 0;
  this.objectives.forEach(function (o) { o.done = false; o.value = null; });
  this.log.length = 0;
};

root.FleexFactory = { Sim: Sim, Plan: Plan, MODELS: MODELS, MODEL_ORDER: MODEL_ORDER, TYPES: TYPES, PRIORITIES: PRIORITIES, GEST: GEST, SOURCES: SOURCES, PRESETS: PRESETS, BLUEPRINTS: BLUEPRINTS,
  DX: DX, DY: DY, BELT_V: BELT_V, RING: RING, fmtDur: fmtDur, clamp: clamp, isBox: isBox };
})(typeof window !== 'undefined' ? window : globalThis);
