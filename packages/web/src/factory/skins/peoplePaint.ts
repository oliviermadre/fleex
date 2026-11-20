/**
 * The people of the floor, as each skin draws them (`people.ts` moves them): in pixel art, a little worker seen from
 * above and the front, its legs going as it walks; in Fleex's skin, a figure seen from above as a plan draws one
 * (shoulders and a head); in the neon one, the same in light, with a trail. DRAFT for `docs/factory/people.html`.
 */
import { mix } from '../floorLook';
import type { Person } from '../people';
import { ART, box } from './pixelArt';
import type { Palette } from './fleex';

const INK = '#2b2833';
/** Shirts, skin tones and hair, chosen by a person's number: no two neighbours alike, nothing kept. */
export const SHIRTS = ['#e0614f', '#4f8fe0', '#5fb35f', '#e0b14f', '#9b6fe0', '#4fc4c4', '#f2b01e'];
const SKIN = ['#f2c79e', '#d9a07a', '#a8714a', '#7a4f33'], HAIR = ['#3a2a1e', '#f2b01e', '#8a4b2a', '#1d1b26', '#c0c0c0'];

/** A person in pixel art, feet at the middle of the bottom of their tile; `light`: the day workshop. */
export function pixelPerson(ctx: CanvasRenderingContext2D, p: Person, light: boolean): void {
  const X = Math.round((p.x + 0.5) * ART), Y = Math.round((p.y + 0.85) * ART), walking = p.stride > 0, step = walking ? Math.floor(p.stride) % 2 : -1;
  const shirt = SHIRTS[p.shirt % SHIRTS.length]!, skin = SKIN[p.id % SKIN.length]!, hair = HAIR[(p.id * 3) % HAIR.length]!, legs = light ? '#3d4a7a' : '#2e3860';
  const r = (dx: number, dy: number, w: number, h: number, c: string) => box(ctx, X + dx, Y + dy, w, h, c);
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * (light ? 0.25 : 0.45); r(-4, -1, 8, 2, '#000000'); ctx.globalAlpha = a0;
  r(-3, -6, 2, step === 1 ? 4 : 5, legs); r(1, -6, 2, step === 0 ? 4 : 5, legs);
  r(-4, -11, 8, 6, shirt); r(-4, -11, 8, 1, mix(shirt, '#ffffff', 0.3));
  /* arms swing as they walk; seen from the side, one arm */
  if (p.dir === 0 || p.dir === 2) r(p.dir === 0 ? 2 : -4, -10 + (step === 1 ? 1 : 0), 2, 4, mix(shirt, '#000000', 0.2));
  else { r(-5, -10 + (step === 0 ? 1 : 0), 1, 4, skin); r(4, -10 + (step === 1 ? 1 : 0), 1, 4, skin); }
  r(-2, -15, 4, 4, skin); r(-3, -17, 6, 2, hair);
  if (p.dir === 3) r(-2, -15, 4, 2, hair);
  else if (p.dir === 1) { r(-1, -13, 1, 1, INK); r(1, -13, 1, 1, INK); }
  else r(p.dir === 0 ? 1 : -2, -13, 1, 1, INK);
  if (p.dir === 0) r(-3, -15, 1, 2, hair); else if (p.dir === 2) r(2, -15, 1, 2, hair);
  /* a reviewer carries a clipboard */
  if (p.role === 'reviewer') { r(p.dir === 2 ? -6 : 3, -11, 4, 5, INK); r(p.dir === 2 ? -5 : 4, -10, 2, 3, '#fafafa'); }
}

/** A person seen from above, as a plan draws one: shoulders, a head turned the way they go. Neon: in light, with a trail. */
export function flatPerson(ctx: CanvasRenderingContext2D, p: Person, pal: Palette, neon: boolean): void {
  const cx = p.x + 0.5, cy = p.y + 0.5, dx = [1, 0, -1, 0][p.dir]!, dy = [0, 1, 0, -1][p.dir]!, sway = p.stride > 0 ? Math.sin(p.stride * Math.PI) * 0.05 : 0;
  const shirt = SHIRTS[p.shirt % SHIRTS.length]!, skin = SKIN[p.id % SKIN.length]!;
  const a0 = ctx.globalAlpha;
  if (neon) {
    for (let k = 1; k <= 3; k++) if (p.stride > 0) { ctx.globalAlpha = (a0 * 0.4) / k; ctx.beginPath(); ctx.arc(cx - dx * k * 0.2, cy - dy * k * 0.2, 0.07, 0, 6.3); ctx.fillStyle = shirt; ctx.fill(); }
    ctx.globalAlpha = a0;
  } else { ctx.beginPath(); ctx.ellipse(cx + 0.05, cy + 0.08, 0.36, 0.24, 0, 0, 6.3); ctx.fillStyle = pal.light ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.35)'; ctx.fill(); }
  /* the shoulders lie across the way they go; the arms swing with the stride */
  const ax = dy, ay = -dx;
  if (p.stride > 0) for (const s of [1, -1]) { ctx.beginPath(); ctx.arc(cx + ax * s * 0.3 + dx * sway * s * 2, cy + ay * s * 0.3 + dy * sway * s * 2, 0.07, 0, 6.3); ctx.fillStyle = neon ? shirt : skin; ctx.fill(); }
  ctx.beginPath(); ctx.ellipse(cx + ax * sway, cy + ay * sway, dx ? 0.16 : 0.32, dx ? 0.32 : 0.16, 0, 0, 6.3);
  if (neon) { ctx.fillStyle = '#0b0a16'; ctx.fill(); ctx.strokeStyle = shirt; ctx.lineWidth = 0.05; ctx.stroke(); }
  else { ctx.fillStyle = mix(shirt, pal.floor, pal.light ? 0.05 : 0.1); ctx.fill(); ctx.strokeStyle = mix(shirt, '#000000', 0.35); ctx.lineWidth = 0.03; ctx.stroke(); }
  ctx.beginPath(); ctx.arc(cx + dx * 0.06, cy + dy * 0.06, 0.15, 0, 6.3);
  if (neon) { ctx.fillStyle = '#0b0a16'; ctx.fill(); ctx.strokeStyle = pal.text; ctx.lineWidth = 0.045; ctx.stroke(); }
  else { ctx.fillStyle = skin; ctx.fill(); ctx.strokeStyle = mix(skin, '#000000', 0.4); ctx.lineWidth = 0.025; ctx.stroke(); ctx.beginPath(); ctx.arc(cx - dx * 0.02, cy - dy * 0.02, 0.11, 0, 6.3); ctx.fillStyle = HAIR[(p.id * 3) % HAIR.length]!; ctx.fill(); }
  if (p.role === 'reviewer') { const bx = cx + dx * 0.24 + ax * 0.12, by = cy + dy * 0.24 + ay * 0.12; ctx.fillStyle = neon ? '#0b0a16' : '#fafafa'; ctx.strokeStyle = neon ? '#ffd23f' : mix('#c8955a', '#000000', 0.3); ctx.lineWidth = 0.03; ctx.fillRect(bx - 0.09, by - 0.11, 0.18, 0.22); ctx.strokeRect(bx - 0.09, by - 0.11, 0.18, 0.22); }
}
