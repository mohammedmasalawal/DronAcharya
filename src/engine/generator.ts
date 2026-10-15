import type { Difficulty, ScenarioSpec, Threat } from '../schema';
import { mulberry32 } from '../sim/prng';

export function generateScenario(
  seed: number,
  difficulty: Difficulty,
  history: ScenarioSpec[],
): ScenarioSpec {
  const rng = mulberry32(seed);
  const durationSec = 180;
  const count = 1 + Math.round(difficulty.threatCount * 7);

  const threats: Threat[] = Array.from({ length: count }, (_, i) => ({
    id: `t${i + 1}`,
    cls: 'quad',
    hostile: true,
    rfEmitting: true,
    spawnAtSec: Math.floor(rng() * durationSec * 0.5),
    bearingDeg: Math.floor(rng() * 360),
    rangeM: 2000 + Math.floor(rng() * 2000),
    altM: 50 + Math.floor(rng() * 150),
    speedMps: 15 + Math.floor(rng() * 10),
    behavior: 'direct',
  }));

  return {
    id: `scn-${seed}`,
    seed,
    mapType: 'rural',
    timeOfDay: 'day',
    weather: 'clear',
    durationSec,
    sensors: [
      { type: 'radar', health: 1 },
      { type: 'eoir', health: 1 },
      { type: 'rf', health: 1 },
    ],
    effectors: [
      { type: 'jammer', rangeM: 1500, ammo: 99 },
      { type: 'gun', rangeM: 800, ammo: 60 },
    ],
    assets: [{ id: 'a1', x: 0, y: 0, value: 100 }],
    threats,
    roe: { requireClassification: true, minConfidence: 0.6 },
    difficulty,
    noveltyScore: history.length === 0 ? 1 : 0.5,
  };
}
