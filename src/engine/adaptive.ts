import type { Competencies, Difficulty, ScoreReport, Stage } from '../schema';
import { mulberry32 } from '../shared/prng';
import type { AnalysisExtras } from './scoring';

export type CompetencyKey = keyof Competencies;
export type Ratings = Record<CompetencyKey, number>;
export type Levels = Record<CompetencyKey, number>;
export type KnobKey = keyof Difficulty;

export interface HistoryEntry {
  difficulty: Difficulty;
  competencies: Competencies;
  ratings: Ratings;
  levels?: Levels;
}

export interface SkillProfile {
  traineeId: string;
  ratings: Ratings;
  levels: Levels;
  smoothed: Levels;
  sessions: number;
  history: HistoryEntry[];
}

export const COMPETENCY_KEYS: CompetencyKey[] = [
  'detect',
  'classify',
  'prioritise',
  'engage',
  'roe',
  'trust',
];

export const KNOB_KEYS: KnobKey[] = [
  'threatCount',
  'speed',
  'altitude',
  'evasiveness',
  'ambiguity',
  'degradation',
  'timePressure',
];

export const INITIAL_RATING = 1000;

const REFERENCE_BASE = 700;
const REFERENCE_SPAN = 600;
export const INITIAL_LEVEL = 0.3;
export const INITIAL_SMOOTHED = 0.75;
const SMOOTHING = 0.5;
const CONTROLLER_GAIN = 0.6;
const SETPOINT = 0.75;
const MAX_STEP = 0.12;
const MIN_LEVEL = 0.05;
const MAX_LEVEL = 0.95;
const K_EARLY = 100;
const K_MIDDLE = 60;
const K_LATE = 40;
const EARLY_SESSIONS = 3;
const MIDDLE_SESSIONS = 8;
const WEAKEST_BOOST = 0.1;
const EXPLORE_PROBABILITY = 0.1;
const EXPLORE_SPAN = 0.1;
const ASSISTANT_AMBIGUITY_WEIGHT = 0.5;
const ASSISTANT_DEGRADATION_WEIGHT = 0.2;

const OWNED_KNOBS: Record<CompetencyKey, KnobKey[]> = {
  detect: ['speed', 'timePressure', 'altitude', 'degradation'],
  classify: ['ambiguity', 'degradation'],
  prioritise: ['threatCount', 'timePressure'],
  engage: ['threatCount', 'evasiveness', 'timePressure'],
  roe: ['ambiguity'],
  trust: ['ambiguity', 'degradation'],
};

const STAGE_OF: Record<CompetencyKey, Stage | null> = {
  detect: 'detection',
  classify: 'classification',
  prioritise: 'assessment',
  engage: 'engagement',
  roe: 'engagement',
  trust: null,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function ownedKnobs(key: CompetencyKey): KnobKey[] {
  return [...OWNED_KNOBS[key]];
}

export function levelFor(key: CompetencyKey, difficulty: Difficulty): number {
  if (key === 'trust') {
    const weighted =
      ASSISTANT_AMBIGUITY_WEIGHT * difficulty.ambiguity +
      ASSISTANT_DEGRADATION_WEIGHT * difficulty.degradation;
    return clamp(weighted / (ASSISTANT_AMBIGUITY_WEIGHT + ASSISTANT_DEGRADATION_WEIGHT), 0, 1);
  }
  return mean(OWNED_KNOBS[key].map((knob) => difficulty[knob]));
}

export function kFactor(completedSessions: number): number {
  if (completedSessions < EARLY_SESSIONS) return K_EARLY;
  if (completedSessions < MIDDLE_SESSIONS) return K_MIDDLE;
  return K_LATE;
}

export function expectedSuccess(rating: number, level: number): number {
  const reference = REFERENCE_BASE + REFERENCE_SPAN * level;
  return 1 / (1 + 10 ** ((reference - rating) / 400));
}

function uniformLevels(value: number): Levels {
  return {
    detect: value,
    classify: value,
    prioritise: value,
    engage: value,
    roe: value,
    trust: value,
  };
}

export function createProfile(traineeId: string): SkillProfile {
  return {
    traineeId,
    ratings: uniformLevels(INITIAL_RATING),
    levels: uniformLevels(INITIAL_LEVEL),
    smoothed: uniformLevels(INITIAL_SMOOTHED),
    sessions: 0,
    history: [],
  };
}

export function updateSkill(
  profile: SkillProfile,
  report: ScoreReport,
  extras: AnalysisExtras,
  servedDifficulty: Difficulty,
): SkillProfile {
  const k = kFactor(profile.sessions);
  const ratings: Ratings = { ...profile.ratings };
  const levels: Levels = { ...(profile.levels ?? uniformLevels(INITIAL_LEVEL)) };
  const smoothed: Levels = { ...(profile.smoothed ?? uniformLevels(INITIAL_SMOOTHED)) };

  for (const key of COMPETENCY_KEYS) {
    const stage = STAGE_OF[key];
    if (stage !== null && extras.droppedStages.includes(stage)) continue;
    if (key === 'trust' && extras.trustSamples === 0) continue;

    const score = report.competencies[key] / 100;
    const expected = expectedSuccess(ratings[key], levelFor(key, servedDifficulty));
    ratings[key] += k * (score - expected);

    smoothed[key] = SMOOTHING * smoothed[key] + (1 - SMOOTHING) * score;
    const step = clamp(CONTROLLER_GAIN * (smoothed[key] - SETPOINT), -MAX_STEP, MAX_STEP);
    levels[key] = clamp(levels[key] + step, MIN_LEVEL, MAX_LEVEL);
  }

  return {
    traineeId: profile.traineeId,
    ratings,
    levels,
    smoothed,
    sessions: profile.sessions + 1,
    history: [
      ...profile.history,
      {
        difficulty: { ...servedDifficulty },
        competencies: { ...report.competencies },
        ratings: { ...ratings },
        levels: { ...levels },
      },
    ],
  };
}

export function weakestCompetency(profile: SkillProfile): CompetencyKey {
  let weakest = COMPETENCY_KEYS[0]!;
  for (const key of COMPETENCY_KEYS) {
    if (profile.ratings[key] < profile.ratings[weakest]) weakest = key;
  }
  return weakest;
}

export function nextDifficulty(profile: SkillProfile, seed: number): Difficulty {
  const rng = mulberry32(seed >>> 0);
  const levels = profile.levels ?? uniformLevels(INITIAL_LEVEL);
  const emphasised = new Set(OWNED_KNOBS[weakestCompetency(profile)]);
  const explore = rng() < EXPLORE_PROBABILITY;

  const next = {} as Difficulty;
  for (const knob of KNOB_KEYS) {
    const owners = COMPETENCY_KEYS.filter((key) => OWNED_KNOBS[key].includes(knob));
    let level = mean(owners.map((key) => levels[key]));
    if (emphasised.has(knob)) level += WEAKEST_BOOST;
    if (explore) level += (rng() * 2 - 1) * EXPLORE_SPAN;
    next[knob] = Math.round(clamp(level, 0, 1) * 1000) / 1000;
  }
  return next;
}

export function examConfig(
  seed: number,
  difficulty: Difficulty,
): { seed: number; difficulty: Difficulty } {
  return { seed, difficulty: { ...difficulty } };
}
