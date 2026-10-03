const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[^/:]+\.localhost)$/i;

/** Address-bar input → a loadable http(s) URL, or null when it isn't one. */
export function normalizeUrl(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return null; // another scheme (file:, javascript:…)
  if (/^\d+$/.test(s)) return `http://localhost:${s}`;
  if (s.startsWith(':')) return `http://localhost${s}`;
  const host = s.split(/[/:?#]/)[0] ?? '';
  return `${LOCAL_HOST.test(host) ? 'http' : 'https'}://${s}`;
}
