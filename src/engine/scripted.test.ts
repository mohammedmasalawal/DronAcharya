import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ScenarioSpecSchema } from '../schema';
import { replayEvents } from '../sim';
import { runBot } from './bots';
import { DEFAULT_TREE } from './defaultTree';
import { SCRIPTED_NAMES, loadScripted } from './scripted';
import { analyseSession } from './scoring';
import { checkSolvability } from './solvability';

describe('scripted scenarios', () => {
  it('has the ten required scenarios, one file each', () => {
    const files = readdirSync('data/scenarios')
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, ''))
      .sort();
    expect(files).toHaveLength(10);
    expect([...SCRIPTED_NAMES].sort()).toEqual(files);
    expect(files).toEqual(
      [
        'bird-flock-civilian-drone',
        'decoy-saturation',
        'feint-and-strike',
        'fog-eo-blinded',
        'fpv-urban-street',
        'friendly-crossing',
        'lone-recon-dusk',
        'mixed-class-finale',
        'night-swarm-radar-failure',
        'rf-silent-autonomous-strike',
      ].sort(),
    );
  });

  it.each(SCRIPTED_NAMES)('%s validates, is solvable and the expert scores 70 or more', (name) => {
    const spec = loadScripted(name);
    expect(() => ScenarioSpecSchema.parse(spec)).not.toThrow();
    expect(checkSolvability(spec, { dynamic: true })).toEqual({ ok: true, problems: [] });

    const log = runBot(spec, 'expert');
    expect(replayEvents(spec, log)).toEqual(log.events);
    const { report } = analyseSession(spec, log, DEFAULT_TREE);
    expect(report.total).toBeGreaterThanOrEqual(70);
    expect(report.critical).toEqual([]);
  });

  it('covers the intended features', () => {
    const specs = SCRIPTED_NAMES.map(loadScripted);
    const byName = (name: string) => loadScripted(name);

    expect(byName('lone-recon-dusk').timeOfDay).toBe('dusk');
    expect(byName('fpv-urban-street').mapType).toBe('urban');
    expect(
      byName('night-swarm-radar-failure').sensors.some((s) => s.type === 'radar' && s.failAtSec),
    ).toBe(true);
    expect(
      byName('night-swarm-radar-failure').threats.filter((t) => t.swarmId).length,
    ).toBeGreaterThanOrEqual(4);
    expect(byName('decoy-saturation').threats.filter((t) => !t.hostile).length).toBeGreaterThan(
      byName('decoy-saturation').threats.filter((t) => t.hostile).length,
    );
    expect(
      byName('bird-flock-civilian-drone').threats.filter((t) => t.cls === 'bird').length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      byName('rf-silent-autonomous-strike')
        .threats.filter((t) => t.hostile)
        .some((t) => !t.rfEmitting),
    ).toBe(true);
    expect(
      new Set(byName('feint-and-strike').threats.map((t) => Math.floor(t.bearingDeg / 90))).size,
    ).toBeGreaterThanOrEqual(2);
    expect(byName('fog-eo-blinded').weather).toBe('fog');
    expect(byName('friendly-crossing').threats.some((t) => t.cls === 'friendly')).toBe(true);
    expect(
      new Set(byName('mixed-class-finale').threats.map((t) => t.cls)).size,
    ).toBeGreaterThanOrEqual(6);
    expect(specs.every((s) => s.id.startsWith('scripted-'))).toBe(true);
  });

  it('rejects an unknown name', () => {
    expect(() => loadScripted('nope')).toThrow(/Unknown scripted scenario/);
  });
});
