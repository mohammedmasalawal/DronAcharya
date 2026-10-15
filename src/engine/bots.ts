import type { EffectorType, ScenarioSpec, SessionLog, Threat, ThreatClass } from '../schema';
import { mulberry32, type Rng } from '../shared/prng';
import {
  TIMESTEP_SEC,
  createWorld,
  finish,
  getObservations,
  step,
  type Observation,
  type SimInput,
} from '../sim';
import { targetAssetValue, theoreticalEtaSec } from './facts';

export type BotKind = 'expert' | 'novice' | 'overtrusting';

type Range = [number, number];

interface Profile {
  salt: number;
  detectDelay: Range;
  classifyDelay: Range;
  engageDelay: Range;
  accuracy: number | 'truth' | 'assistant';
  confidence: Range;
  panicEngage: number;
  wrongEffector: number;
  rankOptimal: boolean;
  groupSwarms: boolean;
  knowsEmitters: boolean;
}

const PROFILES: Record<BotKind, Profile> = {
  expert: {
    salt: 0x1f3d,
    detectDelay: [1, 2],
    classifyDelay: [0.5, 1],
    engageDelay: [0, 0.4],
    accuracy: 'truth',
    confidence: [0.85, 0.95],
    panicEngage: 0,
    wrongEffector: 0,
    rankOptimal: true,
    groupSwarms: true,
    knowsEmitters: true,
  },
  novice: {
    salt: 0x2a71,
    detectDelay: [5, 12],
    classifyDelay: [2, 4],
    engageDelay: [1, 4],
    accuracy: 0.6,
    confidence: [0.4, 0.85],
    panicEngage: 0.2,
    wrongEffector: 0.25,
    rankOptimal: false,
    groupSwarms: false,
    knowsEmitters: false,
  },
  overtrusting: {
    salt: 0x3c95,
    detectDelay: [1.5, 3],
    classifyDelay: [0.5, 1.5],
    engageDelay: [0, 1],
    accuracy: 'assistant',
    confidence: [0.75, 0.9],
    panicEngage: 0,
    wrongEffector: 0,
    rankOptimal: true,
    groupSwarms: true,
    knowsEmitters: false,
  },
};

const ALL_CLASSES: ThreatClass[] = [
  'quad',
  'fpv',
  'fixedwing',
  'loiter',
  'bird',
  'friendly',
  'civilian',
];
const DRONE_CLASSES: ThreatClass[] = ['quad', 'fpv', 'fixedwing', 'loiter'];

const EFFECTOR_ORDER: EffectorType[] = ['jammer', 'gun', 'spoofer', 'net', 'interceptor'];

const EFFECTIVE_AGAINST: Record<EffectorType, ThreatClass[]> = {
  jammer: ['quad', 'fpv', 'friendly'],
  spoofer: ['quad', 'fixedwing', 'loiter', 'friendly'],
  gun: ['quad', 'fpv', 'fixedwing', 'loiter', 'bird', 'friendly', 'civilian'],
  net: ['quad', 'fpv', 'bird', 'friendly'],
  interceptor: ['quad', 'fpv', 'fixedwing', 'loiter', 'friendly', 'civilian'],
};

const MAX_ENGAGES_PER_THREAT = 3;
const RETRY_AFTER_SEC = 5;
const SWARM_ASSESS_TIMEOUT_SEC = 5;

interface Plan {
  detectDelay: number;
  classifyDelay: number;
  engageDelay: number;
  accuracyRoll: number;
  wrongPick: number;
  confidence: number;
  panicRoll: number;
  effectorRoll: number;
  effectorPick: number;
  rankKey: number;
}

interface Memory {
  visibleSince: number | null;
  detectSent: boolean;
  detectedAt: number | null;
  call: ThreatClass | null;
  classifiedAt: number | null;
  engages: number;
  lastEngageAt: number | null;
  tried: EffectorType[];
}

function between(rng: Rng, range: Range): number {
  return range[0] + rng() * (range[1] - range[0]);
}

function seedFor(spec: ScenarioSpec, profile: Profile): number {
  return (Math.imul(spec.seed >>> 0, 2654435761) ^ profile.salt) >>> 0;
}

function makePlan(rng: Rng, profile: Profile): Plan {
  return {
    detectDelay: between(rng, profile.detectDelay),
    classifyDelay: between(rng, profile.classifyDelay),
    engageDelay: between(rng, profile.engageDelay),
    accuracyRoll: rng(),
    wrongPick: rng(),
    confidence: between(rng, profile.confidence),
    panicRoll: rng(),
    effectorRoll: rng(),
    effectorPick: rng(),
    rankKey: rng(),
  };
}

function chooseClass(
  profile: Profile,
  plan: Plan,
  threat: Threat,
  observation: Observation,
): ThreatClass {
  if (profile.accuracy === 'truth') return threat.cls;
  if (profile.accuracy === 'assistant') return observation.assistantSuggestion ?? threat.cls;
  if (plan.accuracyRoll < profile.accuracy) return threat.cls;
  const others = ALL_CLASSES.filter((cls) => cls !== threat.cls);
  return others[Math.floor(plan.wrongPick * others.length)] ?? threat.cls;
}

function isEffective(effector: EffectorType, cls: ThreatClass, emitter: boolean): boolean {
  if (!EFFECTIVE_AGAINST[effector].includes(cls)) return false;
  return effector !== 'jammer' || emitter;
}

function chooseEffector(
  cls: ThreatClass,
  emitter: boolean,
  engageable: EffectorType[],
  tried: EffectorType[],
): EffectorType | null {
  const effective = EFFECTOR_ORDER.filter(
    (effector) => engageable.includes(effector) && isEffective(effector, cls, emitter),
  );
  return effective.find((effector) => !tried.includes(effector)) ?? effective[0] ?? null;
}

