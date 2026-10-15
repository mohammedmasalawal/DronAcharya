import { describe, expect, it } from 'vitest';
import { generateScenario } from '../engine/generator';
import { mulberry32 } from '../shared/prng';
import { createWorld, getObservations, step, TIMESTEP_SEC } from './index';

const difficulty = {
  threatCount: 0.5,
  speed: 0.5,
  altitude: 0.5,
  evasiveness: 0.5,
  ambiguity: 0.5,
  degradation: 0.5,
  timePressure: 0.5,
};

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('stays within [0, 1)', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('sim stub', () => {
  it('advances time by the fixed timestep', () => {
    const world = createWorld(generateScenario(1, difficulty, []));
    const next = step(world, []);
    expect(next.tick).toBe(1);
    expect(next.t).toBeCloseTo(TIMESTEP_SEC);
  });

  it('reports one observation per threat', () => {
    const spec = generateScenario(1, difficulty, []);
    expect(getObservations(createWorld(spec))).toHaveLength(spec.threats.length);
  });
});
