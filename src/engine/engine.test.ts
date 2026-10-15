import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONDITION_IDS,
  ScenarioSpecSchema,
  ScoreReportSchema,
  ScoringTreeSchema,
  SessionEventSchema,
} from '../schema';
import { generateScenario } from './generator';
import { runBot } from './bots';
import { analyseSession, scoreSession } from './scoring';
import { createProfile, updateSkill } from './adaptive';

const tree = ScoringTreeSchema.parse(
  JSON.parse(readFileSync('data/scoring-tree.default.json', 'utf8')),
);

const difficulty = {
  threatCount: 0.5,
  speed: 0.5,
  altitude: 0.5,
  evasiveness: 0.5,
  ambiguity: 0.5,
  degradation: 0.5,
  timePressure: 0.5,
};

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

describe('condition ids', () => {
  it('are used by every branch and critical fail in the default tree', () => {
    const ids = new Set<string>(CONDITION_IDS);
    for (const node of tree.nodes) {
      for (const branch of node.branches) {
        expect(ids.has(branch.condition)).toBe(true);
      }
    }
    for (const fail of tree.criticalFails) {
      expect(ids.has(fail.condition)).toBe(true);
    }
  });

  it('are the only conditions the schema accepts', () => {
    const bad = {
      ...tree,
      nodes: tree.nodes.map((node, i) =>
        i === 0 ? { ...node, branches: [{ condition: 'made_up', points: 1, label: 'x' }] } : node,
      ),
    };
    expect(() => ScoringTreeSchema.parse(bad)).toThrow();
  });

  it('are unique', () => {
    expect(new Set(CONDITION_IDS).size).toBe(CONDITION_IDS.length);
  });
});

describe('classify event', () => {
  it('carries followedAssistant and assistantCorrect', () => {
    const event = {
      type: 'classify',
      t: 12,
      threatId: 't1',
      cls: 'quad',
      confidence: 0.8,
      followedAssistant: true,
      assistantCorrect: false,
    };
    expect(() => SessionEventSchema.parse(event)).not.toThrow();
    expect(() => SessionEventSchema.parse({ ...event, followedAssistant: undefined })).toThrow();
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
    const { report, extras } = analyseSession(spec, runBot(spec, 'novice'), tree);
    const next = updateSkill(createProfile('x'), report, extras, difficulty);
    expect(next.sessions).toBe(1);
  });
});
