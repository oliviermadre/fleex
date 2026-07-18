import { BrowserRouter } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { CreateTaskModal } from './components/modals/CreateTaskModal';
import { CommandPalette } from './components/command-palette/CommandPalette';
import { ToastContainer } from './components/ui/ToastContainer';
import { ConfirmModalHost } from './components/ui/ConfirmModalHost';
import { NotificationToasts } from './components/notifications/NotificationToasts';
import { VersionBanner } from './components/ui/VersionBanner';
import { RouterSync } from './router/RouterSync';
import { useTheme } from './hooks/useTheme';
import { useTerminalFont } from './hooks/useTerminalFont';
import { useMobileMode } from './mobile/useMobileMode';
import { MobileApp } from './mobile/MobileApp';

export function App() {
  useTheme();
  useTerminalFont();
  const isMobile = useMobileMode();

  if (isMobile) {
    return (
      <BrowserRouter>
        <MobileApp />
        <ToastContainer />
        <ConfirmModalHost />
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
      <ConfirmModalHost />
    </BrowserRouter>
  );
}
