const { app, BrowserWindow, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ── Configuration ────────────────────────────────────────────────────────────
// When launched by `fleex start --desktop`, the CLI passes the server port.
// Fallback to 3000 for standalone usage.
app.setName('Fleex');

const serverPort = process.env['FLEEX_SERVER_PORT'] || '3000';
const serverUrl = `http://localhost:${serverPort}`;

function isExternalUrl(url) {
  try {
    const parsed = new URL(url);
    // Any local Fleex instance (any port) is internal — workspace switching
    // navigates the window between instance web ports.
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return false;
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const TITLEBAR_HEIGHT = 38;

const FLEEX_HOME = process.env['FLEEX_HOME'] || path.join(os.homedir(), '.fleex');

/**
 * Scan ~/.fleex/.run for STARTED instances (live server pid). Returns one entry
 * per running instance with its workspace identity and web port — the data the
 * titlebar switcher needs. Mirrors the CLI's discoverInstances (hook/index.ts).
 */
function scanRunningInstances() {
  const runDir = path.join(FLEEX_HOME, '.run');
  let slugs;
  try {
    slugs = fs.readdirSync(runDir);
  } catch {
    return [];
  }
  const out = [];
  for (const slug of slugs) {
    const dir = path.join(runDir, slug);
    try {
      const ports = JSON.parse(fs.readFileSync(path.join(dir, 'ports.json'), 'utf8'));
      const pid = parseInt(fs.readFileSync(path.join(dir, 'server.pid'), 'utf8').trim(), 10);
      if (typeof ports.web !== 'number' || !Number.isFinite(pid) || pid <= 0) continue;
      try { process.kill(pid, 0); } catch { continue; } // not alive
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch { /* optional */ }
      out.push({
        slug,
        workspace: meta.workspace || slug,
        branch: meta.branch || '',
        driver: meta.driver || '',
        webPort: ports.web,
      });
    } catch {
      continue;
    }
  }
  // Stable order: workspace name, then branch.
  out.sort((a, b) => (a.workspace + a.branch).localeCompare(b.workspace + b.branch));
  return out;
}

/** Web port the window is currently showing (fallback: launch port). */
function currentWebPort() {
  try {
    const u = new URL(mainWindow.webContents.getURL());
    if (u.port) return parseInt(u.port, 10);
  } catch { /* fall through */ }
  return parseInt(serverPort, 10);
}

const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');

let mainWindow = null;

// ── Browser-parity: history navigation ────────────────────────────────────────
// The desktop shell is a BrowserWindow loading the web app, which uses
// react-router (BrowserRouter). User navigations push real session-history
// entries, so Chromium's navigation history already mirrors the browser — we
// just re-expose Back/Forward (menu + shortcuts + trackpad swipe) that a bare
// BrowserWindow otherwise hides.
//
// Find-in-page (Cmd+F) was intentionally removed: the native findInPage bar
// behaved poorly inside the SPA and wasn't worth maintaining here.

const isMac = process.platform === 'darwin';

function activeContents() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
}

function canGoBack(wc) {
  return wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack();
}
function canGoForward(wc) {
  return wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward();
}

function goBack() {
  const wc = activeContents();
  if (!wc || !canGoBack(wc)) return;
  if (wc.navigationHistory) wc.navigationHistory.goBack();
  else wc.goBack();
}
function goForward() {
  const wc = activeContents();
  if (!wc || !canGoForward(wc)) return;
  if (wc.navigationHistory) wc.navigationHistory.goForward();
  else wc.goForward();
}

// Reflect history availability in the menu (greyed out at the ends).
function updateNavMenuState() {
  const menu = Menu.getApplicationMenu();
  const wc = activeContents();
  if (!menu || !wc) return;
  const back = menu.getMenuItemById('nav-back');
  const forward = menu.getMenuItemById('nav-forward');
  if (back) back.enabled = canGoBack(wc);
  if (forward) forward.enabled = canGoForward(wc);
}

function buildApplicationMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'History',
      submenu: [
        // Primary accelerators — always navigate (focus-insensitive). The macOS
        // secondaries Cmd+←/Cmd+→ are handled in the preload so they keep their
        // edit meaning inside text fields / terminals.
        { id: 'nav-back', label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: goBack },
        { id: 'nav-forward', label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: goForward },
      ],
    },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  updateNavMenuState();
}

