import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import type { AgentPersona } from '@fleex/shared';
import { SettingsPanel } from './SettingsPanel';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';

vi.mock('../../services/api', async (orig) => ({
  ...(await orig<typeof import('../../services/api')>()),
  fetchModels: vi.fn(async () => ({ models: [], fallback: true })),
}));

const persona = (id: string, displayName: string, model: string) => ({ id, name: id, displayName, model }) as unknown as AgentPersona;

afterEach(cleanup);

describe('Settings › General › default assistant', () => {
  const open = (defaultAssistantPersonaId?: string) => {
    useAgentPersonaStore.setState({ personas: [persona('p-nas', 'Nas', 'claude-opus-5-5'), persona('p-builder', 'The Builder', 'claude-sonnet-5-5')] });
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, defaultAssistantPersonaId } });
    useUIStore.setState({ activePanel: 'settings', settingsTab: 'general' });
    render(<SettingsPanel />);
  };

  it("shows the assistant's model next to the picker: the model of the chosen persona", () => {
    open('p-nas');
    expect(screen.getByTestId('assistant-model').textContent).toContain('opus-5-5');
  });

  it('follows the picker, before saving', () => {
    open('p-nas');
    fireEvent.change(screen.getByLabelText('Default assistant'), { target: { value: 'p-builder' } });
    expect(screen.getByTestId('assistant-model').textContent).toContain('sonnet-5-5');
  });

  it('shows no model when no assistant is chosen', () => {
    open(undefined);
    expect(screen.queryByTestId('assistant-model')).toBeNull();
  });
});
