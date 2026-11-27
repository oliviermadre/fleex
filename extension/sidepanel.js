'use strict';

const HOST = 'localhost:4399';

// ── Icons (inline SVG, Lucide-style, stroke currentColor) ─────────────────
const ICON_PATHS = {
  edit:    '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  trash:   '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  attach:  '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  check:   '<polyline points="20 6 9 17 4 12"/>',
  x:       '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  ban:     '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  loader:  '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
};

function iconEl(name) {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const thread     = document.getElementById('thread');
const statusEl   = document.getElementById('status');
const input      = document.getElementById('input');
const sendBtn    = document.getElementById('send');
const ctxBtn     = document.getElementById('ctx-btn');
const wsBtnEl    = document.getElementById('ws-btn');
const wsLabel    = document.getElementById('ws-label');
const modelBtnEl = document.getElementById('model-btn');
const pageChip   = document.getElementById('page-chip');
const sbToggle   = document.getElementById('sb-toggle');
const newConvBtn = document.getElementById('new-conv');
const sidebar    = document.getElementById('sidebar');
const overlay    = document.getElementById('overlay');
const sbClose    = document.getElementById('sb-close');
const newSbBtn   = document.getElementById('new-sb');
const sessionsEl = document.getElementById('sessions');
const sbSearch   = document.getElementById('sb-search');
const sbFilter   = document.getElementById('sb-filter');
const toastEl    = document.getElementById('toast');

// ── Global state ───────────────────────────────────────────────────────────
let ws             = null;
let online         = false;
let activeId       = null;
let sessions       = [];
let booting        = true;
let generating     = false;
const pendingConfirm = {};

// Streaming state
let currentTurn      = null;   // .blocks div of the active assistant turn
let currentTextBlock = null;   // .block-text div being streamed into
let currentText      = '';     // accumulated markdown for currentTextBlock
let currentToolCard  = null;   // .tool-card div awaiting result
const toolCards = new Map();   // tool_use id → .tool-card (several can run at once)
let thinkingBlock    = null;   // .thinking div (removed on first event)

// Selections
let currentWorkspace = '';
let currentModel     = '';
let workspacesList   = [];
let modelsList       = [];

// Sidebar search/filter
let convQuery  = '';
let convFilter = 'all';

// ── WebSocket ──────────────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket(`ws://${HOST}/chat`);
  ws.onopen  = () => setOnline(true);
  ws.onclose = () => { setOnline(false); setTimeout(connect, 1500); };
  ws.onerror = () => setOnline(false);
  ws.onmessage = (e) => handle(JSON.parse(e.data));
}
function sendMsg(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function setOnline(on) {
  online = on;
  statusEl.className = on ? 'online' : '';
  statusEl.title = on ? 'Connected' : 'Disconnected — reconnecting…';
  if (!on) { booting = true; generating = false; }
  refreshComposer();
}

// ── Incoming messages ──────────────────────────────────────────────────────
function handle(m) {
  switch (m.type) {
    case 'dev_reload':
      if (m.full) { try { chrome.runtime.reload(); } catch { location.reload(); } }
      else location.reload();
      return;
    case 'sessions':
      onSessions(m.sessions || []);
      return;
    case 'session_created':
      booting = false;
      setActive(m.id);
      openSidebar(false);
      return;
    case 'session_history':
      if (m.id === activeId) renderTranscript(m.transcript || []);
      return;
  }
  if (m.type === 'confirm_request') {
    pendingConfirm[m.sessionId] = m;
    if (m.sessionId === activeId) { finalizeTextBlock(); renderConfirm(m); }
    return;
  }
  if (m.sessionId && m.sessionId !== activeId) return;
  handleStream(m);
}

function handleStream(ev) {
  switch (ev.type) {
    case 'text': {
      if (thinkingBlock) { thinkingBlock.remove(); thinkingBlock = null; }
      if (!currentTurn) currentTurn = startAssistantTurn();
      if (!currentTextBlock) {
        currentTextBlock = document.createElement('div');
        currentTextBlock.className = 'block-text';
        currentTurn.appendChild(currentTextBlock);
      }
      currentText += ev.text;
      currentTextBlock.innerHTML = renderMarkdown(currentText);
      const caret = document.createElement('span');
      caret.className = 'caret';
      caret.setAttribute('aria-hidden', 'true');
      currentTextBlock.appendChild(caret);
      thread.scrollTop = thread.scrollHeight;
      break;
    }
    case 'tool_call': {
      if (thinkingBlock) { thinkingBlock.remove(); thinkingBlock = null; }
      finalizeTextBlock();
      if (!currentTurn) currentTurn = startAssistantTurn();
      currentToolCard = toolCardEl(ev);
      if (ev.id) toolCards.set(ev.id, currentToolCard);
      currentTurn.appendChild(currentToolCard);
      thread.scrollTop = thread.scrollHeight;
      break;
    }
    case 'tool_result': {
      const card = (ev.id && toolCards.get(ev.id)) || currentToolCard;
      if (card) updateToolCard(card, ev.status || (ev.ok ? 'ok' : 'fail'), ev.text, ev);
      if (ev.id) toolCards.delete(ev.id);
      currentToolCard = null;
      break;
    }
    case 'tool_denied':
      if (currentToolCard) { updateToolCard(currentToolCard, 'denied', 'declined by user'); currentToolCard = null; }
      break;
    case 'artifact': {
      finalizeTextBlock();
      if (!currentTurn) currentTurn = startAssistantTurn();
      const key = `${ev.turnId}:${ev.card.path}`;
      const prev = thread.querySelector(`[data-artifact="${CSS.escape(key)}"]`);
      const el = artifactEl(ev.card, key);
      if (prev) prev.replaceWith(el); else currentTurn.appendChild(el);
      thread.scrollTop = thread.scrollHeight;
      break;
    }
    case 'notice':
    case 'max_turns':
      finalizeTextBlock();
      thread.appendChild(noticeEl(ev.type === 'max_turns' ? 'max_turns' : ev.notice, ev.limit));
      thread.scrollTop = thread.scrollHeight;
      break;
    case 'auth_missing': {
      const errDiv = document.createElement('div');
      errDiv.className = 'turn-error';
      errDiv.textContent = 'No Claude authentication: log Claude Code in on this machine (claude, then /login) or add ANTHROPIC_API_KEY to ~/.fleex/config.';
      thread.appendChild(errDiv);
      break;
    }
    case 'done':
      finalizeTextBlock();
      currentTurn = null;
      currentToolCard = null;
      toolCards.clear();
      if (thinkingBlock) { thinkingBlock.remove(); thinkingBlock = null; }
      delete pendingConfirm[ev.sessionId];
      thread.querySelectorAll('.turn-confirm .actions').forEach((a) => a.remove());
      generating = false;
      refreshComposer();
      break;
    case 'error': {
      finalizeTextBlock();
      if (thinkingBlock) { thinkingBlock.remove(); thinkingBlock = null; }
      currentTurn = null;
      const errDiv = document.createElement('div');
      errDiv.className = 'turn-error';
      errDiv.textContent = /Unknown message type/.test(ev.message || '')
        ? 'The companion is out of date — restart it to enable conversations.'
        : (ev.message || 'An error occurred');
      thread.appendChild(errDiv);
      thread.scrollTop = thread.scrollHeight;
      generating = false;
      refreshComposer();
      break;
    }
  }
}

// ── Rendering helpers ──────────────────────────────────────────────────────
function startAssistantTurn() {
  const turn = document.createElement('div');
  turn.className = 'turn-assistant';
  const glyph = document.createElement('div');
  glyph.className = 'glyph';
  glyph.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor"/></svg>';
  const blocks = document.createElement('div');
  blocks.className = 'blocks';
  turn.append(glyph, blocks);
  thread.appendChild(turn);
  thread.scrollTop = thread.scrollHeight;
  return blocks;
}

function finalizeTextBlock() {
  if (currentTextBlock) {
    const caret = currentTextBlock.querySelector('.caret');
    if (caret) caret.remove();
    currentTextBlock = null;
    currentText = '';
  }
}

function thinkingEl() {
  const el = document.createElement('div');
  el.className = 'thinking';
  el.setAttribute('aria-label', 'Thinking');
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    el.appendChild(dot);
  }
  return el;
}

