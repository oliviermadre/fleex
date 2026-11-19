/* Fleex Factory — HUD, pilot panel, floor editor, production drawer and input. */
(function () {
'use strict';
var F = window.FleexFactory, MODELS = F.MODELS, TYPES = F.TYPES, GEST = F.GEST, PRESETS = F.PRESETS, BLUEPRINTS = F.BLUEPRINTS, DX = F.DX, DY = F.DY, dur = F.fmtDur, clamp = F.clamp;
var sim, view;
var LS = 'fleex-factory-layout-9', SEED = 20261115;
var ui = { mode: 'pilot', tool: 'select', dir: 0, preset: null, undo: [], batch: null, dirty: false, groups: [null, null, null, null, null, null], tour: -1, tab: 'bottlenecks',
  speed: 1, lastSpeed: 1, sel: null, prod: false, cards: [], applied: [], logSeen: 0, hold: false, narrow: false, lastHtml: '' };
var TYPE_CHIP = { build: 'blue', fix: 'red', think: 'purple', lead: 'yellow', ops: 'teal' };
var STATUS_CHIP = { backlog: 'gray', todo: 'orange', doing: 'blue', reviewing: 'purple', done: 'green' };
var KIND = { gate: ['Gate', 'yellow'], question: ['Question', 'blue'], error: ['Erreur', 'red'], idle: ['À relancer', 'orange'] };
var BN = { automate: ['Automatisation', 'blue'], todo: ['Bande passante', 'orange'], human: ['Attente humaine', 'yellow'], question: ['Questions et erreurs', 'blue'],
  bench: ['Hors workflow', 'yellow'], pool: ['Capacité', 'blue'], cost: ['Coût', 'orange'], stuck: ['Sortie bloquée', 'red'] };
var POLICY = { human: 'humain', sampled: 'échantillonné', auto: 'automatique' };
var OVERLAYS = ['none', 'flow', 'cost', 'time', 'human'];
var KIND_NAME = { belt: 'Convoyeur', arm: 'Bras', station: 'Poste', depot: 'Zone', intake: 'Intake', exit: 'Sortie', label: 'Étiquette', pool: 'Slots agents' };
var ARROW = ['→', '↓', '←', '↑'];
var EXEC = { agent: 'Agent', skill: 'Skill', panel: 'Panel', human_gate: 'Human gate', native: 'Action native' };
var EXEC_HELP = { agent: 'Une persona exécute l’étape dans une session Claude.', skill: 'Une skill lancée telle quelle sur le ticket.',
  panel: 'Plusieurs personas répondent, un orchestrateur synthétise. Compte pour 3 slots.', native: 'Action déterministe sur le ticket, sans agent ni coût.',
  human_gate: 'Attend une décision humaine. Chaque issue sort par son propre bras.' };
var DEPLOY = { name: 'Deploy', exec: 'skill', ref: 'deploy', model: 'claude-sonnet-5-5', dur: 4, cost: 0.4, gesture: 'deploy', outcomes: [{ name: 'ok' }] };

function $(s) { return document.querySelector(s); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function money(v) { return '$' + (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)); }
function pct(v) { return Math.round(v * 100) + ' %'; }
function hhmm(min) { var m = Math.floor(((min % 1440) + 1440) % 1440); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
function plural(n, w) { return n + ' ' + w + (n > 1 ? 's' : ''); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function typeChip(t) { return t.triaged ? '<span class="chip ' + TYPE_CHIP[t.type] + '"><i></i>' + t.type + '</span>' : '<span class="chip">brut</span>'; }
function statusChip(t) { return '<span class="chip ' + STATUS_CHIP[t.status] + '">' + t.status + '</span>'; }
function ticketLink(t) { return '<button class="tlink" data-act="ticket" data-id="' + t.id + '"><span class="id">' + t.displayId + '</span>' + esc(t.title) + '</button>'; }
function entName(e) { return !e ? 'le sol' : e.name || (e.kind === 'label' ? e.text : e.kind === 'pool' ? 'Slots agents' : KIND_NAME[e.kind] + ' ' + ARROW[e.dir]); }
function entLink(e) { return e ? '<button class="tlink" data-act="ent" data-id="' + e.id + '">' + esc(entName(e)) + '</button>' : '<span class="where">rien</span>'; }
function stat(l, v) { return '<div class="stat"><div class="s-l">' + l + '</div><div class="s-v">' + v + '</div></div>'; }
function signed(v, digits) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(digits); }
function entById(id) { for (var i = 0; i < sim.ents.length; i++) if (sim.ents[i].id === id) return sim.ents[i]; return null; }
function selEnt() { return ui.sel && ui.sel.type === 'ent' ? ui.sel.e : null; }
function bench(status) { var b = sim.ents.filter(function (e) { return e.kind === 'depot' && sim.works(e); }); return b.filter(function (e) { return e.status === status; })[0] || b[0] || null; }

/* ---------- toast (one at a time, like Fleex) ---------- */
var toastTimer = 0;
function toast(text, kind) {
  var el = $('#toast');
  el.className = kind || ''; el.innerHTML = '<i></i><span>' + esc(text) + '</span>'; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 4200);
}

/* ---------- HUD ---------- */
function setText(id, html) { var el = document.getElementById(id); if (el._h !== html) { el._h = html; el.innerHTML = html; } }
function cls(sel, c) { var el = $(sel), base = 'kpi' + (c ? ' ' + c : ''); if (el.className !== base) el.className = base; }
function hud() {
  var k = sim.kpis(), c = sim.clock(), hod = sim.hourOfDay(), night = hod < 7 || hod >= 20;
  setText('clock', (night ? '☾ ' : '☀ ') + c.dow + ' ' + ('0' + c.hh).slice(-2) + ':' + ('0' + c.mm).slice(-2) + '<small>jour ' + c.day + '</small>');
  setText('k-flow', k.shipped24 + '<small>/ 24 h</small>');
  setText('k-back', String(k.backlog));
  setText('k-todo', k.todo + (k.todo ? '<small>' + dur(k.todoOldest) + '</small>' : ''));
  setText('k-wip', k.wip + '<small>' + dur(k.lead) + '</small>');
  setText('k-focus', k.focus + (k.focus ? '<small>' + dur(k.oldest) + '</small>' : ''));
  setText('k-pool', k.outage ? 'panne API' : k.poolUsed + ' / ' + k.poolMax);
  $('#k-poolbar').style.width = Math.min(100, k.poolUsed / k.poolMax * 100) + '%';
  $('#k-poolbar').style.background = k.poolUsed >= k.poolMax ? '#f59e0b' : '';
  setText('k-cost', money(k.burn) + '<small>/h</small>');
  setText('k-bench', pct(k.benchShare));
  cls('[data-kpi="focus"]', k.focus >= 10 ? 'bad' : k.focus >= 4 ? 'warn' : k.focus === 0 ? 'good' : '');
  cls('[data-kpi="todo"]', k.todoOldest > 360 ? 'bad' : k.todoOldest > 180 ? 'warn' : '');
  cls('[data-kpi="pool"]', k.outage ? 'bad' : k.poolUsed >= k.poolMax ? 'warn' : '');
  cls('[data-kpi="bench"]', k.benchShare <= 0.35 ? 'good' : '');
  var done = sim.objectives.filter(function (o) { return o.done; }).length;
  setText('c-focus', String(k.focus)); $('#c-focus').className = 'cnt' + (k.focus ? ' hot' : '');
  setText('c-goals', done + '/' + sim.objectives.length);
  ui.k = k;
}

/* ---------- overlays ---------- */
function heat() {
  var ov = view.overlay, m = new Map(), max = 0, vals = [], W = 12;
  if (ov === 'flow') sim.ents.forEach(function (e) { if (e.kind === 'belt') vals.push([e, sim.sum(e.flow, 6), '']); });
  else if (ov !== 'none') sim.ents.forEach(function (e) {
    var v = 0, label = '', s;
    if (e.kind === 'station') {
      s = sim.stationStats(e, W);
      if (ov === 'cost') { v = s.cost; label = v >= 0.5 ? money(v) : ''; }
      else if (ov === 'time') { v = s.avgRun; label = v >= 1 ? dur(v) : ''; }
      else { v = s.humanWait; label = s.waitingNow ? s.waitingNow + ' · ' + dur(s.oldest) : v > 1 ? '⌀ ' + dur(s.avgHuman) : ''; }
    } else if (e.kind === 'depot') {
      s = sim.zoneStats(e, W);
      if (ov === 'cost') { v = s.cost; label = v >= 0.5 ? money(v) : ''; }
      else if (ov === 'time') { v = s.done ? s.humanWait / s.done : 0; label = v >= 1 ? dur(v) : ''; }
      else if (e.status === 'todo') { v = s.ready ? s.old * s.ready : 0; label = s.ready ? s.ready + ' · ' + dur(s.old) : ''; }
      else { v = s.humanWait; label = s.idle ? s.idle + ' · ' + dur(s.oldest) : v > 1 ? '⌀ ' + dur(s.avgHuman) : ''; }
    } else return;
    vals.push([e, v, label]);
  });
  vals.forEach(function (p) { if (p[1] > max) max = p[1]; });
  vals.forEach(function (p) { if (p[1] > 0 && (ov === 'flow' || p[2])) m.set(p[0].id, { v: clamp(Math.sqrt(p[1] / max), 0.08, 1), label: p[2] }); });
  view.heat = m;
  ui.cards = sim.bottlenecks();
  view.beacons = ui.cards.slice(0, 3);
  setText('c-bn', String(ui.cards.length));
  if (ov === 'human') { var s2 = new Set(); sim.focus().forEach(function (f) { s2.add(f.t.id); }); sim.depots('todo').forEach(function (d) { d.items.forEach(function (e) { s2.add(e.t.id); }); }); view.shown = s2; }
  else view.shown = null;
}
function setOverlay(ov) {
  view.overlay = ov;
  document.querySelectorAll('#overlays button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.ov === ov ? 'true' : 'false'); });
  heat(); legend();
}
function legend() {
  var ov = view.overlay, h;
  if (ui.mode === 'edit') h = '<span><i style="background:#22c55e"></i>entrée</span><span><i style="background:#fb923c"></i>sortie (bras)</span><span><i style="background:#eab308"></i>bras à filtre</span><span><i style="background:#ef4444"></i>cul-de-sac</span><span>R pivote · Suppr retire · Ctrl+Z annule</span>';
  else if (ov === 'none') {
    h = Object.keys(TYPES).map(function (k) { return '<span><i style="background:' + TYPES[k].color + '"></i>' + k + '</span>'; }).join('') +
      '<span><i class="lamp" style="background:#22c55e"></i>en cours</span><span><i class="lamp" style="background:#f59e0b"></i>attend un humain</span>' +
      '<span><i class="lamp" style="background:#60a5fa"></i>attend un slot</span><span><i class="lamp" style="background:#fb923c"></i>sortie bloquée</span><span><i style="background:#eab308"></i>bras à filtre</span>';
  } else {
    var txt = { flow: ['#4ade80', 'Passages sur chaque case de convoyeur, 6 h'], cost: ['#fb923c', 'Dépense par poste et par zone, 12 h'],
      time: ['#60a5fa', 'Durée moyenne d’un run par poste ; attente par ticket dans les zones de travail'], human: ['#facc15', 'Ce qui attend quelqu’un : nombre et ancienneté'] }[ov];
    h = '<span><i style="background:' + txt[0] + '"></i>' + txt[1] + '</span><span>plus c’est clair, plus c’est élevé</span>';
  }
  $('#legend').innerHTML = h;
}

/* ---------- selection ---------- */
function select(sel, look) {
  ui.sel = sel; view.sel = sel;
  if (sel) {
    setTab('inspect');
    if (look && sel.type === 'ticket') { if (sim.tickets.has(sel.t.id)) view.lookAt(sel.t.x, sel.t.y, Math.max(view.cam.z, 24)); }
    else if (look && sel.type === 'tickets') frameTickets(sel.list);
    else if (look && sel.type === 'ent') view.lookAt(sel.e.x + sel.e.w / 2, sel.e.y + sel.e.h / 2, Math.max(view.cam.z, sel.e.w > 5 || sel.e.h > 5 ? 16 : 24));
    if (ui.narrow) $('#panel').classList.remove('closed');
  } else view.follow = null;
  ui.menu = null;
  heat(); panel(true); tray(); bubble(); layout(); cmdRender(); selInfo();
}
function live(t) { return sim.tickets.has(t.id); }
function frameTickets(list) {
  var l = list.filter(live); if (!l.length) return;
  var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  l.forEach(function (t) { x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y); });
  view.frame(x0 - 4, y0 - 3, x1 - x0 + 8, y1 - y0 + 6, false, 30);
}
/* Maj+clic: add a ticket to the selection, or take it out */
function toggleTicket(t) {
  var s = ui.sel, list = s && s.type === 'tickets' ? s.list.slice() : s && s.type === 'ticket' ? [s.t] : [], i = list.indexOf(t);
  if (i >= 0) list.splice(i, 1); else list.push(t);
  select(!list.length ? null : list.length === 1 ? { type: 'ticket', t: list[0] } : { type: 'tickets', list: list }, false);
}
/* what holds a ticket right now */
function holder(t) {
  var e = t.loc, i;
  if (!sim.tickets.has(t.id)) return { k: t.status === 'done' ? 'done' : 'outside' };
  if (!e) return { k: 'loose' };
  if (e.kind === 'belt' || e.kind === 'arm' || e.kind === 'intake') return { k: e.kind, e: e };
  if (e.kind === 'depot') { for (i = 0; i < e.items.length; i++) if (e.items[i].t === t) return { k: 'depot', e: e, it: e.items[i] }; }

  if (e.kind === 'station') {
    for (i = 0; i < e.rack.length; i++) if (e.rack[i].t === t) return { k: 'rack', e: e, it: e.rack[i] };
    for (i = 0; i < e.cells.length; i++) if (e.cells[i].t === t) return { k: 'cell', e: e, it: e.cells[i] };
  }
  if (e.outbox) for (i = 0; i < e.outbox.length; i++) if (e.outbox[i].t === t) return { k: 'out', e: e, it: e.outbox[i] };
  return { k: 'loose' };
}
/* the same, in two words and a colour */
function stateOf(t) {
  var h = holder(t), it = h.it;
  if (h.k === 'done') return { c: '#22c55e', w: 'expédié' };
  if (h.k === 'outside') return { c: '#71717a', w: 'Fleex classique' };
  if (h.k === 'loose') return { c: '#f59e0b', w: 'posé au sol' };
  if (h.k === 'belt' || h.k === 'arm') return { c: '#a1a1aa', w: 'en transit' };
  if (h.k === 'intake') return { c: '#a1a1aa', w: 'à l’intake' };
  if (h.k === 'depot') return it.released ? { c: sim.now - it.relAt > 4 ? '#fb923c' : '#a1a1aa', w: h.e.name + ' · libéré' } : it.state === 'idle' ? { c: '#f59e0b', w: h.e.name + ' · à relancer' } : it.state === 'queued' ? { c: '#60a5fa', w: h.e.name + ' · en file' } :
    it.state === 'run' ? { c: '#22c55e', w: h.e.name + ' · agent en cours' } : { c: h.e.status === 'todo' ? '#fb923c' : '#71717a', w: h.e.name };

  if (h.k === 'rack') return { c: '#f59e0b', w: h.e.name + ' · vous attend' };
  if (h.k === 'out') return { c: sim.now - it.since > 4 ? '#fb923c' : '#a1a1aa', w: h.e.name + (sim.now - it.since > 4 ? ' · sortie bloquée' : ' · sort') };
  return { c: it.state === 'failed' ? '#ef4444' : it.state === 'question' ? '#f59e0b' : it.state === 'queued' ? '#60a5fa' : '#22c55e',
    w: h.e.name + (it.state === 'question' ? ' · question' : it.state === 'failed' ? ' · erreur' : it.state === 'queued' ? ' · en file' : '') };
}
function whereIs(t) {
  var h = holder(t), it = h.it, e = h.e;
  if (h.k === 'done') return 'Expédié à ' + hhmm(t.doneAt);
  if (h.k === 'outside') return 'Dans Fleex classique, hors de la Factory';
  if (h.k === 'loose') return 'Posé au sol : rien ne le déplacera, déposez-le sur une machine';
  if (h.k === 'belt') { var d = sim.leadsTo(e); return 'Sur un convoyeur ' + ARROW[e.dir] + (d ? ', qui mène à ' + entName(d) : ', qui ne mène nulle part'); }
  if (h.k === 'arm') return 'Dans la pince d’un bras, vers ' + entName(e.dst);
  if (h.k === 'intake') return 'À l’intake ' + e.name + ', attend un bras';
  if (h.k === 'depot') { var g = it.i < it.plan.length ? GEST[it.plan[it.i]] : null;
    return e.name + (it.released ? ' · libéré, attend un bras' : it.state === 'idle' ? ' · rien en cours depuis ' + dur(sim.now - it.idleSince) + ', prochain geste : ' + g.n : it.state === 'queued' ? ' · ' + g.n + ' attend un slot' :
      it.state === 'run' ? ' · ' + g.n + ' tourne depuis ' + dur(sim.now - it.started) : ' · en stock depuis ' + dur(sim.now - it.since)); }
  if (h.k === 'rack') return e.name + ' · needs_review depuis ' + dur(sim.now - it.since);
  if (h.k === 'out') return e.name + ' · terminé' + (t.outcome ? ', issue « ' + t.outcome + ' »' : '') + (sim.now - it.since > 4 ? ' · aucun bras ne le prend depuis ' + dur(sim.now - it.since) : ', attend un bras');
  return e.name + ' · ' + (it.state === 'question' ? 'waiting_for_info' : it.state === 'failed' ? 'failed' : it.state === 'queued' ? 'queued, attend un slot depuis ' + dur(sim.now - it.q) : 'running depuis ' + dur(sim.now - it.started));
}
/* where an outcome of a station leaves, according to the arms around it */
function armFor(st, outcome) {
  var tk = st.takers, i, plain = null;
  for (i = 0; i < tk.length; i++) { var f = tk[i].filter; if (f && f.values.length) { if (f.field === 'outcome' && f.values.indexOf(outcome) >= 0) return tk[i]; } else if (!plain) plain = tk[i]; }
  return plain;
}
function destName(arm) { if (!arm) return null; if (!arm.dst) return 'le sol'; var e = sim.leadsTo(arm.dst); return e ? entName(e) : 'un cul-de-sac'; }

/* ---------- saved selections, RTS style ---------- */
function describe(sel) {
  if (!sel) return '';
  if (sel.type === 'ticket') return sel.t.displayId;
  if (sel.type === 'tickets') return sel.list.length + ' tickets';
  if (sel.type === 'operator') return 'Opérateur simulé';
  return entName(sel.e);
}
function saveGroup(i) {
  if (!ui.sel) { toast('Sélectionnez d’abord un élément du plan'); return; }
  if (i < 0) { i = ui.groups.indexOf(null); if (i < 0) i = ui.groups.length - 1; }
  ui.groups[i] = ui.sel; toast('Groupe ' + (i + 1) + ' : ' + describe(ui.sel)); tray(); panel(true);
}
function recallGroup(i) { var g = ui.groups[i]; if (g && !(g.type === 'ent' && sim.ents.indexOf(g.e) < 0)) select(g, true); }
function tray() {
  var h = '';
  ui.groups.forEach(function (g, i) {
    if (g && g.type === 'ent' && sim.ents.indexOf(g.e) < 0) g = ui.groups[i] = null;
    if (!g) { h += '<button class="grp empty" data-grp="' + i + '" title="Maj+' + (i + 1) + ' : enregistrer la sélection ici"><b>' + (i + 1) + '</b></button>'; return; }
    var txt = describe(g), col = '#a1a1aa', sub = '';
    if (g.type === 'ticket') { var st = stateOf(g.t); col = st.c; sub = st.w; }
    else if (g.type === 'tickets') { var wait = g.list.filter(function (t) { return stateOf(t).c === '#f59e0b'; }).length, gone = g.list.filter(function (t) { return !live(t); }).length; col = wait ? '#f59e0b' : '#22c55e'; sub = (wait ? wait + ' vous attend' + (wait > 1 ? 'ent' : '') : gone === g.list.length ? 'tous sortis' : 'en cours'); }
    var on = ui.sel === g;
    h += '<span class="grp' + (on ? ' on' : '') + '"><button data-grp="' + i + '" title="' + (i + 1) + ' : rappeler cette sélection"><b>' + (i + 1) + '</b><i style="background:' + col + '"></i><span>' + esc(txt) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></button>' +
      '<button class="x" data-grpx="' + i + '" aria-label="Vider le groupe ' + (i + 1) + '">×</button></span>';
  });
  var el = $('#groups');
  if (el._h !== h) { el._h = h; el.innerHTML = h; }
}

/* ---------- acting from the floor: the actions of the selected ticket float next to it ---------- */
function releaseLabel(d) { if (d.status === 'todo') return 'Lancer'; var a = d.takers[0], n = destName(a); return a ? 'Envoyer vers ' + n : 'Libérer'; }
function ticketActions(t) {
  var it = null, h = holder(t);
  if (h.k === 'done' || h.k === 'outside') return '';
  sim.focus().forEach(function (f) { if (f.t === t) it = f; });
  if (it) return actionsFor(it);
  if (h.k === 'depot' && !h.it.released && h.it.state === 'ready') return '<button class="btn sm primary" data-act="release" data-id="' + t.id + '">' + esc(releaseLabel(h.e)) + '</button>';
  return '';
}
function bubble() {
  var el = $('#bubble'), s = ui.sel, t = s && s.type === 'ticket' ? s.t : null, h = t && ui.mode === 'pilot' && !view.dragT ? ticketActions(t) : '';
  if (!h || ui.hold) { if (!h) el.hidden = true; return; }
  if (el._h !== h) { el._h = h; el.innerHTML = '<div class="row">' + h + '</div>'; }
  var p = view.toScreen(t.x, t.y), I = view.inset;
  if (p.x < I.l || p.x > view.w - I.r || p.y < I.t || p.y > view.h - I.b) { el.hidden = true; return; }
  el.hidden = false;
  el.style.left = clamp(p.x, I.l + el.offsetWidth / 2, view.w - I.r - el.offsetWidth / 2) + 'px';
  el.style.top = (p.y - 18) + 'px';
}
function findTicket(id) {
  var t = sim.tickets.get(id), i;
  if (t) return t;
  for (i = sim.recent.length - 1; i >= 0; i--) if (sim.recent[i].id === id) return sim.recent[i];
  for (i = sim.outside.length - 1; i >= 0; i--) if (sim.outside[i].id === id) return sim.outside[i];
  return null;
}
function setTab(tab) {
  ui.tab = tab; if (view) view.showBeacons = tab === 'bottlenecks';
  document.querySelectorAll('.tabs [role=tab]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'); });
}

