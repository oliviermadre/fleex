// Preload for ticket-browser <webview>s (forced by main.js's will-attach-webview).
// Sandboxed: no fs. It fetches the picker source from main on first use, runs it
// in the page's main world, and relays picker messages between page and host.
const { ipcRenderer, webFrame } = require('electron');

const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
let injected = null;

function inject() {
  if (!injected) {
    injected = ipcRenderer
      .invoke('fleex:picker-source')
      .then((src) => webFrame.executeJavaScript(`${src}\n;window.__fleexPicker && window.__fleexPicker.boot(${JSON.stringify(nonce)});`))
      .catch((err) => { injected = null; throw err; });
  }
  return injected;
}

ipcRenderer.on('picker:start', () => {
  inject()
    .then(() => window.postMessage({ __fleexPicker: 'in', nonce, cmd: 'start' }, '*'))
    .catch(() => ipcRenderer.sendToHost('picker:cancelled'));
});

ipcRenderer.on('picker:stop', () => {
  window.postMessage({ __fleexPicker: 'in', nonce, cmd: 'stop' }, '*');
});

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.__fleexPicker !== 'out' || d.nonce !== nonce) return;
  ipcRenderer.sendToHost(`picker:${d.type}`, d.payload);
});
