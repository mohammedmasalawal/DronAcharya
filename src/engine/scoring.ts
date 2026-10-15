import type {
  ConditionId,
  Competencies,
  CriticalEvent,
  Decision,
  ScenarioSpec,
  ScoreReport,
  ScoringTree,
  SessionLog,
  Stage,
} from '../schema';
import {
  assessmentVerdict,
  classificationVerdict,
  detectionVerdict,
  engagementVerdict,
  outcomeVerdict,
  type Flag,
  type Verdict,
} from './conditions';
import { buildFacts, type AssistantSample, type ThreatFacts } from './facts';

const STAGES: Stage[] = ['detection', 'classification', 'assessment', 'engagement', 'outcome'];

const NEUTRAL_COMPETENCY = 50;

const ROE_VIOLATIONS: ConditionId[] = [
  'engaged_before_confirmation',
  'engaged_friendly',
  'engaged_bird',
  'engaged_civilian',
];

export interface VerdictRecord {
  threatId: string;
  stage: Stage;
  condition: ConditionId;
}

export interface SessionExtras {
  kendallTau: number | null;
  excludedThreatIds: string[];
  droppedStages: Stage[];
  misses: { threatId: string; stage: Stage }[];
  wastedEffort: string[];
  engageCounts: Record<string, number>;
  verdicts: VerdictRecord[];
}

export interface SessionAnalysis {
  report: ScoreReport;
  extras: SessionExtras;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function optimalOrder(hostile: ThreatFacts[]): string[] {
  return [...hostile]
    .sort(
      (a, b) =>
        a.etaSec - b.etaSec ||
        b.assetValue - a.assetValue ||
        a.threat.id.localeCompare(b.threat.id),
    )
    .map((facts) => facts.threat.id);
}

function kendallTau(optimal: string[], ranked: string[]): number | null {
  const shared = optimal.filter((id) => ranked.includes(id));
  if (shared.length < 2) return null;

  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < shared.length; i++) {
    for (let j = i + 1; j < shared.length; j++) {
      const a = shared[i]!;
      const b = shared[j]!;
      if (ranked.indexOf(a) < ranked.indexOf(b)) concordant += 1;
      else discordant += 1;
    }
  }
  return (concordant - discordant) / (concordant + discordant);
}

const ASSISTANT_TRUST_VALUE = {
  followedWrong: -1,
  overrodeWrong: 1,
  followedRight: 0.5,
  overrodeRight: -0.25,
};

function trustScore(samples: AssistantSample[]): number {
  if (samples.length === 0) return NEUTRAL_COMPETENCY;

  const sum = samples.reduce((total, sample) => {
    if (sample.followedAssistant) {
      return (
        total +
        (sample.assistantCorrect
          ? ASSISTANT_TRUST_VALUE.followedRight
          : ASSISTANT_TRUST_VALUE.followedWrong)
      );
    }
    return (
      total +
      (sample.assistantCorrect
        ? ASSISTANT_TRUST_VALUE.overrodeRight
        : ASSISTANT_TRUST_VALUE.overrodeWrong)
    );
  }, 0);

  return clamp(50 + 50 * (sum / samples.length), 0, 100);
}

