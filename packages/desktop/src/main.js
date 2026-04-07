const { app, BrowserWindow, shell, nativeImage } = require('electron');
const path = require('path');

// ── Configuration ────────────────────────────────────────────────────────────
// When launched by `fleex start --desktop`, the CLI passes the server port.
// Fallback to 3000 for standalone usage.
app.setName('Fleex');

const serverPort = process.env['FLEEX_SERVER_PORT'] || '3000';
const serverUrl = `http://localhost:${serverPort}`;

const TITLEBAR_HEIGHT = 38;

const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');

let mainWindow = null;

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
    },
  });

  mainWindow.loadURL(serverUrl);

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
      }

      /* Push ALL app content below the titlebar */
      body > div#root > div {
        padding-top: ${TITLEBAR_HEIGHT}px;
      }

      /* Hidden by JS — see hideSidebarLogo() below */
    `);

    // Inject the titlebar element + sync script
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
          return '<div style="display:flex;align-items:center;gap:2px;cursor:default;" title="' + metric.label + ' — ' + remaining + '% left">'
            + '<span style="font-size:8px;font-weight:500;line-height:1;color:var(--theme-text-muted,#a1a1aa);">' + label + '</span>'
            + '<svg width="10" height="16" viewBox="0 0 10 16" fill="none">'
            + '<rect x="1" y="2" width="8" height="12" rx="1" stroke="var(--theme-border-input,#3f3f46)" stroke-width="0.8" fill="none"/>'
            + '<line x1="0" y1="2" x2="10" y2="2" stroke="var(--theme-border-input,#3f3f46)" stroke-width="0.8"/>'
            + '<rect x="1.4" y="' + (2.4 + 11.2 * (1 - fillHeight)) + '" width="7.2" height="' + (11.2 * fillHeight) + '" rx="0.5" fill="' + fillColor + '" opacity="0.8"/>'
            + '</svg>'
            + '<span style="font-size:9px;line-height:1;color:var(--theme-text-secondary,#d4d4d8);">' + remaining + '%</span>'
            + '</div>';
        }

        async function syncUsage() {
          const container = document.getElementById('fleex-titlebar-usage');
          if (!container) return;
          try {
            const res = await fetch('/api/claude-usage');
            if (!res.ok) return;
            const usage = await res.json();
            let html = '';
            if (usage.session) html += renderGauge('5h', usage.session);
            if (usage.weeklyAllModels) html += renderGauge('7d', usage.weeklyAllModels);
            if (html) container.innerHTML = html;
          } catch {}
        }

        // Fetch immediately, then every 30s
        syncUsage();
        setInterval(syncUsage, 30000);

        // Re-hide logo on DOM changes (SPA navigation)
        const observer = new MutationObserver(() => { hideSidebarLogo(); });
        observer.observe(document.body, { childList: true, subtree: true });
      })();
    `);
  });

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.includes(`localhost:${serverPort}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
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
