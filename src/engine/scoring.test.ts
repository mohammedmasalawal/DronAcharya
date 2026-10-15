import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONDITION_IDS,
  ScoreReportSchema,
  ScoringTreeSchema,
  type ConditionId,
  type ScenarioSpec,
  type ScoringTree,
  type SessionEvent,
  type Stage,
  type Threat,
} from '../schema';
import { analyseSession, scoreSession } from './scoring';

const tree: ScoringTree = ScoringTreeSchema.parse(
  JSON.parse(readFileSync('data/scoring-tree.default.json', 'utf8')),
);

const legacyTree: ScoringTree = {
  ...tree,
  nodes: tree.nodes
    .filter((node) => node.id !== 'outcome.ammo')
    .map((node) => ({
      ...node,
      branches: node.branches.flatMap((branch) => {
        if (branch.condition === 'neutralised_late') return [];
        if (branch.condition === 'neutralised_early') {
          return [{ condition: 'neutralised' as const, points: 1, label: 'Threat neutralised' }];
        }
        return [branch];
      }),
    })),
};

const STAGES: Stage[] = ['detection', 'classification', 'assessment', 'engagement', 'outcome'];

function threat(overrides: Partial<Threat> & { id: string }): Threat {
  return {
    cls: 'quad',
    hostile: true,
    rfEmitting: true,
    spawnAtSec: 0,
    bearingDeg: 0,
    rangeM: 3000,
    altM: 100,
    speedMps: 30,
    behavior: 'direct',
    ...overrides,
  };
}

function spec(threats: Threat[], overrides: Partial<ScenarioSpec> = {}): ScenarioSpec {
  return {
    id: 'scn',
    seed: 1,
    mapType: 'rural',
    timeOfDay: 'day',
    weather: 'clear',
    durationSec: 200,
    sensors: [{ type: 'radar', health: 1 }],
    effectors: [
      { type: 'jammer', rangeM: 3500, ammo: 5 },
      { type: 'gun', rangeM: 800, ammo: 20 },
    ],
    assets: [{ id: 'a1', x: 0, y: 0, value: 100 }],
    threats,
    roe: { requireClassification: true, minConfidence: 0.6 },
    difficulty: {
      threatCount: 0,
      speed: 0,
      altitude: 0,
      evasiveness: 0,
      ambiguity: 0,
      degradation: 0,
      timePressure: 0,
    },
    noveltyScore: 0,
    ...overrides,
  };
}

const observable = (id: string, t = 0): SessionEvent => ({ type: 'observable', t, threatId: id });
const detect = (id: string, t: number): SessionEvent => ({ type: 'detect', t, threatId: id });
const classify = (
  id: string,
  t: number,
  cls: Threat['cls'],
  confidence = 0.9,
  followedAssistant = false,
  assistantCorrect = true,
): SessionEvent => ({
  type: 'classify',
  t,
  threatId: id,
  cls,
  confidence,
  followedAssistant,
  assistantCorrect,
});
const rank = (t: number, order: string[]): SessionEvent => ({ type: 'rank', t, order });
const engage = (id: string, t: number, effector: 'jammer' | 'gun' = 'jammer'): SessionEvent => ({
  type: 'engage',
  t,
  threatId: id,
  effector,
});
const result = (
  id: string,
  t: number,
  outcome: Extract<SessionEvent, { type: 'result' }>['outcome'],
): SessionEvent => ({ type: 'result', t, threatId: id, outcome });

const log = (events: SessionEvent[]) => ({ scenarioId: 'scn', traineeId: 'trainee', events });

function conditionFor(
  events: SessionEvent[],
  scn: ScenarioSpec,
  id: string,
  stage: Stage,
  usingTree: ScoringTree = tree,
) {
  const { extras } = analyseSession(scn, log(events), usingTree);
  return extras.verdicts.find((v) => v.threatId === id && v.stage === stage)?.condition;
}

const twoHostileOneBird = spec([
  threat({ id: 'h1', rangeM: 2000, speedMps: 40 }),
  threat({ id: 'h2', rangeM: 3000, speedMps: 40, bearingDeg: 90 }),
  threat({ id: 'b1', cls: 'bird', hostile: false, rfEmitting: false, speedMps: 8 }),
]);

