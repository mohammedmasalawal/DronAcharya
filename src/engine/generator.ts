import {
  ScenarioSpecSchema,
  type Behavior,
  type Difficulty,
  type Effector,
  type MapType,
  type ScenarioSpec,
  type Sensor,
  type Threat,
  type ThreatClass,
  type TimeOfDay,
  type Weather,
} from '../schema';
import { mulberry32, type Rng } from '../shared/prng';
import { noveltyOf } from './novelty';
import { checkSolvability } from './solvability';

export const NOVELTY_FLOOR = 0.25;
export const MAX_REROLLS = 10;
const VALIDITY_TRIES = 8;
const FULL_RELIEF_FROM_TRY = 6;

const SECTOR_COUNT = 6;
const SECTOR_WIDTH_DEG = 360 / SECTOR_COUNT;
const MIN_HOSTILE_RANGE_M = 1700;
const ARRIVAL_MARGIN_SEC = 15;
const SWARM_SPAWN_SPREAD_SEC = 0.4;

const MAP_TYPES: MapType[] = ['rural', 'urban', 'hilly', 'industrial'];

const BASE_SPEED_MPS: Record<ThreatClass, [number, number]> = {
  quad: [16, 26],
  fpv: [38, 58],
  fixedwing: [28, 42],
  loiter: [20, 32],
  bird: [6, 14],
  friendly: [14, 24],
  civilian: [24, 44],
};

const BASE_ALTITUDE_M: Record<ThreatClass, [number, number]> = {
  quad: [40, 220],
  fpv: [20, 120],
  fixedwing: [80, 260],
  loiter: [60, 240],
  bird: [20, 150],
  friendly: [60, 200],
  civilian: [150, 500],
};

const EMITS_BY_DEFAULT: Record<ThreatClass, boolean> = {
  quad: true,
  fpv: true,
  fixedwing: false,
  loiter: false,
  bird: false,
  friendly: true,
  civilian: true,
};

interface Draft {
  cls: ThreatClass;
  hostile: boolean;
  rfEmitting: boolean;
  behavior: Behavior;
  swarmId?: string;
  speedMps: number;
  spawnAtSec: number;
  bearingDeg: number;
  rangeM: number;
  altM: number;
}

