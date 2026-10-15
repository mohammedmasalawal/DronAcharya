import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScenarioSpec } from '../schema';
import {
  TIMESTEP_SEC,
  createWorld,
  finish,
  getObservations,
  step,
  type EffectorState,
  type Observation,
  type SimInput,
  type World,
} from '../sim';

export interface LiveSnapshot {
  t: number;
  done: boolean;
  observations: Observation[];
  detectedIds: string[];
  results: Record<string, string>;
  effectors: EffectorState[];
  lastRejection: string | null;
}

const PUBLISH_INTERVAL_MS = 100;
const MAX_FRAME_MS = 250;

function snapshotOf(world: World, observations: Observation[]): LiveSnapshot {
  const detectedIds: string[] = [];
  const results: Record<string, string> = {};

  for (const event of world.events) {
    if (event.type === 'detect') detectedIds.push(event.threatId);
    if (event.type === 'result') results[event.threatId] = event.outcome;
  }

  const last = world.rejected.at(-1);
  return {
    t: world.t,
    done: world.done,
    observations,
    detectedIds,
    results,
    effectors: world.effectors.map((effector) => ({ ...effector })),
    lastRejection: last ? `${last.input.type}: ${last.reason}` : null,
  };
}

export function useLiveWorld(spec: ScenarioSpec) {
  const [world] = useState(() => createWorld(spec));
  const queue = useRef<SimInput[]>([]);
  const view = useRef(new Map<string, Observation>());
  const pausedRef = useRef(false);
  const speedRef = useRef(1);
  const [paused, setPausedState] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [snapshot, setSnapshot] = useState(() => snapshotOf(world, getObservations(world)));

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let lastPublish = 0;
    let carry = 0;

    const tick = (now: number) => {
      const elapsedSec = Math.min(now - last, MAX_FRAME_MS) / 1000;
      last = now;

      if (!pausedRef.current && !world.done) {
        carry += elapsedSec * speedRef.current;
        while (carry >= TIMESTEP_SEC && !world.done) {
          step(world, queue.current.splice(0), TIMESTEP_SEC);
          carry -= TIMESTEP_SEC;
        }
      }

      const observations = getObservations(world);
      view.current = new Map(observations.map((o) => [o.threatId, o]));

      if (now - lastPublish >= PUBLISH_INTERVAL_MS || world.done) {
        lastPublish = now;
        setSnapshot(snapshotOf(world, observations));
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [world]);

  const send = useCallback((input: SimInput) => {
    queue.current.push(input);
  }, []);

  const setPaused = useCallback((value: boolean) => {
    pausedRef.current = value;
    setPausedState(value);
  }, []);

  const setSpeed = useCallback((value: number) => {
    speedRef.current = value;
    setSpeedState(value);
  }, []);

  const endNow = useCallback(() => {
    finish(world);
    setSnapshot(snapshotOf(world, []));
  }, [world]);

  return { world, view, snapshot, send, paused, setPaused, speed, setSpeed, endNow };
}
