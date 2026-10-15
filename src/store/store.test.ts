import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { specForExam } from '../client/exam';
import { generateScenario } from '../engine/generator';
import { runBot } from '../engine/bots';
import type { Difficulty, ScenarioSpec } from '../schema';
import {
  DEFAULT_EXAM_DIFFICULTY,
  DemoDataSchema,
  buildDemoData,
  createExam,
  db,
  getProfile,
  getSession,
  importDemoData,
  listExams,
  listSessions,
  listTrainees,
  listUnitReports,
  listUnits,
  resetDemoData,
  resolveExam,
  runTrainingLoop,
  saveProfile,
  saveSession,
  seedForExam,
  type DemoData,
} from './index';

const uniform = (value: number): Difficulty => ({
  threatCount: value,
  speed: value,
  altitude: value,
  evasiveness: value,
  ambiguity: value,
  degradation: value,
  timePressure: value,
});

const play = (spec: ScenarioSpec, traineeId: string, unitId = 'unit-1') => {
  const log = runBot(spec, 'expert', { skill: 0.6, trustBias: 0.2 });
  return { spec, log, endedAtSec: spec.durationSec, traineeId, unitId };
};

async function clearAll(): Promise<void> {
  await Promise.all([
    db.trainees.clear(),
    db.units.clear(),
    db.exams.clear(),
    db.sessions.clear(),
    db.skillProfiles.clear(),
  ]);
}

beforeEach(clearAll);

describe('saveSession', () => {
  const spec = generateScenario(21, uniform(0.4), []);

  it('round trips a session with its report and extras', async () => {
    const input = play(spec, 'ana');
    const id = await saveSession(input);
    expect(id).toBe(`${spec.id}:ana:1`);

    const stored = await getSession(id);
    expect(stored).toBeDefined();
    expect(stored!.id).toBe(id);
    expect(stored!.traineeId).toBe('ana');
    expect(stored!.unitId).toBe('unit-1');
    expect(stored!.scenarioId).toBe(spec.id);
    expect(stored!.spec).toEqual(spec);
    expect(stored!.log.events).toEqual(input.log.events);
    expect(stored!.endedAtSec).toBe(spec.durationSec);
    expect(stored!.report.sessionId).toBe(id);
    expect(stored!.report.total).toBeGreaterThan(0);
    expect(stored!.extras.trustSamples).toBeGreaterThanOrEqual(0);
    expect(stored!.extras.verdicts.length).toBeGreaterThan(0);
    expect(typeof stored!.createdAt).toBe('number');
  });

  it('updates the skill profile through updateSkill', async () => {
    expect(await getProfile('ana')).toBeUndefined();
    await saveSession(play(spec, 'ana'));
    const first = await getProfile('ana');
    expect(first!.sessions).toBe(1);
    expect(first!.history).toHaveLength(1);
    expect(first!.history[0]!.difficulty).toEqual(spec.difficulty);

    await saveSession(play(generateScenario(22, uniform(0.4), []), 'ana'));
    expect((await getProfile('ana'))!.sessions).toBe(2);
  });

  it('numbers sessions per trainee and scenario', async () => {
    const other = generateScenario(23, uniform(0.4), []);
    expect(await saveSession(play(spec, 'ana'))).toBe(`${spec.id}:ana:1`);
    expect(await saveSession(play(spec, 'ana'))).toBe(`${spec.id}:ana:2`);
    expect(await saveSession(play(spec, 'ana'))).toBe(`${spec.id}:ana:3`);
    expect(await saveSession(play(other, 'ana'))).toBe(`${other.id}:ana:1`);
    expect(await saveSession(play(spec, 'ben'))).toBe(`${spec.id}:ben:1`);
  });

  it('creates the unit and trainee when they do not exist', async () => {
    await saveSession(play(spec, 'ana', 'unit-9'));
    expect((await listUnits()).map((u) => u.id)).toEqual(['unit-9']);
    expect((await listTrainees('unit-9')).map((t) => t.id)).toEqual(['ana']);
  });

  it('lists a trainee’s sessions in creation order', async () => {
    const a = generateScenario(31, uniform(0.3), []);
    const b = generateScenario(32, uniform(0.3), []);
    const first = await saveSession(play(a, 'ana'));
    const second = await saveSession(play(b, 'ana'));
    await saveSession(play(a, 'ben'));
    const rows = await listSessions('ana');
    expect(rows.map((r) => r.id)).toEqual([first, second]);
    expect(await listSessions('nobody')).toEqual([]);
  });

  it('lists unit reports across trainees and excludes other units', async () => {
    await saveSession(play(spec, 'ana', 'unit-a'));
    await saveSession(play(spec, 'ben', 'unit-a'));
    await saveSession(play(spec, 'cat', 'unit-b'));
    const reports = await listUnitReports('unit-a');
    expect(reports).toHaveLength(2);
    expect(reports.map((r) => r.traineeId).sort()).toEqual(['ana', 'ben']);
    for (const row of reports) {
      expect(row.report.sessionId).toBe(row.sessionId);
      expect(row.extras).toBeDefined();
    }
    expect(await listUnitReports('unit-c')).toEqual([]);
  });

  it('saves and reads a profile explicitly', async () => {
    await saveSession(play(spec, 'ana'));
    const profile = (await getProfile('ana'))!;
    await saveProfile({ ...profile, ratings: { ...profile.ratings, detect: 1234 } });
    expect((await getProfile('ana'))!.ratings.detect).toBe(1234);
  });
});

