import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { db, importDemoData, resetDemoData } from '../store';
import { DemoDataSchema } from '../store/demoData';
import { DebriefView } from './Debrief';
import { ProgressView } from './Progress';
import { ReviewView } from './Review';
import { UnitView } from './Unit';
import {
  competencyTrend,
  conditionDifficulty,
  confusionMatrix,
  decisionTime,
  difficultyTrend,
  eloTrend,
  examComparison,
  noveltyTrend,
  pointsLost,
  ranking,
  reactionByCondition,
  stageTotals,
  threatTimeline,
  totalSeries,
  trustBreakdown,
  unitHeatmap,
} from './data';
import { feedback } from './feedback';
import { loadReviewIndex, loadSessionView, loadTraineeView, loadUnitData } from './load';
import { matchDashboardRoute, matchRoute } from './routes';
import { replayUrl, sessionUrl } from './ui';

describe('dashboard over the store', () => {
  beforeAll(async () => {
    await resetDemoData();
    const json = JSON.parse(readFileSync('data/demo/demo-data.json', 'utf8'));
    DemoDataSchema.parse(json);
    await importDemoData(json);
  }, 120_000);

  it('loads the review index with both units and all trainees', async () => {
    const index = await loadReviewIndex();
    expect(index.units.map((u) => u.unit.name)).toEqual(['Alpha', 'Bravo']);
    expect(index.units.flatMap((u) => u.trainees)).toHaveLength(8);
    for (const unit of index.units) {
      for (const row of unit.trainees) {
        expect(row.sessions).toBe(12);
        expect(row.latestSessionId).not.toBeNull();
      }
    }
    const html = renderToString(createElement(ReviewView, { index }));
    expect(html).toContain('Unit Alpha');
    expect(html).toContain('Latest debrief');
  });

  it('runs every helper over every trainee without throwing', async () => {
    const index = await loadReviewIndex();
    for (const { trainee } of index.units.flatMap((u) => u.trainees)) {
      const view = await loadTraineeView(trainee.id);
      expect(view).not.toBeNull();
      const { sessions, profile } = view!;
      expect(competencyTrend(sessions)).toHaveLength(11);
      expect(difficultyTrend(sessions).exam).toHaveLength(1);
      expect(noveltyTrend(sessions).trend).toHaveLength(11);
      expect(totalSeries(sessions).trend).toHaveLength(11);
      expect(eloTrend(profile, sessions)).toHaveLength(11);
      expect(confusionMatrix(sessions).total).toBeGreaterThan(0);
      expect(reactionByCondition(sessions)).toHaveLength(6);

      for (const session of sessions) {
        expect(stageTotals(session).length).toBeGreaterThan(0);
        expect(threatTimeline(session.spec, session.log).length).toBeGreaterThan(0);
        expect(trustBreakdown(session.log)).toBeDefined();
        for (const item of pointsLost(session)) {
          expect(Number.isFinite(decisionTime(item.decision, session.log))).toBe(true);
        }
        const lines = feedback(session.spec, session.log, session.report, session.extras);
        expect(lines.length).toBeGreaterThanOrEqual(1);
        expect(lines.length).toBeLessThanOrEqual(3);
      }
    }
  }, 120_000);

  it('runs the unit aggregates for both units', async () => {
    const index = await loadReviewIndex();
    for (const { unit } of index.units) {
      const data = await loadUnitData(unit.id);
      expect(data).not.toBeNull();
      expect(unitHeatmap(data!)).toHaveLength(4);
      expect(conditionDifficulty(data!).length).toBeGreaterThan(0);
      expect(examComparison(data!)[0]!.rows).toHaveLength(4);
      expect(ranking(data!)).toHaveLength(4);
    }
  });

  it('renders the debrief, progress and unit screens', async () => {
    const index = await loadReviewIndex();
    const firstUnit = index.units[0]!;
    const trainee = firstUnit.trainees[0]!;

    const sessionView = await loadSessionView(trainee.latestSessionId!);
    const debrief = renderToString(
      createElement(DebriefView, {
        session: sessionView!.session,
        traineeName: trainee.trainee.name,
      }),
    );
    expect(debrief).toContain('What to work on');
    expect(debrief).toContain('Per-threat timeline');
    expect(debrief).toContain('Why you lost points');
    expect(debrief).toContain('Trust in the AI assistant');

    const traineeView = await loadTraineeView(trainee.trainee.id);
    const progress = renderToString(
      createElement(ProgressView, {
        trainee: traineeView!.trainee,
        unit: traineeView!.unit,
        sessions: traineeView!.sessions,
        profile: traineeView!.profile,
      }),
    );
    expect(progress).toContain('Competency trend');
    expect(progress).toContain('Weakest by Elo rating');
    expect(progress).toContain('Classification confusion');

    const unit = renderToString(
      createElement(UnitView, { data: (await loadUnitData(firstUnit.unit.id))! }),
    );
    expect(unit).toContain('Competency heatmap');
    expect(unit).toContain('Common exam comparison');
    expect(unit).toContain('Ranking');
  });

  it('shows a critical-fail badge naming the cause and the cap', async () => {
    const rows = await db.sessions.toArray();
    const capped = rows.find((row) => row.report.critical.length > 0)!;
    const html = renderToString(createElement(DebriefView, { session: capped, traineeName: 'x' }));
    expect(html).toContain('Critical fail');
    expect(html).toContain(capped.report.critical[0]!.label);
  });

  it('returns null for unknown ids', async () => {
    expect(await loadSessionView('nope')).toBeNull();
    expect(await loadTraineeView('nope')).toBeNull();
    expect(await loadUnitData('nope')).toBeNull();
  });

  it('round-trips session ids that contain colons through the route', async () => {
    const rows = await db.sessions.limit(5).toArray();
    for (const row of rows) {
      const path = sessionUrl('debrief', row.id);
      expect(path).not.toContain(':');
      const match = matchDashboardRoute(path);
      expect(match).not.toBeNull();
      expect(match!.params.sessionId).toBe(row.id);
      expect((await loadSessionView(match!.params.sessionId!))!.session.id).toBe(row.id);
    }
  });
});

describe('routing', () => {
  it('matches the four dashboard routes and rejects others', () => {
    expect(matchDashboardRoute('/review')!.route.pattern).toBe('/review');
    expect(matchDashboardRoute('/debrief/a')!.route.pattern).toBe('/debrief/:sessionId');
    expect(matchDashboardRoute('/progress/t1')!.params.traineeId).toBe('t1');
    expect(matchDashboardRoute('/unit/u1')!.params.unitId).toBe('u1');
    expect(matchDashboardRoute('/play/1')).toBeNull();
    expect(matchDashboardRoute('/debrief')).toBeNull();
    expect(matchDashboardRoute('/')).toBeNull();
  });

  it('decodes encoded segments and survives malformed ones', () => {
    expect(matchRoute('/debrief/:sessionId', '/debrief/scn-1%3Aana%3A2')!.sessionId).toBe(
      'scn-1:ana:2',
    );
    expect(matchRoute('/debrief/:sessionId', '/debrief/100%')!.sessionId).toBe('100%');
  });

  it('builds replay links at the requested timestamp', () => {
    expect(replayUrl('scn-1:ana:2', 12.34)).toBe('/replay/scn-1%3Aana%3A2?t=12.3');
    expect(replayUrl('x', -5)).toBe('/replay/x?t=0.0');
  });
});
