/* Fleex Factory — simulation engine (no DOM).
   Mock data, real Fleex vocabulary: WorkflowExecutorType, StepRunStatus, FocusItemKind, agentMaxConcurrency.
   Time unit: one simulated minute. Space unit: one floor tile. */
(function (root) {
'use strict';

var RING = 72;                 // hourly buckets kept per metric
var GAP = 0.62;                // minimum spacing between two items on a belt
var BELT_V = 1.7;              // tiles per simulated minute
var SWING = 0.26;              // inserter half-cycle, simulated minutes
var DAY = 1440;

var MODELS = {
  'claude-haiku-5-5':  { label: 'Haiku 5.5',  short: 'haiku',  speed: 0.55, cost: 0.05, defect: 0.42, tier: 1 },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', short: 'sonnet', speed: 0.80, cost: 0.45, defect: 0.26, tier: 2 },
  'claude-opus-5-5':   { label: 'Opus 5.5',   short: 'opus',   speed: 1.00, cost: 1.00, defect: 0.16, tier: 3 },
  'claude-fable-5-2':  { label: 'Fable 5.2',  short: 'fable',  speed: 1.10, cost: 1.60, defect: 0.08, tier: 4 }
};
var MODEL_ORDER = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'];

var TYPES = {
  build: { label: 'build', color: '#60a5fa', letter: 'B' },
  fix:   { label: 'fix',   color: '#f87171', letter: 'F' },
  think: { label: 'think', color: '#c084fc', letter: 'T' },
  lead:  { label: 'lead',  color: '#facc15', letter: 'L' },
  ops:   { label: 'ops',   color: '#2dd4bf', letter: 'O' }
};

var TITLES = {
  fix: ['Export CSV tronqué au-delà de 10 000 lignes', 'Boucle de redirection SSO sur Safari', 'Crash du drag & drop dans le Kanban',
    'Webhook Slack reçu en double', 'Timeout sur /api/statistics', 'Fuite mémoire dans le terminal', 'Tri des tickets cassé après un filtre',
    'Notification push envoyée deux fois', 'Agenda : fuseau décalé d’une heure', 'CostBadge affiche NaN sans exécution',
    'Worktree non nettoyé après merge', 'Session CLI marquée interrompue à tort', 'Mention @agent ignorée dans un commentaire',
    'Deliverable vide après un retry', 'Focus : gate résolue encore affichée'],
  build: ['Filtres sauvegardés dans Tasks', 'Vue Agenda hebdomadaire', 'Import des issues Linear', 'Raccourcis clavier dans Focus',
    'Mode compact pour la timeline', 'Export PDF d’un deliverable', 'Recherche plein texte dans Documents', 'Webhook entrant générique',
    'Tags colorés sur le Kanban', 'Résumé quotidien par e-mail', 'Budget par workflow', 'Reprise d’un run depuis une étape',
    'Duplication d’un workflow', 'Vue liste dans Routines', 'Pièces jointes dans les commentaires'],
  think: ['Faut-il un mode multi-utilisateur ?', 'Pricing : par siège ou à l’usage ?', 'Explorer une app mobile native',
    'Une marketplace de workflows ?', 'Positionnement face aux IDE agentiques', 'Onboarding en moins de 5 minutes',
    'Quel rôle pour la voix dans l’intake ?'],
  lead: ['PRD : Fleex Intake', 'PRD : Budgets et alertes de coût', 'PRD : Vue Factory', 'PRD : Permissions par board',
    'PRD : Connecteur Gmail', 'PRD : Routines partagées', 'PRD : Revue de code par panel'],
  ops: ['Mettre à jour les dépendances', 'Rotation des clés API', 'Nettoyer les worktrees orphelins', 'Rapport hebdo des coûts',
    'Audit des migrations', 'Purger les sessions expirées', 'Bump du Claude Agent SDK', 'Vérifier les policies RLS']
};

var SOURCES = [
  { id: 'gmail',   name: 'Gmail',         perDay: 9,  mix: { fix: 0.3, build: 0.3, lead: 0.2, think: 0.2 } },
  { id: 'slack',   name: 'Slack',         perDay: 14, mix: { fix: 0.5, build: 0.2, ops: 0.2, think: 0.1 } },
  { id: 'meet',    name: 'Meeting notes', perDay: 6,  mix: { think: 0.35, lead: 0.35, build: 0.3 } },
  { id: 'github',  name: 'GitHub',        perDay: 12, mix: { fix: 0.55, build: 0.35, ops: 0.1 } },
  { id: 'linear',  name: 'Linear',        perDay: 10, mix: { build: 0.6, fix: 0.25, lead: 0.15 } },
  { id: 'routine', name: 'Routines',      perDay: 5,  mix: { ops: 0.8, fix: 0.2 }, flat: true },
  { id: 'cli',     name: 'CLI · MCP',     perDay: 4,  mix: { build: 0.5, think: 0.3, ops: 0.2 } },
  { id: 'fleex',   name: 'Sous-tickets',  perDay: 0,  mix: { build: 1 }, internal: true }
];

/* dur: minutes on Opus · cost: USD on Opus · check: share of the ticket's defect risk this step catches
   produces: the step (re)writes the artefact, so it sets the defect risk from its model. */
var WORKFLOWS = [
  { slug: 'ideation', name: 'Ideation', emoji: '💡', color: '#c084fc', hitl: true, output: 'prd',
    desc: 'Explorer une idée, la challenger en panel, rédiger un PR-FAQ, puis choisir une direction.', steps: [
    { name: 'Explore',        exec: 'agent', ref: 'the-explorer', mode: 'plan', model: 'claude-opus-5-5', dur: 16, cost: 1.3, pQuestion: 0.08 },
    { name: 'Challenge',      exec: 'panel', ref: 'les-big-tech', mode: 'talk', model: 'claude-opus-5-5', dur: 14, cost: 2.6 },
    { name: 'PR-FAQ',         exec: 'skill', ref: 'pr-faq',       mode: 'edit', model: 'claude-sonnet-5-5', dur: 10, cost: 2.0, produces: true },
    { name: 'Pick direction', exec: 'human_gate', outcomes: ['approve', 'request_changes', 'reject'], pReject: 0.14, review: [5, 11] }
  ], rework: [{ from: 3, to: 2, side: 'top', level: 1 }] },

  { slug: 'specification', name: 'Specification', emoji: '📐', color: '#facc15', hitl: true, output: 'spec',
    desc: 'Structurer un PRD, écrire la spec, la faire relire, la valider, puis créer les tickets.', steps: [
    { name: 'Structure PRD',  exec: 'skill', ref: 'structure-prd', mode: 'edit', model: 'claude-sonnet-5-5', dur: 8, cost: 1.1 },
    { name: 'Spec',           exec: 'agent', ref: 'the-architect', mode: 'edit', model: 'claude-opus-5-5', dur: 20, cost: 1.9, pQuestion: 0.1, produces: true },
    { name: 'Review spec',    exec: 'panel', ref: 'les-big-tech',  mode: 'talk', model: 'claude-opus-5-5', dur: 12, cost: 2.2, check: 0.9 },
    { name: 'Validate spec',  exec: 'human_gate', outcomes: ['approve', 'request_changes', 'reject'], pReject: 0.04, review: [6, 12] },
    { name: 'Create tickets', exec: 'native', ref: 'ticket.create · forEach', dur: 1, cost: 0, fanout: [2, 3] }
  ], rework: [{ from: 2, to: 1, side: 'top', level: 1 }, { from: 3, to: 1, side: 'bottom', level: 1 }] },

  { slug: 'feature-delivery', name: 'Feature Delivery', emoji: '🏭', color: '#60a5fa', hitl: true, output: 'code',
    desc: 'Plan, développement, revue et QA, avec deux validations humaines.', steps: [
    { name: 'Plan',           exec: 'agent', ref: 'the-architect', mode: 'plan', model: 'claude-opus-5-5', dur: 12, cost: 1.0, pQuestion: 0.08, produces: true },
    { name: 'Plan review',    exec: 'human_gate', outcomes: ['approve', 'request_changes'], pReject: 0, review: [3, 7] },
    { name: 'Development',    exec: 'agent', ref: 'jeff-bezos',    mode: 'edit', model: 'claude-opus-5-5', dur: 40, cost: 5.5, pQuestion: 0.05, pFail: 0.03, produces: true },
    { name: 'Code Review',    exec: 'panel', ref: 'les-big-tech',  mode: 'plan', model: 'claude-opus-5-5', dur: 12, cost: 2.0, check: 0.75 },
    { name: 'QA',             exec: 'agent', ref: 'the-tester',    mode: 'edit', model: 'claude-sonnet-5-5', dur: 14, cost: 2.4, check: 0.75, pFail: 0.02 },
    { name: 'PR review',      exec: 'human_gate', outcomes: ['approve', 'request_changes'], pReject: 0, review: [5, 11] },
    { name: 'Merge',          exec: 'native', ref: 'ticket.set_status → done', dur: 1, cost: 0 }
  ], rework: [{ from: 1, to: 0, side: 'top', level: 1 }, { from: 3, to: 2, side: 'top', level: 1 },
              { from: 4, to: 2, side: 'top', level: 2 }, { from: 5, to: 2, side: 'bottom', level: 1 }] },

  { slug: 'feature-autopilot', name: 'Feature Autopilot', emoji: '🤖', color: '#4ade80', hitl: false, output: 'code',
    desc: 'La même chaîne sans validation humaine : tout repose sur la revue et la QA automatiques.', steps: [
    { name: 'Plan',           exec: 'agent', ref: 'the-architect', mode: 'plan', model: 'claude-sonnet-5-5', dur: 11, cost: 1.1, produces: true },
    { name: 'Development',    exec: 'agent', ref: 'jeff-bezos',    mode: 'edit', model: 'claude-opus-5-5', dur: 30, cost: 4.0, pFail: 0.03, produces: true },
    { name: 'Code Review',    exec: 'agent', ref: 'the-reviewer',  mode: 'plan', model: 'claude-sonnet-5-5', dur: 11, cost: 1.8, check: 0.7 },
    { name: 'QA',             exec: 'agent', ref: 'the-tester',    mode: 'edit', model: 'claude-sonnet-5-5', dur: 14, cost: 2.2, check: 0.75, pFail: 0.02 },
    { name: 'Merge',          exec: 'native', ref: 'ticket.set_status → done', dur: 1, cost: 0 }
  ], rework: [{ from: 2, to: 1, side: 'top', level: 1 }, { from: 3, to: 1, side: 'top', level: 2 }] },

  { slug: 'bugfix', name: 'Bugfix', emoji: '🐛', color: '#f87171', hitl: false, output: 'code',
    desc: 'Reproduire, corriger, vérifier, merger. Aucune validation humaine.', steps: [
    { name: 'Reproduce',      exec: 'agent', ref: 'the-sentinel', mode: 'plan', model: 'claude-sonnet-5-5', dur: 12, cost: 1.6, pQuestion: 0.07, pFail: 0.03 },
    { name: 'Fix',            exec: 'agent', ref: 'jeff-bezos',   mode: 'edit', model: 'claude-opus-5-5', dur: 18, cost: 2.2, produces: true },
    { name: 'QA',             exec: 'agent', ref: 'the-tester',   mode: 'edit', model: 'claude-sonnet-5-5', dur: 14, cost: 2.2, check: 0.8 },
    { name: 'Merge',          exec: 'native', ref: 'ticket.set_status → done', dur: 1, cost: 0 }
  ], rework: [{ from: 2, to: 1, side: 'top', level: 1 }] }
];

var LAY = { W: 69, H: 42, srcX: 1, srcW: 3, srcH: 2.4, collX: 5.5, triX: 7.5, busX: 13.5, st0: 16.5, pitch: 7, sw: 4, sh: 3,
  dockX: 64.5, dockW: 3.5, laneY: [4.5, 12.5, 20.5, 28.5, 36.5], srcY: [2.5, 7, 11.5, 16, 25, 29.5, 34, 38.5], reach: 0.7 };

/* ---------- helpers ---------- */
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

/* ---------- belt segment ---------- */
function Seg(pts, kind) {
  this.pts = pts; this.kind = kind || 'main';
  this.cum = [0];
  for (var i = 1; i < pts.length; i++) {
    this.cum.push(this.cum[i - 1] + Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]));
  }
  this.len = this.cum[this.cum.length - 1];
  this.items = [];             // items[0] is the head (closest to the end)
  this.sink = null;            // {kind:'seg', pick} | {kind:'port', port} | {kind:'dock', lane}
  this.flow = null;            // hourly ring, set by the sim
  this.station = null;         // downstream station, for overlays
}
Seg.prototype.canEnter = function () {
  var n = this.items.length;
  return n === 0 || this.items[n - 1].d >= GAP;
};
Seg.prototype.push = function (t) { this.items.push({ t: t, d: 0 }); t.loc = this; };
Seg.prototype.head = function () {
  var h = this.items[0];
  return h && h.d >= this.len - 1e-6 ? h : null;
};
Seg.prototype.at = function (d, out) {
  var c = this.cum, p = this.pts, i = 1;
  d = clamp(d, 0, this.len);
  while (i < c.length - 1 && c[i] < d) i++;
  var l = c[i] - c[i - 1], f = l ? (d - c[i - 1]) / l : 0;
  out.x = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f;
  out.y = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f;
  return out;
};