/* ---------- panel: bottlenecks ---------- */
function bnHTML() {
  var h = '<p class="lead">Ce qui freine, coûte ou mériterait d’être automatisé, sur les 12 dernières heures. Les trois premiers sont repérés sur le plan par une étiquette « Goulot », visible tant que cet onglet est ouvert.</p>';
  if (!ui.cards.length) h += '<div class="empty">Rien à signaler. L’usine tourne sans attente notable.</div>';
  ui.cards.forEach(function (c, i) {
    h += '<div class="card"><div class="top"><span class="rank ' + c.kind + '">' + (i + 1) + '</span><span class="chip ' + BN[c.kind][1] + '">' + BN[c.kind][0] + '</span></div>' +
      '<div class="title">' + esc(c.title) + '</div><div class="metric">' + esc(c.metric) + '</div><div class="detail">' + esc(c.detail) + '</div>' +
      (c.fix ? '<div class="hint">' + esc(c.fix.hint) + '</div>' : '') +
      '<div class="row">' + (c.ref || c.loose ? '<button class="btn sm" data-act="bn-see" data-i="' + i + '">Voir sur le plan</button>' : '') +
      (c.fix ? '<button class="btn sm primary" data-act="bn-fix" data-i="' + i + '">' + esc(c.fix.label) + '</button>' : '') + '</div></div>';
  });
  if (ui.applied.length) {
    h += '<p class="sub">Réglages appliqués</p><ul class="log">';
    var k = ui.k || sim.kpis();
    ui.applied.slice(-5).reverse().forEach(function (a) {
      h += '<li><time>' + hhmm(a.at) + '</time>' + esc(a.text);
      if (sim.now - a.at >= 120) {
        h += '<br><span style="color:var(--t3)">Depuis : ' + signed(k.shipped24 - a.k.shipped24, 0) + ' expédiés / 24 h · Focus ' + signed(k.focus - a.k.focus, 0) + ' · hors workflow ' +
          signed((k.benchShare - a.k.benchShare) * 100, 0) + ' pts · coût/ticket ' + (k.costPerTicket >= a.k.costPerTicket ? '+' : '−') + '$' + Math.abs(k.costPerTicket - a.k.costPerTicket).toFixed(2) + '</span>';
      } else h += '<br><span style="color:var(--t3)">Effet mesuré dans ' + dur(120 - (sim.now - a.at)) + '</span>';
      h += '</li>';
    });
    h += '</ul>';
  }
  return h;
}

/* ---------- panel: focus ---------- */
function actionsFor(it) {
  var k = 'data-key="' + it.key + '"', h = '';
  if (it.kind === 'gate') {
    it.st.outcomes.forEach(function (o, i) {
      var a = armFor(it.st, o.name), n = destName(a);
      h += '<button class="btn sm' + (i === 0 ? ' primary' : '') + '" data-act="resolve" data-do="' + esc(o.name) + '" ' + k + ' title="' + (a ? 'Sort vers ' + esc(n) : 'Aucun bras ne prend cette issue') + '">' +
        (o.name === 'approve' ? 'Approuver' : esc(o.name)) + (i || !a ? ' → ' + esc(a ? n : 'aucune sortie') : '') + '</button>';
    });
  } else if (it.kind === 'question') h += '<button class="btn sm primary" data-act="resolve" data-do="answer" ' + k + '>Répondre</button>';
  else if (it.kind === 'error') h += '<button class="btn sm primary" data-act="resolve" data-do="retry" ' + k + '>Relancer l’étape</button>';
  else if (it.g) {
    h += '<button class="btn sm primary" data-act="resolve" data-do="next" ' + k + '>' + (it.g.k === 'human' ? 'Faire : ' + it.g.n : 'Lancer ' + esc(it.g.n)) + '</button>' +
      '<button class="btn sm" data-act="resolve" data-do="done" ' + k + '>Clore ici</button>';
  } else h += '<button class="btn sm primary" data-act="resolve" data-do="done" ' + k + '>Clore et libérer</button>';
  return h;
}
function focusItem(it) {
  var kd = KIND[it.kind], where = it.zone ? it.zone.name + (it.zone.status ? ' · ' + it.zone.status : '') + (it.g ? ' · rien en cours' : ' · travail terminé, à clore') :
    it.st.name + (it.kind === 'question' ? ' · waiting_for_info' : it.kind === 'error' ? ' · failed' : ' · needs_review');
  return '<div class="fitem"><div class="l1"><span class="chip ' + kd[1] + '">' + kd[0] + '</span>' + typeChip(it.t) + '<span class="age">' + dur(it.age) + '</span></div>' +
    ticketLink(it.t) + '<div class="where">' + esc(where) + '</div><div class="row">' + actionsFor(it) + '</div></div>';
}
function focusHTML() {
  var list = sim.focus(), op = sim.op, av = sim.opAvailable();
  var h = '<p class="lead">Tout ce qui attend un humain, le plus ancien d’abord : gates, questions, erreurs, et les tickets d’une zone de travail où plus rien ne tourne. Votre action part tout de suite.</p>' +
    '<div class="row"><button class="switch" role="switch" data-act="op-toggle" aria-checked="' + op.enabled + '"><i></i>Opérateur simulé</button><button class="btn sm ghost" data-act="op-settings">Régler</button><span class="spacer"></span>' +
    '<span class="chip ' + (av ? 'green' : 'gray') + '">' + (!op.enabled ? 'désactivé' : av ? (op.state === 'work' ? 'occupé' : 'en poste') : sim.now < op.awayUntil ? 'en réunion' : 'hors horaires') + '</span></div>';
  if (!list.length) return h + '<div class="empty">Rien en attente. Les agents avancent seuls.</div>';
  var gates = list.filter(function (i) { return i.kind === 'gate'; }).length;
  if (gates > 1) h += '<div class="row"><button class="btn sm" data-act="approve-all">Approuver les ' + gates + ' gates</button></div>';
  list.slice(0, 30).forEach(function (it) { h += focusItem(it); });
  if (list.length > 30) h += '<p class="lead">+ ' + (list.length - 30) + ' autres éléments.</p>';
  return h;
}

