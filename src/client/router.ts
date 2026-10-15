import { useMemo, useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'play'; examId: string }
  | { name: 'replay'; sessionId: string; t: number }
  | { name: 'notFound' };

const NAVIGATE_EVENT = 'dronacharya:navigate';

export function parseRoute(pathname: string, search: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (parts.length === 0) return { name: 'home' };

  if (parts[0] === 'play' && parts.length === 2) {
    return { name: 'play', examId: parts[1]! };
  }

  if (parts[0] === 'replay' && parts.length === 2) {
    const raw = Number(new URLSearchParams(search).get('t'));
    return { name: 'replay', sessionId: parts[1]!, t: Number.isFinite(raw) && raw > 0 ? raw : 0 };
  }

  return { name: 'notFound' };
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
}

function currentLocation(): string {
  return window.location.pathname + window.location.search;
}

export function useRoute(): Route {
  const location = useSyncExternalStore(subscribe, currentLocation);
  return useMemo(() => {
    const [pathname = '/', search = ''] = location.split('?');
    return parseRoute(pathname, search ? `?${search}` : '');
  }, [location]);
}

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function setQueryTime(seconds: number): void {
  const url = new URL(window.location.href);
  url.searchParams.set('t', seconds.toFixed(2));
  window.history.replaceState(null, '', url);
}
