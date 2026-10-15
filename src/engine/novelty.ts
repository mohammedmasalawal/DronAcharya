import type { ScenarioSpec, ThreatClass } from '../schema';

export const HISTORY_WINDOW = 8;

const SECTORS = 6;
const TIME_BINS = 6;
const CLASSES: ThreatClass[] = [
  'quad',
  'fpv',
  'fixedwing',
  'loiter',
  'bird',
  'friendly',
  'civilian',
];

const WEIGHTS = {
  bearings: 0.2,
  spawns: 0.15,
  classes: 0.2,
  conditions: 0.3,
  difficulty: 0.15,
};

export interface Features {
  bearings: number[];
  spawns: number[];
  classes: number[];
  conditions: [string, string, string];
  difficulty: number[];
}

function normalised(counts: number[]): number[] {
  const total = counts.reduce((sum, value) => sum + value, 0);
  return total === 0 ? counts : counts.map((value) => value / total);
}

export function featuresOf(spec: ScenarioSpec): Features {
  const bearings = new Array<number>(SECTORS).fill(0);
  const spawns = new Array<number>(TIME_BINS).fill(0);
  const classes = new Array<number>(CLASSES.length).fill(0);

  for (const threat of spec.threats) {
    const sector = Math.floor(((threat.bearingDeg % 360) / 360) * SECTORS) % SECTORS;
    const bin = Math.min(
      TIME_BINS - 1,
      Math.floor((threat.spawnAtSec / spec.durationSec) * TIME_BINS),
    );
    bearings[sector] = (bearings[sector] ?? 0) + 1;
    spawns[bin] = (spawns[bin] ?? 0) + 1;
    const index = CLASSES.indexOf(threat.cls);
    classes[index] = (classes[index] ?? 0) + 1;
  }

  const d = spec.difficulty;
  return {
    bearings: normalised(bearings),
    spawns: normalised(spawns),
    classes: normalised(classes),
    conditions: [spec.mapType, spec.timeOfDay, spec.weather],
    difficulty: [
      d.threatCount,
      d.speed,
      d.altitude,
      d.evasiveness,
      d.ambiguity,
      d.degradation,
      d.timePressure,
    ],
  };
}

function totalVariation(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / 2;
}

function meanAbsolute(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length;
}

export function featureDistance(a: Features, b: Features): number {
  const mismatched = a.conditions.filter((value, i) => value !== b.conditions[i]).length;
  return (
    WEIGHTS.bearings * totalVariation(a.bearings, b.bearings) +
    WEIGHTS.spawns * totalVariation(a.spawns, b.spawns) +
    WEIGHTS.classes * totalVariation(a.classes, b.classes) +
    WEIGHTS.conditions * (mismatched / a.conditions.length) +
    WEIGHTS.difficulty * meanAbsolute(a.difficulty, b.difficulty)
  );
}

export function noveltyOf(spec: ScenarioSpec, history: ScenarioSpec[]): number {
  const recent = history.slice(-HISTORY_WINDOW);
  if (recent.length === 0) return 1;

  const features = featuresOf(spec);
  let nearest = Infinity;
  for (const past of recent) {
    nearest = Math.min(nearest, featureDistance(features, featuresOf(past)));
  }
  return Math.max(0, Math.min(1, nearest));
}
