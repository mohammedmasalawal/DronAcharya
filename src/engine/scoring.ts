import type { ScenarioSpec, ScoreReport, ScoringTree, SessionLog } from '../schema';

export function scoreSession(spec: ScenarioSpec, log: SessionLog, _tree: ScoringTree): ScoreReport {
  return {
    sessionId: `${spec.id}:${log.traineeId}`,
    total: 0,
    byStage: { detection: 0, classification: 0, assessment: 0, engagement: 0, outcome: 0 },
    decisions: [],
    competencies: { detect: 0, classify: 0, prioritise: 0, engage: 0, roe: 0, trust: 0 },
    critical: [],
  };
}