export function analyseSession(
  spec: ScenarioSpec,
  log: SessionLog,
  tree: ScoringTree,
): SessionAnalysis {
  const { scored, excludedThreatIds, lastRank, assistantSamples } = buildFacts(spec, log);
  const hostile = scored.filter((facts) => facts.threat.hostile);

  const optimal = optimalOrder(hostile);
  const hostileIds = new Set(optimal);
  const rankedHostile = (lastRank ?? []).filter(
    (id, index, all) => hostileIds.has(id) && all.indexOf(id) === index,
  );

  const decisions: Decision[] = [];
  const verdicts: VerdictRecord[] = [];
  const misses: SessionExtras['misses'] = [];
  const wastedEffort: string[] = [];
  const stagePoints: Record<Stage, number> = {
    detection: 0,
    classification: 0,
    assessment: 0,
    engagement: 0,
    outcome: 0,
  };
  const activeStages: Stage[] = [];
  const droppedStages: Stage[] = [];

  const verdictFor = (stage: Stage, facts: ThreatFacts): Verdict => {
    switch (stage) {
      case 'detection':
        return detectionVerdict(facts);
      case 'classification':
        return classificationVerdict(facts);
      case 'assessment':
        return assessmentVerdict(
          optimal.indexOf(facts.threat.id),
          rankedHostile.indexOf(facts.threat.id),
        );
      case 'engagement':
        return engagementVerdict(spec, facts);
      case 'outcome':
        return outcomeVerdict(facts);
    }
  };

  for (const stage of STAGES) {
    const applicable = stage === 'assessment' ? hostile : scored;
    const node = tree.nodes.find((candidate) => candidate.stage === stage);

    if (!node || applicable.length === 0) {
      droppedStages.push(stage);
      continue;
    }

    activeStages.push(stage);
    const max = tree.weights[stage] / applicable.length;
    let sum = 0;

    for (const facts of applicable) {
      const verdict = verdictFor(stage, facts);
      const branch = node.branches.find((candidate) => candidate.condition === verdict.condition);
      const fraction = branch ? clamp(branch.points, -1, 1) : 0;
      const points = clamp(fraction * max, -max, max);
      const flags: Flag[] = verdict.flags;

      sum += points;
      verdicts.push({ threatId: facts.threat.id, stage, condition: verdict.condition });
      decisions.push({
        threatId: facts.threat.id,
        stage,
        points,
        max,
        nodePath: [node.id],
        reason: branch ? `${branch.label}. ${verdict.reason}` : `No branch. ${verdict.reason}`,
      });

      if (flags.includes('miss')) misses.push({ threatId: facts.threat.id, stage });
      if (flags.includes('wasted_effort') && !wastedEffort.includes(facts.threat.id)) {
        wastedEffort.push(facts.threat.id);
      }
    }

    stagePoints[stage] = Math.max(0, sum);
  }

  const activeWeight = activeStages.reduce((total, stage) => total + tree.weights[stage], 0);
  const earned = activeStages.reduce((total, stage) => total + stagePoints[stage], 0);
  let total = activeWeight > 0 ? clamp((100 * earned) / activeWeight, 0, 100) : 0;

  const critical: CriticalEvent[] = [];
  for (const fail of tree.criticalFails) {
    for (const record of verdicts) {
      if (record.condition !== fail.condition) continue;
      critical.push({ id: fail.id, threatId: record.threatId, label: fail.label });
      if (fail.scoreCap !== undefined) total = Math.min(total, fail.scoreCap);
    }
  }

  const percent = (stage: Stage): number =>
    activeStages.includes(stage) && tree.weights[stage] > 0
      ? clamp((100 * stagePoints[stage]) / tree.weights[stage], 0, 100)
      : NEUTRAL_COMPETENCY;

  const engagementRecords = verdicts.filter((record) => record.stage === 'engagement');
  const roe =
    engagementRecords.length === 0
      ? NEUTRAL_COMPETENCY
      : (100 *
          engagementRecords.filter((record) => !ROE_VIOLATIONS.includes(record.condition)).length) /
        engagementRecords.length;

  const competencies: Competencies = {
    detect: percent('detection'),
    classify: percent('classification'),
    prioritise: percent('assessment'),
    engage: percent('engagement'),
    roe,
    trust: trustScore(assistantSamples),
  };

  return {
    report: {
      sessionId: `${log.scenarioId}:${log.traineeId}`,
      total,
      byStage: stagePoints,
      decisions,
      competencies,
      critical,
    },
    extras: {
      kendallTau: kendallTau(optimal, rankedHostile),
      excludedThreatIds,
      droppedStages,
      misses,
      wastedEffort,
      engageCounts: Object.fromEntries(scored.map((f) => [f.threat.id, f.engageCount])),
      verdicts,
    },
  };
}

export function scoreSession(spec: ScenarioSpec, log: SessionLog, tree: ScoringTree): ScoreReport {
  return analyseSession(spec, log, tree).report;
}