// IPC from the preload (renderer) side. Registered once at module load.
ipcMain.on('fleex:navigate', (_e, dir) => {
  if (dir === 'back') goBack();
  else if (dir === 'forward') goForward();
});

// Per-window wiring: keep Back/Forward menu state in sync, plus trackpad swipe.
function wireBrowserParity(win) {
  const wc = win.webContents;

  // Full document navigation (workspace switch / reload).
  wc.on('did-navigate', updateNavMenuState);
  // SPA route changes (react-router pushState/replaceState).
  wc.on('did-navigate-in-page', updateNavMenuState);
  wc.on('did-frame-navigate', updateNavMenuState);
  wc.on('did-finish-load', updateNavMenuState);

  // Trackpad three-finger horizontal swipe → history navigation. Honours the
  // macOS "Swipe between pages" system setting, exactly like the browser.
  // Electron reports `left` for a back-gesture and `right` for forward (Cocoa
  // swipe-delta semantics). If it feels reversed on-device, flip these two.
  win.on('swipe', (_e, direction) => {
    if (direction === 'left') goBack();
    else if (direction === 'right') goForward();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: iconPath,
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Fleex',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(serverUrl);

  wireBrowserParity(mainWindow);

  mainWindow.webContents.on('did-finish-load', () => {
    // Inject CSS
    mainWindow.webContents.insertCSS(`
      /* ── Desktop titlebar ── */
      #fleex-desktop-titlebar {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: ${TITLEBAR_HEIGHT}px;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--theme-bg-base, #1a1a2e);
        border-bottom: 1px solid var(--theme-border, #2a2a3e);
        -webkit-app-region: drag;
        padding-left: 78px; /* space for traffic lights */
        padding-right: 12px;
        box-sizing: border-box;
      }
      #fleex-desktop-titlebar * {
        -webkit-app-region: no-drag;
      }
      #fleex-titlebar-left {
        display: flex;
        align-items: center;
        gap: 8px;
        pointer-events: none;
      }
      #fleex-titlebar-right {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      #fleex-titlebar-usage {
        display: flex;
        align-items: center;
        gap: 8px;
        position: relative;
        cursor: default;
      }
      #fleex-titlebar-usage .fleex-usage-tooltip {
        display: none;
        position: absolute;
        top: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        min-width: 220px;
        background: var(--theme-bg-surface, #27273a);
        border: 1px solid var(--theme-border, #2a2a3e);
        border-radius: 6px;
        padding: 10px 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        z-index: 100000;
        pointer-events: none;
      }
      #fleex-titlebar-usage:hover .fleex-usage-tooltip {
        display: block;
      }

      /* ── Workspace switcher ── */
      #fleex-workspace-switcher {
        position: relative;
        display: flex;
        align-items: center;
        gap: 4px;
        pointer-events: auto;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
        color: var(--theme-text-muted, #a1a1aa);
        border-radius: 4px;
        padding: 2px 6px;
      }
      #fleex-workspace-switcher:hover {
        background: var(--theme-bg-overlay, #1a1a2e);
        color: var(--theme-text-secondary, #d4d4d8);
      }
      #fleex-workspace-switcher .fleex-ws-sep {
        color: var(--theme-border-subtle, #2a2a3e);
        margin-right: 2px;
      }
      #fleex-workspace-switcher .fleex-ws-name {
        color: var(--theme-text-secondary, #d4d4d8);
      }
      #fleex-workspace-switcher .fleex-ws-caret {
        font-size: 9px;
        opacity: 0.7;
      }
      #fleex-workspace-menu {
        display: none;
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        min-width: 220px;
        max-height: 320px;
        overflow-y: auto;
        background: var(--theme-bg-surface, #27273a);
        border: 1px solid var(--theme-border, #2a2a3e);
        border-radius: 6px;
        padding: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        z-index: 100000;
      }
      #fleex-workspace-menu.open { display: block; }
      .fleex-ws-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 4px;
        cursor: pointer;
        white-space: nowrap;
      }
      .fleex-ws-item:hover { background: var(--theme-bg-overlay, #1a1a2e); }
      .fleex-ws-item.current { cursor: default; }
      .fleex-ws-item .fleex-ws-check {
        width: 12px;
        color: var(--theme-accent, #6ee7b7);
        font-size: 11px;
      }
      .fleex-ws-item .fleex-ws-item-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--theme-text-primary, #e4e4e7);
      }
      .fleex-ws-item .fleex-ws-item-meta {
        font-size: 10px;
        color: var(--theme-text-muted, #a1a1aa);
      }

      /* Push ALL app content below the titlebar */
      body > div#root > div {
        padding-top: ${TITLEBAR_HEIGHT}px;
      }

      /* Hidden by JS — see hideSidebarLogo() below */
    `);

    // Inject the titlebar element + sync script. The main process (Node, fs
    // access) hands the renderer the list of running instances + the current
    // port; the renderer builds the switcher and navigates on selection.
    const instances = scanRunningInstances();
    const curPort = currentWebPort();
    const curWs = (instances.find((i) => i.webPort === curPort) || {}).workspace
      || process.env['FLEEX_WORKSPACE'] || '';
    const instancesJson = JSON.stringify(instances);
    const currentPortJson = JSON.stringify(curPort);
    const currentWsJson = JSON.stringify(curWs);
    mainWindow.webContents.executeJavaScript(`
      (function() {
        // Create titlebar
        const bar = document.createElement('div');
        bar.id = 'fleex-desktop-titlebar';

        // Left: logo
        bar.innerHTML = \`
          <div id="fleex-titlebar-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="color: var(--theme-accent, #6ee7b7);">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" />
            </svg>
            <span style="font-size: 13px; font-weight: 700; letter-spacing: -0.02em;">
              <span style="color: var(--theme-text-primary, #e4e4e7);">fleex</span><span style="color: var(--theme-accent, #6ee7b7);">.dev</span>
            </span>
            <span id="fleex-workspace-switcher"></span>
          </div>
          <div id="fleex-titlebar-right">
            <div id="fleex-titlebar-usage"></div>
            <span style="
              border: 1px solid var(--theme-border-subtle, #2a2a3e);
              border-radius: 4px;
              padding: 2px 8px;
              font-size: 10px;
              color: var(--theme-text-faint, #71717a);
            ">⌘K command palette</span>
          </div>
        \`;

        document.body.prepend(bar);

        // ── Workspace switcher ──
        const FLEEX_INSTANCES = ${instancesJson};
        const FLEEX_CURRENT_PORT = ${currentPortJson};
        const FLEEX_CURRENT_WS = ${currentWsJson};
        (function buildWorkspaceSwitcher() {
          const host = document.getElementById('fleex-workspace-switcher');
          if (!host) return;
          // Legacy / no workspace context: keep header as plain "fleex.dev".
          if (!FLEEX_CURRENT_WS && FLEEX_INSTANCES.length === 0) { host.style.display = 'none'; return; }

          const sep = document.createElement('span');
          sep.className = 'fleex-ws-sep';
          sep.textContent = '|';
          const lead = document.createElement('span');
          lead.textContent = 'workspace : ';
          const name = document.createElement('span');
          name.className = 'fleex-ws-name';
          name.textContent = FLEEX_CURRENT_WS || '—';
          host.appendChild(sep);
          host.appendChild(lead);
          host.appendChild(name);

          const switchable = FLEEX_INSTANCES.length > 1;
          if (switchable) {
            const caret = document.createElement('span');
            caret.className = 'fleex-ws-caret';
            caret.textContent = '▾';
            host.appendChild(caret);
          }

          const menu = document.createElement('div');
          menu.id = 'fleex-workspace-menu';
          for (const inst of FLEEX_INSTANCES) {
            const item = document.createElement('div');
            const isCurrent = inst.webPort === FLEEX_CURRENT_PORT;
            item.className = 'fleex-ws-item' + (isCurrent ? ' current' : '');
            const check = document.createElement('span');
            check.className = 'fleex-ws-check';
            check.textContent = isCurrent ? '✓' : '';
            const labels = document.createElement('div');
            const nm = document.createElement('div');
            nm.className = 'fleex-ws-item-name';
            nm.textContent = inst.workspace;
            const meta = document.createElement('div');
            meta.className = 'fleex-ws-item-meta';
            meta.textContent = [inst.driver, inst.branch].filter(Boolean).join(' · ');
            labels.appendChild(nm);
            if (meta.textContent) labels.appendChild(meta);
            item.appendChild(check);
            item.appendChild(labels);
            if (!isCurrent) {
              item.addEventListener('click', function(e) {
                e.stopPropagation();
                window.location.href = 'http://localhost:' + inst.webPort;
              });
            }
            menu.appendChild(item);
          }
          host.appendChild(menu);

          if (switchable) {
            host.addEventListener('click', function(e) {
              e.stopPropagation();
              menu.classList.toggle('open');
            });
            document.addEventListener('click', function() { menu.classList.remove('open'); });
            document.addEventListener('keydown', function(e) {
              if (e.key === 'Escape') menu.classList.remove('open');
            });
          } else {
            host.style.cursor = 'default';
          }
        })();

        // Hide the original FleexLogo in the nav sidebar
        // Target: the first child (with border-b class) of the nav sidebar container (border-r + bg-base)
        function hideSidebarLogo() {
          const sidebars = document.querySelectorAll('div.flex.h-full.flex-col.border-r');
          for (const sidebar of sidebars) {
            const firstChild = sidebar.firstElementChild;
            if (firstChild && firstChild.classList.contains('border-b') && firstChild.classList.contains('items-center')) {
              firstChild.style.display = 'none';
              return true;
            }
          }
          return false;
        }
        hideSidebarLogo();

        // Fetch usage data directly from the API and render gauges
        function getFillColor(remaining) {
          if (remaining > 50) return 'var(--theme-success, #22c55e)';
          if (remaining >= 20) return 'var(--theme-warning, #eab308)';
          return 'var(--theme-danger, #ef4444)';
        }

        function renderGauge(label, metric) {
          const remaining = 100 - metric.percentage;
          const fillHeight = remaining / 100;
          const fillColor = getFillColor(remaining);
          return '<div style="display:flex;align-items:center;gap:2px;">'
            + '<span style="font-size:8px;font-weight:500;line-height:1;color:var(--theme-text-muted,#a1a1aa);">' + label + '</span>'
            + '<svg width="10" height="16" viewBox="0 0 10 16" fill="none">'
            + '<rect x="1" y="2" width="8" height="12" rx="1" stroke="var(--theme-border-input,#3f3f46)" stroke-width="0.8" fill="none"/>'
            + '<line x1="0" y1="2" x2="10" y2="2" stroke="var(--theme-border-input,#3f3f46)" stroke-width="0.8"/>'
            + '<rect x="1.4" y="' + (2.4 + 11.2 * (1 - fillHeight)) + '" width="7.2" height="' + (11.2 * fillHeight) + '" rx="0.5" fill="' + fillColor + '" opacity="0.8"/>'
            + '</svg>'
            + '<span style="font-size:9px;line-height:1;color:var(--theme-text-secondary,#d4d4d8);">' + remaining + '%</span>'
            + '</div>';
        }

        function formatResetTime(resetsAt) {
          if (!resetsAt) return '—';
          const target = new Date(resetsAt);
          if (isNaN(target.getTime())) return '—';
          const diffMs = target.getTime() - Date.now();
          if (diffMs <= 0) return 'any moment';
          const totalMin = Math.floor(diffMs / 60000);
          const totalHrs = Math.floor(totalMin / 60);
          const totalDays = Math.floor(totalHrs / 24);
          if (totalMin < 1) return '<1m';
          if (totalMin < 60) return totalMin + 'm';
          if (totalHrs < 24) { const rm = totalMin % 60; return rm > 0 ? totalHrs + 'h ' + rm + 'm' : totalHrs + 'h'; }
          const rh = totalHrs % 24;
          return rh > 0 ? totalDays + 'd ' + rh + 'h' : totalDays + 'd';
        }

        function renderTooltipRow(label, metric) {
          const remaining = 100 - metric.percentage;
          const fillColor = getFillColor(remaining);
          const resetTime = formatResetTime(metric.resetsAt);
          return '<div>'
            + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">'
            + '<span style="font-size:11px;font-weight:600;color:var(--theme-text-primary,#e4e4e7);">' + label + '</span>'
            + '<span style="font-size:10px;font-weight:500;color:var(--theme-text-secondary,#d4d4d8);">' + remaining + '% left</span>'
            + '</div>'
            + '<div style="height:6px;border-radius:3px;background:var(--theme-bg-overlay,#1a1a2e);overflow:hidden;">'
            + '<div style="height:100%;width:' + remaining + '%;border-radius:3px;background:' + fillColor + ';"></div>'
            + '</div>'
            + '<div style="font-size:10px;color:var(--theme-text-muted,#a1a1aa);margin-top:3px;">Resets in ' + resetTime + '</div>'
            + '</div>';
        }

        async function syncUsage() {
          const container = document.getElementById('fleex-titlebar-usage');
          if (!container) return;
          try {
            const res = await fetch('/api/claude-usage');
            if (!res.ok) return;
            const usage = await res.json();
            let gaugesHtml = '';
            let tooltipHtml = '';
            if (usage.session) {
              gaugesHtml += renderGauge('5h', usage.session);
              tooltipHtml += renderTooltipRow('Current session (5h)', usage.session);
            }
            if (usage.weeklyAllModels) {
              gaugesHtml += renderGauge('7d', usage.weeklyAllModels);
              tooltipHtml += renderTooltipRow('Weekly — all models', usage.weeklyAllModels);
            }
            if (usage.weeklySonnet) {
              tooltipHtml += renderTooltipRow('Weekly — Sonnet', usage.weeklySonnet);
            }
            if (gaugesHtml) {
              container.innerHTML = gaugesHtml + '<div class="fleex-usage-tooltip"><div style="display:flex;flex-direction:column;gap:8px;">' + tooltipHtml + '</div></div>';
            }
          } catch {}
        }

        // Fetch immediately, then every 30s
        syncUsage();
        setInterval(syncUsage, 30000);

        // Intercept ALL link clicks so external URLs open in the OS browser
        document.addEventListener('click', function(e) {
          var link = e.target.closest('a[href]');
          if (!link) return;
          var href = link.href;
          if (href && /^https?:\\/\\//.test(href) && href.indexOf('localhost:${serverPort}') === -1) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            window.open(href, '_blank');
          }
        }, true);

        // Re-hide logo on DOM changes (SPA navigation)
        const observer = new MutationObserver(() => { hideSidebarLogo(); });
        observer.observe(document.body, { childList: true, subtree: true });
      })();
    `);
  });

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Prevent the main window from navigating away to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isExternalUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Protect child windows (e.g. about:blank intermediaries) with the same handlers
  mainWindow.webContents.on('did-create-window', (childWindow) => {
    childWindow.webContents.on('will-navigate', (event, url) => {
      if (isExternalUrl(url)) {
        event.preventDefault();
        shell.openExternal(url);
        childWindow.close();
      }
    });

    childWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternalUrl(url)) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }
  buildApplicationMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  }
});
