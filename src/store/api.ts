import { createProfile, updateSkill, type SkillProfile } from '../engine/adaptive';
import { DEFAULT_TREE } from '../engine/defaultTree';
import { generateScenario } from '../engine/generator';
import { analyseSession, type AnalysisExtras } from '../engine/scoring';
import { sessionIdFor, simulateTraining, type TrainingOptions } from '../engine/training';
import type { Difficulty, ScenarioSpec, ScoreReport, SessionLog } from '../schema';
import { db } from './db';
import { DemoDataSchema, DEMO_PREFIX } from './demoData';
import { DEFAULT_EXAM_DIFFICULTY, seedForExam } from './exam';
import type { ExamRecord, SessionRecord, TraineeRecord, UnitRecord } from './records';

export interface SaveSessionInput {
  spec: ScenarioSpec;
  log: SessionLog;
  endedAtSec: number;
  traineeId: string;
  unitId: string;
  examId?: string;
}

export interface UnitReport {
  sessionId: string;
  traineeId: string;
  scenarioId: string;
  createdAt: number;
  report: ScoreReport;
  extras: AnalysisExtras;
}

export interface DemoImportCounts {
  units: number;
  trainees: number;
  exams: number;
  sessions: number;
  skillProfiles: number;
}

const HISTORY_FOR_NOVELTY = 8;

function byCreatedThenId(a: SessionRecord, b: SessionRecord): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id, undefined, { numeric: true });
}

export async function saveSession(input: SaveSessionInput): Promise<string> {
  const { spec, traineeId, unitId } = input;

  return db.transaction('rw', [db.units, db.trainees, db.sessions, db.skillProfiles], async () => {
    const now = Date.now();

    if (!(await db.units.get(unitId))) {
      await db.units.put({ id: unitId, name: unitId, createdAt: now });
    }
    if (!(await db.trainees.get(traineeId))) {
      await db.trainees.put({ id: traineeId, name: traineeId, unitId, createdAt: now });
    }

    const previous = await db.sessions
      .where('traineeId')
      .equals(traineeId)
      .filter((session) => session.scenarioId === spec.id)
      .count();
    const id = sessionIdFor(spec.id, traineeId, previous + 1);

    const log: SessionLog = { ...input.log, scenarioId: spec.id, traineeId };
    const analysis = analyseSession(spec, log, DEFAULT_TREE);
    const report: ScoreReport = { ...analysis.report, sessionId: id };

    const profile = (await db.skillProfiles.get(traineeId)) ?? createProfile(traineeId);
    const updated = updateSkill(profile, report, analysis.extras, spec.difficulty);

    await db.sessions.add({
      id,
      traineeId,
      unitId,
      scenarioId: spec.id,
      spec,
      log,
      endedAtSec: input.endedAtSec,
      report,
      extras: analysis.extras,
      ...(input.examId === undefined ? {} : { examId: input.examId }),
      createdAt: now,
    });
    await db.skillProfiles.put(updated);

    return id;
  });
}

export async function getExam(id: string): Promise<ExamRecord | undefined> {
  return db.exams.get(id);
}

export async function listAllSessions(): Promise<SessionRecord[]> {
  const rows = await db.sessions.toArray();
  return rows.sort(byCreatedThenId).reverse();
}

export async function countSessions(): Promise<number> {
  return db.sessions.count();
}

export async function listUnitSessions(unitId: string): Promise<SessionRecord[]> {
  const rows = await db.sessions.where('unitId').equals(unitId).toArray();
  return rows.sort(byCreatedThenId);
}

export async function getUnit(id: string): Promise<UnitRecord | undefined> {
  return db.units.get(id);
}

export async function getTrainee(id: string): Promise<TraineeRecord | undefined> {
  return db.trainees.get(id);
}

export async function getSession(id: string): Promise<SessionRecord | undefined> {
  return db.sessions.get(id);
}

export async function listSessions(traineeId: string): Promise<SessionRecord[]> {
  const rows = await db.sessions.where('traineeId').equals(traineeId).toArray();
  return rows.sort(byCreatedThenId);
}

export async function listUnitReports(unitId: string): Promise<UnitReport[]> {
  const rows = await db.sessions.where('unitId').equals(unitId).toArray();
  return rows.sort(byCreatedThenId).map((row) => ({
    sessionId: row.id,
    traineeId: row.traineeId,
    scenarioId: row.scenarioId,
    createdAt: row.createdAt,
    report: row.report,
    extras: row.extras,
  }));
}

export async function getProfile(traineeId: string): Promise<SkillProfile | undefined> {
  return db.skillProfiles.get(traineeId);
}

export async function saveProfile(profile: SkillProfile): Promise<void> {
  await db.skillProfiles.put(profile);
}