/* ---------- simulation ---------- */
function Sim(seed) {
  this.rnd = rng32(seed || 20261114);
  this.now = 0;                // minutes since Monday 00:00
  this.hourIdx = 0;
  this.rings = [];
  this.segs = []; this.stations = []; this.lanes = []; this.sources = []; this.inserters = []; this.ports = [];
  this.tickets = new Map();    // active tickets
  this.recent = [];            // last shipped / cancelled
  this.drones = []; this.fx = []; this.events = []; this.log = [];
  this.seq = 1040;
  this.pool = { max: 10, used: 0, fullMin: this.ring(), usedMin: this.ring(), x: 8, y: 25.6, w: 3, h: 2.6 };
  this.g = { inn: this.ring(), out: this.ring(), cost: this.ring(), escapes: this.ring(), scrapped: this.ring(), human: this.ring(), wip: this.ring() };
  this.op = { x: 9.5, y: 17.2, hx: 9.5, hy: 17.2, state: 'home', item: null, left: 0, total: 1, enabled: true, awayUntil: 0, handled: this.ring(),
    hut: { x: 8, y: 14.3, w: 3, h: 2.2 } };
  this.outageUntil = 0;
  this.ships = [];             // last shipped summaries, newest last
  this.session = { t0: 0, shipped: 0, zeroFocusSince: -1, ldStreak: 0, noEscapeSince: 0 };
  this.objectives = [];
  this.build();
  this.initObjectives();
}

Sim.prototype.ring = function () { var r = new Float64Array(RING); this.rings.push(r); return r; };
Sim.prototype.add = function (r, v) { r[this.hourIdx % RING] += v; };
Sim.prototype.sum = function (r, hours) {
  var s = 0, n = Math.min(hours, RING, this.hourIdx + 1);
  for (var i = 0; i < n; i++) s += r[(this.hourIdx - i + RING * 4) % RING];
  return s;
};
/* elapsed span, in hours, actually covered by the last `hours` buckets */
Sim.prototype.span = function (hours) {
  var frac = (this.now % 60) / 60;
  return Math.max(0.25, Math.min(hours - 1 + frac, this.now / 60));
};
Sim.prototype.series = function (r, hours) {
  var out = [];
  for (var i = hours - 1; i >= 0; i--) { var k = this.hourIdx - i; out.push(k < 0 ? 0 : r[(k + RING * 4) % RING]); }
  return out;
};
Sim.prototype.hourOfDay = function () { return (this.now % DAY) / 60; };
Sim.prototype.clock = function () {
  var d = Math.floor(this.now / DAY), m = Math.floor(this.now % DAY);
  var names = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  return { day: d + 1, dow: names[d % 7], hh: Math.floor(m / 60), mm: m % 60 };
};

