import { describe, expect, it } from 'vitest';
import type { Competencies, Difficulty, ScoreReport } from '../schema';
import { mulberry32 } from '../shared/prng';
import {
  COMPETENCY_KEYS,
  INITIAL_LEVEL,
  INITIAL_RATING,
  INITIAL_SMOOTHED,
  KNOB_KEYS,
  createProfile,
  examConfig,
  kFactor,
  expectedSuccess,
  levelFor,
  nextDifficulty,
  ownedKnobs,
  updateSkill,
  type Ratings,
  type SkillProfile,
} from './adaptive';
import type { AnalysisExtras } from './scoring';

const uniform = (value: number): Difficulty => ({
  threatCount: value,
  speed: value,
  altitude: value,
  evasiveness: value,
  ambiguity: value,
  degradation: value,
  timePressure: value,
});

const reportWith = (score: number): ScoreReport => {
  const competencies: Competencies = {
    detect: score,
    classify: score,
    prioritise: score,
    engage: score,
    roe: score,
    trust: score,
  };
  return {
    sessionId: 's',
    total: score,
    byStage: {} as ScoreReport['byStage'],
    decisions: [],
    competencies,
    critical: [],
  };
};

const extrasWith = (overrides: Partial<AnalysisExtras> = {}): AnalysisExtras => ({
  kendallTau: null,
  excludedThreatIds: [],
  droppedStages: [],
  misses: [],
  wastedEffort: [],
  ammoHeavy: [],
  trustSamples: 3,
  engageCounts: {},
  verdicts: [],
  ...overrides,
});

const profileWith = (ratings: Partial<Ratings>, sessions = 0): SkillProfile => ({
  ...createProfile('t'),
  ratings: { ...createProfile('t').ratings, ...ratings },
  sessions,
});

const withoutExploration = (): number => {
  for (let seed = 1; seed < 1000; seed++) if (mulberry32(seed)() >= 0.1) return seed;
  throw new Error('no seed');
};

const withExploration = (): number => {
  for (let seed = 1; seed < 1000; seed++) if (mulberry32(seed)() < 0.1) return seed;
  throw new Error('no seed');
};

