import type { ScenarioSpec, SessionEvent } from '../schema';
import { saveSession } from '../store';

export interface CompleteSessionInput {
  spec: ScenarioSpec;
  events: SessionEvent[];
  endedAtSec: number;
  traineeId: string;
  unitId: string;
  examId?: string;
}

export interface CompletedSession {
  id: string;
  debriefPath: string;
}

export function debriefPath(sessionId: string): string {
  return `/debrief/${encodeURIComponent(sessionId)}`;
}

export function replayPath(sessionId: string, seconds = 0): string {
  return `/replay/${encodeURIComponent(sessionId)}?t=${Math.max(0, seconds).toFixed(1)}`;
}

export async function completeSession(input: CompleteSessionInput): Promise<CompletedSession> {
  const id = await saveSession({
    spec: input.spec,
    log: {
      scenarioId: input.spec.id,
      traineeId: input.traineeId,
      events: input.events,
    },
    endedAtSec: input.endedAtSec,
    traineeId: input.traineeId,
    unitId: input.unitId,
    examId: input.examId,
  });
  return { id, debriefPath: debriefPath(id) };
}
