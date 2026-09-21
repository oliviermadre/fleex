// extension/markdown.js — minimal, XSS-safe Markdown renderer (no external deps; MV3 CSP-safe).
// Loaded as a classic <script> by sidepanel.html AND imported by the vitest suite.
(function (root) {
  'use strict';

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /**
   * Inline rendering.
   * CONTRACT: `text` must already be HTML-escaped (renderMarkdown() escapes the
   * whole source upfront). The <n> placeholder relies on that guarantee: an
   * escaped input cannot contain a literal '<', so the marker is unforgeable.
   */
  function mdInline(text) {
    const codes = [];

    // Defensive guard: neutralise any placeholder-looking sequence in the input.
    let t = text.replace(/<(\d+)>/g, '&lt;$1&gt;');

    // Extract inline code spans without touching the surrounding whitespace.
    t = t.replace(/`([^`]+)`/g, (_, c) => `<${codes.push(c) - 1}>`);

    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const raw = url.replace(/&amp;/g, '&');
      return /^(https?:|mailto:)/i.test(raw)
        ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : m;
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');

    // Restore: an unknown index yields the placeholder verbatim, never an empty
    // <code></code> (which the CSS would draw as a pastille, swallowing content).
    t = t.replace(/<(\d+)>/g, (match, i) => {
      const code = codes[+i];
      return code === undefined ? match : `<code>${code}</code>`;
    });
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
  function isHr(l) { return /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l); }

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
      if (isHr(line)) { html += '<hr>'; i++; continue; }
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
             !/^#{1,6}\s/.test(lines[i]) && !isHr(lines[i]) && !isUl(lines[i]) && !isOl(lines[i]) && !isTableStart(lines, i)) {
        para.push(lines[i]); i++;
      }
      html += `<p>${para.map(mdInline).join('<br>')}</p>`;
    }
    return html;
  }

  // Test surface.
  root.FleexMarkdown = { renderMarkdown, mdInline, escapeHtml };
  // Historical globals, so sidepanel.js keeps calling renderMarkdown(...) as-is.
  root.renderMarkdown = renderMarkdown;
  root.mdInline = mdInline;
  root.escapeHtml = escapeHtml;
})(globalThis);
