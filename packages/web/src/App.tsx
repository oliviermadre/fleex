import { BrowserRouter } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { CreateTaskModal } from './components/modals/CreateTaskModal';
import { CommandPalette } from './components/command-palette/CommandPalette';
import { AskMemoryModal } from './components/modals/AskMemoryModal';
import { Toaster } from './components/ui/toast/Toaster';
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
        <Toaster linksEnabled={false} />
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
      <NotificationToasts />
      <VersionBanner />
      <Toaster />
    </BrowserRouter>
  );
}