describe('updateSkill', () => {
  it('starts every rating at 1000', () => {
    const profile = createProfile('t');
    expect(COMPETENCY_KEYS.every((key) => profile.ratings[key] === INITIAL_RATING)).toBe(true);
    expect(profile.sessions).toBe(0);
    expect(profile.history).toEqual([]);
  });

  it('raises ratings after good performance and lowers them after poor performance', () => {
    const good = updateSkill(createProfile('t'), reportWith(95), extrasWith(), uniform(0.5));
    const poor = updateSkill(createProfile('t'), reportWith(10), extrasWith(), uniform(0.5));
    for (const key of COMPETENCY_KEYS) {
      expect(good.ratings[key]).toBeGreaterThan(INITIAL_RATING);
      expect(poor.ratings[key]).toBeLessThan(INITIAL_RATING);
    }
  });

  it('applies the Elo formula with K 100, then 60 for sessions 4 to 8, then 40', () => {
    const level = 0.5;
    const expected = expectedSuccess(1000, level);
    const at = (completed: number) =>
      updateSkill(profileWith({}, completed), reportWith(80), extrasWith(), uniform(level)).ratings
        .detect;

    for (const completed of [0, 1, 2])
      expect(at(completed)).toBeCloseTo(1000 + 100 * (0.8 - expected), 6);
    for (const completed of [3, 4, 5, 6, 7])
      expect(at(completed)).toBeCloseTo(1000 + 60 * (0.8 - expected), 6);
    for (const completed of [8, 9, 20])
      expect(at(completed)).toBeCloseTo(1000 + 40 * (0.8 - expected), 6);
    expect([kFactor(2), kFactor(3), kFactor(7), kFactor(8)]).toEqual([100, 60, 60, 40]);
  });

  it('keeps the widened Elo reference scale 700 + 600 x level', () => {
    expect(expectedSuccess(1000, 0.5)).toBeCloseTo(0.5, 9);
    expect(expectedSuccess(1000, 0)).toBeCloseTo(1 / (1 + 10 ** (-300 / 400)), 9);
    expect(expectedSuccess(1000, 1)).toBeCloseTo(1 / (1 + 10 ** (300 / 400)), 9);
  });

  it('uses the mapped knobs for each competency', () => {
    const d: Difficulty = {
      threatCount: 0.2,
      speed: 0.4,
      altitude: 0.6,
      evasiveness: 0.8,
      ambiguity: 0.3,
      degradation: 0.5,
      timePressure: 0.7,
    };
    expect(levelFor('detect', d)).toBeCloseTo((0.4 + 0.7 + 0.6 + 0.5) / 4, 9);
    expect(levelFor('classify', d)).toBeCloseTo((0.3 + 0.5) / 2, 9);
    expect(levelFor('prioritise', d)).toBeCloseTo((0.2 + 0.7) / 2, 9);
    expect(levelFor('engage', d)).toBeCloseTo((0.2 + 0.8 + 0.7) / 3, 9);
    expect(levelFor('roe', d)).toBeCloseTo(0.3, 9);
    expect(levelFor('trust', d)).toBeCloseTo((0.5 * 0.3 + 0.2 * 0.5) / 0.7, 9);
  });

  it('skips competencies whose stage was dropped', () => {
    const next = updateSkill(
      createProfile('t'),
      reportWith(100),
      extrasWith({ droppedStages: ['classification', 'assessment'] }),
      uniform(0.5),
    );
    expect(next.ratings.classify).toBe(INITIAL_RATING);
    expect(next.ratings.prioritise).toBe(INITIAL_RATING);
    expect(next.ratings.detect).toBeGreaterThan(INITIAL_RATING);

    const noEngagement = updateSkill(
      createProfile('t'),
      reportWith(100),
      extrasWith({ droppedStages: ['engagement'] }),
      uniform(0.5),
    );
    expect(noEngagement.ratings.engage).toBe(INITIAL_RATING);
    expect(noEngagement.ratings.roe).toBe(INITIAL_RATING);
  });

  it('skips trust when there were no scored assistant suggestions', () => {
    const next = updateSkill(
      createProfile('t'),
      reportWith(100),
      extrasWith({ trustSamples: 0 }),
      uniform(0.5),
    );
    expect(next.ratings.trust).toBe(INITIAL_RATING);
    expect(next.ratings.detect).toBeGreaterThan(INITIAL_RATING);
  });

  it('returns a new profile without mutating the input', () => {
    const profile = createProfile('t');
    const snapshot = structuredClone(profile);
    const next = updateSkill(profile, reportWith(90), extrasWith(), uniform(0.4));
    expect(profile).toEqual(snapshot);
    expect(next).not.toBe(profile);
    expect(next.ratings).not.toBe(profile.ratings);
    expect(next.history).not.toBe(profile.history);
    expect(next.sessions).toBe(1);
    expect(next.history).toHaveLength(1);
    expect(next.history[0]!.difficulty).toEqual(uniform(0.4));
    expect(next.history[0]!.ratings).toEqual(next.ratings);
  });
});

