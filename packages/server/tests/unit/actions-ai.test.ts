import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import type { IconSuggestion } from '@fleex/shared';
import {
  SuggestActionUseCase,
  parseJsonObject,
  validateDraftPlan,
  type JsonModelPort,
  type IconSearchPort,
} from '../../src/application/use-cases/suggest-action.js';
import { actionsAiRoutes } from '../../src/infrastructure/http/actions-ai.routes.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const binaries = { lookup: vi.fn(async (name: string) => ({ name, found: name !== 'platool', ...(name !== 'platool' ? { path: `/usr/bin/${name}` } : {}) })) };
const GH_ICON: IconSuggestion = { id: 'simple-icons:github', source: 'simple-icons', name: 'github', svg: '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>', license: 'CC0-1.0' };

/** A model that answers by matching the system prompt, in order of the replies given. */
function scriptedModel(replies: ((system: string, prompt: string) => string | undefined)[]): JsonModelPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    complete: vi.fn(async (system: string, prompt: string) => {
      calls.push(prompt);
      for (const reply of replies) {
        const out = reply(system, prompt);
        if (out !== undefined) return out;
      }
      return '{}';
    }),
  };
}

const icons = (result: IconSuggestion[] | Error): IconSearchPort => ({
  search: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }),
});

describe('SuggestActionUseCase.command', () => {
  it('returns the command with its explanation and checks the binaries it needs', async () => {
    const model = scriptedModel([() => '{"command":"gcloud auth login --update-adc","explanation":"Ouvre le navigateur.","risk":"mutating"}']);
    const uc = new SuggestActionUseCase(model, binaries, icons([]), logger);
    const s = await uc.command({ intent: 'me connecter à gcloud', kind: 'action', scope: 'pinned' });
    expect(s).toMatchObject({ command: 'gcloud auth login --update-adc', risk: 'mutating', binaries: [{ name: 'gcloud', found: true }] });
  });

  it('marks an interactive command for the terminal — a -it never works in the background — but never a probe', async () => {
    const model = scriptedModel([() => '{"command":"docker run --rm -it alpine sh","explanation":"x","risk":"safe","runMode":"background"}']);
    const uc = new SuggestActionUseCase(model, binaries, icons([]), logger);
    expect((await uc.command({ intent: 'shell alpine', kind: 'action', scope: 'pinned' })).runMode).toBe('terminal');
    expect((await uc.command({ intent: 'shell alpine', kind: 'probe', scope: 'pinned' })).runMode).toBeUndefined();
  });

  it('tells the model aliases are not loaded, so it proposes real programs', async () => {
    const model = scriptedModel([() => '{"command":"gh auth status","risk":"safe"}']);
    await new SuggestActionUseCase(model, binaries, icons([]), logger).command({ intent: 'gh ok?', kind: 'action', scope: 'pinned' });
    expect((model.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toContain('never rely on an alias');
  });

  it('forces destructive on a dangerous command whatever the model says', async () => {
    const model = scriptedModel([() => '{"command":"docker system prune -af","explanation":"x","risk":"safe"}']);
    const uc = new SuggestActionUseCase(model, binaries, icons([]), logger);
    expect((await uc.command({ intent: 'clean docker', kind: 'action', scope: 'pinned' })).risk).toBe('destructive');
  });

  it('retries once when the first reply is not valid JSON, then gives up with a clear error', async () => {
    let n = 0;
    const model: JsonModelPort = { complete: vi.fn(async () => (n++ === 0 ? 'Sure! here it is' : '```json\n{"command":"gh auth status","risk":"safe"}\n```')) };
    const uc = new SuggestActionUseCase(model, binaries, icons([]), logger);
    expect((await uc.command({ intent: 'gh ok?', kind: 'probe', scope: 'pinned' })).command).toBe('gh auth status');

    const broken: JsonModelPort = { complete: vi.fn(async () => 'nope') };
    await expect(new SuggestActionUseCase(broken, binaries, icons([]), logger).command({ intent: 'x', kind: 'action', scope: 'pinned' }))
      .rejects.toThrow(/usable answer/);
    expect(broken.complete).toHaveBeenCalledTimes(2);
  });

  it('tells the model about the probe contract only for probes', async () => {
    const model = scriptedModel([() => '{"command":"true"}']);
    const uc = new SuggestActionUseCase(model, binaries, icons([]), logger);
    await uc.command({ intent: 'ok?', kind: 'probe', scope: 'pinned' });
    await uc.command({ intent: 'go', kind: 'action', scope: 'pinned' });
    const systems = (model.complete as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(systems[0]).toContain('STATUS PROBE');
    expect(systems[1]).not.toContain('STATUS PROBE');
  });
});

describe('SuggestActionUseCase.iconSuggestions', () => {
  it('searches Iconify with the keywords only (never the command) and puts the brand first', async () => {
    const model = scriptedModel([() => '{"keywords":["git","octocat"],"brand":"github","generate":false}']);
    const search = icons([GH_ICON]);
    const uc = new SuggestActionUseCase(model, binaries, search, logger);
    const res = await uc.iconSuggestions({ label: 'GitHub CLI', command: 'gh auth login --secret-token abc' });
    expect(res.suggestions[0]!.source).toBe('simple-icons');
    const [keywords, options] = (search.search as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(keywords).toEqual(['github', 'git', 'octocat']);
    expect(JSON.stringify(keywords)).not.toContain('secret');
    expect(options).toMatchObject({ brandFirst: true, includeBrands: true, limit: 6 });
  });

  it('still offers a generated icon when Iconify is down', async () => {
    const model = scriptedModel([
      (system) => (system.includes('icon search keywords') ? '{"keywords":["cloud"],"brand":null,"generate":false}' : undefined),
      (system) => (system.includes('draw one minimal line icon') ? '{"svg":"<svg viewBox=\\"0 0 24 24\\"><script>x</script><circle cx=\\"12\\" cy=\\"12\\" r=\\"4\\"/></svg>"}' : undefined),
    ]);
    const uc = new SuggestActionUseCase(model, binaries, icons(new Error('ECONNREFUSED')), logger);
    const res = await uc.iconSuggestions({ label: 'GCloud' });
    expect(res.iconifyUnavailable).toBe(true);
    expect(res.suggestions).toHaveLength(1);
    expect(res.suggestions[0]!.source).toBe('generated');
    expect(res.suggestions[0]!.svg).not.toContain('script');
  });
});

describe('SuggestActionUseCase.draft', () => {
  const plan = {
    label: 'K8s staging',
    actionType: 'shell',
    actionValue: 'platool login staging',
    probe: 'kubectl --context staging cluster-info --request-timeout=5s',
    rules: [{ label: 'Disconnect from staging', when: ['ok'], command: 'platool logout staging' }],
    iconKeywords: ['kubernetes', 'cluster'],
    brand: 'kubernetes',
    notes: null,
  };

  it('turns "toggle cluster staging avec platool" into an action, a probe and an ok → logout rule in ONE model call', async () => {
    const model = scriptedModel([(system) => (system.includes('design a one-click button') ? JSON.stringify(plan) : undefined)]);
    const search = icons([{ ...GH_ICON, id: 'simple-icons:kubernetes', name: 'kubernetes' }]);
    const stages: string[] = [];
    const uc = new SuggestActionUseCase(model, binaries, search, logger);
    const result = await uc.draft({ prompt: 'toggle cluster staging avec platool', scope: 'pinned', onStage: (s) => stages.push(s) });

    // Each SDK call spawns a Claude Code process: one call, not one per field.
    expect(model.complete).toHaveBeenCalledTimes(1);
    expect(stages).toEqual(['intent', 'command', 'probe', 'icon']);
    expect(result.draft).toMatchObject({
      label: 'K8s staging',
      actionValue: 'platool login staging',
      status: { command: expect.stringContaining('kubectl --context staging') },
      conditionalActions: [{ label: 'Disconnect from staging', when: ['ok'], actionValue: 'platool logout staging' }],
    });
    expect(result.icon?.name).toBe('kubernetes');
    expect((search.search as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toEqual(['kubernetes', 'cluster']);
  });

  it('keeps brand logos out of the icon search when the action is not about a brand', async () => {
    const model = scriptedModel([() => JSON.stringify({ ...plan, brand: null, iconKeywords: ['toggle', 'server'] })]);
    const search = icons([]);
    await new SuggestActionUseCase(model, binaries, search, logger).draft({ prompt: 'toggle staging', scope: 'pinned' });
    expect((search.search as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toMatchObject({ includeBrands: false });
  });

  it('never adds a probe or rules to a ticket action, even if the model proposes one', async () => {
    const model = scriptedModel([() => JSON.stringify({ ...plan, actionValue: 'cursor "{{workspace_path}}"' })]);
    const uc = new SuggestActionUseCase(model, binaries, icons([]), logger);
    const result = await uc.draft({ prompt: 'ouvrir dans cursor', scope: 'ticket' });
    expect(result.draft.status).toBeUndefined();
    expect(result.draft.conditionalActions).toBeUndefined();
  });

  it('warns in the notes when the drafted command is destructive', async () => {
    const model = scriptedModel([() => JSON.stringify({ ...plan, probe: null, rules: [], actionValue: 'docker system prune -af' })]);
    const result = await new SuggestActionUseCase(model, binaries, icons([]), logger).draft({ prompt: 'clean docker', scope: 'pinned' });
    expect(result.notes).toContain('Destructive');
  });

  it('also warns when only the probe is destructive — it would run by itself every interval', async () => {
    const model = scriptedModel([() => JSON.stringify({ ...plan, rules: [], actionValue: 'platool login prod', probe: 'kubectl --context prod delete pod -l app=x' })]);
    const result = await new SuggestActionUseCase(model, binaries, icons([]), logger).draft({ prompt: 'k8s prod', scope: 'pinned' });
    expect(result.notes).toContain('kubectl --context prod delete');
  });
});

describe('validation helpers', () => {
  it('extracts a fenced JSON object', () => {
    expect(parseJsonObject('here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('[1,2]')).toBeNull();
  });

  it('stops at the brace closing the object, not at braces in trailing prose', () => {
    const reply = '{"command":"cd \\"{{workspace_path}}\\" && git status","risk":"safe"}\nNote: this uses {{workspace_path}} as the cwd.';
    expect(parseJsonObject(reply)).toEqual({ command: 'cd "{{workspace_path}}" && git status', risk: 'safe' });
  });

  it('ignores braces inside JSON strings, including after escaped quotes', () => {
    expect(parseJsonObject('{"a":"} \\" {","b":{"c":1}} trailing }')).toEqual({ a: '} " {', b: { c: 1 } });
  });

  it('skips a non-JSON brace in prose before the object', () => {
    expect(parseJsonObject('Using {{ticket_id}}:\n```json\n{"a":1}\n```\n{x}')).toEqual({ a: 1 });
  });

  it('rejects a url plan without an http(s) url and drops rules without a valid status', () => {
    expect(validateDraftPlan({ label: 'x', actionType: 'url', actionValue: 'ftp://x' })).toBeNull();
    expect(validateDraftPlan({ label: 'x', actionType: 'shell', actionValue: 'true', rules: [{ label: 'a', when: ['green'], command: 'b' }] })!.rules).toEqual([]);
  });
});

describe('actions AI routes', () => {
  const build = async (available: boolean, suggestAction: Partial<SuggestActionUseCase>) => {
    const app = Fastify();
    await app.register(actionsAiRoutes({ suggestAction: suggestAction as SuggestActionUseCase, iconSearch: icons([GH_ICON]), isAvailable: async () => available, logger }));
    await app.ready();
    return app;
  };

  it('reports availability and refuses work when Claude is not connected', async () => {
    const app = await build(false, {});
    expect((await app.inject({ method: 'GET', url: '/api/actions-ai/status' })).json()).toEqual({ available: false });
    expect((await app.inject({ method: 'POST', url: '/api/actions-ai/command', payload: { intent: 'x' } })).statusCode).toBe(503);
    await app.close();
  });

  it('keeps the icon library and SVG import working without AI, and sanitises imports', async () => {
    const app = await build(false, {});
    const search = await app.inject({ method: 'GET', url: '/api/actions-ai/icons/search?q=github' });
    expect(search.json().suggestions[0].id).toBe('simple-icons:github');
    const clean = await app.inject({ method: 'POST', url: '/api/actions-ai/icons/sanitize', payload: { svg: '<svg viewBox="0 0 24 24" onload="x()"><script>1</script><path d="M1 1"/></svg>' } });
    expect(clean.json().svg).not.toMatch(/script|onload/);
    expect((await app.inject({ method: 'POST', url: '/api/actions-ai/icons/sanitize', payload: { svg: '<div/>' } })).statusCode).toBe(422);
    await app.close();
  });

  it('streams draft stages then the result as NDJSON', async () => {
    const app = await build(true, {
      draft: async ({ onStage }) => {
        onStage?.('intent');
        onStage?.('command');
        return { draft: { label: 'X', actionType: 'shell', actionValue: 'true' }, icon: null };
      },
    });
    const res = await app.inject({ method: 'POST', url: '/api/actions-ai/draft', payload: { prompt: 'x', scope: 'pinned' } });
    const lines = res.body.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([{ stage: 'intent' }, { stage: 'command' }, { draft: { label: 'X', actionType: 'shell', actionValue: 'true' }, icon: null }]);
    await app.close();
  });
});
