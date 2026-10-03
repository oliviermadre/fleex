// Fleex element picker — runs in the guest page's main world (React fibers are
// only visible there). Injected once by picker-preload.js after core.js, inside a
// closure that declares __fleexPickerNonce; talks to the preload through
// window.postMessage. The page can see those messages, so the preload — not the
// nonce — is the trust boundary (it only relays during a pick the user started).
/* global __fleexPickerNonce */
(function () {
  'use strict';
  var core = window.__fleexPickerCore;
  var nonce = typeof __fleexPickerNonce === 'string' ? __fleexPickerNonce : null;
  var active = false;
  var box = null;
  var label = null;
  var current = null;
  var defaultsFrame = null;
  var defaultsCache = {};
  var prevCursor = '';

  function post(type, payload) {
    window.postMessage({ __fleexPicker: 'out', nonce: nonce, type: type, payload: payload }, '*');
  }

  function defaultsFor(tag) {
    if (defaultsCache[tag]) return defaultsCache[tag];
    if (!defaultsFrame) {
      defaultsFrame = document.createElement('iframe');
      defaultsFrame.setAttribute('aria-hidden', 'true');
      defaultsFrame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;';
      document.documentElement.appendChild(defaultsFrame);
    }
    var out = {};
    try {
      var d = defaultsFrame.contentDocument;
      var probe = d.createElement(tag);
      d.body.appendChild(probe);
      var cs = defaultsFrame.contentWindow.getComputedStyle(probe);
      core.STYLE_PROPS.forEach(function (p) { out[p] = cs.getPropertyValue(p); });
      probe.remove();
    } catch (e) { /* cross-origin sandboxing: compare against nothing */ }
    defaultsCache[tag] = out;
    return out;
  }

  function targetOf(e) {
    var path = e.composedPath ? e.composedPath() : [];
    var t = path.length ? path[0] : e.target;
    return t && t.nodeType === 1 ? t : null;
  }

  function draw(el) {
    var r = el.getBoundingClientRect();
    box.style.transform = 'translate(' + r.left + 'px,' + r.top + 'px)';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    var cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    label.textContent = el.tagName.toLowerCase() + (cls ? '.' + cls : '') + ' — ' + Math.round(r.width) + '×' + Math.round(r.height);
    label.style.transform = 'translate(' + r.left + 'px,' + Math.max(0, r.top - 22) + 'px)';
  }

  function onMove(e) {
    var el = targetOf(e);
    if (!el || el === current) return;
    current = el;
    draw(el);
  }

  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    swallow(e);
    var el = targetOf(e) || current;
    if (el) pick(el);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    swallow(e);
    stop();
    post('cancelled');
  }

  var BLOCKED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'contextmenu'];

  function start() {
    if (active) return;
    active = true;
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;border:2px solid #7c6cf0;background:rgba(124,108,240,0.12);border-radius:2px;box-sizing:border-box;';
    label = document.createElement('div');
    label.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;font:11px/18px ui-monospace,monospace;padding:0 6px;background:#7c6cf0;color:#fff;border-radius:3px;white-space:nowrap;';
    document.documentElement.appendChild(box);
    document.documentElement.appendChild(label);
    prevCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = 'crosshair';
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    BLOCKED.forEach(function (t) { window.addEventListener(t, swallow, true); });
  }

  function stop() {
    if (!active) return;
    active = false;
    current = null;
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
    BLOCKED.forEach(function (t) { window.removeEventListener(t, swallow, true); });
    document.documentElement.style.cursor = prevCursor;
    if (box) box.remove();
    if (label) label.remove();
    if (defaultsFrame) { defaultsFrame.remove(); defaultsFrame = null; }
    box = label = null;
  }

  function nextFrames() {
    return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
  }

  function pick(el) {
    var built;
    try {
      built = core.buildContext(el, { defaultsFor: defaultsFor });
    } catch (e) {
      stop();
      post('cancelled');
      return;
    }
    stop();
    var source = built.react
      ? core.resolveSource(built.react, function (u) { return fetch(u).then(function (r) { return r.text(); }); })
      : Promise.resolve(undefined);
    source
      .then(function (src) { if (src && built.context.react) built.context.react.source = src; })
      .then(nextFrames) // the overlay must be gone before Fleex captures the page
      .then(function () { post('picked', built.context); });
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__fleexPicker !== 'in' || d.nonce !== nonce) return;
    if (d.cmd === 'start') start();
    else if (d.cmd === 'stop') stop();
  });
})();
