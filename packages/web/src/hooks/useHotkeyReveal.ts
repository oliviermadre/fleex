import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';

export function useHotkeyReveal() {
  const setAltHeld = useUIStore((s) => s.setAltHeld);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Alt') setAltHeld(true);
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (e.key === 'Alt') setAltHeld(false);
    }

    function handleBlur() {
      setAltHeld(false);
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [setAltHeld]);
}
