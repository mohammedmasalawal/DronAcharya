import { ScenarioSpecSchema, type ScenarioSpec } from '../schema';
import birdFlock from '../../data/scenarios/bird-flock-civilian-drone.json';
import decoySaturation from '../../data/scenarios/decoy-saturation.json';
import feintAndStrike from '../../data/scenarios/feint-and-strike.json';
import fogEoBlinded from '../../data/scenarios/fog-eo-blinded.json';
import fpvUrbanStreet from '../../data/scenarios/fpv-urban-street.json';
import friendlyCrossing from '../../data/scenarios/friendly-crossing.json';
import loneRecon from '../../data/scenarios/lone-recon-dusk.json';
import mixedFinale from '../../data/scenarios/mixed-class-finale.json';
import nightSwarm from '../../data/scenarios/night-swarm-radar-failure.json';
import rfSilentStrike from '../../data/scenarios/rf-silent-autonomous-strike.json';

const SOURCES: Record<string, unknown> = {
  'lone-recon-dusk': loneRecon,
  'fpv-urban-street': fpvUrbanStreet,
  'night-swarm-radar-failure': nightSwarm,
  'decoy-saturation': decoySaturation,
  'bird-flock-civilian-drone': birdFlock,
  'rf-silent-autonomous-strike': rfSilentStrike,
  'feint-and-strike': feintAndStrike,
  'fog-eo-blinded': fogEoBlinded,
  'friendly-crossing': friendlyCrossing,
  'mixed-class-finale': mixedFinale,
};

export const SCRIPTED_NAMES: string[] = Object.keys(SOURCES);

export function loadScripted(name: string): ScenarioSpec {
  const source = SOURCES[name];
  if (source === undefined) {
    throw new Error(`Unknown scripted scenario "${name}". Available: ${SCRIPTED_NAMES.join(', ')}`);
  }
  return ScenarioSpecSchema.parse(source);
}

export function loadAllScripted(): ScenarioSpec[] {
  return SCRIPTED_NAMES.map(loadScripted);
}
