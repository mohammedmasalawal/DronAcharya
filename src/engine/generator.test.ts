import { describe, expect, it } from 'vitest';
import { ScenarioSpecSchema, type Behavior, type Difficulty, type ThreatClass } from '../schema';
import { MAX_REROLLS, NOVELTY_FLOOR, generateScenario } from './generator';
import { noveltyOf } from './novelty';
import { checkSolvability } from './solvability';

const uniform = (value: number): Difficulty => ({
  threatCount: value,
  speed: value,
  altitude: value,
  evasiveness: value,
  ambiguity: value,
  degradation: value,
  timePressure: value,
});

const seeds = (count: number, from = 1) => Array.from({ length: count }, (_, i) => from + i);
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

describe('determinism', () => {
  it('gives an identical spec for the same seed and difficulty', () => {
    expect(generateScenario(42, uniform(0.5), [])).toEqual(generateScenario(42, uniform(0.5), []));
  });

  it('gives different specs for different seeds', () => {
    const a = generateScenario(1, uniform(0.5), []);
    const b = generateScenario(2, uniform(0.5), []);
    expect(a).not.toEqual(b);
    expect(a.threats).not.toEqual(b.threats);
  });

  it('is deterministic with a history too', () => {
    const history = [generateScenario(7, uniform(0.5), [])];
    expect(generateScenario(7, uniform(0.5), history)).toEqual(
      generateScenario(7, uniform(0.5), history),
    );
  });
});

describe('difficulty mapping', () => {
  const easy = seeds(6).map((seed) => generateScenario(seed, uniform(0.1), []));
  const hard = seeds(6).map((seed) => generateScenario(seed, uniform(0.9), []));

  it('raises the threat count', () => {
    expect(mean(hard.map((s) => s.threats.length))).toBeGreaterThan(
      mean(easy.map((s) => s.threats.length)) * 3,
    );
    for (const spec of easy) expect(spec.threats.length).toBeLessThanOrEqual(6);
  });

  it('adds swarm members only at high threat counts', () => {
    for (const spec of easy) expect(spec.threats.some((t) => t.swarmId)).toBe(false);
    for (const spec of hard)
      expect(spec.threats.filter((t) => t.swarmId).length).toBeGreaterThan(2);
  });

  it('raises ambiguity through non-threats and RF-silent hostiles', () => {
    const nonThreatShare = (specs: typeof easy) =>
      mean(
        specs.map((s) => {
          const individual = s.threats.filter((t) => !t.swarmId);
          return individual.filter((t) => !t.hostile).length / individual.length;
        }),
      );
    const silentShare = (specs: typeof easy) =>
      mean(
        specs.map((s) => {
          const hostile = s.threats.filter(
            (t) => t.hostile && t.cls !== 'fixedwing' && t.cls !== 'loiter',
          );
          return hostile.filter((t) => !t.rfEmitting).length / Math.max(1, hostile.length);
        }),
      );
    expect(nonThreatShare(hard)).toBeGreaterThan(nonThreatShare(easy) + 0.15);
    expect(silentShare(hard)).toBeGreaterThan(silentShare(easy));
  });

  it('lowers sensor health and schedules a failure when degraded', () => {
    const worst = (specs: typeof easy) =>
      mean(specs.map((s) => Math.min(...s.sensors.map((x) => x.health))));
    expect(worst(hard)).toBeLessThan(worst(easy) - 0.2);
    for (const spec of easy)
      expect(spec.sensors.every((s) => s.failAtSec === undefined)).toBe(true);
    for (const spec of hard) {
      const failing = spec.sensors.filter((s) => s.failAtSec !== undefined);
      expect(failing).toHaveLength(1);
      const at = failing[0]!.failAtSec!;
      expect(at).toBeGreaterThan(spec.durationSec * 0.3);
      expect(at).toBeLessThan(spec.durationSec * 0.7);
    }
  });

  it('shortens the spawn-to-impact window with time pressure', () => {
    const window = (specs: typeof easy) =>
      mean(
        specs.flatMap((s) => s.threats.filter((t) => t.hostile).map((t) => t.rangeM / t.speedMps)),
      );
    expect(window(hard)).toBeLessThan(window(easy));
  });

  it('raises speed and lowers altitude', () => {
    const hostile = (specs: typeof easy) =>
      specs.flatMap((s) => s.threats.filter((t) => t.hostile));
    expect(mean(hostile(hard).map((t) => t.speedMps))).toBeGreaterThan(
      mean(hostile(easy).map((t) => t.speedMps)),
    );
    expect(mean(hostile(hard).map((t) => t.altM))).toBeLessThan(
      mean(hostile(easy).map((t) => t.altM)),
    );
  });

  it('uses more approach sectors at high difficulty', () => {
    const sectors = (spec: (typeof easy)[number]) =>
      new Set(spec.threats.map((t) => Math.floor(t.bearingDeg / 60))).size;
    expect(mean(hard.map(sectors))).toBeGreaterThan(mean(easy.map(sectors)));
  });

  it('shares behaviour between evasive and terrain-masked hostiles with evasiveness', () => {
    const masked = (specs: typeof easy) =>
      specs.flatMap((s) =>
        s.threats.filter((t) => t.behavior === 'evasive' || t.behavior === 'terrain_mask'),
      ).length;
    expect(masked(hard)).toBeGreaterThan(masked(easy));
  });
});

