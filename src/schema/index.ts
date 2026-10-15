import { z } from 'zod';

export const MapType = z.enum(['rural', 'urban', 'hilly', 'industrial']);
export const TimeOfDay = z.enum(['day', 'dusk', 'night']);
export const Weather = z.enum(['clear', 'haze', 'rain', 'fog']);
export const SensorType = z.enum(['radar', 'eoir', 'rf']);
export const EffectorType = z.enum(['jammer', 'spoofer', 'gun', 'net', 'interceptor']);
export const ThreatClass = z.enum([
  'quad',
  'fpv',
  'fixedwing',
  'loiter',
  'bird',
  'friendly',
  'civilian',
]);
export const Behavior = z.enum(['direct', 'terrain_mask', 'evasive', 'loiter', 'swarm']);
export const Outcome = z.enum(['neutralised', 'leak', 'fratricide', 'wasted', 'ignored']);
export const Stage = z.enum(['detection', 'classification', 'assessment', 'engagement', 'outcome']);

const unit = z.number().min(0).max(1);

export const SensorSchema = z.object({
  type: SensorType,
  health: unit,
  failAtSec: z.number().nonnegative().optional(),
});

export const EffectorSchema = z.object({
  type: EffectorType,
  rangeM: z.number().positive(),
  ammo: z.number().int().nonnegative(),
});

export const AssetSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  value: z.number().nonnegative(),
});

export const ThreatSchema = z.object({
  id: z.string(),
  cls: ThreatClass,
  hostile: z.boolean(),
  rfEmitting: z.boolean(),
  spawnAtSec: z.number().nonnegative(),
  bearingDeg: z.number().min(0).max(360),
  rangeM: z.number().positive(),
  altM: z.number().nonnegative(),
  speedMps: z.number().nonnegative(),
  behavior: Behavior,
  swarmId: z.string().optional(),
});

export const RoeSchema = z.object({
  requireClassification: z.boolean(),
  minConfidence: unit,
});

export const DifficultySchema = z.object({
  threatCount: unit,
  speed: unit,
  altitude: unit,
  evasiveness: unit,
  ambiguity: unit,
  degradation: unit,
  timePressure: unit,
});

export const ScenarioSpecSchema = z.object({
  id: z.string(),
  seed: z.number().int(),
  mapType: MapType,
  timeOfDay: TimeOfDay,
  weather: Weather,
  durationSec: z.number().positive(),
  sensors: z.array(SensorSchema),
  effectors: z.array(EffectorSchema),
  assets: z.array(AssetSchema),
  threats: z.array(ThreatSchema),
  roe: RoeSchema,
  difficulty: DifficultySchema,
  noveltyScore: unit,
});

const at = { t: z.number().nonnegative() };

export const SessionEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('observable'), ...at, threatId: z.string() }),
  z.object({ type: z.literal('detect'), ...at, threatId: z.string() }),
  z.object({
    type: z.literal('classify'),
    ...at,
    threatId: z.string(),
    cls: ThreatClass,
    confidence: unit,
    followedAssistant: z.boolean(),
    assistantCorrect: z.boolean(),
  }),
  z.object({ type: z.literal('rank'), ...at, order: z.array(z.string()) }),
  z.object({
    type: z.literal('engage'),
    ...at,
    threatId: z.string(),
    effector: EffectorType,
  }),
  z.object({ type: z.literal('result'), ...at, threatId: z.string(), outcome: Outcome }),
]);

export const SessionLogSchema = z.object({
  scenarioId: z.string(),
  traineeId: z.string(),
  events: z.array(SessionEventSchema),
});

