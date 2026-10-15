import type { ScenarioSpec, SessionEvent, ThreatClass } from '../schema';
import { mulberry32 } from '../shared/prng';
import { EFFECT_DELAY_SEC, resolveEffect, isEffective } from './effectors';
import { ARRIVE_RADIUS_M, advanceThreat, distanceToTargetM } from './motion';
import { slantRangeM, visibleSensors } from './sensors';
import type {
  EffectorState,
  GroundTruth,
  Observation,
  SimInput,
  ThreatState,
  World,
} from './types';

export const TIMESTEP_SEC = 0.05;

const EXIT_RANGE_FACTOR = 1.15;
const TRANSIT_OFFSET_M = 700;
const SWARM_SPACING_M = 40;

const CONFUSABLE: Record<ThreatClass, ThreatClass[]> = {
  quad: ['fpv', 'bird'],
  fpv: ['quad', 'loiter'],
  fixedwing: ['loiter', 'civilian'],
  loiter: ['fixedwing', 'quad'],
  bird: ['quad', 'fpv'],
  friendly: ['quad', 'fixedwing'],
  civilian: ['fixedwing', 'friendly'],
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function suggestClass(
  cls: ThreatClass,
  spec: ScenarioSpec,
  roll: number,
  pick: number,
): ThreatClass {
  const pCorrect = clamp(
    0.95 - 0.5 * spec.difficulty.ambiguity - 0.2 * spec.difficulty.degradation,
    0.3,
    0.99,
  );
  if (roll < pCorrect) return cls;
  const options = CONFUSABLE[cls];
  return options[Math.floor(pick * options.length)] ?? cls;
}

function nearestAsset(spec: ScenarioSpec, x: number, y: number): { x: number; y: number } {
  let best = { x: 0, y: 0 };
  let bestDist = Infinity;
  for (const asset of spec.assets) {
    const dist = Math.hypot(asset.x - x, asset.y - y);
    if (dist < bestDist) {
      best = { x: asset.x, y: asset.y };
      bestDist = dist;
    }
  }
  return best;
}

function swarmOffset(spec: ScenarioSpec, id: string, swarmId: string | undefined): number {
  if (swarmId === undefined) return 0;
  const members = spec.threats.filter((t) => t.swarmId === swarmId);
  const index = members.findIndex((t) => t.id === id);
  return (index - (members.length - 1) / 2) * SWARM_SPACING_M;
}

function createThreatState(
  spec: ScenarioSpec,
  index: number,
  phase: number,
  roll: number,
  pick: number,
): ThreatState {
  const threat = spec.threats[index]!;
  const bearing = (threat.bearingDeg * Math.PI) / 180;
  const sin = Math.sin(bearing);
  const cos = Math.cos(bearing);
  const lateral = swarmOffset(spec, threat.id, threat.swarmId);
  const x = threat.rangeM * sin + lateral * cos;
  const y = threat.rangeM * cos - lateral * sin;
  const target = nearestAsset(spec, x, y);

  let vx = 0;
  let vy = 0;
  let targetX = target.x;
  let targetY = target.y;

  if (!threat.hostile) {
    const toTargetX = target.x - x;
    const toTargetY = target.y - y;
    const length = Math.max(Math.hypot(toTargetX, toTargetY), 1);
    const side = phase < Math.PI ? 1 : -1;
    const wayX = target.x + (-toTargetY / length) * TRANSIT_OFFSET_M * side;
    const wayY = target.y + (toTargetX / length) * TRANSIT_OFFSET_M * side;
    const wayLength = Math.max(Math.hypot(wayX - x, wayY - y), 1);
    vx = (wayX - x) / wayLength;
    vy = (wayY - y) / wayLength;
    targetX = target.x;
    targetY = target.y;
  }

  return {
    id: threat.id,
    spec: threat,
    status: 'pending',
    x,
    y,
    alt: threat.altM,
    vx,
    vy,
    targetX,
    targetY,
    startDistM: Math.hypot(targetX - x, targetY - y),
    phase,
    orbitStartSec: null,
    assistantSuggestion: suggestClass(threat.cls, spec, roll, pick),
    visibleBy: [],
    everObservable: false,
    detectedAt: null,
    classifiedAs: null,
    pending: null,
  };
}

export function createWorld(spec: ScenarioSpec): World {
  const rng = mulberry32(spec.seed);
  const threats = spec.threats.map((_, index) => {
    const phase = rng() * Math.PI * 2;
    const roll = rng();
    const pick = rng();
    return createThreatState(spec, index, phase, roll, pick);
  });
  const effectors: EffectorState[] = spec.effectors.map((e) => ({
    type: e.type,
    rangeM: e.rangeM,
    ammo: e.ammo,
  }));

  const world: World = {
    spec,
    tick: 0,
    t: 0,
    done: false,
    events: [],
    threats,
    effectors,
    rejected: [],
  };
  refresh(world);
  return world;
}

function emit(world: World, event: SessionEvent): void {
  world.events.push(event);
}

function reject(world: World, input: SimInput, reason: string): void {
  world.rejected.push({ t: world.t, input, reason });
}

function findThreat(world: World, id: string): ThreatState | undefined {
  return world.threats.find((threat) => threat.id === id);
}

function applyInput(world: World, input: SimInput): void {
  const t = world.t;

  if (input.type === 'rank') {
    const known = new Set(world.threats.map((threat) => threat.id));
    if (!input.order.every((id) => known.has(id))) {
      reject(world, input, 'unknown_threat');
      return;
    }
    emit(world, { type: 'rank', t, order: [...input.order] });
    return;
  }

  const threat = findThreat(world, input.threatId);
  if (!threat) {
    reject(world, input, 'unknown_threat');
    return;
  }
  if (threat.status !== 'active') {
    reject(world, input, 'not_active');
    return;
  }

  if (input.type === 'detect') {
    if (threat.detectedAt !== null) return reject(world, input, 'already_detected');
    if (threat.visibleBy.length === 0) return reject(world, input, 'not_visible');
    threat.detectedAt = t;
    emit(world, { type: 'detect', t, threatId: threat.id });
    return;
  }

  if (threat.detectedAt === null) {
    reject(world, input, 'not_detected');
    return;
  }

  if (input.type === 'classify') {
    threat.classifiedAs = input.cls;
    emit(world, {
      type: 'classify',
      t,
      threatId: threat.id,
      cls: input.cls,
      confidence: clamp(input.confidence, 0, 1),
      followedAssistant: input.cls === threat.assistantSuggestion,
      assistantCorrect: threat.assistantSuggestion === threat.spec.cls,
    });
    return;
  }

  if (threat.pending) {
    reject(world, input, 'engagement_in_progress');
    return;
  }
  const effector = world.effectors.find((e) => e.type === input.effector && e.ammo > 0);
  if (!effector) {
    reject(world, input, 'no_ammo');
    return;
  }
  if (slantRangeM(threat) > effector.rangeM) {
    reject(world, input, 'out_of_range');
    return;
  }
  effector.ammo -= 1;
  threat.pending = {
    effector: input.effector,
    resolveAt: t + EFFECT_DELAY_SEC[input.effector],
  };
  emit(world, { type: 'engage', t, threatId: threat.id, effector: input.effector });
}

function settle(
  world: World,
  threat: ThreatState,
  status: ThreatState['status'],
  outcome: Extract<SessionEvent, { type: 'result' }>['outcome'],
): void {
  threat.status = status;
  threat.pending = null;
  emit(world, { type: 'result', t: world.t, threatId: threat.id, outcome });
}

function resolvePending(world: World): void {
  for (const threat of world.threats) {
    if (threat.status !== 'active' || !threat.pending) continue;
    if (threat.pending.resolveAt > world.t) continue;

    const effector = threat.pending.effector;
    const direct = resolveEffect(effector, threat.spec);
    const rangeM = world.effectors.find((e) => e.type === effector)?.rangeM ?? 0;

    if (direct.removed) {
      settle(world, threat, 'neutralised', direct.outcome);
    } else {
      threat.pending = null;
      emit(world, { type: 'result', t: world.t, threatId: threat.id, outcome: direct.outcome });
    }

    const swarmId = threat.spec.swarmId;
    if (effector !== 'jammer' || swarmId === undefined || !direct.removed) continue;

    for (const mate of world.threats) {
      if (mate === threat || mate.status !== 'active' || mate.spec.swarmId !== swarmId) continue;
      if (!isEffective('jammer', mate.spec) || slantRangeM(mate) > rangeM) continue;
      settle(world, mate, 'neutralised', resolveEffect('jammer', mate.spec).outcome);
    }
  }
}

function refresh(world: World): void {
  for (const threat of world.threats) {
    if (threat.status === 'pending' && world.t >= threat.spec.spawnAtSec) {
      threat.status = 'active';
    }
    if (threat.status !== 'active') continue;

    threat.visibleBy = visibleSensors(world.spec, threat, world.t);
    if (threat.visibleBy.length > 0 && !threat.everObservable) {
      threat.everObservable = true;
      emit(world, { type: 'observable', t: world.t, threatId: threat.id });
    }
  }

  resolvePending(world);

  for (const threat of world.threats) {
    if (threat.status !== 'active') continue;

    if (threat.spec.hostile) {
      if (distanceToTargetM(threat) <= ARRIVE_RADIUS_M) settle(world, threat, 'leaked', 'leak');
      continue;
    }

    const exited =
      Math.hypot(threat.x, threat.y) > threat.spec.rangeM * EXIT_RANGE_FACTOR &&
      threat.spec.behavior !== 'loiter';
    if (exited) settle(world, threat, 'exited', 'ignored');
  }
}

export function finish(world: World): World {
  if (world.done) return world;
  for (const threat of world.threats) {
    if (threat.status === 'active') settle(world, threat, 'ignored', 'ignored');
  }
  world.done = true;
  return world;
}

export function step(world: World, inputs: SimInput[], dt: number = TIMESTEP_SEC): World {
  if (world.done) return world;

  for (const input of inputs) applyInput(world, input);

  for (const threat of world.threats) {
    if (threat.status === 'active') advanceThreat(threat, world.t, dt);
  }

  world.tick += 1;
  world.t = world.tick * dt;
  refresh(world);

  if (world.t >= world.spec.durationSec) finish(world);
  return world;
}

function jitter(world: World, threat: ThreatState, quality: number): { dx: number; dy: number } {
  const amplitude = 15 + 250 * (1 - quality) + 150 * world.spec.difficulty.degradation;
  const angle = world.tick * 0.07 + threat.phase;
  return { dx: Math.sin(angle) * amplitude, dy: Math.cos(angle * 1.3) * amplitude };
}

function sensorQuality(world: World, threat: ThreatState): number {
  let best = 0;
  for (const sensor of world.spec.sensors) {
    if (threat.visibleBy.includes(sensor.type)) best = Math.max(best, sensor.health);
  }
  return best;
}

function bearingDeg(x: number, y: number): number {
  const deg = (Math.atan2(x, y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function getObservations(world: World): Observation[] {
  const observations: Observation[] = [];

  for (const threat of world.threats) {
    if (threat.status !== 'active' || threat.visibleBy.length === 0) continue;

    const { dx, dy } = jitter(world, threat, sensorQuality(world, threat));
    const x = threat.x + dx;
    const y = threat.y + dy;
    const detected = threat.detectedAt !== null;

    observations.push({
      threatId: threat.id,
      x,
      y,
      altM: threat.alt,
      rangeM: Math.hypot(x, y),
      bearingDeg: bearingDeg(x, y),
      speedMps: threat.spec.speedMps,
      sensors: threat.visibleBy,
      detected,
      classifiedAs: threat.classifiedAs,
      assistantSuggestion: detected ? threat.assistantSuggestion : null,
      engageable: world.effectors
        .filter((e) => e.ammo > 0 && slantRangeM(threat) <= e.rangeM)
        .map((e) => e.type),
    });
  }

  return observations;
}

export function getGroundTruth(world: World): GroundTruth[] {
  return world.threats
    .filter((threat) => threat.status !== 'pending')
    .map((threat) => ({
      threatId: threat.id,
      cls: threat.spec.cls,
      hostile: threat.spec.hostile,
      behavior: threat.spec.behavior,
      swarmId: threat.spec.swarmId,
      status: threat.status,
      x: threat.x,
      y: threat.y,
      altM: threat.alt,
      speedMps: threat.spec.speedMps,
      visible: threat.visibleBy.length > 0,
      detected: threat.detectedAt !== null,
      classifiedAs: threat.classifiedAs,
    }));
}
