import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { ErrorFallback, type ErrorFallbackVariant } from './ErrorFallback';
import { generateErrorId, reportClientError } from '../../services/errorReporter';

interface ErrorBoundaryProps {
  /** Identifies the boundary in crash reports: `root`, `main-view`, … */
  name: string;
  variant?: ErrorFallbackVariant;
  /** Identity of the view being rendered, attached to the report for triage. */
  viewKey?: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  errorId: string | null;
  /** Bumped by "Reload this view" — changing the child key forces a remount. */
  resetKey: number;
}

/**
 * Contains a render crash to one region of the UI instead of unmounting the
 * whole tree (React's default, which leaves a blank page).
 *
 * **What this does NOT catch** — these are structural React limits, not
 * oversights. They are covered by `installGlobalErrorHandlers()` instead:
 *   - errors thrown in event handlers (`onClick`, …)
 *   - errors in async code (`setTimeout`, `.then`, `await`)
 *   - errors during server-side rendering
 *   - errors thrown by this boundary's own fallback
 *
 * Resetting after navigation is deliberately NOT handled here: a boundary that
 * has caught stays caught, so navigating from a crashed ticket to a healthy one
 * would keep showing the crash screen. The caller passes a `key` that changes
 * with the view identity (see `useMainViewKey`), which makes React remount this
 * component — and discard the error state — on every navigation.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
    componentStack: null,
    errorId: null,
    resetKey: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Generated here rather than inside the reporter so the id shown on screen
    // is the same one sent to the server even when the report is deduped away.
    const errorId = generateErrorId();
    this.setState({ componentStack: info.componentStack ?? null, errorId });

    reportClientError({
      error,
      errorId,
      source: 'boundary',
      boundary: this.props.name,
      viewKey: this.props.viewKey,
      componentStack: info.componentStack ?? undefined,
    });
  }

  private handleReset = (): void => {
    this.setState((prev) => ({
      error: null,
      componentStack: null,
      errorId: null,
      resetKey: prev.resetKey + 1,
    }));
  };

  render(): ReactNode {
    const { error, componentStack, errorId, resetKey } = this.state;

    if (error) {
      return (
        <ErrorFallback
          error={error}
          componentStack={componentStack}
          errorId={errorId}
          variant={this.props.variant ?? 'view'}
          onReset={this.handleReset}
        />
      );
    }

    // Keyed so a reset genuinely remounts the children: without this, a child
    // holding bad state in a ref or a module-level cache would re-throw
    // immediately and "Reload this view" would look broken.
    return <Fragment key={resetKey}>{this.props.children}</Fragment>;
  }
}
