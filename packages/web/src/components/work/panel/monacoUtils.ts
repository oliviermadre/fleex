/** Shared Monaco helpers for the Code editor (language + app-theme inference). */

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', mdx: 'markdown', css: 'css', scss: 'scss', less: 'less', html: 'html',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', sh: 'shell', bash: 'shell', zsh: 'shell',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', php: 'php', sql: 'sql',
  xml: 'xml', svg: 'xml', graphql: 'graphql', gql: 'graphql', dockerfile: 'dockerfile',
};

export function getLanguage(path: string): string {
  const base = path.split('/').pop()?.toLowerCase() ?? '';
  if (base === 'dockerfile') return 'dockerfile';
  const ext = base.split('.').pop() ?? '';
  return LANGUAGE_MAP[ext] ?? 'plaintext';
}

/** Infer a Monaco theme from the app's surface color luminance. */
export function inferMonacoTheme(): 'vs' | 'vs-dark' {
  if (typeof window === 'undefined') return 'vs-dark';
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--theme-bg-base').trim();
    let r = 20, g = 20, b = 20;
    if (raw.startsWith('#') || /^[0-9a-f]{6}$/i.test(raw)) {
      const hex = raw.replace('#', '');
      r = parseInt(hex.slice(0, 2), 16); g = parseInt(hex.slice(2, 4), 16); b = parseInt(hex.slice(4, 6), 16);
    } else {
      const m = /(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(raw);
      if (m) { r = Number(m[1]); g = Number(m[2]); b = Number(m[3]); }
    }
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? 'vs' : 'vs-dark';
  } catch {
    return 'vs-dark';
  }
}
