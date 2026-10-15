import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { DemoDataSchema, type DemoData } from '../store/demoData';
import type { SessionRecord } from '../store/records';
import {
  COMPETENCY_KEYS,
  CONDITION_GROUPS,
  chronological,
  competencyTrend,
  conditionDifficulty,
  conditionGroupsOf,
  confusionMatrix,
  decisionTime,
  difficultyTrend,
  eloTrend,
  examComparison,
  isExamSession,
  lowestRecentCompetency,
  noveltyTrend,
  pointsLost,
  ranking,
  reactionByCondition,
  stageTotals,
  threatTimeline,
  totalSeries,
  trustBreakdown,
  unitHeatmap,
  weakestByElo,
  type UnitData,
} from './data';

let demo: DemoData;
let first: { id: string; sessions: SessionRecord[] };
let unit: UnitData;

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

beforeAll(() => {
  demo = DemoDataSchema.parse(JSON.parse(readFileSync('data/demo/demo-data.json', 'utf8')));
  const trainee = demo.trainees[0]!;
  first = {
    id: trainee.id,
    sessions: demo.sessions.filter((s) => s.traineeId === trainee.id),
  };
  const unitRecord = demo.units[0]!;
  unit = {
    unit: unitRecord,
    trainees: demo.trainees.filter((t) => t.unitId === unitRecord.id),
    sessions: demo.sessions.filter((s) => s.unitId === unitRecord.id),
    exams: demo.exams.filter((e) => e.unitId === unitRecord.id),
    profiles: Object.fromEntries(demo.skillProfiles.map((p) => [p.traineeId, p])),
  };
});

describe('exam identification', () => {
  it('marks exactly one exam session per trainee in the demo data', () => {
    for (const trainee of demo.trainees) {
      const own = demo.sessions.filter((s) => s.traineeId === trainee.id);
      expect(own.filter(isExamSession)).toHaveLength(1);
    }
  });
});

