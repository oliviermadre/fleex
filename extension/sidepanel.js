'use strict';

const HOST = 'localhost:4399';

const log = document.getElementById('log');
const statusEl = document.getElementById('status');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const attachBtn = document.getElementById('attach');
const wsSelect = document.getElementById('workspace');
const pageChip = document.getElementById('page-chip');
const banner = document.getElementById('state-banner');
const menuBtn = document.getElementById('menu');
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const sbClose = document.getElementById('sb-close');
const newBtn = document.getElementById('new');
const sessionsEl = document.getElementById('sessions');

let ws = null;
let online = false;
let activeId = null;
let sessions = [];
let currentAssistant = null; // streaming bubble for the active session
const pendingConfirm = {}; // sessionId -> last confirm_request event
let booting = true; // until we've selected/created the first session

// ── WebSocket ─────────────────────────────────────────────────────────────--
function connect() {
  ws = new WebSocket(`ws://${HOST}/chat`);
  ws.onopen = () => setOnline(true);
  ws.onclose = () => { setOnline(false); setTimeout(connect, 1500); };
  ws.onerror = () => setOnline(false);
  ws.onmessage = (e) => handle(JSON.parse(e.data));
}
function sendMsg(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function setOnline(on) {
  online = on;
  statusEl.textContent = on ? 'online' : 'offline';
  statusEl.className = `status ${on ? 'on' : 'off'}`;
  if (!on) booting = true;
  refreshComposer();
}

// ── Incoming messages ─────────────────────────────────────────────────────--
function handle(m) {
  switch (m.type) {
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
  // Streaming events carry a sessionId.
  if (m.type === 'confirm_request') {
    pendingConfirm[m.sessionId] = m;
    if (m.sessionId === activeId) { finalizeAssistant(); renderConfirm(m); }
    return;
  }
  if (m.sessionId && m.sessionId !== activeId) return; // background session; sidebar shows status
  handleStream(m);
}

function handleStream(ev) {
  switch (ev.type) {
    case 'text':
      if (!currentAssistant) currentAssistant = bubble('msg assistant', '');
      currentAssistant.textContent += ev.text;
      log.scrollTop = log.scrollHeight;
      break;
    case 'tool_call':
      finalizeAssistant();
      toolLine(ev.argv);
      break;
    case 'tool_result': {
      const t = bubble(ev.ok ? 'tool' : 'tool fail');
      t.textContent = `${ev.ok ? '✓' : '✗'} ${ev.name}${ev.ok ? '' : ': ' + truncate(ev.text, 200)}`;
      break;
    }
    case 'tool_denied':
      bubble('tool').textContent = `⊘ declined ${ev.name}`;
      break;
    case 'done':
      finalizeAssistant();
      delete pendingConfirm[ev.sessionId];
      break;
    case 'error':
      finalizeAssistant();
      bubble('msg error', /Unknown message type/.test(ev.message || '')
        ? 'The companion is out of date — restart it (bun run packages/sidepanel-host/src/server.ts) to enable conversations.'
        : ev.message);
      break;
  }
}

// ── Sessions / sidebar ──────────────────────────────────────────────────────
function onSessions(list) {
  sessions = list;
  // Pick or create an active session on first load.
  if (booting && !activeId) {
    if (list.length > 0) { booting = false; setActive(list[0].id); }
    else { sendMsg({ type: 'new_session', workspace: wsSelect.value || undefined }); }
  }
  // Active session was deleted elsewhere.
  if (activeId && !list.some((s) => s.id === activeId)) {
    activeId = null;
    if (list.length > 0) setActive(list[0].id);
    else { booting = true; sendMsg({ type: 'new_session', workspace: wsSelect.value || undefined }); }
  }
  renderSidebar();
  updateBanner();
  refreshComposer();
}

function findSession(id) { return sessions.find((s) => s.id === id); }

function renderSidebar() {
  sessionsEl.innerHTML = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    li.className = `session${s.id === activeId ? ' active' : ''}`;

    const dot = document.createElement('span');
    dot.className = `dot ${s.status}`;
    dot.title = s.status;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = s.title;
    title.onclick = () => { setActive(s.id); openSidebar(false); };
    const sub = document.createElement('div');
    sub.className = 'sub';
    const ws = document.createElement('span');
    ws.className = 'ws';
    ws.textContent = s.workspace || 'default';
    const cnt = document.createElement('span');
    cnt.textContent = `${s.messageCount} msg`;
    sub.append(ws, cnt);
    meta.append(title, sub);

    const act = document.createElement('div');
    act.className = 'act';
    const rename = document.createElement('button');
    rename.className = 'icon';
    rename.title = 'Rename';
    rename.textContent = '✎';
    rename.onclick = (e) => { e.stopPropagation(); startRename(li, s); };
    const del = document.createElement('button');
    del.className = 'icon';
    del.title = 'Close conversation';
    del.textContent = '🗑';
    del.onclick = (e) => { e.stopPropagation(); sendMsg({ type: 'delete_session', id: s.id }); };
    act.append(rename, del);

    li.append(dot, meta, act);
    sessionsEl.appendChild(li);
  }
}

function startRename(li, s) {
  const title = li.querySelector('.title');
  const inp = document.createElement('input');
  inp.className = 'title-input';
  inp.value = s.title;
  const commit = (save) => {
    if (save && inp.value.trim()) sendMsg({ type: 'rename_session', id: s.id, title: inp.value.trim() });
    else renderSidebar();
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); };
  inp.onblur = () => commit(true);
  title.replaceWith(inp);
  inp.focus();
  inp.select();
}