const ACCESS_LABEL = { read: 'lecture', write: 'écriture', destructive: 'destructif' };

/** "tool · target" of a line; pre-SDK lines carried the fleex argv instead. */
function toolLabelOf(t) {
  if (t.argv) return `fleex ${t.argv.join(' ')}`;
  return t.target ? `${t.name} · ${t.target}` : (t.name || 'tool');
}

function toolCardEl(t) {
  const card = document.createElement('div');
  card.className = 'tool-card';

  const head = document.createElement('div');
  head.className = 'tool-card-head';

  const ic = iconEl('loader');
  ic.classList.add('tool-card-icon', 'spinning');

  const nameEl = document.createElement('span');
  nameEl.className = 'tool-card-name';
  nameEl.textContent = toolLabelOf(t);

  head.append(ic, nameEl);
  if (t.outsideWorkDir) {
    const b = document.createElement('span');
    b.className = 'tool-card-badge badge-write';
    b.textContent = 'hors du dossier';
    head.appendChild(b);
  }
  if (t.access && ACCESS_LABEL[t.access]) {
    // Display only: nothing is blocked on it.
    const b = document.createElement('span');
    b.className = `tool-card-badge badge-${t.access}`;
    b.textContent = ACCESS_LABEL[t.access];
    head.appendChild(b);
  }

  const statusEl = document.createElement('span');
  statusEl.className = 'tool-card-status';
  statusEl.textContent = 'running…';

  const chevron = iconEl('chevron');
  chevron.classList.add('tool-card-chevron');

  head.append(statusEl, chevron);
  head.onclick = () => card.classList.toggle('expanded');

  const body = document.createElement('div');
  body.className = 'tool-card-body';
  card.append(head, body);
  return card;
}

