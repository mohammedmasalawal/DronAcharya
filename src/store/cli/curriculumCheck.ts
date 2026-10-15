import {
  createProfile,
  nextDifficulty,
  updateSkill,
  type SkillProfile,
} from '../../engine/adaptive';
import { runBot } from '../../engine/bots';
import { DEFAULT_TREE } from '../../engine/defaultTree';
import { deriveSeed, generateScenario } from '../../engine/generator';
import { analyseSession } from '../../engine/scoring';
import { mulberry32 } from '../../shared/prng';
import type { Difficulty } from '../../schema';

const TRAINEES = 30;
const SESSIONS = 15;
const LEARNING_RATE = 0.05;
const TRUST_BIAS = 0.3;
const START_SKILL_FROM = 0.1;
const START_SKILL_TO = 0.5;
const LADDER_START = 0.2;
const LADDER_STEP = 0.04;
const RANDOM_LOW = 0.1;
const RANDOM_HIGH = 0.9;
const COMFORT_BASE = 0.15;
const COMFORT_SPAN = 0.7;
const FIT_SLOPE = 2.5;
const LAST_SESSIONS = 3;

type CurriculumName = 'adaptive' | 'fixed ladder' | 'random';

const CURRICULA: CurriculumName[] = ['adaptive', 'fixed ladder', 'random'];

function uniform(level: number): Difficulty {
  return {
    threatCount: level,
    speed: level,
    altitude: level,
    evasiveness: level,
    ambiguity: level,
    degradation: level,
    timePressure: level,
  };
}

function meanLevel(difficulty: Difficulty): number {
  const values = Object.values(difficulty);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fit(servedLevel: number, skill: number): number {
  const comfortable = COMFORT_BASE + COMFORT_SPAN * skill;
  return Math.max(0, 1 - FIT_SLOPE * Math.abs(servedLevel - comfortable));
}

interface Outcome {
  finalSkill: number;
  lastTotal: number;
  meanServed: number;
}

function runTrainee(curriculum: CurriculumName, index: number): Outcome {
  const traineeSeed = 5000 + index;
  const rng = mulberry32(traineeSeed);
  let skill = START_SKILL_FROM + ((START_SKILL_TO - START_SKILL_FROM) * index) / (TRAINEES - 1);
  let profile: SkillProfile = createProfile(`t${index}`);
  const totals: number[] = [];
  const served: number[] = [];

  for (let session = 0; session < SESSIONS; session++) {
    let difficulty: Difficulty;
    if (curriculum === 'adaptive') {
      difficulty = nextDifficulty(profile, deriveSeed(traineeSeed, 9000 + session));
    } else if (curriculum === 'fixed ladder') {
      difficulty = uniform(Math.min(1, LADDER_START + LADDER_STEP * session));
    } else {
      difficulty = uniform(RANDOM_LOW + rng() * (RANDOM_HIGH - RANDOM_LOW));
    }

    const spec = generateScenario(deriveSeed(traineeSeed, session + 1), difficulty, []);
    const log = runBot(spec, 'expert', { skill, trustBias: TRUST_BIAS });
    const analysis = analyseSession(spec, log, DEFAULT_TREE);
    profile = updateSkill(profile, analysis.report, analysis.extras, spec.difficulty);

    const level = meanLevel(spec.difficulty);
    totals.push(analysis.report.total);
    served.push(level);
    skill = Math.min(1, skill + LEARNING_RATE * fit(level, skill));
  }

  const tail = totals.slice(-LAST_SESSIONS);
  return {
    finalSkill: skill,
    lastTotal: tail.reduce((sum, value) => sum + value, 0) / tail.length,
    meanServed: served.reduce((sum, value) => sum + value, 0) / served.length,
  };
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

console.log(
  `${TRAINEES} synthetic trainees, start skill ${START_SKILL_FROM} to ${START_SKILL_TO}, ` +
    `${SESSIONS} sessions, learning rate ${LEARNING_RATE}, trust bias ${TRUST_BIAS}`,
);
console.log('curriculum     mean final skill  mean total (last 3)  mean served difficulty');

const results = new Map<CurriculumName, Outcome[]>();
for (const curriculum of CURRICULA) {
  const outcomes = Array.from({ length: TRAINEES }, (_, index) => runTrainee(curriculum, index));
  results.set(curriculum, outcomes);
  console.log(
    `${curriculum.padEnd(14)} ${mean(outcomes.map((o) => o.finalSkill))
      .toFixed(3)
      .padStart(16)} ` +
      `${mean(outcomes.map((o) => o.lastTotal))
        .toFixed(1)
        .padStart(20)} ` +
      `${mean(outcomes.map((o) => o.meanServed))
        .toFixed(3)
        .padStart(22)}`,
  );
}

const adaptive = results.get('adaptive')!;
const ladder = results.get('fixed ladder')!;
const wins = adaptive.filter((o, i) => o.finalSkill > ladder[i]!.finalSkill).length;
console.log(`adaptive beats the fixed ladder on final skill for ${wins} of ${TRAINEES} trainees`);