/* ---------- layout ---------- */
Sim.prototype.seg = function (pts, kind) {
  var s = new Seg(pts, kind); s.flow = this.ring(); s.id = this.segs.length; this.segs.push(s); return s;
};
Sim.prototype.newStation = function (def, x, y, lane, idx) {
  var st = { id: this.stations.length, def: def, name: def.name, exec: def.exec, x: x, y: y, w: LAY.sw, h: LAY.sh, lane: lane, idx: idx,
    model: def.model || null, policy: def.exec === 'human_gate' ? 'human' : null,
    cells: [], rack: [], outMain: [], links: [], inPorts: [], outSeg: null, inSeg: null, starved: 0,
    h_: { done: this.ring(), inn: this.ring(), cost: this.ring(), busy: this.ring(), slotWait: this.ring(), humanWait: this.ring(),
      ko: this.ring(), touches: this.ring(), auto: this.ring() } };
  st.cx = x + st.w / 2; st.cy = y + st.h / 2;
  this.stations.push(st);
  return st;
};
Sim.prototype.armPort = function (st, seg) {
  var R = LAY.reach;
  seg.station = st;
  var ins = { kind: 'in', st: st, seg: seg, bx: st.x - R / 2, by: st.cy - 0.85, ax: st.x - R, ay: st.cy, zx: st.x + 0.4, zy: st.cy, p: 0, state: 'rest', t: null };
  var port = { st: st, seg: seg, ins: ins };
  seg.sink = { kind: 'port', port: port };
  st.inPorts.push(port); st.inSeg = seg; this.ports.push(port); this.inserters.push(ins);
};
Sim.prototype.armOut = function (st, seg) {
  var R = LAY.reach;
  var ins = { kind: 'out', st: st, seg: seg, bx: st.x + st.w + R / 2, by: st.cy + 0.85, ax: st.x + st.w - 0.4, ay: st.cy, zx: st.x + st.w + R, zy: st.cy, p: 0, state: 'rest', t: null };
  st.outSeg = seg; st.outIns = ins; this.inserters.push(ins);
};

Sim.prototype.build = function () {
  var self = this, L = LAY, mid = L.laneY[2], R = L.reach;

  /* triage */
  var tri = this.newStation({ name: 'Triage', exec: 'agent', ref: 'the-sentinel', mode: 'plan', model: 'claude-haiku-5-5', dur: 2.2, cost: 0.9, router: true },
    L.triX, mid - 1.5, null, -1);
  this.triage = tri;
  var feed = this.seg([[L.collX, mid], [tri.x - R, mid]]);
  this.armPort(tri, feed);
  var triOut = this.seg([[tri.x + tri.w + R, mid], [L.busX, mid]]);
  this.armOut(tri, triOut);

  /* intake dock: sources feed two collector chains that meet in front of the triage */
  var ys = L.srcY, chainTop = [], chainBot = [];
  SOURCES.forEach(function (def, i) {
    var src = { id: def.id, def: def, name: def.name, x: L.srcX, y: ys[i] - L.srcH / 2, w: L.srcW, h: L.srcH, cy: ys[i],
      perDay: def.perDay, on: true, buffer: [], acc: 0, emitted: self.ring(), internal: !!def.internal, seg: null };
    self.sources.push(src);
  });
  function chain(idxs) {
    var prev = null;
    idxs.forEach(function (i, k) {
      var src = self.sources[i], nextY = k < idxs.length - 1 ? ys[idxs[k + 1]] : mid;
      var side, trunk;
      if (k === 0) {
        side = self.seg([[L.srcX + L.srcW, ys[i]], [L.collX, ys[i]], [L.collX, nextY]]);
        trunk = side;
      } else {
        side = self.seg([[L.srcX + L.srcW, ys[i]], [L.collX, ys[i]]]);
        trunk = self.seg([[L.collX, ys[i]], [L.collX, nextY]]);
        (function (tr) { side.sink = { kind: 'seg', pick: function () { return tr; } }; prev.sink = { kind: 'seg', pick: function () { return tr; } }; })(trunk);
      }
      src.seg = side; prev = trunk;
    });
    prev.sink = { kind: 'seg', pick: function () { return feed; } };
  }
  chain([0, 1, 2, 3]); chain([7, 6, 5, 4]);

  /* distribution bus */
  var entry = [];
  WORKFLOWS.forEach(function (wf, l) {
    entry[l] = self.seg([[L.busX, L.laneY[l]], [L.st0 - R, L.laneY[l]]]);
  });
  var up1 = this.seg([[L.busX, mid], [L.busX, L.laneY[1]]]);
  var up2 = this.seg([[L.busX, L.laneY[1]], [L.busX, L.laneY[0]]]);
  var dn1 = this.seg([[L.busX, mid], [L.busX, L.laneY[3]]]);
  var dn2 = this.seg([[L.busX, L.laneY[3]], [L.busX, L.laneY[4]]]);
  triOut.sink = { kind: 'seg', pick: function (t) { return t.lane === 2 ? entry[2] : t.lane < 2 ? up1 : dn1; } };
  up1.sink = { kind: 'seg', pick: function (t) { return t.lane === 1 ? entry[1] : up2; } };
  up2.sink = { kind: 'seg', pick: function () { return entry[0]; } };
  dn1.sink = { kind: 'seg', pick: function (t) { return t.lane === 3 ? entry[3] : dn2; } };
  dn2.sink = { kind: 'seg', pick: function () { return entry[4]; } };
  this.bus = [up1, up2, dn1, dn2, triOut, feed];

  /* lanes */
  WORKFLOWS.forEach(function (wf, l) {
    var y = L.laneY[l];
    var lane = { idx: l, wf: wf, y: y, x: L.st0 - 1.6, w: L.dockX - 0.6 - (L.st0 - 1.6), top: y - 3.85, h: 7.5, stations: [], shipped: self.ring(), cost: self.ring(), leads: [], scrapped: 0, entry: entry[l] };
    self.lanes.push(lane);
    var inSeg = entry[l];
    wf.steps.forEach(function (def, k) {
      var st = self.newStation(def, L.st0 + k * L.pitch, y - L.sh / 2, lane, k);
      lane.stations.push(st);
      self.armPort(st, inSeg);
      var endX = k < wf.steps.length - 1 ? L.st0 + (k + 1) * L.pitch - R : L.dockX;
      var out = self.seg([[st.x + st.w + R, y], [endX, y]]);
      self.armOut(st, out);
      inSeg = out;
    });
    inSeg.sink = { kind: 'dock', lane: lane };
    lane.outSeg = inSeg;
    /* rework belts plug straight into the stations (no arm) */
    (wf.rework || []).forEach(function (rw) {
      var F = lane.stations[rw.from], T = lane.stations[rw.to];
      var top = rw.side === 'top', lift = 0.75 + 0.62 * rw.level;
      var yF = top ? F.y : F.y + F.h, yT = top ? T.y : T.y + T.h, yy = top ? F.y - lift : F.y + F.h + lift;
      var xF = F.cx + (rw.level === 2 ? 0.5 : -0.5), xT = T.cx + (rw.level === 2 ? -0.7 : 0.7);
      var seg = self.seg([[xF, yF], [xF, yy], [xT, yy], [xT, yT]], 'rework');
      seg.station = T;
      var port = { st: T, seg: seg, ins: null };
      seg.sink = { kind: 'port', port: port };
      T.inPorts.push(port); self.ports.push(port);
      F.links.push({ seg: seg, to: T, q: [], side: rw.side });
    });
  });
  this.dock = { x: L.dockX, y: 1.6, w: L.dockW, h: L.H - 3.2 };
};

