import React from 'react';
import i18n from '@/i18n';
import { Button } from '@/components/ui/button';
import { BRAND_ACCENT } from '@/components/checklist/checklistPdf';

/** Error boundary so checklist render errors show a message instead of a blank screen. */
export class ChecklistErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ChecklistPage error:", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-muted">
          <h1 className="text-xl font-semibold text-foreground">{i18n.t("checklist:errorBoundary.somethingWentWrong")}</h1>
          <p className="text-sm text-muted-foreground text-center max-w-md">{this.state.error.message}</p>
          <Button
            variant="outline"
            onClick={() => this.setState({ error: null })}
            style={{ borderColor: BRAND_ACCENT, color: BRAND_ACCENT }}
          >
            {i18n.t("common:actions.tryAgain")}
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
