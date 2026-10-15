import { z } from 'zod';
import { examConfig } from '../engine/adaptive';
import { simulateTraining } from '../engine/training';
import {
  ExamRecordSchema,
  SessionRecordSchema,
  SkillProfileSchema,
  TraineeRecordSchema,
  UnitRecordSchema,
  type ExamRecord,
  type SessionRecord,
  type TraineeRecord,
  type UnitRecord,
} from './records';
import type { SkillProfile } from '../engine/adaptive';

export const DEMO_PREFIX = 'demo-';
export const DEMO_SESSIONS_PER_TRAINEE = 12;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const BASE_TIME_MS = Date.UTC(2026, 8, 1, 9, 0, 0);

export const DemoDataSchema = z.object({
  version: z.literal(1),
  units: z.array(UnitRecordSchema),
  trainees: z.array(TraineeRecordSchema),
  exams: z.array(ExamRecordSchema),
  sessions: z.array(SessionRecordSchema),
  skillProfiles: z.array(SkillProfileSchema),
});

export type DemoData = z.infer<typeof DemoDataSchema>;

interface TraineePlan {
  callsign: string;
  skill: number;
  trustBias: number;
}

interface UnitPlan {
  id: string;
  name: string;
  examSeed: number;
  trainees: TraineePlan[];
}

const UNIT_PLANS: UnitPlan[] = [
  {
    id: `${DEMO_PREFIX}alpha`,
    name: 'Alpha',
    examSeed: 7101,
    trainees: [
      { callsign: 'Falcon', skill: 0.15, trustBias: 0.7 },
      { callsign: 'Kestrel', skill: 0.3, trustBias: 0.5 },
      { callsign: 'Harrier', skill: 0.45, trustBias: 0.3 },
      { callsign: 'Osprey', skill: 0.6, trustBias: 0.15 },
    ],
  },
  {
    id: `${DEMO_PREFIX}bravo`,
    name: 'Bravo',
    examSeed: 7202,
    trainees: [
      { callsign: 'Condor', skill: 0.2, trustBias: 0.6 },
      { callsign: 'Merlin', skill: 0.35, trustBias: 0.4 },
      { callsign: 'Sparrow', skill: 0.55, trustBias: 0.25 },
      { callsign: 'Eagle', skill: 0.7, trustBias: 0.1 },
    ],
  },
];

const EXAM_DIFFICULTY = {
  threatCount: 0.5,
  speed: 0.5,
  altitude: 0.5,
  evasiveness: 0.5,
  ambiguity: 0.5,
  degradation: 0.5,
  timePressure: 0.5,
};

export function buildDemoData(): DemoData {
  const units: UnitRecord[] = [];
  const trainees: TraineeRecord[] = [];
  const exams: ExamRecord[] = [];
  const sessions: SessionRecord[] = [];
  const skillProfiles: SkillProfile[] = [];

  UNIT_PLANS.forEach((unit, unitIndex) => {
    units.push({ id: unit.id, name: unit.name, createdAt: BASE_TIME_MS - DAY_MS });

    const config = examConfig(unit.examSeed, EXAM_DIFFICULTY);
    exams.push({
      id: `${unit.id}-exam`,
      unitId: unit.id,
      seed: config.seed,
      difficulty: config.difficulty,
      createdAt: BASE_TIME_MS - DAY_MS,
    });

    unit.trainees.forEach((plan, traineeIndex) => {
      const traineeId = `${unit.id}-${String(traineeIndex + 1).padStart(2, '0')}`;
      trainees.push({
        id: traineeId,
        name: plan.callsign,
        unitId: unit.id,
        createdAt: BASE_TIME_MS - DAY_MS,
      });

      const run = simulateTraining({
        traineeId,
        sessions: DEMO_SESSIONS_PER_TRAINEE,
        skill: plan.skill,
        trustBias: plan.trustBias,
        seed: 1000 + unitIndex * 100 + traineeIndex * 17,
        exam: {
          sessionIndex: DEMO_SESSIONS_PER_TRAINEE - 1,
          seed: config.seed,
          difficulty: config.difficulty,
        },
      });

      run.forEach((session) => {
        sessions.push({
          id: session.sessionId,
          traineeId,
          unitId: unit.id,
          scenarioId: session.spec.id,
          spec: session.spec,
          log: session.log,
          endedAtSec: session.endedAtSec,
          report: session.report,
          extras: session.extras,
          createdAt:
            BASE_TIME_MS + session.index * DAY_MS + (unitIndex * 4 + traineeIndex) * HOUR_MS,
        });
      });

      const last = run[run.length - 1];
      if (last) skillProfiles.push(last.profile);
    });
  });

  return { version: 1, units, trainees, exams, sessions, skillProfiles };
}
