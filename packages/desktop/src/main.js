const { app, BrowserWindow, shell, nativeImage } = require('electron');
const path = require('path');

// ── Configuration ────────────────────────────────────────────────────────────
// When launched by `fleex start --desktop`, the CLI passes the server port.
// Fallback to 3000 for standalone usage.
app.setName('Fleex');

const serverPort = process.env['FLEEX_SERVER_PORT'] || '3000';
const serverUrl = `http://localhost:${serverPort}`;

function isExternalUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' && parsed.port === serverPort) return false;
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

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

        function formatResetTime(resetStr) {
          if (!resetStr) return '';
          const tzMatch = resetStr.match(/\\(([^)]+)\\)/);
          const tz = tzMatch ? tzMatch[1] : 'UTC';
          const now = new Date();

          const sameDayMatch = resetStr.match(/Resets?\\s+(\\d{1,2}(?::\\d{2})?)\\s*(am|pm)/i);
          const futureDayMatch = resetStr.match(/Resets?\\s+(\\w+)\\s+(\\d{1,2})\\s+at\\s+(\\d{1,2}(?::\\d{2})?)\\s*(am|pm)/i);

          let target = null;
          if (sameDayMatch) {
            target = buildResetDate(now.getFullYear(), now.getMonth(), now.getDate(), sameDayMatch[1], sameDayMatch[2], tz);
            if (target <= now) target = buildResetDate(now.getFullYear(), now.getMonth(), now.getDate() + 1, sameDayMatch[1], sameDayMatch[2], tz);
          } else if (futureDayMatch) {
            const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
            const monthIdx = months.findIndex(m => futureDayMatch[1].toLowerCase().startsWith(m));
            if (monthIdx >= 0) {
              let year = now.getFullYear();
              if (monthIdx < now.getMonth() || (monthIdx === now.getMonth() && parseInt(futureDayMatch[2]) < now.getDate())) year++;
              target = buildResetDate(year, monthIdx, parseInt(futureDayMatch[2]), futureDayMatch[3], futureDayMatch[4], tz);
            }
          }
          if (!target) return resetStr;
          const diffMs = target.getTime() - now.getTime();
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

        function buildResetDate(year, month, day, timePart, ampm, tz) {
          const parts = timePart.includes(':') ? timePart.split(':') : [timePart, '0'];
          let hour = parseInt(parts[0]);
          const minute = parseInt(parts[1]);
          if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
          if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
          const dateStr = year + '-' + String(month+1).padStart(2,'0') + '-' + String(day).padStart(2,'0') + 'T' + String(hour).padStart(2,'0') + ':' + String(minute).padStart(2,'0') + ':00';
          try {
            const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
            const utcGuess = new Date(dateStr + 'Z');
            const p = fmt.formatToParts(utcGuess);
            const g = (t) => parseInt(p.find(x => x.type === t)?.value ?? '0');
            const tzDate = new Date(Date.UTC(g('year'), g('month')-1, g('day'), g('hour'), g('minute'), g('second')));
            return new Date(utcGuess.getTime() - (tzDate.getTime() - utcGuess.getTime()));
          } catch { return new Date(dateStr); }
        }

        function renderTooltipRow(label, metric) {
          const remaining = 100 - metric.percentage;
          const fillColor = getFillColor(remaining);
          const resetTime = formatResetTime(metric.reset);
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