describe('trend helpers', () => {
  it('keeps exam sessions out of the competency trend', () => {
    const trend = competencyTrend(first.sessions);
    expect(trend).toHaveLength(11);
    const examIds = new Set(first.sessions.filter(isExamSession).map((s) => s.id));
    expect(trend.some((point) => examIds.has(point.sessionId))).toBe(false);
    for (const key of COMPETENCY_KEYS) expect(typeof trend[0]![key]).toBe('number');
  });

  it('uses the overall session ordinal so exam gaps stay visible', () => {
    const trend = competencyTrend(first.sessions);
    expect(trend.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const ordered = chronological(first.sessions);
    expect(isExamSession(ordered[11]!)).toBe(true);
  });

  it('splits difficulty, novelty and totals into trend and exam series', () => {
    for (const series of [
      difficultyTrend(first.sessions),
      noveltyTrend(first.sessions),
      totalSeries(first.sessions),
    ]) {
      expect(series.trend).toHaveLength(11);
      expect(series.exam).toHaveLength(1);
      expect(series.exam[0]!.n).toBe(12);
    }
    const noveltyValues = noveltyTrend(first.sessions).trend.map((p) => p.value);
    expect(noveltyValues.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('reads Elo ratings from the profile history without exam sessions', () => {
    const profile = demo.skillProfiles.find((p) => p.traineeId === first.id)!;
    const points = eloTrend(profile, first.sessions);
    expect(points).toHaveLength(11);
    expect(points[0]!.detect).toBe(profile.history[0]!.ratings.detect);
    expect(eloTrend(undefined, first.sessions)).toEqual([]);
  });

  it('finds the weakest competency by Elo and the lowest recent score', () => {
    const profile = demo.skillProfiles.find((p) => p.traineeId === first.id)!;
    const weakest = weakestByElo(profile)!;
    for (const key of COMPETENCY_KEYS) {
      expect(profile.ratings[weakest]).toBeLessThanOrEqual(profile.ratings[key]);
    }
    const lowest = lowestRecentCompetency(first.sessions)!;
    expect(lowest.value).toBeGreaterThanOrEqual(0);
    expect(lowest.value).toBeLessThanOrEqual(100);
  });
});

describe('confusionMatrix', () => {
  it('counts every scored threat exactly once', () => {
    const matrix = confusionMatrix(first.sessions);
    let scored = 0;
    for (const session of first.sessions) {
      const observed = new Set(
        session.log.events
          .filter((e) => e.type === 'observable')
          .map((e) => ('threatId' in e ? e.threatId : '')),
      );
      scored += session.spec.threats.filter((t) => observed.has(t.id)).length;
    }
    expect(matrix.total).toBe(scored);
    const sum = matrix.rows.reduce(
      (acc, row) => acc + matrix.columns.reduce((s, c) => s + matrix.counts[row]![c]!, 0),
      0,
    );
    expect(sum).toBe(scored);
    expect(matrix.columns.at(-1)).toBe('unclassified');
  });

  it('excludes threats that were never observable', () => {
    const base = first.sessions[0]!;
    const observed = new Set(
      base.log.events
        .filter((e) => e.type === 'observable')
        .map((e) => ('threatId' in e ? e.threatId : '')),
    );
    const stripped: SessionRecord = {
      ...base,
      log: {
        ...base.log,
        events: base.log.events.filter(
          (e) => !(e.type === 'observable' && observed.has(e.threatId)),
        ),
      },
    };
    expect(confusionMatrix([stripped]).total).toBe(0);
  });

  it('puts correct answers on the diagonal for a skilled trainee', () => {
    const skilled = unit.sessions.filter((s) => s.traineeId === unit.trainees[3]!.id);
    const matrix = confusionMatrix(skilled);
    const diagonal = matrix.rows.reduce((sum, row) => sum + (matrix.counts[row]![row] ?? 0), 0);
    expect(diagonal / matrix.total).toBeGreaterThan(0.6);
  });
});

describe('reactionByCondition', () => {
  it('returns every group with a positive mean when data exists', () => {
    const rows = reactionByCondition(demo.sessions);
    expect(rows.map((r) => r.group)).toEqual(CONDITION_GROUPS);
    for (const row of rows) {
      if (row.count > 0) expect(row.meanSec).toBeGreaterThanOrEqual(0);
      else expect(row.meanSec).toBeNull();
    }
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBeGreaterThan(0);
  });

  it('assigns groups from time of day, degradation and weather', () => {
    const base = first.sessions[0]!.spec;
    const healthy = { ...base, timeOfDay: 'day' as const, weather: 'clear' as const };
    expect(
      conditionGroupsOf({
        ...healthy,
        sensors: base.sensors.map((s) => ({ type: s.type, health: 1 })),
      }),
    ).toEqual(['day']);
    expect(
      conditionGroupsOf({
        ...healthy,
        timeOfDay: 'night',
        weather: 'fog',
        sensors: [{ type: 'radar', health: 0.5 }],
      }),
    ).toEqual(['night', 'degraded', 'fog']);
    expect(
      conditionGroupsOf({
        ...healthy,
        timeOfDay: 'dusk',
        weather: 'rain',
        sensors: [{ type: 'rf', health: 1, failAtSec: 40 }],
      }),
    ).toEqual(['dusk', 'degraded', 'rain']);
  });

  it('computes the mean reaction from detect minus observable', () => {
    const session = first.sessions[0]!;
    const rows = reactionByCondition([session]);
    const expected: number[] = [];
    const observableAt = new Map<string, number>();
    for (const event of session.log.events) {
      if (event.type === 'observable' && !observableAt.has(event.threatId)) {
        observableAt.set(event.threatId, event.t);
      }
    }
    const seen = new Set<string>();
    for (const event of session.log.events) {
      if (
        event.type === 'detect' &&
        !seen.has(event.threatId) &&
        observableAt.has(event.threatId)
      ) {
        seen.add(event.threatId);
        expected.push(event.t - observableAt.get(event.threatId)!);
      }
    }
    const group = rows.find((r) => r.group === session.spec.timeOfDay)!;
    expect(group.count).toBe(expected.length);
    expect(group.meanSec).toBeCloseTo(mean(expected), 9);
  });
});

describe('unit aggregates', () => {
  it('builds the heatmap from each trainee’s last 3 non-exam sessions', () => {
    const heatmap = unitHeatmap(unit);
    expect(heatmap).toHaveLength(4);
    const row = heatmap[0]!;
    const own = chronological(unit.sessions.filter((s) => s.traineeId === row.traineeId)).filter(
      (s) => !isExamSession(s),
    );
    const last3 = own.slice(-3);
    expect(row.competencies.detect).toBeCloseTo(
      mean(last3.map((s) => s.report.competencies.detect)),
      9,
    );
    expect(row.sessions).toBe(12);
  });

  it('flags the worst condition within each dimension', () => {
    const rows = conditionDifficulty(unit);
    for (const dimension of ['mapType', 'timeOfDay', 'weather'] as const) {
      const group = rows.filter((r) => r.dimension === dimension);
      expect(group.length).toBeGreaterThan(0);
      if (group.length > 1) {
        expect(group.filter((r) => r.worst)).toHaveLength(1);
        expect(group[0]!.worst).toBe(true);
        expect(group[0]!.meanTotal).toBeLessThanOrEqual(group[1]!.meanTotal);
      }
      expect(group.reduce((sum, r) => sum + r.sessions, 0)).toBe(unit.sessions.length);
    }
  });

  it('compares the exam on the common seed', () => {
    const tables = examComparison(unit);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.rows).toHaveLength(4);
    expect(tables[0]!.seed).toBe(unit.exams[0]!.seed);
    const totals = tables[0]!.rows.map((r) => r.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
    expect(tables[0]!.meanTotal).toBeCloseTo(mean(totals), 9);
  });

  it('ranks by recent mean and counts critical fails', () => {
    const rows = ranking(unit);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    const means = rows.map((r) => r.recentMean!);
    expect([...means].sort((a, b) => b - a)).toEqual(means);
    const top = rows[0]!;
    const own = unit.sessions.filter((s) => s.traineeId === top.traineeId);
    expect(top.criticalFails).toBe(own.reduce((sum, s) => sum + s.report.critical.length, 0));
    expect(top.sessions).toBe(12);
  });
});

describe('decision helpers', () => {
  const session = demo_first();

  function demo_first(): () => SessionRecord {
    return () => first.sessions.find((s) => s.report.decisions.some((d) => d.points < d.max))!;
  }

  it('maps each decision to a real event time', () => {
    const s = session();
    for (const decision of s.report.decisions) {
      const t = decisionTime(decision, s.log);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(s.endedAtSec + 1);
    }
  });

  it('uses detect time for detection and result time for outcome', () => {
    const s = session();
    const decision = s.report.decisions.find((d) => d.stage === 'detection')!;
    const detect = s.log.events.find(
      (e) => e.type === 'detect' && e.threatId === decision.threatId,
    );
    const observable = s.log.events.find(
      (e) => e.type === 'observable' && e.threatId === decision.threatId,
    )!;
    expect(decisionTime(decision, s.log)).toBe(detect ? detect.t : observable.t);

    const outcome = s.report.decisions.find((d) => d.stage === 'outcome')!;
    const results = s.log.events.filter(
      (e) => e.type === 'result' && e.threatId === outcome.threatId,
    );
    expect(decisionTime(outcome, s.log)).toBe(results.at(-1)!.t);
  });

  it('falls back to the observable time when nothing else happened', () => {
    const decision = {
      threatId: 'x',
      stage: 'engagement' as const,
      points: 0,
      max: 1,
      nodePath: [],
      reason: '',
    };
    const log = {
      scenarioId: 's',
      traineeId: 't',
      events: [{ type: 'observable' as const, t: 12.5, threatId: 'x' }],
    };
    expect(decisionTime(decision, log)).toBe(12.5);
    expect(decisionTime(decision, { ...log, events: [] })).toBe(0);
  });

  it('sorts lost points by amount with their classes and replay times', () => {
    const s = session();
    const lost = pointsLost(s);
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.map((item) => item.lost)).toEqual(
      [...lost.map((i) => i.lost)].sort((a, b) => b - a),
    );
    for (const item of lost) {
      expect(item.decision.points).toBeLessThan(item.decision.max);
      expect(item.trueClass).not.toBeNull();
    }
  });

  it('totals stages and trust counts', () => {
    const s = first.sessions[0]!;
    const stages = stageTotals(s);
    expect(stages.reduce((sum, r) => sum + r.points, 0)).toBeCloseTo(
      Object.values(s.report.byStage).reduce((a, b) => a + b, 0),
      9,
    );
    const trust = trustBreakdown(s.log);
    const classifies = s.log.events.filter((e) => e.type === 'classify').length;
    expect(
      trust.followedWrong + trust.overrodeWrong + trust.followedRight + trust.overrodeRight,
    ).toBe(classifies);
  });

  it('builds one timeline row per scored threat', () => {
    const s = first.sessions[0]!;
    const rows = threatTimeline(s.spec, s.log);
    const observed = new Set(
      s.log.events
        .filter((e) => e.type === 'observable')
        .map((e) => ('threatId' in e ? e.threatId : '')),
    );
    expect(rows.map((r) => r.threatId).sort()).toEqual(
      s.spec.threats
        .filter((t) => observed.has(t.id))
        .map((t) => t.id)
        .sort(),
    );
    for (const row of rows) {
      if (row.resultAt !== null) expect(row.outcome).not.toBeNull();
    }
  });
});
