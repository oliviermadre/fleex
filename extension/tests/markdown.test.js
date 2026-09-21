import '../markdown.js';

const { renderMarkdown, mdInline, escapeHtml } = globalThis.FleexMarkdown;

/** Inline rendering as the renderer actually performs it: escape, then inline. */
const inline = (s) => mdInline(escapeHtml(s));

describe('mdInline — no digit is ever swallowed (CDDA-21)', () => {
  // The bug: the inline-code placeholder was " <index> ", so any number
  // surrounded by spaces in ordinary prose was consumed and replaced by an
  // empty <code></code> — rendered as a little rounded square by the CSS.
  // These 5 cases are taken verbatim from the ticket screenshots.
  const untouched = [
    ['AC1', 'Les 4 points à trancher avant de lui parler'],
    ['AC2', 'tech » → 4 « je suis d\'accord »'],
    ['AC3', '(Pablo 42 PR vs Ludo 61, Jérémy 88)'],
    ['AC4', 'Variable Q2 : ~70 % (1 126 €), réaction plate'],
    ['AC5', 'Total : 1 000 000 € sur 3 ans'],
  ];

  it.each(untouched)('%s — plain prose passes through unchanged: %s', (_id, input) => {
    expect(inline(input)).toBe(escapeHtml(input));
  });

  it('AC6 — a real code span still renders, and the neighbouring digit survives', () => {
    expect(inline('Lance `git status` avant, il reste 0 fichiers'))
      .toBe('Lance <code>git status</code> avant, il reste 0 fichiers');
  });

  it('AC7 — two code spans plus a bare digit on the same line', () => {
    expect(inline('`npm ci` puis `npm test` : 1 erreur'))
      .toBe('<code>npm ci</code> puis <code>npm test</code> : 1 erreur');
  });

  it('AC8 — code span glued to surrounding words', () => {
    expect(inline('foo`bar`baz')).toBe('foo<code>bar</code>baz');
  });

  it('AC9 — adjacent code spans keep the single space between them', () => {
    expect(inline('`a` `b`')).toBe('<code>a</code> <code>b</code>');
  });

  it('AC10 — code span at start of line', () => {
    expect(inline('`code` en tête de ligne')).toBe('<code>code</code> en tête de ligne');
  });

  it('AC11 — code span nested inside bold', () => {
    expect(inline('**gras avec `code` dedans**'))
      .toBe('<strong>gras avec <code>code</code> dedans</strong>');
  });

  it('AC12 — code content is escaped exactly once', () => {
    // Used to double-escape: the user saw the literal text "a &lt; b".
    expect(inline('compare `a < b` et `x & y`'))
      .toBe('compare <code>a &lt; b</code> et <code>x &amp; y</code>');
  });

  it('AC13 — emphasis and links are unaffected by the fix', () => {
    expect(inline('texte *ital* et **gras** et [lien](https://x.io)'))
      .toBe('texte <em>ital</em> et <strong>gras</strong> et '
        + '<a href="https://x.io" target="_blank" rel="noopener noreferrer">lien</a>');
  });

  it('AC14 — a forged placeholder in unescaped input is neutralised, not restored', () => {
    // Defensive guard: mdInline stays safe even if a caller forgets to escape.
    expect(mdInline('a <0> b')).toBe('a &lt;0&gt; b');
  });

  it('AC14b — an unmatched placeholder is emitted verbatim, never as empty code', () => {
    // Escaped input can only contain &lt;0&gt;, so this is the belt-and-braces
    // path: whatever happens, no content disappears.
    expect(inline('a <0> b')).toBe('a &lt;0&gt; b');
  });
});

describe('renderMarkdown — content-preservation invariants', () => {
  it('AC15 — never emits an empty <code></code> pastille', () => {
    const samples = [
      'Les 4 points à trancher',
      'un budget de 1 200 € pour 3 personnes',
      'Lance `git status`, il reste 0 fichiers',
      '| a | 12 | b |\n| --- | --- | --- |\n| 1 | 2 | 3 |',
      '```\nconst x = 42 ;\n```',
      '# Titre 7 mots\n\n- item 5\n- item 6',
    ];
    for (const s of samples) expect(renderMarkdown(s)).not.toContain('<code></code>');
  });

  it('AC16 — every number in the input is present in the output', () => {
    const subjects = ['Pablo', 'Ludo', 'Jérémy', 'l\'équipe'];
    const tails = ['points à trancher', 'PR ouvertes', '€ de budget', 'jours'];
    const spans = ['', 'Lance `git status` : ', '`npm ci` puis '];
    for (const subject of subjects) {
      for (const tail of tails) {
        for (const span of spans) {
          for (const n of ['0', '4', '42', '1 126', '1 000 000']) {
            const input = `${span}${subject} ${n} ${tail}`;
            const out = renderMarkdown(input);
            for (const group of n.split(' ')) {
              expect(out, `"${input}" lost the number ${n}`).toContain(group);
            }
          }
        }
      }
    }
  });

  it('AC17 — spacing outside code spans is byte-identical to the input', () => {
    const input = 'a  b   c 42 d';
    expect(renderMarkdown(input)).toBe('<p>a  b   c 42 d</p>');
  });
});

