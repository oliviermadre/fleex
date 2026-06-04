import { BrowserRouter } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { CreateTaskModal } from './components/modals/CreateTaskModal';
import { CommandPalette } from './components/command-palette/CommandPalette';
import { ToastContainer } from './components/ui/ToastContainer';
import { NotificationToasts } from './components/notifications/NotificationToasts';
import { VersionBanner } from './components/ui/VersionBanner';
import { RouterSync } from './router/RouterSync';
import { useFaviconStatus } from './hooks/useFaviconStatus';
import { useTheme } from './hooks/useTheme';
import { useTerminalFont } from './hooks/useTerminalFont';

export function App() {
  useFaviconStatus();
  useTheme();
  useTerminalFont();

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