function between(rng: Rng, low: number, high: number): number {
  return low + rng() * (high - low);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pickOne<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function weightedPick<T>(rng: Rng, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}

function shuffled<T>(rng: Rng, items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function deriveSeed(seed: number, salt: number): number {
  const rng = mulberry32((seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
  return Math.floor(rng() * 2147483647);
}

function meanAxis(difficulty: Difficulty): number {
  const values = Object.values(difficulty);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hostileClass(rng: Rng, mean: number): ThreatClass {
  return weightedPick<ThreatClass>(rng, [
    ['quad', 0.75 - 0.4 * mean],
    ['fpv', 0.15 + 0.15 * mean],
    ['fixedwing', 0.05 + 0.1 * mean],
    ['loiter', 0.05 + 0.15 * mean],
  ]);
}

function nonThreatClass(rng: Rng): ThreatClass {
  return weightedPick<ThreatClass>(rng, [
    ['bird', 0.4],
    ['civilian', 0.35],
    ['friendly', 0.25],
  ]);
}

interface Timing {
  spawnAtSec: number;
  rangeM: number;
  speedMps: number;
}

function fitHostile(
  rng: Rng,
  speedMps: number,
  spawnWindowSec: number,
  durationSec: number,
  timePressure: number,
): Timing {
  const arrivalCap = durationSec - ARRIVAL_MARGIN_SEC;
  let spawnAtSec = between(rng, 0, spawnWindowSec);
  let rangeM = lerp(4200, 2200, timePressure) * between(rng, 0.8, 1.15);
  let speed = speedMps;

  spawnAtSec = Math.max(0, Math.min(spawnAtSec, arrivalCap - MIN_HOSTILE_RANGE_M / speed));
  rangeM = Math.min(rangeM, speed * (arrivalCap - spawnAtSec));

  if (rangeM < MIN_HOSTILE_RANGE_M) {
    rangeM = MIN_HOSTILE_RANGE_M;
    speed = Math.max(speed, rangeM / (arrivalCap - spawnAtSec));
  }

  return { spawnAtSec, rangeM, speedMps: speed };
}

function buildSpec(seed: number, difficulty: Difficulty, relief: number, id: string): ScenarioSpec {
  const rng = mulberry32(seed);
  const mean = meanAxis(difficulty);
  const evasiveness = difficulty.evasiveness * (1 - relief);
  const degradation = difficulty.degradation * (1 - relief);

  const mapType = pickOne(rng, MAP_TYPES);
  const timeOfDay = weightedPick<TimeOfDay>(rng, [
    ['day', 0.5],
    ['dusk', 0.25],
    ['night', 0.25],
  ]);
  const weather = weightedPick<Weather>(rng, [
    ['clear', 0.5],
    ['haze', 0.2],
    ['rain', 0.15],
    ['fog', 0.15],
  ]);

  const durationSec = Math.round(150 + 60 * (1 - difficulty.timePressure));
  const spawnWindowSec = durationSec * (0.5 - 0.3 * difficulty.timePressure);

  const individual = Math.round(2 + difficulty.threatCount * 18);
  const swarmSize =
    difficulty.threatCount >= 0.55
      ? 3 + Math.round(((difficulty.threatCount - 0.55) / 0.45) * 6)
      : 0;
  const nonThreats = Math.min(
    individual - 1,
    Math.round(individual * (0.1 + 0.5 * difficulty.ambiguity)),
  );
  const hostiles = individual - nonThreats;

  const sectorPool = shuffled(
    rng,
    Array.from({ length: SECTOR_COUNT }, (_, i) => i),
  );
  const sectorCount = 1 + Math.round(approachShare(difficulty) * (SECTOR_COUNT - 1));
  const usedSectors = sectorPool.slice(0, sectorCount);
  const bearing = (index: number): number =>
    usedSectors[index % usedSectors.length]! * SECTOR_WIDTH_DEG +
    between(rng, 5, SECTOR_WIDTH_DEG - 5);

  const drafts: Draft[] = [];

  const hostileClasses = Array.from({ length: hostiles }, () => hostileClass(rng, mean));
  const silentBudget = Math.round(hostiles * 0.55 * difficulty.ambiguity);
  let silent = 0;
  const evasiveBudget = Math.round(evasiveness * hostiles);
  let evasive = 0;

  hostileClasses.forEach((cls, index) => {
    const speedBase = between(rng, ...BASE_SPEED_MPS[cls]);
    const speed = speedBase * (0.75 + 0.55 * difficulty.speed);
    const timing = fitHostile(rng, speed, spawnWindowSec, durationSec, difficulty.timePressure);
    const altBase = between(rng, ...BASE_ALTITUDE_M[cls]);

    let rfEmitting = EMITS_BY_DEFAULT[cls];
    if (rfEmitting && silent < silentBudget) {
      rfEmitting = false;
      silent += 1;
    }

    let behavior: Behavior = 'direct';
    if (cls === 'loiter') {
      behavior = 'loiter';
    } else if (evasive < evasiveBudget) {
      behavior = rng() < 0.5 ? 'terrain_mask' : 'evasive';
      evasive += 1;
    }

    drafts.push({
      cls,
      hostile: true,
      rfEmitting,
      behavior,
      speedMps: timing.speedMps,
      spawnAtSec: timing.spawnAtSec,
      bearingDeg: bearing(index),
      rangeM: timing.rangeM,
      altM: Math.max(12, altBase * (1 - 0.75 * difficulty.altitude)),
    });
  });

  for (let i = 0; i < nonThreats; i++) {
    const cls = nonThreatClass(rng);
    const orbit = cls === 'bird' && rng() < 0.3;
    drafts.push({
      cls,
      hostile: false,
      rfEmitting: EMITS_BY_DEFAULT[cls],
      behavior: orbit ? 'loiter' : 'direct',
      speedMps: between(rng, ...BASE_SPEED_MPS[cls]),
      spawnAtSec: between(rng, 0, spawnWindowSec),
      bearingDeg: bearing(hostiles + i),
      rangeM: between(rng, 1500, 4000),
      altM: between(rng, ...BASE_ALTITUDE_M[cls]),
    });
  }

  let swarmRfEmitting = true;
  if (swarmSize > 0) {
    swarmRfEmitting = rng() >= 0.35 * difficulty.ambiguity;
    const swarmBearing = bearing(0);
    const swarmSpeed = between(rng, ...BASE_SPEED_MPS.quad) * (0.75 + 0.55 * difficulty.speed);
    const anchor = fitHostile(
      rng,
      swarmSpeed,
      spawnWindowSec,
      durationSec,
      difficulty.timePressure,
    );
    const altitude = Math.max(
      12,
      between(rng, ...BASE_ALTITUDE_M.quad) * (1 - 0.75 * difficulty.altitude),
    );

    for (let member = 0; member < swarmSize; member++) {
      drafts.push({
        cls: 'quad',
        hostile: true,
        rfEmitting: swarmRfEmitting,
        behavior: 'swarm',
        swarmId: 'sw1',
        speedMps: anchor.speedMps,
        spawnAtSec: anchor.spawnAtSec + member * SWARM_SPAWN_SPREAD_SEC,
        bearingDeg: swarmBearing + between(rng, -3, 3),
        rangeM: anchor.rangeM + between(rng, -60, 60),
        altM: altitude + between(rng, -10, 10),
      });
    }
  }

  const ordered = [...drafts].sort((a, b) => a.spawnAtSec - b.spawnAtSec);
  const threats: Threat[] = ordered.map((draft, index) => ({
    id: `t${index + 1}`,
    cls: draft.cls,
    hostile: draft.hostile,
    rfEmitting: draft.rfEmitting,
    spawnAtSec: round(draft.spawnAtSec, 1),
    bearingDeg: round(((draft.bearingDeg % 360) + 360) % 360, 1),
    rangeM: Math.round(draft.rangeM),
    altM: Math.round(draft.altM),
    speedMps: round(draft.speedMps, 1),
    behavior: draft.behavior,
    ...(draft.swarmId ? { swarmId: draft.swarmId } : {}),
  }));

  const sensors: Sensor[] = [
    {
      type: 'radar',
      health: round(clamp(1 - 0.5 * degradation * between(rng, 0.6, 1.2), 0.3, 1), 2),
    },
    {
      type: 'eoir',
      health: round(clamp(1 - 0.5 * degradation * between(rng, 0.6, 1.2), 0.3, 1), 2),
    },
    { type: 'rf', health: round(clamp(1 - 0.4 * degradation * between(rng, 0.5, 1.2), 0.4, 1), 2) },
  ];
  if (degradation >= 0.35) {
    const failing = pickOne(rng, [0, 1]);
    const target = sensors[failing]!;
    sensors[failing] = { ...target, failAtSec: Math.round(durationSec * between(rng, 0.35, 0.65)) };
  }

  const hostileThreats = threats.filter((threat) => threat.hostile);
  const emitters = hostileThreats.filter((threat) => threat.rfEmitting && !threat.swarmId).length;
  const gunRounds = hostileThreats.length + 2 + Math.round(4 * (1 - difficulty.threatCount));
  const effectors: Effector[] = [
    {
      type: 'jammer',
      rangeM: Math.round(between(rng, 3200, 3800)),
      ammo: Math.max(3, emitters + (swarmSize > 0 && swarmRfEmitting ? 2 : 0) + 2),
    },
    { type: 'gun', rangeM: Math.round(between(rng, 1250, 1500)), ammo: gunRounds },
    { type: 'net', rangeM: Math.round(between(rng, 550, 700)), ammo: 4 },
    { type: 'spoofer', rangeM: Math.round(between(rng, 2300, 2800)), ammo: 3 },
    { type: 'interceptor', rangeM: Math.round(between(rng, 2800, 3500)), ammo: 2 },
  ];

  const assetCount = 1 + Math.floor(rng() * 3);
  const assets = Array.from({ length: assetCount }, (_, i) => ({
    id: `a${i + 1}`,
    x: Math.round(between(rng, -250, 250)),
    y: Math.round(between(rng, -250, 250)),
    value: Math.round(between(rng, 40, 100)),
  }));

  return {
    id,
    seed,
    mapType,
    timeOfDay,
    weather,
    durationSec,
    sensors,
    effectors,
    assets,
    threats,
    roe: {
      requireClassification: true,
      minConfidence: round(0.5 + 0.2 * difficulty.ambiguity, 2),
    },
    difficulty,
    noveltyScore: 1,
  };
}

function approachShare(difficulty: Difficulty): number {
  return (difficulty.threatCount + difficulty.timePressure) / 2;
}

function buildPlayable(seed: number, difficulty: Difficulty, id: string): ScenarioSpec {
  let last: ScenarioSpec | null = null;

  for (let attempt = 0; attempt < VALIDITY_TRIES; attempt++) {
    const relief = clamp((attempt - 2) / (FULL_RELIEF_FROM_TRY - 2), 0, 1);
    const candidateSeed = attempt === 0 ? seed : deriveSeed(seed, 1000 + attempt);
    const spec = ScenarioSpecSchema.parse(buildSpec(candidateSeed, difficulty, relief, id));
    last = spec;
    if (checkSolvability(spec, { dynamic: true }).ok) return spec;
  }

  return last!;
}

export function generateScenario(
  seed: number,
  difficulty: Difficulty,
  history: ScenarioSpec[],
): ScenarioSpec {
  let best: ScenarioSpec | null = null;

  for (let reroll = 0; reroll <= MAX_REROLLS; reroll++) {
    const subSeed = reroll === 0 ? seed : deriveSeed(seed, reroll);
    const id = reroll === 0 ? `scn-${seed}` : `scn-${seed}-r${reroll}`;
    const spec = buildPlayable(subSeed, difficulty, id);
    const novelty = noveltyOf(spec, history);
    const candidate = { ...spec, noveltyScore: novelty };

    if (!best || novelty > best.noveltyScore) best = candidate;
    if (novelty >= NOVELTY_FLOOR) break;
  }

  return best!;
}
