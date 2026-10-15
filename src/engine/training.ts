import type { Difficulty, ScenarioSpec, ScoreReport, SessionLog } from '../schema';
import { createProfile, nextDifficulty, updateSkill, type SkillProfile } from './adaptive';
import { runBot } from './bots';
import { DEFAULT_TREE } from './defaultTree';
import { deriveSeed, generateScenario } from './generator';
import { analyseSession, type AnalysisExtras } from './scoring';

export const DEFAULT_LEARNING_RATE = 0.04;
export const TRUST_BIAS_DECAY = 0.03;

const HISTORY_FOR_NOVELTY = 8;
const SCENARIO_SALT = 0;
const DIFFICULTY_SALT = 5000;

export interface TrainingExam {
  sessionIndex: number;
  seed: number;
  difficulty: Difficulty;
}

export interface TrainingOptions {
  traineeId: string;
  sessions: number;
  skill: number;
  trustBias: number;
  learningRate?: number;
  seed: number;
  profile?: SkillProfile;
  history?: ScenarioSpec[];
  exam?: TrainingExam;
}

export interface TrainingSession {
  index: number;
  sessionId: string;
  spec: ScenarioSpec;
  log: SessionLog;
  endedAtSec: number;
  report: ScoreReport;
  extras: AnalysisExtras;
  difficulty: Difficulty;
  skill: number;
  trustBias: number;
  isExam: boolean;
  profile: SkillProfile;
}

export function sessionIdFor(scenarioId: string, traineeId: string, n: number): string {
  return `${scenarioId}:${traineeId}:${n}`;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function simulateTraining(options: TrainingOptions): TrainingSession[] {
  const learningRate = options.learningRate ?? DEFAULT_LEARNING_RATE;
  let profile = options.profile ?? createProfile(options.traineeId);
  let skill = clampUnit(options.skill);
  let trustBias = clampUnit(options.trustBias);
  const specs: ScenarioSpec[] = [...(options.history ?? [])];
  const perScenario = new Map<string, number>();
  const sessions: TrainingSession[] = [];

  for (let index = 0; index < options.sessions; index++) {
    const isExam = options.exam !== undefined && options.exam.sessionIndex === index;
    let spec: ScenarioSpec;

    if (isExam && options.exam) {
      spec = generateScenario(options.exam.seed, options.exam.difficulty, []);
    } else {
      const difficulty = nextDifficulty(profile, deriveSeed(options.seed, DIFFICULTY_SALT + index));
      spec = generateScenario(
        deriveSeed(options.seed, SCENARIO_SALT + index + 1),
        difficulty,
        specs.slice(-HISTORY_FOR_NOVELTY),
      );
    }

    const rawLog = runBot(spec, 'expert', { skill, trustBias });
    const log: SessionLog = { ...rawLog, traineeId: options.traineeId };
    const n = (perScenario.get(spec.id) ?? 0) + 1;
    perScenario.set(spec.id, n);
    const sessionId = sessionIdFor(spec.id, options.traineeId, n);

    const analysis = analyseSession(spec, log, DEFAULT_TREE);
    const report: ScoreReport = { ...analysis.report, sessionId };
    profile = updateSkill(profile, report, analysis.extras, spec.difficulty);
    specs.push(spec);

    sessions.push({
      index,
      sessionId,
      spec,
      log,
      endedAtSec: spec.durationSec,
      report,
      extras: analysis.extras,
      difficulty: spec.difficulty,
      skill,
      trustBias,
      isExam,
      profile,
    });

    skill = clampUnit(skill + learningRate);
    trustBias = clampUnit(trustBias - TRUST_BIAS_DECAY);
  }

  return sessions;
}