function perfectEvents(): SessionEvent[] {
  return [
    observable('h1'),
    observable('h2'),
    observable('b1'),
    detect('h1', 1),
    detect('h2', 2),
    detect('b1', 3),
    classify('h1', 4, 'quad'),
    classify('h2', 5, 'quad'),
    classify('b1', 6, 'bird'),
    rank(7, ['h1', 'h2']),
    engage('h1', 10),
    result('h1', 11, 'neutralised'),
    engage('h2', 12),
    result('h2', 13, 'neutralised'),
    result('b1', 200, 'ignored'),
  ];
}

describe('overall behaviour', () => {
  it('scores a perfect run 100 with no critical events', () => {
    const report = scoreSession(twoHostileOneBird, log(perfectEvents()), tree);
    expect(report.total).toBeCloseTo(100, 6);
    expect(report.critical).toEqual([]);
    expect(report.competencies.detect).toBeCloseTo(100, 6);
    expect(report.competencies.roe).toBe(100);
    expect(() => ScoreReportSchema.parse(report)).not.toThrow();
  });

  it('scores a run with no actions near zero and flags the misses', () => {
    const events = [
      observable('h1'),
      observable('h2'),
      observable('b1'),
      result('h1', 60, 'leak'),
      result('h2', 80, 'leak'),
      result('b1', 200, 'ignored'),
    ];
    const { report, extras } = analyseSession(twoHostileOneBird, log(events), tree);
    expect(report.total).toBeLessThan(10);
    expect(report.critical.map((c) => c.id)).toEqual(['critical_miss', 'critical_miss']);
    expect(extras.misses.filter((m) => m.stage === 'detection')).toHaveLength(3);
    expect(extras.verdicts.filter((v) => v.condition === 'never_detected')).toHaveLength(3);
  });

  it('uses the session id from the log', () => {
    const report = scoreSession(twoHostileOneBird, log(perfectEvents()), tree);
    expect(report.sessionId).toBe('scn:trainee');
  });
});

describe('detection', () => {
  const single = spec([threat({ id: 'h1', rangeM: 3000, speedMps: 30 })]);

  it.each([
    [5, 'reaction<=0.25'],
    [40, 'reaction<=0.6'],
    [95, 'reaction>0.6'],
  ])('maps a detect at %is to %s', (at, expected) => {
    const events = [observable('h1'), detect('h1', at), result('h1', 100, 'leak')];
    expect(conditionFor(events, single, 'h1', 'detection')).toBe(expected);
  });

  it('uses the first detect only', () => {
    const events = [observable('h1'), detect('h1', 5), detect('h1', 90), result('h1', 100, 'leak')];
    expect(conditionFor(events, single, 'h1', 'detection')).toBe('reaction<=0.25');
  });

  it('uses the leak time as the end of the warning window', () => {
    const events = [observable('h1'), detect('h1', 30), result('h1', 40, 'leak')];
    expect(conditionFor(events, single, 'h1', 'detection')).toBe('reaction>0.6');
  });
});

describe('classification', () => {
  const mixed = spec([
    threat({ id: 'h1' }),
    threat({ id: 'b1', cls: 'bird', hostile: false }),
    threat({ id: 'f1', cls: 'friendly', hostile: false }),
  ]);
  const base = [observable('h1'), observable('b1'), observable('f1')];

  it('grades exact, same family, wrong family and never classified', () => {
    const events = [
      ...base,
      classify('h1', 1, 'fpv'),
      classify('b1', 1, 'bird'),
      classify('f1', 1, 'civilian'),
    ];
    expect(conditionFor(events, mixed, 'h1', 'classification')).toBe('same_family');
    expect(conditionFor(events, mixed, 'b1', 'classification')).toBe('exact');
    expect(conditionFor(events, mixed, 'f1', 'classification')).toBe('wrong_family');
    expect(conditionFor(base, mixed, 'h1', 'classification')).toBe('not_classified');
  });

  it('recognises a non-threat called a threat and a threat called a non-threat', () => {
    const events = [...base, classify('b1', 1, 'quad'), classify('h1', 1, 'bird')];
    expect(conditionFor(events, mixed, 'b1', 'classification')).toBe('nonthreat_called_threat');
    expect(conditionFor(events, mixed, 'h1', 'classification')).toBe('threat_called_nonthreat');
  });

  it('uses the last classify before the first engage', () => {
    const events = [
      ...base,
      classify('h1', 1, 'bird'),
      classify('h1', 2, 'quad'),
      engage('h1', 3),
      classify('h1', 4, 'bird'),
    ];
    expect(conditionFor(events, mixed, 'h1', 'classification')).toBe('exact');
  });

  it('uses the last classify overall when never engaged', () => {
    const events = [...base, classify('h1', 1, 'quad'), classify('h1', 2, 'bird')];
    expect(conditionFor(events, mixed, 'h1', 'classification')).toBe('threat_called_nonthreat');
  });
});