/* ---------- tickets ---------- */
Sim.prototype.pickType = function (mix) {
  var r = this.rnd(), acc = 0;
  for (var k in mix) { acc += mix[k]; if (r < acc) return k; }
  return Object.keys(mix)[0];
};
Sim.prototype.makeTicket = function (src, type, title) {
  var r = this.rnd;
  type = type || this.pickType(src.def.mix);
  var list = TITLES[type], cx = [1, 2, 3, 5, 8, 13];
  var t = { id: ++this.seq, displayId: 'FLX-' + this.seq, type: type, title: title || list[Math.floor(r() * list.length)],
    source: src.id, sourceName: src.name, priority: r() < 0.08 ? 'urgent' : r() < 0.3 ? 'high' : r() < 0.75 ? 'medium' : 'low',
    complexity: cx[Math.floor(r() * r() * cx.length)], born: this.now, doneAt: 0, state: 'intake', triaged: false,
    lane: -1, wf: null, forceLane: -1, step: null, cost: 0, defect: 0.15, humanWait: 0, slotWait: 0, agentMin: 0, touches: 0, reworks: 0,
    att: {}, history: [], readyAt: this.now, blocked: 0, loc: null, x: src.x, y: src.cy };
  this.tickets.set(t.id, t);
  this.add(this.g.inn, 1);
  return t;
};
Sim.prototype.route = function (t) {
  if (t.forceLane >= 0) return t.forceLane;
  switch (t.type) {
    case 'think': return 0;
    case 'lead': return 1;
    case 'fix': return 4;
    case 'ops': return 3;
    default: return t.complexity >= 3 ? 2 : (this.rnd() < 0.3 ? 2 : 3);
  }
};

/* ---------- stations ---------- */
Sim.prototype.weight = function (st) { return st.exec === 'panel' ? 3 : 1; };
Sim.prototype.needsSlot = function (st) {
  if (st.skip) return 0;
  if (st.exec === 'agent' || st.exec === 'skill' || st.exec === 'panel') return this.weight(st);
  if (st.exec === 'human_gate' && st.policy === 'sampled') return 1;
  return 0;
};
Sim.prototype.canAccept = function (st) {
  var w = this.needsSlot(st);
  if (!w) return true;
  if (this.now < this.outageUntil) return false;
  return this.pool.used + w <= this.pool.max;
};
Sim.prototype.reserve = function (st, t) { var w = this.needsSlot(st); t._res = w; this.pool.used += w; };

Sim.prototype.receive = function (st, t) {
  var r = this.rnd, def = st.def;
  var wait = t.blocked || 0;
  t.blocked = 0;
  if (this.needsSlot(st) && wait > 0.7) { this.add(st.h_.slotWait, wait); t.slotWait += wait; } else wait = 0;
  t.step = st; t.loc = st; t.state = st === this.triage ? 'triage' : 'flow';
  t.att[st.id] = (t.att[st.id] || 0) + 1;
  this.add(st.h_.inn, 1);
  var w = t._res || 0; t._res = 0;
  var cell = { t: t, p: 0, dur: 1, cost: 0, state: 'running', w: w, since: this.now, started: this.now, wait: wait, spent: 0, qAt: 0, fAt: 0, attempt: t.att[st.id] };
  if (st.skip) { cell.state = 'stamp'; cell.dur = 0.3; cell.skipped = true; st.cells.push(cell); return; }
  if (def.exec === 'human_gate') {
    if (st.policy === 'human') { st.rack.push({ t: t, since: this.now, kind: 'gate', wait: wait }); return; }
    if (st.policy === 'sampled') { cell.state = 'judge'; cell.dur = 1.6; cell.cost = 0.12; }
    else { cell.state = 'stamp'; cell.dur = 0.35; }
    st.cells.push(cell); return;
  }
  if (def.exec === 'native') { cell.dur = def.dur; st.cells.push(cell); return; }
  var m = MODELS[st.model], again = cell.attempt > 1 ? 0.6 : 1, size = 0.75 + Math.min(t.complexity, 13) / 16;
  var noise = Math.exp((r() + r() + r() - 1.5) * 0.45);
  cell.dur = def.dur * m.speed * again * noise * (def.router ? 1 : size);
  cell.cost = def.cost * m.cost * again * noise * (def.router ? 1 : size) * (0.85 + 0.3 * r());
  if (def.pQuestion && r() < def.pQuestion) cell.qAt = 0.25 + r() * 0.5;
  if (def.pFail && r() < def.pFail) cell.fAt = 0.3 + r() * 0.6;
  st.cells.push(cell);
};

Sim.prototype.record = function (st, t, cell, result, humanWait) {
  t.history.push({ step: st.name, exec: st.exec, model: st.model, attempt: t.att[st.id] || 1, start: cell ? cell.started : this.now,
    dur: cell ? this.now - cell.started : 0, cost: cell ? cell.spent : 0, wait: cell ? cell.wait : 0, human: humanWait || 0,
    result: cell && cell.skipped ? 'skipped' : result });
  if (t.history.length > 40) t.history.shift();
};

/* a step run ended: 'ok' moves on, 'ko' takes the rework belt, 'cancelled' leaves the floor */
Sim.prototype.finish = function (st, t, result, cell, humanWait) {
  var def = st.def;
  this.record(st, t, cell, result, humanWait);
  t.readyAt = this.now;
  if (result === 'cancelled') {
    t.state = 'cancelled'; t.doneAt = this.now; this.tickets.delete(t.id);
    this.add(this.g.scrapped, 1); if (st.lane) st.lane.scrapped++;
    this.fx.push({ kind: 'scrap', x: st.x + st.w - 0.5, y: st.y + st.h + 0.5, t0: this.now, c: TYPES[t.type].color });
    this.recent.push(t); if (this.recent.length > 60) this.recent.shift();
    return;
  }
  this.add(st.h_.done, 1);
  if (result === 'ko' && st.links.length) {
    var link = st.links[0];
    this.add(st.h_.ko, 1); t.reworks++;
    link.q.push(t);
    return;
  }
  if (def.produces) {
    var m = MODELS[st.model];
    t.defect = m.defect * (0.6 + 0.8 * this.rnd()) * Math.pow(0.5, (t.att[st.id] || 1) - 1);
  }
  if (def.router) {
    t.triaged = true;
    t.lane = this.route(t); t.wf = WORKFLOWS[t.lane];
  }
  if (def.fanout) this.fanout(st, t);
  st.outMain.push(t);
};

Sim.prototype.fanout = function (st, t) {
  var n = t.bigFan ? 8 : def_rand(this.rnd, st.def.fanout), base = t.title.replace(/^PRD : /, ''), self = this, pad = this.sources[7];
  base = base.charAt(0).toUpperCase() + base.slice(1);
  for (var i = 0; i < n; i++) {
    (function (i) {
      self.drone(st.cx, st.y, pad.x + pad.w / 2, pad.cy, i * 0.8, '#60a5fa', function () {
        var nt = self.makeTicket(pad, 'build', base + ' · lot ' + (i + 1) + '/' + n);
        nt.forceLane = self.rnd() < 0.5 ? 2 : 3; nt.parent = t.displayId; nt.complexity = [2, 3, 5][Math.floor(self.rnd() * 3)];
        pad.buffer.push(nt);
      });
    })(i);
  }
  this.say('spawn', t.displayId + ' → ' + n + ' tickets créés (ticket.create)');
};
function def_rand(r, range) { return range[0] + Math.floor(r() * (range[1] - range[0] + 1)); }

Sim.prototype.drone = function (x0, y0, x1, y1, delay, color, cb) {
  var dist = Math.hypot(x1 - x0, y1 - y0);
  this.drones.push({ x0: x0, y0: y0, x1: x1, y1: y1, t: -delay, dur: Math.max(1.5, dist / 9), color: color, cb: cb, x: x0, y: y0 });
};

