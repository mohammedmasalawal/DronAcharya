import type { ScenarioSpec, SessionEvent, SessionLog } from '../schema';
import { createWorld, finish, step, TIMESTEP_SEC } from './world';
import type { SimInput, World } from './types';

function toInput(event: SessionEvent): SimInput | null {
  switch (event.type) {
    case 'detect':
      return { type: 'detect', threatId: event.threatId };
    case 'classify':
      return {
        type: 'classify',
        threatId: event.threatId,
        cls: event.cls,
        confidence: event.confidence,
      };
    case 'rank':
      return { type: 'rank', order: event.order };
    case 'engage':
      return { type: 'engage', threatId: event.threatId, effector: event.effector };
    default:
      return null;
  }
}

export function inputsByTick(log: SessionLog): Map<number, SimInput[]> {
  const byTick = new Map<number, SimInput[]>();
  for (const event of log.events) {
    const input = toInput(event);
    if (!input) continue;
    const tick = Math.round(event.t / TIMESTEP_SEC);
    byTick.set(tick, [...(byTick.get(tick) ?? []), input]);
  }
  return byTick;
}

export function worldAtTime(
  spec: ScenarioSpec,
  log: SessionLog,
  seconds: number,
  endedAtSec: number = spec.durationSec,
): World {
  const inputs = inputsByTick(log);
  const endTick = Math.round(endedAtSec / TIMESTEP_SEC);
  const targetTick = Math.min(Math.round(seconds / TIMESTEP_SEC), endTick);
  const world = createWorld(spec);
  while (world.tick < targetTick && !world.done) {
    step(world, inputs.get(world.tick) ?? [], TIMESTEP_SEC);
  }
  if (world.tick >= endTick) finish(world);
  return world;
}

export function replayEvents(
  spec: ScenarioSpec,
  log: SessionLog,
  endedAtSec: number = spec.durationSec,
): SessionEvent[] {
  return worldAtTime(spec, log, endedAtSec, endedAtSec).events;
}