describe('assessment', () => {
  const trio = spec([
    threat({ id: 'a', rangeM: 1000, speedMps: 50 }),
    threat({ id: 'b', rangeM: 2000, speedMps: 50 }),
    threat({ id: 'c', rangeM: 3000, speedMps: 50 }),
    threat({ id: 'd', rangeM: 5000, speedMps: 50 }),
  ]);
  const seen = ['a', 'b', 'c', 'd'].map((id) => observable(id));

  it('scores exact, within 1, within 2 and far or missing positions', () => {
    const events = [...seen, rank(1, ['b', 'a', 'd', 'c'])];
    expect(conditionFor(events, trio, 'a', 'assessment')).toBe('rank_within_1');
    expect(conditionFor([...seen, rank(1, ['a', 'b', 'c', 'd'])], trio, 'a', 'assessment')).toBe(
      'rank_exact',
    );
    expect(conditionFor([...seen, rank(1, ['b', 'c', 'd', 'a'])], trio, 'a', 'assessment')).toBe(
      'rank_far_or_missing',
    );
    expect(conditionFor([...seen, rank(1, ['c', 'd', 'a', 'b'])], trio, 'a', 'assessment')).toBe(
      'rank_within_2',
    );
  });

  it('scores a missing rank event as far or missing', () => {
    expect(conditionFor(seen, trio, 'a', 'assessment')).toBe('rank_far_or_missing');
  });

  it('uses the last rank event', () => {
    const events = [...seen, rank(1, ['d', 'c', 'b', 'a']), rank(2, ['a', 'b', 'c', 'd'])];
    expect(conditionFor(events, trio, 'a', 'assessment')).toBe('rank_exact');
  });

  it('breaks ETA ties by asset value and ignores non-hostile threats', () => {
    const scn = spec(
      [
        threat({ id: 'low', bearingDeg: 90, rangeM: 2000, speedMps: 40 }),
        threat({ id: 'high', bearingDeg: 270, rangeM: 2000, speedMps: 40 }),
        threat({ id: 'bird', cls: 'bird', hostile: false }),
      ],
      {
        assets: [
          { id: 'east', x: 2000, y: 0, value: 10 },
          { id: 'west', x: -2000, y: 0, value: 90 },
        ],
      },
    );
    const events = [
      observable('low'),
      observable('high'),
      observable('bird'),
      rank(1, ['bird', 'high', 'low']),
    ];
    expect(conditionFor(events, scn, 'high', 'assessment')).toBe('rank_exact');
    expect(conditionFor(events, scn, 'low', 'assessment')).toBe('rank_exact');
    expect(analyseSession(scn, log(events), tree).extras.kendallTau).toBe(1);
    expect(
      analyseSession(scn, log([...events.slice(0, 3), rank(2, ['low', 'high'])]), tree).extras
        .kendallTau,
    ).toBe(-1);
  });

  it('does not let Kendall tau change the points', () => {
    const a = scoreSession(trio, log([...seen, rank(1, ['a', 'b', 'c', 'd'])]), tree);
    const swapped = scoreSession(trio, log([...seen, rank(1, ['b', 'a', 'c', 'd'])]), tree);
    expect(swapped.byStage.assessment).toBeLessThan(a.byStage.assessment);
    expect(
      analyseSession(trio, log([...seen, rank(1, ['b', 'a', 'c', 'd'])]), tree).extras.kendallTau,
    ).toBeCloseTo(2 / 3, 6);
  });
});

