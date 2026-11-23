import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  scopeLabel: string;
  children: React.ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected rendering error occurred.',
    };
  }

  public componentDidCatch(error: Error): void {
    console.error(`[ErrorBoundary:${this.props.scopeLabel}]`, error);
  }

  private handleRecover = () => {
    this.setState({ hasError: false, message: '' });
    this.props.onReset?.();
  };

  public render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-[260px] flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-[#101520] border border-rose-400/30 rounded-xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <h2 className="text-base font-semibold text-white">
                {this.props.scopeLabel} encountered an error
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Your script and cast settings remain safe. Recover this view or reload the studio.
              </p>
            </div>
          </div>

          <div className="px-3 py-2 rounded-lg bg-[#090C12] border border-white/[0.08] text-xs font-mono text-rose-300 break-words">
            {this.state.message}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={this.handleRecover}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Recover View
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-xs font-medium text-slate-200 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Reload Studio
            </button>
          </div>
        </div>
      </div>
    );
  }
}
