/* Fleex Factory — HUD, pilot panel, production drawer and input. */
(function () {
'use strict';
var F = window.FleexFactory, MODELS = F.MODELS, TYPES = F.TYPES, WORKFLOWS = F.WORKFLOWS, dur = F.fmtDur, clamp = F.clamp;
var sim, view;
var ui = { tab: 'bottlenecks', speed: 1, lastSpeed: 1, sel: null, prod: false, cards: [], applied: [], logSeen: 0, hold: false, narrow: false, lastHtml: '' };
var TYPE_CHIP = { build: 'blue', fix: 'red', think: 'purple', lead: 'yellow', ops: 'teal' };
var KIND = { gate: ['Gate', 'yellow'], route: ['Routage', 'purple'], question: ['Question', 'blue'], error: ['Erreur', 'red'] };
var BN = { human: 'Attente humaine', question: 'Questions et erreurs', pool: 'Capacité', cost: 'Coût', quality: 'Qualité' };
var OVERLAYS = ['none', 'flow', 'cost', 'time', 'human'];
var EXEC = { agent: 'Persona qui exécute l’étape dans une session Claude.', skill: 'Skill lancée telle quelle sur le ticket.',
  panel: 'Plusieurs personas répondent, un orchestrateur synthétise. Compte pour 3 slots.', native: 'Action déterministe, sans agent ni coût.',
  human_gate: 'Étape qui attend une décision humaine.' };

function $(s) { return document.querySelector(s); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function money(v) { return '$' + (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)); }
function pct(v) { return Math.round(v * 100) + ' %'; }
function hhmm(min) { var m = Math.floor(min % 1440); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
function stLabel(st) { return st.lane ? st.lane.wf.name + ' · ' + st.name : st.name; }
function typeChip(t) { return '<span class="chip ' + TYPE_CHIP[t.type] + '"><i></i>' + t.type + '</span>'; }
function ticketLink(t) { return '<button class="tlink" data-act="ticket" data-id="' + t.id + '"><span class="id">' + t.displayId + '</span>' + esc(t.title) + '</button>'; }
function stat(l, v) { return '<div class="stat"><div class="s-l">' + l + '</div><div class="s-v">' + v + '</div></div>'; }

/* ---------- toast (one at a time, like Fleex) ---------- */
var toastTimer = 0;
function toast(text, kind) {
  var el = $('#toast');
  el.className = kind || ''; el.innerHTML = '<i></i><span>' + esc(text) + '</span>'; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 4200);
}

/* ---------- HUD ---------- */
function setText(id, html) { var el = document.getElementById(id); if (el._h !== html) { el._h = html; el.innerHTML = html; } }
function hud() {
  var k = sim.kpis(), c = sim.clock(), hod = sim.hourOfDay(), night = hod < 7 || hod >= 20;
  setText('clock', (night ? '☾ ' : '☀ ') + c.dow + ' ' + ('0' + c.hh).slice(-2) + ':' + ('0' + c.mm).slice(-2) + '<small>jour ' + c.day + '</small>');
  setText('k-flow', k.perHour.toFixed(1) + '<small>/h · ' + k.shipped24 + ' / 24 h</small>');
  setText('k-wip', String(k.wip));
  setText('k-lead', dur(k.lead));
  setText('k-focus', k.focus + (k.focus ? '<small>' + dur(k.oldest) + '</small>' : ''));
  setText('k-pool', k.outage ? 'panne API' : k.poolUsed + ' / ' + k.poolMax);
  $('#k-poolbar').style.width = Math.min(100, k.poolUsed / k.poolMax * 100) + '%';
  $('#k-poolbar').style.background = k.poolUsed >= k.poolMax ? '#f59e0b' : '';
  setText('k-cost', money(k.burn) + '<small>/h · ' + money(k.costToday) + ' auj.</small>');
  setText('k-auto', pct(k.autonomy));
  cls('[data-kpi="focus"]', k.focus >= 12 ? 'bad' : k.focus >= 5 ? 'warn' : k.focus === 0 ? 'good' : '');
  cls('[data-kpi="pool"]', k.outage ? 'bad' : k.poolUsed >= k.poolMax ? 'warn' : '');
  cls('[data-kpi="auto"]', k.autonomy >= 0.8 ? 'good' : '');
  var done = sim.objectives.filter(function (o) { return o.done; }).length;
  setText('c-focus', String(k.focus)); $('#c-focus').className = 'cnt' + (k.focus ? ' hot' : '');
  setText('c-goals', done + '/' + sim.objectives.length);
  ui.k = k;
}
function cls(sel, c) { var el = $(sel); var base = 'kpi' + (c ? ' ' + c : ''); if (el.className !== base) el.className = base; }

/* ---------- overlays ---------- */
function heat() {
  var m = new Map(), ov = view.overlay, max = 0, vals = [], W = 12;
  if (ov === 'flow') {
    var sp = sim.span(6);
    sim.segs.forEach(function (sg) { var v = sim.sum(sg.flow, 6) / sp; vals.push([sg, v]); if (v > max) max = v; });
    vals.forEach(function (p) { m.set('s' + p[0].id, { v: max ? Math.sqrt(p[1] / max) : 0, label: p[0].station && p[1] >= 0.05 ? p[1].toFixed(1) + '/h' : '' }); });
  } else if (ov !== 'none') {
    sim.stations.forEach(function (st) {
      var s = sim.stationStats(st, W), v = 0, label = '';
      if (ov === 'cost') { v = s.cost; label = v >= 0.5 ? money(v) : ''; }
      else if (ov === 'time') { v = s.done ? (s.busy / sim.weight(st) + s.slotWait + s.humanWait) / s.done : 0; label = v >= 1 ? dur(v) : ''; }
      else { v = s.humanWait; label = s.waitingNow ? s.waitingNow + ' · ' + dur(s.oldest) : v > 1 ? '⌀ ' + dur(s.avgHuman) : ''; }
      vals.push([st, v, label]); if (v > max) max = v;
    });
    vals.forEach(function (p) { m.set(p[0].id, { v: max && p[2] ? clamp(Math.sqrt(p[1] / max), 0.08, 1) : 0, label: p[2] }); });
  }
  view.heat = m;
  ui.cards = sim.bottlenecks();
  view.beacons = ui.cards.slice(0, 3);
  setText('c-bn', String(ui.cards.length));
  /* in the Human layer, only the tickets waiting for someone stay bright */
  if (ov === 'human') { var s2 = new Set(); sim.focus().forEach(function (f) { s2.add(f.t.id); }); view.shown = s2; } else view.shown = null;
}
function setOverlay(ov) {
  view.overlay = ov;
  document.querySelectorAll('#overlays button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.ov === ov ? 'true' : 'false'); });
  heat(); legend();
}
function legend() {
  var ov = view.overlay, h;
  if (ov === 'none') {
    h = Object.keys(TYPES).map(function (k) { return '<span><i style="background:' + TYPES[k].color + '"></i>' + k + '</span>'; }).join('') +
      '<span><i class="lamp" style="background:#22c55e"></i>en cours</span><span><i class="lamp" style="background:#f59e0b"></i>attend un humain</span>' +
      '<span><i class="lamp" style="background:#60a5fa"></i>attend un slot</span><span><i class="lamp" style="background:#ef4444"></i>en erreur</span>';
  } else {
    var txt = { flow: ['#4ade80', 'Débit par convoyeur, tickets par heure sur 6 h'], cost: ['#fb923c', 'Dépense par poste sur 12 h'],
      time: ['#60a5fa', 'Temps moyen passé par ticket à chaque poste (run + files d’attente)'], human: ['#facc15', 'Attente humaine : tickets en attente et ancienneté'] }[ov];
    h = '<span><i style="background:' + txt[0] + '"></i>' + txt[1] + '</span><span>plus c’est clair, plus c’est élevé</span>';
  }
  $('#legend').innerHTML = h;
}

/* ---------- selection ---------- */
function select(sel, look) {
  ui.sel = sel; view.sel = sel;
  if (sel) {
    setTab('inspect');
    if (look && sel.type !== 'ticket' && sel.type !== 'lane') view.lookAt(sel.ref.x + sel.ref.w / 2, sel.ref.y + sel.ref.h / 2, Math.max(view.cam.z, 24));
    if (look && sel.type === 'ticket' && sel.t.state !== 'done' && sel.t.state !== 'cancelled') view.lookAt(sel.t.x, sel.t.y, Math.max(view.cam.z, 24));
    if (ui.narrow) $('#panel').classList.remove('closed');
  } else view.follow = null;
  panel(true); layout();
}
function findTicket(id) {
  var t = sim.tickets.get(id);
  if (t) return t;
  for (var i = sim.recent.length - 1; i >= 0; i--) if (sim.recent[i].id === id) return sim.recent[i];
  return null;
}
function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tabs [role=tab]').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'); });
}

