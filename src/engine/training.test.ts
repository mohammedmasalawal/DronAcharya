import { describe, expect, it } from 'vitest';
import { replayEvents } from '../sim';
import { COMPETENCY_KEYS, INITIAL_RATING, examConfig } from './adaptive';
import { simulateTraining } from './training';

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const meanDifficulty = (d: Record<string, number>) => mean(Object.values(d));

describe('simulateTraining', () => {
  it('is deterministic and needs no database', () => {
    const options = { traineeId: 'a', sessions: 4, skill: 0.4, trustBias: 0.3, seed: 9 };
    expect(simulateTraining(options)).toEqual(simulateTraining(options));
  });

  it('raises skill and lowers trust bias per session, both clamped', () => {
    const run = simulateTraining({
      traineeId: 'a',
      sessions: 6,
      skill: 0.9,
      trustBias: 0.05,
      learningRate: 0.04,
      seed: 3,
    });
    expect(run.map((s) => s.skill)).toEqual(
      [0.9, 0.94, 0.98, 1, 1, 1].map((v) => expect.closeTo(v, 6)),
    );
    expect(run.map((s) => s.trustBias)).toEqual(
      [0.05, 0.02, 0, 0, 0, 0].map((v) => expect.closeTo(v, 6)),
    );
  });

  it('updates the profile with every session and records the served difficulty', () => {
    const run = simulateTraining({
      traineeId: 'a',
      sessions: 5,
      skill: 0.5,
      trustBias: 0.2,
      seed: 4,
    });
    run.forEach((session, index) => {
      expect(session.profile.sessions).toBe(index + 1);
      expect(session.profile.history).toHaveLength(index + 1);
      expect(session.profile.history[index]!.difficulty).toEqual(session.spec.difficulty);
      expect(session.difficulty).toEqual(session.spec.difficulty);
    });
  });

  it('produces replayable logs and ids in the session id format', () => {
    const run = simulateTraining({
      traineeId: 'cadet-7',
      sessions: 3,
      skill: 0.6,
      trustBias: 0.2,
      seed: 5,
    });
    for (const session of run) {
      expect(replayEvents(session.spec, session.log)).toEqual(session.log.events);
      expect(session.log.traineeId).toBe('cadet-7');
      expect(session.sessionId).toBe(`${session.spec.id}:cadet-7:1`);
      expect(session.report.sessionId).toBe(session.sessionId);
    }
  });

  it('gives a whole unit an identical exam on the common seed', () => {
    const config = examConfig(7101, {
      threatCount: 0.5,
      speed: 0.5,
      altitude: 0.5,
      evasiveness: 0.5,
      ambiguity: 0.5,
      degradation: 0.5,
      timePressure: 0.5,
    });
    const exam = { sessionIndex: 2, seed: config.seed, difficulty: config.difficulty };
    const a = simulateTraining({
      traineeId: 'a',
      sessions: 3,
      skill: 0.2,
      trustBias: 0.6,
      seed: 1,
      exam,
    });
    const b = simulateTraining({
      traineeId: 'b',
      sessions: 3,
      skill: 0.7,
      trustBias: 0.1,
      seed: 2,
      exam,
    });

    expect(a[2]!.isExam).toBe(true);
    expect(a[2]!.spec).toEqual(b[2]!.spec);
    expect(a[0]!.spec).not.toEqual(b[0]!.spec);
    expect(a[2]!.log.events).not.toEqual(b[2]!.log.events);
  });

  it('continues from an existing profile and history', () => {
    const first = simulateTraining({
      traineeId: 'a',
      sessions: 3,
      skill: 0.4,
      trustBias: 0.3,
      seed: 6,
    });
    const second = simulateTraining({
      traineeId: 'a',
      sessions: 2,
      skill: 0.5,
      trustBias: 0.2,
      seed: 7,
      profile: first[2]!.profile,
      history: first.map((s) => s.spec),
    });
    expect(second[0]!.profile.sessions).toBe(4);
    expect(second[1]!.profile.sessions).toBe(5);
  });
});

describe('adaptive responsiveness for a skill 0.3 trainee over 12 sessions', () => {
  const runs = [1, 2, 3, 4, 5, 6].map((seed) =>
    simulateTraining({ traineeId: 'cadet', sessions: 12, skill: 0.3, trustBias: 0.5, seed }),
  );
  const first = (run: (typeof runs)[number]) => run.slice(0, 3);
  const last = (run: (typeof runs)[number]) => run.slice(-3);

  it('raises the mean difficulty of the last 3 sessions by at least 0.12 over the first 3', () => {
    const gains = runs.map(
      (run) =>
        mean(last(run).map((s) => meanDifficulty(s.difficulty))) -
        mean(first(run).map((s) => meanDifficulty(s.difficulty))),
    );
    expect(mean(gains)).toBeGreaterThanOrEqual(0.12);
    for (const gain of gains) expect(gain).toBeGreaterThan(0.08);
  }, 120_000);

  it('raises the mean total of the last 3 sessions over the first 3', () => {
    const gains = runs.map(
      (run) =>
        mean(last(run).map((s) => s.report.total)) - mean(first(run).map((s) => s.report.total)),
    );
    expect(mean(gains)).toBeGreaterThan(0);
  }, 120_000);

  it('never ends a fully scored competency more than 40 rating points below its start', () => {
    const stageFor = {
      detect: 'detection',
      classify: 'classification',
      prioritise: 'assessment',
      engage: 'engagement',
      roe: 'engagement',
    } as const;

    for (const run of runs) {
      const final = run[run.length - 1]!.profile.ratings;
      for (const key of COMPETENCY_KEYS) {
        const scoredEvery = run.every((session) =>
          key === 'trust'
            ? session.extras.trustSamples > 0
            : !session.extras.droppedStages.includes(stageFor[key]),
        );
        if (scoredEvery) expect(final[key]).toBeGreaterThanOrEqual(INITIAL_RATING - 40);
      }
    }
  }, 120_000);
});
