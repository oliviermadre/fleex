import { AppLayout } from './components/layout/AppLayout';
import { CreateSessionModal } from './components/modals/CreateSessionModal';
import { useFaviconStatus } from './hooks/useFaviconStatus';

export function App() {
  useFaviconStatus();

  return (
    <>
      <AppLayout />
      <CreateSessionModal />
    </>
  );
}
