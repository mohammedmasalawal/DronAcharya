import { COMPETENCY_KEYS, type CompetencyKey, type SkillProfile } from '../engine/adaptive';
import { buildFacts } from '../engine/facts';
import type { Decision, Outcome, ScenarioSpec, SessionLog, Stage, ThreatClass } from '../schema';
import type { ExamRecord, SessionRecord, TraineeRecord, UnitRecord } from '../store/records';

export { COMPETENCY_KEYS, type CompetencyKey };

export const CLASSES: ThreatClass[] = [
  'quad',
  'fpv',
  'fixedwing',
  'loiter',
  'bird',
  'friendly',
  'civilian',
];

export const STAGES: Stage[] = [
  'detection',
  'classification',
  'assessment',
  'engagement',
  'outcome',
];

export const RECENT_SESSIONS = 3;

export interface UnitData {
  unit: UnitRecord;
  trainees: TraineeRecord[];
  sessions: SessionRecord[];
  exams: ExamRecord[];
  profiles: Record<string, SkillProfile>;
}

export type CompetencyScores = Record<CompetencyKey, number>;

export function isExamSession(session: SessionRecord): boolean {
  return session.examId !== undefined;
}

export function chronological(sessions: SessionRecord[]): SessionRecord[] {
  return [...sessions].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function meanDifficulty(spec: ScenarioSpec): number {
  return mean(Object.values(spec.difficulty));
}

export interface SeriesPoint {
  n: number;
  sessionId: string;
  value: number;
}

export interface SplitSeries {
  trend: SeriesPoint[];
  exam: SeriesPoint[];
}

function splitSeries(
  sessions: SessionRecord[],
  valueOf: (session: SessionRecord) => number,
): SplitSeries {
  const trend: SeriesPoint[] = [];
  const exam: SeriesPoint[] = [];
  chronological(sessions).forEach((session, index) => {
    const point = { n: index + 1, sessionId: session.id, value: valueOf(session) };
    (isExamSession(session) ? exam : trend).push(point);
  });
  return { trend, exam };
}

export interface CompetencyPoint extends CompetencyScores {
  n: number;
  sessionId: string;
}

export function competencyTrend(sessions: SessionRecord[]): CompetencyPoint[] {
  const points: CompetencyPoint[] = [];
  chronological(sessions).forEach((session, index) => {
    if (isExamSession(session)) return;
    points.push({ n: index + 1, sessionId: session.id, ...session.report.competencies });
  });
  return points;
}

export function totalSeries(sessions: SessionRecord[]): SplitSeries {
  return splitSeries(sessions, (session) => session.report.total);
}

export function difficultyTrend(sessions: SessionRecord[]): SplitSeries {
  return splitSeries(sessions, (session) => meanDifficulty(session.spec));
}

export function noveltyTrend(sessions: SessionRecord[]): SplitSeries {
  return splitSeries(sessions, (session) => session.spec.noveltyScore);
}

export interface EloPoint extends CompetencyScores {
  n: number;
  sessionId: string;
}

export function eloTrend(profile: SkillProfile | undefined, sessions: SessionRecord[]): EloPoint[] {
  if (!profile) return [];
  const ordered = chronological(sessions);
  const points: EloPoint[] = [];
  const count = Math.min(profile.history.length, ordered.length);
  for (let index = 0; index < count; index++) {
    const session = ordered[index]!;
    if (isExamSession(session)) continue;
    points.push({ n: index + 1, sessionId: session.id, ...profile.history[index]!.ratings });
  }
  return points;
}

export interface ConfusionMatrix {
  rows: ThreatClass[];
  columns: (ThreatClass | 'unclassified')[];
  counts: Record<string, Record<string, number>>;
  total: number;
}

export function confusionMatrix(sessions: SessionRecord[]): ConfusionMatrix {
  const columns: ConfusionMatrix['columns'] = [...CLASSES, 'unclassified'];
  const counts: Record<string, Record<string, number>> = {};
  for (const row of CLASSES) {
    counts[row] = Object.fromEntries(columns.map((column) => [column, 0]));
  }

  let total = 0;
  for (const session of sessions) {
    const { scored } = buildFacts(session.spec, session.log);
    for (const facts of scored) {
      const chosen = facts.classification ? facts.classification.cls : 'unclassified';
      counts[facts.threat.cls]![chosen]! += 1;
      total += 1;
    }
  }

  return { rows: [...CLASSES], columns, counts, total };
}

export type ConditionGroup = 'day' | 'dusk' | 'night' | 'degraded' | 'fog' | 'rain';

export const CONDITION_GROUPS: ConditionGroup[] = [
  'day',
  'dusk',
  'night',
  'degraded',
  'fog',
  'rain',
];

export interface ReactionRow {
  group: ConditionGroup;
  meanSec: number | null;
  count: number;
}

export const DEGRADED_HEALTH = 0.7;

export function conditionGroupsOf(spec: ScenarioSpec): ConditionGroup[] {
  const groups: ConditionGroup[] = [spec.timeOfDay];
  if (spec.sensors.some((s) => s.health < DEGRADED_HEALTH || s.failAtSec !== undefined)) {
    groups.push('degraded');
  }
  if (spec.weather === 'fog') groups.push('fog');
  if (spec.weather === 'rain') groups.push('rain');
  return groups;
}

export function reactionByCondition(sessions: SessionRecord[]): ReactionRow[] {
  const sums = new Map<ConditionGroup, { total: number; count: number }>();
  for (const group of CONDITION_GROUPS) sums.set(group, { total: 0, count: 0 });

  for (const session of sessions) {
    const groups = conditionGroupsOf(session.spec);
    for (const facts of buildFacts(session.spec, session.log).scored) {
      if (facts.detectAt === null) continue;
      const reaction = Math.max(0, facts.detectAt - facts.observableAt);
      for (const group of groups) {
        const entry = sums.get(group)!;
        entry.total += reaction;
        entry.count += 1;
      }
    }
  }

  return CONDITION_GROUPS.map((group) => {
    const entry = sums.get(group)!;
    return {
      group,
      meanSec: entry.count > 0 ? entry.total / entry.count : null,
      count: entry.count,
    };
  });
}

function nonExam(sessions: SessionRecord[]): SessionRecord[] {
  return chronological(sessions).filter((session) => !isExamSession(session));
}

function recentNonExam(sessions: SessionRecord[]): SessionRecord[] {
  return nonExam(sessions).slice(-RECENT_SESSIONS);
}

function sessionsOf(data: UnitData, traineeId: string): SessionRecord[] {
  return data.sessions.filter((session) => session.traineeId === traineeId);
}

export interface HeatmapRow {
  traineeId: string;
  name: string;
  sessions: number;
  competencies: Record<CompetencyKey, number | null>;
}

export function unitHeatmap(data: UnitData): HeatmapRow[] {
  return [...data.trainees]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((trainee) => {
      const own = sessionsOf(data, trainee.id);
      const recent = recentNonExam(own);
      const competencies = {} as Record<CompetencyKey, number | null>;
      for (const key of COMPETENCY_KEYS) {
        competencies[key] =
          recent.length > 0 ? mean(recent.map((s) => s.report.competencies[key])) : null;
      }
      return { traineeId: trainee.id, name: trainee.name, sessions: own.length, competencies };
    });
}

export type ConditionDimension = 'mapType' | 'timeOfDay' | 'weather';

export interface ConditionRow {
  dimension: ConditionDimension;
  value: string;
  sessions: number;
  meanTotal: number;
  competencies: CompetencyScores;
  worst: boolean;
}

export function conditionDifficulty(data: UnitData): ConditionRow[] {
  const dimensions: ConditionDimension[] = ['mapType', 'timeOfDay', 'weather'];
  const rows: ConditionRow[] = [];

  for (const dimension of dimensions) {
    const groups = new Map<string, SessionRecord[]>();
    for (const session of data.sessions) {
      const value = session.spec[dimension];
      groups.set(value, [...(groups.get(value) ?? []), session]);
    }

    const dimensionRows: ConditionRow[] = [...groups.entries()].map(([value, members]) => {
      const competencies = {} as CompetencyScores;
      for (const key of COMPETENCY_KEYS) {
        competencies[key] = mean(members.map((s) => s.report.competencies[key]));
      }
      return {
        dimension,
        value,
        sessions: members.length,
        meanTotal: mean(members.map((s) => s.report.total)),
        competencies,
        worst: false,
      };
    });

    dimensionRows.sort((a, b) => a.meanTotal - b.meanTotal || a.value.localeCompare(b.value));
    if (dimensionRows.length > 1 && dimensionRows[0]) dimensionRows[0].worst = true;
    rows.push(...dimensionRows);
  }

  return rows;
}

export interface ExamRow {
  traineeId: string;
  name: string;
  sessionId: string;
  total: number;
  competencies: CompetencyScores;
  criticalFails: number;
}

export interface ExamTable {
  examId: string;
  seed: number | null;
  rows: ExamRow[];
  meanTotal: number;
}

export function examComparison(data: UnitData): ExamTable[] {
  const names = new Map(data.trainees.map((trainee) => [trainee.id, trainee.name]));
  const byExam = new Map<string, SessionRecord[]>();
  for (const session of data.sessions) {
    if (session.examId === undefined) continue;
    byExam.set(session.examId, [...(byExam.get(session.examId) ?? []), session]);
  }

  return [...byExam.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([examId, members]) => {
      const rows: ExamRow[] = members
        .map((session) => ({
          traineeId: session.traineeId,
          name: names.get(session.traineeId) ?? session.traineeId,
          sessionId: session.id,
          total: session.report.total,
          competencies: { ...session.report.competencies },
          criticalFails: session.report.critical.length,
        }))
        .sort((a, b) => b.total - a.total || a.traineeId.localeCompare(b.traineeId));
      const exam = data.exams.find((candidate) => candidate.id === examId);
      return {
        examId,
        seed: exam ? exam.seed : null,
        rows,
        meanTotal: mean(rows.map((row) => row.total)),
      };
    });
}

export interface RankingRow {
  rank: number;
  traineeId: string;
  name: string;
  recentMean: number | null;
  criticalFails: number;
  sessions: number;
}

export function ranking(data: UnitData): RankingRow[] {
  const rows = data.trainees.map((trainee) => {
    const own = sessionsOf(data, trainee.id);
    const recent = recentNonExam(own);
    return {
      traineeId: trainee.id,
      name: trainee.name,
      recentMean: recent.length > 0 ? mean(recent.map((s) => s.report.total)) : null,
      criticalFails: own.reduce((sum, s) => sum + s.report.critical.length, 0),
      sessions: own.length,
    };
  });

  rows.sort(
    (a, b) => (b.recentMean ?? -1) - (a.recentMean ?? -1) || a.traineeId.localeCompare(b.traineeId),
  );
  return rows.map((row, index) => ({ rank: index + 1, ...row }));
}

export function recentCompetencyMeans(sessions: SessionRecord[]): CompetencyScores | null {
  const recent = recentNonExam(sessions);
  if (recent.length === 0) return null;
  const means = {} as CompetencyScores;
  for (const key of COMPETENCY_KEYS) {
    means[key] = mean(recent.map((s) => s.report.competencies[key]));
  }
  return means;
}

export function lowestRecentCompetency(
  sessions: SessionRecord[],
): { key: CompetencyKey; value: number } | null {
  const means = recentCompetencyMeans(sessions);
  if (!means) return null;
  let lowest: CompetencyKey = COMPETENCY_KEYS[0]!;
  for (const key of COMPETENCY_KEYS) {
    if (means[key] < means[lowest]) lowest = key;
  }
  return { key: lowest, value: means[lowest] };
}

export function weakestByElo(profile: SkillProfile | undefined): CompetencyKey | null {
  if (!profile) return null;
  let weakest: CompetencyKey = COMPETENCY_KEYS[0]!;
  for (const key of COMPETENCY_KEYS) {
    if (profile.ratings[key] < profile.ratings[weakest]) weakest = key;
  }
  return weakest;
}

export function decisionTime(decision: Decision, log: SessionLog): number {
  const events = log.events.filter(
    (event) => 'threatId' in event && event.threatId === decision.threatId,
  );
  const first = (type: string) => events.find((event) => event.type === type)?.t;
  const last = (type: string) => events.filter((event) => event.type === type).at(-1)?.t;

  const observable = first('observable');
  const detect = first('detect');
  const engage = first('engage');
  const result = last('result');
  const firstEngageSeq = events.findIndex((event) => event.type === 'engage');
  const classifyBefore = events
    .filter(
      (event, index) => event.type === 'classify' && (firstEngageSeq < 0 || index < firstEngageSeq),
    )
    .at(-1)?.t;
  const rank = log.events.filter((event) => event.type === 'rank').at(-1)?.t;

  let time: number | undefined;
  switch (decision.stage) {
    case 'detection':
      time = detect;
      break;
    case 'classification':
      time = classifyBefore ?? last('classify');
      break;
    case 'assessment':
      time = rank ?? detect;
      break;
    case 'engagement':
      time = engage ?? result;
      break;
    case 'outcome':
      time = result;
      break;
  }

  return time ?? observable ?? 0;
}

export interface PointsLost {
  decision: Decision;
  lost: number;
  trueClass: ThreatClass | null;
  chosenClass: ThreatClass | null;
  time: number;
}

export function pointsLost(session: SessionRecord): PointsLost[] {
  const classes = new Map(session.spec.threats.map((threat) => [threat.id, threat.cls]));
  const chosen = new Map(
    buildFacts(session.spec, session.log).scored.map((facts) => [
      facts.threat.id,
      facts.classification ? facts.classification.cls : null,
    ]),
  );

  return session.report.decisions
    .filter((decision) => decision.points < decision.max - 1e-9)
    .map((decision) => ({
      decision,
      lost: decision.max - decision.points,
      trueClass: classes.get(decision.threatId) ?? null,
      chosenClass: chosen.get(decision.threatId) ?? null,
      time: decisionTime(decision, session.log),
    }))
    .sort((a, b) => b.lost - a.lost || a.decision.threatId.localeCompare(b.decision.threatId));
}

export interface StageTotal {
  stage: Stage;
  points: number;
  max: number;
}

export function stageTotals(session: SessionRecord): StageTotal[] {
  return STAGES.map((stage) => {
    const decisions = session.report.decisions.filter((decision) => decision.stage === stage);
    return {
      stage,
      points: session.report.byStage[stage],
      max: decisions.reduce((sum, decision) => sum + decision.max, 0),
    };
  }).filter((row) => row.max > 0);
}

export interface TrustBreakdown {
  followedWrong: number;
  overrodeWrong: number;
  followedRight: number;
  overrodeRight: number;
}

export function trustBreakdown(log: SessionLog): TrustBreakdown {
  const result: TrustBreakdown = {
    followedWrong: 0,
    overrodeWrong: 0,
    followedRight: 0,
    overrodeRight: 0,
  };
  for (const event of log.events) {
    if (event.type !== 'classify') continue;
    if (event.followedAssistant) {
      if (event.assistantCorrect) result.followedRight += 1;
      else result.followedWrong += 1;
    } else if (event.assistantCorrect) result.overrodeRight += 1;
    else result.overrodeWrong += 1;
  }
  return result;
}

export interface ThreatTimelineRow {
  threatId: string;
  cls: ThreatClass;
  hostile: boolean;
  chosen: ThreatClass | null;
  observableAt: number;
  detectAt: number | null;
  classifyAt: number | null;
  engageAt: number | null;
  resultAt: number | null;
  outcome: Outcome | null;
}

export function threatTimeline(spec: ScenarioSpec, log: SessionLog): ThreatTimelineRow[] {
  return buildFacts(spec, log).scored.map((facts) => {
    const own = log.events.filter(
      (event) => 'threatId' in event && event.threatId === facts.threat.id,
    );
    const engage = own.find((event) => event.type === 'engage');
    const classifies = own.filter((event) => event.type === 'classify');
    const results = own.filter((event) => event.type === 'result');
    const lastResult = results.at(-1);
    return {
      threatId: facts.threat.id,
      cls: facts.threat.cls,
      hostile: facts.threat.hostile,
      chosen: facts.classification ? facts.classification.cls : null,
      observableAt: facts.observableAt,
      detectAt: facts.detectAt,
      classifyAt: (classifies.at(-1) ?? null)?.t ?? null,
      engageAt: engage ? engage.t : facts.engage ? facts.engage.t : null,
      resultAt: lastResult ? lastResult.t : null,
      outcome: lastResult && lastResult.type === 'result' ? lastResult.outcome : null,
    };
  });
}