function priorityOrder(spec: ScenarioSpec, ids: string[]): string[] {
  const byId = new Map(spec.threats.map((threat) => [threat.id, threat]));
  const keyed = ids.flatMap((id) => {
    const threat = byId.get(id);
    return threat
      ? [
          {
            id,
            eta: theoreticalEtaSec(threat, spec.durationSec),
            value: targetAssetValue(spec, threat),
          },
        ]
      : [];
  });
  return keyed
    .sort((a, b) => a.eta - b.eta || b.value - a.value || a.id.localeCompare(b.id))
    .map((entry) => entry.id);
}

export function runBot(spec: ScenarioSpec, kind: BotKind): SessionLog {
  const profile = PROFILES[kind];
  const rng = mulberry32(seedFor(spec, profile));
  const threats = new Map(spec.threats.map((threat) => [threat.id, threat]));
  const plans = new Map(spec.threats.map((threat) => [threat.id, makePlan(rng, profile)]));
  const memory = new Map<string, Memory>(
    spec.threats.map((threat) => [
      threat.id,
      {
        visibleSince: null,
        detectSent: false,
        detectedAt: null,
        call: null,
        classifiedAt: null,
        engages: 0,
        lastEngageAt: null,
        tried: [],
      },
    ]),
  );
  const believedHostile = new Set<string>();
  const world = createWorld(spec);

  const swarmPending = (threat: Threat, t: number): boolean => {
    if (!profile.groupSwarms || threat.swarmId === undefined) return false;
    return spec.threats.some((mate) => {
      if (mate.id === threat.id || mate.swarmId !== threat.swarmId) return false;
      const last = memory.get(mate.id)?.lastEngageAt;
      return last !== null && last !== undefined && t - last < RETRY_AFTER_SEC;
    });
  };

  const swarmAssessed = (threat: Threat, t: number): boolean => {
    if (!profile.groupSwarms || threat.swarmId === undefined) return true;
    const mates = spec.threats.filter((mate) => mate.swarmId === threat.swarmId);
    const classified = mates.filter((mate) => memory.get(mate.id)?.call !== null);
    if (classified.length === mates.length) return true;
    const firstAt = Math.min(
      ...classified.map((mate) => memory.get(mate.id)?.classifiedAt ?? Infinity),
    );
    return t - firstAt >= SWARM_ASSESS_TIMEOUT_SEC;
  };

  while (!world.done) {
    const t = world.t;
    const observations = getObservations(world);
    const visible = new Set(observations.map((observation) => observation.threatId));
    const inputs: SimInput[] = [];
    let rankDirty = false;

    for (const [id, state] of memory) {
      if (!visible.has(id)) state.visibleSince = null;
    }

    for (const observation of observations) {
      const threat = threats.get(observation.threatId);
      const plan = plans.get(observation.threatId);
      const state = memory.get(observation.threatId);
      if (!threat || !plan || !state) continue;

      if (state.visibleSince === null) state.visibleSince = t;

      if (!observation.detected) {
        if (!state.detectSent && t - state.visibleSince >= plan.detectDelay) {
          inputs.push({ type: 'detect', threatId: threat.id });
          state.detectSent = true;
        }
        continue;
      }

      if (state.detectedAt === null) state.detectedAt = t;

      if (state.call === null) {
        if (t - state.detectedAt < plan.classifyDelay) continue;
        const cls = chooseClass(profile, plan, threat, observation);
        inputs.push({ type: 'classify', threatId: threat.id, cls, confidence: plan.confidence });
        state.call = cls;
        state.classifiedAt = t;
        if (DRONE_CLASSES.includes(cls)) {
          believedHostile.add(threat.id);
          rankDirty = true;
        }
        continue;
      }

      const hostileBelief = DRONE_CLASSES.includes(state.call);
      const panic = plan.panicRoll < profile.panicEngage;
      if (!hostileBelief && !panic) continue;
      if (state.classifiedAt === null || t - state.classifiedAt < plan.engageDelay) continue;
      if (state.engages >= MAX_ENGAGES_PER_THREAT) continue;
      if (state.lastEngageAt !== null && t - state.lastEngageAt < RETRY_AFTER_SEC) continue;
      if (swarmPending(threat, t)) continue;
      if (!swarmAssessed(threat, t)) continue;

      const emitter = profile.knowsEmitters
        ? threat.rfEmitting
        : observation.sensors.includes('rf');
      const believed = state.call;
      let effector: EffectorType | null;

      if (plan.effectorRoll < profile.wrongEffector && observation.engageable.length > 0) {
        const index = Math.floor(plan.effectorPick * observation.engageable.length);
        effector = observation.engageable[index] ?? null;
      } else {
        effector = chooseEffector(believed, emitter, observation.engageable, state.tried);
      }

      if (!effector) continue;
      inputs.push({ type: 'engage', threatId: threat.id, effector });
      state.engages += 1;
      state.lastEngageAt = t;
      state.tried.push(effector);
    }

    if (rankDirty) {
      const ids = [...believedHostile];
      const order = profile.rankOptimal
        ? priorityOrder(spec, ids)
        : ids.sort((a, b) => (plans.get(a)?.rankKey ?? 0) - (plans.get(b)?.rankKey ?? 0));
      inputs.push({ type: 'rank', order });
    }

    step(world, inputs, TIMESTEP_SEC);
  }

  finish(world);
  return { scenarioId: spec.id, traineeId: `bot-${kind}`, events: world.events };
}