Sim.prototype.updateStation = function (st, dt) {
  var cells = st.cells, out = this.now < this.outageUntil;
  for (var i = cells.length - 1; i >= 0; i--) {
    var c = cells[i];
    if (c.state === 'question' || c.state === 'failed') continue;
    if (c.state === 'queued') {
      /* answered or retried: the run takes the next free slot */
      if (!this.canAccept(st)) continue;
      c.w = this.needsSlot(st); this.pool.used += c.w; c.state = 'running';
    }
    if (out && c.w) continue;
    var dp = Math.min(dt / c.dur, 1 - c.p);
    c.p += dp;
    if (c.cost) {
      var $ = c.cost * dp; c.spent += $; c.t.cost += $;
      this.add(st.h_.cost, $); this.add(this.g.cost, $); if (st.lane) this.add(st.lane.cost, $);
    }
    if (c.w) { this.add(st.h_.busy, dt * c.w); c.t.agentMin += dt; }
    if (c.qAt && c.p >= c.qAt) { c.qAt = 0; c.state = 'question'; c.since = this.now; this.pool.used -= c.w; c.w = 0; continue; }
    if (c.fAt && c.p >= c.fAt) { c.fAt = 0; c.state = 'failed'; c.since = this.now; this.pool.used -= c.w; c.w = 0; continue; }
    if (c.p >= 1 - 1e-9) {
      cells.splice(i, 1);
      this.pool.used -= c.w;
      var t = c.t, def = st.def;
      if (c.state === 'judge') {
        if (this.rnd() < clamp(1 - t.defect * 2.2, 0.15, 0.92)) { this.add(st.h_.auto, 1); this.finish(st, t, 'ok', c); }
        else st.rack.push({ t: t, since: this.now, kind: 'gate', wait: 0 });
      } else if (c.state === 'stamp') {
        this.add(st.h_.auto, 1); this.finish(st, t, 'ok', c);
      } else if (def.router && this.rnd() < 0.06) {
        t.lane = this.route(t);
        var alt = t.lane === 2 ? 3 : t.lane === 3 ? 2 : t.lane === 0 ? 1 : t.lane === 1 ? 0 : 3;
        this.record(st, t, c, 'awaiting_routing');
        st.rack.push({ t: t, since: this.now, kind: 'route', wait: 0, options: [t.lane, alt] });
      } else if (def.check && (t.att[st.id] || 1) <= 3 && this.rnd() < t.defect * def.check * 2.1) {
        this.finish(st, t, 'ko', c);
      } else {
        if (def.check) t.defect *= 0.45;
        this.finish(st, t, 'ok', c);
      }
    }
  }
};

/* ---------- human interventions (the Focus queue) ---------- */
Sim.prototype.focus = function () {
  var out = [], now = this.now;
  for (var i = 0; i < this.stations.length; i++) {
    var st = this.stations[i];
    for (var j = 0; j < st.rack.length; j++) {
      var e = st.rack[j];
      out.push({ key: e.t.id + ':' + st.id, kind: e.kind === 'route' ? 'route' : 'gate', st: st, t: e.t, since: e.since, age: now - e.since, entry: e });
    }
    for (var k = 0; k < st.cells.length; k++) {
      var c = st.cells[k];
      if (c.state === 'question' || c.state === 'failed') {
        out.push({ key: c.t.id + ':' + st.id, kind: c.state === 'failed' ? 'error' : 'question', st: st, t: c.t, since: c.since, age: now - c.since, cell: c });
      }
    }
  }
  out.sort(function (a, b) { return a.since - b.since; });
  return out;
};
Sim.prototype.focusValid = function (it) {
  if (!it) return false;
  if (it.entry) return it.st.rack.indexOf(it.entry) >= 0;
  return it.st.cells.indexOf(it.cell) >= 0 && (it.cell.state === 'question' || it.cell.state === 'failed');
};
/* action: approve | request_changes | reject | answer | retry | route:<lane> */
Sim.prototype.resolve = function (it, action, byOperator) {
  if (!this.focusValid(it)) return false;
  var st = it.st, t = it.t, wait = this.now - it.since;
  this.add(st.h_.humanWait, wait); this.add(st.h_.touches, 1); this.add(this.g.human, wait);
  t.humanWait += wait; t.touches++;
  if (!byOperator && this.op.item && this.op.item.key === it.key) { this.op.item = null; this.op.state = 'idle'; }
  if (it.entry) {
    st.rack.splice(st.rack.indexOf(it.entry), 1);
    if (it.kind === 'route') {
      var lane = action.indexOf('route:') === 0 ? +action.slice(6) : it.entry.options[0];
      t.forceLane = lane;
      this.finish(st, t, 'ok', null, wait);
      return true;
    }
    if (action === 'reject') { this.finish(st, t, 'cancelled', null, wait); return true; }
    if (action === 'request_changes' && st.links.length) { this.finish(st, t, 'ko', null, wait); return true; }
    t.defect *= 0.35;
    this.finish(st, t, 'ok', null, wait);
    return true;
  }
  var c = it.cell;
  if (c.state === 'failed') { c.p = 0; c.attempt++; t.att[st.id]++; }
  c.state = 'queued';
  return true;
};

Sim.prototype.opAvailable = function () {
  var h = this.hourOfDay();
  return this.op.enabled && this.now >= this.op.awayUntil && ((h >= 9 && h < 12.5) || (h >= 13.5 && h < 18.5));
};
Sim.prototype.updateOperator = function (dt) {
  var op = this.op, avail = this.opAvailable();
  if (!avail) {
    op.item = null;
    var d0 = Math.hypot(op.hx - op.x, op.hy - op.y);
    if (d0 > 0.05) { var s0 = Math.min(1, 10 * dt / d0); op.x += (op.hx - op.x) * s0; op.y += (op.hy - op.y) * s0; op.state = 'walk'; }
    else op.state = 'away';
    return;
  }
  if (op.state === 'away' || op.state === 'home') op.state = 'idle';
  if (op.item && !this.focusValid(op.item)) { op.item = null; op.state = 'idle'; }
  if (op.state === 'idle') {
    var list = this.focus();
    if (!list.length) {
      var dh = Math.hypot(op.hx - op.x, op.hy - op.y);
      if (dh > 0.05) { var sh = Math.min(1, 10 * dt / dh); op.x += (op.hx - op.x) * sh; op.y += (op.hy - op.y) * sh; }
      return;
    }
    /* questions and errors first: they hold an agent back; then the oldest gate */
    var pick = null;
    for (var i = 0; i < list.length; i++) { if (list[i].kind === 'question' || list[i].kind === 'error') { pick = list[i]; break; } }
    op.item = pick || list[0]; op.state = 'walk';
  }
  var it = op.item, tx = it.st.cx, ty = it.st.y + it.st.h + 0.75;
  if (op.state === 'walk') {
    var d = Math.hypot(tx - op.x, ty - op.y);
    if (d > 0.05) { var s = Math.min(1, 10 * dt / d); op.x += (tx - op.x) * s; op.y += (ty - op.y) * s; return; }
    var r = this.rnd, rv = it.st.def.review || [3, 6];
    op.total = it.kind === 'gate' ? rv[0] + r() * (rv[1] - rv[0]) : it.kind === 'question' ? 2 + r() * 3 : it.kind === 'route' ? 1 : 1.5;
    op.left = op.total; op.state = 'work';
    return;
  }
  if (op.state === 'work') {
    op.left -= dt;
    if (op.left > 0) return;
    var action = 'approve', def = it.st.def, rr = this.rnd();
    if (it.kind === 'gate') {
      if (rr < (def.pReject || 0)) action = 'reject';
      else if (it.st.links.length && rr < (def.pReject || 0) + 0.05 + it.t.defect * 0.9) action = 'request_changes';
    } else if (it.kind === 'question') action = 'answer';
    else if (it.kind === 'error') action = 'retry';
    else action = 'route:' + it.entry.options[0];
    this.resolve(it, action, true);
    this.add(op.handled, 1);
    op.item = null; op.state = 'idle';
  }
};

