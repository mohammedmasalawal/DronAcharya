import { createProfile, nextDifficulty, updateSkill } from '../../engine/adaptive';
import { runBot } from '../../engine/bots';
import { DEFAULT_TREE } from '../../engine/defaultTree';
import { deriveSeed, generateScenario } from '../../engine/generator';
import { analyseSession } from '../../engine/scoring';
import { mulberry32 } from '../../shared/prng';
import type { Difficulty } from '../../schema';

const TRAINEES = 30;
const SESSIONS = 15;
const TRUST_BIAS = 0.3;
const START_SKILL: [number, number] = [0.1, 0.5];
const LEARNING_RATE: [number, number] = [0.02, 0.08];
const LAST_SESSIONS = 3;
const LADDER_START = 0.2;
const LADDER_STEPS = [0.02, 0.04, 0.06];
const CONSTANT_LEVEL = 0.5;
const RANDOM_RANGE: [number, number] = [0.1, 0.9];

interface LearnerModel {
  name: string;
  comfortBase: number;
  comfortSpan: number;
  tolerance: number;
}

const MODELS: LearnerModel[] = [
  { name: 'A', comfortBase: 0.15, comfortSpan: 0.7, tolerance: 2.5 },
  { name: 'B', comfortBase: 0.1, comfortSpan: 0.6, tolerance: 2.0 },
];

interface Curriculum {
  name: string;
  pick: (session: number, ctx: Context) => Difficulty;
}

interface Context {
  nextAdaptive: () => Difficulty;
  random: () => number;
}

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

const CURRICULA: Curriculum[] = [
  { name: 'adaptive', pick: (_, ctx) => ctx.nextAdaptive() },
  ...LADDER_STEPS.map((step) => ({
    name: `ladder +${step.toFixed(2)}`,
    pick: (session: number) => uniform(Math.min(1, LADDER_START + step * session)),
  })),
  { name: 'constant 0.5', pick: () => uniform(CONSTANT_LEVEL) },
  {
    name: 'random',
    pick: (_: number, ctx: Context) =>
      uniform(RANDOM_RANGE[0] + ctx.random() * (RANDOM_RANGE[1] - RANDOM_RANGE[0])),
  },
];

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = fraction * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

function meanLevel(difficulty: Difficulty): number {
  return mean(Object.values(difficulty));
}

interface Trainee {
  index: number;
  seed: number;
  startSkill: number;
  learningRate: number;
}

function makeTrainees(): Trainee[] {
  const rng = mulberry32(424242);
  return Array.from({ length: TRAINEES }, (_, index) => ({
    index,
    seed: 6000 + index,
    startSkill: START_SKILL[0] + rng() * (START_SKILL[1] - START_SKILL[0]),
    learningRate: LEARNING_RATE[0] + rng() * (LEARNING_RATE[1] - LEARNING_RATE[0]),
  }));
}

interface Outcome {
  finalSkill: number;
  lastTotal: number;
  meanServed: number;
}

function runTrainee(curriculum: Curriculum, model: LearnerModel, trainee: Trainee): Outcome {
  const rng = mulberry32(trainee.seed);
  let skill = trainee.startSkill;
  let profile = createProfile(`t${trainee.index}`);
  const totals: number[] = [];
  const served: number[] = [];

  for (let session = 0; session < SESSIONS; session++) {
    const ctx: Context = {
      nextAdaptive: () => nextDifficulty(profile, deriveSeed(trainee.seed, 9000 + session)),
      random: rng,
    };
    const difficulty = curriculum.pick(session, ctx);
    const spec = generateScenario(deriveSeed(trainee.seed, session + 1), difficulty, []);
    const log = runBot(spec, 'expert', { skill, trustBias: TRUST_BIAS });
    const analysis = analyseSession(spec, log, DEFAULT_TREE);
    profile = updateSkill(profile, analysis.report, analysis.extras, spec.difficulty);

    const level = meanLevel(spec.difficulty);
    const comfortable = model.comfortBase + model.comfortSpan * skill;
    const fit = Math.max(0, 1 - model.tolerance * Math.abs(level - comfortable));
    skill = Math.min(1, skill + trainee.learningRate * fit);

    totals.push(analysis.report.total);
    served.push(level);
  }

  return {
    finalSkill: skill,
    lastTotal: mean(totals.slice(-LAST_SESSIONS)),
    meanServed: mean(served),
  };
}

const trainees = makeTrainees();

console.log(
  `${TRAINEES} seeded synthetic trainees: start skill U(${START_SKILL.join(', ')}), ` +
    `learning rate U(${LEARNING_RATE.join(', ')}), ${SESSIONS} sessions, trust bias ${TRUST_BIAS}`,
);
console.log(
  'Both learner models are ASSUMPTIONS, not measurements of real trainees. Each session:',
);
console.log('  skill += learningRate * max(0, 1 - tolerance * |served - comfortable|)');

for (const model of MODELS) {
  console.log(
    `\nLearner model ${model.name} (assumption): comfortable = ${model.comfortBase} + ` +
      `${model.comfortSpan} * skill, tolerance ${model.tolerance}`,
  );
  console.log(
    'curriculum      mean final skill  p10 final skill  mean total (last 3)  mean served difficulty',
  );

  const summary = new Map<string, { mean: number; p10: number }>();
  for (const curriculum of CURRICULA) {
    const outcomes = trainees.map((trainee) => runTrainee(curriculum, model, trainee));
    const finals = outcomes.map((o) => o.finalSkill);
    summary.set(curriculum.name, { mean: mean(finals), p10: percentile(finals, 0.1) });
    console.log(
      `${curriculum.name.padEnd(15)} ${mean(finals).toFixed(3).padStart(16)} ` +
        `${percentile(finals, 0.1).toFixed(3).padStart(16)} ` +
        `${mean(outcomes.map((o) => o.lastTotal))
          .toFixed(1)
          .padStart(20)} ` +
        `${mean(outcomes.map((o) => o.meanServed))
          .toFixed(3)
          .padStart(22)}`,
    );
  }

  const ladders = CURRICULA.filter((c) => c.name.startsWith('ladder')).map((c) => c.name);
  let best = ladders[0]!;
  for (const name of ladders) {
    if (summary.get(name)!.mean > summary.get(best)!.mean) best = name;
  }
  const adaptive = summary.get('adaptive')!;
  const bestLadder = summary.get(best)!;
  const meanVerdict = adaptive.mean > bestLadder.mean ? 'BEATS' : 'does NOT beat';
  const p10Verdict = adaptive.p10 > bestLadder.p10 ? 'wins' : 'does not win';
  console.log(
    `Model ${model.name}: adaptive ${meanVerdict} the best fixed ladder (${best}) on mean final ` +
      `skill (${adaptive.mean.toFixed(3)} vs ${bestLadder.mean.toFixed(3)}) and ${p10Verdict} on ` +
      `the 10th percentile (${adaptive.p10.toFixed(3)} vs ${bestLadder.p10.toFixed(3)}).`,
  );
}
