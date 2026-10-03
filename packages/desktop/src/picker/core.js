// Fleex element picker — pure helpers, shared by picker.js (injected into the
// guest page's main world) and the web unit tests. No dependencies, no build:
// evaluated as a classic script, it publishes globalThis.__fleexPickerCore.
(function (root) {
  'use strict';

  var TEXT_MAX = 300;
  var ATTR_MAX = 200;
  var HTML_MAX = 2048;
  var SIBLINGS_MAX = 10;
  var OWNERS_MAX = 5;

  var STYLE_PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
    'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
    'margin', 'padding', 'box-sizing',
    'flex', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap', 'grid-template-columns',
    'overflow', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
    'color', 'background-color', 'background-image', 'border', 'border-radius', 'box-shadow',
    'opacity', 'transform', 'cursor', 'text-align', 'white-space',
  ];

  function clip(s, max) {
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  function normText(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  function cssEscape(s) {
    return root.CSS && root.CSS.escape ? root.CSS.escape(s) : String(s).replace(/([^\w-])/g, '\\$1');
  }

  function uniqueId(el) {
    if (!el.id) return null;
    var doc = el.ownerDocument;
    var sel = '#' + cssEscape(el.id);
    try {
      return doc.querySelectorAll(sel).length === 1 ? sel : null;
    } catch (e) {
      return null;
    }
  }

  function sameTagIndex(el) {
    var parent = el.parentElement;
    if (!parent) return { index: 1, count: 1 };
    var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === el.tagName; });
    return { index: same.indexOf(el) + 1, count: same.length };
  }

  function uniqueSelector(el) {
    var direct = uniqueId(el);
    if (direct) return direct;
    var parts = [];
    var node = el;
    var doc = el.ownerDocument;
    while (node && node.nodeType === 1) {
      if (node !== el) {
        var id = uniqueId(node);
        if (id) { parts.unshift(id); return parts.join(' > '); }
      }
      if (node === doc.body || node === doc.documentElement) { parts.unshift(node.tagName.toLowerCase()); break; }
      var tag = node.tagName.toLowerCase();
      var pos = sameTagIndex(node);
      parts.unshift(pos.count > 1 ? tag + ':nth-of-type(' + pos.index + ')' : tag);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function xpathOf(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1) {
      if (node.id && uniqueId(node)) { parts.unshift('//*[@id="' + node.id + '"]'); return parts.join('/'); }
      var tag = node.tagName.toLowerCase();
      var pos = sameTagIndex(node);
      parts.unshift(pos.count > 1 ? tag + '[' + pos.index + ']' : tag);
      node = node.parentElement;
    }
    return '/' + parts.join('/');
  }

  function classesOf(el) {
    var c = normText(el.getAttribute('class'));
    return c || undefined;
  }

  function siblingsOf(el) {
    var parent = el.parentElement;
    if (!parent) return [];
    var kids = Array.prototype.slice.call(parent.children);
    var i = kids.indexOf(el);
    var start = Math.max(0, Math.min(i - 4, kids.length - SIBLINGS_MAX));
    return kids.slice(start, start + SIBLINGS_MAX).map(function (k) {
      var out = { tag: k.tagName.toLowerCase() };
      var cls = classesOf(k);
      if (cls) out.classes = cls;
      var t = normText(k.textContent);
      if (t) out.text = clip(t, 40);
      if (k === el) out.selected = true;
      return out;
    });
  }

  function pickStyles(computed, defaults) {
    var out = {};
    STYLE_PROPS.forEach(function (p) {
      var v = computed.getPropertyValue(p);
      if (v && v !== defaults[p]) out[p] = v;
    });
    return out;
  }

  // ── React ───────────────────────────────────────────────────────────────────
  function fiberOf(el) {
    for (var n = el; n; n = n.parentElement) {
      var keys = Object.keys(n);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber$') === 0) return n[keys[i]];
      }
    }
    return null;
  }

  function nameOf(type) {
    if (!type) return null;
    if (typeof type === 'function') return type.displayName || type.name || null;
    if (typeof type === 'object') {
      if (type.displayName) return type.displayName;
      if (type.render) return type.render.displayName || type.render.name || null; // forwardRef
      if (type.type) return nameOf(type.type); // memo
    }
    return null;
  }

  function reactInfo(el) {
    var host = fiberOf(el);
    if (!host) return null;
    // Production builds keep the fiber expandos but no debug fields, and their
    // component names are minified (`t`, `Xe`): report nothing rather than noise.
    if (!('_debugOwner' in host) && !host._debugStack && !host._debugSource) return null;
    var names = [];
    var first = null;
    for (var f = host.return; f && names.length < OWNERS_MAX + 1; f = f.return) {
      var n = nameOf(f.type);
      if (n) { names.push(n); if (!first) first = f; }
    }
    if (!names.length) return null;
    var info = { component: names[0], owners: names.slice(1) };
    var debugSource = host._debugSource || (first && first._debugSource);
    if (debugSource) info.debugSource = debugSource;
    // Where the picked tag itself was written; else where the component was used.
    var stackOwner = host._debugStack ? host : first;
    if (stackOwner && stackOwner._debugStack && stackOwner._debugStack.stack) info.stack = stackOwner._debugStack.stack;
    return info;
  }

  // ── Source maps ─────────────────────────────────────────────────────────────
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function decodeVlq(segment) {
    var out = [];
    var shift = 0;
    var value = 0;
    for (var i = 0; i < segment.length; i++) {
      var digit = B64.indexOf(segment[i]);
      if (digit < 0) return out;
      var cont = digit & 32;
      value += (digit & 31) << shift;
      if (cont) { shift += 5; continue; }
      var neg = value & 1;
      value = value >>> 1;
      out.push(neg ? -value : value);
      value = 0;
      shift = 0;
    }
    return out;
  }

  // line and column are 1-based (as in stack traces); so is the result.
  function originalPosition(map, line, column) {
    var lines = map.mappings.split(';');
    var srcIdx = 0, srcLine = 0, srcCol = 0;
    var best = null;
    for (var l = 0; l < lines.length && l < line; l++) {
      var genCol = 0;
      var segs = lines[l] ? lines[l].split(',') : [];
      for (var s = 0; s < segs.length; s++) {
        var f = decodeVlq(segs[s]);
        genCol += f[0];
        if (f.length >= 4) {
          srcIdx += f[1]; srcLine += f[2]; srcCol += f[3];
          if (l === line - 1 && genCol <= column - 1) {
            best = { source: map.sources[srcIdx], line: srcLine + 1, column: srcCol + 1 };
          }
        }
      }
    }
    return best;
  }

  function extractInlineSourceMap(code) {
    var m = /\/\/# sourceMappingURL=data:application\/json;(?:charset=[^;,]+;)?base64,([A-Za-z0-9+/=]+)\s*$/m.exec(code);
    if (!m) return null;
    try {
      var bin = root.atob(m[1]);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return null;
    }
  }

  function parseStackFrames(stack) {
    var out = [];
    String(stack || '').split('\n').forEach(function (line) {
      var m = /(https?:\/\/[^\s()]+?):(\d+):(\d+)\)?\s*$/.exec(line);
      if (m) out.push({ url: m[1], line: Number(m[2]), column: Number(m[3]) });
    });
    return out;
  }

  function pickAppFrame(frames) {
    for (var i = 0; i < frames.length; i++) {
      var u = frames[i].url;
      if (u.indexOf('/node_modules/') >= 0 || u.indexOf('/.vite/deps/') >= 0 || u.indexOf('/@vite/') >= 0 || u.indexOf('/@react-refresh') >= 0) continue;
      return frames[i];
    }
    return null;
  }

  function resolveSource(info, fetchText) {
    if (info.debugSource) {
      var d = info.debugSource;
      return Promise.resolve({ file: d.fileName, line: d.lineNumber, column: d.columnNumber });
    }
    var frame = info.stack ? pickAppFrame(parseStackFrames(info.stack)) : null;
    if (!frame) return Promise.resolve(undefined);
    var file = new URL(frame.url).pathname;
    return Promise.resolve()
      .then(function () { return fetchText(frame.url); })
      .then(function (code) {
        var map = extractInlineSourceMap(code);
        var pos = map && originalPosition(map, frame.line, frame.column);
        return pos ? { file: file, line: pos.line, column: pos.column } : { file: file };
      })
      .catch(function () { return { file: file }; });
  }

  // ── Context ─────────────────────────────────────────────────────────────────
  function buildContext(el, opts) {
    var doc = el.ownerDocument;
    var win = doc.defaultView;
    var r = el.getBoundingClientRect();
    var attrs = {};
    Array.prototype.forEach.call(el.attributes, function (a) { attrs[a.name] = clip(a.value, ATTR_MAX); });
    var tag = el.tagName.toLowerCase();
    var text = normText(el.innerText !== undefined ? el.innerText : el.textContent);
    var context = {
      v: 1,
      page: { url: String(win.location.href), title: doc.title, viewport: { w: win.innerWidth, h: win.innerHeight, dpr: win.devicePixelRatio || 1 } },
      tag: tag,
      rect: { x: r.left, y: r.top, w: r.width, h: r.height },
      selector: uniqueSelector(el),
      xpath: xpathOf(el),
      attributes: attrs,
      styles: pickStyles(win.getComputedStyle(el), opts.defaultsFor(tag)),
      html: clip(el.outerHTML, HTML_MAX),
      siblings: siblingsOf(el),
    };
    if (text) context.text = clip(text, TEXT_MAX);
    var react = reactInfo(el);
    if (react) context.react = { component: react.component, owners: react.owners };
    return { context: context, react: react };
  }

  root.__fleexPickerCore = {
    STYLE_PROPS: STYLE_PROPS,
    uniqueSelector: uniqueSelector,
    xpathOf: xpathOf,
    siblingsOf: siblingsOf,
    pickStyles: pickStyles,
    reactInfo: reactInfo,
    decodeVlq: decodeVlq,
    originalPosition: originalPosition,
    extractInlineSourceMap: extractInlineSourceMap,
    parseStackFrames: parseStackFrames,
    pickAppFrame: pickAppFrame,
    resolveSource: resolveSource,
    buildContext: buildContext,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
