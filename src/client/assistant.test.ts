import { describe, expect, it } from 'vitest';
import { generateScenario } from '../engine/generator';
import type { Difficulty, SessionEvent, ThreatClass } from '../schema';
import { createWorld, getObservations, replayEvents, step, type SimInput } from '../sim';
import { worldAtTime } from '../sim';

const uniform = (value: number): Difficulty => ({
  threatCount: value,
  speed: value,
  altitude: value,
  evasiveness: value,
  ambiguity: value,
  degradation: value,
  timePressure: value,
});

type ClassifyEvent = Extract<SessionEvent, { type: 'classify' }>;

function classifies(events: SessionEvent[]): ClassifyEvent[] {
  return events.filter((event): event is ClassifyEvent => event.type === 'classify');
}

function playClassify(
  seed: number,
  level: number,
  choose: (suggestion: ThreatClass, truth: ThreatClass) => ThreatClass,
) {
  const spec = generateScenario(seed, uniform(level), []);
  const world = createWorld(spec);
  const truth = new Map(spec.threats.map((threat) => [threat.id, threat.cls]));
  const seen = new Set<string>();
  const classified = new Set<string>();
  const suggestions = new Map<string, ThreatClass>();

  for (let guard = 0; guard < 40000 && !world.done; guard++) {
    const inputs: SimInput[] = [];
    for (const observation of getObservations(world)) {
      if (!observation.detected && !seen.has(observation.threatId)) {
        seen.add(observation.threatId);
        inputs.push({ type: 'detect', threatId: observation.threatId });
      } else if (observation.detected && observation.assistantSuggestion !== null) {
        if (!classified.has(observation.threatId)) {
          classified.add(observation.threatId);
          suggestions.set(observation.threatId, observation.assistantSuggestion);
          inputs.push({
            type: 'classify',
            threatId: observation.threatId,
            cls: choose(observation.assistantSuggestion, truth.get(observation.threatId)!),
            confidence: 0.8,
          });
        }
      }
    }
    step(world, inputs);
  }

  return { spec, world, suggestions, truth };
}

describe('assistant suggestion and logged flags', () => {
  it('logs followedAssistant true when the trainee picks the suggestion', () => {
    const { world, suggestions, truth } = playClassify(3, 0.5, (suggestion) => suggestion);
    const events = classifies(world.events);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.cls).toBe(suggestions.get(event.threatId));
      expect(event.followedAssistant).toBe(true);
      expect(event.assistantCorrect).toBe(
        suggestions.get(event.threatId) === truth.get(event.threatId),
      );
    }
  });

  it('logs followedAssistant false when the trainee picks their own answer', () => {
    const { world, suggestions, truth } = playClassify(
      4,
      0.5,
      (_suggestion, trueClass) => trueClass,
    );
    const events = classifies(world.events);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const suggestion = suggestions.get(event.threatId)!;
      expect(event.cls).toBe(truth.get(event.threatId));
      expect(event.followedAssistant).toBe(suggestion === truth.get(event.threatId));
      expect(event.assistantCorrect).toBe(suggestion === truth.get(event.threatId));
    }
  });

  it('flags an overridden wrong suggestion and a followed wrong suggestion differently', () => {
    const followed = playClassify(5, 0.9, (suggestion) => suggestion);
    const overrode = playClassify(5, 0.9, (_s, trueClass) => trueClass);

    const followedWrong = classifies(followed.world.events).filter(
      (event) => event.followedAssistant && !event.assistantCorrect,
    );
    const overrodeWrong = classifies(overrode.world.events).filter(
      (event) => !event.followedAssistant && !event.assistantCorrect,
    );
    expect(followedWrong.length).toBeGreaterThan(0);
    expect(overrodeWrong.length).toBeGreaterThan(0);
    expect(
      classifies(overrode.world.events).every(
        (event) => event.cls === overrode.truth.get(event.threatId),
      ),
    ).toBe(true);
  });

  it('keeps the assistant suggestion identical under replay', () => {
    const { spec, world } = playClassify(6, 0.5, (suggestion) => suggestion);
    const log = { scenarioId: spec.id, traineeId: 't', events: world.events };
    expect(replayEvents(spec, log, spec.durationSec)).toEqual(world.events);

    const original = createWorld(spec).threats.map((t) => t.assistantSuggestion);
    const replayed = worldAtTime(spec, log, 30, spec.durationSec).threats.map(
      (t) => t.assistantSuggestion,
    );
    expect(replayed).toEqual(original);
  });

  it('withholds the suggestion until the contact is detected', () => {
    const spec = generateScenario(7, uniform(0.5), []);
    const world = createWorld(spec);
    for (let guard = 0; guard < 4000 && getObservations(world).length === 0; guard++) {
      step(world, []);
    }
    const first = getObservations(world)[0]!;
    expect(first.detected).toBe(false);
    expect(first.assistantSuggestion).toBeNull();
    step(world, [{ type: 'detect', threatId: first.threatId }]);
    const after = getObservations(world).find((o) => o.threatId === first.threatId)!;
    expect(after.assistantSuggestion).not.toBeNull();
  });

  it('measures the assistant error rate at difficulty 0.1, 0.5 and 0.9', () => {
    const rate = (level: number) => {
      let wrong = 0;
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const spec = generateScenario(seed, uniform(level), []);
        for (const threat of createWorld(spec).threats) {
          total += 1;
          if (threat.assistantSuggestion !== threat.spec.cls) wrong += 1;
        }
      }
      return wrong / total;
    };

    const low = rate(0.1);
    const mid = rate(0.5);
    const high = rate(0.9);
    expect(low).toBeGreaterThan(0.05);
    expect(low).toBeLessThan(0.2);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.5);
    expect(high).toBeGreaterThan(0.55);
    expect(high).toBeLessThan(0.8);
  });
});
