import { z } from 'zod';
import {
  CompetenciesSchema,
  ConditionId,
  DifficultySchema,
  ScenarioSpecSchema,
  ScoreReportSchema,
  SessionLogSchema,
  Stage,
} from '../schema';

export const RatingsSchema = z.object({
  detect: z.number(),
  classify: z.number(),
  prioritise: z.number(),
  engage: z.number(),
  roe: z.number(),
  trust: z.number(),
});

export const HistoryEntrySchema = z.object({
  difficulty: DifficultySchema,
  competencies: CompetenciesSchema,
  ratings: RatingsSchema,
  levels: RatingsSchema.optional(),
});

export const SkillProfileSchema = z.object({
  traineeId: z.string(),
  ratings: RatingsSchema,
  levels: RatingsSchema.default({
    detect: 0.3,
    classify: 0.3,
    prioritise: 0.3,
    engage: 0.3,
    roe: 0.3,
    trust: 0.3,
  }),
  smoothed: RatingsSchema.default({
    detect: 0.75,
    classify: 0.75,
    prioritise: 0.75,
    engage: 0.75,
    roe: 0.75,
    trust: 0.75,
  }),
  sessions: z.number().int().nonnegative(),
  history: z.array(HistoryEntrySchema),
});

export const ExtrasSchema = z.object({
  kendallTau: z.number().nullable(),
  excludedThreatIds: z.array(z.string()),
  droppedStages: z.array(Stage),
  misses: z.array(z.object({ threatId: z.string(), stage: Stage })),
  wastedEffort: z.array(z.string()),
  ammoHeavy: z.array(z.string()),
  trustSamples: z.number().int().nonnegative(),
  engageCounts: z.record(z.string(), z.number()),
  verdicts: z.array(z.object({ threatId: z.string(), stage: Stage, condition: ConditionId })),
});

export const UnitRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
});

export const TraineeRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  unitId: z.string(),
  createdAt: z.number(),
});

export const ExamRecordSchema = z.object({
  id: z.string(),
  unitId: z.string(),
  seed: z.number().int(),
  difficulty: DifficultySchema,
  createdAt: z.number(),
});

export const SessionRecordSchema = z.object({
  id: z.string(),
  traineeId: z.string(),
  unitId: z.string(),
  scenarioId: z.string(),
  spec: ScenarioSpecSchema,
  log: SessionLogSchema,
  endedAtSec: z.number(),
  report: ScoreReportSchema,
  extras: ExtrasSchema,
  examId: z.string().optional(),
  createdAt: z.number(),
});

export type UnitRecord = z.infer<typeof UnitRecordSchema>;
export type TraineeRecord = z.infer<typeof TraineeRecordSchema>;
export type ExamRecord = z.infer<typeof ExamRecordSchema>;
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
