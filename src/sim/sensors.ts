import type {
  MapType,
  ScenarioSpec,
  Sensor,
  SensorType,
  Threat,
  ThreatClass,
  TimeOfDay,
  Weather,
} from '../schema';
import type { ThreatState } from './types';

const BASE_RANGE_M: Record<SensorType, number> = { radar: 6000, eoir: 3500, rf: 5000 };

const SIGNATURE: Record<ThreatClass, number> = {
  quad: 0.7,
  fpv: 0.55,
  fixedwing: 1,
  loiter: 0.85,
  bird: 0.45,
  friendly: 0.7,
  civilian: 1.3,
};

const EOIR_LIGHT: Record<TimeOfDay, number> = { day: 1, dusk: 0.7, night: 0.4 };
const EOIR_WEATHER: Record<Weather, number> = { clear: 1, haze: 0.7, rain: 0.8, fog: 0.4 };
const RADAR_WEATHER: Record<Weather, number> = { clear: 1, haze: 1, rain: 0.85, fog: 1 };
const TERRAIN_MASK: Record<MapType, number> = {
  urban: 0.35,
  hilly: 0.35,
  industrial: 0.5,
  rural: 0.7,
};
const LOW_CLUTTER: Record<MapType, number> = { urban: 0.7, hilly: 0.7, industrial: 0.85, rural: 1 };
const LOW_ALTITUDE_M = 40;

type Conditions = Pick<ScenarioSpec, 'mapType' | 'timeOfDay' | 'weather'>;

export function isSensorAlive(sensor: Sensor, t: number): boolean {
  return sensor.failAtSec === undefined || t < sensor.failAtSec;
}

export function detectionRangeM(
  sensor: Sensor,
  threat: Threat,
  altM: number,
  conditions: Conditions,
): number {
  const base = BASE_RANGE_M[sensor.type] * sensor.health;

  if (sensor.type === 'rf') {
    return threat.rfEmitting ? base : 0;
  }

  const signature = SIGNATURE[threat.cls];

  if (sensor.type === 'eoir') {
    return base * signature * EOIR_LIGHT[conditions.timeOfDay] * EOIR_WEATHER[conditions.weather];
  }

  const masked = threat.behavior === 'terrain_mask' ? TERRAIN_MASK[conditions.mapType] : 1;
  const clutter = altM < LOW_ALTITUDE_M ? LOW_CLUTTER[conditions.mapType] : 1;
  return base * signature * RADAR_WEATHER[conditions.weather] * masked * clutter;
}

export function slantRangeM(threat: ThreatState): number {
  return Math.hypot(threat.x, threat.y, threat.alt);
}

export function visibleSensors(spec: ScenarioSpec, threat: ThreatState, t: number): SensorType[] {
  const range = slantRangeM(threat);
  const seen = new Set<SensorType>();

  for (const sensor of spec.sensors) {
    if (!isSensorAlive(sensor, t)) continue;
    if (range <= detectionRangeM(sensor, threat.spec, threat.alt, spec)) {
      seen.add(sensor.type);
    }
  }

  return [...seen];
}
