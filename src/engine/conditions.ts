import { CONDITION_IDS, type ConditionId, type ScenarioSpec, type ThreatClass } from '../schema';
import type { ThreatFacts } from './facts';

export type Flag = 'miss' | 'wasted_effort';

export interface Verdict {
  condition: ConditionId;
  reason: string;
  flags: Flag[];
}

interface Band {
  id: ConditionId;
  limit: number;
}

function bandsFor(pattern: RegExp): Band[] {
  return CONDITION_IDS.flatMap((id) => {
    const match = pattern.exec(id);
    return match ? [{ id, limit: Number(match[1]) }] : [];
  }).sort((a, b) => a.limit - b.limit);
}

const REACTION_BANDS = bandsFor(/^reaction<=(\d+(?:\.\d+)?)$/);
const RANK_BANDS = bandsFor(/^rank_within_(\d+)$/);

const DRONE_CLASSES: ThreatClass[] = ['quad', 'fpv', 'fixedwing', 'loiter'];

type Family = 'drone' | ThreatClass;

function familyOf(cls: ThreatClass): Family {
  return DRONE_CLASSES.includes(cls) ? 'drone' : cls;
}

function seconds(value: number): string {
  return `${value.toFixed(1)}s`;
}

export function detectionVerdict(facts: ThreatFacts): Verdict {
  if (facts.detectAt === null) {
    return { condition: 'never_detected', reason: 'MISS: never detected', flags: ['miss'] };
  }

  const delay = facts.detectAt - facts.observableAt;
  const ratio = delay / facts.warningWindowSec;
  const band = REACTION_BANDS.find((candidate) => ratio <= candidate.limit);

  return {
    condition: band ? band.id : 'reaction>0.6',
    reason: `Detected ${seconds(delay)} after observable (${(ratio * 100).toFixed(0)}% of a ${seconds(
      facts.warningWindowSec,
    )} window)`,
    flags: [],
  };
}

export function classificationVerdict(facts: ThreatFacts): Verdict {
  const { threat, classification } = facts;

  if (!classification) {
    return { condition: 'not_classified', reason: 'Never classified', flags: [] };
  }

  const called = classification.cls;
  const detail = `called ${called}, actual ${threat.cls}`;

  if (called === threat.cls) return { condition: 'exact', reason: `Exact: ${detail}`, flags: [] };

  if (familyOf(called) === familyOf(threat.cls)) {
    return { condition: 'same_family', reason: `Right family: ${detail}`, flags: [] };
  }

  if (!threat.hostile && familyOf(called) === 'drone') {
    return {
      condition: 'nonthreat_called_threat',
      reason: `Non-threat called a threat: ${detail}`,
      flags: [],
    };
  }

  if (threat.hostile && familyOf(called) !== 'drone') {
    return {
      condition: 'threat_called_nonthreat',
      reason: `Threat called a non-threat: ${detail}`,
      flags: [],
    };
  }

  return { condition: 'wrong_family', reason: `Wrong family: ${detail}`, flags: [] };
}

export function assessmentVerdict(optimalPosition: number, rankPosition: number): Verdict {
  if (rankPosition < 0) {
    return {
      condition: 'rank_far_or_missing',
      reason: `Not ranked, optimal position ${optimalPosition + 1}`,
      flags: [],
    };
  }

  const distance = Math.abs(rankPosition - optimalPosition);
  const detail = `ranked ${rankPosition + 1}, optimal ${optimalPosition + 1}`;

  if (distance === 0) return { condition: 'rank_exact', reason: `Exact: ${detail}`, flags: [] };

  const band = RANK_BANDS.find((candidate) => distance <= candidate.limit);
  if (band) {
    return { condition: band.id, reason: `Off by ${distance}: ${detail}`, flags: [] };
  }

  return { condition: 'rank_far_or_missing', reason: `Far from optimal: ${detail}`, flags: [] };
}

function engagedNonThreat(facts: ThreatFacts): ConditionId {
  switch (facts.threat.cls) {
    case 'friendly':
      return 'engaged_friendly';
    case 'bird':
      return 'engaged_bird';
    default:
      return 'engaged_civilian';
  }
}

export function engagementVerdict(spec: ScenarioSpec, facts: ThreatFacts): Verdict {
  const { threat, engage } = facts;

  if (!engage) {
    if (!threat.hostile) {
      return {
        condition: 'held_fire_on_nonthreat',
        reason: `Correctly held fire on ${threat.cls}`,
        flags: [],
      };
    }
    if (facts.leakAt !== null) {
      return {
        condition: 'held_fire_on_hostile',
        reason: `MISS: held fire on a hostile that leaked at ${seconds(facts.leakAt)}`,
        flags: ['miss'],
      };
    }
    return {
      condition: 'ignored_hostile',
      reason: 'Hostile never engaged and never reached an asset',
      flags: [],
    };
  }

  const via = engage.covered ? ` (covered by engage on ${engage.viaThreatId})` : '';

  if (!threat.hostile) {
    return {
      condition: engagedNonThreat(facts),
      reason: `Engaged ${threat.cls} with ${engage.effector}${via}`,
      flags: [],
    };
  }

  if (spec.roe.requireClassification) {
    if (!engage.call) {
      return {
        condition: 'engaged_before_confirmation',
        reason: `ROE violation: engaged with ${engage.effector} before classification${via}`,
        flags: [],
      };
    }
    if (engage.call.confidence < spec.roe.minConfidence) {
      return {
        condition: 'engaged_before_confirmation',
        reason: `ROE violation: confidence ${(engage.call.confidence * 100).toFixed(0)}% below ${(
          spec.roe.minConfidence * 100
        ).toFixed(0)}%${via}`,
        flags: [],
      };
    }
  }

  if (facts.outcomeAfterEngage === 'wasted') {
    return {
      condition: 'hostile_roe_met_wrong_effector',
      reason: `Wrong effector: ${engage.effector} was wasted${via}`,
      flags: ['wasted_effort'],
    };
  }

  return {
    condition: 'hostile_roe_met_correct_effector',
    reason: `Engaged with ${engage.effector} within ROE${via}`,
    flags: [],
  };
}

export function outcomeVerdict(facts: ThreatFacts): Verdict {
  const { threat, lastOutcome } = facts;
  const spent = `${facts.engageCount} engage${facts.engageCount === 1 ? '' : 's'}`;

  if (!threat.hostile) {
    switch (lastOutcome) {
      case 'fratricide':
        return { condition: 'fratricide', reason: `Fratricide (${spent})`, flags: [] };
      case 'wasted':
      case 'neutralised':
        return {
          condition: 'wasted',
          reason: `Effector spent on a non-threat (${spent})`,
          flags: [],
        };
      default:
        return { condition: 'ignored_nonthreat', reason: 'Non-threat left alone', flags: [] };
    }
  }

  switch (lastOutcome) {
    case 'neutralised': {
      const when =
        facts.neutralisedAt === null
          ? ''
          : `, ${seconds(facts.neutralisedAt - facts.observableAt)} after observable`;
      return { condition: 'neutralised', reason: `Neutralised (${spent}${when})`, flags: [] };
    }
    case 'leak':
      return {
        condition: 'leak',
        reason: `Leaked at ${seconds(facts.leakAt ?? 0)} (${spent})`,
        flags: ['miss'],
      };
    case 'wasted':
      return {
        condition: 'wasted',
        reason: `Effector wasted (${spent})`,
        flags: ['wasted_effort'],
      };
    default:
      return {
        condition: 'ignored_hostile',
        reason: `Hostile never reached an asset and was not stopped (${spent})`,
        flags: [],
      };
  }
}
