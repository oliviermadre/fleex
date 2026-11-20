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

  it('switches the decor of the skin in use, on by default for the pixel skins and off for the others, and keeps it skin by skin', () => {
    const save = vi.fn(async () => {});
    useFactoryStore.setState({ enabled: true });
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, factorySkin: 'fleex', factoryDecor: undefined }, saveSettings: save }));
    const { unmount } = render(<FactorySkinPicker />);
    const sw = () => screen.getByRole('switch', { name: /Decor for/ });
    expect(sw().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw());
    expect(save).toHaveBeenCalledWith({ factoryDecor: { fleex: true } });
    unmount();
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, factorySkin: 'pixel', factoryDecor: { fleex: true } } }));
    render(<FactorySkinPicker />);
    expect(sw().getAttribute('aria-checked')).toBe('true');
    fireEvent.click(sw());
    expect(save).toHaveBeenLastCalledWith({ factoryDecor: { fleex: true, pixel: false } });
  });
});