describe('controller', () => {
  const scoreOf = (profile: SkillProfile, score: number, extras = extrasWith()) =>
    updateSkill(profile, reportWith(score), extras, uniform(0.5));

  it('starts every level at 0.3 and every smoothed score at 0.75', () => {
    const profile = createProfile('t');
    for (const key of COMPETENCY_KEYS) {
      expect(profile.levels[key]).toBe(INITIAL_LEVEL);
      expect(profile.smoothed[key]).toBe(INITIAL_SMOOTHED);
    }
    expect(INITIAL_LEVEL).toBe(0.3);
    expect(INITIAL_SMOOTHED).toBe(0.75);
  });

  it('smooths the score and steps the level proportionally to the error', () => {
    const next = scoreOf(createProfile('t'), 85);
    expect(next.smoothed.detect).toBeCloseTo(0.5 * 0.75 + 0.5 * 0.85, 9);
    expect(next.levels.detect).toBeCloseTo(0.3 + 0.6 * (0.8 - 0.75), 9);

    const poor = scoreOf(createProfile('t'), 65);
    expect(poor.smoothed.detect).toBeCloseTo(0.7, 9);
    expect(poor.levels.detect).toBeCloseTo(0.3 + 0.6 * (0.7 - 0.75), 9);
  });

  it('clamps the step to 0.12 and the level to [0.05, 0.95]', () => {
    const first = scoreOf(createProfile('t'), 100);
    expect(first.smoothed.detect).toBeCloseTo(0.875, 9);
    expect(first.levels.detect).toBeCloseTo(0.3 + 0.6 * 0.125, 9);

    const steps: number[] = [];
    let rising = createProfile('t');
    for (let i = 0; i < 6; i++) {
      const next = scoreOf(rising, 100);
      steps.push(next.levels.detect - rising.levels.detect);
      rising = next;
    }
    expect(Math.max(...steps)).toBeCloseTo(0.12, 9);
    expect(steps[2]).toBeCloseTo(0.12, 9);
    for (const step of steps) expect(step).toBeLessThanOrEqual(0.12 + 1e-9);

    const down = scoreOf(createProfile('t'), 0);
    expect(down.levels.detect).toBeCloseTo(0.3 - 0.12, 9);

    let falling = createProfile('t');
    for (let i = 0; i < 20; i++) {
      rising = scoreOf(rising, 100);
      falling = scoreOf(falling, 0);
    }
    expect(rising.levels.detect).toBeCloseTo(0.95, 9);
    expect(falling.levels.detect).toBeCloseTo(0.05, 9);
  });

  it('holds the level when the smoothed score sits on the setpoint', () => {
    const next = scoreOf(createProfile('t'), 75);
    expect(next.levels.detect).toBeCloseTo(0.3, 9);
  });

  it('leaves levels and smoothed scores of skipped competencies unchanged', () => {
    const next = scoreOf(
      createProfile('t'),
      100,
      extrasWith({ droppedStages: ['classification', 'engagement'], trustSamples: 0 }),
    );
    for (const key of ['classify', 'engage', 'roe', 'trust'] as const) {
      expect(next.levels[key]).toBe(INITIAL_LEVEL);
      expect(next.smoothed[key]).toBe(INITIAL_SMOOTHED);
    }
    expect(next.levels.detect).toBeGreaterThan(INITIAL_LEVEL);
    expect(next.levels.prioritise).toBeGreaterThan(INITIAL_LEVEL);
  });

  it('records levels in the history and does not mutate the input', () => {
    const profile = createProfile('t');
    const snapshot = structuredClone(profile);
    const next = scoreOf(profile, 90);
    expect(profile).toEqual(snapshot);
    expect(next.levels).not.toBe(profile.levels);
    expect(next.smoothed).not.toBe(profile.smoothed);
    expect(next.history[0]!.levels).toEqual(next.levels);
  });

  it('keeps the Elo update independent of the controller', () => {
    const next = scoreOf(createProfile('t'), 90);
    const expected = expectedSuccess(1000, levelFor('detect', uniform(0.5)));
    expect(next.ratings.detect).toBeCloseTo(1000 + 100 * (0.9 - expected), 9);
  });

  it('accepts a legacy profile that has no levels', () => {
    const legacy = {
      ...createProfile('t'),
      levels: undefined,
      smoothed: undefined,
    } as unknown as SkillProfile;
    const next = scoreOf(legacy, 100);
    expect(next.levels.detect).toBeCloseTo(0.375, 9);
    expect(Object.values(nextDifficulty(legacy, 1)).every(Number.isFinite)).toBe(true);
  });
});