function setActive(id) {
  activeId = id;
  currentAssistant = null;
  log.innerHTML = '';
  const s = findSession(id);
  if (s) wsSelect.value = s.workspace || '';
  sendMsg({ type: 'open_session', id });
  // Re-show a pending confirmation if this session is mid-gate.
  if (pendingConfirm[id]) setTimeout(() => renderConfirm(pendingConfirm[id]), 0);
  renderSidebar();
  updateBanner();
  refreshComposer();
}

function openSidebar(show) {
  sidebar.classList.toggle('hidden', !show);
  overlay.classList.toggle('hidden', !show);
}

// ── Banner / composer state ───────────────────────────────────────────────--
function activeStatus() { return findSession(activeId)?.status ?? 'idle'; }

function updateBanner() {
  const st = activeStatus();
  if (!activeId || st === 'idle') { banner.className = 'hidden'; banner.textContent = ''; return; }
  if (st === 'working') { banner.className = 'working'; banner.textContent = '⏳ Working…'; }
  else { banner.className = ''; banner.textContent = '⏳ Waiting for your confirmation below'; }
}

function refreshComposer() {
  const busy = activeStatus() !== 'idle';
  sendBtn.disabled = !online || !activeId || busy;
  // Keep the field focusable whenever connected, even before a session exists,
  // so the user is never stuck with a dead input.
  input.disabled = !online;
}

// ── Rendering helpers ─────────────────────────────────────────────────────--
function bubble(cls, text) {
  const el = document.createElement('div');
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}
function toolLine(argv) {
  const t = bubble('tool');
  t.innerHTML = `▷ <code>fleex ${escapeHtml(argv.join(' '))}</code>`;
  return t;
}
function finalizeAssistant() { currentAssistant = null; }

function renderTranscript(items) {
  log.innerHTML = '';
  currentAssistant = null;
  for (const it of items) {
    if (it.role === 'user') bubble('msg user', it.text);
    else if (it.role === 'assistant') bubble('msg assistant', it.text);
    else if (it.tool) {
      toolLine(it.tool.argv);
      const s = it.tool.status;
      if (s === 'ok') bubble('tool').textContent = `✓ ${it.tool.name}`;
      else if (s === 'fail') bubble('tool fail').textContent = `✗ ${it.tool.name}: ${truncate(it.tool.text || '', 200)}`;
      else if (s === 'denied') bubble('tool').textContent = `⊘ declined ${it.tool.name}`;
    }
  }
  if (pendingConfirm[activeId]) renderConfirm(pendingConfirm[activeId]);
}

