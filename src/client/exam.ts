import { generateScenario } from '../engine/generator';
import type { Difficulty, ScenarioSpec } from '../schema';

const DEFAULT_DIFFICULTY: Difficulty = {
  threatCount: 0.5,
  speed: 0.5,
  altitude: 0.5,
  evasiveness: 0.5,
  ambiguity: 0.5,
  degradation: 0.5,
  timePressure: 0.5,
};

export function seedForExam(examId: string): number {
  if (/^\d{1,9}$/.test(examId)) return Number(examId);

  let hash = 0x811c9dc5;
  for (let i = 0; i < examId.length; i++) {
    hash ^= examId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 1;
}

export function specForExam(examId: string): ScenarioSpec {
  return generateScenario(seedForExam(examId), DEFAULT_DIFFICULTY, []);
}