describe('engagement decisions', () => {
  const classified = (id: string, cls: Threat['cls'] = 'quad', confidence = 0.9) => [
    observable(id),
    detect(id, 1),
    classify(id, 2, cls, confidence),
  ];

  it('treats engaging a bird as a heavy penalty and wasted outcome', () => {
    const scn = spec([threat({ id: 'b1', cls: 'bird', hostile: false })]);
    const events = [...classified('b1', 'bird'), engage('b1', 5, 'gun'), result('b1', 6, 'wasted')];
    expect(conditionFor(events, scn, 'b1', 'engagement')).toBe('engaged_bird');
    expect(conditionFor(events, scn, 'b1', 'outcome')).toBe('wasted');
    const { report } = analyseSession(scn, log(events), tree);
    expect(report.competencies.roe).toBe(0);
  });

  it('caps the total at 40 when a friendly is engaged', () => {
    const scn = spec([
      threat({ id: 'f1', cls: 'friendly', hostile: false }),
      threat({ id: 'h1' }),
      threat({ id: 'h2', bearingDeg: 90 }),
    ]);
    const events = [
      ...perfectEvents().filter((e) => !('threatId' in e) || ['h1', 'h2'].includes(e.threatId)),
      observable('f1'),
      detect('f1', 1),
      classify('f1', 2, 'friendly'),
      engage('f1', 5),
      result('f1', 6, 'fratricide'),
      rank(30, ['h1', 'h2']),
    ].filter((e) => e.type !== 'result' || e.threatId !== 'b1');
    const { report, extras } = analyseSession(scn, log(events), tree);
    expect(conditionFor(events, scn, 'f1', 'engagement')).toBe('engaged_friendly');
    expect(conditionFor(events, scn, 'f1', 'outcome')).toBe('fratricide');
    expect(report.total).toBeLessThanOrEqual(40);
    expect(report.critical.some((c) => c.id === 'fratricide' && c.threatId === 'f1')).toBe(true);
    expect(extras.verdicts.length).toBeGreaterThan(0);
  });

  it('marks jamming an RF-silent hostile as the wrong effector', () => {
    const scn = spec([threat({ id: 'h1', rfEmitting: false })]);
    const events = [
      ...classified('h1'),
      engage('h1', 5),
      result('h1', 6, 'wasted'),
      engage('h1', 8, 'gun'),
      result('h1', 9, 'neutralised'),
    ];
    const { extras } = analyseSession(scn, log(events), tree);
    expect(conditionFor(events, scn, 'h1', 'engagement')).toBe('hostile_roe_met_wrong_effector');
    expect(conditionFor(events, scn, 'h1', 'outcome', legacyTree)).toBe('neutralised');
    expect(extras.wastedEffort).toEqual(['h1']);
    expect(extras.engageCounts.h1).toBe(2);
  });

  it('ignores later engages when deciding the engagement', () => {
    const scn = spec([threat({ id: 'h1' })]);
    const events = [
      ...classified('h1'),
      engage('h1', 5),
      result('h1', 6, 'neutralised'),
      engage('h1', 7, 'gun'),
    ];
    expect(conditionFor(events, scn, 'h1', 'engagement')).toBe('hostile_roe_met_correct_effector');
  });

  it('flags engaging before classification as an ROE violation even on a hostile', () => {
    const scn = spec([threat({ id: 'h1' })]);
    const events = [
      observable('h1'),
      detect('h1', 1),
      engage('h1', 2),
      classify('h1', 3, 'quad'),
      result('h1', 3, 'neutralised'),
    ];
    expect(conditionFor(events, scn, 'h1', 'engagement')).toBe('engaged_before_confirmation');
    expect(analyseSession(scn, log(events), tree).report.competencies.roe).toBe(0);
  });

  it('flags engaging below the minimum confidence as an ROE violation', () => {
    const scn = spec([threat({ id: 'h1' })]);
    const events = [
      ...classified('h1', 'quad', 0.3),
      engage('h1', 5),
      result('h1', 6, 'neutralised'),
    ];
    expect(conditionFor(events, scn, 'h1', 'engagement')).toBe('engaged_before_confirmation');
  });

  it('does not enforce classification when the ROE does not require it', () => {
    const scn = spec([threat({ id: 'h1' })], {
      roe: { requireClassification: false, minConfidence: 0.9 },
    });
    const events = [
      observable('h1'),
      detect('h1', 1),
      engage('h1', 2),
      result('h1', 3, 'neutralised'),
    ];
    expect(conditionFor(events, scn, 'h1', 'engagement')).toBe('hostile_roe_met_correct_effector');
  });

  it('treats a never-engaged hostile that leaks as a critical miss with no cap', () => {
    const scn = spec([threat({ id: 'h1' })]);
    const events = [...classified('h1'), result('h1', 90, 'leak')];
    const { report } = analyseSession(scn, log(events), tree);
    expect(conditionFor(events, scn, 'h1', 'engagement')).toBe('held_fire_on_hostile');
    expect(conditionFor(events, scn, 'h1', 'outcome')).toBe('leak');
    expect(report.critical).toEqual([
      { id: 'critical_miss', threatId: 'h1', label: 'Held fire on a hostile' },
    ]);
  });

  it('gives zero engagement points and no critical flag for an ignored hostile', () => {
    const scn = spec([threat({ id: 'h1' })]);
    const events = [...classified('h1'), result('h1', 200, 'ignored')];
    const { report } = analyseSession(scn, log(events), tree);
    expect(conditionFor(events, scn, 'h1', 'engagement')).toBe('ignored_hostile');
    expect(conditionFor(events, scn, 'h1', 'outcome')).toBe('ignored_hostile');
    expect(report.critical).toEqual([]);
    const engagement = report.decisions.find((d) => d.stage === 'engagement');
    expect(engagement?.points).toBe(0);
  });

  it('rewards holding fire on a non-threat', () => {
    const scn = spec([threat({ id: 'c1', cls: 'civilian', hostile: false })]);
    const events = [...classified('c1', 'civilian'), result('c1', 200, 'ignored')];
    expect(conditionFor(events, scn, 'c1', 'engagement')).toBe('held_fire_on_nonthreat');
    expect(conditionFor(events, scn, 'c1', 'outcome')).toBe('ignored_nonthreat');
  });
});