function renderConfirm(ev) {
  const card = bubble('confirm');
  const title = document.createElement('div');
  title.textContent = `Run this ${ev.name.replace(/_/g, ' ')}?`;
  const code = document.createElement('code');
  code.textContent = `fleex ${ev.argv.join(' ')}`;
  const actions = document.createElement('div');
  actions.className = 'actions';
  const yes = document.createElement('button');
  yes.className = 'primary';
  yes.textContent = 'Approve';
  const no = document.createElement('button');
  no.className = 'danger';
  no.textContent = 'Decline';
  const decide = (approved) => {
    sendMsg({ type: 'confirm', sessionId: ev.sessionId, id: ev.id, approved });
    delete pendingConfirm[ev.sessionId];
    yes.disabled = no.disabled = true;
    title.textContent = approved ? `Approved ${ev.name}` : `Declined ${ev.name}`;
  };
  yes.onclick = () => decide(true);
  no.onclick = () => decide(false);
  actions.append(yes, no);
  card.append(title, code, actions);
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : s || ''; }

// ── Sending ─────────────────────────────────────────────────────────────────
function submit() {
  const text = input.value.trim();
  if (!text || !online) return;
  if (!activeId) {
    bubble('msg error', 'No active conversation. Open ☰ → ＋ New. If this persists, restart the companion — its code may be out of date.');
    return;
  }
  if (activeStatus() !== 'idle') return;
  bubble('msg user', text);
  finalizeAssistant();
  sendMsg({ type: 'user', sessionId: activeId, text });
  input.value = '';
  autoGrow();
}
sendBtn.onclick = submit;
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
});
function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}
input.addEventListener('input', autoGrow);

// ── Page capture ──────────────────────────────────────────────────────────--
function extractPage() {
  const pick = document.querySelector('article') || document.querySelector('main') || document.body;
  const clone = pick.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,svg,canvas,iframe').forEach((e) => e.remove());
  const text = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
  return { url: location.href, title: document.title, content: text };
}
attachBtn.onclick = async () => {
  if (!activeId) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
    const result = results && results[0] && results[0].result;
    if (result && result.content) {
      sendMsg({ type: 'page', sessionId: activeId, url: result.url, title: result.title, content: result.content });
      pageChip.textContent = `📎 attached: ${truncate(result.title || result.url, 60)}`;
      pageChip.classList.remove('hidden');
    }
  } catch (err) {
    bubble('msg error', `Could not read the page: ${err.message}`);
  }
};

// ── Workspace selector ───────────────────────────────────────────────────────
wsSelect.onchange = () => {
  chrome.storage.local.set({ workspace: wsSelect.value });
  if (activeId) sendMsg({ type: 'set_workspace', id: activeId, workspace: wsSelect.value });
};
async function loadWorkspaces() {
  try {
    const res = await fetch(`http://${HOST}/workspaces`);
    const list = await res.json();
    for (const w of list) {
      const opt = document.createElement('option');
      opt.value = w.name;
      opt.textContent = w.isDefault ? `${w.name} (default)` : w.name;
      wsSelect.appendChild(opt);
    }
    const saved = (await chrome.storage.local.get('workspace')).workspace;
    if (saved && [...wsSelect.options].some((o) => o.value === saved)) wsSelect.value = saved;
  } catch {
    /* host offline */
  }
}

// ── Sidebar controls ─────────────────────────────────────────────────────────
menuBtn.onclick = () => openSidebar(sidebar.classList.contains('hidden'));
sbClose.onclick = () => openSidebar(false);
overlay.onclick = () => openSidebar(false);
newBtn.onclick = () => { sendMsg({ type: 'new_session', workspace: wsSelect.value || undefined }); };

// ── Boot ─────────────────────────────────────────────────────────────────────
loadWorkspaces();
connect();
