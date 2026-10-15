import { buildFacts } from '../engine/facts';
import type { AnalysisExtras } from '../engine/scoring';
import type { ScenarioSpec, ScoreReport, SessionLog, ThreatClass } from '../schema';

export const MAX_FEEDBACK_SENTENCES = 3;

const CLASS_PLURAL: Record<ThreatClass, string> = {
  quad: 'quadcopters',
  fpv: 'FPV drones',
  fixedwing: 'fixed-wing drones',
  loiter: 'loitering munitions',
  bird: 'birds',
  friendly: 'friendly drones',
  civilian: 'civilian aircraft',
};

const MIN_CONFUSED_CASES = 2;
const MIN_CONFUSED_SHARE = 0.5;
const DEGRADED_HEALTH = 0.7;

interface Candidate {
  severity: number;
  text: string;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function conditionPhrase(spec: ScenarioSpec): string {
  if (spec.timeOfDay === 'night') return 'At night';
  if (spec.timeOfDay === 'dusk') return 'At dusk';
  if (spec.weather === 'fog') return 'In fog';
  if (spec.weather === 'rain') return 'In rain';
  if (spec.weather === 'haze') return 'In haze';
  if (spec.sensors.some((s) => s.health < DEGRADED_HEALTH || s.failAtSec !== undefined)) {
    return 'With degraded sensors';
  }
  return `Over ${spec.mapType} terrain`;
}

function weatherPhrase(spec: ScenarioSpec): string {
  if (spec.weather === 'fog') return 'In fog';
  if (spec.weather === 'rain') return 'In rain';
  if (spec.weather === 'haze') return 'In haze';
  return conditionPhrase(spec);
}

function confusion(spec: ScenarioSpec, log: SessionLog): Candidate[] {
  const byClass = new Map<ThreatClass, (ThreatClass | 'unclassified')[]>();
  for (const facts of buildFacts(spec, log).scored) {
    const chosen = facts.classification ? facts.classification.cls : 'unclassified';
    byClass.set(facts.threat.cls, [...(byClass.get(facts.threat.cls) ?? []), chosen]);
  }

  const candidates: Candidate[] = [];
  for (const [trueClass, chosen] of byClass) {
    if (chosen.length < MIN_CONFUSED_CASES) continue;
    const counts = new Map<ThreatClass | 'unclassified', number>();
    for (const value of chosen) {
      if (value !== trueClass) counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    let worst: ThreatClass | 'unclassified' | null = null;
    let worstCount = 0;
    for (const [value, count] of counts) {
      if (count > worstCount) {
        worst = value;
        worstCount = count;
      }
    }
    if (worst === null) continue;
    if (worstCount < MIN_CONFUSED_CASES || worstCount / chosen.length < MIN_CONFUSED_SHARE)
      continue;

    const phrase = conditionPhrase(spec);
    const text =
      worst === 'unclassified'
        ? `${phrase} you left ${CLASS_PLURAL[trueClass]} unclassified in ${worstCount} of ${chosen.length} cases.`
        : `${phrase} you called ${CLASS_PLURAL[trueClass]} ${CLASS_PLURAL[worst]} in ${worstCount} of ${chosen.length} cases.`;
    candidates.push({ severity: 40 + 8 * worstCount, text });
  }
  return candidates;
}

function lateDetection(spec: ScenarioSpec, extras: AnalysisExtras): Candidate[] {
  const detection = extras.verdicts.filter((v) => v.stage === 'detection');
  const late = detection.filter(
    (v) => v.condition === 'reaction>0.6' || v.condition === 'never_detected',
  );
  if (late.length === 0) return [];
  const never = late.filter((v) => v.condition === 'never_detected').length;
  const phrase = weatherPhrase(spec);
  return [
    {
      severity: 35 + 6 * late.length + 4 * never,
      text: `${phrase} you detected ${late.length} of ${detection.length} ${plural(detection.length, 'contact', 'contacts')} late or not at all.`,
    },
  ];
}

function followedWrongAssistant(log: SessionLog): Candidate[] {
  const count = log.events.filter(
    (event) => event.type === 'classify' && event.followedAssistant && !event.assistantCorrect,
  ).length;
  if (count === 0) return [];
  return [
    {
      severity: 50 + 10 * count,
      text: `You followed the AI assistant when it was wrong ${count} ${plural(count, 'time', 'times')}; check its suggestion against the sensors before accepting it.`,
    },
  ];
}

function roeViolations(extras: AnalysisExtras): Candidate[] {
  const count = extras.verdicts.filter(
    (v) => v.stage === 'engagement' && v.condition === 'engaged_before_confirmation',
  ).length;
  if (count === 0) return [];
  return [
    {
      severity: 70 + 8 * count,
      text: `You engaged ${count} ${plural(count, 'contact', 'contacts')} before the classification met the rules of engagement; confirm first, then fire.`,
    },
  ];
}

function nonThreatEngagements(extras: AnalysisExtras): Candidate[] {
  const engagement = extras.verdicts.filter((v) => v.stage === 'engagement');
  const friendly = engagement.filter((v) => v.condition === 'engaged_friendly').length;
  const other = engagement.filter(
    (v) => v.condition === 'engaged_bird' || v.condition === 'engaged_civilian',
  ).length;

  const candidates: Candidate[] = [];
  if (friendly > 0) {
    candidates.push({
      severity: 100 + friendly,
      text: `You engaged ${friendly} friendly ${plural(friendly, 'aircraft', 'aircraft')}, which is a critical fail that caps the score.`,
    });
  }
  if (other > 0) {
    candidates.push({
      severity: 80 + other,
      text: `You engaged ${other} ${plural(other, 'non-threat', 'non-threats')} (birds or civilian aircraft); hold fire unless the contact is confirmed hostile.`,
    });
  }
  return candidates;
}

function jammedSilentDrones(spec: ScenarioSpec, log: SessionLog): Candidate[] {
  const silent = new Set(spec.threats.filter((t) => t.hostile && !t.rfEmitting).map((t) => t.id));
  const jammed = new Set<string>();
  for (const event of log.events) {
    if (event.type === 'engage' && event.effector === 'jammer' && silent.has(event.threatId)) {
      jammed.add(event.threatId);
    }
  }
  if (jammed.size === 0) return [];
  return [
    {
      severity: 60 + 8 * jammed.size,
      text: `Jammers had no effect on ${jammed.size} RF-silent ${plural(jammed.size, 'drone', 'drones')}; use a gun, net or spoofer when the RF sensor shows no emissions.`,
    },
  ];
}

function jammedSwarmEarly(spec: ScenarioSpec, log: SessionLog): Candidate[] {
  const bySwarm = new Map<string, string[]>();
  for (const threat of spec.threats) {
    if (threat.swarmId === undefined) continue;
    bySwarm.set(threat.swarmId, [...(bySwarm.get(threat.swarmId) ?? []), threat.id]);
  }

  const candidates: Candidate[] = [];
  for (const [swarmId, members] of bySwarm) {
    const jam = log.events.find(
      (event) =>
        event.type === 'engage' && event.effector === 'jammer' && members.includes(event.threatId),
    );
    if (!jam) continue;
    const assessed = members.filter((id) =>
      log.events.some(
        (event) => event.type === 'classify' && event.threatId === id && event.t < jam.t,
      ),
    );
    if (assessed.length >= members.length) continue;
    const missed = members.length - assessed.length;
    candidates.push({
      severity: 55 + 5 * missed,
      text: `You jammed swarm ${swarmId} before classifying all ${members.length} members; ${missed} ${plural(missed, 'member was', 'members were')} never assessed.`,
    });
  }
  return candidates;
}

export function feedback(
  spec: ScenarioSpec,
  log: SessionLog,
  report: ScoreReport,
  extras: AnalysisExtras,
): string[] {
  const candidates = [
    ...nonThreatEngagements(extras),
    ...roeViolations(extras),
    ...followedWrongAssistant(log),
    ...jammedSilentDrones(spec, log),
    ...jammedSwarmEarly(spec, log),
    ...confusion(spec, log),
    ...lateDetection(spec, extras),
  ];

  if (candidates.length === 0) {
    return report.total >= 90
      ? ['Clean session: no significant errors in detection, classification or engagement.']
      : ['No single dominant error stands out; review the lowest-scoring decisions below.'];
  }

  return candidates
    .sort((a, b) => b.severity - a.severity || a.text.localeCompare(b.text))
    .slice(0, MAX_FEEDBACK_SENTENCES)
    .map((candidate) => candidate.text);
}
