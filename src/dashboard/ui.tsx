import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { navigate } from '../client/router';
import type { Outcome, ThreatClass } from '../schema';
import { ensureDemoSeeded, isDemoId, reimportDemo } from './demo';

export const COMPETENCY_LABEL: Record<string, string> = {
  detect: 'Detect',
  classify: 'Classify',
  prioritise: 'Prioritise',
  engage: 'Engage',
  roe: 'ROE',
  trust: 'Trust',
};

export const COMPETENCY_COLOR: Record<string, string> = {
  detect: '#5aa9ff',
  classify: '#b48cff',
  prioritise: '#ffc857',
  engage: '#ff7a59',
  roe: '#3ddc97',
  trust: '#4dd0e1',
};

export const STAGE_LABEL: Record<string, string> = {
  detection: 'Detection',
  classification: 'Classification',
  assessment: 'Assessment',
  engagement: 'Engagement',
  outcome: 'Outcome',
};

export const CLASS_LABEL: Record<ThreatClass | 'unclassified', string> = {
  quad: 'Quadcopter',
  fpv: 'FPV drone',
  fixedwing: 'Fixed-wing',
  loiter: 'Loitering',
  bird: 'Bird',
  friendly: 'Friendly',
  civilian: 'Civilian',
  unclassified: 'Unclassified',
};

export const OUTCOME_COLOR: Record<Outcome, string> = {
  neutralised: '#3ddc97',
  leak: '#ff5d6c',
  fratricide: '#d6336c',
  wasted: '#ffc857',
  ignored: '#8896b3',
};

export function fixed(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function heatColor(value: number): string {
  const clamped = Math.max(0, Math.min(100, value));
  const hue = (clamped / 100) * 130;
  return `hsl(${hue.toFixed(0)} 62% 34%)`;
}

export function sessionUrl(kind: 'debrief' | 'progress' | 'unit', id: string): string {
  return `/${kind}/${encodeURIComponent(id)}`;
}

export function replayUrl(sessionId: string, seconds: number): string {
  return `/replay/${encodeURIComponent(sessionId)}?t=${Math.max(0, seconds).toFixed(1)}`;
}

export function Link({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} className={className}>
      {children}
    </a>
  );
}

export interface LoadState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]): LoadState<T> {
  const [state, setState] = useState<{
    data: T | undefined;
    error: string | null;
    loading: boolean;
  }>({ data: undefined, error: null, loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true }));
    loader()
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            data: undefined,
            error: error instanceof Error ? error.message : 'Could not load data',
            loading: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, reload };
}

export function DemoBanner({ ids, onReset }: { ids: string[]; onReset: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!ids.some(isDemoId)) return null;

  const reset = () => {
    setBusy(true);
    reimportDemo()
      .then(onReset)
      .finally(() => setBusy(false));
  };

  return (
    <div className="dash-banner no-print" role="status">
      <span>Demo data (synthetic trainees)</span>
      <button type="button" onClick={reset} disabled={busy}>
        {busy ? 'Resetting...' : 'Reset demo data'}
      </button>
    </div>
  );
}

export function Shell({
  title,
  subtitle,
  children,
  banner,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  banner?: ReactNode;
}) {
  useEffect(() => {
    void ensureDemoSeeded();
  }, []);

  return (
    <div className="dash">
      <nav className="dash-nav no-print">
        <Link to="/review" className="dash-brand">
          DronAcharya · After-action review
        </Link>
        <span className="dash-nav-links">
          <Link to="/review">Review</Link>
          <Link to="/">Home</Link>
        </span>
      </nav>
      {banner}
      <main className="dash-main">
        <header className="dash-title">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </header>
        {children}
      </main>
    </div>
  );
}

export function Message({ children }: { children: ReactNode }) {
  return <p className="dash-message">{children}</p>;
}

export function Card({
  title,
  children,
  wide,
}: {
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={wide ? 'dash-card dash-wide' : 'dash-card'}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
