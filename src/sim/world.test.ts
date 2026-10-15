import { describe, expect, it } from 'vitest';
import type { ScenarioSpec, SessionEvent, Threat } from '../schema';
import {
  TIMESTEP_SEC,
  createWorld,
  finish,
  getGroundTruth,
  getObservations,
  replayEvents,
  step,
  type SimInput,
  type World,
} from './index';

const baseThreat: Threat = {
  id: 't1',
  cls: 'quad',
  hostile: true,
  rfEmitting: true,
  spawnAtSec: 0,
  bearingDeg: 0,
  rangeM: 3000,
  altM: 100,
  speedMps: 50,
  behavior: 'direct',
};

function makeSpec(overrides: Partial<ScenarioSpec> = {}, threats: Partial<Threat>[] = [{}]) {
  const spec: ScenarioSpec = {
    id: 'test',
    seed: 1,
    mapType: 'rural',
    timeOfDay: 'day',
    weather: 'clear',
    durationSec: 120,
    sensors: [{ type: 'radar', health: 1 }],
    effectors: [
      { type: 'jammer', rangeM: 3500, ammo: 5 },
      { type: 'gun', rangeM: 800, ammo: 5 },
      { type: 'net', rangeM: 500, ammo: 2 },
    ],
    assets: [{ id: 'a1', x: 0, y: 0, value: 100 }],
    threats: threats.map((t, i) => ({ ...baseThreat, id: `t${i + 1}`, ...t })),
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
  return spec;
}

function runUntil(world: World, seconds: number, inputsAt: Record<number, SimInput[]> = {}) {
  const targetTick = Math.round(seconds / TIMESTEP_SEC);
  while (world.tick < targetTick && !world.done) {
    step(world, inputsAt[world.tick] ?? [], TIMESTEP_SEC);
  }
  return world;
}

function ofType<T extends SessionEvent['type']>(world: World, type: T) {
  return world.events.filter((e): e is Extract<SessionEvent, { type: T }> => e.type === type);
}

describe('observable events', () => {
  it('fires once, at the first moment a sensor can see the threat', () => {
    const spec = makeSpec({}, [{ rangeM: 7000 }]);
    const world = runUntil(createWorld(spec), 100);
    const events = ofType(world, 'observable');
    expect(events).toHaveLength(1);
    expect(events[0]!.t).toBeGreaterThan(40);
    expect(events[0]!.t).toBeLessThan(60);
  });

  it('is immediate when the threat starts inside sensor range', () => {
    const world = createWorld(makeSpec());
    expect(ofType(world, 'observable')).toEqual([{ type: 'observable', t: 0, threatId: 't1' }]);
  });

  it('does not fire for a threat only an offline sensor could see', () => {
    const spec = makeSpec({ sensors: [{ type: 'radar', health: 1, failAtSec: 5 }] }, [
      { rangeM: 8000 },
    ]);
    const world = runUntil(createWorld(spec), 100);
    expect(ofType(world, 'observable')).toHaveLength(0);
  });

  it('lets rf see only emitting threats', () => {
    const rf = [{ type: 'rf' as const, health: 1 }];
    const silent = makeSpec({ sensors: rf }, [{ rfEmitting: false }]);
    const loud = makeSpec({ sensors: rf }, [{ rfEmitting: true }]);
    expect(ofType(createWorld(silent), 'observable')).toHaveLength(0);
    expect(ofType(createWorld(loud), 'observable')).toHaveLength(1);
  });

  it('shortens eoir range at night and in fog', () => {
    const eoir = [{ type: 'eoir' as const, health: 1 }];
    const day = makeSpec({ sensors: eoir }, [{ rangeM: 2300 }]);
    const night = makeSpec({ sensors: eoir, timeOfDay: 'night' }, [{ rangeM: 2300 }]);
    const fog = makeSpec({ sensors: eoir, weather: 'fog' }, [{ rangeM: 2300 }]);
    expect(ofType(createWorld(day), 'observable')).toHaveLength(1);
    expect(ofType(createWorld(night), 'observable')).toHaveLength(0);
    expect(ofType(createWorld(fog), 'observable')).toHaveLength(0);
  });

  it('delays terrain-masked threats on urban maps', () => {
    const direct = makeSpec({ mapType: 'urban' }, [{ rangeM: 4000, altM: 30 }]);
    const masked = makeSpec({ mapType: 'urban' }, [
      { rangeM: 4000, altM: 30, behavior: 'terrain_mask' },
    ]);
    const a = runUntil(createWorld(direct), 120);
    const b = runUntil(createWorld(masked), 120);
    expect(ofType(a, 'observable')[0]!.t).toBeLessThan(ofType(b, 'observable')[0]!.t);
  });

  it('does not reveal threats before they spawn', () => {
    const world = createWorld(makeSpec({}, [{ spawnAtSec: 30 }]));
    expect(getObservations(world)).toHaveLength(0);
    expect(getGroundTruth(world)).toHaveLength(0);
    runUntil(world, 31);
    expect(getObservations(world)).toHaveLength(1);
  });
});

describe('results', () => {
  it('leaks an unengaged hostile once it reaches the asset', () => {
    const world = runUntil(createWorld(makeSpec()), 120);
    const results = ofType(world, 'result');
    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('leak');
    expect(results[0]!.t).toBeGreaterThan(50);
    expect(results[0]!.t).toBeLessThan(65);
  });

  it('marks surviving threats ignored when the scenario ends', () => {
    const world = runUntil(createWorld(makeSpec({ durationSec: 10 })), 10);
    expect(world.done).toBe(true);
    expect(ofType(world, 'result')).toEqual([
      { type: 'result', t: world.t, threatId: 't1', outcome: 'ignored' },
    ]);
  });

  it('lets a non-hostile transit past the asset and exit as ignored', () => {
    const spec = makeSpec({}, [{ cls: 'civilian', hostile: false, speedMps: 80 }]);
    const world = runUntil(createWorld(spec), 120);
    const results = ofType(world, 'result');
    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('ignored');
    expect(results[0]!.t).toBeLessThan(120);
  });

  it('neutralises a hostile quad with a jammer after the effect delay', () => {
    const world = createWorld(makeSpec());
    runUntil(world, 120, {
      0: [{ type: 'detect', threatId: 't1' }],
      20: [{ type: 'classify', threatId: 't1', cls: 'quad', confidence: 0.9 }],
      40: [{ type: 'engage', threatId: 't1', effector: 'jammer' }],
    });
    expect(world.events.map((e) => e.type)).toEqual([
      'observable',
      'detect',
      'classify',
      'engage',
      'result',
    ]);
    const result = ofType(world, 'result')[0]!;
    expect(result.outcome).toBe('neutralised');
    expect(result.t).toBeCloseTo(2 + 1, 5);
  });

  it('wastes a jammer on a non-emitting hostile and keeps it inbound', () => {
    const spec = makeSpec({}, [{ rfEmitting: false }]);
    const world = createWorld(spec);
    runUntil(world, 120, {
      0: [{ type: 'detect', threatId: 't1' }],
      20: [{ type: 'engage', threatId: 't1', effector: 'jammer' }],
    });
    const outcomes = ofType(world, 'result').map((e) => e.outcome);
    expect(outcomes).toEqual(['wasted', 'leak']);
  });

  it('wastes a gun round on a bird and removes it', () => {
    const spec = makeSpec({}, [{ cls: 'bird', hostile: false, rangeM: 700, speedMps: 5 }]);
    const world = createWorld(spec);
    runUntil(world, 120, {
      0: [{ type: 'detect', threatId: 't1' }],
      20: [{ type: 'engage', threatId: 't1', effector: 'gun' }],
    });
    expect(ofType(world, 'result').map((e) => e.outcome)).toEqual(['wasted']);
    expect(world.threats[0]!.status).toBe('neutralised');
  });

  it('records fratricide when a friendly is engaged with an effective effector', () => {
    const spec = makeSpec({}, [{ cls: 'friendly', hostile: false }]);
    const world = createWorld(spec);
    runUntil(world, 120, {
      0: [{ type: 'detect', threatId: 't1' }],
      20: [{ type: 'engage', threatId: 't1', effector: 'jammer' }],
    });
    expect(ofType(world, 'result').map((e) => e.outcome)).toEqual(['fratricide']);
  });

  it('neutralises every jammed member of a swarm from one engagement', () => {
    const spec = makeSpec({}, [
      { swarmId: 's1', behavior: 'swarm' },
      { swarmId: 's1', behavior: 'swarm' },
      { swarmId: 's1', behavior: 'swarm' },
    ]);
    const world = createWorld(spec);
    runUntil(world, 60, {
      0: [{ type: 'detect', threatId: 't1' }],
      20: [{ type: 'engage', threatId: 't1', effector: 'jammer' }],
    });
    const outcomes = ofType(world, 'result').map((e) => `${e.threatId}:${e.outcome}`);
    expect(outcomes.sort()).toEqual(['t1:neutralised', 't2:neutralised', 't3:neutralised']);
  });
});

describe('input validation', () => {
  it('rejects detect and classify for a threat that has not spawned', () => {
    const world = createWorld(makeSpec({}, [{ spawnAtSec: 50 }]));
    step(world, [
      { type: 'detect', threatId: 't1' },
      { type: 'classify', threatId: 't1', cls: 'quad', confidence: 1 },
    ]);
    expect(world.rejected.map((r) => r.reason)).toEqual(['not_active', 'not_active']);
    expect(world.events).toHaveLength(0);
  });

  it('rejects detect when no sensor sees the threat', () => {
    const world = createWorld(makeSpec({}, [{ rangeM: 9000 }]));
    step(world, [{ type: 'detect', threatId: 't1' }]);
    expect(world.rejected.map((r) => r.reason)).toEqual(['not_visible']);
  });

  it('rejects classify before detect', () => {
    const world = createWorld(makeSpec());
    step(world, [{ type: 'classify', threatId: 't1', cls: 'quad', confidence: 1 }]);
    expect(world.rejected.map((r) => r.reason)).toEqual(['not_detected']);
  });

  it('rejects an out-of-range engagement without spending ammo', () => {
    const spec = makeSpec({}, [{ rangeM: 3000 }]);
    const world = createWorld(spec);
    step(world, [{ type: 'detect', threatId: 't1' }]);
    step(world, [{ type: 'engage', threatId: 't1', effector: 'gun' }]);
    expect(world.rejected.at(-1)!.reason).toBe('out_of_range');
    expect(world.effectors.find((e) => e.type === 'gun')!.ammo).toBe(5);
    expect(ofType(world, 'engage')).toHaveLength(0);
  });

  it('rejects engagement when the effector is out of ammo', () => {
    const spec = makeSpec({ effectors: [{ type: 'jammer', rangeM: 5000, ammo: 0 }] });
    const world = createWorld(spec);
    step(world, [{ type: 'detect', threatId: 't1' }]);
    step(world, [{ type: 'engage', threatId: 't1', effector: 'jammer' }]);
    expect(world.rejected.at(-1)!.reason).toBe('no_ammo');
  });

  it('flags assistant trust on classify events', () => {
    const world = createWorld(makeSpec());
    const suggestion = world.threats[0]!.assistantSuggestion;
    step(world, [{ type: 'detect', threatId: 't1' }]);
    step(world, [{ type: 'classify', threatId: 't1', cls: suggestion, confidence: 0.5 }]);
    const event = ofType(world, 'classify')[0]!;
    expect(event.followedAssistant).toBe(true);
    expect(event.assistantCorrect).toBe(suggestion === 'quad');
  });

  it('ignores inputs after the scenario is finished', () => {
    const world = finish(createWorld(makeSpec()));
    const before = world.events.length;
    step(world, [{ type: 'detect', threatId: 't1' }]);
    expect(world.events).toHaveLength(before);
  });
});

describe('determinism', () => {
  const script: Record<number, SimInput[]> = {
    0: [{ type: 'detect', threatId: 't1' }],
    10: [{ type: 'classify', threatId: 't1', cls: 'fpv', confidence: 0.7 }],
    20: [{ type: 'rank', order: ['t2', 't1'] }],
    30: [{ type: 'engage', threatId: 't1', effector: 'jammer' }],
  };
  const spec = makeSpec({ seed: 99 }, [{}, { bearingDeg: 120, behavior: 'evasive' }]);

  it('produces identical events for identical inputs', () => {
    const a = runUntil(createWorld(spec), 120, script);
    const b = runUntil(createWorld(spec), 120, script);
    expect(a.events).toEqual(b.events);
  });

  it('replays a recorded log into the same event stream', () => {
    const live = runUntil(createWorld(spec), 120, script);
    const log = { scenarioId: spec.id, traineeId: 'x', events: live.events };
    expect(replayEvents(spec, log)).toEqual(live.events);
  });

  it('keeps the assistant suggestion seeded', () => {
    const a = createWorld(spec).threats.map((t) => t.assistantSuggestion);
    const b = createWorld(spec).threats.map((t) => t.assistantSuggestion);
    expect(a).toEqual(b);
  });
});

describe('observations', () => {
  it('hide ground truth and withhold the assistant until detected', () => {
    const world = createWorld(makeSpec());
    const [before] = getObservations(world);
    expect(before!.detected).toBe(false);
    expect(before!.assistantSuggestion).toBeNull();
    expect(before).not.toHaveProperty('cls');
    step(world, [{ type: 'detect', threatId: 't1' }]);
    const [after] = getObservations(world);
    expect(after!.detected).toBe(true);
    expect(after!.assistantSuggestion).not.toBeNull();
  });

  it('list only effectors that are in range with ammo', () => {
    const world = createWorld(makeSpec({}, [{ rangeM: 3000 }]));
    expect(getObservations(world)[0]!.engageable).toEqual(['jammer']);
    runUntil(world, 50);
    expect(getObservations(world)[0]!.engageable).toContain('gun');
  });
});