/* ---------- shipping ---------- */
Sim.prototype.ship = function (lane, t) {
  t.state = 'done'; t.doneAt = this.now; t.loc = null;
  this.tickets.delete(t.id);
  this.add(lane.shipped, 1); this.add(this.g.out, 1);
  var s = { lane: lane.idx, lead: this.now - t.born, human: t.humanWait, slot: t.slotWait, agent: t.agentMin, touches: t.touches, cost: t.cost, reworks: t.reworks, at: this.now };
  lane.leads.push(s); if (lane.leads.length > 80) lane.leads.shift();
  this.ships.push(s); if (this.ships.length > 160) this.ships.shift();
  this.recent.push(t); if (this.recent.length > 60) this.recent.shift();
  this.session.shipped++;
  if (lane.idx === 2) this.session.ldStreak = t.touches === 0 ? this.session.ldStreak + 1 : 0;
  this.fx.push({ kind: 'ship', x: LAY.dockX + 0.6, y: lane.y, t0: this.now, c: lane.wf.color });
  var self = this, r = this.rnd;
  if (lane.wf.slug === 'ideation' && r() < 0.4) {
    var pad = this.sources[7], title = 'PRD : ' + t.title.replace(/ \?$/, '').replace(/^(Faut-il|Explorer|Une|Quel rôle pour) /, '');
    this.drone(LAY.dockX + 1, lane.y, pad.x + pad.w / 2, pad.cy, 0, '#facc15', function () {
      var nt = self.makeTicket(pad, 'lead', title.charAt(0).toUpperCase() + title.slice(1)); nt.parent = t.displayId; pad.buffer.push(nt);
    });
  }
  /* a defect that slipped through comes back later as a bug */
  if (lane.wf.output === 'code' && r() < t.defect * 0.55) {
    this.events.push({ at: this.now + 60 + r() * 240, fn: function () {
      var src = self.sources[r() < 0.6 ? 1 : 3];
      var nt = self.makeTicket(src, 'fix', 'Régression : ' + t.title.replace(/^Régression : /, ''));
      nt.parent = t.displayId; nt.priority = 'high'; src.buffer.push(nt);
      self.add(self.g.escapes, 1); self.session.noEscapeSince = self.now;
      self.say('escape', 'Défaut échappé sur ' + t.displayId + ' → ' + nt.displayId);
    } });
  }
};

Sim.prototype.say = function (kind, text) {
  this.log.push({ at: this.now, kind: kind, text: text });
  if (this.log.length > 60) this.log.shift();
};

/* ---------- main step ---------- */
Sim.prototype.step = function (dt) {
  var i, j, self = this;
  this.now += dt;
  var hi = Math.floor(this.now / 60);
  while (hi > this.hourIdx) {
    this.hourIdx++;
    var b = this.hourIdx % RING;
    for (i = 0; i < this.rings.length; i++) this.rings[i][b] = 0;
  }

  /* intake */
  var curve = dayCurve(this.hourOfDay());
  for (i = 0; i < this.sources.length; i++) {
    var src = this.sources[i];
    if (src.on && src.perDay > 0) {
      src.acc += dt * src.perDay / DAY * (src.def.flat ? 1 : curve);
      if (src.acc > 0 && this.rnd() < src.acc) { src.acc -= 1; src.buffer.push(this.makeTicket(src)); if (src.acc < -1) src.acc = -1; }
    }
    if (src.buffer.length && src.seg.canEnter()) {
      var nt = src.buffer.shift(); nt.readyAt = this.now; src.seg.push(nt); this.add(src.emitted, 1);
    }
  }
  /* scheduled events */
  for (i = this.events.length - 1; i >= 0; i--) {
    if (this.events[i].at <= this.now) { var ev = this.events[i]; this.events.splice(i, 1); ev.fn(); }
  }

  /* belts */
  var adv = BELT_V * dt;
  for (i = 0; i < this.segs.length; i++) {
    var sg = this.segs[i], items = sg.items, lim = sg.len;
    for (j = 0; j < items.length; j++) {
      var it = items[j];
      var nd = Math.min(it.d + adv, lim);
      if (nd - it.d < adv * 0.5) it.t.blocked += dt;
      it.d = nd;
      lim = nd - GAP;
    }
    var hd = items[0];
    if (hd && hd.d >= sg.len - 1e-6 && sg.sink) {
      var sk = sg.sink;
      if (sk.kind === 'seg') {
        var tg = sk.pick(hd.t);
        if (tg.canEnter()) { items.shift(); tg.push(hd.t); this.add(sg.flow, 1); }
      } else if (sk.kind === 'dock') {
        items.shift(); this.add(sg.flow, 1); this.ship(sk.lane, hd.t);
      }
    }
  }

  /* input ports: first come, first served across the whole floor (the SDK concurrency limiter) */
  var waiting = [];
  for (i = 0; i < this.ports.length; i++) {
    var p = this.ports[i], h = p.seg.head();
    p.st.starved = 0;
    if (h && (!p.ins || p.ins.state === 'rest')) waiting.push(p);
  }
  waiting.sort(function (a, b) { return a.seg.items[0].t.readyAt - b.seg.items[0].t.readyAt; });
  for (i = 0; i < waiting.length; i++) {
    var pt = waiting[i], st = pt.st, tk = pt.seg.items[0].t;
    if (!this.canAccept(st)) { st.starved++; continue; }
    pt.seg.items.shift(); this.add(pt.seg.flow, 1);
    this.reserve(st, tk);
    if (pt.ins) { pt.ins.t = tk; pt.ins.state = 'carry'; tk.loc = pt.ins; }
    else this.receive(st, tk);
  }
  /* count every waiting ticket behind a starved head as queued for a slot */
  for (i = 0; i < this.ports.length; i++) {
    var pp = this.ports[i];
    if (pp.st.starved) {
      var its = pp.seg.items;
      for (j = 1; j < its.length; j++) { if (its[j].d >= its[j - 1].d - GAP - 0.02) pp.st.starved++; else break; }
    }
  }

  /* arms */
  var dp = dt / SWING;
  for (i = 0; i < this.inserters.length; i++) {
    var a = this.inserters[i];
    if (a.state === 'carry') {
      a.p += dp;
      if (a.p >= 1) {
        a.p = 1;
        if (a.kind === 'in') { this.receive(a.st, a.t); a.t = null; a.state = 'back'; }
        else if (a.seg.canEnter()) { a.seg.push(a.t); a.t = null; a.state = 'back'; }
      }
    } else if (a.state === 'back') {
      a.p -= dp; if (a.p <= 0) { a.p = 0; a.state = 'rest'; }
    } else if (a.kind === 'out' && a.st.outMain.length && a.seg.canEnter()) {
      a.t = a.st.outMain.shift(); a.t.loc = a; a.state = 'carry';
    }
  }

  /* stations */
  for (i = 0; i < this.stations.length; i++) {
    var s = this.stations[i];
    this.updateStation(s, dt);
    for (j = 1; j < s.outMain.length; j++) s.outMain[j].blocked += dt;
    for (j = 0; j < s.links.length; j++) {
      var lk = s.links[j];
      if (lk.q.length && lk.seg.canEnter()) lk.seg.push(lk.q.shift());
    }
  }

  this.updateOperator(dt);

  /* drones */
  for (i = this.drones.length - 1; i >= 0; i--) {
    var d = this.drones[i];
    d.t += dt;
    var f = clamp(d.t / d.dur, 0, 1), e = f * f * (3 - 2 * f);
    d.x = d.x0 + (d.x1 - d.x0) * e; d.y = d.y0 + (d.y1 - d.y0) * e; d.f = f;
    if (d.t >= d.dur) { this.drones.splice(i, 1); d.cb(); }
  }
  while (this.fx.length && this.now - this.fx[0].t0 > 3) this.fx.shift();

  /* accumulators */
  this.add(this.pool.usedMin, dt * this.pool.used);
  if (this.pool.used >= this.pool.max) this.add(this.pool.fullMin, dt);
  this.add(this.g.wip, dt * this.tickets.size);
  this.tickObjectives(dt);
};