describe('swarm coverage', () => {
  const swarm = spec([
    threat({ id: 's1', swarmId: 'sw', behavior: 'swarm' }),
    threat({ id: 's2', swarmId: 'sw', behavior: 'swarm' }),
    threat({ id: 's3', swarmId: 'sw', behavior: 'swarm' }),
  ]);
  const events = [
    ...['s1', 's2', 's3'].map((id) => observable(id)),
    ...['s1', 's2', 's3'].map((id) => detect(id, 2)),
    ...['s1', 's2', 's3'].map((id) => classify(id, 3, 'quad')),
    engage('s1', 6),
    result('s1', 7, 'neutralised'),
    result('s2', 7, 'neutralised'),
    result('s3', 7, 'neutralised'),
  ];

  it('credits covered members instead of scoring them as held fire', () => {
    const { report, extras } = analyseSession(swarm, log(events), tree);
    for (const id of ['s1', 's2', 's3']) {
      expect(conditionFor(events, swarm, id, 'engagement')).toBe(
        'hostile_roe_met_correct_effector',
      );
      expect(conditionFor(events, swarm, id, 'outcome', legacyTree)).toBe('neutralised');
      expect(conditionFor(events, swarm, id, 'outcome')).toBe('neutralised_early');
    }
    expect(report.critical).toEqual([]);
    expect(extras.engageCounts).toEqual({ s1: 1, s2: 0, s3: 0 });
  });

  it('still scores detection and classification per member', () => {
    const partial = events.filter((e) => !(e.type === 'detect' && e.threatId === 's3'));
    expect(conditionFor(partial, swarm, 's3', 'detection')).toBe('never_detected');
    expect(conditionFor(partial, swarm, 's2', 'detection')).not.toBe('never_detected');
  });

  it('judges the ROE of covered members by the engaged member', () => {
    const early = events.filter((e) => e.type !== 'classify' || e.threatId !== 's1');
    expect(conditionFor(early, swarm, 's2', 'engagement')).toBe('engaged_before_confirmation');
  });
});

describe('trust', () => {
  const single = spec([threat({ id: 'h1' })]);
  const base = [observable('h1'), detect('h1', 1)];

  const trustFor = (followed: boolean, correct: boolean) =>
    analyseSession(single, log([...base, classify('h1', 2, 'quad', 0.9, followed, correct)]), tree);

  it('applies the specified value for each combination', () => {
    expect(trustFor(true, false).report.competencies.trust).toBe(0);
    expect(trustFor(false, false).report.competencies.trust).toBe(100);
    expect(trustFor(true, true).report.competencies.trust).toBe(75);
    expect(trustFor(false, true).report.competencies.trust).toBe(37.5);
  });

  it('is neutral with no classify events', () => {
    const report = scoreSession(single, log(base), tree);
    expect(report.competencies.trust).toBe(50);
  });

  it('never changes the total', () => {
    const followed = trustFor(true, false).report.total;
    const overrode = trustFor(false, false).report.total;
    expect(followed).toBe(overrode);
  });
});

