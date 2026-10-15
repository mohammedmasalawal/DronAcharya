import type { Competencies, Difficulty, ScoreReport } from '../schema';

export interface SkillProfile {
  traineeId: string;
  sessions: number;
  skill: Competencies;
}

export function updateSkill(profile: SkillProfile, report: ScoreReport): SkillProfile {
  return { ...profile, sessions: profile.sessions + 1, skill: report.competencies };
}

export function nextDifficulty(_profile: SkillProfile): Difficulty {
  return {
    threatCount: 0.5,
    speed: 0.5,
    altitude: 0.5,
    evasiveness: 0.5,
    ambiguity: 0.5,
    degradation: 0.5,
    timePressure: 0.5,
  };
}
