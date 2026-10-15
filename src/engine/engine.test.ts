import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ScenarioSpecSchema, ScoreReportSchema, ScoringTreeSchema } from '../schema';
import { generateScenario } from './generator';
import { runBot } from './bots';
import { scoreSession } from './scoring';
import { nextDifficulty, updateSkill } from './adaptive';

const tree = ScoringTreeSchema.parse(
  JSON.parse(readFileSync('data/scoring-tree.default.json', 'utf8')),
);

const difficulty = nextDifficulty({
  traineeId: 'x',
  sessions: 0,
  skill: { detect: 0, classify: 0, prioritise: 0, engage: 0, roe: 0, trust: 0 },
});

describe('scoring tree', () => {
  it('has stage weights that sum to 100', () => {
    const total = Object.values(tree.weights).reduce((sum, w) => sum + w, 0);
    expect(total).toBe(100);
  });

  it('has a node for every weighted stage', () => {
    const stages = new Set(tree.nodes.map((node) => node.stage));
    for (const stage of Object.keys(tree.weights)) {
      expect(stages.has(stage as keyof typeof tree.weights)).toBe(true);
    }
  });
});

describe('generateScenario', () => {
  it('is deterministic for the same seed', () => {
    expect(generateScenario(42, difficulty, [])).toEqual(generateScenario(42, difficulty, []));
  });

  it('differs across seeds', () => {
    expect(generateScenario(1, difficulty, [])).not.toEqual(generateScenario(2, difficulty, []));
  });

  it('produces a schema-valid spec', () => {
    expect(() => ScenarioSpecSchema.parse(generateScenario(3, difficulty, []))).not.toThrow();
  });
});

describe('bots and scoring', () => {
  it('runs a bot and returns a schema-valid report', () => {
    const spec = generateScenario(1, difficulty, []);
    const log = runBot(spec, 'expert');
    const report = scoreSession(spec, log, tree);
    expect(() => ScoreReportSchema.parse(report)).not.toThrow();
  });

  it('counts sessions when updating skill', () => {
    const spec = generateScenario(1, difficulty, []);
    const report = scoreSession(spec, runBot(spec, 'novice'), tree);
    const profile = { traineeId: 'x', sessions: 0, skill: report.competencies };
    expect(updateSkill(profile, report).sessions).toBe(1);
  });
});