const STATUS_TEXT = { ok: 'done', fail: 'failed', denied: 'refusé', stopped: 'arrêté', interrupted: 'interrompu' };

function updateToolCard(card, status, text, meta = {}) {
  const ok = status === 'ok';
  const soft = status === 'denied' || status === 'stopped' || status === 'interrupted';
  const oldIc = card.querySelector('.tool-card-icon');
  const newIc = iconEl(ok ? 'check' : soft ? 'ban' : 'x');
  newIc.classList.add('tool-card-icon', ok ? 'ok' : soft ? 'denied' : 'fail');
  oldIc.replaceWith(newIc);

  const st = card.querySelector('.tool-card-status');
  st.textContent = (meta.outsideAutoAllowed ? '⚡ ' : '') + (STATUS_TEXT[status] || status)
    + (status === 'fail' && meta.exitCode !== undefined ? ` (exit ${meta.exitCode})` : '');

  if (text && text.trim()) {
    const body = card.querySelector('.tool-card-body');
    const sec = document.createElement('div');
    sec.className = 'tool-card-section';
    const lbl = document.createElement('div');
    lbl.className = 'tool-card-label';
    lbl.textContent = ok ? 'Result' : 'Error';
    const pre = document.createElement('pre');
    pre.className = 'tool-card-pre';
    // The last lines: where results and errors are.
    const lines = text.split('\n');
    pre.textContent = lines.length > 20 ? `… ${lines.length - 20} lines above\n` + lines.slice(-20).join('\n') : truncate(text, 4000);
    sec.append(lbl, pre);
    body.appendChild(sec);
  }
}

function formatBytes(n) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

/** A file the conversation produced in its folder. */
function artifactEl(card, key) {
  const el = document.createElement('div');
  el.className = 'tool-card artifact-card';
  el.dataset.artifact = key;
  const head = document.createElement('div');
  head.className = 'tool-card-head';
  const name = document.createElement('span');
  name.className = 'tool-card-name';
  name.textContent = `📄 ${card.relPath}`;
  const size = document.createElement('span');
  size.className = 'tool-card-status';
  size.textContent = formatBytes(card.sizeBytes) + (card.attachments.length ? ` · attaché à #${card.attachments.map((a) => a.displayId).join(', #')}` : '');
  const open = document.createElement('button');
  open.className = 'sugg-btn';
  open.textContent = 'Ouvrir';
  open.onclick = () => sendMsg({ type: 'open_path', sessionId: activeId, path: card.path });
  head.append(name, size, open);
  el.appendChild(head);
  const p = card.preview;
  if (card.kind === 'full' && p && (p.type === 'text' || p.type === 'markdown' || p.type === 'csv')) {
    const pre = document.createElement('pre');
    pre.className = 'tool-card-pre';
    pre.textContent = p.type === 'csv' ? p.rows.map((r) => r.join(' | ')).join('\n') : p.text;
    el.appendChild(pre);
  }
  return el;
}

