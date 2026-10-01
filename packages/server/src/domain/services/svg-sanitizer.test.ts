import { describe, it, expect } from 'vitest';
import { sanitizeSvg, sanitizeActionIcons, iconifyBodyToSvg, SVG_MAX_BYTES } from './svg-sanitizer.js';

describe('sanitizeSvg', () => {
  it('keeps plain icon geometry and forces currentColor so the icon follows the theme', () => {
    const out = sanitizeSvg('<svg width="16" height="16"><path d="M0 0h8" fill="#ff0000" stroke="red"/></svg>');
    expect(out).toBe('<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h8" fill="currentColor" stroke="currentColor"/></svg>');
  });

  it('keeps fill="none" (outline icons would otherwise turn solid)', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 24 24"><path fill="none" d="M1 1"/></svg>')).toContain('fill="none"');
  });

  it('drops <script> with its content and every on* handler', () => {
    const out = sanitizeSvg('<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(2)</script><circle cx="1" cy="1" r="1" onclick="x()"/></svg>')!;
    expect(out).not.toMatch(/script|alert|onload|onclick/);
    expect(out).toContain('<circle cx="1" cy="1" r="1"/>');
  });

  it('drops links, styles, foreignObject and url() references — anything that can reach out', () => {
    const out = sanitizeSvg(
      '<svg viewBox="0 0 24 24"><a href="https://evil"><path d="M1 1"/></a><foreignObject><div>x</div></foreignObject>' +
      '<style>*{}</style><rect x="0" y="0" width="1" height="1" fill="url(#g)" style="fill:red" xlink:href="#x"/></svg>',
    )!;
    expect(out).not.toMatch(/href|foreignObject|style|url\(|evil/);
    expect(out).toContain('<rect x="0" y="0" width="1" height="1"/>');
  });

  it('can keep brand colours on request', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 24 24"><path fill="#181717" d="M1 1"/></svg>', { keepColors: true })).toContain('fill="#181717"');
  });

  it('rejects input that is not an svg, has no geometry, or is too large', () => {
    expect(sanitizeSvg('<div>hello</div>')).toBeNull();
    expect(sanitizeSvg('<svg viewBox="0 0 24 24"></svg>')).toBeNull();
    const huge = `<svg viewBox="0 0 24 24">${'<path d="M1 1"/>'.repeat(SVG_MAX_BYTES / 10)}</svg>`;
    expect(sanitizeSvg(huge)).toBeNull();
  });

  it('closes elements left open by malformed markup', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 24 24"><g><path d="M1 1"/>')).toBe('<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g><path d="M1 1"/></g></svg>');
  });

  it('builds a standalone svg from an Iconify body', () => {
    const svg = sanitizeSvg(iconifyBodyToSvg('<path fill="currentColor" d="M12 0"/>', 24, 24));
    expect(svg).toContain('viewBox="0 0 24 24"');
  });
});

describe('sanitizeActionIcons', () => {
  it('sanitises inline SVG icons before they are stored, keeping colours, leaving other icon types alone', () => {
    const [svg, url, empty] = sanitizeActionIcons([
      { id: 'a', iconType: 'svg', icon: '<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(1)</script><path fill="#f00" d="M1 1h2"/></svg>' },
      { id: 'b', iconType: 'url', icon: 'https://example.com/i.png' },
      { id: 'c', iconType: 'svg', icon: '<img src=x onerror=alert(1)>' },
    ]);
    expect(svg!.icon).not.toMatch(/script|onload|alert/);
    expect(svg!.icon).toContain('fill="#f00"');
    expect(url!.icon).toBe('https://example.com/i.png');
    expect(empty!.icon).toBe('');
  });
});
