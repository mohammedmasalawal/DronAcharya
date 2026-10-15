import type { SkillProfile } from '../engine/adaptive';
import {
  getProfile,
  getSession,
  getTrainee,
  getUnit,
  listSessions,
  listTrainees,
  listUnitSessions,
  listUnits,
  listExams,
  type SessionRecord,
  type TraineeRecord,
  type UnitRecord,
} from '../store';
import type { UnitData } from './data';
import { ensureDemoSeeded } from './demo';

export interface ReviewIndex {
  units: {
    unit: UnitRecord;
    trainees: { trainee: TraineeRecord; sessions: number; latestSessionId: string | null }[];
  }[];
}

export async function loadReviewIndex(): Promise<ReviewIndex> {
  await ensureDemoSeeded();
  const units = await listUnits();
  const result: ReviewIndex['units'] = [];

  for (const unit of units) {
    const sessions = await listUnitSessions(unit.id);
    const trainees = await listTrainees(unit.id);
    result.push({
      unit,
      trainees: trainees.map((trainee) => {
        const own = sessions.filter((session) => session.traineeId === trainee.id);
        return {
          trainee,
          sessions: own.length,
          latestSessionId: own.length > 0 ? own[own.length - 1]!.id : null,
        };
      }),
    });
  }

  return { units: result };
}

export async function loadSessionView(
  sessionId: string,
): Promise<{ session: SessionRecord; trainee: TraineeRecord | undefined } | null> {
  await ensureDemoSeeded();
  const session = await getSession(sessionId);
  if (!session) return null;
  return { session, trainee: await getTrainee(session.traineeId) };
}

export interface TraineeView {
  trainee: TraineeRecord;
  unit: UnitRecord | undefined;
  sessions: SessionRecord[];
  profile: SkillProfile | undefined;
}

export async function loadTraineeView(traineeId: string): Promise<TraineeView | null> {
  await ensureDemoSeeded();
  const trainee = await getTrainee(traineeId);
  if (!trainee) return null;
  return {
    trainee,
    unit: await getUnit(trainee.unitId),
    sessions: await listSessions(traineeId),
    profile: await getProfile(traineeId),
  };
}

export async function loadUnitData(unitId: string): Promise<UnitData | null> {
  await ensureDemoSeeded();
  const unit = await getUnit(unitId);
  if (!unit) return null;
  const trainees = await listTrainees(unitId);
  const profiles: Record<string, SkillProfile> = {};
  for (const trainee of trainees) {
    const profile = await getProfile(trainee.id);
    if (profile) profiles[trainee.id] = profile;
  }
  return {
    unit,
    trainees,
    sessions: await listUnitSessions(unitId),
    exams: await listExams(unitId),
    profiles,
  };
}
