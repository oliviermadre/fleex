import { lazy, Suspense } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { ErrorBoundary } from './components/errors/ErrorBoundary';
import { ToastContainer } from './components/ui/ToastContainer';
import { useTerminalFont } from './hooks/useTerminalFont';
import { useTheme } from './hooks/useTheme';
import { useMobileMode } from './mobile/useMobileMode';

// One shell per platform, so a phone never downloads the desktop tree and vice
// versa. useTheme/useTerminalFont still run before the branch — since they now
// write to terminalAppearance instead of terminalManager, that costs nothing.
const DesktopShell = lazy(() =>
  import('./components/layout/DesktopShell').then((m) => ({ default: m.DesktopShell })),
);
const MobileApp = lazy(() => import('./mobile/MobileApp').then((m) => ({ default: m.MobileApp })));

export function App() {
  useTheme();
  useTerminalFont();
  const isMobile = useMobileMode();

  return (
    <BrowserRouter>
      {/* Kept outside ToastContainer so toasts still render if the app crashes. */}
      <ErrorBoundary name={isMobile ? 'mobile-app' : 'desktop-shell'}>
        {/* Bare surface, not a spinner: this is almost always a cache hit and a
            flash of loading UI would be the only thing anyone ever noticed. */}
        <Suspense fallback={<div className="h-dvh w-full bg-[var(--theme-bg-base)]" />}>
          {isMobile ? <MobileApp /> : <DesktopShell />}
        </Suspense>
      </ErrorBoundary>
      <ToastContainer />
    </BrowserRouter>
  );
}