function noticeEl(kind, limit) {
  const el = document.createElement('div');
  el.className = 'turn-notice';
  if (kind === 'max_turns') {
    el.textContent = `Limite de ${limit ?? '?'} tours atteinte. `;
    const btn = document.createElement('button');
    btn.className = 'sugg-btn';
    btn.textContent = 'Continuer';
    btn.onclick = () => {
      btn.disabled = true;
      sendMsg({ type: 'continue', sessionId: activeId });
      generating = true;
      refreshComposer();
    };
    el.appendChild(btn);
  } else {
    el.textContent = { continued: '↻ continué', legacy_resumed: 'Reprise avec le nouvel assistant', context_reloaded: "Contexte rechargé depuis l'historique" }[kind] || '';
  }
  return el;
}

function renderEmpty() {
  const el = document.createElement('div');
  el.className = 'empty-state';
  const boltDiv = document.createElement('div');
  boltDiv.className = 'empty-bolt';
  boltDiv.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor"/></svg>';
  const p = document.createElement('p');
  p.textContent = 'What do you want to do\nwith your workspaces?';
  const suggs = document.createElement('div');
  suggs.className = 'suggestions';
  ["What's on my board?", 'Write a script that exports my blocked tickets to CSV and run it', 'Create a ticket for this page'].forEach((text) => {
    const btn = document.createElement('button');
    btn.className = 'sugg-btn';
    btn.textContent = text;
    btn.onclick = () => {
      input.value = text;
      el.remove();
      submit();
    };
    suggs.appendChild(btn);
  });
  el.append(boltDiv, p, suggs);
  return el;
}

/** The one confirmation left: a file write outside the conversation folder. */
function renderConfirm(ev) {
  const card = document.createElement('div');
  card.className = 'turn-confirm';
  const title = document.createElement('div');
  title.className = 'confirm-title';
  title.textContent = `${ev.tool} outside the conversation folder?`;
  const code = document.createElement('code');
  code.textContent = ev.path;
  const diff = document.createElement('details');
  const sum = document.createElement('summary');
  sum.textContent = ev.isNewFile ? 'New file' : 'Diff';
  const pre = document.createElement('pre');
  pre.className = 'tool-card-pre';
  pre.textContent = ev.diff || '';
  diff.append(sum, pre);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const yes = document.createElement('button');
  yes.className = 'confirm-approve';
  yes.textContent = 'Approve';
  const no = document.createElement('button');
  no.className = 'confirm-decline';
  no.textContent = 'Decline';
  // "Always" covers later outside writes of this conversation only; the server
  // applies it to the pending call's own conversation.
  const always = document.createElement('button');
  always.className = 'confirm-always';
  always.textContent = '⚡ Always allow in this conversation';
  const decide = (decision) => {
    sendMsg({ type: 'confirm', sessionId: ev.sessionId, id: ev.id, decision });
    delete pendingConfirm[ev.sessionId];
    title.textContent = decision === 'always' ? `Always allowed — ${ev.path}` : decision === 'allow' ? `Approved — ${ev.path}` : `Declined — ${ev.path}`;
    actions.remove();
  };
  yes.onclick = () => decide('allow');
  no.onclick = () => decide('deny');
  always.onclick = () => decide('always');
  actions.append(yes, no, always);
  card.append(title, code, diff, actions);
  thread.appendChild(card);
  thread.scrollTop = thread.scrollHeight;
}

function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : s || ''; }

// ── Markdown rendering lives in markdown.js (loaded before this file) ──
// It exposes renderMarkdown / mdInline / escapeHtml as globals.

// ── Sessions ───────────────────────────────────────────────────────────────
function newSession() {
  sendMsg({ type: 'new_session', workspace: currentWorkspace || undefined, model: currentModel || undefined });
}

function onSessions(list) {
  sessions = list;
  if (booting && !activeId) {
    if (list.length > 0) { booting = false; setActive(list[0].id); }
    else { newSession(); }
  }
  if (activeId && !list.some((s) => s.id === activeId)) {
    activeId = null;
    if (list.length > 0) setActive(list[0].id);
    else { booting = true; newSession(); }
  }
  renderSidebar();
  refreshComposer();
}

function findSession(id) { return sessions.find((s) => s.id === id); }

