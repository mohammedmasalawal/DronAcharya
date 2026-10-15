import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScenarioSpec, SessionLog } from '../schema';
import {
  TIMESTEP_SEC,
  finish,
  getGroundTruth,
  inputsByTick,
  step,
  worldAtTime,
  type GroundTruth,
  type World,
} from '../sim';

export interface ReplaySnapshot {
  t: number;
  done: boolean;
  truth: GroundTruth[];
}

const PUBLISH_INTERVAL_MS = 80;
const MAX_FRAME_MS = 250;

function snapshotOf(world: World): ReplaySnapshot {
  return { t: world.t, done: world.done, truth: getGroundTruth(world) };
}

export function useReplay(
  spec: ScenarioSpec,
  log: SessionLog,
  endedAtSec: number,
  initialT: number,
) {
  const inputs = useMemo(() => inputsByTick(log), [log]);
  const worldRef = useRef<World | null>(null);
  if (worldRef.current === null) {
    worldRef.current = worldAtTime(spec, log, initialT, endedAtSec);
  }

  const view = useRef(new Map<string, GroundTruth>());
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const [playing, setPlayingState] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [snapshot, setSnapshot] = useState(() => snapshotOf(worldRef.current!));

  const endTick = Math.round(endedAtSec / TIMESTEP_SEC);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let lastPublish = 0;
    let carry = 0;

    const tick = (now: number) => {
      const world = worldRef.current!;
      const elapsedSec = Math.min(now - last, MAX_FRAME_MS) / 1000;
      last = now;

      if (playingRef.current && !world.done) {
        carry += elapsedSec * speedRef.current;
        while (carry >= TIMESTEP_SEC && !world.done) {
          step(world, inputs.get(world.tick) ?? [], TIMESTEP_SEC);
          if (world.tick >= endTick) finish(world);
          carry -= TIMESTEP_SEC;
        }
        if (world.done) {
          playingRef.current = false;
          setPlayingState(false);
        }
      }

      const truth = getGroundTruth(world);
      view.current = new Map(truth.map((item) => [item.threatId, item]));

      if (now - lastPublish >= PUBLISH_INTERVAL_MS) {
        lastPublish = now;
        setSnapshot({ t: world.t, done: world.done, truth });
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inputs, endTick]);

  const seek = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(seconds, endedAtSec));
      worldRef.current = worldAtTime(spec, log, clamped, endedAtSec);
      setSnapshot(snapshotOf(worldRef.current));
    },
    [spec, log, endedAtSec],
  );

  const setPlaying = useCallback((value: boolean) => {
    playingRef.current = value;
    setPlayingState(value);
  }, []);

  const setSpeed = useCallback((value: number) => {
    speedRef.current = value;
    setSpeedState(value);
  }, []);

  return { view, snapshot, seek, playing, setPlaying, speed, setSpeed };
}
