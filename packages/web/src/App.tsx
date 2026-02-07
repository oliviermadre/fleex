import { AppLayout } from './components/layout/AppLayout';
import { CreateSessionModal } from './components/modals/CreateSessionModal';
import { SettingsModal } from './components/settings/SettingsModal';

export function App() {
  return (
    <>
      <AppLayout />
      <CreateSessionModal />
      <SettingsModal />
    </>
  );
}
