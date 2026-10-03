/**
 * `.claude/launch.json` (Claude Desktop's preview config) read as a list of URL
 * shortcuts for the browser's new-tab page. Nothing is ever started from it.
 */
export interface LaunchShortcut {
  name: string;
  url: string;
}

const DEFAULT_PORT = 3000;

export function parseLaunchConfig(raw: string): LaunchShortcut[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const confs = (json as { configurations?: unknown }).configurations;
  if (!Array.isArray(confs)) return [];
  const out: LaunchShortcut[] = [];
  for (const c of confs as Record<string, unknown>[]) {
    if (!c || typeof c.name !== 'string') continue;
    if (typeof c.url === 'string' && /^https?:\/\//i.test(c.url)) {
      out.push({ name: c.name, url: c.url });
    } else {
      const port = typeof c.port === 'number' ? c.port : DEFAULT_PORT;
      out.push({ name: c.name, url: `http://localhost:${port}` });
    }
  }
  return out;
}