describe('result mapping', () => {
  it.each([
    ['hostile neutralised', { hostile: true, cls: 'quad' }, 'neutralised', 'neutralised'],
    ['hostile wasted', { hostile: true, cls: 'quad' }, 'wasted', 'wasted'],
    ['bird wasted', { hostile: false, cls: 'bird' }, 'wasted', 'wasted'],
    ['civilian wasted', { hostile: false, cls: 'civilian' }, 'wasted', 'wasted'],
    ['friendly fratricide', { hostile: false, cls: 'friendly' }, 'fratricide', 'fratricide'],
    ['non-threat ignored', { hostile: false, cls: 'bird' }, 'ignored', 'ignored_nonthreat'],
    ['hostile ignored', { hostile: true, cls: 'quad' }, 'ignored', 'ignored_hostile'],
    ['hostile leak', { hostile: true, cls: 'quad' }, 'leak', 'leak'],
  ] as const)('%s', (_name, traits, outcome, expected) => {
    const scn = spec([threat({ id: 'x', ...traits })]);
    const events = [observable('x'), result('x', 50, outcome)];
    expect(conditionFor(events, scn, 'x', 'outcome', legacyTree)).toBe(expected as ConditionId);
  });

  it('gives a leak zero outcome points', () => {
    const scn = spec([threat({ id: 'h1' })]);
    const { report } = analyseSession(scn, log([observable('h1'), result('h1', 50, 'leak')]), tree);
    expect(report.byStage.outcome).toBe(0);
  });
});

