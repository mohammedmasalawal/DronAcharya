import type { EffectorType, ScenarioSpec, Threat, ThreatClass } from '../schema';
import { runBot } from './bots';

export const SOLVABLE_MAX_DIFFICULTY = 0.8;

const ARRIVE_RADIUS_M = 30;
const RESPONSE_MARGIN_SEC = 6;

const EFFECTIVE_AGAINST: Record<EffectorType, ThreatClass[]> = {
  jammer: ['quad', 'fpv', 'friendly'],
  spoofer: ['quad', 'fixedwing', 'loiter', 'friendly'],
  gun: ['quad', 'fpv', 'fixedwing', 'loiter', 'bird', 'friendly', 'civilian'],
  net: ['quad', 'fpv', 'bird', 'friendly'],
  interceptor: ['quad', 'fpv', 'fixedwing', 'loiter', 'friendly', 'civilian'],
};

const EFFECT_DELAY_SEC: Record<EffectorType, number> = {
  jammer: 1,
  spoofer: 3,
  gun: 1,
  net: 2,
  interceptor: 4,
};

export interface SolvabilityReport {
  ok: boolean;
  problems: string[];
}

export function defeats(effector: EffectorType, threat: Threat): boolean {
  if (!EFFECTIVE_AGAINST[effector].includes(threat.cls)) return false;
  return effector !== 'jammer' || threat.rfEmitting;
}

export function maxAxis(spec: ScenarioSpec): number {
  return Math.max(...Object.values(spec.difficulty));
}

function staticProblems(spec: ScenarioSpec): string[] {
  const problems: string[] = [];
  const hostile = spec.threats.filter((threat) => threat.hostile);
  const timed = maxAxis(spec) <= SOLVABLE_MAX_DIFFICULTY;
  const usable = new Set<EffectorType>();

  for (const threat of hostile) {
    const defenders = spec.effectors.filter(
      (effector) => effector.ammo > 0 && defeats(effector.type, threat),
    );

    if (defenders.length === 0) {
      problems.push(`${threat.id} has no effective effector with ammo`);
      continue;
    }

    for (const effector of defenders) usable.add(effector.type);

    if (timed) {
      const lead = Math.max(
        ...defenders.map(
          (effector) =>
            (Math.min(threat.rangeM, effector.rangeM) - ARRIVE_RADIUS_M) /
              Math.max(threat.speedMps, 0.1) -
            EFFECT_DELAY_SEC[effector.type],
        ),
      );
      if (lead < RESPONSE_MARGIN_SEC) {
        problems.push(`${threat.id} leaves only ${lead.toFixed(1)}s to respond`);
      }
    }
  }

  const swarms = new Map<string, Threat[]>();
  let engagements = 0;
  for (const threat of hostile) {
    if (threat.swarmId === undefined) {
      engagements += 1;
      continue;
    }
    swarms.set(threat.swarmId, [...(swarms.get(threat.swarmId) ?? []), threat]);
  }
  for (const members of swarms.values()) {
    engagements += members.every((member) => member.rfEmitting) ? 1 : members.length;
  }

  const ammo = spec.effectors
    .filter((effector) => usable.has(effector.type))
    .reduce((sum, effector) => sum + effector.ammo, 0);
  if (ammo < engagements) {
    problems.push(`${ammo} rounds cannot cover ${engagements} engagements`);
  }

  return problems;
}

function dynamicProblems(spec: ScenarioSpec): string[] {
  const log = runBot(spec, 'expert');
  const problems: string[] = [];

  for (const threat of spec.threats.filter((candidate) => candidate.hostile)) {
    const observed = log.events.some(
      (event) => event.type === 'observable' && event.threatId === threat.id,
    );
    const outcomes = log.events.flatMap((event) =>
      event.type === 'result' && event.threatId === threat.id ? [event.outcome] : [],
    );

    if (!observed) problems.push(`${threat.id} is never observable`);
    else if (outcomes.includes('leak')) problems.push(`${threat.id} leaks past the expert`);
    else if (!outcomes.includes('neutralised')) problems.push(`${threat.id} is never neutralised`);
  }

  return problems;
}

export function checkSolvability(
  spec: ScenarioSpec,
  options: { dynamic?: boolean } = {},
): SolvabilityReport {
  const problems = staticProblems(spec);
  if (options.dynamic && problems.length === 0) problems.push(...dynamicProblems(spec));
  return { ok: problems.length === 0, problems };
}