export const CONDITION_IDS = [
  'reaction<=0.25',
  'reaction<=0.6',
  'reaction>0.6',
  'never_detected',
  'exact',
  'same_family',
  'wrong_family',
  'nonthreat_called_threat',
  'threat_called_nonthreat',
  'not_classified',
  'rank_exact',
  'rank_within_1',
  'rank_within_2',
  'rank_far_or_missing',
  'hostile_roe_met_correct_effector',
  'hostile_roe_met_wrong_effector',
  'engaged_before_confirmation',
  'held_fire_on_hostile',
  'engaged_bird',
  'engaged_civilian',
  'engaged_friendly',
  'held_fire_on_nonthreat',
  'neutralised',
  'ignored_nonthreat',
  'wasted',
  'ignored_hostile',
  'leak',
  'fratricide',
] as const;

export const ConditionId = z.enum(CONDITION_IDS);

export const BranchSchema = z.object({
  condition: ConditionId,
  points: z.number(),
  label: z.string(),
});

export const TreeNodeSchema = z.object({
  id: z.string(),
  stage: Stage,
  question: z.string(),
  branches: z.array(BranchSchema).min(1),
});

export const CriticalFailSchema = z.object({
  id: z.string(),
  condition: ConditionId,
  label: z.string(),
  scoreCap: z.number().min(0).max(100).optional(),
});

export const ScoringTreeSchema = z.object({
  nodes: z.array(TreeNodeSchema).min(1),
  weights: z.object({
    detection: z.number().nonnegative(),
    classification: z.number().nonnegative(),
    assessment: z.number().nonnegative(),
    engagement: z.number().nonnegative(),
    outcome: z.number().nonnegative(),
  }),
  criticalFails: z.array(CriticalFailSchema),
});

export const DecisionSchema = z.object({
  threatId: z.string(),
  stage: Stage,
  points: z.number(),
  max: z.number(),
  nodePath: z.array(z.string()),
  reason: z.string(),
});

export const CompetenciesSchema = z.object({
  detect: z.number(),
  classify: z.number(),
  prioritise: z.number(),
  engage: z.number(),
  roe: z.number(),
  trust: z.number(),
});

export const CriticalEventSchema = z.object({
  id: z.string(),
  threatId: z.string().optional(),
  label: z.string(),
});

export const ScoreReportSchema = z.object({
  sessionId: z.string(),
  total: z.number(),
  byStage: z.object({
    detection: z.number(),
    classification: z.number(),
    assessment: z.number(),
    engagement: z.number(),
    outcome: z.number(),
  }),
  decisions: z.array(DecisionSchema),
  competencies: CompetenciesSchema,
  critical: z.array(CriticalEventSchema),
});

export type ConditionId = z.infer<typeof ConditionId>;
export type MapType = z.infer<typeof MapType>;
export type TimeOfDay = z.infer<typeof TimeOfDay>;
export type Weather = z.infer<typeof Weather>;
export type SensorType = z.infer<typeof SensorType>;
export type EffectorType = z.infer<typeof EffectorType>;
export type ThreatClass = z.infer<typeof ThreatClass>;
export type Behavior = z.infer<typeof Behavior>;
export type Outcome = z.infer<typeof Outcome>;
export type Stage = z.infer<typeof Stage>;
export type Sensor = z.infer<typeof SensorSchema>;
export type Effector = z.infer<typeof EffectorSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Threat = z.infer<typeof ThreatSchema>;
export type Roe = z.infer<typeof RoeSchema>;
export type Difficulty = z.infer<typeof DifficultySchema>;
export type ScenarioSpec = z.infer<typeof ScenarioSpecSchema>;
export type SessionEvent = z.infer<typeof SessionEventSchema>;
export type SessionLog = z.infer<typeof SessionLogSchema>;
export type Branch = z.infer<typeof BranchSchema>;
export type TreeNode = z.infer<typeof TreeNodeSchema>;
export type CriticalFail = z.infer<typeof CriticalFailSchema>;
export type ScoringTree = z.infer<typeof ScoringTreeSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type Competencies = z.infer<typeof CompetenciesSchema>;
export type CriticalEvent = z.infer<typeof CriticalEventSchema>;
export type ScoreReport = z.infer<typeof ScoreReportSchema>;
