import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FactorySkinPicker } from './FactorySkinPicker';
import { useFactoryStore } from './factoryStore';
import { useSettingsStore } from '../stores/settingsStore';

afterEach(() => { cleanup(); useFactoryStore.setState({ enabled: false }); });

describe('choosing the skin of the Factory', () => {
  it('is not offered while the Factory is off', () => {
    useFactoryStore.setState({ enabled: false });
    render(<FactorySkinPicker />);
    expect(screen.queryByRole('group', { name: 'Factory skin' })).toBeNull();
  });

  it('shows one card a skin, the one in use pressed, and saves the one clicked', () => {
    const save = vi.fn(async () => {});
    useFactoryStore.setState({ enabled: true });
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, factorySkin: undefined }, saveSettings: save }));
    render(<FactorySkinPicker />);
    expect(screen.getByRole('button', { name: /Fleex/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Neon/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /Neon/ }));
    expect(save).toHaveBeenCalledWith({ factorySkin: 'neon' });
  });
});
