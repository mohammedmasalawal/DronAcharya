import type { ComponentType } from 'react';
import { Debrief } from './Debrief';
import { Progress } from './Progress';
import { Review } from './Review';
import { Unit } from './Unit';

export interface DashboardPageProps {
  params: Record<string, string>;
}

export interface DashboardRoute {
  pattern: string;
  component: ComponentType<DashboardPageProps>;
}

export const dashboardRoutes: DashboardRoute[] = [
  { pattern: '/review', component: Review },
  { pattern: '/debrief/:sessionId', component: Debrief },
  { pattern: '/progress/:traineeId', component: Progress },
  { pattern: '/unit/:unitId', component: Unit },
];

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function matchRoute(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split('/').filter(Boolean);
  const have = pathname.split('/').filter(Boolean);
  if (want.length !== have.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const expected = want[i]!;
    const actual = have[i]!;
    if (expected.startsWith(':')) params[expected.slice(1)] = decode(actual);
    else if (expected !== actual) return null;
  }
  return params;
}

export function matchDashboardRoute(
  pathname: string,
): { route: DashboardRoute; params: Record<string, string> } | null {
  for (const route of dashboardRoutes) {
    const params = matchRoute(route.pattern, pathname);
    if (params) return { route, params };
  }
  return null;
}