describe('scoring math', () => {
  it('makes decision max sum to the stage weight', () => {
    const { report } = analyseSession(twoHostileOneBird, log(perfectEvents()), tree);
    for (const stage of STAGES) {
      const max = report.decisions
        .filter((d) => d.stage === stage)
        .reduce((sum, d) => sum + d.max, 0);
      expect(max).toBeCloseTo(tree.weights[stage], 6);
    }
  });

  it('drops the assessment stage and re-normalises when there are no hostile threats', () => {
    const scn = spec([
      threat({ id: 'b1', cls: 'bird', hostile: false }),
      threat({ id: 'c1', cls: 'civilian', hostile: false }),
    ]);
    const events = [
      observable('b1'),
      observable('c1'),
      detect('b1', 1),
      detect('c1', 1),
      classify('b1', 2, 'bird'),
      classify('c1', 2, 'civilian'),
      result('b1', 200, 'ignored'),
      result('c1', 200, 'ignored'),
    ];
    const { report, extras } = analyseSession(scn, log(events), tree);
    expect(extras.droppedStages).toEqual(['assessment']);
    expect(report.decisions.some((d) => d.stage === 'assessment')).toBe(false);
    expect(report.total).toBeCloseTo(100, 6);
    expect(report.competencies.prioritise).toBe(50);
    const max = report.decisions.reduce((sum, d) => sum + d.max, 0);
    expect(max).toBeCloseTo(100 - tree.weights.assessment, 6);
  });

  it('excludes threats with no observable event from every stage', () => {
    const scn = spec([threat({ id: 'h1' }), threat({ id: 'ghost' })]);
    const events = [
      observable('h1'),
      detect('h1', 1),
      classify('h1', 2, 'quad'),
      rank(3, ['h1', 'ghost']),
      engage('h1', 5),
      result('h1', 6, 'neutralised'),
      result('ghost', 50, 'leak'),
    ];
    const { report, extras } = analyseSession(scn, log(events), tree);
    expect(extras.excludedThreatIds).toEqual(['ghost']);
    expect(report.decisions.some((d) => d.threatId === 'ghost')).toBe(false);
    expect(report.decisions.filter((d) => d.stage === 'detection')).toHaveLength(1);
    expect(report.decisions.find((d) => d.stage === 'detection')?.max).toBe(tree.weights.detection);
    expect(report.total).toBeCloseTo(100, 6);
  });

  it('clamps each decision and each stage', () => {
    const scn = spec([threat({ id: 'h1' }), threat({ id: 'f1', cls: 'friendly', hostile: false })]);
    const events = [
      observable('h1'),
      observable('f1'),
      engage('f1', 5),
      result('f1', 6, 'fratricide'),
      result('h1', 90, 'leak'),
    ];
    const { report } = analyseSession(scn, log(events), tree);
    for (const decision of report.decisions) {
      expect(decision.points).toBeGreaterThanOrEqual(-decision.max);
      expect(decision.points).toBeLessThanOrEqual(decision.max);
    }
    for (const stage of STAGES) expect(report.byStage[stage]).toBeGreaterThanOrEqual(0);
    expect(report.total).toBeGreaterThanOrEqual(0);
  });

  it('records the visited node and a reason for every decision', () => {
    const { report } = analyseSession(twoHostileOneBird, log(perfectEvents()), tree);
    for (const decision of report.decisions) {
      expect(decision.nodePath.length).toBeGreaterThan(0);
      expect(tree.nodes.map((n) => n.id)).toContain(decision.nodePath[0]);
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });

  it('takes every point value from the tree', () => {
    const doubled: ScoringTree = {
      ...tree,
      nodes: tree.nodes.map((node) => ({
        ...node,
        branches: node.branches.map((branch) => ({
          ...branch,
          points: branch.condition === 'exact' ? 0 : branch.points,
        })),
      })),
    };
    const exactOnly = spec([threat({ id: 'h1' })]);
    const events = [observable('h1'), detect('h1', 1), classify('h1', 2, 'quad')];
    const base = scoreSession(exactOnly, log(events), tree);
    const changed = scoreSession(exactOnly, log(events), doubled);
    expect(base.byStage.classification).toBe(tree.weights.classification);
    expect(changed.byStage.classification).toBe(0);
  });
});

describe('tree validation', () => {
  it('rejects unknown condition ids at parse time', () => {
    const bad = {
      ...tree,
      nodes: tree.nodes.map((node, index) =>
        index === 0
          ? { ...node, branches: [{ condition: 'made_up_condition', points: 1, label: 'x' }] }
          : node,
      ),
    };
    expect(() => ScoringTreeSchema.parse(bad)).toThrow();
  });

  it('rejects unknown ids in critical fails', () => {
    const bad = {
      ...tree,
      criticalFails: [{ id: 'x', condition: 'made_up_condition', label: 'x' }],
    };
    expect(() => ScoringTreeSchema.parse(bad)).toThrow();
  });
});

describe('neutralisation timing and ammunition', () => {
  const single = spec([threat({ id: 'h1', rangeM: 3000, speedMps: 30 })]);
  const prelude = [observable('h1'), detect('h1', 1), classify('h1', 2, 'quad')];
  const outcomeDecision = (events: SessionEvent[], scn: ScenarioSpec, usingTree = tree) =>
    analyseSession(scn, log(events), usingTree).report.decisions.find(
      (d) => d.stage === 'outcome',
    )!;

  it('scores neutralised_early when neutralised within half the warning window', () => {
    const events = [...prelude, engage('h1', 40), result('h1', 50, 'neutralised')];
    expect(conditionFor(events, single, 'h1', 'outcome')).toBe('neutralised_early');
    const decision = outcomeDecision(events, single);
    expect(decision.points).toBeCloseTo(decision.max, 6);
    expect(decision.nodePath).toEqual(['outcome.result']);
  });

  it('scores neutralised_late when neutralised after half the warning window', () => {
    const events = [...prelude, engage('h1', 60), result('h1', 70, 'neutralised')];
    expect(conditionFor(events, single, 'h1', 'outcome')).toBe('neutralised_late');
    const decision = outcomeDecision(events, single);
    expect(decision.points).toBeCloseTo(0.6 * decision.max, 6);
  });

  it('puts the boundary at exactly half the window into early', () => {
    const events = [...prelude, engage('h1', 49), result('h1', 50, 'neutralised')];
    expect(conditionFor(events, single, 'h1', 'outcome')).toBe('neutralised_early');
  });

  it('deducts ammo_heavy on top of the timing branch and records both nodes', () => {
    const events = [
      ...prelude,
      engage('h1', 20, 'gun'),
      result('h1', 21, 'wasted'),
      engage('h1', 22),
      result('h1', 23, 'neutralised'),
    ];
    const { extras } = analyseSession(single, log(events), tree);
    const decision = outcomeDecision(events, single);
    expect(decision.points).toBeCloseTo((1 - 0.2) * decision.max, 6);
    expect(decision.nodePath).toEqual(['outcome.result', 'outcome.ammo']);
    expect(extras.ammoHeavy).toEqual(['h1']);
    expect(extras.verdicts.filter((v) => v.stage === 'outcome').map((v) => v.condition)).toEqual([
      'neutralised_early',
      'ammo_heavy',
    ]);
  });

  it('applies the deduction to a late neutralisation too', () => {
    const events = [
      ...prelude,
      engage('h1', 55),
      result('h1', 56, 'wasted'),
      engage('h1', 57),
      result('h1', 70, 'neutralised'),
    ];
    const decision = outcomeDecision(events, single);
    expect(decision.points).toBeCloseTo((0.6 - 0.2) * decision.max, 6);
  });

  it('does not apply ammo_heavy for a single engage', () => {
    const events = [...prelude, engage('h1', 20), result('h1', 21, 'neutralised')];
    const { extras } = analyseSession(single, log(events), tree);
    expect(extras.ammoHeavy).toEqual([]);
  });

  const swarm = spec([
    threat({ id: 's1', swarmId: 'sw', behavior: 'swarm' }),
    threat({ id: 's2', swarmId: 'sw', behavior: 'swarm' }),
    threat({ id: 's3', swarmId: 'sw', behavior: 'swarm' }),
  ]);
  const swarmPrelude = ['s1', 's2', 's3'].flatMap((id) => [
    observable(id),
    detect(id, 1),
    classify(id, 2, 'quad'),
  ]);

  it('counts one jammer engage on a swarm once, not once per member', () => {
    const events = [
      ...swarmPrelude,
      engage('s1', 10),
      result('s1', 11, 'neutralised'),
      result('s2', 11, 'neutralised'),
      result('s3', 11, 'neutralised'),
    ];
    const { extras } = analyseSession(swarm, log(events), tree);
    expect(extras.ammoHeavy).toEqual([]);
  });

  it('marks every member heavy when the swarm took more than one engage', () => {
    const events = [
      ...swarmPrelude,
      engage('s1', 10, 'gun'),
      result('s1', 11, 'wasted'),
      engage('s2', 12),
      result('s1', 13, 'neutralised'),
      result('s2', 13, 'neutralised'),
      result('s3', 13, 'neutralised'),
    ];
    const { extras, report } = analyseSession(swarm, log(events), tree);
    expect(extras.ammoHeavy.sort()).toEqual(['s1', 's2', 's3']);
    for (const decision of report.decisions.filter((d) => d.stage === 'outcome')) {
      expect(decision.nodePath).toEqual(['outcome.result', 'outcome.ammo']);
    }
  });

  it('falls back to flat neutralised scoring with an old tree', () => {
    const events = [
      ...prelude,
      engage('h1', 20, 'gun'),
      result('h1', 21, 'wasted'),
      engage('h1', 60),
      result('h1', 70, 'neutralised'),
    ];
    expect(conditionFor(events, single, 'h1', 'outcome', legacyTree)).toBe('neutralised');
    const decision = outcomeDecision(events, single, legacyTree);
    expect(decision.points).toBeCloseTo(decision.max, 6);
    expect(decision.nodePath).toEqual(['outcome.result']);
  });

  it('accepts a tree that references the new ids', () => {
    const custom = {
      ...tree,
      nodes: tree.nodes.map((node) =>
        node.stage === 'outcome'
          ? {
              ...node,
              branches: [
                ...node.branches,
                { condition: 'ammo_heavy', points: -0.5, label: 'Heavy' },
              ],
            }
          : node,
      ),
    };
    expect(() => ScoringTreeSchema.parse(custom)).not.toThrow();
    expect(CONDITION_IDS).toEqual(
      expect.arrayContaining([
        'neutralised',
        'neutralised_early',
        'neutralised_late',
        'ammo_heavy',
      ]),
    );
  });

  it('lets a tree put ammo_heavy in the same node as the timing branch', () => {
    const merged: ScoringTree = {
      ...tree,
      nodes: tree.nodes
        .filter((node) => node.id !== 'outcome.ammo')
        .map((node) =>
          node.id === 'outcome.result'
            ? {
                ...node,
                branches: [
                  ...node.branches,
                  { condition: 'ammo_heavy' as const, points: -0.4, label: 'Heavy' },
                ],
              }
            : node,
        ),
    };
    const events = [
      ...prelude,
      engage('h1', 20, 'gun'),
      result('h1', 21, 'wasted'),
      engage('h1', 22),
      result('h1', 23, 'neutralised'),
    ];
    const decision = outcomeDecision(events, single, merged);
    expect(decision.nodePath).toEqual(['outcome.result']);
    expect(decision.points).toBeCloseTo(0.6 * decision.max, 6);
  });
});
