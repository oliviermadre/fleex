// @ts-check
/**
 * ESLint flat config (ticket #467 — make `lint` a real lint).
 *
 * Design notes:
 *   - Rules are listed EXPLICITLY rather than pulled from `recommendedTypeChecked`.
 *     That preset drags in the `no-unsafe-*` family, which would emit thousands of
 *     baseline entries on a codebase that legitimately contains `any`. We want a
 *     lint that is *useful*, not *maximal*.
 *   - Type-aware linting is expensive and requires every linted file to belong to a
 *     tsconfig `include`. It is therefore scoped to TYPE_AWARE_FILES below; every
 *     other TS file still gets the TS *parser* (see the "TS base" block) so that no
 *     file is ever parsed by espree and reported as a fatal error.
 *   - `react-hooks` v7 ships ~30 rules (React Compiler). We enable only the two the
 *     ticket asks for, explicitly, so this config is independent of the plugin's
 *     major version.
 *
 * Violations of these rules on existing code are absorbed by the snapshot ratchet
 * (scripts/check-lint-ratchet.mjs) — see CONTRIBUTING.md.
 */
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Files eligible for type-aware linting: each one MUST be covered by the `include`
 * of a tsconfig, otherwise `projectService` errors out.
 *
 * Deliberately excluded (no tsconfig covers them today):
 *   packages/server/tests/**, packages/server/scripts/**, packages/cli/tests/**,
 *   packages/*&#47;vite*.config.ts, vitest.workspace.ts
 * Adding them to a tsconfig would change what `lint:types` checks — out of scope here.
 */
const TYPE_AWARE_FILES = [
  'packages/*/src/**/*.{ts,tsx}',
  'packages/cli/index.ts',
  'packages/mcp/tests/**/*.ts',
  'packages/sidepanel-host/tests/**/*.ts',
];

export default tseslint.config(
  // ── 1. Global ignores ─────────────────────────────────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'packages/web/public/**',
      // Vanilla browser JS against the `chrome.*` APIs: no build, no tests.
      // Config cost outweighs the value — deliberately out of scope (D9).
      'extension/**',
    ],
  },

  // ── 2. Linter options ─────────────────────────────────────────────────────
  // A dead `eslint-disable` is worse than no comment: it advertises a guard that
  // does not exist. The repo had 15 of them before this config landed.
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },

  // ── 3. Base JS ────────────────────────────────────────────────────────────
  js.configs.recommended,

  // ── 4. TS base: parser for EVERY TypeScript file (no type information) ─────
  // Guarantees no TS file falls through to espree and produces a fatal parse
  // error, which the ratchet refuses to baseline by design.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    // `eslintRecommended` switches off the core rules TypeScript already covers or
    // that misfire on TS syntax — notably `no-redeclare`, which flags legitimate
    // `const X` + `type X` declaration merging (see shared/src/types/websocket.ts).
    extends: [tseslint.configs.base, tseslint.configs.eslintRecommended],
    rules: {
      // TypeScript itself resolves globals and unused symbols far better.
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },

  // ── 5. Shared rules for all hand-written source (JS + TS) ─────────────────
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    plugins: { 'import-x': importX },
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',

      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          pathGroups: [{ pattern: '@fleex/**', group: 'internal', position: 'before' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
          // CRITICAL: side-effect imports (`import './index.css'`) are order-sensitive.
          // Letting --fix move them silently breaks the build.
          warnOnUnassignedImports: false,
        },
      ],
    },
  },

  // ── 6. TypeScript rules (parser-only, no type information needed) ─────────
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
          // Inline `import('./x').Type` annotations are used deliberately in the
          // shared type packages to avoid top-level imports. Banning them is not
          // auto-fixable, so it would only add permanent baseline noise.
          disallowTypeAnnotations: false,
        },
      ],
    },
  },

  // ── 7. Type-aware rules (the expensive ones) ──────────────────────────────
  {
    files: TYPE_AWARE_FILES,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        // Without this, every `onClick={async () => …}` in the web app errors.
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'error',
    },
  },

  // ── 8. React web app ──────────────────────────────────────────────────────
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Explicit, NOT the v7 preset: that would enable ~30 React Compiler rules.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // ── 9. Node-side packages, scripts and config files ───────────────────────
  {
    files: [
      'packages/{server,cli,mcp,shared,sidepanel-host,host-gateway,event-hub}/**/*.ts',
      'packages/*/vite.config.ts',
      'packages/*/vitest*.config.ts',
      'vitest.workspace.ts',
      'scripts/**/*.mjs',
      'eslint.config.mjs',
    ],
    languageOptions: { globals: globals.node },
  },

  // The audit callback is handed to Playwright's `page.evaluate()`, so it runs
  // inside the browser even though the file is a Node script.
  {
    files: ['scripts/theme-audit/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // ── 10. Electron desktop shell (CommonJS, no TypeScript) ──────────────────
  // The preload script bridges both worlds: Node `require` plus `window`/`document`.
  {
    files: ['packages/desktop/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // ── 11. Tests ─────────────────────────────────────────────────────────────
  {
    files: ['**/*.test.{ts,tsx}', '**/tests/**/*.ts', 'scripts/**/*.test.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    rules: {
      // Mocks and fixtures legitimately need `any`; forcing types here buys nothing.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // ── 12. Prettier — MUST stay last so it can switch off stylistic rules ────
  prettier,
);
