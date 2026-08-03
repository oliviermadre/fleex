import { BrowserRouter } from 'react-router-dom';

import { CommandPalette } from './components/command-palette/CommandPalette';
import { ErrorBoundary } from './components/errors/ErrorBoundary';
import { AppLayout } from './components/layout/AppLayout';
import { CreateTaskModal } from './components/modals/CreateTaskModal';
import { NotificationToasts } from './components/notifications/NotificationToasts';
import { ToastContainer } from './components/ui/ToastContainer';
import { VersionBanner } from './components/ui/VersionBanner';
import { useTerminalFont } from './hooks/useTerminalFont';
import { useTheme } from './hooks/useTheme';
import { MobileApp } from './mobile/MobileApp';
import { useMobileMode } from './mobile/useMobileMode';
import { RouterSync } from './router/RouterSync';

export function App() {
  useTheme();
  useTerminalFont();
  const isMobile = useMobileMode();

  if (isMobile) {
    return (
      <BrowserRouter>
        {/* Kept outside ToastContainer so toasts still render if the app crashes. */}
        <ErrorBoundary name="mobile-app">
          <MobileApp />
        </ErrorBoundary>
        <ToastContainer />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <RouterSync />
      <AppLayout />
      <CreateTaskModal />
      <CommandPalette />
      <ToastContainer />
      <NotificationToasts />
      <VersionBanner />
    </BrowserRouter>
  );
}