export async function createExam(input: {
  id: string;
  unitId: string;
  seed: number;
  difficulty: Difficulty;
}): Promise<ExamRecord> {
  const record: ExamRecord = { ...input, createdAt: Date.now() };
  await db.exams.put(record);
  return record;
}

export async function listExams(unitId: string): Promise<ExamRecord[]> {
  const rows = await db.exams.where('unitId').equals(unitId).toArray();
  return rows.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export async function resolveExam(examId: string): Promise<ScenarioSpec> {
  const exam = await db.exams.get(examId);
  if (exam) return generateScenario(exam.seed, exam.difficulty, []);
  return generateScenario(seedForExam(examId), DEFAULT_EXAM_DIFFICULTY, []);
}

export async function listUnits(): Promise<UnitRecord[]> {
  const rows = await db.units.toArray();
  return rows.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export async function listTrainees(unitId: string): Promise<TraineeRecord[]> {
  const rows = await db.trainees.where('unitId').equals(unitId).toArray();
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

export async function saveUnit(unit: { id: string; name: string }): Promise<void> {
  const existing = await db.units.get(unit.id);
  await db.units.put({ ...unit, createdAt: existing?.createdAt ?? Date.now() });
}

export async function saveTrainee(trainee: {
  id: string;
  name: string;
  unitId: string;
}): Promise<void> {
  const existing = await db.trainees.get(trainee.id);
  await db.trainees.put({ ...trainee, createdAt: existing?.createdAt ?? Date.now() });
}

export type TrainingLoopOptions = Omit<TrainingOptions, 'traineeId' | 'profile' | 'history'>;

export async function runTrainingLoop(
  traineeId: string,
  unitId: string,
  options: TrainingLoopOptions,
): Promise<string[]> {
  const profile = await getProfile(traineeId);
  const past = await listSessions(traineeId);
  const run = simulateTraining({
    ...options,
    traineeId,
    profile,
    history: past.slice(-HISTORY_FOR_NOVELTY).map((row) => row.spec),
  });

  const ids: string[] = [];
  for (const session of run) {
    ids.push(
      await saveSession({
        spec: session.spec,
        log: session.log,
        endedAtSec: session.endedAtSec,
        traineeId,
        unitId,
        ...(session.isExam && options.exam?.id ? { examId: options.exam.id } : {}),
      }),
    );
  }
  return ids;
}

async function addMissing<T>(
  keys: string[],
  rows: T[],
  exists: (keys: string[]) => Promise<boolean[]>,
  add: (rows: T[]) => Promise<unknown>,
): Promise<number> {
  const present = await exists(keys);
  const fresh = rows.filter((_, index) => !present[index]);
  if (fresh.length > 0) await add(fresh);
  return fresh.length;
}

export async function importDemoData(json: unknown): Promise<DemoImportCounts> {
  const data = DemoDataSchema.parse(json);

  return db.transaction(
    'rw',
    [db.units, db.trainees, db.exams, db.sessions, db.skillProfiles],
    async () => ({
      units: await addMissing(
        data.units.map((row) => row.id),
        data.units,
        async (keys) => (await db.units.bulkGet(keys)).map((row) => row !== undefined),
        (rows) => db.units.bulkAdd(rows),
      ),
      trainees: await addMissing(
        data.trainees.map((row) => row.id),
        data.trainees,
        async (keys) => (await db.trainees.bulkGet(keys)).map((row) => row !== undefined),
        (rows) => db.trainees.bulkAdd(rows),
      ),
      exams: await addMissing(
        data.exams.map((row) => row.id),
        data.exams,
        async (keys) => (await db.exams.bulkGet(keys)).map((row) => row !== undefined),
        (rows) => db.exams.bulkAdd(rows),
      ),
      sessions: await addMissing(
        data.sessions.map((row) => row.id),
        data.sessions,
        async (keys) => (await db.sessions.bulkGet(keys)).map((row) => row !== undefined),
        (rows) => db.sessions.bulkAdd(rows),
      ),
      skillProfiles: await addMissing(
        data.skillProfiles.map((row) => row.traineeId),
        data.skillProfiles,
        async (keys) => (await db.skillProfiles.bulkGet(keys)).map((row) => row !== undefined),
        (rows) => db.skillProfiles.bulkAdd(rows),
      ),
    }),
  );
}

export async function resetDemoData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.units, db.trainees, db.exams, db.sessions, db.skillProfiles],
    async () => {
      await db.sessions.where('traineeId').startsWith(DEMO_PREFIX).delete();
      await db.skillProfiles.where('traineeId').startsWith(DEMO_PREFIX).delete();
      await db.trainees.where('id').startsWith(DEMO_PREFIX).delete();
      await db.exams.where('id').startsWith(DEMO_PREFIX).delete();
      await db.units.where('id').startsWith(DEMO_PREFIX).delete();
    },
  );
}