/* ---------- player levers ---------- */
Sim.prototype.setModel = function (st, model) { if (MODELS[model]) st.model = model; };
Sim.prototype.setPolicy = function (st, policy) {
  if (st.exec !== 'human_gate') return;
  st.policy = policy;
  if (policy === 'human') return;
  /* re-run what is already on the rack through the new policy */
  var rack = st.rack.filter(function (e) { return e.kind === 'gate'; });
  for (var i = 0; i < rack.length; i++) {
    var e = rack[i];
    if (policy === 'auto' || this.rnd() < clamp(1 - e.t.defect * 2.2, 0.15, 0.92)) {
      st.rack.splice(st.rack.indexOf(e), 1);
      var w = this.now - e.since; this.add(st.h_.humanWait, w); e.t.humanWait += w; this.add(st.h_.auto, 1);
      this.finish(st, e.t, 'ok', null, w);
    }
  }
};
Sim.prototype.canSkip = function (st) { var d = st.def; return !d.produces && !d.router && d.exec !== 'native' && d.exec !== 'human_gate'; };
Sim.prototype.setConcurrency = function (n) { this.pool.max = clamp(Math.round(n), 2, 32); };
Sim.prototype.inject = function (sourceId, type, title) {
  var src = this.sources.filter(function (s) { return s.id === sourceId; })[0] || this.sources[6];
  var t = this.makeTicket(src, type, title);
  src.buffer.push(t);
  return t;
};
Sim.prototype.scenario = function (name) {
  var self = this, r = this.rnd, i;
  if (name === 'incident') {
    for (i = 0; i < 12; i++) {
      (function (i) { self.events.push({ at: self.now + i * 1.6 + r(), fn: function () {
        var t = self.inject(i % 3 === 0 ? 'github' : 'slack', 'fix'); t.priority = 'urgent';
      } }); })(i);
    }
    this.say('alert', 'Incident prod : 12 bugs arrivent de Slack et GitHub');
  } else if (name === 'meeting') {
    this.op.awayUntil = this.now + 120;
    this.say('alert', 'Opérateur en réunion pendant 2 h');
  } else if (name === 'prd') {
    var t = this.inject('meet', 'lead', 'PRD : Refonte de l’onboarding'); t.bigFan = true;
    this.say('info', 'Gros PRD injecté depuis Meeting notes');
  } else if (name === 'outage') {
    this.outageUntil = this.now + 30;
    this.say('alert', 'Panne API : les agents sont à l’arrêt pendant 30 min');
  }
};

/* ---------- read models ---------- */
Sim.prototype.kpis = function () {
  var self = this, W = 6, sp = this.span(W), f = this.focus();
  var out6 = this.sum(this.g.out, W), ships = this.ships.slice(-60);
  var frac = (this.now % 60) / 60, cur = this.g.cost[this.hourIdx % RING], prev = this.hourIdx > 0 ? this.g.cost[(this.hourIdx - 1) % RING] : 0;
  var hod = Math.floor(this.hourOfDay());
  var k = {
    shipped24: this.sum(this.g.out, 24), perHour: out6 / sp, in6: this.sum(this.g.inn, W) / sp,
    wip: this.tickets.size,
    lead: median(ships.map(function (s) { return s.lead; })),
    autonomy: ships.length ? ships.filter(function (s) { return s.touches === 0; }).length / ships.length : 0,
    costPerTicket: ships.length ? ships.reduce(function (a, s) { return a + s.cost; }, 0) / ships.length : 0,
    burn: cur + prev * (1 - frac), costToday: this.sum(this.g.cost, hod + 1),
    focus: f.length, oldest: f.length ? f[0].age : 0,
    poolUsed: this.pool.used, poolMax: this.pool.max, saturation: this.sum(this.pool.fullMin, W) / (sp * 60),
    escapes24: this.sum(this.g.escapes, 24), scrapped24: this.sum(this.g.scrapped, 24),
    opState: this.op.state, opAvailable: this.opAvailable(), outage: this.now < this.outageUntil
  };
  var done = 0, ko = 0;
  this.stations.forEach(function (st) { if (st.def.check) { done += self.sum(st.h_.done, 12); ko += self.sum(st.h_.ko, 12); } });
  k.fpy = done ? 1 - ko / done : 1;
  return k;
};
Sim.prototype.stationStats = function (st, W) {
  W = W || 12;
  var sp = this.span(W), done = this.sum(st.h_.done, W), cost = this.sum(st.h_.cost, W), now = this.now;
  var hw = this.sum(st.h_.humanWait, W), waitingNow = 0, oldest = 0;
  st.rack.forEach(function (e) { waitingNow++; hw += now - e.since; oldest = Math.max(oldest, now - e.since); });
  st.cells.forEach(function (c) { if (c.state === 'question' || c.state === 'failed') { waitingNow++; hw += now - c.since; oldest = Math.max(oldest, now - c.since); } });
  var touches = this.sum(st.h_.touches, W);
  return { done: done, perHour: done / sp, cost: cost, costPer: done ? cost / done : 0, busy: this.sum(st.h_.busy, W),
    avgRun: done ? this.sum(st.h_.busy, W) / this.weight(st) / done : 0,
    slotWait: this.sum(st.h_.slotWait, W), humanWait: hw, waitingNow: waitingNow, oldest: oldest,
    avgHuman: touches + waitingNow ? hw / (touches + waitingNow) : 0,
    ko: this.sum(st.h_.ko, W), koRate: done ? this.sum(st.h_.ko, W) / done : 0, auto: this.sum(st.h_.auto, W), touches: touches,
    running: st.cells.filter(function (c) { return c.state === 'running' || c.state === 'judge'; }).length, starved: st.starved };
};
Sim.prototype.laneStats = function (lane) {
  var l = lane.leads.slice(-40), n = l.length || 1;
  function avg(k) { return l.reduce(function (a, s) { return a + s[k]; }, 0) / n; }
  return { shipped24: this.sum(lane.shipped, 24), lead: median(l.map(function (s) { return s.lead; })), cost: avg('cost'),
    autonomy: l.length ? l.filter(function (s) { return s.touches === 0; }).length / l.length : 0,
    agent: avg('agent'), human: avg('human'), slot: avg('slot'), reworks: avg('reworks'), n: l.length,
    wip: Array.from(this.tickets.values()).filter(function (t) { return t.lane === lane.idx; }).length };
};

