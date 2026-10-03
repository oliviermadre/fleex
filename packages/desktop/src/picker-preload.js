// Preload for ticket-browser <webview>s (forced by main.js's will-attach-webview).
// Sandboxed: no fs. It fetches the picker source from main on first use, runs it
// in the page's main world, and relays picker messages between page and host.
const { ipcRenderer, webFrame } = require('electron');

const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
let injected = null;
// True between picker:start and the first picked/cancelled. The page sees the
// nonce in our messages and could forge picks — outside a pick, nothing is relayed.
let armed = false;

function inject() {
  if (!injected) {
    injected = ipcRenderer
      .invoke('fleex:picker-source')
      .then((src) => webFrame.executeJavaScript(`(function () {\nvar __fleexPickerNonce = ${JSON.stringify(nonce)};\n${src}\n})();`))
      .catch((err) => { injected = null; throw err; });
  }
  return injected;
}

ipcRenderer.on('picker:start', () => {
  armed = true;
  inject()
    .then(() => window.postMessage({ __fleexPicker: 'in', nonce, cmd: 'start' }, '*'))
    .catch(() => {
      armed = false;
      ipcRenderer.sendToHost('picker:cancelled');
    });
});

ipcRenderer.on('picker:stop', () => {
  armed = false;
  window.postMessage({ __fleexPicker: 'in', nonce, cmd: 'stop' }, '*');
});

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!armed || !d || d.__fleexPicker !== 'out' || d.nonce !== nonce) return;
  if (d.type !== 'picked' && d.type !== 'cancelled') return;
  armed = false;
  ipcRenderer.sendToHost(`picker:${d.type}`, d.payload);
});