function renderSidebar() {
  // Build workspace filter tabs
  const wsNames = [...new Set(sessions.map((s) => s.workspace || 'default'))];
  const segs = sbFilter.querySelectorAll('.seg[data-filter]');
  const existing = [...segs].map((b) => b.dataset.filter);
  const needed = ['all', ...wsNames];
  if (JSON.stringify(existing) !== JSON.stringify(needed)) {
    sbFilter.innerHTML = '';
    for (const f of needed) {
      const btn = document.createElement('button');
      btn.className = 'seg' + (f === convFilter ? ' active' : '');
      btn.dataset.filter = f;
      btn.textContent = f === 'all' ? 'All' : f;
      btn.onclick = () => { convFilter = f; sbFilter.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.filter === f)); renderSidebar(); };
      sbFilter.appendChild(btn);
    }
  }

  const q = convQuery.toLowerCase();
  const filtered = sessions.filter((s) => {
    if (convFilter !== 'all' && (s.workspace || 'default') !== convFilter) return false;
    if (q && !s.title.toLowerCase().includes(q)) return false;
    return true;
  });

  sessionsEl.innerHTML = '';
  for (const s of filtered) {
    const li = document.createElement('li');
    li.className = `session${s.id === activeId ? ' active' : ''}`;

    const dot = document.createElement('span');
    dot.className = `dot ${s.status || 'idle'}`;
    dot.title = s.status || 'idle';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = s.title;
    title.onclick = () => { setActive(s.id); openSidebar(false); };
    const sub = document.createElement('div');
    sub.className = 'sub';
    const wsTag = document.createElement('span');
    wsTag.className = 'ws-tag';
    wsTag.textContent = s.workspace || 'default';
    const cnt = document.createElement('span');
    cnt.textContent = `${s.messageCount} msg`;
    sub.append(wsTag, cnt);
    meta.append(title, sub);

    const act = document.createElement('div');
    act.className = 'act';
    const rename = document.createElement('button');
    rename.title = 'Rename'; rename.setAttribute('aria-label', 'Rename');
    rename.appendChild(iconEl('edit'));
    rename.onclick = (e) => { e.stopPropagation(); startRename(li, s); };
    const del = document.createElement('button');
    del.title = 'Delete'; del.setAttribute('aria-label', 'Delete conversation');
    del.appendChild(iconEl('trash'));
    del.onclick = (e) => { e.stopPropagation(); sendMsg({ type: 'delete_session', id: s.id }); };
    act.append(rename, del);

    li.append(dot, meta, act);
    sessionsEl.appendChild(li);
  }
}

function startRename(li, s) {
  const titleEl = li.querySelector('.title');
  const inp = document.createElement('input');
  inp.className = 'title-input';
  inp.value = s.title;
  const commit = (save) => {
    if (save && inp.value.trim()) sendMsg({ type: 'rename_session', id: s.id, title: inp.value.trim() });
    else renderSidebar();
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); };
  inp.onblur = () => commit(true);
  titleEl.replaceWith(inp);
  inp.focus(); inp.select();
}

function setActive(id) {
  activeId = id;
  currentTurn = null;
  currentTextBlock = null;
  currentText = '';
  currentToolCard = null;
  thinkingBlock = null;
  generating = false;
  thread.innerHTML = '';
  const s = findSession(id);
  if (s && s.workspace) { currentWorkspace = s.workspace; updateWsBtn(); renderWsPopover(workspacesList); }
  if (s && s.model !== undefined) { currentModel = s.model || ''; updateModelBtn(); renderModelPopover(modelsList); }
  applyWorkspaceTheme(s ? s.workspace : '');
  sendMsg({ type: 'open_session', id });
  if (pendingConfirm[id]) setTimeout(() => renderConfirm(pendingConfirm[id]), 0);
  renderSidebar();
  refreshComposer();
}