/* ---------- panel: bottlenecks ---------- */
function bnHTML() {
  var h = '<p class="lead">Ce qui freine la ligne ou coûte le plus, sur les 12 dernières heures. Les pastilles numérotées sont reportées sur le plan.</p>';
  if (!ui.cards.length) h += '<div class="empty">Aucun goulot détecté. L’usine tourne sans attente notable.</div>';
  ui.cards.forEach(function (c, i) {
    h += '<div class="card"><div class="top"><span class="rank ' + c.kind + '">' + (i + 1) + '</span><span class="chip ' +
      ({ human: 'yellow', question: 'blue', pool: 'blue', cost: 'orange', quality: 'red' }[c.kind]) + '">' + BN[c.kind] + '</span></div>' +
      '<div class="title">' + esc(c.title) + '</div><div class="metric">' + esc(c.metric) + '</div><div class="detail">' + esc(c.detail) + '</div>' +
      (c.fix ? '<div class="hint">' + esc(c.fix.hint) + '</div>' : '') +
      '<div class="row"><button class="btn sm" data-act="bn-see" data-i="' + i + '">Voir sur le plan</button>' +
      (c.fix ? '<button class="btn sm primary" data-act="bn-fix" data-i="' + i + '">' + esc(c.fix.label) + '</button>' : '') + '</div></div>';
  });
  if (ui.applied.length) {
    h += '<p class="sub">Réglages appliqués</p><ul class="log">';
    var k = ui.k || sim.kpis();
    ui.applied.slice(-5).reverse().forEach(function (a) {
      h += '<li><time>' + hhmm(a.at) + '</time>' + esc(a.text);
      if (sim.now - a.at >= 90) {
        var d = [signed(k.perHour - a.k.perHour, 1) + ' /h', 'Focus ' + signed(k.focus - a.k.focus, 0), 'autonomie ' + signed((k.autonomy - a.k.autonomy) * 100, 0) + ' pts',
          'coût/ticket ' + (k.costPerTicket >= a.k.costPerTicket ? '+' : '−') + '$' + Math.abs(k.costPerTicket - a.k.costPerTicket).toFixed(2)];
        h += '<br><span style="color:var(--t3)">Depuis : débit ' + d.join(' · ') + '</span>';
      } else h += '<br><span style="color:var(--t3)">Effet mesuré dans ' + dur(90 - (sim.now - a.at)) + '</span>';
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
    var out = it.st.def.outcomes || ['approve'];
    h += '<button class="btn sm primary" data-act="resolve" data-do="approve" ' + k + '>Approuver</button>';
    if (out.indexOf('request_changes') >= 0) h += '<button class="btn sm" data-act="resolve" data-do="request_changes" ' + k + '>Demander des changements</button>';
    if (out.indexOf('reject') >= 0) h += '<button class="btn sm danger" data-act="resolve" data-do="reject" ' + k + '>Rejeter</button>';
  } else if (it.kind === 'route') {
    it.entry.options.forEach(function (l, i) {
      h += '<button class="btn sm' + (i ? '' : ' primary') + '" data-act="resolve" data-do="route:' + l + '" ' + k + '>→ ' + WORKFLOWS[l].name + '</button>';
    });
  } else if (it.kind === 'question') h += '<button class="btn sm primary" data-act="resolve" data-do="answer" ' + k + '>Répondre</button>';
  else h += '<button class="btn sm primary" data-act="resolve" data-do="retry" ' + k + '>Relancer l’étape</button>';
  return h;
}
function focusItem(it) {
  var kd = KIND[it.kind];
  return '<div class="fitem"><div class="l1"><span class="chip ' + kd[1] + '">' + kd[0] + '</span>' + typeChip(it.t) + '<span class="age">' + dur(it.age) + '</span></div>' +
    ticketLink(it.t) + '<div class="where">' + esc(stLabel(it.st)) + (it.kind === 'question' ? ' · waiting_for_info' : it.kind === 'error' ? ' · failed' : it.kind === 'route' ? ' · awaiting_routing' : ' · needs_review') + '</div>' +
    '<div class="row">' + actionsFor(it) + '</div></div>';
}
function focusHTML() {
  var list = sim.focus(), op = sim.op, av = sim.opAvailable();
  var h = '<p class="lead">Tout ce qui attend un humain, le plus ancien d’abord. Votre action part tout de suite ; l’opérateur simulé traite le reste à son rythme.</p>' +
    '<div class="row"><button class="switch" role="switch" data-act="op-toggle" aria-checked="' + op.enabled + '"><i></i>Opérateur simulé</button><span class="spacer"></span>' +
    '<span class="chip ' + (av ? 'green' : 'gray') + '">' + (!op.enabled ? 'désactivé' : av ? (op.state === 'work' ? 'traite un élément' : 'en poste') : sim.now < op.awayUntil ? 'en réunion' : 'hors horaires') + '</span></div>';
  if (!list.length) return h + '<div class="empty">Rien en attente. Les agents avancent seuls.</div>';
  var gates = list.filter(function (i) { return i.kind === 'gate'; }).length;
  if (gates > 1) h += '<div class="row"><button class="btn sm" data-act="approve-all">Approuver les ' + gates + ' gates</button></div>';
  list.slice(0, 30).forEach(function (it) { h += focusItem(it); });
  if (list.length > 30) h += '<p class="lead">+ ' + (list.length - 30) + ' autres éléments.</p>';
  return h;
}

/* ---------- panel: inspector ---------- */
function whereIs(t) {
  if (t.state === 'done') return 'Expédié à ' + hhmm(t.doneAt);
  if (t.state === 'cancelled') return 'Rejeté (cancelled)';
  var loc = t.loc;
  if (!loc) return 'En stock au quai ' + t.sourceName;
  if (loc.pts) return loc.kind === 'rework' ? 'Reprise, retour vers ' + loc.station.name : loc.station ? 'Sur le convoyeur vers ' + loc.station.name : t.triaged ? 'Sur le bus de distribution' : 'Sur le convoyeur d’intake';
  if (loc.seg) return 'Dans le bras du poste ' + loc.st.name;
  var st = loc, i;
  for (i = 0; i < st.rack.length; i++) if (st.rack[i].t === t) return st.name + ' · ' + (st.rack[i].kind === 'route' ? 'awaiting_routing' : 'needs_review');
  for (i = 0; i < st.cells.length; i++) if (st.cells[i].t === t) {
    var c = st.cells[i];
    return st.name + ' · ' + (c.state === 'question' ? 'waiting_for_info' : c.state === 'failed' ? 'failed' : c.state === 'queued' ? 'queued, attend un slot' : 'running ' + Math.round(c.p * 100) + ' %');
  }
  return st.name + ' · completed, attend le convoyeur';
}
function ticketHTML(t) {
  var live = t.state !== 'done' && t.state !== 'cancelled', it = null;
  if (live) sim.focus().forEach(function (f) { if (f.t === t) it = f; });
  var h = '<div class="row">' + typeChip(t) + '<span class="chip">' + t.priority + '</span>' + (t.reworks ? '<span class="chip orange">' + t.reworks + ' reprise' + (t.reworks > 1 ? 's' : '') + '</span>' : '') + '</div>' +
    '<h2 class="h"><span class="num" style="color:var(--t2);font-size:12px">' + t.displayId + '</span><br>' + esc(t.title) + '</h2>' +
    '<p class="lead">' + esc(whereIs(t)) + '</p>';
  if (it) h += '<div class="row">' + actionsFor(it) + '</div>';
  if (live) h += '<div class="row"><button class="btn sm" data-act="follow" aria-pressed="' + (view.follow === t) + '">' + (view.follow === t ? 'Suivi en cours' : 'Suivre sur le plan') + '</button></div>';
  h += '<dl class="kv"><dt>Source</dt><dd>' + esc(t.sourceName) + (t.parent ? ' · issu de ' + t.parent : '') + '</dd>' +
    '<dt>Workflow</dt><dd>' + (t.wf ? esc(t.wf.name) + ' <span class="num" style="color:var(--t3)">@workflow:' + t.wf.slug + '</span>' : 'pas encore trié') + '</dd>' +
    '<dt>Complexité</dt><dd class="num">' + t.complexity + '</dd>' +
    '<dt>Coût cumulé</dt><dd class="num">' + money(t.cost) + '</dd>' +
    '<dt>' + (live ? 'Âge' : 'Lead time') + '</dt><dd class="num">' + dur((live ? sim.now : t.doneAt) - t.born) + '</dd>' +
    '<dt>Attente humaine</dt><dd class="num">' + dur(t.humanWait) + ' · ' + t.touches + ' intervention' + (t.touches > 1 ? 's' : '') + '</dd>' +
    '<dt>File de slots</dt><dd class="num">' + dur(t.slotWait) + '</dd></dl>';
  h += '<p class="sub">Runs d’étapes</p>';
  if (!t.history.length) h += '<p class="lead">Aucune étape terminée pour l’instant.</p>';
  else {
    h += '<ul class="tl">';
    t.history.forEach(function (r) {
      var c = r.result === 'ko' || r.result === 'cancelled' ? 'ko' : r.exec === 'human_gate' && r.human ? 'hum' : '';
      h += '<li><span class="dot ' + c + '"></span><span>' + esc(r.step) + (r.attempt > 1 ? ' <small>essai ' + r.attempt + '</small>' : '') + ' <small>' +
        (r.result === 'ko' ? (r.exec === 'human_gate' ? 'request_changes' : 'ko') : r.result) + '</small></span>' +
        '<span class="m">' + (r.human ? 'attente ' + dur(r.human) : dur(r.dur) + (r.cost ? ' · ' + money(r.cost) : '')) + '</span></li>';
    });
    h += '</ul>';
  }
  return h;
}
function runsHTML(st) {
  var h = '', n = 0;
  st.cells.forEach(function (c) {
    if (n++ >= 8) return;
    h += '<div class="fitem"><div class="l1">' + typeChip(c.t) + (c.state === 'question' ? '<span class="chip blue">waiting_for_info</span>' : c.state === 'failed' ? '<span class="chip red">failed</span>' : c.state === 'judge' ? '<span class="chip">agent juge</span>' : c.state === 'queued' ? '<span class="chip blue">queued</span>' : '') +
      '<span class="age">' + money(c.spent) + '</span></div>' + ticketLink(c.t) +
      '<div class="run"><div class="prog"><i style="width:' + Math.round(c.p * 100) + '%"></i></div><span class="pct">' + Math.round(c.p * 100) + ' %</span></div>' +
      (c.state === 'question' || c.state === 'failed' ? '<div class="row">' + actionsFor({ key: c.t.id + ':' + st.id, kind: c.state === 'failed' ? 'error' : 'question', st: st, t: c.t, cell: c }) + '</div>' : '') + '</div>';
  });
  return h;
}
function stationHTML(st) {
  var s = sim.stationStats(st, 12), d = st.def, gate = st.exec === 'human_gate', h = '';
  h += '<div class="row">' + (st.lane ? '<span class="chip" style="color:' + st.lane.wf.color + '"><i></i>' + esc(st.lane.wf.name) + '</span>' : '<span class="chip">Intake</span>') +
    '<span class="chip">' + st.exec + '</span>' + (d.mode ? '<span class="chip">mode ' + d.mode + '</span>' : '') + '</div>' +
    '<h2 class="h">' + esc(st.name) + '</h2><p class="lead">' + (d.router ? 'Qualifie chaque demande entrante, lui donne un type et choisit son workflow.' : EXEC[st.exec]) +
    (d.ref ? ' <span class="num" style="color:var(--t3)">' + esc(d.ref) + '</span>' : '') + '</p>';
  if (gate) {
    h += '<div class="field"><span class="lab">Politique de contrôle</span><div class="seg wide" role="group">' +
      [['human', 'Humain'], ['sampled', 'Échantillonné'], ['auto', 'Automatique']].map(function (p) {
        return '<button data-act="policy" data-v="' + p[0] + '" aria-pressed="' + (st.policy === p[0]) + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<span class="help">' + ({ human: 'Chaque ticket attend votre décision.', sampled: 'Un agent juge laisse passer les tickets à faible risque ; les autres vous attendent.',
        auto: 'Aucun contrôle : tout passe. Surveillez les défauts échappés.' }[st.policy]) + '</span></div>';
    h += '<div class="stats">' + stat('En attente', s.waitingNow) + stat('Attente moy.', dur(s.avgHuman)) + stat('Plus ancien', s.waitingNow ? dur(s.oldest) : '—') +
      stat('Décisions 12 h', s.touches) + stat('Passés seuls', s.auto) + stat('Renvoyés', pct(s.koRate)) + '</div>';
    if (st.rack.length) {
      h += '<p class="sub">Sur l’étagère</p>';
      if (st.rack.length > 1) h += '<div class="row"><button class="btn sm" data-act="approve-st">Tout approuver (' + st.rack.length + ')</button></div>';
      st.rack.slice(0, 12).forEach(function (e) { h += focusItem({ key: e.t.id + ':' + st.id, kind: 'gate', st: st, t: e.t, since: e.since, age: sim.now - e.since, entry: e }); });
    }
    h += runsHTML(st);
    return h;
  }
  if (st.model) {
    h += '<div class="field"><label for="sel-model">Modèle</label><select id="sel-model" data-act="model">' +
      F.MODEL_ORDER.map(function (m) { var o = MODELS[m]; return '<option value="' + m + '"' + (m === st.model ? ' selected' : '') + '>' + o.label + ' · coût ×' + o.cost + ' · durée ×' + o.speed + '</option>'; }).join('') +
      '</select><span class="help">Un modèle plus léger coûte moins et va plus vite, mais laisse plus de défauts aux contrôles en aval.</span></div>';
  }
  h += '<div class="stats">' + stat('Traités 12 h', s.done) + stat('Durée moy.', s.done ? dur(s.avgRun) : '—') + stat('En cours', s.running) +
    stat('Dépense 12 h', money(s.cost)) + stat('Par ticket', s.done ? money(s.costPer) : '—') + stat('File slots', dur(s.slotWait)) +
    (d.check ? stat('Renvoyés (ko)', pct(s.koRate)) : '') + (s.humanWait > 1 ? stat('Attente hum.', dur(s.humanWait)) : '') + '</div>';
  if (st.rack.length) {
    h += '<p class="sub">Routage ambigu</p>';
    st.rack.forEach(function (e) { h += focusItem({ key: e.t.id + ':' + st.id, kind: 'route', st: st, t: e.t, since: e.since, age: sim.now - e.since, entry: e }); });
  }
  if (st.cells.length) { h += '<p class="sub">Runs en cours</p>' + runsHTML(st); }
  else h += '<p class="lead">Aucun run en cours sur ce poste.</p>';
  return h;
}
function sourceHTML(src) {
  var h = '<div class="row"><span class="chip">Quai d’intake</span></div><h2 class="h">' + esc(src.name) + '</h2>';
  if (src.internal) {
    return h + '<p class="lead">Piste d’atterrissage des tickets créés par un workflow (<span class="num">ticket.create</span>). Les drones viennent de Specification et d’Ideation.</p>' +
      '<div class="stats">' + stat('Reçus 24 h', sim.sum(src.emitted, 24)) + stat('En stock', src.buffer.length) + '</div>';
  }
  h += '<p class="lead">Les demandes captées ici deviennent des tickets bruts, puis passent au tri.</p>' +
    '<div class="row"><button class="switch" role="switch" data-act="src-toggle" aria-checked="' + src.on + '"><i></i>Source active</button></div>' +
    '<div class="field"><label for="src-rate">Volume : <span class="num">' + Math.round(src.perDay) + '</span> tickets par jour</label>' +
    '<input type="range" id="src-rate" data-act="src-rate" min="0" max="60" step="1" value="' + Math.round(src.perDay) + '"></div>' +
    '<div class="stats">' + stat('Émis 24 h', sim.sum(src.emitted, 24)) + stat('En stock', src.buffer.length) + '</div><p class="sub">Injecter un ticket</p><div class="row">';
  Object.keys(src.def.mix).forEach(function (k) { h += '<button class="btn sm" data-act="inject" data-type="' + k + '">+ ' + k + '</button>'; });
  return h + '</div>';
}
function poolHTML() {
  var p = sim.pool, used = sim.series(p.usedMin, 24), full = sim.series(p.fullMin, 24), W = 6, h;
  h = '<div class="row"><span class="chip blue">Capacité</span></div><h2 class="h">Slots agents</h2>' +
    '<p class="lead">Fleex lance tout en parallèle, dans la limite de <span class="num">agentMaxConcurrency</span>. Au-delà, les runs attendent leur tour, premier arrivé, premier servi. C’est la seule file d’attente côté agents, et elle est commune à toute l’usine.</p>' +
    '<div class="field"><label for="pool-max">agentMaxConcurrency : <span class="num">' + p.max + '</span></label><input type="range" id="pool-max" data-act="pool-max" min="2" max="32" step="1" value="' + p.max + '"></div>' +
    '<div class="stats">' + stat('Occupés', p.used + ' / ' + p.max) + stat('Saturé 6 h', pct(sim.sum(p.fullMin, W) / (sim.span(W) * 60))) + stat('Moyenne 24 h', (sim.sum(p.usedMin, 24) / (sim.span(24) * 60)).toFixed(1)) + '</div>' +
    '<p class="sub">Occupation moyenne par heure, 24 h</p><div class="bars24" role="img" aria-label="Occupation des slots sur 24 heures">';
  used.forEach(function (v, i) { h += '<i class="' + (full[i] > 6 ? 'full' : '') + '" style="height:' + Math.min(100, v / 60 / p.max * 100) + '%" data-tip="' + (v / 60).toFixed(1) + ' slots occupés en moyenne' + (full[i] > 6 ? ' · saturé ' + Math.round(full[i]) + ' min' : '') + '"></i>'; });
  return h + '</div><p class="lead">En ambre : les heures où la limite a été atteinte.</p>';
}
function operatorHTML() {
  var op = sim.op, av = sim.opAvailable(), f = sim.focus();
  return '<div class="row"><span class="chip yellow">Humain</span></div><h2 class="h">Poste opérateur</h2>' +
    '<p class="lead">Une seule personne traite les gates, les questions et les erreurs, une à la fois, de 9:00 à 12:30 puis de 13:30 à 18:30. La nuit, les agents continuent et les gates se remplissent.</p>' +
    '<div class="row"><button class="switch" role="switch" data-act="op-toggle" aria-checked="' + op.enabled + '"><i></i>Opérateur simulé</button></div>' +
    '<div class="stats">' + stat('État', !op.enabled ? 'manuel' : av ? 'en poste' : 'absent') + stat('Traités 24 h', sim.sum(op.handled, 24)) + stat('En attente', f.length) + '</div>' +
    '<div class="row"><button class="btn sm" data-act="scenario" data-sc="meeting">Envoyer en réunion 2 h</button><button class="btn sm" data-act="tab" data-tab="focus">Ouvrir Focus</button></div>';
}
function dockHTML() {
  var h = '<div class="row"><span class="chip green">Done</span></div><h2 class="h">Expédition</h2><p class="lead">Ce qui sort de l’usine : PR mergées, PRD et specs.</p><div class="tw"><table class="t"><tr><th>Workflow</th><th>24 h</th><th>Lead</th><th>$/ticket</th></tr>';
  sim.lanes.forEach(function (l) { var s = sim.laneStats(l); h += '<tr><td><i style="background:' + l.wf.color + '"></i>' + esc(l.wf.name) + '</td><td>' + s.shipped24 + '</td><td>' + (s.n ? dur(s.lead) : '—') + '</td><td>' + (s.n ? money(s.cost) : '—') + '</td></tr>'; });
  h += '</table></div><p class="sub">Derniers tickets sortis</p>';
  sim.recent.slice(-8).reverse().forEach(function (t) {
    h += '<div class="fitem"><div class="l1">' + typeChip(t) + (t.state === 'cancelled' ? '<span class="chip red">rejeté</span>' : '') + '<span class="age">' + hhmm(t.doneAt) + ' · ' + money(t.cost) + '</span></div>' + ticketLink(t) + '</div>';
  });
  return h;
}
function laneHTML(ln) {
  var s = sim.laneStats(ln), wf = ln.wf, gates = ln.stations.filter(function (st) { return st.exec === 'human_gate'; });
  var h = '<div class="row"><span class="chip" style="color:' + wf.color + '"><i></i>Ligne</span><span class="chip">' + (gates.length ? gates.length + ' human_gate' : 'sans HITL') + '</span></div>' +
    '<h2 class="h">' + esc(wf.name) + '</h2><p class="lead">' + esc(wf.desc) + ' <span class="num" style="color:var(--t3)">@workflow:' + wf.slug + '</span></p>' +
    '<div class="stats">' + stat('Expédiés 24 h', s.shipped24) + stat('En cours', s.wip) + stat('Lead médian', s.n ? dur(s.lead) : '—') +
    stat('Coût / ticket', s.n ? money(s.cost) : '—') + stat('Sans humain', s.n ? pct(s.autonomy) : '—') + stat('Reprises', s.n ? s.reworks.toFixed(2) : '—') + '</div>';
  if (gates.length) {
    var pol = gates.every(function (g) { return g.policy === gates[0].policy; }) ? gates[0].policy : '';
    h += '<div class="field"><span class="lab">Contrôles humains de la ligne</span><div class="seg wide" role="group">' +
      [['human', 'Humain'], ['sampled', 'Échantillonné'], ['auto', 'Automatique']].map(function (p) {
        return '<button data-act="lane-policy" data-v="' + p[0] + '" aria-pressed="' + (pol === p[0]) + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<span class="help">Règle d’un coup les ' + gates.length + ' postes de contrôle de la ligne.</span></div>';
  }
  h += '<p class="sub">Chaîne de valeur, 12 h</p><div class="tw"><table class="t"><tr><th>Poste</th><th>Traités</th><th>Dépense</th><th>Attente</th></tr>';
  ln.stations.forEach(function (st) {
    var x = sim.stationStats(st, 12), wait = x.humanWait + x.slotWait;
    h += '<tr><td><button class="tlink" data-act="station" data-id="' + st.id + '">' + esc(st.name) + '</button></td><td>' + x.done + '</td><td>' + (x.cost > 0.005 ? money(x.cost) : '—') + '</td><td>' + (wait > 1 ? dur(wait) : '—') + '</td></tr>';
  });
  return h + '</table></div><p class="lead">Attente : file de slots et attente humaine cumulées. Cliquez un poste pour le régler.</p>';
}
function inspectHTML() {
  var s = ui.sel;
  if (!s) return '<div class="empty">Cliquez un poste, une ligne, un quai, un ticket, le poste opérateur ou les slots agents sur le plan pour l’inspecter et le régler.</div>' +
    '<p class="sub">Raccourcis</p><p class="lead"><kbd>Espace</kbd> pause · <kbd>1</kbd>–<kbd>4</kbd> vitesse · <kbd>F</kbd> toute l’usine · <kbd>O</kbd> calque · <kbd>P</kbd> production · <kbd>Échap</kbd> désélectionner</p>';
  if (s.type === 'ticket') return ticketHTML(s.t);
  if (s.type === 'station') return stationHTML(s.ref);
  if (s.type === 'source') return sourceHTML(s.ref);
  if (s.type === 'pool') return poolHTML();
  if (s.type === 'operator') return operatorHTML();
  if (s.type === 'lane') return laneHTML(s.ref);
  return dockHTML();
}

/* ---------- panel: objectives ---------- */
function goalsHTML() {
  var done = sim.objectives.filter(function (o) { return o.done; }).length, k = ui.k || sim.kpis();
  var levels = ['Atelier', 'Manufacture', 'Usine', 'Usine autonome'], lv = done >= 6 ? 3 : done >= 4 ? 2 : done >= 2 ? 1 : 0;
  var h = '<div class="level"><div class="row"><span class="n">Niveau ' + (lv + 1) + ' · ' + levels[lv] + '</span><span class="spacer"></span><span class="num">' + done + ' / ' + sim.objectives.length + '</span></div>' +
    '<div class="prog" style="margin-top:8px"><i style="width:' + (done / sim.objectives.length * 100) + '%;background:var(--hazard)"></i></div>' +
    '<p class="lead" style="margin-top:8px">Autonomie ' + pct(k.autonomy) + ' · ' + k.escapes24 + ' défaut' + (k.escapes24 > 1 ? 's' : '') + ' échappé' + (k.escapes24 > 1 ? 's' : '') + ' en 24 h · contrôles passés du premier coup ' + pct(k.fpy) + '</p></div>';
  sim.objectives.forEach(function (o) {
    var v = o.value || o.eval(), p = o.done ? 1 : v[2] ? v[0] / v[1] : o.lower ? clamp(v[1] / Math.max(v[0], 0.01), 0, 1) : clamp(v[0] / v[1], 0, 1);
    h += '<div class="obj' + (o.done ? ' done' : '') + '"><div class="o1"><span class="check">' + (o.done ? '✓' : '') + '</span><b>' + esc(o.name) + '</b><span class="v">' + (o.done ? 'atteint' : o.fmt(v)) + '</span></div>' +
      '<div class="detail" style="color:var(--t2);font-size:12px">' + esc(o.desc) + '</div><div class="prog"><i style="width:' + Math.round(p * 100) + '%"></i></div></div>';
  });
  var log = sim.log.slice(-7).reverse();
  if (log.length) { h += '<p class="sub">Journal de l’usine</p><ul class="log">'; log.forEach(function (l) { h += '<li><time>' + hhmm(l.at) + '</time>' + esc(l.text) + '</li>'; }); h += '</ul>'; }
  return h;
}

function panel(force) {
  if (ui.hold && !force) return;
  var body = $('#pbody'), ae = document.activeElement;
  if (!force && ae && ae.tagName === 'SELECT' && body.contains(ae)) return;
  var html = ui.tab === 'bottlenecks' ? bnHTML() : ui.tab === 'focus' ? focusHTML() : ui.tab === 'goals' ? goalsHTML() : inspectHTML();
  if (html === ui.lastHtml) return;
  var fid = ae && body.contains(ae) ? ae.id : '';
  ui.lastHtml = html; body.innerHTML = html;
  if (fid) { var el = document.getElementById(fid); if (el) el.focus(); }
}

function applied(text) { ui.applied.push({ at: sim.now, text: text, k: ui.k || sim.kpis() }); toast('Réglage appliqué : ' + text); }
function signed(v, digits) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(digits); }
function onPanel(e) {
  var b = e.target.closest('[data-act]'); if (!b) return;
  var act = b.dataset.act, s = ui.sel, list, it;
  if (e.type === 'click' && (b.tagName === 'SELECT' || b.tagName === 'INPUT')) return;
  if (act === 'ticket') { var t = findTicket(+b.dataset.id); if (t) select({ type: 'ticket', t: t, ref: t }, true); return; }
  if (act === 'station') { select({ type: 'station', ref: sim.stations[+b.dataset.id] }, true); return; }
  if (act === 'lane-policy' && s) {
    s.ref.stations.forEach(function (st) { if (st.exec === 'human_gate') sim.setPolicy(st, b.dataset.v); });
    applied(s.ref.wf.name + ' → tous les contrôles en ' + ({ human: 'humain', sampled: 'échantillonné', auto: 'automatique' }[b.dataset.v]));
  } else if (act === 'tab') { setTab(b.dataset.tab); }
  else if (act === 'bn-see') {
    var c = ui.cards[+b.dataset.i]; if (!c) return;
    if (c.st) { view.sel = ui.sel = { type: 'station', ref: c.st }; view.lookAt(c.st.cx, c.st.cy, Math.max(view.cam.z, 26)); }
    else { view.sel = ui.sel = { type: 'pool', ref: sim.pool }; view.lookAt(sim.pool.x + 1.5, sim.pool.y + 1.3, Math.max(view.cam.z, 26)); }
    if (ui.narrow) $('#panel').classList.add('closed');
  } else if (act === 'bn-fix') {
    var cf = ui.cards[+b.dataset.i]; if (!cf || !cf.fix) return;
    cf.fix.apply(); applied(cf.title + ' → ' + cf.fix.label); heat();
  } else if (act === 'resolve') {
    list = sim.focus(); it = list.filter(function (f) { return f.key === b.dataset.key; })[0];
    if (it && sim.resolve(it, b.dataset.do)) {
      var d = b.dataset.do;
      toast(it.t.displayId + ' : ' + (d === 'approve' ? 'approuvé, la pièce repart' : d === 'request_changes' ? 'renvoyé en reprise' : d === 'reject' ? 'rejeté' : d === 'answer' ? 'réponse envoyée, l’agent reprend' : d === 'retry' ? 'étape relancée' : 'routé vers ' + WORKFLOWS[+d.slice(6)].name));
    }
  } else if (act === 'approve-all' || act === 'approve-st') {
    list = sim.focus().filter(function (f) { return f.kind === 'gate' && (act === 'approve-all' || (s && f.st === s.ref)); });
    list.forEach(function (f) { sim.resolve(f, 'approve'); });
    toast(list.length + ' gates approuvées');
  } else if (act === 'op-toggle') { sim.op.enabled = !sim.op.enabled; toast(sim.op.enabled ? 'Opérateur simulé activé' : 'Opérateur simulé désactivé : à vous de traiter Focus'); }
  else if (act === 'follow' && s && s.type === 'ticket') { view.follow = view.follow === s.t ? null : s.t; if (view.follow) { view.goal = null; if (view.cam.z < 22) view.cam.z = 22; } }
  else if (act === 'policy' && s) { sim.setPolicy(s.ref, b.dataset.v); applied(stLabel(s.ref) + ' → contrôle ' + ({ human: 'humain', sampled: 'échantillonné', auto: 'automatique' }[b.dataset.v])); }
  else if (act === 'model' && s) { sim.setModel(s.ref, b.value); applied(stLabel(s.ref) + ' → ' + MODELS[b.value].label); b.blur(); }
  else if (act === 'src-toggle' && s) { s.ref.on = !s.ref.on; }
  else if (act === 'src-rate' && s) { s.ref.perDay = +b.value; var lb = b.parentNode.querySelector('.num'); if (lb) lb.textContent = b.value; return; }
  else if (act === 'pool-max') { sim.setConcurrency(+b.value); var lp = b.parentNode.querySelector('.num'); if (lp) lp.textContent = b.value; return; }
  else if (act === 'inject' && s) { var nt = sim.inject(s.ref.id, b.dataset.type); toast(nt.displayId + ' ajouté au quai ' + s.ref.name); }
  else if (act === 'scenario') scenario(b.dataset.sc);
  panel(true); hud();
}
function scenario(name) {
  if (name === 'ticket') { var t = sim.inject('cli'); toast(t.displayId + ' ajouté depuis CLI · MCP'); select({ type: 'ticket', t: t, ref: t }, false); return; }
  sim.scenario(name);
}

/* ---------- production drawer ---------- */
function lineChart() {
  var n = 24, a = sim.series(sim.g.inn, n + 1).slice(0, n), b = sim.series(sim.g.out, n + 1).slice(0, n);
  var W = 330, H = 178, l = 24, r = 62, t = 10, bt = 22, pw = W - l - r, ph = H - t - bt, max = Math.max(4, Math.max.apply(null, a.concat(b)));
  max = Math.ceil(max / 2) * 2;
  function X(i) { return l + pw * i / (n - 1); } function Y(v) { return t + ph * (1 - v / max); }
  function path(s) { return s.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(''); }
  function hour(i) { return ('0' + ((hr - n + i) % 24 + 24) % 24).slice(-2) + ' h'; }
  var g = '', i, hr = Math.floor(sim.now / 60);
  for (i = 0; i <= 2; i++) { var v = max * i / 2; g += '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#2e2e33" stroke-width="1"/><text x="' + (l - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + v + '</text>'; }
  for (i = 0; i < n; i += 6) g += '<text x="' + X(i) + '" y="' + (H - 5) + '" text-anchor="middle">' + hour(i) + '</text>';
  g += '<text x="' + X(n - 1) + '" y="' + (H - 5) + '" text-anchor="middle">' + hour(n - 1) + '</text>';
  g += '<path d="' + path(a) + '" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round"/><path d="' + path(b) + '" fill="none" stroke="var(--s2)" stroke-width="2" stroke-linejoin="round"/>';
  var ya = Y(a[n - 1]), yb = Y(b[n - 1]); if (Math.abs(ya - yb) < 14) { if (ya <= yb) { ya -= 7; yb += 7; } else { ya += 7; yb -= 7; } }
  g += '<circle cx="' + X(n - 1) + '" cy="' + Y(a[n - 1]) + '" r="4" fill="var(--s1)" stroke="#18181b" stroke-width="2"/><circle cx="' + X(n - 1) + '" cy="' + Y(b[n - 1]) + '" r="4" fill="var(--s2)" stroke="#18181b" stroke-width="2"/>' +
    '<text class="v" x="' + (X(n - 1) + 10) + '" y="' + (ya + 4) + '">' + a[n - 1] + ' entrés</text><text class="v" x="' + (X(n - 1) + 10) + '" y="' + (yb + 4) + '">' + b[n - 1] + ' sortis</text>';
  for (i = 0; i < n; i++) g += '<rect class="hitbar" x="' + (X(i) - pw / n / 2) + '" y="' + t + '" width="' + (pw / n) + '" height="' + ph + '" fill="transparent" data-tip="' +
    hour(i) + ' · ' + a[i] + ' entrés · ' + b[i] + ' expédiés"/>';
  return '<div class="viz"><h3>Entrées et sorties par heure</h3><p class="cap">Tickets arrivés à l’intake et tickets expédiés, 24 dernières heures pleines.</p>' +
    '<div class="lg"><span><i style="background:var(--s1)"></i>Entrés</span><span><i style="background:var(--s2)"></i>Expédiés</span></div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Entrées et sorties par heure">' + g + '</svg></div>';
}
function costChart() {
  var rows = sim.stations.map(function (st) { var s = sim.stationStats(st, 12); return { st: st, v: s.cost, per: s.costPer, done: s.done }; })
    .filter(function (r) { return r.v > 0.3; }).sort(function (a, b) { return b.v - a.v; });
  var total = rows.reduce(function (a, r) { return a + r.v; }, 0), top = rows.slice(0, 7), max = top.length ? top[0].v : 1;
  var W = 330, rh = 29, H = top.length * rh + 2, g = '';
  top.forEach(function (o, i) {
    var y = i * rh + 2, w = Math.max(3, W * o.v / max);
    g += '<text x="0" y="' + (y + 11) + '">' + esc(stLabel(o.st)) + '</text><text class="v" x="' + W + '" y="' + (y + 11) + '" text-anchor="end">' + money(o.v) + '</text>' +
      '<rect x="0" y="' + (y + 16) + '" width="' + W + '" height="8" rx="4" fill="#27272a"/>' +
      '<rect x="0" y="' + (y + 16) + '" width="' + w.toFixed(1) + '" height="8" rx="4" fill="var(--s1)"/>' +
      '<rect class="hitbar" x="0" y="' + y + '" width="' + W + '" height="' + (rh - 2) + '" fill="transparent" data-tip="' + esc(stLabel(o.st)) + ' · ' + money(o.v) + ' · ' + pct(o.v / total) + ' de la dépense · ' + money(o.per) + ' par ticket"/>';
  });
  return '<div class="viz"><h3>Dépense par poste</h3><p class="cap">Les 7 postes les plus coûteux sur 12 h. Total, tous postes : ' + money(total) + '.</p>' +
    '<svg viewBox="0 0 ' + W + ' ' + Math.max(H, 40) + '" role="img" aria-label="Dépense par poste">' + g + '</svg></div>';
}
function timeChart() {
  var rows = sim.lanes.map(function (ln) { var s = sim.laneStats(ln); return { ln: ln, a: s.agent, q: s.slot, h: s.human, n: s.n }; });
  var max = Math.max.apply(null, rows.map(function (r) { return r.a + r.q + r.h; }).concat([1]));
  var W = 330, rh = 34, H = rows.length * rh + 2, g = '', cols = ['var(--s1)', 'var(--s2)', 'var(--s3)'], names = ['Agents au travail', 'File de slots', 'Attente humaine'];
  rows.forEach(function (o, i) {
    var y = i * rh + 2, x = 0, tot = o.a + o.q + o.h;
    g += '<text x="0" y="' + (y + 11) + '">' + esc(o.ln.wf.name) + '</text><text class="v" x="' + W + '" y="' + (y + 11) + '" text-anchor="end">' + (o.n ? dur(tot) : '—') + '</text>';
    [o.a, o.q, o.h].forEach(function (v, k) {
      var w = W * v / max; if (w < 0.8) return;
      g += '<rect x="' + x.toFixed(1) + '" y="' + (y + 16) + '" width="' + Math.max(1.5, w - 2).toFixed(1) + '" height="11" rx="3" fill="' + cols[k] + '" data-tip="' + esc(o.ln.wf.name) + ' · ' + names[k] + ' : ' + dur(v) + ' par ticket (' + pct(v / (tot || 1)) + ')"/>';
      x += w;
    });
  });
  return '<div class="viz"><h3>Où passe le temps d’un ticket</h3><p class="cap">Moyenne par ticket expédié, par workflow (40 derniers).</p>' +
    '<div class="lg">' + names.map(function (n, k) { return '<span><i style="background:' + cols[k] + '"></i>' + n + '</span>'; }).join('') + '</div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Répartition du temps par workflow">' + g + '</svg></div>';
}
function prodTable() {
  var h = '<div class="viz wide"><h3>Par workflow</h3><div class="tw"><table class="t"><tr><th>Workflow</th><th>Expédiés 24 h</th><th>En cours</th><th>Lead médian</th><th>Coût / ticket</th><th>Sans humain</th><th>Reprises / ticket</th><th>Rejetés</th></tr>';
  sim.lanes.forEach(function (l) {
    var s = sim.laneStats(l);
    h += '<tr><td><i style="background:' + l.wf.color + '"></i>' + esc(l.wf.name) + '</td><td>' + s.shipped24 + '</td><td>' + s.wip + '</td><td>' + (s.n ? dur(s.lead) : '—') + '</td><td>' + (s.n ? money(s.cost) : '—') +
      '</td><td>' + (s.n ? pct(s.autonomy) : '—') + '</td><td>' + (s.n ? s.reworks.toFixed(2) : '—') + '</td><td>' + l.scrapped + '</td></tr>';
  });
  return h + '</table></div></div>';
}
function production() {
  if (!ui.prod || ui.holdProd) return;
  var html = lineChart() + costChart() + timeChart() + prodTable();
  if (html !== ui.prodHtml) { ui.prodHtml = html; $('#prod-body').innerHTML = html; }
}
function toggleProd(on) {
  ui.prod = on == null ? !ui.prod : on;
  $('#prod').hidden = !ui.prod; $('#btn-prod').setAttribute('aria-pressed', ui.prod ? 'true' : 'false');
  ui.prodHtml = ''; production();
}

/* ---------- tooltip ---------- */
function tipShow(html, x, y) {
  var el = $('#tip'); el.innerHTML = html; el.hidden = false;
  var w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = clamp(x + 14, 6, window.innerWidth - w - 6) + 'px';
  el.style.top = clamp(y + 16 + h > window.innerHeight ? y - h - 10 : y + 16, 6, window.innerHeight - h - 6) + 'px';
}
function tipHide() { $('#tip').hidden = true; }
function hoverTip(p) {
  if (p.type === 'ticket') return '<b>' + p.t.displayId + '</b> ' + esc(p.t.title) + '<div class="d">' + (p.t.triaged ? p.t.type + ' · ' : 'brut · ') + esc(whereIs(p.t)) + ' · ' + money(p.t.cost) + '</div>';
  if (p.type === 'station') {
    var st = p.ref, s = sim.stationStats(st, 12);
    return '<b>' + esc(stLabel(st)) + '</b><div class="d">' + st.exec + (st.model ? ' · ' + MODELS[st.model].label : '') + '<br>' +
      (st.exec === 'human_gate' ? s.waitingNow + ' en attente' + (s.waitingNow ? ' · plus ancien ' + dur(s.oldest) : '') : s.running + ' en cours · ' + s.done + ' traités en 12 h · ' + money(s.cost)) + '</div>';
  }
  if (p.type === 'source') return '<b>' + esc(p.ref.name) + '</b><div class="d">' + (p.ref.internal ? 'tickets créés par un workflow' : Math.round(p.ref.perDay) + ' tickets par jour') + '</div>';
  if (p.type === 'pool') return '<b>Slots agents</b><div class="d">' + sim.pool.used + ' occupés sur ' + sim.pool.max + ' (agentMaxConcurrency)</div>';
  if (p.type === 'operator') return '<b>Poste opérateur</b><div class="d">' + (sim.opAvailable() ? 'en poste' : 'absent') + ' · ' + sim.focus().length + ' éléments en attente</div>';
  return '<b>Expédition</b><div class="d">' + sim.sum(sim.g.out, 24) + ' tickets sortis en 24 h</div>';
}

/* ---------- canvas input ---------- */
function bindCanvas() {
  var cv = $('#floor'), pts = new Map(), moved = 0, pinch = 0, start = null;
  function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  cv.addEventListener('pointerdown', function (e) {
    cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, pos(e)); moved = 0; start = pos(e);
    if (pts.size === 2) { var a = Array.from(pts.values()); pinch = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
    tipHide();
  });
  cv.addEventListener('pointermove', function (e) {
    var p = pos(e), prev = pts.get(e.pointerId);
    if (!prev) {
      if (e.pointerType !== 'mouse') return;
      var hit = view.pick(p.x, p.y); view.hover = hit; cv.classList.toggle('hit', !!hit && hit.type !== 'lane');
      if (hit && hit.type !== 'lane') tipShow(hoverTip(hit), e.clientX, e.clientY); else tipHide();
      return;
    }
    if (pts.size === 1) {
      var dx = p.x - prev.x, dy = p.y - prev.y; moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 5) { view.cam.x -= dx / view.cam.z; view.cam.y -= dy / view.cam.z; view.goal = null; view.follow = null; cv.classList.add('drag'); }
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
    pts.delete(e.pointerId); cv.classList.remove('drag');
    if (pts.size < 2) pinch = 0;
    if (moved <= 5 && pts.size === 0 && e.type === 'pointerup') {
      var p = pos(e), hit = view.pick(p.x, p.y);
      select(hit, false);
      if (!hit && ui.tab === 'inspect') panel(true);
    }
  }
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', function () { view.hover = null; tipHide(); });
  cv.addEventListener('wheel', function (e) {
    e.preventDefault(); var p = pos(e); view.follow = null;
    view.zoomAt(p.x, p.y, Math.exp(-clamp(e.deltaY, -120, 120) * (e.ctrlKey ? 0.012 : 0.0022)));
  }, { passive: false });
  cv.addEventListener('dblclick', function (e) { var p = pos(e); view.zoomAt(p.x, p.y, 1.6); });

  var mini = $('#mini'), mdown = false;
  function mgo(e) { var r = mini.getBoundingClientRect(), w = view.miniToWorld(e.clientX - r.left, e.clientY - r.top); if (w) { view.cam.x = clamp(w.x, 0, F.LAY.W); view.cam.y = clamp(w.y, 0, F.LAY.H); view.goal = null; view.follow = null; } }
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
  view.inset = ui.narrow ? { l: 4, t: hudH + $('#strip').offsetHeight + 14, r: 4, b: pn.offsetHeight + 6 } : { l: 14, t: hudH + $('#strip').offsetHeight + 22, r: pn.offsetWidth + 28, b: 54 };
}

function fitZoom() { var I = view.inset; return Math.min((view.w - I.l - I.r) / (F.LAY.W + 1), (view.h - I.t - I.b) / (F.LAY.H + 1)); }

/* ---------- boot ---------- */
function boot() {
  sim = new F.Sim(20261114);
  sim.prewarm(34.25 * 60);            /* opens on Tuesday 10:15, with a night's backlog on the gates */
  view = new F.View($('#floor'), sim);
  view.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  view.shown = null;
  window.__factory = { sim: sim, view: view, ui: ui };

  view.resize(); layout();
  if (ui.narrow) { $('#panel').classList.add('closed'); layout(); view.frame(4, 11, 30, 19, true); } else view.fit(true);
  ui.fitZ = fitZoom();
  hud(); heat(); legend(); panel(true);

  bindCanvas();
  var pn = $('#panel');
  pn.addEventListener('click', function (e) {
    var tb = e.target.closest('[role=tab]');
    if (tb) { setTab(tb.dataset.tab); pn.classList.remove('closed'); panel(true); layout(); return; }
    if (e.target.closest('#sheet-toggle')) { pn.classList.toggle('closed'); layout(); return; }
    onPanel(e);
  });
  pn.addEventListener('change', onPanel);
  pn.addEventListener('input', function (e) { if (e.target.type === 'range') onPanel(e); });
  pn.addEventListener('pointerdown', function () { ui.hold = true; });
  window.addEventListener('pointerup', function () { setTimeout(function () { ui.hold = false; ui.holdProd = false; }, 60); });
  window.addEventListener('pointercancel', function () { ui.hold = false; ui.holdProd = false; });

  $('#hud').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.speed != null) setSpeed(+b.dataset.speed);
    else if (b.dataset.kpi) {
      var k = b.dataset.kpi;
      if (k === 'flow') setOverlay(view.overlay === 'flow' ? 'none' : 'flow');
      else if (k === 'cost') setOverlay(view.overlay === 'cost' ? 'none' : 'cost');
      else if (k === 'lead') setOverlay(view.overlay === 'time' ? 'none' : 'time');
      else if (k === 'focus') { setTab('focus'); pn.classList.remove('closed'); panel(true); layout(); }
      else if (k === 'pool') select({ type: 'pool', ref: sim.pool }, true);
      else if (k === 'auto') { setTab('goals'); pn.classList.remove('closed'); panel(true); layout(); }
      else if (k === 'wip') toggleProd(true);
    }
  });
  $('#overlays').addEventListener('click', function (e) { var b = e.target.closest('[data-ov]'); if (b) setOverlay(b.dataset.ov); });
  $('#btn-prod').addEventListener('click', function () { toggleProd(); });
  $('#prod-close').addEventListener('click', function () { toggleProd(false); });
  $('#prod').addEventListener('pointerdown', function () { ui.holdProd = true; });
  $('#btn-help').addEventListener('click', function () { $('#intro').hidden = false; });
  $('#intro-go').addEventListener('click', function () { $('#intro').hidden = true; try { localStorage.setItem('fleex-factory-intro', '1'); } catch (err) {} });
  $('#intro').addEventListener('click', function (e) { if (e.target.id === 'intro') $('#intro').hidden = true; });
  document.querySelector('.toolbar').addEventListener('click', function (e) { var b = e.target.closest('[data-sc]'); if (b) scenario(b.dataset.sc); });
  $('#z-in').addEventListener('click', function () { view.zoomAt(view.w / 2, view.h / 2, 1.4); });
  $('#z-out').addEventListener('click', function () { view.zoomAt(view.w / 2, view.h / 2, 1 / 1.4); });
  $('#z-fit').addEventListener('click', function () { view.fit(); });

  /* chart and bar tooltips */
  document.addEventListener('mousemove', function (e) {
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (t) tipShow(esc(t.dataset.tip), e.clientX, e.clientY); else if (e.target.id !== 'floor') tipHide();
  });
  document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) tipShow(esc(t.dataset.tip), e.clientX, e.clientY); });

  window.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
    var k = e.key;
    if (k === ' ') { e.preventDefault(); setSpeed(ui.speed ? 0 : ui.lastSpeed); }
    else if (k >= '1' && k <= '4') setSpeed([1, 3, 8, 20][+k - 1]);
    else if (k === 'f' || k === 'F') view.fit();
    else if (k === 'o' || k === 'O') setOverlay(OVERLAYS[(OVERLAYS.indexOf(view.overlay) + 1) % OVERLAYS.length]);
    else if (k === 'p' || k === 'P') toggleProd();
    else if (k === 'Escape') { if (!$('#intro').hidden) $('#intro').hidden = true; else if (ui.prod) toggleProd(false); else select(null); }
  });
  window.addEventListener('resize', function () { view.resize(); layout(); ui.fitZ = fitZoom(); });

  var seen = false; try { seen = localStorage.getItem('fleex-factory-intro') === '1'; } catch (err) {}
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
    if (ts - tPanel > 400) { tPanel = ts; panel(); }
    if (ts - tHeat > 900) { tHeat = ts; heat(); }
    if (ts - tMini > 120 && !ui.narrow) {
      tMini = ts;
      var zoomed = view.cam.z > ui.fitZ * 1.3, mb = $('#mini-box');
      if (mb.hidden === zoomed) mb.hidden = !zoomed;
      if (zoomed) view.minimap($('#mini'));
    }
    if (ts - tProd > 1500) { tProd = ts; production(); }
    while (ui.logSeen < sim.log.length) {
      var l = sim.log[ui.logSeen++];
      if (l.kind === 'objective') toast('★ ' + l.text, 'objective'); else if (l.kind === 'alert') toast(l.text, 'alert'); else if (l.kind === 'escape') toast(l.text);
    }
    if (sim.log.length >= 60) ui.logSeen = Math.min(ui.logSeen, sim.log.length);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
