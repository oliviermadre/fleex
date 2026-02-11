import { AppLayout } from './components/layout/AppLayout';
import { CreateSessionModal } from './components/modals/CreateSessionModal';
import { CommandPalette } from './components/command-palette/CommandPalette';
import { useFaviconStatus } from './hooks/useFaviconStatus';
import { useTheme } from './hooks/useTheme';

export function App() {
  useFaviconStatus();
  useTheme();

  return (
    <>
      <AppLayout />
      <CreateSessionModal />
      <CommandPalette />
    </>
  );
}
