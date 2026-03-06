import { BrowserRouter } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { CreateSessionModal } from './components/modals/CreateSessionModal';
import { CommandPalette } from './components/command-palette/CommandPalette';
import { ToastContainer } from './components/ui/ToastContainer';
import { RouterSync } from './router/RouterSync';
import { useFaviconStatus } from './hooks/useFaviconStatus';
import { useTheme } from './hooks/useTheme';

export function App() {
  useFaviconStatus();
  useTheme();

  return (
    <BrowserRouter>
      <RouterSync />
      <AppLayout />
      <CreateSessionModal />
      <CommandPalette />
      <ToastContainer />
    </BrowserRouter>
  );
}
