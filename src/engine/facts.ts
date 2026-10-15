import type {
  EffectorType,
  Outcome,
  ScenarioSpec,
  SessionLog,
  Threat,
  ThreatClass,
} from '../schema';

export interface Call {
  cls: ThreatClass;
  confidence: number;
}

export interface EngageFact {
  t: number;
  effector: EffectorType;
  viaThreatId: string;
  covered: boolean;
  call: Call | null;
}

export interface ThreatFacts {
  threat: Threat;
  observableAt: number;
  detectAt: number | null;
  classification: Call | null;
  engage: EngageFact | null;
  engageCount: number;
  engageGroupCount: number;
  lastOutcome: Outcome | null;
  outcomeAfterEngage: Outcome | null;
  leakAt: number | null;
  neutralisedAt: number | null;
  etaSec: number;
  warningWindowSec: number;
  assetValue: number;
}

export interface AssistantSample {
  followedAssistant: boolean;
  assistantCorrect: boolean;
}

export interface LogFacts {
  scored: ThreatFacts[];
  excludedThreatIds: string[];
  lastRank: string[] | null;
  assistantSamples: AssistantSample[];
}

interface Seq<T> {
  seq: number;
  value: T;
}

function push<T>(map: Map<string, Seq<T>[]>, key: string, entry: Seq<T>): void {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

export function theoreticalEtaSec(threat: Threat, durationSec: number): number {
  const travel = threat.speedMps > 0 ? threat.rangeM / threat.speedMps : Infinity;
  return Math.min(threat.spawnAtSec + travel, durationSec);
}

export function targetAssetValue(spec: ScenarioSpec, threat: Threat): number {
  const bearing = (threat.bearingDeg * Math.PI) / 180;
  const x = threat.rangeM * Math.sin(bearing);
  const y = threat.rangeM * Math.cos(bearing);
  let bestValue = 0;
  let bestDistance = Infinity;
  for (const asset of spec.assets) {
    const distance = Math.hypot(asset.x - x, asset.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestValue = asset.value;
    }
  }
  return bestValue;
}

export function buildFacts(spec: ScenarioSpec, log: SessionLog): LogFacts {
  const events = log.events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.t - b.event.t || a.index - b.index)
    .map((entry) => entry.event);

  const observableAt = new Map<string, number>();
  const detectAt = new Map<string, number>();
  const classifies = new Map<string, Seq<Call & { t: number }>[]>();
  const engages = new Map<string, Seq<{ t: number; effector: EffectorType }>[]>();
  const results = new Map<string, Seq<{ t: number; outcome: Outcome }>[]>();
  const assistantSamples: AssistantSample[] = [];
  let lastRank: string[] | null = null;

  events.forEach((event, seq) => {
    switch (event.type) {
      case 'observable':
        if (!observableAt.has(event.threatId)) observableAt.set(event.threatId, event.t);
        break;
      case 'detect':
        if (!detectAt.has(event.threatId)) detectAt.set(event.threatId, event.t);
        break;
      case 'classify':
        push(classifies, event.threatId, {
          seq,
          value: { cls: event.cls, confidence: event.confidence, t: event.t },
        });
        assistantSamples.push({
          followedAssistant: event.followedAssistant,
          assistantCorrect: event.assistantCorrect,
        });
        break;
      case 'rank':
        lastRank = [...event.order];
        break;
      case 'engage':
        push(engages, event.threatId, { seq, value: { t: event.t, effector: event.effector } });
        break;
      case 'result':
        push(results, event.threatId, { seq, value: { t: event.t, outcome: event.outcome } });
        break;
    }
  });

  const callBefore = (threatId: string, seq: number): Call | null => {
    const before = (classifies.get(threatId) ?? []).filter((entry) => entry.seq < seq);
    const last = before.at(-1);
    return last ? { cls: last.value.cls, confidence: last.value.confidence } : null;
  };

  const callOverall = (threatId: string): Call | null => {
    const last = classifies.get(threatId)?.at(-1);
    return last ? { cls: last.value.cls, confidence: last.value.confidence } : null;
  };

  const groupEngageCount = (threat: Threat): number => {
    if (threat.swarmId === undefined) return engages.get(threat.id)?.length ?? 0;
    return spec.threats
      .filter((mate) => mate.swarmId === threat.swarmId)
      .reduce((total, mate) => total + (engages.get(mate.id)?.length ?? 0), 0);
  };

  const scored: ThreatFacts[] = [];
  const excludedThreatIds: string[] = [];

  for (const threat of spec.threats) {
    const observable = observableAt.get(threat.id);
    if (observable === undefined) {
      excludedThreatIds.push(threat.id);
      continue;
    }

    const ownEngages = engages.get(threat.id) ?? [];
    const ownFirst = ownEngages[0];
    let engage: (EngageFact & { seq: number }) | null = null;

    if (ownFirst) {
      engage = {
        t: ownFirst.value.t,
        effector: ownFirst.value.effector,
        viaThreatId: threat.id,
        covered: false,
        call: callBefore(threat.id, ownFirst.seq),
        seq: ownFirst.seq,
      };
    } else if (threat.swarmId !== undefined) {
      for (const mate of spec.threats) {
        if (mate.id === threat.id || mate.swarmId !== threat.swarmId) continue;
        const mateFirst = engages.get(mate.id)?.[0];
        if (!mateFirst) continue;
        if (engage && engage.seq <= mateFirst.seq) continue;
        engage = {
          t: mateFirst.value.t,
          effector: mateFirst.value.effector,
          viaThreatId: mate.id,
          covered: true,
          call: callBefore(mate.id, mateFirst.seq),
          seq: mateFirst.seq,
        };
      }
    }

    const classification =
      engage && !engage.covered ? callBefore(threat.id, engage.seq) : callOverall(threat.id);

    const threatResults = results.get(threat.id) ?? [];
    const leak = threatResults.find((entry) => entry.value.outcome === 'leak');
    const neutralised = threatResults.find((entry) => entry.value.outcome === 'neutralised');
    const afterEngage = engage
      ? (threatResults.find((entry) => entry.seq > engage.seq)?.value.outcome ?? null)
      : null;

    const etaSec = theoreticalEtaSec(threat, spec.durationSec);
    const impactSec = leak ? leak.value.t : etaSec;

    scored.push({
      threat,
      observableAt: observable,
      detectAt: detectAt.get(threat.id) ?? null,
      classification,
      engage: engage
        ? {
            t: engage.t,
            effector: engage.effector,
            viaThreatId: engage.viaThreatId,
            covered: engage.covered,
            call: engage.call,
          }
        : null,
      engageCount: ownEngages.length,
      engageGroupCount: groupEngageCount(threat),
      lastOutcome: threatResults.at(-1)?.value.outcome ?? null,
      outcomeAfterEngage: afterEngage,
      leakAt: leak ? leak.value.t : null,
      neutralisedAt: neutralised ? neutralised.value.t : null,
      etaSec,
      warningWindowSec: Math.max(1, impactSec - observable),
      assetValue: targetAssetValue(spec, threat),
    });
  }

  return { scored, excludedThreatIds, lastRank, assistantSamples };
}
