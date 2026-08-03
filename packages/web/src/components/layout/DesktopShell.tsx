import { RouterSync } from '../../router/RouterSync';
import { CommandPalette } from '../command-palette/CommandPalette';
import { CreateTaskModal } from '../modals/CreateTaskModal';
import { NotificationToasts } from '../notifications/NotificationToasts';
import { VersionBanner } from '../ui/VersionBanner';

import { AppLayout } from './AppLayout';

/**
 * The desktop app tree, extracted so App can lazy-load it opposite MobileApp.
 * Previously App imported both shells statically and every client paid for the
 * other platform's code.
 */
export function DesktopShell() {
  return (
    <>
      <RouterSync />
      <AppLayout />
      <CreateTaskModal />
      <CommandPalette />
      <NotificationToasts />
      <VersionBanner />
    </>
  );
}
