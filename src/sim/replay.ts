import type { ScenarioSpec, SessionEvent, SessionLog } from '../schema';
import { createWorld, step, TIMESTEP_SEC } from './world';
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

export function worldAtTime(spec: ScenarioSpec, log: SessionLog, seconds: number): World {
  const inputs = inputsByTick(log);
  const targetTick = Math.round(seconds / TIMESTEP_SEC);
  const world = createWorld(spec);
  while (world.tick < targetTick && !world.done) {
    step(world, inputs.get(world.tick) ?? [], TIMESTEP_SEC);
  }
  return world;
}

export function replayEvents(spec: ScenarioSpec, log: SessionLog): SessionEvent[] {
  return worldAtTime(spec, log, spec.durationSec).events;
}
