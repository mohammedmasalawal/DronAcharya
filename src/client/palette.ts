import type { MapType, ThreatClass, TimeOfDay, Weather } from '../schema';
import type { GroundTruth, ThreatStatus } from '../sim';

export const CLASS_LABEL: Record<ThreatClass, string> = {
  quad: 'Quadcopter',
  fpv: 'FPV drone',
  fixedwing: 'Fixed-wing',
  loiter: 'Loitering munition',
  bird: 'Bird',
  friendly: 'Friendly',
  civilian: 'Civilian',
};

export const CLASS_ORDER: ThreatClass[] = [
  'quad',
  'fpv',
  'fixedwing',
  'loiter',
  'bird',
  'friendly',
  'civilian',
];

export const GROUND_COLOR: Record<MapType, string> = {
  rural: '#3f6a34',
  urban: '#4d5259',
  hilly: '#5e5238',
  industrial: '#44494f',
};

export const SKY_COLOR: Record<TimeOfDay, string> = {
  day: '#a9c8e6',
  dusk: '#b87a5c',
  night: '#080c18',
};

export const LIGHT_LEVEL: Record<TimeOfDay, number> = { day: 1, dusk: 0.6, night: 0.28 };

export const FOG_FAR_M: Record<Weather, number> = {
  clear: 40000,
  haze: 15000,
  rain: 12000,
  fog: 6000,
};

export const UNDETECTED_COLOR = '#8d96a8';
export const DETECTED_COLOR = '#ffc83d';
export const SELECTED_COLOR = '#ffffff';

export function truthColor(truth: GroundTruth): string {
  if (truth.cls === 'friendly') return '#3ddc84';
  if (truth.cls === 'civilian') return '#4db8ff';
  if (truth.cls === 'bird') return '#c9a26b';
  return '#ff5252';
}

export function isResolved(status: ThreatStatus): boolean {
  return status !== 'active' && status !== 'pending';
}