describe('renderMarkdown — horizontal rules', () => {
  it('AC18 — ---, *** and ___ produce an <hr>', () => {
    expect(renderMarkdown('---')).toBe('<hr>');
    expect(renderMarkdown('***')).toBe('<hr>');
    expect(renderMarkdown('___')).toBe('<hr>');
    expect(renderMarkdown('-----')).toBe('<hr>');
    expect(renderMarkdown('  ---  ')).toBe('<hr>');
  });

  it('AC18 — an hr ends the preceding paragraph instead of being absorbed by it', () => {
    expect(renderMarkdown('avant\n---\naprès')).toBe('<p>avant</p><hr><p>après</p>');
  });

  it('AC18 — near-misses stay what they were', () => {
    expect(renderMarkdown('--')).toBe('<p>--</p>');
    expect(renderMarkdown('-- -')).toBe('<p>-- -</p>');
    expect(renderMarkdown('- - -')).toBe('<ul><li>- -</li></ul>');
    expect(renderMarkdown('- item')).toBe('<ul><li>item</li></ul>');
    expect(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |'))
      .toBe('<table><thead><tr><th>a</th><th>b</th></tr></thead>'
        + '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  });
});

describe('renderMarkdown — non-regression on existing blocks', () => {
  it('AC19 — headings', () => {
    expect(renderMarkdown('## Titre')).toBe('<h2>Titre</h2>');
  });

  it('AC19 — unordered and ordered lists', () => {
    expect(renderMarkdown('- un\n- deux')).toBe('<ul><li>un</li><li>deux</li></ul>');
    expect(renderMarkdown('1. un\n2. deux')).toBe('<ol><li>un</li><li>deux</li></ol>');
  });

  it('AC19 — GFM table with alignment and a bare number in a cell', () => {
    expect(renderMarkdown('| a | b |\n| :--- | ---: |\n| 1 | 2 |'))
      .toBe('<table><thead><tr><th style="text-align:left">a</th>'
        + '<th style="text-align:right">b</th></tr></thead>'
        + '<tbody><tr><td style="text-align:left">1</td>'
        + '<td style="text-align:right">2</td></tr></tbody></table>');
  });

  it('AC19 — fenced code block keeps a space-wrapped number intact', () => {
    expect(renderMarkdown('```\nconst x = 42 ;\n```'))
      .toBe('<pre><code>const x = 42 ;</code></pre>');
  });

  it('AC19 — soft line breaks inside a paragraph', () => {
    expect(renderMarkdown('une ligne\nune autre')).toBe('<p>une ligne<br>une autre</p>');
  });

  it('streaming — an unclosed backtick renders as text, no pastille', () => {
    // The panel re-renders on every chunk (sidepanel.js:128), so half-typed
    // spans must not flash a square.
    const out = renderMarkdown('Lance `git stat');
    expect(out).not.toContain('<code>');
    expect(out).toContain('`git stat');
  });
});

describe('renderMarkdown — security invariants', () => {
  it('AC20 — raw HTML is escaped, no live tag is produced', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('AC20 — a <script> inside a code span stays escaped', () => {
    const out = renderMarkdown('`<script>alert(1)</script>`');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;');
  });

  it('AC20 — javascript: links are not turned into anchors', () => {
    const out = renderMarkdown('[x](javascript:alert(1))');
    expect(out).not.toContain('<a ');
  });

  it('AC20 — http(s) and mailto links are still allowed', () => {
    expect(renderMarkdown('[x](https://a.io)')).toContain('<a href="https://a.io"');
    expect(renderMarkdown('[x](mailto:a@b.io)')).toContain('<a href="mailto:a@b.io"');
  });
});
