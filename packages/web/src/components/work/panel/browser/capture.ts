import { uploadFile } from '../../../../services/api';
import type { ElementContext } from '../../../shared/elementContext';
import type { ElectronWebview } from './webview';

const PAD = 8;

/** The element's box plus padding, clipped to the viewport, in webview DIPs. */
export function captureRect(ctx: ElementContext, zoom: number, pad = PAD) {
  const { w: vw, h: vh } = ctx.page.viewport;
  const left = Math.max(0, ctx.rect.x - pad);
  const top = Math.max(0, ctx.rect.y - pad);
  const right = Math.min(vw, ctx.rect.x + ctx.rect.w + pad);
  const bottom = Math.min(vh, ctx.rect.y + ctx.rect.h + pad);
  if (right <= left || bottom <= top) return null;
  return {
    x: Math.round(left * zoom),
    y: Math.round(top * zoom),
    width: Math.round((right - left) * zoom),
    height: Math.round((bottom - top) * zoom),
  };
}

export function dataUrlToFile(dataUrl: string, name: string): File {
  const [head = '', b64 = ''] = dataUrl.split(',', 2);
  const type = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}

/** Screenshot the picked element and upload it; undefined when it can't be done. */
export async function captureElement(wv: ElectronWebview, ctx: ElementContext): Promise<string | undefined> {
  const bridge = window.fleexDesktop;
  const rect = captureRect(ctx, wv.getZoomFactor());
  if (!bridge || !rect) return undefined;
  const dataUrl = await bridge.capture(wv.getWebContentsId(), rect);
  const uploaded = await uploadFile(dataUrlToFile(dataUrl, `element-${Date.now()}.png`));
  return uploaded.url;
}