function renderTranscript(items) {
  thread.innerHTML = '';
  currentTurn = null; currentTextBlock = null; currentText = '';
  currentToolCard = null; toolCards.clear(); thinkingBlock = null;

  if (items.length === 0) { thread.appendChild(renderEmpty()); return; }

  let asBlocks = null; // current .blocks div for grouping

  for (const it of items) {
    if (it.role === 'user') {
      asBlocks = null;
      const turn = document.createElement('div');
      turn.className = 'turn-user';
      const b = document.createElement('div');
      b.className = 'bubble';
      b.textContent = it.text;
      turn.appendChild(b);
      thread.appendChild(turn);
    } else if (it.role === 'assistant') {
      if (!asBlocks) asBlocks = startAssistantTurn();
      const blk = document.createElement('div');
      blk.className = 'block-text';
      blk.innerHTML = renderMarkdown(it.text);
      asBlocks.appendChild(blk);
    } else if (it.tool) {
      if (!asBlocks) asBlocks = startAssistantTurn();
      const card = toolCardEl(it.tool);
      if (it.tool.status !== 'running') updateToolCard(card, it.tool.status, it.tool.text || '', it.tool);
      asBlocks.appendChild(card);
    } else if (it.artifact) {
      if (!asBlocks) asBlocks = startAssistantTurn();
      asBlocks.appendChild(artifactEl(it.artifact, `${it.artifact.turnId}:${it.artifact.path}`));
    } else if (it.notice) {
      thread.appendChild(noticeEl(it.notice, it.limit));
      asBlocks = null;
    }
  }

  if (pendingConfirm[activeId]) renderConfirm(pendingConfirm[activeId]);
  thread.scrollTop = thread.scrollHeight;
}

function openSidebar(show) {
  sidebar.classList.toggle('hidden', !show);
  overlay.classList.toggle('hidden', !show);
  if (show) { sbSearch.value = ''; convQuery = ''; renderSidebar(); sbSearch.focus(); }
}

function activeStatus() { return findSession(activeId)?.status ?? 'idle'; }

function refreshComposer() {
  const busy = activeStatus() !== 'idle';
  if (generating) {
    sendBtn.disabled = false;
    sendBtn.classList.add('stop');
    sendBtn.textContent = 'Stop';
  } else {
    sendBtn.disabled = !online || !activeId || busy;
    sendBtn.classList.remove('stop');
    sendBtn.textContent = 'Send';
  }
  input.disabled = !online;
}

// ── Sending ────────────────────────────────────────────────────────────────
function submit() {
  if (generating) {
    // Stop: the companion interrupts the turn (a pending confirmation is refused).
    if (activeId) sendMsg({ type: 'stop', sessionId: activeId });
    return;
  }
  const text = input.value.trim();
  if (!text || !online) return;
  if (!activeId) return;
  if (activeStatus() !== 'idle') return;

  // User bubble
  const turn = document.createElement('div');
  turn.className = 'turn-user';
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  turn.appendChild(b);
  thread.appendChild(turn);

  // Thinking state
  currentTurn = startAssistantTurn();
  thinkingBlock = thinkingEl();
  currentTurn.appendChild(thinkingBlock);
  thread.scrollTop = thread.scrollHeight;

  sendMsg({ type: 'user', sessionId: activeId, text });
  input.value = '';
  autoGrow();
  generating = true;
  refreshComposer();
}

sendBtn.onclick = submit;
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
});
function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}
input.addEventListener('input', autoGrow);

// ── Page capture ───────────────────────────────────────────────────────────
function extractPage() {
  const pick = document.querySelector('article') || document.querySelector('main') || document.body;
  const clone = pick.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,svg,canvas,iframe').forEach((e) => e.remove());
  const text = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
  return { url: location.href, title: document.title, content: text };
}

async function attachPage() {
  if (!activeId) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
    const result = results && results[0] && results[0].result;
    if (result && result.content) {
      sendMsg({ type: 'page', sessionId: activeId, url: result.url, title: result.title, content: result.content });
      showPageChip(result.title || result.url);
    }
  } catch (err) {
    const errDiv = document.createElement('div');
    errDiv.className = 'turn-error';
    errDiv.textContent = `Could not read the page: ${err.message}`;
    thread.appendChild(errDiv);
    thread.scrollTop = thread.scrollHeight;
  }
}

function showPageChip(text) {
  const chipText = document.createElement('span');
  chipText.className = 'chip-text';
  chipText.textContent = truncate(text, 60);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'chip-x';
  closeBtn.title = 'Remove';
  closeBtn.setAttribute('aria-label', 'Remove page attachment');
  const xIc = iconEl('x');
  closeBtn.appendChild(xIc);
  closeBtn.onclick = () => pageChip.classList.add('hidden');
  pageChip.innerHTML = '';
  pageChip.append(chipText, closeBtn);
  pageChip.classList.remove('hidden');
}

// ── Workspace picker ───────────────────────────────────────────────────────
function updateWsBtn() {
  wsLabel.textContent = currentWorkspace || 'default';
}

// Each workspace's own theme accent (null if not running / no theme).
function wsAccent(w) {
  const t = resolveTheme(w.activeThemeId, w.customThemes);
  return (t && t.colors && t.colors.accent) || null;
}