/* ---------- panel: inspector ---------- */
function fText(label, act, val, extra) { return '<div class="field"><label for="f-' + act + '">' + label + '</label><input type="text" id="f-' + act + '" data-act="' + act + '" value="' + esc(val) + '" autocomplete="off"' + (extra || '') + '></div>'; }
function fSel(label, act, val, opts) {
  return '<div class="field"><label for="f-' + act + '">' + label + '</label><select id="f-' + act + '" data-act="' + act + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>';
}
function fRange(label, act, val, min, max, step, unit) {
  return '<div class="field"><label for="f-' + act + '">' + label + ' : <span class="num">' + val + '</span>' + (unit || '') + '</label><input type="range" id="f-' + act + '" data-act="' + act + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" value="' + val + '"></div>';
}
function head(e, title, chips) {
  var dirn = e.kind === 'belt' || e.kind === 'arm';
  return '<div class="row"><span class="chip">' + KIND_NAME[e.kind] + '</span>' + (chips || '') + '<span class="spacer"></span><button class="btn sm ghost" data-act="pin" title="Enregistre cette sélection dans un groupe numéroté">Épingler</button></div>' +
    '<h2 class="h">' + esc(title) + '</h2><div class="row">' + (isContainer(e) ? '<button class="btn sm primary" data-act="open" title="Tout ce que contient cette machine, en grand (V ou double-clic)">Ouvrir</button>' : '') + (dirn ? '<button class="btn sm" data-act="rotate" title="Pivoter d’un quart de tour (R)">Pivoter ' + ARROW[e.dir] + '</button>' : '') +
    (e.kind !== 'pool' ? '<button class="btn sm danger" data-act="delete" title="Retirer du plan (Suppr)">Retirer</button>' : '') +
    '<span class="where">' + (ui.mode === 'edit' ? 'Glissez-le sur le plan pour le déplacer' : 'Construire (B) pour le déplacer') + '</span></div>';
}
function feeders(e) {
  var out = [], x, y, n;
  for (x = e.x - 1; x <= e.x + e.w; x++) for (y = e.y - 1; y <= e.y + e.h; y++) {
    if (x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h) continue;
    n = sim.at(x, y);
    if (n && ((n.kind === 'belt' && sim.at(n.x + DX[n.dir], n.y + DY[n.dir]) === e) || (n.kind === 'arm' && n.dst === e))) out.push(n);
  }
  return out;
}
function portsHTML(e) {
  var ins = feeders(e), h = '<p class="sub">Entrées</p>';
  if (!ins.length) h += '<p class="lead">Rien n’arrive ici. Faites-y aboutir un convoyeur, ou pointez un bras dessus.</p>';
  else h += '<ul class="tl">' + ins.map(function (n) { return '<li><span class="dot"></span><span>' + entLink(n) + (n.kind === 'arm' ? ' <small>depuis ' + esc(entName(n.src)) + (F.armTag(n) ? ' · ' + esc(F.armTag(n)) : '') + '</small>' : '') + '</span><span class="m"></span></li>'; }).join('') + '</ul>';
  return h;
}
function outsHTML(e) {
  var h = '<p class="sub">Sorties</p>';
  if (!e.takers.length) return h + '<p class="lead">Aucun bras ne prend ici : ce qui est terminé reste dans le bac de sortie. Posez un bras contre ce bord.</p>';
  return h + '<ul class="tl">' + e.takers.map(function (a) { return '<li><span class="dot hum"></span><span>' + entLink(a) + ' <small>' + esc(F.armTag(a) || 'tout') + '</small></span><span class="m">→ ' + esc(destName(a)) + '</span></li>'; }).join('') + '</ul>';
}
function runsHTML(st) {
  var h = '', n = 0;
  st.rack.forEach(function (r) { if (n++ >= 8) return; h += '<div class="fitem"><div class="l1">' + typeChip(r.t) + '<span class="chip yellow">needs_review</span><span class="age">' + dur(sim.now - r.since) + '</span></div>' + ticketLink(r.t) +
    '<div class="row">' + actionsFor({ key: r.t.id + ':' + st.id, kind: 'gate', st: st, t: r.t }) + '</div></div>'; });
  st.cells.forEach(function (c) {
    if (c.run === 'stamp' || n++ >= 8) return;
    h += '<div class="fitem"><div class="l1">' + typeChip(c.t) + (c.state === 'question' ? '<span class="chip blue">waiting_for_info</span>' : c.state === 'failed' ? '<span class="chip red">failed</span>' :
      c.run === 'judge' && c.state !== 'queued' ? '<span class="chip">agent juge</span>' : c.state === 'queued' ? '<span class="chip blue">queued</span>' : '') +
      '<span class="age">' + money(c.spent) + '</span></div>' + ticketLink(c.t) +
      (c.state === 'running' || c.state === 'judge' ? '<div class="run"><div class="prog ind"><i></i></div><span class="pct">' + dur(sim.now - c.started) + '</span></div>' :
        '<div class="where">' + (c.state === 'queued' ? 'attend un slot depuis ' + dur(sim.now - c.q) : 'à l’arrêt depuis ' + dur(sim.now - c.since)) + '</div>') +
      (c.state === 'question' || c.state === 'failed' ? '<div class="row">' + actionsFor({ key: c.t.id + ':' + st.id, kind: c.state === 'failed' ? 'error' : 'question', st: st, t: c.t }) + '</div>' : '') + '</div>';
  });
  st.outbox.forEach(function (o) { if (n++ >= 8) return; h += '<div class="fitem"><div class="l1">' + typeChip(o.t) + '<span class="chip ' + (sim.now - o.since > 4 ? 'orange' : 'gray') + '">issue ' + esc(o.t.outcome) + '</span><span class="age">' + dur(sim.now - o.since) + '</span></div>' + ticketLink(o.t) + '<div class="where">dans le bac de sortie, attend un bras</div></div>'; });
  return h;
}
function stationHTML(st) {
  var s = sim.stationStats(st, 12), gate = st.exec === 'human_gate', nat = st.exec === 'native', h;
  h = head(st, st.name, '<span class="chip ' + (gate ? 'yellow' : nat ? 'green' : 'blue') + '">' + EXEC[st.exec] + '</span>') +
    '<p class="lead">' + EXEC_HELP[st.exec] + '</p>' + fText('Nom', 'st-name', st.name);
  if (!nat) h += fSel('Exécuteur', 'st-exec', st.exec, [['agent', 'Agent (persona)'], ['skill', 'Skill'], ['panel', 'Panel'], ['human_gate', 'Human gate']]);
  if (gate) {
    h += '<div class="field"><span class="lab">Qui décide</span><div class="seg wide">' + ['human', 'sampled', 'auto'].map(function (p) { return '<button data-act="policy" data-v="' + p + '" aria-pressed="' + (st.policy === p) + '">' + POLICY[p] + '</button>'; }).join('') + '</div>' +
      '<span class="help">' + (st.policy === 'human' ? 'Chaque ticket attend votre décision.' : st.policy === 'sampled' ? 'Un agent juge valide les tickets à faible risque ; le reste vous attend.' : 'Tout passe par la première issue, sans contrôle.') + '</span></div>';
  } else if (nat) h += fSel('Statut posé sur le ticket', 'st-sets', st.sets || '', [['doing', 'doing'], ['reviewing', 'reviewing'], ['todo', 'todo'], ['backlog', 'backlog']]);
  else h += fText(st.exec === 'agent' ? 'Persona' : st.exec === 'skill' ? 'Skill' : 'Panel', 'st-ref', st.ref || '') +
    fSel('Modèle', 'st-model', st.model, F.MODEL_ORDER.map(function (m) { return [m, MODELS[m].label]; }));
  h += fRange('Capacité (tickets à l’intérieur)', 'st-cap', st.cap, 1, 24, 1) + '<p class="sub">Issues et sorties</p><p class="lead">Une issue sort par le bras dont le filtre « issue » la contient. Un bras sans filtre prend ce qui reste. La première issue est le chemin normal.</p><div class="ocs">';
  st.outcomes.forEach(function (o, i) {
    var a = armFor(st, o.name);
    h += '<div class="oc"><input type="text" id="f-oc-' + i + '" data-act="oc-name" data-i="' + i + '" value="' + esc(o.name) + '" aria-label="Nom de l’issue ' + (i + 1) + '" autocomplete="off">' +
      (i && !gate ? '<input type="number" id="f-ocp-' + i + '" data-act="oc-p" data-i="' + i + '" min="0" max="60" value="' + Math.round(o.p * 100) + '" aria-label="Fréquence en pourcentage" title="Fréquence simulée, en %">' : '') +
      (i ? '<button class="btn sm ghost" data-act="oc-del" data-i="' + i + '" aria-label="Retirer cette issue">×</button>' : '') +
      '<span class="to ' + (a ? '' : 'bad') + '">' + (a ? '→ ' + esc(destName(a)) : 'aucun bras') + '</span></div>';
  });
  h += '</div><div class="row"><button class="btn sm" data-act="oc-add">+ Issue</button></div>' + outsHTML(st) + portsHTML(st);
  h += '<p class="sub">Sur 12 h</p><div class="stats">' + stat('Traités', s.done) + (gate ? stat('Attente moy.', dur(s.avgHuman)) + stat('Retours', pct(s.koRate)) : stat('Coût', money(s.cost)) + stat('Run moyen', dur(s.avgRun))) +
    (gate ? stat('Auto-validés', s.auto) : stat('Par ticket', money(s.costPer))) + stat('File de slots', dur(s.slotWait)) + stat(gate ? 'En attente' : 'Retours', gate ? s.waitingNow : pct(s.koRate)) + '</div>';
  var r = runsHTML(st);
  if (r) h += '<p class="sub">En ce moment</p>' + r;
  return h;
}
function armHTML(a) {
  var f = a.filter, field = f && f.values.length ? f.field : f ? f.field : '', opts = [], h;
  h = head(a, 'Bras ' + ARROW[a.dir], f && f.values.length ? '<span class="chip yellow">filtre</span>' : '') +
    '<p class="lead">Prend une pièce sur la case derrière lui et la dépose sur la case devant, si elle est libre.</p>' +
    '<dl class="kv"><dt>Prend sur</dt><dd>' + entLink(a.src) + '</dd><dt>Dépose sur</dt><dd>' + entLink(a.dst) + '</dd><dt>Mène à</dt><dd>' + esc(destName(a)) + '</dd><dt>Passages, 24 h</dt><dd class="num">' + sim.sum(a.moved, 24) + '</dd></dl>' +
    fSel('Ne prend que', 'arm-field', field, [['', 'tout, ou ce que les bras à filtre voisins laissent'], ['type', 'certains types de ticket'], ['priority', 'certaines priorités'], ['outcome', 'certaines issues du poste']]);
  if (field === 'type') opts = Object.keys(TYPES); else if (field === 'priority') opts = F.PRIORITIES;
  else if (field === 'outcome') { if (a.src && a.src.kind === 'station') opts = a.src.outcomes.map(function (o) { return o.name; }); else if (a.src && a.src.kind === 'depot') opts = ['done', 'reviewing']; }
  if (field) {
    f.values.forEach(function (v) { if (opts.indexOf(v) < 0) opts = opts.concat([v]); });
    h += '<div class="field"><span class="lab">Valeurs retenues</span><div class="vals">' + opts.map(function (v) { return '<button class="btn sm" data-act="arm-val" data-v="' + esc(v) + '" aria-pressed="' + (f.values.indexOf(v) >= 0) + '">' + esc(v) + '</button>'; }).join('') + '</div>' +
      (field === 'outcome' ? '<input type="text" id="f-arm-add" data-act="arm-add" placeholder="Autre issue, puis Entrée" autocomplete="off">' : '') +
      '<span class="help">' + (f.values.length ? 'Ce bras laisse passer tout le reste.' : 'Aucune valeur cochée : le bras prend tout.') + '</span></div>';
  }
  return h;
}
function beltHTML(b) {
  var n = sim.at(b.x + DX[b.dir], b.y + DY[b.dir]), ok = n && (n.kind === 'belt' || F.isBox(n)), d = sim.leadsTo(b);
  return head(b, 'Convoyeur ' + ARROW[b.dir]) +
    '<p class="lead">Une case, un ticket. Elle le pousse vers la case qu’elle vise dès que celle-ci est libre ; sinon le ticket attend ici, et ceux de derrière avec lui.</p>' +
    '<dl class="kv"><dt>Pousse vers</dt><dd>' + (ok ? entLink(n) : '<span style="color:var(--red-t)">rien : cul-de-sac</span>') + '</dd><dt>Mène à</dt><dd>' + (d ? entLink(d) : 'nulle part') + '</dd>' +
    '<dt>En ce moment</dt><dd>' + (b.item ? ticketLink(b.item.t) : 'libre') + '</dd><dt>Passages, 24 h</dt><dd class="num">' + sim.sum(b.flow, 24) + '</dd></dl>' +
    (b.takers.length ? '<p class="sub">Bras qui prélèvent ici</p><ul class="tl">' + b.takers.map(function (a) { return '<li><span class="dot hum"></span><span>' + entLink(a) + ' <small>' + esc(F.armTag(a) || 'tout') + '</small></span><span class="m">→ ' + esc(destName(a)) + '</span></li>'; }).join('') + '</ul>' : '');
}
function depotHTML(d) {
  var s = sim.zoneStats(d, 12), rank = { urgent: 0, high: 1, medium: 2, low: 3 }, list = d.items.filter(function (e) { return !e.released && e.state === 'ready'; }).sort(function (a, b) { return rank[a.t.priority] * 300 + a.since - rank[b.t.priority] * 300 - b.since; });
  var h = head(d, d.name, d.status ? '<span class="chip ' + STATUS_CHIP[d.status] + '">' + d.status + '</span>' : '') +
    '<p class="lead">Une zone : les tickets y attendent, et on peut y travailler à la main (commenter, lancer un agent ou une skill par une mention). Un bras ne prend que ce qui est libéré.</p>' +
    fText('Nom', 'dp-name', d.name) + fSel('Statut posé à l’entrée', 'dp-status', d.status, [['', 'aucun'], ['backlog', 'backlog'], ['todo', 'todo'], ['doing', 'doing'], ['reviewing', 'reviewing']]) +
    '<p class="lead">' + (sim.works(d) ? 'Statut de travail : la simulation fait arriver ici des tickets qui ont encore des gestes à faire (correction, QA, mise en prod).' : 'Statut de stock : rien à faire sur les tickets qui arrivent ici, ils attendent d’être libérés.') + '</p>' +
    '<div class="field"><span class="lab">Sortie</span><div class="seg wide"><button data-act="dp-release" data-v="manual" aria-pressed="' + (d.release === 'manual') + '">à la main</button><button data-act="dp-release" data-v="auto" aria-pressed="' + (d.release === 'auto') + '">automatique</button></div>' +
    '<span class="help">' + (d.release === 'auto' ? 'Un ticket part dès qu’il n’a plus rien à faire ici' + (d.status === 'todo' ? ' et que l’en-cours est sous la limite.' : '.') : 'Vous libérez chaque ticket. L’opérateur simulé le fait à votre place quand il est en poste.') + '</span></div>';
  if (d.release === 'auto' && d.status === 'todo') h += fRange('Limite d’en-cours', 'dp-limit', d.limit, 2, 30, 1);
  h += fRange('Largeur', 'dp-w', d.w, 2, 24, 1, ' cases') + fRange('Hauteur', 'dp-h', d.h, 2, 18, 1, ' cases') + outsHTML(d) + portsHTML(d) +
    '<p class="sub">En ce moment · 12 h</p><div class="stats">' + stat('En stock', s.ready) + stat('À relancer', s.idle) + stat('Avec un agent', s.running + s.queued) + stat('Attente / geste', dur(s.avgHuman)) + stat('Coût', money(s.cost)) + stat('Libérés', s.out) + '</div>';
  var foc = sim.focus().filter(function (f) { return f.zone === d; });
  if (foc.length) { h += '<p class="sub">À relancer</p>'; foc.slice(0, 8).forEach(function (it) { h += focusItem(it); }); }
  if (list.length) h += '<p class="sub">' + plural(list.length, 'ticket') + ' en stock</p>';
  list.slice(0, 10).forEach(function (e) {
    h += '<div class="fitem"><div class="l1">' + typeChip(e.t) + '<span class="chip">' + e.t.priority + '</span><span class="age">' + dur(sim.now - e.since) + '</span></div>' + ticketLink(e.t) +
      '<div class="row"><button class="btn sm" data-act="release" data-id="' + e.t.id + '">' + esc(releaseLabel(d)) + '</button></div></div>';
  });
  if (list.length > 10) h += '<p class="lead">+ ' + (list.length - 10) + ' autres : ouvrez la zone pour tout voir.</p>';
  return h;
}
function outsideHTML(n) {
  var h = '<p class="sub">Dans Fleex classique · ' + sim.outside.length + '</p>';
  if (!sim.outside.length) return h + '<p class="lead">Aucun ticket hors Factory pour l’instant. Coupez le transfert d’un intake, ou rendez un ticket à Fleex, pour en voir ici.</p>';
  sim.outside.slice(-n).reverse().forEach(function (t) {
    h += '<div class="fitem"><div class="l1">' + typeChip(t) + '<span class="chip">' + esc(t.sourceName) + '</span></div>' + ticketLink(t) + '<div class="row"><button class="btn sm" data-act="transfer" data-id="' + t.id + '">Transférer à la Factory</button></div></div>';
  });
  return h;
}
function intakeHTML(s) {
  return head(s, s.name, '<span class="chip ' + (s.transfer ? 'green' : 'gray') + '">' + (s.transfer ? 'transféré' : 'hors factory') + '</span>') +
    '<p class="lead">Une source de tickets. Elle les range dans son bac de sortie ; comme pour un poste, c’est un bras posé contre elle qui les emmène.</p>' + fText('Nom', 'in-name', s.name) +
    fSel('Source', 'in-sid', s.sid, F.SOURCES.map(function (x) { return [x.id, x.name]; })) +
    '<div class="row"><button class="switch" role="switch" data-act="in-transfer" aria-checked="' + s.transfer + '"><i></i>Transférer à la Factory</button></div>' +
    '<p class="lead">' + (s.transfer ? 'Les tickets de cette source portent le flag « transféré » : leur cycle de vie se joue ici.' : 'Les tickets de cette source restent dans Fleex classique (' + s.kept + ' depuis la coupure). Rien n’arrive sur le plan.') + '</p>' +
    '<div class="row"><button class="switch" role="switch" data-act="in-on" aria-checked="' + s.on + '"><i></i>Source active</button></div>' +
    fRange('Tickets par jour', 'in-rate', Math.round(s.perDay), 0, 40, 1) +
    '<div class="field"><span class="lab">Déposer un ticket maintenant</span><div class="row">' + Object.keys(TYPES).map(function (k) { return '<button class="btn sm" data-act="inject" data-type="' + k + '">' + k + '</button>'; }).join('') + '</div></div>' +
    outsHTML(s) + '<dl class="kv"><dt>Emmenés, 24 h</dt><dd class="num">' + sim.sum(s.emitted, 24) + '</dd><dt>Dans le bac de sortie</dt><dd class="num">' + s.buffer.length + '</dd></dl>' + outsideHTML(6);
}
function exitHTML(e) {
  return head(e, e.name, '<span class="chip green">done</span>') + '<p class="lead">Tout ce qui arrive ici passe en done et quitte le plan. Un convoyeur peut y aboutir, un bras peut y déposer.</p>' +
    fText('Nom', 'ex-name', e.name) + fRange('Largeur', 'ex-w', e.w, 1, 12, 1, ' cases') + fRange('Hauteur', 'ex-h', e.h, 1, 38, 1, ' cases') + portsHTML(e) +
    '<dl class="kv"><dt>Expédiés, 24 h</dt><dd class="num">' + sim.sum(e.count, 24) + '</dd></dl>' +
    '<p class="sub">Derniers expédiés</p>' + sim.recent.slice(-6).reverse().map(function (t) { return '<div class="fitem">' + ticketLink(t) + '<div class="where">' + hhmm(t.doneAt) + ' · ' + money(t.cost) + ' · ' + plural(t.touches, 'intervention') + '</div></div>'; }).join('');
}
function poolHTML() {
  var p = sim.pool, sat = sim.sum(p.fullMin, 12) / (sim.span(12) * 60);
  return '<div class="row"><span class="chip">Slots agents</span><span class="spacer"></span><button class="btn sm ghost" data-act="pin">Épingler</button></div><h2 class="h">agentMaxConcurrency</h2>' +
    '<p class="lead">La seule file d’attente côté agents : un run prend un slot, un panel en prend trois. Elle est commune à tous les postes et aux mentions lancées dans les zones.</p>' +
    fRange('Slots', 'pool-max', p.max, 2, 32, 1) + '<div class="stats">' + stat('Occupés', p.used + ' / ' + p.max) + stat('Plein, 12 h', pct(sat)) + stat('Agent·h, 12 h', (sim.sum(p.usedMin, 12) / 60).toFixed(1)) + '</div>';
}
function operatorHTML() {
  var op = sim.op;
  return '<div class="row"><span class="chip">Opérateur simulé</span></div><h2 class="h">Quelqu’un qui clique à votre place</h2>' +
    '<p class="lead">Pour que la maquette tourne seule : il traite Focus, garnit le todo et lance un ticket quand l’en-cours est sous la limite. En poste de 9:00 à 12:30 et de 13:30 à 18:30. Le pointeur blanc montre ce qu’il traite.</p>' +
    '<div class="row"><button class="switch" role="switch" data-act="op-toggle" aria-checked="' + op.enabled + '"><i></i>Activé</button></div>' + fRange('Limite d’en-cours', 'op-wip', op.wipLimit, 2, 30, 1) +
    '<div class="stats">' + stat('Traités, 12 h', sim.sum(op.handled, 12)) + stat('État', op.state === 'work' ? 'occupé' : sim.opAvailable() ? 'en poste' : 'absent') + '</div>';
}
function labelHTML(e) {
  return head(e, e.text) + fText('Texte', 'lb-text', e.text) + fSel('Couleur', 'lb-color', e.color, [['#a1a1aa', 'gris'], ['#c084fc', 'violet'], ['#60a5fa', 'bleu'], ['#4ade80', 'vert'], ['#facc15', 'jaune'], ['#fb923c', 'orange'], ['#f87171', 'rouge']]);
}
/* ---------- a ticket's thread and timeline, as Tasks and Focus would show them ---------- */
var WHO = { you: 'Vous', op: 'Opérateur simulé', auto: 'Automatique' };
function stamp(at) { return at < 0 ? 'avant J1' : 'J' + (Math.floor(at / 1440) + 1) + ' ' + hhmm(at); }
function threadHTML(t, max) {
  var log = t.log, h = '<div class="thread">', i0 = max && log.length > max ? log.length - max : 0, i;
  if (i0) h += '<div class="msg sys"><span>… ' + i0 + ' messages plus anciens : ouvrez le ticket pour tout lire</span></div>';
  for (i = i0; i < log.length; i++) {
    var l = log[i], meta = (l.dur >= 1 ? dur(l.dur) : '') + (l.cost ? (l.dur >= 1 ? ' · ' : '') + money(l.cost) : '');
    if (l.who === 'system' || l.auto) h += '<div class="msg sys' + (l.k === 'error' ? ' err' : '') + '"><span>' + esc(l.text) + (l.auto ? ' · automatique' : '') + '</span><time>' + stamp(l.at) + '</time></div>';
    else if (l.who === 'agent') h += '<div class="msg agent' + (l.k === 'question' ? ' q' : l.back ? ' back' : '') + '"><div class="au"><b>' + esc(l.author || 'agent') + '</b>' + (l.model && MODELS[l.model] ? '<span>' + MODELS[l.model].label + '</span>' : '') +
      (l.k === 'question' ? '<span class="chip blue">question</span>' : '') + '<time>' + stamp(l.at) + '</time></div><p>' + esc(l.text) + '</p>' + (meta ? '<div class="meta">' + (l.step ? esc(l.step) + ' · ' : '') + meta + '</div>' : '') + '</div>';
    else h += '<div class="msg human"><div class="au"><b>' + WHO[l.who] + '</b>' + (l.k === 'gate' ? '<span class="chip ' + (l.back ? 'orange' : 'green') + '">gate</span>' : l.k === 'mention' ? '<span class="chip blue">mention</span>' : '') +
      '<time>' + stamp(l.at) + '</time></div><p>' + esc(l.text) + '</p>' + (l.wait > 1 ? '<div class="meta">après ' + dur(l.wait) + ' d’attente</div>' : '') + '</div>';
  }
  if (live(t)) { var st = stateOf(t); h += '<div class="msg sys now"><span><i style="color:' + st.c + ';font-style:normal">●</i> ' + esc(whereIs(t)) + '</span></div>'; }
  return h + '</div>';
}
function composerHTML(t) {
  if (!live(t)) return '';
  var h = holder(t), m = '';
  if (h.k === 'depot' && !h.it.released && (h.it.state === 'idle' || h.it.state === 'ready')) m = '<div class="row"><span class="where">Lancer ici :</span>' + [['fixbug', '@agent:builder'], ['deploy', '@skill:deploy'], ['chore', '@skill:maintenance']].map(function (x) {
    return '<button class="btn sm" data-act="mention" data-v="' + x[0] + '" data-id="' + t.id + '" title="' + esc(GEST[x[0]].n) + ' : l’agent travaille sur le ticket sans qu’il quitte ' + esc(h.e.name) + '">' + x[1] + '</button>'; }).join('') + '</div>';
  else if (h.k === 'depot' || h.k === 'cell' || h.k === 'rack') m = '';
  return m + '<div class="composer"><input type="text" id="f-comment" data-act="comment" data-id="' + t.id + '" placeholder="Commenter ce ticket…" autocomplete="off" aria-label="Commenter ce ticket"><button class="btn sm" data-act="comment-send" data-id="' + t.id + '">Envoyer</button></div>';
}
function timelineHTML(t) {
  var h = '<ul class="tl">';
  t.log.forEach(function (l) {
    var c = l.k === 'error' || l.back ? 'ko' : l.who === 'you' || l.who === 'op' ? 'hum' : l.who === 'agent' ? '' : 'sys';
    h += '<li><span class="dot ' + c + '"></span><span>' + esc(l.k === 'run' || l.k === 'question' ? (l.step || l.author) + (l.k === 'question' ? ' · question' : '') : l.text) +
      (l.who === 'op' ? ' <small>opérateur simulé</small>' : l.who === 'you' ? ' <small>vous</small>' : l.auto ? ' <small>auto</small>' : '') + '</span><span class="m">' + stamp(l.at) + (l.dur >= 1 ? ' · ' + dur(l.dur) : '') + (l.cost ? ' · ' + money(l.cost) : '') + '</span></li>';
  });
  return h + '</ul>';
}
function timeBar(t) {
  var end = t.status === 'done' ? t.doneAt : sim.now, total = Math.max(1, end - t.born), parts = [['Agents', t.agentMin, 'var(--s1)'], ['File de slots', t.slotWait, 'var(--s2)'], ['Attente d’un humain', t.humanWait, 'var(--s4)']], used = 0, h = '<div class="tbar">', lg = '';
  parts.forEach(function (p) { used += p[1]; }); parts.push(['En stock ou en transit', Math.max(0, total - used), '#52525b']);
  total = Math.max(total, used);
  parts.forEach(function (p) { if (p[1] / total > 0.004) h += '<i style="width:' + (p[1] / total * 100).toFixed(1) + '%;background:' + p[2] + '" data-tip="' + p[0] + ' : ' + dur(p[1]) + '"></i>'; lg += '<span><i style="background:' + p[2] + '"></i>' + p[0] + ' · ' + dur(p[1]) + '</span>'; });
  return h + '</div><div class="lg">' + lg + '</div>';
}
function ticketKV(t) {
  return '<dl class="kv"><dt>Source</dt><dd>' + esc(t.sourceName) + (t.parent ? ' · issu de ' + t.parent : '') + '</dd><dt>Coût cumulé</dt><dd class="num">' + money(t.cost) + '</dd>' +
    (t.firstDoingAt ? '<dt>' + (t.status === 'done' ? 'Cycle' : 'En cours depuis') + '</dt><dd class="num">' + dur((t.status === 'done' ? t.doneAt : sim.now) - t.firstDoingAt) + '</dd>' : '') + '<dt>Âge</dt><dd class="num">' + dur((t.status === 'done' ? t.doneAt : sim.now) - t.born) + '</dd>' +
    '<dt>Attente humaine</dt><dd class="num">' + dur(t.humanWait) + ' · ' + plural(t.touches, 'intervention') + '</dd><dt>File de slots</dt><dd class="num">' + dur(t.slotWait) + '</dd>' +
    '<dt>Retours en arrière</dt><dd class="num">' + t.reworks + '</dd><dt>Complexité</dt><dd class="num">' + t.complexity + '</dd></dl>';
}
function managedHTML(t) {
  if (live(t)) return '<div class="managed"><b>Managé par la Factory</b><p>Ce ticket porte le flag « transféré ». Son cycle de vie se joue ici : dans Tasks et Focus il s’affiche avec ce bandeau, en lecture seule, et ce fil y est le sien.</p>' +
    '<div class="row"><button class="btn sm" data-act="giveback" data-id="' + t.id + '">Rendre à Fleex classique</button></div></div>';
  if (t.status !== 'done') return '<div class="managed off"><b>Dans Fleex classique</b><p>Ce ticket n’est pas transféré : il suit le fonctionnement habituel de Fleex (workflows, mentions), sans passer par le plan.</p>' +
    '<div class="row"><button class="btn sm primary" data-act="transfer" data-id="' + t.id + '">Transférer à la Factory</button></div></div>';
  return '';
}
function ticketHTML(t) {
  var inF = live(t), tr = inF ? sim.trace(t) : null, acts = inF ? ticketActions(t) : '', tab = ui.tkTab || 'thread';
  var h = '<div class="row">' + statusChip(t) + typeChip(t) + '<span class="chip">' + t.priority + '</span>' + (t.reworks ? '<span class="chip orange">' + plural(t.reworks, 'retour') + '</span>' : '') + '<span class="spacer"></span>' +
    '<button class="btn sm primary" data-act="open-ticket" data-id="' + t.id + '" title="Discussion, timeline et détails en grand (V ou double-clic)">Ouvrir</button></div>' +
    '<h2 class="h"><span class="num" style="color:var(--t2);font-size:12px">' + t.displayId + '</span><br>' + esc(t.title) + '</h2><p class="lead">' + esc(whereIs(t)) + '</p>';
  if (acts) h += '<div class="row">' + acts + '</div>';
  if (tr && tr.dest) h += '<p class="lead">Si rien ne change, il va vers : <b style="color:var(--t1)">' + esc(tr.dest) + '</b>.</p>';
  h += '<div class="seg wide">' + [['thread', 'Discussion'], ['timeline', 'Timeline'], ['details', 'Détails']].map(function (x) { return '<button data-act="tk-tab" data-v="' + x[0] + '" aria-pressed="' + (tab === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
  if (tab === 'thread') h += threadHTML(t, 14) + composerHTML(t);
  else if (tab === 'timeline') h += timeBar(t) + timelineHTML(t);
  else h += managedHTML(t) + (inF ? '<div class="row"><button class="btn sm" data-act="pin">Épingler</button><button class="btn sm" data-act="follow" aria-pressed="' + (view.follow === t) + '">' + (view.follow === t ? 'Suivi en cours' : 'Suivre') + '</button><span class="where">Glissez-le sur le plan pour le déplacer</span></div>' : '') + ticketKV(t);
  return h;
}
function openTicket(t) { if (!t) return; ui.box = null; ui.boxT = t; ui.boxHead = ui.boxBody = ''; $('#modal').hidden = false; tipHide(); boxRender(true); var b = $('#modal-body'), th = b.querySelector('.thread'); b.scrollTop = 0; if (th) th.scrollTop = th.scrollHeight; }
function ticketBoxHTML(t) {
  var st = stateOf(t), acts = live(t) ? ticketActions(t) : '';
  var head = '<div class="portrait" style="width:44px;height:44px;border-color:' + st.c + '"><span class="sq" style="width:22px;height:22px;background:' + (t.triaged ? TYPES[t.type].color : '#8b949e') + '"></span></div><div style="min-width:0;flex:1 1 320px"><h2><span class="num" style="color:var(--t2);font-size:13px;font-weight:500;margin-right:8px">' + t.displayId + '</span>' + esc(t.title) + '</h2>' +
    '<div class="row" style="gap:5px;margin-top:3px">' + statusChip(t) + typeChip(t) + '<span class="chip">' + t.priority + '</span>' + (t.reworks ? '<span class="chip orange">' + plural(t.reworks, 'retour') + '</span>' : '') + '<span class="where"><span style="color:' + st.c + '">●</span> ' + esc(whereIs(t)) + '</span></div></div>' +
    (acts ? '<div class="row">' + acts + '</div>' : '') + (live(t) ? '<button class="btn sm" data-act="box-see">Voir sur le plan</button>' : '') + '<button class="btn sm" data-act="box-close" title="Fermer (Échap)">Fermer</button>';
  var body = '<div class="tk2"><section class="col"><h3>Discussion<b>' + t.log.length + '</b></h3>' + threadHTML(t) + composerHTML(t) + '</section>' +
    '<section class="tkside">' + managedHTML(t) + '<div class="col"><h3>Où est passé le temps</h3>' + timeBar(t) + '</div><div class="col"><h3>Détails</h3>' + ticketKV(t) + '</div><div class="col"><h3>Timeline<b>' + t.log.length + '</b></h3>' + timelineHTML(t) + '</div></section></div>';
  return { head: head, body: body };
}
function ticketsHTML(list) {
  var h = '<div class="row"><span class="chip blue">' + list.length + ' tickets</span><span class="spacer"></span><button class="btn sm" data-act="pin">Épingler</button></div><p class="lead">Maj+clic ajoute ou retire un ticket. Maj+1…6 enregistre ce groupe, 1…6 le rappelle.</p>';
  list.forEach(function (t) {
    var s = stateOf(t), a = live(t) ? ticketActions(t) : '';
    h += '<div class="fitem"><div class="l1">' + typeChip(t) + '<span class="chip" style="color:' + s.c + '">' + esc(s.w) + '</span><span class="age">' + money(t.cost) + '</span></div>' + ticketLink(t) +
      '<div class="row">' + a + '<button class="btn sm ghost" data-act="unselect" data-id="' + t.id + '">Retirer</button></div></div>';
  });
  return h;
}
function overviewHTML() {
  var n = {}; sim.ents.forEach(function (e) { n[e.kind] = (n[e.kind] || 0) + 1; });
  return '<p class="lead">Cliquez un élément du plan : ticket, poste, bras, case de convoyeur, zone, intake. Tout se sélectionne et se règle ici. Glissez un ticket pour le déposer ailleurs.</p>' +
    '<div class="stats">' + stat('Dans la Factory', sim.tickets.size) + stat('Fleex classique', sim.outside.length) + stat('Au sol', sim.loose.length) +
    stat('Postes', n.station || 0) + stat('Bras', n.arm || 0) + stat('Convoyeurs', n.belt || 0) + '</div>' +
    '<div class="row"><button class="btn sm primary" data-act="mode-edit">Construire</button><button class="btn sm ghost" data-act="op-settings">Opérateur simulé</button></div>' + outsideHTML(8);
}
function inspectHTML() {
  var s = ui.sel;
  if (!s) return overviewHTML();
  if (s.type === 'ticket') return ticketHTML(s.t);
  if (s.type === 'tickets') return ticketsHTML(s.list);
  if (s.type === 'operator') return operatorHTML();
  var e = s.e, k = e.kind;
  return k === 'station' ? stationHTML(e) : k === 'arm' ? armHTML(e) : k === 'belt' ? beltHTML(e) : k === 'depot' ? depotHTML(e) : k === 'intake' ? intakeHTML(e) : k === 'exit' ? exitHTML(e) : k === 'pool' ? poolHTML() : labelHTML(e);
}

/* ---------- panel: objectives ---------- */
function goalsHTML() {
  var done = sim.objectives.filter(function (o) { return o.done; }).length, k = ui.k || sim.kpis();
  var levels = ['Atelier', 'Manufacture', 'Usine', 'Usine autonome'], lv = done >= 6 ? 3 : done >= 4 ? 2 : done >= 2 ? 1 : 0;
  var h = '<div class="level"><div class="row"><span class="n">Niveau ' + (lv + 1) + ' · ' + levels[lv] + '</span><span class="spacer"></span><span class="num">' + done + ' / ' + sim.objectives.length + '</span></div>' +
    '<div class="prog" style="margin-top:8px"><i style="width:' + (done / sim.objectives.length * 100) + '%;background:var(--hazard)"></i></div>' +
    '<p class="lead" style="margin-top:8px">' + pct(k.benchShare) + ' du temps d’un ticket se passe dans une zone de travail · ' + pct(k.autonomy) + ' des tickets sortent sans intervention · ' + plural(k.escapes24, 'défaut') + ' échappé' + (k.escapes24 > 1 ? 's' : '') + ' en 24 h</p></div>';
  sim.objectives.forEach(function (o) {
    var v = o.value || o.eval(), p = o.done ? 1 : v[2] ? v[0] / v[1] : o.lower ? clamp(v[1] / Math.max(v[0], 0.01), 0, 1) : clamp(v[0] / v[1], 0, 1);
    h += '<div class="obj' + (o.done ? ' done' : '') + '"><div class="o1"><span class="check">' + (o.done ? '✓' : '') + '</span><b>' + esc(o.name) + '</b><span class="v">' + (o.done ? 'atteint' : o.fmt(v)) + '</span></div>' +
      '<div style="color:var(--t2);font-size:12px">' + esc(o.desc) + '</div><div class="prog"><i style="width:' + Math.round(p * 100) + '%"></i></div></div>';
  });
  var log = sim.log.slice(-7).reverse();
  if (log.length) { h += '<p class="sub">Journal de l’usine</p><ul class="log">'; log.forEach(function (l) { h += '<li><time>' + hhmm(l.at) + '</time>' + esc(l.text) + '</li>'; }); h += '</ul>'; }
  return h;
}

function panel(force) {
  if (ui.hold && !force) return;
  var body = $('#pbody'), ae = document.activeElement, typing = ae && body.contains(ae) && (ae.tagName === 'SELECT' || (ae.tagName === 'INPUT' && ae.type !== 'range'));
  if (!force && typing) return;
  if (ui.sel && ui.sel.type === 'ent' && sim.ents.indexOf(ui.sel.e) < 0) { ui.sel = view.sel = null; }
  var html = ui.tab === 'bottlenecks' ? bnHTML() : ui.tab === 'focus' ? focusHTML() : ui.tab === 'goals' ? goalsHTML() : inspectHTML();
  if (html === ui.lastHtml) return;
  var fid = ae && body.contains(ae) ? ae.id : '', pos = fid && ae.selectionStart != null && ae.type === 'text' ? ae.selectionStart : -1;
  ui.lastHtml = html; body.innerHTML = html;
  if (fid) { var el = document.getElementById(fid); if (el) { el.focus(); if (pos >= 0) try { el.setSelectionRange(pos, pos); } catch (err) {} } }
}

function applied(text) { ui.applied.push({ at: sim.now, text: text, k: ui.k || sim.kpis() }); toast('Réglage appliqué : ' + text); }
function onPanel(e) {
  var b = e.target.closest('[data-act]'); if (!b) return;
  var act = b.dataset.act, s = ui.sel, en = selEnt(), list, it, t, i, isField = b.tagName === 'SELECT' || b.tagName === 'INPUT';
  if (e.type === 'click' && isField) return;
  if (e.type !== 'click' && !isField) return;
  if (act === 'ticket') { t = findTicket(+b.dataset.id); if (!t) return; if (ui.box) { select({ type: 'ticket', t: t }, false); openTicket(t); } else { if (ui.boxT) closeBox(); select({ type: 'ticket', t: t }, true); } return; }
  if (act === 'mention') { t = findTicket(+b.dataset.id); if (t && t.loc && t.loc.kind === 'depot' && sim.mention(t.loc, t, b.dataset.v)) toast(t.displayId + ' : ' + GEST[b.dataset.v].n + ' lancé'); panel(true); boxRender(true); cmdRender(); return; }
  if (act === 'open-ticket') { openTicket(findTicket(+b.dataset.id)); return; }
  if (act === 'tk-tab') { ui.tkTab = b.dataset.v; panel(true); return; }
  if (act === 'comment-send' || (act === 'comment' && e.type === 'change')) { var ci = act === 'comment' ? b : b.parentNode.querySelector('input'), ct = findTicket(+b.dataset.id); if (ct && ci.value.trim()) { sim.comment(ct, ci.value.trim()); ci.value = ''; ci.blur(); panel(true); boxRender(true); } return; }
  if (act === 'comment') return;
  if (act === 'ent') { var x = entById(+b.dataset.id); if (ui.box) closeBox(); if (x) select({ type: 'ent', e: x }, true); return; }
  if (act === 'box-close') { closeBox(); return; }
  if (act === 'box-see') { var be = ui.box, bt = ui.boxT; closeBox(); if (be) select({ type: 'ent', e: be }, true); else if (bt) select({ type: 'ticket', t: bt }, true); return; }
  if (act === 'box-filter') { ui.boxFilter = b.dataset.v; boxRender(true); return; }
  if (act === 'box-sort') { ui.boxSort = b.dataset.v; boxRender(true); return; }
  if (act === 'open') { openBox(en); return; }
  if (act === 'op-settings') { select({ type: 'operator' }, false); return; }
  if (act === 'pin') { saveGroup(-1); return; }
  if (act === 'mode-edit') { setMode('edit'); return; }
  if (act === 'unselect') { var tu = findTicket(+b.dataset.id); if (tu) toggleTicket(tu); return; }
  /* text and number fields: applied as you type, the panel is left alone until you leave the field */
  if (isField && (b.type === 'text' || b.type === 'number')) {
    var v = b.value;
    if (act === 'arm-add') { if (e.type === 'change' && v.trim() && en) { if (!en.filter) en.filter = { field: 'outcome', values: [] }; if (en.filter.values.indexOf(v.trim()) < 0) en.filter.values.push(v.trim()); b.value = ''; dirty(); b.blur(); panel(true); } return; }
    if (!en) return;
    if (act === 'oc-name') { i = +b.dataset.i; var old = en.outcomes[i].name, nv = v.trim() || old; en.outcomes[i].name = nv;
      en.takers.forEach(function (a) { if (a.filter && a.filter.field === 'outcome') { var k = a.filter.values.indexOf(old); if (k >= 0) a.filter.values[k] = nv; } }); }
    else if (act === 'oc-p') en.outcomes[+b.dataset.i].p = clamp(+v || 0, 0, 60) / 100;
    else if (act === 'st-ref') en.ref = v;
    else if (act === 'lb-text') en.text = v || 'Zone';
    else en.name = v || KIND_NAME[en.kind];
    dirty(); return;
  }
  if (b.type === 'range') {
    var lb = b.parentNode.querySelector('.num'); if (lb) lb.textContent = b.value;
    if (act === 'pool-max') sim.pool.max = +b.value;
    else if (act === 'op-wip') sim.op.wipLimit = +b.value;
    else if (!en) return;
    else if (act === 'dp-limit') en.limit = +b.value;
    else if (act === 'st-cap') en.cap = +b.value;
    else if (act === 'in-rate') en.perDay = +b.value;
    else if (act === 'dp-w' || act === 'ex-w') { if (!sim.resize(en, +b.value, en.h)) { b.value = en.w; if (lb) lb.textContent = en.w; } }
    else if (act === 'dp-h' || act === 'ex-h') { if (!sim.resize(en, en.w, +b.value)) { b.value = en.h; if (lb) lb.textContent = en.h; } }
    dirty(); return;
  }
  if (act === 'bn-see') {
    var c = ui.cards[+b.dataset.i]; if (!c) return;
    if (c.ref) { ui.sel = view.sel = { type: 'ent', e: c.ref }; view.lookAt(c.ref.x + c.ref.w / 2, c.ref.y + c.ref.h / 2, Math.max(view.cam.z, c.ref.w > 5 || c.ref.h > 5 ? 16 : 26)); }
    else if (c.loose) { ui.sel = view.sel = { type: 'ticket', t: c.loose.t }; view.lookAt(c.loose.x + 0.5, c.loose.y + 0.5, Math.max(view.cam.z, 26)); }
    if (ui.narrow) $('#panel').classList.add('closed');
  } else if (act === 'bn-fix') {
    var cf = ui.cards[+b.dataset.i]; if (!cf || !cf.fix) return;
    if (cf.edit === 'deploy') { setMode('edit'); setTool('st:skill', DEPLOY); toast('Poste Deploy prêt : cliquez sur le chemin, avant la finition. Posé sur un convoyeur, il le remplace ; ajoutez un bras à sa sortie.'); if (cf.ref) view.lookAt(cf.ref.x - 4, cf.ref.y + cf.ref.h / 2, 24); return; }
    cf.fix.apply(); applied(cf.title + ' : ' + cf.fix.label); dirty();
  } else if (act === 'resolve') {
    list = sim.focus(); it = list.filter(function (f) { return f.key === b.dataset.key; })[0];
    if (it && sim.resolve(it, b.dataset.do)) {
      var d = b.dataset.do, a = it.st && it.kind === 'gate' ? armFor(it.st, d) : null;
      toast(it.t.displayId + ' : ' + (it.kind === 'gate' ? d + (a ? ', sort vers ' + destName(a) : ' : aucun bras ne prend cette issue, il reste dans le bac') :
        { answer: 'réponse envoyée, l’agent reprend', retry: 'étape relancée', next: it.g && it.g.k === 'human' ? it.g.n + ' faite' : (it.g ? it.g.n : '') + ' lancé', done: 'clos' }[d]));
    }
  } else if (act === 'approve-all') {
    list = sim.focus().filter(function (f) { return f.kind === 'gate'; });
    list.forEach(function (f) { sim.resolve(f, f.st.outcomes[0].name); });
    toast(list.length + ' gates approuvées');
  } else if (act === 'release') {
    t = findTicket(+b.dataset.id);
    if (t && t.loc && t.loc.kind === 'depot') { var dp = t.loc; if (sim.release(dp, t)) toast(t.displayId + (dp.status === 'todo' ? ' lancé' : ' libéré') + (dp.takers.length ? '' : ' : aucun bras ne sort de ' + dp.name + ', il y reste')); }
  } else if (act === 'giveback') { t = findTicket(+b.dataset.id); if (t && live(t)) { sim.giveBack(t); toast(t.displayId + ' rendu à Fleex classique : il quitte le plan'); } }
  else if (act === 'transfer') { t = findTicket(+b.dataset.id); if (t && sim.transferIn(t)) { toast(t.displayId + ' transféré à la Factory : il entre par l’intake ' + t.sourceName); select({ type: 'ticket', t: t }, false); } }
  else if (act === 'op-toggle') { sim.op.enabled = !sim.op.enabled; toast(sim.op.enabled ? 'Opérateur simulé activé' : 'Opérateur simulé désactivé : à vous de traiter Focus et de lancer les todos'); }
  else if (act === 'follow' && s && s.type === 'ticket') { view.follow = view.follow === s.t ? null : s.t; if (view.follow) { view.goal = null; if (view.cam.z < 22) view.cam.z = 22; } }
  else if (act === 'scenario') scenario(b.dataset.sc);
  else if (!en) return;
  else if (act === 'rotate') rotate(en);
  else if (act === 'delete') { begin(); eraseEnt(en); commit(); return; }
  else if (act === 'policy') { if (en.policy !== b.dataset.v) { en.policy = b.dataset.v; applied(en.name + ' en contrôle ' + POLICY[b.dataset.v]); } }
  else if (act === 'st-model') { en.model = b.value; applied(en.name + ' sur ' + MODELS[b.value].label); b.blur(); }
  else if (act === 'st-exec') {
    var pr = PRESETS[b.value]; en.exec = b.value; en.policy = b.value === 'human_gate' ? 'human' : null;
    if (b.value === 'human_gate') { en.review = pr.review; if (en.outcomes.length < 2) en.outcomes = clone(pr.outcomes).map(function (o) { return { name: o.name, p: o.p || 0, k: o.k || 0 }; }); }
    else { en.model = en.model || pr.model; en.dur = en.dur || pr.dur; en.cost = en.cost || pr.cost; en.ref = en.ref || pr.ref; }
    b.blur();
  } else if (act === 'st-sets') { en.sets = b.value; en.ref = 'ticket.set_status → ' + b.value; b.blur(); }
  else if (act === 'oc-add') { var nm = 'issue-' + (en.outcomes.length + 1); en.outcomes.push({ name: nm, p: 0.1, k: 0 }); toast('Issue « ' + nm + ' » ajoutée : posez un bras filtré sur cette issue pour lui donner une sortie'); }
  else if (act === 'oc-del') en.outcomes.splice(+b.dataset.i, 1);
  else if (act === 'arm-field') { en.filter = b.value ? { field: b.value, values: [] } : null; b.blur(); }
  else if (act === 'arm-val') { if (en.filter) { i = en.filter.values.indexOf(b.dataset.v); if (i >= 0) en.filter.values.splice(i, 1); else en.filter.values.push(b.dataset.v); } }
  else if (act === 'dp-status') { en.status = b.value; b.blur(); }
  else if (act === 'dp-release') en.release = b.dataset.v;
  else if (act === 'in-transfer') { en.transfer = !en.transfer; toast(en.transfer ? en.name + ' : les nouveaux tickets sont transférés à la Factory' : en.name + ' : les nouveaux tickets restent dans Fleex classique'); }
  else if (act === 'in-on') en.on = !en.on;
  else if (act === 'in-sid') { var src = F.SOURCES.filter(function (x) { return x.id === b.value; })[0]; if (en.name === en.def.name) en.name = src.name; en.sid = src.id; en.def = src; b.blur(); }
  else if (act === 'inject') { var nt = sim.inject(en.sid, b.dataset.type); if (nt) toast(nt.displayId + ' déposé à l’intake ' + en.name); }
  else if (act === 'lb-color') { en.color = b.value; b.blur(); }
  dirty(); heat(); panel(true); hud(); cmdRender(); selInfo(); boxRender(true);
}
function scenario(name) {
  if (name === 'ticket') { var t = sim.inject('cli'); if (!t) { toast('Aucun intake sur le plan'); return; } toast(t.displayId + ' déposé depuis ' + t.sourceName); select({ type: 'ticket', t: t }, false); return; }
  sim.scenario(name);
}

/* ---------- editing the floor ---------- */
function dirty() { ui.dirty = true; clearTimeout(dirty.t); dirty.t = setTimeout(save, 400); }
function save() { if (!ui.dirty) return; try { localStorage.setItem(LS, JSON.stringify(sim.layout())); } catch (err) {} }
function begin() { if (!ui.batch) ui.batch = []; }
function rec(op) { if (ui.batch) ui.batch.push(op); }
function commit() {
  var b = ui.batch; ui.batch = null;
  if (b && b.length) { ui.undo.push(b); if (ui.undo.length > 80) ui.undo.shift(); sim.session.edits++; dirty(); cmdRender(); }
  heat(); panel(true); tray();
}
function undo() {
  var b = ui.undo.pop(); if (!b) { toast('Rien à annuler'); return; }
  for (var i = b.length - 1; i >= 0; i--) {
    var op = b[i];
    if (op.k === 'add') { if (sim.ents.indexOf(op.e) >= 0) sim.remove(op.e); }
    else if (op.k === 'del') sim.put(op.spec);
    else if (sim.ents.indexOf(op.e) < 0) continue;
    else if (op.k === 'move') sim.move(op.e, op.x, op.y);
    else if (op.k === 'dir') { op.e.dir = op.dir; sim.wire(); }
  }
  if (selEnt() && sim.ents.indexOf(selEnt()) < 0) select(null);
  dirty(); cmdRender(); heat(); panel(true); toast('Annulé');
}
function eraseEnt(e) {
  if (!e || sim.ents.indexOf(e) < 0) return;
  if (e.kind === 'pool') { toast('Les slots agents se règlent, ils ne se retirent pas'); return; }
  var n = sim.ticketsIn(e).length;
  rec({ k: 'del', spec: sim.spec(e) }); sim.remove(e);
  if (n) toast(plural(n, 'ticket') + ' posé' + (n > 1 ? 's' : '') + ' au sol : déposez-les sur une machine');
  if (selEnt() === e) { ui.sel = view.sel = null; }
}
function rotate(e) { begin(); rec({ k: 'dir', e: e, dir: e.dir }); e.dir = (e.dir + 1) % 4; sim.wire(); commit(); }
function specFor(x, y) {
  var t = ui.tool, s, sz;
  if (t === 'belt' || t === 'arm') return { kind: t, x: x, y: y, dir: ui.dir };
  if (t.slice(0, 3) === 'st:') { s = clone(ui.preset || PRESETS[t.slice(3)]); s.kind = 'station'; sz = sim.sizeOf(s); s.x = x - (sz[0] >> 1); s.y = y - (sz[1] >> 1); return s; }
  if (t === 'depot') return { kind: 'depot', x: x - 1, y: y - 1, w: 4, h: 4, name: 'Zone', status: '', release: 'manual' };
  if (t === 'intake') { var used = sim.ents.filter(function (e) { return e.kind === 'intake'; }).map(function (e) { return e.sid; }), free = F.SOURCES.filter(function (q) { return used.indexOf(q.id) < 0; })[0] || F.SOURCES[0];
    return { kind: 'intake', x: x, y: y, sid: free.id }; }
  if (t === 'exit') return { kind: 'exit', x: x - 1, y: y - 1, w: 3, h: 3, name: 'Sortie' };
  return { kind: 'label', x: x, y: y, text: 'Zone', color: '#a1a1aa' };
}
/* a machine may land on belt tiles: it takes their place */
function canPlace(s) {
  var sz = sim.sizeOf(s), i, j, e;
  for (j = s.y; j < s.y + sz[1]; j++) for (i = s.x; i < s.x + sz[0]; i++) {
    if (i < 0 || j < 0 || i >= sim.W || j >= sim.H) return false;
    e = sim.at(i, j); if (e && e.kind !== 'belt') return false;
  }
  return true;
}
function place(s) {
  if (!canPlace(s)) return null;
  var sz = sim.sizeOf(s), i, j, e;
  for (j = s.y; j < s.y + sz[1]; j++) for (i = s.x; i < s.x + sz[0]; i++) {
    e = sim.at(i, j); if (!e) continue;
    if (s.kind === 'belt') { if (e.dir !== s.dir) { rec({ k: 'dir', e: e, dir: e.dir }); e.dir = s.dir; sim.wire(); } return e; }
    eraseEnt(e);
  }
  e = sim.put(s); if (e) rec({ k: 'add', e: e });
  return e;
}
function setBelt(x, y, d) {
  var e = sim.at(x, y);
  if (e) { if (e.kind === 'belt' && e.dir !== d) { rec({ k: 'dir', e: e, dir: e.dir }); e.dir = d; sim.wire(); } return; }
  e = sim.put({ kind: 'belt', x: x, y: y, dir: d }); if (e) rec({ k: 'add', e: e });
}
function planAt(slug, tl) { var b = sim.blueprint(slug, 0, 0).box(); return sim.blueprint(slug, tl.x - b.x - (b.w >> 1), tl.y - b.y - (b.h >> 1)); }
function fits(plan) { return plan.list.every(function (s) { var z = sim.sizeOf(s); return sim.free(s.x, s.y, z[0], z[1]); }); }
function ghostFor(tl) {
  var t = ui.tool, e, s, sz;
  if (ui.mode !== 'edit' || t === 'select') return null;
  if (t === 'erase') { e = sim.at(tl.x, tl.y); return e ? { x: e.x, y: e.y, w: e.w, h: e.h, erase: true, ok: true } : { x: tl.x, y: tl.y, w: 1, h: 1, erase: true, ok: true }; }
  if (t.slice(0, 3) === 'bp:') { var pl = planAt(t.slice(3), tl), ok = fits(pl);
    return { list: pl.list.map(function (q) { var z = sim.sizeOf(q); return { x: q.x, y: q.y, w: z[0], h: z[1] }; }), ok: ok, text: ok ? 'Poser ' + BLUEPRINTS[t.slice(3)].name : 'Pas la place ici' }; }
  s = specFor(tl.x, tl.y); sz = sim.sizeOf(s);
  return { x: s.x, y: s.y, w: sz[0], h: sz[1], kind: s.kind, dir: s.dir, ok: canPlace(s) };
}
function setTool(tool, preset) { ui.tool = tool; ui.preset = preset || null; ui.menu = null; view.ghost = null; cmdRender(); selInfo(); $('#floor').classList.toggle('tool', ui.mode === 'edit' && tool !== 'select'); }
function setMode(mode) {
  if (ui.mode === mode) return;
  ui.mode = mode; view.edit = mode === 'edit'; view.ghost = null; view.dragT = null;
  if (mode === 'edit' && view.overlay !== 'none') setOverlay('none');
  ui.menu = null; $('#buildflag').hidden = mode !== 'edit';
  $('#app').classList.toggle('editing', mode === 'edit');
  var wide = view.cam.z <= ui.fitZ * 1.08;
  setTool('select'); legend(); layout(); panel(true);
  if (wide || mode === 'edit') view.fit();
  var keep = view.edit; view.edit = false; ui.fitZ = fitZoom(); view.edit = keep;
}
/* ---------- command card: what the selection can do, with its keys ---------- */
var ICON = {
  belt: '<path d="M4 8l4 4-4 4M10.5 8l4 4-4 4M17 8l3.5 4-3.5 4"/>', arm: '<circle cx="7" cy="17" r="3"/><path d="M9.2 14.8L16 8"/><path d="M13.5 6.5H18V11"/>',
  agent: '<rect x="5" y="8" width="14" height="10" rx="2.5"/><path d="M12 4v4M9.5 13h.01M14.5 13h.01"/>', skill: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  panel: '<circle cx="12" cy="8" r="2.6"/><circle cx="5.5" cy="11" r="2"/><circle cx="18.5" cy="11" r="2"/><path d="M7.5 20c0-3.2 2-5.4 4.5-5.4s4.5 2.2 4.5 5.4M2.5 19c0-2.4 1.3-4 3-4M21.5 19c0-2.4-1.3-4-3-4"/>',
  gate: '<path d="M12 3l8 3.5V12c0 4.7-3.3 7.8-8 9-4.7-1.2-8-4.3-8-9V6.5z"/><path d="M8.7 12l2.3 2.3 4.3-4.6"/>', native: '<path d="M4 12V5h7l9 9-7 7z"/><circle cx="8.5" cy="9.5" r="1.1"/>',
  depot: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>', bench: '<path d="M3 10h18M6 10v9M18 10v9M8 5.5h8V10H8z"/>',
  intake: '<path d="M4 13l3-8h10l3 8v6H4z"/><path d="M4 13h5l1 3h4l1-3h5"/>', exit: '<path d="M4 12h11M11 7l5 5-5 5"/><path d="M20 4v16"/>', label: '<path d="M5 6h14M12 6v13"/>',
  erase: '<path d="M4 16l9-9 6 6-7 7H8z"/><path d="M9.5 10.5l6 6"/>', rotate: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>', undo: '<path d="M9 7l-5 5 5 5"/><path d="M4 12h10a5 5 0 0 1 0 10h-2"/>',
  back: '<path d="M15 6l-6 6 6 6"/>', build: '<path d="M4 20h16M7 20V9l6-5v16M13 8h6v4"/>', test: '<path d="M9 3h6M10 3v6L5 19h14L14 9V3"/>', prod: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>',
  op: '<path d="M6 3l12 9-6 1 3 7-3 1-3-7-3 4z"/>', fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', open: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9.5h16"/>',
  trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>', pin: '<path d="M12 17v4M7 4h10l-2 6 3 4H6l3-4z"/>', follow: '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/>',
  play: '<path d="M7 5l12 7-12 7z"/>', check: '<path d="M5 12l5 5 9-10"/>', loop: '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/>', auto: '<circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>', flag: '<path d="M6 21V4h11l-2 4 2 4H6"/>', power: '<path d="M12 3v8"/><path d="M6.5 7a8 8 0 1 0 11 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', import: '<path d="M12 3v11M7 10l5 5 5-5M4 20h16"/>', layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v5M12 18h.01"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', doc: '<path d="M7 3h8l4 4v14H7z"/><path d="M10 12h6M10 16h6"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>', ticket: '<rect x="5" y="5" width="14" height="14" rx="3.5"/>', give: '<path d="M20 12H8M12 7l-5 5 5 5"/><path d="M4 4v16"/>',
  person: '<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/>', pool: '<circle cx="7" cy="8" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="17" cy="8" r="2"/><circle cx="7" cy="15" r="2"/><circle cx="12" cy="15" r="2"/><circle cx="17" cy="15" r="2"/>'
};
function ic(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[n] || '') + '</svg>'; }
var BUILD = [
  ['belt', 'C', 'Convoyeur', 'belt', 'Glissez pour tracer : chaque case prend la direction du geste'], ['arm', 'B', 'Bras', 'arm', 'Prend sur la case derrière lui, dépose sur la case devant. R change le sens'],
  ['erase', 'X', 'Gomme', 'erase', 'Cliquez ou glissez pour retirer'], null, null, null,
  ['st:agent', 'A', 'Agent', 'agent', 'Poste 3×3 : une persona'], ['st:skill', 'S', 'Skill', 'skill', 'Poste 3×3 : une skill'], ['st:panel', 'N', 'Panel', 'panel', 'Poste 3×3 : un panel de personas'],
  ['st:human_gate', 'G', 'Gate', 'gate', 'Poste 3×3 : une décision humaine, plusieurs issues'], ['st:native', 'T', 'Statut', 'native', 'Poste 2×2 : pose un statut sur le ticket'], null,
  ['depot', 'D', 'Zone', 'depot', 'Stock ou zone de travail : les tickets y attendent, on y commente, on y lance des mentions, on les libère'],
  ['intake', 'I', 'Intake', 'intake', 'Source de tickets : un bras posé contre elle la vide'], ['exit', 'O', 'Sortie', 'exit', 'Expédie : le ticket passe en done'], ['label', 'L', 'Étiquette', 'label', 'Un nom sur le plan'], null, null
];
var KIND_ICON = { belt: 'belt', arm: 'arm', depot: 'depot', intake: 'intake', exit: 'exit', label: 'label', pool: 'pool' };
var EXEC_ICON = { agent: 'agent', skill: 'skill', panel: 'panel', human_gate: 'gate', native: 'native' };
function entIcon(e) { return e.kind === 'station' ? EXEC_ICON[e.exec] : KIND_ICON[e.kind]; }
function isContainer(e) { return !!e && (e.kind === 'station' || e.kind === 'depot'); }
function toolTip() { for (var i = 0; i < BUILD.length; i++) if (BUILD[i] && BUILD[i][0] === ui.tool) return BUILD[i]; return null; }
function resetFloor() { try { localStorage.removeItem(LS); } catch (err) {} ui.dirty = false; startSim(null); view.fit(); hud(); heat(); panel(true); tray(); toast('Plan de départ rétabli'); }
function commands() {
  var s = ui.sel, en = selEnt(), c = [], title = 'Commandes', t, it = null, h;
  function add(key, label, icon, fn, o) { var x = { key: key, label: label, icon: icon, fn: fn }, k; if (o) for (k in o) x[k] = o[k]; c.push(x); return x; }
  function back(label, fn, tip) { while (c.length < 5) c.push(null); c.splice(5, 0, { key: 'Échap', label: label, icon: 'back', fn: fn, tip: tip }); }
  function common(e) { add('Y', 'Épingler', 'pin', function () { saveGroup(-1); }, { tip: 'Enregistre la sélection dans un groupe numéroté' }); if (e && e.kind !== 'pool') add('Suppr', 'Retirer', 'trash', function () { begin(); eraseEnt(e); commit(); }, { cls: 'danger', tip: 'Retire la machine du plan' }); }
  if (ui.menu === 'import') {
    [['product-ideation', 'I', 'Ideation'], ['spec-dev-qa', 'H', 'Dev HITL'], ['spec-dev-pr-autonomous', 'N', 'Dev auto']].forEach(function (p) {
      add(p[1], p[2], 'import', function () { ui.menu = null; setTool('bp:' + p[0]); }, { tip: BLUEPRINTS[p[0]].name + ' : pose la ligne entière, postes, bras et convoyeurs' }); });
    back('Retour', function () { ui.menu = null; });
    return { title: 'Importer un workflow', c: c };
  }
  if (ui.menu === 'test') {
    add('I', 'Incident', 'alert', function () { scenario('incident'); }, { tip: '12 bugs urgents arrivent en rafale' });
    add('M', 'Réunion', 'clock', function () { scenario('meeting'); }, { tip: 'L’opérateur simulé s’absente pendant 2 h' });
    add('G', 'Gros PRD', 'doc', function () { scenario('prd'); }, { tip: 'Un PRD qui se découpe en 6 tickets' });
    add('A', 'Panne API', 'plug', function () { scenario('outage'); }, { tip: 'Tous les agents s’arrêtent 30 min' });
    add('T', '+ Ticket', 'ticket', function () { scenario('ticket'); }, { tip: 'Ajoute un ticket depuis CLI · MCP' });
    back('Retour', function () { ui.menu = null; });
    return { title: 'Banc d’essai', c: c };
  }
  if (ui.mode === 'edit' && (!s || ui.tool !== 'select')) {
    var cur = toolTip();
    BUILD.forEach(function (b) {
      if (!b) { c.push(null); return; }
      add(b[1], ui.preset && ui.tool === b[0] ? ui.preset.name : b[2], b[3], function () { setTool(ui.tool === b[0] ? 'select' : b[0]); }, { pressed: ui.tool === b[0], tip: b[4] });
    });
    c[3] = { key: 'R', label: 'Sens ' + ARROW[ui.dir], icon: 'rotate', fn: function () { ui.dir = (ui.dir + 1) % 4; if (view.ghost && view.ghost.dir != null) view.ghost.dir = ui.dir; }, tip: 'Direction des convoyeurs et des bras posés' };
    c[4] = { key: 'Z', label: 'Annuler', icon: 'undo', fn: undo, disabled: !ui.undo.length, tip: 'Annule la dernière pose (Ctrl+Z)' };
    c[5] = { key: 'Échap', label: ui.tool !== 'select' ? 'Lâcher' : 'Piloter', icon: 'back', fn: function () { if (ui.tool !== 'select') setTool('select'); else setMode('pilot'); }, tip: ui.tool !== 'select' ? 'Lâche l’outil' : 'Quitte la construction' };
    c[11] = { key: 'W', label: 'Importer', icon: 'import', fn: function () { ui.menu = 'import'; }, pressed: ui.tool.slice(0, 3) === 'bp:', tip: 'Pose un workflow Fleex existant, traduit en machines' };
    var sure = ui.sure && Date.now() - ui.sure < 3000;
    c[17] = { key: '', label: sure ? 'Confirmer ?' : 'Réinit.', icon: 'loop', cls: 'danger', fn: function () { if (sure) { ui.sure = 0; resetFloor(); } else ui.sure = Date.now(); }, tip: 'Revient au plan de départ' };
    return { title: 'Construction' + (cur ? ' · ' + cur[2] + ' : ' + cur[4] : ui.tool.slice(0, 3) === 'bp:' ? ' · cliquez une zone libre pour poser le workflow' : ' · choisissez quoi poser, ou cliquez une machine'), c: c };
  }
  if (s && s.type === 'ticket') {
    t = s.t; h = holder(t); title = t.displayId;
    add('V', 'Ouvrir', 'open', function () { openTicket(t); }, { cls: 'go', tip: 'Discussion, timeline et détails du ticket (double-clic)' });
    if (h.k === 'outside') add('Q', 'Transférer', 'flag', function () { if (sim.transferIn(t)) toast(t.displayId + ' transféré à la Factory'); }, { cls: 'go', tip: 'Transférer ce ticket à la Factory' });
    else if (h.k !== 'done') {
      sim.focus().forEach(function (f) { if (f.t === t) it = f; });
      if (it && it.kind === 'gate') it.st.outcomes.slice(0, 4).forEach(function (o, i) { var a = armFor(it.st, o.name);
        add('QWER'[i], o.name === 'approve' ? 'Approuver' : o.name, i ? 'loop' : 'check', function () { resolveKey(it.key, o.name); }, { cls: i ? 'warn' : 'go', tip: o.name + (a ? ' : sort vers ' + destName(a) : ' : aucun bras ne prend cette issue') }); });
      else if (it && it.kind === 'question') add('Q', 'Répondre', 'check', function () { resolveKey(it.key, 'answer'); }, { cls: 'go' });
      else if (it && it.kind === 'error') add('Q', 'Relancer', 'loop', function () { resolveKey(it.key, 'retry'); }, { cls: 'go', tip: 'Relancer l’étape' });
      else if (it) { if (it.g) add('Q', it.g.k === 'human' ? 'Faire' : 'Lancer', 'play', function () { resolveKey(it.key, 'next'); }, { cls: 'go', tip: it.g.n }); add(it.g ? 'W' : 'Q', 'Clore', 'check', function () { resolveKey(it.key, 'done'); }, { cls: it.g ? '' : 'go', tip: 'Clore le travail ici et libérer le ticket' }); }
      else if (h.k === 'depot' && !h.it.released && h.it.state === 'ready') add('Q', h.e.status === 'todo' ? 'Lancer' : 'Libérer', 'play', function () { sim.release(h.e, t); }, { cls: 'go', tip: releaseLabel(h.e) });
      add('S', 'Suivre', 'follow', function () { view.follow = view.follow === t ? null : t; if (view.follow) { view.goal = null; if (view.cam.z < 22) view.cam.z = 22; } }, { pressed: view.follow === t, tip: 'La caméra suit ce ticket' });
      add('Y', 'Épingler', 'pin', function () { saveGroup(-1); });
      add('X', 'Rendre', 'give', function () { sim.giveBack(t); toast(t.displayId + ' rendu à Fleex classique : il quitte le plan'); }, { tip: 'Rendre ce ticket à Fleex classique' });
    }
  } else if (s && s.type === 'tickets') {
    title = s.list.length + ' tickets';
    var gates = sim.focus().filter(function (f) { return f.kind === 'gate' && s.list.indexOf(f.t) >= 0; });
    add('Q', 'Approuver', 'check', function () { gates.forEach(function (f) { sim.resolve(f, f.st.outcomes[0].name); }); toast(plural(gates.length, 'gate') + ' approuvée' + (gates.length > 1 ? 's' : '')); }, { cls: 'go', disabled: !gates.length, tip: 'Approuve les gates en attente parmi ces tickets' });
    add('Y', 'Épingler', 'pin', function () { saveGroup(-1); });
  } else if (s && s.type === 'operator') {
    title = 'Opérateur simulé';
    add('U', 'Activé', 'op', function () { sim.op.enabled = !sim.op.enabled; }, { pressed: sim.op.enabled });
  } else if (en) {
    title = entName(en);
    if (isContainer(en)) add('V', 'Ouvrir', 'open', function () { openBox(en); }, { cls: 'go', tip: 'Voir tout ce que contient ' + en.name + ' (double-clic)' });
    if (en.kind === 'station' && en.exec === 'human_gate') {
      add('K', POLICY[en.policy], 'person', function () { en.policy = en.policy === 'human' ? 'sampled' : en.policy === 'sampled' ? 'auto' : 'human'; applied(en.name + ' en contrôle ' + POLICY[en.policy]); dirty(); }, { tip: 'Qui décide : humain, échantillonné, automatique' });
      add('A', 'Tout appr.', 'check', function () { var n = 0; sim.focus().forEach(function (f) { if (f.st === en && f.kind === 'gate') { sim.resolve(f, en.outcomes[0].name); n++; } }); toast(plural(n, 'ticket') + ' approuvé' + (n > 1 ? 's' : '')); }, { disabled: !en.rack.length, tip: 'Approuve tout ce qui attend à cette gate' });
    } else if (en.kind === 'station' && en.exec !== 'native') {
      var mi = F.MODEL_ORDER.indexOf(en.model);
      add('U', 'Modèle +', 'up', function () { en.model = F.MODEL_ORDER[mi + 1]; applied(en.name + ' sur ' + MODELS[en.model].label); dirty(); }, { disabled: mi >= F.MODEL_ORDER.length - 1, tip: 'Modèle plus capable : moins de retours, plus cher' });
      add('J', 'Modèle −', 'down', function () { en.model = F.MODEL_ORDER[mi - 1]; applied(en.name + ' sur ' + MODELS[en.model].label); dirty(); }, { disabled: mi <= 0, tip: 'Modèle moins cher : plus rapide, plus de retours' });
    } else if (en.kind === 'depot') {
      add('L', en.status === 'todo' ? 'Lancer 1' : 'Libérer 1', 'play', function () { var b = sim.bestOf(en); if (b) { sim.release(en, b.t); toast(b.t.displayId + (en.status === 'todo' ? ' lancé' : ' libéré')); } }, { cls: 'go', disabled: !sim.bestOf(en), tip: 'Fait sortir le ticket le plus prioritaire' });
      add('A', 'Auto', 'auto', function () { en.release = en.release === 'auto' ? 'manual' : 'auto'; applied(en.name + ' : sortie ' + (en.release === 'auto' ? 'automatique' : 'à la main')); dirty(); }, { pressed: en.release === 'auto', tip: 'Sortie automatique : un ticket part dès qu’il n’a plus rien à faire ici' });
      var idle = sim.focus().filter(function (f) { return f.zone === en && f.g; });
      add('G', 'Gestes', 'person', function () { idle.forEach(function (f) { sim.resolve(f, 'next'); }); toast(plural(idle.length, 'geste') + ' lancé' + (idle.length > 1 ? 's' : '')); }, { disabled: !idle.length, tip: 'Lance le prochain geste de chaque ticket à l’arrêt dans cette zone' });
    } else if (en.kind === 'intake') {
      add('T', 'Transfert', 'flag', function () { en.transfer = !en.transfer; dirty(); toast(en.transfer ? en.name + ' : les nouveaux tickets sont transférés à la Factory' : en.name + ' : les nouveaux tickets restent dans Fleex classique'); }, { pressed: en.transfer, tip: 'Transférer les tickets de cette source à la Factory' });
      add('A', 'Active', 'power', function () { en.on = !en.on; dirty(); }, { pressed: en.on, tip: 'Source active' });
      add('N', '+ Ticket', 'plus', function () { var nt = sim.inject(en.sid); if (nt) toast(nt.displayId + ' déposé à l’intake ' + en.name); }, { tip: 'Dépose un ticket maintenant' });
    } else if (en.kind === 'belt' || en.kind === 'arm') add('R', 'Pivoter', 'rotate', function () { rotate(en); }, { tip: 'Quart de tour' });
    else if (en.kind === 'pool') {
      add('U', '+2 slots', 'up', function () { sim.pool.max = Math.min(32, sim.pool.max + 2); applied('agentMaxConcurrency à ' + sim.pool.max); });
      add('J', '−2 slots', 'down', function () { sim.pool.max = Math.max(2, sim.pool.max - 2); applied('agentMaxConcurrency à ' + sim.pool.max); }, { disabled: sim.pool.max <= 2 });
    }
    common(en);
    if (ui.mode === 'edit') back('Menu', function () { select(null); }, 'Retour au menu de construction');
  } else {
    add('B', 'Construire', 'build', function () { setMode('edit'); }, { cls: 'go', tip: 'Aménager le plan : convoyeurs, bras, postes, dépôts' });
    add('T', 'Essais', 'test', function () { ui.menu = 'test'; }, { tip: 'Bousculer l’usine : incident, réunion, gros PRD, panne' });
    add('P', 'Production', 'prod', function () { toggleProd(); }, { pressed: ui.prod, tip: 'Statistiques de production' });
    add('O', { none: 'Calque', flow: 'Débit', cost: 'Coût', time: 'Temps', human: 'Humain' }[view.overlay], 'layers', function () { setOverlay(OVERLAYS[(OVERLAYS.indexOf(view.overlay) + 1) % OVERLAYS.length]); }, { pressed: view.overlay !== 'none', tip: 'Calque suivant : débit, coût, temps, attente humaine' });
    add('U', 'Opérateur', 'op', function () { sim.op.enabled = !sim.op.enabled; toast(sim.op.enabled ? 'Opérateur simulé activé' : 'Opérateur simulé désactivé : à vous de traiter Focus et de lancer les todos'); }, { pressed: sim.op.enabled, tip: 'Quelqu’un qui clique à votre place' });
    add('F', 'Tout voir', 'fit', function () { view.fit(); });
  }
  return { title: title, c: c };
}
function resolveKey(key, action) { var it = sim.focus().filter(function (f) { return f.key === key; })[0]; if (it) sim.resolve(it, action); }
function cmdRender() {
  var r = commands(), h = '', i, x;
  ui.cmds = r.c;
  for (i = 0; i < 18; i++) {
    x = r.c[i];
    if (!x) { h += '<span class="cb slot"></span>'; continue; }
    h += '<button class="cb' + (x.cls ? ' ' + x.cls : '') + '" data-cmd="' + i + '"' + (x.pressed != null ? ' aria-pressed="' + !!x.pressed + '"' : '') + (x.disabled ? ' disabled' : '') +
      ' title="' + esc((x.tip || x.label) + (x.key ? ' (' + x.key + ')' : '')) + '">' + (x.key ? '<kbd>' + x.key + '</kbd>' : '') + ic(x.icon) + '<span>' + esc(x.label) + '</span></button>';
  }
  var el = $('#cmd'); if (el._h !== h) { el._h = h; el.innerHTML = h; }
  setText('cmd-title', esc(r.title));
}
function runCmd(x) { if (!x || x.disabled) return; x.fn(); heat(); panel(true); hud(); cmdRender(); selInfo(); boxRender(true); }
function keyCmd(e) {
  var k = e.key === 'Delete' || e.key === 'Backspace' ? 'Suppr' : e.key.length === 1 ? e.key.toUpperCase() : '', list = ui.cmds || [], i;
  if (!k) return false;
  for (i = 0; i < list.length; i++) if (list[i] && list[i].key === k && !list[i].disabled) { e.preventDefault(); runCmd(list[i]); return true; }
  return false;
}

/* ---------- selection card: who is selected, and what it holds ---------- */
function wire(list, max) {
  var h = '<div class="wire">';
  list.slice(0, max).forEach(function (t) { var st = stateOf(t); h += '<button data-act="ticket" data-id="' + t.id + '" style="background:' + (t.triaged ? TYPES[t.type].color : '#8b949e') + ';border-color:' + (st.c === '#22c55e' || st.c === '#a1a1aa' || st.c === '#71717a' ? '#0b0d0e' : st.c) + '" title="' + esc(t.displayId + ' · ' + t.title + ' · ' + st.w) + '" aria-label="' + esc(t.displayId) + '"></button>'; });
  if (list.length > max) h += '<span class="more">+' + (list.length - max) + '</span>';
  return h + '</div>';
}
function sstat(l, v) { return '<span>' + l + '<b>' + v + '</b></span>'; }
function selInfo() {
  var s = ui.sel, h, e, t, st, inside, col = '', k = ui.k || sim.kpis();
  if (!s) {
    var cur = toolTip();
    h = '<div class="portrait" style="' + (ui.mode === 'edit' ? 'border-color:#60a5fa;color:#93c5fd' : '') + '">' + ic(ui.mode === 'edit' ? (cur ? cur[3] : 'build') : 'prod') + '</div><div class="si-main"><div class="si-name">' + (ui.mode === 'edit' ? 'Construction' : 'Fleex Factory') + '</div>' +
      '<div class="si-sub">' + (ui.mode === 'edit' ? (cur ? cur[4] + '.' : 'Choisissez une machine à poser, ou cliquez-en une pour la régler, la déplacer ou la retirer.') : 'Cliquez un élément pour le sélectionner, glissez un ticket pour le déplacer. Double-clic sur un poste, une zone ou un ticket : tout le détail.') + '</div>' +
      '<div class="si-stats">' + sstat('dans la Factory', sim.tickets.size) + sstat('au sol', sim.loose.length) + sstat('Fleex classique', sim.outside.length) + sstat('machines', sim.ents.length) + '</div></div>';
  } else if (s.type === 'ticket') {
    t = s.t; st = stateOf(t);
    h = '<div class="portrait" style="border-color:' + st.c + '"><span class="sq" style="background:' + (t.triaged ? TYPES[t.type].color : '#8b949e') + '"></span></div><div class="si-main"><div class="si-name"><small>' + t.displayId + '</small>' + esc(t.title) + '</div>' +
      '<div class="si-sub"><span style="color:' + st.c + '">●</span> ' + esc(whereIs(t)) + '</div><div class="si-stats">' + sstat('type', t.triaged ? t.type : 'brut') + sstat('priorité', t.priority) + sstat('coût', money(t.cost)) + sstat('interventions', t.touches) + (t.reworks ? sstat('retours', t.reworks) : '') + '</div></div>';
  } else if (s.type === 'tickets') {
    h = '<div class="portrait">' + ic('ticket') + '</div><div class="si-main"><div class="si-name">' + s.list.length + ' tickets</div>' + wire(s.list, 60) + '</div>';
  } else if (s.type === 'operator') {
    h = '<div class="portrait">' + ic('op') + '</div><div class="si-main"><div class="si-name">Opérateur simulé</div><div class="si-sub">Clique à votre place pour que la maquette tourne seule. En poste de 9:00 à 12:30 et de 13:30 à 18:30.</div></div>';
  } else {
    e = s.e; inside = sim.ticketsIn(e);
    var sub = '', stats = '';
    if (e.kind === 'station') {
      st = sim.stationStats(e, 12); col = { failed: '#ef4444', blocked: '#fb923c', human: '#f59e0b', starved: '#60a5fa', running: '#22c55e', idle: '' }[e._state || 'idle'];
      sub = EXEC[e.exec] + (e.exec === 'human_gate' ? ' · ' + POLICY[e.policy] + ' · ' + e.outcomes.length + ' issues' : e.exec === 'native' ? ' · ' + esc(e.ref || '') : ' · ' + esc(e.ref || '') + ' · ' + MODELS[e.model].label);
      stats = sstat('dedans', sim.load(e) + '/' + e.cap) + sstat('traités 12 h', st.done) + (e.exec === 'human_gate' ? sstat('attente', dur(st.avgHuman)) : e.exec === 'native' ? '' : sstat('coût', money(st.cost)) + sstat('run', dur(st.avgRun))) + (st.out ? sstat('en sortie', st.out) : '');
    } else if (e.kind === 'depot') { st = sim.zoneStats(e, 12);
      sub = 'Zone' + (e.status ? ' · ' + e.status : '') + ' · sortie ' + (e.release === 'auto' ? 'automatique' : 'à la main'); stats = sstat('en stock', st.ready) + (st.ready ? sstat('plus ancien', dur(st.old)) : '') + (st.idle || sim.works(e) ? sstat('à relancer', st.idle) : '') + (st.running + st.queued ? sstat('avec un agent', st.running + st.queued) : '') + (st.out ? sstat('libérés', st.out) : ''); if (st.idle) col = '#f59e0b'; }
    else if (e.kind === 'intake') { sub = 'Intake · ' + (e.transfer ? 'transféré à la Factory' : 'reste dans Fleex classique') + (e.on ? '' : ' · coupé'); stats = sstat('par jour', Math.round(e.perDay)) + sstat('emmenés 24 h', sim.sum(e.emitted, 24)) + sstat('dans le bac', e.buffer.length); }
    else if (e.kind === 'arm') { sub = 'Bras · ' + esc(entName(e.src)) + ' → ' + esc(entName(e.dst)) + (F.armTag(e) ? ' · ' + (e.filter && e.filter.values.length ? 'ne prend que ' : 'prend le reste : ') + esc(F.armTag(e)) : ' · prend tout'); stats = sstat('passages 24 h', sim.sum(e.moved, 24)) + sstat('mène à', esc(destName(e))); if (e.filter && e.filter.values.length) col = '#eab308'; }
    else if (e.kind === 'belt') { var d = sim.leadsTo(e); sub = 'Convoyeur · ' + (d ? 'mène à ' + esc(entName(d)) : 'cul-de-sac'); stats = sstat('passages 24 h', sim.sum(e.flow, 24)) + sstat('état', e.item ? 'occupé' : 'libre'); }
    else if (e.kind === 'pool') { sub = 'agentMaxConcurrency : la seule file d’attente côté agents'; stats = sstat('occupés', sim.pool.used + '/' + sim.pool.max); }
    else if (e.kind === 'exit') { sub = 'Sortie · passe en done'; stats = sstat('expédiés 24 h', sim.sum(e.count, 24)); }
    else sub = 'Étiquette de zone';
    h = '<div class="portrait" style="' + (col ? 'border-color:' + col + ';color:' + col : '') + '">' + ic(entIcon(e)) + '</div><div class="si-main"><div class="si-name">' + esc(entName(e)) + '</div><div class="si-sub">' + sub + '</div>' +
      (stats ? '<div class="si-stats">' + stats + '</div>' : '') + (inside.length && e.kind !== 'belt' && e.kind !== 'arm' ? wire(inside, 34) : '') + '</div>';
  }
  var el = $('#selinfo'); if (el._h !== h) { el._h = h; el.innerHTML = h; }
}

/* ---------- the big window: everything inside a station, a depot or a bench ---------- */
function openBox(e) { if (!isContainer(e)) return; ui.boxT = null; ui.box = e; ui.boxHead = ui.boxBody = ''; ui.boxFilter = ''; ui.boxSort = 'prio'; $('#modal').hidden = false; tipHide(); boxRender(true); $('#modal-body').scrollTop = 0; }
function closeBox() { ui.box = null; ui.boxT = null; $('#modal').hidden = true; }
function tcard(t, chips, where, actions, extra) {
  return '<div class="fitem"><div class="l1">' + typeChip(t) + '<span class="chip">' + t.priority + '</span>' + (chips || '') + '<span class="age">' + money(t.cost) + '</span></div>' + ticketLink(t) +
    (where ? '<div class="where">' + where + '</div>' : '') + (extra || '') + (actions ? '<div class="row">' + actions + '</div>' : '') + '</div>';
}
function colHTML(title, n, body) { return '<div class="col"><h3>' + title + '<b>' + n + '</b></h3>' + (body || '<div class="none">Rien ici.</div>') + '</div>'; }
function runsTable(e, title) {
  var rows = [];
  function scan(t) { t.history.forEach(function (x) { if (x.sid === e.id) rows.push({ t: t, x: x }); }); }
  sim.tickets.forEach(scan); sim.recent.forEach(scan);
  rows.sort(function (a, b) { return b.x.at - a.x.at; });
  if (!rows.length) return '';
  var h = '<div class="viz wide"><h3>' + title + '</h3><div class="tw"><table class="t"><tr><th>Ticket</th><th>Quand</th><th>Résultat</th><th>Durée</th><th>Coût</th><th>Attente humaine</th></tr>';
  rows.slice(0, 16).forEach(function (r) {
    h += '<tr><td>' + ticketLink(r.t) + '</td><td>' + hhmm(r.x.at) + '</td><td style="font-family:var(--sans);color:' + (r.x.back || r.x.result === 'interrupted' ? 'var(--red-t)' : 'inherit') + '">' + esc(r.x.step === e.name ? r.x.result : r.x.step) + (r.x.attempt > 1 ? ' · passage ' + r.x.attempt : '') + '</td><td>' + (r.x.dur >= 1 ? dur(r.x.dur) : '—') + '</td><td>' + (r.x.cost ? money(r.x.cost) : '—') + '</td><td>' + (r.x.human ? dur(r.x.human) : '—') + '</td></tr>';
  });
  return h + '</table></div></div>';
}
function boxHTML(e) {
  var head = '<div class="portrait" style="width:44px;height:44px">' + ic(entIcon(e)) + '</div><div style="min-width:0"><h2>' + esc(e.name) + '</h2><div class="si-stats">', body = '', s, n = 0, now = sim.now;
  if (e.kind === 'station') {
    s = sim.stationStats(e, 12);
    var wait = '', run = '', q = '', out = '', nw = 0, nr = 0, nq = 0, gate = e.exec === 'human_gate';
    e.rack.forEach(function (r) { nw++; wait += tcard(r.t, '<span class="chip yellow">needs_review</span>', 'attend votre décision depuis ' + dur(now - r.since), actionsFor({ key: r.t.id + ':' + e.id, kind: 'gate', st: e, t: r.t })); });
    e.cells.forEach(function (c) {
      if (c.run === 'stamp') return;
      if (c.state === 'question' || c.state === 'failed') { nw++; wait += tcard(c.t, c.state === 'failed' ? '<span class="chip red">failed</span>' : '<span class="chip blue">waiting_for_info</span>', 'à l’arrêt depuis ' + dur(now - c.since), actionsFor({ key: c.t.id + ':' + e.id, kind: c.state === 'failed' ? 'error' : 'question', st: e, t: c.t })); }
      else if (c.state === 'queued') { nq++; q += tcard(c.t, '<span class="chip blue">queued</span>', 'attend un slot depuis ' + dur(now - c.q)); }
      else { nr++; run += tcard(c.t, c.run === 'judge' ? '<span class="chip">agent juge</span>' : '<span class="chip green">running</span>', '', '', '<div class="run"><div class="prog ind"><i></i></div><span class="pct">' + dur(now - c.started) + '</span></div>'); }
    });
    e.outbox.forEach(function (o) { var a = armFor(e, o.t.outcome); out += tcard(o.t, '<span class="chip ' + (now - o.since > 4 ? 'orange' : 'gray') + '">issue ' + esc(o.t.outcome) + '</span>', (a ? 'attend le bras vers ' + esc(destName(a)) : 'aucun bras ne prend cette issue') + ' · depuis ' + dur(now - o.since)); });
    head += sstat(EXEC[e.exec], gate ? POLICY[e.policy] : e.exec === 'native' ? esc(e.ref || '') : esc(e.ref || '') + ' · ' + MODELS[e.model].label) + sstat('dedans', sim.load(e) + ' / ' + e.cap) + sstat('traités 12 h', s.done) +
      (gate ? sstat('attente moyenne', dur(s.avgHuman)) + sstat('retours', pct(s.koRate)) : sstat('coût 12 h', money(s.cost)) + sstat('run moyen', dur(s.avgRun)) + sstat('file de slots', dur(s.slotWait)));
    body = '<div class="cols">' + colHTML(gate ? 'Attend votre décision' : 'Questions et erreurs', nw, wait) + (gate && e.policy === 'human' ? '' : colHTML(gate ? 'Jugé par un agent' : 'En cours', nr, run) + colHTML('En file de slots', nq, q)) + colHTML('Bac de sortie', e.outbox.length, out) + '</div>' + runsTable(e, 'Derniers passages à ce poste');
  } else {
    s = sim.zoneStats(e, 12);
    var rank = { urgent: 0, high: 1, medium: 2, low: 3 }, ord = { idle: 0, run: 1, queued: 1, ready: 2 }, all = e.items.slice(), f = ui.boxFilter, counts = {};
    all.forEach(function (x) { var k = x.t.triaged ? x.t.type : 'brut'; counts[k] = (counts[k] || 0) + 1; });
    var list = all.filter(function (x) { return !f || (x.t.triaged ? x.t.type : 'brut') === f; });
    list.sort(ui.boxSort === 'age' ? function (a, b) { return a.since - b.since; } : function (a, b) { return (a.released ? 3 : ord[a.state]) * 1e9 + rank[a.t.priority] * 1e7 + a.since - (b.released ? 3 : ord[b.state]) * 1e9 - rank[b.t.priority] * 1e7 - b.since; });
    head += sstat('Zone', e.status || 'sans statut') + sstat('tickets', all.length) + sstat('en stock', s.ready) + (s.ready ? sstat('plus ancien', dur(s.old)) : '') + sstat('à relancer', s.idle) + sstat('avec un agent', s.running + s.queued) +
      sstat('sortie', e.release === 'auto' ? 'automatique' : 'à la main') + sstat('vers', e.takers.length ? esc(destName(e.takers[0])) : 'aucun bras');
    body = '<div class="boxbar"><div class="vals"><button class="btn sm" data-act="box-filter" data-v="" aria-pressed="' + !f + '">Tous · ' + all.length + '</button>' +
      Object.keys(counts).sort().map(function (k) { return '<button class="btn sm" data-act="box-filter" data-v="' + k + '" aria-pressed="' + (f === k) + '">' + k + ' · ' + counts[k] + '</button>'; }).join('') + '</div><span class="spacer"></span>' +
      '<div class="seg"><button data-act="box-sort" data-v="prio" aria-pressed="' + (ui.boxSort === 'prio') + '">Ce qui vous attend d’abord</button><button data-act="box-sort" data-v="age" aria-pressed="' + (ui.boxSort === 'age') + '">Par ancienneté</button></div></div>';
    if (!list.length) body += '<div class="empty">Aucun ticket.</div>';
    else body += '<div class="tgrid">' + list.map(function (x) {
      var g = x.i < x.plan.length ? GEST[x.plan[x.i]] : null, plan = x.plan.length ? '<div class="plan">' + x.plan.map(function (k, i) { return '<span class="' + (i < x.i ? 'done' : i === x.i ? 'cur' : '') + '">' + (i < x.i ? '✓ ' : '') + esc(GEST[k].n) + '</span>'; }).join('') + '</div>' : '';
      if (x.released) return tcard(x.t, '<span class="chip ' + (now - x.relAt > 4 ? 'orange' : 'green') + '">libéré</span>', 'attend un bras depuis ' + dur(now - x.relAt), '', plan);
      if (x.state === 'idle') return tcard(x.t, '<span class="chip orange">à relancer</span>', 'rien ne tourne depuis ' + dur(now - x.idleSince), actionsFor({ key: x.t.id + ':' + e.id, kind: 'idle', zone: e, t: x.t, g: g }), plan);
      if (x.state === 'run' || x.state === 'queued') return tcard(x.t, x.state === 'queued' ? '<span class="chip blue">queued</span>' : '<span class="chip green">running</span>', x.state === 'queued' ? esc(g.n) + ' attend un slot' : '', '', (x.state === 'run' ? '<div class="run"><div class="prog ind"><i></i></div><span class="pct">' + dur(now - x.started) + '</span></div>' : '') + plan);
      return tcard(x.t, '', 'en stock depuis ' + dur(now - x.since) + ' · ' + esc(x.t.sourceName), '<button class="btn sm' + (e.status === 'todo' ? ' primary' : '') + '" data-act="release" data-id="' + x.t.id + '">' + esc(sim.works(e) ? 'Clore et libérer' : releaseLabel(e)) + '</button>', plan);
    }).join('') + '</div>';
    if (sim.works(e)) body += runsTable(e, 'Derniers gestes dans cette zone');
  }
  head += '</div></div><span class="spacer"></span><button class="btn sm" data-act="box-see">Voir sur le plan</button><button class="btn sm" data-act="box-close" title="Fermer (Échap)">Fermer</button>';
  return { head: head, body: body };
}
function boxRender(force) {
  var e = ui.box, tk = ui.boxT, ae = document.activeElement; if (!e && !tk) return;
  if (e && sim.ents.indexOf(e) < 0) { closeBox(); return; }
  if (!force && (ui.holdBox || (ae && ae.tagName === 'INPUT' && $('#modal').contains(ae)))) return;
  var r = tk ? ticketBoxHTML(tk) : boxHTML(e), hd = $('#modal-head'), bd = $('#modal-body'), st;
  if (r.head !== ui.boxHead) { ui.boxHead = r.head; hd.innerHTML = r.head; }
  if (r.body !== ui.boxBody) { ui.boxBody = r.body; st = bd.scrollTop; bd.innerHTML = r.body; bd.scrollTop = st; }
}

/* ---------- production drawer ---------- */
function lineChart() {
  var n = 24, a = sim.series(sim.g.inn, n + 1).slice(0, n), b = sim.series(sim.g.out, n + 1).slice(0, n);
  var W = 330, H = 178, l = 24, r = 62, t = 10, bt = 22, pw = W - l - r, ph = H - t - bt, max = Math.max(4, Math.max.apply(null, a.concat(b)));
  max = Math.ceil(max / 2) * 2;
  var g = '', i, hr = Math.floor(sim.now / 60);
  function X(i) { return l + pw * i / (n - 1); } function Y(v) { return t + ph * (1 - v / max); }
  function path(s) { return s.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(''); }
  function hour(i) { return ('0' + ((hr - n + i) % 24 + 24) % 24).slice(-2) + ' h'; }
  for (i = 0; i <= 2; i++) { var v = max * i / 2; g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#2e2e33" stroke-width="1"/><text x="' + (l - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v + '</text>'; }
  for (i = 0; i < n; i += 6) g += '<text x="' + X(i) + '" y="' + (H - 5) + '" text-anchor="middle">' + hour(i) + '</text>';
  g += '<text x="' + X(n - 1) + '" y="' + (H - 5) + '" text-anchor="middle">' + hour(n - 1) + '</text>';
  g += '<path d="' + path(a) + '" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round"/><path d="' + path(b) + '" fill="none" stroke="var(--s2)" stroke-width="2" stroke-linejoin="round"/>';
  var ya = Y(a[n - 1]), yb = Y(b[n - 1]); if (Math.abs(ya - yb) < 14) { if (ya <= yb) { ya -= 7; yb += 7; } else { ya += 7; yb -= 7; } }
  g += '<circle cx="' + X(n - 1) + '" cy="' + Y(a[n - 1]) + '" r="4" fill="var(--s1)" stroke="#18181b" stroke-width="2"/><circle cx="' + X(n - 1) + '" cy="' + Y(b[n - 1]) + '" r="4" fill="var(--s2)" stroke="#18181b" stroke-width="2"/>' +
    '<text class="v" x="' + (X(n - 1) + 10) + '" y="' + (ya + 4) + '">' + a[n - 1] + ' entrés</text><text class="v" x="' + (X(n - 1) + 10) + '" y="' + (yb + 4) + '">' + b[n - 1] + ' sortis</text>';
  for (i = 0; i < n; i++) g += '<rect class="hitbar" x="' + (X(i) - pw / n / 2) + '" y="' + t + '" width="' + (pw / n) + '" height="' + ph + '" fill="transparent" data-tip="' + hour(i) + ' · ' + a[i] + ' entrés · ' + b[i] + ' expédiés"/>';
  return '<div class="viz"><h3>Entrées et sorties par heure</h3><p class="cap">Tickets transférés à la Factory et tickets expédiés, 24 dernières heures pleines.</p>' +
    '<div class="lg"><span><i style="background:var(--s1)"></i>Entrés</span><span><i style="background:var(--s2)"></i>Expédiés</span></div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Entrées et sorties par heure">' + g + '</svg></div>';
}
function machineRows() {
  var rows = [];
  sim.ents.forEach(function (e) {
    var s;
    if (e.kind === 'station') { s = sim.stationStats(e, 12); rows.push({ e: e, name: e.name, kind: EXEC[e.exec], done: s.done, v: s.cost, per: s.costPer, run: s.avgRun, human: s.humanWait, ko: s.koRate }); }
    else if (e.kind === 'depot' && sim.works(e)) { s = sim.zoneStats(e, 12); rows.push({ e: e, name: e.name + ' (à la main)', kind: 'Zone', done: s.done, v: s.cost, per: s.done ? s.cost / s.done : 0, run: 0, human: s.humanWait, ko: 0 }); }
  });
  return rows;
}
function costChart(rows) {
  rows = rows.filter(function (r) { return r.v > 0.2; }).sort(function (a, b) { return b.v - a.v; });
  var total = rows.reduce(function (a, r) { return a + r.v; }, 0), top = rows.slice(0, 7), max = top.length ? top[0].v : 1, W = 330, rh = 29, H = top.length * rh + 2, g = '';
  top.forEach(function (o, i) {
    var y = i * rh + 2, w = Math.max(3, W * o.v / max);
    g += '<text x="0" y="' + (y + 11) + '">' + esc(o.name) + '</text><text class="v" x="' + W + '" y="' + (y + 11) + '" text-anchor="end">' + money(o.v) + '</text>' +
      '<rect x="0" y="' + (y + 16) + '" width="' + W + '" height="8" rx="4" fill="#27272a"/><rect x="0" y="' + (y + 16) + '" width="' + w.toFixed(1) + '" height="8" rx="4" fill="var(--s1)"/>' +
      '<rect class="hitbar" x="0" y="' + y + '" width="' + W + '" height="' + (rh - 2) + '" fill="transparent" data-tip="' + esc(o.name) + ' · ' + money(o.v) + ' · ' + pct(o.v / (total || 1)) + ' de la dépense · ' + money(o.per) + ' par ticket"/>';
  });
  return '<div class="viz"><h3>Dépense par poste</h3><p class="cap">Les 7 premiers sur 12 h, zones de travail comprises. Total : ' + money(total) + '.</p>' +
    '<svg viewBox="0 0 ' + W + ' ' + Math.max(H, 40) + '" role="img" aria-label="Dépense par poste">' + g + '</svg></div>';
}
function prodTable(rows) {
  var h = '<div class="viz wide"><h3>Par poste, sur 12 h</h3><div class="tw"><table class="t"><tr><th>Poste</th><th>Type</th><th>Traités</th><th>Coût</th><th>Coût / ticket</th><th>Run moyen</th><th>Attente humaine</th><th>Retours</th></tr>';
  rows.filter(function (r) { return r.done || r.human > 1; }).sort(function (a, b) { return b.human + b.v * 20 - a.human - a.v * 20; }).slice(0, 14).forEach(function (r) {
    h += '<tr><td><button class="tlink" data-ent="' + r.e.id + '">' + esc(r.name) + '</button></td><td style="font-family:var(--sans)">' + r.kind + '</td><td>' + r.done + '</td><td>' + money(r.v) + '</td><td>' + (r.done ? money(r.per) : '—') + '</td><td>' + (r.run ? dur(r.run) : '—') +
      '</td><td>' + (r.human > 1 ? dur(r.human) : '—') + '</td><td>' + (r.ko ? pct(r.ko) : '—') + '</td></tr>';
  });
  return h + '</table></div></div>';
}
function production() {
  if (!ui.prod || ui.holdProd) return;
  var rows = machineRows(), html = lineChart() + costChart(rows) + prodTable(rows);
  if (html !== ui.prodHtml) { ui.prodHtml = html; $('#prod-body').innerHTML = html; }
}
function toggleProd(on) {
  ui.prod = on == null ? !ui.prod : on;
  $('#prod').hidden = !ui.prod; $('#btn-prod').setAttribute('aria-pressed', ui.prod ? 'true' : 'false');
  ui.prodHtml = ''; production();
}

/* ---------- guided tour ---------- */
function named(n) { return sim.ents.filter(function (e) { return e.name === n; })[0] || null; }
function pick1(e) { if (e) select({ type: 'ent', e: e }, false); else select(null); }
var TOUR = [
  { t: 'De l’intake aux dépôts', d: 'Chaque source range ses tickets bruts dans son bac ; un bras les pose sur le convoyeur collecteur. Le Tri leur donne un type et une priorité ; à sa sortie, un bras à filtre envoie les urgents vers le Todo, un bras sans filtre range le reste en Backlog. Dans un dépôt, rien ne tourne et rien ne coûte.',
    go: function () { setMode('pilot'); setOverlay('none'); pick1(named('Tri')); view.frame(0, 1, 16.5, 37); } },
  { t: 'Chaque case décide pour elle-même', d: 'Un convoyeur est une suite de cases indépendantes : chacune porte un ticket et le pousse vers la case qu’elle vise, si elle est libre. Un bras jaune prélève au passage ce qui correspond à son filtre (type = build, par exemple) ; le reste continue. Le chemin d’un ticket n’est écrit nulle part.',
    go: function () { pick1(sim.at(17, 21)); view.frame(13.5, 16, 14, 20, false, 40); } },
  { t: 'Une ligne : des postes et des bras', d: 'Voici Spec Dev PR (HITL), importé tel quel. Un poste fait tourner son étape, puis range le ticket dans son bac de sortie. Le bras posé contre lui le passe au poste suivant. Les petits postes verts posent un statut.',
    go: function () { pick1(named('Build')); view.frame(17, 15.5, 30, 10.5, false, 36); } },
  { t: 'Une gate, plusieurs sorties', d: 'Cette human gate a quatre issues. Chacune sort par son propre bras, filtré sur l’issue : redo-artifact-only et redo-all repartent par le haut, redo-spec-only par le bas via « spec to gate », et approve continue tout droit. Sélectionnez le poste : entrées en vert, sorties en orange.',
    go: function () { pick1(named('Human Gate')); view.frame(17, 4.5, 17, 12.5, false, 44); } },
  { t: 'Les zones', d: 'Backlog, Todo, Établi, Finition : une seule sorte de machine. Un ticket y attend, on peut le commenter ou lui lancer un agent par une mention, et il n’en sort qu’une fois libéré. Fin de ligne ne veut pas dire done : la pièce tombe en Finition, ou sur l’Établi pour ce qu’aucun bras n’a pris. Là, chaque geste (une mention à un agent, une skill, une QA) attend que vous le lanciez : c’est là que le temps part.',
    go: function () { pick1(named('Finition')); view.frame(44, 1, 18, 37); } },
  { t: 'Déplacer un ticket', d: 'Glissez un ticket et déposez-le où vous voulez : sur un poste, dans un dépôt, sur une case de convoyeur. Il reprend alors le chemin sur lequel il se trouve. Un ticket transféré est « managé par la Factory » : dans Tasks et Focus, chaque poste traversé apparaît comme un run de son fil.',
    go: function () { var t = null; sim.tickets.forEach(function (x) { if (!t && x.loc && x.loc.kind === 'station') t = x; }); if (t) select({ type: 'ticket', t: t }, true); else select(null); } },
  { t: 'La console', d: 'En bas, comme dans un jeu de stratégie : la mini-carte et les calques à gauche, la sélection au centre avec ce qu’elle contient, et à droite ses commandes, chacune avec sa touche. Double-cliquez un poste, une zone ou un ticket (ou V) pour ouvrir en grand tout ce qu’il contient.',
    go: function () { pick1(sim.depots('backlog')[0]); view.fit(); } },
  { t: 'Construire', d: 'Le bouton Construire (touche B) ouvre le menu de construction dans la console : chaque machine a sa touche. Tracez un convoyeur en glissant, posez un bras (R le fait pivoter), un poste, un dépôt, un intake, une sortie. Un intake se vide par un bras, comme un poste. Chaque machine se règle dans l’Inspecteur : nom, exécuteur, issues, filtre du bras. « Importer un workflow » pose une ligne entière.',
    go: function () { select(null); setMode('edit'); view.fit(); } },
  { t: 'À vous de piloter', d: 'Goulots classe ce qui freine et signale une sortie bloquée ou un geste répété à transformer en poste. Focus liste ce qui vous attend. Maj+clic sélectionne plusieurs tickets, Maj+1 à 6 enregistre une sélection, 1 à 6 la rappelle.',
    go: function () { setMode('pilot'); select(null); setTab('bottlenecks'); panel(true); view.fit(); } }
];
function tourShow(i) {
  ui.tour = i; layout();
  var s = TOUR[i], el = $('#tour'), dots = '';
  for (var k = 0; k < TOUR.length; k++) dots += '<i class="' + (k <= i ? 'on' : '') + '"></i>';
  el.innerHTML = '<div class="row"><span class="step">Visite ' + (i + 1) + ' / ' + TOUR.length + '</span><span class="spacer"></span><span class="dots">' + dots + '</span></div>' +
    '<h2 class="h">' + s.t + '</h2><p>' + s.d + '</p><div class="row end"><button class="btn sm ghost" data-tour="end">Quitter</button>' +
    (i ? '<button class="btn sm" data-tour="prev">Précédent</button>' : '') + '<button class="btn sm primary" data-tour="next">' + (i === TOUR.length - 1 ? 'Terminer' : 'Suivant') + '</button></div>';
  el.hidden = false;
  layout(); s.go();
  if (ui.narrow) { $('#panel').classList.add('closed'); layout(); }
}
function tourEnd() { ui.tour = -1; $('#tour').hidden = true; setMode('pilot'); layout(); view.fit(); ui.fitZ = fitZoom(); if (view.overlay !== 'none') setOverlay('none'); }

/* ---------- tooltip ---------- */
function tipShow(html, x, y) {
  var el = $('#tip'); el.innerHTML = html; el.hidden = false;
  var w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = clamp(x + 14, 6, window.innerWidth - w - 6) + 'px';
  el.style.top = clamp(y + 16 + h > window.innerHeight ? y - h - 10 : y + 16, 6, window.innerHeight - h - 6) + 'px';
}
function tipHide() { $('#tip').hidden = true; }
function hoverTip(p) {
  if (p.type === 'ticket') {
    var t = p.t, st0 = stateOf(t), tr = sim.trace(t);
    return '<div class="row" style="gap:4px;margin-bottom:4px">' + statusChip(t) + typeChip(t) + '<span class="chip">' + t.priority + '</span></div>' +
      '<b><span class="num" style="color:var(--t2);font-weight:500">' + t.displayId + '</span> ' + esc(t.title) + '</b>' +
      '<div class="d"><span style="color:' + st0.c + '">●</span> ' + esc(whereIs(t)) + '<br>' + money(t.cost) + (t.touches ? ' · ' + plural(t.touches, 'intervention') : '') + (t.reworks ? ' · ' + plural(t.reworks, 'retour') : '') +
      (tr && tr.dest ? '<br>Si rien ne change, va vers : ' + esc(tr.dest) : '') + '<br><span style="color:var(--t3)">Clic : sélectionner · glisser : déplacer · Maj+clic : ajouter</span></div>';
  }
  var e = p.e, rank = -1, s; ui.cards.slice(0, 3).forEach(function (c, i) { if (c.ref === e) rank = i; });
  var gl = rank >= 0 && ui.tab === 'bottlenecks' ? '<div class="d" style="color:var(--yellow-t)">Goulot ' + (rank + 1) + ' : ' + esc(ui.cards[rank].metric) + '</div>' : '';
  if (e.kind === 'station') {
    s = sim.stationStats(e, 12);
    return '<b>' + esc(e.name) + '</b><div class="d">' + EXEC[e.exec] + (e.exec !== 'human_gate' && e.exec !== 'native' && e.model ? ' · ' + (e.ref ? esc(e.ref) + ' · ' : '') + MODELS[e.model].label : '') + '<br>' +
      (e.exec === 'human_gate' ? s.waitingNow + ' en attente' + (s.waitingNow ? ' · plus ancien ' + dur(s.oldest) : '') + ' · issues : ' + esc(e.outcomes.map(function (o) { return o.name; }).join(', ')) :
        s.running + ' en cours' + (s.queued ? ' · ' + s.queued + ' en file' : '') + ' · ' + s.done + ' traités en 12 h · ' + money(s.cost)) +
      (s.out ? '<br><span style="color:var(--orange-t)">' + s.out + ' dans le bac de sortie' + (s.stuck > 4 ? ' depuis ' + dur(s.stuck) : '') + '</span>' : '') + '</div>' + gl;
  }
  if (e.kind === 'belt') { var d = sim.leadsTo(e); return '<b>Convoyeur ' + ARROW[e.dir] + '</b><div class="d">' + (d ? 'mène à ' + esc(entName(d)) : 'cul-de-sac') + ' · ' + (e.item ? 'porte ' + e.item.t.displayId : 'libre') + ' · ' + sim.sum(e.flow, 6) + ' passages en 6 h</div>'; }
  if (e.kind === 'arm') return '<b>Bras ' + ARROW[e.dir] + '</b><div class="d">' + esc(entName(e.src)) + ' → ' + esc(entName(e.dst)) + '<br>' + (e.filter && e.filter.values.length ? 'ne prend que : ' + esc(e.filter.values.join(', ')) : F.armTag(e) ? 'prend le reste : ' + esc(F.armTag(e)) : 'prend tout') + '</div>';
  if (e.kind === 'depot') { s = sim.zoneStats(e, 12);
    return '<b>' + esc(e.name) + (e.status ? ' · ' + e.status : '') + '</b><div class="d">' + plural(s.n, 'ticket') + (s.ready ? ' · ' + s.ready + ' en stock, le plus ancien depuis ' + dur(s.old) : '') + (s.idle ? ' · ' + s.idle + ' à relancer' : '') + (s.running + s.queued ? ' · ' + (s.running + s.queued) + ' avec un agent' : '') +
      ' · sortie ' + (e.release === 'auto' ? 'automatique' : 'à la main') + '<br><span style="color:var(--t3)">Double-clic : tout voir</span></div>' + gl; }
  if (e.kind === 'intake') return '<b>' + esc(e.name) + '</b><div class="d">' + Math.round(e.perDay) + ' tickets par jour · ' + (e.transfer ? 'transférés à la Factory' : 'restent dans Fleex classique') + (e.buffer.length ? '<br>' + e.buffer.length + ' dans le bac de sortie' + (e.takers.length ? '' : ' : aucun bras ne le vide') : '') + '</div>' + gl;
  if (e.kind === 'pool') return '<b>Slots agents</b><div class="d">' + sim.pool.used + ' occupés sur ' + sim.pool.max + ' (agentMaxConcurrency)</div>' + gl;
  if (e.kind === 'label') return '<b>' + esc(e.text) + '</b><div class="d">Étiquette de zone</div>';
  return '<b>' + esc(e.name) + ' · done</b><div class="d">' + sim.sum(e.count, 24) + ' tickets expédiés en 24 h</div>';
}

/* ---------- canvas input ---------- */
function bindCanvas() {
  var cv = $('#floor'), pts = new Map(), moved = 0, pinch = 0, press = null;
  function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function tileAt(p) { var w = view.toWorld(p.x, p.y); return { x: Math.floor(w.x), y: Math.floor(w.y), wx: w.x, wy: w.y }; }
  function paintTo(tx, ty) {
    var l = press.last, g = 0;
    while ((l.x !== tx || l.y !== ty) && g++ < 200) {
      var d = l.x < tx ? 0 : l.x > tx ? 2 : l.y < ty ? 1 : 3, nx = l.x + DX[d], ny = l.y + DY[d];
      setBelt(l.x, l.y, d); setBelt(nx, ny, d); ui.dir = d; l = { x: nx, y: ny }; press.did = true;
    }
    press.last = l;
  }
  function dragTicket(t, tl) {
    var e = sim.at(tl.x, tl.y), ok = false, can = true, text, path = null;
    if (!e) text = 'Au sol : il n’avancera plus tout seul';
    else if (e === t.loc && e.kind !== 'belt') { can = false; text = 'Il est déjà ici'; }
    else if (sim.canTake(e)) { ok = true; if (e.kind === 'belt') path = sim.trace(t, e);
      text = e.kind === 'belt' ? 'Convoyeur ' + ARROW[e.dir] + (path && path.dest ? ' : il ira vers ' + path.dest : '') : e.kind === 'exit' ? 'Expédier : passe en done' : 'Déposer dans ' + e.name; }
    else { can = false; text = e.kind === 'belt' ? 'Case occupée' : F.isBox(e) ? e.name + ' est plein' : 'Impossible sur ' + KIND_NAME[e.kind].toLowerCase(); }
    view.dragT = { t: t, x: tl.wx, y: tl.wy, ok: ok, can: can, text: text, tx: tl.x, ty: tl.y, path: path };
  }
  cv.addEventListener('pointerdown', function (e) {
    cv.setPointerCapture(e.pointerId); var p = pos(e); pts.set(e.pointerId, p); moved = 0; press = null;
    tipHide();
    if (pts.size === 2) { var a = Array.from(pts.values()); pinch = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); view.dragT = null; if (ui.batch) commit(); return; }
    var tl = tileAt(p), hit;
    if (ui.mode === 'edit') {
      if (ui.tool === 'belt') press = { k: 'paint', last: { x: tl.x, y: tl.y }, did: false };
      else if (ui.tool === 'erase') { press = { k: 'erase' }; begin(); eraseEnt(sim.at(tl.x, tl.y)); }
      else if (ui.tool === 'select') { hit = view.pick(p.x, p.y, true); if (hit) press = { k: 'ent', e: hit.e, ox: tl.x - hit.e.x, oy: tl.y - hit.e.y }; }
      else press = { k: 'place' };
    } else { hit = view.pick(p.x, p.y); if (hit && hit.type === 'ticket' && live(hit.t) && !e.shiftKey) press = { k: 'ticket', t: hit.t }; }
  });
  cv.addEventListener('pointermove', function (e) {
    var p = pos(e), prev = pts.get(e.pointerId), tl = tileAt(p);
    if (!prev) {
      if (e.pointerType !== 'mouse') return;
      var hit = view.pick(p.x, p.y, ui.mode === 'edit'); view.hover = hit; cv.classList.toggle('hit', !!hit);
      view.ghost = ghostFor(tl);
      if (hit && !(ui.mode === 'edit' && ui.tool !== 'select')) tipShow(hoverTip(hit), e.clientX, e.clientY); else tipHide();
      return;
    }
    if (pts.size === 1) {
      var dx = p.x - prev.x, dy = p.y - prev.y; moved += Math.abs(dx) + Math.abs(dy);
      if (press && press.k === 'paint') { begin(); paintTo(tl.x, tl.y); view.ghost = ghostFor(tl); }
      else if (press && press.k === 'erase') { eraseEnt(sim.at(tl.x, tl.y)); view.ghost = ghostFor(tl); }
      else if (press && press.k === 'ent') { if (moved > 5) { var en = press.e, gx = tl.x - press.ox, gy = tl.y - press.oy; press.drag = true; view.ghost = { x: gx, y: gy, w: en.w, h: en.h, ok: sim.free(gx, gy, en.w, en.h, en), text: 'Déplacer ' + entName(en) }; cv.classList.add('drag'); } }
      else if (press && press.k === 'ticket') { if (moved > 5) { press.drag = true; dragTicket(press.t, tl); cv.classList.add('drag'); } }
      else if (moved > 5) { view.cam.x -= dx / view.cam.z; view.cam.y -= dy / view.cam.z; view.goal = null; view.follow = null; cv.classList.add('drag'); }
      pts.set(e.pointerId, p);
    } else if (pts.size === 2) {
      pts.set(e.pointerId, p);
      var a = Array.from(pts.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      if (pinch) view.zoomAt((a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2, d / pinch);
      pinch = d; moved = 99;
    }
  });
  function up(e) {
    if (!pts.has(e.pointerId)) return;
    var p = pos(e), tl = tileAt(p), pr = press, real = e.type === 'pointerup';
    pts.delete(e.pointerId); cv.classList.remove('drag'); press = null;
    if (pts.size < 2) pinch = 0;
    if (pr && pr.k === 'paint') { if (real && !pr.did && moved <= 5) { begin(); place(specFor(tl.x, tl.y)); } commit(); return; }
    if (pr && pr.k === 'erase') { commit(); return; }
    if (pr && pr.k === 'ent' && pr.drag) {
      var g = view.ghost; view.ghost = null;
      if (real && g && g.ok && (g.x !== pr.e.x || g.y !== pr.e.y)) { begin(); rec({ k: 'move', e: pr.e, x: pr.e.x, y: pr.e.y }); sim.move(pr.e, g.x, g.y); commit(); }
      else if (real && g && !g.ok) toast('Pas la place ici');
      select({ type: 'ent', e: pr.e }, false); return;
    }
    if (pr && pr.k === 'ticket' && pr.drag) {
      var d = view.dragT; view.dragT = null;
      if (real && d && d.can) {
        var was = holder(d.t), cut = was.k === 'cell' && was.it.state === 'running', dest = sim.drop(d.t, d.tx, d.ty);
        toast(d.t.displayId + (dest ? dest.kind === 'exit' ? ' expédié à la main' : dest.kind === 'belt' ? ' posé sur un convoyeur : il suit le chemin' : ' déposé dans ' + dest.name : ' posé au sol') + (cut ? ' · run interrompu à ' + was.e.name : ''));
        select({ type: 'ticket', t: d.t }, false);
      } else if (real && d) toast(d.text);
      return;
    }
    if (pr && pr.k === 'place') {
      if (real && moved <= 5 && pts.size === 0) {
        begin();
        if (ui.tool.slice(0, 3) === 'bp:') { var pl = planAt(ui.tool.slice(3), tl); if (fits(pl)) { sim.stamp(pl).forEach(function (x) { if (x) rec({ k: 'add', e: x }); }); toast(BLUEPRINTS[ui.tool.slice(3)].name + ' posé : reliez son entrée et sa sortie'); setTool('select'); } else toast('Pas la place ici : il faut une zone libre'); }
        else { var ne = place(specFor(tl.x, tl.y)); if (!ne) toast('Pas la place ici'); else if (ne.kind !== 'belt' && ne.kind !== 'arm') { commit(); setTool('select'); select({ type: 'ent', e: ne }, false); return; } }
        commit(); view.ghost = ghostFor(tl);
      }
      return;
    }
    if (moved <= 5 && pts.size === 0 && real) {
      var hit = pr && pr.k === 'ticket' ? { type: 'ticket', t: pr.t } : pr && pr.k === 'ent' ? { type: 'ent', e: pr.e } : view.pick(p.x, p.y, ui.mode === 'edit');
      if (e.shiftKey && hit && hit.type === 'ticket') toggleTicket(hit.t); else if (!(e.shiftKey && !hit)) select(hit, false);
    }
  }
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', function () { view.hover = null; view.ghost = null; tipHide(); });
  cv.addEventListener('wheel', function (e) {
    e.preventDefault(); var p = pos(e); view.follow = null;
    view.zoomAt(p.x, p.y, Math.exp(-clamp(e.deltaY, -120, 120) * (e.ctrlKey ? 0.012 : 0.0022)));
  }, { passive: false });
  cv.addEventListener('dblclick', function (e) { var p = pos(e), hit = view.pick(p.x, p.y, ui.mode === 'edit'); if (hit && hit.type === 'ticket') { select(hit, false); openTicket(hit.t); } else if (hit && isContainer(hit.e)) { select(hit, false); openBox(hit.e); } else if (ui.mode !== 'edit') view.zoomAt(p.x, p.y, 1.6); });

  var mini = $('#mini'), mdown = false;
  function mgo(e) { var r = mini.getBoundingClientRect(), w = view.miniToWorld(e.clientX - r.left, e.clientY - r.top); if (w) { view.cam.x = clamp(w.x, 0, sim.W); view.cam.y = clamp(w.y, 0, sim.H); view.goal = null; view.follow = null; } }
  mini.addEventListener('pointerdown', function (e) { mdown = true; mini.setPointerCapture(e.pointerId); mgo(e); });
  mini.addEventListener('pointermove', function (e) { if (mdown) mgo(e); });
  mini.addEventListener('pointerup', function () { mdown = false; });
}

function setSpeed(v) {
  if (v > 0) ui.lastSpeed = v;
  ui.speed = v;
  document.querySelectorAll('.speed button').forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.speed === v ? 'true' : 'false'); });
}

/* ---------- layout ---------- */
function layout() {
  var hudH = $('#hud').offsetHeight, root = document.documentElement, pn = $('#panel');
  ui.narrow = window.innerWidth <= 860;
  root.style.setProperty('--hud-top', hudH + 'px');
  root.style.setProperty('--sheet-px', pn.offsetHeight + 'px');
  var tourH = ui.tour >= 0 ? $('#tour').offsetHeight + 16 : 0, cons = $('#console').offsetHeight;
  root.style.setProperty('--cons-px', cons + 'px');
  view.inset = ui.narrow ? { l: 4, t: hudH + 12, r: 4, b: pn.offsetHeight + cons + 10 + tourH } : { l: 14, t: hudH + 20, r: pn.offsetWidth + 28, b: cons + 50 + tourH };
}
function fitZoom() { var c = { x: view.cam.x, y: view.cam.y, z: view.cam.z }, g = view.goal, z; view.fit(true); z = view.cam.z; view.cam.x = c.x; view.cam.y = c.y; view.cam.z = c.z; view.goal = g; return z; }

/* ---------- boot ---------- */
function startSim(layoutSpecs) {
  var ok = Array.isArray(layoutSpecs) && layoutSpecs.length && layoutSpecs.every(function (s) { return s && typeof s.kind === 'string' && s.x >= 0 && s.y >= 0; });
  try { sim = new F.Sim(SEED, ok ? layoutSpecs : null); } catch (err) { sim = new F.Sim(SEED); }
  sim.prewarm(34.25 * 60);            /* opens on Tuesday 10:15, with a night behind it */
  if (view) { view.sim = sim; view.sel = view.hover = view.follow = view.ghost = view.dragT = null; }
  ui.sel = null; ui.undo = []; ui.batch = null; ui.groups = [null, null, null, null, null, null]; ui.applied = []; ui.logSeen = sim.logN || 0; ui.lastHtml = '';
  if (window.__factory) window.__factory.sim = sim;
}
function boot() {
  var saved = null; try { saved = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (err) {}
  startSim(saved);
  view = new F.View($('#floor'), sim);
  view.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.__factory = { sim: sim, view: view, ui: ui, setMode: setMode, setTool: setTool, select: select };

  view.resize(); cmdRender(); selInfo(); layout();
  if (ui.narrow) { $('#panel').classList.add('closed'); layout(); view.frame(15, 17, 24, 12, true); } else view.fit(true);
  ui.fitZ = fitZoom();
  hud(); heat(); legend(); panel(true); tray();

  bindCanvas();
  var pn = $('#panel');
  pn.addEventListener('click', function (e) {
    var tb = e.target.closest('[role=tab]');
    if (tb) { setTab(tb.dataset.tab); pn.classList.remove('closed'); panel(true); layout(); return; }
    if (e.target.closest('#sheet-toggle')) { pn.classList.toggle('closed'); layout(); return; }
    onPanel(e);
  });
  pn.addEventListener('change', onPanel);
  pn.addEventListener('input', function (e) { if (e.target.tagName === 'INPUT') onPanel(e); });
  pn.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
  pn.addEventListener('pointerdown', function () { ui.hold = true; });
  window.addEventListener('pointerup', function () { setTimeout(function () { ui.hold = false; ui.holdProd = false; ui.holdBox = false; }, 60); });
  window.addEventListener('pointercancel', function () { ui.hold = false; ui.holdProd = false; ui.holdBox = false; });

  $('#hud').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.speed != null) setSpeed(+b.dataset.speed);
    else if (b.dataset.kpi) {
      var k = b.dataset.kpi, d;
      if (k === 'flow') setOverlay(view.overlay === 'flow' ? 'none' : 'flow');
      else if (k === 'cost') setOverlay(view.overlay === 'cost' ? 'none' : 'cost');
      else if (k === 'back' || k === 'todo') { d = sim.depots(k === 'back' ? 'backlog' : 'todo')[0]; if (d) select({ type: 'ent', e: d }, true); }
      else if (k === 'bench') { d = bench('reviewing'); if (d) select({ type: 'ent', e: d }, true); }
      else if (k === 'focus') { setTab('focus'); pn.classList.remove('closed'); panel(true); layout(); }
      else if (k === 'pool') { d = sim.ents.filter(function (x) { return x.kind === 'pool'; })[0]; if (d) select({ type: 'ent', e: d }, true); }
      else if (k === 'wip') toggleProd(true);
    }
  });
  $('#overlays').addEventListener('click', function (e) { var b = e.target.closest('[data-ov]'); if (b) { if (ui.mode === 'edit') setMode('pilot'); setOverlay(b.dataset.ov); cmdRender(); } });
  $('#cmd').addEventListener('click', function (e) { var b = e.target.closest('[data-cmd]'); if (b) runCmd(ui.cmds[+b.dataset.cmd]); });
  $('#selinfo').addEventListener('click', onPanel);
  $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeBox(); else onPanel(e); });
  $('#modal').addEventListener('pointerdown', function () { ui.holdBox = true; });
  $('#modal').addEventListener('change', onPanel);
  $('#modal').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur(); });
  $('#groups').addEventListener('click', function (e) {
    var x = e.target.closest('[data-grpx]'), g = e.target.closest('[data-grp]');
    if (x) { ui.groups[+x.dataset.grpx] = null; tray(); }
    else if (g) { var i = +g.dataset.grp; if (ui.groups[i] && !e.shiftKey) recallGroup(i); else saveGroup(i); }
  });
  $('#bubble').addEventListener('click', onPanel);
  $('#bubble').addEventListener('pointerdown', function () { ui.hold = true; });
  $('#btn-prod').addEventListener('click', function () { toggleProd(); });
  $('#prod-close').addEventListener('click', function () { toggleProd(false); });
  $('#prod').addEventListener('pointerdown', function () { ui.holdProd = true; });
  $('#prod').addEventListener('click', function (e) { var b = e.target.closest('[data-ent]'); if (b) { var x = entById(+b.dataset.ent); if (x) { toggleProd(false); select({ type: 'ent', e: x }, true); } } });
  $('#btn-help').addEventListener('click', function () { if (ui.tour >= 0) tourEnd(); $('#intro').hidden = false; });
  function closeIntro() { $('#intro').hidden = true; try { localStorage.setItem('fleex-factory-intro-7', '1'); } catch (err) {} }
  $('#intro-go').addEventListener('click', function () { closeIntro(); });
  $('#intro-tour').addEventListener('click', function () { closeIntro(); tourShow(0); });
  $('#tour').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tour]'); if (!b) return;
    if (b.dataset.tour === 'end') tourEnd();
    else if (b.dataset.tour === 'prev') tourShow(ui.tour - 1);
    else if (ui.tour >= TOUR.length - 1) tourEnd(); else tourShow(ui.tour + 1);
  });
  $('#intro').addEventListener('click', function (e) { if (e.target.id === 'intro') $('#intro').hidden = true; });
  $('#z-in').addEventListener('click', function () { view.zoomAt(view.w / 2, view.h / 2, 1.4); });
  $('#z-out').addEventListener('click', function () { view.zoomAt(view.w / 2, view.h / 2, 1 / 1.4); });
  $('#z-fit').addEventListener('click', function () { view.fit(); });

  document.addEventListener('mousemove', function (e) {
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (t) tipShow(esc(t.dataset.tip), e.clientX, e.clientY); else if (e.target.id !== 'floor') tipHide();
  });
  document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) tipShow(esc(t.dataset.tip), e.clientX, e.clientY); });

  window.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    var k = e.key, en = selEnt();
    if ((e.metaKey || e.ctrlKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); undo(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (ui.box || ui.boxT) { if (k === 'Escape') closeBox(); return; }
    if ($('#intro').hidden && keyCmd(e)) return;
    if (k === ' ') { e.preventDefault(); setSpeed(ui.speed ? 0 : ui.lastSpeed); }
    else if (/^Digit[1-6]$/.test(e.code)) { e.preventDefault(); if (e.shiftKey) saveGroup(+e.code.slice(5) - 1); else recallGroup(+e.code.slice(5) - 1); }
    else if (k === '+' || k === '=' || k === '-' || k === '_') { var sp = [0, 1, 3, 8, 20], ci = sp.indexOf(ui.speed); setSpeed(sp[clamp(ci + (k === '-' || k === '_' ? -1 : 1), 0, 4)]); }
    else if (k === 'f' || k === 'F') view.fit();
    else if (k === 'r' || k === 'R') { if (en && (ui.mode !== 'edit' || ui.tool === 'select') && (en.kind === 'belt' || en.kind === 'arm')) rotate(en); else { ui.dir = (ui.dir + 1) % 4; cmdRender(); if (view.ghost && view.ghost.dir != null) view.ghost.dir = ui.dir; } }
    else if ((k === 'Delete' || k === 'Backspace') && en) { e.preventDefault(); begin(); eraseEnt(en); commit(); }
    else if (k === 'o' || k === 'O') { if (ui.mode === 'pilot') setOverlay(OVERLAYS[(OVERLAYS.indexOf(view.overlay) + 1) % OVERLAYS.length]); }
    else if (k === 'p' || k === 'P') toggleProd();
    else if (k === 'Escape') { if (!$('#intro').hidden) $('#intro').hidden = true; else if (ui.tour >= 0) tourEnd(); else if (ui.prod) toggleProd(false); else if (ui.menu) { ui.menu = null; cmdRender(); } else if (ui.mode === 'edit' && ui.tool !== 'select') setTool('select'); else if (ui.sel) select(null); else if (ui.mode === 'edit') setMode('pilot'); }
    else if (k === 'ArrowRight' && ui.tour >= 0) { if (ui.tour >= TOUR.length - 1) tourEnd(); else tourShow(ui.tour + 1); }
    else if (k === 'ArrowLeft' && ui.tour > 0) tourShow(ui.tour - 1);
  });
  window.addEventListener('resize', function () { view.resize(); layout(); ui.fitZ = fitZoom(); });

  var seen = false; try { seen = localStorage.getItem('fleex-factory-intro-7') === '1'; } catch (err) {}
  if (!seen) $('#intro').hidden = false;

  var last = performance.now(), tHud = 0, tPanel = 0, tHeat = 0, tMini = 0, tProd = 0;
  function frame(ts) {
    var dt = Math.min(0.1, Math.max(0, (ts - last) / 1000)); last = ts;
    if (ui.speed > 0 && $('#intro').hidden) {
      var sd = dt * ui.speed * 2, n = Math.max(1, Math.ceil(sd / 0.1));
      for (var i = 0; i < n; i++) sim.step(sd / n);
    }
    view.draw(dt);
    if (ts - tHud > 250) { tHud = ts; hud(); }
    if (ts - tPanel > 400) { tPanel = ts; panel(); tray(); cmdRender(); selInfo(); boxRender(); }
    bubble();
    if (ts - tHeat > 900) { tHeat = ts; heat(); }
    if (ts - tMini > 120 && !ui.narrow) {
      tMini = ts;
      view.minimap($('#mini'));
    }
    if (ts - tProd > 1500) { tProd = ts; production(); }
    for (var li = 0; li < sim.log.length; li++) {
      var l = sim.log[li];
      if (l.n <= ui.logSeen) continue;
      ui.logSeen = l.n;
      if (l.kind === 'objective') toast('★ ' + l.text, 'objective'); else if (l.kind === 'alert') toast(l.text, 'alert'); else if (l.kind === 'escape') toast(l.text);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
