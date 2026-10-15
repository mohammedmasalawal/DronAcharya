import { describe, expect, it } from 'vitest';
import { DEFAULT_TREE } from '../engine/defaultTree';
import { analyseSession } from '../engine/scoring';
import type { ScenarioSpec, SessionEvent, Threat } from '../schema';
import { MAX_FEEDBACK_SENTENCES, feedback } from './feedback';

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
    sensors: [
      { type: 'radar', health: 1 },
      { type: 'eoir', health: 1 },
      { type: 'rf', health: 1 },
    ],
    effectors: [
      { type: 'jammer', rangeM: 3500, ammo: 6 },
      { type: 'gun', rangeM: 1300, ammo: 30 },
    ],
    assets: [{ id: 'a1', x: 0, y: 0, value: 100 }],
    threats,
    roe: { requireClassification: true, minConfidence: 0.6 },
    difficulty: {
      threatCount: 0.5,
      speed: 0.5,
      altitude: 0.5,
      evasiveness: 0.5,
      ambiguity: 0.5,
      degradation: 0.5,
      timePressure: 0.5,
    },
    noveltyScore: 1,
    ...overrides,
  };
}

const observable = (id: string): SessionEvent => ({ type: 'observable', t: 0, threatId: id });
const detect = (id: string, t: number): SessionEvent => ({ type: 'detect', t, threatId: id });
const classify = (
  id: string,
  t: number,
  cls: Threat['cls'],
  followed = false,
  assistantCorrect = true,
): SessionEvent => ({
  type: 'classify',
  t,
  threatId: id,
  cls,
  confidence: 0.9,
  followedAssistant: followed,
  assistantCorrect,
});
const engage = (id: string, t: number, effector: 'jammer' | 'gun' = 'gun'): SessionEvent => ({
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

function run(scn: ScenarioSpec, events: SessionEvent[]): string[] {
  const log = { scenarioId: scn.id, traineeId: 'trainee', events };
  const { report, extras } = analyseSession(scn, log, DEFAULT_TREE);
  return feedback(scn, log, report, extras);
}

describe('feedback rules', () => {
  it('reports a repeated confusion pair under the scenario condition', () => {
    const scn = spec(
      ['a', 'b', 'c', 'd'].map((id) => threat({ id, cls: 'fpv' })),
      { timeOfDay: 'night' },
    );
    const events: SessionEvent[] = [
      ...['a', 'b', 'c', 'd'].flatMap((id) => [observable(id), detect(id, 1)]),
      classify('a', 2, 'quad'),
      classify('b', 2, 'quad'),
      classify('c', 2, 'quad'),
      classify('d', 2, 'fpv'),
    ];
    expect(run(scn, events)).toContain(
      'At night you called FPV drones quadcopters in 3 of 4 cases.',
    );
  });

  it('reports unclassified contacts as a confusion with the unclassified column', () => {
    const scn = spec(['a', 'b'].map((id) => threat({ id, cls: 'loiter' })));
    const events: SessionEvent[] = ['a', 'b'].flatMap((id) => [observable(id), detect(id, 1)]);
    expect(run(scn, events).join(' ')).toContain(
      'you left loitering munitions unclassified in 2 of 2 cases',
    );
  });

  it('reports late detection under the weather', () => {
    const scn = spec(
      ['a', 'b', 'c'].map((id) => threat({ id, rangeM: 3000, speedMps: 30 })),
      { weather: 'fog' },
    );
    const events: SessionEvent[] = [
      ...['a', 'b', 'c'].map(observable),
      detect('a', 2),
      detect('b', 90),
      classify('a', 3, 'quad'),
    ];
    expect(run(scn, events)).toContain('In fog you detected 2 of 3 contacts late or not at all.');
  });

  it('reports following a wrong assistant suggestion', () => {
    const scn = spec([threat({ id: 'a', cls: 'fpv' })]);
    const events: SessionEvent[] = [
      observable('a'),
      detect('a', 1),
      classify('a', 2, 'quad', true, false),
    ];
    expect(run(scn, events).join(' ')).toContain(
      'You followed the AI assistant when it was wrong 1 time',
    );
  });

  it('reports rules-of-engagement violations', () => {
    const scn = spec([threat({ id: 'a' })]);
    const events: SessionEvent[] = [
      observable('a'),
      detect('a', 1),
      engage('a', 2),
      classify('a', 3, 'quad'),
      result('a', 3, 'neutralised'),
    ];
    expect(run(scn, events).join(' ')).toContain(
      'before the classification met the rules of engagement',
    );
  });

  it('reports engaging non-threats and a friendly separately', () => {
    const scn = spec([
      threat({ id: 'b', cls: 'bird', hostile: false, rfEmitting: false }),
      threat({ id: 'f', cls: 'friendly', hostile: false }),
    ]);
    const events: SessionEvent[] = [
      observable('b'),
      observable('f'),
      detect('b', 1),
      detect('f', 1),
      classify('b', 2, 'bird'),
      classify('f', 2, 'friendly'),
      engage('b', 5),
      engage('f', 5, 'jammer'),
      result('b', 6, 'wasted'),
      result('f', 6, 'fratricide'),
    ];
    const lines = run(scn, events);
    expect(lines[0]).toContain('friendly aircraft, which is a critical fail');
    expect(lines.join(' ')).toContain('1 non-threat (birds or civilian aircraft)');
  });

  it('reports jamming RF-silent drones', () => {
    const scn = spec([threat({ id: 'a', cls: 'fixedwing', rfEmitting: false })]);
    const events: SessionEvent[] = [
      observable('a'),
      detect('a', 1),
      classify('a', 2, 'fixedwing'),
      engage('a', 3, 'jammer'),
      result('a', 4, 'wasted'),
    ];
    expect(run(scn, events).join(' ')).toContain('Jammers had no effect on 1 RF-silent drone');
  });

  it('reports jamming a swarm before assessing its members', () => {
    const scn = spec(
      ['a', 'b', 'c'].map((id) => threat({ id, swarmId: 'sw1', behavior: 'swarm' })),
    );
    const events: SessionEvent[] = [
      ...['a', 'b', 'c'].flatMap((id) => [observable(id), detect(id, 1)]),
      classify('a', 2, 'quad'),
      engage('a', 3, 'jammer'),
      result('a', 4, 'neutralised'),
      result('b', 4, 'neutralised'),
      result('c', 4, 'neutralised'),
    ];
    expect(run(scn, events).join(' ')).toContain(
      'You jammed swarm sw1 before classifying all 3 members; 2 members were never assessed.',
    );
  });

  it('does not flag a swarm that was fully assessed first', () => {
    const scn = spec(['a', 'b'].map((id) => threat({ id, swarmId: 'sw1', behavior: 'swarm' })));
    const events: SessionEvent[] = [
      ...['a', 'b'].flatMap((id) => [observable(id), detect(id, 1), classify(id, 2, 'quad')]),
      engage('a', 3, 'jammer'),
      result('a', 4, 'neutralised'),
      result('b', 4, 'neutralised'),
    ];
    expect(run(scn, events).join(' ')).not.toContain('jammed swarm');
  });
});

describe('feedback selection', () => {
  const crowded = spec(
    [
      threat({ id: 'f', cls: 'friendly', hostile: false }),
      threat({ id: 's', cls: 'fixedwing', rfEmitting: false }),
      threat({ id: 'q', cls: 'fpv' }),
      threat({ id: 'r', cls: 'fpv' }),
    ],
    { timeOfDay: 'night', weather: 'fog' },
  );
  const events: SessionEvent[] = [
    ...['f', 's', 'q', 'r'].flatMap((id) => [observable(id), detect(id, 80)]),
    classify('f', 81, 'friendly'),
    classify('s', 81, 'fixedwing'),
    classify('q', 81, 'quad', true, false),
    classify('r', 81, 'quad', true, false),
    engage('f', 82, 'jammer'),
    engage('s', 82, 'jammer'),
    result('f', 83, 'fratricide'),
    result('s', 83, 'wasted'),
  ];

  it('never returns more than three sentences', () => {
    const lines = run(crowded, events);
    expect(lines).toHaveLength(MAX_FEEDBACK_SENTENCES);
  });

  it('puts the most severe problem first', () => {
    expect(run(crowded, events)[0]).toContain('friendly aircraft');
  });

  it('is deterministic', () => {
    expect(run(crowded, events)).toEqual(run(crowded, events));
  });

  it('gives one positive sentence for a clean session', () => {
    const scn = spec([threat({ id: 'a' })]);
    const clean: SessionEvent[] = [
      observable('a'),
      detect('a', 1),
      classify('a', 2, 'quad'),
      { type: 'rank', t: 2.5, order: ['a'] },
      engage('a', 3, 'jammer'),
      result('a', 4, 'neutralised'),
    ];
    const lines = run(scn, clean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Clean session');
  });
});
