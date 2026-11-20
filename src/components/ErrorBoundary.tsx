import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '@/i18n';
import { Button } from '@/components/ui/button';
import { isChunkLoadError, shouldReloadForChunkError } from '@/lib/chunkRecovery';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Short label used in the console log prefix (e.g. "rankings"). */
  label?: string;
  /** Custom fallback UI. When provided, replaces the default fallback entirely. */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Reusable render error boundary. Catches a throw from its subtree, logs it, and shows a
 * graceful fallback (with the raw message in dev) instead of unmounting the whole app.
 * Modeled on the inline boundary in ChecklistPage.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, errorInfo);
  }

  private reset = () => {
    const { error } = this.state;
    if (error && isChunkLoadError(error)) {
      // React.lazy caches a rejected import promise. Clearing boundary state
      // would immediately throw the same promise again; a reload is the only
      // meaningful retry and refreshes the hashed module graph.
      shouldReloadForChunkError(error);
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 p-6 text-center">
        <h3 className="text-lg font-semibold text-foreground">{i18n.t('misc:error.sectionTitle')}</h3>
        <p className="max-w-xs text-sm text-muted-foreground">
          {i18n.t('misc:error.sectionBody')}
        </p>
        {import.meta.env.DEV && (
          <pre className="max-h-48 max-w-full overflow-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-left text-[11px] leading-snug text-destructive">
            {error.message}
            {error.stack ? '\n\n' + error.stack.split('\n').slice(1, 5).join('\n') : ''}
          </pre>
        )}
        <Button
          variant="outline"
          onClick={this.reset}
          className="border-malachite-600 text-malachite-600 hover:bg-malachite-50 dark:hover:bg-muted dark:text-malachite-300"
        >
          {i18n.t('common:actions.tryAgain')}
        </Button>
      </div>
    );
  }
}