describe('nextDifficulty', () => {
  const levelsProfile = (
    levels: Partial<Ratings>,
    ratings: Partial<Ratings> = {},
  ): SkillProfile => ({
    ...createProfile('t'),
    levels: { ...createProfile('t').levels, ...levels },
    ratings: { ...createProfile('t').ratings, ...ratings },
  });

  it('gives each knob the mean level of the competencies that own it', () => {
    const profile = levelsProfile(
      { detect: 0.8, classify: 0.2, prioritise: 0.6, engage: 0.4, roe: 0.5, trust: 0.9 },
      { detect: 900 },
    );
    const d = nextDifficulty(profile, withoutExploration());
    expect(d.speed).toBeCloseTo(0.8 + 0.1, 3);
    expect(d.altitude).toBeCloseTo(0.8 + 0.1, 3);
    expect(d.threatCount).toBeCloseTo((0.6 + 0.4) / 2, 3);
    expect(d.evasiveness).toBeCloseTo(0.4, 3);
    expect(d.ambiguity).toBeCloseTo((0.2 + 0.5 + 0.9) / 3, 3);
    expect(d.degradation).toBeCloseTo(Math.min(1, (0.8 + 0.2 + 0.9) / 3 + 0.1), 3);
    expect(d.timePressure).toBeCloseTo(Math.min(1, (0.8 + 0.6 + 0.4) / 3 + 0.1), 3);
  });

  it('adds the +0.1 emphasis to the knobs of the weakest competency by Elo rating', () => {
    const base = levelsProfile({
      detect: 0.5,
      classify: 0.5,
      prioritise: 0.5,
      engage: 0.5,
      roe: 0.5,
      trust: 0.5,
    });
    const seed = withoutExploration();
    const plain = nextDifficulty(base, seed);
    for (const knob of KNOB_KEYS) {
      const boost = ownedKnobs('detect').includes(knob) ? 0.1 : 0;
      expect(plain[knob]).toBeCloseTo(0.5 + boost, 3);
    }

    const weakClassify = nextDifficulty(
      { ...base, ratings: { ...base.ratings, classify: 900 } },
      seed,
    );
    expect(weakClassify.ambiguity).toBeCloseTo(0.6, 3);
    expect(weakClassify.degradation).toBeCloseTo(0.6, 3);
    expect(weakClassify.speed).toBeCloseTo(0.5, 3);
    expect(weakClassify.threatCount).toBeCloseTo(0.5, 3);
  });

  it('returns exactly the seven schema fields', () => {
    const d = nextDifficulty(createProfile('t'), 1);
    expect(Object.keys(d).sort()).toEqual([...KNOB_KEYS].sort());
  });

  it('clamps every knob to [0, 1]', () => {
    const all = (value: number) => ({
      detect: value,
      classify: value,
      prioritise: value,
      engage: value,
      roe: value,
      trust: value,
    });
    const high = levelsProfile(all(0.95));
    const low = levelsProfile(all(0.05));
    for (let seed = 1; seed <= 200; seed++) {
      for (const profile of [high, low]) {
        const d = nextDifficulty(profile, seed);
        for (const knob of KNOB_KEYS) {
          expect(d[knob]).toBeGreaterThanOrEqual(0);
          expect(d[knob]).toBeLessThanOrEqual(1);
        }
      }
    }
    const top = nextDifficulty(high, withoutExploration());
    expect(Math.max(...Object.values(top))).toBe(1);
  });

  it('is deterministic for a seed', () => {
    const profile = levelsProfile({ detect: 0.6, classify: 0.4 });
    expect(nextDifficulty(profile, 42)).toEqual(nextDifficulty(profile, 42));
  });

  it('jitters every knob only when exploration triggers', () => {
    const profile = levelsProfile({ detect: 0.6, classify: 0.4, engage: 0.7 });
    const baseline = nextDifficulty(profile, withoutExploration());
    expect(nextDifficulty(profile, withoutExploration())).toEqual(baseline);

    const explored = nextDifficulty(profile, withExploration());
    expect(explored).not.toEqual(baseline);
    for (const knob of KNOB_KEYS) {
      expect(Math.abs(explored[knob] - baseline[knob])).toBeLessThanOrEqual(0.1 + 1e-9);
    }

    let differing = 0;
    for (let seed = 1; seed <= 400; seed++) {
      if (JSON.stringify(nextDifficulty(profile, seed)) !== JSON.stringify(baseline)) {
        differing += 1;
      }
    }
    expect(differing).toBeGreaterThan(10);
    expect(differing).toBeLessThan(100);
  });
});

describe('examConfig', () => {
  it('returns the same fixed configuration for a unit', () => {
    const difficulty = uniform(0.5);
    const a = examConfig(7101, difficulty);
    const b = examConfig(7101, difficulty);
    expect(a).toEqual(b);
    expect(a).toEqual({ seed: 7101, difficulty });
    expect(a.difficulty).not.toBe(difficulty);
  });
});
