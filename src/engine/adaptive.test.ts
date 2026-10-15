import { describe, expect, it } from 'vitest';
import type { Competencies, Difficulty, ScoreReport } from '../schema';
import { mulberry32 } from '../shared/prng';
import {
  COMPETENCY_KEYS,
  INITIAL_RATING,
  KNOB_KEYS,
  createProfile,
  examConfig,
  expectedSuccess,
  levelFor,
  nextDifficulty,
  targetLevel,
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

  it('applies the Elo formula with K 40 for the first five sessions and 24 after', () => {
    const level = 0.5;
    const expected = expectedSuccess(1000, level);
    const early = updateSkill(createProfile('t'), reportWith(80), extrasWith(), uniform(level));
    expect(early.ratings.detect).toBeCloseTo(1000 + 40 * (0.8 - expected), 6);

    const late = updateSkill(profileWith({}, 5), reportWith(80), extrasWith(), uniform(level));
    expect(late.ratings.detect).toBeCloseTo(1000 + 24 * (0.8 - expected), 6);
  });

  it('rates harder scenarios more generously', () => {
    const easy = updateSkill(createProfile('t'), reportWith(70), extrasWith(), uniform(0.2));
    const hard = updateSkill(createProfile('t'), reportWith(70), extrasWith(), uniform(0.9));
    expect(hard.ratings.detect).toBeGreaterThan(easy.ratings.detect);
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

describe('nextDifficulty', () => {
  it('targets about 70% expected success', () => {
    for (const rating of [850, 1000, 1200, 1400]) {
      const level = targetLevel(rating);
      expect(expectedSuccess(rating, level)).toBeCloseTo(0.7, 2);
    }
  });

  it('gives the weakest competency knobs the +0.1 emphasis', () => {
    const profile = profileWith({
      detect: 1400,
      classify: 1000,
      prioritise: 1400,
      engage: 1400,
      roe: 1400,
      trust: 1400,
    });
    const d = nextDifficulty(profile, withoutExploration());
    const high = targetLevel(1400);
    const low = targetLevel(1000);

    expect(d.ambiguity).toBeCloseTo(Math.min(1, (low + high + high) / 3 + 0.1), 3);
    expect(d.degradation).toBeCloseTo(Math.min(1, (high + low + high) / 3 + 0.1), 3);
    expect(d.speed).toBeCloseTo(high, 3);
    expect(d.threatCount).toBeCloseTo(high, 3);
    expect(d.evasiveness).toBeCloseTo(high, 3);
  });

  it('returns exactly the seven schema fields', () => {
    const d = nextDifficulty(createProfile('t'), 1);
    expect(Object.keys(d).sort()).toEqual([...KNOB_KEYS].sort());
  });

  it('clamps every knob to [0, 1]', () => {
    const high = nextDifficulty(
      profileWith({
        detect: 4000,
        classify: 4000,
        prioritise: 4000,
        engage: 4000,
        roe: 4000,
        trust: 4000,
      }),
      withoutExploration(),
    );
    const low = nextDifficulty(
      profileWith({
        detect: -2000,
        classify: -2000,
        prioritise: -2000,
        engage: -2000,
        roe: -2000,
        trust: -2000,
      }),
      withoutExploration(),
    );
    for (const knob of KNOB_KEYS) {
      expect(high[knob]).toBeLessThanOrEqual(1);
      expect(high[knob]).toBeGreaterThanOrEqual(0.95);
      expect(low[knob]).toBeGreaterThanOrEqual(0);
      expect(low[knob]).toBeLessThanOrEqual(0.2);
    }
    for (let seed = 1; seed <= 200; seed++) {
      const d = nextDifficulty(profileWith({ detect: 4000, classify: -2000 }), seed);
      for (const knob of KNOB_KEYS) {
        expect(d[knob]).toBeGreaterThanOrEqual(0);
        expect(d[knob]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is deterministic for a seed', () => {
    const profile = profileWith({ detect: 1100, classify: 900 });
    expect(nextDifficulty(profile, 42)).toEqual(nextDifficulty(profile, 42));
  });

  it('jitters every knob only when exploration triggers', () => {
    const profile = profileWith({ detect: 1100, classify: 900, engage: 1200 });
    const baseline = nextDifficulty(profile, withoutExploration());
    expect(nextDifficulty(profile, withoutExploration())).toEqual(baseline);

    const explored = nextDifficulty(profile, withExploration());
    expect(explored).not.toEqual(baseline);
    for (const knob of KNOB_KEYS) {
      expect(Math.abs(explored[knob] - baseline[knob])).toBeLessThanOrEqual(0.1 + 1e-9);
    }

    let differing = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const d = nextDifficulty(profile, seed);
      if (JSON.stringify(d) !== JSON.stringify(baseline)) differing += 1;
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