describe('content', () => {
  const sample = seeds(40).map((seed) =>
    generateScenario(seed, uniform(0.6 + (seed % 4) * 0.1), []),
  );

  it('uses every class and behaviour the sim supports', () => {
    const classes = new Set<ThreatClass>();
    const behaviours = new Set<Behavior>();
    for (const spec of sample) {
      for (const threat of spec.threats) {
        classes.add(threat.cls);
        behaviours.add(threat.behavior);
      }
    }
    expect([...classes].sort()).toEqual(
      ['bird', 'civilian', 'fixedwing', 'fpv', 'friendly', 'loiter', 'quad'].sort(),
    );
    expect([...behaviours].sort()).toEqual(
      ['direct', 'evasive', 'loiter', 'swarm', 'terrain_mask'].sort(),
    );
  });

  it('keeps rfEmitting sensible per class', () => {
    for (const spec of sample) {
      for (const threat of spec.threats) {
        if (threat.cls === 'bird') expect(threat.rfEmitting).toBe(false);
        if (threat.cls === 'friendly' || threat.cls === 'civilian') {
          expect(threat.rfEmitting).toBe(true);
        }
        if (threat.cls === 'fixedwing' || threat.cls === 'loiter') {
          expect(threat.hostile).toBe(true);
        }
      }
    }
  });

  it('spreads swarm spawn times under one swarm id', () => {
    for (const spec of sample) {
      const members = spec.threats.filter((t) => t.swarmId);
      if (members.length === 0) continue;
      expect(new Set(members.map((m) => m.swarmId)).size).toBe(1);
      expect(new Set(members.map((m) => m.spawnAtSec)).size).toBeGreaterThan(1);
      expect(members.every((m) => m.behavior === 'swarm')).toBe(true);
    }
  });

  it('always provides sensors, assets and an effector loadout', () => {
    for (const spec of sample) {
      expect(spec.sensors.map((s) => s.type).sort()).toEqual(['eoir', 'radar', 'rf']);
      expect(spec.assets.length).toBeGreaterThan(0);
      expect(spec.effectors.length).toBeGreaterThan(0);
      expect(spec.threats.some((t) => t.hostile)).toBe(true);
    }
  });

  it('draws conditions from the seed', () => {
    const maps = new Set(seeds(30).map((seed) => generateScenario(seed, uniform(0.2), []).mapType));
    const times = new Set(
      seeds(30).map((seed) => generateScenario(seed, uniform(0.2), []).timeOfDay),
    );
    expect(maps.size).toBeGreaterThan(1);
    expect(times.size).toBeGreaterThan(1);
  });
});

describe('novelty', () => {
  it('is 1 with an empty history', () => {
    expect(generateScenario(5, uniform(0.5), []).noveltyScore).toBe(1);
  });

  it('is low against a history of near-identical specs', () => {
    const base = generateScenario(5, uniform(0.5), []);
    const history = Array.from({ length: 8 }, () => base);
    expect(noveltyOf(base, history)).toBeLessThan(0.05);
  });

  it('only looks at the last eight specs', () => {
    const base = generateScenario(5, uniform(0.5), []);
    const other = generateScenario(6, uniform(0.1), []);
    const history = [base, ...Array.from({ length: 8 }, () => other)];
    expect(noveltyOf(base, history)).toBeGreaterThan(noveltyOf(base, [base]));
  });

  it('re-rolls to improve novelty and keeps the most novel candidate', () => {
    const base = generateScenario(5, uniform(0.5), []);
    const history = Array.from({ length: 8 }, () => base);
    const rerolled = generateScenario(5, uniform(0.5), history);
    expect(noveltyOf(base, history)).toBeLessThan(NOVELTY_FLOOR);
    expect(rerolled.noveltyScore).toBeGreaterThan(noveltyOf(base, history));
    expect(rerolled.noveltyScore).toBeGreaterThanOrEqual(NOVELTY_FLOOR);
    expect(rerolled.id).not.toBe(base.id);
    expect(rerolled.id).toMatch(new RegExp(`^scn-5-r([1-9]|${MAX_REROLLS})$`));
  });

  it('keeps the original when it is already novel enough', () => {
    const history = [generateScenario(1, uniform(0.1), [])];
    const spec = generateScenario(9, uniform(0.9), history);
    expect(spec.id).toBe('scn-9');
    expect(spec.noveltyScore).toBeGreaterThanOrEqual(NOVELTY_FLOOR);
  });
});

describe('validity', () => {
  it('passes the schema and the solvability rule over 200 seeds at difficulties 0.1 to 0.9', () => {
    const failures: string[] = [];

    for (const seed of seeds(200)) {
      const level = 0.1 + (seed % 9) * 0.1;
      const spec = generateScenario(seed, uniform(level), []);
      const parsed = ScenarioSpecSchema.safeParse(spec);
      if (!parsed.success) failures.push(`seed ${seed}: schema`);
      const check = checkSolvability(spec, { dynamic: true });
      if (!check.ok)
        failures.push(`seed ${seed} @${level.toFixed(1)}: ${check.problems.join('; ')}`);
    }

    expect(failures).toEqual([]);
  }, 240_000);

  it('rejects an unsolvable loadout', () => {
    const spec = generateScenario(3, uniform(0.3), []);
    const unsolvable = { ...spec, effectors: [{ type: 'net' as const, rangeM: 500, ammo: 1 }] };
    expect(checkSolvability(unsolvable).ok).toBe(false);
  });

  it('rejects a hostile that arrives faster than any response allows', () => {
    const spec = generateScenario(3, uniform(0.3), []);
    const hostile = spec.threats.find((t) => t.hostile)!;
    const rushed = {
      ...spec,
      threats: spec.threats.map((t) =>
        t.id === hostile.id ? { ...t, rangeM: 1700, speedMps: 500 } : t,
      ),
    };
    expect(checkSolvability(rushed).ok).toBe(false);
  });
});