function renderWsPopover(workspaces) {
  const pop = document.getElementById('ws-popover');
  pop.innerHTML = '';
  for (const w of workspaces) {
    const item = document.createElement('div');
    item.className = 'pop-item' + (w.name === currentWorkspace ? ' active' : '');
    item.role = 'menuitem';

    const accent = wsAccent(w);
    const dot = document.createElement('span');
    dot.className = 'pop-dot';
    dot.style.background = accent || 'var(--text-faint)';
    if (accent) dot.style.boxShadow = `0 0 0 3px color-mix(in srgb, ${accent} 24%, transparent)`;

    const text = document.createElement('span');
    text.className = 'pop-text';
    const name = document.createElement('span');
    name.className = 'pop-name';
    name.textContent = w.name;
    const sub = document.createElement('span');
    sub.className = 'pop-sub';
    sub.textContent = w.branch || 'not running';
    if (!w.branch) sub.classList.add('off');
    text.append(name, sub);

    const check = document.createElement('span');
    check.className = 'pop-check' + (w.name === currentWorkspace ? '' : ' hidden');
    check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

    if (w.isDefault) {
      const badge = document.createElement('span');
      badge.className = 'pop-mode';
      badge.textContent = 'default';
      item.append(dot, text, badge, check);
    } else {
      item.append(dot, text, check);
    }

    item.onclick = () => { selectWorkspace(w.name); closeAllPopovers(); };
    pop.appendChild(item);
  }
}

function selectWorkspace(name) {
  currentWorkspace = name;
  chrome.storage.local.set({ workspace: name });
  if (activeId) sendMsg({ type: 'set_workspace', id: activeId, workspace: name });
  updateWsBtn();
  renderWsPopover(workspacesList);
  applyWorkspaceTheme(name, true);
  showToast(`Workspace: ${name}`);
}

// ── Model picker ───────────────────────────────────────────────────────────
function updateModelBtn() {
  const m = modelsList.find((m) => m.id === currentModel);
  modelBtnEl.textContent = m ? (m.short || m.label || m.id) : 'model';
}

function renderModelPopover(models) {
  const pop = document.getElementById('model-popover');
  pop.innerHTML = '';
  for (const m of models) {
    const item = document.createElement('div');
    item.className = 'pop-item' + (m.id === currentModel ? ' active' : '');
    item.role = 'menuitem';

    const name = document.createElement('span');
    name.className = 'pop-name';
    name.textContent = m.label || m.id;

    const check = document.createElement('span');
    check.className = 'pop-check' + (m.id === currentModel ? '' : ' hidden');
    check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

    item.append(name, check);
    item.onclick = () => { selectModel(m.id); closeAllPopovers(); };
    pop.appendChild(item);
  }
}

function selectModel(id) {
  currentModel = id;
  chrome.storage.local.set({ model: id });
  if (activeId) sendMsg({ type: 'set_model', id: activeId, model: id });
  updateModelBtn();
  renderModelPopover(modelsList);
}

// ── Context menu ───────────────────────────────────────────────────────────
function renderCtxMenu() {
  const menu = document.getElementById('ctx-menu');
  menu.innerHTML = '';
  const item = document.createElement('div');
  item.className = 'pop-item';
  item.role = 'menuitem';
  const ic = iconEl('attach');
  const label = document.createElement('span');
  label.className = 'pop-name';
  label.textContent = 'Attach current page';
  item.append(ic, label);
  item.onclick = async () => { closeAllPopovers(); await attachPage(); };
  menu.appendChild(item);
}

// ── Popover management ─────────────────────────────────────────────────────
function closeAllPopovers() {
  document.getElementById('ws-popover').classList.add('hidden');
  document.getElementById('model-popover').classList.add('hidden');
  document.getElementById('ctx-menu').classList.add('hidden');
}

// Anchor a popover to its trigger button, positioned relative to #app.
// placement 'above' opens upward (footer buttons), 'below' opens downward (header).
// align 'left'|'right' edges the popover to the matching side of the button.
function positionPopover(pop, anchor, placement, align) {
  const app = document.getElementById('app');
  const a = app.getBoundingClientRect();
  const b = anchor.getBoundingClientRect();
  const gap = 6;
  pop.style.left = pop.style.right = pop.style.top = pop.style.bottom = 'auto';
  if (placement === 'above') {
    pop.style.bottom = (a.bottom - b.top + gap) + 'px';
  } else {
    pop.style.top = (b.bottom - a.top + gap) + 'px';
  }
  if (align === 'right') {
    pop.style.right = (a.right - b.right) + 'px';
  } else {
    pop.style.left = (b.left - a.left) + 'px';
  }
}