/* ranked list of what slows the floor down or costs the most, each with a one-click lever */
Sim.prototype.bottlenecks = function () {
  var self = this, W = 12, cards = [], totalCost = 0, stats = [];
  this.stations.forEach(function (st) { var s = self.stationStats(st, W); stats.push(s); totalCost += s.cost; });
  var label = function (st) { return st.lane ? st.lane.wf.name + ' · ' + st.name : st.name; };

  var humans = this.stations.map(function (st, i) { return { st: st, s: stats[i] }; })
    .filter(function (o) { return o.s.humanWait > 45; })
    .sort(function (a, b) { return b.s.humanWait - a.s.humanWait; }).slice(0, 3);
  humans.forEach(function (o) {
    var st = o.st, s = o.s, card = { kind: 'human', st: st, title: label(st), score: s.humanWait,
      metric: s.waitingNow + ' en attente · ' + fmtDur(s.avgHuman) + ' d’attente en moyenne',
      detail: (s.waitingNow ? 'Le plus ancien attend depuis ' + fmtDur(s.oldest) + ' · ' : '') + fmtDur(s.humanWait) + ' d’attente cumulée sur 12 h' };
    if (st.exec === 'human_gate' && st.policy === 'human') {
      card.fix = { label: 'Passer en contrôle échantillonné', hint: 'Un agent juge valide les tickets à faible risque, le reste vous attend.',
        apply: function () { self.setPolicy(st, 'sampled'); } };
    } else if (st.exec === 'human_gate' && st.policy === 'sampled') {
      card.fix = { label: 'Passer en automatique', hint: 'Plus aucun contrôle humain : le débit monte, les défauts échappés aussi.',
        apply: function () { self.setPolicy(st, 'auto'); } };
    } else {
      card.kind = 'question';
      card.metric = fmtDur(s.humanWait) + ' d’arrêt sur questions et erreurs, 12 h';
      card.detail = s.waitingNow + ' run' + (s.waitingNow > 1 ? 's' : '') + ' à l’arrêt · ' + fmtDur(s.avgHuman) + ' d’attente en moyenne';
      var up = nextModel(st.model, 1);
      if (up) card.fix = { label: 'Monter sur ' + MODELS[up].label, hint: 'Un modèle plus solide pose moins de questions bloquantes.',
        apply: function () { self.setModel(st, up); st.def.pQuestion = (st.def.pQuestion || 0) * 0.5; st.def.pFail = (st.def.pFail || 0) * 0.5; } };
    }
    cards.push(card);
  });

  var slotWait = stats.reduce(function (a, s) { return a + s.slotWait; }, 0), sat = this.sum(this.pool.fullMin, W) / (this.span(W) * 60);
  if (slotWait > 40 || sat > 0.12) {
    cards.push({ kind: 'pool', st: null, title: 'Slots agents saturés', score: slotWait * 1.5,
      metric: fmtDur(slotWait) + ' de file d’attente sur 12 h',
      detail: 'agentMaxConcurrency = ' + this.pool.max + ' · plein ' + Math.round(sat * 100) + ' % du temps',
      fix: { label: 'Passer à ' + (this.pool.max + 4) + ' slots', hint: 'Plus d’agents en parallèle : la file se vide, la dépense horaire monte.',
        apply: function () { self.setConcurrency(self.pool.max + 4); } } });
  }

  var top = -1;
  stats.forEach(function (s, i) { if (top < 0 || s.cost > stats[top].cost) top = i; });
  if (top >= 0 && totalCost > 5) {
    var cst = this.stations[top], share = stats[top].cost / totalCost, down = nextModel(cst.model, -1), c2 = { kind: 'cost', st: cst, title: label(cst), score: share * 400,
      metric: '$' + stats[top].cost.toFixed(0) + ' sur 12 h · ' + Math.round(share * 100) + ' % de la dépense',
      detail: '$' + stats[top].costPer.toFixed(2) + ' par ticket · ' + MODELS[cst.model].label };
    if (down && MODELS[cst.model].tier > 2) c2.fix = { label: 'Passer sur ' + MODELS[down].label,
      hint: 'Environ −' + Math.round((1 - MODELS[down].cost / MODELS[cst.model].cost) * 100) + ' % de coût, mais plus de reprises en aval.',
      apply: function () { self.setModel(cst, down); } };
    cards.push(c2);
  }

  var worst = null;
  this.stations.forEach(function (st, i) {
    if (st.def.check && stats[i].done >= 6 && stats[i].koRate > 0.22 && (!worst || stats[i].ko > worst.s.ko)) worst = { st: st, s: stats[i] };
  });
  if (worst) {
    var prod = worst.st.links[0].to, upm = nextModel(prod.model, 1), c3 = { kind: 'quality', st: worst.st, title: label(worst.st), score: worst.s.ko * 25,
      metric: Math.round(worst.s.koRate * 100) + ' % des tickets renvoyés vers ' + prod.name,
      detail: worst.s.ko + ' reprises sur 12 h · ' + prod.name + ' tourne sur ' + MODELS[prod.model].label };
    if (upm) c3.fix = { label: prod.name + ' sur ' + MODELS[upm].label, hint: 'Moins de défauts à la source, donc moins de boucles de reprise.',
      apply: function () { self.setModel(prod, upm); } };
    cards.push(c3);
  }
  cards.sort(function (a, b) { return b.score - a.score; });
  return cards;
};
function nextModel(model, dir) { var i = MODEL_ORDER.indexOf(model) + dir; return i >= 0 && i < MODEL_ORDER.length ? MODEL_ORDER[i] : null; }
function fmtDur(min) {
  if (min < 1) return '< 1 min';
  if (min < 60) return Math.round(min) + ' min';
  var h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h >= 48) return Math.round(min / DAY) + ' j';
  return h + ' h ' + (m < 10 ? '0' : '') + m;
}

/* ---------- objectives ---------- */
Sim.prototype.initObjectives = function () {
  var self = this;
  this.objectives = [
    { id: 'start', name: 'Mise en route', desc: 'Expédier 25 tickets', done: false,
      eval: function () { return [self.session.shipped, 25]; }, fmt: function (v) { return Math.floor(v[0]) + ' / 25'; } },
    { id: 'pace', name: 'Cadence', desc: 'Tenir 5 tickets expédiés par heure sur 6 h', done: false,
      eval: function () { return [self.sum(self.g.out, 6) / self.span(6), 5]; }, fmt: function (v) { return v[0].toFixed(1) + ' / 5 par h'; } },
    { id: 'focus0', name: 'File vide', desc: 'Garder Focus vide pendant 1 h', done: false,
      eval: function () { return [self.session.zeroFocusSince < 0 ? 0 : self.now - self.session.zeroFocusSince, 60]; }, fmt: function (v) { return Math.floor(v[0]) + ' / 60 min'; } },
    { id: 'frugal', name: 'Sobriété', desc: 'Coût moyen sous $5 par ticket sur les 30 derniers', done: false, lower: true,
      eval: function () { var s = self.ships.slice(-30).filter(function (x) { return x.at > self.session.t0; });
        if (s.length < 30) return [s.length, 30, true];
        return [s.reduce(function (a, x) { return a + x.cost; }, 0) / 30, 5]; },
      fmt: function (v) { return v[2] ? v[0] + ' / 30 tickets mesurés' : '$' + v[0].toFixed(2) + ' / $5.00'; } },
    { id: 'auto80', name: 'Autonomie 80 %', desc: '80 % des 60 derniers tickets sans intervention humaine', done: false,
      eval: function () { return [self.kpis().autonomy * 100, 80]; }, fmt: function (v) { return Math.round(v[0]) + ' % / 80 %'; } },
    { id: 'lightsout', name: 'Lights-out', desc: '10 tickets d’affilée sur Feature Delivery sans toucher humain', done: false,
      eval: function () { return [self.session.ldStreak, 10]; }, fmt: function (v) { return v[0] + ' / 10'; } },
    { id: 'clean', name: 'Zéro défaut', desc: 'Aucun défaut échappé pendant 24 h', done: false,
      eval: function () { return [(self.now - self.session.noEscapeSince) / 60, 24]; }, fmt: function (v) { return v[0].toFixed(1) + ' / 24 h'; } }
  ];
};
Sim.prototype.tickObjectives = function () {
  var f = 0;
  for (var i = 0; i < this.stations.length && !f; i++) {
    var st = this.stations[i];
    if (st.rack.length) f = 1;
    for (var j = 0; j < st.cells.length && !f; j++) if (st.cells[j].state === 'question' || st.cells[j].state === 'failed') f = 1;
  }
  if (f) this.session.zeroFocusSince = -1; else if (this.session.zeroFocusSince < 0) this.session.zeroFocusSince = this.now;
  if (Math.floor(this.now / 5) === Math.floor((this.now - 0.2) / 5)) return;
  for (var k = 0; k < this.objectives.length; k++) {
    var o = this.objectives[k];
    if (o.done) continue;
    var v = o.eval();
    o.value = v;
    if (v[2]) continue;
    if (o.lower ? v[0] <= v[1] : v[0] >= v[1]) {
      o.done = true; o.doneAt = this.now;
      if (this.now > this.session.t0) this.say('objective', 'Objectif atteint : ' + o.name);
    }
  }
};

/* fast-forward without rendering, so the floor opens mid-shift with history behind it */
Sim.prototype.prewarm = function (minutes) {
  var n = Math.round(minutes / 0.1);
  for (var i = 0; i < n; i++) this.step(0.1);
  this.session.t0 = this.now; this.session.shipped = 0; this.session.ldStreak = 0; this.session.noEscapeSince = this.now;
  this.session.zeroFocusSince = -1;
  this.objectives.forEach(function (o) { o.done = false; });
  this.log.length = 0;
};

root.FleexFactory = { Sim: Sim, MODELS: MODELS, MODEL_ORDER: MODEL_ORDER, TYPES: TYPES, WORKFLOWS: WORKFLOWS, SOURCES: SOURCES, LAY: LAY,
  BELT_V: BELT_V, GAP: GAP, RING: RING, fmtDur: fmtDur, clamp: clamp };
})(typeof window !== 'undefined' ? window : globalThis);
