/// <reference types="vite/client" />
import { describe, it, expect, beforeAll } from 'vitest';
// A plain classic script, imported for its global side effect.
import '../../../../../../desktop/src/picker/core.js';
// Raw source, as the preload sends it to the page (a relative `?raw` import has no types).
const [pickerSrc] = Object.values(
  import.meta.glob<string>('../../../../../../desktop/src/picker/picker.js', { query: '?raw', import: 'default', eager: true }),
);

type Msg = { __fleexPicker: string; nonce: string; type?: string };

function nextMessage(): Promise<Msg> {
  return new Promise((resolve) => {
    const on = (e: MessageEvent) => {
      const d = e.data as Msg;
      if (d?.__fleexPicker !== 'out') return;
      window.removeEventListener('message', on);
      resolve(d);
    };
    window.addEventListener('message', on);
  });
}

beforeAll(() => {
  // The preload runs the script inside a closure that carries the nonce.
  new Function(`var __fleexPickerNonce = 'n1';\n${pickerSrc}`)();
});

describe('picker.js', () => {
  it('cancels cleanly when building the context throws', async () => {
    const core = (globalThis as unknown as { __fleexPickerCore: { buildContext: unknown } }).__fleexPickerCore;
    const original = core.buildContext;
    core.buildContext = () => { throw new Error('exotic element'); };
    document.body.innerHTML = '<button id="b">x</button>';
    window.postMessage({ __fleexPicker: 'in', nonce: 'n1', cmd: 'start' }, '*');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.documentElement.style.cursor).toBe('crosshair');
    const msg = nextMessage();
    document.getElementById('b')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect((await msg).type).toBe('cancelled');
    expect(document.documentElement.style.cursor).toBe('');
    core.buildContext = original;
  });
});
