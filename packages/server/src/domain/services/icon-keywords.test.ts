import { describe, it, expect } from 'vitest';
import { guessIconKeywords } from './icon-keywords.js';

describe('guessIconKeywords', () => {
  it('maps a program to the brand its icon goes by, ahead of the label words', () => {
    expect(guessIconKeywords('Login GitHub', 'gh auth login --web')).toEqual({ brand: 'github', keywords: ['github', 'login'] });
    expect(guessIconKeywords('Pods', 'kubectl get pods')).toEqual({ brand: 'kubernetes', keywords: ['kubernetes', 'pods'] });
  });

  it('skips env assignments, launchers and cd plumbing to find the program', () => {
    expect(guessIconKeywords('Up', 'cd "{{workspace_path}}" && FOO=1 docker compose up -d').brand).toBe('docker');
    expect(guessIconKeywords('', 'sudo npx vercel deploy').brand).toBe('vercel');
  });

  it('takes the brand from a URL host', () => {
    expect(guessIconKeywords('Dashboards', 'https://app.datadoghq.com/dashboard').brand).toBe('datadoghq');
    expect(guessIconKeywords('', 'open https://github.com/org/repo/pulls').brand).toBe('github');
    expect(guessIconKeywords('Local', 'http://localhost:3000').brand).toBeNull();
  });

  it('falls back to label words, without stop words, and caps the list', () => {
    expect(guessIconKeywords('Open the staging database console', 'make db')).toEqual({ brand: null, keywords: ['staging', 'database', 'console'] });
    expect(guessIconKeywords('alpha beta gamma delta epsilon', undefined).keywords).toHaveLength(4);
  });

  it('uses an unknown program as the keyword when the label has none', () => {
    expect(guessIconKeywords('', 'lazygit')).toEqual({ brand: null, keywords: ['lazygit'] });
  });
});
