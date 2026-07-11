import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, errorInfo: null, copied: false };

  copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('Uncaught render error:', error, errorInfo);
  }

  componentWillUnmount() {
    if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
  }

  buildReport = (): string => {
    const { error, errorInfo } = this.state;
    return [
      'Koinkat error report',
      '====================',
      `Version:   ${__APP_VERSION__}`,
      `Platform:  ${navigator.platform}`,
      `UserAgent: ${navigator.userAgent}`,
      `Route:     ${window.location.pathname}`,
      `Time:      ${new Date().toISOString()}`,
      '',
      `Error:     ${error?.message ?? '(unknown)'}`,
      '',
      'Stack:',
      error?.stack ?? '(no stack)',
      '',
      'Component stack:',
      errorInfo?.componentStack ?? '(no component stack)',
    ].join('\n');
  };

  handleCopyDetails = async () => {
    try {
      await navigator.clipboard.writeText(this.buildReport());
      this.setState({ copied: true });
      if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
      this.copyResetTimer = setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (err) {
      console.error('Clipboard write failed:', err);
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ backgroundColor: 'var(--app-bg)' }}
      >
        <Card className="max-w-2xl w-full">
          <div className="flex flex-col gap-4">
            <h1
              style={{
                color: 'var(--text)',
                fontSize: 'var(--fs-h2)',
                fontWeight: 'var(--fw-semibold)',
              }}
            >
              Something went wrong.
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-body)' }}>
              Koinkat hit an unexpected error. Your data is safe - it lives on
              your device, not in this crashed window.
            </p>

            <details>
              <summary
                className="cursor-pointer text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                Technical details
              </summary>
              <pre
                data-privacy-field
                className="mt-2 p-3 text-xs whitespace-pre-wrap overflow-auto"
                style={{
                  backgroundColor: 'var(--input-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-1)',
                  maxHeight: '24rem',
                  color: 'var(--text)',
                }}
              >
                {this.buildReport()}
              </pre>
            </details>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="primary" onClick={this.handleCopyDetails}>
                {copied ? 'Copied!' : 'Copy error details'}
              </Button>
              <Button variant="secondary" onClick={this.handleReload}>
                Reload app
              </Button>
            </div>

            <a
              href="https://github.com/MarcoSburlino/Koinkat/issues/new"
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
              style={{ color: 'var(--primary)' }}
            >
              Report this issue on GitHub
            </a>
          </div>
        </Card>
      </div>
    );
  }
}
