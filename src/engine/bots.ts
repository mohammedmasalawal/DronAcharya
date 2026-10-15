import type { ScenarioSpec, SessionLog } from '../schema';
import { createWorld, step } from '../sim';

export type BotKind = 'expert' | 'novice' | 'overtrusting';

export function runBot(spec: ScenarioSpec, kind: BotKind): SessionLog {
  let world = createWorld(spec);
  while (world.t < spec.durationSec) {
    world = step(world, []);
  }
  return { scenarioId: spec.id, traineeId: `bot-${kind}`, events: world.events };
}
