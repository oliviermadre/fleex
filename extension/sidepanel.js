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
      currentToolCard = toolCardEl(ev.name || (ev.argv && ev.argv[0]), ev.argv);
      currentTurn.appendChild(currentToolCard);
      thread.scrollTop = thread.scrollHeight;
      break;
    }
    case 'tool_result':
      if (currentToolCard) { updateToolCard(currentToolCard, ev.ok, ev.text, false); currentToolCard = null; }
      break;
    case 'tool_denied':
      if (currentToolCard) { updateToolCard(currentToolCard, false, 'declined by user', true); currentToolCard = null; }
      break;
    case 'done':
      finalizeTextBlock();
      currentTurn = null;
      currentToolCard = null;
      if (thinkingBlock) { thinkingBlock.remove(); thinkingBlock = null; }
      delete pendingConfirm[ev.sessionId];
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

function toolCardEl(name, argv) {
  const card = document.createElement('div');
  card.className = 'tool-card';

  const head = document.createElement('div');
  head.className = 'tool-card-head';

  const ic = iconEl('loader');
  ic.classList.add('tool-card-icon', 'spinning');

  const nameEl = document.createElement('span');
  nameEl.className = 'tool-card-name';
  nameEl.textContent = (name || 'tool').replace(/_/g, ' ');

  const statusEl = document.createElement('span');
  statusEl.className = 'tool-card-status';
  statusEl.textContent = 'running…';

  const chevron = iconEl('chevron');
  chevron.classList.add('tool-card-chevron');

  head.append(ic, nameEl, statusEl, chevron);
  head.onclick = () => card.classList.toggle('expanded');

  const body = document.createElement('div');
  body.className = 'tool-card-body';

  const sec = document.createElement('div');
  sec.className = 'tool-card-section';
  const label = document.createElement('div');
  label.className = 'tool-card-label';
  label.textContent = 'Command';
  const pre = document.createElement('pre');
  pre.className = 'tool-card-pre';
  pre.textContent = `fleex ${(argv || []).join(' ')}`;
  sec.append(label, pre);
  body.appendChild(sec);

  card.append(head, body);
  return card;
}

function updateToolCard(card, ok, text, denied) {
  const oldIc = card.querySelector('.tool-card-icon');
  const newIc = iconEl(ok ? 'check' : denied ? 'ban' : 'x');
  newIc.classList.add('tool-card-icon', ok ? 'ok' : denied ? 'denied' : 'fail');
  oldIc.replaceWith(newIc);

  const st = card.querySelector('.tool-card-status');
  st.textContent = ok ? 'done' : denied ? 'declined' : 'failed';

  if (text && text.trim()) {
    const body = card.querySelector('.tool-card-body');
    const sec = document.createElement('div');
    sec.className = 'tool-card-section';
    const lbl = document.createElement('div');
    lbl.className = 'tool-card-label';
    lbl.textContent = ok ? 'Result' : 'Error';
    const pre = document.createElement('pre');
    pre.className = 'tool-card-pre';
    pre.textContent = truncate(text, 600);
    sec.append(lbl, pre);
    body.appendChild(sec);
  }
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
  ["What's on my board?", 'Create a ticket for this page', 'List my open tickets'].forEach((text) => {
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

function renderConfirm(ev) {
  const card = document.createElement('div');
  card.className = 'turn-confirm';
  const title = document.createElement('div');
  title.className = 'confirm-title';
  title.textContent = `Run this ${ev.name.replace(/_/g, ' ')}?`;
  const code = document.createElement('code');
  code.textContent = `fleex ${ev.argv.join(' ')}`;
  const actions = document.createElement('div');
  actions.className = 'actions';
  const yes = document.createElement('button');
  yes.className = 'confirm-approve';
  yes.textContent = 'Approve';
  const no = document.createElement('button');
  no.className = 'confirm-decline';
  no.textContent = 'Decline';
  const decide = (approved) => {
    sendMsg({ type: 'confirm', sessionId: ev.sessionId, id: ev.id, approved });
    delete pendingConfirm[ev.sessionId];
    yes.disabled = no.disabled = true;
    title.textContent = approved ? `Approved — ${ev.name.replace(/_/g, ' ')}` : `Declined — ${ev.name.replace(/_/g, ' ')}`;
    actions.remove();
  };
  yes.onclick = () => decide(true);
  no.onclick = () => decide(false);
  actions.append(yes, no);
  card.append(title, code, actions);
  thread.appendChild(card);
  thread.scrollTop = thread.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : s || ''; }

// ── Minimal, XSS-safe Markdown renderer (no external deps; MV3 CSP-safe) ──
function mdInline(text) {
  const codes = [];
  let t = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return ` ${codes.length - 1} `; });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const raw = url.replace(/&amp;/g, '&');
    return /^(https?:|mailto:)/i.test(raw)
      ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : m;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  t = t.replace(/ (\d+) /g, (_, i) => `<code>${escapeHtml(codes[+i] || '')}</code>`);
  return t;
}

function parseRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
}
function isTableSep(line) {
  if (!line || line.indexOf('|') === -1) return false;
  return parseRow(line).every((c) => /^:?-{1,}:?$/.test(c));
}
function cellAlign(s) {
  const l = s.startsWith(':'), r = s.endsWith(':');
  return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
}
function alignAttr(a) { return a ? ` style="text-align:${a}"` : ''; }
function isTableStart(lines, i) {
  return i + 1 < lines.length && lines[i].indexOf('|') !== -1 && isTableSep(lines[i + 1]);
}

