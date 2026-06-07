'use strict';

const HOST = 'localhost:4399';
const log = document.getElementById('log');
const statusEl = document.getElementById('status');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const attachBtn = document.getElementById('attach');
const wsSelect = document.getElementById('workspace');
const pageChip = document.getElementById('page-chip');

let ws = null;
let currentAssistant = null; // the streaming assistant bubble being filled

// ── WebSocket ───────────────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket(`ws://${HOST}/chat`);
  ws.onopen = async () => {
    setStatus(true);
    const saved = (await chrome.storage.local.get('workspace')).workspace;
    if (saved) {
      wsSelect.value = saved;
      sendMsg({ type: 'set_workspace', workspace: saved });
    }
  };
  ws.onclose = () => {
    setStatus(false);
    setTimeout(connect, 1500);
  };
  ws.onerror = () => setStatus(false);
  ws.onmessage = (e) => handleEvent(JSON.parse(e.data));
}

function sendMsg(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function setStatus(on) {
  statusEl.textContent = on ? 'online' : 'offline';
  statusEl.className = `status ${on ? 'on' : 'off'}`;
  sendBtn.disabled = !on;
}

// ── Rendering ─────────────────────────────────────────────────────────────--
function bubble(cls, text) {
  const el = document.createElement('div');
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function finalizeAssistant() {
  currentAssistant = null;
}

function handleEvent(ev) {
  switch (ev.type) {
    case 'text':
      if (!currentAssistant) currentAssistant = bubble('msg assistant', '');
      currentAssistant.textContent += ev.text;
      log.scrollTop = log.scrollHeight;
      break;
    case 'tool_call':
      finalizeAssistant();
      bubble('tool').innerHTML = `▷ <code>fleex ${escapeHtml(ev.argv.join(' '))}</code>`;
      break;
    case 'confirm_request':
      finalizeAssistant();
      renderConfirm(ev);
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
      break;
    case 'error':
      finalizeAssistant();
      bubble('msg error', ev.message);
      break;
    case 'page_attached':
      showChip(ev.title);
      break;
    case 'workspace':
      // ack; nothing to render
      break;
  }
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
    sendMsg({ type: 'confirm', id: ev.id, approved });
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
function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n) + '…' : s || '';
}

// ── Sending a user message ───────────────────────────────────────────────────
function submit() {
  const text = input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  bubble('msg user', text);
  sendMsg({ type: 'user', text });
  input.value = '';
  autoGrow();
}

sendBtn.onclick = submit;
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
});
function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
}
input.addEventListener('input', autoGrow);

// ── Page capture ──────────────────────────────────────────────────────────-─
function extractPage() {
  const pick = document.querySelector('article') || document.querySelector('main') || document.body;
  const clone = pick.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,svg,canvas,iframe').forEach((e) => e.remove());
  const text = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
  return { url: location.href, title: document.title, content: text };
}

attachBtn.onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
    const result = results && results[0] && results[0].result;
    if (result && result.content) {
      sendMsg({ type: 'page', url: result.url, title: result.title, content: result.content });
      showChip(result.title || result.url);
    }
  } catch (err) {
    bubble('msg error', `Could not read the page: ${err.message}`);
  }
};

function showChip(label) {
  pageChip.textContent = `📎 attached: ${truncate(label, 60)}`;
  pageChip.classList.remove('hidden');
}

// ── Workspace selector ───────────────────────────────────────────────────────
wsSelect.onchange = () => {
  sendMsg({ type: 'set_workspace', workspace: wsSelect.value });
  chrome.storage.local.set({ workspace: wsSelect.value });
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
  } catch {
    // host offline; selector keeps just the default option
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
loadWorkspaces();
connect();
