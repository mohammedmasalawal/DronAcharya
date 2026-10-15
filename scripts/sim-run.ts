import { parseArgs } from 'node:util';
import { DifficultySchema } from '../src/schema';
import { DEFAULT_TREE } from '../src/engine/defaultTree';
import { generateScenario } from '../src/engine/generator';
import { runBot, type BotKind } from '../src/engine/bots';
import { scoreSession } from '../src/engine/scoring';
import { SCRIPTED_NAMES, loadScripted } from '../src/engine/scripted';

const botKinds: BotKind[] = ['expert', 'novice', 'overtrusting'];

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1' },
    bot: { type: 'string', default: 'expert' },
    difficulty: { type: 'string', default: '0.5' },
    scripted: { type: 'string' },
  },
});

const seed = Number(values.seed);
const bot = values.bot as BotKind;
const level = Number(values.difficulty);

if (!Number.isInteger(seed)) {
  throw new Error(`--seed must be an integer, got "${values.seed}"`);
}
if (!botKinds.includes(bot)) {
  throw new Error(`--bot must be one of ${botKinds.join(', ')}, got "${values.bot}"`);
}
if (!Number.isFinite(level) || level < 0 || level > 1) {
  throw new Error(`--difficulty must be between 0 and 1, got "${values.difficulty}"`);
}
if (values.scripted !== undefined && !SCRIPTED_NAMES.includes(values.scripted)) {
  throw new Error(
    `--scripted must be one of ${SCRIPTED_NAMES.join(', ')}, got "${values.scripted}"`,
  );
}

const difficulty = DifficultySchema.parse({
  threatCount: level,
  speed: level,
  altitude: level,
  evasiveness: level,
  ambiguity: level,
  degradation: level,
  timePressure: level,
});

const spec =
  values.scripted !== undefined
    ? loadScripted(values.scripted)
    : generateScenario(seed, difficulty, []);
const log = runBot(spec, bot);
const report = scoreSession(spec, log, DEFAULT_TREE);

console.log(JSON.stringify(report, null, 2));
