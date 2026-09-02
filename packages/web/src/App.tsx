import { BrowserRouter } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { CreateTaskModal } from './components/modals/CreateTaskModal';
import { CommandPalette } from './components/command-palette/CommandPalette';
import { AskMemoryModal } from './components/modals/AskMemoryModal';
import { ToastContainer } from './components/ui/ToastContainer';
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
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <RouterSync />
      <AppLayout />
      <CreateTaskModal />
      <CommandPalette />
      <AskMemoryModal />
      <ToastContainer />
      <NotificationToasts />
      <VersionBanner />
    </BrowserRouter>
  );
}
