/**
 * The model written under a station must be the one the run will really use: a station's own choice beats its
 * persona's, a panel is its orchestrator, and what calls no model says nothing rather than something wrong.
 */
import { describe, it, expect } from 'vitest';
import { modelTag, stationModel, type ModelSources } from './stationModel';

const src: ModelSources = {
  personas: [{ id: 'p-builder', name: 'builder', model: 'claude-sonnet-4-6' }, { id: 'p-bare', name: 'bare' }],
  skills: [{ commandName: 'review', personaId: 'p-builder' }, { commandName: 'loose', personaId: 'p-bare' }],
  panels: [{ name: 'review', orchestratorModel: 'claude-opus-4-8' }],
};

describe('the model of a station', () => {
  it('an agent station with no model of its own runs on its persona\'s, never "inherit"', () => {
    expect(stationModel({ exec: 'agent', ref: 'builder' }, src)).toBe('claude-sonnet-4-6');
    expect(stationModel({ exec: 'agent', ref: 'builder', model: '' }, src)).toBe('claude-sonnet-4-6');
  });
  it('a model chosen on the station overrides the persona\'s, as the server runs it', () => {
    expect(stationModel({ exec: 'agent', ref: 'builder', model: 'claude-haiku-4-5' }, src)).toBe('claude-haiku-4-5');
    expect(stationModel({ exec: 'agent', ref: 'nobody', model: 'claude-haiku-4-5' }, src)).toBe('claude-haiku-4-5');
  });
  it('a skill station runs on the model of the persona the skill belongs to, unless it chooses its own', () => {
    expect(stationModel({ exec: 'skill', ref: 'review' }, src)).toBe('claude-sonnet-4-6');
    expect(stationModel({ exec: 'skill', ref: 'review', model: 'claude-haiku-4-5' }, src)).toBe('claude-haiku-4-5');
    expect(stationModel({ exec: 'skill', ref: 'loose' }, src)).toBeNull();
    expect(stationModel({ exec: 'skill', ref: 'gone' }, src)).toBeNull();
  });
  it('a panel runs on its orchestrator', () => {
    expect(stationModel({ exec: 'panel', ref: 'review' }, src)).toBe('claude-opus-4-8');
  });
  it('says nothing when it cannot know: no persona or panel chosen, unknown, or without a model', () => {
    expect(stationModel({ exec: 'agent', ref: '' }, src)).toBeNull();
    expect(stationModel({ exec: 'agent', ref: 'bare' }, src)).toBeNull();
    expect(stationModel({ exec: 'panel', ref: 'gone' }, src)).toBeNull();
  });
  it('what calls no model gets no model', () => {
    for (const exec of ['script', 'human_gate', 'native'] as const) expect(stationModel({ exec, ref: 'builder', model: 'claude-haiku-4-5' }, src)).toBeNull();
  });
  it('reads without the claude- prefix', () => {
    expect(modelTag('claude-opus-4-8')).toBe('opus-4-8');
    expect(modelTag('gpt-5')).toBe('gpt-5');
  });
});
