import { BrowserRouter } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { CreateTaskModal } from './components/modals/CreateTaskModal';
import { CommandPalette } from './components/command-palette/CommandPalette';
import { AskMemoryModal } from './components/modals/AskMemoryModal';
import { Toaster } from './components/ui/toast/Toaster';
import { VersionBanner } from './components/ui/VersionBanner';
import { RouterSync } from './router/RouterSync';
import { useTheme } from './hooks/useTheme';
import { useTerminalFont } from './hooks/useTerminalFont';
import { useMobileMode } from './mobile/useMobileMode';
import { MobileApp } from './mobile/MobileApp';
import { DEMO_MODE, DEMO_MODE_CSS } from './lib/demoMode';

/** `?demo=1` (screenshots): no banner, no toasts, no animation. */
const demoStyle = DEMO_MODE ? <style>{DEMO_MODE_CSS}</style> : null;

export function App() {
  useTheme();
  useTerminalFont();
  const isMobile = useMobileMode();

  if (isMobile) {
    return (
      <BrowserRouter>
        {demoStyle}
        <MobileApp />
        {!DEMO_MODE && <Toaster linksEnabled={false} />}
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      {demoStyle}
      <RouterSync />
      <AppLayout />
      <CreateTaskModal />
      <CommandPalette />
      <AskMemoryModal />
      {!DEMO_MODE && <VersionBanner />}
      {!DEMO_MODE && <Toaster />}
    </BrowserRouter>
  );
}