function renderMarkdown(src) {
  const lines = escapeHtml(src).split('\n');
  let html = '', i = 0;
  const isUl = (l) => /^\s*[-*]\s+/.test(l);
  const isOl = (l) => /^\s*\d+\.\s+/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      i++;
      let code = '';
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { code += lines[i] + '\n'; i++; }
      i++;
      html += `<pre><code>${code.replace(/\n$/, '')}</code></pre>`;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { html += `<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`; i++; continue; }
    if (isUl(line)) {
      html += '<ul>';
      while (i < lines.length && isUl(lines[i])) { html += `<li>${mdInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`; i++; }
      html += '</ul>';
      continue;
    }
    if (isOl(line)) {
      html += '<ol>';
      while (i < lines.length && isOl(lines[i])) { html += `<li>${mdInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`; i++; }
      html += '</ol>';
      continue;
    }
    if (isTableStart(lines, i)) {
      const header = parseRow(line);
      const aligns = parseRow(lines[i + 1]).map(cellAlign);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].indexOf('|') !== -1 && !/^\s*$/.test(lines[i])) { rows.push(parseRow(lines[i])); i++; }
      const th = header.map((c, idx) => `<th${alignAttr(aligns[idx])}>${mdInline(c)}</th>`).join('');
      const body = rows.map((r) => `<tr>${r.map((c, idx) => `<td${alignAttr(aligns[idx])}>${mdInline(c)}</td>`).join('')}</tr>`).join('');
      html += `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
      continue;
    }
    if (/^\s*$/.test(line)) { i++; continue; }
    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^```/.test(lines[i]) &&
           !/^#{1,6}\s/.test(lines[i]) && !isUl(lines[i]) && !isOl(lines[i]) && !isTableStart(lines, i)) {
      para.push(lines[i]); i++;
    }
    html += `<p>${para.map(mdInline).join('<br>')}</p>`;
  }
  return html;
}

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
  currentToolCard = null; thinkingBlock = null;

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
      const card = toolCardEl(it.tool.name || (it.tool.argv && it.tool.argv[0]), it.tool.argv);
      const st = it.tool.status;
      if (st === 'ok')     updateToolCard(card, true,  it.tool.text || '', false);
      else if (st === 'fail')   updateToolCard(card, false, it.tool.text || '', false);
      else if (st === 'denied') updateToolCard(card, false, 'declined by user', true);
      asBlocks.appendChild(card);
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
  if (generating) return; // Stop button: no interrupt protocol yet
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
