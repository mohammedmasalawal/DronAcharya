import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ScoringTreeSchema, DifficultySchema } from '../src/schema';
import { generateScenario } from '../src/engine/generator';
import { runBot, type BotKind } from '../src/engine/bots';
import { scoreSession } from '../src/engine/scoring';

const botKinds: BotKind[] = ['expert', 'novice', 'overtrusting'];

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1' },
    bot: { type: 'string', default: 'expert' },
  },
});

const seed = Number(values.seed);
const bot = values.bot as BotKind;

if (!Number.isInteger(seed)) {
  throw new Error(`--seed must be an integer, got "${values.seed}"`);
}
if (!botKinds.includes(bot)) {
  throw new Error(`--bot must be one of ${botKinds.join(', ')}, got "${values.bot}"`);
}

const tree = ScoringTreeSchema.parse(
  JSON.parse(readFileSync(new URL('../data/scoring-tree.default.json', import.meta.url), 'utf8')),
);

const difficulty = DifficultySchema.parse({
  threatCount: 0.5,
  speed: 0.5,
  altitude: 0.5,
  evasiveness: 0.5,
  ambiguity: 0.5,
  degradation: 0.5,
  timePressure: 0.5,
});

const spec = generateScenario(seed, difficulty, []);
const log = runBot(spec, bot);
const report = scoreSession(spec, log, tree);

console.log(JSON.stringify(report, null, 2));