function togglePopover(id, anchor, placement, align) {
  const pop = document.getElementById(id);
  const wasHidden = pop.classList.contains('hidden');
  closeAllPopovers();
  if (wasHidden) {
    if (anchor) positionPopover(pop, anchor, placement, align);
    pop.classList.remove('hidden');
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.popover') &&
      !e.target.closest('#ws-btn') &&
      !e.target.closest('#model-btn') &&
      !e.target.closest('#ctx-btn')) {
    closeAllPopovers();
  }
});

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(text, ms = 2200) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  toastEl.style.animation = 'none';
  void toastEl.offsetWidth; // trigger reflow
  toastEl.style.animation = '';
  toastEl.style.animationDuration = (ms / 1000) + 's';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms);
}

// ── Panel resize ───────────────────────────────────────────────────────────
function initResize() {
  const app   = document.getElementById('app');
  const saved = localStorage.getItem('fa.w');
  if (saved) app.style.width = saved + 'px';

  document.getElementById('resize-handle').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = app.offsetWidth;
    const onMove = (e2) => {
      const w = Math.max(380, Math.min(Math.round(window.innerWidth * 0.94), startW + (startX - e2.clientX)));
      app.style.width = w + 'px';
    };
    const onUp = () => {
      localStorage.setItem('fa.w', parseInt(app.style.width, 10) || startW);
      window.removeEventListener('mousemove', onMove);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseup', onUp, { once: true });
  });
}

// ── Per-workspace theme ────────────────────────────────────────────────────
let themedWorkspace = null;
async function applyWorkspaceTheme(wsName, transition = false) {
  const key = wsName || '';
  if (key === themedWorkspace && !transition) return;
  themedWorkspace = key;
  try {
    const res = await fetch(`http://${HOST}/theme?workspace=${encodeURIComponent(key)}`);
    if (!res.ok) { applyTheme(null); themedWorkspace = null; return; }
    const data = await res.json();
    applyTheme(resolveTheme(data.activeThemeId, data.customThemes), transition);
  } catch {
    applyTheme(null);
    themedWorkspace = null;
  }
}

// ── Data loading ───────────────────────────────────────────────────────────
async function loadWorkspaces() {
  try {
    const res = await fetch(`http://${HOST}/workspaces`);
    workspacesList = await res.json();
    renderWsPopover(workspacesList);
    const saved = (await chrome.storage.local.get('workspace')).workspace;
    const def = workspacesList.find((w) => w.isDefault);
    if (saved && workspacesList.some((w) => w.name === saved)) {
      currentWorkspace = saved;
    } else if (def) {
      currentWorkspace = def.name;
    }
    updateWsBtn();
    applyWorkspaceTheme(currentWorkspace);
  } catch { /* host offline */ }
}

async function loadModels() {
  try {
    const res = await fetch(`http://${HOST}/models`);
    const data = await res.json();
    modelsList = Array.isArray(data) ? data : data.models || [];
    renderModelPopover(modelsList);
    const saved = (await chrome.storage.local.get('model')).model;
    if (saved && modelsList.some((m) => m.id === saved)) currentModel = saved;
    updateModelBtn();
  } catch { /* host offline */ }
}

// ── Event wiring ───────────────────────────────────────────────────────────
sbToggle.onclick  = () => openSidebar(sidebar.classList.contains('hidden'));
sbClose.onclick   = () => openSidebar(false);
overlay.onclick   = () => openSidebar(false);
newConvBtn.onclick = newSbBtn.onclick = newSession;

wsBtnEl.onclick   = () => togglePopover('ws-popover', wsBtnEl, 'below', 'right');
modelBtnEl.onclick = () => togglePopover('model-popover', modelBtnEl, 'above', 'left');
ctxBtn.onclick    = () => { renderCtxMenu(); togglePopover('ctx-menu', ctxBtn, 'above', 'left'); };

sbSearch.addEventListener('input', (e) => { convQuery = e.target.value; renderSidebar(); });

// ── Boot ───────────────────────────────────────────────────────────────────
initResize();
loadWorkspaces();
loadModels();
connect();
