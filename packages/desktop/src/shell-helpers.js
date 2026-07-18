// Pure helpers for the desktop shell — no Electron imports, so they can be
// unit-tested in a plain Node/vitest environment.

/**
 * Is `url` an external destination that should open in the OS browser rather
 * than inside the Fleex window? Any localhost/127.0.0.1 origin is internal
 * (workspace switching navigates the window between instance web ports).
 *
 * @param {string} url
 * @returns {boolean}
 */
function isExternalUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return false;
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A self-contained fallback page shown when the Fleex web UI can't be reached
 * (e.g. the `.dmg` was double-clicked but no stack is running yet). Keeps the
 * user out of a raw Chromium error page — satisfies US1: "aucun état incohérent
 * ni message technique cryptique". `retryUrl` is loaded when the user clicks
 * Retry.
 *
 * @param {string} retryUrl  The Fleex server URL to retry.
 * @returns {string}         A `data:text/html` URL.
 */
function fallbackPage(retryUrl) {
  const safeUrl = String(retryUrl).replace(/"/g, '%22').replace(/</g, '%3C');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #12121c; color: #e4e4e7;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-app-region: drag;
  }
  .card { text-align: center; max-width: 420px; padding: 32px; }
  .logo { color: #6ee7b7; margin-bottom: 20px; }
  h1 { font-size: 18px; font-weight: 700; margin: 0 0 10px; }
  p { font-size: 13px; line-height: 1.6; color: #a1a1aa; margin: 0 0 22px; }
  button {
    -webkit-app-region: no-drag;
    background: #6ee7b7; color: #06212a; border: 0; border-radius: 6px;
    padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  button:hover { filter: brightness(1.05); }
</style>
</head>
<body>
  <div class="card">
    <svg class="logo" width="40" height="40" viewBox="0 0 24 24" fill="none">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" />
    </svg>
    <h1>Waiting for Fleex</h1>
    <p>The Fleex services aren't reachable yet. If you launched from the terminal, run <b>fleex&nbsp;start</b> first, then retry.</p>
    <button onclick="location.href='${safeUrl}'">Retry</button>
  </div>
</body>
</html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

module.exports = { isExternalUrl, fallbackPage };
