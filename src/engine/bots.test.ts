import { describe, expect, it } from 'vitest';
import type { Difficulty, ScenarioSpec, SessionEvent } from '../schema';
import { replayEvents } from '../sim';
import { runBot, type BotKind } from './bots';
import { DEFAULT_TREE } from './defaultTree';
import { generateScenario } from './generator';
import { analyseSession } from './scoring';

const uniform = (value: number): Difficulty => ({
  threatCount: value,
  speed: value,
  altitude: value,
  evasiveness: value,
  ambiguity: value,
  degradation: value,
  timePressure: value,
});

const KINDS: BotKind[] = ['expert', 'novice', 'overtrusting'];
const seeds = (count: number, from = 1) => Array.from({ length: count }, (_, i) => from + i);
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

const score = (spec: ScenarioSpec, kind: BotKind) =>
  analyseSession(spec, runBot(spec, kind), DEFAULT_TREE).report;

describe('bots drive the real sim', () => {
  const spec = generateScenario(11, uniform(0.5), []);

  it.each(KINDS)('%s produces real observable and result events', (kind) => {
    const log = runBot(spec, kind);
    expect(log.traineeId).toBe(`bot-${kind}`);
    expect(log.scenarioId).toBe(spec.id);
    expect(log.events.some((e) => e.type === 'observable')).toBe(true);
    expect(log.events.some((e) => e.type === 'result')).toBe(true);
    expect(log.events.some((e) => e.type === 'detect')).toBe(true);
  });

  it.each(KINDS)('%s is deterministic', (kind) => {
    expect(runBot(spec, kind)).toEqual(runBot(spec, kind));
  });

  it.each(KINDS)('%s replays to exactly the same events', (kind) => {
    const log = runBot(spec, kind);
    expect(replayEvents(spec, log)).toEqual(log.events);
  });

  it('differs between kinds', () => {
    const a = runBot(spec, 'expert').events;
    const b = runBot(spec, 'novice').events;
    expect(a).not.toEqual(b);
  });

  it('replays across many specs for every bot', () => {
    for (const seed of seeds(12, 100)) {
      const scenario = generateScenario(seed, uniform(0.2 + (seed % 7) * 0.1), []);
      for (const kind of KINDS) {
        const log = runBot(scenario, kind);
        expect(replayEvents(scenario, log)).toEqual(log.events);
      }
    }
  });
});

describe('expert', () => {
  it('scores at least 70 on every generated spec at difficulty 0.7 or below', () => {
    const low: string[] = [];
    for (const seed of seeds(40)) {
      const level = 0.1 + (seed % 7) * 0.1;
      const spec = generateScenario(seed, uniform(level), []);
      const report = score(spec, 'expert');
      if (report.total < 70)
        low.push(`seed ${seed} @${level.toFixed(1)}: ${report.total.toFixed(1)}`);
    }
    expect(low).toEqual([]);
  }, 120_000);

  it('never fires on a non-threat and never violates the ROE', () => {
    for (const seed of seeds(15)) {
      const spec = generateScenario(seed, uniform(0.6), []);
      const log = runBot(spec, 'expert');
      const hostile = new Set(spec.threats.filter((t) => t.hostile).map((t) => t.id));
      const engaged = log.events.filter(
        (e): e is Extract<SessionEvent, { type: 'engage' }> => e.type === 'engage',
      );
      expect(engaged.every((e) => hostile.has(e.threatId))).toBe(true);
      const report = analyseSession(spec, log, DEFAULT_TREE).report;
      expect(report.competencies.roe).toBe(100);
      expect(report.critical).toEqual([]);
    }
  });

  it('detects contacts within about one to two seconds', () => {
    const spec = generateScenario(4, uniform(0.3), []);
    const log = runBot(spec, 'expert');
    for (const event of log.events) {
      if (event.type !== 'detect') continue;
      const seen = log.events.find(
        (e) => e.type === 'observable' && e.threatId === event.threatId,
      )!;
      expect(event.t - seen.t).toBeLessThan(2.5);
    }
  });
});

describe('novice and overtrusting', () => {
  const specs = seeds(30).map((seed) => generateScenario(seed, uniform(0.5), []));

  it('the expert beats the novice by at least 15 points on average', () => {
    const expert = mean(specs.map((s) => score(s, 'expert').total));
    const novice = mean(specs.map((s) => score(s, 'novice').total));
    expect(expert - novice).toBeGreaterThanOrEqual(15);
  }, 120_000);

  it('the overtrusting bot has the lowest trust', () => {
    const trust = (kind: BotKind) => mean(specs.map((s) => score(s, kind).competencies.trust));
    const overtrusting = trust('overtrusting');
    expect(overtrusting).toBeLessThan(trust('expert'));
    expect(overtrusting).toBeLessThan(trust('novice'));
  }, 120_000);

  it('the overtrusting bot always follows the assistant', () => {
    for (const spec of specs.slice(0, 10)) {
      const classifies = runBot(spec, 'overtrusting').events.filter(
        (e): e is Extract<SessionEvent, { type: 'classify' }> => e.type === 'classify',
      );
      expect(classifies.length).toBeGreaterThan(0);
      expect(classifies.every((e) => e.followedAssistant)).toBe(true);
    }
  });

  it('the novice is right about 60% of the time and reacts slowly', () => {
    let right = 0;
    let total = 0;
    const delays: number[] = [];

    for (const spec of specs) {
      const log = runBot(spec, 'novice');
      const truth = new Map(spec.threats.map((t) => [t.id, t.cls]));
      for (const event of log.events) {
        if (event.type === 'classify') {
          total += 1;
          if (truth.get(event.threatId) === event.cls) right += 1;
        }
        if (event.type === 'detect') {
          const seen = log.events.find(
            (e) => e.type === 'observable' && e.threatId === event.threatId,
          );
          if (seen) delays.push(event.t - seen.t);
        }
      }
    }

    expect(right / total).toBeGreaterThan(0.45);
    expect(right / total).toBeLessThan(0.75);
    expect(mean(delays)).toBeGreaterThan(4);
  }, 120_000);

  it('the novice sometimes engages non-threats or picks the wrong effector', () => {
    let nonThreatEngages = 0;
    let wasted = 0;
    for (const spec of specs) {
      const log = runBot(spec, 'novice');
      const hostile = new Set(spec.threats.filter((t) => t.hostile).map((t) => t.id));
      for (const event of log.events) {
        if (event.type === 'engage' && !hostile.has(event.threatId)) nonThreatEngages += 1;
        if (event.type === 'result' && event.outcome === 'wasted' && hostile.has(event.threatId)) {
          wasted += 1;
        }
      }
    }
    expect(nonThreatEngages).toBeGreaterThan(0);
    expect(wasted).toBeGreaterThan(0);
  }, 120_000);
});