describe('exams', () => {
  it('resolves a known exam from the table', async () => {
    await createExam({ id: 'exam-1', unitId: 'unit-1', seed: 4242, difficulty: uniform(0.3) });
    const spec = await resolveExam('exam-1');
    expect(spec).toEqual(generateScenario(4242, uniform(0.3), []));
    expect((await listExams('unit-1')).map((e) => e.id)).toEqual(['exam-1']);
    expect(await listExams('unit-2')).toEqual([]);
  });

  it('gives every trainee the identical scenario for a known exam', async () => {
    await createExam({ id: 'exam-2', unitId: 'unit-1', seed: 99, difficulty: uniform(0.6) });
    expect(await resolveExam('exam-2')).toEqual(await resolveExam('exam-2'));
  });

  it('falls back to the seed for an unknown numeric id', async () => {
    expect(await resolveExam('77')).toEqual(generateScenario(77, DEFAULT_EXAM_DIFFICULTY, []));
    expect(await resolveExam('0012')).toEqual(generateScenario(12, DEFAULT_EXAM_DIFFICULTY, []));
  });

  it('hashes an unknown string id deterministically, exactly like the client', async () => {
    const spec = await resolveExam('EXAM-A');
    expect(spec).toEqual(await resolveExam('EXAM-A'));
    expect(spec).toEqual(specForExam('EXAM-A'));
    expect(spec.seed).not.toBe(seedForExam('EXAM-B'));
  });

  it('treats a numeric string differently from a hashed one', async () => {
    expect(seedForExam('12')).toBe(12);
    expect(seedForExam('x12')).not.toBe(12);
    expect(seedForExam('1234567890')).not.toBe(1234567890);
    expect(await resolveExam('12')).not.toEqual(await resolveExam('x12'));
  });

  it('prefers a stored exam over the numeric fallback', async () => {
    await createExam({ id: '55', unitId: 'unit-1', seed: 8, difficulty: uniform(0.2) });
    expect(await resolveExam('55')).toEqual(generateScenario(8, uniform(0.2), []));
  });
});

