import type { EffectorType, Outcome, Threat, ThreatClass } from '../schema';

const EFFECTIVE_AGAINST: Record<EffectorType, ThreatClass[]> = {
  jammer: ['quad', 'fpv', 'friendly'],
  spoofer: ['quad', 'fixedwing', 'loiter', 'friendly'],
  gun: ['quad', 'fpv', 'fixedwing', 'loiter', 'bird', 'friendly', 'civilian'],
  net: ['quad', 'fpv', 'bird', 'friendly'],
  interceptor: ['quad', 'fpv', 'fixedwing', 'loiter', 'friendly', 'civilian'],
};

export const EFFECT_DELAY_SEC: Record<EffectorType, number> = {
  jammer: 1,
  spoofer: 3,
  gun: 1,
  net: 2,
  interceptor: 4,
};

export interface EffectResult {
  outcome: Outcome;
  removed: boolean;
}

export function isEffective(effector: EffectorType, threat: Threat): boolean {
  if (!EFFECTIVE_AGAINST[effector].includes(threat.cls)) return false;
  return effector !== 'jammer' || threat.rfEmitting;
}

export function resolveEffect(effector: EffectorType, threat: Threat): EffectResult {
  const effective = isEffective(effector, threat);

  if (threat.hostile) {
    return effective
      ? { outcome: 'neutralised', removed: true }
      : { outcome: 'wasted', removed: false };
  }

  if (threat.cls === 'friendly' && effective) {
    return { outcome: 'fratricide', removed: true };
  }

  return { outcome: 'wasted', removed: effective };
}
