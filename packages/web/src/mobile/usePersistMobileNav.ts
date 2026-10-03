import { useEffect, useState } from 'react';
import { useTicketStore } from '../stores/ticketStore';
import { restoreMobileNav, saveMobileNav, useMobileNavStore } from './mobileNavStore';

/**
 * Restore the last screen on boot, then keep it saved. Saving on every nav
 * change (not only on `pagehide`) because iOS can kill a suspended web app
 * without firing anything.
 */
export function usePersistMobileNav(): void {
  // Restore synchronously on the first render, before any screen mounts.
  useState(() => restoreMobileNav());
  useEffect(() => {
    const unsubNav = useMobileNavStore.subscribe(() => saveMobileNav());
    const unsubTicket = useTicketStore.subscribe((s, prev) => {
      if (s.selectedTicketId !== prev.selectedTicketId) saveMobileNav();
    });
    const onHide = () => saveMobileNav();
    window.addEventListener('pagehide', onHide);
    return () => {
      unsubNav();
      unsubTicket();
      window.removeEventListener('pagehide', onHide);
    };
  }, []);
}

/**
 * Dev server only: the Vite client reloads the page when its HMR socket comes
 * back after the phone slept ("server connection lost. Polling for restart…").
 * It skips that reload once it believes the page is unloading, so tell it so
 * when the app goes to the background. The phone then stops receiving HMR
 * updates — Settings › « Recharger l’app » picks up new code.
 */
export function useNoDevReloadOnWake(): void {
  useEffect(() => {
    // Typed loosely: the project has no vite/client ambient types.
    if (!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') window.dispatchEvent(new Event('beforeunload'));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}
