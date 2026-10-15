import type { ScenarioSpec, SessionEvent, EffectorType, ThreatClass } from '../schema';
import { mulberry32, type Rng } from '../shared/prng';

export const TIMESTEP_SEC = 0.05;

export type SimInput =
  | { type: 'detect'; threatId: string }
  | { type: 'classify'; threatId: string; cls: ThreatClass; confidence: number }
  | { type: 'rank'; order: string[] }
  | { type: 'engage'; threatId: string; effector: EffectorType };

export interface Observation {
  threatId: string;
  observable: boolean;
  detected: boolean;
}

export interface World {
  spec: ScenarioSpec;
  rng: Rng;
  tick: number;
  t: number;
  events: SessionEvent[];
}

export function createWorld(spec: ScenarioSpec): World {
  return { spec, rng: mulberry32(spec.seed), tick: 0, t: 0, events: [] };
}

export function step(world: World, _inputs: SimInput[], dt: number = TIMESTEP_SEC): World {
  return { ...world, tick: world.tick + 1, t: world.t + dt };
}

export function getObservations(world: World): Observation[] {
  return world.spec.threats.map((threat) => ({
    threatId: threat.id,
    observable: world.t >= threat.spawnAtSec,
    detected: false,
  }));
}