describe('demo data', () => {
  let demo: DemoData;

  beforeAll(() => {
    demo = buildDemoData();
  });

  it('builds a valid, consistent demo set', () => {
    expect(() => DemoDataSchema.parse(JSON.parse(JSON.stringify(demo)))).not.toThrow();
    expect(demo.units).toHaveLength(2);
    expect(demo.trainees).toHaveLength(8);
    expect(demo.exams).toHaveLength(2);
    expect(demo.sessions).toHaveLength(96);
    expect(demo.skillProfiles).toHaveLength(8);
    for (const session of demo.sessions) {
      expect(session.report.sessionId).toBe(session.id);
    }
    for (const unit of demo.units) {
      const exam = demo.exams.find((e) => e.unitId === unit.id)!;
      const takers = demo.sessions.filter(
        (s) => s.unitId === unit.id && s.scenarioId === `scn-${exam.seed}`,
      );
      expect(takers).toHaveLength(4);
      expect(new Set(takers.map((s) => JSON.stringify(s.spec))).size).toBe(1);
    }
  }, 60_000);

  it('shows clear improvement across sessions 10 to 12 versus 1 to 3', () => {
    const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
    const gains = demo.trainees.map((trainee) => {
      const rows = demo.sessions
        .filter((s) => s.traineeId === trainee.id)
        .sort((a, b) => a.createdAt - b.createdAt);
      expect(rows).toHaveLength(12);
      return (
        mean(rows.slice(9, 12).map((s) => s.report.total)) -
        mean(rows.slice(0, 3).map((s) => s.report.total))
      );
    });
    expect(gains.filter((gain) => gain > 0).length).toBeGreaterThanOrEqual(6);
    expect(mean(gains)).toBeGreaterThanOrEqual(8);
  });

  it('matches the committed demo file', () => {
    const committed = JSON.parse(readFileSync('data/demo/demo-data.json', 'utf8'));
    expect(JSON.parse(JSON.stringify(demo))).toEqual(committed);
  });

  it('imports idempotently, skipping existing ids', async () => {
    const first = await importDemoData(demo);
    expect(first).toEqual({ units: 2, trainees: 8, exams: 2, sessions: 96, skillProfiles: 8 });
    expect(await db.sessions.count()).toBe(96);

    const second = await importDemoData(demo);
    expect(second).toEqual({ units: 0, trainees: 0, exams: 0, sessions: 0, skillProfiles: 0 });
    expect(await db.sessions.count()).toBe(96);
    expect(await db.trainees.count()).toBe(8);
  }, 60_000);

  it('adds only the missing rows on a partial re-import', async () => {
    await importDemoData(demo);
    await db.sessions.limit(5).delete();
    const again = await importDemoData(demo);
    expect(again.sessions).toBe(5);
    expect(await db.sessions.count()).toBe(96);
  }, 60_000);

  it('exposes imported data through the query helpers', async () => {
    await importDemoData(demo);
    const unit = demo.units[0]!;
    const reports = await listUnitReports(unit.id);
    expect(reports).toHaveLength(48);
    const trainee = demo.trainees.find((t) => t.unitId === unit.id)!;
    expect(await listSessions(trainee.id)).toHaveLength(12);
    expect((await getProfile(trainee.id))!.sessions).toBe(12);
    expect(await listExams(unit.id)).toHaveLength(1);
    const exam = demo.exams.find((e) => e.unitId === unit.id)!;
    expect(await resolveExam(exam.id)).toEqual(generateScenario(exam.seed, exam.difficulty, []));
  }, 60_000);

  it('resets only demo data', async () => {
    await importDemoData(demo);
    await saveSession(play(generateScenario(5, uniform(0.3), []), 'real-trainee', 'real-unit'));
    await resetDemoData();
    expect(await db.sessions.count()).toBe(1);
    expect(await db.trainees.count()).toBe(1);
    expect(await db.units.count()).toBe(1);
    expect(await db.exams.count()).toBe(0);
    expect(await db.skillProfiles.count()).toBe(1);
    expect(await getProfile('real-trainee')).toBeDefined();
  }, 60_000);

  it('rejects malformed demo data', async () => {
    await expect(importDemoData({ version: 2 })).rejects.toThrow();
    expect(await db.sessions.count()).toBe(0);
  });
});

describe('runTrainingLoop', () => {
  it('persists every simulated session and the final profile', async () => {
    const ids = await runTrainingLoop('ana', 'unit-1', {
      sessions: 4,
      skill: 0.4,
      trustBias: 0.3,
      seed: 5,
    });
    expect(ids).toHaveLength(4);
    expect((await listSessions('ana')).map((s) => s.id)).toEqual(ids);
    const profile = (await getProfile('ana'))!;
    expect(profile.sessions).toBe(4);
    expect(profile.history).toHaveLength(4);
  }, 60_000);

  it('continues from the stored profile on a second run', async () => {
    await runTrainingLoop('ana', 'unit-1', { sessions: 2, skill: 0.4, trustBias: 0.3, seed: 5 });
    await runTrainingLoop('ana', 'unit-1', { sessions: 2, skill: 0.5, trustBias: 0.2, seed: 6 });
    expect((await getProfile('ana'))!.sessions).toBe(4);
    expect(await listSessions('ana')).toHaveLength(4);
  }, 60_000);
});
