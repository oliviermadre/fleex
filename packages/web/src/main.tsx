import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { ErrorBoundary } from './components/errors/ErrorBoundary';
import { installGlobalErrorHandlers, reportClientError } from './services/errorReporter';
import './index.css';

// Catches what error boundaries structurally cannot: event handlers, async
// callbacks, and unhandled promise rejections.
installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById('root')!, {
  // Fires for errors NO boundary caught. With the root boundary below this
  // should stay empty — if it ever logs, a boundary is missing somewhere.
  onUncaughtError: (error, errorInfo) => {
    reportClientError({
      error,
      source: 'react.uncaught',
      componentStack: errorInfo.componentStack ?? undefined,
    });
  },
}).render(
  <React.StrictMode>
    <ErrorBoundary name="root" variant="root">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// PWA installability (Add to Home Screen). Requires a secure context — met on
// localhost or behind `tailscale serve` (HTTPS). See docs/mobile.md.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
